// Independent local review probes. No candidate source edits, network, or real effects.
// Run: node plans/004-review-probes.cjs /absolute/path/to/candidate
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const root = process.argv[2];
if (!root) throw new Error('Pass the candidate checkout.');
const web = path.join(root, 'apps/web');
const runtime = path.join(root, 'apps/runtime/src');
const localRequire = createRequire(path.join(web, 'package.json'));
const ts = localRequire('typescript');
const overrides = new Map();
const cache = new Map();
function load(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  function resolve(specifier) {
    if (overrides.has(specifier)) return overrides.get(specifier);
    if (specifier.startsWith('#/')) return load(path.join(web, 'src', `${specifier.slice(2)}.ts`));
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(absolute), specifier);
      return load(target.endsWith('.js') ? target.slice(0, -3) + '.ts' : target.endsWith('.ts') ? target : target + '.ts');
    }
    return localRequire(specifier);
  }
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
const fixtures = load(path.join(web, 'src/test/session-runtime-fixture.ts'));
const journal = load(path.join(runtime, 'journal.ts'));
const cryptoModule = load(path.join(runtime, 'runtime-crypto.ts'));
const coordinatorModule = load(path.join(runtime, 'session-runtime.ts'));
const projector = load(path.join(runtime, 'product-projector.ts'));
const d1Utils = load(path.join(web, 'src/lib/sqlite-d1-test-utils.ts'));
const results = [];
const allFixtures = [];
function check(name, ok, observed) {
  const result = { name, result: ok ? 'PASS' : 'FAIL', observed };
  results.push(result); console.log(JSON.stringify(result));
}
class FakeEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
class FakeContainer extends FakeEntrypoint { async schedule() {} }
overrides.set('cloudflare:workers', { env: {}, WorkerEntrypoint: FakeEntrypoint });
overrides.set('@cloudflare/containers', { Container: FakeContainer });
overrides.set('@cloudflare/sandbox', { Sandbox: FakeContainer });
overrides.set('@tanstack/react-router', { createFileRoute: () => (options) => options });
overrides.set('#/db', { createDb: () => fixtures.sessionRuntimeRouteHarness.db });
overrides.set('#/lib/auth', { createAuth: () => ({ api: { getSession: async () => fixtures.sessionRuntimeRouteHarness.userId ? { user: { id: fixtures.sessionRuntimeRouteHarness.userId } } : null } }) });
const unexpected = () => { throw new Error('Unexpected legacy execution'); };
overrides.set('#/lib/agent-run-service', { prepareAgentRun: unexpected, executeAgentRun: unexpected, agentStreamBodySchema: { safeParse: unexpected } });
overrides.set('#/lib/agent-control-service', { controlAgentRun: unexpected, agentControlBodySchema: { safeParse: unexpected } });
const prompt = { version: 1, kind: 'prompt', projectId: 'proj-1', sessionId: 'sess-1', text: 'synthetic review input', idempotencyKey: 'key-1' };
function fixture(options) {
  const f = fixtures.createSessionRuntimeFixture(options); f.seedTrustedSession(); allFixtures.push(f); return f;
}
async function admit(f, input = {}) { return (await f.asUser('user-1').command({ ...prompt, ...input })).body.commandId; }
async function ready(options) {
  const f = fixture(options); const id = await admit(f); await f.deliver(); return { f, id, c: f.coordinator('sess-1') };
}
async function stop(f, runId, key = 'stop-1') {
  return f.asUser('user-1').command({ version: 1, kind: 'stop', projectId: 'proj-1', sessionId: 'sess-1', idempotencyKey: key, targetRunId: runId }, { path: 'control' });
}
function effect(f, id, patch = {}) {
  return { version: 1, runId: id, assistantEntryId: f.observeReceipt(id).assistantMessageId, toolCallId: 'tool-1', attempt: 1, executorIncarnationId: 'synthetic-exec-1', runEpoch: 1, lifecycleGeneration: 1, deadline: f.now() + 60000, arguments: { operation: 'synthetic' }, outcomePolicy: 'never_retry', state: 'prepared', ...patch };
}
async function attempt(fn) {
  try { return { accepted: true, value: await fn() }; }
  catch (error) { return { accepted: false, code: error?.code ?? error?.name ?? 'error' }; }
}
async function observe(f) { return (await f.asUser('user-1').observe({ projectId: 'proj-1', sessionId: 'sess-1' })).body.snapshot; }
function assistantStatuses(f) { return f.observeMessages('sess-1').filter((m) => m.role === 'assistant').map((m) => m.status); }
async function main() {
  {
    const server = load(path.join(runtime, 'server.ts'));
    const routes = [];
    const entry = new server.RuntimeEntrypoint({}, { SessionRuntime: { getByName(name) { routes.push(name); return { acceptCommand: async () => ({}), control: async () => ({}), readSnapshot: async () => ({}) }; } } });
    await entry.deliver({ commandId: 'command-a', ownerVersion: 1 });
    await entry.control({ commandId: 'stop-a', ownerVersion: 1 });
    await entry.readSnapshot({ sessionId: 'workspace-a' });
    check('private delivery and control route to the same workspace coordinator as observation', routes.every((r) => r === 'workspace-a'), { routes });
    const sqlite = new DatabaseSync(':memory:'); const adapter = journal.createNodeSqliteAdapter(sqlite);
    const state = { id: { toString: () => 'synthetic-do-id' }, blockConcurrencyWhile: async (fn) => fn(), storage: { sql: { exec: (sql, ...args) => ({ toArray: () => adapter.query(sql, ...args) }) }, transactionSync: (fn) => adapter.transaction(fn) } };
    const instance = new server.SessionRuntime(state, { RUNTIME_ENCRYPTION_CURRENT_KEY_VERSION: 'v1', RUNTIME_ENCRYPTION_KEYS: JSON.stringify({ v1: '07'.repeat(32) }) });
    const ack = await attempt(() => instance.acceptCommand({ commandId: 'persisted-command', ownerVersion: 1 }));
    check('Container class has a usable reconstruction adapter', ack.accepted, { accepted: ack.accepted, errorCategory: ack.code, hasEffectMethod: typeof instance.admitEffect === 'function', hasContinuationMethod: typeof instance.commitContinuation === 'function' });
    sqlite.close();
  }
  {
    const f = fixture(); const id = await admit(f);
    f.sqlite.exec('UPDATE workspace_sessions SET runtimeOwnerVersion = 3');
    const c = await f.ensureCoordinator({ sessionId: 'sess-1' });
    const accepted = await attempt(() => c.acceptCommand({ commandId: id, ownerVersion: 1 }));
    check('coordinator rejects an old accepted owner version after ownership transfer', !accepted.accepted && c.readSnapshot().runStates.length === 0, { accepted: accepted.accepted, runCount: c.readSnapshot().runStates.length });
  }
  {
    const f = fixture(); const id = await admit(f); const c = await f.ensureCoordinator({ sessionId: 'sess-1' });
    const accepted = await attempt(() => c.acceptCommand({ commandId: id, ownerVersion: 99 }));
    check('handoff ownerVersion must match persisted command authority', !accepted.accepted, { accepted: accepted.accepted, acknowledgedOwnerVersion: accepted.value?.ownerVersion });
  }
  for (const kind of ['archived', 'deleting', 'wrong_lifecycle', 'missing_identity']) {
    const { f, id, c } = await ready();
    if (kind === 'archived') f.sqlite.exec("UPDATE workspace_sessions SET status = 'archived'");
    if (kind === 'deleting') f.sqlite.exec("UPDATE projects SET status = 'deleting'");
    const admitted = await attempt(() => c.admitEffect(effect(f, id, kind === 'wrong_lifecycle' ? { lifecycleGeneration: 900 } : {})));
    check(`effect admission denies ${kind}`, !admitted.accepted, { accepted: admitted.accepted, state: admitted.value?.state });
  }
  {
    const { f, id, c } = await ready();
    await c.admitEffect(effect(f, id));
    await stop(f, id); await f.deliver();
    const snapshot = await observe(f);
    const next = await admit(f, { idempotencyKey: 'next' }); await f.deliver();
    const admitted = await attempt(() => c.admitEffect(effect(f, next, { runEpoch: 2 })));
    const unresolved = c.sql.query("SELECT count(*) AS n FROM effects WHERE run_id = ? AND state = 'admitted'", id)[0].n;
    check('uncooperative Stop stays nonterminal and blocks a replacement writer', snapshot.runStates[0].status === 'stopping' && !admitted.accepted, { stoppedRunState: snapshot.runStates[0].status, unresolved, replacementEffectAdmitted: admitted.accepted });
  }
  {
    const { f, id, c } = await ready();
    const later = await admit(f, { idempotencyKey: 'later' }); await f.deliver();
    await stop(f, id); await f.deliver();
    const follow = await f.asUser('user-1').command({ version: 1, kind: 'follow_up', projectId: 'proj-1', sessionId: 'sess-1', idempotencyKey: 'follow-later', targetRunId: later, text: 'synthetic follow-up' });
    await f.deliver();
    const state = c.readSnapshot().commandStates.find((s) => s.id === follow.body.commandId)?.status;
    check('Stop of A does not invalidate a distinct later run B follow-up', state === 'consumed', { followUpState: state });
  }
  {
    const { f, id, c } = await ready();
    await f.asUser('user-1').command({ version: 1, kind: 'follow_up', projectId: 'proj-1', sessionId: 'sess-1', idempotencyKey: 'follow', targetRunId: id, text: 'synthetic follow-up' });
    await f.deliver(); await stop(f, id); await f.deliver(); await c.reconcile();
    const statuses = assistantStatuses(f);
    check('terminal Stop settles every pending assistant belonging to its run', statuses.every((s) => s === 'failed'), { statuses, projectionLag: (await observe(f)).projectionLag });
  }
  {
    const f = fixture(); const id = await admit(f); await stop(f, id); await f.deliver();
    const c = f.coordinator('sess-1'); await c.reconcile();
    check('late prompt canceled by Stop has its assistant settled', assistantStatuses(f).every((s) => s === 'failed'), { statuses: assistantStatuses(f), commandState: (await observe(f)).commandStates.find((s) => s.id === id)?.status });
  }
  {
    const f = fixture(); const a = await admit(f); const b = await admit(f, { idempotencyKey: 'b' });
    const cancel = await f.asUser('user-1').command({ version: 1, kind: 'cancel', projectId: 'proj-1', sessionId: 'sess-1', idempotencyKey: 'cancel-a', targetCommandId: a });
    const c = await f.ensureCoordinator({ sessionId: 'sess-1' });
    await c.acceptCommand({ commandId: b, ownerVersion: 1 });
    await c.acceptCommand({ commandId: cancel.body.commandId, ownerVersion: 1 });
    const status = (await observe(f)).commandStates.find((s) => s.id === b)?.status;
    check('durable cancellation resolves a missing predecessor without delivering canceled work', status === 'consumed', { nextCommandStatus: status });
  }
  {
    let now = 1700000000000; const f = fixture({ now: () => now }); const id = await admit(f);
    now += 16 * 60000; const c = await f.ensureCoordinator({ sessionId: 'sess-1' }); await c.acceptCommand({ commandId: id, ownerVersion: 1 }); await c.reconcile();
    const s = await observe(f);
    check('expired queued work settles without creating a live queued run', s.runStates.every((r) => ['failed','canceled'].includes(r.status)) && assistantStatuses(f).every((v) => v === 'failed'), { runStates: s.runStates.map((r) => r.status), statuses: assistantStatuses(f) });
  }
  {
    const { f, id, c } = await ready(); const original = c.sql.query.bind(c.sql); let inject = true;
    c.sql.query = (sql, ...args) => { if (inject && /INSERT INTO continuations/.test(sql)) { inject = false; throw new Error('synthetic persistence failure'); } return original(sql, ...args); };
    const commit = await attempt(() => c.commitContinuation({ expectedPosition: 0, snapshot: { synthetic: true } }));
    const next = await attempt(() => c.admitEffect(effect(f, id)));
    check('actual continuation persistence failure latches off subsequent admissions', !commit.accepted && !next.accepted, { commitAccepted: commit.accepted, nextEffectAdmitted: next.accepted, fatalLatch: journal.isFatalLatched(c.sql) });
  }
  {
    const { f, id, c } = await ready();
    await c.admitEffect(effect(f, id));
    const conflict = await attempt(() => c.admitEffect(effect(f, id, { arguments: { changed: true }, executorIncarnationId: 'different-process' })));
    const second = await attempt(() => c.admitEffect(effect(f, id, { attempt: 2 })));
    check('pending effect identity cannot be rewritten or concurrently reattempted', !conflict.accepted && !second.accepted, { conflictingAdmissionAccepted: conflict.accepted, secondAttemptAccepted: second.accepted });
  }
  {
    const { f, id, c } = await ready(); const e = effect(f, id); await c.admitEffect(e); c.markOutcomeUnknown(e);
    const next = await attempt(() => c.admitEffect(effect(f, id, { toolCallId: 'different-tool' })));
    check('unknown effect halts the run and all subsequent tools', !next.accepted && c.readSnapshot().runStates[0].status === 'failed', { nextAdmitted: next.accepted, runStatus: c.readSnapshot().runStates[0].status });
  }
  {
    const { f, id, c } = await ready(); await stop(f, id); await f.deliver();
    const committed = await attempt(() => c.commitContinuation({ expectedPosition: 0, snapshot: { synthetic: true } }));
    check('superseded continuation cannot advance after Stop', !committed.accepted, { accepted: committed.accepted, position: c.readSnapshot().checkpointPosition });
  }
  {
    const { f, id, c } = await ready({ persistentJournal: true });
    c.sql.query("UPDATE commands SET ciphertext = 'invalid-authenticated-record'");
    await f.restartJournals(); const restarted = f.coordinator('sess-1');
    const next = await attempt(() => restarted.admitEffect(effect(f, id)));
    check('restart with tampered canonical command fails closed before effect admission', !next.accepted, { effectAdmittedAfterTamper: next.accepted });
  }
  {
    const f = fixture(); const a = await admit(f); const b = await admit(f, { idempotencyKey: 'b' });
    const d1 = d1Utils.createSqliteD1(f.sqlite); const assistantB = f.observeReceipt(b).assistantMessageId;
    const membership = { targetKind: 'membership', targetId: 'nonexistent-command', commandId: 'nonexistent-command', workspaceSessionId: 'sess-1', userId: 'user-1', projectId: 'proj-1', ownerVersion: 1, coordinatorSeq: 1, runId: a, assistantMessageId: assistantB };
    await projector.applyProductProjectionBatch(d1, [membership], f.now());
    const result = await projector.applyProductProjectionBatch(d1, [{ ...membership, targetKind: 'message', targetId: assistantB, coordinatorSeq: 2, status: 'failed' }], f.now());
    const state = f.sqlite.prepare('SELECT status FROM messages WHERE id = ?').get(assistantB).status;
    check('projection membership validates the persisted command and its exact assistant', state === 'pending', { unrelatedAssistantStatus: state, classification: result[0].classification });
  }
  {
    const f = fixture(); const id = await admit(f); f.sqlite.prepare('UPDATE session_commands SET executionProjectionVersion = 5 WHERE id = ?').run(id);
    const payload = { targetKind: 'command', targetId: id, commandId: id, workspaceSessionId: 'sess-1', userId: 'user-1', projectId: 'proj-1', ownerVersion: 1, coordinatorSeq: 9, expectedSourceStatus: '0', reasonCode: 'synthetic' };
    const result = await projector.applyProductProjectionBatch(d1Utils.createSqliteD1(f.sqlite), [payload], f.now());
    const cursor = f.sqlite.prepare('SELECT coordinatorSeq FROM runtime_projection_cursors WHERE targetId = ?').get(id);
    check('failed target CAS does not advance its cursor or claim already applied', result[0].classification === 'blocked_membership' && !cursor, { classification: result[0].classification, cursor: cursor?.coordinatorSeq, actualVersion: f.sqlite.prepare('SELECT executionProjectionVersion FROM session_commands WHERE id = ?').get(id).executionProjectionVersion });
  }
  {
    const { f, id, c } = await ready(); await c.reconcile(); await stop(f, id); await f.deliver();
    f.sqlite.exec("INSERT INTO runtime_deleted_target_fences VALUES ('workspace_session', 'sess-1', 1, 1)");
    await c.reconcile();
    check('a persisted deletion fence prevents terminal projection writes', assistantStatuses(f).every((s) => s === 'pending'), { statuses: assistantStatuses(f) });
  }
  {
    const f = fixture(); await admit(f); const second = await admit(f, { idempotencyKey: 'second' });
    const c = await f.ensureCoordinator({ sessionId: 'sess-1' }); await c.acceptCommand({ commandId: second, ownerVersion: 1 });
    const pending = c.sql.query("SELECT count(*) AS n FROM wakeups WHERE state = 'pending'")[0].n;
    check('accepted command wakeup intent schedules work even without projections', pending > 0 && f.scheduled.length > 0, { durablePendingWakeups: pending, schedulerCalls: f.scheduled.length });
  }
  {
    const { f, id, c } = await ready(); await c.reconcile(); f.scheduled.length = 0; const deadline = c.recordInterruption(id);
    const res = await c.reconcile();
    check('recovery deadline has a future scheduler wakeup independent of browser traffic', f.scheduled.some((s) => +s.when === deadline.recoveryDeadlineAt), { schedulerCalls: f.scheduled.length, nextDeadlineAt: res.nextDeadlineAt, recoveryDeadlineAt: deadline.recoveryDeadlineAt });
  }
  {
    const f = fixture(); for (let i = 0; i < 26; i++) await admit(f, { idempotencyKey: `item-${i}` }); await f.deliver();
    const result = await f.coordinator('sess-1').reconcile();
    check('one reconcile pass processes at most 25 total intents', result.processed <= 25, { processed: result.processed });
  }
  {
    const keyring = await cryptoModule.importRuntimeKeyringFromBytes('review', { review: new Uint8Array(32).fill(31) });
    const aad = { ownerId: 'synthetic-owner', workspaceSessionId: 'synthetic-session', recordId: 'synthetic-record', formatVersion: 1 };
    const first = await cryptoModule.encryptRuntimePayload(new Uint8Array([1,1,1,1]), keyring, aad, { inlineMaxBytes: 1, chunkBytes: 2 });
    const second = await cryptoModule.encryptRuntimePayload(new Uint8Array([2,2,2,2]), keyring, aad, { inlineMaxBytes: 1, chunkBytes: 2 });
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array([1,1,2,2]))).toString('hex');
    const mixed = { ...first.manifest, chunks: [first.manifest.chunks[0], second.manifest.chunks[1]], digest };
    const result = await attempt(() => cryptoModule.decryptRuntimePayload({ kind: 'chunked', manifest: mixed }, keyring, aad));
    check('chunk manifest authenticates one immutable record version against cross-write splicing', !result.accepted, { mixedRecordAccepted: result.accepted });
  }
  {
    const { f, id, c } = await ready(); await c.reconcile();
    const assistant = f.observeReceipt(id).assistantMessageId;
    const base = { workspaceSessionId: 'sess-1', userId: 'user-1', projectId: 'proj-1', ownerVersion: 1, commandId: id, runId: id };
    const d1 = d1Utils.createSqliteD1(f.sqlite, { beforeStatement(sql) { if (/UPDATE session_commands/.test(sql)) throw new Error('synthetic second-target failure'); } });
    const result = await projector.applyProductProjectionBatch(d1, [
      { ...base, targetKind: 'message', targetId: assistant, coordinatorSeq: 20, status: 'complete', contentRedacted: 'synthetic final result' },
      { ...base, targetKind: 'command', targetId: id, coordinatorSeq: 21, expectedSourceStatus: '0', reasonCode: 'complete' },
    ], f.now());
    const row = f.sqlite.prepare('SELECT status, content FROM messages WHERE id = ?').get(assistant);
    check('related terminal targets roll back together when the later target fails', row.status === 'pending', { assistantStatus: row.status, classifications: result.map((r) => r.classification) });
    check('completed assistant projection writes redacted final content with status', row.status !== 'complete' || row.content === 'synthetic final result', { assistantStatus: row.status, contentByteCount: Buffer.byteLength(row.content) });
  }
  {
    const { f, id, c } = await ready();
    const replacementKeyring = await cryptoModule.importRuntimeKeyringFromBytes('v2', { v2: new Uint8Array(32).fill(17) });
    const adapters = load(path.join(web, 'src/lib/session-runtime-authority.ts')).createProductAdapters(f.db, d1Utils.createSqliteD1(f.sqlite));
    const restarted = new coordinatorModule.SessionCoordinator({ sql: c.sql, keyring: replacementKeyring, adapters, scheduler: { schedule: async () => {} }, clock: { now: f.now }, identity: c.identity });
    const result = await attempt(async () => { restarted.initialize(); return restarted.admitEffect(effect(f, id)); });
    check('retained journal with a missing old encryption key blocks admission on reinitialization', !result.accepted, { newEffectAdmitted: result.accepted });
  }
  {
    const { f } = await ready(); const denied = await f.asUser('foreign-user').observe({ projectId: 'proj-1', sessionId: 'sess-1' });
    check('observation rejects a foreign owner', denied.status === 404, { status: denied.status });
  }
  for (const f of allFixtures) { f.dispose(); f.sqlite.close(); }
  const failures = results.filter((r) => r.result === 'FAIL').length;
  console.log(JSON.stringify({ checks: results.length, failures })); process.exitCode = failures ? 1 : 0;
}
main().catch((error) => { console.error(JSON.stringify({ probeHarnessError: error?.name ?? 'Error', code: error?.code ?? null, location: String(error?.stack ?? '').split('\n').filter((s) => s.includes('004-review-probes.cjs')).slice(0, 2) })); process.exitCode = 2; });
