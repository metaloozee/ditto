# 008 initial advisor review

Disposition: REJECTED for plan 008 acceptance. The partial candidate is preserved in `/home/ayan/ditto-execution/plan-008-4WXvNW` at base `2487d56`. No integration, staging or commit is authorized. Passing regression gates do not establish the required new safety/recovery guarantees.

## Review basis

The advisor read the current candidate admission/reconstruction/decision service, versioned contract parser, complete new Worker and runtime command suites, relevant route/admission diffs, control/start/cancellation/closure code and candidate direct-DO composition. Two independent read-only reviewers used `openai-codex/gpt-6.1-sol` with medium reasoning. One read the complete changed runtime paths and the other reviewed product authority/composition and legacy maintenance. Their findings were verified against the cited source by the advisor. No source edits were made by the advisor or reviewers.

The preserved candidate contains 36 intended implementation files, 29 tracked modifications and seven new files. A complete source archive and SHA-256 manifest were written before further corrections under `plans/evidence/artifacts/008/advisor-current/` in the execution worktree. Generated `.execution-008/` remains separate and intact.

## Confirmed rejection findings

| Finding | Evidence in execution worktree | Confirmation |
| --- | --- | --- |
| Concurrent identical Stop deliveries poison storage safety | `apps/runtime/src/pi-durable-host.ts:3945–3956,4028–4044`, `storeProduct:3859–3870` | Independent encrypted real-DO probe: one identical delivery fulfills, one rejects; one persistent safety block appears. Both should return the original receipt without a block. |
| Concurrent identical cancel deliveries poison storage safety | `pi-durable-host.ts:3996–4024` | Independent encrypted real-DO probe gives the same failure. Both requests pass the pre-lane duplicate read; the second queued control commit does not recheck its own retained outcome. |
| Start preparation crossing queue expiry becomes a storage failure | `pi-durable-host.ts:4261–4294`, especially `:4280–4281`; generic transition handling `:972–980` | Independent fake-clock probe crosses the deadline at the synchronous start commit. It throws `Candidate start deadline lost`, persists one safety block and leaves the assistant pending, instead of retaining an expired fate and failure projection. |
| Held candidate callbacks ignore owner cancellation and delay actual close | `pi-durable-host.ts:4141,4221–4225,4300–4304,4663–4677,5159–5160` | Independent real-DO probe holds expiry reconciliation, calls `yield`, and observes actual close still pending after 1200ms. Consumption discards the context supplied by `ownerTransition`; independent 30-second callback contexts are not aborted by `ownerAbort`. The probe then releases the callback and drains cleanup, so no held process remains. |
| Legacy capacity maintenance contacts candidate synthetic identity through legacy Sandbox namespace | `apps/web/src/lib/workspace-runtime.ts:1183–1204`, with ownership rejection only at `:1217` | Confirmed from source. The ready identity scan calls `getProjectSandboxState` before reading owner. Current scheduled composition test mocks the entire legacy drain, so it cannot detect this call. Container startup was not demonstrated and is not claimed. |
| Abrupt active-host recovery has no candidate termination/generation protocol | `pi-durable-host.ts:508–516`; `pi-durable-product-session.ts:134`; `session-command-candidate.ts:523–528` | Confirmed unavailable recovery from source. Candidate authority always returns generation 1 without `priorTerminated`, while accepted reopen correctly requires a newer generation and matching trusted termination witness for an unclosed invocation. Graceful `yield`/reopen tests do not prove abrupt process restart. Do not relax the takeover guard or infer termination from timeouts. |

The first four findings are independently reproduced by unchanged safety predicates. The latter two are source-confirmed gaps, not dynamic claims. Current close-probe coverage proves cancellation failure even before an active invocation is allocated; the active-invocation deadline extension is supported by the same source path but was not separately dynamically reproduced.

## Independent probes and verification

All commands ran inside the disposable worktree using `sh .execution-008/clean-run.sh`, with the existing isolated dependencies and temporary roots. No provider calls, dependency installation, test deadline change, external cleanup or main dependency mutation occurred.

