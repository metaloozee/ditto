# 007 supported summary provenance review

Verdict: no reviewed solution found under the pinned supported APIs that also preserves the current specification. This is not a proof of impossibility. Keep 007 and dependent implementation blocked. The smallest recommended path is a supported upstream per-attempt summary-request hook, not another correction executor against the same APIs.

This review changed only this evidence file. It did not change the existing correction, historical evidence, dependencies or source; run tests; install an upgrade; contact a provider; inspect credentials; publish an issue; stage or commit. PD38 remains not run.

## Scope and sources

Execution worktree `/tmp/ditto-plan-007-3oi7vl`, detached base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. The existing uncommitted correction remains a candidate, not an integrated solution. The main-checkout advisor review and plan 007 were read as evidence.

Local citations below use these prefixes, all in the execution worktree:

- `D/` = `apps/runtime/node_modules/@earendil-works/pi-durable/`, version 1.0.1.
- `A/` = `apps/runtime/node_modules/@earendil-works/pi-ai/`, the installed pinned provider API used by the fixture.
- `H` = `apps/runtime/src/pi-durable-host.ts`.
- `E` = `apps/runtime/src/pi-durable-effects.test.ts`.

Reviewed the complete package export map, root exports, public task/Session/Storage declarations, Harness/extension/Registry/hook declarations, Models/provider declarations, compaction implementation, README and changelog. Scheduler and Session implementation were read to verify ordering, not to propose depending on their private methods. The authoritative project runtime spec was read, including decisions 1, 3.3–3.4, 6–10, 17, OD2/OD7 and PD08–PD19/PD36/PD42.

The current spec requires Pi continuation ownership, default prepared-request configuration, mandatory exact effect admission, fresh authority after asynchronous work and no private scheduler patch, maintained fork or second continuation engine. A public method that can execute JavaScript does not by itself authorize changing those semantics.

## What the pinned APIs actually expose

| API | Evidence | Consequence |
|---|---|---|
| Generation `beforeRequest` | `D/dist/harness/types.d.ts:518–525` | Explicitly runs before every attempt, including recovery. It supplies messages and HookApi identity. |
| Compaction `beforeCompact` | `D/dist/harness/types.d.ts:545–564` | Supplies selected source entries/messages, first-kept position, reason/instructions and HookApi identity. It can decline or return summary text. It does not expose the constructed summary request or prepared options. |
| HookApi | `D/dist/harness/types.d.ts:510–516` | Committed document reads, task/conversation identity and first-writer-wins task memos. No commit callback, per-phase model binding or summary-attempt hook. |
| TaskRuntime | `D/dist/types.d.ts:132–193` | A custom task can access identity, signal, Models, settings, agent, memos and gated commits. This is not an invocation notification for built-in tasks. |
| Registry/extensions | `D/dist/harness/types.d.ts:184–234`; `D/dist/harness/define.d.ts:15–20`; `D/dist/harness/registry.js:6–24` | Public wrappers target tools or prompt sections, not tasks or Models. Built-in tasks are installed independently and explicitly cannot be removed or replaced; an extension task named `pi.compaction` throws. |
| Harness composition | `D/dist/harness/types.d.ts:362–382` | Models and RegistryReader are injected globally. There is no per-task/per-attempt Models factory or invocation callback. |
| Models/provider composition | `A/dist/models.d.ts:42–51,65–119,130–205` | A provider or Models decorator can inspect exact model, transcript and options, but neither receives Pi task identity. `transformHeaders` receives headers only. Global Models injection does not supply missing task scope. |
| Storage | `D/dist/types.d.ts:780–855` | Receives atomic batches of full task records and reads keyed by identity/range. It does not receive the summary-provider transcript or authenticated task invocation identity with that transcript. |
| Commit observation | `D/dist/types.d.ts:757–761`; `D/dist/session/session.js:249–307` | Synchronous observation is after Storage settlement and adoption. Listeners cannot block or call Session APIs. It is not a pre-storage atomic hook. |

`D/dist/index.d.ts:1–32` exports CompactionTask and SummaryRequest but does not export a summary-request builder or a new summary hook. SummaryRequest means the prepared configuration/range/attempt checkpoint, not the two provider messages, per `D/dist/harness/compaction.d.ts:8–29`.

A structural custom RegistryReader could technically return altered task objects. That is not reviewed support for decorating built-in phases. It conflicts with the explicit built-in replacement invariant in `registry.js:6–24`. Wrapping `CompactionTask.definition.phases.summarize` to inject a scoped Models closure would need upstream support for that integration and compatibility review; exported definitions alone are not authorization to alter built-in execution. Do not use that type-level escape as the executor's next path.

