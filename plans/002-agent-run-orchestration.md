# Plan 002: Worker agent run + SSE stream + post-run backup

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 61532eb..HEAD -- src/ alchemy.run.ts README.md Dockerfile sandbox/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Prerequisite**: Plan 001 must be DONE (or the runner paths it defines must
> exist). If `sandbox/runner/src/cli.ts` is missing, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/001-ai-harness-runner.md
- **Category**: direction
- **Planned at**: commit `61532eb`, 2026-07-09

## Why this matters

Backup/restore and D1 session metadata already work. The composer still
inserts a hardcoded assistant row (`"Implementation is remaining"`). This plan
wires the real path: wake sandbox → shell session → `execStream` harness →
parse NDJSON → SSE to client → persist assistant text → snapshot workspace
with `createBackup`. Without post-run backup, agent edits die when the
container sleeps (FUSE overlay is ephemeral per Cloudflare docs).

## Current state

### Already correct (reuse — do not reimplement)

`src/lib/sandbox-bootstrap.ts` — `getProjectSandbox` uses
`enableDefaultSession: false`; `backupSandboxWorkspace` / `restoreSandboxWorkspace`
call `createBackup` / `restoreBackup`:

```ts
export function getProjectSandbox(env: Env, sandboxId: string) {
	return getSandbox(
		env.Sandbox as Parameters<typeof getSandbox>[0],
		sandboxId,
		{
			enableDefaultSession: false,
		},
	);
}

export async function backupSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
	projectId: string;
}): Promise<DirectoryBackup> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	return await sandbox.createBackup(
		getSandboxBackupOptions({ env: options.env, projectId: options.projectId }),
	);
}
```

`src/lib/project-sandbox.ts` — `ensureProjectSandbox` hydrates from backup or
recreates from GitHub when the workspace is cold.

`alchemy.run.ts` — Container `Sandbox`, R2 `BACKUP_BUCKET`, credentials bindings.

### Stub to replace

`src/integrations/trpc/routers/workspace.ts` `sendMessage` (approx lines
210–302) inserts user + assistant with content `"Implementation is remaining"`
and returns immediately. No sandbox command, no streaming.

### Gaps vs SDK research

