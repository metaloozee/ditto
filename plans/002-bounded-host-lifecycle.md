# 002: Prove a bounded runtime host

Status: DONE for the independently accepted revised local feasibility scope. Reviewed base: `3d69820`; source integrated into `feat/pi-durable` at `0d9c73c`. Phase: L1, host gate. Depends on: passed 001. See [integration and archived artifacts](evidence/002-integration.md), [final advisor acceptance](evidence/002-advisor-final-review.md) and [completion evidence](evidence/002-host-lifecycle-completion.md), including the same-DO alarm follow-up. The final 53-test host suite, `pnpm runtime:verify`, `pnpm verify`, joined native-alarm probes and preservation checks passed independently. Earlier [resume evidence](evidence/002-host-lifecycle-resume.md) and [advisor review with reproduced blocker](evidence/002-advisor-resume-review.md) remain unchanged failed/incomplete records. Complete L1 still requires separately executed 003.

Read the accepted [host-yield decision](decisions/002-cooperative-host-yield.md) with `docs/specs/pi-durable-session-runtime.md`, decisions 3.2–3.6, 7–9, 17–18; PD08–PD10, PD27 and partial PD07; OD2, OD5–OD6. That decision amends the local-wait requirement. No other architecture decision changes.

The user authorized commits, fast-forward integration and cleanup of the detached execution worktree `/tmp/ditto-plan-002-9KCuBv`. Accepted source and the exact approved spec amendment are integrated; historical experiments and generated evidence are archived before removal. Do not resume the completed plan in that former worktree. The reviewed base `3d69820` includes accepted L0 at `89a34b4`. Main-checkout runtime dependencies are not assumed installed. Future execution must stamp its actual HEAD and dirty scope.

## Outcome and owner

One open Pi Harness per runtime DO must yield and reopen with durable continuation and no user cancellation. Ditto owns provider/execution adapters and their cancellation-aware local waits. A remote shell may ignore cancellation. Its local wait must still end without claiming that the process stopped, its effect failed before dispatch, or its replay is safe.

For graceful yield, a replacement Harness may open passively only after the prior Harness's actual close finishes. Abrupt restart instead needs trusted prior-host termination evidence and the guarded closure-accounting/reconciliation transition in step 2. A crash test does not pass the graceful-close bound. Neither path authorizes a replacement writer. Retained unresolved effects deny model/tool admission until reconciliation satisfies the existing effect policy. Unknown shell outcomes never replay automatically. Remote termination or isolation and capacity accounting remain separate requirements.

The previous reproduction proved that an arbitrary trusted task phase which ignores its signal prevents bounded close. It did not prove that guarded adapters cannot support bounded close. Preserve that reproduction and historical evidence. Do not weaken its assertions or label its result a passing host gate. The upstream issue draft is historical, not a required dependency.

## Current code and verified API facts

`apps/runtime/src/pi-durable-local.ts` opens public `SqliteStorage` through `fixtureDatabase`, installs deployment-owned synthetic tools/provider, and awaits `root.submit(...).wait(...)` followed by `harness.close(...)`. This is the L0 fixture, not a bounded host. Preserve its behavior.

`apps/runtime/src/pi-durable-host.test.ts` already exists in the execution worktree. Its test `passive reads admit nothing but close cannot bound a noncooperative invocation` demonstrates the limitation with real local workerd/SQLite. It releases the old invocation for cleanup and reopens only after actual close.

Locked Pi Durable/pi-ai/Chord versions are 1.0.1. These are package-relative shipped excerpts, inspected against that version:

```js
// pi-durable/dist/harness/generation.js, request phase
const options = { ...streamOptions, signal: runtime.signal,
  ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }) };
const message = await streamResponse(runtime, model, messages, options, attempt, context);

// pi-durable/dist/harness/tool.js, tool execution
result = await tool.execute(args, { ...api, env }, context);

// pi-durable/dist/harness/scheduler.js, join
await Promise.allSettled([...this.#invocations.values()].map((invocation) => invocation.done));
```

These facts identify integration points, not a completed adapter design. Verify public provider/tool declarations and actual request, stream, compaction, retry and tool phases before selecting registration details. Chord's public context waiter cancels a wait, not its underlying operation. Use that distinction at the admitted I/O seam, never around close to authorize replacement.

`apps/runtime/src/session-runtime.ts` still owns the legacy container scheduler. `feasibility.test.ts` expects it not to own an alarm. Leave that constraint and legacy implementation unchanged. The new candidate uses `apps/runtime/vitest.config.ts` and its SQLite DO fixture.

## Scope and boundaries

