# Plan 005: Session worktrees + branch lifecycle for concurrent agents

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6ac3b74..HEAD -- src/lib/agent-run.ts src/lib/workspace-policy.ts src/lib/sandbox-bootstrap.ts src/routes/api.agent.stream.ts src/db/schema.ts docs/architecture/agent-harness.md sandbox/runner/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (builds on DONE plans 001–003)
- **Category**: direction
- **Planned at**: commit `6ac3b74`, 2026-07-09

## Why this matters

Ditto runs one sandbox per project (`/workspace`). Multiple chat sessions share
that filesystem, so concurrent agents corrupt each other. Product intent
(`PRODUCT.md`) says users should always know which **branch** they are on;
schema already has `branchName` / `baseCommitSha` / `workspacePath` but nothing
writes them.

**Chosen approach (product decision):** git **worktrees** per session under
`/workspace/.ditto/worktrees/<sessionId>`, each on branch
`ditto/session-<shortId>`, with **`node_modules` (and `.env`) symlinked** from
the primary `/workspace` so dependencies are not reinstalled per session.
Agent runs use the worktree as `cwd`. Branch + worktree are created **lazily
on the first agent message**.

This plan does **not** implement commit/push/PR UI or GitHub credentials for
push — that is plan 006/007. This plan only isolates session file trees and
records branch metadata.

## Current state

### Schema (placeholders unused)

`src/db/schema.ts` — `workspaceSessions` already has:

```ts
branchName: text("branchName"),
baseCommitSha: text("baseCommitSha"),
workspacePath: text("workspacePath").notNull().default(WORKSPACE_PATH),
```

Session insert in `src/routes/api.agent.stream.ts` only sets
`id`, `projectId`, `userId`, `title`, `status` — never branch fields.

### Agent always runs at `/workspace`

`src/lib/agent-run.ts` (approx lines 71–148):

```ts
const shell = await sandbox.createSession({
  id: `agent-${options.conversationId}`,
  cwd: WORKSPACE_PATH,
  env: { OPENCODE_API_KEY: options.env.OPENCODE_API_KEY },
  commandTimeoutMs: AGENT_COMMAND_TIMEOUT_MS,
});
// job JSON always has cwd: WORKSPACE_PATH
```

### Bootstrap clone (primary tree)

`src/lib/sandbox-bootstrap.ts` clones into `WORKSPACE_PATH` (`/workspace`) via
`sandbox.gitCheckout`, scrubs remote token, installs deps once into
`/workspace/node_modules`.

### PI tools (no dedicated git)

`sandbox/runner/src/run-agent.ts` tools:
`["read", "bash", "edit", "write", "grep", "find", "ls"]`.
PI `ToolName` union has no `git`. Agent can run `git` only via bash.

### Sandbox SDK git API