## Ordering and signal evidence

Selection resolves agent/model/settings, calls `beforeCompact`, and then commits `summarize` with model, thinking, stream options, token limit, tail, first-kept and attempt in `D/dist/harness/compaction.js:57–99`. The summarize phase reconstructs its private provider messages later, calls `completeSimple`, records usage, and either places the summary, persists retry or fails in `:101–161`. Retry increments attempt but retains that prepared request in `:155–166`. Cache retention is forced to `none`, `deferred` is removed, and reasoning is omitted for `off` in `:119–127`.

This distinction matters. Storing the selected source-message digest as the digest of the summary-provider transcript is wrong. The latter contains different messages, prompt serialization and summary instructions. Its timestamps are also rebuilt per invocation. Preserve the existing semantic transcript digest rule, rather than claim byte-identical wall-clock timestamps across reopen.

The current host obtains genuine selection identity in `H:1125–1249` and associates it with the hook's AbortSignal. Its provider guard rejects an unbound first recovered summary in `H:1531–1547`. The narrow correction persists the validated tuple/digest before asynchronous preparation at `H:1626–1655`, then rechecks and admits at `H:1656–1697`.

Storage cannot reconstruct that live binding from a persisted record alone. Session passes `withoutAbortSignal(context)` to Storage.commit in `D/dist/session/session.js:274–277`. The scheduler creates a new AbortController on each invocation at `D/dist/harness/scheduler.js:709–727`; its runtime exposes that signal at `:960–964`. Task reservation/phase-step control does not supply Storage with an authenticated tuple of invocation signal, task identity and model request. Reusing the old signal after reopen is invalid.

Summary context reads are not a substitute. `D/dist/harness/context.js:9–28,65–77` exposes conversation/range reads, not the calling task identity. Several tasks can read the same range, and read-only host code can do so too. Matching a read signal or request against the only eligible task/range remains inference, not an owning binding.

`A/dist/models.js:445–474` normalizes the transcript, applies auth and delegates to the provider. Options retain the supplied signal, but the provider path gains no Pi identity. A Models decorator sees the original request earlier, yet has the same identity deficit on reopen.

The existing supported-boundary reproduction remains decisive, `E:861–944`:

- Before Pi persists summarize, reopen reruns selection and succeeds.
- After the real Storage batch, before publication/first provider callback, reopen retains summarize but has no tuple/digest association. It denies with `Missing first summary association` and dispatches no summary.

This review did not rerun those tests. Their independent results are in the unchanged main advisor evidence. Safe denial is not successful continuation.

## Candidate 1: supported per-attempt summary-request hook

Recommended, but requires an upstream API change or a separately reviewed release that actually supplies it. No such hook was found in 1.0.1 or the current public source inspected here.

The concrete required contract is a hook in built-in `pi.compaction` after it constructs the actual messages/options from the persisted SummaryRequest, before every Models call. It must run on initial summarize, reopened summarize and each retry. It must carry authenticated task and conversation identity, prepared configuration/range/attempt, exact request messages/options and the same invocation cancellation scope used by the ensuing Models call. The API must document that relationship, not merely expose two unrelated signals. An immutable observer is sufficient; a prompt replacement feature is unnecessary.

Pi continues to own selection, summarize/retry checkpoints, retry delays, usage commits, summary placement and task settlement. Ditto continues to own encrypted provenance and exact effect admission. The hook binds the current invocation to the existing task/mapping and request digest. The mandatory provider guard still performs durable association, asynchronous preparation, fresh authority and dispatch. Hook success alone grants no effect authority. Ordinary hook-error reporting must never allow an unbound provider dispatch; the mandatory adapter still denies it.

Both interruption orderings:

1. Before summarize persistence, selection reruns normally. No hook or provenance from the abandoned invocation authorizes new work.
2. After summarize persistence but before the first callback, reopened summarize reconstructs its request and runs the new hook. It supplies fresh authenticated identity before the first provider guard, closing the missing association without copying prompts. A crash before/after hook association storage also recovers because the hook reruns; failed storage keeps admission fenced.

Prepared model/thinking/options/token limit remain Pi's original checkpoint. Retry retains that configuration, increments Pi attempt and obtains a new effect attempt with fresh checks. Newly prepared generation observes changed configuration. No model-switch scheduler is added. This fits the current architectural spec in intent, but a dependency change needs separate authorization, compatible-set review and PD36 migration or an explicit retained-state block.

