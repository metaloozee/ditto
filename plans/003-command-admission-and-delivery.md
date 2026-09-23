# 003: Admit durable commands and deliver them idempotently

Status: READY, NOT STARTED. Accepted 001/002 source landed on `brain` in merge `693a334`; see the [002 acceptance review](002-expanded-repair-review.md). A separately requested execution should start from the merged `brain` baseline in a new worktree and read current plans from `/home/ayan/ditto/plans`. Preserve unrelated work; the old execution worktree retains untracked evidence and is not a clean starting point. Use `gpt-6-sol` with medium reasoning for subagents. Paid topology remains NOT RUN and blocks real-user enablement. Original plan base: `c963890`, branch `brain`. Effort: L, 4-6 days. Risk: high.

## Target and prerequisites

Replace request-owned prompt admission for explicitly trusted test sessions with an authenticated command service returning durable receipts. Keep production/default sessions on the fenced legacy route until release. This phase does not launch Pi or claim coordinator acceptance from a mock as platform evidence.

Required inputs from 002: strict `@ditto/runtime-contracts` parsers, `session_commands`, `session_command_keys`, transactional session sequence counter, delivery fields on `workspace_runtime_work`, `runtimeOwner/runtimeOwnerVersion`, and permanent tombstones. A command references complete user and pending assistant IDs, not an embedded transcript. First-session idempotency is scoped to owner plus project; later commands to owner plus workspace session. An identical key/payload returns the original immutable IDs. A different canonical payload conflicts. All timestamps in the new protocol use epoch milliseconds; explicitly convert old second-based D1 queue fields at the compatibility adapter.

001 already defines `@ditto/runtime` test/typecheck and independent npm brain gates. 002 defines contracts build/test/typecheck. No real containers, model windows, Git windows, or project values are needed for admission.

## Rechecked current behavior

`apps/web/src/routes/api.agent.stream.ts:98-105` runs execution inside SSE startup:

```ts
try {
  await executeAgentRun({
    context: prepared.context,
    emit: ({ event, data }) => {
      deliver(event, data);
    },
  });
```

`apps/web/src/lib/agent-run-service.ts` already batches session, user, assistant and runtime-work inserts, but `prepareAgentRun` directly checks the product's model-key binding and allocates fresh IDs. `apps/web/src/lib/agent-control-service.ts:14-18` uses an executor-side control CLI and socket directory. Follow-ups there are accepted before D1 message rows exist; `packages/sandbox-runner/src/run-agent.ts:59` retains them in memory.

`apps/web/src/lib/workspace-runtime.ts:1154-1157` makes the dispatcher an execution owner:

```ts
await agent.executeAgentRun({
  context,
  emit: () => undefined,
});
```

For the trusted owner that becomes bounded delivery only.

Existing route test exemplar, `apps/web/src/routes/api.agent.stream.test.ts:104-112`:

```ts
async function postJson(body: unknown): Promise<Response> {
  return getPostHandler()({
    request: new Request("http://localhost/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}
```

Keep the captured production handler and existing injected-auth fixture pattern. Label `asUser` cases as mocked-auth ownership/admission tests, not proof of cookie authentication. Do not mock the command service or coordinator decisions; inject service transport and durable persistence underneath them. 012 adds a bounded real-auth public HTTP smoke using disposable sessions, without requiring real cookies for every fault-matrix case or redesigning auth.

## File scope

Existing adapters: `apps/web/src/routes/api.agent.stream.ts`, `api.agent.control.ts`, their tests; `apps/web/src/lib/agent-run-service.ts`, `agent-control-service.ts`, `workspace-runtime.ts`, `workspace-runtime-capacity.ts`; `apps/web/src/server.ts` scheduled path. Existing `apps/web/src/lib/agent-models.ts` fixes model and supported thinking levels.

New: `apps/web/src/lib/session-command.ts`, `session-command-delivery.ts`, `session-runtime-client.ts`; corresponding `session-command.test.ts` and `session-command-delivery.test.ts`; `apps/web/src/test/session-runtime-fixture.ts`. Use the existing two API route paths, dispatching an explicitly versioned JSON command for trusted owners. Add GET observation handling on `/api/agent/stream` in 004/010. Do not create an unrelated new UI layout or edit generated route tree by hand.

## Planned APIs and guarantees

`admitSessionCommand({db, runtime, authenticatedUserId, input, now, createId}) -> ReceiptV1` owns policy and D1 transaction. `runtime.modelConfiguration()` returns only `{configured: boolean, protocolVersion}`. Missing configuration and invalid `off|high|max` fail before prompt-side effects. An already accepted identical key returns its receipt even if the key configuration subsequently becomes unavailable, after current access/tombstone checks; it does not constitute new admission.

