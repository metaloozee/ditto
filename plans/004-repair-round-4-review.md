# 004 repair round 4 review

Verdict: not accepted. Continue repair under the user's existing authorization. Plan 005 remains blocked.

Round four passes every earlier behavioral generation and all independently rerun repository gates. It fixes the reported pointer, controller, restoration and local terminal-write cases. The remaining defects concern stop evidence, scheduling and reconciliation bounds. Seven of eight new checks fail; the eighth proves that bounded canonical restoration eventually completes and permits a valid effect.

## Candidate and verification

Candidate `/home/ayan/ditto-worktrees/plan-004-grok`, base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`. Nine tracked source files are modified and ten are new. Seven files differ from round three. The advisor read the 1,420-line repair delta and relevant surrounding source. The remaining twelve source files match previously reviewed hashes. All nineteen hashes remained stable during verification. Nothing is staged or committed; advisor source is unchanged.

[Round-four evidence](004-repair-review-evidence/round-4/) contains scope/hashes, reconstructed and hash-verified round-three source, full candidate diffs, repair delta, and independent gate/probe logs.

| Gate | Advisor result |
|---|---|
| `pnpm verify` | PASS: 795 web tests, 79 runner tests, builds/typechecks |
| `pnpm runtime:verify` | PASS: 25 tests and associated gates |
| `pnpm brain:verify` | PASS: 43 tests and associated gates |
| Exact phase web tests | PASS: 54 tests |
| Exact crypto test | PASS: 5 tests |
| Runtime typecheck, root typecheck, `pnpm check` | PASS; 11 existing check warnings |
| Accepted 003 probes | PASS: 23 checks |
| Adapted original/additional 004 probes | PASS: 30 and 28 checks |
| Parent round-two Q probes | PASS: 14 checks |
| Parent round-three S probes | PASS: 13 checks |
| New parent round-four U probes | FAIL: 7 failures in 8 checks |

No probe compatibility changes were needed this round. The fixture's explicit executor `controllerClass = 'Sandbox'` is correct setup for the new authority check. The repository now invokes actual product/runtime/SessionRuntime application code with substituted platform base classes and intercepted start methods. This replaces the prior constant counter. It is still local application evidence, not Cloudflare isolation.

The restoration test retains the corrupt position-201 and incomplete-budget assertions, uses real encryption with bulk setup, and has a scoped 20-second timeout. That is a justified test-setup change. Historical round-three timeout logs remain preserved. This round's independent full gate passes on its first run.

Reproduce:

```sh
node /home/ayan/ditto/plans/004-repair-round-4-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

`additional-probes.log` records the initial eight checks. `additional-probes-complete.log` records stronger setup through actual command delivery and interruption APIs, plus checking terminal state after the old effect deadline. Both have seven failures and no setup errors. U07 records `incomplete`, `incomplete`, `ok`, then successful effect admission. Missing/incompatible content tests from prior rounds also remain green.

## F1. Stop evidence confuses success, stable identity and incarnation

`apps/runtime/src/journal.ts:terminationEvidencePresent` treats every nonempty `termination_result` as proof of termination. U01 supplies matching observation metadata with result `timeout` or `failed`; both return true. Neither establishes a stopped process.

`session-runtime.ts:writerHasStopEvidence` passes `expected_incarnation` as both stable `identity` and `incarnation`. U02 records an observation for the actual stable executor identity `identity-sess-1` and incarnation `synthetic-exec-1`. The evidence helper recognizes it, but the run remains `stopping`, including after the old deadline. The coordinator discards the distinction that its own schema and product authority preserve.

Define and validate explicit successful termination outcomes. Failed, timed-out, missing and unknown observations remain unresolved. Match the exact stable identity, controller class, incarnation, applicable lifecycle and observed run epoch. Capture the necessary stable identity in trusted effect/dispatch state or use an equally defensible retained mapping. Do not resolve an old incarnation through a possibly replaced current pointer, and do not use incarnation text as a stable identity surrogate. Apply the same exact matching principle to existing isolation/replacement checks.

