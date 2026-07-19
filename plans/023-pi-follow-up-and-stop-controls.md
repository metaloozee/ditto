# Plan 023: Queue PI follow-ups and stop the active agent from the composer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat dfbc217..HEAD -- \
>   src/components/composer.tsx src/components/composer.test.tsx \
>   src/components/ai-chat.tsx src/components/ai-chat.test.tsx \
>   src/lib/agent-stream-client.ts src/lib/agent-stream-client.test.ts \
>   src/lib/agent-stream-protocol.ts src/lib/agent-stream-protocol.test.ts \
>   src/lib/agent-run-service.ts src/lib/agent-run-service.test.ts \
>   src/lib/agent-run.ts src/lib/agent-run.test.ts \
>   src/routes/api.agent.stream.ts src/routes/api.agent.stream.test.ts \
>   src/routeTree.gen.ts sandbox/runner/src docs/architecture plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/017-extract-agent-run-lifecycle.md, plans/018-bound-streaming-work.md (both DONE)
- **Category**: direction
- **Planned at**: commit `dfbc217`, 2026-07-14
- **Execution**: DONE — retry commit `d667b30`, reviewed and merged into master
  at `6180528` on 2026-07-15. Automated gates passed; GitHub-backed manual race
  checks were unavailable.
- **First-attempt note**: the initial execution was blocked because
  `sandbox/runner/src/cli.ts` was omitted from the exclusive Scope list even
  though it had to carry `runId`. The retry used the corrected scope below.

## Why this matters

Ditto currently keeps the textarea editable while an agent streams, but it
blocks every second submission and offers no real Stop action. Users can type a
next instruction but cannot give it to the live PI session. Aborting the browser
fetch is not a valid substitute: the Worker intentionally lets the sandbox run
finish so D1 does not retain a pending assistant row.

PI 0.80.3 already provides the required execution semantics. A normal message
submitted while streaming should call `AgentSession.followUp()` so PI processes
it as the next user turn. An explicit Stop should call `clearQueue()` before
`abort()` so queued work does not restart after cancellation. Ditto must add a
small control path to the existing live SDK session; it must not add a second
application FIFO, replace the SDK runner with PI RPC mode, or treat transport
disconnection as execution cancellation.

## Locked behavior

Whitespace-only text counts as empty.

| Runner/UI state | Textarea | Button and action |
|---|---|---|
| Idle | Empty | Submit disabled |
| Idle | Non-empty | Start the existing `/api/agent/stream` prompt flow |
| Starting, before runner control-ready | Any | Button disabled; do not fake cancellation |
| Streaming/control-ready | Empty | Square Stop button; clear PI follow-ups, then request PI abort |
| Streaming/control-ready | Non-empty | Send button; queue one PI follow-up and clear the draft only after acknowledgement |
| Stopping or control request pending | Any | Button disabled until acknowledgement/terminal SSE |

Additional decisions:

- Normal streaming Send means **follow-up**, never steering.
- PI delivery mode stays `one-at-a-time`; each queued draft is a distinct user
  turn with its own assistant response.
- Stop is **cancel-and-drop** for follow-ups that PI has not started. They are
  transient queue items and are not inserted into D1 until PI starts them.
- The currently active assistant keeps any partial output and reaches D1 with
  `status: "failed"`, matching the existing interrupted-response UI.
- Browser disconnect/navigation remains detached from execution. Only the new
  authenticated control endpoint may request Stop.
- No PI, Cloudflare Sandbox, database-schema, or package dependency upgrade is
  part of this plan.

## Current state

### Product and architecture constraints

- `PRODUCT.md` requires calm, inspectable AI actions, accurate labels, keyboard
  operation, and clear loading/error states.
- `docs/README.md:72-83` says routes/UI orchestrate, shared policy belongs in
  `src/lib`, D1 is authoritative for chat history, and every assistant row must
  reach `complete` or `failed`.
- `docs/architecture/overview.md:167-168` deliberately detaches agent execution
  from browser disconnects. Preserve that rule; add explicit session control
  rather than reversing it.
- `docs/architecture/agent-harness.md:45-99` is the authoritative runtime and
  transport description. It currently documents one job file, one output-only
  runner stream, and one terminal assistant persistence path.
- `docs/architecture/security.md:39-74` treats prompt, repository, tool, and
  sandbox output as untrusted. User text must continue to travel in a file or
  structured protocol, never shell interpolation.

### Composer blocks the requested behavior

`src/components/composer.tsx:265-283` currently rejects empty input first and
then rejects all submissions while streaming:

```ts
async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const prompt = text;
  if (!prompt.trim()) {
    return;
  }
  // ...
  if (disabledReason || isStreaming) {
    return;
  }
```

