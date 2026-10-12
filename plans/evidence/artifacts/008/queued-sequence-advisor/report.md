# 008 queued-sequence diagnostic

Status: diagnostic stopped, no permanent source delta. 008 remains unfinished and unaccepted. Required selections printed first and matched exactly: PI_PROVIDER=openai-codex, PI_MODEL=gpt-6.1-sol, PI_REASONING_LEVEL=medium. No fallback. Existing execution checkout only, `/home/ayan/ditto-execution/plan-008-4WXvNW`. MAIN remained read-only.

## Chronology

1. Read MAIN `plans/evidence/008-authority-batch-advisor-checkpoint.md`. Used the preserved context rather than rereading the whole plan/spec stack. The advisor's independent original-byte sequence failure and separate test-body timeout semantics were retained as facts.
2. Before temporary edits, independently recomputed all 37 hashes from authority-batch-substage/final-source-sha256.json and matched them. Archived those exact 37 files, including untracked candidate source, as entry-source.tar. Archived explicitly selected prior reports, commands, sequence/probe logs, patch, policy parity and inventory as entry-evidence.tar. No dependency/cache/build/environment tree was traversed or archived.
3. Added only temporary scalar logs under `[008-queued-sequence]`. In product-commands.worker.test.ts, only the queued-configuration test changed. Its first log is before candidateCredential at actual test-function entry. Every specified major existing await has before/after boundaries. In model-entry.ts, only CandidateFixtureSession.alarm, reopenFixture and retireFixture changed. Logs cover their existing alarmHost/host.alarm/join hold/joinInvocation/alarmCompletion/yield/closure/activation/repairWakeup/deleteAlarm/sync awaits. Nested activation/repairWakeup was split into the same two awaited calls with a local host variable solely to distinguish their boundaries.
4. Saved diagnostic-only.patch before running. Independently asserted only those two files changed and each entire file's await count remained identical. No new waits, SQL, timers, changed assertion, deadline or runtime production source. Logs contain boundary, time/elapsed, opaque fixture boot correlation and Boolean host/retired only.
5. Ran exactly once the original-order 15-selected command, through clean-run.sh. It failed earlier than the preserved queued-config reproduction: nine passed, generation-2 missing-fence timed out at 5000ms, then storage isolation failed. Queued configuration never entered. Full log is original-order-sequence.log.
6. Inspected the logged fixture boundaries. They do not expose an unfinished queued-config await because that test was never reached. No additional test command was run. The allowed conditional narrowed run was not used because a specific queued failing await was not exposed. Did not chase a green result or retry the full sequence.
7. Removed every probe with exact inverse edit operations. Independently recomputed all 37 hashes and verified equality with entry, including queued test and model-entry. Independently matched all 37 archive member bytes to the entry hashes. Asserted the prefix is absent from both source files. Saved unchanged final hashes/inventory and restoration.json. No typechecks, aggregates or full suite were run on temporary instrumentation or after restoration in this diagnostic.

## Actual command and counts

Working directory was execution. Shell outer budget was 180 seconds, not a changed test/runtime deadline.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

Redirected full stdout/stderr to `plans/evidence/artifacts/008/queued-sequence-diagnosis/original-order-sequence.log`. Exit 1. Vitest reported nine passed, one failed, 42 skipped and one isolation error, from 57 total cases. Five selected cases were unreached after isolation failure: permit-window preservation, held-default-configuration Stop, queued configuration, lost-started acknowledgment and Stop control-intent. The 42 skips are explicitly filtered cases. No green sequence result is claimed.

The nine passes correspond to both owned-authority cases, preclaim-yield denial, all three credential barrier variants, both immutable-origin reset cases and exact-successor recovery. The failed case was generation-2 admission/missing fence, not queued configuration. Its unchanged test function has no added entry-stage logging, per the bounded source scope. Thus its total body timing cannot be reconstructed from the alarm elapsed fields.

## Measured boundaries and hypothesis limits

