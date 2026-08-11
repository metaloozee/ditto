# Plan 033: Detach agent SSE delivery without stopping execution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Keep
> browser delivery separate from agent execution: a browser cancel is not Stop.
> If anything in "STOP conditions" occurs, stop and report; do not add an
> `AbortController`, cancel the sandbox process, or broaden this into bounded
> streaming work. When done, update Plan 033 in `plans/README.md` unless a
> reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b783dec..HEAD -- apps/web/src/routes/api.agent.stream.ts apps/web/src/routes/api.agent.stream.test.ts apps/web/src/lib/agent-run-service.ts apps/web/src/lib/agent-run-service.test.ts apps/web/src/lib/agent-run.ts apps/web/src/lib/agent-stream-client.ts docs/architecture/agent-harness.md docs/architecture/security.md plans/033-detach-agent-sse-delivery.md plans/README.md`
> The plan file and index are expected planning artifacts. The implementation,
> test, and architecture paths were unchanged at planning time. Record the
> initial `git status --short` output. The untracked approved umbrella spec and
> the existing Plan 032/index edits are user-owned planning work; preserve them.
> Plan 032's landed Git/security documentation changes are expected drift; rebase
> this plan's cited doc paragraphs around them. If the agent route, route test,
> execution/persistence service, or the specific persistence/transport doc
> contracts changed semantically, treat that mismatch as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: MED
- **Depends on**: Plans 017, 018, 023, and 032 (032 must land first because both plans edit the agent/security architecture docs)
- **Category**: bug
- **Requirements**: STREAM-1 and STREAM-2 from the approved platform-hardening specification
- **Planned at**: commit `b783dec`, 2026-07-29
- **Execution status**: DONE-local — merged at `23babdb`; deployed >30-second disconnect smoke deferred

## Why this matters

Ditto deliberately lets an agent run finish after its browser leaves. The SSE
route currently passes `ReadableStreamDefaultController.enqueue()` directly into
`executeAgentRun`; cancelling the response closes that controller, so the next
agent event throws into the execution callback. The same unconditional
`controller.close()` can then throw again. A delivery-only disconnect can
therefore perturb terminal message persistence and post-run backup even though
only authenticated Stop is supposed to stop execution.

After this plan, the route has a small explicit attached/detached/closed delivery
state. Browser cancellation makes later SSE delivery a no-op, while the existing
agent service continues through terminal persistence and backup for the lifetime
of the Worker invocation. Expected cancellation is silent; unexpected controller
failures are reported once with a static, secret-free log message and never
become agent execution failures.

Cloudflare does not guarantee that an HTTP invocation itself survives client
disconnect: its current limits documentation says request tasks *may* be canceled
and `ctx.waitUntil()` extends them by at most 30 seconds. Since Ditto permits
600-second agent commands, controller safety is necessary but cannot by itself
prove the stronger durable-execution invariant. This plan therefore requires a
deployed disconnect smoke beyond 30 seconds. If that smoke shows invocation
cancellation, mark this plan BLOCKED and commission a separate Queue/Workflow/
Durable Object execution-owner design; do not hide the gap with `waitUntil()`.

## Current state

The approved umbrella specification is
`docs/superpowers/specs/2026-07-26-platform-hardening-design.md`, Workstream 2,
"Detached agent execution and bounded delivery." It was untracked at planning
time, so this plan inlines the relevant requirements:

- **STREAM-1**: attached/detached browser delivery is independent from sandbox
  execution, terminal assistant persistence, and post-run backup. Once detached,
  stop encoding and queueing browser events.
- **STREAM-2**: enqueue, close, error, and cancellation races are idempotent.
  Attempt at most one terminal controller action while attached. Delivery
  failures are observable but are not execution failures.
- Browser navigation remains **non-cancelling**. Only the authenticated
  `/api/agent/control` Stop path may call PI queue clearing/cooperative abort.
- Bounded runner stdout, slow-consumer queues, event coalescing, and public tool
  projection are the later STREAM-3/STREAM-4 plan, not this plan.

### Unsafe route/controller coupling

`apps/web/src/routes/api.agent.stream.ts:60-76` currently has no `cancel()`
handler or controller state:

```ts
const readable = new ReadableStream<Uint8Array>({
  async start(controller) {
    const enqueue = (event: string, data: unknown) => {
      controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
    };

    try {
      await executeAgentRun({
        context: prepared.context,
        emit: ({ event, data }) => {
          enqueue(event, data);
        },
      });
    } finally {
      controller.close();
    }
  },
});
```

`ReadableStream` cancellation closes the stream/controller. A later
`enqueue()` or `close()` throws `TypeError: Invalid state: Controller is already
closed`. Because `emit` is synchronous, that exception enters
`executeAgentRun` as if the run itself failed.

### Execution and persistence already belong to the service

`apps/web/src/lib/agent-run-service.ts:687-1047` owns the run independently of
HTTP:

- `executeAgentRun` receives a synchronous typed `emit` callback.
- It awaits `runAgentInSandbox`, settles each started assistant to `complete` or
  `failed`, then calls `persistProjectSandboxBackup`.
- Normal failures persist partial content and emit `error` followed by `done`.
- It intentionally has no browser `Request`, `Response`, or cancellation signal.

Do not move controller state into this service. The route must make its delivery
callback non-throwing; the service should continue to treat its event sink as a
simple synchronous observer.

`apps/web/src/lib/agent-run.ts:283-285` already documents the execution rule:

```ts
// Intentionally not abortable: client navigations/disconnects must not tear
// down long agent runs mid-stream (would leave empty assistant rows in D1).
// Cost/side effects continue until the sandbox process exits.
```

### Existing route-test seam

`apps/web/src/routes/api.agent.stream.test.ts` mocks `prepareAgentRun` and
`executeAgentRun`, captures the real POST handler through `createFileRoute`, and
reads the real `Response` body. The existing ordered-SSE test proves
`meta -> delta -> done` while attached. Extend this file; do not introduce a
second route harness or mock `ReadableStream` itself.

Use the repository's local deferred-promise style (for example
`apps/web/src/lib/project-sandbox.test.ts:256-264`) to pause the mocked executor
at a deterministic lifecycle point. Do not use wall-clock sleeps or fake network
requests.

### Documentation that needs precision

- `docs/architecture/agent-harness.md:157-163` says browser disconnect remains
  detached from execution but does not describe the route's delivery state or
  no-op behavior after detach.
- `docs/architecture/security.md:209-212` states cancellation does not stop
  execution. Update it to name the route-owned attached/detached state and
  terminal persistence/backup continuation.

### Verification baseline at planning time

At `b783dec` on 2026-07-29:

- `pnpm typecheck` passes.
- `pnpm check` passes with 32 existing warnings.
- Exact focused tests pass: 3 files, 52 tests.
- The full web suite has one unrelated existing failure:
  `apps/web/src/components/ai-chat.test.tsx` expects `bg-transparent`, while the
  current navbar intentionally has a background gradient (60 files and 651
  tests pass; one test fails). Do not edit that component/test in this plan.
- Because root `pnpm verify` stops at that web-suite failure, compare the full
  baseline before/after. If it has been fixed before execution, require a fully
  green `pnpm verify`.

### Cloudflare invocation-lifetime caveat

Cloudflare Workers' current limits documentation states that HTTP requests have
no hard duration limit only while the client remains connected; after disconnect,
associated tasks may be canceled, and `ctx.waitUntil()` extends execution for at
most 30 seconds:
<https://developers.cloudflare.com/workers/platform/limits/#duration>.
The context documentation likewise says a streamed response keeps the invocation
active while the client is receiving it:
<https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil>.

The local Web Stream tests in this plan prove the deterministic controller bug
is fixed; they cannot prove Cloudflare keeps a production invocation alive. The
mandatory deployed smoke in Step 4 is an acceptance gate, not permission to add
`waitUntil()` or a new durable execution architecture inside this small plan.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install app | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Install runner | `pnpm runner:install` | exit 0; `packages/sandbox-runner/package-lock.json` unchanged |
| Focused agent tests | `pnpm --filter @ditto/web exec vitest run src/routes/api.agent.stream.test.ts src/lib/agent-run-service.test.ts src/lib/agent-run.test.ts` | all pass; baseline is 3 files / 52 tests before new route cases |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Check | `pnpm check` | exit 0; existing warnings allowed, no new diagnostics in in-scope files |
| Full web suite | `pnpm test` | exit 0, or exactly the one planning-time `ai-chat.test.tsx` failure with every other test passing |
| Build | `pnpm build` | exit 0 |
| Runner regression | `pnpm runner:verify` | exit 0; no runner source changes |
| Full gate when baseline is green | `pnpm verify` | exit 0 |
| Deployed disconnect smoke | Follow Step 4 against an authorized disposable environment | run remains active for >30 seconds after disconnect; assistant becomes terminal; backup generation advances; no controller exception |

Do not use `pnpm test -- <paths>` for the focused gate: with this repository's
script forwarding it runs the entire suite. Use the exact `pnpm ... exec vitest`
command above.

## Scope

**In scope** (the only implementation/docs files to modify):

- `apps/web/src/routes/api.agent.stream.ts`
- `apps/web/src/routes/api.agent.stream.test.ts`
- `docs/architecture/agent-harness.md`
- `docs/architecture/security.md`
- `plans/README.md` status only, unless the reviewer maintains it

**Read-only regression dependencies**:

- `apps/web/src/lib/agent-run-service.ts`
- `apps/web/src/lib/agent-run-service.test.ts`
- `apps/web/src/lib/agent-run.ts`
- `apps/web/src/lib/agent-stream-client.ts`

**Out of scope** (do not touch):

- `agent-run-service.ts` or `agent-run.ts` execution, persistence, backup,
  redaction, follow-up, Stop, or worktree behavior.
- Browser/client stream parsing or Composer behavior.
- `api.provider-auth.stream.ts`: provider-login cancellation intentionally
  aborts its auth attempt and has different lifecycle semantics.
- Runner stdout backpressure, Worker pending-byte/event limits, slow-consumer
  coalescing, or tool-event projection (STREAM-3/STREAM-4 follow-up).
- WebSockets, resumable/replayable SSE, run ledgers, reconnect UX, admission
  control, schema/migration changes, dependencies, or generated route files.
- The unrelated `ai-chat.test.tsx` navbar-class baseline failure.
- The approved umbrella spec.
- Plan 032 implementation. Plan 032 must land before this plan starts because
  both plans update `agent-harness.md`, `security.md`, and the plan index.

## Git workflow

- Branch: `advisor/033-detach-agent-sse-delivery`
- Start from the landed Plan 032 commit, not from its pre-implementation base.
- Commit: `fix(agent): detach SSE delivery on cancel`
- Do not push, open a PR, merge, or deploy unless instructed.
- Preserve all initial out-of-scope working-tree entries byte-for-byte.

## Steps

### Step 0: Record drift and the current baseline

1. Confirm Plan 032 is DONE and its implementation/docs commit is in `HEAD`.
   If it is still TODO or only exists in another worktree, STOP; do not execute
   these overlapping documentation plans in parallel.
2. Run the drift check and `git status --short`; save both outputs in the
   execution notes.
3. Run `pnpm install --frozen-lockfile` and `pnpm runner:install` in a clean
   executor worktree; both lockfiles must remain unchanged.
4. Run the exact focused test command, `pnpm typecheck`, and `pnpm check`.
5. Run `pnpm test` once before editing. Confirm either a green suite or exactly
   the planning-time `ai-chat.test.tsx` failure described above.
6. Confirm an operator-authorized disposable deployed environment is available
   for Step 4. If not, implementation may be prepared and locally reviewed, but
   Plan 033 must finish BLOCKED rather than DONE.
7. Do not fix baseline warnings or the unrelated UI test.

**Verify**: focused tests and typecheck pass; check exits 0; the full-suite result
matches one of the two accepted baselines exactly.

### Step 1: Add cancellation-first route regression tests

Extend `apps/web/src/routes/api.agent.stream.test.ts` before changing the route.
Use the existing captured POST handler, real `Response.body.getReader()`, and the
mocked `executeAgentRun`. Add a tiny local deferred helper; no timers.

For each case:

1. Have `executeAgentRunMock` emit enough data to establish the named phase and
   resolve a `phaseReached` deferred.
2. Return the response, acquire its reader, and read the first chunk when the
   case has an attached pre-cancel event.
3. Call `const cancellation = reader.cancel("navigation")` while the mocked
   executor is paused; do not make test progress depend on when a particular
   Web Stream implementation resolves that promise.
4. Release the executor. It must attempt later `emit` calls and then execute
   mock-side markers representing terminal persistence and backup before
   resolving an `executionFinished` deferred.
5. Await both `cancellation` and `executionFinished` with no rejected/unhandled
   promise. Assert all post-cancel markers ran.

Cover these four lifecycle points named by STREAM-1 acceptance criteria:

- **During text**: cancel after `meta` plus a text `delta`; resume with another
  delta, terminal-persistence marker, backup marker, and `done`.
- **During tool progress**: cancel after an `agent` tool-start/update event;
  resume through tool end, terminal persistence, backup, and `done`.
- **Queued follow-up boundary**: cancel while the run is active before the mock
  emits `turn_done` / `turn_start`; resume through the follow-up's terminal
  marker, backup, and final `done`. The mock verifies execution chronology; it
  must not add a second HTTP stream or call the control route.
- **Terminal settlement**: pause after assistant-terminal persistence starts but
  before backup/final `done`; cancel, then prove persistence completes, backup
  runs, and the executor resolves.

Mock `#/lib/agent-stream-protocol` in this route test with a call-counting
`encodeSseEvent` implementation that still returns valid SSE text. For every
cancel case, record its call count immediately before cancellation and assert it
does not increase afterward. Spy on `console.warn`/`console.error` and assert an
expected cancellation emits neither. These assertions prove post-detach events
were not merely encoded and discarded by the already-canceled reader.

