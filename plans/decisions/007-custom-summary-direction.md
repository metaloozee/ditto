# 007 custom summary direction

Status: accepted by the maintainer, including the recommended one-attempt summary failure policy. READY for a separately dispatched, fixture-only custom-summary feasibility gate. This changes the contract; it does not pass the earlier failed gate or complete 007. The next executor applies the exact spec edits below in the isolated worktree before implementation.

Prepared against main HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. The uncommitted runtime correction is preserved in `/tmp/ditto-plan-007-3oi7vl`; its exact source identities and scope are recorded in [correction review](../evidence/007-preparation-correction-advisor-review.md). The [API review](../evidence/007-supported-summary-provenance-review.md) explains why default built-in compaction cannot yet meet the exact recovered-request association requirement. No source or authoritative spec was edited by the advisor for this decision. Earlier failures and the narrow correction remain preserved.

## Selected direction

Use Pi Durable 1.0.1's supported `beforeCompact` summary override for an internal runtime-owned summarizer. Do not make automatic compaction depend on the model choosing to call a new tool. No upstream issue, dependency upgrade, private prompt copy, task replacement or scheduler patch is proposed.

The public hook receives source messages, selected entry identities, first-kept position and HookApi task/conversation identity. Returning `{ summary }` lets Pi place the summary through its normal commit/submission behavior. The override replaces built-in summary request construction under the approved narrow amendment to decision 6/OD7 below. It does not claim to preserve the built-in summary preparation point, retry or usage accounting.

Pi remains the sole conversation/task continuation owner. The runtime owns preparation policy for this custom summary, exact effect admission and result evidence. No second transcript, independent summary queue or new scheduler is introduced. Generation preparation/retry behavior remains unchanged.

## Approved request and recovery contract

1. Define a versioned application-owned summary prompt and bounded response contract using the public selected source. Do not copy Pi's private summarizer strings or serialization. Reject oversized input/output rather than silently alter context. Preserve the original hook source/range provenance.
2. Through the runtime owner, resolve the current conversation model/thinking and supported summary options while preparing the request. Serialize configuration/preparation transitions without holding an orchestration lock across model I/O. Persist the exact prepared summary request, task/conversation identity, selected range/source digest and policy version through supported encrypted persistence before model admission. This durable request commit is the custom summary's preparation point. Later configuration changes do not change it. A new summary task prepares from current configuration.
3. On hook re-entry after reopen, load the original prepared request. Verify the current trusted hook selection and task identity against it. Do not recompute model selection or invent a binding from a sole producer. If the selected source no longer matches, halt safely instead of placing a summary against a different range.
4. Use mandatory runtime admission for the exact request. Recheck current authority, epoch, connection, entitlement, deadline, Stop and unresolved effects. Persisted preparation grants no admission authority. The eventual credential-bearing request remains product-side, as required by 007; initial feasibility remains synthetic.
5. Persist the validated result and summary usage in the existing effect evidence before the hook may return summary text to Pi. A durable completed result must be reusable if interruption occurs before a hook memo or Pi summary-placement commit. Do not call the provider again merely because Pi has not yet placed the summary. Unknown admitted outcomes retain the existing reconciliation/review block and never replay automatically.
6. Let Pi own summary placement and task settlement. Reconcile the custom effect against the actual supported placement receipt, preserving task/submission identities. Custom-summary usage must remain durably accounted without double charging or pretending Pi's skipped built-in usage commit recorded it.
7. A hook error must never fall through into unguarded default summarization. The registered mandatory adapter must deny a built-in summary callback that lacks the custom request association. Explicitly test this fallback path.

Hook memos can retain preparation/result references, but first-writer-wins memos are not a mutable retry scheduler or a substitute for effect admission and accounting. The executor must prove every new persistence handoff and use actual Worker/SQLite. Retained storage remains encrypted, and compatibility changes must reject or explicitly migrate older meanings.

## Accepted failure policy

Use **one provider attempt per custom summary task, with automatic provider retries disabled**. A known failed response stops the affected run visibly. The user may initiate a new explicit action under fresh admission. An uncertain dispatched outcome instead retains the existing persistent review/reconciliation block. Infrastructure interruption before admission may resume the same prepared request, and a recorded success may be reused without another dispatch.

