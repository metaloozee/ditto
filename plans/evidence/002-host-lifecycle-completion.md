# 002 host lifecycle completion

Disposition: **READY FOR ADVISOR ACCEPTANCE, not DONE.** The revised local 002 gates passed in the preserved disposable worktree. No advisor has accepted this completion. 003 remains BLOCKED and was not edited this turn. Complete L1 still requires 003.

Read this with the [accepted cooperative-wait decision](../decisions/002-cooperative-host-yield.md), [resume execution](002-host-lifecycle-resume.md), and [advisor's reproduced blocker](002-advisor-resume-review.md). Those documents, the [historical execution](002-host-lifecycle.md), and [historical review](002-advisor-review.md) are unchanged. The arbitrary noncooperative phase remains a failed bounded-host gate, even though its observational reproduction test passes.

## Isolation and incremental review

All commands ran from `/tmp/ditto-plan-002-9KCuBv`, detached HEAD `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed`. No new worktree was created. The invoking environment reported `PI_MODEL=gpt-6.1-sol` and `PI_REASONING_LEVEL=high`. No other model was launched.

Before the first source edit, exact originals of these five files were copied under ignored `node_modules/.plan-002-completion/baseline/`, preserving their repository-relative paths:

| Baseline file | SHA-256 |
|---|---|
| `apps/runtime/src/pi-durable-host.ts` | `28f2ca961cd0ba50ce87e2be02c0c7c7d4e81ec583e0a58e7d03ea29d363d892` |
| `apps/runtime/src/pi-durable-cooperative-fixture.ts` | `d476ca622fe4b9d5e31b4879365e2a3d20ad88c4389c2b93546169f71219d02f` |
| `apps/runtime/src/pi-durable-host.test.ts` | `02b58b7429966b940c5db2fe56f3bf32c178420887ee7035a25ef02a5ee77a58` |
| `apps/runtime/src/pi-durable-test-entry.ts` | `b4be0b566080867d38ede6adcf0817cd879495e94f24f4aac0e79f72e9cb7c53` |
| `apps/runtime/vitest.config.ts` | `ffc969b4eee3d81b140ce1293ae4664342bfee5d6f52fe3ec2cc189d955ecfc6` |

`node_modules/.plan-002-completion/incremental.patch` compares those originals with the completion candidate. Cooperative fixture and test entry are unchanged from that baseline. Actual incremental source changes are host, host tests, and one test-clock binding in runtime Vitest configuration. Documentation changes are this new record and status/link updates in plan 002 and `plans/README.md`.

Entry dirty scope already included the six approved spec replacements, runtime test entry/config changes, candidate host/provider/test files, plan 002/003/index amendments, decisions, and earlier evidence. All remain uncommitted. The approved spec was not edited again. `logs/preservation.log` proves the spec still equals HEAD plus exactly six approved replacements. It also verifies the historical evidence hashes, L0 and legacy scheduler hashes, and the exact historical test body against the saved baseline. Its historical-test-body SHA-256 is `eb258e1b0b45023532b088e8be57ef9a76462497a1bbec70cfdfb4d29e90a37d`. Plan 003's preserved hash is `1123fb8b616a1fdefd237189c0ee480691ecac0c325288bc10e5b9dac4ec7068`.

No main-checkout write, staging, commit, reset, deletion of unrelated work, deployment, issue publication, live provider/executor request, control-plane call, credential or `.env` read occurred. Official documentation retrieval was informational. No package installation, lockfile change, private framework patch, or maintained fork was used.

## Installed and effective environment

`logs/versions.log` and `logs/runtime-resolution.log` record installed versions and the pool's actual dependency resolution.

| Component | Version |
|---|---|
| Pi Durable / pi-ai / Chord | 1.0.1 each, unchanged |
| Worker test pool | 0.12.21 |
| Pool-resolved Miniflare | 4.20260310.0 |
| Pool-resolved workerd | 1.20260310.1 |
| Worker declarations | 4.20260702.1 |
| Vitest / TypeScript / TypeBox | 3.2.7 / 5.9.3 / 1.3.27 |
| Node / pnpm | 24.21.0 / 11.8.0 |
| Requested compatibility date | 2026-09-16, unchanged |
| Effective date | 2026-03-10, explicit fallback in every Worker run |

Other workerd versions already coexist in the pnpm store. They were not selected or upgraded. The pool resolves its March executable. These checks prove neither September compatibility nor hosted behavior. Existing `nodejs_compat` and pool-added test flags remain unchanged. No Docker image was built or run.

## Authority cancellation and actual close

Both `admit` authority promises now use public Chord `awaitWithContext` under Pi's supplied invocation context. Pre/post abort checks, live denial, durable fence, ownership generation, current authority, deadline and executor checks remain. Prechecking an already-aborted context also prevents starting an unobserved promise in Chord 1.0.1's already-aborted branch.

Cancellation ends the local wait only. The underlying authority promise remains observed by the public waiter after cancellation. It cannot resume the rejected `admit` continuation or dispatch an effect. Four permanent regressions cover both read positions on real built-in generation and tool execution. Each awaits the same actual `host.yield()` completion while preparation is still pending, denies premature reopen, then resolves or rejects preparation after close. They assert retained effect/task facts, no late dispatch/publication, no user-abort mark, passive replacement only after close, and no duplicate budget.

Red before the fix: `authority-red.log`, exit 1, four failed compliance assertions. Green after the fix: `authority-green.log`, exit 0, four tests. The advisor's ignored two-test reproduction and both earlier logs were read and preserved; their original failing-behavior assertions were not rewritten.

Other invocation-bound safety waits used here now pass context through `storage.sync` and the public `Harness.getTask` read used for result reconciliation. Because that reconciliation made the check asynchronous, final synchronous live-denial assertions now guard admission/allocation and scheduling-enabling calls. Initial budget allocation uses the last checked authority generation, not an earlier read. Two additional regressions cover authority changing before allocation and yield sealing the host at the final submission boundary. Their local observers cannot grant admission after cancellation. Actual Harness close is still awaited directly with `BACKGROUND_CONTEXT`, never raced or abandoned. Native storage operations and mandatory cleanup remain joined. The synthetic provider's keyless auth, fixed catalogue, event-stream cleanup, tool validation and result construction have no external preparation dependency. No hooks or compaction are enabled. Built-in generation stream cleanup, sequential tool settlement and retry sleep were inspected in locked shipped code and exercised by the existing real Pi tests. This is not a guarantee for arbitrary trusted JavaScript or arbitrary stalled platform storage.

Default budgets remain **1000 ms work + 1000 ms drain**. Before scheduling, SQLite stores invocation ID, generation, start, `yield_at = start + 1000`, and `end_at = start + 2000`. Duplicates retain those absolute deadlines. A new invocation requires actual prior close or matching trusted termination, durable accounting and guard reconciliation. Existing effect and first-interruption recovery deadlines do not extend.

For example, `host-final.log` recorded these absolute millisecond values with authority still pending:

| Path/read | Start | Yield | End | Actual close returned |
|---|---:|---:|---:|---:|
| request/1 | 1791127535820 | 1791127536820 | 1791127537820 | 1791127535879 |
| request/2 | 1791127535944 | 1791127536944 | 1791127537944 | 1791127536008 |
| tool/1 | 1791127536069 | 1791127537069 | 1791127538069 | 1791127536156 |
| tool/2 | 1791127536221 | 1791127537221 | 1791127538221 | 1791127536314 |

The automatic combined native-alarm test recorded start `1791127540793`, yield `1791127541793`, end `1791127542793`, and actual close returned `1791127541809`, with remote execution still pending. Logged `state: active` is the immutable invocation value returned by scheduling, not the separately asserted SQLite closure state. These are local safety observations, not benchmarks.

## Result handoff and retained uncertainty

There is still one `host_effects` table. Tool `result-recorded` is now an admission barrier until public `Harness.getTask` reports the original `pi.tool`, version 1, matching task/call identity, terminal `completed` receipt. Only then does a short durable transition mark that same row `pi-committed`. The pinned built-in tool's settlement commits its result entry and terminal task together. This establishes Pi-side settlement evidence, not an atomic transaction spanning Pi and host writes.

The original operation remains encoded in the original effect ID with the original host invocation, task ID and call ID. Epoch, attempt, executor and effect deadline remain on that row. No recovery path invents another tool attempt or feeds stored results back into Pi. Provider retry correlation and full product result/Stop settlement still belong to 003.

Public `Storage.commit` fault injection wraps real `SqliteStorage` at DO composition. It does not patch scheduler internals:

- Safety result missing: selectively fail the safety write. Pi records a recoverable tool failure and attempts its next tool/model work; mandatory guards deny dispatch. The admitted row survives.
- Safety result durable, Pi result commit missing: reject the public atomic batch containing a completed tool receipt before native commit. The safety row is `result-recorded`; Pi retains `execute`. Scheduling, tool admission and actual later Pi requests remain denied across two reopens.
- Normal handoff: the first tool's Pi terminal receipt permits `pi-committed`; a separately failed next admission proves only one execution occurred.

The two-reopen defense tests keep ordinary host scheduling denied. Inside a narrowly isolated test-only probe, `Reflect.get` obtains this host's existing Harness and calls public Pi `resume`/`root.submit`, still behind its mandatory provider/tool guards. No public host bypass or second Harness was added. On the first live-shell reopen, Pi's actual unsafe `execute` recovery records the original interruption without rerunning that shell, then its second sequential tool and later provider request encounter the guards. On the second reopen, a synthetic probe input exercises actual built-in generation/provider admission. The original shell remains pending and counted throughout both reopens. Provider/executor dispatch counts on each reopened fixture are zero. The one original executor reservation, attempt and deadline remain unchanged. A late rejection afterward changes neither Pi tasks nor safety evidence.

This fixture does not claim an actual remote process was terminated or isolated. A retained admitted tool row is its conservative one-executor reservation. The local authority/capacity fixtures deny a changed executor or more than one live executor. They do not provision a second live executor or prove hosted capacity.

## Native timed-alarm diagnosis

The tight pinned reproduction is retained at `apps/runtime/node_modules/.plan-002-completion-probe/`. Green configuration is `config.ts` with `native.test.ts`; the red control is `red-config.ts` with `native-red.test.ts`. Both use the same real Worker/SQLite pool and preserve storage isolation.

The feedback loop reproduced the historical `.sqlite-shm` assertion. Initial fixed-delay and live-clock/fixed-delay probes passed. Repeated SQLite polling failed. Ranked hypotheses were overlapping polling/storage, an unjoined native alarm event, and an internal pool cleanup limitation after all lifecycle resources settle. Probes changed one variable at a time:

| Probe log | Exit | Finding |
|---|---:|---|
| `native-red.log` | 0 | Fixed clock and one finite sleep passed. This was not a reproduction. |
| `native-live-clock.log` | 0 | Changing only to live time still passed. |
| `native-poll.log` | 1 | Replacing sleep with SQLite polling reproduced `.sqlite-shm`. Lifecycle assertions reached bounded close. |
| `native-poll-joined.log` | 1 | Awaiting `instance.alarmCompletion` inside the first DO event did not repair cleanup. |
| `native-memory-poll.log` | 1 | Non-storage polling also failed. SQLite polling itself was not the cause. |
| `native-memory-instrumented.log` | 1 | Before releasing the event, handler count was 0 and native `getAlarm` was null. Awaiting an unset completion property had joined no handler. |
| `native-cross-event-join.log` | 0 | Release the first DO event, then deliver/join the retained alarm via public test API. |
| `native-sqlite-cross-event-join.log` | 0 | Restore original SQLite polling with cross-event joining; same combined lifecycle assertions pass. |
| `native-red-retained.log` | 1 | Retained unjoined cleanup control still reproduces the exact pool symptom. |
| `native-green-retained.log` | 0 | Retained joined counterpart passes. |
| `native-red-final.log` / `native-green-final.log` | 0 / 0 | Final concurrent isolated-process probes both passed. The unjoined control is timing-dependent, not always red. |
| `native-red-rate-{1..5}.log` | 1, 1, 0, 0, 1 | Serialized final-source control reproduced the exact cleanup error in 3 of 5 runs. |
| `native-green-rate-{1..5}.log` | 0 each | Serialized joined final-source counterpart passed all 5 runs. |

The permanent combined test keeps real wall-clock yield, native alarm storage and original SQLite polling. It awaits actual close, returns from the first `runInDurableObject` event, awaits public `runDurableObjectAlarm`, joins fixture alarm completion, asserts a handler ran and one invocation remains, then awaits alarm deletion and storage sync. General test cleanup also awaits tracked alarm completion and sync. No safety assertion or isolation setting was removed. Debug instrumentation is absent from source and retained probe files; its failed log remains.

This repairs the experiment's missing lifecycle join, not workerd or the pool's internal SQLite implementation. The unjoined control remains red-capable with a measured 3-of-5 final serialized reproduction rate, not a deterministic failure. The joined counterpart passed all five serialized repetitions. The green combined experiment uses the public test driver to deliver/reconcile the retained native alarm after event release; it is not proof of hosted automatic alarm timing. Split timer/alarm tests are not counted as this repair.

Current official [alarm documentation](https://developers.cloudflare.com/durable-objects/api/alarms/) and [test known issues](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/) were retrieved. They document one at-least-once alarm and joining storage/RPC resources. They do not explain the pool's internal `.sqlite-shm` assertion. Locked public test APIs and native behavior, not newer plugin examples, determined this fixture.

## DO composition and reopen

`PiDurableHostFixture.activate` lazily composes its own keyless provider, guarded tool, native storage/wakeup and local authority dependencies. A shared opening promise prevents two Harnesses on one owner. Activation itself stays passive. `alarm` no longer requires manual host attachment; it activates/reconciles before scheduling.

The local `retire` fixture awaits successful actual close and durable accounting before retaining matching local prior-owner evidence and clearing the in-memory handle. Tests drop alarm state, repair retained acceptance on activation, invoke the DO handler, reconstruct a fresh fixture instance over the same real SQLite after prior close, and reopen with retained uncertainty. Every recovery remains passive/fenced until checks permit scheduling. There is no browser-owned attachment guarantee or product routing.

Vitest supplies `PI_HOST_FIXTURE_CLOCK_OFFSET_MS = 60000` only for this DO-owned controlled-clock composition, preventing uncontrolled immediate deliveries during passive activation assertions. The joined combined experiment injects real `Date.now` and native wakeups instead. Reconstruction and local termination records are synthetic fixtures, not actual hosted eviction/identity evidence.

## Fault matrix and gate results

All permanent names and parameter cases appear in verbose `host-final.log` and `host-final-repeat.log`, 46 tests each. The following groups cover the complete revised local 002 requirements.

| Gate / faults | Result | Permanent observations |
|---|---|---|
| Approved spec application/preservation | passed | Exactly six replacements already present; no new amendment. Historical body/evidence and L0/legacy hashes retained. |
| Real request, stream, sequential tool cancellation | passed | Existing three cooperative built-in tests and three guarded reopen variants; underlying work pending, actual close bounded, no user abort, late resolve/reject observed. |
| Authority preparation read 1/read 2, provider/tool | passed | Four red-before/green-after regressions; pending preparation through actual close, durable rows differ correctly by read position; premature reopen denied. |
| Fresh post-persistence revocation/generation/capacity, plus tool executor change | passed | Seven real admission-path cases, no dispatch after mutable authority changes; original durable admission remains. |
| Result barrier unavailable/selectively failed | passed | Both continuing-unavailability variants deny later model/tool attempts and unavailable reopen without requiring a new failure marker. |
| Both safety/Pi tool-result crash orders | passed | Two public Pi/real SQLite cases, persistent barriers across two reopens; no atomicity claim. |
| Completed result receipt | passed | Original row becomes `pi-committed` only after original Pi tool terminal completion. |
| Live unsafe recovery and second restart | passed | Original interruption entry, attempted second sequential tool, real later provider requests behind guards; no new dispatch, original pending executor remains counted. |
| Before/after submit, after close, closure-account commit | passed | Four retained-intent crash cases; stable submission counts and denied takeover without trusted evidence. |
| Wrong/missing termination ID, stale generation, revoked authority, repeated account failure | passed | Matching trusted evidence and successful durable accounting required; duplicates retain IDs/deadlines and allocate no new budget during failures. |
| Real retry sleep / duplicate budgets | passed | Original Pi retry and first-interruption recovery deadlines retained; one fresh budget only after accounted prior close. |
| Host version, Pi task version, authority, executor generation/capacity | passed | Five adversarial cases plus incompatible Pi version 99; no extra invocation or executor dispatch. Last-read owner allocation and synchronous final submission denial have separate regressions. |
| Genuine close end overrun | passed negative safety tests | Both injected-clock overrun and an actual 250+100 ms wall-clock public Storage cleanup stall remain failed/fenced; close is never abandoned and no replacement opens while pending. The deliberately noncooperative cleanup is a fault fixture, not accepted integration code. |
| Automatic wall-clock yield | passed | Original injected-wakeup timer test and joined combined native-alarm test both assert actual close before persisted end deadline. |
| Dropped alarm, duplicate delivery, earliest retry/effect/projection/checkpoint reservation, failed handler | passed | Retained intent repairs; earlier alarm is not replaced by later work; failed safety read denies effects and reopening reconciles. Reservations do not implement projections/checkpoints. |
| DO-owned activation/reconstruction without attachment | passed | Passive opening, durable acceptance/wakeup repair, one owner, uncertainty retained and denied across reopens. Local-only identity evidence. |
| Historical noncooperative task | passed reproduction; historical host gate failed | Unchanged test deliberately proves inability to bound arbitrary noncooperative trusted JavaScript. Not acceptance evidence. |
| Unjoined combined native-alarm control | failed | Exact cleanup failure preserved and still red; joined combined acceptance test passed. |
| Advisor acceptance / complete L1 / 003 | not run | Separate review required; 003 remains BLOCKED. |

The preexisting manual-admit preparation test was retained, not substituted for the four real Pi regressions. No outer close timeout, user `abortTask`, conversation/submission abort, task-state reconstruction, second effect ledger or continuation engine implements yield. Scheduling-enabling compaction, reset, user abort and wait APIs remain unexposed by the host. Disabled compaction and deferred-provider paths are not claimed runtime passes. Future adapters must use the same guards and cancellation contract.

## Commands and logs

Logs below are relative to ignored `node_modules/.plan-002-completion/logs/`. Every verification used the preserved directory and this sanitized environment:

```sh
cd /tmp/ditto-plan-002-9KCuBv
env -i PATH="$PATH" NO_COLOR=1 \
  HOME="$PWD/node_modules/.plan-002-resume/home" <command>
```

| Command | Result | Log |
|---|---|---|
| `pnpm --filter @ditto/runtime typecheck` | passed, exit 0, both configurations | `types-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts --reporter=verbose` | passed, exit 0, 46 tests | `host-final.log` |
| Same targeted command repeated | passed, exit 0, 46 tests | `host-final-repeat.log` |
| `pnpm runtime:verify` | passed, exit 0, runtime types, 6 Node tests and 74 Worker tests in 5 files | `runtime-verify-final.log` |
| `pnpm verify` | passed, exit 0, Biome, web types, 808 web tests in 72 files, web build, runner types, 79 runner tests in 11 files and runner build | `verify-final.log` |
| `git diff --check` | passed, exit 0 after documentation | `diff-check.log` |
| Exact spec/body/hash preservation | passed | `preservation.log` |
| Contracts / retained brain | not run | Their inputs did not change. |

Retained probe commands use `pnpm --filter @ditto/runtime exec vitest run --config "$PWD/apps/runtime/node_modules/.plan-002-completion-probe/red-config.ts"` or `config.ts`. The red control reproduces a timing-dependent failure; its final five serialized exits were 1, 1, 0, 0, 1. The green counterpart exited 0 in all five corresponding repetitions, with one actual test per run. No zero-test pass is counted.

New intermediate failures are retained too. `types-incremental.log` and `handoff-first.log` caught an incorrect test-only `instanceof Harness` assumption; Harness is a public factory/interface, not a constructor. A checked test-only handle replaced that assumption. `handoff-second.log` caught a recovery probe expecting already-settled Pi tasks to make a fresh request automatically; the fixture now explicitly submits its guarded later probe. `host-matrix.log` retains an immediate-alarm activation race and cleanup failure; the controlled DO composition clock makes activation assertions deterministic while the separate combined experiment retains native wall-clock coverage. None of these failed runs is counted as a pass.

## Limits and handoff

No remaining reproduced blocker exists in the conforming local 002 slice. Advisor review and independent reruns are the remaining acceptance gate. The known unjoined pool failure is still reproducible and explicitly excluded from any claim that the framework was repaired.

Docker execution, hosted eviction/termination/isolation/capacity, real subscription/model networking, encryption, full coding-tool parity, complete user Stop/run/message settlement, product-worker or transport restart and browser checks are **not run**. Synthetic fixture success proves none of them. Partial PD07 covers runtime intent/alarm activation only; product restart remains later work.

003 must reuse this single effect table, finish full product-facing correlation and result/Stop/recovery policy, and independently review the conservative `result-recorded`/Pi-receipt handoff. Do not infer safe shell replay from a late promise, canceled wait, deadline, lease or new host budget. Do not integrate, commit or unblock 003 until the separate advisor accepts 002.

## Post-review follow-up: alarm reactivation on a surviving DO

The advisor identified this case after reading the full candidate and independently passing the earlier 74-Worker/6-Node runtime gate and 808-web/79-runner repository gate. The preceding completion record did **not** prove normal alarm recovery after graceful yield on the same surviving DO: its composition-reopen test manually retired the attached host. This section records the additional defect and its correction; earlier results, reviews, logs and native cleanup diagnosis are unchanged.

Status remains **READY FOR ADVISOR ACCEPTANCE, not DONE**. 003 remains BLOCKED. No completion acceptance is inferred from the advisor's earlier gate runs.

### Baseline and scope

All work remained in `/tmp/ditto-plan-002-9KCuBv`, HEAD `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed`. The session reported `PI_MODEL=gpt-6.1-sol` and `PI_REASONING_LEVEL=high`; no subagent was used. Versions and the effective March 10 compatibility fallback remain those recorded above.

Before any source edit, exact current originals were copied under ignored `node_modules/.plan-002-completion/baseline2/`, preserving these repository-relative paths:

| Candidate file | Pre-edit SHA-256 |
|---|---|
| `apps/runtime/src/pi-durable-host.ts` | `49fcac14dc41699dae1a66d7cd9f916f12feb4dd74a9ca7d58d45bd1343167b3` |
| `apps/runtime/src/pi-durable-host.test.ts` | `256593a70478469d133bf318c3bcf833da6f07a5b9f23801c7ef3de2718f0f8e` |
| `apps/runtime/vitest.config.ts` | `a6edaee66825710ec12e4b1f880eb83031f83783b61ab30c9f18cf3b802d51b9` |

The completion evidence itself was additionally copied to the same relative path under `baseline2` immediately before this append. No original was reconstructed. The config remained unchanged. Incremental changes are in `node_modules/.plan-002-completion/incremental-alarm-reactivation.patch` against these copies: host lifecycle/wakeup glue, seven additional tests, and this appended section. The prior baseline and incremental patch remain historical artifacts.

### Red and correction

The first three regressions were added before changing host behavior. They use real DO SQLite, actual public Pi generation/retry/tool paths, and cross-event native alarm delivery via `runDurableObjectAlarm`, followed by joining `alarmCompletion` and storage resources. Recovery never calls `retire`, constructs a replacement externally, clears the host pointer, or directly calls `schedule`/`resume`. Initial setup alone uses the public host to submit the synthetic input.

| Stage | Result | Retained log |
|---|---|---|
| Initial red | 3 failures; formatting the closed host in assertion diagnostics also invoked its `inspect`, producing `Session is closed` rejections | `red-alarm-reactivation.log` |
| Clean red after changing only assertions to compare boolean identity | 3 failures, 46 skipped; all alarms returned the same sealed/closed host; no unhandled errors or isolated-storage cleanup error | `red-clean-alarm-reactivation.log` |
| Closure-owned reactivation alone | unknown request/tool cases passed; retry case failed because scheduling became `running` before its retained deadline | `glue-only-alarm-reactivation.log` |
| Retry wakeup and clock alignment added | 3 passes, 46 skipped | `green-alarm-reactivation.log` |
| Additional draining/failure cases | 7 passes, 46 skipped | `targeted-alarm-reactivation.log` |

`activate` now coalesces the entire transition, including joining the attached host's actual close/accounting promise. A live host is reused. A successfully closed host is replaced through DO-owned composition and public passive `PiDurableHost.open`; a rejected closure propagates and cannot grant handoff. Concurrent activation callers receive the same replacement. There is no deadline-only takeover and no abandoned or raced actual close.

An early alarm can reopen passively without allocating work. If all live work consists of compatible, ready, non-aborted Pi v1 generation retry checkpoints with future deadlines, the adapter reserves the earliest public checkpoint deadline in existing `host_wakeups` as `pi-retry`. It does not edit the checkpoint or decide its continuation. Serviced reconciliation/retry wakeup intents are removed before the due attempt; Pi alone resumes its retained task through the existing authority/version/executor/effect guards. No new engine or ledger was added.

The fixture's public Harness clock now uses the same offset-aware function as its host budget clock. This avoids a synthetic 60-second mismatch in the controlled-clock experiment; without the fixture offset both use wall time. Retry delay is 1600 ms in the new test. The normal 1000 ms work / 1000 ms drain budgets, absolute deadlines, and uncertainty policy were not relaxed.

### New behavior proved

| Test | Assertions |
|---|---|
| `alarm-reactivates real Pi retry on the same surviving DO without retire` | Original automatic yield actually closes/accounts before its immutable end deadline. A retained early native alarm opens a new paused Harness, preserves the original Pi task ID and retry deadline, and keeps one budget. A due alarm allocates exactly one fresh guarded budget, resumes attempt 2 of that same Pi task, and records its admitted model effect against the new budget/deadline. Original/new provider counters are 1/1; tool counters are zero. Duplicate delivery creates neither another budget nor another provider call. No durable user abort mark appears. |
| `alarm-reconciles unknown request on the same surviving DO without retire` | Alarm-owned passive reopening across two graceful closures retains the pending remote request and exact effect rows; original provider count stays one, new providers/tools stay zero, budget count stays one. |
| `alarm-reconciles unknown tool on the same surviving DO without retire` | Same denial across two reopens for a live synthetic unsafe shell; original provider/tool counts stay 1/1, all new counters stay zero, original evidence and budget remain unchanged. |
| `joins concurrent alarm activation behind original actual close and accounting` | A controlled public Storage cleanup wait holds actual close. Two activation callers remain pending with no replacement while state is draining. After release and durable accounting, both receive one paused replacement; no fresh budget is allocated. |
| `denies alarm activation after original account closure failure` | Two activation retries propagate the rejected closure; no replacement or changed invocation facts. |
| `denies alarm activation after original after-close closure failure` | Same fail-closed behavior after actual close but before successful accounting. |
| `denies alarm activation after original overrun closure failure` | A genuine injected-clock end overrun remains failed/fenced and cannot open a replacement from its deadline. |

The failure cases test the activation transition used by the alarm handler directly; they do not claim a hosted platform alarm retry experiment. The existing independent trusted-termination/reconstruction gates are unchanged. Unknown effects are checked before retry inspection and still deny every new budget/model/tool admission.

### Final verification for this increment

All commands used the same sanitized environment recorded above. Logs are under ignored `node_modules/.plan-002-completion/logs/`.

| Command | Result | Log |
|---|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts -t 'same surviving DO\|alarm activation' --reporter=verbose` | 7 passed, 46 skipped, exit 0 | `targeted-alarm-reactivation.log` |
| `pnpm --filter @ditto/runtime typecheck` | both configurations passed, exit 0 | `types-latest-alarm-reactivation.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts --reporter=verbose` | 53 passed, exit 0 | `host-final-alarm-reactivation.log` |
| Same full host command repeated | 53 passed, exit 0 | `host-final-repeat-alarm-reactivation.log` |
| `pnpm runtime:verify` | types, 6 Node tests and 81 Worker tests in 5 files passed, exit 0 | `runtime-verify-final-alarm-reactivation.log` |
| `pnpm verify` | Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build passed, exit 0 | `verify-final-alarm-reactivation.log` |
| `git diff --check` and exact incremental preservation checks | passed | `preservation-alarm-reactivation.log` |
| Baseline2 `git diff --no-index --check` for all four files | no whitespace diagnostics; exit 1 means differing files, 0 means unchanged | `incremental-whitespace-alarm-reactivation.log` |

`verify-alarm-reactivation.log` retains an intermediate Biome failure for an assignment-in-expression in the new activation code. It was corrected without suppression before the final complete reruns. Earlier successful host/runtime reruns also remain in their distinct logs. No zero-test run is acceptance evidence.

The new tests retain cross-event native delivery/resource joins. The previous unjoined cleanup control, its measured 3-of-5 reproduction rate, and the joined five-pass counterpart are preserved, not rewritten or claimed repaired here. The full suites include the existing joined combined wall-clock/native-alarm experiment.

The advisor's concern was **reproduced and fixed**, not refuted. The new hunks require advisor acceptance. No deployment, real provider/executor, Docker, secret/credential read, package change, main-checkout edit, staging, commit, product routing, scheduler patch, or 003 change was performed. All previously recorded local-only limits still apply.
