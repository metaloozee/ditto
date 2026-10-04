# 002 independent advisor review

Verdict: accept the failed-gate disposition and its scoped reproduction. Plan 002 is not DONE. Its bounded-host engineering gate failed, and 003 remains blocked. No host glue was implemented or approved.

Reviewed base `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed` and uncommitted changes in detached `/tmp/ditto-plan-002-9KCuBv`. The executor used `openai/gpt-6.1-sol` with Medium reasoning. The advisor read every changed file and checked the cited locked public declarations and shipped lifecycle implementation. Main checkout remains clean. Nothing was staged, committed, merged, pushed or deployed.

## Why the gate failed

Pi Durable 1.0.1's `dist/harness/harness.js:203–210` routes close through Session and joins task invocations before storage closes. `dist/harness/scheduler.js:111–114` joins their completion promises with `Promise.allSettled`, without a deadline. Its `549–557` close listener stops new scheduling and signals existing AbortControllers, but cannot force a non-cooperative phase to return. `dist/session/session.js:202–218` strips caller cancellation from mandatory cleanup and returns a context-bound wait. Chord 1.0.1's `dist/context/index.d.ts:19–23` explicitly distinguishes canceling that waiter from canceling the underlying promise.

The new `apps/runtime/src/pi-durable-host.test.ts` exercises the public APIs against actual local workerd and DO SQLite. A committed version-1 synthetic task remains unadmitted during passive inspection, history/context reads and watch acquisition. After resume, it deliberately ignores its aborted signal. The original close stays pending past a persisted 50 ms test budget; canceling a second close waiter rejects only that waiter. Releasing the controlled task then increments a late-action counter. Replacement Harness creation occurs only after the original close finishes. The recovered task is pending, scheduling remains paused, and no user-abort mark was recorded.

This establishes a supported-close limitation for a non-cooperative task. The late-action counter is a synthetic action, not a real remote shell effect. It does not prove a production admission adapter is bypassable, every cooperative adapter fails, or hosted eviction behavior. It is enough to stop this plan because the acceptance contract explicitly requires bounded end for non-cooperative work. A timer or canceled waiter cannot satisfy that requirement. No private scheduler calls or patches, second continuation engine, or timeout-race replacement appear in the diff.

## Independently rerun verification

| Check | Outcome | Evidence |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0 | `node_modules/002-advisor-runtime-verify.log`; both runtime typechecks, 6 Node checks, 29 Worker tests in 5 files |
| `pnpm verify` | passed, exit 0 | `node_modules/002-advisor-verify.log`; Biome check, web typecheck, 808 web tests, web build, runner typecheck, 79 runner tests and runner build |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts` | passed, exit 0 | `node_modules/002-advisor-host-test.log`; 1 reproduction test, independently rerun after the full runtime gate |
| `git diff --check` | passed, exit 0 | Execution-worktree tracked diff |
| Supported bounded lifecycle | failed | Passing reproduction confirms the blocker, not completed host behavior |
| Full model/tool/sleep/retry and alarm fault matrix | not run | Required stop at the unsupported-interface gate |
| Docker, live provider, hosted, browser, product-worker restart | not run | Not authorized or outside this failed-gate review |
| Retained brain verification | not run | No brain or shared inputs changed |

Commands ran only inside the disposable worktree with `env -i`, inherited executable PATH, `NO_COLOR=1` and a worktree-local HOME. Generated advisor npm/cache directories were preserved under ignored `node_modules/002-advisor-home-npm`, `002-advisor-home-cache` and `002-advisor-home`. No credentials entered the command environment. No credential files, live model calls or Cloudflare control-plane operations were used.

The existing Worker test configuration requests `2026-09-16`, but installed workerd falls back to `2026-03-10`. The logs state that limitation; this review makes no September-compatibility or hosted-lifecycle claim. Existing configuration and exact Pi Durable/pi-ai/Chord 1.0.1 pins are unchanged.

## Scope and next action

The only source addition is the public-API reproduction test. Remaining changes are the 002 plan, index, executor evidence and this advisor review. L0 fixture, legacy runtime, product code, manifests, lockfiles and deployment configuration are unchanged. All work remains uncommitted in the detached worktree; no integration or cleanup is authorized.

Resume only after a supported upstream bounded pump/yield and close/ownership contract is available, or the maintainer explicitly amends the host decision under OD2. Such a contract must preserve continuation without user cancellation and account for non-cooperative in-flight work before admitting a replacement owner. This review does not publish an issue, choose another host, or weaken the specification. PD08/PD09 fail this engineering gate; PD10 and the product-worker PD07 scenario remain not run. Narrow passive-read evidence does not complete PD27 or L1.