`src/components/composer.tsx:413` and `:475` make the only action unavailable
for the whole stream:

```ts
const submitDisabled = !text.trim() || isStreaming || Boolean(disabledReason);

<InputGroupButton
  aria-label="Submit"
  disabled={submitDisabled}
  type="submit"
>
```

The textarea remains controlled by `Chat` through `inputText` and
`onInputTextChange`, so text typed during a stream already survives incoming
deltas. Keep that ownership.

### The browser transport can abort only local consumption

`src/lib/agent-stream-client.ts:150-207` accepts an optional `AbortSignal` for
`fetch`, but `Composer` does not create one. More importantly,
`src/lib/agent-run.ts:254-257` intentionally does not pass a signal to sandbox
execution:

```ts
// Intentionally not abortable: client navigations/disconnects must not tear
// down long agent runs mid-stream (would leave empty assistant rows in D1).
```

`src/lib/agent-run.test.ts` has a regression test asserting no `AbortSignal`
reaches `execStream` or `parseSSEStream`. Keep that test and behavior.

### The runner is single-input and output-only

`sandbox/runner/src/cli.ts:82-117` reads one `--job` file and calls `runAgent`
once. `sandbox/runner/src/run-agent.ts:126-143` subscribes to selected PI events,
awaits one `session.prompt(options.prompt)`, and disposes the session.

Both copies of `RunnerOut` are output-only:

- `sandbox/runner/src/protocol.ts:3-15`
- `src/lib/agent-stream-protocol.ts:1-15`

The Worker starts that process with `shell.execStream()` in
`src/lib/agent-run.ts:249`. The live `AgentSession` exists only inside that Node
process, so a second HTTP request cannot call it directly.

### The current persistence lifecycle assumes one user/assistant pair

`src/lib/agent-run-service.ts:168-405` prepares one workspace session and inserts
one complete user row plus one pending assistant row. `executeAgentRun` at
`:470-687` accumulates one assistant parts list and terminally persists only
`context.assistantMessageId`.

A PI follow-up creates another user and assistant message inside the same outer
`session.prompt()` call. Ditto therefore needs explicit turn-boundary events so
it can start and settle a separate D1 pair without splitting execution into a
second runner job.

### Exact PI 0.80.3 behavior to preserve

The runner pins `@earendil-works/pi-coding-agent` `0.80.3` in
`sandbox/runner/package.json`. The checked-in install documents and types:

- `sandbox/runner/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md:184-238`
  — streaming prompts require `steer` or `followUp`; `followUp()` waits until
  current work would otherwise finish.
- `.../docs/settings.md:164-169` — steering and follow-up default to
  `one-at-a-time`.
- `.../dist/core/agent-session.d.ts:346-406` — exact public methods are
  `followUp(text)`, `clearQueue()`, and `abort()`.
- `clearQueue()` returns the removed steering/follow-up text arrays; `abort()`
  waits for idle but does not itself clear queued messages.
- PI emits `message_start` for each user/assistant message and `queue_update`
  when queues change. `session.prompt()` resolves after the accepted outer run,
  including queued continuation.

Do not import from PI `dist/**`; use the public package exports already used by
`run-agent.ts`.

### Verification baseline

At plan time:

- `pnpm typecheck` passed.
- `npm run typecheck --prefix sandbox/runner` passed.
- Root Vitest passed all 38 files / 338 tests.
- Runner protocol Vitest passed 6 tests.

## Target design

Keep the current SDK runner and add one narrow, run-scoped control channel.

```text
Initial prompt
  Composer -> POST /api/agent/stream -> executeAgentRun
  -> execStream(existing runner CLI) -> live PI AgentSession

Follow-up or Stop while that stream remains open
  Composer -> POST /api/agent/control
  -> authenticated agent-control service
  -> write a JSON control job under /tmp
  -> execute baked control CLI (no user text in shell command)
  -> run-scoped Unix-domain socket
  -> the same live AgentSession.followUp() OR clearQueue()+abort()

Live runner stdout remains authoritative for turn boundaries
  PI message_start(user follow-up)
  -> RunnerOut control event with server-generated message IDs
  -> executeAgentRun settles prior assistant, inserts next D1 pair
  -> SSE turn_done + turn_start
  -> Composer commits prior pair and promotes queued draft to active streaming
```

### Why a run-scoped Unix socket

The installed Cloudflare Sandbox `0.12.1` types provide initial command input,
process control, files, and concurrent RPC calls, but no API for writing more
stdin bytes to an already-running `execStream` process. Do not upgrade the SDK
or expose a terminal/WebSocket merely to work around that.

Use Node's built-in `node:net` Unix-domain sockets inside the runner package:

