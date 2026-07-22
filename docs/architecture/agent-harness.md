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
project re-runs restore before agent work.

Sandbox preparation also validates the baked runner manifest and CLI before it
mutates project state. An invalid `/opt/ditto-runner` fails with an actionable
image rebuild error instead of creating a broken agent run.

Post-run and post-git snapshot writes share `persistProjectSandboxBackup`, which
**versions** each attempt:

1. Atomically increments `sandboxBackupRequestedGeneration` (candidate).
2. Creates the R2 backup for the live workspace.
3. Stores the handle only when
   `sandboxBackupStoredGeneration < candidateGeneration`.

Out-of-order completions therefore cannot let an older snapshot replace a newer
stored generation. Superseded candidates are not failures. First-provision and
restore/recreate paths may still write the backup handle without the generation
gate. After each completed agent run, the stream route calls the versioned helper
once (the runner itself does not snapshot).

## Qualified session layers

| Layer | Store | ID | Role |
|-------|-------|----|------|
| Workspace conversation | D1 `workspace_sessions` | `sessionId` / `conversationId` | UI chat thread and message history |
| Session git worktree | Sandbox filesystem | `ditto/session-<shortId>` on `/workspace/.ditto/worktrees/<sessionId>` | Per-session branch and isolated working tree |
| Sandbox shell session | Cloudflare Sandbox `createSession` | e.g. `agent-<conversationId>` or `git-metadata-<id>` | Isolated cwd and env for one harness run |
| PI agent session (chat) | File `/workspace/.ditto/sessions/<sessionId>.jsonl` | Same as D1 session id | Model history, tools, and harness state |
| PI agent session (UI git metadata) | In-memory only (`SessionManager.inMemory`) | Ephemeral request id | One-shot commit/PR metadata drafting; no JSONL, D1, or chat history |

## Runtime path

1. The user sends a message from the composer.
2. The client `POST`s `/api/agent/stream` with cookie auth.
3. The Worker ensures the project sandbox is awake and hydrated.
4. The Worker creates or loads a D1 workspace session. On the first agent
   message for a session, it ensures a git worktree under
   `/workspace/.ditto/worktrees/<sessionId>` on branch
   `ditto/session-<shortId>` **before** any chat rows are written. Before
   creating that branch for a **new** session (no established `branchName`
   yet), the Worker fetches and fast-forwards the primary clone's **currently
   checked-out** branch from GitHub so `baseCommitSha` matches pushed remote
   state. Existing sessions keep their established branch and worktree; Ditto
   does not fetch, merge, or reset them automatically. Only changes pushed to
   the linked GitHub repository are visible; unpushed commits on a developer
   laptop are outside the sandbox. Symlinks shared `node_modules` from the
   primary `/workspace` tree only (not `.env`), and persists `branchName`,
   `baseCommitSha`, and `workspacePath` on the session row. Dirty tracked
   primary state, a locally ahead primary clone, or a diverged primary branch
   block fresh session worktree creation instead of overwriting local commits.
   If worktree preparation fails for a **newly created** empty session, that
   session row is removed before the 409 response.
5. After the worktree is ready, the Worker inserts the user message
   (`status: complete`) and an assistant placeholder (`status: pending`) in
   one D1 batch, then opens the SSE stream and emits `meta`.
6. The Worker creates a sandbox shell session with cwd set to the session
   worktree, decrypts project environment values from D1, and injects them
   into the session `env` together with provider and callback credentials.
   It writes a job file containing the run IDs, model, prompt, cwd, and the
   optional effective `thinkingLevel` (prompt is not interpolated into shell
   commands).
7. The Worker runs `ditto-runner` via `execStream` and parses versioned NDJSON
   stdout. The runner subscribes to PI SDK events and normalizes assistant
   `text_delta`, `tool_execution_start|update|end`, and run-scoped follow-up
   boundary events; growing partial-message snapshots do not cross the process
   boundary.
8. The runner validates the job, resolves the model and in-memory credential
   store, then opens or resumes PI state under
   `/workspace/.ditto/sessions/<conversationId>.jsonl` on the primary tree.
   `SessionManager.open` supplies durable history; an in-memory
   `SettingsManager` enables compaction and `one-at-a-time` follow-ups. The
   session is created with the session worktree cwd, resolved model/runtime,
   optional thinking level, built-in coding tools, and Ditto Git custom tools.
9. After the runner socket is listening, the Worker emits `control_ready`. A
   later PI user-message boundary finalizes the prior assistant, emits
   `turn_done`, inserts the started follow-up's D1 pair, and emits `turn_start`
   before that turn's assistant deltas.
10. The Worker redacts runner output and structured control events, flushes held
   safe text before ordering boundaries, batches only contiguous text deltas,
   and forwards SSE events in source order.
