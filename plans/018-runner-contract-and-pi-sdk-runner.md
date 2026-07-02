# Plan 018: Build the runner↔broker NDJSON contract module, tests, and the Pi SDK agent runner

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 55b6151..HEAD -- Dockerfile tsconfig.json plans/README.md src/lib/pi-rpc.ts src/lib/pi-rpc.test.ts sandbox/pi/ditto-ask-user.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (The new files this plan creates
> do not exist yet at `55b6151`, so they will not appear in the diff.)

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/017-add-pi-session-broker-foundation.md (for the Dockerfile that already installs Pi, and the `WorkspaceSessionBroker` DO + `pi-rpc.ts` this plan runs alongside without modifying)
- **Category**: direction
- **Planned at**: commit `55b6151`, 2026-07-02

## Why this matters

Plan 017 shipped a working agent layer by driving Pi as a **CLI subprocess in
RPC mode** from inside the `WorkspaceSessionBroker` Durable Object: the DO
hand-rolls a named-pipe transport, writes Pi RPC commands into the pipe, and
parses Pi's wire protocol in the Worker. That works, but every Pi capability
(model cycle, compaction, a custom skill, the ask-user flow) must be
re-expressed as an RPC command and re-parsed in the DO, and the JSONL stream
can be poisoned by shell noise.

`docs/pi-sdk-session-broker-prd.md` prescribes a rewrite: Pi runs through its
**typed SDK** inside a small Node.js *agent runner* program baked into the
sandbox image. The runner owns all Pi SDK complexity and emits a stream of
**Ditto-defined** structured NDJSON events; the DO (in a later plan) shrinks
to a broker that relays those events to the browser and D1.

This plan is **phase 1 of the PRD's recommended sequencing**: the runner spike
plus the single automated test seam the maintainer agreed to — a pure
**protocol-mapping module** that maps Ditto commands → runner dispatch actions
and Pi SDK events → Ditto events, verified by Vitest with no sandbox, no
Durable Object, and no credentials. It deliberately does **not** rewire the
Durable Object, the tRPC API, the browser, or D1 — those are phase 2 (plan
019) and phase 3 (plan 020). The existing `pi-rpc.ts` CLI-RPC path stays live
and untouched until phase 2 switches the DO to launching this runner.

## Current state

Relevant files (do NOT modify the ones marked "untouched" — they belong to
phase 2):

- `docs/pi-sdk-session-broker-prd.md` — the PRD this plan implements phase 1 of.
  The wire contract (lines 100–119) and the SDK→Ditto event mapping table
  (lines 123–132) are the authoritative spec for the contract module.
- `src/lib/pi-rpc.ts` — the **prior** Pi RPC protocol helpers (untouched). The
  new contract module mirrors its framing/parsing helpers but for the
  Ditto-owned wire types. Reusable patterns: `JsonlBuffer`, `parsePiRpcEvent`,
  `getTextField`, `trimCompact`.
- `src/lib/pi-rpc.test.ts` — the **prior art** pure-protocol unit test (untouched).
  The new test file follows this exact style.
- `src/lib/workspace-session-broker.ts` — the existing `WorkspaceSessionBroker`
  DO (untouched). Still uses `pi-rpc.ts` + the FIFO bridge. Phase 2 rewires it.
- `sandbox/pi/ditto-ask-user.ts` — the existing Pi CLI extension loaded via
  `-e` (untouched). It calls `ctx.ui.input(...)` and relies on
  `extension_ui_request`/`extension_ui_response` RPC translation. The new runner
  replaces this with an SDK `defineTool` that emits a Ditto `input_request`
  event directly; the old extension stays live for the DO's CLI-RPC path until
  phase 2.
- `Dockerfile` — currently installs Pi globally and copies the extension:

```dockerfile
// Dockerfile:1-5
FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.3

COPY sandbox/pi/ /opt/ditto/pi/
```

- `tsconfig.json` — root TS config (will be modified to exclude the runner from
  the Worker typecheck, since the runner imports the image-only Pi SDK):

```json
// tsconfig.json:1-3
{
  "include": ["**/*.ts", "**/*.tsx", "alchemy.run.ts", "types/**/*.ts"],
  "compilerOptions": {
```

  There is currently **no `exclude`** field. `**/*.ts` matches
  `sandbox/runner/index.ts`, which would make `pnpm exec tsc --noEmit` fail on
  the missing `@earendil-works/pi-coding-agent` import. This plan adds an
  `exclude`.

