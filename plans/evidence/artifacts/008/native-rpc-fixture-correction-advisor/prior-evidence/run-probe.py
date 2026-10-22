import json, pathlib, subprocess, time
root = pathlib.Path('/home/ayan/ditto-execution/plan-008-4WXvNW')
out = root / 'plans/evidence/artifacts/008/native-rpc-fixture'
argv = ['sh', '.execution-008/clean-run.sh', 'pnpm', '--filter', '@ditto/credential-tests', 'exec', 'vitest', 'run', '--config', str(out / 'probe.config.ts')]
start = time.monotonic()
with (out / 'probe-original.log').open('w') as log:
    result = subprocess.run(argv, cwd=root, stdout=log, stderr=subprocess.STDOUT)
(out / 'command-original.json').write_text(json.dumps({'argv':argv,'cwd':str(root),'exit':result.returncode,'elapsedSeconds':time.monotonic()-start,'testDeadlineMs':5000,'hookDeadlineMs':10000,'provider':'openai','model':'gpt-6.1-sol','reasoning':'medium','fallback':False},indent=2)+'\n')
print('Probe exit', result.returncode)
raise SystemExit(result.returncode)
