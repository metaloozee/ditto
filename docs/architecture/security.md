# Security and trust boundaries

## Goal

Ditto executes an AI coding agent against user repositories. The architecture
therefore assumes prompts, repository contents, tool output, and sandbox process
environment are untrusted or disclosure-prone. Authorization and secret controls
are enforced at the Worker and Git export boundaries, not delegated to the
model.

## Trust zones

| Zone | Trusted for | Not trusted for |
|---|---|---|
| Browser | User interaction and cookie transport | Resource ownership, Git policy, durable terminal state |
| Worker | Authentication, authorization, secret handling, D1 writes, credential minting | Arbitrary text emitted by agent/sandbox commands |
| D1 | Durable metadata under Worker access | Plaintext project secrets (stored encrypted instead) |
| Sandbox | Isolated repository execution | Keeping process environment hidden from the agent |
| PI harness/model | Requested code work | Authorization decisions, secret-safe output, GitHub credentials |
| GitHub | Repository and PR authority | Ditto application ownership without OAuth/App checks |
| R2 backup | Encrypted Cloudflare object storage for workspace snapshots | Live filesystem semantics or secret-file filtering beyond configured excludes |

## Authentication and authorization

Browser APIs use better-auth GitHub OAuth and an HTTP-only session cookie. tRPC
creates the auth session once per request, and protected procedures require a
user. Direct SSE and `/api/agent/control` handling perform the same better-auth
session check.

Every project and workspace-session lookup includes the authenticated `userId`.
GitHub operations also call `authorizeGitHubRepositoryAccess`, which checks the
user OAuth token's visible repositories and installation ID. The OAuth token
proves user access; a short-lived GitHub App installation token performs the
server-side repository mutation.

The sandbox runner cannot call browser-authenticated tRPC. Its two Git tools use
`/api/agent/git` with a short-lived HS256 bearer JWT containing project, session,
user, sandbox, subject, issue time, and expiry. The Worker verifies shape,
signature, subject, and time, then resolves claims against current D1 ownership
and readiness before dispatch.

Follow-up and Stop controls prove authenticated project ownership and an active,
owned workspace session before any sandbox access. Missing, foreign, archived,
or stale run targets are rejected without creating message rows.

Model and thinking-level input is also untrusted browser input. The stream route
requires a valid session and bounded `provider/model` syntax. The Worker then
resolves the user's encrypted provider connection and catalog; it accepts only
catalog models, plus the exact operator fallback, and rejects explicit thinking
levels that are not authorized for that model. These checks happen before
sandbox, session, or message side effects. Browser-side clamping improves UX but
is not an authorization boundary.

## Provider credentials and capability metadata

Provider credentials are encrypted in `ai_provider_credentials` with
`AI_CREDENTIALS_ENCRYPTION_KEY` and user/provider AAD. Provider login runs in an
auth-only sandbox and persists only a bounded, validated safe model catalog
alongside the credential. Catalog metadata contains model names and Pi's
canonical thinking capabilities, not credential material. OAuth refresh uses a
D1 lease and compare-and-swap version; a process whose exit cannot be confirmed
keeps the lease until TTL rather than being released while it may still run.

At project-run time, the Worker projects credentials into the minimum runtime
shape. API-key environment fields are allowlisted; OAuth refresh is replaced by
`ditto:no-refresh`, and the access token must outlive the agent command window
plus safety skew. The runner receives this projection through
`DITTO_PI_CREDENTIAL`, then deletes credential env values before PI session and
tool initialization. The exact fallback uses operator `OPENCODE_API_KEY` and
never requires an account connection.

## Secret storage and injection

Project environment variables are normalized, deduplicated, encrypted with
AES-256-GCM, and stored as a versioned payload in `projects.envVars`. The key is
derived from `BETTER_AUTH_SECRET` with PBKDF2-SHA-256, a random salt, and 310,000
iterations. The UI can list keys but never reads values back.

At run time the Worker decrypts values and injects them into the isolated shell
session process environment together with `OPENCODE_API_KEY` and the Git callback
JWT. Values are not written to a worktree `.env`, agent job JSON, SSE metadata,
or Git remote.

The process environment is not a vault from the agent: shell tools can read it.
Controls therefore also exist on output and Git egress.

## Output redaction

`secret-redaction.ts` removes known concrete secrets of at least eight
characters plus common GitHub, provider-key, AWS-key, and PEM patterns.
Redaction is applied to:

- runner text deltas, including secrets split across stream chunks;
- structured PI events and tool payloads;
- stderr and command failures;
- assistant content before D1 persistence; and
- Git/export errors before they reach the client.

The streaming redactor holds only a suffix that could complete a configured
exact secret, plus a small bounded window for secret-shaped patterns. Very long
configured values therefore do not buffer an entire assistant response. A PI
tool event ends the current assistant-text segment, so the Worker's runner
bridge safely flushes held text before forwarding the tool event. Incomplete
PEM regions stay
held until a complete block arrives or the segment ends, when they fail closed
to the redaction marker.

## Git credential handling

GitHub installation tokens are minted per operation inside the Worker. Clone,
fetch, and push pass a tokenized HTTPS URL as a command argument only for that
operation. A `finally` path resets `origin` to the public HTTPS URL. Tokens are
provided to command-error redaction and are never persisted in D1, R2 metadata,
runner environment, job files, or remote configuration.

The runner receives only a Ditto callback URL and scoped JWT. Push and pull
request operations return through the Worker, which mints the installation token
and applies the same domain policy as the UI.

## Git egress policy

Before outgoing commits are pushed, `git-secret-policy.ts` fails closed when it
cannot establish or inspect the outgoing range. It blocks:

