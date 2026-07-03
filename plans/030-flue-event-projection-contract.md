# Plan 030: Add the Flue Event Projection Contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report; do
> not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat df4631b..HEAD -- src/lib/workspace-policy.ts src/lib/workspace-session-broker.ts src/lib/assistant-stream-draft.ts src/db/schema.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> git diff --stat -- src/lib/workspace-policy.ts src/lib/workspace-session-broker.ts src/lib/assistant-stream-draft.ts src/db/schema.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the excerpts
> below against the live code before proceeding. If an excerpt no longer matches
> and the difference is not merely formatting, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration / tests
- **Planned at**: commit `df4631b`, 2026-07-03

## Why this matters

Phase 2 of `docs/four-layer-flue-workflow-rewrite-prd.md` requires Flue assistant
output and tool activity to become product-visible projections without making D1
the canonical Flue transcript. The current app has a D1 event vocabulary and a
legacy Pi-runner mapper, but no pure seam for mapping Flue runtime events into
Ditto events and live socket frames. Add that seam first so the later bridge and
`startRun` wiring can be tested without a live LLM, live Flue Worker, or live
Sandbox.

## Current state

Relevant files:

- `docs/four-layer-flue-workflow-rewrite-prd.md` - source-of-truth PRD; Phase 2 is "Flue project agent foundation".
- `src/lib/workspace-policy.ts` - current Ditto run statuses and product event vocabulary.
- `src/lib/workspace-session-broker.ts` - legacy runner-to-product projection pattern to preserve at the UI boundary.
- `src/lib/assistant-stream-draft.ts` - existing helper for accumulating assistant deltas into one persisted assistant message at terminal state.
- `src/db/schema.ts` - D1 event table uses `AGENT_RUN_EVENT_TYPES` from `workspace-policy.ts`.

The PRD requires explicit event projection while keeping Flue canonical:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:551-571
### 14. Event projection must be explicit

The product UI needs a stable event vocabulary, but Flue remains canonical for agent conversation.

Recommended product event projection:
| Source activity | Product projection | Notes |
| Assistant text delta | `message.assistant.delta` | Stream to UI; compact or finalize projection in D1. |
| Tool started | `tool.started` | Include tool name, run ID, capability class. |
| Tool finished | `tool.finished` | Include success/failure and artifact refs. |
| Run completed/failed/canceled | `run.terminal` | Releases lock if owner. |
```

The current persisted event vocabulary is intentionally smaller and already used
by the UI:

```ts
// src/lib/workspace-policy.ts:12-23
export const AGENT_RUN_EVENT_TYPES = [
	"message",
	"tool_started",
	"tool_finished",
	"command_output",
	"file_changed",
	"diff_ready",
	"needs_input",
	"lock_rejected",
	"done",
	"error",
] as const;
```

The current socket frame shape is also smaller. Preserve it for Phase 2 so no UI
rewrite is required:

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

The legacy broker accumulates assistant deltas for live streaming and persists a
single assistant message only at terminal state:

```ts
// src/lib/workspace-session-broker.ts:456-460
case "assistant_delta":
	this.assistantDraft.append(runId, event.text);
	this.broadcast({ type: "assistant_delta", runId, text: event.text });
	return;

// src/lib/workspace-session-broker.ts:607-619
const assistantText = this.assistantDraft.consume(state.activeRunId);
...(assistantText
	? [{
			runId: state.activeRunId,
			projectId: state.projectId,
			sessionId: state.sessionId,
			type: "message" as const,
			payload: createAgentRunEventPayload({ role: "assistant", text: assistantText }),
		}]
	: []),
