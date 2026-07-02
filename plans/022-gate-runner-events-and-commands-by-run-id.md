# Plan 022: Gate runner events and commands by run id

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
> git diff --stat bb00b96..HEAD -- src/lib/runner-protocol.ts src/lib/runner-protocol.test.ts sandbox/runner/index.ts src/lib/workspace-session-broker.ts src/integrations/trpc/routers/workspace.ts src/hooks/use-workspace-session-socket.ts src/components/ai-chat.tsx
> git diff --stat -- src/lib/runner-protocol.ts src/lib/runner-protocol.test.ts sandbox/runner/index.ts src/lib/workspace-session-broker.ts src/integrations/trpc/routers/workspace.ts src/hooks/use-workspace-session-socket.ts src/components/ai-chat.tsx
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code. If the cited logic no longer
> exists or has materially different semantics, STOP and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/021-add-runner-verification-and-reproducible-installs.md
- **Category**: correctness / bug
- **Planned at**: commit `bb00b96`, 2026-07-02

## Why this matters

The runner↔broker protocol includes run ids on runner events, but the broker
currently applies every non-`ready` event to whatever run is active in Durable
Object state. Likewise, abort commands sent to the runner do not check that the
abort target is still the runner's current run. A late event or stale abort can
therefore affect the wrong active run after a cancel/retry or runner reuse.

Ditto's PRD requires canceled runs to stay canceled and late agent output not
to resurrect or corrupt a later run. This plan makes run id ownership an
enforced protocol invariant at the pure protocol seam, in the runner, and in
the broker.

## Current state

Relevant files:

- `src/lib/runner-protocol.ts` — owns the Ditto NDJSON command/event types and pure command dispatch helper.
- `src/lib/runner-protocol.test.ts` — pure protocol tests.
- `sandbox/runner/index.ts` — Node runner that receives `RunnerCommand`s and emits `RunnerEvent`s.
- `src/lib/workspace-session-broker.ts` — Durable Object broker that launches the runner, relays events, and persists terminal events.
- `src/integrations/trpc/routers/workspace.ts` — tRPC router posts `/reply` and `/abort` to the broker with the user-visible run id.

Current protocol excerpts:

```ts
// src/lib/runner-protocol.ts:18-21
export type RunnerCommand =
	| { type: "prompt"; id: string; message: string }
	| { type: "reply"; requestId: string; answer: string }
	| { type: "abort"; id: string };
```

```ts
// src/lib/runner-protocol.ts:26-57
export type RunnerEvent =
	| { type: "ready"; runnerVersion: string; model: string }
	| { type: "assistant_delta"; runId: string; text: string }
	| { type: "tool_started"; runId: string; toolName: string; label?: string }
	| { type: "tool_progress"; runId: string; text: string }
	| { type: "tool_finished"; runId: string; toolName: string; status: string }
	| { type: "file_changed"; runId: string; path: string }
	| { type: "diff_ready"; runId: string; changedFiles: number; truncated?: boolean }
	| { type: "input_request"; runId: string; requestId: string; question: string; placeholder?: string }
	| { type: "done"; runId: string; status: "completed" | "failed" | "canceled" }
	| { type: "error"; runId: string; message: string };
```

The broker ignores `event.runId` and uses `state.activeRunId` instead:

```ts
// src/lib/workspace-session-broker.ts:439-459
private async handleRunnerEvent(event: RunnerEvent): Promise<void> {
	if (event.type === "ready") {
		this.runnerReady = true;
		this.readyResolve();
		return;
	}

	const state = await this.getState();
	const runId = state.activeRunId;
	if (!runId || state.canceledRunIds?.includes(runId)) {
		return;
	}
	// ...
	case "assistant_delta":
		this.assistantDraft.append(runId, event.text);
		this.broadcast({ type: "assistant_delta", runId, text: event.text });
```

Input requests also persist under the active run without checking the event's
run id:

