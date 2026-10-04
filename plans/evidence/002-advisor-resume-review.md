# 002 resumed implementation advisor review

Verdict: **BLOCKED. Do not accept 002 as complete or unblock 003.** The public built-in model/tool cancellation slice passes. The guarded host candidate has a reproduced bounded-close defect in trusted authority preparation, in addition to the executor's documented incomplete fault coverage. This is an integration defect, not evidence that Pi requires an upstream lifecycle change.

Reviewed detached worktree `/tmp/ditto-plan-002-9KCuBv`, HEAD `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed`, with uncommitted changes. Execution and the focused verification agent used `openai/gpt-6.1-sol` with High reasoning. The advisor inspected the complete candidate host, cooperative provider/tool fixture, 902-line host test, test configuration and entrypoint changes, approved spec diff, execution evidence, and relevant shipped Pi/Chord implementations. No source changes were made by the advisor.

Read this with [executor resume evidence](002-host-lifecycle-resume.md), the [accepted cooperative-wait decision](../decisions/002-cooperative-host-yield.md), and [plan 002](../002-bounded-host-lifecycle.md). The [historical execution](002-host-lifecycle.md) and [historical advisor review](002-advisor-review.md) remain unchanged. Neither passing observational reproduction is a passed host gate.

## Confirmed blocker: trusted preparation does not end under cancellation

`apps/runtime/src/pi-durable-host.ts:379–425` awaits `dependencies.authority()` twice in `admit`, at lines 380 and 413. Neither await uses the invocation's cancellation context. The subsequent signal/fence checks prevent dispatch after the wait returns, but cannot make the wait return. This code runs inside the synthetic provider's stream continuation, which Pi's actual built-in generation consumes and actual Harness close joins.

The existing asynchronous-preparation test at `apps/runtime/src/pi-durable-host.test.ts:607–637` directly calls `host.admit` outside the Pi invocation. It also releases preparation before awaiting close. That test establishes denied late admission, not bounded completion with pending preparation on the invocation path.

A separate ignored verification fixture drove real public input submission and built-in generation through `cooperativeFixture`. It held each authority read pending inside the provider's `guard.admit`, then observed the same `host.yield()` close promise. Wakeup was injected; native alarms were unset. No custom task, user-abort API, close replacement race or real external effect was used.

The advisor read both probe/config files and independently reran the reproduction:

| Preparation held pending | Work budget | Drain budget | Observed elapsed before release | Signal aborted | Actual close settled | Persisted effects |
|---|---:|---:|---:|---|---|---:|
| Initial authority read, line 380 | 250 ms | 100 ms | 401 ms | yes | no | 0 |
| Post-persistence authority read, line 413 | 250 ms | 100 ms | 401 ms | yes | no | 1 |

Both invocations remained `draining` after their persisted 350 ms end deadline. Provider attempts/calls were 1/0 and tool attempts/calls were 0/0. Once preparation was manually released for cleanup, actual close rejected with `Actual close exceeded end deadline`. New scheduling was denied. No unhandled rejection or new dispatch was reported.

The two observational tests exit 0 because they assert this failure. **Bounded close for pending authority preparation: failed.** Their small injected budgets are allowed by the configurable local test contract; this is not a performance benchmark. The same uncancelled waits can exceed the default budget if preparation stays pending longer.

Evidence lives in ignored paths within the preserved worktree:

- Probe and config: `apps/runtime/node_modules/.plan-002-review-probe/{probe.test.ts,config.ts}`.
- Verification agent log: `node_modules/.plan-002-advisor/logs/preparation-probe.log`.
- Independent advisor log: `node_modules/.plan-002-advisor/logs/preparation-probe-independent.log`.

Exact independent command, from the worktree root:

```sh
env -i PATH="$PATH" NO_COLOR=1 \
  HOME="$PWD/node_modules/.plan-002-resume/home" \
  pnpm --filter @ditto/runtime exec vitest run \
  --config "$PWD/apps/runtime/node_modules/.plan-002-review-probe/config.ts" \
  --reporter=verbose
```

This verifies preparation on the provider path. A separate pending-authority tool-path reproduction was not run. Both call the same host admission implementation, but that is not additional test evidence.

## Independent repository checks

All checks ran inside this disposable worktree with `env -i`, executable PATH, `NO_COLOR=1`, and the existing worktree-local sanitized HOME. Logs are in `node_modules/.plan-002-advisor/logs/`.