- `package.json` — package manager is `pnpm@11.8.0`; test runner is `vitest`.
- `biome.json` — formatter uses **tabs** and **double quotes**; linter includes
  only `**/src/**/*`, so files under `sandbox/runner/` are NOT linted by
  `pnpm lint` (only typechecked/tested where applicable).

The wire contract this plan implements (verbatim from the PRD):

```ts
// docs/pi-sdk-session-broker-prd.md:100-119
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

The SDK→Ditto event mapping this plan implements (verbatim from the PRD):

```text
// docs/pi-sdk-session-broker-prd.md:123-132
| message_update (text_delta)           | assistant_delta                              |
| tool_execution_start                  | tool_started                                 |
| tool_execution_update                 | tool_progress                                |
| tool_execution_end                    | tool_finished (+ file_changed/diff_ready after git inspect) |
| ask_user tool invocation              | input_request                                |
| agent_end                             | done { status: "completed" }                 |
| extension_error / runner exception    | error + done { status: "failed" }            |
```

Note: `file_changed`/`diff_ready` after `tool_execution_end` require a `git
status` side effect inside the sandbox — that is a **runner** concern (a side
effect), not a pure mapping. The contract module's pure mapper emits
`tool_finished` only; the runner emits `file_changed`/`diff_ready` after
inspecting git. The `input_request` is also **not** an SDK subscription event —
it is emitted by the ask-user tool's own `execute` function (see Step 3).

Pi SDK API facts verified against current Pi docs (Context7, `/earendil-works/pi`):

- `createAgentSession({ customTools, sessionManager })` returns `{ session }`.
- `defineTool({ name, label, description, parameters, execute })` where
  `parameters` uses `typebox`'s `Type.Object(...)` and `execute` is
  `async (toolCallId, params) => ({ content: [{ type: "text", text }], details: {} })`.
- `session.subscribe((event) => { switch (event.type) { ... } })` emits typed
  events; the relevant ones are `message_update` (with
  `event.assistantMessageEvent.type === "text_delta"` and
  `event.assistantMessageEvent.delta`), `tool_execution_start`
  (`event.toolName`), `tool_execution_update`, `tool_execution_end`
  (`event.result`), `agent_end`, and `extension_error`.
- `session.prompt(...)`, `session.abort()`, and `SessionManager.inMemory()` are
  named in the PRD as the runner's session/prompt/abort/durability API. These
  three were not fully surfaced in the doc query; if their signatures differ
  from what Step 3 assumes, treat it as a STOP condition and consult
  `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md`.

Sandbox SDK transport fact (verified in-repo at `55b6151`): the installed
`@cloudflare/sandbox@0.12.1` exposes `startProcess`, `streamProcessLogs`, `exec`,
`killProcess`, `listProcesses`, `getProcess` — and **no** `stdin`,
`execInteractive`, `writeStdin`, or `sendInput` (confirmed by grepping
`node_modules/@cloudflare/sandbox/dist`). The latest npm release is `0.12.3`,
a patch over `0.12.1` with the same surface. The PRD's "preferred" path (bump
the SDK to expose `stdin`) is therefore **not available in the 0.12.x line**.
This plan resolves the PRD's open transport decision as: **named-pipe fallback**
— the runner reads NDJSON commands from its stdin, which the DO (phase 2) will
redirect from a FIFO, exactly as the existing CLI-RPC path already does. The
runner is transport-agnostic: it simply reads NDJSON lines from `process.stdin`.

Repo conventions to match:

- TypeScript is strict. Prefer explicit narrow types and small parser helpers
  over `any` or `@ts-ignore`.
- Imports inside `src/` use the `#/` alias, e.g. `import { createDb } from "#/db";`.
- Formatting uses **tabs** and **double quotes** (biome).
- Pure protocol helpers live in `src/lib/` with a sibling `.test.ts` file — see
  `src/lib/pi-rpc.ts` + `src/lib/pi-rpc.test.ts`, `src/lib/env-vars.test.ts`,
  `src/lib/sandbox-backup.test.ts`.