- no dependency;
- no second scheduler;
- the `AgentSession` stays in the existing SDK process;
- a random `runId` prevents a late command from reaching a later run for the
  same conversation;
- the Worker sends user text through a JSON job file, not shell interpolation;
- the socket and control jobs live under `/tmp`, outside R2 backups.

The socket is operational coordination, not durable state. PI owns the actual
follow-up queue.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Root focused tests | `pnpm exec vitest run src/components/composer.test.tsx src/components/ai-chat.test.tsx src/lib/agent-stream-client.test.ts src/lib/agent-stream-protocol.test.ts src/lib/agent-control-service.test.ts src/lib/agent-run-service.test.ts src/lib/agent-run.test.ts src/routes/api.agent.control.test.ts src/routes/api.agent.stream.test.ts` | listed files pass |
| Runner focused tests | `npm test --prefix sandbox/runner -- --run src/protocol.test.ts src/control-channel.test.ts src/run-agent.test.ts` | listed files pass |
| Root typecheck | `pnpm typecheck` | exit 0, no errors |
| Runner typecheck | `npm run typecheck --prefix sandbox/runner` | exit 0, no errors |
| Root check | `pnpm check` | exit 0 |
| Full gate | `pnpm verify` | check, both typechecks, all tests, and both builds pass |
| Manual runtime | rebuild the sandbox image, then `pnpm dev` | one active run accepts follow-up and Stop as described |

Do not run `pnpm format` or `pnpm fix` over the repository. They are mutating
broad commands. Use the normal check and format only explicitly changed files if
needed.

## Suggested executor toolkit

- Use `sandbox-sdk` before changing Cloudflare Sandbox calls; verify behavior
  against installed `@cloudflare/sandbox@0.12.1` types, not newer docs alone.
- Use `fixing-accessibility` for the changing icon-only submit/Stop button.
- Use `vercel-react-best-practices` and `react-doctor` when finishing the React
  state changes.
- Apply the ponytail rule: no app-owned FIFO, no new dependency, no generic
  message bus, and no PI RPC-mode migration.
- PI references to read before editing:
  - `sandbox/runner/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
  - `sandbox/runner/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
  - `sandbox/runner/node_modules/@earendil-works/pi-coding-agent/docs/usage.md`
  - the public declarations in `dist/core/agent-session.d.ts`

## Scope

**In scope** (the only source files to create or modify):

- Browser/UI:
  - `src/components/composer.tsx`
  - `src/components/composer.test.tsx`
  - `src/components/ai-chat.tsx`
  - `src/components/ai-chat.test.tsx`
  - `src/lib/agent-stream-client.ts`
  - `src/lib/agent-stream-client.test.ts`
- Worker protocol/control/lifecycle:
  - `src/lib/agent-stream-protocol.ts`
  - `src/lib/agent-stream-protocol.test.ts`
  - `src/lib/agent-run-service.ts`
  - `src/lib/agent-run-service.test.ts`
  - `src/lib/agent-run.ts`
  - `src/lib/agent-run.test.ts`
  - `src/lib/agent-control-service.ts` (create)
  - `src/lib/agent-control-service.test.ts` (create)
  - `src/routes/api.agent.control.ts` (create)
  - `src/routes/api.agent.control.test.ts` (create)
  - `src/routes/api.agent.stream.ts`
  - `src/routes/api.agent.stream.test.ts`
  - `src/routeTree.gen.ts` (generated by TanStack tooling; never hand-edit)
- Sandbox runner:
  - `sandbox/runner/src/cli.ts`
  - `sandbox/runner/src/protocol.ts`
  - `sandbox/runner/src/protocol.test.ts`
  - `sandbox/runner/src/run-agent.ts`
  - `sandbox/runner/src/run-agent.test.ts` (create)
  - `sandbox/runner/src/control-channel.ts` (create)
  - `sandbox/runner/src/control-channel.test.ts` (create)
  - `sandbox/runner/src/control-cli.ts` (create)
- Architecture documentation:
  - `docs/architecture/overview.md`
  - `docs/architecture/frontend.md`
  - `docs/architecture/server-and-data.md`
  - `docs/architecture/agent-harness.md`
  - `docs/architecture/security.md`
  - `docs/architecture/repository-map.md`
- Plan status only:
  - `plans/README.md`

**Out of scope**:

- `src/db/schema.ts` and all `migrations/**`; queued follow-ups remain transient
  until PI starts the turn.
- `package.json`, lockfiles, `Dockerfile`, and dependency versions.
- PI steering UX or any call to `session.steer()`.
- PI RPC mode, a WebSocket/terminal connection, Durable Object queue, database
  queue, background worker, or custom queue retry scheduler.
