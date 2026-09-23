// Review-only probes. Source reads plus disposable in-memory SQLite; no live services.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const root = process.argv[2] || '/home/ayan/ditto-worktrees/plan-001-reexecute';
const web = path.join(root, 'apps/web');
const localRequire = createRequire(path.join(web, 'package.json'));
const ts = localRequire('typescript');
const { drizzle } = localRequire('drizzle-orm/sqlite-proxy');
const cache = new Map();
function loadSource(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const resolve = (specifier) => {
    if (specifier.startsWith('#/')) return loadSource(path.join(web, 'src', `${specifier.slice(2)}.ts`));
    if (specifier.startsWith('.')) return loadSource(path.resolve(path.dirname(absolute), `${specifier}.ts`));
    return localRequire(specifier);
  };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  return module.exports;
}
function fixture() {
  const test = fs.readFileSync(path.join(web, 'src/db/trusted-runtime-migration.test.ts'), 'utf8');
  const body = test.slice(test.indexOf('function legacyDatabase()'), test.indexOf('function counts('));
  if (!body.startsWith('function legacyDatabase()')) throw new Error('Fixture drift; review before rerunning');
  const sqlite = new Function('DatabaseSync', `${body}; return legacyDatabase();`)(DatabaseSync);
  sqlite.exec(fs.readFileSync(path.join(web, 'migrations/0020_trusted_runtime_additive.sql'), 'utf8').replaceAll('--> statement-breakpoint', ''));
  sqlite.exec('UPDATE privileged_operations SET expiresAt = 4102444800');
  let hook;
  const db = drizzle(async (query, params, method) => {
    const statement = sqlite.prepare(query);
    if (method === 'run') { statement.run(...params); return { rows: [] }; }
    const rows = statement.all(...params);
    if (hook && hook.match(query)) {
      const callback = hook.callback;
      hook = undefined;
      await callback();
    }
    const values = rows.map(Object.values);
    return { rows: method === 'get' ? values[0] : values };
  });
  return { db, sqlite, once(match, callback) { hook = { match, callback }; } };
}
const authorityModule = loadSource(path.join(web, 'src/lib/sandbox-authority.ts'));
const capacity = loadSource(path.join(web, 'src/lib/workspace-runtime-capacity.ts'));
const ctx = { identityId: 'i', lifecycleGeneration: 1, containerId: 'opaque-container' };
const sessionRead = (q) => q.startsWith('select') && q.includes('from "workspace_sessions"');
let failures = 0;
async function mustDeny(label, call) {
  try { await call(); console.log(`FAIL ${label}: ALLOWED`); failures++; }
  catch (error) {
    if (error.name !== 'SandboxAuthorityError') throw error;
    console.log(`PASS ${label}: denied ${error.code}`);
  }
}
async function probePolicyAdapter() {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(web, 'src/lib/workspace-runtime.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let captured;
  const requireStub = (specifier) => specifier === '#/lib/workspace-runtime-policy'
    ? { withWorkspaceRuntimePolicyLease: async (input) => { captured = input; } }
    : {};
  new Function('require', 'module', 'exports', output)(requireStub, module, module.exports);
  const productEnv = { BETTER_AUTH_SECRET: 'fixture-only', GITHUB_APP_PRIVATE_KEY: 'fixture-only' };
  await module.exports.withWorkspaceRuntimeLease({ db: {}, env: productEnv, authority: {}, userId: 'u', projectId: 'p', sessionId: 's', purpose: 'local_git_read' }, async () => undefined);
  if (!captured) throw new Error('Policy boundary probe did not intercept the shared call; review adapter drift');
  const passed = !Object.hasOwn(captured, 'env');
  console.log(`${passed ? 'PASS' : 'FAIL'} product adapter excludes Env from shared policy input: envForwarded=${captured.env === productEnv}`);
  if (!passed) failures++;
}
function probeNpmRefresh() {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ditto-advisor-npm-'));
  const contracts = path.join(temp, 'runtime-contracts');
  const consumer = path.join(temp, 'consumer');
  const env = { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_install_links: 'true' };
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const realTscBuild = process.argv.includes('--tsc-build');
  try {
    fs.mkdirSync(path.join(contracts, 'src'), { recursive: true });
    fs.mkdirSync(consumer);
    const build = realTscBuild ? `${JSON.stringify(process.execPath)} ${JSON.stringify(localRequire.resolve('typescript/bin/tsc'))} -p tsconfig.json` : 'node build.cjs';
    fs.writeFileSync(path.join(contracts, 'package.json'), JSON.stringify({ name: '@ditto/runtime-contracts', version: '1.0.0', type: 'module', exports: './dist/index.js', files: ['dist'], scripts: { build } }));
    fs.writeFileSync(path.join(contracts, 'build.cjs'), "const fs=require('node:fs');fs.rmSync('dist',{recursive:true,force:true});fs.cpSync('src','dist',{recursive:true});");
    if (realTscBuild) {
      fs.writeFileSync(path.join(contracts, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: 'src', declaration: true, skipLibCheck: true }, include: ['src/**/*.ts'] }));
      fs.writeFileSync(path.join(contracts, 'src/obsolete.ts'), 'export const obsolete = true;\n');
    } else {
      fs.writeFileSync(path.join(contracts, 'src/obsolete.js'), 'export const obsolete = true;\n');
      fs.writeFileSync(path.join(contracts, 'src/obsolete.d.ts'), 'export declare const obsolete: true;\n');
    }
    const writeSource = (marker) => {
      fs.writeFileSync(path.join(contracts, `src/index.${realTscBuild ? 'ts' : 'js'}`), `export const marker = '${marker}';\n`);
      if (!realTscBuild) fs.writeFileSync(path.join(contracts, 'src/index.d.ts'), `export declare const marker: '${marker}';\n`);
    };
    const actual = JSON.parse(fs.readFileSync(path.join(root, 'packages/session-brain/package.json'), 'utf8'));
    if (actual.scripts['contracts:refresh'] === 'node ./scripts/refresh-contracts.mjs') {
      fs.mkdirSync(path.join(consumer, 'scripts'));
      fs.copyFileSync(path.join(root, 'packages/session-brain/scripts/refresh-contracts.mjs'), path.join(consumer, 'scripts/refresh-contracts.mjs'));
    }
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'copy-consumer', private: true, type: 'module', scripts: { 'contracts:refresh': actual.scripts['contracts:refresh'] }, dependencies: { '@ditto/runtime-contracts': 'file:../runtime-contracts' } }));
    writeSource('before');
    npm(['run', 'build'], contracts);
    npm(['install', '--ignore-scripts'], consumer);
    const resolveInstalled = () => createRequire(path.join(consumer, 'package.json')).resolve('@ditto/runtime-contracts');
    const installed = resolveInstalled();
    if (fs.realpathSync(installed).startsWith(fs.realpathSync(contracts) + path.sep)) throw new Error('Expected a copied directory file dependency');
    writeSource('after');
    if (realTscBuild) fs.unlinkSync(path.join(contracts, 'src/obsolete.ts'));
    else {
      fs.unlinkSync(path.join(contracts, 'src/obsolete.js'));
      fs.unlinkSync(path.join(contracts, 'src/obsolete.d.ts'));
    }
    npm(['run', 'build'], contracts);
    npm(['run', 'contracts:refresh'], consumer);
    const imported = execFileSync(process.execPath, ['--input-type=module', '-e', "const m = await import('@ditto/runtime-contracts');console.log(m.marker)"], { cwd: consumer, encoding: 'utf8' }).trim();
    const declarations = fs.readFileSync(path.join(path.dirname(resolveInstalled()), 'index.d.ts'), 'utf8');
    const declarationsFresh = declarations.includes('after');
    const passed = imported === 'after' && declarationsFresh;
    console.log(`npm ${npm(['--version'], consumer).trim()}, directory file dependency installed as copy`);
    console.log(`Actual refresh script: ${actual.scripts['contracts:refresh']}`);
    console.log(`${passed ? 'PASS' : 'FAIL'} actual copied-consumer refresh: imported=${imported}, declarations=${declarationsFresh ? 'fresh' : 'stale'}, producer=${realTscBuild ? 'tsc' : 'clean-copy'}`);
    if (!passed) failures++;
    const staleFiles = ['obsolete.js', 'obsolete.d.ts'].filter((file) => fs.existsSync(path.join(path.dirname(resolveInstalled()), file)));
    console.log(`${staleFiles.length ? 'FAIL' : 'PASS'} refresh removes deleted emitted artifacts: staleFiles=${staleFiles.join(',') || 'none'}`);
    if (staleFiles.length) failures++;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
