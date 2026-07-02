# Pi SDK Session Broker PRD

**Owner:** Ayan
**Status:** Draft
**Date:** 2026-07-02

## Problem Statement

When a user sends a coding instruction in Ditto, the agent runner currently drives Pi as a CLI subprocess in RPC mode. To make that work, the session-broker Durable Object has to hand-roll a named-pipe transport, write Pi RPC commands into the pipe, stream Pi's stdout, and parse Pi's wire protocol — all inside the Worker.

From the user's perspective this shows up as fragility and slow progress on the agent layer: every Pi capability (a new tool, a model cycle, compaction, a custom skill) has to be re-expressed as an RPC command and re-parsed in the Worker, the JSONL stream can be poisoned by shell noise, and a large chunk of low-level process management lives in the wrong layer. The user cannot feel these internals directly, but they block a reliable, inspectable, repo-native coding agent — which is Ditto's core promise.

## Solution

Pi runs through its **typed SDK** inside the sandbox container. A small Node.js *agent runner* program uses `createAgentSession()`, `session.prompt()`, and `session.subscribe()` to run the agent loop, owns all Pi SDK complexity (model resolution, the ask-user tool, event mapping), and emits a stream of Ditto-defined structured events.

The `WorkspaceSessionBroker` Durable Object shrinks to a broker: it launches the runner inside the container via the Cloudflare Sandbox SDK, relays live events to the browser over WebSocket, persists canonical events to D1, and relays user replies and cancels back into the container. The TanStack Start app stays a client-facing shell — tRPC mutations into the DO and live WebSocket rendering, with no agent-protocol logic in the browser.

When Pi needs input, the ask-user tool emits an `input_request` event; the DO forwards it immediately to the browser so the user can answer inline in the same chat. The reply travels back through the DO into the runner, the blocked tool resolves, and Pi continues from there.

## User Stories

1. As a founder importing a repo, I want to send a coding instruction and see the agent start working immediately, so that I don't have to set up a local environment to make progress.
2. As a founder, I want the agent's reasoning, tool calls, and file changes to stream into the chat as they happen, so that I can trust what the agent is doing rather than staring at a spinner.
3. As a founder, I want a single durable conversation per chat tab, so that I can revisit earlier instructions and the agent remembers context within that session.
4. As a founder, I want the agent to pause and ask me a clarifying question inline when it is unsure, so that it does not guess wrong and waste a mutating run.
5. As a founder, I want to answer that clarification in the same chat input, so that the agent resumes the same run instead of starting over.
6. As a founder, I want to cancel a run mid-flight, so that a runaway agent does not keep mutating my project while I regroup.
7. As a founder, I want a canceled run to stay canceled, so that late agent output cannot flip my project back to "completed" after I stopped it.
8. As a founder, I want to refresh the page during an active run, so that a tab reload does not lose my place or the canonical history.
9. As a founder, I want to pick a model per run, so that I can trade cost and quality depending on the task.
10. As a founder, I want my selected model to persist across sessions, so that I do not reselect it every time.
11. As an engineer, I want the agent to read, edit, run, and verify inside the project sandbox, so that changes are grounded in the real repo state.
12. As an engineer, I want changed files and diffs to appear as real data backed by git, so that I can review exactly what the agent did.
13. As an engineer, I want only one mutating run on my project at a time, so that concurrent edits cannot corrupt the workspace.
14. As an engineer, I want a failed mutating run to release the project lock, so that I am not blocked after an error.
15. As an engineer, I want a killed or crashed runner to leave a clean failed state and release the lock, so that a dead process does not strand my project.
16. As an engineer, I want successful mutating runs to refresh the sandbox backup before completing, so that my changes survive a sandbox restart.
17. As an engineer, I want the agent to never push, open PRs, deploy, or destroy sandboxes on its own, so that outside-world effects stay under my explicit control.
18. As an engineer, I want no provider keys, GitHub tokens, private keys, or `.env` values to appear in chat events or D1, so that secrets never leak through the agent surface.
19. As an engineer, I want project-local `.pi` extensions, skills, prompt templates, and themes from imported repos to stay disabled, so that an untrusted repo cannot inject dynamic Pi resources into my runner.
20. As a low-code builder, I want clear running / waiting-for-input / completed / failed / canceled states, so that I always know what the agent is doing without reading logs.
21. As a low-code builder, I want honest empty and disabled states for not-yet-built actions like commit-and-push, so that I am not misled into clicking no-op controls.
22. As a product/design teammate, I want to make small safe code changes without local setup, so that I can contribute without a developer environment.
23. As an agency contractor, I want to work across many client repos from the browser, so that I do not context-switch between local checkouts.
24. As the maintainer, I want the agent layer to be extensible (custom tools, skills, context files, model cycling) without touching the Durable Object or the browser, so that new Pi capabilities land quickly.
25. As the maintainer, I want the Durable Object to contain no Pi wire-protocol knowledge, so that the Worker stays small and Pi upgrades do not ripple into broker parsing logic.
26. As the maintainer, I want D1 to remain the canonical event log, so that the runner's in-memory session is a runtime convenience and never the source of truth.
27. As the maintainer, I want the runner's event stream to be clean NDJSON on stdout with diagnostics on stderr only, so that the broker's line parser is never poisoned by shell noise.
28. As the maintainer, I want the public tRPC API (`startRun`, `answerRunQuestion`, `cancelRun`) to stay shape-stable, so that the rewrite is internal to the agent layer.
29. As the maintainer, I want the browser WebSocket frame contract to stay shape-stable, so that the UI does not need a parallel rewrite.
30. As the maintainer, I want the rewrite to preserve the existing sandbox readiness and backup-refresh paths, so that I do not rebuild Plan 015's durability layer.
31. As the maintainer, I want the ask-user mechanism to be a first-class typed tool rather than an extension-UI RPC translation, so that input requests are direct and testable.
32. As the maintainer, I want a single high test seam — the runner ↔ broker NDJSON contract — so that the protocol is verified in isolation without spawning sandboxes.