- Cancelling execution on browser disconnect or navigation.
- Changing the per-session workspace lock. Control commands intentionally
  bypass it because the active run already holds it.
- Persisting queued-but-not-started drafts across process/container failure.
- Cross-device/multi-client queue synchronization beyond authenticated access
  and the canonical D1 rows created when a queued turn actually starts.
- Redesigning chat, model selection, Git actions, tool cards, or message schema.

## Git workflow

- Branch: `advisor/023-pi-follow-up-stop`
- Use small Conventional Commits matching recent history, for example:
  1. `feat(runner): add pi session control channel`
  2. `feat(agent): persist queued pi turns`
  3. `feat(chat): queue follow-ups and stop streams`
  4. `docs(agent): document live session controls`
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Add and test the run-scoped runner control channel

Create `sandbox/runner/src/control-channel.ts` using only Node standard-library
modules. It must own:

1. A short Unix socket path derived from random `runId`, under `/tmp`. Hash or
   strictly normalize the ID so the path is safe and below Unix socket length
   limits.
2. A discriminated command union:
   - follow-up: request ID, run/session IDs, model, text, user message ID, and
     assistant message ID;
   - stop: request ID and run/session IDs.
3. A discriminated response union:
   - accepted follow-up with its correlation IDs;
   - accepted stop with the queued follow-ups removed by Stop;
   - rejected with a bounded, non-secret message.
4. One JSON line request and one JSON line response per socket connection.
5. Strict runtime validation, maximum request size, and a short timeout.
6. Serialized command handling. A Stop and follow-up must never mutate PI queue
   state concurrently.
7. Stale socket unlink before listen and socket close/unlink in `finally`.

Create `sandbox/runner/src/control-cli.ts`. It accepts only `--job <path>`, reads
and validates the JSON job, connects to the derived socket, prints exactly one
JSON response line on stdout, and exits non-zero for transport/protocol failure.
It must not accept prompt text in argv.

Do not add a second package or dependency. TypeScript already builds every
non-test file under `sandbox/runner/src`, so the baked image will contain
`dist/control-cli.js` without a Dockerfile change.

`control-channel.test.ts` must cover:

- follow-up request/response round trip over a temporary Unix socket;
- two concurrent commands execute in arrival order;
- oversized/malformed input is rejected;
- wrong run/session ID is rejected;
- stale socket cleanup;
- socket cleanup after close;
- CLI job parsing never requires user text in argv.

**Verify**:

```bash
npm test --prefix sandbox/runner -- --run src/control-channel.test.ts
npm run typecheck --prefix sandbox/runner
```

Expected: all new tests pass and typecheck exits 0.

### Step 2: Bind controls to the existing PI `AgentSession`

Update `sandbox/runner/src/run-agent.ts`; do not replace `createAgentSession` or
move to RPC mode.

Extend `RunAgentOptions` with `runId`. After creating the PI session and before
emitting runner `ready`:

Update `sandbox/runner/src/cli.ts` to validate `runId` from the existing JSON
job file and pass it to `runAgent()`. Keep user text in the job file; do not add
`runId`, prompt text, or other job fields to argv. This file is the required
bridge between the Worker-written job in Step 4 and `RunAgentOptions`.

1. Start the control socket for this run.
2. Keep a FIFO metadata array for accepted follow-ups. This array contains only
   correlation metadata; PI's `AgentSession` remains the execution queue.
3. Force deterministic `followUpMode: "one-at-a-time"` through the existing
   in-memory settings/session API.
4. Subscribe to `message_start` in addition to the existing text/tool events.
   Ignore the first user `message_start` (the initial prompt). For each later
   user `message_start`, shift exactly one accepted follow-up metadata item and
   emit a runner control event `follow_up_started` before that turn's assistant
   deltas.
5. A follow-up control must reject if the session is not streaming, the run is
   stopping, IDs do not match, the model differs from the active model, or PI
   rejects `session.followUp(text)`.
6. On acceptance, call `await session.followUp(text)` and retain the correlation
   metadata. Do not call `prompt()` and do not call `steer()`.
7. A Stop control must set a `stopping` guard, call `session.clearQueue()` first,
   pair the removed PI queue entries with pending metadata, emit
   `follow_up_cancelled` control events, then initiate `session.abort()`.
   Acknowledge that Stop was accepted without pretending cooperative abort has
   already settled; the original runner/SSE `done` remains terminal authority.
8. An expected user Stop sets final `ok: false` but does not emit a generic
   runner error toast. Unexpected abort/control errors still emit bounded errors.
9. Close the control server before disposing the session and emitting terminal
   runner completion. Await/handle the outstanding abort promise so no rejection
   escapes.