This keeps the custom summary small and avoids adding application-owned durable retry waits/counters. It changes built-in summary retry behavior and must be stated in the approved amendment. The sole attempt is reserved atomically at admission and is not refunded after failure or uncertain dispatch. Loading a completed result consumes no additional attempt. An admitted request without definitive no-dispatch evidence cannot automatically redispatch after restart. This is admission accounting, not an exactly-once provider or billing claim. Future automatic summary retries would require a separately approved bounded policy and spending/recovery tests; they cannot be added as hidden provider retries.

## Gate and amendment requirements

Before dependent 007 adapters, test interruption before preparation, after preparation but before admission, after admission, after durable result but before hook return, and before/after Pi placement. Cover both plaintext disposable and retained encrypted fixtures. Assert captured request bodies/configuration, no repeated completed request, truthful uncertainty, selected-range mismatch denial, fresh authority after configuration changes, Stop and failed persistence. Automatic and manual compaction must use the same guarded override. No built-in fallback may bypass it.

The exact approved amendment below defines the custom preparation point, one-attempt policy, accounting owner and failure behavior. The next separate executor applies those spec edits in its isolated worktree, then implements and verifies the revised gate before transport work. The advisor does not edit `docs/` or source directly.

Relevant commands for the eventual execution are runtime typecheck, the nearest preparation/effects/host/storage tests, `pnpm runtime:verify`, and the repository checks required by 007. No tests ran to select this direction. Prior passing checks remain evidence for the narrow correction only. 007 is not DONE; PD38 remains not run. No live request, deployment, staging, commit, integration or worktree removal is authorized.

## Exact approved specification edits

Apply only these edits to `docs/specs/pi-durable-session-runtime.md` in the execution worktree. Match the old text exactly and stop on drift. Do not revise deployment ownership, credential policy, ordinary generation retries, unknown-effect handling or the prohibition on another engine. This is a summary-only policy exception.

### 1. Scope the default configuration rule to generation

Old:

```text
Use Pi Durable's default change behavior:
```

New:

```text
Use Pi Durable's default change behavior for generation requests. Custom summary requests use the explicit preparation contract below:
```

The existing configuration table and command-wide pin/scheduler prohibition remain unchanged.

### 2. Add the custom summary contract after the request-construction paragraph

Old:

```text
Validate actual request construction for selected models and supported thinking options. Cover normal turns, retries, follow-ups, compaction, cancellation, and Git metadata. A successful turn with another provider or a deterministic fixture does not prove the Codex subscription contract.
```

New:

```text
Validate actual request construction for selected models and supported thinking options. Cover normal turns, retries, follow-ups, compaction, cancellation, and Git metadata. A successful turn with another provider or a deterministic fixture does not prove the Codex subscription contract.

Use application-owned summarization through Pi's supported beforeCompact summary override. It is an internal runtime operation, not a tool that the model may choose to skip. Pi continues to own range selection, conversation/task continuation, summary placement and task settlement. Do not copy private summary prompts, replace built-in tasks, patch the scheduler, or introduce a second continuation engine.

The runtime owns a versioned, bounded summary prompt and request policy. Before admission, persist the exact request, model/thinking/options, originating task/conversation, selected range/source digest and policy version through supported encrypted persistence. Committing this request is the custom summary preparation point. A prepared request retains its configuration on reopen. A newly prepared request resolves current conversation configuration. Do not pin a whole command or add a model-switch scheduler.

On hook re-entry, validate trusted task and selection provenance against the retained request. Reuse an already-recorded successful result without another provider call, including interruption before hook return or Pi summary placement. A changed source/range, conflicting result or incompatible policy must not silently place a summary or authorize a fresh request.

Every custom summary request passes mandatory exact effect admission with current ownership, connection/model authority, epoch, deadline, Stop, storage and uncertainty checks. Preparation grants no authority. Reserve one provider attempt per summary task atomically at admission. Disable automatic provider retries for custom summaries. Failure does not refund that attempt. A known failed summary stops the affected run visibly; an uncertain admitted outcome keeps the persistent reconciliation/review block and never automatically redispatches. An explicit new user action uses fresh admission rather than reviving the failed summary task.

Persist the validated summary result and its usage in runtime effect evidence before allowing Pi to consume the summary. Custom-summary accounting belongs to the runtime because the override skips Pi's built-in summary usage commit. Count each admitted attempt once; result reuse must not add spending. Do not claim that Pi's usage total includes this work unless a supported, independently tested integration records it. Generation accounting and retry behavior remain unchanged.

Hook failure must not enable an unguarded built-in summary fallback. The mandatory provider adapter still denies any request without the exact trusted association. Custom hooks and model waits must cooperate with host cancellation. Prove recovery before preparation, before and after admission, after result persistence, and before and after Pi placement using actual local Worker/SQLite and encrypted retained fixtures. Completed results must survive without repeat dispatch; unresolved outcomes must block every later model and tool effect.
```