Exercise cancellation followed by repeated post-cancel emits plus finalization;
it must not throw or produce an unhandled rejection. Do not rely on calling
`reader.cancel()` twice to prove source-callback idempotence because the Web
Streams implementation may invoke the underlying `cancel()` only once. Keep the
existing attached ordered-SSE test unchanged as the happy-path guard.

Add one non-cancellation case where the mocked `executeAgentRun` unexpectedly
throws after stream setup. Assert the attached reader errors once, the route
emits only a static secret-free execution log (not the thrown message), and the
finally path does not turn the already-errored stream into a second close/error.
This covers STREAM-2's error terminal action separately from expected detach.

The cancellation tests should fail against current code because post-cancel
`enqueue()` or final `close()` throws before `executionFinished` resolves.

**Verify**:
`pnpm --filter @ditto/web exec vitest run src/routes/api.agent.stream.test.ts`
→ existing attached test passes; the new disconnect tests fail for controller-
closed exceptions before Step 2, then all pass after Step 2.

### Step 2: Add the minimum route-owned delivery state

Change only the `ReadableStream` construction in
`apps/web/src/routes/api.agent.stream.ts`. Keep the state local to this one
response; do not create a reusable transport class or a new file.

Implement three states:

```ts
type DeliveryState = "attached" | "detached" | "closed";
```

