// Advisor probes. Only disposable in-memory SQLite and synthetic requests are used.
// No candidate source is changed. Pass the candidate checkout explicitly.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'apps/web/package.json'))) {
  throw new Error('Pass the candidate checkout as the first argument.');
}
const web = path.join(root, 'apps/web');
const localRequire = createRequire(path.join(web, 'package.json'));
const ts = localRequire('typescript');
const cache = new Map();
const overrides = new Map();
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
    if (specifier.startsWith('#/')) {
      return load(path.join(web, 'src', `${specifier.slice(2)}.ts`));
    }
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(absolute), specifier);
      return load(target.endsWith('.js') ? target.slice(0, -3) + '.ts' : target + '.ts');
    }
    return localRequire(specifier);
  }
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
const fixtureModule = load(path.join(web, 'src/test/session-runtime-fixture.ts'));
const admission = load(path.join(web, 'src/lib/session-command.ts'));
const delivery = load(path.join(web, 'src/lib/session-command-delivery.ts'));
const runtimeClient = load(path.join(web, 'src/lib/session-runtime-client.ts'));
const contracts = load(path.join(root, 'packages/runtime-contracts/src/command.ts'));
const baseBody = { version: 1, kind: 'prompt', projectId: 'proj-1', sessionId: 'sess-1', idempotencyKey: 'key-1', text: 'hello' };
const results = [];
function check(name, passed, observed) {
  results.push({ name, result: passed ? 'PASS' : 'FAIL', observed });
  console.log(JSON.stringify(results.at(-1)));
}
async function main() {
  // Capture the real POST handlers. Only routing, auth, D1 binding construction,
  // and the unused legacy services are substituted; trusted admission is real.
  let currentFixture;
  let productKeyReads = 0;
  const env = {};
  Object.defineProperty(env, 'OPENCODE_API_KEY', { get() { productKeyReads++; return String(true); } });
  overrides.set('cloudflare:workers', { env });
  overrides.set('@tanstack/react-router', { createFileRoute: () => (options) => options });
  overrides.set('#/db', { createDb: () => currentFixture.db });
  overrides.set('#/lib/auth', { createAuth: () => ({ api: { getSession: async () => ({ user: { id: 'user-1' } }) } }) });
  const forbiddenLegacy = () => { throw new Error('Unexpected legacy invocation'); };
  overrides.set('#/lib/agent-run-service', { prepareAgentRun: forbiddenLegacy, executeAgentRun: forbiddenLegacy, agentStreamBodySchema: { safeParse: forbiddenLegacy } });
  overrides.set('#/lib/agent-control-service', { controlAgentRun: forbiddenLegacy, agentControlBodySchema: { safeParse: forbiddenLegacy } });
  for (const routeName of ['stream', 'control']) {
    const route = load(path.join(web, `src/routes/api.agent.${routeName}.ts`)).Route;
    currentFixture = fixtureModule.createSessionRuntimeFixture();
    currentFixture.seedProject();
    const first = { ...baseBody };
    delete first.sessionId;
    const before = productKeyReads;
    const response = await route.server.handlers.POST({ request: new Request(`http://localhost/api/agent/${routeName}`, { method: 'POST', body: JSON.stringify(first) }) });
    const owner = currentFixture.sqlite.prepare('SELECT runtimeOwner FROM workspace_sessions').get()?.runtimeOwner;
    check(`${routeName}: default production adapter does not create trusted sessions`, response.status !== 202 && owner !== 'trusted_v1', { status: response.status, owner, rows: currentFixture.counts() });
    check(`${routeName}: trusted model probe does not read product key`, productKeyReads === before, { productKeyReads: productKeyReads - before });
    currentFixture.sqlite.close();

    currentFixture = fixtureModule.createSessionRuntimeFixture();
    currentFixture.seedTrustedSession();
    const raw = JSON.stringify(baseBody).replace('"version":1', '"version":2,"version":1');
    let rawRejected = false;
    try { contracts.parseBrowserCommandV1(raw); } catch { rawRejected = true; }
    const duplicateResponse = await route.server.handlers.POST({ request: new Request(`http://localhost/api/agent/${routeName}`, { method: 'POST', body: raw }) });
    check(`${routeName}: route preserves duplicate-field rejection`, rawRejected && duplicateResponse.status === 400, { rawParserRejected: rawRejected, routeStatus: duplicateResponse.status, commands: currentFixture.counts().commands });
    currentFixture.sqlite.close();
  }

  const persisted = fixtureModule.createSessionRuntimeFixture();
  persisted.seedTrustedSession();
  const accepted = await persisted.asUser('user-1').command({ ...baseBody, thinkingLevel: 'max' });
  const stored = ['session_commands', 'workspace_runtime_work', 'session_command_keys', 'messages'].flatMap((table) => persisted.sqlite.prepare(`SELECT * FROM ${table}`).all());
  const hasThinking = stored.some((row) => Object.entries(row).some(([key, value]) => key === 'thinkingLevel' && value === 'max' || typeof value === 'string' && value.includes('"thinkingLevel":"max"')));
  check('accepted thinking setting survives in durable payload', hasThinking, { status: accepted.status, recoverableThinkingField: hasThinking, workPayload: persisted.sqlite.prepare('SELECT payload FROM workspace_runtime_work').get().payload });
  const receipt = accepted.body;
  console.log(JSON.stringify({ name: 'receipt message mapping shape', result: 'INFO', observed: { receiptFields: Object.keys(receipt).sort() }, note: 'The existing ReceiptV1 contract has no direct message-id fields. This shape alone is not a rejection.' }));
  persisted.sqlite.close();

  let now = 1700000000000;
  const backlog = fixtureModule.createSessionRuntimeFixture({ now: () => now });
  backlog.seedTrustedSession();
  let lastId;
  for (let n = 0; n < 26; n++) {
    const result = await backlog.asUser('user-1').command({ ...baseBody, idempotencyKey: `k-${n}` });
    lastId = result.body.commandId;
  }
  await backlog.deliver();
  now += 60000;
  await backlog.deliver();
  now += 60000;
  await backlog.deliver();
  const outbound = backlog.outbound.filter((call) => call.method === 'deliver');
  check('successful delivery leaves retry queue and later work progresses', outbound.some((call) => call.input.commandId === lastId), { passes: 3, calls: outbound.length, uniqueCommands: new Set(outbound.map((call) => call.input.commandId)).size, lastCommandDelivered: outbound.some((call) => call.input.commandId === lastId), states: backlog.sqlite.prepare('SELECT deliveryState, count(*) AS n FROM workspace_runtime_work GROUP BY deliveryState').all() });
  backlog.sqlite.close();

  let clock = 1700000000000;
  const bounded = fixtureModule.createSessionRuntimeFixture({ now: () => clock });
  bounded.seedTrustedSession();
  for (let n = 0; n < 5; n++) await bounded.asUser('user-1').command({ ...baseBody, idempotencyKey: `budget-${n}` });
  const start = clock;
  const boundedRuntime = runtimeClient.createSessionRuntimeClient({
    modelConfiguration: async () => ({ configured: true, protocolVersion: 1 }),
    deliver: async () => { clock += 4900; },
    control: async () => { clock += 4900; },
  });
  const pass = await delivery.deliverSessionCommands({ db: bounded.db, runtime: boundedRuntime, clock: { now: () => clock, random: () => 0.5 } });
  check('delivery pass respects 20-second logical-clock budget', clock - start <= 20000, { elapsedMs: clock - start, attempts: pass.delivered, eachCallMs: 4900 });
  bounded.sqlite.close();

  const lifecycle = fixtureModule.createSessionRuntimeFixture();
  lifecycle.seedTrustedSession();
  await lifecycle.asUser('user-1').command(baseBody);
  lifecycle.sqlite.exec("UPDATE projects SET status = 'deleting'; INSERT INTO runtime_deleted_target_fences VALUES ('project', 'proj-1', 1, 1)");
  await lifecycle.deliver();
  const staleCalls = lifecycle.outbound.filter((call) => call.method !== 'modelConfiguration').length;
  console.log(JSON.stringify({ name: 'delivery after product tombstone', result: 'INFO', observed: { deliveriesAfterFence: staleCalls }, note: 'This proves an outbound delivery, not execution or recreation. Consumption-side lifecycle rejection remains required in 004; do not treat the call alone as unauthorized execution.' }));
  lifecycle.sqlite.close();

  let retryClock = 1700000000000;
  const retry = fixtureModule.createSessionRuntimeFixture({ now: () => retryClock });
  retry.seedTrustedSession();
  await retry.asUser('user-1').command(baseBody);
  const attemptsAt = [];
  await delivery.deliverSessionCommands({ db: retry.db, runtime: runtimeClient.createSessionRuntimeClient({
    modelConfiguration: async () => ({ configured: true, protocolVersion: 1 }),
    deliver: async () => { attemptsAt.push(retryClock); retryClock += 4900; throw new Error('synthetic transport outage'); },
    control: async () => {},
  }), clock: { now: () => retryClock, random: () => 0.5 }, budget: { maxDeliveries: 2 } });
  check('backoff starts after failed transport attempt', attemptsAt.length === 1 || attemptsAt[1] - attemptsAt[0] >= 5900, { relativeAttemptStartsMs: attemptsAt.map((value) => value - 1700000000000), callDurationMs: 4900, minimumPostFailureBackoffMs: 1000 });
  retry.sqlite.close();

  const normalized = fixtureModule.createSessionRuntimeFixture();
  normalized.seedTrustedSession();
  await normalized.asUser('user-1').command(baseBody);
  const equivalent = await normalized.asUser('user-1').command({ ...baseBody, text: '  hello  ' });
  const blank = await normalized.asUser('user-1').command({ ...baseBody, idempotencyKey: 'blank', text: '   ' });
  check('admission normalizes text and rejects blank prompts', equivalent.status === 202 && blank.status === 400, { equivalentRetryStatus: equivalent.status, blankPromptStatus: blank.status });
  normalized.sqlite.close();

  const protocol = fixtureModule.createSessionRuntimeFixture();
  protocol.seedTrustedSession();
  const incompatible = await admission.handleSessionCommandRequest({ db: protocol.db, runtime: { modelConfiguration: async () => ({ configured: true, protocolVersion: 2 }), deliver: async () => {}, control: async () => {} }, authenticatedUserId: 'user-1', body: baseBody });
  check('admission fails closed on incompatible runtime protocol', incompatible.status !== 202 && protocol.counts().commands === 0, { status: incompatible.status, commands: protocol.counts().commands });
  protocol.sqlite.close();

  // Controls that should pass: persistence-time ownership/deletion races and actual
  // rollback at every first-session admission statement. These do not mock services.
  for (const kind of ['deletion', 'ownership']) {
    const raced = fixtureModule.createSessionRuntimeFixture();
    raced.seedTrustedSession();
    const result = await admission.handleSessionCommandRequest({ db: raced.db, authenticatedUserId: 'user-1', body: baseBody, runtime: {
      async modelConfiguration() {
        raced.sqlite.exec(kind === 'deletion' ? "UPDATE projects SET status = 'deleting'" : "UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2");
        return { configured: true, protocolVersion: 1 };
      }, deliver: async () => {}, control: async () => {},
    } });
    check(`atomic guard rejects concurrent ${kind}`, result.status === 409 && raced.counts().commands === 0 && raced.counts().messages === 0 && raced.counts().work === 0, { status: result.status, rows: raced.counts() });
    raced.sqlite.close();
  }
  let rollbackPass = true;
  for (let index = 0; index < 9; index++) {
    const rollback = fixtureModule.createSessionRuntimeFixture({ failBatchAt: index });
    rollback.seedProject();
    const first = { ...baseBody };
    delete first.sessionId;
    let rejected = false;
    try { await rollback.asUser('user-1').command(first); } catch { rejected = true; }
    rollbackPass &&= rejected && Object.values(rollback.counts()).every((n) => n === 0) && rollback.sqlite.prepare('SELECT count(*) AS n FROM session_command_sequences').get().n === 0;
    rollback.sqlite.close();
  }
  check('batch faults leave no admission rows or sequence gaps', rollbackPass, { testedStatementPositions: 9 });
  console.log(JSON.stringify({ checks: results.length, failures: results.filter((r) => r.result === 'FAIL').length }));
  process.exitCode = results.some((r) => r.result === 'FAIL') ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 2; });