11. On success the Worker persists each started assistant with
   `status: complete` before its turn settles. On runner/stream/storage failure
   it persists accumulated partial content with `status: failed`, then emits
   `error` followed by failed `done`. Backup is
   best-effort via `persistProjectSandboxBackup` (versioned `createBackup` of
   `/workspace`, including `.ditto/worktrees`) and does not rewrite message
   status.

## Thinking-level propagation

Thinking levels are Pi abstractions, not provider-specific strings. The
canonical order is `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
The frontend clamps the saved preference to the selected model's advertised
capabilities. The Worker validates an explicitly supplied level against the
authorized account catalog before writing any job. If the catalog is legacy or
has no capability metadata, the frontend omits the optional field and the
Worker preserves that compatibility path.

The optional value then travels through `AgentRunContext` to `runAgentInSandbox`,
which writes it to `.ditto/jobs/<id>.json`. `agent-job.ts` is the sandbox trust
boundary: it accepts only the canonical vocabulary before `cli.ts` passes the
value to `runAgent`. `run-agent.ts` supplies it to `createAgentSession`; Pi
clamps again as a defense against an invalid or stale capability boundary. An
omitted value leaves Pi's normal model/session default in control. Follow-ups
reuse that live PI session through the control socket; they do not create a new
thinking-level request.

## Transport

The Sandbox Durable Object talks to the container with RPC transport
(`transport: "rpc"` in `getProjectSandbox`). Multi-step SDK calls multiplex on
one connection so long agent runs do not exhaust HTTP subrequest limits.

PI assistant text updates and tool execution events remain separate throughout
the runner, Worker, SSE, and browser layers. A tool event is an ordering
boundary: pending redacted text and pending server-side delta batches flush
before the tool is forwarded. Text parts concatenate the original delta bytes
without synthetic whitespace, while tool parts retain their chronological
position in the assistant-parts timeline.

### Live PI agent session controls

The browser sends follow-up or Stop as a second cookie-authenticated
`POST /api/agent/control`; it does not open another SSE stream or runner job.
The Worker verifies project and active workspace-session ownership, writes a
bounded JSON control job under `/tmp/ditto-agent-controls`, and runs the static
baked `control-cli.js --job <generated-path>` command. User text never appears
in argv or shell interpolation.

The control CLI connects to a short `runId`-derived Unix-domain socket owned by
the existing runner process. That process alone owns the live PI agent session:
follow-up calls PI `followUp()` in `one-at-a-time` mode, while Stop calls
`clearQueue()` before cooperative `abort()`. Socket commands are serialized, so
follow-up and Stop cannot mutate the PI queue concurrently. Queued metadata is
transient; D1 rows begin only when PI emits the correlated user turn boundary.
The socket, control job, and short-lived sandbox shell session are cleaned up
after use.

Stop acknowledgement means cancellation was requested, not that the provider
or tool stopped instantly. The original runner completion and SSE `done` remain
terminal authority. A browser disconnect remains detached from execution.

## Concurrency

Concurrent workspace sessions for the same project use separate git worktrees
under `/workspace/.ditto/worktrees/<sessionId>`, each on its own
`ditto/session-*` branch. Agent coding runs use the session worktree as `cwd`,
so file edits do not stomp another session's tree. The primary `/workspace` tree
stays the package-install root; `/workspace/node_modules` is symlinked into each
worktree when present so dependencies are not reinstalled per session. Project
environment values are stored encrypted in D1, decrypted by the Worker per run,
and injected into each agent shell session's process `env`; worktrees never
receive a `.env` file.

Residual limits: all sessions still share one sandbox container process space
(dev servers, ports, and long-running processes can collide). There is no
application-level mutex per `projectId` yet; parallel agents should not run
competing installs on the primary tree. Within one session, agent runs and
mutating UI Git operations share an atomic lock under sandbox `/tmp`, preventing
concurrent worktree writers across Worker requests without persisting locks in
workspace backups. UI Commit and UI Open PR hold that same lock from snapshot
collection through generation and mutation; nested git helpers bypass re-lock.

The live control path intentionally bypasses that workspace-session lock: the
active agent run already holds it, so reacquiring it would deadlock. Controls
only reach the same run-scoped Unix socket and do not start a second filesystem
writer.

## Git export

Users commit, push, and open pull requests from the project UI (tRPC
`sessionGit.*`). The Worker runs git commands in the session worktree cwd
(`workspace_sessions.workspacePath`), not in the chat agent harness.

One-click UI Commit and UI Open PR draft metadata from the **actual Git diff**,
not the session title or prompt:

1. Under the session lock, the Worker builds a bounded, redacted snapshot
   (commit: temporary index of safe paths; PR: exact stored `baseCommitSha` to
   `HEAD` subjects/paths/stat/patch). Secret-like paths are omitted; staged
   secrets fail closed. No project env, GitHub tokens, callback JWT, chat text,
   or session title enter the job.
2. A short-lived sandbox shell runs `ditto-git-metadata` with only
   `DITTO_PI_CREDENTIAL` from the fixed operator fallback
   (`opencode/deepseek-v4-flash-free` via `OPENCODE_API_KEY`). Job files live
   under `/tmp/ditto-git-metadata-jobs/` and are deleted afterward.
3. The metadata runner uses an in-memory PI session, empty resource discovery,
   no repository/mutation tools, and exactly one terminating typed tool
   (`submit_commit_metadata` or `submit_pull_request_metadata`). At most two
   assistant turns. No durable PI JSONL or chat history.
4. The Worker independently Zod-validates the one-line protocol result and
   rejects secret-bearing output. Generation failure aborts with no Git/GitHub
   mutation. Explicit commit `message` or PR `title`/`body`/`baseBranch` still
   use the legacy paths (deterministic PR builders for non-UI/agent callers).

Existing sessions can explicitly sync the latest GitHub default branch through
`sessionGit.sync`. Sync requires a clean session worktree, fetches the named
default branch without switching the primary checkout, and merges the exact
fetched commit into the session branch without rebasing or rewriting session
commits. Conflicting merges are aborted before dependency installation. After a
successful merge, dependencies are installed from the session worktree into the
shared `node_modules`. A successful sync stores the new default-branch commit as
`baseCommitSha`, so upstream-only changes are not reported as session-authored
changes.

- Network git uses a short-lived **GitHub App installation access token**
  minted per operation (including the one-shot primary-branch fetch before the
  first session worktree). Tokens are never stored in D1, job files, SSE, env
  vars, or as a persisted `origin` URL; fetch uses a tokenized URL argument and
  scrubs `origin` back to the public HTTPS URL in `finally`.
- Push uses a tokenized remote URL argument, then **scrubs** `origin` back to
  the public HTTPS URL in a `finally` block (primary `/workspace` and worktree).
- Command output is redacted before errors reach the client.
- Opening a PR uses installation Octokit auth (not the user's OAuth token).
- v1 has no merge API or merge button.
- UI and Worker session git mutations refresh the project sandbox backup
  **only after the session lock releases** following a sandbox-mutating success
  (commit that created a commit, or PR open that first pushed — including when
  the subsequent open-PR call fails after a successful push). Opening a PR when
  no push was needed does not snapshot. Backups are best-effort: a failed
  snapshot does not turn a completed git mutation into a reported failure. Cold
  restore therefore does not resurrect pre-export dirty worktrees after real
  mutations.

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

## Session website preview

- One process and one exposed port per active session. Process cwd is the exact
  canonical session worktree; process id is `ditto-preview-<safe-id>`.
- Only exact root `dev` scripts `vite` / `vite dev` / `next` / `next dev` with the
  matching direct dependency and local `node_modules/.bin` binary. Vite must be
  `>=6.1.0`. Fixed commands only — never package scripts, hooks, or installers.
- Preview process env is code-owned (`HOST`, `PORT`, and Vite
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.ayn.wtf`). Project env vars are not
  decrypted or injected. No worktree backup on start.
