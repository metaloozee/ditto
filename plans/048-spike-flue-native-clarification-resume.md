# Plan 048: Spike Flue-Native Clarification and Resume

> **Executor instructions**: This is an investigate-then-implement plan for a
> lower-confidence PRD gap. The design spike (Step 1) has already been
> completed by the advisor during reconciliation — read the "Spike findings"
> section below before starting Step 2. The installed Flue runtime
> `@flue/runtime@1.0.0-beta.1` has NO native pause/resume primitive, but it
> DOES expose an observable structured tool signal. The implementation uses a
> `request_clarification` tool whose structured result is the product
> boundary, and a multi-turn re-prompt (new `POST /agents/:name/:id` on the
> same agent instance) as the "resume" contract. If during implementation you
> discover the structured tool result cannot be reliably parsed from the
> `tool` event's `result` field, STOP and report.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 6f623b2..HEAD -- src/lib/flue-event-projection.ts src/lib/flue-event-projection.test.ts src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/integrations/trpc/routers/workspace.ts src/components/ai-chat.tsx src/hooks/use-workspace-session-socket.ts .flue/agents/project-coder.ts .flue/workflows/ditto-project-run.ts plans/README.md
> git diff --stat -- src/lib/flue-event-projection.ts src/lib/flue-event-projection.test.ts src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/integrations/trpc/routers/workspace.ts src/components/ai-chat.tsx src/hooks/use-workspace-session-socket.ts .flue/agents/project-coder.ts .flue/workflows/ditto-project-run.ts plans/README.md
> ```
>
> If the working-tree diff (second command) shows changes to any in-scope
> file other than `plans/README.md`, STOP and report — another plan may have
> landed concurrently.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: 034, 039; 047 (DONE — lease renewal is available)
- **Category**: direction / correctness
- **PRD phase**: Previous-phase gap (`needs_input` / answer clarification)
- **Planned at**: commit `f09866f`, 2026-07-04
- **Reconciled at**: commit `6f623b2`, 2026-07-06, after advisor completed the
  Step 1 design spike and plans 044-047 landed. Line numbers in "Current
  state" updated; Steps 2-5 rewritten to match the actual Flue contract.

## Why this matters

The PRD includes "answer clarification" as a product API, user stories 11-12
require the agent to ask and resume, and the event projection table includes
`needs_input`. The legacy `WorkspaceSessionBroker` path supports
`input_request`, but the current Flue path does not. `workspace.answerRunQuestion`
always posts to the legacy broker, so a Flue run that entered `needs_input`
would not resume correctly.

## Spike findings (Step 1 — completed by advisor)

The advisor inspected the installed `@flue/runtime@1.0.0-beta.1` type
declarations (`node_modules/@flue/runtime/dist/types-DU_ZkvZJ.d.mts`), the
runtime implementation (`handle-agent-GRq-xcch.mjs`,
`persisted-image-placement-qyxGKalp.mjs`), the Cloudflare routing
(`cloudflare/internal.mjs`), the tool contract
(`tool-types-6GUMYEa-.d.mts`), and the bundled docs
(`docs/concepts/durable-execution.md`, `docs/api/agent-api.md`,
`docs/api/events-reference.md`, `docs/sdk/agents.md`).

**Findings:**

1. **Flue has NO native pause/resume primitive.** The `FlueSession`
   interface (`types-DU_ZkvZJ.d.mts:467-526`) exposes `prompt()`, `skill()`,
   `task()`, `shell()`, `compact()`, `delete()` — there is no
   `resume()`, `provideInput()`, `submitInput()`, or `awaitInput()`. The
   `CallHandle` (`types-DU_ZkvZJ.d.mts:460-465`) has `abort()` but no
   `resume()`.

2. **Flue has NO `needs_input` event type.** The full `FlueEventVariant`
   union (`types-DU_ZkvZJ.d.mts:814-960`) is: `run_start`, `run_resume`,
   `agent_start`, `agent_end`, `turn_start`, `turn_request`, `turn_messages`,
   `message_start`, `message_end`, `text_delta`, `thinking_start`,
   `thinking_delta`, `thinking_end`, `tool_start`, `tool`, `turn`,
   `task_start`, `task`, `compaction_start`, `compaction`, `operation_start`,
   `operation`, `log`, `idle`, `submission_settled`, `run_end`. There is no
   `needs_input`, `pause`, `await_input`, or `input_request` variant.

3. **`run_resume` is recovery-only.** Per
   `docs/api/events-reference.md:33`: "Recovery continued handling an
   admitted workflow run after interruption." It is emitted by the
   reconciliation system after a crash/restart, not by a product-level
   pause/resume API.

4. **Flue has NO `/reply` HTTP endpoint.** The direct agent HTTP routes
   (`handle-agent-GRq-xcch.mjs:251-271`) are: `POST /agents/:name/:id`
   (admit a new prompt submission, return stream coordinates) and
   `GET /agents/:name/:id?offset=&live=long-poll` (read the Durable Stream).
   The `?wait=result` query parameter switches to synchronous-result mode.
   There is no `/reply`, `/resume`, or `/input` sub-route.

5. **A tool's `execute` returns `Promise<string>`** (`tool-types-6GUMYEa-.d.mts`:
   `execute: (args, signal?) => Promise<string>`). When the Promise resolves,
   the result is sent back to the LLM and the agent loop **continues** to the
   next turn. A tool cannot "pause" the agent — the agent produces more
   events (text, more tool calls, or `submission_settled`) after the tool
   returns. A blocking tool (a Promise that never resolves) is not durable:
   the Flue DO would reset on idle, reconciliation would mark the tool as
   "interrupted with unknown outcome," and the submission would be settled as
   failed (see `docs/concepts/durable-execution.md:38`).

6. **The structured tool result IS an observable signal.** The `tool` event
   (`types-DU_ZkvZJ.d.mts:878-883`) has a `result?: any` field. A tool can
   return a JSON string and the bridge can parse it from the `tool` event's
   `result` after it passes through `compactFlueText` (which redacts secrets
   and truncates to 2000 chars — the JSON must stay under that limit and
   contain no secret patterns).

7. **"Resume" = new prompt on the same agent instance.** Per
   `docs/sdk/agents.md:6`: "Each agent instance is a single conversation."
   Sending a new `POST /agents/:name/:id` with the user's answer continues
   the same conversation — it does NOT create a new canonical thread. The
   existing `adapter.dispatch({ agentName, agentInstanceId, message })`
   (`src/lib/flue-dispatch-adapter.ts:111-141`) already does exactly this.

**Conclusion:** The viable contract is a structured tool result + multi-turn
re-prompt. There is no native pause. The agent calls a `request_clarification`
tool, the tool returns a structured result, the agent finishes its turn
(`submission_settled` fires), the bridge marks the run as `needs_input`, and
when the user answers, the bridge sends a new `POST /agents/:name/:id` with
the answer on the same agent instance. The bridge must NOT stop consuming
immediately upon seeing the tool result — it must wait for
`submission_settled` because the agent continues after the tool returns.

## Current state

- `src/lib/workspace-policy.ts:6` includes run status `needs_input`; line 22
  includes the `needs_input` event type; line 42 treats `needs_input` as an
  active run status.
- `src/hooks/use-workspace-session-socket.ts:81` handles live `needs_input`
  frames (sets `needsInput: { runId, question, requestId }`).
- `src/components/ai-chat.tsx:145` renders a `NeedsInputCard` and
  `src/components/ai-chat.tsx:451` calls `workspace.answerRunQuestion`.
- `src/integrations/trpc/routers/workspace.ts:1248` implements
  `answerRunQuestion`; `src/integrations/trpc/routers/workspace.ts:1279`
  always posts `/reply` to `WorkspaceSessionBroker` via
  `postWorkspaceSessionBroker`. The run status is set back to `running` at
  line 1289 and a user answer event is inserted at line 1300.
- `src/lib/flue-event-projection.ts:69` `mapFlueEventToDittoEvents` maps
  `text_delta`, `tool_start`, `tool`, `log`, `operation`, `submission_settled`,
  and `run_end`. There is no `needs_input` projection. The `tool` case
  (line 108) puts `compactFlueText(event.result)` into the payload but does
  not inspect it for a structured signal.
- `src/lib/flue-run-bridge.ts:321` `fetch` handles `/start` and `/abort`; no
  `/reply` route. `FlueRunBridgeState` (line 45) has no `pendingInputRequestId`
  or `pendingInputQuestion` fields. The consumption loop (line 518)
  calls `finishRun` when `projection.terminalStatus` is set (line 595).
- `.flue/agents/project-coder.ts:28` instructs the model to "ask for
  clarification" but there is no tool that produces a structured signal. The
  agent has 5 read-only tools (lines 180-287); no `request_clarification`
  tool exists.
- `.flue/workflows/ditto-project-run.ts:57` calls `session.prompt` with
  `createMutatingProjectTools` as extra tools; the project-coder agent's
  built-in tools are also available.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Focused tests | `pnpm test -- src/lib/flue-event-projection.test.ts src/lib/flue-run-bridge.test.ts` | all pass |
| Full tests | `pnpm test` | all pass |
| Lint | `pnpm lint` | exit 0, only the 2 known warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85` |
| Flue build | `pnpm flue:build` | exit 0, known DO migration warning only |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:
- `src/lib/flue-event-projection.ts` and `src/lib/flue-event-projection.test.ts`
  — detect the structured `needs_input` tool result and emit a
  `needs_input` event + frame.
