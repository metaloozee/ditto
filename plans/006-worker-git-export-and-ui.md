# Plan 006: Worker-owned commit / push / open PR + UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6ac3b74..HEAD -- src/lib/github-export.ts src/lib/github-app.ts src/lib/sandbox-bootstrap.ts src/integrations/trpc/routers/ src/components/composer.tsx src/components/ai-chat.tsx src/db/schema.ts`
> If plan 005 has already landed, also re-read `session-worktree.ts` and use
> `workspaceSessions.workspacePath` as the git cwd. If 005 is not merged,
> STOP and report — this plan depends on 005.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH (credentials + git network ops)
- **Depends on**: `plans/005-session-worktrees-and-branches.md`
- **Category**: direction
- **Planned at**: commit `6ac3b74`, 2026-07-09

## Why this matters

Users need a trusted path from sandbox edits → GitHub without giving the
coding agent a GitHub token. Installation App auth already exists for clone
(`getInstallationAccessToken`). Pure helpers exist in `github-export.ts` but
have no production callers. Composer hardcodes branch label `"master"`.

**Product decisions (locked):**

- User triggers commit / push / open PR via **UI** (this plan)
- Chat-driven push/PR via Worker-backed agent tools is plan **007**
- Agent may still local-`git commit` via bash (no token required)
- **No merge** in v1 (deferred)
- Auth identity for network git: **GitHub App installation token**, never
  user OAuth token for push

## Current state

### Installation token (clone only today)

`src/lib/github-app.ts`:

```ts
export async function getInstallationAccessToken(env, installationId): Promise<string>
```

`sandbox-bootstrap.ts` uses tokenized clone URL then **scrubs** remote to
public HTTPS URL — keep that invariant after every push.

### Export helpers (unused)

`src/lib/github-export.ts` — `buildExportBranchName` (run-scoped), commit
message, PR title/body, redaction. Prefer **session branch** from plan 005
(`ditto/session-…`) over run-scoped names for the session’s long-lived branch.
You may still use commit message / PR title helpers; extend or add
session-oriented helpers rather than forcing `runId` into branch names.

### Octokit

- `getGitHubApp` + `getInstallationOctokit` already used in
  `github.listBranches`
- Dependency: `octokit` in root `package.json`

### UI

`src/components/composer.tsx` ~430–434:

```tsx
<div className="flex items-center gap-1">
  <GitBranchIcon className="size-3" />
  <p>master</p>
</div>
```

tRPC patterns: `useTRPC()`, protected procedures in
`src/integrations/trpc/routers/*`. Toasts via `sonner`.

### Security requirements (non-negotiable)

1. Never persist installation tokens in D1, R2 backups, job JSON, or SSE.
2. For push: set remote URL with token → push → **always** scrub remote in
   `finally` (even on failure).
3. Redact all exec stdout/stderr with `redactGitHubExportOutput` /
   `redactSecrets` including the concrete token string.
4. Authorize: session belongs to user; project has `githubRepo` +
   `githubInstallationId`; reuse `authorizeGitHubRepositoryAccess` or
   project ownership checks consistent with other routers.
5. Never log raw tokens.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `pnpm test` | exit 0 |
| Check | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `src/lib/session-git.ts` (**create**) — status/diff/commit/push orchestration
  via sandbox `exec` + installation token
- `src/lib/session-git.test.ts` (**create**) — mocked sandbox + token
- `src/lib/github-export.ts` — small extensions if needed (session PR body
  without fake runId; keep redaction tests green)
- `src/integrations/trpc/routers/workspace.ts` or new
  `src/integrations/trpc/routers/session-git.ts` registered on app router —
  procedures: `gitStatus`, `commit`, `push`, `openPullRequest`
- `src/components/composer.tsx` — real branch name from session
- `src/components/session-git-actions.tsx` (**create**) — Commit / Push /
  Open PR controls (or inline in composer footer / chat header — pick one
  calm place matching PRODUCT.md density)
- Wire actions into project session UI (`ai-chat.tsx` or
  `project.$projectId.tsx`) so they receive `projectId` + `sessionId`
- Tests for pure helpers; mock tests for session-git
- Docs touch: `docs/architecture/agent-harness.md` short “Git export” section
- `README.md` note: GitHub App needs **Contents: Read & write** and
  **Pull requests: Read & write** permissions (document only; do not put
  secrets in README)