- Concurrency boundary is the D1 project lifecycle lease (`previewLockToken` /
  expiry / `deletingAt`), not an in-sandbox lock. Writer lock is used only to
  repair a missing worktree, then released before the dev server runs.

## Security notes

- User prompts travel in job files written with `writeFile`, not via shell
  string interpolation.
- Stderr and client-visible errors pass through `redactSecrets`.
- Project environment values are decrypted in the Worker and injected only as
  sandbox shell session process environment variables. Provider and callback
  credentials (for example `OPENCODE_API_KEY`, `DITTO_GIT_CALLBACK_TOKEN`) follow
  the same rule: never stored in worktree files, job JSON, SSE payloads, or git
  remotes.
- The agent can read its process environment through bash, so output redaction
  and pre-push scrub policies (plans 012/013) remain necessary; process env is
  not a hidden vault from the harness.
- GitHub App installation tokens are never placed in the sandbox. Agent git
  tools call the Worker callback with `DITTO_GIT_CALLBACK_URL` and
  `DITTO_GIT_CALLBACK_TOKEN` only (no `GIT_TOKEN` or `x-access-token` in
  runner env).
- Never log or expose raw `OPENCODE_API_KEY` values in logs, SSE payloads, or
  UI copy.

## Account provider credentials (Plan 025)

- Provider login projects bounded model catalogs from Pi, including supported thinking levels, and the Worker persists the safe catalog with the encrypted account credential.
- Login/refresh runs in auth-only sandboxes under `/tmp`; no `auth.json`, no project env, no R2 backup of secrets.
- Project runners receive only an allowlisted `DITTO_PI_CREDENTIAL` runtime projection; OAuth refresh is stripped, and the runner deletes credential env values before PI session/tools start.
- Fallback model is exactly `opencode/deepseek-v4-flash-free` via operator `OPENCODE_API_KEY`.