- `.env` and `.env.*` paths at any nesting level;
- binary or unreadable additions that cannot be inspected safely;
- known project secret values found in added lines;
- recognized secret-shaped content; and
- malformed Git output or unresolved commit ranges.

Local agent edits and commits remain possible so work is not destroyed; the
policy blocks export from the sandbox to GitHub.

## UI git-metadata drafting

One-click UI Commit / Open PR spawn an ephemeral metadata agent that is **not**
the chat harness:

- No project environment variables, GitHub tokens, or git-callback JWT in the
  shell or job. Only operator-fallback `DITTO_PI_CREDENTIAL` is passed and
  deleted inside the runner before the PI session starts.
- Input is a bounded, redacted **Git snapshot** (paths/stat/patch/subjects),
  never the user prompt or session title. Secret-like paths are omitted;
  `redactStructured` runs before the job is written; patch size is capped.
- The agent has no repository tools, no disk resource discovery, and only one
  typed terminating output tool. Prompt wording treats the diff as untrusted
  data; isolation is enforced by tool removal, schema validation, and redaction,
  not prompt text alone.
- Output is independently Zod-validated in the Worker and rejected if
  secret redaction would change it. Errors are reason-coded and redacted; raw
  model/diff/stderr/credentials never reach the browser.
- `/tmp` job, patch, and temp-index artifacts are removed on every path. The
  metadata session is in-memory and disposed; nothing is written to D1 or PI
  JSONL. Generation failure occurs before any Git/GitHub mutation.

## Filesystem and command controls

Prompts are serialized to a job file with the Sandbox file API and never
interpolated into a shell command. `agent-job.ts` validates that job at the
sandbox boundary, including the optional thinking level's canonical vocabulary,
before `cli.ts` invokes the runner. Shell values that must enter commands are
single-quoted by narrow helpers. Destructive workspace clearing checks that the
configured root is exactly `/workspace` before running.

Follow-up text likewise travels in a bounded JSON job, never argv. The Worker
invokes only the baked control CLI with a generated job path; the CLI reaches a
run-scoped Unix-domain socket under `/tmp`. Control jobs, sockets, and temporary
sandbox shell sessions are removed on success and failure. Structured control
events and diagnostics pass through the same bounded redaction boundary as
runner output.

Per-session mutations acquire an atomic directory lock under `/tmp`. Locks are
outside `/workspace`, so backups do not preserve stale lock state. A stale-lock
recovery window prevents permanent deadlock after an interrupted process.

R2 backups explicitly exclude `.env` and `.env.*`, package stores,
dependencies, build outputs, and caches. Session worktrees symlink only
`node_modules`; no environment file is shared from the primary clone.

## Failure posture

- Ownership failures return not found/forbidden rather than continuing.
- Invalid or expired agent JWTs return 401.
- Secret preflight and ambiguous outgoing Git ranges fail closed.
- Sandbox runner health is checked before project state is mutated.
- Assistant terminal persistence is attempted before successful `done`.
- Browser fetch cancellation and disconnect do not cancel execution. Only an
  authenticated Stop control calls PI `clearQueue()` and cooperative `abort()`;
  terminal SSE persistence remains authoritative.
- Backup failure is reported as non-fatal after a completed run or Git mutation;
  it does not rewrite the successful operation's result.
- Client-visible errors are redacted, while server logs avoid raw credentials.

## Security-sensitive files

| Concern | Files |
|---|---|
| Auth/session | `apps/web/src/lib/auth.ts`, `auth.client.ts`, `auth.functions.ts`, `apps/web/src/integrations/trpc/init.ts` |
| Live agent control | `apps/web/src/lib/agent-control-service.ts`, `apps/web/src/routes/api.agent.control.ts`, `packages/sandbox-runner/src/control-channel.ts` |
| GitHub authorization | `apps/web/src/lib/github-authorization.ts`, `github-app.ts`, `github-repositories.ts` |
| Agent callback JWT | `apps/web/src/lib/agent-git-jwt.ts`, `agent-git-handler.ts`, `apps/web/src/routes/api.agent.git.ts` |
| Encryption/env vars | `apps/web/src/lib/crypto.ts`, `project-env-vars.ts`, `env-vars.ts` |
| Redaction | `apps/web/src/lib/secret-redaction.ts`, `agent-run.ts`, `github-export.ts` |
| Git egress | `apps/web/src/lib/git-secret-policy.ts`, `session-git.ts` |
| UI git metadata | `apps/web/src/lib/session-git-metadata.ts`, `session-git-ui-actions.ts`, `packages/sandbox-runner/src/run-git-metadata.ts` |
| Backup exclusions | `apps/web/src/lib/sandbox-backup.ts` |
| Workspace locking | `apps/web/src/lib/session-workspace-lock.ts`, `workspace-policy.ts` |

## Account provider credentials (Plan 025)

- Credentials are account-scoped in D1 (`ai_provider_credentials`), encrypted with `AI_CREDENTIALS_ENCRYPTION_KEY` + user/provider AAD.
- Login/refresh runs in auth-only sandboxes under `/tmp`; no `auth.json`, no project env, no R2 backup of secrets.
- Project runners receive `DITTO_PI_CREDENTIAL` only as an allowlisted runtime projection; OAuth refresh is stripped and the runner deletes credential env values before session/tools.
- Provider catalogs carry Pi's canonical thinking capabilities; missing levels remain readable for legacy D1 catalogs and cause the client to omit `thinkingLevel`.
- Fallback model is exactly `opencode/deepseek-v4-flash-free` via operator `OPENCODE_API_KEY`.
