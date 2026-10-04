# 002 supported host lifecycle gate

Refreshed base: `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed`. Execution is confined to the existing detached `/tmp/ditto-plan-002-9KCuBv`. L0 is accepted and integrated at `89a34b4`; it proved one synthetic turn, not bounded lifetime.

## Protocol review before host implementation

Inspected the exact frozen-lock public declarations and shipped implementation of Pi Durable, pi-ai and Chord 1.0.1. Citations below are package-relative to `apps/runtime/node_modules/@earendil-works/`.

A compliant host would need this sequence:

1. Open SQLite and `Harness.open` without enabling scheduling. Open reconciles surviving running tasks to pending and performs local reconciliation; passive does not mean no storage writes. Inspect live tasks/submissions, read history and acquire watches without model/tool admission.
2. Before any scheduling, obtain fresh authority, validate durable lifecycle/run fences and compatible task versions, and reconcile the exact executor incarnation. Do not replace an old owner merely because a deadline expired. Recheck guards at external-operation admission and conditionally record late evidence against its original epoch.
3. Persist inbox acceptance, owner identity, the finite invocation deadline and earliest wakeup intent before acknowledgment. For this local experiment the proposed invocation budget is **50 ms**, stored in synthetic SQLite. This is an engineering bound, not a latency target or hosted limit.
4. Only guarded transitions may enable scheduling. `Harness.resume`, `Conversation.submit`, `Conversation.compact`, `Conversation.abort`, `Submission.wait`, `Harness.waitForTask`, `Harness.waitForIdle`, and `Conversation.waitForIdle` enable it. `Conversation.reset` also does so indirectly through submit. Invocation-bound conversation handles inherit those paths. `abortTask` and submission abort mutate cancellation state and require privilege even though they do not independently call resume. Once enabled, commits and registry publications can kick more scheduling. There is no public pause or bounded pump.
5. At budget expiry seal admission, preserve continuation without user cancellation, and join or otherwise prove all old invocations unable to act before closing storage or admitting a replacement. A local timeout only cancels a caller wait. It is not process death.
6. On a later activation repeat passive reconciliation before resume. Retain one open owner until supported close actually completes. Reconcile durable wakeup intent with the platform alarm, selecting the earliest runnable/retry/effect/projection/checkpoint deadline. Check an existing alarm before changing it. Duplicate delivery and handler failure must not duplicate effects. At-least-once alarms with finite retries cannot substitute for persisted intent and reconciliation.

**Step 5 has no supported bounded implementation for non-cooperative work in 1.0.1. The engineering gate fails; no host implementation is authorized by this result.** The real-workerd/SQLite public-API reproduction verified this without racing a replacement. The [independent advisor review](002-advisor-review.md) confirmed the blocker and reran the verification gates.

## API evidence

- `pi-durable/dist/harness/types.d.ts:472–478` lists automatic scheduling calls; `harness/harness.js:34–36, 38–43, 63–70, 143–173` confirms them and the indirect reset path.
- `harness/scheduler.js:79–105` passively opens and reconciles; `107–117` enables scheduling and implements join as `Promise.allSettled` of all invocation completion promises.
- `harness/harness.js:203–210` closes through Session and joins tasks before storage close.
- `session/session.js:202–218` seals synchronously but strips caller cancellation from cleanup and returns a context-bound wait on the same close promise.
- `harness/scheduler.js:549–557` signals invocation AbortControllers on seal. It does not force non-cooperative handlers to finish.
- `pi-durable/dist/types.d.ts:132–185` exposes invocation signal, guarded commit and cooperative sleep, not a host interrupt/pump deadline.
- `chord/dist/context/index.d.ts:19–23` explicitly says cancelling a context rejects only its waiter, not the underlying promise.
- `pi-ai/dist/types.d.ts:57–58` gives provider requests an optional cooperative AbortSignal. `pi-ai/dist/utils/retry.d.ts:35–47` normalizes aborted retry backoff to an aborted assistant message; it is not a host-yield contract. Neither provides non-cooperative invocation termination.

Cloudflare references supplied by the advisor: https://developers.cloudflare.com/durable-objects/api/alarms/ and https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/. At-least-once finite alarm retries, alarm replacement, absent reliable shutdown hooks and potentially surviving in-flight I/O do not strengthen this contract. No compatibility dates or configuration are changed.

## Verification