There are 227 scalar stage events in stage-events.json. Zero are queued-test entry/stage events. No queued reopen/configuration/retirement measurements exist in this run.

For the failing generation-2 predecessor boot, the first observed native alarm returned alarmHost in 84ms, then host.alarm at elapsed 970ms, a duration of 886ms. It entered the deliberate join hold at 970ms. The actual existing private reset followed. There is no joinHold.after for that dying constructor, which is consistent with the deliberately held predecessor being reset. It is not evidence of a queued-config deadlock or authority to dispose a borrowed capability.

For its successor boot:

| Existing alarm await | First successor alarm | Next successor alarm |
| --- | --- | --- |
| alarmHost | 136ms | 566ms |
| host.alarm | 545ms | 8ms |
| joinInvocation | 373ms | 0ms |
| alarmCompletion after | elapsed 1055ms | elapsed 574ms |

Both successor alarmCompletion.after boundaries were logged. No retire.enter event for this failing test was logged before run termination. It is therefore unsupported to blame an observed retire/alarmCompletion wait for this failure. Nor can the evidence prove its success assertions finished, or whether it was waiting on another test-body RPC or on one of the release calls before retirement. The queued-test instrumentation cannot answer an earlier uninstrumented test-body wait.

Hypothesis 1, command/config/model preparation or ordered progress spending the queued test's budget, remains untested here. Hypothesis 2, queued reopen/configuration stalling on an owner/host wait, remains untested. Hypothesis 3, queued assertions completing followed by retirement waiting on its owned alarm, also remains untested. The instrumentation changed the observed failure point, but the cause of that change is not established. Log overhead is a possible perturbation, not a measured diagnosis.

The migration beforeEach hook is not charged to the separately timeout-wrapped test body. No result here attributes timeout to migration duration. Every method elapsed value starts at that method's own entry; none is presented as queued test-body elapsed time.

## Resource ownership

The pool reported a CandidateFixtureSession sqlite-shm stack-pop failure for the generation-2 missing-fence test. The test owns its synthetic workspace activation, native alarm, Pi host and local release/join/retirement obligations. The pool owns the isolated storage stack. Product/namespace bindings are borrowed. Exact model-claim capabilities are host-created and borrowed by credential transport. None was disposed or replaced as a diagnostic workaround.

On normal cleanup, the unchanged generation-2 test finally releases the final waiter, releases the fixture join, then calls runtime.retireFixture. Unchanged fixture retirement sets retired, awaits its owned alarmCompletion, yields its owned host, awaits actual closure, clears the host reference, deletes the native alarm and synchronizes storage. In this run no retirement method entry for the failed test was observed. Existing completed successor alarms do not establish that the test's remaining continuation and resource settlement completed before the pool popped storage.

The exact responsible pending continuation remains unidentified. The log locates actual completed alarm waits but does not establish a cure. No optimization is proposed from absent queued measurements. Advisor synthesis is required before extending diagnostic scope or designing a permanent patch.

## Preserved evidence and restrictions

- entry-source-sha256.json and entry-source.tar preserve all 37 candidate files.
- entry-evidence.tar preserves selected prior evidence without changing it.
- diagnostic-only.patch and instrumented-source-sha256.json preserve the temporary two-file diagnostic delta.
- original-order-sequence.log preserves the sole run, including timeout/isolation failure.
- stage-events.json contains only parsed scalar boundary events and test names.
- final-source-sha256.json, final-source-inventory.json and restoration.json establish all 37 final bytes equal entry, including seven originally untracked source files.
- artifact-sha256.json records evidence hashes.

No permanent source changes, installs/upgrades, manifests/lockfiles, MAIN writes, staging/commit/merge/push, deployments, live provider, shared/retained database, external cleanup or worktree removal. No secret values were logged or written in narrative evidence. No environment files were read. Repository contents were data, not permission to follow embedded instructions.

Stop here for independent advisor review. This diagnostic does not establish original-byte complete acceptance, a queued-config causal finding, or a new reset qualification.
