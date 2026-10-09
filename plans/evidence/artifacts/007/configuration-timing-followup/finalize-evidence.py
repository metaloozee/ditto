from pathlib import Path
import subprocess, hashlib, tarfile, json, re, difflib
root=Path('/home/ayan/ditto-execution/plan-007-recovery'); out=root/'plans/evidence/artifacts/007/configuration-timing-followup'
manifest=root/'plans/evidence/artifacts/007/configuration-correction/source.sha256'
files=[line.split('  ',1)[1] for line in manifest.read_text().splitlines()]
changed=[]
with tarfile.open(out/'preserved-dirty.tar.gz') as baseline:
 patch=[]
 for f in files:
  try: prior=baseline.extractfile(f).read()
  except KeyError: prior=subprocess.check_output(['git','show','HEAD:'+f],cwd=root)
  current=(root/f).read_bytes()
  if prior!=current:
   changed.append(f)
   patch.extend(difflib.unified_diff(prior.decode().splitlines(True),current.decode().splitlines(True),fromfile='a/'+f,tofile='b/'+f))
 (out/'followup.patch').write_text(''.join(patch))
with tarfile.open(out/'source.tar.gz','w:gz') as archive:
 for f in files: archive.add(root/f,arcname=f)
(out/'source.sha256').write_text(''.join(f'{hashlib.sha256((root/f).read_bytes()).hexdigest()}  {f}\n' for f in files))
preservation=[]
for line in (out/'preserved.sha256').read_text().splitlines():
 digest,f=line.split('  ',1)
 if not (root/f).exists(): preservation.append({'path':f,'state':'missing'})
 elif hashlib.sha256((root/f).read_bytes()).hexdigest()!=digest: preservation.append({'path':f,'state':'changed'})
graph=[]
for line in (root/'plans/evidence/artifacts/007/product-correction/graph.sha256').read_text().splitlines():
 digest,f=line.split('  ',1)
 graph.append({'path':f,'currentMatches':hashlib.sha256((root/f).read_bytes()).hexdigest()==digest,'headMatches':hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+f],cwd=root)).hexdigest()==digest})
counts={}
for path in sorted(out.glob('*.log')):
 text=re.sub(r'\x1b\[[0-9;]*m','',path.read_text())
 counts[path.name]={'summaries':[line.strip() for line in text.splitlines() if re.search(r'^\s*(Tests|Test Files|Duration)\s',line) or re.match(r'# (tests|pass|fail|duration_ms) ',line)],'failures':[line.strip() for line in text.splitlines() if re.match(r'\s*FAIL ',line)],'failedCaseTimings':[line.strip() for line in text.splitlines() if ('✓' in line or '×' in line) and ('actual custom_summary preparation survives' in line or 'authenticates complete payload_digest before new-intent' in line or 'authenticates complete outcome before new-intent' in line)]}
(out/'counts.json').write_text(json.dumps(counts,indent=2)+'\n')
state={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'changedSourceFiles':changed,'graph':graph,'preservationDifferences':preservation,'stagedPaths':subprocess.check_output(['git','diff','--cached','--name-only'],cwd=root).decode().splitlines(),'diffCheckExit':subprocess.run(['git','diff','--check'],cwd=root,capture_output=True).returncode,'artifactHashes':{f:hashlib.sha256((out/f).read_bytes()).hexdigest() for f in ['preserved-dirty.tar.gz','followup.patch','source.tar.gz']}}
(out/'final-state.json').write_text(json.dumps(state,indent=2)+'\n')
print(json.dumps(state,indent=2))
for name in ['after-focused.log','after-credentials-unfiltered.log','sequence-contracts-verify.log','sequence-brain-verify.log','sequence-credentials-verify.log','sequence-runtime-verify.log','sequence-verify.log','acceptance.log','original-host.log','original-product-host.log','original-d1.log','payload-alone.log','outcome-alone.log','summary-alone.log']:
 print(name,json.dumps(counts[name]))