```ts
// src/lib/workspace-session-broker.ts:505-539
private async handleInputRequest(event: RunnerEvent): Promise<void> {
	if (event.type !== "input_request") return;
	const state = await this.getState();
	if (!state.activeRunId || !state.projectId || !state.sessionId) {
		return;
	}
	// updates agentRuns.id = state.activeRunId and inserts needs_input
```

The runner accepts abort commands without checking that the command id matches
`currentRunId`:

```ts
// sandbox/runner/index.ts:333-335
case "abort": {
	session.abort().then(undefined, handleRunError);
	break;
}
```

The pure dispatch helper currently treats every abort as applicable:

```ts
// src/lib/runner-protocol.ts:337-338
case "abort":
	return { action: "abort" };
```

Repo conventions:

- Protocol behavior belongs in `src/lib/runner-protocol.ts` with sibling Vitest tests.
- Broker persisted events use `createAgentRunEventPayload(...)` and `schemaVersion: 1`.
- Cancellation is durable-first in `workspace.cancelRun`; broker `/abort` is best effort.
- Do not add broad browser or Cloudflare integration tests; keep the automated seam pure.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused protocol tests | `pnpm vitest run src/lib/runner-protocol.test.ts` | exit 0; new stale-run tests pass |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Runner typecheck | `pnpm runner:typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0; only pre-existing warnings in unrelated UI files |
| Full tests | `pnpm test` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `src/lib/runner-protocol.ts`
- `src/lib/runner-protocol.test.ts`
- `sandbox/runner/index.ts`
- `src/lib/workspace-session-broker.ts`
- `src/integrations/trpc/routers/workspace.ts` only if the broker control body needs an additional run id field
- `plans/README.md`

**Out of scope**:

- D1 schema changes.
- Browser frame contract changes.
- Model-selection behavior (covered by plan 023).
- Active stream replay/durability (covered by plan 024).
- Changing cancellation to be non-best-effort.
- Changing Pi SDK prompts/tools.

## Git workflow

- Branch: `advisor/022-runner-run-id-gates`
- Commit message style: Conventional Commits, e.g. `fix(runner): gate events by run id`
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Extend the pure command contract and tests

In `src/lib/runner-protocol.ts`, change reply commands to carry the run id they
belong to:

```ts
| { type: "reply"; runId: string; requestId: string; answer: string }
```

Update `RunnerDispatch` so prompt, reply, and abort decisions include the run
id they target:

```ts
| { action: "prompt"; runId: string; message: string }
| { action: "resolveInput"; runId: string; requestId: string; answer: string }
| { action: "abort"; runId: string }
| null
```

Change `planRunnerCommand` to accept a pending-input predicate with both
request id and run id:

```ts
hasPendingInput: (requestId: string, runId: string) => boolean
```

Expected behavior:

- `prompt` returns `{ action: "prompt", runId: command.id, message }`.
- `reply` returns `resolveInput` only when `hasPendingInput(requestId, runId)` is true.
- `abort` returns `{ action: "abort", runId: command.id }`; the runner will do the current-run check.

Update `src/lib/runner-protocol.test.ts` to cover:

- reply command with matching pending `(requestId, runId)` dispatches.
- reply command with matching request id but wrong run id returns `null`.
- abort dispatch includes the target run id.

**Verify**:

```bash
pnpm vitest run src/lib/runner-protocol.test.ts
```

Expected: exit 0.

### Step 2: Track pending input requests by run id inside the runner

In `sandbox/runner/index.ts`, change `pendingInputs` from a map of request id to
resolver into a map of request id to an object that includes the owning run id:

```ts
type PendingInput = { runId: string; resolve: (answer: string) => void };
const pendingInputs = new Map<string, PendingInput>();
```

When the `ask_user` tool emits an `input_request`, store `{ runId, resolve }`.
Use the current run id captured for that request; do not read a later
`currentRunId` when resolving.

Update the `planRunnerCommand` call to:

```ts
const dispatch = planRunnerCommand(parsed, (requestId, runId) => {
	return pendingInputs.get(requestId)?.runId === runId;
});
```

When handling `resolveInput`, resolve only the stored pending input for that
request id and run id. When handling `abort`, only call `session.abort()` when
`dispatch.runId === currentRunId`; otherwise log a diagnostic to stderr and
ignore it.

**Verify**:

```bash
pnpm runner:typecheck
```

Expected: exit 0.

### Step 3: Send reply commands with run id from the broker

In `src/lib/workspace-session-broker.ts`, update the `/reply` path to include
`input.runId` in the runner command:

```ts
await this.sendRunnerCommand({
	type: "reply",
	runId: input.runId,
	requestId: state.pendingInputRequestId,
	answer: input.answer,
});
```

Before sending, validate that the broker is still waiting on that same run:

```ts
if (state.activeRunId !== input.runId) {
	throw new Error("This input request no longer belongs to the active run.");
}
```

Keep the existing "No pending input request" error for sessions with no pending
request.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exit 0.

### Step 4: Ignore stale runner events in the broker

In `src/lib/workspace-session-broker.ts`, update `handleRunnerEvent` after the
`ready` case:

- Read `state.activeRunId`.
- If there is no active run, return.
- If `event.runId !== state.activeRunId`, return without broadcasting or inserting D1 events.
- If the active run is in `state.canceledRunIds`, return.
- Use `event.runId` (now known equal to active) for assistant draft, broadcasts, and inserts.

Then update `handleInputRequest` to reject mismatched input requests before
updating D1:

```ts
if (event.runId !== state.activeRunId) return;
```

Do not emit an error for stale events; late output from a canceled or previous
run is expected during cancellation races and should be ignored.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

Expected: both exit 0.

### Step 5: Make broker abort a no-op for non-active runs

In `WorkspaceSessionBroker.abort`, after loading state:

- Add the requested run id to `canceledRunIds` as it does today.
- Flush assistant draft for that requested run id.
- Only send `{ type: "abort", id: input.runId }` to the runner when `state.activeRunId === input.runId`.
- Only broadcast `done(canceled)` when the requested run is still active in broker state. The tRPC layer already inserted the durable done event; stale broker aborts should not affect a later active run.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

Expected: both exit 0.

### Step 6: Run the full verification baseline

Run:

```bash
pnpm lint
pnpm runner:typecheck
pnpm exec tsc --noEmit --pretty false
pnpm test
git diff --check
```

Expected: all exit 0, with only the known unrelated lint warnings.

## Test plan

Add or update tests in `src/lib/runner-protocol.test.ts` for the pure command
changes:

- `reply` dispatch succeeds only when request id and run id both match.
- stale `reply` for the same request id but different run id returns `null`.
- `abort` dispatch carries the target run id.

No broad Durable Object integration test is required. The broker behavior is
covered by typecheck plus the pure protocol tests, consistent with the existing
runner-contract testing strategy.

## Done criteria

- [ ] `RunnerCommand` reply includes `runId`.
- [ ] `planRunnerCommand` checks pending replies by request id and run id.
- [ ] The runner stores pending input requests with their owning run id.
- [ ] The runner ignores abort commands whose id is not the current run id.
- [ ] The broker sends reply commands with `runId`.
- [ ] The broker ignores runner events whose `event.runId` differs from `state.activeRunId`.
- [ ] The broker does not send stale aborts to a newer active run.
- [ ] `pnpm vitest run src/lib/runner-protocol.test.ts` exits 0.
- [ ] `pnpm runner:typecheck` exits 0.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.

## STOP conditions

Stop and report back if:

- The runner contract no longer has run ids on non-`ready` events.
- The broker has been refactored so `handleRunnerEvent`, `reply`, or `abort` no longer exists.
- Enforcing run ids appears to require a D1 schema change.
- A stale runner event is currently used intentionally for cross-run replay; this would contradict the PRD cancellation guarantees.
- Verification fails because plan 021's runner verification scripts are absent or broken.

## Maintenance notes

Run id ownership is now part of the runner protocol, not a UI convention. Any
future command type that mutates run state must carry enough identity for the
runner and broker to prove it belongs to the active run before applying it.