- Recent commits use Conventional Commits, e.g.
  `feat(workspace): add pi session broker`.

Verification baseline captured at plan-writing time on `55b6151`:

- `pnpm exec tsc --noEmit --pretty false` exits 0.
- `pnpm test` exits 0 (`src/lib/env-vars.test.ts`, `src/lib/github-repositories.test.ts`,
  `src/lib/pi-rpc.test.ts`, `src/lib/sandbox-backup.test.ts`).
- `pnpm lint` exits 0 with existing warnings only in
  `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- `git diff --check` exits 0.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (Worker + contract module, excludes runner) | `pnpm exec tsc --noEmit --pretty false` | exit 0, no errors |
| Tests (incl. new contract module tests) | `pnpm test` | exit 0, all pass |
| Lint (src/ only) | `pnpm lint` | exit 0, only the two pre-existing warnings |
| Whitespace | `git diff --check` | exit 0, no output |
| (Optional) in-repo runner typecheck | `cd sandbox/runner && pnpm install && pnpm exec tsc --noEmit` | exit 0 — only if the executor wants to typecheck the runner locally; requires network access to install `@earendil-works/pi-coding-agent` + `typebox` |

Do not run `pnpm format`, `pnpm check --write`, `pnpm fix`, `pnpm deploy`, or
`pnpm destroy` unless the operator explicitly asks. Do not commit provider
credentials, `.env`, generated `.alchemy/` state, or secret-bearing command
output.

## Suggested executor toolkit

- Use `sandbox-sdk` if available before authoring the Dockerfile/runner
  launch shape.
- Pi SDK docs to consult during Step 3 (the runner program):
  - `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md`
  - `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md`
- Cloudflare Sandbox docs for the process-launch surface the DO (phase 2) will
  use to start this runner:
  - `https://developers.cloudflare.com/sandbox/api/commands/`

## Scope

**In scope** (the only files you should create or modify):

- `src/lib/runner-protocol.ts` (create) — the pure protocol-mapping module.
- `src/lib/runner-protocol.test.ts` (create) — its Vitest tests.
- `sandbox/runner/index.ts` (create) — the Node.js agent runner program.
- `sandbox/runner/package.json` (create) — minimal deps for the runner
  (`@earendil-works/pi-coding-agent`, `typebox`) so it resolves in the image
  and optionally in-repo.
- `sandbox/runner/tsconfig.json` (create) — extends the root config, includes
  the runner + the protocol module, `noEmit: true`.
- `Dockerfile` (modify) — bake the runner, the protocol module, and `tsx` into
  the image alongside the existing Pi install and extension.
- `tsconfig.json` (modify) — add an `exclude` so the runner is not typechecked
  by the Worker's `tsc --noEmit` (it imports the image-only Pi SDK).
- `plans/README.md` (modify) — add this plan's row + a reconciliation note.

**Out of scope** (do NOT touch — they belong to phase 2 / plan 019):

- `src/lib/workspace-session-broker.ts` — the DO stays on the CLI-RPC path.
- `src/lib/pi-rpc.ts` and `src/lib/pi-rpc.test.ts` — stay live; the DO still
  uses them. They become dead code only when phase 2 rewires the DO.
- `sandbox/pi/ditto-ask-user.ts` — the CLI extension stays live for the DO's
  current path. The runner has its own SDK ask-user tool.
- `src/integrations/trpc/routers/workspace.ts` — no tRPC changes.
- `src/routes/api.workspace.session.$sessionId.socket.ts` — no socket changes.
- Any browser component (`src/components/*`, `src/hooks/*`, `src/routes/*`).
- `src/db/schema.ts` and `migrations/` — no D1 schema changes.
- `alchemy.run.ts` and `src/server.ts` — no new Worker bindings or DO exports
  (the runner runs inside the existing sandbox container, launched by the
  existing Sandbox SDK; no Worker-side binding is needed for phase 1).
- Pre-compiling the runner to JS, R2 artifact storage, redaction libraries,
  timeouts, stale-lock cleanup — those are phase 3 (plan 020).

## Git workflow

- Branch: `advisor/018-runner-contract-and-pi-sdk-runner` if you create a branch.
- Commit style: Conventional Commits, e.g.
  `feat(runner): add ditto ndjson contract and pi sdk runner`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Create the pure runner↔broker contract module