Declare the state in the per-response closure immediately before the
`ReadableStream` constructor so both `start()` and the underlying source's
`cancel()` callback share it. Do not put it at module scope, and do not declare
it only inside `start()` (that would leave `cancel()` unable to detach before a
later emit).

Required behavior:

- Start in `attached` for each response.
- `cancel()` transitions `attached -> detached`. It is idempotent and does not
  abort, signal, reject, or otherwise call the agent service/sandbox.
- Delivery checks for `attached` **before** `encodeSseEvent` and encoding. After
  detach/close it returns immediately, so no browser payload is encoded or
  queued.
- While attached, encode and `controller.enqueue()` inside a narrow `try/catch`.
  If enqueue loses a race with cancellation/closure, transition to `detached`,
  emit one static secret-free `console.warn`, and return without throwing into
  `executeAgentRun`.
- Successful service completion performs one close attempt only while attached.
  Set the state to `closed` before calling `controller.close()` so a reentrant or
  repeated finish cannot attempt a second terminal action. A controller-close
  race gets the same static, secret-free delivery warning and is not rethrown.
- If an unexpected exception escapes `executeAgentRun`, log a static
  secret-free execution message and perform at most one `controller.error()`
  while attached. Mark `closed` before that attempt; `finally` close must then be
  a no-op. When detached, log the escaped execution failure but do not touch the
  controller. Do not log the raw error object/message because this route sits on
  a secret-bearing execution path.