`deliverSessionCommands({db, runtime, clock, budget})` leases delivery intents and calls private `runtime.deliver({commandId, ownerVersion})`, fetching trusted persisted command data rather than trusting a queued transcript. The coordinator in 004 returns an idempotent acknowledgment with accepted position and receipt. A lost acknowledgment leaves the same command deliverable. Priority `runtime.control` receives Stop by exact target run and is not blocked by ordinary sequence gaps or capacity.

`SnapshotV1` observation starts in 004; the test fixture initially observes D1 receipts and recorded outbound deliveries. The fixture exposes only `asUser(...).command`, `receipt`, later `snapshot`/`events`, and execution-file observations. Test infrastructure can kill processes or fail transport/storage at defined boundaries. It must not expose `coordinator.setStateForTest` or make testing-only production RPC methods.

## Recovery command union and delivery owners

Define these exact discriminants in `packages/runtime-contracts/src/command.ts` here. For every variant: owned retained workspace is the target, idempotency scope is authenticated owner + workspace, and canonical kind plus full normalized payload determines conflict. Product generates command/run/message/authority IDs; callers supply only permitted references and explicit acknowledgments. Expected recovery position/generation is a compare precondition, not caller authority. Both admission and consumption revalidate current owner, state and evidence. Archived, migrating, deleted or unsupported targets reject without side effects. A failed-review state is distinct from `runtimeOwner=blocked` migration incompatibility, which these commands cannot override.

| Kind / handler phase | Required payload and allowed source | Messages, model and capacity | Result / admission reopening |
|---|---|---|---|
| `abandon_failed_run` / 006 | Exact failed run and expected recovery position; failed/review state | No new messages, model or capacity | Records abandonment and leaves failed assistants/history. Never marks a live shell stopped, releases its slot, clears unknown effects or reopens mutation by itself. |
| `retry_known_safe` / 006 | Exact failed run/position and safe retry reason; verified supported continuation with no unresolved effect and no-effect or reconciled known outcome | Fresh run ID linked to source, new pending assistant linked to retained original user instruction, no duplicate user message; configured model and all missing required pools before execution | Prior failed assistant remains failed. Reopens only after server proves safety, required stopped/isolation evidence and baseline; no completed tool repeats. |
| `acknowledge_uncertainty_and_start_new_action` / 006 | Exact failed run/position, exact unresolved operation IDs, explicit uncertainty acknowledgment, new text/thinking | NEW run with its own complete user/pending assistant pair; configured model, all missing required pools | Never replays the old command or marks its external effects resolved. Lifts only the acknowledged review barrier after writer stop/isolation and all start gates; old outcomes remain unknown. |
| `restore_checkpoint_acknowledging_loss` / 007 | Exact committed pair ID, expected current mutation generation/position, explicit acknowledgment of unbacked loss; failed/review or lost-executor state, no active safe run | No chat pair or model; execution capacity for replacement, no brain launch | Reject if old writer can reach replacement. Rotates identity/generation, creates a distinct recovery lineage and initial pair, preserves interrupted history/unknown external effects. Does not start a run; unresolved review remains until separately addressed. No silent different-pair fallback for this explicit choice. |
| `retry_backup` / 007, preview integration 008 | Exact workspace generation/position and pending checkpoint intent if any; pending/degraded backup at safe quiescent state | No chat pair/model; publication-only uses no container, capture reserves required execution capacity | Reuses valid captured bytes or takes a newly verified capture, never repeats tools or clears unknown-effect review. Leaves preview stopped. |
| `restart_preview` / 008 | Exact workspace generation and explicit restart request; stopped/failed preview on nonarchived workspace with safe committed recovery or usable live tree | No chat pair/model/brain; execution pool only | Revalidates preview/recovery gates, never clears unknown review or resumes agent work. Reject while unresolved writer/review prevents safe preview. |

003 tests parsing, rejected unavailable variants, idempotency and message-allocation policy at its fixture seam. It does not accept executable recovery work before the owning handler is wired and its tests pass; no generic recovery dispatcher default exists. 006/007/008 add admission and consumption atomically with their handler and extend the same command tests. Observations advertise only currently allowed implemented actions; the server still revalidates on submission and consumption. All failed preconditions retain the existing run, messages and capacity unchanged.

## Ordered work and tests