**Out of scope**:

- Merge button / merge API (explicitly deferred)
- Agent custom tools (007)
- Worktree creation (005)
- Changing bootstrap clone flow except reusing scrub helper if extracted
- Force-push, branch delete, multi-base-branch picker beyond repo default
  for PR base

## Git workflow

- Branch: `advisor/006-worker-git-export-ui`
- Conventional commits: `feat(git): …`, `feat(ui): …`, `test(git): …`
- Do NOT push/PR unless operator asks

## Design (normative)

### Git cwd

All session git ops use:

```ts
const cwd = session.workspacePath; // worktree from plan 005
```

If `session.branchName` or worktree missing, call the same
`ensureSessionWorktree` from 005 first (import it; do not duplicate).

### `session-git.ts` operations

```ts
// All take env, sandboxId, installationId, githubRepo (owner/repo),
// session { id, branchName, workspacePath }, and user-facing inputs.

getSessionGitStatus(...) -> {
  branch: string;
  dirty: boolean;
  ahead: number; // vs upstream if any, else 0
  changedFiles: string[]; // porcelain paths
  summary: string; // short human text
}

commitSessionChanges(... { message: string; authorName; authorEmail }) -> {
  commitSha: string | null; // null if nothing to commit
  committed: boolean;
}

pushSessionBranch(...) -> {
  remoteBranch: string;
  pushed: boolean;
}

openSessionPullRequest(... { title?: string; body?: string; baseBranch?: string }) -> {
  url: string;
  number: number;
}
```

#### commit (local only)

```
git -C <cwd> status --porcelain
# if empty → committed: false
git -C <cwd> add -A
git -C <cwd> -c user.name=... -c user.email=... commit -m <message>
git -C <cwd> rev-parse HEAD
```

Author: prefer signed-in user `name` + `id+ditto@users.noreply.github.com` or
user email from better-auth if available on ctx.user. Do not use installation
token for local commit.