### 3. Update OD7's summary exception

Old:

```text
| OD7 | Model behavior | Remember subscription-backed model selection per workspace conversation. Offer supported thinking options and use Pi Durable's default change behavior. | Prepared requests retain configuration. The next request uses changes, even within a running instruction. Do not pin queued work at command admission. No automatic API-billing fallback. |
```

New:

```text
| OD7 | Model behavior | Remember subscription-backed model selection per workspace conversation. Offer supported thinking options. Use Pi Durable's default generation behavior and the approved one-attempt custom-summary preparation policy. | Prepared requests retain configuration. The next prepared request uses changes, even within a running instruction. Custom summaries persist exact request/result provenance through the supported override and fail visibly without automatic retries. Do not pin queued work at command admission. No automatic API-billing fallback. |
```

## Separate executor brief for the revised initial gate

This section is self-contained for the custom-summary prerequisite. The full remaining Codex request/configuration work is still plan 007, and must not start before independent review of this gate.

### Existing implementation and files in scope

Use the preserved detached worktree `/tmp/ditto-plan-007-3oi7vl`, base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Main-checkout dependencies and source remain out of scope. The existing uncommitted host-2 correction records callback-validated provenance before admission but cannot bind a first recovered built-in summary. Preserve its archive and all earlier evidence.

Primary files:

- `apps/runtime/src/pi-durable-host.ts`: owning guard, task/request correlation, encrypted provenance, effect admission/results, accounting and settlement.
- `apps/runtime/src/pi-durable-cooperative-fixture.ts`: trusted provider and existing compaction extension composition.
- `apps/runtime/src/pi-durable-model-preparation.gate.test.ts` and `pi-durable-effects.test.ts`: nearest actual Worker/SQLite behavior seam.
- Existing host/storage/history/encryption tests if their compaction fixture expectations legitimately change.
- One focused `apps/runtime/src/pi-durable-summary.ts` module and nearest summary test only if needed to keep the versioned prompt/request policy out of host lifecycle code. Do not introduce a generic summarizer framework.
- The exact spec edits above and new evidence under `plans/evidence/007-custom-summary-gate.md`.

Out of scope: credential DO, web UI, live account discovery/transport, shared command V1 reinterpretation, ordinary generation retry changes, a package upgrade, independent custom task scheduling, retained workspace enablement, and integration of source into the main checkout. New dependencies are unnecessary.

Current supported composition to replace:

```ts
hook(CompactionTask, {
	beforeCompact: async (selection, api, context) => {
		await guard.bindCompaction(api, {
			firstKept: Number(selection.firstKept),
			entries: selection.entries.map((entry) => Number(entry.id)),
			digest: await requestDigest(selection.messages),
		}, context);
		return undefined;
	},
})
```

Returning undefined invokes Pi's built-in summarize phase. Change the selected production-target/custom fixture composition to use the supported summary override, with the trusted HookApi identity carried into the owning runtime operation. Do not merely teach the old provider guard to infer ownership of an unbound built-in request. Retain separate explicitly named stock-Pi fixtures when they still test genuine upstream behavior.

### Ordered implementation steps

