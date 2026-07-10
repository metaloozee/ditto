# Plan 009: Fix stale composer git status after commit/push (missing sandbox backup)

> **For agentic workers:** REQUIRED: implement task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Run every verification command and confirm the
> expected result before moving on. Prefer TDD. Do **not** push or open a PR
> unless the operator asks.
>
> **Drift check (run first):**
> `git diff --stat HEAD -- src/lib/session-git.ts src/lib/project-sandbox.ts src/integrations/trpc/routers/session-git.ts src/lib/agent-git-handler.ts src/lib/agent-run.ts src/components/session-git-actions.tsx`
> Re-read any drifted files before editing.

## Status

- **Priority**: P0 (user-visible correctness bug on happy path)
- **Effort**: M
- **Risk**: MED (backup/R2 + D1 project row; must not drop secrets into backups beyond existing excludes)
- **Depends on**: plans 005–006 (worktrees + session git export)
- **Category**: bugfix
- **Repro route**: `/project/35ZGvNdNagBE9ns1WlGyL/session/JPHeonfn0gvHpqtUqvH94`
- **Planned at**: 2026-07-10

## Goal

After a session’s changes are committed (and typically pushed / PR opened), a
full page reload of the chat must show a **clean** working tree: no changed-file
capsule, **Commit disabled**, PR button still showing the open PR. Today, reload
resurrects **stale dirty files** and re-enables Commit even though the work is
already on GitHub.

## Confirmed diagnosis (do not re-litigate without new evidence)

### Symptom (user report)

On the composer for session `JPHeonfn0gvHpqtUqvH94`:

- File-count capsule shows **2** changed files (PR files: `src/App.tsx`,
  `src/App.css`)
- **Commit is active** (`dirty === true`)
- PR control correctly shows `#2` (open PR exists)
- Changes were already committed + pushed before reload

### Live evidence from this machine

| Fact | Source |
|------|--------|
| Session worktree path correct | D1 `workspace_sessions`: `workspacePath=/workspace/.ditto/worktrees/JPHeonfn0gvHpqtUqvH94`, branch `ditto/session-JPHeonfn0gvH` |
| PR `#2` on GitHub has commit `chore: the index page` touching App.tsx + App.css | GitHub API |
| UI commit + push succeeded | `.alchemy/logs/ditto-website-ayan.log` ~10:43Z: `git add -A`, `git commit`, `git push` |
| Last backup **before** cold wake was `67cd58ce-…` created ~agent-run time (dirty tree) | log `backup.create success 67cd58ce…` near worktree creation |
| After reload, sandbox restored **that** backup | log `backup.restore success 67cd58ce…` at `2026-07-10T10:55:16Z` — **after** commit/push |
| Restore then wrote a **new** backup of the dirty restored tree (`3d49dec9…`) and stored it on the project | log + D1 `projects.sandboxBackup` |
| Agent runs always call `backupSandboxWorkspace` at end of `runAgentInSandbox` | `src/lib/agent-run.ts` |
| UI `sessionGit.commit` / `push` / `openPullRequest` **never** update `projects.sandboxBackup` | `src/integrations/trpc/routers/session-git.ts` |

### Root cause (one sentence)

**Workspace-mutating git export ops from the UI do not refresh the project’s
sandbox backup, so cold restore rehydrates the last post-agent-run snapshot
(often still dirty), while GitHub/PR state remains correct.**

### Non-causes (ruled out)

| Hypothesis | Why ruled out |
|------------|----------------|
| React Query cache after reload | Full reload; no persist plugin; `gitStatus` refetches |
| Wrong worktree path / branch | D1 metadata correct; PR branch matches |
| `parsePorcelainPaths` false positives | Files are the real PR files; restore explains reappearance |
| PR detection wrong | PR is correct; only dirty/ahead UI is wrong |
| Symlink `node_modules`/`.env` as the 2 files | Repo ignores `node_modules`; PR files are App.tsx/App.css |

### Failure chain