After the upstream contract is available, the narrow local changes are: register the new mandatory compaction binding hook in the existing trusted fixture/production composition; extend the existing binding record if required for request/configuration identity; validate HookApi identity against the actual persisted checkpoint; retain the existing preparation seal/flush and effect-admission path; extend compatibility handling and the nearest existing gate tests. Do not dispatch that executor now.

Required regression predicates before accepting that later integration:

- Change the after-storage boundary from safe-denial expectation to successful reopen of the same task/checkpoint. Both sides of actual SQLite close/open must pass, including encrypted storage.
- No summary effect exists before admission. No old invocation dispatches after yield. Close actually joins before replacement admission.
- Capture complete prepared tuple and semantic request digest inside guarded dispatch; recover original summary configuration after a selection change; newly prepared follow-up uses the changed configuration.
- Interrupt before hook, during association seal/transaction/flush, after association and during asynchronous preparation. Prove rollback or fail-closed behavior as well as successful permitted recovery.
- Recovered retry has authenticated task identity, retained configuration, correct Pi attempt and distinct effect attempt. Keep Pi usage/retry placement semantics.
- Wrong task/conversation/range/digest, absent hook, mixed producers, forged/different signal, Stop/stale epoch, revoked authority, unknown effects, expired deadlines and storage failure dispatch zero new requests.

## Candidate 2: Storage-owned atomic checkpoint association plus selection provenance

Reject as a complete solution under the reviewed contract. It can improve durable checkpoint metadata, but cannot authenticate the first recovered provider producer.

A conforming Storage implementation can atomically record host safety evidence with the Pi task batch using the existing shared local persistence owner, subject to rollback, encrypted bounds and fresh local fence validation. Selection provenance could be cross-checked against the exact task ID, ownership, range and prepared tuple in that batch. This preserves Pi configuration and avoids a commit-listener crash gap. It does not supply the exact provider transcript, which Pi creates only afterward, or the new invocation's signal-to-task identity.

Before the batch, selection replay is available. After the batch, the durable tuple/range survives but summarize bypasses beforeCompact. The first provider callback still has no independently authenticated task identity. Claiming that the only producer with matching options/range must own it weakens the guard. Matching context reads has the same flaw. Writing a digest during that callback without an authenticated identity simply persists the inference.

Reconstructing the summary transcript in Storage would copy private prompt/serialization behavior and alter ownership. Adding a post-adoption listener cannot make an earlier durable write atomic, and cannot replay invocation identity on reopen. A Storage implementation must not mutate Pi's supplied task checkpoint to force selection replay or manufacture memos outside Session ownership; doing so changes continuation meaning and leaves Session adoption inconsistent.

Fresh epoch/product authority checks and retry accounting remain mandatory, but do not repair missing request/task provenance. This candidate is compatible with the spec only as metadata hardening, not as completion of 007. No executor is justified for it now.

## Candidate 3: beforeCompact summary override with task memos

A supported customization, but not an already-approved preservation of default prepared-request behavior. It needs an explicit design/spec amendment if selected instead of candidate 1.

`beforeCompact` may construct an application-owned summary request using public source messages and HookApi identity, memoize its own preparation/result, and return `{ summary }`. This avoids private summary prompt copying if it deliberately defines a new prompt. Pi still selects the prefix and places the returned summary through its own task commit. A hook could use injected Models in 1.0.1; it need not access credentials or add an engine. Memos are first-writer-wins task values, `D/dist/types.d.ts:159–161,473–483`, not atomic effect-result/accounting transactions.

However, this runs before Pi creates SummaryRequest. The hook does not receive the agent/settings snapshot and computed maxTokens that the current select phase already resolved. Reading configuration again through a captured Harness/settings getter races changes during selection. Treating the first memo write as the new preparation point changes the default preparation meaning. The hook would skip Pi's built-in summarize/retry/usage path entirely, `D/dist/harness/compaction.js:87–99,128–166,343–376`. The public hook result carries summary text only, not usage or retry state. Direct model calls do not automatically add their spend to Pi. Hook throws are normally reported and selection proceeds to the default path, so mandatory denial remains necessary.

Both crash orderings change rather than repair the original boundary. Before Pi placement, selection/hook may rerun, but a memoized request/result must survive and reconcile any dispatched effect. Before preparation memo commit, re-resolution can select changed configuration. After an admitted model request but before result memo commit, memos alone cannot prove whether replay is allowed. After result memo but before placement, the hook can return that result again, provided it has durably validated the same selection. After Pi placement there is no summarize checkpoint to reopen. A first-writer-wins memo is not a retry counter or a fresh authority grant.

