// Independent review probes; writes synthetic fixtures only in the candidate's ignored node_modules cache.
// node plans/005-review-probes.cjs /absolute/candidate
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = process.argv[2];
if (!root) throw new Error('Pass candidate root');
const localRequire = createRequire(path.join(root, 'apps/web/package.json'));
const ts = localRequire('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  function resolve(spec) {
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      return load(target.replace(/\.(js|ts)$/, '') + '.ts');
    }
    return localRequire(spec);
  }
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
const results = [];
function check(name, ok, observed) {
  results.push({ name, result: ok ? 'PASS' : 'FAIL', observed });
  console.log(JSON.stringify(results.at(-1)));
}
const base = 1900000000000;
function envelope(deadline = base + 100) {
  return { version: 1, kind: 'continuation', ownerVersion: 1, lifecycleGeneration: 1,
    deadline, brainIdentityId: 'brain', brainIncarnationId: 'incarnation', runId: 'run',
    attempt: 1, runEpoch: 1, operationId: 'operation', expectedCommittedPosition: 0, payload: { entries: [] } };
}
function request(value) {
  return new Request('http://ditto.internal/v1/continuation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
}
async function capture(fn) { try { return { accepted: true, value: await fn() }; } catch (error) { return { accepted: false, code: error.code || error.name }; } }
async function main() {
  const transport = load(path.join(root, 'apps/runtime/src/brain-transport.ts'));
  const realNow = Date.now;
  let current = base;
  Date.now = () => current;
  try {
    const valid = await capture(() => transport.parseBrainRequest(request(envelope()), current));
    check('B01 live bounded brain envelope has a positive control', valid.accepted, { accepted: valid.accepted });
    const expired = await capture(() => transport.parseBrainRequest(request(envelope(base - 1)), current));
    check('B02 already expired brain envelope is rejected', !expired.accepted, { accepted: expired.accepted });
    const stream = new ReadableStream({ pull(controller) { current = base + 200; controller.enqueue(new TextEncoder().encode(JSON.stringify(envelope()))); controller.close(); } });
    const slow = new Request('http://ditto.internal/v1/continuation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' });
    const result = await capture(() => transport.parseBrainRequest(slow, base));
    check('B03 deadline is rechecked after awaited body reading', !result.accepted, { accepted: result.accepted, deadlineExpiredAtCompletion: current > base + 100 });
  } finally { Date.now = realNow; }
  const fixtureRoot = path.join(root, 'node_modules/.cache/ditto-plan-005-review');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(fixtureRoot, 'tool-fixture-'));
  const runnerUrl = pathToFileURL(path.join(root, 'packages/sandbox-runner/dist/remote-tool.js')).href;
  const { executeRemoteTool } = await import(runnerUrl);
  const job = tool => ({ version: 1, runId: 'run', assistantEntryId: 'entry', toolCallId: 'tool', attempt: 1, executorIncarnationId: 'executor', runEpoch: 1, lifecycleGeneration: 1, deadline: Date.now() + 30000, outcomePolicy: 'retry_safe', tool });
  fs.writeFileSync(path.join(fixture, 'source.txt'), 'review-target\n');
  const grep = await capture(() => executeRemoteTool(job({ name: 'grep', pattern: 'review-target', literal: true }), { workspace: fixture, incarnation: 'executor' }));
  check('G01 grep finds a text match without unrelated files', grep.accepted && JSON.stringify(grep.value).includes('review-target'), { accepted: grep.accepted });
  fs.writeFileSync(path.join(fixture, 'binary.bin'), Buffer.from([255, 254, 253]));
  const mixed = await capture(() => executeRemoteTool(job({ name: 'grep', pattern: 'review-target', literal: true }), { workspace: fixture, incarnation: 'executor' }));
  check('G02 unrelated binary files do not prevent finding text matches', mixed.accepted && JSON.stringify(mixed.value).includes('review-target'), { accepted: mixed.accepted, code: mixed.code });
  const regexFixture = fs.mkdtempSync(path.join(fixtureRoot, 'regex-fixture-'));
  fs.writeFileSync(path.join(regexFixture, 'input.txt'), 'a'.repeat(32) + '!\n');
  const code = `const {executeRemoteTool}=await import(${JSON.stringify(runnerUrl)});const job=${JSON.stringify(job({ name: 'grep', pattern: '(a+)+$' }))};job.deadline=Date.now()+50;console.log('entered');await executeRemoteTool(job,{workspace:${JSON.stringify(regexFixture)},incarnation:'executor'});console.log('completed');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const entered = child.stdout?.includes('entered') ?? false;
  check('G03 hostile grep regex cannot overrun its finite deadline', entered && child.error?.code !== 'ETIMEDOUT', { entered, externallyKilledAfterFourSeconds: child.error?.code === 'ETIMEDOUT', advertisedDeadlineMs: 50 });
  const failures = results.filter(item => item.result === 'FAIL').length;
  console.log(JSON.stringify({ checks: results.length, failures }));
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(JSON.stringify({ harnessError: error.name, code: error.code ?? null })); process.exitCode = 2; });