Create `src/lib/runner-protocol.ts`. It owns the Ditto wire types and the pure
mapping logic. It must have **zero** imports from the Pi SDK, Cloudflare
runtime, or `src/db` — that is what makes it the testable seam. Mirror the
framing/parsing style of `src/lib/pi-rpc.ts`.

Required exports:

1. `RunnerCommand` and `RunnerEvent` union types — copy them verbatim from the
   PRD excerpt in "Current state" above.
2. `RUNNER_EVENT_TYPES` — a `Set<string>` of all `RunnerEvent["type"]` values,
   mirroring `PI_EVENT_TYPES` in `src/lib/pi-rpc.ts:41-60`.
3. `RunnerEventBuffer` — an NDJSON line buffer class with
   `push(chunk: string): RunnerEvent[]`, mirroring `JsonlBuffer` in
   `src/lib/pi-rpc.ts:62-84`.
4. `parseRunnerEvent(line: string): RunnerEvent` — JSON.parse + validate
   `type` against `RUNNER_EVENT_TYPES`, mirroring `parsePiRpcEvent` in
   `src/lib/pi-rpc.ts:93-118`. Throw on non-JSON or unknown type.
5. `serializeRunnerCommand(command: RunnerCommand): string` — returns
   `JSON.stringify(command)` (the caller appends `\n`). And
   `serializeRunnerEvent(event: RunnerEvent): string` — same for events.
6. A small `getTextField(event, keys)` helper — you may re-export or copy the
   one from `src/lib/pi-rpc.ts:147-169` so the mapper can read loosely-typed
   SDK event payloads. If copying, keep it private to this module.
7. `mapSdkEventToDitto(event: Record<string, unknown>, runId: string): RunnerEvent[]`
   — the pure SDK→Ditto mapper. It takes a **simulated** SDK event as a plain
   object (so it is testable without the SDK) and returns zero or more Ditto
   events. Implement the PRD mapping table:
   - `message_update` where `assistantMessageEvent.type === "text_delta"` →
     emit `assistant_delta` with `text` from `assistantMessageEvent.delta`
     (fall back to top-level `delta`/`text`/`content` via `getTextField`).
   - `tool_execution_start` → emit `tool_started` with `toolName` from
     `["toolName","name"]` and optional `label`.
   - `tool_execution_update` → emit `tool_progress` with `text` from the
     partial result / output fields (mirror `getToolProgressText` in
     `src/lib/workspace-session-broker.ts:264-271`).
   - `tool_execution_end` → emit `tool_finished` with `toolName` and `status`
     (default `"completed"`). Do **not** emit `file_changed`/`diff_ready` here
     (those need a git side effect the runner performs).
   - `agent_end` → emit `done { status: "completed" }`.
   - `extension_error` → emit `error { message }` then
     `done { status: "failed" }`.
   - Any other/unknown event type → return `[]`.
   - All emitted events carry the `runId` passed in.
8. `planRunnerCommand(command, hasPendingInput)` — the pure command→dispatch
   decision. Signature:

```ts
export type RunnerDispatch =
	| { action: "prompt"; message: string }
	| { action: "resolveInput"; requestId: string; answer: string }
	| { action: "abort" }
	| null; // null = no-op (e.g. reply for an unknown requestId)

export function planRunnerCommand(
	command: RunnerCommand,
	hasPendingInput: (requestId: string) => boolean,
): RunnerDispatch;
```

   - `prompt` → `{ action: "prompt", message }`.
   - `reply` → if `hasPendingInput(requestId)` then
     `{ action: "resolveInput", requestId, answer }` else `null`.
   - `abort` → `{ action: "abort" }`.

The `runId` for events comes from `RunnerCommand.prompt.id` — the runner
treats `prompt.id` as the active run id and tags all emitted events with it
(`abort.id` is the run id being aborted). Document this in a short JSDoc on
`RunnerCommand`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0 (the module has
no external imports, so it typechecks under the Worker config).

### Step 2: Write the contract module tests

Create `src/lib/runner-protocol.test.ts` following the style of
`src/lib/pi-rpc.test.ts` exactly: `describe`/`it`/`expect` from `vitest`,
small focused cases, no process spawning, no Cloudflare runtime. Cover:

- `parseRunnerEvent` parses a `ready`, an `assistant_delta`, an `input_request`,
  and a `done` frame.
- `parseRunnerEvent` rejects non-JSON and unknown `type` values (mirror the
  `pi-rpc.test.ts:59-63` "rejects non-JSON output" case).
- `RunnerEventBuffer` uses strict LF framing, including `\r\n` handling and a
  split line across two `push` calls (mirror `pi-rpc.test.ts:49-57`).
- `serializeRunnerCommand` and `serializeRunnerEvent` produce one JSON object
  that round-trips through `parseRunnerEvent` / `JSON.parse`.
- `mapSdkEventToDitto`: one case per row of the mapping table —
  `message_update` text_delta → `assistant_delta`;
  `tool_execution_start` → `tool_started`;
  `tool_execution_update` → `tool_progress`;
  `tool_execution_end` → `tool_finished` (and **only** `tool_finished`, no
  `file_changed`);
  `agent_end` → `done{completed}`;
  `extension_error` → `error` + `done{failed}`;
  an unknown event type → `[]`.
- `planRunnerCommand`: `prompt` → prompt dispatch; `reply` with a pending
  request → `resolveInput`; `reply` with no pending request → `null`; `abort`
  → abort dispatch.

Use simulated SDK event shapes as plain objects — for the `message_update`
case, reuse the exact shape from `pi-rpc.test.ts:18-33` so the field-extraction
logic is proven against a realistic payload.

**Verify**: `pnpm test` → exit 0, with the new `runner-protocol.test.ts` file
included and all cases passing.

### Step 3: Create the Node.js agent runner program

