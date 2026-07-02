# Plan 019: Rewire the WorkspaceSessionBroker DO to launch the Pi SDK runner

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Prerequisite**: Plan 018 must be DONE before this plan starts. Confirm
> these files exist and typecheck before proceeding:
> `src/lib/runner-protocol.ts`, `src/lib/runner-protocol.test.ts`,
> `sandbox/runner/index.ts`, `sandbox/runner/package.json`,
> `sandbox/runner/tsconfig.json`, and the `Dockerfile` must already install
> `tsx` and copy the runner + protocol module into `/opt/ditto/`. Run
> `pnpm test` and confirm `runner-protocol.test.ts` passes. If any of these
> is missing or broken, STOP — this plan cannot run without 018 landed.
>
> **Drift check (run after the prerequisite check)**:
> `git diff --stat 55b6151..HEAD -- src/lib/workspace-session-broker.ts src/lib/pi-rpc.ts src/lib/pi-rpc.test.ts sandbox/pi/ditto-ask-user.ts`
> `workspace-session-broker.ts`, `pi-rpc.ts`, `pi-rpc.test.ts`, and
> `ditto-ask-user.ts` should be UNCHANGED since `55b6151` (018 did not touch
> them). If any changed, compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/018-runner-contract-and-pi-sdk-runner.md (must be DONE — this plan switches the DO to launching the runner 018 built)
- **Category**: migration
- **Planned at**: commit `55b6151`, 2026-07-02

## Why this matters

Plan 018 built the Pi SDK agent runner (`sandbox/runner/index.ts`) and the
Ditto-owned NDJSON contract (`src/lib/runner-protocol.ts`), but left the
`WorkspaceSessionBroker` Durable Object driving Pi as a CLI subprocess in RPC
mode — hand-rolling a named-pipe transport, writing Pi RPC commands, and parsing
Pi's wire protocol inside the Worker. The runner sits unused.

This plan is **phase 2 of the PRD's recommended sequencing**: it rewires the DO
to launch the runner via the Cloudflare Sandbox SDK and consume the Ditto
NDJSON event stream instead of Pi's RPC protocol. The DO shrinks to a broker:
it launches the runner, relays live events to the browser over WebSocket,
persists canonical events to D1, and relays replies/aborts back into the
container as Ditto commands. The DO now contains **zero Pi wire-protocol
knowledge** (PRD line 25). The tRPC public API, the browser WebSocket frame
contract, and the D1 schema all stay shape-stable (PRD lines 145–155), so no
client-facing or UI change is needed.

After this plan lands, `pi-rpc.ts`, `pi-rpc.test.ts`, and the
`sandbox/pi/ditto-ask-user.ts` CLI extension are dead code and are deleted.

## Current state

Relevant files:

- `docs/pi-sdk-session-broker-prd.md` — the PRD. "Durable Object responsibilities
  (slimmed)" (lines 133–143), "tRPC public API (unchanged shape)" (lines
  145–147), "Browser frame contract (unchanged shape)" (lines 149–151), and
  "Run lifecycle and cancellation" (lines 157–159) are the authoritative
  constraints this plan must honor.
- `src/lib/workspace-session-broker.ts` — the existing 948-line DO (REWRITTEN
  by this plan). Today it drives Pi CLI-RPC. Key current-state excerpts:

Imports (the `pi-rpc` helpers this plan replaces with `runner-protocol`):

```ts
// src/lib/workspace-session-broker.ts:1-21
import { DurableObject } from "cloudflare:workers";
import {
	type ExecutionSession,
	type LogEvent,
	parseSSEStream,
	type SessionOptions,
} from "@cloudflare/sandbox";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "#/db";
import { agentRunEvents, agentRuns, projects } from "#/db/schema";
import {
	buildJsonlWriteCommand,
	getPiModelParts,
	getTextField,
	JsonlBuffer,
	type PiRpcCommand,
	type PiRpcEvent,
	type PiRpcResponse,
	quoteShellArg,
	trimCompact,
} from "#/lib/pi-rpc";
```

Live state shape (rename `piProcessId`→`runnerProcessId`,
`pendingUiRequestId`→`pendingInputRequestId` per PRD line 136 vocabulary):

```ts
// src/lib/workspace-session-broker.ts:36-47
type BrokerState = {
	sessionId?: string;
	userId?: string;
	projectId?: string;
	sandboxId?: string;
	activeRunId?: string;
	isMutating?: boolean;
	piProcessId?: string;
	fifoPath?: string;
	pendingUiRequestId?: string;
	canceledRunIds?: string[];
};
```

The browser frame contract — UNCHANGED by this plan (PRD line 151):