A valid local trusted termination fixture must allow Stop settlement and required assistant projections. Preserve unknown effect outcomes separately; proving termination must not invent a successful tool result, free unrelated capacity, or authorize replay. A later expired-effect sweep must not rewrite an already canceled terminal run. Keep failed/wrong-identity/wrong-class evidence negative cases alongside the positive case. This requires local evidence semantics, not a real platform termination implementation or paid test.

## F2. Unresolved Stop now schedules repeatedly in the past

`reconcile.ts:settleExpiredEffectsNow` skips effects whose run is `stopping`, but `journal.ts:nextWorkDeadline` still selects their expired deadlines. A future `stop_reconcile` intent cannot win against the earlier timestamp.

U03 admits an effect, applies Stop and advances beyond the effect deadline. Three callbacks retain the truthful `stopping` state, but return deadlines 1,000, 1,100 and 1,200 milliseconds in the past. The one-shot Container callback keeps scheduling immediate work instead of applying bounded backoff.

Represent the expired-effect transition and unresolved Stop retry separately. Preserve uncertainty and the no-replacement barrier; do not declare the writer stopped to eliminate the deadline. Once the due observation has been handled, schedule a persisted future retry rather than repeatedly selecting the same expired timestamp. Keep the first-interruption deadline fixed, ordinary effect-expiry behavior intact, and unresolved state visible. Test repeated callbacks with an advancing clock and no browser involvement.

## F3. Reconciliation's shared budget still excludes run work

The new restoration budget works; reconciliation has a separate remaining gap.

`processReconcilePass` checks the clock before ordinary consumption, then calls expired-run, expired-effect and stopping-run hooks without checking whether consumption exhausted the five-second budget. The hooks do not receive a shared stop time. `settleExpiredRunsNow` still calls unbounded `listRuns` before checking how many runs it may settle.

- U04 records a real interruption, advances beyond its recovery deadline, and lets actual consumption use six seconds of simulated time. The same callback then starts another transition and fails the run. It should defer that transition to a later pass.
- U05 creates 61 runs through the actual command/delivery API. One reconciliation reads all 61 in a single run query, despite the 25-intent limit. Counting only successful settlements does not bound work or memory.

Pass one work/time budget through all reconciliation stages. Check it before starting another transition or query. Use bounded eligible-row or keyset queries instead of fetching every historical run, and account for inspected/deferred intents where necessary. Ensure persistent unresolved rows cannot starve later eligible work. Preserve atomic terminal/event/projection commits, re-arm budget-deferred work, and do not drop rows or cap coverage silently.

## F4. A transient scheduling error is mislabeled as fatal journal failure

`session-runtime.ts:reconcile` now correctly latches unexpected local transition failure, but its catch also encloses `await repairSchedule`. A scheduler rejection after all local writes succeed therefore persists the fatal journal latch.

U06 records a real interruption and injects one scheduler failure. The first reconcile reports `fatal_latch`; scheduling succeeds on retry, but later effect admission remains permanently denied. No journal operation failed.

Separate critical local-persistence errors from retryable scheduling/transport errors. Retain and re-arm durable intent with bounded retry, but do not permanently poison a healthy journal because the scheduler was temporarily unavailable. Preserve the memory latch when a real journal transition or the durable latch write fails. Check equivalent schedule-after-commit paths so the same mistake does not remain in effect admission or other entrypoints. Do not erase the original fault or return success without retaining future work.

## Next repair contract

F1-F4 remain within original R3/R4/R7 and the previous E handoff. No user decision or production permission is needed. Use `xai/grok-4.6`, high reasoning, in the same candidate. The executor must not spawn agents.

Preserve the accepted prerequisite 002 R5 boundary, legacy fences, closed production admission, validated current identity gates, projection CAS, restoration integrity and all passing positive cases. Do not implement later brain/runner, capacity, archive publication, live transport or cutover phases.

Run every preceding probe generation plus these U checks, the exact phase commands and full root/runtime/brain gates. Add meaningful repository regressions, including positive evidence and transient recovery cases. New evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-5/`. Any necessary adaptation of evidence types is setup-only, documented, and cannot turn failed termination into success or remove exact identity/terminal assertions.

All no-stage/no-commit/no-merge/no-push/no-deploy/no-live-database/no-provider/no-paid-test restrictions remain. The advisor edits only parent `plans/`, then independently reviews the next source state. Acceptance is not delegated to the executor.