In scope: candidate host glue, mandatory synthetic provider/execution adapters, the smallest durable host admission/effect records needed for interruption safety, private clock/wakeup fixtures, runtime tests/config, evidence, and the exact approved spec edits listed in the decision.

Use only disposable synthetic storage with a hard one-runtime/one-executor limit. Do not dispatch real provider calls or use credentials. An isolated old executor remains counted; the limit does not permit provisioning a second live executor.

Out of scope: product routing/authentication, complete product run settlement, model entitlement, encrypted retained content, full remote coding-tool parity, deployment, legacy removal, data reset, staging and commit. Do not import the old custom continuation engine or add another effect ledger around a ledger introduced here. Plan 003 must extend the resulting safety records.

Follow TypeScript tabs/double quotes and `unknown` for external values. Match `pi-durable-compatibility.test.ts` for `runInDurableObject` and real SQLite assertions. Do not place model/tool I/O inside `blockConcurrencyWhile` or storage transactions. Infrastructure dependencies enter at fixture/DO composition; tools do not discover bindings.

## Steps and verification

### 0. Apply the approved documentation amendment

Read `plans/decisions/002-cooperative-host-yield.md`. Apply only its exact replacements to `docs/specs/pi-durable-session-runtime.md` in the execution worktree before implementation. This documentation application is part of resumed 002, not permission to change additional requirements. If a replacement no longer matches, stop and report drift. Do not reinterpret unchanged authority, unknown-effect or Stop requirements.

Preserve the earlier `plans/evidence/002-host-lifecycle.md` and `002-advisor-review.md`. Write new execution results to `plans/evidence/002-host-lifecycle-resume.md`, with a link to those records and the accepted decision. Earlier failures stay failures.

Check: `git diff --check`, expected no whitespace errors. Record HEAD, uncommitted source/docs scope, exact packages and effective compatibility date.

### 1. Prove cancellation through Pi's real model and tool paths first

Before implementing a broad host, add a minimal provider/tool fixture through supported public registration. Drive a real Pi input submission, its built-in generation task, and a sequential deployment-owned tool. Do not substitute a custom cooperative task for these paths.

For a model request, provider stream read and remote tool wait, keep the underlying fixture operation pending despite cancellation. Require the trusted adapter's local wait to reject or end under the invocation signal/context. All trusted preparation, hooks, stream consumption/cleanup and retry waits used by this slice must cooperate. Observe late resolve and late reject without unhandled rejection, new I/O or unguarded Pi publication.

Fence admission and retain dispatch evidence before requesting actual Harness close. Verify the cancellation-aware adapter lets Pi's real phase return and the original close finish. Do not call `abortTask`, `Conversation.abort`, submission abort, or another user-Stop API to implement host yield.

Check: `pnpm --filter @ditto/runtime typecheck` and `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts`, both exit 0. If the built-in phase or cleanup still cannot finish with conforming adapters and no private patch, record the revised gate as `failed` and stop. A passing waiter-timeout assertion is insufficient.

### 2. Specify and implement the smallest guarded host protocol

Record passive open/inspection, fresh fixture authority/fences/version checks, executor reconciliation, scheduling-enabling calls, persisted wakeup intent and actual-close ordering in the new evidence. Include submit, resume, compaction, conversation abort and scheduling-enabling waits/reset paths. No call may bypass guarded runtime transitions.

Use configurable local test budgets of 1,000 ms for scheduled work and 1,000 ms for cooperative drain. Before scheduling, commit a durable host invocation ID, host ownership generation, start time, yield deadline at start + 1,000 ms, and end deadline at start + 2,000 ms. Distinguish this ID from the Pi task, effect attempt and user-run epoch. Retries or duplicate wakeups for that invocation reuse its ID and absolute deadlines. They must not restart its clock.

After actual prior close, or trusted prior-host termination following a crash, a guarded transition may durably account for that ended invocation and create the next invocation ID with a fresh start time and budget. Reconcile authority, effects and executor ownership before permitting scheduling under the new ID. Opening passively does not itself grant a new scheduling budget. If closure accounting cannot commit, remain fenced. A restart must establish prior-owner termination through trusted host evidence before takeover; expired deadlines or leases alone are insufficient. A new host invocation never extends an existing effect deadline or the first-interruption recovery deadline. Local identity/termination fixtures do not prove hosted takeover.

The invocation ends only after actual close settles before its end deadline. A watchdog can detect failure but cannot turn pending close into success. These budgets are safety fixtures, not hosted limits or performance guarantees. Test duplicates before yield, during drain, and after a durably accounted close; exactly one guarded next-invocation transition may allocate a new budget.