Extend `sandbox/runner/src/protocol.ts` additively (keep `v: 1`) with one
`control_event` output whose inner event union is:

- `follow_up_started` with request/run/session IDs, text, userMessageId, and
  assistantMessageId;
- `follow_up_cancelled` with the same correlation IDs;
- `stop_requested` with run/session IDs.

Keep existing text/tool normalization and exact output order. Add protocol tests
for strict event shapes and user-message text extraction. Add
`run-agent.test.ts` with a mocked public PI session covering:

- accepted follow-up calls `followUp`, not `prompt`/`steer`;
- two follow-ups start FIFO on subsequent user `message_start` events;
- Stop calls `clearQueue` before `abort`;
- Stop cancels only not-yet-started metadata;
- follow-up after stopping is rejected;
- expected Stop produces `done.ok === false` without a generic error event;
- the control socket is closed on success, prompt failure, and Stop.

**Verify**:

```bash
npm test --prefix sandbox/runner -- --run src/protocol.test.ts src/control-channel.test.ts src/run-agent.test.ts
npm run typecheck --prefix sandbox/runner
npm run build --prefix sandbox/runner

test -f sandbox/runner/dist/control-cli.js
```

Expected: tests/typecheck/build pass and the control CLI exists.

### Step 3: Add the authenticated Worker control service and route

Create `src/lib/agent-control-service.ts`. Keep the route thin and put ownership,
validation, sandbox invocation, and error mapping here.

Define a Zod request union:

```ts
{ action: "follow_up"; projectId; sessionId; runId; model; message }
{ action: "stop"; projectId; sessionId; runId }
```

Required service behavior:

1. Load the project and active workspace session constrained by authenticated
   `userId`, `projectId`, and `sessionId`. Return 404 for foreign, missing, or
   archived resources and 409 when the project/sandbox is not ready.
2. For a follow-up, allocate request/user/assistant IDs but **do not insert D1
   message rows yet**. The response IDs support optimistic rendering; canonical
   rows are inserted when PI emits `follow_up_started`.
3. Write a bounded JSON control job under `/tmp/ditto-agent-controls/` through
   the Sandbox file API.
4. Run only this static command shape, with a narrowly quoted generated job path:

   ```text
   node /opt/ditto-runner/dist/control-cli.js --job '<generated-path>'
   ```

   No message text, model, IDs, or other request data may be interpolated into
   the command string.
5. Parse exactly one bounded JSON response, redact diagnostics, enforce a short
   control timeout, and delete the temporary job in `finally`.
6. Map missing/stale socket, run mismatch, or already-settled session to 409 so
   the browser can preserve the draft and wait for terminal SSE.
7. Do not acquire `withSessionWorkspaceLock`; doing so would deadlock against the
   active run that owns the live PI session.

Create `src/routes/api.agent.control.ts` following
`src/routes/api.agent.stream.ts`: cookie auth via `createAuth(env)`, JSON parse,
service call, and JSON response. Add `api.agent.control.test.ts` following the
captured-route pattern in `api.agent.stream.test.ts` for 401, 400, mapped 404/409,
accepted follow-up, and accepted Stop.

Service tests must prove:

- ownership constraints are applied before sandbox access;
- follow-up response contains generated correlation IDs;
- no D1 message insert occurs at queue acceptance;
- job JSON contains the message while the shell command does not;
- temporary job deletion runs on success and every failure;
- control path bypasses the session workspace lock;
- stale control target returns 409 with no phantom message rows;
- client-visible failures are redacted and bounded.

Run TanStack generation through the normal build/dev tooling; do not hand-edit
`src/routeTree.gen.ts`.

**Verify**:

```bash
pnpm exec vitest run src/lib/agent-control-service.test.ts src/routes/api.agent.control.test.ts
pnpm typecheck
pnpm build
```

Expected: tests pass, route typechecks, build succeeds, and generated route tree
contains `/api/agent/control`.

### Step 4: Carry run and turn boundaries through the existing stream

Update the runner job written by `src/lib/agent-run.ts` to include `runId`, and
mirror the additive `control_event` variant in
`src/lib/agent-stream-protocol.ts`. Preserve all redaction rules: control-event
text and structured fields must pass through the same structured redaction
boundary as tool events before reaching SSE or D1.

In `src/lib/agent-run-service.ts`:

1. Generate a unique `runId` during `prepareAgentRun`, include it in
   `AgentRunContext` and the initial `meta` SSE payload, and pass it into
   `runAgentInSandbox`/runner job.
