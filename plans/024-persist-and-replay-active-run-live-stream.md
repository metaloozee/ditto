# Plan 024: Persist and replay active-run live stream state

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat bb00b96..HEAD -- src/lib/workspace-session-broker.ts src/hooks/use-workspace-session-socket.ts src/components/ai-chat.tsx src/lib/assistant-stream-draft.ts src/lib/assistant-stream-draft.test.ts src/lib/workspace-policy.ts docs/pi-sdk-session-broker-prd.md
> git diff --stat -- src/lib/workspace-session-broker.ts src/hooks/use-workspace-session-socket.ts src/components/ai-chat.tsx src/lib/assistant-stream-draft.ts src/lib/assistant-stream-draft.test.ts src/lib/workspace-policy.ts docs/pi-sdk-session-broker-prd.md
> ```
>
> Plans 022 and 023 are expected to touch `src/lib/workspace-session-broker.ts`
> before this plan starts. If those plans are DONE, compare the current code
> against the intent below rather than expecting byte-for-byte line matches. If
> the broker no longer broadcasts `assistant_delta` or stores state under
> `BROKER_STATE_KEY`, STOP and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/022-gate-runner-events-and-commands-by-run-id.md, plans/023-restart-runner-when-model-changes.md
- **Category**: correctness / durability
- **Planned at**: commit `bb00b96`, 2026-07-02

## Why this matters

The PRD says a user should be able to refresh the page during an active run
without losing their place. Today the broker broadcasts live assistant deltas
to currently connected sockets and flushes one final assistant message to D1
when the run reaches a terminal state. A browser refresh during the run opens a
new WebSocket, receives only a snapshot with `activeRunId`, and loses the
assistant text streamed so far. A Durable Object hibernation/restart has the
same problem unless the in-memory `AssistantStreamDraft` survives.

This plan stores a compact active-run live snapshot in Durable Object storage
and replays it in the broker `snapshot` frame. It does **not** write every token
to D1; D1 remains the canonical terminal history after completion. The goal is
active-run continuity across refresh/reconnect while keeping the existing D1
schema and public tRPC API stable.

## Current state

Relevant files:

- `src/lib/workspace-session-broker.ts` — owns WebSocket snapshots, live broadcasts, and terminal D1 flush.
- `src/hooks/use-workspace-session-socket.ts` — browser hook that interprets broker frames.
- `src/components/ai-chat.tsx` — renders persisted events and transient live assistant text.
- `src/lib/assistant-stream-draft.ts` — in-memory assistant delta accumulator.
- `src/lib/assistant-stream-draft.test.ts` — pure tests for assistant draft behavior.

PRD evidence:

```text
// docs/pi-sdk-session-broker-prd.md:28-30
As a founder, I want to cancel a run mid-flight, so that a runaway agent does
not keep mutating my project while I regroup.
As a founder, I want a canceled run to stay canceled, so that late agent output
cannot flip my project back to "completed" after I stopped it.
As a founder, I want to refresh the page during an active run, so that a tab
reload does not lose my place or the canonical history.
```

Current broker live handling:

```ts
// src/lib/workspace-session-broker.ts:456-470
case "assistant_delta":
	this.assistantDraft.append(runId, event.text);
	this.broadcast({ type: "assistant_delta", runId, text: event.text });
	return;
case "tool_progress":
	this.broadcast({
		type: "tool_progress",
		runId,
		text: trimCompact(event.text),
	});
	return;
```

Terminal D1 flush consumes the in-memory draft:

```ts
// src/lib/workspace-session-broker.ts:607-655
const assistantText = this.assistantDraft.consume(state.activeRunId);
const terminalEvents = [
	...(assistantText
		? [{ type: "message" as const, payload: createAgentRunEventPayload({ role: "assistant", text: assistantText }) }]
		: []),
	{ type: "done" as const, payload: createAgentRunEventPayload({ status }) },
];
// db.batch updates agentRuns/projects and inserts terminalEvents
```

New socket snapshots send only broker state:

```ts
// src/lib/workspace-session-broker.ts:784-789
this.ctx.acceptWebSocket(server);
this.sockets.set(server, attachment);
this.sendFrame(server, {
	type: "snapshot",
	state: await this.getState(),
});
```

The browser hook resets live assistant text on snapshots instead of replaying
stored text:

```ts
// src/hooks/use-workspace-session-socket.ts:80-104
case "snapshot":
	if (frame.state.activeRunId) {
		return frame.state.activeRunId === current.liveRunId
			? current
			: {
					...current,
					assistantText: "",
					liveRunId: frame.state.activeRunId,
					lastDoneRunId: null,
				};
	}