```
agent edits files (dirty)
  → agent run ends → backupSandboxWorkspace (DIRTY snapshot stored on project)
  → user Commit / Push / Open PR via UI (worktree clean + remote updated)
  → NO backup update
  → sandbox sleeps / cold-starts
  → ensureProjectSandbox restores DIRTY snapshot
  → optionally re-backups dirty tree (locks bug in)
  → SessionGitActions shows 2 files + Commit active; PR still found via Octokit
```

## Architecture of the fix

**Persist a fresh sandbox backup (and D1 `sandboxBackup` handle) after any
Worker-owned session git mutation that changes sandbox filesystem / git state.**

Minimum required:

1. After **successful commit that actually committed** (`committed === true`)
2. After **successful push** (`pushed === true`) — updates `refs/remotes/origin/*` and upstream tracking used by `ahead`
3. After **openPullRequest** when it **auto-pushed** (same as push) — if openPR only creates the GitHub PR with no local git change, backup is optional but cheap consistency is fine

Reuse the same backup + D1 write path already used by agent runs / restore
(`backupSandboxWorkspace` + serialize into `projects.sandboxBackup` /
`sandboxBackupCreatedAt` / `status: "ready"`).

Prefer a **single exported helper** on `project-sandbox.ts` (or a tiny
`sandbox-backup-persist.ts`) so session-git router and `finalizeAgentRun` do
not diverge.

### Out of scope

- Changing UI copy / capsule design
- Fixing historical bad backups already stored for this project (optional
  one-shot re-backup on next successful git op is enough)
- Merge button
- Making agent bash commits backup mid-run (end-of-run backup already covers)
- Changing restore pipeline broadly

## File map

| File | Role |
|------|------|
| `src/lib/project-sandbox.ts` | Export `persistProjectSandboxBackup` (lift/adapt private `storeReadyProjectBackup`) |
| `src/lib/agent-run.ts` | Optionally call shared helper instead of inlined D1 write in `finalizeAgentRun` (same behavior) |
| `src/integrations/trpc/routers/session-git.ts` | After commit/push/openPR success, call persist helper |
| `src/lib/agent-git-handler.ts` | After agent-driven push/openPR success **during a run**, optional: no backup required mid-run **if** end-of-run always backs up. **Still back up** if these handlers can be invoked when no agent-run backup will follow — today they only run mid-agent via JWT, so **router is the critical path**. Document this; only add handler backup if easy and tested. |
| `src/lib/project-sandbox.test.ts` or extend existing tests | Unit tests for persist helper |
| `src/integrations/trpc/routers/session-git.ts` tests **or** focused unit test of a thin orchestration function | Prove commit/push path triggers backup |
| `docs/architecture/agent-harness.md` | One short note: UI git export refreshes sandbox backup |

## Normative design

### Helper API

```ts
// src/lib/project-sandbox.ts

/**
 * Snapshot /workspace (incl. worktrees) and store the backup handle on the
 * project row. Same durability path as post-agent-run and post-restore.
 */
export async function persistProjectSandboxBackup(options: {
  db: ReturnType<typeof createDb>;
  env: Env;
  project: {
    id: string;
    userId: string;
    sandboxId: string | null;
    status: string;
  };
}): Promise<typeof projects.$inferSelect> {
  if (options.project.status !== "ready" || !options.project.sandboxId) {
    throw new Error("Project sandbox is not ready.");
  }
  const backup = await backupSandboxWorkspace({
    env: options.env,
    sandboxId: options.project.sandboxId,
    projectId: options.project.id,
  });
  return storeReadyProjectBackup({
    db: options.db,
    project: options.project as typeof projects.$inferSelect,
    backup,
  });
}
```

Export or keep `storeReadyProjectBackup` private but callable from the new
helper in the same file. Prefer exporting only `persistProjectSandboxBackup`.

### When the session-git router must persist

| Procedure | Persist when |
|-----------|----------------|
| `commit` | `result.committed === true` |
| `push` | mutation succeeds (`pushed === true`) |
| `openPullRequest` | after success **if** a push ran in that mutation **or** always after success (simpler; OK) |

