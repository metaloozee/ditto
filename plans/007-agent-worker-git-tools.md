# Plan 007: Agent chat tools for push / open PR via Worker callback

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6ac3b74..HEAD -- sandbox/runner/ src/lib/session-git.ts src/lib/agent-run.ts src/routes/ src/env.ts`
> Requires plans **005** and **006** landed (`session-git` core + worktrees).
> If missing, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: HIGH (agent → network → git write)
- **Depends on**: `plans/005-session-worktrees-and-branches.md`,
  `plans/006-worker-git-export-and-ui.md`
- **Category**: direction
- **Planned at**: commit `6ac3b74`, 2026-07-09

## Why this matters

Users want to say in chat “commit and open a PR” as well as use UI buttons.
**Product decision:** agent may **local-commit via bash**; **push and open PR**
must go through **Worker tools** that mint the GitHub App installation token
— the agent never receives a GitHub credential.

PI has no built-in git tools (`ToolName` =
`read|bash|edit|write|grep|find|ls`) but supports `customTools` on
`createAgentSession`.

## Current state

### Runner

`sandbox/runner/src/run-agent.ts` — `createAgentSession({ tools: [...], ... })`
with no `customTools`.

Job JSON today: `{ conversationId, model, prompt, cwd? }`.

### Worker agent run

`src/lib/agent-run.ts` injects only `OPENCODE_API_KEY` into shell env.

### Plan 006

`src/lib/session-git.ts` exposes `commitSessionChanges`, `pushSessionBranch`,
`openSessionPullRequest`, `getSessionGitStatus` — **reuse these**; do not
reimplement git.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Runner unit (if any) | `cd sandbox/runner && npm test` | exit 0 if tests exist |
| Runner build | `cd sandbox/runner && npm run build` | exit 0 |
| App tests | `pnpm test` | exit 0 |
| App check | `pnpm check` | exit 0 |
| Image | rebuild via `pnpm dev` / deploy after runner change | harness picks up new tools |

## Scope

**In scope**:

- `sandbox/runner` custom tools: `ditto_push_branch`, `ditto_open_pull_request`
  (names exact — stable for prompts)
- Optional: `ditto_git_status` read-only via Worker (or local bash — prefer
  local `git status` via existing bash for status/commit)
- Job JSON + shell env: short-lived **Ditto callback JWT** + callback base URL
  (not a GitHub token)
- Worker route `POST /api/agent/git` (or `/api/internal/session-git`) validating
  JWT and dispatching to `session-git` functions
- JWT mint/verify helpers (use existing secret `BETTER_AUTH_SECRET` **or** new
  env `DITTO_AGENT_GIT_JWT_SECRET` — prefer **reuse `BETTER_AUTH_SECRET`** to
  avoid new deploy secrets unless you already add secrets often; document
  choice in code comment)
- Wire mint into `runAgentInSandbox` / stream route
- Minimal system guidance: tool descriptions tell the model to use bash for
  local commit and these tools for push/PR
- Tests: JWT validate rejects bad tokens; handler authz; runner tool builds
- Docs: architecture note on callback tools
- Rebuild sandbox image (Dockerfile already COPYs runner)

**Out of scope**:

- Merge tool
- Giving agent `GIT_TOKEN` / installation token
- Cloudflare full `/proxy` multi-service framework copy (not required — we
  only need one internal callback API, not proxying GitHub REST through the
  sandbox)
- UI changes (006)

## Git workflow

- Branch: `advisor/007-agent-git-tools`
- Commits: `feat(agent): …`, `feat(runner): …`
- Do NOT push/PR unless asked

## Design (normative)

### Security model

```
Agent custom tool
  → HTTPS POST {action, sessionId, projectId, ...}
    Authorization: Bearer <DITTO_RUN_JWT>
  → Worker /api/agent/git
  → verify JWT (HMAC), check claims match body
  → session-git.push / openPR (installation token only inside Worker)
  → JSON result to tool