- Expected reader cancellation is not an error and should not produce warning
  noise.

Keep `await executeAgentRun(...)` inside `start()`. Do not fire-and-forget it,
move it to the client, or replace it with `request.signal`; the awaited promise
is the current Worker-visible lifetime of terminal persistence and backup.

Do **not** add any of the following to this route:

```ts
AbortController
request.signal
controlAgentRun
runAgentInSandbox
```

**Verify**:

1. Route disconnect tests all pass.
2. Existing ordered attached delivery remains `meta -> delta -> done`.
3. `rg -n "AbortController|request\.signal|controlAgentRun|runAgentInSandbox" apps/web/src/routes/api.agent.stream.ts` returns no matches.
4. Exact focused agent test command passes; existing service persistence/backup
   tests remain unchanged.

### Step 3: Align architecture documentation

Update only the relevant paragraphs:

- `docs/architecture/agent-harness.md` Persistence: correct the stale statement
  at lines 37-38 that says the stream route calls the backup helper; the
  `agent-run-service` now owns post-run backup.
- `docs/architecture/agent-harness.md` Transport / live controls: state that the
  route owns attached/detached/closed delivery; reader cancellation detaches and
  makes later encoding/enqueue a no-op; service execution, all started-assistant
  terminal writes, and post-run backup continue while the invocation survives.
  Authenticated Stop remains the only application execution-cancellation path.
