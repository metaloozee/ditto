from pathlib import Path
import re
root=Path('/home/ayan/ditto-execution/plan-007-recovery'); out=root/'plans/evidence/artifacts/007/configuration-timing-followup'
src=root/'apps/credential-tests/src/model-entry.ts'
def absolute(m):
 path=m.group(1)
 return 'from "'+str((src.parent/path).resolve())+'"' if path.startswith('.') else m.group(0)
text=re.sub(r'from "([^"]+)"',absolute,src.read_text())
text=text.replace('const credential =\n\t\t\tawait', 'const start = performance.now();\n        const credential =\n\t\t\tawait')
text=text.replace('\n\t\tif (\n\t\t\tselection', '\n        const credentialMs = performance.now()-start;\n\t\tif (\n\t\t\tselection')
text=text.replace('return readOwnedConfigurationAuthority(', 'const result = await readOwnedConfigurationAuthority(')
text=text.replace('\n\t\t\ttrue,\n\t\t);', "\n\t\t\ttrue,\n\t\t);\n        console.log('[007-product-timing]', JSON.stringify({selection: selection !== undefined, credentialMs, policyMs: performance.now()-start-credentialMs}));\n        return result;")
text=text.replace("console.log('[007-product-timing]', JSON.stringify({selection: selection !== undefined, credentialMs, policyMs: performance.now()-start-credentialMs}));", "timingRows.push({selection: selection !== undefined, credentialMs, policyMs: performance.now()-start-credentialMs});")
text=text.replace('export class FixtureProduct extends WorkerEntrypoint<ModelProductBindings> {', 'const timingRows: {selection: boolean; credentialMs: number; policyMs: number}[] = [];\nexport class FixtureProduct extends WorkerEntrypoint<ModelProductBindings> {\n readTiming() { return timingRows.splice(0); }')
(out/'timing-product-entry-quiet.ts').write_text(text)
config=(out/'timing.config.ts').read_text().replace('/apps/credential-tests/src/model-entry.ts','/plans/evidence/artifacts/007/configuration-timing-followup/timing-product-entry-quiet.ts')
probe=(out/'timing.worker.test.ts').read_text().replace("afterEach(() => { console.log('[007-timing]'", "afterEach(async () => { const components = await (SELF as unknown as {readTiming(): Promise<unknown>}).readTiming(); console.log('[007-product-components]', JSON.stringify({test:expect.getState().currentTestName,components})); console.log('[007-timing]'")
(out/'timing-product-quiet.worker.test.ts').write_text(probe)
config=config.replace('/timing.worker.test.ts','/timing-product-quiet.worker.test.ts')
(out/'timing-product-quiet.config.ts').write_text(config)