| Check | Outcome | Evidence |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0 | `runtime-verify.log`; runtime typechecks, 6 Node checks, 46 Worker tests in 5 files |
| `pnpm verify` | passed, exit 0 | `verify.log`; Biome, web typecheck, 808 web tests, web build, runner typecheck, 79 runner tests and runner build |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts` | passed, exit 0 | `host-test.log`; 18 scoped tests, independently repeated after the full gates |
| Preparation reproduction | passed reproduction, bounded-close requirement failed | `preparation-probe-independent.log`; 2 observations, actual close pending beyond deadline |
| `git diff --check` | passed | Checked before and after advisor plan/evidence updates |
| Approved spec replacements | passed | Independently rebuilt HEAD spec with all six exact decision replacements; resulting text equals the worktree spec |
| Contracts and retained brain checks | not run | Their inputs did not change |
| Complete 002 / L1 | failed host preparation case; incomplete remaining acceptance | 003 remains blocked |

Installed workerd still falls back from requested compatibility date `2026-09-16` to `2026-03-10`. The review proves no September compatibility or hosted behavior. Locked Pi Durable, pi-ai and Chord remain 1.0.1.

## Other acceptance gaps remain

The executor correctly recorded these instead of declaring the green scoped suite complete:

- The reverse safety-result/Pi-result-commit crash ordering has no dedicated passing test. Current safety and Pi writes are not claimed atomic.
- Version, authority, capacity and invocation-end fault coverage is incomplete. Pending preparation now provides one concrete failing end-deadline case.
- The two passive reopens deny scheduling and directly test provider/tool admission. They do not run Pi's unsafe-tool recovery behind the guards on both reopens. Preserve the stronger fail-closed scheduling denial; complete or explicitly review the required recovery-path evidence rather than weakening it.
- The combined wall-clock/native timed-alarm experiment failed Worker-pool isolated-storage cleanup. The advisor inspected the retained `.sqlite-shm` assertion logs, but did not rerun that removed experimental variant or establish its root cause. Separate passing native-alarm and injected-wakeup timer tests do not fix or prove the combined path.
- The fixture DO's alarm requires an attached host. It does not establish composition and reconciliation after genuine DO reactivation. The executor names this limit correctly.

Current official Cloudflare alarm documentation confirms one alarm per DO and at-least-once handler execution. Current Worker-test known-issues documentation recommends awaiting storage work and disposing RPC resources. Those general statements do not establish the root cause of this pinned pool's cleanup failure or authorize changing the toolchain.

## Next bounded execution

Keep the current candidate and all failed evidence. Do not require an upstream change on the strength of this integration defect.

1. Make both authority-preparation waits on `PiDurableHost.admit` end under the supplied invocation context. The public Chord `awaitWithContext` already distinguishes local cancellation from the underlying promise. Apply cancellation at this trusted preparation seam, keep the post-wait fence/signal/authority checks, and observe late resolve/reject. Do not abandon close or leave a trusted continuation able to dispatch.
2. Add permanent regressions through real built-in generation that keep each authority promise pending until actual close has completed within its deadline. Release underlying promises only for cleanup afterward. Preserve no-dispatch and retained-evidence assertions. Check the same contract for the tool path and all trusted preparation used by the slice.
3. Finish the plan's missing result/Pi-commit ordering and adversarial fault tests. Reuse the existing admission/evidence table; do not create another ledger or expand into full product Stop/settlement.
4. Diagnose the combined native timed-alarm experiment with a retained, red-capable local reproduction. Do not label split tests a repair. Establish the fixture's activation/reconciliation behavior and keep local identity/termination evidence separate from hosted claims.
5. Repeat the targeted host suite, `pnpm runtime:verify`, `pnpm verify`, and `git diff --check`, then request acceptance review. Stop again if actual close cannot finish with conforming preparation through public interfaces.

This list specifies the completion work; it does not mark it executed or waive the original plan's gates. No automatic integration is approved.

## Preservation and scope

The advisor independently checked unchanged HEAD content for L0 `pi-durable-local.ts`, legacy `session-runtime.ts`, and the legacy feasibility tests. Existing 003 planning changes and accepted decision text match the main checkout. Historical execution/review hashes match the executor's preservation record and the main checkout. The historical test body matches the original read.

All implementation stays in the existing detached worktree. Main-checkout source and planning changes are untouched. Advisor writes are limited to this review and status/link updates under the worktree's `plans/`. No staging, commit, reset, merge, push, deployment, issue publication, live database operation, credential read, live provider request or cleanup occurred.

Docker, hosted eviction and process termination/isolation, real Codex access, product-worker restart, encrypted retained content, full Stop/message settlement, and browser checks are **not run**. The partial passing slice is useful evidence, not completion of 002 or L1.
