# Plan 033: Add the Flue Run Bridge Durable Object

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report; do
> not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat df4631b..HEAD -- alchemy.run.ts src/server.ts src/lib/workspace-session-broker.ts src/lib/project-coordinator.ts src/lib/flue-event-projection.ts src/lib/flue-dispatch-adapter.ts src/lib/assistant-stream-draft.ts src/db/schema.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> git diff --stat -- alchemy.run.ts src/server.ts src/lib/workspace-session-broker.ts src/lib/project-coordinator.ts src/lib/flue-event-projection.ts src/lib/flue-dispatch-adapter.ts src/lib/assistant-stream-draft.ts src/db/schema.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the excerpts
> below against the live code before proceeding. If an excerpt no longer matches
> and the difference is not merely formatting, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/030-flue-event-projection-contract.md`, `plans/031-flue-dispatch-and-stream-adapter.md`
- **Category**: migration / architecture / tests
- **Planned at**: commit `df4631b`, 2026-07-03

## Why this matters

Phase 2 needs a server-owned bridge between product runs and Flue's Durable
Stream. The bridge must dispatch admitted work to the private Flue Worker,
consume stream events by offset, project them into D1 and browser socket frames,
and notify the project coordinator when a run reaches terminal state. This keeps
TanStack Start out of Flue internals while preserving the current UI's socket
contract.

## Current state

Relevant files:

- `alchemy.run.ts` - declares app-owned Durable Object namespaces and migrations.
- `src/server.ts` - exports app-owned Durable Object classes.
- `src/lib/workspace-session-broker.ts` - existing session-scoped WebSocket frame contract and D1 projection pattern.
- `src/lib/project-coordinator.ts` - project-scoped coordinator with `/admit`, `/terminal`, and `/status` endpoints.
- `src/lib/flue-event-projection.ts` - should exist from plan 030.
- `src/lib/flue-dispatch-adapter.ts` - should exist from plan 031.
- `src/lib/assistant-stream-draft.ts` - accumulates assistant deltas into one final assistant message.
- `src/db/schema.ts` - contains `agent_runs` and `agent_run_events` tables with Flue pointer columns.

The app currently exports only the Sandbox, coordinator, and legacy broker:

```ts
// src/server.ts:1-11
import handler from "@tanstack/react-start/server-entry";
import { ProjectCoordinator } from "#/lib/project-coordinator";
import { WorkspaceSessionBroker } from "#/lib/workspace-session-broker";

export { Sandbox } from "@cloudflare/sandbox";
export { ProjectCoordinator };
export { WorkspaceSessionBroker };

export default {
	fetch: handler.fetch,
};
```

Alchemy currently has app-owned DO namespaces through `ProjectCoordinator` only:

```ts
// alchemy.run.ts:26-37
const workspaceSessionBroker = DurableObjectNamespace(
	"workspace-session-broker",
	{ className: "WorkspaceSessionBroker", sqlite: true },
);

const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	sqlite: true,
});
```

The existing browser frame vocabulary is stable and should be reused:

```ts
// src/lib/workspace-session-broker.ts:80-86
export type WorkspaceSessionBrokerFrame =
	| { type: "snapshot"; state: BrokerState }
	| { type: "assistant_delta"; runId: string; text: string }
	| { type: "tool_progress"; runId: string; text: string }
	| { type: "needs_input"; runId: string; question: string; requestId: string }
	| { type: "done"; runId: string; status: "completed" | "failed" | "canceled" }
	| { type: "error"; message: string };
```

The project coordinator terminal endpoint already releases read-only runs and
owned mutation leases:

```ts
// src/lib/project-coordinator.ts:147-169
export function observeProjectRunTerminal(
	state: ProjectCoordinatorState,
	input: { projectId: string; runId: string; status: ProjectCoordinatorTerminalStatus },
	nowIso: string,
): ProjectCoordinatorState {
	return {
		...state,
		projectId: state.projectId ?? input.projectId,
		mutationLease:
			state.mutationLease?.runId === input.runId ? null : state.mutationLease,
		activeReadOnlyRuns: state.activeReadOnlyRuns.filter(
			(run) => run.runId !== input.runId,
		),
		lastTerminal: { runId: input.runId, status: input.status, observedAt: nowIso },
	};
}
```

The PRD allows WebSockets, Durable Streams, or long polling, but reconnect must
come from durable sources:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:573-582
### 15. UI streaming should reconnect from durable sources

The browser should not own run progress. On reconnect, the UI should reconstruct state from durable sources:
- D1 product metadata and projections for sessions/runs/status;
- Flue canonical stream or materialized Flue observation for agent messages;
- coordinator state snapshot for lock/queue/restore status;
- R2 artifact pointers for large logs/diffs.

Live streaming may use WebSockets, Durable Streams observation, long polling, or an equivalent documented mechanism.
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prerequisite tests | `pnpm test -- src/lib/flue-event-projection.test.ts src/lib/flue-dispatch-adapter.test.ts` | exits 0 |
| Focused bridge tests | `pnpm test -- src/lib/flue-run-bridge.test.ts` | exits 0; new tests pass |
| Full tests | `pnpm test` | exits 0 |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85` |
| Flue build | `pnpm flue:build` | exits 0 with only known generated-wrangler migration warning |
| Whitespace | `git diff --check` | exits 0 with no output |

