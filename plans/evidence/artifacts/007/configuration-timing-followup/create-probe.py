from pathlib import Path
import re
root=Path('/home/ayan/ditto-execution/plan-007-recovery')
out=root/'plans/evidence/artifacts/007/configuration-timing-followup'
src=root/'apps/credential-tests/src/codex-request-contract.worker.test.ts'
text=src.read_text()
def absolute(m):
 path=m.group(1)
 if not path.startswith('.'): return m.group(0)
 raw='?raw' if path.endswith('?raw') else ''
 path=path.removesuffix('?raw')
 return 'from "'+str((src.parent/path).resolve())+raw+'"'
text=re.sub(r'from "([^"]+)"',absolute,text)
probe='''
let measured: Record<string, { count: number; ms: number; max: number }> = {};
let measuredStart = 0;
function timed(name: string, operation: (...args: unknown[]) => unknown) {
 return async function(this: unknown, ...args: unknown[]) {
  const start = performance.now();
  try { return await operation.apply(this, args); }
  finally {
   const ms = performance.now() - start;
   const row = measured[name] ??= {count: 0, ms: 0, max: 0};
   row.count++; row.ms += ms; row.max = Math.max(row.max, ms);
  }
 };
}
function wrap(target: object, key: string, name: string) {
 const operation = Reflect.get(target, key) as (...args: unknown[]) => unknown;
 Reflect.set(target, key, timed(name, operation));
}
for (const key of ['configurationAllowed', 'configurationLedger', 'configurationIdentity', 'configurationEvidence', 'initializeOwnedConfiguration', 'piConfiguration', 'durable', 'seal', 'configureOwned', 'yield'])
 wrap(PiDurableHost.prototype, key, 'host.' + key);
wrap(ModelProductAuthority.prototype, 'ownedConfiguration', 'local.productD1');
const originalOpen = PiDurableHost.open;
const seen = new WeakSet<object>();
PiDurableHost.open = async function(storage, dependencies) {
 const start = performance.now();
 const host = await originalOpen.call(this, storage, dependencies);
 const row = measured['host.open'] ??= {count:0, ms:0, max:0};
 const ms = performance.now()-start; row.count++; row.ms+=ms; row.max=Math.max(row.max,ms);
 const harness = Reflect.get(host, 'harness');
 for (const key of ['root', 'conversation']) {
  const original = Reflect.get(harness,key);
  Reflect.set(harness,key,async function(...args: unknown[]) {
   const conversation = await original.apply(this,args);
   if(conversation && !seen.has(conversation)) {
    seen.add(conversation); wrap(conversation,'configure','pi.configure');
   }
   return conversation;
  });
 }
 return host;
};
beforeEach(() => { measured = {}; measuredStart = performance.now(); });
afterEach(() => { console.log('[007-timing]', JSON.stringify({test: expect.getState().currentTestName, totalMs: performance.now()-measuredStart, measured})); });
'''
text=text.replace('const product = SELF as Service<FixtureProduct>;',probe+'\nconst product = SELF as Service<FixtureProduct>;')
text=text.replace('let host = await PiDurableHost.open(storage, dependencies);', '''if (dependencies.configuration) dependencies.configuration.authorize = timed('product.configurationRPC', dependencies.configuration.authorize as (...args: unknown[]) => unknown) as typeof dependencies.configuration.authorize;
            dependencies.authority = timed('local.authority', dependencies.authority as (...args: unknown[]) => unknown) as typeof dependencies.authority;
            let host = await PiDurableHost.open(storage, dependencies);''')
text=text.replace('beforeEach(async () => {','beforeEach(async () => {\n const setupStart = performance.now();')
text=text.replace('afterEach(() => {\n\t// Denial',"afterEach(() => {\n\t// Denial")
text=text.replace(').toBe("connected");\n});', ''').toBe("connected");
 measured['fixture.setup'] = {count:1,ms:performance.now()-setupStart,max:performance.now()-setupStart};
});''',1)
(out/'timing.worker.test.ts').write_text(text)
(out/'timing.config.ts').write_text('''import base from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/vitest.config.ts";
export default {...base, cacheDir: "/home/ayan/ditto-execution/plan-007-recovery/plans/evidence/artifacts/007/configuration-timing-followup/cache", test: {...base.test, include: ["/home/ayan/ditto-execution/plan-007-recovery/plans/evidence/artifacts/007/configuration-timing-followup/timing.worker.test.ts"], poolOptions: {workers: {...base.test.poolOptions.workers, main: "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/model-entry.ts"}}}};
''')