**Failure policy:** If git op succeeds but backup fails:

- Prefer **still return git success** to the client (export already happened) and
  log/surface a non-fatal path — **OR** fail the mutation so the client retries.
- **Choose:** fail closed on backup failure for commit/push (throw
  `TRPCError` `INTERNAL_SERVER_ERROR` with a clear message like
  `"Changes were saved in the sandbox but durability backup failed. Retry Commit/Push."`)
  **only if** that matches existing agent-run severity. Agent run currently
  **continues** with `backupStored: false` on backup failure.
- **Match agent-run softness:** do **not** fail the git mutation if backup
  fails; best-effort `try/catch`, leave previous backup handle. Document that
  durability may lag one cycle. Add a `console.error` or existing log pattern
  if any.

**Decision (locked):** best-effort backup after successful git ops — never roll
back a successful commit/push because R2 backup failed. Same spirit as
`runAgentInSandbox` (`backupStored: false`).

### Loading project row for backup

`resolveSessionGitContext` today returns sandbox/session/github fields but not
full project / userId. Extend it to return enough for
`persistProjectSandboxBackup`:

```ts
return {
  projectId: project.id,
  userId: project.userId, // or options.ctx.user.id
  project, // strip secrets if you must; backup helper only needs id/userId/sandboxId/status
  githubRepo: project.githubRepo,
  installationId: project.githubInstallationId,
  sandboxId: project.sandboxId,
  session: gitSession,
};
```

Do **not** return `envVars` or raw secrets.

### Agent path

- `finalizeAgentRun` already writes backup — optionally refactor to
  `persistProjectSandboxBackup` for DRY (behavior unchanged).
- `agent-git-handler` mid-run push: end-of-run backup remains source of truth.
  No required change.

## Tasks

### Task 1: Persist helper + unit tests

**Files:**

- Modify: `src/lib/project-sandbox.ts`
- Create or modify: `src/lib/project-sandbox.test.ts` (create if missing; else
  extend)

- [ ] **Step 1: Write failing tests for `persistProjectSandboxBackup`**

```ts
// sketch — match repo vitest + vi.mock style from session-worktree.test.ts
it("creates a backup and stores the handle on the project", async () => {
  // mock backupSandboxWorkspace → { id: "bak-1", dir: "/workspace" }
  // mock db.update(...).set(...).where(...).returning() → updated project
  const result = await persistProjectSandboxBackup({
    db: dbMock,
    env: {} as Env,
    project: {
      id: "p1",
      userId: "u1",
      sandboxId: "s1",
      status: "ready",
    },
  });
  expect(backupSandboxWorkspace).toHaveBeenCalledWith({
    env: expect.anything(),
    sandboxId: "s1",
    projectId: "p1",
  });
  expect(result.sandboxBackup).toContain("bak-1");
});

it("throws when sandbox is not ready", async () => {
  await expect(
    persistProjectSandboxBackup({
      db: dbMock,
      env: {} as Env,
      project: { id: "p1", userId: "u1", sandboxId: null, status: "ready" },
    }),
  ).rejects.toThrow(/not ready/i);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm test -- src/lib/project-sandbox.test.ts
```

- [ ] **Step 3: Implement `persistProjectSandboxBackup` by lifting D1 write from
  private `storeReadyProjectBackup`**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-sandbox.ts src/lib/project-sandbox.test.ts
