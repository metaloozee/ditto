# Agent harness architecture

## Goal

Ditto runs AI coding work inside each project's Cloudflare sandbox. The browser
talks to a Worker over Server-Sent Events (SSE); the Worker wakes the sandbox,
starts an isolated shell session, runs the PI harness, forwards streaming
events, persists chat in D1, and snapshots the workspace when a run finishes.

## Persistence

Workspace files are durable through R2 directory backups, not by mounting an R2
bucket on `/workspace`. `backupSandboxWorkspace` calls `createBackup`; cold
sandboxes hydrate through `restoreBackup` inside `ensureProjectSandbox`. A
FUSE restore is ephemeral for the life of the container, so waking a sleeping
project re-runs restore before agent work. After each agent run, the Worker
stores a fresh backup handle on the project row so edits survive sandbox sleep.

## Three session layers

| Layer | Store | ID | Role |
|-------|-------|----|------|
| Workspace conversation | D1 `workspace_sessions` | `sessionId` / `conversationId` | UI chat thread and message history |
| Sandbox shell session | Cloudflare Sandbox `createSession` | e.g. `agent-<conversationId>` | Isolated cwd and env for one harness run |
| PI agent session | File `/workspace/.ditto/sessions/<sessionId>.jsonl` | Same as D1 session id | Model history, tools, and harness state |

## Runtime path

1. The user sends a message from the composer.
2. The client `POST`s `/api/agent/stream` with cookie auth.
3. The Worker ensures the project sandbox is awake and hydrated.
4. The Worker creates or loads a D1 workspace session and inserts user plus
   assistant placeholder rows.
5. The Worker creates a sandbox shell session and writes a job file (prompt is
   not interpolated into shell commands).
6. The Worker runs `ditto-runner` via `execStream` and parses NDJSON stdout.
7. The harness opens or resumes PI state under
   `/workspace/.ditto/sessions/<conversationId>.jsonl`.
8. The Worker forwards `meta`, `agent`, `delta`, `error`, and `done` SSE events.
9. On completion the Worker updates the assistant message in D1 and calls
   `createBackup` to snapshot `/workspace`.

## Transport

The Sandbox Durable Object talks to the container with RPC transport
(`transport: "rpc"` in `getProjectSandbox`). Multi-step SDK calls multiplex on
one connection so long agent runs do not exhaust HTTP subrequest limits.

## Concurrency (deferred)

All shell sessions for a project share one filesystem and process space inside
the same sandbox container. Two concurrent agent runs can edit the same files and
corrupt the repository.

**Not implemented yet:** an application-level mutex, lease, or queue per
`projectId`. Future work should serialize mutating agent runs per project (for
example a D1 lease row or single-flight coordination in a Durable Object) before
shipping multi-tab parallel agents.

## Security notes

- User prompts travel in job files written with `writeFile`, not via shell
  string interpolation.
- Stderr and client-visible errors pass through `redactSecrets`.
- Model provider keys are injected only as sandbox session environment variables
  (for example `OPENCODE_API_KEY`).
- Never log or expose raw `OPENCODE_API_KEY` values in logs, SSE payloads, or
  UI copy.