```

Repo conventions:

- Keep pure state helpers in `src/lib/` with sibling `.test.ts` files.
- Keep WebSocket frame changes additive; avoid changing public tRPC shapes.
- Use compact payloads and `trimCompact`-style truncation for live tool output.
- Do not add broad browser/Cloudflare integration tests for this path.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused draft tests | `pnpm vitest run src/lib/assistant-stream-draft.test.ts` | exit 0; new replay helpers pass |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Runner typecheck | `pnpm runner:typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0; only pre-existing unrelated warnings |
| Full tests | `pnpm test` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `src/lib/assistant-stream-draft.ts`
- `src/lib/assistant-stream-draft.test.ts`
- `src/lib/workspace-session-broker.ts`
- `src/hooks/use-workspace-session-socket.ts`
- `src/components/ai-chat.tsx`
- `plans/README.md`

**Out of scope**:

- D1 schema changes.
- Persisting every assistant token or full tool transcript to D1.
- Changing tRPC input/output shapes.
- Changing runner protocol event types.
- Building the full diff review UI.
- Replaying D1 history into Pi model context after runner restart.

## Git workflow

- Branch: `advisor/024-active-run-live-replay`
- Commit message style: Conventional Commits, e.g. `fix(workspace): replay active run stream on reconnect`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add pure helpers for replayable live state

Add a `peek(runId: string): string | null` method to `AssistantStreamDraft`:

- Return `null` if the stored run id differs.
- Return the trimmed accumulated text if present.
- Do not clear the draft.

Update `src/lib/assistant-stream-draft.test.ts` to cover:

- `peek` returns accumulated text without consuming it.
- `peek` returns `null` for another run.
- `consume` still clears after returning text.

If you need a helper for bounded tool progress tails, add it in the same file
or a new pure file under `src/lib/`, with tests. Target behavior: append a
`{ runId, text, createdAt }` item and keep only the newest 20 entries.

**Verify**:

```bash
pnpm vitest run src/lib/assistant-stream-draft.test.ts
```

Expected: exit 0.

### Step 2: Store live assistant/tool snapshot in Durable Object state

In `src/lib/workspace-session-broker.ts`, extend `BrokerState` with additive
fields:

```ts
assistantDraftText?: string;
toolProgressTail?: Array<{ runId: string; text: string; createdAt: number }>;
```

Add a private state write helper so live-delta persistence does not broadcast a
`snapshot` frame for every token:

```ts
private async putState(state: BrokerState, options: { broadcast?: boolean } = {}): Promise<void> {
	await this.ctx.storage.put(BROKER_STATE_KEY, state);
	if (options.broadcast ?? true) {
		this.broadcast({ type: "snapshot", state });
	}
}
```

Update existing `setState` to call `putState(state, { broadcast: true })`, or
replace `setState` with `putState` carefully. Preserve existing snapshot
broadcasts for start/reply/terminal transitions.

In the `assistant_delta` handler:

1. append to `assistantDraft`;
2. broadcast the delta as today;
3. store `assistantDraftText: this.assistantDraft.peek(runId) ?? undefined` in DO storage without broadcasting a snapshot.

In the `tool_progress` handler:

1. compact the text with `trimCompact`;
2. broadcast it as today;
3. append it to `toolProgressTail` for the active run, capped at 20 entries;
4. store the updated state without broadcasting a snapshot.

Do not store secrets here; the runner already redacts tool progress before
emitting it (plan 020). Keep the same compacting limit used for live frames.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exit 0.

### Step 3: Clear live snapshot fields on run boundaries

In `WorkspaceSessionBroker.start`, clear `assistantDraftText` and
`toolProgressTail` for the new run when setting active state.

In terminal paths (`finishRun`, `clearCanceledRun`, and stale-runner cleanup),
clear:

```ts
assistantDraftText: undefined,
toolProgressTail: undefined,
```