2. Add SSE event types:
   - `control_ready: { runId }` after runner `ready` confirms the control socket
     is listening;
   - `turn_done` with the completed current user/assistant IDs, content, parts,
     and tools;
   - `turn_start` with the accepted follow-up's IDs and user text;
   - `queue_cancelled` with cancelled correlation IDs.
3. Replace the single hard-coded assistant accumulator with one `currentTurn`
   record. The initial record uses prepared IDs/text; every
   `follow_up_started` event advances it.
4. On `follow_up_started`, in this order:
   - flush pending text;
   - finalize and persist the previous assistant as `complete`;
   - emit `turn_done` for that prior pair;
   - atomically insert the follow-up user row (`complete`) and assistant row
     (`pending`) using the runner-supplied IDs, authenticated project/session/
     user IDs, active model, and update session recency;
   - reset assistant parts/content for the new turn;
   - emit `turn_start` before any following delta/tool event.
5. On terminal runner completion, persist only the current assistant as
   `complete` or `failed`, then emit the existing overall `done`. Its
   `assistantMessageId` is the final active turn's ID.
6. On Stop, queued-but-not-started drafts have no D1 rows. The active current
   turn persists partial content as `failed`; no assistant remains `pending`.
7. If follow-up row insertion or a turn-boundary terminal write fails, request
   Stop through the same run-scoped control path, attempt to terminally fail all
   known pending assistants, emit `error` then failed `done`, and do not continue
   presenting later turns as durable success.
8. Keep backup once per settled outer run, after every started turn has terminal
   persistence. Do not back up once per queued turn.

Refactor `persistAssistantTerminal` only as far as needed to accept the current
assistant ID; do not create a repository/message framework.

Tests in the existing service/protocol/runner suites must cover:

- `meta -> control_ready -> delta -> turn_done -> turn_start -> delta -> done`
  ordering for one follow-up;
- two one-at-a-time follow-ups create three distinct user/assistant D1 pairs;
- exact text/tool chronology is isolated per assistant turn;
- first and middle turns persist `complete`; final successful turn persists
  `complete`;
- Stop during the initial or follow-up turn persists that active assistant
  `failed` with partial content;
- queued-but-not-started follow-ups create no D1 rows after Stop;
- boundary persistence failure requests Stop and leaves no known pending row;
- redaction still covers follow-up text and control diagnostics;
- existing browser-disconnect test still proves no signal reaches execution.

**Verify**:

```bash
pnpm exec vitest run src/lib/agent-stream-protocol.test.ts src/lib/agent-run.test.ts src/lib/agent-run-service.test.ts src/routes/api.agent.stream.test.ts
pnpm typecheck
```

Expected: all listed tests pass and typecheck exits 0.

### Step 5: Extend the browser stream/control clients

In `src/lib/agent-stream-client.ts`:

1. Add typed handlers for `control_ready`, `turn_done`, `turn_start`, and
   `queue_cancelled` frames.
2. Keep frame parsing malformed-data tolerant as today.
3. Add a separate JSON helper for `POST /api/agent/control`; do not overload
   `streamAgentRun` or open a second SSE stream.
4. Preserve the current optional fetch `AbortSignal` semantics. The new Stop
   helper must not call `AbortController.abort()` on the SSE request.
5. For non-2xx control responses, throw the server's safe message and leave the
   caller's draft untouched.

Tests must cover every new SSE dispatch, follow-up acknowledgement, Stop
acknowledgement, stale-run 409, malformed JSON, and proof that Stop does not
abort the original stream request.

**Verify**:

```bash
pnpm exec vitest run src/lib/agent-stream-client.test.ts
pnpm typecheck
```

Expected: client tests pass and types compile.

### Step 6: Implement the composer state matrix and queued presentation

Refactor `src/components/composer.tsx` so the first long-lived submit handler and
later control submissions can coexist safely. Keep one active stream Promise;
do not start another `/api/agent/stream` call for a follow-up.

Required state/ref behavior:

1. Track `runId`, `controlReady`, `controlPending`, and `stopping` separately
   from overall `isStreaming`.
2. Extend `ComposerStreamingState` with a bounded ordered list of queued
   follow-ups containing request/user/assistant IDs and text. This is transient
   UI projection, not a scheduler.
3. Split internal operations into narrow functions for initial prompt,
   follow-up submit, and Stop. Repeated React form submissions may occur while
   the initial async handler still awaits SSE; refs must prevent stale closure,
   duplicate queueing, or double settlement.
4. Initial idle Send keeps the existing stream lifecycle.
5. While streaming/control-ready with non-empty text:
   - snapshot the current text;
   - send one follow-up control request;
   - preserve text while awaiting acknowledgement;
   - on success append the acknowledged item and clear the textarea only if it
     still equals the submitted snapshot (do not erase newer typing);
   - on failure toast once and preserve the draft.