All commands explicitly changed directory to the isolated worktree. Command environments used `env -i PATH="$PATH" HOME="$PWD" NO_COLOR=1`. No credential environment was inherited; no credential file, live model/Cloudflare API, Docker turn, deployment or product route was accessed. Frozen workspace dependencies were installed locally with `pnpm install --frozen-lockfile --ignore-scripts`; independent runner dependencies with `npm ci --prefix packages/sandbox-runner --ignore-scripts`. No shared dependency symlinks or manifest/lock edits. Generated HOME npm/cache directories were moved under ignored `node_modules/002-home-npm` and `node_modules/002-home-cache`; no pre-existing state was deleted.

| Gate | Outcome | Exact command/result |
|---|---|---|
| Supported bounded lifecycle | failed | Public close remains pending after the persisted 50 ms budget while the handler ignores its aborted signal. Cancelling another close waiter rejects only that waiter. |
| Runtime types | passed | `pnpm --filter @ditto/runtime typecheck`, exit 0, both configurations |
| Public-API reproduction | passed | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts`, exit 0, one test |
| Runtime regression gate | passed | `pnpm runtime:verify`, exit 0, 6 Node checks and 29 Worker tests in 5 files |
| Repository gate | passed | `pnpm verify`, final exit 0, Biome, web typecheck, 808 web tests, web build, runner typecheck, 79 runner tests and build |
| Diff whitespace | passed | `git diff --check`, exit 0 |
| Brain | not run | Retained brain/shared inputs unchanged |
| Model/tool/sleep/retry fault matrix, durable alarm fault/reconciliation host tests | not run | Stop at the supported-interface gate; no speculative host exists |
| Docker/live provider/hosted/browser/product restart | not run | Outside this execution or blocked; no hosted eviction claim |

Exact reproduction name: `passive reads admit nothing but close cannot bound a noncooperative invocation`. It creates a deployment-owned version-1 synthetic task using `defineTask`, persists its checkpoint and the finite budget in actual DO SQLite, and exercises only public `Harness`/task/storage APIs. Before resume, inspect/history/context/conversation-watch/task-graph-watch cause zero task admissions. The fixture installs no real provider or execution adapter and performs no external I/O; this does not claim the full PD27 provider/executor suite.

After `resume`, the task enters a controlled await which deliberately ignores cancellation. `close` aborts its invocation signal but does not settle. A second close with a context cancelled after 50 ms rejects. SQLite still has no `abortRequested` mark. Releasing the test gate then increments a synthetic late-action counter despite that signal being aborted. Only after the original close joins does the test reopen storage and a replacement Harness. The durable task becomes pending, stays un-cancelled and paused, and is not admitted again. This is a regression/reproduction, not a timeout-race replacement or a stored timer-as-process-death argument. Its controlled release is solely test cleanup; production non-cooperative work has no such guarantee.

Tests run the existing Worker-pool SQLite seam with workerd 1.20260310.1 and effective compatibility date `2026-03-10`; existing requested date/configuration are unchanged. Pi Durable/pi-ai/Chord remain exactly 1.0.1. The Worker test runner's added Node compatibility flags are existing test infrastructure, not a new candidate deployment. No private scheduler was patched or invoked.

The initial repository gate failed on formatting of the new test; the exact formatter changes were applied. The next attempt passed application checks but failed runner typecheck because the independent runner had no dependencies. After its frozen npm installation the final gate passed. Logs are local ignored `node_modules/002-typecheck.log`, `002-host-test.log`, `002-runtime-verify.log`, `002-verify.log`, `002-verify-final.log`, `002-runner-install.log`, and `002-verify-complete.log`. The last file contains the final passing run.

## Stop and required supported change

A supported upstream host-lifecycle contract is needed: a finite pump/yield deadline which seals new scheduling, preserves pending continuation without a user abort mark, and returns only with a trustworthy guarantee that the prior invocation cannot act. It must define handling of non-cooperative in-flight model/tool I/O and safe close/reopen ownership. Cooperative AbortSignals alone and cancellation of a join waiter are insufficient. An explicit alternative host decision requires maintainer review under OD2; this execution does not choose one, fork Pi, publish an issue or add a second engine.

PD08/PD09 remain failed at this engineering gate. PD10 and product-worker PD07 are not run. The narrow passive/read and clean post-join reopen observations do not complete their full acceptance matrix. L1, 002 and 003 remain blocked.

Source scope is only the new `apps/runtime/src/pi-durable-host.test.ts`; documentation scope is `plans/002-bounded-host-lifecycle.md`, `plans/README.md`, and this evidence file. L0 fixture, configuration, legacy runtime, locks and product source are unchanged. All changes remain uncommitted in the preserved worktree. No staging, commit, merge, push, reset or main-checkout write occurred.