Recreating durable retry waits, attempts, usage and guarded result reconciliation in the hook would be substantial custom continuation policy. Adding a custom summarization task would need a separately approved ownership design, not merely the phrase 'Pi runs it'. A custom task is supported generally, but cannot replace automatic built-in compaction through the stock Registry. Before endorsing this path, amend decision 6/OD7 to define its preparation point and request semantics, state who owns retry/accounting, and prove it does not create competing continuation authority. It is larger and less compatible than candidate 1.

## Public upstream check and limits

Read-only public fetches inspected:

- `https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/harness/types.ts`
- `https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/src/harness/compaction.ts`
- `https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/docs/spec.md`
- `https://raw.githubusercontent.com/earendil-works/pi/main/packages/durable/CHANGELOG.md`
- `https://raw.githubusercontent.com/earendil-works/pi/main/packages/ai/src/models.ts`
- `https://registry.npmjs.org/@earendil-works/pi-durable/latest`
- `https://api.github.com/repos/earendil-works/pi/commits/main`

The registry reported latest 1.1.0. The changelog documents HookApi.models/ToolExecutionApi.models, scan-order and runtime.context signature changes, task timestamps, context caching, and other changes. The inspected CompactionHooks still has only beforeCompact. Its implementation still calls beforeCompact only in select and completeSimple in summarize without an exact task/request hook. Adding HookApi.models makes custom summary calls easier, not default summarize recovery provenance. Current Models still has no Pi task identity field.

The main-branch API lookup reported SHA `7933a0e2866a5b1c73c76aeb016de26bbc3b1357`. The source fetches used mutable main URLs, not a proven installed-release artifact or an atomic snapshot at that SHA. A follow-up direct immutable-source retrieval timed out, so this review does not claim release-artifact equivalence or immutable upstream line citations. The pinned local file:line evidence above is the basis for the candidate decisions. Public source review is corroboration, not authorization to install 1.1.0 or proof that every upstream branch/release lacks a solution.

A future upgrade proposal must separately inspect the exact released export/API/source contract, update the entire pinned compatible set, account for Storage scan-order/context API and provider session-ID changes, rerun encrypted conformance and actual Worker gates, and pass the earliest post-checkpoint/pre-callback interruption. Existing green safe-denial tests cannot stand in for that gate.

## Decision needed

Authorize pursuit/review of a supported upstream per-attempt summary-request identity hook, or explicitly choose a custom-summary specification amendment. No issue publication or dependency modification is authorized by this review. Do not send another source executor until that owning contract is identified and reviewed. Keep the existing narrow correction and all historical failed experiments unchanged.

## Advisor verification and released-package check

The advisor checked the actual pinned compaction implementation, public HookApi/CompactionHooks/TaskRuntime declarations, Registry replacement rules, Models/provider interfaces and Session/Storage ordering. These support the review's conclusions: selection identity is not a recovered-summary request binding; a provider decorator lacks task identity; post-adoption listeners cannot supply an atomic pre-storage association; returning custom summary text bypasses the built-in summarize/retry/usage path. The conclusion remains no reviewed solution found, not a proof of impossibility.

The advisor additionally fetched version-specific published 1.1.0 files without installing or changing dependencies:

- `https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/types.d.ts`
- `https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/compaction.js`

In those fetched artifacts, HookApi adds Models access but CompactionHooks still exposes only `beforeCompact`. The summarize phase constructs messages/options and calls Models directly without a per-attempt summary-request hook. Its new provider `sessionId` does not itself provide the missing task/request identity handoff. This removes the mutable-main limitation for these two specific inspected files, not for the full release graph. No package signature/integrity validation, compatible-set migration, installation, bundle, conformance or runtime test of 1.1.0 was performed. An upgrade is neither authorized nor established as a solution.

All three candidate source/test SHA-256 identities still match the independently reviewed correction. The research executor used `openai/gpt-6.1-sol` with medium reasoning and wrote only its evidence file. No source or dependency changed and no test was rerun for this API review. The 219 Worker/6 Node passing result belongs to the earlier correction review, not a new run. Only `plans/` documentation/evidence changed in the main checkout. No upstream issue, staging, commit, integration, deployment or live-provider operation occurred.

Advisor recommendation: pursue a supported per-attempt summary-request identity contract first. It preserves Pi's default prepared-request, retry and accounting ownership. Custom summary policy is a genuine alternative, but requires an explicit specification decision and broader implementation/testing. 007 remains BLOCKED until that decision and supported contract are established.
