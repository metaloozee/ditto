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
| Session git worktree | Sandbox filesystem | `ditto/session-<shortId>` on `/workspace/.ditto/worktrees/<sessionId>` | Per-session branch and isolated working tree |
| Sandbox shell session | Cloudflare Sandbox `createSession` | e.g. `agent-<conversationId>` | Isolated cwd and env for one harness run |
| PI agent session | File `/workspace/.ditto/sessions/<sessionId>.jsonl` | Same as D1 session id | Model history, tools, and harness state |

## Runtime path

1. The user sends a message from the composer.
2. The client `POST`s `/api/agent/stream` with cookie auth.
3. The Worker ensures the project sandbox is awake and hydrated.
4. The Worker creates or loads a D1 workspace session and inserts user plus
   assistant placeholder rows.
5. On the first agent message for a session, the Worker ensures a git worktree
   under `/workspace/.ditto/worktrees/<sessionId>` on branch
   `ditto/session-<shortId>`, symlinks shared `node_modules` and `.env` from
   the primary `/workspace` tree, and persists `branchName`, `baseCommitSha`,
   and `workspacePath` on the session row.
6. The Worker creates a sandbox shell session with cwd set to the session
   worktree and writes a job file (prompt is not interpolated into shell
   commands).
7. The Worker runs `ditto-runner` via `execStream` and parses NDJSON stdout.
8. The harness opens or resumes PI state under
   `/workspace/.ditto/sessions/<conversationId>.jsonl` on the primary tree.
9. The Worker forwards `meta`, `agent`, `delta`, `error`, and `done` SSE events.
10. On completion the Worker updates the assistant message in D1 and calls
   `createBackup` to snapshot `/workspace` (including `.ditto/worktrees`).

## Transport

The Sandbox Durable Object talks to the container with RPC transport
(`transport: "rpc"` in `getProjectSandbox`). Multi-step SDK calls multiplex on
one connection so long agent runs do not exhaust HTTP subrequest limits.

## Concurrency

Concurrent workspace sessions for the same project use separate git worktrees
under `/workspace/.ditto/worktrees/<sessionId>`, each on its own
`ditto/session-*` branch. Agent coding runs use the session worktree as `cwd`,
so file edits do not stomp another session's tree. The primary `/workspace` tree
stays the package-install root; `node_modules` and `.env` are symlinked into each
worktree when present so dependencies are not reinstalled per session.

Residual limits: all sessions still share one sandbox container process space
(dev servers, ports, and long-running processes can collide). There is no
application-level mutex per `projectId` yet; parallel agents should not run
competing installs on the primary tree.

## Git export

Users commit, push, and open pull requests from the project UI (tRPC
`sessionGit.*`). The Worker runs git commands in the session worktree cwd
(`workspace_sessions.workspacePath`), not in the agent harness.

- Network git uses a short-lived **GitHub App installation access token**
  minted per operation. Tokens are never stored in D1, job files, or SSE.
- Push uses a tokenized remote URL argument, then **scrubs** `origin` back to
  the public HTTPS URL in a `finally` block (primary `/workspace` and worktree).
- Command output is redacted before errors reach the client.
- Opening a PR uses installation Octokit auth (not the user's OAuth token).
- v1 has no merge API or merge button.
- UI and Worker session git mutations (commit / push / open PR) refresh the
  project sandbox backup after success so cold restore does not resurrect
  pre-export dirty worktrees.

Chat-driven git uses PI custom tools in the sandbox runner (`ditto_push_branch`,
`ditto_open_pull_request`). Those tools `POST` to Worker `POST /api/agent/git`
with a short-lived HS256 JWT (`DITTO_GIT_CALLBACK_TOKEN`) minted when the
agent shell session starts. The Worker verifies the JWT and reuses the same
`session-git` helpers as the UI (installation token only inside the Worker).
Use bash for local `git status` / `git commit`; use Ditto tools for push and
open PR only.

Agent git guidance (tool `promptGuidelines` + descriptions):

- Local commits use **Conventional Commits**
  (`feat:`, `fix:`, `chore:`, …; imperative subject).
- Before `ditto_open_pull_request`, the agent should review commits and the
  diff, then pass a **humanized title** and **brief body** (not raw commit
  subjects alone). Worker defaults still apply if title/body are omitted
  (deterministic helpers in `github-export.ts` from commit subjects and
  `git diff --name-only` file paths vs base).

Operators must rebuild the sandbox image (restart `pnpm dev` or redeploy) after
runner changes so custom tools appear in the container.

## Security notes

- User prompts travel in job files written with `writeFile`, not via shell
  string interpolation.
- Stderr and client-visible errors pass through `redactSecrets`.
- Model provider keys are injected only as sandbox session environment variables
  (for example `OPENCODE_API_KEY`).
- GitHub App installation tokens are never placed in the sandbox. Agent git
  tools call the Worker callback with `DITTO_GIT_CALLBACK_URL` and
  `DITTO_GIT_CALLBACK_TOKEN` only (no `GIT_TOKEN` or `x-access-token` in
  runner env).
- Never log or expose raw `OPENCODE_API_KEY` values in logs, SSE payloads, or
  UI copy.