6. On `turn_done`, call `onStreamCommit` for that completed pair exactly once.
   On `turn_start`, remove the matching queued item and replace active streaming
   IDs/user text/parts with the new turn. Overall `done` commits only the final
   active turn and clears all transient queue/control state.
7. While streaming/control-ready with empty or whitespace-only text, submit
   Stop. Disable while the request is pending, show a stopping accessible name,
   and wait for terminal SSE before treating execution as settled.
8. Keep the model selector and Git mutations disabled while streaming so a
   queued follow-up cannot claim a model different from the live PI session.
9. Derive the icon and accessible name from state:
   - idle/non-empty: `Submit`;
   - streaming/non-empty: `Queue message` with the existing send icon;
   - streaming/empty: `Stop` with `SquareIcon` (or the existing Lucide stop
     glyph, if present);
   - pending Stop: `Stopping`, disabled.
10. Enter without Shift follows the same matrix, including empty Enter invoking
    Stop only when control-ready. Shift+Enter remains newline and IME composition
    remains protected.

In `src/components/ai-chat.tsx`, render queued follow-up user bubbles after the
active assistant row with a quiet visible `Queued` status. Reuse existing
`Message`, `Bubble`, and typography tokens; do not add a new card system or
animation. Use a polite live region or equivalent accessible status so queue
acceptance is not conveyed by icon/color alone.

Composer/Chat tests must cover:

- the full locked behavior table, including whitespace;
- button accessible name/icon changes;
- draft clears only after follow-up acknowledgement;
- typing newer text during acknowledgement is not erased;
- queue failure preserves draft and emits one error;
- only one initial `streamAgentRun` call exists across multiple follow-ups;
- FIFO queued rendering and `Queued` status;
- `turn_done` commits once and `turn_start` promotes the matching item;
- Stop does not call the browser stream abort path;
- Stop/follow-up double-click and race guards;
- terminal `done` clears stopping/queue state and commits the final turn once;
- existing delta/tool chronology and timestamp tests continue to pass.

**Verify**:

```bash
pnpm exec vitest run src/components/composer.test.tsx src/components/ai-chat.test.tsx src/lib/agent-stream-client.test.ts
pnpm check
pnpm typecheck
```

Expected: tests pass, accessibility names are queryable by role, check/typecheck
exit 0.

### Step 7: Update the architecture sources of truth

Update the five architecture documents and repository map in scope. Keep terms
qualified: **workspace session**, **sandbox shell session**, **PI agent session**,
and **follow-up**.

Required documentation changes:

- `overview.md`: explicit Stop is session control; browser disconnect remains
  detached. D1 rows begin when a queued follow-up starts.
- `frontend.md`: document the idle/starting/queue/Stop state matrix, transient
  queued projection, and multi-turn stream commits.
- `server-and-data.md`: add `/api/agent/control`, its cookie auth, control service,
  and per-follow-up assistant lifecycle.
- `agent-harness.md`: document the second control request, JSON control job,
  run-scoped Unix socket, PI `followUp`/`clearQueue`/`abort`, one-at-a-time turn
  boundaries, one final backup, and lock bypass rationale.
- `security.md`: document authentication/ownership before controls, no prompt
  shell interpolation, `/tmp` socket/job cleanup, redaction, and the fact that
  browser fetch cancellation still is not execution cancellation.
- `repository-map.md`: add every new route, service, runner control, and test
  file; update changed responsibility descriptions.

Do not describe queued drafts as durable. Do not claim abort is instantaneous;
PI/provider/tool cancellation is cooperative.

**Verify**:

```bash
rg -n "agent/control|follow-up|clearQueue|abort|Unix|browser disconnect" docs/architecture
pnpm check
```

Expected: each concept appears in its owning document and check exits 0.

### Step 8: Full verification and manual race checks

Run:

```bash
pnpm verify
```

Expected: root check/typecheck/tests/build and runner typecheck/tests/build all
pass.

Rebuild the sandbox image, then manually verify in a ready GitHub-backed project:

1. Start a response; before `control_ready`, action remains disabled.
2. After control-ready with empty textarea, button says Stop.
3. Type a follow-up; button says Queue message and submission does not interrupt
   the current response.
4. Queue two drafts; they display FIFO and PI answers them as two distinct turns.
5. Reload after completion; D1 history shows distinct user/assistant pairs in
   order and no pending assistant.
6. Queue a draft, then Stop before it starts; queued UI disappears and no D1 row
   exists for that dropped draft.
7. Stop during tool/model work; partial active output remains as interrupted/
   failed when available and the stream eventually settles.
8. Race a follow-up against natural settlement; either it is acknowledged by the
   live run or receives 409 while preserving the draft—never both, never lost.