## Implementation Decisions

### Three-layer split

- **Container layer:** a Node.js agent runner program baked into the sandbox image. It imports the Pi SDK, creates an in-memory `AgentSession`, subscribes to typed SDK events, runs prompts, and exposes a Ditto-owned command/event contract.
- **Worker/DO layer:** the `WorkspaceSessionBroker` Durable Object, one per `workspace_sessions.id`. It launches the runner via the Cloudflare Sandbox SDK, consumes the Ditto event stream, relays live frames to the browser, persists canonical events to D1, and relays replies/aborts back into the container.
- **Browser layer:** the TanStack Start app as a client shell — tRPC mutations to the DO and live WebSocket rendering. No agent-protocol logic.

### Why SDK over RPC

The runner is a Node.js program running inside the same sandbox process as Pi. Pi's own docs state the SDK is preferred when the integration wants type safety, direct access to agent state, programmatic tool/extension customization, and runs in the same Node.js process — all of which apply. RPC mode is for language-agnostic or process-isolated clients, which this is not. The rewrite therefore inherits a Ditto-owned wire contract instead of Pi's CLI RPC protocol.

### Runner session strategy

- The runner uses `SessionManager.inMemory()` so D1 — not Pi — remains the durable session of record.
- The runner is a long-lived process per workspace session (reused across reconnects via a deterministic process id derived from the session id).
- Conversation continuity within a live runner process is acceptable; cross-restart continuity is reconstructed from D1 history or treated as a new conversation (left open — see Further Notes).

### Hardening preserved

The Plan 017 hardening intent is preserved, expressed via SDK options rather than CLI flags: telemetry/version-check disabled, no discovery of project-local `.pi` extensions, skills, prompt templates, or themes from imported repos; plain context files such as `AGENTS.md` remain in scope. The agent has broad sandbox permission; generic per-tool approvals are not added.

### Ask-user tool

The ask-user mechanism becomes a `defineTool()` custom tool passed via `customTools`. It does **not** call `ctx.ui.input()` and does **not** rely on `extension_ui_request`/`extension_ui_response` RPC translation. Instead it emits a Ditto `input_request` event and returns a Promise that the runner resolves when it receives a matching `reply` command. The runner keeps an in-memory map of pending request ids → resolve functions.