`@cloudflare/sandbox@0.12.1` exposes only `gitCheckout` (clone). Branch create /
worktree / commit / push must use `sandbox.exec('git …')` (Cloudflare
[Work with Git](https://developers.cloudflare.com/sandbox/guides/git-workflows/)
docs confirm this pattern).

### Architecture doc

`docs/architecture/agent-harness.md` § Concurrency says concurrent agents are
unsafe and deferred. This plan **implements worktree isolation** and must
update that section.

### Conventions

- Paths: `#/*` imports; `WORKSPACE_PATH` from `#/lib/workspace-policy`
- Shell quoting: `quoteShellArg` pattern in `sandbox-bootstrap.ts` / `agent-run.ts`
- Secrets: never log tokens; use `redactSecrets` for command errors
- Tests: Vitest + vi.mock — see `src/lib/agent-run.test.ts`
- Commands: `pnpm test`, `pnpm check` (Biome), no separate typecheck script
  (Vite/TS via build). Prefer `pnpm test` + `pnpm check`.

## Commands you will need

| Purpose   | Command                         | Expected on success        |
|-----------|---------------------------------|----------------------------|
| Tests     | `pnpm test`                     | exit 0                     |
| Lint/fmt  | `pnpm check`                    | exit 0                     |
| Single    | `pnpm test -- src/lib/<file>`   | exit 0, new tests pass     |

## Suggested executor toolkit

- Skill `sandbox-sdk` if available — git via `exec`, not invented SDK methods
- Do **not** add `@earendil-works/pi-coding-agent` to root `package.json`
- Rebuild sandbox image only if runner sources change (this plan may only
  change Worker code; if runner `cwd` already comes from job JSON, no image
  rebuild needed)

## Scope

**In scope**:

- `src/lib/workspace-policy.ts` — path helpers for worktrees / branch names
- `src/lib/session-worktree.ts` (**create**) — ensure branch + worktree + symlinks
- `src/lib/session-worktree.test.ts` (**create**)
- `src/lib/agent-run.ts` — accept `cwd` / worktree path; pass into job + session
- `src/lib/agent-run.test.ts` — expect worktree cwd when provided
- `src/routes/api.agent.stream.ts` — call ensure worktree before run; persist
  `branchName`, `baseCommitSha`, `workspacePath`
- `docs/architecture/agent-harness.md` — document worktrees + concurrency
- Optionally thin helpers in `src/lib/sandbox-bootstrap.ts` if exporting
  `runCommand` is cleaner than duplicating exec+throw (prefer export a shared
  `execOrThrow` rather than copy-paste)

**Out of scope**:

- Commit / push / open PR / merge (plans 006–007)
- GitHub installation token usage beyond any read-only `git fetch` if needed
  (prefer local-only branch from current HEAD; do **not** reintroduce token
  into remote URL in this plan)
- Project mutex / leases
- UI branch label (006)
- Changing Dockerfile / PI package versions
- R2 backup excludes (keep backing up whole `/workspace` including
  `.ditto/worktrees`; `node_modules` already excluded)
- `workspace.sendMessage` stub path (legacy non-streaming) — leave alone unless
  it still creates sessions without worktrees **and** is still called from UI;
  if UI only uses SSE, do not expand scope

## Git workflow

- Branch: `advisor/005-session-worktrees`
- Commits: conventional style matching recent log
  (`feat(workspace): …`, `test(workspace): …`, `docs(agent): …`)
- Do NOT push or open a PR unless the operator instructed it

## Design (normative — implement exactly)

### Paths

```
WORKSPACE_PATH = /workspace                          # primary clone + node_modules
SESSION_WORKTREE_ROOT = /workspace/.ditto/worktrees
session worktree = /workspace/.ditto/worktrees/<sessionId>
branch name = ditto/session-<first 12 chars of sessionId sanitized>
```

Helpers in `workspace-policy.ts` (pure functions, unit-tested):

```ts
export const SESSION_WORKTREE_ROOT = `${WORKSPACE_PATH}/.ditto/worktrees`;

export function sessionWorktreePath(sessionId: string): string {
  // path.join equivalent; sessionId is nanoid — still sanitize for path safety
}

export function sessionBranchName(sessionId: string): string {
  // `ditto/session-` + sanitize(sessionId).slice(0, 12)
}
```

Sanitize: same spirit as `github-export.ts` `sanitizeBranchSegment` — only
`[A-Za-z0-9._-]` (no slashes inside the id segment).

### `ensureSessionWorktree` algorithm

File: `src/lib/session-worktree.ts`

```ts
export async function ensureSessionWorktree(options: {
  env: Env;
  sandboxId: string;
  sessionId: string;
  /** If session already has branchName + workspacePath set, reuse after verifying path exists */
  existing?: {
    branchName: string | null;
    baseCommitSha: string | null;
    workspacePath: string;
  };
}): Promise<{
  branchName: string;
  baseCommitSha: string;
  workspacePath: string;
}>
```

Steps inside (all via `sandbox.exec` with quoted args, cwd `/workspace` unless noted):

1. `getProjectSandbox(env, sandboxId)`.
2. If `existing.branchName` and `existing.workspacePath` look set:
   - `exists(existing.workspacePath)` — if true, return existing (idempotent).
   - if false, fall through to recreate (worktree lost after bad restore).
3. Resolve base SHA: `git rev-parse HEAD` in `/workspace` (primary tree must be
   a git repo — already true after bootstrap).
4. Resolve default base branch name for metadata only:
   `git rev-parse --abbrev-ref HEAD` on primary (or keep primary on whatever
   was cloned; do **not** require GitHub API in this plan).
5. Branch name = `sessionBranchName(sessionId)`.
6. Create branch if missing (from current primary HEAD):
   ```
   git show-ref --verify --quiet refs/heads/<branch> || git branch <branch> HEAD
   ```
   Do **not** check out the branch on the primary tree (primary stays put).
7. Worktree path = `sessionWorktreePath(sessionId)`.
8. If worktree dir missing:
   ```
   git worktree add <worktreePath> <branch>
   ```
   (If `git worktree add` fails because branch already checked out elsewhere,
    STOP and report — should not happen if primary never checks out session
    branches.)
9. Symlink shared deps (only if targets exist on primary):
   ```
   # node_modules
   if [ -e /workspace/node_modules ] && [ ! -e <wt>/node_modules ]; then
     ln -s /workspace/node_modules <wt>/node_modules
   fi
   # .env (project env vars live on primary)
   if [ -f /workspace/.env ] && [ ! -e <wt>/.env ]; then
     ln -s /workspace/.env <wt>/.env
   fi
   ```
   Prefer one `sandbox.exec` bash script with `set -euo pipefail` written via
   `writeFile` then executed, **or** sequential `exec` calls with
   `quoteShellArg` — match bootstrap style. Do not interpolate unsanitized
   sessionId into unquoted shell.
10. Record `baseCommitSha` from step 3 (SHA at worktree creation).
11. Return `{ branchName, baseCommitSha, workspacePath: worktreePath }`.

**Idempotency:** second call for same session must not create a second
worktree or reset the branch.

**No GitHub token** in this plan. Branch is local until plan 006 pushes.

### Wire into agent stream

In `api.agent.stream.ts`, after D1 session row exists and sandbox is ensured,
**before** `runAgentInSandbox`:

```ts
const ensured = await ensureSessionWorktree({
  env,
  sandboxId: ensuredProject.sandboxId!,
  sessionId,
  existing: {
    branchName: workspaceSession.branchName,
    baseCommitSha: workspaceSession.baseCommitSha,
    workspacePath: workspaceSession.workspacePath,
  },
});

if (
  workspaceSession.branchName !== ensured.branchName ||
  workspaceSession.workspacePath !== ensured.workspacePath ||
  workspaceSession.baseCommitSha !== ensured.baseCommitSha
) {
  await db.update(workspaceSessions).set({
    branchName: ensured.branchName,
    baseCommitSha: ensured.baseCommitSha,
    workspacePath: ensured.workspacePath,
    updatedAt: sql`(unixepoch())`,
  }).where(eq(workspaceSessions.id, sessionId));
}
```

Pass `cwd: ensured.workspacePath` into `runAgentInSandbox`.

### Change `runAgentInSandbox`

Add required `cwd: string` (session worktree path). Use it for:

- `createSession({ cwd })`
- job JSON `cwd`
- `execStream(..., { cwd })`

Keep `.ditto/sessions`, `.ditto/jobs`, `.ditto/pi-agent` on **primary**
`/workspace/.ditto/...` (shared agent state store is fine; job files stay on
primary so backup layout is stable). Only the **coding cwd** is the worktree.

Update job write path to remain under `${WORKSPACE_PATH}/.ditto/jobs/`.

Update `agent-run.test.ts`: pass `cwd: "/workspace/.ditto/worktrees/conv-1"`
and expect that path in createSession / job JSON / execStream.

### Docs

Update `docs/architecture/agent-harness.md`:

- Add worktree row to session layers table
- Replace "Concurrency (deferred)" with: concurrent sessions use separate
  worktrees; shared `node_modules` via symlink; primary `/workspace` is the
  package install root; still one process space (ports/dev servers can
  collide) — note residual limits honestly
- Runtime path step: ensure worktree before harness run

## Steps

### Step 1: Pure path helpers + tests

Add `sessionWorktreePath`, `sessionBranchName`, constants to
`workspace-policy.ts`. Unit test edge cases (slash/special chars in id —
nanoid is safe but sanitize anyway).

**Verify**: `pnpm test -- src/lib/workspace-policy` or co-located test file → pass

### Step 2: `session-worktree.ts` + unit tests with mocked sandbox

Mock `getProjectSandbox` / `exec` / `exists` like `agent-run.test.ts`.
Cover: first ensure creates branch+worktree+symlinks; second ensure is no-op;
recreate when path missing.

**Verify**: `pnpm test -- src/lib/session-worktree` → pass

### Step 3: Thread `cwd` through `runAgentInSandbox`

**Verify**: `pnpm test -- src/lib/agent-run` → pass (updated expectations)

### Step 4: Call ensure from `api.agent.stream.ts` and persist D1 fields

No full integration test required if none exists for the route; keep changes
minimal and type-safe.

**Verify**: `pnpm check` → exit 0

### Step 5: Architecture doc update

**Verify**: file mentions worktrees and no longer says concurrency is fully deferred without the worktree design

### Step 6: Full suite

**Verify**: `pnpm test && pnpm check` → exit 0

## Test plan

| Case | Where |
|------|--------|
| branch name sanitization | `workspace-policy` or `session-worktree` test |
| first ensure creates worktree | `session-worktree.test.ts` |
| second ensure reuses | same |
| missing worktree recreates | same |
| agent-run uses provided cwd | `agent-run.test.ts` |
| job JSON cwd matches worktree | `agent-run.test.ts` |

Do **not** require Docker for unit tests.

## Done criteria

- [x] `pnpm test` exits 0 including new worktree tests
- [x] `pnpm check` exits 0
- [x] `workspace_sessions.branchName`, `baseCommitSha`, `workspacePath` are
      written on first agent stream for a session
- [x] Agent job `cwd` is `/workspace/.ditto/worktrees/<sessionId>` not bare
      `/workspace`
- [x] Primary tree is never force-checked-out to a session branch as part of
      ensure (worktree add only)
- [x] `node_modules` and `.env` symlinked when present on primary
- [x] No GitHub installation token appears in new code paths
- [x] `docs/architecture/agent-harness.md` documents worktrees
- [x] No files outside in-scope list modified (`git status`)
- [x] `plans/README.md` status row updated

**Execution**: COMPLETE on `advisor/005-session-worktrees` @ `b5d9cad`  
**Worktree**: `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f4ad4-629d-7940-bdc6-1d9e681e33f3`  
**Reviewer verdict**: APPROVE (2026-07-10)

## STOP conditions

- `git worktree` is missing inside the sandbox image (base
  `cloudflare/sandbox:0.12.1` should include git; if `git worktree add`
  fails with "not a git command", STOP — do not invent a copy-based fake)
- Primary `/workspace` is not a git repo after `ensureProjectSandbox` (bootstrap
  bug — report)
- Implementing ensure requires changing backup `dir` away from `/workspace`
- You believe monorepo packages need per-worktree installs (e.g. nested
  `packages/*/node_modules`) — implement root symlink only; document follow-up
  in maintenance notes; do not expand to multi-root install
- Drift in cited files vs excerpts

## Maintenance notes

- Plan 006 commit/push must run git commands with `cwd` =
  `session.workspacePath` (worktree), not primary
- If bootstrap re-clones primary, worktrees may break — `ensureSessionWorktree`
  recreate path handles missing dirs; may need `git worktree prune` later
- Shared `node_modules` means two agents can race npm installs if both trigger
  install — installs stay on primary only; agents should not reinstall in
  worktree
- Reviewer: confirm no token in remote URL; confirm primary HEAD unchanged
  after ensure
- Deferred: merge UI, package-manager-specific link farms beyond root
  `node_modules`, per-session preview ports