| Check | Independent result |
| --- | --- |
| Exact `pnpm brain:verify` | failed, unchanged offline freshness fixture reports `ENOTCACHED`; contracts 49 and two freshness tests passed before failure; subsequent brain gates did not run |
| Exact `pnpm credentials:verify` on current bytes | passed once, credential typecheck, 196 Worker tests across three files and three Node checks; Worker duration 271.38s |
| Exact `pnpm runtime:verify` on current bytes | passed, both typechecks, 396 Worker tests across 13 files and six Node checks |
| Exact `pnpm verify` | interrupted by conversation/tool abort during credential execution; no final suite or command result, no surviving pnpm/Vitest/workerd process in subsequent check |
| New independent command safety probes | failed, four tests collected and all four expose the defects above; duration 3.05s |
| First advisor probe configuration attempt | failed before test collection, relative Worker entrypoint and overbroad Vitest alias were wrong; corrected only the advisor config and preserved both logs |
| Staging / tracked whitespace | empty staging; `git diff --check` passed |
| Full crash matrix / live / hosted / retained activation / UI / Docker | not established or not run; no acceptance claim |

Advisor probes/configs and logs live in execution-worktree `plans/evidence/artifacts/008/advisor-current/`. Run the probes with:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts
```

The probe config imports the existing runtime Worker configuration and changes only its test inclusion, exact Vitest alias and absolute Worker entrypoint. It does not increase test limits or alter product authority. Probes use synthetic encrypted real-DO storage and the existing guarded cooperative provider as a local runtime seam; they are not product-to-provider acceptance substitutes.

The credential pass does not erase the executor's earlier failed ordered-alarm and delayed-delivery aggregate tests. The latest source includes a small post-failure simplification; one independent passing invocation is useful evidence, not proof of timing stability. The repository verification interruption is neither a failure nor a pass. Brain cache preparation remains a tooling prerequisite, not a Pi feasibility failure.

## Correction boundaries

1. Carry owner cancellation context through candidate consumption, configuration and callback waits, preserving fresh post-await checks, actual close accounting and priority Stop outside the ordinary lane.
2. Revalidate exact control duplicates at their commit boundary. Cancel may recheck inside its lane; Stop must stay priority and must not wait behind the ordinary/configuration lane. Conflicting payloads still deny, and legitimate duplicate races must not create persistence-failure blocks or repeat epoch changes.
3. Treat losing the pre-start queue deadline as an ordinary expired outcome, not a generic transition exception. Retain one immutable fate and local failure projection without submission; repair lost acknowledgments idempotently.
4. Filter or check legacy ownership before any Sandbox RPC in maintenance. Add real scheduled-boundary coverage with legacy lower execution dependencies inert, not an all-drain mock.
5. Establish a separately trusted disposable-fixture prior-host termination/generation mechanism, or stop with the exact missing supported evidence. Never derive termination from lease expiry, elapsed time, browser fields or construction of a replacement host. This remains a plan requirement, not permission for unsafe takeover.
6. Complete the required real-D1/control crash matrix and queued configuration, cancel/start, delayed old Stop and candidate exact-halt cases. Existing predecessor tests and direct-host callbacks do not substitute for those integrations.

All original failures, source archive and advisor probes must be preserved. The advisor probe assertions must remain unchanged during correction. Root script registration is authorized, dependency declarations/lockfiles stay pinned, default composition remains unavailable, and the two previously approved extra file scopes remain narrow. Independent review and full final gates are still required before DONE.

## Considered and rejected

The separate deployment-owned candidate model policy, protected default credential factory and queue-TTL separation are not defects. Current model authority uses reconciled start evidence and retains finite effect/window deadlines; historical trusted policy keeps command expiry. Cold Stop does not create a root, late terminal delivery accounts original message membership, and early provider mapping has a dedicated guard. No confirmed custom-summary or final exact-claim regression was found in this initial review. These rejections do not excuse the concrete cancellation, duplicate-control, expiry and recovery defects above.