- `docs/architecture/security.md` Failure posture: add the same implementation
  boundary in concise security language. Delivery/controller failures are
  logged without raw secret-bearing errors and are not classified as agent-run
  failures.

Do not document replay, reconnect, queue bounds, or tool projection; those do not
exist after this plan.

**Verify**:
`rg -n "attached|detached|browser.*cancel|terminal.*backup" docs/architecture/agent-harness.md docs/architecture/security.md`
→ both files describe the new delivery-only state without claiming resumability
or bounded delivery.

### Step 4: Run local gates, then a deployed disconnect smoke

#### Local gates

1. Run the exact focused agent tests, `pnpm typecheck`, and `pnpm check`.
2. Run `pnpm test` and compare it with Step 0.
   - If Step 0 was green, this run must be green.
   - If Step 0 had only the known `ai-chat.test.tsx` failure, that exact failure
     may remain; all new route tests and all other tests must pass.
3. Run `pnpm build` and `pnpm runner:verify` separately. If the unrelated web
   test was fixed before execution, run `pnpm verify` and require exit 0.
4. Run `git diff --check` and audit final scope.

#### Authorized deployed smoke (mandatory for DONE)

Use an existing disposable staging project and replaceable provider credential;
obtain explicit operator authorization before deployment or provider use. Do not
run this against a user's active project.

1. Record the session ID, new assistant message ID from the initial `meta` event,
   and the project's current stored backup generation. Do not record credentials
   or raw environment values.
2. Start a harmless agent task known to remain active for more than 45 seconds.
   After receiving `meta` plus at least one text or tool event, close the browser
   tab or cancel the SSE client without calling `/api/agent/control`.
3. Confirm server logs show no stream-controller exception or raw execution
   error. Expected cancellation is silent; do not require a detach log or the
   browser connection to remain.
4. After the sandbox process settles, query through the authenticated app/admin
   tooling: the named assistant row is `complete` or `failed` (never `pending`),
   and the project's stored backup generation advanced for that run.
5. Record elapsed time from disconnect to settlement; it must exceed 30 seconds
   so the smoke crosses Cloudflare's documented `waitUntil()` window.

If the invocation disappears, the assistant remains pending, backup does not
run, or logs show runtime cancellation, mark Plan 033 **BLOCKED** even if every
local test passes. Report that STREAM-1 needs a durable execution-owner design;
do not add `waitUntil()` or weaken the acceptance criterion.

Finally run `git status --short`, preserve initial out-of-scope entries, and
update only Plan 033's index status unless a reviewer owns it.