When `abort` flushes an assistant draft for the canceled run, also clear the
stored `assistantDraftText` if the canceled run is the active run.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

Expected: both exit 0.

### Step 4: Replay live snapshot in the socket hook

In `src/hooks/use-workspace-session-socket.ts`, extend
`WorkspaceSessionSocketState` with a live tool progress tail:

```ts
liveToolProgress: Array<{ runId: string; text: string; createdAt: number }>;
```

On `tool_progress` frames, append the frame to the live tail (cap at 20) and
keep the current behavior for assistant deltas.

On `snapshot` frames with `frame.state.activeRunId`, set:

- `assistantText` to `frame.state.assistantDraftText ?? ""` when connecting to a run that is not already the current `liveRunId`;
- `liveToolProgress` to `frame.state.toolProgressTail ?? []`;
- `liveRunId` to `frame.state.activeRunId`.

When there is no active run and no `lastDoneRunId`, clear `assistantText`,
`liveRunId`, `needsInput`, and `liveToolProgress`.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exit 0.

### Step 5: Render replayed live tool progress compactly

In `src/components/ai-chat.tsx`, render `socketState.liveToolProgress` while a
run is active. Keep this simple and compact:

- Show at most the tail provided by the hook.
- Use the existing activity/log visual language (`ActivityEventMessage` or a small sibling component).
- Do not persist or fake changed files/diffs here.
- Keep assistant streaming rendering unchanged except that snapshot replay now supplies initial text.

If the UI already renders live tool progress after earlier drift, do not add a
duplicate renderer; adapt the hook replay to feed the existing renderer.

**Verify**:

```bash
pnpm lint
pnpm exec tsc --noEmit --pretty false
```

Expected: lint exits 0 with only the known unrelated warnings; typecheck exits 0.

### Step 6: Run the full verification baseline

Run:

```bash
pnpm vitest run src/lib/assistant-stream-draft.test.ts
pnpm runner:typecheck
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Expected: all exit 0, with only the known unrelated lint warnings.

## Test plan

Add focused pure tests in `src/lib/assistant-stream-draft.test.ts` for the new
`peek` behavior and any bounded-tail helper you introduce. Do not add a broad
browser or Durable Object integration harness.

Manual smoke before deployment:

1. Start a run that streams more than one assistant delta.
2. Refresh the browser tab before the run finishes.
3. Confirm the assistant text streamed so far reappears from the snapshot.
4. Trigger tool progress, refresh, and confirm the compact recent tool progress tail reappears.
5. Let the run finish and confirm only the final assistant message/done event remain in canonical D1 history after another refresh.
6. Cancel a run, refresh, and confirm canceled output does not reappear as active.

## Done criteria

- [ ] `AssistantStreamDraft.peek(runId)` exists, is tested, and does not consume text.
- [ ] `BrokerState` includes additive `assistantDraftText` and `toolProgressTail` fields.
- [ ] The broker stores live assistant draft text in DO storage as deltas arrive.
- [ ] The broker stores a bounded recent tool-progress tail in DO storage.
- [ ] The broker clears live snapshot fields on start, completion, failure, cancellation, and stale-runner cleanup.
- [ ] New WebSocket snapshots replay active-run assistant text and tool progress through `useWorkspaceSessionSocket`.
- [ ] Chat renders replayed live progress without duplicating terminal persisted events.
- [ ] `pnpm vitest run src/lib/assistant-stream-draft.test.ts` exits 0.
- [ ] `pnpm runner:typecheck` exits 0.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.

## STOP conditions

Stop and report back if:

- The broker no longer uses `AssistantStreamDraft` or no longer broadcasts `assistant_delta` frames.
- Replaying live state appears to require a D1 migration.
- The browser frame contract has been replaced rather than extended.
- The implementation would store unredacted tool output or environment values.
- Adding live replay causes duplicated final assistant messages after completion.
- Verification fails because plans 021-023 have not landed.

## Maintenance notes

This plan intentionally stores only active-run live replay state in Durable
Object storage. D1 remains the canonical terminal event log. If future product
requirements demand full live transcript auditability, add a separate plan for
bounded D1 checkpoints or artifact storage; do not silently start writing every
token to `agent_run_events` without a cost/performance review.