git commit -m "feat(sandbox): persist backup helper for git export durability"
```

### Task 2: Wire session-git router

**Files:**

- Modify: `src/integrations/trpc/routers/session-git.ts`
- Prefer extracting a small pure/async helper for “after git op, best-effort
  backup” so it is unit-testable without full tRPC — e.g. in
  `src/lib/session-git-backup.ts` or next to session-git.

- [ ] **Step 1: Extend `resolveSessionGitContext` return value** with
  `project: { id, userId, sandboxId, status }` (or full project row without
  secrets).

- [ ] **Step 2: After successful commit when `committed`**

```ts
const result = await commitSessionChanges({...});
if (result.committed) {
  try {
    await persistProjectSandboxBackup({
      db,
      env: ctx.env,
      project: resolved.project,
    });
  } catch {
    // best-effort; git commit already landed
  }
}
return result;
```

Note: `createDb(ctx.env)` may already exist inside `resolveSessionGitContext` —
either return `db` from resolve (avoid double create) or create again. Prefer
**one** `createDb` per request: refactor resolve to accept `db` or return it.

- [ ] **Step 3: After successful push**

Same best-effort `persistProjectSandboxBackup`.

- [ ] **Step 4: After successful openPullRequest**

If the mutation called `pushSessionBranch`, backup is required for tracking.
Simplest rule: **always** best-effort backup after openPR success.

- [ ] **Step 5: Unit-test the orchestration helper** (mock
  `commitSessionChanges` + `persistProjectSandboxBackup`) proving:

  1. `committed: true` → persist called
  2. `committed: false` → persist **not** called
  3. push success → persist called
  4. persist throw does not fail the returned git result

- [ ] **Step 6: Run**

```bash
pnpm test -- src/lib/session-git.test.ts src/lib/project-sandbox.test.ts
# plus any new test file
pnpm check
```

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(git): refresh sandbox backup after session commit/push/PR"
```

### Task 3: Optional DRY for agent-run finalize

**Files:**

- Modify: `src/lib/agent-run.ts` (only if low risk)

- [ ] If `finalizeAgentRun` duplicates D1 write, switch it to
  `persistProjectSandboxBackup` **or** keep as-is if types/DB flow differ.
- [ ] Ensure `agent-run.test.ts` still passes.

Skip this task if it expands scope without reducing bugs.

### Task 4: Docs

**Files:**

- Modify: `docs/architecture/agent-harness.md` (Git export section)

- [ ] Add one short bullet:

  > UI and Worker session git mutations (commit / push / open PR) refresh the
  > project sandbox backup after success so cold restore does not resurrect
  > pre-export dirty worktrees.

- [ ] Commit: `docs(agent): note backup refresh after git export`

### Task 5: Verification checklist (executor)

- [ ] `pnpm test` — all green
- [ ] `pnpm check` — all green
- [ ] Manual (if sandbox/dev available): on a dirty session, Commit → Push →
  confirm capsule clears; force cold restore (or restart sandbox) → reload
  route → still clean + PR visible. If full manual is hard, unit tests for
  persist wiring are mandatory and sufficient for merge readiness.
- [ ] Grep: no leftover `DEBUG-` logs
- [ ] Do not force-push; do not open PR unless asked

## STOP conditions

- If `backupSandboxWorkspace` cannot run without project `githubRepo` or R2
  config in a way that breaks local `USE_LOCAL_BUCKET_BACKUPS=true` — stop and
  report; do not invent a second backup mechanism.
- If D1 update races with concurrent agent-run finalize (both writing
  `sandboxBackup`) — last-write-wins is acceptable; do not add locking in this
  plan.
- If you discover dirty status **without** restore (hydrated sandbox, clean
  HEAD, still porcelain) — that is a **different** bug; file it separately and
  still ship this fix for the confirmed restore path.

## Acceptance criteria

1. After UI commit of real changes, a subsequent sandbox restore uses a backup
   taken **at or after** that commit (persist called).
2. After UI push, restore does not revive “N commits ahead” solely due to missing
   remote-tracking refs in an old backup (persist called on push).
3. Open PR metadata continues to come from GitHub (unchanged).
4. Backup failure does not undo a successful commit/push.
5. Tests cover persist helper + “commit true/false → persist yes/no”.
6. `pnpm test` and `pnpm check` pass.

## Verdict template (composer must end with this)

```markdown
## Composer verdict
- Status: DONE | BLOCKED
- Root cause addressed: yes/no
- Files changed: …
- Tests: …
- Residual risks: …
- Manual repro: attempted/not attempted — result
```