```ts
// src/lib/workspace-session-broker.ts:74-80
export type WorkspaceSessionBrokerFrame =
	| { type: "snapshot"; state: BrokerState }
	| { type: "assistant_delta"; runId: string; text: string }
	| { type: "tool_progress"; runId: string; text: string }
	| { type: "needs_input"; runId: string; question: string; requestId: string }
	| { type: "done"; runId: string; status: "completed" | "failed" | "canceled" }
	| { type: "error"; message: string };
```

Process-id and broker-dir helpers (rename `pi`→`runner`):

```ts
// src/lib/workspace-session-broker.ts:145-151
function makeProcessId(sessionId: string): string {
	return `ditto-pi-${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function makeBrokerDir(sessionId: string): string {
	return `/tmp/ditto/pi/${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}
```

The Pi CLI-RPC launch command (replaced with a runner launch — no `pi --mode
rpc`, no `-e` extension; the runner has its own ask-user tool):

```ts
// src/lib/workspace-session-broker.ts:182-208
function makePiCommand(options: {
	brokerDir: string;
	fifoPath: string;
	provider: string;
	model: string;
}): string {
	return [
		"set -euo pipefail",
		`mkdir -p ${quoteShellArg(options.brokerDir)}`,
		`rm -f ${quoteShellArg(options.fifoPath)}`,
		`mkfifo ${quoteShellArg(options.fifoPath)}`,
		[
			"exec env PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 pi --mode rpc",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-approve",
			"-e /opt/ditto/pi/ditto-ask-user.ts",
			`--provider ${quoteShellArg(options.provider)}`,
			`--model ${quoteShellArg(options.model)}`,
			`< ${quoteShellArg(options.fifoPath)}`,
			`2> ${quoteShellArg(`${options.brokerDir}/rpc.err`)}`,
		].join(" "),
	].join("; ");
}
```

The process-ensure path (reused structure — still creates/reuses a sandbox
session via `createOrGetSandboxSession`, still gives the process a deterministic
id, still streams logs; only the launched command and stored fields change):

```ts
// src/lib/workspace-session-broker.ts:419-464
private async ensurePiProcess(input: StartRequest): Promise<void> {
	const state = await this.getState();
	if (state.piProcessId && state.fifoPath) {
		await this.startLogStream(state.piProcessId);
		return;
	}

	const sandbox = getProjectSandbox(this.env, input.sandboxId);
	const session = await createOrGetSandboxSession(
		sandbox as SandboxWithSessions,
		{
			id: input.sessionId,
			name: `Ditto ${input.sessionId}`,
			cwd: WORKSPACE_PATH,
			env: { OPENCODE_API_KEY: this.env.OPENCODE_API_KEY },
		},
	);
	const brokerDir = makeBrokerDir(input.sessionId);
	const fifoPath = `${brokerDir}/rpc.in`;
	const processId = makeProcessId(input.sessionId);
	const { provider, model } = getPiModelParts(input.modelSpecifier);
	const command = `bash -lc ${quoteShellArg(
		makePiCommand({ brokerDir, fifoPath, provider, model }),
	)}`;

	await session.startProcess(command, {
		processId,
		autoCleanup: false,
		cwd: WORKSPACE_PATH,
		env: { OPENCODE_API_KEY: this.env.OPENCODE_API_KEY },
		onExit: (code) => { ... },
	});

	await this.setState({
		...(await this.getState()),
		piProcessId: processId,
		fifoPath,
	});
	await this.startLogStream(processId);
}
```

The command sender (writes a `PiRpcCommand` to the FIFO via `exec` and awaits a
matching `response` event — the runner contract has NO response events, so this
becomes a fire-and-forget NDJSON write with no response waiter):

```ts
// src/lib/workspace-session-broker.ts:515-553
private async sendCommand(command: PiRpcCommand): Promise<PiRpcResponse> {
	...
	const responsePromise = new Promise<PiRpcResponse>((resolve, reject) => {
		this.responseWaiters.set(command.id ?? "", { resolve, reject });
	});

	this.commandQueue = this.commandQueue.then(async () => {
		...
		const result = await session.exec(
			buildJsonlWriteCommand(state.fifoPath ?? "", command),
			{ cwd: WORKSPACE_PATH, timeout: COMMAND_TIMEOUT_MS },
		);
		...
	});
	...
}
```

The Pi RPC event handler (replaced with a `RunnerEvent` handler — the event
types and field extraction change completely):

```ts
// src/lib/workspace-session-broker.ts:568-641
private async handlePiEvent(event: PiRpcEvent): Promise<void> {
	if (event.type === "response") { ... return; }
	...
	switch (event.type) {
		case "message_update": { ... }
		case "message_end": { ... }
		case "tool_execution_start": ...
		case "tool_execution_update": { ... }
		case "tool_execution_end": ... await this.emitWorkspaceChanges(); return;
		case "extension_ui_request": await this.handleUiRequest(event); return;
		case "agent_end": await this.completeRun(); return;
		case "extension_error": await this.failRun(...); return;
	}
}
```

The extension-UI-request handler (the runner emits `input_request` directly with
`requestId`/`question`/`placeholder`, so this becomes a simpler
`handleInputRequest` that reads those fields from the `RunnerEvent`):

```ts
// src/lib/workspace-session-broker.ts:643-685
private async handleUiRequest(event: Record<string, unknown>): Promise<void> {
	...
	const requestId = getTextField(event, ["requestId", "id"]) ?? crypto.randomUUID();
	const question = getTextField(event, ["question", "prompt", "message"]) ?? "The agent needs input.";
	...
	await this.setState({ ...state, pendingUiRequestId: requestId });
	this.broadcast({ type: "needs_input", runId: state.activeRunId, question, requestId });
}
```

The reply/abort methods (send `extension_ui_response` / Pi `abort` → send
`reply` / `abort` `RunnerCommand`s):

```ts
// src/lib/workspace-session-broker.ts:385-417
private async reply(input: ReplyRequest): Promise<void> {
	const state = await this.getState();
	if (!state.pendingUiRequestId) { throw new Error("No pending Pi UI request for this session."); }
	const response = await this.sendCommand({
		type: "extension_ui_response",
		id: state.pendingUiRequestId,
		value: input.answer,
	});
	...
}

private async abort(input: AbortRequest): Promise<void> {
	...
	try {
		await this.sendCommand({ id: `abort-${input.runId}`, type: "abort" });
	} catch { ... }
	this.broadcast({ type: "done", runId: input.runId, status: "canceled" });
}
```

The git-inspect helper — KEPT AS-IS by this plan (the DO continues to produce
`file_changed`/`diff_ready` D1 events via `git status` after a `tool_finished`;
the runner emits `tool_finished` only, consistent with plan 018 Step 3):

```ts
// src/lib/workspace-session-broker.ts:855-890
private async emitWorkspaceChanges(): Promise<void> {
	...
	const result = await session.exec("git status --short", {
		cwd: WORKSPACE_PATH,
		timeout: COMMAND_TIMEOUT_MS,
	});
	...
	for (const path of paths) {
		await this.insertEvent("file_changed", { path });
	}
	await this.insertEvent("diff_ready", { changedFiles: paths.length, truncated: ... });
}
```

- `src/lib/pi-rpc.ts` + `src/lib/pi-rpc.test.ts` — DELETED by this plan (dead
  after the DO stops using Pi RPC).
- `sandbox/pi/ditto-ask-user.ts` — DELETED by this plan (the runner has its own
  SDK ask-user tool; the `-e` extension is no longer loaded).
- `src/lib/runner-protocol.ts` — from plan 018 (the contract module this plan
  consumes). Exports `RunnerCommand`, `RunnerEvent`, `RUNNER_EVENT_TYPES`,
  `RunnerEventBuffer`, `parseRunnerEvent`, `serializeRunnerCommand`,
  `serializeRunnerEvent`, `mapSdkEventToDitto`, `planRunnerCommand`. This plan
  imports `RunnerCommand`, `RunnerEvent`, `RunnerEventBuffer`,
  `parseRunnerEvent`, `serializeRunnerCommand` (and the type-only `RunnerEvent`
  union) — NOT `mapSdkEventToDitto`/`planRunnerCommand` (those are runner-side).
- `sandbox/runner/index.ts` — from plan 018 (the runner this plan launches). It
  reads `OPENCODE_API_KEY` + `MODEL_SPECIFIER` from env, emits `ready` on
  startup, reads NDJSON commands from stdin, writes NDJSON events to stdout,
  diagnostics to stderr.
- `Dockerfile` — after plan 018 it installs `tsx` and copies the runner +
  protocol module. This plan removes the now-dead `COPY sandbox/pi/` line.
- `src/integrations/trpc/routers/workspace.ts` — UNCHANGED. `startRun` posts
  `/start`, `answerRunQuestion` posts `/reply`, `cancelRun` posts `/abort` via
  `postWorkspaceSessionBroker` (lines 48–74). The DO's `/start`/`/reply`/`/abort`
  fetch routes stay.
- `src/routes/api.workspace.session.$sessionId.socket.ts` — UNCHANGED authed
  WebSocket route.
- `src/hooks/use-workspace-session-socket.ts` + `src/components/ai-chat.tsx` +
  `src/routes/project.$projectId.tsx` — UNCHANGED browser layer consuming
  `WorkspaceSessionBrokerFrame`.
- `alchemy.run.ts` + `src/server.ts` — UNCHANGED (the `WorkspaceSessionBroker`
  DO namespace, binding, and migration already exist from plan 017; the runner
  runs inside the existing sandbox container; no new bindings).

Repo conventions to match (unchanged from plan 018):

- TypeScript strict; tabs + double quotes; `#/` imports inside `src/`.
- D1 writes stay batched + conditional (`db.batch(...)`, conditional
  `update(...).where(eq(projects.activeAgentRunId, runId))`).
- Conventional Commits, e.g. `feat(workspace): broker launches pi sdk runner`.

Verification baseline (captured at `55b6151`; must still pass after this plan
with 018 landed):

- `pnpm exec tsc --noEmit --pretty false` exits 0.
- `pnpm test` exits 0 (including `runner-protocol.test.ts` from 018;
  `pi-rpc.test.ts` is deleted by this plan).
- `pnpm lint` exits 0 with only the two pre-existing warnings in
  `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- `git diff --check` exits 0.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Tests | `pnpm test` | exit 0; `pi-rpc.test.ts` is gone, `runner-protocol.test.ts` still passes |
| Lint | `pnpm lint` | exit 0, only the two pre-existing warnings |
| Whitespace | `git diff --check` | exit 0, no output |
| Dead-code check | `rg -n "pi-rpc|PiRpc|ditto-ask-user|makePiCommand|handlePiEvent|ensurePiProcess" src/ sandbox/` | no matches (all Pi-RPC references removed) |

Do not run `pnpm format`, `pnpm fix`, `pnpm deploy`, or `pnpm destroy` unless
the operator explicitly asks. Do not commit credentials, `.env`, generated
`.alchemy/` state, or secret-bearing command output.

## Suggested executor toolkit

- Use `durable-objects` if available before editing the DO lifecycle and
  WebSocket hibernation paths.
- Use `workers-best-practices` if available before touching the DO fetch routes.
- Use `sandbox-sdk` if available before editing the `startProcess` /
  `streamProcessLogs` launch shape.

## Scope

**In scope** (the only files you should modify):

- `src/lib/workspace-session-broker.ts` (rewrite) — launch the runner, consume
  `RunnerEvent`s, send `RunnerCommand`s.
- `src/lib/pi-rpc.ts` (delete).
- `src/lib/pi-rpc.test.ts` (delete).
- `sandbox/pi/ditto-ask-user.ts` (delete).
- `Dockerfile` (modify — remove the dead `COPY sandbox/pi/` line; keep 018's
  runner copy and `tsx` install).
- `plans/README.md` (modify — status row).

**Out of scope** (do NOT touch):

- `sandbox/runner/index.ts` and `src/lib/runner-protocol.ts` — plan 018 owns
  them. This plan consumes them as-is. If the runner needs a change to satisfy
  this plan, STOP and report (the contract may need a 018 revision instead).
- `src/integrations/trpc/routers/workspace.ts` — tRPC API is shape-stable
  (PRD line 147).
- `src/routes/api.workspace.session.$sessionId.socket.ts` — socket route
  unchanged.
- `src/hooks/use-workspace-session-socket.ts`, `src/components/ai-chat.tsx`,
  `src/components/composer.tsx`, `src/routes/project.$projectId.tsx` — browser
  frame contract is shape-stable (PRD line 151).
- `src/db/schema.ts` and `migrations/` — no D1 schema change (PRD line 155).
- `alchemy.run.ts` and `src/server.ts` — no new bindings or DO exports.
- Redaction, `ready`-wait timeouts, stale-runner detection, stale-lock cleanup
  on construction, runner-restart continuity — those are phase 3 (plan 020).

## Git workflow

- Branch: `advisor/019-broker-launches-pi-sdk-runner`.
- Commit style: Conventional Commits, e.g.
  `refactor(workspace): broker launches pi sdk runner`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Rewire the DO to launch the runner and consume RunnerEvents

Edit `src/lib/workspace-session-broker.ts`. This is one coherent rewrite of the
DO internals; the public surface (`/start`/`/reply`/`/abort` fetch routes,
`WorkspaceSessionBrokerFrame`, the WebSocket hibernation in the constructor and
`acceptSocket`, `getState`/`setState`/`broadcast`/`sendFrame`) stays intact.

**1a. Replace imports.** Drop the `#/lib/pi-rpc` import block. Add:

```ts
import {
	type RunnerCommand,
	type RunnerEvent,
	RunnerEventBuffer,
	parseRunnerEvent,
	serializeRunnerCommand,
} from "#/lib/runner-protocol";
```

Keep `quoteShellArg` and `trimCompact` by re-implementing them locally in this
file (they are tiny — `quoteShellArg` is 3 lines at `src/lib/pi-rpc.ts:120-122`,
`trimCompact` is 8 lines at `src/lib/pi-rpc.ts:171-178`) OR by adding them to
`src/lib/runner-protocol.ts` — but the latter is plan 018's file and out of
scope, so re-implement locally. Keep the `@cloudflare/sandbox` imports
(`ExecutionSession`, `LogEvent`, `parseSSEStream`, `SessionOptions`) — the
launch/stream shape is reused.

**1b. Rename state fields.** In `BrokerState` (lines 36–47), rename
`piProcessId` → `runnerProcessId` and `pendingUiRequestId` →
`pendingInputRequestId` (PRD line 136 vocabulary). Update every read/write of
these fields throughout the file. Rename `makeProcessId` to emit
`ditto-runner-${...}` (line 146) and `makeBrokerDir` to use
`/tmp/ditto/runner/${...}` (line 150).

**1c. Replace the launch command.** Replace `makePiCommand` (lines 182–208)
with `makeRunnerCommand` that creates the FIFO and launches the runner with
stdin redirected from the FIFO. Target shape:

```ts
function makeRunnerCommand(options: {
	brokerDir: string;
	fifoPath: string;
	modelSpecifier: string;
}): string {
	return [
		"set -euo pipefail",
		`mkdir -p ${quoteShellArg(options.brokerDir)}`,
		`rm -f ${quoteShellArg(options.fifoPath)}`,
		`mkfifo ${quoteShellArg(options.fifoPath)}`,
		[
			`exec env OPENCODE_API_KEY="$OPENCODE_API_KEY"`,
			`MODEL_SPECIFIER=${quoteShellArg(options.modelSpecifier)}`,
			"tsx /opt/ditto/sandbox/runner/index.ts",
			`< ${quoteShellArg(options.fifoPath)}`,
			`2> ${quoteShellArg(`${options.brokerDir}/runner.err`)}`,
		].join(" "),
	].join("; ");
}
```

The DO launches it as `bash -lc <quoted makeRunnerCommand>` via
`session.startProcess(...)` with `cwd: WORKSPACE_PATH` and
`env: { OPENCODE_API_KEY: this.env.OPENCODE_API_KEY }` (so the runner's
`process.env.OPENCODE_API_KEY` is set). The `MODEL_SPECIFIER` is baked into the
command (the runner splits it into provider/model — plan 018 Step 3 item 1). Do
NOT pass `--provider`/`--model` or any Pi CLI flags; the runner is a Node
program, not the Pi CLI.

**1d. Rewrite `ensurePiProcess` → `ensureRunnerProcess`.** Keep the structure
of `ensurePiProcess` (lines 419–464): reuse the sandbox session via
`createOrGetSandboxSession`, derive `brokerDir`/`fifoPath`/`processId` from the
session id, call `session.startProcess(command, { processId, autoCleanup:
false, cwd: WORKSPACE_PATH, env: { OPENCODE_API_KEY }, onExit })`. Change:
- Use `makeRunnerCommand({ brokerDir, fifoPath, modelSpecifier: input.modelSpecifier })`
  instead of `makePiCommand` + `getPiModelParts`.
- Store `runnerProcessId` (not `piProcessId`) and `fifoPath`.
- The `onExit` callback: on non-zero exit mid-run, call `handleRunnerFailure`
  (renamed from `handlePiFailure`).

**1e. Rewrite the command sender.** Replace `sendCommand` (lines 515–553) with
`sendRunnerCommand(command: RunnerCommand): Promise<void>`. It writes one NDJSON
line (`serializeRunnerCommand(command) + "\n"`) into the FIFO via `session.exec`
using the same `buildJsonlWriteCommand`-equivalent shell write (re-implement
locally — it is `printf %s '<json>\n' > '<fifo>'`). Keep the `commandQueue`
serialization (PRD line 140: "Serialize command writes so two client actions
cannot interleave NDJSON into the runner's input") and the `COMMAND_TIMEOUT_MS`
timeout. **Remove the `responseWaiters` map and `rejectResponseWaiters`
entirely** — the runner contract has no `response` event; commands are
fire-and-forget and the runner emits events asynchronously. Remove the
`responsePromise` and the `responseWaiters.set`/`delete` calls.

**1f. Rewrite the event handler.** Replace `handlePiOutput` (lines 562–566) +
`handlePiEvent` (lines 568–641) with:

```ts
private async handleRunnerOutput(chunk: string): Promise<void> {
	for (const event of this.runnerEventBuffer.push(chunk)) {
		await this.handleRunnerEvent(event);
	}
}
```

where `this.runnerEventBuffer` is `new RunnerEventBuffer()` (replacing
`this.jsonlBuffer`). Then `handleRunnerEvent(event: RunnerEvent)` switches on
`event.type` (the Ditto `RunnerEvent` union, not Pi RPC types):

- `ready` — record that the runner is up (set a `runnerReady` flag or resolve a
  `readyPromise`; see Step 1h). Do not persist to D1, do not broadcast.
- `assistant_delta` — `this.broadcast({ type: "assistant_delta", runId, text })`
  (live only; no D1, matching the existing `message_update` path at lines
  589–595).
- `tool_started` — `await this.insertEvent("tool_started", { toolName:
  event.toolName })` (matching lines 606–610).
- `tool_progress` — `this.broadcast({ type: "tool_progress", runId, text:
  trimCompact(event.text) })` (live only; matching lines 611–621).
- `tool_finished` — `await this.insertEvent("tool_finished", { toolName:
  event.toolName, status: event.status })` then `await this.emitWorkspaceChanges()`
  (matching lines 622–628 — the DO's git inspect produces `file_changed`/
  `diff_ready`).
- `file_changed` — `await this.insertEvent("file_changed", { path: event.path })`
  (defensive: if the runner ever emits these, persist them; today the runner
  does not, and the DO's `emitWorkspaceChanges` is the producer).
- `diff_ready` — `await this.insertEvent("diff_ready", { changedFiles:
  event.changedFiles, truncated: event.truncated })`.
- `input_request` — `await this.handleInputRequest(event)` (replaces
  `handleUiRequest`; see Step 1g).
- `done` — if `event.status === "completed"` call `completeRun()`; if
  `"failed"` call `failRun(...)` (use a generic message; the preceding `error`
  event carries the detail). Ignore `"canceled"` (cancellation is durable-first;
  the DO already broadcast `done{canceled}` in `abort`).
- `error` — `await this.insertEvent("error", { reason: trimCompact(event.message)
  })` (do NOT call `failRun` here — the runner follows `error` with a `done{failed}`,
  which triggers `failRun`. If the `error` arrives without a following `done`,
  the `onExit`/stdin-close path catches it).

Keep the canceled-run guard at the top of `handleRunnerEvent` (matching lines
578–586): read state, if `runId` is in `canceledRunIds` or `isRunCanceled`,
return early so late events cannot resurrect a canceled run (PRD line 143).

**1g. Rewrite `handleUiRequest` → `handleInputRequest`.** Replace lines 643–685.
The runner's `input_request` event already carries `requestId`, `question`, and
`placeholder` as typed fields (no `getTextField` guessing needed). Target:

```ts
private async handleInputRequest(event: RunnerEvent): Promise<void> {
	if (event.type !== "input_request") return;
	const state = await this.getState();
	if (!state.activeRunId || !state.projectId || !state.sessionId) return;

	const db = createDb(this.env);
	await db.batch([
		db.update(agentRuns).set({
			status: "needs_input",
			question: event.question,
			recommendedAnswer: event.placeholder ?? null,
			updatedAt: sql`(unixepoch())`,
		}).where(eq(agentRuns.id, state.activeRunId)),
		db.insert(agentRunEvents).values({
			runId: state.activeRunId,
			projectId: state.projectId,
			sessionId: state.sessionId,
			type: "needs_input",
			payload: createAgentRunEventPayload({
				requestId: event.requestId,
				question: event.question,
				placeholder: event.placeholder,
			}),
		}),
	]);
	await this.setState({ ...state, pendingInputRequestId: event.requestId });
	this.broadcast({
		type: "needs_input",
		runId: state.activeRunId,
		question: event.question,
		requestId: event.requestId,
	});
}
```

**1h. Rewrite `start` to wait for `ready`.** The existing `start` (lines 360–383)
calls `ensurePiProcess` then `sendCommand({ type: "prompt" })` and awaits the
Pi RPC `response`. With the runner there is no response — but the FIFO write
will block until the runner opens stdin, which happens after the runner emits
`ready`. So `start` must wait for the `ready` event before sending the `prompt`
command. Add a `readyPromise` (or a `runnerReady` flag + resolver) set in
`handleRunnerEvent`'s `ready` case. In `start`:

```ts
private async start(input: StartRequest): Promise<void> {
	const state = { ...(await this.getState()), sessionId: input.sessionId, ... };
	await this.setState(state);
	await this.ensureRunnerProcess(input);
	await this.waitForRunnerReady();           // NEW: resolve on `ready` event, timeout in plan 020
	await this.sendRunnerCommand({ type: "prompt", id: input.runId, message: input.message });
}
```

For this plan, implement `waitForRunnerReady()` as a simple promise that
resolves when `handleRunnerEvent` sees `ready` (set a `readyResolver` in the
constructor). If `ready` already arrived (runner reused), resolve immediately.
A timeout is plan 020's job; for now, if `ready` never arrives, the
`onExit`/stdin-close failure path will catch a dead runner — but add a TODO
comment that plan 020 adds a timeout.

**1i. Rewrite `reply` and `abort`.**
- `reply` (lines 385–402): drop the `pendingUiRequestId` existence check's old
  error wording; send a `reply` `RunnerCommand`:
  `await this.sendRunnerCommand({ type: "reply", requestId: state.pendingInputRequestId, answer: input.answer })`.
  Then clear `pendingInputRequestId` from state. If `pendingInputRequestId` is
  unset, throw (matching the existing guard) — `answerRunQuestion` already
  verified `needs_input` server-side.
- `abort` (lines 404–417): keep the durable-first `canceledRunIds` append +
  `broadcast({ type: "done", status: "canceled" })`. Send an `abort`
  `RunnerCommand` best-effort:
  `await this.sendRunnerCommand({ type: "abort", id: input.runId }).catch(() => {})`.
  Remove the old `sendCommand({ type: "abort" })` call.

**1j. Update `startLogStream` + `handleProcessLogEvent`.** These (lines 466–513)
keep their structure: `sandbox.streamProcessLogs(processId)` →
`parseSSEStream<LogEvent>(stream)` → `handleProcessLogEvent`. Only the stdout
branch changes: `case "stdout": await this.handleRunnerOutput(event.data)` (was
`handlePiOutput`). The `stderr`/`exit`/`error` branches stay (stderr is
ignored — the runner writes diagnostics to stderr, which the DO does not parse;
exit/error → `handleRunnerFailure`). Rename `handlePiFailure` →
`handleRunnerFailure` (it just calls `failRun`).

Keep `emitWorkspaceChanges` (lines 855–890), `completeRun` (687–717), `failRun`
(719–732), `finishRun` (738–788), `isRunCanceled` (790–798), `clearCanceledRun`
(800–833), `insertEvent` (835–853), `acceptSocket` (892–915) — all unchanged
except renaming `pendingUiRequestId`→`pendingInputRequestId` and
`piProcessId`→`runnerProcessId` where they appear. The `completeRun` backup
refresh (lines 700–714) is preserved (PRD line 30 / 015 durability).

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0. Then
`rg -n "PiRpc|makePiCommand|handlePiEvent|ensurePiProcess|piProcessId|pendingUiRequestId|extension_ui|getPiModelParts|buildJsonlWriteCommand" src/lib/workspace-session-broker.ts`
→ no matches (all Pi-RPC references gone from the DO).

### Step 2: Delete the dead Pi RPC helpers and CLI extension

Now that no code references them:
1. Delete `src/lib/pi-rpc.ts`.
2. Delete `src/lib/pi-rpc.test.ts`.
3. Delete `sandbox/pi/ditto-ask-user.ts`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0 (nothing imports
the deleted files). `pnpm test` → exit 0 (`pi-rpc.test.ts` is gone;
`runner-protocol.test.ts` and the other suites still pass). `pnpm lint` →
exit 0.

### Step 3: Remove the dead extension copy from the Dockerfile

After plan 018, the Dockerfile installs `tsx` and copies the runner + protocol
module. The `COPY sandbox/pi/ /opt/ditto/pi/` line is now dead (the runner has
its own ask-user tool; nothing loads `/opt/ditto/pi/ditto-ask-user.ts`). Remove
that line. Keep the `tsx` install, the Pi global install (the runner imports
`@earendil-works/pi-coding-agent` from the global install), and the runner +
protocol-module copies.

Target Dockerfile shape:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.3 tsx

COPY sandbox/runner/ /opt/ditto/sandbox/runner/
COPY src/lib/runner-protocol.ts /opt/ditto/src/lib/runner-protocol.ts
```

If `sandbox/pi/` is now empty after deleting `ditto-ask-user.ts`, leave the
directory out of the image entirely (do not `COPY` it). Do not remove the Pi
global install — the runner imports the SDK from it.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0. `pnpm lint` →
exit 0. `git diff --check` → exit 0.

### Step 4: Final verification and manual browser smoke

Run the full baseline:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm lint
git diff --check
```

Then the dead-code sweep (must return nothing):

```bash
rg -n "pi-rpc|PiRpc|ditto-ask-user|makePiCommand|handlePiEvent|ensurePiProcess|extension_ui" src/ sandbox/
```

Then inspect scope:

```bash
git status --short
```

Expected: only in-scope files changed/deleted.

Manual browser smoke (requires `pnpm dev` + a ready project sandbox + a valid
`OPENCODE_API_KEY`; the rebuilt image must be built first). Match the Plan 017
verification table:

1. **Normal prompt**: submit one project composer prompt. Confirm the broker
   launches the runner, the browser receives live `assistant_delta` /
   `tool_progress` frames over WebSocket, D1 ends with a real assistant
   `message` + terminal `done{completed}`, the lock releases, and
   `projects.sandboxBackupCreatedAt` refreshes for a mutating run.
2. **ask-user**: submit a prompt that triggers the `ask_user` tool. Confirm an
   `input_request` event arrives, the inline `NeedsInputCard` renders, answering
   it resumes the same run to `done`.
3. **Cancel**: click Stop mid-run. Confirm Ditto marks the run canceled
   durably, posts `/abort`, and late runner events do NOT flip the run back to
   `completed`/`failed`.
4. **Refresh**: reload the page during an active run. Confirm the socket
   reconnects (or the `workspace.get` polling fallback at
   `src/routes/project.$projectId.tsx:35-36` rehydrates from D1) without losing
   canonical history.

If the runner's stdout is ever polluted by non-JSON noise, the launch shape is
wrong — STOP rather than adding a fragile parser.

## Test plan

No new automated seam (PRD line 169: "Everything above [the runner↔DO contract]
already exists and stays shape-stable, so it does not earn a new automated
seam"). The contract module tests from plan 018 still cover the NDJSON mapping.
This plan's verification is command + manual-smoke based:

- `pnpm exec tsc --noEmit --pretty false` covers the DO rewrite typing.
- `pnpm test` confirms deleting `pi-rpc.test.ts` does not break the suite and
  `runner-protocol.test.ts` still passes.
- The dead-code sweep confirms no Pi-RPC references remain.
- The browser smoke validates the DO launch, event relay, D1 persistence,
  backup refresh, cancel semantics, and ask-user UX.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/workspace-session-broker.ts` imports from `#/lib/runner-protocol`
      and has zero imports from `#/lib/pi-rpc`.
- [ ] The DO launches `tsx /opt/ditto/sandbox/runner/index.ts` via `startProcess`
      with stdin from a FIFO and `env.OPENCODE_API_KEY` set.
- [ ] The DO consumes `RunnerEvent`s via `RunnerEventBuffer` + `parseRunnerEvent`
      and sends `RunnerCommand`s via `serializeRunnerCommand` + FIFO write.
- [ ] `WorkspaceSessionBrokerFrame` is byte-for-byte unchanged.
- [ ] `responseWaiters` / `rejectResponseWaiters` are removed (no response
      events in the runner contract).
- [ ] `BrokerState` uses `runnerProcessId` and `pendingInputRequestId`.
- [ ] `src/lib/pi-rpc.ts`, `src/lib/pi-rpc.test.ts`, and
      `sandbox/pi/ditto-ask-user.ts` are deleted.
- [ ] `Dockerfile` no longer copies `sandbox/pi/`; it still installs `tsx` and
      copies the runner + protocol module.
- [ ] `rg -n "pi-rpc|PiRpc|ditto-ask-user|makePiCommand|handlePiEvent|ensurePiProcess|extension_ui" src/ sandbox/`
      returns no matches.
- [ ] No file outside the in-scope list is modified (`git status --short`).
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings.
- [ ] `git diff --check` exits 0.
- [ ] `plans/README.md` status row for Plan 019 is updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 018 is not DONE (the runner or contract module is missing or its tests
  fail) — this plan cannot run without it.
- The code at the locations in "Current state" doesn't match the excerpts (the
  DO has drifted since `55b6151`, or 018 landed differently from its spec).
- The runner cannot be launched via `startProcess` with stdin from a FIFO using
  the installed `@cloudflare/sandbox@0.12.x` API (the transport decision was
  resolved in plan 018 as the named-pipe fallback; if it turns out the runner
  cannot read NDJSON from a FIFO-fed stdin, STOP).
- The runner's stdout is polluted by non-JSON noise so `RunnerEventBuffer`
  cannot parse it deterministically.
- The `ready` event never arrives after launch and there is no way to
  distinguish "runner still starting" from "runner dead" without a timeout
  (plan 020 adds the timeout; if blocking is unavoidable here, STOP and let
  plan 020 land the timeout first).
- The rewire appears to require touching an out-of-scope file (the runner, the
  tRPC router, the browser, D1 schema, `alchemy.run.ts`, or `src/server.ts`).
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- **The DO still does the `git status` workspace inspect** via
  `emitWorkspaceChanges` after a `tool_finished` event. A future optimization
  can move that into the runner (so the runner emits `file_changed`/
  `diff_ready` as `RunnerEvent`s and the DO becomes a pure relay), but that is
  deferred — git inspect is a Ditto-side concern, not Pi wire protocol, so the
  DO still satisfies "contains no Pi wire-protocol knowledge" (PRD line 25).
- **No `ready`-wait timeout yet.** `start` awaits the `ready` event with no
  timeout; a dead runner that never emits `ready` would hang `start` until the
  `onExit` callback fires. Plan 020 adds a bounded `ready` wait.
- **No stale-runner detection on DO construction.** If the DO hibernates and
  the runner process dies while the DO is asleep, the next `start` reuses the
  stored `runnerProcessId` and `startLogStream` may fail silently. Plan 020
  adds construction-time liveness checks + stale-lock cleanup.
- **Runner-restart continuity is still open** (PRD line 204). On runner
  restart, the new runner starts a fresh `AgentSession` (in-memory); D1 is the
  visible history. Plan 020 settles this decision explicitly.
- Reviewers should scrutinize: that `WorkspaceSessionBrokerFrame` is unchanged;
  that `responseWaiters` is fully removed (no dangling response handling);
  that the canceled-run guard still runs before any terminal update; that the
  `completeRun` backup-refresh path is intact; and that the FIFO write stays
  serialized on `commandQueue`.