Before any effect, commit its logical identity/attempt, epoch, executor generation where applicable, dispatch state and deadline. Host yield commits a no-new-admission fence, interruption/reconciliation intent and future wakeup before close signals cancellation. Recheck the fence after async preparation. If admission/evidence persistence fails, deny further effects immediately in the live instance, even if Pi catches the adapter error. Do not assume a failure marker can commit while storage is unavailable. Already-durable admission/effect evidence must deny unsafe recovery after restart when that marker is absent. If storage cannot be read, do not schedule. Test both a selectively failed result write and continuing storage unavailability. Stop the gate if either path permits another effect.

Use short local transitions around I/O. If Pi and safety writes cannot share a supported transaction, document the intent/evidence ordering and test both crash orders. Database sharing alone does not establish atomicity.

Check: the same targeted command exits 0. Assert passive startup, history/context reads and watches cause zero provider/executor admissions. Assert acknowledgments follow durable inbox/wakeup intent, not model execution.

### 3. Distinguish local yield from remote termination

Fault the host during a prepared model request, midstream response, live tool and sleeping/retrying task. Include a remote command that ignores cancellation while its trusted local wait cooperates.

Assert actual close completes within the persisted end deadline, the old Harness is no longer able to admit effects, no replacement Harness opens before that close, committed continuation remains recoverable, and host yield records no user-Stop or task-abort mark. Do not claim that preserving a task also authorizes replay of its admitted operation.

Keep a dispatched unresolved tool effect durably accounted for. Reopen passively twice. Let Pi attempt unsafe-tool recovery or a subsequent model request only behind guards; both provider and execution adapters must deny further effects while the effect is unresolved. A process deadline or canceled transport wait is not termination evidence. Keep live execution counted even if its local wait ended.

Deliver a late result against the original operation/epoch/generation. It must not publish through the closed Harness, overwrite current run state, or create a new attempt. Trusted reconciliation may record validated evidence idempotently. The admission fence clears only under an explicit reconciled policy decision, never merely because a promise completed. If the outcome remains unknown, preserve the review block and deny replay. No generic background continuation or chained remote retry is allowed.

Check: the same targeted command exits 0 with observed provider/executor call counts, original operation IDs, storage facts and actual-close ordering. Clearly label mocked executor identity/termination evidence as local-only. Killing workerd is a separate crash test, not proof of hosted eviction or remote termination.

### 4. Prove durable wakeup and failure recovery

Use one alarm policy for runnable work, retry deadlines, unresolved effects, and reserved future projection/checkpoint deadlines. Check existing alarm state before replacing it. Persist intent before acknowledgment and repair missed scheduling on activation/reconciliation.

Drop alarm scheduling after the intent commit, duplicate delivery, fail a handler, and reopen the runtime and any existing credential-free transport fixture. Retained intent must choose the earliest required deadline. Model/tool admission remains fenced while unresolved effects exist. Timer callbacks, a browser and `waitUntil` must not provide the only lifetime guarantee.

Check: the same targeted command exits 0, repeated with real DO SQLite. No product routing is needed for partial PD07; product-worker restart coverage remains in 008/010.

### 5. Record and verify the gate

Record exact APIs, versions, phase paths, numeric budgets, absolute deadlines, injected crash points, commands/test names and outcomes in `plans/evidence/002-host-lifecycle-resume.md`. Report `passed`, `failed`, `not run` per gate. State limitations separately for provider, Docker, hosted, product restart and browser checks.

Run `pnpm runtime:verify`, `pnpm verify`, and `git diff --check`, expected exit 0. Run `pnpm contracts:verify` if shared contracts changed; run retained brain checks only if its inputs changed. No zero-test filter counts as a pass.

## Acceptance, stop and handoff

002 passes only with actual bounded close through Pi's built-in paths and conforming adapters, passive activation, durable wakeups, preserved continuation and durable denial of unresolved effects across two reopens. A green historical non-cooperative custom-task reproduction is not this acceptance evidence. No test may equate timeout with process death.

Stop on non-cooperative trusted phase/cleanup in the chosen integration, unbounded actual close, lost effect accounting, failure to deny late admission, continuation recorded as user cancellation, unsafe replay, a private scheduler patch, maintained fork, second engine or endless alarm handler. Record a concrete limitation and seek review. Upstream support is needed only if the conforming integration still fails; the historical reproduction alone does not require an upstream change.

003's prerequisite is accepted and integrated into `feat/pi-durable`, but 003 has not started. Before separately requested execution, refresh its conditional brief against the accepted source and evidence. Its next executor must inspect and reuse the minimal admission/effect protocol from 002, then complete full Stop, failure settlement, result barriers, recovery deadlines and product-facing correlation. L1 is complete only after both plans pass. Future provider, tool, compaction and callback paths must use the same cancellation/admission contract.
