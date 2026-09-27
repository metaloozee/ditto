# 004 repair round 5 review

Verdict: not accepted. Continue targeted repair under the user's authorization. Plan 005 remains blocked.

Round five fixes the earlier termination matching, past-deadline retry, run-query bound and transient-scheduler latch examples. All earlier checks pass. Four of five new checks fail: acceptance can lose its only scheduled callback, retry-persistence errors are swallowed, Stop bypasses recovery expiry, and terminal projection still scans unrelated command history.

## Independent verification

Candidate `/home/ayan/ditto-worktrees/plan-004-grok`, base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`. Nine tracked source files are modified and ten are new. Five files differ from round four. The advisor read every hunk of the 1,059-line repair delta and relevant surrounding code. Fourteen other source files match prior reviewed hashes. All nineteen hashes remained stable through verification. Nothing is staged or committed.

[Round-five evidence](004-repair-review-evidence/round-5/) contains full source diffs and hashes, a reconstructed/hash-verified round-four source tree, the repair delta and independent logs.

| Gate | Advisor result |
|---|---|
| `pnpm verify` | PASS: 802 web tests, 79 runner tests, builds/typechecks |
| `pnpm runtime:verify` | PASS: 25 tests and associated gates |
| `pnpm brain:verify` | PASS: 43 tests and associated gates |
| Exact phase web command | PASS: 61 tests |
| Exact runtime crypto command | PASS: 5 tests |
| Runtime typecheck, root typecheck, `pnpm check` | PASS; 11 existing warnings |
| Accepted 003 probes | PASS: 23 checks |
| Adapted original/additional 004 probes | PASS: 30 and 28 checks |
| Parent Q, S and U generations | PASS: 14, 13 and 8 checks |
| New parent V probes | FAIL: 4 failures in 5 checks |

There were no probe setup adaptations this round. Capturing executor stable identity/controller on the effect is within scope and preferable to resolving an old incarnation through a current pointer. Failed/timeout evidence stays negative; valid termination cancels the targeted run without inventing a tool result. Bounded restoration still completes across later passes.

The executor's original-R1-R10 summary should be read as passing examples, not prior acceptance. No round has accepted plan 004. Retrieval of the completed agent returned `Agent not found`; the candidate's execution summary and source were available and reviewed directly.

Reproduction:

```sh
node /home/ayan/ditto/plans/004-repair-round-5-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

`additional-probes.log` records five checks, four failures and no setup errors. V01 is a positive control through actual command delivery: the receipt leaves the outbox only with a successfully armed callback.

## G1. Successful handoff can strand the only durable work

`apps/runtime/src/session-runtime.ts:tryArmSchedule` catches a scheduler rejection, writes some retry metadata, and returns false without attempting another schedule. `acceptCommand`, its duplicate path and several other callers ignore that false result.

V02 injects one failure into the first scheduler call during actual dispatcher delivery. The command becomes `delivered`, with zero armed callbacks. Advancing the clock and running the dispatcher again still produces zero callbacks because the delivered outbox row is no longer eligible. The failure is temporary, but no component calls the scheduler a second time.

A wakeup row alone is not a scheduled callback. Keep a bounded retry mechanism that actually arms the supported Container scheduler, or propagate a retryable handoff failure so the existing autonomous outbox retry remains responsible. If bounded scheduling attempts fail, do not report a handoff success that removes the only retry owner. Preserve durable acceptance and its exact receipt on retry; do not create another run or effect decision. Check duplicate acknowledgment, effect admission and interruption paths as well. Do not introduce an unbounded request loop, timer-based execution loop or unrelated deployment path.

## G2. The retry helper now suppresses real journal failure

The inner catch in `tryArmSchedule` swallows exceptions from `persistFutureCoordinatorWork`. Its comment claims an in-memory retry, but no retry state or callback is actually recorded there. More importantly, this is a real local persistence failure, not the remote scheduler failure F4 asked to keep retryable.

V03 injects a scheduler rejection followed by an actual retry-wakeup INSERT failure during acceptance. Both faults are reached. Acceptance returns success, and a later effect is admitted in an existing run.

Separate scheduler errors from local journal operations structurally. Local retry-intent/deadline persistence failure must invoke the same fatal memory/durable barrier as other critical journal transitions, including when storing the latch also fails. Pure scheduler failure must still remain recoverable without a permanent fatal latch. Do not collapse both errors into false or leave an empty catch. Preserve deliberate validation/conflict categories and committed acceptance identity.

## G3. Stop bypasses the fixed recovery deadline

`journal.ts:listDueExpiredRuns` now excludes `stopping`, and `markFirstInterruption` preserves that state. These changes avoid an earlier state rewrite but mean an interrupted run that later receives Stop can never reach the required recovery-expiry settlement.

V04 admits an effect, records interruption, applies Stop, and reconciles just after the persisted fifteen-minute deadline. The deadline is unchanged, but the run remains `stopping` with reason `stop_unresolved_writer`; its assistant remains pending. The unresolved effect is correctly retained and later admission is denied. Those correct barriers do not satisfy terminal recovery-expiry settlement.

Apply the fixed recovery deadline to all applicable nonterminal runs, including stopping runs. On expiry, atomically fail the run and enqueue its assistant projections with the recovery-expiry reason, while preserving unresolved effects and the no-replacement/no-replay barriers. Failure does not claim that the writer stopped or release its capacity. Keep completed/canceled runs immutable and keep ordinary pre-deadline Stop retries in the future. Do not reset or extend the deadline to avoid the case.

## G4. Terminal projection still defeats the reconciliation query bound

The eligible-run scan is bounded now. Its terminal callback, `session-runtime.ts:queueTerminalProjections`, still calls `listCommands` across the entire workspace, including repeated full scans while checking assistant membership.

V05 creates 61 runs through actual command/delivery, interrupts just one, and expires it. The run correctly fails, but that one terminal transition reads all 61 command rows in a query. The other sixty runs are unrelated to this settlement.

Use exact run/command membership queries and bounded continuation for any larger per-run work. Do not read the whole session's command history to settle one run. Retain an atomic durable terminal decision plus enough durable projection work to settle every assistant, and process deferred work under the existing shared budget. Do not fix the bound by dropping a turn, skipping a suffix or limiting settlement to the originating assistant. Preserve old-run/new-run ordering, denied/canceled command membership and related D1 transaction behavior.

## Next repair contract

G1-G4 remain in original R4/R5/R7 and the existing F handoff. No new architecture or permission decision is needed. Use `xai/grok-4.6`, high reasoning, in the existing candidate; the executor must not spawn agents.

Keep production admission closed, accepted 002 R5 and legacy fences intact, and preserve all prior passing cases. No stage/commit/merge/push/deploy, dependency change, historical migration edit, live/shared database, paid platform, real provider or downstream runner/brain implementation is authorized.

Add substantive repository regressions. Run every preceding behavioral generation plus V, exact phase commands, typechecks/check and root/runtime/brain verification. New sanitized evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-6/`. Preserve historical failures. Any legitimate setup-only adaptation must retain the assertions and positive controls.

The advisor edits only parent `plans/` and will independently review the next candidate. Passing executor gates is not acceptance.
