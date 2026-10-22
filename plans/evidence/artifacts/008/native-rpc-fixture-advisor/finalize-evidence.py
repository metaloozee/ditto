import pathlib, json, hashlib, subprocess
root = pathlib.Path('/home/ayan/ditto-execution/plan-008-4WXvNW')
out = root / 'plans/evidence/artifacts/008/native-rpc-fixture'
prior = json.loads((root / 'plans/evidence/artifacts/008/rpc-completion-diagnosis/pinned-source-excerpts.json').read_text())
selected = [r for r in prior if 'chord' in r['path'] or 'test-internal' in r['path']]
for r in selected:
    assert hashlib.sha256(pathlib.Path(r['path']).read_bytes()).hexdigest() == r['sha256']
pool = pathlib.Path(next(r['path'] for r in prior if 'test-internal' in r['path'])).parents[3] / 'pool/index.mjs'
mf = root / 'node_modules/.pnpm/miniflare@4.20260310.0/node_modules/miniflare/dist/src/index.js'
for path, ranges in [(pool,[(7595,7614),(7636,7640),(7676,7695)]),(mf,[(70607,70638),(70656,70660),(72876,72908),(75872,76020)])]:
    lines = path.read_text().splitlines()
    for start, end in ranges:
        selected.append({'path':str(path),'startLine':start,'endLine':end,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'text':'\n'.join(f'{i}: {lines[i-1]}' for i in range(start,end+1))})
(out / 'pinned-source-excerpts.json').write_text(json.dumps(selected,indent=2)+'\n')
metafile = json.loads((out / 'build-metafile.json').read_text())
inputs = {}
for path in metafile['inputs']:
    actual = (root / 'apps/credential-tests' / path).resolve()
    inputs[str(actual.relative_to(root))] = hashlib.sha256(actual.read_bytes()).hexdigest()
(out / 'bundle-input-sha256.json').write_text(json.dumps(inputs,indent=2)+'\n')
markers = [b'fixtureNativeRpc008',b'NativeRpcFixtureReceiver',b'boundedNativeRpcProbe',b'ScratchCurrent008',b'ScratchNative008',b'NATIVE_RPC_008']
# git inventory avoids dependency/cache trees while including untracked candidate source.
paths = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z','apps','packages'],cwd=root).split(b'\0')
matches = []
for p in paths:
    if not p: continue
    path = root / p.decode()
    if path.is_file():
        for marker in markers:
            if marker in path.read_bytes(): matches.append({'path':p.decode(),'marker':marker.decode()})
assert not matches
proof = json.loads((out / 'restoration-proof.json').read_text())
proof.update({'applicationSourceFilesScanned':len([p for p in paths if p]),'applicationProbeMarkers':matches})
(out / 'restoration-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
artifacts = ['receiver.ts','caller.ts','probe.worker.test.ts','probe.config.ts','probe-original.config.ts','receiver.bundle.mjs','receiver-original.bundle.mjs','temporary-model-entry.ts','temporary-probe.patch','build-metafile.json','build-original-metafile.json','probe-original.log','probe-corrected.log']
(out / 'probe-artifact-sha256.json').write_text(json.dumps({p:hashlib.sha256((out/p).read_bytes()).hexdigest() for p in artifacts},indent=2)+'\n')
print('Evidence finalized; application marker scan empty')