Stage policy: `git add -A` inside worktree. Do **not** commit if only
`.ditto/` noise appears — if status is empty after filtering, no-op.
Optionally exclude `/workspace/.ditto` by ensuring worktree does not contain
primary `.ditto` (worktrees usually don't). If agent creates secrets files,
still allow commit (user chose to commit) but never commit by accident without
user action.

#### push (tokenized remote)

```
token = await getInstallationAccessToken(env, installationId)
remote = https://x-access-token:${token}@github.com/${githubRepo}.git
public = https://github.com/${githubRepo}.git
try {
  git remote set-url origin <remote>   # in worktree or primary? 
  # Prefer: git -C <cwd> push <remote> HEAD:refs/heads/<branchName>
  # so we never need to set-url on the repo if possible.
  git -C <cwd> push --set-upstream <remote-url> HEAD:refs/heads/<branchName>
} finally {
  git -C <cwd> remote set-url origin <public>  # if origin exists
  # Always scrub; also scrub primary /workspace origin for safety
}
```

**Prefer push URL form** that does not rewrite `origin` long-term:

```
git -C <cwd> push --set-upstream https://x-access-token:TOKEN@github.com/owner/repo.git HEAD:refs/heads/BRANCH
```

Still run scrub of `origin` if it was previously tokenized. Pass token into
`redactSecrets` for any thrown errors.

#### open PR

Use installation Octokit (not user token):

```ts
const app = getGitHubApp(env);
const octokit = await app.getInstallationOctokit(installationId);
const [owner, repo] = githubRepo.split("/");
// base: input.baseBranch ?? repo default_branch from repos.get
await octokit.rest.pulls.create({
  owner, repo,
  head: branchName,
  base,
  title: title ?? buildPullRequestTitle({ sessionTitle }),
  body: body ?? buildPullRequestBody({ projectId, sessionId, runId: sessionId, changedFileCount }),
});
```

If PR already exists for head/base, return existing PR URL
(`pulls.list` filter) instead of failing hard.

**App permissions:** document that the GitHub App must allow Contents write +
PRs write. If API returns 403, surface a clear TRPC error asking to update App
permissions / reinstall.

### tRPC API

Register under workspace or `sessionGit` router (match existing app router
composition in `src/integrations/trpc/router.ts` or equivalent).

Procedures (all `protectedProcedure`):

| Procedure | Input | Behavior |
|-----------|-------|----------|
| `gitStatus` | `{ projectId, sessionId }` | ensure sandbox awake + worktree; return status |
| `commit` | `{ projectId, sessionId, message? }` | default message via `buildExportCommitMessage` |
| `push` | `{ projectId, sessionId }` | commit not auto; push current branch (error if no commits / no remote tracking) |
| `openPullRequest` | `{ projectId, sessionId, title?, body?, baseBranch? }` | push if needed **or** require already pushed — **recommended:** push first if ahead/no upstream, then open PR |

Recommended UX sequence for buttons:

1. **Commit** — local only  
2. **Push** — requires commit(s); pushes branch  
3. **Open PR** — pushes if unpushed, then creates PR  

Disable buttons based on `gitStatus` (Commit disabled when !dirty; Push when
nothing to push; Open PR when no branch commits ahead of base — use simple
heuristics; perfect git graph not required).

### UI

1. Replace hardcoded `master` with `session.branchName ?? "—"` from workspace
   query data already loaded on the project page.
2. Add a compact action group (buttons or dropdown) near composer footer or
   chat header:
   - Commit (optional small message dialog or use session title)
   - Push
   - Open pull request
3. Loading + error toasts (`sonner`); success toast with PR link when
   applicable (`window.open` or anchor).
4. Match existing shadcn / PromptInput button styles; no new design system.
5. Accessibility: visible labels or `aria-label`s on icon-only controls.

Do **not** build a full diff review IDE in this plan. Optional: show
`changedFiles.length` from status next to buttons.

### Extract shared scrub helper

If bootstrap’s remote scrub is duplicated, extract
`scrubGithubRemote(sandbox, cwd, publicRepoUrl)` used by bootstrap + push
finally. Keep behavior identical.

## Steps

### Step 1: Extend pure helpers + tests

Session-oriented naming if needed; keep existing tests passing.

**Verify**: `pnpm test -- src/lib/github-export` → pass

### Step 2: Implement `session-git.ts` with heavy mocks

Mock `getProjectSandbox`, `getInstallationAccessToken`, Octokit PR create.
Assert token appears in push argv only inside try path and redaction on errors.

**Verify**: `pnpm test -- src/lib/session-git` → pass

### Step 3: tRPC procedures + authz

**Verify**: `pnpm check` → 0; add router unit tests if pattern exists, else
rely on session-git tests

### Step 4: UI wiring

**Verify**: `pnpm check` → 0; manual smoke listed in test plan

### Step 5: Docs + README App permissions note

**Verify**: `pnpm test && pnpm check` → 0

## Test plan

- Token redaction still works with installation-shaped tokens (`ghs_…`)
- commit no-op on clean tree
- commit creates sha when porcelain non-empty (mock exec sequence)
- push calls token mint once and never leaves token in returned strings
- open PR uses installation octokit; handles “already exists”
- UI: branch label not the string `master` hardcoded (grep)

```bash
rg -n '"master"' src/components/composer.tsx
# should not be the sole branch label; may still appear as fallback only if documented
```

## Done criteria

- [ ] `pnpm test && pnpm check` exit 0
- [ ] tRPC `commit` / `push` / `openPullRequest` / `gitStatus` exist and are
      authorized
- [ ] Push path uses installation token and scrubs/redacts
- [ ] UI shows real `branchName` and offers Commit, Push, Open PR
- [ ] No merge implementation
- [ ] No GitHub token in agent env or job JSON
- [ ] `plans/README.md` updated
- [ ] Scope-only file changes

## STOP conditions

- Plan 005 not present (no worktree path / ensureSessionWorktree)
- GitHub App cannot be granted write permissions in this environment and 403
  cannot be surfaced cleanly — still implement code + clear error, but STOP
  if product owner required merge-only workflow instead
- `openPullRequest` seems to require user OAuth instead of installation —
  installation is mandatory per product decision; STOP if impossible
- Diff/UI scope creeps into full PR review app

## Maintenance notes

- Plan 007 will call the **same** `session-git` functions from an HTTP
  callback — keep them framework-agnostic (no tRPC types inside core lib)
- Installation tokens expire (~1h); mint per operation, do not cache in D1
- Reviewer focus: finally-scrub, redaction, authz, no force push
- Follow-up: merge button, diff viewer, choose base branch in UI,
  signed commits