1. Drift-check `git rev-parse --short HEAD` and `git status --short`; preserve the dirty egress test. Build contracts before using its package export: `pnpm --filter @ditto/runtime-contracts build`. Create strict route/version discrimination. Old client requests for legacy owners retain current behavior; old requests targeting a trusted/migrating owner return an upgrade/recovery category and never launch the old runner.
2. Implement ownership/archive/deleting checks and configuration probe. Keep auth entrypoints unchanged. Admission rechecks owned project/session and owner fence inside the persistence decision, so deletion racing the initial read cannot accept new work. Add T01/T02 via the authenticated handler, asserting no command/message/session/delivery rows and no container/upstream calls on rejection. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts`.
3. Implement atomic key reservation, sequence allocation, message/session creation and outbox insert. Use a proven transactional D1 batch or equivalent single atomic statement design with bounded conflict retry. A first-session retry after a lost response must return the original session. Concurrent same-key submissions create one logical command; conflicting payloads create none beyond the first. Treat normalized text and thinking defaults consistently in canonical hashing. Add T03/T04 and failure after every statement. Same command key after deletion cannot recreate the target. Rerun the same narrow test.
4. Add durable follow-up, Stop and queue cancellation. Define the recovery union above, but reject its unimplemented executable variants until their owning phase enables both admission and handler. 005 adds UI Git variants and admission, 008 adds preview variants and admission, and 009 adds archive/continue/project-deletion variants and admission. Model configuration and message creation follow command kind: prompt/follow-up and new recovery actions that invoke Pi require configuration; model-free controls remain available during provider outage. Recovery message rules are in the table above. Follow-up gets its own message pair on acceptance, exact target run and FIFO sequence. Do not call `session.followUp` yet. Stop accepts durable intent even when runtime is unavailable; recorded != applied. Queue cancellation retains the instruction and failed assistant projection. Final cancellation decisions are coordinator-owned, not a product shortcut. Extend T01-T04 to controls.
5. Split trusted delivery from legacy work execution/expiry. Initial defaults: at most 25 deliveries or 20 seconds per pass, 5-second service call timeout, persisted bounded exponential backoff from 1 second to 60 seconds with jitter, and a minute cron retry. These are policy bounds, not platform guarantees. Immediate delivery is optional and never required for acceptance. Dispatcher lease expiry only redelivers trusted work. It must never call legacy `expireQueuedWork`, `reclaimExpiredWorkLeases`, `failWork`, or release observed execution capacity for a trusted command. Add T05 plus delivery-side T06/T07 cases: retain the same IDs after a lost acknowledgment, retry a missing predecessor, and deliver a persisted cancellation without mutating terminal execution state. Observe outbound calls and D1 receipts only. Coordinator dedupe, actual sequence consumption and advancement through cancellation are completed in 004, not proved by this delivery fixture. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-command-delivery.test.ts src/lib/workspace-runtime-capacity.test.ts`.
6. Keep the production scheduled entrypoint backward-compatible: legacy work goes to the old executor only after fence validation; trusted work goes to delivery only. `waitUntil` may finish a bounded delivery attempt, not a run. Verify route regressions and root gates:

```sh
pnpm --filter @ditto/web exec vitest run src/routes/api.agent.stream.test.ts src/routes/api.agent.control.test.ts src/lib/agent-run-service.test.ts
pnpm check
pnpm typecheck
pnpm --filter @ditto/runtime-contracts typecheck
```

All commands should exit 0 with named files selected and no skipped new tests. The documented `pnpm --filter @ditto/web test -- <file>` ran the full suite at the parent baseline; `exec vitest run` is deliberate.

## Handoff, done and maintenance

004 receives durable `CommandV1` deliveries, persisted ordinary sequence numbers, priority controls, immutable receipt/message IDs, owner fences and an authenticated test fixture. Runtime acknowledgment semantics are defined but only become real in 004. No test can call a receipt "running" just because D1 committed.

Machine-checkable done criteria: T01-T05 and explicitly labeled delivery-only T06/T07 cases pass through production admission/delivery code. Full T06/T07 acceptance remains BLOCKED until 004 proves coordinator dedupe and consumption order; SQL fixture assertions show one command/key/session/pair for concurrent retries, zero new rows on invalid admission, and no trusted terminal mutation from the dispatcher after lost handoff. Legacy regression files and step-6 gates pass. No model/git/action operation is opened during queueing.

STOP if D1 atomicity cannot be demonstrated, a product request must await prompt completion, sequence conflicts leave undeliverable gaps, ownership transfer permits both paths, or the model probe returns the key. Later command kinds must implement idempotency and coordinator serialization, not bypass this boundary. Retain dedupe for the workspace lifetime and apply versioned tombstones on deletion.