async function main() {
  {
    const f = fixture();
    const authority = authorityModule.createSandboxAuthority(f.db);
    f.sqlite.exec("UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2");
    await mustDeny('already-migrating callback', () => authority.resolveOutboundRequest(ctx, 'model'));
    f.sqlite.close();
  }
  {
    const f = fixture();
    const authority = authorityModule.createSandboxAuthority(f.db);
    f.once(sessionRead, () => f.sqlite.exec("UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2"));
    await mustDeny('unlimited callback owner changes after owner read', () => authority.resolveOutboundRequest(ctx, 'model'));
    console.log('durable owner at return:', f.sqlite.prepare('SELECT runtimeOwner FROM workspace_sessions').get().runtimeOwner);
    f.sqlite.close();
  }
  {
    const f = fixture();
    const authority = authorityModule.createSandboxAuthority(f.db);
    await mustDeny('explicit caller owner-version mismatch', () => authority.resolveOutboundRequest({ ...ctx, runtimeOwnerVersion: 99 }, 'model'));
    f.sqlite.close();
  }
  {
    const f = fixture();
    const authority = authorityModule.createSandboxAuthority(f.db);
    f.once(sessionRead, () => authority.rotateGeneration('i'));
    await mustDeny('operation insertion after actual lifecycle rotation', () => authority.openOperation({ identityId: 'i', family: 'git_transport', type: 'git_fetch', contractVersion: 1, expiresAt: new Date(4102444800000) }));
    console.log('identity/operation generations:', f.sqlite.prepare("SELECT si.lifecycleGeneration AS identityGeneration, op.lifecycleGeneration AS operationGeneration FROM sandbox_identities si JOIN privileged_operations op ON op.identityId=si.id WHERE op.family='git_transport'").get());
    f.sqlite.close();
  }
  {
    const f = fixture();
    f.sqlite.exec("DELETE FROM workspace_capacity_leases; INSERT INTO workspace_capacity_leases (id,sessionId,userId,leaseToken,expiresAt) VALUES ('l1','other-1','u','t1',4102444800),('l2','other-2','u','t2',4102444800); INSERT INTO workspace_runtime_work (id,fifoSeq,projectId,userId,sessionId,intent,queueExpiresAt) VALUES ('work',1,'p','u','s','agent_run',4102444800)");
    let statusAtFence;
    f.once((q) => q.startsWith('select') && q.includes('runtime_capacity_policy'), () => {
      statusAtFence = f.sqlite.prepare("SELECT status FROM workspace_runtime_work WHERE id='work'").get().status;
      f.sqlite.exec("UPDATE workspace_sessions SET runtimeOwner='migrating', runtimeOwnerVersion=2 WHERE id='s'");
    });
    await capacity.drainWorkspaceRuntimeQueue({ db: f.db, env: {}, now: () => 1700000000000 });
    const statusAfter = f.sqlite.prepare("SELECT status FROM workspace_runtime_work WHERE id='work'").get().status;
    const passed = statusAtFence === statusAfter;
    console.log(`${passed ? 'PASS' : 'FAIL'} legacy drainer mutation after ownership fence: ${statusAtFence} -> ${statusAfter}`);
    if (!passed) failures++;
    f.sqlite.close();
  }
  {
    const f = fixture();
    f.once(sessionRead, () => f.sqlite.exec("UPDATE workspace_sessions SET runtimeOwner='migrating', runtimeOwnerVersion=2 WHERE id='s'"));
    let denied = false;
    try {
      await capacity.persistWorkspaceWork({ db: f.db, workId: 'late-work', intent: { kind: 'preview_start', projectId: 'p', userId: 'u', sessionId: 's' }, nowMs: 1700000000000 });
    } catch (error) {
      if (error.name !== 'WorkspaceRuntimeError') throw error;
      denied = true;
    }
    const count = f.sqlite.prepare("SELECT count(*) AS n FROM workspace_runtime_work WHERE id='late-work'").get().n;
    const passed = denied && count === 0;
    console.log(`${passed ? 'PASS' : 'FAIL'} legacy queue admission after owner read: denied=${denied}, insertedRows=${count}`);
    if (!passed) failures++;
    f.sqlite.close();
  }
  const contracts = require(path.join(root, 'packages/runtime-contracts/dist/index.js'));
  for (const [label, input] of [
    ['prototype unknown field', '{"version":1,"kind":"prompt","idempotencyKey":"key","projectId":"p","text":"hello","__proto__":"ignored"}'],
    ['deep array', '['.repeat(8000) + '0' + ']'.repeat(8000)],
    ['deep object', '{"a":'.repeat(8000) + '0' + '}'.repeat(8000)],
  ]) {
    try { contracts.parseBrowserCommandV1(input); console.log(`FAIL ${label}: accepted`); failures++; }
    catch (error) {
      const passed = error.name === 'ContractParseError';
      console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: ${error.name} ${error.code || ''}`);
      if (!passed) failures++;
    }
  }
  if (process.argv.includes('--adapter')) await probePolicyAdapter();
  if (process.argv.includes('--npm')) probeNpmRefresh();
  console.log(`Residual failures: ${failures}`);
  process.exitCode = failures ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