9. Navigate away without Stop; execution still completes and persists as before.
10. Open a second tab and confirm foreign/missing/archived session controls are
    rejected; no second runner job is created.

Record any unavailable manual environment check in the plan status; do not mark a
failed race as complete.

## Test plan summary

- **Runner unit**: Unix control framing/cleanup, PI follow-up FIFO, Stop order,
  expected abort, message boundary correlation.
- **Worker unit**: authorization, safe job transport, no lock deadlock, protocol
  parsing/redaction, multi-turn D1 state transitions, persistence failure.
- **Route unit**: auth/body/error mapping and SSE/control response order.
- **Browser unit**: event dispatch, behavior matrix, draft preservation,
  queued rendering, exact-once commits, Stop races and accessibility.
- **Full regression**: `pnpm verify` plus rebuilt-image manual run.

## Done criteria

All must hold:

- [ ] Streaming + non-empty submit calls PI `followUp()` on the existing live
      `AgentSession`; it never starts a second `session.prompt()` or runner job.
- [ ] Streaming + empty/whitespace submit exposes an accessible Stop action that
      calls `clearQueue()` before `abort()`.
- [ ] Stop does not abort the browser SSE fetch and browser disconnect still does
      not abort execution.
- [ ] PI remains pinned to 0.80.3 and the current SDK-based `createAgentSession`
      runner remains in place.
- [ ] Queue delivery is one-at-a-time and steering is not exposed.
- [ ] Every started follow-up receives a distinct complete user row and pending
      assistant row, then that assistant reaches `complete` or `failed`.
- [ ] Queued-but-not-started drafts create no D1 rows and are dropped on Stop.
- [ ] Text/tool event order and per-turn timestamps remain exact.
- [ ] Follow-up/Stop controls are authenticated, ownership-checked, redacted,
      bounded, and carry no user text in shell arguments.
- [ ] The control path cannot deadlock on the active session workspace lock.
- [ ] Stale-run 409 preserves the textarea draft.
- [ ] No schema migration, dependency, WebSocket, PI RPC mode, or app-owned FIFO
      was added.
- [ ] `pnpm verify` exits 0.
- [ ] Rebuilt-image manual checks pass or an unavailable environment is recorded.
- [ ] No files outside Scope are modified (`git status --short`).
- [ ] `plans/README.md` marks Plan 023 DONE only after all mandatory checks pass.

## STOP conditions

Stop and report; do not improvise if:

- Installed PI 0.80.3 behavior or public types differ from `followUp()`,
  `clearQueue()`, `abort()`, one-at-a-time delivery, or user `message_start`
  events described above.
- A real PI 0.80.3 characterization proves follow-up user-message boundaries
  cannot be correlated FIFO before assistant deltas. Do not guess from text or
  merge all turns into one assistant row.
- The installed Cloudflare Sandbox/runtime cannot execute a short second command
  while the original RPC `execStream` is active, or cannot reach a run-scoped
  Unix socket. Report the reproduction; do not switch to terminal/WebSocket or
  upgrade dependencies without approval.
- The implementation would require placing prompt text in argv/shell command,
  exposing the sandbox terminal, or accepting unauthenticated controls.
- Correctness appears to require a D1 queue/schema migration. That is the
  rejected app-owned-queue design and needs a separate product decision.
- Stop can clear a newly accepted follow-up after it has been reported started,
  or follow-up and Stop cannot be serialized deterministically.
- A started assistant can remain `pending` after any tested terminal path.
- Control failure requires releasing or reacquiring the active workspace lock.
- Existing redaction, Git tool, backup, ordered-parts, or browser-disconnect
  invariants regress.
- Any step requires changing PI/Sandbox package versions, root dependencies,
  Docker base, or authentication architecture.
- A verification command fails twice after one reasonable in-scope correction.
- Drift makes the current-state excerpts or protocol ownership materially false.

## Maintenance notes

- PI queue semantics are version-sensitive. Any later PI bump must rerun runner
  tests for `followUp`, `clearQueue`, `abort`, event order, and settlement.
- The run-scoped socket is deliberately local and transient. If future product
  requirements demand durable queues across container failure, design that as a
  separate D1/DO feature rather than silently promoting this control channel
  into a scheduler.
- Keep the control command allowlist limited to follow-up and Stop. Steering has
  different user semantics and needs an explicit product control if ever added.
- Reviewers should scrutinize exact-once D1 transitions, Stop/follow-up ordering,
  shell interpolation, socket/job cleanup, and the preserved disconnect policy.
- If queued-message volume becomes a measured problem, add an explicit product
  limit later. Do not add speculative queue configuration in this plan.