```

Installed Flue 1.0 beta event types were verified from
`node_modules/@flue/runtime/dist/types-DU_ZkvZJ.d.mts`. Relevant variants:

```ts
// node_modules/@flue/runtime/dist/types-DU_ZkvZJ.d.mts:862-884,936-958
{ type: 'text_delta'; text: string }
{ type: 'tool_start'; toolName: string; toolCallId: string; args?: any }
{ type: 'tool'; toolName: string; toolCallId: string; isError: boolean; result?: any; durationMs: number }
{ type: 'log'; level: 'info' | 'warn' | 'error'; message: string; attributes?: Record<string, unknown> }
{ type: 'idle' }
{ type: 'submission_settled'; submissionId: string; outcome: 'completed' | 'failed'; error?: string }
{ type: 'run_end'; runId: string; result?: unknown; isError: boolean; error?: unknown; durationMs: number }
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm test -- src/lib/flue-event-projection.test.ts` | exits 0; new tests pass |
| Full tests | `pnpm test` | exits 0; current baseline is 11 files / 86 tests before this plan |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85` |
| Whitespace | `git diff --check` | exits 0 with no output |

Do not run `pnpm format`, `pnpm fix`, `pnpm deploy`, or `pnpm destroy` unless
the operator explicitly asks.

## Scope

**In scope**:

- `src/lib/flue-event-projection.ts` (create)
- `src/lib/flue-event-projection.test.ts` (create)
- `plans/README.md` only to update this plan's status row if instructed

**Out of scope**:

- Changing `src/db/schema.ts` or `AGENT_RUN_EVENT_TYPES`.
- Changing UI components or socket hooks.
- Calling a live Flue Worker, LLM, Sandbox, D1 database, or Cloudflare runtime.
- Adding mutating tools, file writes, diffs, snapshots, or cancellation behavior.
- Rewriting or deleting `WorkspaceSessionBroker`.

## Git workflow

- Branch: `advisor/030-flue-event-projection` if you create a branch.
- Commit message style: Conventional Commits, e.g. `feat(flue): add event projection contract`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Create the projection module types

Create `src/lib/flue-event-projection.ts`. Import only types from existing Ditto
modules, plus `createAgentRunEventPayload` from `workspace-policy.ts` if the
module returns serialized D1 payloads. Do not import `@flue/runtime`; this must
stay structurally typed so tests do not depend on Flue internals.

Define a structural event input type that covers the Flue variants above and
allows unknown future fields:

```ts
export type FlueEventInput = {
	type: string;
	eventIndex?: number;
	timestamp?: string;
	dispatchId?: string;
	submissionId?: string;
	[key: string]: unknown;
};
```

Define a projection result shape that separates durable D1 events from live-only
frames and terminal status:

```ts
export type FlueProjectedEvent = {
	type: AgentRunEventType;
	payload: string;
};

export type FlueProjectedFrame =
	| { type: "assistant_delta"; text: string }
	| { type: "tool_progress"; text: string }
	| { type: "error"; message: string };

export type FlueEventProjection = {
	events: FlueProjectedEvent[];
	frames: FlueProjectedFrame[];
	assistantDelta: string | null;
	terminalStatus: "completed" | "failed" | null;
};
```

If exact names differ during implementation, keep the same semantics: durable
events are separate from live frames, assistant deltas are not persisted as
separate D1 messages, and terminal status is explicit.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0 or fails only
because the mapper implementation is not added yet. Do not move to Step 2 with
syntax errors unrelated to this new file.

### Step 2: Implement small, deterministic mapping helpers

Add helpers in the same file:

- `compactFlueText(value: unknown, maxLength = 2000): string | null` - returns a trimmed string or `null`; truncates with `\n...[truncated]`.
- `getToolStatus(event: FlueEventInput): "completed" | "failed"` - `failed` when `event.isError === true`, otherwise `completed`.
- `getFlueErrorMessage(event: FlueEventInput): string` - extracts `error`, `message`, or `result` safely without dumping large objects.

Do not add secret-pattern redaction in this plan unless a tiny reusable helper
already exists outside the superseded runner path. Redaction is important, but
this plan's job is to establish the event vocabulary seam. Cap all projected
text to 2000 characters to avoid large D1 payloads.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 3: Implement `mapFlueEventToDittoEvents`

Export this function:

```ts
export function mapFlueEventToDittoEvents(
	event: FlueEventInput,
): FlueEventProjection
```

Required mapping:

- `text_delta` with non-empty `text` returns no durable event, one live `assistant_delta` frame, and `assistantDelta` set to the text.
- `tool_start` returns one durable `tool_started` event with `toolName`, `toolCallId`, and capped `args` summary if present; it may also return a `tool_progress` frame such as `Started <toolName>.`.
- `tool` returns one durable `tool_finished` event with `toolName`, `toolCallId`, `status`, `durationMs`, and a capped `result` summary when present. If `isError === true`, also return one durable `error` event with a capped reason.
- `log` returns one durable `command_output` event with `level`, `message`, and capped `attributes` summary; for `level === "error"`, also return a live `error` frame.
- `operation` with `isError === true` returns one durable `error` event and `terminalStatus: "failed"` when `operationKind === "prompt"`.
- `submission_settled` returns `terminalStatus` from `outcome`; if failed, include one durable `error` event with the capped `error` message.
- `run_end` returns `terminalStatus: "failed"` when `isError === true`, otherwise `"completed"`; failed runs include one durable `error` event.
- Unknown or unsupported event types return an empty projection.

All durable event payloads must be serialized with `createAgentRunEventPayload(...)`
so `schemaVersion: 1` is present, matching existing event rows.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 4: Add focused unit tests

Create `src/lib/flue-event-projection.test.ts` using the existing Vitest style in
`src/lib/runner-protocol.test.ts`: small inputs, direct `expect(...)`, no network
or runtime mocks.

Cover at least these cases:

- `text_delta` produces a live assistant frame and no durable D1 event.
- `tool_start` produces `tool_started` with `schemaVersion: 1` in the JSON payload.
- successful `tool` produces `tool_finished` with `status: "completed"`.
- failed `tool` produces `tool_finished` and `error`.
- `log` produces `command_output` with capped output for a long message.
- `submission_settled` with `completed` returns terminal status `completed`.
- `submission_settled` with `failed` returns terminal status `failed` and an error event.
- unknown events project to no events, no frames, no terminal status.

For payload assertions, parse the returned `payload` string and assert on fields
instead of comparing raw JSON text.

**Verify**: `pnpm test -- src/lib/flue-event-projection.test.ts` -> exits 0 and
all new tests pass.

### Step 5: Run the full baseline

Run:

```bash
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm lint
git diff --check
```

Expected result: tests pass including the new projection tests, typecheck exits
0, lint exits 0 with only the two known warnings, and whitespace check emits no
output.

## Test plan

- New unit tests in `src/lib/flue-event-projection.test.ts` cover every mapping listed in Step 4.
- No live Flue, Cloudflare, D1, Sandbox, or LLM integration tests are required in this plan.
- Full regression check: `pnpm test`, `pnpm exec tsc --noEmit --pretty false`, `pnpm lint`, and `git diff --check`.

## Done criteria

All must hold:

- [ ] `src/lib/flue-event-projection.ts` exists and exports `mapFlueEventToDittoEvents` plus structural types.
- [ ] Assistant `text_delta` events are live-only and are not persisted as separate D1 assistant messages.
- [ ] Tool start/finish, logs, errors, and terminal outcomes map to existing `AGENT_RUN_EVENT_TYPES`; no schema migration is added.
- [ ] All projected durable event payloads include `schemaVersion: 1`.
- [ ] `pnpm test -- src/lib/flue-event-projection.test.ts` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with only the known warnings in `grainient.tsx:297` and `sidebar.tsx:85`.
- [ ] `git diff --check` exits 0.
- [ ] No source files outside the in-scope list are modified.

## STOP conditions

Stop and report back if:

- The code at the cited current-state locations does not match the excerpts.
- Implementing the mapper appears to require a D1 schema change or UI event vocabulary rewrite.
- You need to import live Flue runtime types to make the tests pass.
- You discover Flue beta.1 event names differ from the installed type excerpt above.
- A verification command fails twice after a reasonable fix attempt.
- You need to touch a file listed out of scope.

## Maintenance notes

- Plan 033 will use this mapper inside the `FlueRunBridge` Durable Object. Keep the API boring and pure so bridge tests can fake Flue events.
- The bridge should still own assistant-delta accumulation via `AssistantStreamDraft`; this mapper intentionally does not build final assistant messages.
- If a future Flue version changes event names, update this mapper and its tests before touching bridge or UI code.