Do not run live browser, Flue, Sandbox, or LLM smoke tests unless the operator
explicitly approves provider spend and credentials are available.

## Scope

**In scope**:

- `src/lib/flue-run-bridge.ts` (create)
- `src/lib/flue-run-bridge.test.ts` (create for pure helpers; see Step 7)
- `src/server.ts`
- `alchemy.run.ts`
- `plans/README.md` only to update this plan's status row if instructed

**Out of scope**:

- `src/integrations/trpc/routers/workspace.ts`; `startRun` wiring is plan 034.
- `src/routes/api.workspace.session.$sessionId.socket.ts`; socket proxy switch is plan 034.
- `.flue/agents/project-coder.ts`; read-only agent tools are plan 032.
- D1 schema/migrations.
- UI components or React hooks.
- Mutating tools, lease-fenced writes, diff generation, snapshots, restore, GitHub export actions.
- Deleting or replacing `WorkspaceSessionBroker`.

## Git workflow

- Branch: `advisor/033-flue-run-bridge` if you create a branch.
- Commit message style: Conventional Commits, e.g. `feat(flue): add run bridge durable object`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Verify prerequisites landed

Confirm these files exist:

- `src/lib/flue-event-projection.ts`
- `src/lib/flue-dispatch-adapter.ts`

Run:

```bash
pnpm test -- src/lib/flue-event-projection.test.ts src/lib/flue-dispatch-adapter.test.ts
```

Expected result: both prerequisite test files pass. If either file is absent,
STOP and execute plans 030/031 first.

### Step 2: Add Alchemy and Worker exports for the bridge DO

In `alchemy.run.ts`, declare a new app-owned Durable Object namespace near the
existing coordinator:

```ts
const flueRunBridge = DurableObjectNamespace("flue-run-bridge", {
	className: "FlueRunBridge",
	sqlite: true,
});
```

Bind it into the public `website` Worker as `FlueRunBridge`.

Add it to the `wrangler.transform` durable object bindings and add a new
migration tag after `v3`:

```ts
{ new_sqlite_classes: ["FlueRunBridge"], tag: "v4" }
```

Do not add it to the private `flueWorker`; this bridge is application-owned and
belongs to the public TanStack Worker side of the service-binding boundary.

In `src/server.ts`, import and export the class:

```ts
import { FlueRunBridge } from "#/lib/flue-run-bridge";
export { FlueRunBridge };
```

**Verify**: `pnpm exec tsc --noEmit --pretty false` will fail until the class
exists in Step 3; continue directly to Step 3.

### Step 3: Create the bridge Durable Object skeleton

Create `src/lib/flue-run-bridge.ts`. Follow `WorkspaceSessionBroker` style for
request parsing, stable errors, WebSocket auto-response, and broadcasting.

Import:

```ts
import { DurableObject } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "#/db";
import { agentRunEvents, agentRuns, projects } from "#/db/schema";
import { AssistantStreamDraft } from "#/lib/assistant-stream-draft";
import {
	createFlueDispatchAdapter,
	createServiceBindingDispatchFetch,
	createServiceBindingStreamFetch,
	PROJECT_CODER_AGENT_NAME,
} from "#/lib/flue-dispatch-adapter";
import { mapFlueEventToDittoEvents } from "#/lib/flue-event-projection";
import { createAgentRunEventPayload } from "#/lib/workspace-policy";
import type { WorkspaceSessionBrokerFrame } from "#/lib/workspace-session-broker";
```

Use a type-only import for `WorkspaceSessionBrokerFrame`.

Define bridge state:

```ts
type FlueRunBridgeState = {
	sessionId?: string;
	userId?: string;
	projectId?: string;
	sandboxId?: string;
	activeRunId?: string;
	flueAgentName?: string;
	flueAgentInstanceId?: string;
	streamOffset?: string;
	streamCursor?: string | null;
	streamClosed?: boolean;
	canceledRunIds?: string[];
};
```

State key: `flue-run-bridge-state`.

Use `idFromName(sessionId)` in later callers, matching the existing browser
socket route shape. Do not use this DO as the project lock authority; the project
coordinator remains project-scoped.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0 after the class is
minimally valid.

### Step 4: Implement HTTP endpoints and WebSocket accept

Implement `fetch(request)` with:

- WebSocket upgrade: accept and send a `snapshot` frame containing current bridge state.
- `POST /start`: parse a start request and call `this.start(input)`.
- `POST /abort`: parse `{ runId }` and call `this.abort(input)`.
- Other methods/path: stable 405/404.

Start request shape:

```ts
type StartRequest = {
	sessionId: string;
	userId: string;
	projectId: string;
	sandboxId: string;
	runId: string;
	message: string;
	modelSpecifier: string;
	isMutating: false;
};
```

Reject `/start` when `isMutating !== false`. Phase 2 bridge is read-only only.

Use the same WebSocket auto-response as the broker:

```ts
this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
```

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 5: Dispatch to Flue and persist stream coordinates

In `start(input)`:

1. Clear the assistant draft for the run.
2. Build the Flue agent instance id as `${projectId}:${sandboxId}`. This must match `.flue/agents/project-coder.ts` parsing.
3. Save bridge state with `activeRunId`, `projectId`, `sessionId`, `sandboxId`, `flueAgentName: PROJECT_CODER_AGENT_NAME`, and `flueAgentInstanceId`.
4. Create the adapter from `this.env.FLUE_WORKER` service binding using plan 031 factories.
5. Call `adapter.dispatch({ agentName, agentInstanceId, message })`.
6. Update `agent_runs` with `flueAgentName`, `flueAgentInstanceId`, `flueSubmissionId` only when receipt has a non-null submission id, and `flueStreamOffset` from the receipt.
7. Save `streamOffset` in bridge state.
8. Use `this.ctx.waitUntil(this.consumeFlueStream(input.runId))` so stream consumption continues after `/start` returns 202.
9. Return a 202 response from `/start`.

If dispatch fails, mark the run failed in D1, insert `error` and `done` events,
notify the project coordinator `/terminal` with status `failed`, broadcast a
`done` frame, and clear `activeRunId`.

Do not ask the project coordinator for admission in this plan. Plan 034 owns
admission before calling the bridge. The bridge owns terminal notification.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 6: Consume Flue stream batches by long polling

Implement `consumeFlueStream(runId: string)` using the adapter `poll(...)` method
from plan 031.

Loop behavior:

- Load bridge state each iteration.
- Stop if `activeRunId` is missing, does not match `runId`, or `canceledRunIds` includes `runId`.
- Stop if D1 says the run status is `canceled`; then clear state and broadcast `done/canceled`.
- Poll Flue with current `streamOffset` and `streamCursor`.
- Save `nextOffset`, `cursor`, and `closed` to bridge state after each response before processing the next poll.
- For each Flue event, call `mapFlueEventToDittoEvents(event)`.
- For `assistantDelta`, append to `AssistantStreamDraft` and broadcast `assistant_delta` frame.
- Insert projected durable events into `agent_run_events` with current `runId`, `projectId`, and `sessionId`.
- Broadcast projected `tool_progress` and `error` frames.
- If a projection returns `terminalStatus`, finish the run with that status and stop.
- If the stream is closed and no terminal was seen, finish as `completed`.

When finishing completed/failed:

- Consume the assistant draft. If non-empty, insert one durable `message` event with `{ role: "assistant", text }`.
- Insert one durable `done` event with `{ status }`.
- Update `agent_runs.status`, `finishedAt`, and `updatedAt`.
- Clear `projects.activeAgentRunId` only if it equals this run id. This is mostly a no-op for read-only runs but keeps the update safe.
- Notify `ProjectCoordinator /terminal` addressed by `idFromName(projectId)`.
- Broadcast `{ type: "done", runId, status }`.
- Clear bridge `activeRunId`, `streamCursor`, and `streamClosed`.

Do not write snapshots or sandbox backups in this plan; read-only runs should not
change workspace state.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 7: Implement abort and late-event gating

Implement `/abort`:

- If the active run matches, mark it canceled in bridge state by clearing `activeRunId` and adding the id to `canceledRunIds`.
- Notify `ProjectCoordinator /terminal` with status `canceled` when `projectId` is known.
- Broadcast `{ type: "done", runId, status: "canceled" }`.
- Do not try to cancel the Flue Worker submission in Phase 2 unless the installed API exposes a documented cancellation route. Late Flue events must be ignored by the state/D1 canceled check.

Before inserting or broadcasting any stream event, re-check D1 status for the run.
If the run is canceled, stop processing and do not resurrect it.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 8: Add focused tests around pure helpers

Create `src/lib/flue-run-bridge.test.ts` for pure helpers extracted from the DO
file. Do not require a live Durable Object runtime.

Extract and test helpers such as:

- `createFlueAgentInstanceId(projectId, sandboxId)` returns `projectId:sandboxId` and rejects missing ids.
- `applyFlueStreamCursor(state, pollResult)` updates `streamOffset`, `streamCursor`, and `streamClosed` without changing run identity.
- `shouldIgnoreFlueRunEvent(state, runId, canceledStatuses)` gates mismatched or canceled runs.
- `buildTerminalEvents({ assistantText, status })` returns assistant message first, then `done`, with `schemaVersion: 1` payloads.

If importing `src/lib/flue-run-bridge.ts` directly requires mocking
`cloudflare:workers`, follow the existing project-coordinator test pattern: keep
the helpers exported and pure, or move only the helpers to a small sibling module
`src/lib/flue-run-bridge-policy.ts`. Prefer exporting pure helpers from the same
file if Biome/TypeScript allow it.

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts` -> exits 0 and tests
pass.

### Step 9: Run the full baseline

Run:

```bash
pnpm flue:build
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm lint
git diff --check
```

Expected result: Flue build exits 0 with only the known generated-wrangler DO
migration warning; tests pass; typecheck exits 0; lint exits 0 with only the two
known warnings; whitespace check emits no output.

## Test plan

- New `src/lib/flue-run-bridge.test.ts` covers pure bridge helpers and terminal event construction.
- Existing plan 030/031 tests verify mapping and adapter behavior independently.
- No live Flue Worker, LLM, Cloudflare Sandbox, or browser test is required.
- Optional manual smoke after plan 034: submit a read-only run through the product API and confirm stream frames appear. Do not perform it here unless explicitly approved.

## Done criteria

All must hold:

- [ ] `FlueRunBridge` is declared in Alchemy with SQLite and migration tag `v4`.
- [ ] `FlueRunBridge` is exported from `src/server.ts`.
- [ ] `/start` accepts read-only runs only and dispatches to `FLUE_WORKER` through the plan 031 adapter.
- [ ] The bridge records `flueAgentName`, `flueAgentInstanceId`, and stream offset on the run.
- [ ] The bridge consumes Flue stream batches by long-polling and projects events through `mapFlueEventToDittoEvents`.
- [ ] Assistant deltas stream live and persist as one final assistant message at terminal state.
- [ ] Terminal states update D1, notify `ProjectCoordinator /terminal`, broadcast `done`, and do not resurrect canceled runs.
- [ ] `pnpm test -- src/lib/flue-run-bridge.test.ts` exits 0.
- [ ] `pnpm flue:build` exits 0 with only the known warning.
- [ ] `pnpm test`, `pnpm exec tsc --noEmit --pretty false`, `pnpm lint`, and `git diff --check` pass.
- [ ] No files outside the in-scope list are modified.

## STOP conditions

Stop and report back if:

- Plans 030 and 031 have not landed.
- Alchemy cannot add `FlueRunBridge` as an app-owned Durable Object without manual Cloudflare dashboard drift.
- The `FLUE_WORKER` binding type no longer exposes `fetch(request)` structurally.
- Flue long-poll stream responses do not match plan 031's adapter contract.
- Correct implementation requires changing D1 schema, UI components, or `workspace.startRun` in this plan.
- Correct implementation requires deleting or replacing `WorkspaceSessionBroker`.
- You find a documented Flue cancellation API and using it would require broad adapter changes; defer that to a later plan instead of improvising.
- A verification command fails twice after a reasonable fix attempt.
- You need to touch a file listed out of scope.

## Maintenance notes

- Plan 034 wires read-only `workspace.startRun` to this bridge and switches the socket route for Flue-backed sessions.
- This bridge is a projection/stream adapter, not the live lock authority. Keep admission in the coordinator path.
- Phase 3 will add mutating lease-fenced tools. Do not add write capability to this bridge or agent during Phase 2.