- `src/lib/flue-run-bridge.ts` and `src/lib/flue-run-bridge.test.ts` —
  pause-on-`submission_settled`-with-pending-input, `POST /reply` route,
  re-dispatch on resume.
- `src/integrations/trpc/routers/workspace.ts` — route `answerRunQuestion` to
  `FlueRunBridge /reply` for Flue-backed runs.
- `.flue/agents/project-coder.ts` — add the `request_clarification` tool.
- `plans/README.md` — status row.

**Out of scope**:
- Generic tool approval UX.
- Queueing mutating runs.
- UI redesign of the existing `NeedsInputCard`.
- The mutating workflow `.flue/workflows/ditto-project-run.ts` — the
  project-coder agent's built-in tools are available in the workflow too
  (the workflow passes `tools:` as EXTRA tools, not replacements), so no
  workflow change is needed.
- `src/components/ai-chat.tsx` — the existing `NeedsInputCard` and
  `answerRunQuestion` call should work without UI changes.

## Git workflow

- Branch: `advisor/048-flue-native-clarification-resume`
- Commit style: `feat(flue): support clarification resume`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Design spike (ALREADY COMPLETED)

The advisor completed the design spike during reconciliation. Read the
"Spike findings" section above. Do not re-investigate the Flue runtime types
— the findings are authoritative for this plan. Proceed to Step 2.