1. Apply the exact spec edits. Define the small versioned custom-summary request/result contract using public hook inputs and the selected configured model. Declare explicit byte/token/output bounds compatible with current runtime result/request bounds. Reject oversized source before dispatch, and reject malformed, empty or unsuccessful summary responses. Do not silently truncate source or accept tool-use output as a summary. Use tabs, double quotes and `unknown` narrowing, matching existing runtime code.
2. Add the trusted custom-summary hook operation. Keep its caller interface narrow: trusted hook source/identity/context in, summary decision out. The owning runtime resolves preparation, admission, result reuse and failure policy; the hook caller must not coordinate raw SQL or retries. Use supported task memos or supported encrypted storage to retain the request. Do not patch Pi checkpoints or manufacture Session-owned state. Verify prepared-request persistence before admitting the model, and repeat hook/task provenance validation on every recovery.
3. Preserve mandatory provider dispatch. The provider callback needs an explicit current-invocation association to the custom request established through the trusted hook. Its exact owning admission checks must validate the retained custom request while the Pi task remains in selection; do not pass it through the old built-in summarize checkpoint predicate as if it were equivalent. A hook that has not prepared/bound the exact request cannot dispatch. Omitted/throwing hooks and built-in fallback still deny through the adapter.
4. Extend the existing result/receipt correlation deliberately for this versioned custom request. `recordResult()` currently checks built-in `preparedTask(task)`, and `receipts()` currently handles built-in summarize/retry and Pi placement. Custom selection-phase requests need their own exact retained-request validation. Reuse the existing encrypted effect ledger, not a parallel ledger. Success must be usable after result persistence but before Pi placement without a second dispatch or false unresolved-result block. Reconcile against the actual task/submission/entry receipt before permitting later work. Account summary usage durably by original effect ID and never double count reuse.
5. A known failed response durably fails the affected run and settles its pending assistant projection intent. Do not recursively call a scheduling/abort operation from the hook. Use supported hook decline/return behavior only after the owning run failure is committed, while mandatory guards prevent later fallback/generation effects. Keep unresolved admitted outcomes separate from known failure. There is one attempt reservation per task, including across reopen; disable provider-library retries too. No retry queue or clock-resetting attempt recreation.
6. Add and run the crash/fault predicates below before any dependent adapters. Recheck encrypted private-field ownership, compatibility rejection, Stop and closure accounting. Update the host/request-policy compatibility marker rather than reinterpret host-2 custom-request meanings. If supported memo/storage/configuration/result handoffs cannot preserve these requirements, stop with the exact limitation instead of weakening them.

### Machine-checkable gate predicates

The nearest runtime tests must prove all of the following:

- Initial custom summary produces exactly one guarded synthetic dispatch and a real Pi compaction placement receipt. Both generation-owned automatic compaction and conversation-owned manual compaction use the override.
- Before preparation commits, close/open can prepare safely from current configuration. After the custom request commits, change configuration, close/open, and capture the original retained model/thinking/prompt/options. A newly prepared follow-up captures the changed configuration.
- Actual close joins the cooperative hook/provider wait before replacement scheduling. No abandoned invocation dispatches after yield.
- Interruption after preparation but before admission retains the exact request and admits no early effect. Reopen uses genuine HookApi provenance, not a sole-producer guess.
- Interruption after admission without a recorded result blocks further model/tool effects through two reopens. No second summary attempt is reserved or dispatched.
- Interruption after durable success but before result memo/hook return/Pi placement reuses the same result. Provider call count stays one and usage count stays one. Repeated wakeups and receipt delivery do not place conflicting summaries or duplicate attempts.
- Known provider error, aborted response, empty/malformed summary and a transport failure do not silently return successful compaction or retry. Known failures and unknown outcomes have distinct durable evidence. No failed attempt is refunded.
- Wrong task/conversation/range/source digest, stale epoch, Stop, authority revocation, failed request/result/usage persistence, encrypted tampering and unsupported policy version dispatch no later effect. Hook failure or absence does not dispatch a stock-Pi fallback.
- Retained encrypted reopen proves exact request/result reconstruction and every new persistence ordering. Existing completed tool recovery, unsafe shell blocking, history, retry accounting for generation and host lifetime remain covered.

Run sequentially with sanitized environment in the execution worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime typecheck

env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime exec vitest run \
  src/pi-durable-model-preparation.gate.test.ts src/pi-durable-effects.test.ts \
  src/pi-durable-host.test.ts src/pi-durable-storage.test.ts src/pi-durable-history.test.ts

env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm runtime:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm verify
git diff --check
```

New dedicated summary tests, if added, must also run and be discovered by the aggregate runtime gate. No zero-test filter counts. Prepare missing runner dependencies only in the worktree with frozen lockfiles and lifecycle scripts disabled if `verify` needs them. Preserve manifest/lockfile graphs. Record failed native-alarm experiments honestly; no timeout or safety assertion may be loosened to hide them.

Evidence must distinguish this amended gate from historical stock-Pi failures and the still-unimplemented remaining 007 work. Return READY FOR REVIEW or BLOCKED with exact changed files, constructed synthetic request captures, tests/commands/results, supported handoff evidence and limitations. Do not mark the full plan DONE. Independent review is required before the rest of 007. All deployment, live allowance, staging, commits, integration, shared-data mutation and worktree deletion remain unauthorized.