Create `sandbox/runner/index.ts`. This is a Node.js program that runs **inside
the sandbox container** (not in the Worker). It imports the Pi SDK and the
contract module, owns the agent loop, and exposes the Ditto NDJSON contract on
stdin/stdout. Diagnostics go to stderr only — stdout must stay clean NDJSON
(the PRD's standing requirement, `docs/pi-sdk-session-broker-prd.md:49`).

Structure the runner as a single `main()` with an `async` loop. Required
behavior:

1. **Config from env**: read `OPENCODE_API_KEY`, and `MODEL_SPECIFIER`
   (e.g. `opencode-go/qwen3.7-plus`) from `process.env`. Split
   `MODEL_SPECIFIER` into provider/model using the same slash rule as
   `getPiModelParts` in `src/lib/pi-rpc.ts:131-145` (re-implement locally; do
   not import from `src/` at runtime — see the import note below). If
   `MODEL_SPECIFIER` is missing or malformed, emit `error` + `done{failed}` to
   stdout and exit non-zero.
2. **Create the session** via `createAgentSession` with:
   - `customTools: [askUserTool]` (defined in step 5 below).
   - `sessionManager: SessionManager.inMemory()` — so D1, not Pi, remains the
     durable session of record (PRD line 70).
   - Hardening options that disable telemetry/version-check and disable
     discovery of project-local `.pi` extensions, skills, prompt templates, and
     themes from imported repos, while keeping plain context files such as
     `AGENTS.md` in scope (PRD lines 74–76). Consult the Pi SDK docs for the
     exact option names; if the SDK does not expose equivalents of the CLI
     flags `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY=0`, `--no-extensions`,
     `--no-skills`, `--no-prompt-templates`, `--no-themes`, `--no-approve`,
     STOP and report — do not ship the runner with project-local dynamic
     resources enabled.
3. **Emit `ready`** to stdout immediately after the session is created:
   `{ type: "ready", runnerVersion: "1", model: MODEL_SPECIFIER }`.
4. **Subscribe** to session events via `session.subscribe((event) => { ... })`.
   For each event, call `mapSdkEventToDitto(event, currentRunId)` and write
   each returned `RunnerEvent` to stdout as one NDJSON line via
   `serializeRunnerEvent` + `"\n"`. Guard `currentRunId`: before the first
   `prompt` command, ignore SDK events (or buffer them) — do not emit events
   with an empty `runId`.
5. **Ask-user tool** via `defineTool`:
   - `name: "ask_user"`, `label: "Ask User"`,
     `description: "Ask the Ditto user a concise clarification question."`.
   - `parameters: Type.Object({ question: Type.String(...), placeholder: Type.String(...) })`
     using `typebox`'s `Type` (per the verified SDK docs).
   - `execute`: generate a `requestId` (use `crypto.randomUUID()`), store a
     `resolve` function in a module-level `Map<string, (answer: string) => void>`
     keyed by `requestId`, write an `input_request` event to stdout
     (`{ type: "input_request", runId: currentRunId, requestId, question,
     placeholder }`), and `await` the promise. When the `reply` command
     resolves the promise, return
     `{ content: [{ type: "text", text: answer }], details: { question, answer } }`.
   - This tool must **not** call `ctx.ui.input(...)` and must **not** rely on
     `extension_ui_request`/`extension_ui_response` (PRD lines 78–80).
6. **Command loop on stdin**: read `process.stdin` line by line (NDJSON). For
   each line, `parseRunnerCommand` is not needed on the runner side — instead,
   `JSON.parse` the line, narrow it to `RunnerCommand`, call
   `planRunnerCommand(command, (id) => pendingInputs.has(id))`, and dispatch:
   - `prompt` → set `currentRunId = command.id`, call `session.prompt(command.message)`
     (do not `await` the full run synchronously in a way that blocks stdin
     reading — the prompt runs concurrently while the loop keeps reading
     `reply`/`abort` lines). If `session.prompt`'s signature differs from
     accepting a single message string, STOP and consult the SDK docs.
   - `resolveInput` → look up `pendingInputs.get(requestId)`, call it with
     `answer`, delete the map entry.
   - `abort` → call `session.abort()`.
   - `null` (no-op) → write a diagnostic to stderr only.
7. **Error handling**: any thrown error or `extension_error`-class event must
   emit a redacted `error` event followed by `done { status: "failed" }` and
   exit non-zero. Keep `error.message` compact (reuse the `trimCompact` rule
   from `src/lib/pi-rpc.ts:171-178`, max 2000 chars).
8. **Clean shutdown on stdin close**: when stdin closes (the DO killed the
   FIFO), emit `done { status: "failed" }` if a run is still active and exit.

**Import note for the protocol module**: the runner lives at
`sandbox/runner/index.ts` and the contract module at
`src/lib/runner-protocol.ts`. Import it via the relative path
`../../src/lib/runner-protocol` (which resolves identically in-repo and in the
image — see Step 5's Dockerfile `COPY` layout, which preserves the
`src/lib/...` and `sandbox/runner/...` tree under `/opt/ditto/`). Do **not**
import anything else from `src/` (no `#/db`, no Cloudflare runtime) — those are
Worker-only and would break the Node.js runner.

**Verify**: `cd sandbox/runner && pnpm install && pnpm exec tsc --noEmit` →
exit 0 (optional in-repo gate; requires network to install the Pi SDK +
typebox). If you cannot run this in-repo, skip it and rely on Step 5's image
typecheck + the manual smoke. The repo's hard gate (`pnpm exec tsc --noEmit`)
excludes `sandbox/runner` (Step 4), so the runner is not required to
typecheck under the Worker config.

### Step 4: Exclude the runner from the Worker typecheck

Modify `tsconfig.json` to add an `exclude` array so `pnpm exec tsc --noEmit`
(the Worker typecheck) does not choke on the runner's image-only Pi SDK import.

Add after the `include` line:

```json
  "exclude": ["node_modules", "dist", ".alchemy", ".wrangler", "sandbox/runner"],
```

Keep the existing `include` and all `compilerOptions` unchanged. The existing
`sandbox/pi/ditto-ask-user.ts` has no external imports, so it stays typechecked
under `**/*.ts` — do **not** exclude `sandbox/pi`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0 (the runner is now
excluded; the contract module in `src/lib/` is still checked).

### Step 5: Bake the runner, protocol module, and tsx into the sandbox image

Modify `Dockerfile` to install `tsx` and copy the runner + protocol module into
the image, preserving the relative tree so the runner's
`../../src/lib/runner-protocol` import resolves at runtime. Keep the existing
Pi install and extension copy intact.

Target shape:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.1

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.3 tsx

COPY sandbox/pi/ /opt/ditto/pi/
COPY sandbox/runner/ /opt/ditto/sandbox/runner/
COPY src/lib/runner-protocol.ts /opt/ditto/src/lib/runner-protocol.ts
```

Why this layout: the runner at `/opt/ditto/sandbox/runner/index.ts` imports
`../../src/lib/runner-protocol`, which resolves to
`/opt/ditto/src/lib/runner-protocol.ts` — the same relative path as in-repo.
The DO (phase 2) will launch the runner with `cwd: /opt/ditto` and the command
`tsx /opt/ditto/sandbox/runner/index.ts` (with stdin redirected from a FIFO).
This plan does not author the DO launch — only the image contents.

Do not pre-compile to JS in this plan (pre-compilation is a phase 3
maintenance follow-up). Do not add `typebox` to the root `package.json` — it
resolves from the globally-installed Pi SDK's nested dependencies; if during
the manual smoke `typebox` does not resolve, add it to
`sandbox/runner/package.json` and `npm install -g typebox` in the Dockerfile.

Create `sandbox/runner/package.json` with the runner's runtime deps so it can
be installed in-repo for the optional typecheck and so the deps are explicit:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.80.3",
    "typebox": "*"
  }
}
```

Create `sandbox/runner/tsconfig.json` extending the root config and including
the runner + the protocol module:

```json
{
  "extends": "../../tsconfig.json",
  "include": ["./**/*.ts", "../../src/lib/runner-protocol.ts"],
  "compilerOptions": {
    "noEmit": true
  }
}
```

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0 (Worker config,
runner excluded). `pnpm lint` → exit 0 (no new warnings; `sandbox/runner/` is
not linted by biome, which is expected).

### Step 6: Final verification and manual runner smoke

Run the full verification baseline:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm lint
git diff --check
```

Expected results:

- Typecheck exits 0.
- Tests exit 0, including the new `src/lib/runner-protocol.test.ts` file.
- Lint exits 0 with only the two pre-existing warnings in
  `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- Whitespace check exits 0.

Then inspect scope:

```bash
git status --short
```

Expected: only in-scope files changed/created.

Manual runner smoke (requires a running sandbox with the rebuilt image and a
valid `OPENCODE_API_KEY` — not a gating gate for this plan, but recommended
before phase 2 depends on it). Inside a sandbox container:

1. `cd /opt/ditto && OPENCODE_API_KEY=... MODEL_SPECIFIER=opencode-go/qwen3.7-plus tsx sandbox/runner/index.ts`
2. Type a prompt command on stdin:
   `{"type":"prompt","id":"run-1","message":"list files in /workspace"}\n`
3. Confirm `ready` is emitted first, then a sequence of `assistant_delta` /
   `tool_started` / `tool_progress` / `tool_finished` / `done{completed}` events
   appear on stdout as clean NDJSON, and **nothing** appears on stdout that is
   not a valid `RunnerEvent`.
4. Confirm a prompt that triggers `ask_user` emits an `input_request` event,
   and that sending `{"type":"reply","requestId":"<id>","answer":"..."}\n`
   resolves it and the run continues to `done`.
5. Confirm `{"type":"abort","id":"run-1"}\n` stops the run.

If stdout is ever polluted by non-JSON shell noise or Pi TUI escape sequences,
the launch shape is wrong — STOP and report rather than adding a fragile
parser.

## Test plan

The single automated seam (per the PRD's "Testing Decisions" and the
maintainer's standing preference against a broad new harness) is the contract
module + its Vitest tests, written in Step 2. It covers the full SDK→Ditto
mapping table and the command→dispatch decision, with no sandbox, no DO, and
no credentials.

- New tests: `src/lib/runner-protocol.test.ts`, cases listed in Step 2.
- Structural pattern: `src/lib/pi-rpc.test.ts` (sibling pure-protocol test).
- Verification: `pnpm test` → all pass, including the new file.

The runner program itself is verified by the manual smoke in Step 6 (needs a
sandbox + credentials), consistent with the PRD's "Manual smoke seam (not
automated)". Do not add an integration or browser harness in this plan.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/runner-protocol.ts` exists with `RunnerCommand`, `RunnerEvent`,
      `RUNNER_EVENT_TYPES`, `RunnerEventBuffer`, `parseRunnerEvent`,
      `serializeRunnerCommand`, `serializeRunnerEvent`, `mapSdkEventToDitto`,
      `planRunnerCommand`, and `RunnerDispatch` — and has no imports from the
      Pi SDK, Cloudflare runtime, or `src/db`.
- [ ] `src/lib/runner-protocol.test.ts` exists and passes, covering every row
      of the SDK→Ditto mapping table and every `planRunnerCommand` branch.
- [ ] `sandbox/runner/index.ts` exists, imports the Pi SDK + the contract
      module, reads NDJSON commands from stdin, writes NDJSON events to stdout,
      diagnostics to stderr, and implements the ask-user tool via `defineTool`
      (not `ctx.ui.input`).
- [ ] `sandbox/runner/package.json` and `sandbox/runner/tsconfig.json` exist.
- [ ] `Dockerfile` installs `tsx` and copies the runner + protocol module into
      `/opt/ditto/` preserving the `sandbox/runner/` + `src/lib/runner-protocol.ts`
      tree, without removing the existing Pi install or extension copy.
- [ ] `tsconfig.json` has an `exclude` array containing `"sandbox/runner"`.
- [ ] No file outside the in-scope list is modified (`git status --short`).
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm test` exits 0, including the new `runner-protocol.test.ts`.
- [ ] `pnpm lint` exits 0 with no new warnings in touched `src/` files.
- [ ] `git diff --check` exits 0.
- [ ] `plans/README.md` status row for Plan 018 is updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts (the
  codebase has drifted since `55b6151`).
- The Pi SDK's `createAgentSession` / `session.prompt` / `session.abort` /
  `SessionManager.inMemory` signatures differ materially from what Step 3
  assumes, and the SDK docs do not clarify a workable shape.
- The Pi SDK does not expose options equivalent to the CLI hardening flags
  (`--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`,
  `--no-approve`, telemetry/version-check off) — do not ship the runner with
  project-local dynamic Pi resources from imported repos enabled.
- `typebox` does not resolve from the globally-installed Pi SDK in the image
  and adding it explicitly does not fix it.
- The runner's stdout is polluted by non-JSON shell noise or Pi TUI escape
  sequences during the manual smoke, so a deterministic NDJSON parser is not
  possible.
- A verification command fails twice after a reasonable fix attempt.
- The work appears to require touching an out-of-scope file (the DO, tRPC
  router, browser, D1 schema, `alchemy.run.ts`, or `src/server.ts`).

## Maintenance notes

- **Phase 2 (plan 019, not yet written)** will rewire `WorkspaceSessionBroker`
  to launch this runner via `startProcess` (cwd `/opt/ditto`, command
  `tsx /opt/ditto/sandbox/runner/index.ts`, stdin from a FIFO) and replace its
  `pi-rpc.ts`/`JsonlBuffer`/`handlePiEvent` machinery with `RunnerEventBuffer`
  + `parseRunnerEvent` from the contract module. When that lands, `pi-rpc.ts`,
  `pi-rpc.test.ts`, and `sandbox/pi/ditto-ask-user.ts` become dead and can be
  deleted.
- **Phase 3 (plan 020, not yet written)** will add redaction of tool output
  before `tool_progress` is emitted, runner reuse/stale-lock cleanup, timeouts,
  and the open runner-restart-continuity question (replay D1 into a fresh
  `AgentSession` vs. start a new conversation — PRD line 204). That decision is
  intentionally deferred out of this plan.
- **Pre-compiling the runner** to JS (instead of running via `tsx` in the image)
  is a follow-up optimization; it removes the `tsx` runtime dependency and
  speeds container start. Not needed for the spike.
- If a future `@cloudflare/sandbox` major release exposes a real `stdin` write
  API, the DO (phase 2) can drop the FIFO bridge and write NDJSON commands
  directly to the runner's stdin; the runner itself needs no change because it
  already reads NDJSON from `process.stdin`.
- A reviewer should scrutinize: that the contract module has no SDK/Worker
  imports (the seam stays pure); that the ask-user tool does not call
  `ctx.ui.input`; that stdout stays clean NDJSON; that `tsconfig.json`'s
  `exclude` does not accidentally exclude `src/lib/runner-protocol.ts` (it must
  stay Worker-typechecked); and that the Dockerfile `COPY` layout preserves the
  `../../src/lib/runner-protocol` relative import.