### Step 2: Add the `request_clarification` tool to the project-coder agent

In `.flue/agents/project-coder.ts`, add a new tool to the `tools` array
(around line 286, after `run_readonly_command`). The tool:

- Name: `request_clarification`
- Description: "Ask the user a clarifying question. Call this tool when you
  need more information before proceeding. After calling this tool, stop
  working and wait for the user's answer."
- Parameters (valibot): `v.object({ question: v.string(), requestId:
  v.optional(v.string()) })`
- Execute: returns a JSON string:
  `JSON.stringify({ dittoEvent: "needs_input", question: args.question,
  requestId: args.requestId ?? randomId() })`

Use a simple ID generator for `requestId` if not provided — e.g.
`crypto.randomUUID()` (available in the Cloudflare Worker runtime). The
returned string must stay under 2000 characters and contain no secret
patterns (it will pass through `compactFlueText` + `redactSecrets`).

Update the agent instructions (line 28, `readOnlyInstructions`) to say:
"If a request requires edits or mutation, call the `request_clarification`
tool to ask the user for clarification. Do not explain in natural language
that mutating tools are not enabled — use the tool so the product can pause
the run durably."

Keep `mutatingInstructions` (line 30) unchanged — the mutating path may also
call `request_clarification` if needed, but the instructions should not
encourage it for the common case.

