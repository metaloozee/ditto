# 002 final advisor acceptance

Verdict: **accept 002 as DONE for the revised local feasibility scope.** The cooperative host gate passes in the preserved execution worktree. This is not full L1 acceptance: 003 must still implement and prove its Stop, settlement, correlation and recovery policy. No integration, commit or deployment is authorized by this review.

Reviewed detached `/tmp/ditto-plan-002-9KCuBv` at `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed`, with all implementation uncommitted. The separate completion executor used `openai/gpt-6.1-sol` with High reasoning. The advisor read the host implementation, provider/tool fixture, full test coverage and both incremental patches, configuration/entry changes, the exact spec amendment, completion evidence, retained fault logs, and relevant locked public Pi/Chord implementations. Source changes were made only by the executor. Advisor writes are limited to plans and review evidence.

Read [completion evidence](002-host-lifecycle-completion.md), including its appended same-DO alarm follow-up, with the [accepted cooperative-wait decision](../decisions/002-cooperative-host-yield.md). The [first resume evidence](002-host-lifecycle-resume.md), [reproduced authority blocker](002-advisor-resume-review.md), [historical noncooperative experiment](002-host-lifecycle.md), and [historical review](002-advisor-review.md) remain unchanged. Their failed observations are not relabeled as passes.

## Accepted behavior

- Public Pi input submission drives built-in request/stream, sequential unsafe tool and retry phases. Local provider/tool/authority waits end under invocation cancellation while underlying synthetic operations remain pending. Actual Harness close, not cancellation of its caller's waiter, finishes before the persisted end deadline. Host yield invokes no user-Stop/task-abort API.
- Host invocation identity, ownership generation, start and absolute deadlines are durable before scheduling. Defaults remain 1000 ms work and 1000 ms drain. Duplicate delivery retains the identity and deadlines. A new budget requires actual prior close and durable accounting, or trusted prior-host termination and guarded accounting for the separately tested crash path. Overruns and failed accounting stay fenced.
- One safety/effect table retains original operation, invocation, attempt, epoch, executor generation and deadline. Unresolved effects deny both model and tool admission across two passive reopens. A live unresolved executor remains counted; local cancellation, deadline expiry and late completion do not prove termination or authorize replay.
- Both safety-result/Pi-result-commit crash orders are tested against real DO SQLite using the public Storage interface. Tool `result-recorded` remains a barrier until the matching pinned Pi tool's public terminal completion receipt is present. The same row becomes `pi-committed`; no second ledger, replay engine or asserted cross-system atomic transaction is introduced. Pi's shipped settlement commits its result entry and terminal task together.
- Actual unsafe-tool recovery and subsequent built-in model requests encounter mandatory guards after interruption. The isolated defense probe accesses only the existing host Harness and public Pi APIs in tests. Ordinary host scheduling remains denied under uncertainty, and no public bypass or second Harness owner was added.
- Wakeup intent precedes acknowledgment. Native alarm repair, duplicate delivery, earliest retained deadlines and handler failure are covered. Passive history/context/watch reads admit no provider or executor effects.

The tests deliberately fault noncooperative task/Storage cleanup. They still show pending actual close and denied replacement, then release the fault for cleanup. Those passing negative tests do not claim arbitrary trusted JavaScript is forcibly bounded.

## Two review defects resolved

### Authority preparation

The earlier advisor independently reproduced unbounded actual close at both authority awaits in `admit`. The final host now applies public `awaitWithContext` to both promises, keeps pre/post cancellation and authority/fence checks, and observes late outcomes without dispatch. Four permanent compliance regressions cover both await positions on actual provider generation and tool execution. They assert close completion while authority remains pending, then resolve or reject the underlying operation afterward. The earlier failing-behavior reproduction and logs are preserved.

### Alarm reactivation on a surviving DO

The first completion still returned an attached sealed host from `activate`, so a later alarm could stall without an external `retire`. The advisor identified this in review and resumed the executor within the existing 002 scope. Three clean baseline regressions reproduced the defect before the correction.

The final DO composition serializes activation, joins the attached host's original close/accounting promise, and opens one passive replacement only after successful completion. Failed closure propagates without replacement. An early alarm with only future compatible Pi retry work reserves its retained checkpoint deadline without allocating a budget or modifying continuation. Due delivery resumes the same Pi task through guards under exactly one fresh invocation budget. No manual retirement, external reopen, direct recovery scheduling or browser is required.