### Transport decision

The Durable Object (Worker runtime) cannot import or call Pi SDK functions directly — they live in different processes. A wire contract is therefore required. The contract is a Ditto-owned NDJSON protocol over the runner's stdin/stdout:

- Runner stdout: one JSON object per line, each a Ditto event.
- Runner stdin: one JSON object per line, each a Ditto command.

The installed Cloudflare Sandbox SDK does not expose a direct `stdin` write API. The implementation must resolve this explicitly:

- **Preferred:** bump the Sandbox SDK to a version exposing `stdin` / `execInteractive`, eliminating the named-pipe workaround.
- **Fallback:** keep the named-pipe bridge for command input, but carrying the simpler Ditto command set instead of Pi RPC. Runner stdout is still consumed via `streamProcessLogs()` + NDJSON line buffering.

Either way the broker parses Ditto events, never Pi RPC events.

### Wire contract (prototype type shape)

This type shape encodes the decision-rich parts of the contract precisely; it is the prototype, not a working demo.

```ts
// DO -> Runner (stdin), one NDJSON object per line
type RunnerCommand =
  | { type: "prompt"; id: string; message: string }
  | { type: "reply"; requestId: string; answer: string }
  | { type: "abort"; id: string };

// Runner -> DO (stdout), one NDJSON object per line
type RunnerEvent =
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

### SDK → Ditto event mapping (owned by the runner)

| SDK event | Ditto event(s) |
|---|---|
| `message_update` (`text_delta`) | `assistant_delta` |
| `tool_execution_start` | `tool_started` |
| `tool_execution_update` | `tool_progress` |
| `tool_execution_end` | `tool_finished` (+ `file_changed`/`diff_ready` after git inspect) |
| `ask_user` tool invocation | `input_request` |
| `agent_end` | `done { status: "completed" }` |
| `extension_error` / runner exception | `error` + `done { status: "failed" }` |

### Durable Object responsibilities (slimmed)

- Rehydrate hibernated browser WebSockets on construction; set a heartbeat auto-response.
- Store minimal live state in DO storage: session id, user id, project id, sandbox id, active run id, runner process id, pending input request id, canceled run ids.
- Create or reuse one sandbox execution session per workspace session, keyed by the session id.
- Resolve the project sandbox via the existing Plan 015 `getProjectSandbox` / `ensureProjectSandbox` path — never create a new sandbox.
- Launch the runner via `startProcess` with a deterministic process id so it can detect and reuse an already-running runner after reconnection.
- Serialize command writes so two client actions cannot interleave NDJSON into the runner's input.
- Forward live deltas and `input_request` to the browser immediately; persist terminal/compact events to D1.
- On runner exit mid-run: mark the run failed, release the lock when owned, insert a redacted `error` + `done`.
- Check run status and `canceledRunIds` before applying terminal updates so late events cannot resurrect a canceled run.

### tRPC public API (unchanged shape)

`workspace.startRun`, `workspace.answerRunQuestion`, and `workspace.cancelRun` keep their names and input shapes. `startRun` continues to authorize ownership, ensure sandbox readiness, acquire the mutating lock via conditional update, create/reuse the session, insert the run + initial user message event via `db.batch(...)`, then post `/start` to the Durable Object. `answerRunQuestion` verifies `needs_input`, posts `/reply`, then sets the run back to `running`. `cancelRun` marks canceled durably first, releases the lock, inserts a `done`, then posts `/abort` best-effort.

### Browser frame contract (unchanged shape)

The Durable Object continues to emit the existing `WorkspaceSessionBrokerFrame` types (`snapshot`, `assistant_delta`, `tool_progress`, `needs_input`, `done`, `error`) to the browser. The socket hook and chat UI need no parallel rewrite; only minor adjustments if a frame field shifts.

### Schema

No D1 schema change. The existing `projects`, `workspace_sessions`, `agent_runs`, and `agent_run_events` tables remain the canonical model, including the `modelSpecifier` column on `agent_runs`.

### Run lifecycle and cancellation

Runs transition through `pending`, `running`, `needs_input`, `completed`, `failed`, `canceled`. Terminal states set `finishedAt` and release `projects.activeAgentRunId` only when the run owns the lock. Cancellation calls `session.abort()` on the runner and is durable-first; late runner events are ignored for canceled runs.

### Secrets and redaction

No provider keys, GitHub tokens, private keys, or `.env` values are stored in D1 or emitted in frames. The runner redacts tool output before emitting `tool_progress` excerpts; event payloads stay compact and `schemaVersion: 1`.

## Testing Decisions

### What makes a good test here

A good test exercises **external behavior at a single high seam**, not implementation details. For this rewrite the one new external boundary is the Runner ↔ Durable Object NDJSON contract: commands in, events out. That contract is pure JSON and fully verifiable without a sandbox, a Durable Object, or credentials. Everything above it (browser frames, D1 persistence) already exists and stays shape-stable, so it does not earn a new automated seam.

### Automated seam (the one seam)

A pure **protocol-mapping module** plus its Vitest tests. The module maps:

- Ditto commands (`prompt` / `reply` / `abort`) → the runner dispatch actions (call `session.prompt`, resolve a pending `input_request`, call `session.abort`), expressed as pure data decisions where possible.
- SDK events (or simulated SDK event shapes) → Ditto events, including the `input_request` emission from the ask-user tool and the terminal `done`/`error` mapping.

This is the single automated seam agreed with the maintainer. It reuses the repo's existing pattern for pure protocol unit tests (the prior Pi RPC helpers had a sibling test file of exactly this shape).

### Manual smoke seam (not automated)

End-to-end browser prompt → runner → D1, matching the Plan 017 verification table: a normal prompt completes with canonical D1 events; an `ask_user` prompt pauses and resumes on inline answer; Stop cancels and late events do not resurrect; a page refresh reconnects or falls back to D1 polling. This requires a sandbox and credentials and stays manual, consistent with the maintainer's standing preference against a broad new integration/browser harness.

### Prior art

The repo already ships pure unit tests for protocol/policy helpers (env-var parsing, sandbox backup serialization, workspace policy, the prior RPC helpers). The new protocol-mapping tests follow that same style: small, focused, no process spawning, no Cloudflare runtime.

## Out of Scope

- D1 schema changes.
- Changes to the Alchemy Durable Object namespace/binding shape beyond an optional Sandbox SDK version bump for `stdin`.
- New tRPC procedures or new public input fields.
- A raw terminal / xterm mirror of Pi's TUI.
- Generic per-tool approval UX for sandbox-internal actions.
- Multi-agent swarms, per-session sandboxes, or multi-user real-time collaboration.
- GitHub push/PR/deploy actions (remain explicit user actions).
- Concurrent mutating runs or changing the one-sandbox-per-project model.
- A broad new automated integration or browser test harness.
- Storing full terminal transcripts, full diffs, or unbounded artifacts in D1.
- Backward compatibility branches for historical sessions/runs/events beyond what D1 migrations require.

## Further Notes

- **Runner restart continuity is an open question.** When a runner process restarts (container sleep, crash, redeploy), the new runner could either replay D1 history into a fresh `AgentSession` to restore model context (richer, costs tokens) or start a new conversation and rely on D1 as the visible history (simpler, loses in-memory model state). This should be settled during implementation, not in the PRD.
- **Extensibility is a follow-up, not v1.** Once the contract is stable, the runner can gain model cycling, thinking-level control, curated skills/context files, and compaction triggers without Durable Object or UI changes. Read-only concurrent runs (relaxing the one-active-run-per-project lock) can be revisited once the runner is proven.
- **Implementation should preserve Plan 017's discipline:** explicit drift checks, STOP conditions, in-scope/out-of-scope file lists, and command + manual-smoke verification. The standard repo verification commands (`tsc --noEmit`, `pnpm lint`, `pnpm test`, `git diff --check`) remain the baseline.
- **Recommended sequencing:** (1) runner spike proving clean NDJSON in/out and resolving the transport decision; (2) Durable Object rewire preserving the browser frame contract and D1 persistence; (3) hardening — redaction, timeouts, runner reuse, stale-lock cleanup.
- Do not commit provider credentials, generated Alchemy state, `.env`, or secret-bearing command output.
