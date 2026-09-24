// Independent repair probes. Candidate modules run against disposable SQLite only.
// Pass the isolated candidate path. Does not modify candidate source.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.argv[2];
if (!root) throw new Error('Pass the candidate checkout.');
const web = path.join(root, 'apps/web');
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
      return load(target.endsWith('.js') ? target.slice(0, -3) + '.ts' : target + '.ts');
    }
    return localRequire(specifier);
  }
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
const fixtures = load(path.join(web, 'src/test/session-runtime-fixture.ts'));
const admission = load(path.join(web, 'src/lib/session-command.ts'));
const delivery = load(path.join(web, 'src/lib/session-command-delivery.ts'));
const client = load(path.join(web, 'src/lib/session-runtime-client.ts'));
const results = [];
function check(name, ok, observed) {
  const result = { name, result: ok ? 'PASS' : 'FAIL', observed };
  results.push(result); console.log(JSON.stringify(result));
}
function activate(fixture, userId = 'user-1') {
  fixtures.sessionRuntimeRouteHarness.db = fixture.db;
  fixtures.sessionRuntimeRouteHarness.userId = userId;
}
function ack(fixture, input) {
  const row = fixture.sqlite.prepare('SELECT c.commandSeq, k.receiptId FROM session_commands c JOIN session_command_keys k ON k.commandId=c.id WHERE c.id=?').get(input.commandId);
  return { version: 1, commandId: input.commandId, ownerVersion: input.ownerVersion, acceptedPosition: row.commandSeq, receiptId: row.receiptId };
}
const prompt = { version: 1, kind: 'prompt', projectId: 'proj-1', sessionId: 'sess-1', text: 'hello', idempotencyKey: 'key-1' };
let productKeyReads = 0;
const env = {};
Object.defineProperty(env, 'OPENCODE_API_KEY', { get() { productKeyReads++; throw new Error('Trusted path read product key'); } });
overrides.set('cloudflare:workers', { env });
overrides.set('@tanstack/react-router', { createFileRoute: () => (options) => options });
overrides.set('#/db', { createDb: () => fixtures.sessionRuntimeRouteHarness.db });
overrides.set('#/lib/auth', { createAuth: () => ({ api: { getSession: async () => fixtures.sessionRuntimeRouteHarness.userId ? { user: { id: fixtures.sessionRuntimeRouteHarness.userId } } : null } }) });
const unexpected = () => { throw new Error('Unexpected legacy execution'); };
overrides.set('#/lib/agent-run-service', { prepareAgentRun: unexpected, executeAgentRun: unexpected, agentStreamBodySchema: { safeParse: unexpected } });
overrides.set('#/lib/agent-control-service', { controlAgentRun: unexpected, agentControlBodySchema: { safeParse: unexpected } });
async function main() {
  for (const name of ['stream', 'control']) {
    const fixture = fixtures.createSessionRuntimeFixture(); fixture.seedProject(); activate(fixture);
    const route = load(path.join(web, `src/routes/api.agent.${name}.ts`)).Route;
    const first = { ...prompt }; delete first.sessionId;
    const post = (raw) => route.server.handlers.POST({ request: new Request(`http://localhost/api/agent/${name}`, { method: 'POST', body: raw }) });
    const defaultResponse = await post(JSON.stringify(first));
    check(`${name}: default denies trusted creation`, defaultResponse.status === 409 && fixture.counts().sessions === 0, { status: defaultResponse.status, rows: fixture.counts() });
    const eligible = await fixture.asUser('user-1').command(first, { path: name });
    check(`${name}: injected eligible transport admits without product key`, eligible.status === 202 && productKeyReads === 0, { status: eligible.status, productKeyReads });
    const raw = JSON.stringify({ ...first, idempotencyKey: 'dup' }).replace('"version":1', '"version":2,"version":1');
    const malformed = await fixture.asUser('user-1').command({}, { path: name, raw });
    check(`${name}: duplicate fields remain rejected`, malformed.status === 400 && fixture.counts().commands === 1, { status: malformed.status, commands: fixture.counts().commands });
    activate(fixture, null);
    const anonymous = await post(JSON.stringify(first));
    check(`${name}: missing auth rejects`, anonymous.status === 401, { status: anonymous.status });
    fixture.sqlite.close();
  }

  const persistence = fixtures.createSessionRuntimeFixture(); persistence.seedTrustedSession();
  for (const level of ['off', 'high', 'max']) {
    const response = await persistence.asUser('user-1').command({ ...prompt, idempotencyKey: `level-${level}`, thinkingLevel: level });
    const command = await persistence.reconstructCommand(response.body.commandId);
    check(`durable thinking ${level}`, command?.thinkingLevel === level, { level: command?.thinkingLevel, ownerVersion: command?.runtimeOwnerVersion });
  }
  const original = await persistence.asUser('user-1').command(prompt);
  const retry = await persistence.asUser('user-1').command({ ...prompt, text: '  hello  ', thinkingLevel: 'high' });
  const blank = await persistence.asUser('user-1').command({ ...prompt, text: '\n\t ', idempotencyKey: 'blank' });
  check('normalized idempotency and blank rejection', retry.body.commandId === original.body.commandId && blank.status === 400, { retryStatus: retry.status, blankStatus: blank.status });
  persistence.setModelConfigured(false);
  const afterOutage = await persistence.asUser('user-1').command(prompt);
  const stop = await persistence.asUser('user-1').command({ version: 1, kind: 'stop', projectId: 'proj-1', sessionId: 'sess-1', idempotencyKey: 'stop', targetRunId: 'run-1' }, { path: 'control' });
  check('receipt retry and model-free Stop survive outage', afterOutage.body.commandId === original.body.commandId && stop.status === 202 && stop.body.stopState === 'recorded', { retryStatus: afterOutage.status, stopStatus: stop.status, stopState: stop.body.stopState });
  persistence.sqlite.close();

  const protocol = fixtures.createSessionRuntimeFixture({ protocolVersion: 2 }); protocol.seedTrustedSession();
  const incompatible = await protocol.asUser('user-1').command(prompt);
  check('runtime protocol mismatch is side-effect free', incompatible.status === 409 && protocol.counts().commands === 0, { status: incompatible.status, commands: protocol.counts().commands }); protocol.sqlite.close();

  const backlog = fixtures.createSessionRuntimeFixture(); backlog.seedTrustedSession();
  for (let i=0;i<26;i++) await backlog.asUser('user-1').command({ ...prompt, idempotencyKey: `backlog-${i}` });
  await backlog.deliver(); await backlog.deliver(); await backlog.deliver();
  const calls = backlog.outbound.filter((call) => call.method === 'deliver');
  check('acknowledged backlog progresses once per command', calls.length === 26 && new Set(calls.map((c) => c.input.commandId)).size === 26, { calls: calls.length, unique: new Set(calls.map((c) => c.input.commandId)).size }); backlog.sqlite.close();

  let clock = 1700000000000;
  const lost = fixtures.createSessionRuntimeFixture({ now: () => clock }); lost.seedTrustedSession();
  const lostResult = await lost.asUser('user-1').command(prompt); const lostId = lostResult.body.commandId;
  lost.loseNextAcknowledgment(); await lost.deliver();
  const pending = lost.observeWork(lostId).deliveryState;
  clock += 60000; await lost.deliver();
  const repeats = lost.outbound.filter((call) => call.method === 'deliver');
  check('lost acknowledgment retries immutable IDs', pending === 'pending' && lost.observeWork(lostId).deliveryState === 'delivered' && repeats.length === 2 && repeats[0].input.commandId === repeats[1].input.commandId, { pending, final: lost.observeWork(lostId).deliveryState, calls: repeats.length }); lost.sqlite.close();

  clock = 1700000000000;
  const backoff = fixtures.createSessionRuntimeFixture({ now: () => clock }); backoff.seedTrustedSession();
  await backoff.asUser('user-1').command(prompt);
  const starts = [];
  backoff.setDeliverImpl(async () => { starts.push(clock); clock += 4900; throw new Error('synthetic failure'); });
  await backoff.deliver({ maxDeliveries: 2 });
  const nextAt = backoff.sqlite.prepare('SELECT deliveryLeaseExpiresAt AS nextAt FROM workspace_runtime_work').get().nextAt;
  check('backoff starts after failure', starts.length === 1 && nextAt - clock >= 1000, { calls: starts.length, postFailureDelay: nextAt-clock }); backoff.sqlite.close();

  // Use a real asynchronous service timer. Synchronous SQLite hook simulates a
  // delayed persistence read BEFORE the service call, not time spent in the call.
  let delayArmed = false; let readDelayCount = 0;
  const budget = fixtures.createSessionRuntimeFixture({ now: Date.now, failStatement: (query) => {
    if (delayArmed && /^select/i.test(query) && query.includes('inner join "workspace_sessions"') && query.includes('inner join "session_command_keys"')) {
      delayArmed = false; readDelayCount++;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
    }
    return false;
  } });
  budget.seedTrustedSession(); const budgetCommand = await budget.asUser('user-1').command(prompt);
  budget.setDeliverImpl(async (input) => { await new Promise((resolve) => setTimeout(resolve, 80)); return ack(budget, input); });
  delayArmed = true; const began = Date.now();
  await budget.deliver({ maxMs: 100, maxDeliveries: 1 });
  const elapsed = Date.now()-began; const budgetState = budget.observeWork(budgetCommand.body.commandId).deliveryState;
  check('pass budget includes persisted handoff read', readDelayCount === 1 && budgetState !== 'delivered' && elapsed < 140, { elapsedMs: elapsed, budgetMs: 100, readDelayMs: 80, serviceDelayMs: 80, readDelayCount, state: budgetState });
  // Let the deliberately uncancelled synthetic call settle before closing its DB.
  await new Promise((resolve) => setTimeout(resolve, 100)); budget.sqlite.close();

  let renewalClock = 1700000000000; let delayRenewal = false; let renewalDelayCount = 0;
  const renewal = fixtures.createSessionRuntimeFixture({ now: () => renewalClock, failStatement: (query) => {
    if (delayRenewal && /^update "workspace_runtime_work" set "deliveryLeaseExpiresAt"/i.test(query)) {
      delayRenewal = false; renewalDelayCount++; renewalClock += 120;
    }
    return false;
  } });
  renewal.seedTrustedSession(); await renewal.asUser('user-1').command(prompt);
  delayRenewal = true; await renewal.deliver({ maxMs: 100, maxDeliveries: 1 });
  const callsAfterRenewal = renewal.outbound.filter((call) => call.method === 'deliver').length;
  check('expired lease-renewal budget does not start an RPC', renewalDelayCount === 1 && callsAfterRenewal === 0, { renewalDelayCount, storageElapsedMs: 120, budgetMs: 100, outboundCalls: callsAfterRenewal });
  renewal.sqlite.close();

  clock = 1700000000000;
  const isolated = fixtures.createSessionRuntimeFixture({ now: () => clock }); isolated.seedTrustedSession({ sessionId: 'a' }); isolated.seedTrustedSession({ sessionId: 'b' });
  const a1 = await isolated.asUser('user-1').command({ ...prompt, sessionId: 'a', idempotencyKey: 'a1' });
  const a2 = await isolated.asUser('user-1').command({ ...prompt, sessionId: 'a', idempotencyKey: 'a2' });
  await isolated.asUser('user-1').command({ ...prompt, sessionId: 'b', idempotencyKey: 'b1' });
  const b2 = await isolated.asUser('user-1').command({ ...prompt, sessionId: 'b', idempotencyKey: 'b2' });
  isolated.setDeliverImpl(async (input) => {
    if (input.commandId === a1.body.commandId) throw new client.SessionRuntimeHandoffError('runtime_unavailable', 'synthetic unavailable');
    if (input.commandId === a2.body.commandId) throw new client.SessionRuntimeHandoffError('missing_predecessor', 'synthetic missing predecessor');
    return ack(isolated, input);
  });
  for (let pass=0;pass<3;pass++) { await isolated.deliver(); clock += 60000; }
  check('one workspace gap does not starve another workspace', isolated.observeWork(b2.body.commandId).deliveryState === 'delivered', { healthySecondCommandState: isolated.observeWork(b2.body.commandId).deliveryState, passes: 3 }); isolated.sqlite.close();

  const owner = fixtures.createSessionRuntimeFixture(); owner.seedTrustedSession();
  const ownerCommand = await owner.asUser('user-1').command(prompt);
  owner.sqlite.exec("UPDATE workspace_sessions SET runtimeOwnerVersion = 3");
  const rebound = await owner.reconstructCommand(ownerCommand.body.commandId);
  check('reconstruction does not grant new authority to an old command', rebound === null || rebound.runtimeOwnerVersion === 1, { originalVersion: 1, reconstructedVersion: rebound?.runtimeOwnerVersion }); owner.sqlite.close();

  const incomplete = fixtures.createSessionRuntimeFixture(); incomplete.seedTrustedSession();
  const incompleteCommand = await incomplete.asUser('user-1').command({ ...prompt, thinkingLevel: 'max' });
  incomplete.sqlite.exec("UPDATE workspace_runtime_work SET payload = '{}' ");
  let malformedCommand; let rejected = false;
  try { malformedCommand = await incomplete.reconstructCommand(incompleteCommand.body.commandId); } catch { rejected = true; }
  check('reconstruction fails closed on missing persisted settings', rejected || malformedCommand === null, { rejected, hasCommand: !!malformedCommand, thinkingLevel: malformedCommand?.thinkingLevel ?? null }); incomplete.sqlite.close();

  let rollbackOk = true;
  for (let index=0;index<9;index++) {
    const fixture = fixtures.createSessionRuntimeFixture({ failBatchAt: index }); fixture.seedProject();
    const first = { ...prompt }; delete first.sessionId;
    let failed = false; try { await fixture.asUser('user-1').command(first); } catch { failed = true; }
    rollbackOk &&= failed && Object.values(fixture.counts()).every((n) => n === 0) && fixture.sqlite.prepare('SELECT count(*) AS n FROM session_command_sequences').get().n === 0;
    fixture.sqlite.close();
  }
  check('all nine batch failures retain no admission or sequence rows', rollbackOk, { statements: 9 });
  console.log(JSON.stringify({ checks: results.length, failures: results.filter((r) => r.result === 'FAIL').length }));
  process.exitCode = results.some((r) => r.result === 'FAIL') ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 2; });