```

JWT claims (suggested):

```ts
{
  sub: "agent-git",
  projectId: string,
  sessionId: string,
  userId: string,
  sandboxId: string,
  exp: number, // <= 15 minutes from mint, or AGENT_COMMAND_TIMEOUT aligned
}
```

Mint once per agent run in Worker; pass to sandbox **only** as env:

- `DITTO_GIT_CALLBACK_URL` — absolute URL to the Worker route (from
  `BETTER_AUTH_URL` or request origin)
- `DITTO_GIT_CALLBACK_TOKEN` — JWT

Never put GitHub installation token in these env vars.

### Custom tools (runner)

Implement with PI `ToolDefinition` / `customTools` (inspect installed
`@earendil-works/pi-coding-agent` types under
`dist/core/extensions` for the exact shape — match an example from their
docs or types; if types require `name`, `label`, `description`, `parameters`,
`execute`, follow that).

**`ditto_push_branch`**

- Description: Push this session’s branch to GitHub via Ditto. Use after local
  commits exist. Does not create a PR.
- Params: none or optional empty object
- Execute: `fetch(process.env.DITTO_GIT_CALLBACK_URL, { method:'POST', headers:
  { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'push', ...claims from env or body }) })`
- Return stdout-like tool result with success/error text (redact any accidental
  secrets)

**`ditto_open_pull_request`**

- Params: optional `title`, `body`, `baseBranch`
- action: `openPullRequest`

If env vars missing, tools return a clear error (“Git callback not configured”).

Register:

```ts
tools: ["read", "bash", "edit", "write", "grep", "find", "ls",
        "ditto_push_branch", "ditto_open_pull_request"],
customTools: [pushTool, openPrTool],
```

(Confirm whether custom tool names must also appear in `tools` allowlist —
per SDK comments, when `tools` is provided it is an allowlist; include the
custom names.)

### Worker route

`src/routes/api.agent.git.ts` (TanStack Start server handler, same style as
`api.agent.stream.ts`):

1. Parse JSON body `{ action: 'push' | 'openPullRequest' | 'status', title?, body?, baseBranch? }`
2. Verify Bearer JWT
3. Load project + session; ensure `projectId`/`sessionId`/`userId` match claims
4. `ensureProjectSandbox` if needed
5. Dispatch to `session-git`
6. Return JSON; on error status 4xx/5xx with safe message

No cookie auth required if JWT is valid (agent has no browser cookies). JWT
is the authn.

### Outbound network from sandbox

Sandbox must reach the Worker public URL. Local dev: `BETTER_AUTH_URL`
(`http://localhost:5173` or whatever Alchemy uses). If container cannot reach
host localhost, STOP and report with the error — possible fixes (document,
do not silently skip): host gateway URL, or tunnel. Do not disable auth to
“make it work”.

### Prompting

Keep system prompt changes minimal: tool descriptions are enough. Do not add
huge prompt files unless runner already has a pattern.

## Steps

### Step 1: JWT mint/verify helpers + tests (Worker)

**Verify**: `pnpm test -- src/lib/agent-git-jwt` (or chosen path) → pass

### Step 2: `/api/agent/git` route calling session-git

**Verify**: unit test handler with mocked session-git; `pnpm check`

### Step 3: Mint JWT in `runAgentInSandbox` env

Pass callback URL + token into `createSession({ env: { … } })`.

**Verify**: `agent-run.test.ts` expects env keys present (values mocked)

### Step 4: Runner custom tools + build

**Verify**: `cd sandbox/runner && npm run build` → 0

### Step 5: Docs + full app test/check

**Verify**: `pnpm test && pnpm check` → 0

## Test plan

- JWT expired / wrong secret → 401
- JWT projectId mismatch body → 403
- push action calls `pushSessionBranch` once
- Tool execute without env → structured error (runner test if feasible;
  otherwise Worker-only tests + manual note)
- Grep guarantee: no `getInstallationAccessToken` inside `sandbox/runner`

```bash
rg -n "getInstallationAccessToken|GITHUB_APP|x-access-token" sandbox/runner/src
# expect no matches
```

## Done criteria

- [ ] Agent can invoke push/open PR tools that hit Worker callback
- [ ] No GitHub installation token in sandbox env or runner code
- [ ] UI path from 006 and tools share `session-git` implementation
- [ ] `pnpm test && pnpm check` exit 0; runner builds
- [ ] Architecture doc mentions callback tools
- [ ] `plans/README.md` updated
- [ ] Image rebuild note left for operator if they must restart `pnpm dev`

## STOP conditions

- Sandbox cannot make outbound HTTP to Worker in local or prod after reasonable
  config attempt — report; do not fall back to injecting GitHub tokens
- PI `customTools` API shape differs enough that types will not compile —
  read installed `.d.ts` and adapt; if package version lacks `customTools`,
  STOP (plan assumes `@earendil-works/pi-coding-agent` with `customTools` on
  `CreateAgentSessionOptions` as of 0.80.3)
- Plan 006 `session-git` API missing

## Maintenance notes

- Rotate/short TTL JWTs if agent runs get longer than expiry — align TTL with
  `AGENT_COMMAND_TIMEOUT_MS` (600_000) or refresh strategy
- Reviewer: ensure tools cannot act on a different sessionId than JWT
- Follow-up: merge tool, rate limit callback, audit log of agent-initiated pushes
