# 028 evidence: runtime load failures

Environment: `nproc` = 4, Linux 6.6.87.2-microsoft-standard-WSL2 (WSL2), base commit `2f79ab0`, branch `exec-028-r2`.
Logs: `plans/evidence/artifacts/028/`. Load = N busy `node -e 'for(;;){}'` loops, killed by PID after each run.

## Step 1: single-file reproduction

| File | Load | Runs | Result |
|---|---|---|---|
| pi-durable-checkpoints | 4 loops | 5 | 5 pass |
| pi-durable-checkpoints | none | 2 | 2 pass |
| pi-durable-checkpoints | 8 loops | 5 | 5 pass |
| pi-durable-restore | 4 loops | 5 | 5 pass |
| pi-durable-restore | none | 2 | 2 pass |
| pi-durable-restore | 8 loops | 5 | 5 pass |
| pi-durable-retention | 4 loops | 5 | 5 pass |
| pi-durable-retention | none | 2 | 2 pass |
| pi-durable-retention | 8 loops | 5 | 5 pass |
| pi-durable-host `-t "combines wall-clock yield"` | 4 loops | 5 | 5 pass |
| pi-durable-host `-t "combines wall-clock yield"` | none | 2 | 2 pass |

F1 did not reproduce as a single file under 4 or 8 loops (the plan allows continuing). F2 did not reproduce either (single test, 4 loops).

## Step 2: host fixtures and budgets

Files that call `PiDurableHost.open` (grep), with clock and budgets:

| File | Clock | budgets |
|---|---|---|
| pi-durable-checkpoint.fixture.ts | frozen (`control.now`) | none (fixed in this change) |
| pi-durable-command.fixture.ts | frozen | none |
| pi-durable-candidate.fixture.ts | frozen | none |
| pi-durable-encrypted-corrections.test.ts | frozen | none |
| pi-durable-models.test.ts | frozen | 10_000/1000 |
| pi-durable-effects.test.ts | frozen/real mix | 10_000/1000 (one test 2000/200) |
| pi-durable-model-preparation.gate.test.ts | frozen | 10_000/1000 |
| pi-durable-summary.test.ts | frozen | 10_000/1000 |
| pi-durable-tools.test.ts | frozen | 10_000/1000 |
| pi-durable-host.test.ts | real (`Date.now`) mostly | one test 250/100, rest default 1000/1000 |
| pi-durable-product-session.ts | real | default 1000/1000 |

Frozen clock with no budgets: checkpoint fixture, command fixture, candidate fixture, encrypted-corrections test.

## Step 3: A/B under 4-loop load (checkpoints + restore + retention together, 5 runs per arm)

TEMP diagnostic (reverted): `complete()` logged `host_invocations` when `host.reconcile()` threw.

| Arm | Runs | Result |
|---|---|---|
| A (unchanged fixture) | 5 | 4 pass, 1 fail (run 3) |
| B (`budgets: { workMs: 10_000, drainMs: 1000 }`) | 5 | 5 pass (37 tests each) |

A run 3 failure: `pi-durable-restore.test.ts > waits for an in-flight provider request, and an unknown outcome blocks the restore without any fallback`: `Matcher did not succeed in time`, caused by `Error: Session is closed`. Diagnostic rows (3 identical lines, one per poll tick, at real `Date.now()` about 1792913532241):
`[{"state":"closed","yield_at":1792913589920,"end_at":1792913590920} x2]`.
`yield_at` is the frozen virtual clock (about +58 s ahead of real time), so the invocations were closed by the host's real 1 s `setTimeout`, not by the virtual deadline, while the test was still polling. All 4 `Session is closed` hits in `ab-A-3.log` are from that one failure. The failing test differs from F1a to F1c but has the same stack and cause.

Verdict: H-F1 holds on the plan's criteria (A failure shows `Session is closed` with invocations already closed by the real timer; B 0 of 5). Caveat: evidence is thin, 1 failure in 5 A runs and 0 in 5 B runs, and the A failure was in a different test from the three originally observed.

## Step 4: B does not change what tests test

Time advances in the five checkpoint-fixture files: `later()` in retention (host yielded and closed first, then +ms, `DAY` = transient retention), `+= DAY`, workspace-actions `DEFERRAL` = 10 min, 0/2/5/9 minute steps, and `restore.test.ts:427` `control.now = deadline + 1` where `deadline` is the max admitted `operation_deadline` (an effect deadline, not the invocation window). None relies on the old 2 s invocation window. No-load run of the five files, per-file counts identical in A and B:

| File | A | B |
|---|---|---|
| checkpoints | 12 | 12 |
| restore | 16 | 16 |
| retention | 9 | 9 |
| lifecycle | 9 | 9 |
| workspace-actions | 18 | 18 |
| total | 64 passed | 64 passed |

## Step 6: F2 class

Not classified. A temporary log of `host_invocations` (`started`, `yield_at`, `end_at`, `state`) plus `Date.now()` was added where the poll at `pi-durable-host.test.ts:1565` gives up. 5 runs of the single test under 4-loop load all passed, so the log never fired. Neither (a) nor (b) is established. F2 originally failed in a full-suite `singleWorker` run, so it likely needs the full suite's load. The log was reverted.

## Step 7: unmodified `pnpm runtime:verify`, default parallelism (with the fixture fix applied)

| Run | Result | Duration | "streams long document tails across root replacement deltas" |
|---|---|---|---|
| 1 | 512 passed | 75 s | 4885 ms |
| 2 | 512 passed | 82 s | 4536 ms |
| 3 | 512 passed | 80 s | 3525 ms |
| 4 | 512 passed | 119 s | 4612 ms |
| 5 | 1 failed, 511 passed | 104 s | 8715 ms, failed: `Test timed out in 5000ms` |

Run 5 failure: `pi-durable-storage.test.ts > encrypted DO SQLite > streams long document tails across root replacement deltas`. It is neither F1 nor F2. It is the conformance case that already runs close to its 5 s deadline, as plan 026 noted. workerd also logged "Network connection lost" in that run. No F1 or F2 occurred in the 5 full runs.

## Summary

- H-F1: supported (see Step 3 caveat). Fix applied: one `budgets` line in `pi-durable-checkpoint.fixture.ts`.
- F2: unclassified (not reproduced).
- New or other: the `streams long document tails` conformance case timed out in 1 of 5 full runs.