**Verify**: `pnpm flue:build` exits 0 (the tool compiles against the
installed `@flue/runtime` API). No test for the tool itself — it is a thin
wrapper whose behavior is verified through projection + bridge tests.

### Step 3: Add projection support for the `needs_input` tool signal

In `src/lib/flue-event-projection.ts`:

1. Add a `needs_input` variant to `FlueProjectedFrame`:
   `| { type: "needs_input"; question: string; requestId: string }`.

2. Add a `needsInput` field to `FlueEventProjection`:
   `{ question: string; requestId: string } | null`.

3. In the `tool` case (line 108), after computing `result` from
   `compactFlueText(event.result)`, attempt to parse the result as JSON and
   check for `{ dittoEvent: "needs_input", question, requestId }`. If the
   parse succeeds and `dittoEvent === "needs_input"` and both `question` and
   `requestId` are non-empty strings:
   - Set `needsInput: { question, requestId }`.
   - Add a `needs_input` event to `events`:
     `projectEvent("needs_input", { question, requestId })`.
   - Add a `needs_input` frame to `frames`:
     `{ type: "needs_input", question, requestId }`.
   - Still keep the `tool_finished` event in `events` (the tool did
     complete — the bridge needs both signals).
   - Do NOT set `terminalStatus`.

4. If the JSON parse fails, `dittoEvent` is missing/wrong, or fields are
   empty/missing, treat it as a normal tool result — do not add the
   `needs_input` signal. This is the "malformed signal is ignored, not fatal"
   behavior.

5. Update `emptyProjection()` (line 211) to include `needsInput: null`.

**Verify**: `pnpm test -- src/lib/flue-event-projection.test.ts` — add these
tests:
- A `tool` event whose `result` is
  `'{"dittoEvent":"needs_input","question":"Which branch?","requestId":"r1"}'`
  produces: a `tool_finished` event, a `needs_input` event, a `needs_input`
  frame, `needsInput: { question: "Which branch?", requestId: "r1" }`, and
  `terminalStatus: null`.
- A `tool` event whose `result` is `'{"dittoEvent":"needs_input"}'` (missing
  `question` and `requestId`) produces only the normal `tool_finished`
  projection — no `needs_input` event/frame, `needsInput: null`.
- A `tool` event whose `result` is `'not json'` produces only the normal
  `tool_finished` projection — `needsInput: null`.
- A `tool` event whose `result` is
  `'{"dittoEvent":"something_else","question":"x","requestId":"r1"}'` produces
  only the normal `tool_finished` projection — `needsInput: null`.
- A `tool` event whose `result` contains a secret (e.g.
  `'{"dittoEvent":"needs_input","question":"use key sk-test-xxx","requestId":"r1"}'`)
  still redacts the secret in the `question` field of the `needs_input`
  event/frame (the redaction happens via `compactFlueText` before parsing, so
  parse the REDACTED result — if the redaction corrupts the JSON, the parse
  fails and the signal is ignored, which is safe).

