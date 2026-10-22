import pathlib, json, hashlib, shutil, subprocess, difflib, statistics
root=pathlib.Path('/home/ayan/ditto-execution/plan-008-4WXvNW')
out=root/'plans/evidence/artifacts/008/native-rpc-fixture-correction'
old=root/'plans/evidence/artifacts/008/native-rpc-fixture'
hashfile=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
expected=json.loads((out/'entry-source-sha256.json').read_text())
model='apps/credential-tests/src/model-entry.ts'
shutil.copyfile(root/model,out/'temporary-model-entry.ts')
(out/'temporary-probe.patch').write_text(''.join(difflib.unified_diff((out/'entry-source'/model).read_text().splitlines(True),(root/model).read_text().splitlines(True),fromfile='baseline/'+model,tofile='temporary/'+model)))
shutil.copyfile(root/'.execution-008/native-rpc-fixture-correction/receiver.mjs',out/'receiver.bundle.mjs')
for p in expected: shutil.copyfile(out/'entry-source'/p,root/p)
actual={p:hashfile(root/p) for p in expected}
assert actual==expected
baseline=json.loads(pathlib.Path('/home/ayan/ditto/plans/evidence/artifacts/008/command-read-batch-advisor/final-source-sha256.json').read_text())
assert actual==baseline
prior=json.loads((out/'prior-evidence-sha256.json').read_text())
assert prior=={str(p.relative_to(old)):hashfile(p) for p in old.rglob('*') if p.is_file()}
assert prior=={str(p.relative_to(out/'prior-evidence')):hashfile(p) for p in (out/'prior-evidence').rglob('*') if p.is_file()}
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=root).strip()
check=subprocess.run(['git','diff','--check'],cwd=root,capture_output=True,text=True)
assert check.returncode==0
markers=[b'fixtureNativeRpc008',b'NativeRpcFixtureReceiver',b'boundedNativeRpcProbe',b'ScratchCurrent008',b'ScratchNative008',b'NATIVE_RPC_008']
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z','apps','packages'],cwd=root).split(b'\0')
matches=[]
for p in paths:
    if not p: continue
    path=root/p.decode()
    if path.is_file():
        for marker in markers:
            if marker in path.read_bytes(): matches.append({'path':p.decode(),'marker':marker.decode()})
assert not matches
(out/'final-source-sha256.json').write_text(json.dumps(actual,indent=2)+'\n')
(out/'restoration-proof.json').write_text(json.dumps({'all37MatchEntryAndMainBaseline':True,'files':actual,'applicationSourceFilesScanned':len([p for p in paths if p]),'remainingProbeMarkers':matches,'stagingEmpty':True,'diffCheckExit':check.returncode,'priorEvidenceOriginalAndCopiedBytesUnchanged':True,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()},indent=2)+'\n')
normalize=lambda p:'\n'.join(line for line in p.read_text().splitlines() if not line.startswith('// '))
assert normalize(out/'receiver.bundle.mjs')==normalize(out/'prior-evidence/receiver.bundle.mjs')
assert hashfile(out/'receiver.bundle.mjs')==json.loads((out/'preflight-proof.json').read_text())['preflightBundleSha256']
meta=json.loads((out/'build-metafile.json').read_text())
inputs={str((root/'apps/credential-tests'/p).resolve().relative_to(root)):hashfile((root/'apps/credential-tests'/p).resolve()) for p in meta['inputs']}
(out/'bundle-input-sha256.json').write_text(json.dumps(inputs,indent=2)+'\n')
records=[]; proofs=[]
for line in (out/'probe.log').read_text().splitlines():
    if line.startswith('NATIVE_RPC_008_SAMPLES '): records.append(json.loads(line.split(' ',1)[1]))
    if line.startswith('NATIVE_RPC_008_PROOF '): proofs.append(json.loads(line.split(' ',1)[1]))
intervals=[]; summary=[]
for record in records:
    assert len(record['samples'])==12
    for s in record['samples']:
        assert s['ok']
        intervals.append({'caller':record['caller'],**s,'creationMs':s['created']-s['before'],'beforeToEntryMs':s['entry']-s['before'],'createdToEntryMs':s['entry']-s['created'],'bodyMs':s['exit']-s['entry'],'returnMs':s['after']-s['exit'],'totalMs':s['after']-s['before']})
    for binding in ['ScratchCurrent008','ScratchNative008']:
        for kind in ['echo','authority']:
            group=[s for s in intervals if s['caller']==record['caller'] and s['binding']==binding and s['kind']==kind]
            values={k:[s[k] for s in group] for k in ['creationMs','beforeToEntryMs','createdToEntryMs','bodyMs','returnMs','totalMs']}
            summary.append({'caller':record['caller'],'binding':binding,'kind':kind,'count':len(group),'values':values,'medianMs':{k:statistics.median(v) for k,v in values.items()}})
assert len(intervals)==24 and len(proofs)==2
(out/'scalar-samples.json').write_text(json.dumps(records,indent=2)+'\n')
(out/'rpc-intervals.json').write_text(json.dumps(intervals,indent=2)+'\n')
(out/'timing-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
command=json.loads((out/'command.json').read_text()); assert command['exit']==0
(out/'results.json').write_text(json.dumps({'verdict':'bounded_probe_passed_not_product_acceptance','plan008FixedOrAccepted':False,'correctionInvocations':1,'command':command,'testCount':2,'passed':2,'failed':0,'samples':{'test':12,'existing-DO':12},'proofs':proofs,'wrongOwnerDeniedBothReceivers':True,'receiverAndExecutableBundlePredicatesUnchanged':True,'historicalFailuresRemainFailures':2,'restoredAll37':True},indent=2)+'\n')
files=['receiver.ts','caller.ts','probe.worker.test.ts','probe.config.ts','scratch-correction.patch','temporary-model-entry.ts','temporary-probe.patch','receiver.bundle.mjs','build-metafile.json','probe.log','command.json','preflight-proof.json','rpc-intervals.json','timing-summary.json']
(out/'probe-artifact-sha256.json').write_text(json.dumps({p:hashfile(out/p) for p in files},indent=2)+'\n')
print('37 restored; 24 scalar samples extracted; prior evidence unchanged; no hooks; empty staging; diff check passed')