1. `getProjectSandbox` does **not** set `transport: "rpc"`. Agent runs issue
   many SDK ops; RPC multiplexes over one connection (docs:
   https://developers.cloudflare.com/sandbox/configuration/transport/).
2. No `createSession` usage for agent isolation.
3. No SSE HTTP route (only `/api/trpc/$` and `/api/auth/$`).
4. No `OPENCODE_API_KEY` (or similar) Worker binding for the model provider.
5. `execStream` returns SSE of `ExecEvent` (`start|stdout|stderr|complete|error`);
   use `parseSSEStream` from `@cloudflare/sandbox`.
6. SDK types for `exec`/`execStream` have **no `stdin`** — pass the user prompt
   via a job file written with `writeFile`.

### Conventions to match

- tRPC protected procedures for non-streaming mutations (`workspace.ts`).
- API routes: TanStack Start file routes under `src/routes/api.*.ts` with
  `server.handlers` (see `src/routes/api.auth.$.ts`).
- Auth: `createAuth(env).api.getSession({ headers: request.headers })`.
- Errors: `TRPCError` in tRPC; HTTP status + JSON body on raw routes.
- Secrets: never log raw API keys; use `redactSecrets` from
  `src/lib/secret-redaction.ts` on any stderr forwarded to logs/clients.
- Import alias: `#/*` → `./src/*`.
- Tests: vitest + `vi.mock` pattern in `src/lib/project-sandbox.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install` | exit 0 |
| Tests | `pnpm test` | all pass |
| Lint/format check | `pnpm check` | exit 0 |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 |
| Dev (manual) | `pnpm dev` | app boots |

## Suggested executor toolkit

- Docs: https://developers.cloudflare.com/sandbox/api/sessions/
- Docs: https://developers.cloudflare.com/sandbox/api/commands/ (`execStream`)
- Docs: https://developers.cloudflare.com/sandbox/configuration/transport/
- Docs: https://developers.cloudflare.com/sandbox/guides/backup-restore/
- Skill `sandbox-sdk` if available
- Skill `workers-best-practices` if available (streaming Response, no floating promises)

## Scope

**In scope**:

- `src/lib/sandbox-bootstrap.ts` — add `transport: "rpc"` to `getSandbox` options
  (same value every call; do not flip per request)
- `src/lib/agent-run.ts` (create) — job write, createSession, execStream parse,
  post-run backup helper
- `src/lib/agent-run.test.ts` (create)
- `src/lib/agent-stream-protocol.ts` (create) — client SSE event types +
  encoding helpers shared with the route
- `src/lib/agent-stream-protocol.test.ts` (create)
- `src/routes/api.agent.stream.ts` (create) — POST SSE endpoint
- `src/integrations/trpc/routers/workspace.ts` — change `sendMessage` to
  **prepare** only (no stub assistant), or replace usage docs for the new
  stream route (see Step 3)
- `alchemy.run.ts` — bind `OPENCODE_API_KEY` secret + optional
  `SANDBOX_TRANSPORT` var
- `README.md` — document new env var and stream endpoint (brief)
- `plans/README.md` status row

**Out of scope**:

- `sandbox/runner/**` implementation details (plan 001) except invoking the
  known binary path
- Chat UI streaming consumer (plan 003) — but keep the SSE contract stable
- Concurrency mutex / multi-agent file locking
- Changing D1 schema (existing `messages` / `workspace_sessions` suffice)
- Mounting R2 buckets over `/workspace`

## Git workflow

- Branch: `advisor/002-agent-run-sse` (or continue 001 branch if stacked)
- Commits: conventional, e.g. `feat(agent): stream sandbox harness over SSE`
- Do NOT push/PR unless instructed.

## Architecture (implement exactly this)

### Three “session” layers (names in code)

| Layer | Store | ID | Role |
|-------|-------|----|------|
| Workspace conversation | D1 `workspace_sessions` | `sessionId` / `conversationId` | UI chat thread |
| Sandbox shell session | Cloudflare Sandbox `createSession` | e.g. `agent-${sessionId}-${runId}` | Isolated env/cwd for one run |
| PI agent session | File `/workspace/.ditto/sessions/<sessionId>.jsonl` | same as D1 session id | Model history + tools |

### Request flow

```
Client POST /api/agent/stream
  body: { projectId, sessionId?, message, model }
  → auth
  → ensureProjectSandbox
  → ensure D1 workspace session
  → insert user message
  → insert assistant message placeholder (content "" or "…") OR create id only
  → createSession on sandbox
  → writeFile job JSON
  → execStream("node /opt/ditto-runner/dist/cli.js --job <path>")
  → parseSSEStream ExecEvent
  → for stdout chunks: split lines, parse RunnerOut NDJSON, write client SSE
  → on complete: finalize assistant message text in D1, backupSandboxWorkspace,
     storeReady-style update of projects.sandboxBackup
  → SSE event "done"
```

### Client SSE event contract (stable for plan 003)

Use `text/event-stream`. Each event:

```
event: <name>
data: <json>

```

| event | data shape | when |
|-------|------------|------|
| `meta` | `{ sessionId, userMessageId, assistantMessageId, createdSession, sandboxState }` | once at start |
| `agent` | `{ event: unknown }` | each runner `agent_event` (optional pass-through; can omit heavy payloads if needed) |
| `delta` | `{ delta: string }` | each `assistant_delta` |
| `error` | `{ message: string }` | fatal/run error (redacted) |
| `done` | `{ ok: boolean; assistantMessageId: string; content: string }` | terminal |

Always redact secrets in `error.message` and any forwarded stderr.

## Steps

### Step 1: Enable RPC transport on getSandbox

In `src/lib/sandbox-bootstrap.ts`, extend `getProjectSandbox`:

```ts
return getSandbox(env.Sandbox as Parameters<typeof getSandbox>[0], sandboxId, {
  enableDefaultSession: false,
  transport: "rpc",
});
```

Also add to `alchemy.run.ts` website bindings `vars` (or Alchemy equivalent):

- `SANDBOX_TRANSPORT: "rpc"` if Alchemy supports plain vars on the Worker
- `OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY)`

If Alchemy's `TanStackStart` bindings only take the object form used today,
add:

```ts
OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
SANDBOX_TRANSPORT: "rpc",
```

Update `README.md` env list with `OPENCODE_API_KEY=` (no real values).

**Verify**: `pnpm exec tsc --noEmit` → types accept `transport` and new env
fields (Env is inferred from `alchemy.run.ts` via `types/env.d.ts`). If
Alchemy types lag, extend carefully without `any`.

### Step 2: Agent stream protocol helpers

Create `src/lib/agent-stream-protocol.ts`:

- Types for client SSE payloads listed above
- `encodeSseEvent(event: string, data: unknown): string` →
  `event: …\ndata: …\n\n`
- `parseRunnerStdoutLine(line: string): RunnerOut | null` — mirror plan 001
  kinds (`ready|agent_event|assistant_delta|error|done`). Duplicate the
  minimal type here (Worker cannot import from `sandbox/runner`).
- `splitStdoutBuffer(buffer: string, chunk: string): { lines: string[]; rest: string }`
  for partial line buffering across ExecEvent stdout chunks

Tests in `src/lib/agent-stream-protocol.test.ts`.

**Verify**: `pnpm test -- src/lib/agent-stream-protocol.test.ts` → pass

### Step 3: Decide sendMessage vs stream-only

**Required product behavior**: client will stream via SSE (plan 003). Avoid
double-inserting messages.

Recommended approach (implement this unless drift forces otherwise):

1. Change `workspace.sendMessage` to **only**:
   - ensure sandbox
   - create/load D1 session
   - insert **user** message
   - return `{ session, createdSession, userMessage, project, sandbox }`
   - **do not** insert a stub assistant message
2. SSE route inserts the assistant message (placeholder + final update) so
   streaming owns the assistant row.

Update any server comments/README that describe the stub.

**Verify**: `pnpm test` still passes; manually reason that composer in plan 003
will call stream after or instead of full sendMessage. If you keep
`sendMessage` as a thin wrapper used by the stream route internally, that is
also fine — just no stub text.

### Step 4: Implement `src/lib/agent-run.ts`

Core function (signature may be refined but must cover these responsibilities):

```ts
export async function runAgentInSandbox(options: {
  env: Env;
  sandboxId: string;
  projectId: string;
  conversationId: string;
  model: string;
  prompt: string;
  onRunnerMessage: (msg: RunnerOut) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; assistantText: string; backupStored: boolean }>
```

Implementation outline:

1. `const sandbox = getProjectSandbox(options.env, options.sandboxId)`
2. `const shell = await sandbox.createSession({
     id: `agent-${options.conversationId}`,
     cwd: WORKSPACE_PATH, // from workspace-policy
     env: {
       OPENCODE_API_KEY: options.env.OPENCODE_API_KEY,
       // pass through only known provider keys; never dump entire env
     },
     commandTimeoutMs: 10 * 60 * 1000, // 10m; adjust if platform caps lower
   })`
3. Ensure dirs:
   `await shell.exec("mkdir -p /workspace/.ditto/sessions /workspace/.ditto/jobs /workspace/.ditto/pi-agent")`
   (or use `mkdir` API if preferred)
4. Job path: `/workspace/.ditto/jobs/${nanoid()}.json`
5. `await shell.writeFile(jobPath, JSON.stringify({
     conversationId: options.conversationId,
     model: options.model,
     prompt: options.prompt,
     cwd: WORKSPACE_PATH,
   }))`
6. Stream:
   ```ts
   const stream = await shell.execStream(
     `node /opt/ditto-runner/dist/cli.js --job ${quoteShellArg(jobPath)}`,
     { cwd: WORKSPACE_PATH, signal: options.signal },
   );
   ```
   Reuse the same `quoteShellArg` pattern as `sandbox-bootstrap.ts` (extract
   shared helper to `src/lib/shell-quote.ts` **only if** needed to avoid
   duplication — optional; private copy is OK to stay in-scope).
7. Consume with `parseSSEStream<ExecEvent>(stream)` from `@cloudflare/sandbox`.
8. Maintain a stdout line buffer; on each `stdout` event, parse complete
   lines as RunnerOut; call `onRunnerMessage`.
9. On `error` ExecEvent or runner `kind:"error"`, set ok=false.
10. On `complete`, if exitCode !== 0 and no assistant text, ok=false.
11. **Post-run backup** (always attempt if sandbox still usable and run made
    progress or completed):
    ```ts
    const backup = await backupSandboxWorkspace({
      env: options.env,
      sandboxId: options.sandboxId,
      projectId: options.projectId,
    });
    ```
    Caller persists backup to D1 (or do it inside a higher-level function that
    has `db` access). Prefer a second export:
    `finalizeAgentRun({ db, project, backup })` that updates
    `sandboxBackup` / `sandboxBackupCreatedAt` / `status: "ready"` like
    `storeReadyProjectBackup` in `project-sandbox.ts`. You may export that
    helper from `project-sandbox.ts` or duplicate the update query carefully.

12. Best-effort: `await sandbox.deleteSession?.(shell.id)` if API exists
    (`deleteSession` is in Sessions API). If not available on types, skip
    without failing the run.

**Security**:

- Job file content is the only carrier of the user prompt (not shell
  interpolation of the prompt).
- Quote the job path.
- Redact stderr with `redactSecrets(stderr, [options.env.OPENCODE_API_KEY].filter(Boolean))`
  before including in any thrown Error or SSE error.

**Verify**: unit-test line buffering + job JSON shape with mocks; do not call
real sandbox in unit tests.

### Step 5: SSE route `src/routes/api.agent.stream.ts`

Pattern after `api.auth.$.ts` / `api.trpc.$.tsx`:

```ts
import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
// ...
export const Route = createFileRoute("/api/agent/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => { /* ... */ },
    },
  },
});
```

Handler requirements:

1. Method POST only.
2. Auth via better-auth session; 401 if missing.
3. Parse JSON body with **zod** (already a dependency):
   ```ts
   z.object({
     projectId: z.string().min(1),
     sessionId: z.string().min(1).optional(),
     message: z.string().trim().min(1),
     model: z.string().min(1).refine(isProjectCoderModelSpecifier),
   })
   ```
4. Load project owned by user; 404 if missing; 409/400 if status not ready.
5. `ensureProjectSandbox` with decrypted env vars (same as workspace router).
6. Create/load D1 workspace session (same logic as current `sendMessage`).
7. Insert user message; insert assistant message with `content: ""` (or
   `"Thinking…"` — prefer empty and let UI show streaming state).
8. Return `new Response(readable, { headers: {
     "Content-Type": "text/event-stream; charset=utf-8",
     "Cache-Control": "no-cache, no-transform",
     Connection: "keep-alive",
   }})`
9. In the stream start:
   - enqueue `meta` event
   - call `runAgentInSandbox` with `onRunnerMessage` mapping to SSE `agent` /
     `delta` / `error`
   - accumulate assistant text from deltas / done
   - on finish: update assistant message content in D1; persist backup handle;
     enqueue `done`
10. Use `request.signal` for abort when client disconnects.
11. Wrap in try/catch; always try to enqueue `error` + close.

Do **not** use tRPC for this stream.

**Verify**: `pnpm exec tsc --noEmit` → route typechecks  
**Verify**: `pnpm check` → exit 0

### Step 6: Wire D1 updates for backup after run

After a successful (or partially successful) agent run that may have mutated
files, update the project row:

```ts
await db.update(projects).set({
  sandboxBackup: serializeSandboxBackup(backup),
  sandboxBackupCreatedAt: sql`(unixepoch())`,
  updatedAt: sql`(unixepoch())`,
  status: "ready",
}).where(...)
```

If backup fails, still keep assistant message if present; surface backup
failure in `done` payload optional field `backupError?: string` (redacted) so
plan 003 can toast — but do not roll back message persistence.

**Verify**: unit test with mocked db/update optional; at minimum typecheck.

### Step 7: README + env documentation

Update `README.md`:

- Replace “dummy composer” bullet with “agent runs in sandbox via PI harness;
  client streams `/api/agent/stream`”.
- Document `OPENCODE_API_KEY`.
- Note concurrency is **not** enforced yet (one line + pointer that full
  write-up lands in plan 003 docs).

**Verify**: `pnpm test && pnpm check` → exit 0

## Test plan

New tests:

1. `src/lib/agent-stream-protocol.test.ts` — encode SSE, parse runner lines,
   buffer split across chunks.
2. `src/lib/agent-run.test.ts` — mock `getProjectSandbox` / session methods:
   - writes job file with expected JSON
   - invokes execStream with quoted job path containing `ditto-runner`
   - maps stdout NDJSON to `onRunnerMessage`
   - calls `backupSandboxWorkspace` on completion

Model after `src/lib/project-sandbox.test.ts` (`vi.hoisted`, `vi.mock`).

Do **not** require live Docker/Cloudflare for unit tests.

## Done criteria

- [ ] `getProjectSandbox` sets `transport: "rpc"` and `enableDefaultSession: false`
- [ ] `OPENCODE_API_KEY` bound in `alchemy.run.ts` and listed in README
- [ ] `POST /api/agent/stream` exists and is authenticated
- [ ] No code path inserts `"Implementation is remaining"`
- [ ] Agent prompt reaches harness only via job `writeFile`, not shell-concatenated user text
- [ ] Successful run updates `projects.sandboxBackup` via `createBackup`
- [ ] `pnpm test` exits 0 with new unit tests
- [ ] `pnpm check` exits 0
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] No files outside Scope modified
- [ ] `plans/README.md` status for 002 set to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 runner path differs and `/opt/ditto-runner/dist/cli.js` is not the
  agreed binary.
- `parseSSEStream` is not exported from installed `@cloudflare/sandbox` (check
  `index.d.ts`); if missing, STOP rather than hand-rolling a broken parser
  unless the package documents an alternate (`responseToAsyncIterable` etc.).
- Alchemy cannot express `OPENCODE_API_KEY` secret binding — report how env is
  injected instead of hardcoding.
- `createSession` + `execStream` combination fails typecheck or runtime in a
  way that suggests RPC must be env-only (document and use env-only, still OK).
- You need schema migrations for streaming to work (should not).
- Worker platform rejects long-lived SSE entirely in local Alchemy — report
  with reproduction; do not switch to polling without approval.

## Maintenance notes

- Reviewers: confirm transport is consistent on every `getSandbox` call.
- After agent features grow (diff review, PR export), keep post-run backup as
  the durability boundary.
- If multiple concurrent `/api/agent/stream` calls for one project become
  common, plan 003 docs describe the hazard; implement locking later.
- Rotate `OPENCODE_API_KEY` if leaked; never commit it.
- Plan 003 depends on the SSE event names in this file — change only with a
  coordinated client update.