Follow the existing test pattern in
`src/lib/flue-event-projection.test.ts:45-68` (the "projects a successful
tool completion" test) for structure.

### Step 4: Pause Flue runs in `FlueRunBridge` on pending input

In `src/lib/flue-run-bridge.ts`:

1. Add two fields to `FlueRunBridgeState` (line 45):
   - `pendingInputRequestId?: string`
   - `pendingInputQuestion?: string`

2. In `consumeFlueStream` (line 518), after computing `projection` (line 567):
   - If `projection.needsInput` is set, persist it to state:
     `await this.setState({ ...(await this.getState()),
     pendingInputRequestId: projection.needsInput.requestId,
     pendingInputQuestion: projection.needsInput.question })`.
   - Continue consuming — do NOT return or stop the loop. The agent is still
     running and will produce more events until `submission_settled`.

3. In `consumeFlueStream`, in the frame broadcasting loop (line 581), add a
   branch for `frame.type === "needs_input"`:
   `this.broadcast({ type: "needs_input", runId, question: frame.question,
   requestId: frame.requestId })`.
   This matches the existing `WorkspaceSessionBroker` frame shape
   (`src/lib/workspace-session-broker.ts:88`) so `use-workspace-session-socket`
   handles it without changes.

4. In `consumeFlueStream`, where `projection.terminalStatus` is checked
   (line 595), add a guard BEFORE calling `finishRun`:
   - Re-read state. If `state.pendingInputRequestId` is set AND
     `projection.terminalStatus === "completed"`:
       - Call a new `pauseRunForInput(runId)` method instead of `finishRun`.
       - Return from `consumeFlueStream`.
   - Otherwise (no pending input, or terminal status is `"failed"`): call
     `finishRun` as before.

5. Add a `private async pauseRunForInput(runId: string)` method:
   - Re-read state; bail if the run is no longer active or is canceled.
   - Update `agentRuns.status = "needs_input"`, set `question` and
     `recommendedAnswer: null`, via `createDb(this.env)`.
   - The `needs_input` event was already inserted by `insertProjectedEvents`
     in Step 3. Do not insert it again.
   - Broadcast `{ type: "needs_input", runId, question:
     state.pendingInputQuestion, requestId: state.pendingInputRequestId }`
     (in case the earlier frame broadcast in step 3 was missed by a client
     that connected late — this is idempotent for the UI).
   - Do NOT release the mutation lease. If `isMutating === true`, the lease
     renewal alarm (from plan 047) keeps it alive. If the lease expires
     while waiting, the next `/reply` should fail cleanly (Step 5 checks
     lease validity before resuming).
   - Do NOT call `clearPeriodicCheckpointAlarm` — the periodic checkpoint
     alarm can continue if the run is mutating and waiting for input; this
     is safe because checkpointing a paused run is a no-op (no new tool
     events to checkpoint). If the alarm fires during the pause,
     `checkpointPeriodicMutatingRun` should be a no-op or safely skip.
   - Set `this.consumingRunId = null` implicitly (the `finally` block in
     `resumeFlueStreamIfNeeded` line 510 handles this).

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts` — add tests:
- A `tool` event with a `needs_input` result followed by a
  `submission_settled` (outcome: "completed") event: the run is paused
  (status `needs_input`), the `needs_input` frame is broadcast, and
  `finishRun` is NOT called.
- A `tool` event with a `needs_input` result followed by a
  `submission_settled` (outcome: "failed") event: the run IS finished as
  failed (a failed submission overrides the pending input — the agent
  crashed, so the question is moot).
- A `submission_settled` (outcome: "completed") event with NO prior
  `needs_input` tool result: `finishRun` is called as normal (status
  `completed`). This verifies the guard does not break the existing path.

Follow the existing test pattern in `src/lib/flue-run-bridge.test.ts` — use
the same mock setup (lines 1-59) and the same fake adapter/stream
construction used by existing consumption tests. Look at how existing tests
feed events through `consumeFlueStream` and assert on D1 updates +
broadcasts.

### Step 5: Add `FlueRunBridge` `POST /reply`

In `src/lib/flue-run-bridge.ts`:

1. Add a `case "/reply":` branch to the `fetch` method's switch (line 333).
   Call `await this.reply(parseReplyRequest(await request.json()))` and
   return `new Response(null, { status: 202 })`.

2. Add a `ReplyRequest` type: `{ runId: string; answer: string }`.

3. Add a `parseReplyRequest` function (follow the pattern of
   `parseStartRequest` at line 134 and `parseAbortRequest` at line 166):
   validate `runId` and `answer` are non-empty strings.

4. Add a `private async reply(input: ReplyRequest)` method:
   - Load state. Verify `state.activeRunId === input.runId` and
     `state.pendingInputRequestId` is set. If not, throw an error
     (`"Run is not waiting for input."`) — the `fetch` catch (line 343)
     returns 400.
   - If `state.isMutating === true`: verify the lease is still valid by
     calling `validateProjectCoordinatorLease` (from `project-coordinator.ts`)
     with the coordinator. If the lease is expired, throw an error
     (`"Mutation lease expired."`) — do NOT resume. The user must start a
     new run. Follow the pattern in `renewMutatingLeaseIfNeeded` (line 1223)
     for how to call the coordinator.
   - Insert a user answer event:
     `agentRunEvents` row with `type: "message"`, payload
     `createAgentRunEventPayload({ role: "user", text: input.answer,
     kind: "answer" })`. Follow the pattern in
     `src/integrations/trpc/routers/workspace.ts:1300-1310`.
   - Update `agentRuns.status = "running"`, clear `question` and
     `recommendedAnswer`, via `createDb(this.env)`.
   - Clear `pendingInputRequestId` and `pendingInputQuestion` in state.
   - Re-dispatch: call `adapter.dispatch({ agentName: state.flueAgentName,
     agentInstanceId: state.flueAgentInstanceId, message: input.answer })`
     (for read-only runs) or
     `adapter.dispatchMutatingProjectRun({ ... })` (for mutating runs — use
     the same fields as `start` at line 423, but with `message: input.answer`).
     Use `state.isMutating` to decide.
   - Update `flueStreamPath`, `streamOffset` from the new receipt (follow
     the pattern at line 452-459). Update D1 `flueStreamOffset` (line 439-450).
   - Call `await this.resumeFlueStreamIfNeeded("reply")` to resume
     consumption.

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts` — add tests:
- `reply` with matching `runId` and `pendingInputRequestId`: inserts answer
  event, sets run to `running`, re-dispatches, updates stream offset, resumes
  consumption. Assert the adapter's `dispatch` was called with the answer.
- `reply` for a run with no `pendingInputRequestId`: returns 400 (or throws
  caught by fetch).
- `reply` with mismatched `runId`: returns 400.
- (Mutating) `reply` when the lease is expired: returns 400, does NOT
  re-dispatch. Mock `validateProjectCoordinatorLease` to return
  `{ valid: false }`.

### Step 6: Route `workspace.answerRunQuestion` to the right backend

In `src/integrations/trpc/routers/workspace.ts`, in `answerRunQuestion`
(line 1248):

After loading the run (line 1263) and verifying `run.status === "needs_input"`
(line 1272), add a branch:

- If `run.flueAgentName` is present (the run is Flue-backed): post `/reply`
  to `FlueRunBridge` instead of `postWorkspaceSessionBroker`.
- Otherwise: keep the existing `postWorkspaceSessionBroker /reply` path
  (line 1279).

To post to `FlueRunBridge`, use the same pattern the codebase uses to reach
the bridge elsewhere — look at how `startRun` reaches `FlueRunBridge /start`
(likely via `env.FLUE_RUN_BRIDGE` or a DO stub from the session id). Search
for `FlueRunBridge` or `FLUE_RUN_BRIDGE` in the router file and in
`src/lib/` for the existing dispatch helper. If there is no existing helper
for posting to the bridge, follow the `postWorkspaceSessionBroker` pattern
(`src/integrations/trpc/routers/workspace.ts:1279`) but target the
`FlueRunBridge` DO namespace.

The body is `{ runId: input.runId, answer: input.answer }`.

After the `/reply` post succeeds, keep the existing D1 update (line 1289:
status `running`, clear `question`/`recommendedAnswer`) and the user answer
event insert (line 1300). The bridge's `reply` method also does these
updates, but doing them in the router too is idempotent and keeps the UI
responsive without waiting for the bridge. If this causes a conflict, prefer
letting the bridge own the D1 updates for Flue runs and remove the router's
duplicate updates for the Flue branch only.

The existing `NeedsInputCard` in `src/components/ai-chat.tsx` should work
without UI changes — it already calls `workspace.answerRunQuestion`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` exits 0. If there is an
existing router test harness for `answerRunQuestion`, add a test that a
Flue-backed run posts to `FlueRunBridge /reply` and a legacy run posts to
`WorkspaceSessionBroker /reply`. If there is no harness (check
`src/integrations/trpc/routers/workspace.test.ts` or similar), the typecheck
is sufficient.

### Step 7: Final verification

Run:

```sh
pnpm exec tsc --noEmit --pretty false
pnpm test -- src/lib/flue-event-projection.test.ts src/lib/flue-run-bridge.test.ts
pnpm test
pnpm lint
pnpm flue:build
git diff --check
```

## Test plan

- Projection tests (`src/lib/flue-event-projection.test.ts`):
  - Valid `needs_input` tool result maps to `needs_input` event + frame +
    `needsInput` field.
  - Malformed signal (missing fields, bad JSON, wrong `dittoEvent`) is
    ignored — only normal `tool_finished` projection.
  - Secret in the `question` field is redacted (or the signal is dropped if
    redaction corrupts the JSON).
- Bridge tests (`src/lib/flue-run-bridge.test.ts`):
  - `needs_input` tool result + `submission_settled` (completed) → run
    paused at `needs_input`, frame broadcast, `finishRun` NOT called.
  - `needs_input` tool result + `submission_settled` (failed) → run finished
    as failed (failure overrides pending input).
  - `submission_settled` (completed) with no prior `needs_input` →
    `finishRun` called as normal (regression guard).
  - `reply` with matching run + pending input → answer event inserted, run
    set to `running`, re-dispatch called with the answer, stream offset
    updated, consumption resumed.
  - `reply` with no pending input → 400.
  - `reply` with mismatched run → 400.
  - (Mutating) `reply` with expired lease → 400, no re-dispatch.
- Router tests (if harness exists):
  - Flue-backed `answerRunQuestion` posts to `FlueRunBridge /reply`.
  - Legacy run still posts to `WorkspaceSessionBroker /reply`.

## Done criteria

- [ ] The `request_clarification` tool exists in `.flue/agents/project-coder.ts`
      and `pnpm flue:build` succeeds.
- [ ] Projection detects the structured `needs_input` tool result and emits
      the event + frame; malformed signals are ignored.
- [ ] `FlueRunBridge` pauses a run at `needs_input` when a `needs_input`
      tool result is followed by `submission_settled` (completed).
- [ ] `FlueRunBridge` `POST /reply` re-dispatches a new prompt with the
      user's answer on the same agent instance and resumes consumption.
- [ ] `workspace.answerRunQuestion` routes to `FlueRunBridge /reply` for
      Flue-backed runs and keeps the legacy broker path for legacy runs.
- [ ] Existing `NeedsInputCard` works without UI changes.
- [ ] Legacy broker answer behavior remains intact.
- [ ] No natural-language assistant text parsing is used as the control
      boundary — only the structured `dittoEvent: "needs_input"` tool result.
- [ ] All verification commands pass.
- [ ] `plans/README.md` status row updated (skip this — the reviewer
      maintains the index).

## STOP conditions

Stop and report if:

- The `tool` event's `result` field cannot be reliably parsed as JSON after
  passing through `compactFlueText` (e.g. if `redactSecrets` corrupts the
  JSON structure in a way that makes the signal undetectable). Report what
  you observed.
- Re-dispatching a new `POST /agents/:name/:id` with the answer does NOT
  continue the same conversation (e.g. the Flue runtime creates a new
  session or loses context). Verify by checking that the new receipt's
  `streamUrl` points to the same agent instance path
  (`/agents/project-coder/<projectId>:<sandboxId>`).
- Mutating resume would continue after lease expiry without a fresh lease
  or clear failure. The `reply` method MUST check lease validity before
  re-dispatching for mutating runs.
- Implementing this requires broad UI redesign or new product approval UX.
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

This plan uses a multi-turn re-prompt model instead of a native pause/resume
because the installed Flue runtime does not expose a pause/resume primitive.
The `request_clarification` tool's structured result (`dittoEvent:
"needs_input"`) is the product boundary — future changes to the agent's
instructions or the tool's return shape must preserve this contract. If a
future Flue version adds a native pause/resume API, the bridge's
`pauseRunForInput` and `reply` methods are the seams to revisit — the
projection and router routing would stay the same.