Seven added cases cover real retry continuation, unknown request/tool denial across two reopens, concurrent activation while close is pending, and account/after-close/overrun failure. The advisor inspected the exact new hunks and independently passed them as part of both the final runtime gate and 53-test host suite. All 1916 preceding test lines remain unchanged.

## Native alarm cleanup disposition

The executor retained a red-capable pinned-pool control for the `.sqlite-shm` isolated-storage failure, measured at three failures in five serialized final-source runs. The joined counterpart passed all five executor runs. The correction joins native delivery after releasing the first DO test event, then awaits alarm completion, alarm deletion and storage sync. Test isolation and lifecycle assertions remain enabled.

The advisor read both retained probe/config pairs and the diagnostic logs. Three additional independent runs of the joined native probe passed, one real test per run. The final host suite also passed its combined wall-clock/native-alarm test independently twice, once within `runtime:verify` and once as the targeted suite.

Accept this as correction of the experiment's missing resource join, not a repair of workerd or a deterministic explanation of its internal SQLite assertion. The unjoined control remains a known failed experiment. Public test-driven native delivery proves the local policy and lifecycle; it does not prove hosted automatic alarm timing or eviction.

## Independent final checks

Commands ran only inside the preserved disposable worktree with `env -i`, executable PATH, `NO_COLOR=1`, and `HOME=$PWD/node_modules/.plan-002-resume/home`. Logs are under ignored `node_modules/.plan-002-completion-advisor/logs/`. Earlier independent checks on the pre-alarm-follow-up candidate are retained separately; the following results are against the final source.

| Check | Outcome | Evidence |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0 | `runtime-verify-final.log`; both runtime typechecks, 6 Node checks and 81 Worker tests in 5 files |
| `pnpm verify` | passed, exit 0 | `verify-final.log`; Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts --reporter=verbose` | passed, exit 0 | `host-final.log`; 53 tests, repeated independently after the full gates |
| Joined native probe, three serialized runs | passed, exit 0 each | `native-green-1.log`, `native-green-2.log`, `native-green-3.log`; one test per run |
| Spec/source/history preservation | passed | `preservation-final.log`; exact six approved spec replacements, unchanged L0/legacy code, historical records and test block, untouched 003, and insertion-only final test increment |
| `git diff --check` | passed | Rechecked after final advisor documentation updates |
| Contracts and retained brain checks | not run | Inputs unchanged |
| Revised local 002 gate | passed, accepted | This review and final executable results |
| Complete L1 / 003 | not run | 003 is not executed by this acceptance |

Locked Pi Durable, pi-ai and Chord remain 1.0.1. Pool 0.12.21 uses workerd 1.20260310.1 and falls back from requested compatibility date `2026-09-16` to `2026-03-10`. No pin, lockfile, deployment or image change was made. This review makes no September compatibility claim.

## Limits and next execution

The accepted code is plaintext, credential-free, disposable local feasibility glue. It is not production routing, full result/Stop policy, a complete recovery system, or coding-tool parity. Authority, executor identity, termination and capacity evidence are local fixtures, not hosted platform proof. The hard one-runtime/one-executor limit remains.

Docker execution, hosted eviction/termination/isolation/capacity, actual Codex authentication/model networking, product-worker or transport restart, encrypted retained state and browser verification are **not run**. Partial PD07 establishes runtime wakeup/recovery without a browser; later product restart work remains in 008/010. L1 still requires 003.

003's prerequisite is now accepted in this worktree. Before separately requested execution, refresh its conditional brief against this actual protocol. Reuse the single `host_effects` table and review the pinned terminal-receipt handoff while adding full logical correlation, epochs, result barriers, targeted Stop, settlement and persisted recovery deadlines. Future provider, hook, compaction, tool and callback paths must preserve the cancellation/admission contract. Disabled compaction and deferred-provider paths are not runtime passes.

003's file and implementation were not edited. Main-checkout source and its original planning changes remain untouched. All 002 work stays uncommitted in the existing detached worktree. Nothing was staged, committed, merged, pushed, deployed, published or cleaned up. Acceptance is not permission to integrate or remove the worktree.