**Verify**: local gates have the expected results and the deployed smoke proves
one >30-second post-disconnect run reaches terminal persistence and backup with
no controller exception.

## Test plan

- Attached happy path still serializes ordered `meta`, `delta`, and `done` SSE.
- Disconnect during text does not reject a later delivery callback or prevent
  mocked terminal persistence/backup.
- Disconnect during tool progress preserves execution chronology after detach.
- Disconnect before a queued follow-up turn starts does not prevent its turn
  lifecycle from settling.
- Disconnect during terminal settlement does not skip the terminal write or
  backup.
- `encodeSseEvent` call count stops at cancellation; expected cancellation emits
  no warning/error log.
- Repeated post-cancel emit/finalization is idempotent; no controller exception
  or unhandled promise reaches test logs.
- An unexpected service escape errors an attached reader once, logs only static
  secret-free context, and does not also close the stream.
- Existing `agent-run-service.test.ts` terminal complete/failed, follow-up, and
  backup cases stay green, proving the read-only execution contract used by the
  route.

## Done criteria

All must hold:

- [ ] `apps/web/src/routes/api.agent.stream.ts` has explicit per-response
      `attached | detached | closed` delivery state.
- [ ] `cancel()` only detaches delivery; it never signals or stops execution.
- [ ] Post-detach delivery performs no event encoding, enqueue, close, or error
      controller calls.
- [ ] Enqueue/close/error races cannot throw into `executeAgentRun`; terminal
      controller action is attempted at most once while attached.
- [ ] Four deterministic disconnect lifecycle tests prove mocked terminal
      persistence and backup still finish; no timers or real network are used.
- [ ] The exact focused gate passes with at least five tests added above the
      52-test planning baseline (four detach phases plus one unexpected-error
      terminal-action case).
- [ ] `pnpm typecheck`, `pnpm check`, `pnpm build`, and `pnpm runner:verify`
      exit 0; `pnpm test` is green or differs only by the unchanged documented
      pre-existing `ai-chat.test.tsx` failure.
- [ ] If the pre-existing UI failure is absent at execution time, `pnpm verify`
      exits 0.
- [ ] Documentation corrects backup ownership, distinguishes browser delivery
      detach from authenticated Stop, and does not claim STREAM-3/STREAM-4 bounds.
- [ ] An authorized deployed run remains active for more than 30 seconds after
      SSE cancellation, then leaves the assistant terminal and advances backup
      generation with no controller exception. Without this smoke, status is
      BLOCKED, not DONE.
- [ ] `git diff --check` passes and no out-of-scope implementation/docs files
      changed.
- [ ] Work is committed on `advisor/033-detach-agent-sse-delivery`.

## STOP conditions

Stop and report without improvising if:

- `executeAgentRun` now accepts an abort signal, owns a `Response`/controller, or
  no longer performs terminal persistence and backup before resolving.
- A route disconnect can only be detected by cancelling the sandbox process or
  by changing authenticated Stop semantics.
- The deployed >30-second smoke shows Cloudflare cancels the Worker invocation,
  leaves a pending assistant, or skips backup. `waitUntil()` is documented as
  only a 30-second extension and is not an acceptable patch; report the need for
  a separate durable Queue/Workflow/Durable Object execution-owner design.
- The disconnect regression cannot be reproduced with a real Web
  `ReadableStream` and the existing route harness.
- Correctness requires touching `agent-run-service.ts`, `agent-run.ts`, the
  browser client, provider-auth streaming, runner code, schema, or dependencies.
- The focused/typecheck baseline fails before changes, or the full suite has a
  failure other than the one documented in Current state.
- Any in-scope source/doc differs semantically from the Current state excerpts.

## Maintenance notes

Browser cancel and authenticated Stop are intentionally different state
transitions. Do not copy `api.provider-auth.stream.ts`'s abort-on-cancel behavior
into the agent route. Cloudflare documents post-disconnect request lifetime as
non-guaranteed; retain the deployed smoke in release checks until execution has a
durable owner independent of the HTTP request. The next STREAM-3/STREAM-4 plan
should build bounded pending delivery and public tool-event projection on top of
this stable detach contract; it must not silently claim durable execution.
