# Plan 028: Preserve baseCommitSha and centralize session workspace readiness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat b52f806..HEAD -- \
>   apps/web/src/lib/session-worktree.ts \
>   apps/web/src/lib/session-worktree.test.ts \
>   apps/web/src/lib/session-workspace-lock.ts \
>   apps/web/src/lib/session-workspace-lock-error.ts \
>   apps/web/src/lib/workspace-policy.ts \
>   apps/web/src/lib/agent-run-service.ts \
>   apps/web/src/lib/agent-run-service.test.ts \
>   apps/web/src/lib/agent-run.ts \
>   apps/web/src/lib/agent-git-handler.ts \
>   apps/web/src/lib/agent-git-handler.test.ts \
>   apps/web/src/lib/session-git.ts \
>   apps/web/src/lib/session-git.test.ts \
>   apps/web/src/lib/session-git-ui-actions.ts \
>   apps/web/src/lib/session-preview.ts \
>   apps/web/src/lib/session-preview.test.ts \
>   apps/web/src/integrations/trpc/routers/session-git.ts \
>   apps/web/src/integrations/trpc/routers/session-git.test.ts \
>   apps/web/src/components/session-git-actions.tsx \
>   apps/web/src/components/session-git-actions.test.tsx \
>   apps/web/src/db/schema.ts \
>   docs/architecture/agent-harness.md \
>   plans/README.md
> ```
>
> Then run `git status --short` and `git diff --stat` so uncommitted drift is
> not hidden by `b52f806..HEAD`. Ignore only this plan/index change when it is
> the dispatch input. If any implementation path changed, compare the "Current
> state" excerpts with live code before proceeding. A behavioral mismatch is a
> STOP condition.

## Status

- **Priority**: P0
- **Effort**: M (two phased commits; Phase 1 is S, Phase 2 is M)
- **Risk**: MED — touches agent run, agent git, UI git, and preview worktree paths
- **Depends on**: Plans 005, 010, 017, 026, 027 (all DONE)
- **Category**: bug / tech-debt
- **Planned at**: commit `b52f806`, 2026-07-23
- **Execution status**: DONE (worktree `/home/ayan/ditto-worktrees/028-session-workspace-readiness` @ `84df23b`; advisor APPROVE + ponytail cleanup APPROVE)
- **Landing shape**: TWO logical PR units in ONE plan (Phase 1 then Phase 2). Prefer two commits on one branch; do not mix Phase 2 API work into the Phase 1 commit.

## Why this matters

`baseCommitSha` is the frozen fork point used for PR diffs and "what changed in
this session." Today, when a stored worktree path is missing and the branch is
already known, `ensureSessionWorktree` re-reads primary `HEAD` and returns that
as `baseCommitSha`. Callers then write the new SHA into D1, silently rewriting
history for the session. PR snapshots and "changes since base" become wrong.

Separately, four call sites each reimplement "ensure FS + bind D1" with
inconsistent lock and ownership rules. Agent prepare has no lock around create/
repair; preview locks only repair; UI git status forces full create/repair on a
poll path. This plan freezes base semantics and replaces the four copies with
one readiness API that owns modes, lock policy hooks, and ownership-scoped D1
bind.

## Locked design decisions

Do **not** invent alternatives. These are product-locked.

### baseCommitSha

- **Frozen fork point after first set.** Never rewrite on repair or reuse.
- **Empty base + existing branch** → one-time backfill from primary `HEAD` only
  (when branch already known and stored base is null/empty).
- **Create** (no branch yet) → set base from primary HEAD after existing
  primary-sync rules (unchanged from today).
- **Do NOT change** `syncSessionBranch`'s intentional `baseCommitSha` update
  after merge/sync — that path is out of scope and remains correct.

### Module boundary

Grow `apps/web/src/lib/session-worktree.ts` with `ensureSessionWorkspaceReady`.

| IN | OUT |
|----|-----|
| FS ensure/prepare | auth |
| create / reuse / repair modes | sandbox wake (`ensureProjectSandbox`) |
| lock mode hook | secrets / decrypt |
| D1 bind when values changed | message insert |
| | git mutate (commit/push/PR/sync) |
| | preview process / ports |
| | C1 export orchestration |
| | mega context loader collapsing agent+session git resolve |
| | holding agent lock across messages + run |

### Modes

| Mode | When | Behavior |
|------|------|----------|
| **reuse** | Canonical path exists on FS | `prepareSessionWorktree` only; base/branch/path unchanged |
| **create** | No branch yet (`branchName` null/empty; typically `workspacePath` default `/workspace`) | Sync primary (existing rules), create branch + worktree at canonical path, set base from primary HEAD |
| **repair** | Branch known AND (path missing OR path ≠ canonical) | Re-add worktree at **canonical** path; **KEEP** stored non-empty base; bind canonical path. Orphan non-canonical old path on FS is OK |

Auto-detect mode from `existing` + FS is fine if documented in code/docs.

**Phase 1 vs Phase 2 on non-canonical paths:**
- Phase 1 may only fix base preserve/backfill inside current `ensureSessionWorktree` control flow (missing path → recreate; if non-canonical path **exists**, current code still "reuses" that path — leave that until Phase 2).
- Phase 2 readiness **must** treat `existing.workspacePath !== canonical` as **repair** to canonical even if the old path still exists on FS. Prefer bind canonical; leaving the old path as an orphan is OK.

### Lock modes (caller chooses)

`lock: "acquire" | "assumeHeld" | "none"`

| Caller | Policy |
|--------|--------|
| `prepareAgentRun` | `acquire` **ONLY** for create/repair; **reuse unlocked** (`none`) |
| agent-git all actions | `assumeHeld` + full readiness (repair OK) — agent already holds outer lock via `runAgentInSandbox` |
| UI mutations (commit/sync/push/PR) | full readiness; `acquire` on create/repair; reuse unlocked |
| UI `gitStatus` | **prepare-only**; never create; missing/non-ready tree → soft workflow unavailable `reason: "worktree"` |
| preview | **Readiness owns acquire.** Call `ensureSessionWorkspaceReady({ lock: "acquire" })`. Remove the outer `withSessionWorkspaceLock` around ensure in `resolveSessionWorktree`. Project-level preview **lease** is unrelated and stays. |

**Busy on prepare acquire**: throw/propagate `SessionWorkspaceBusyError` with message
`"This session is busy. Wait for the active agent or Git operation to finish."`
Map to **HTTP 409** on agent prepare (same status family as other prepare failures today).

### D1 bind

Write only if any of `branchName` / `baseCommitSha` / `workspacePath` changed.

```ts
.where(
  and(
    eq(workspaceSessions.id, sessionId),
    eq(workspaceSessions.projectId, projectId),
    eq(workspaceSessions.userId, userId),
    eq(workspaceSessions.status, "active"),
  ),
)
```

If the update affects **zero rows** → **fail the operation** (do not treat as success). Leaving an FS orphan worktree is OK.

### Soft gitStatus unavailable

Extend:

```ts
| { kind: "unavailable"; reason: "github" | "worktree" }
```

UI (`session-git-actions.tsx`) must show a distinct message for `worktree`
(e.g. "Session worktree is not ready") vs github.

### Out of scope (hard)

- C1 git export orchestration changes beyond wiring readiness
- project-sandbox restore
- preview ports / process lifecycle
- message insert under lock
- collapsing `resolveSessionGitContext` + agent git resolve into one mega-loader
- holding agent lock across messages + run (`runAgentInSandbox` keeps its outer lock as today; prepare readiness lock is short and separate, released before message insert)

---

## Current state

All excerpts verified at `b52f806`.

### Bug — repair overwrites base

`apps/web/src/lib/session-worktree.ts` — when `existing.branchName` is set but
path is missing, falls through and always reads primary HEAD as base:

```ts
// session-worktree.ts:91-154 (structure)
if (existing?.branchName && existing.workspacePath) {
  const pathCheck = await sandbox.exists(existing.workspacePath);
  if (pathCheck.exists) {
    await prepareSessionWorktreeFs(sandbox, existing.workspacePath);
    return {
      branchName: existing.branchName,
      baseCommitSha: existing.baseCommitSha ?? "",
      workspacePath: existing.workspacePath,
    };
  }
}
// ...
if (!existing?.branchName) {
  await syncPrimaryWorkspaceFromGitHub({ ... });
}
const headResult = await execOrThrow(sandbox, "git rev-parse HEAD", { cwd: WORKSPACE_PATH, ... });
const baseCommitSha = headResult.stdout.trim(); // BUG for repair: overwrites oldsha
// ... branch ensure + worktree add + prepare ...
return { branchName, baseCommitSha, workspacePath: worktreePath };
```

Test currently **encodes the bug**:

```ts
// session-worktree.test.ts:140-166
it("recreates worktree when stored path is missing", async () => {
  // existing.baseCommitSha: "oldsha"
  execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });
  // ...
  expect(result.baseCommitSha).toBe("newsha"); // MUST become "oldsha"
});
```

### Canonical paths

`apps/web/src/lib/workspace-policy.ts`:

```ts
export const WORKSPACE_PATH = "/workspace";
export const SESSION_WORKTREE_ROOT = `${WORKSPACE_PATH}/.ditto/worktrees`;
export function sessionWorktreePath(sessionId: string): string {
  const segment = sanitizeSessionSegment(sessionId) || "session";
  return `${SESSION_WORKTREE_ROOT}/${segment}`;
}
export function sessionBranchName(sessionId: string): string {
  const segment = sanitizeSessionSegment(sessionId).slice(0, 12) || "unknown";
  return `ditto/session-${segment}`;
}
```

Schema default (`apps/web/src/db/schema.ts`):  
`workspacePath` NOT NULL DEFAULT `'/workspace'`; `branchName` and `baseCommitSha` nullable.  
**Create path** = null/empty `branchName` (often with default `/workspace` path).

### Four D1 bind copies (inconsistent)

1. **`agent-run-service.ts:498-531`** — `deps.ensureSessionWorktree` then update WHERE `id` only; **no lock**; messages inserted **after** (keep that order).
2. **`agent-git-handler.ts:107-134`** — same ensure + bind WHERE `id` only; agent holds lock outer via `runAgentInSandbox` + `bypassWorkspaceLock: true` on mutations.
3. **`session-git` router `resolveSessionGitContext` (`session-git.ts` router :113-140)** — same ensure + bind WHERE `id` only; used by **both** `gitStatus` and mutations.
4. **`session-preview.ts` `resolveSessionWorktree` (:801-873)** — prepare if canonical exists; else lock + ensure; bind with ownership WHERE (`id+projectId+userId+status=active`); **always writes** even if unchanged.

### Lock primitives

```ts
// session-workspace-lock.ts
export async function withSessionWorkspaceLock<T>(options: {
  env: Env; sandboxId: string; sessionId: string; run: () => Promise<T>;
}): Promise<T>
// throws SessionWorkspaceBusyError on acquire failure

// session-workspace-lock-error.ts
// message: "This session is busy. Wait for the active agent or Git operation to finish."
```

```ts
// agent-run.ts:349-357
export async function runAgentInSandbox(...) {
  return await withSessionWorkspaceLock({
    env: options.env,
    sandboxId: options.sandboxId,
    sessionId: options.conversationId,
    run: () => runAgentInSandboxLocked(options),
  });
}
```

Note: agent prepare (`prepareAgentRun`) runs **before** `runAgentInSandbox`, so
create/repair during prepare is **not** covered by the run lock today.

UI git mutations acquire lock inside `session-git` / `session-git-ui-actions`
(and nested helpers use `bypassWorkspaceLock: true`). Agent git mutations pass
`bypassWorkspaceLock: true` because the agent run holds the lock.

### Workflow type today

```ts
// session-git.ts:311-323
export type SessionGitWorkflow =
  | { kind: "commit" }
  | { kind: "push"; reason: "unpushed-commits" | "remote-branch-missing" }
  | { kind: "sync"; baseBranch: string }
  | { kind: "open-pr" }
  | { kind: "open-pr-existing"; pullRequest: SessionGitPullRequestRef }
  | { kind: "closed-pr"; pullRequest: SessionGitPullRequestRef }
  | { kind: "merged-pr"; pullRequest: SessionGitPullRequestRef }
  | { kind: "idle"; reason: "no-changes" }
  | { kind: "unavailable"; reason: "github" }; // extend with "worktree"
```

UI (`session-git-actions.tsx:221-222`): unavailable tooltip is only  
`"GitHub status is currently unavailable"`.  
`session-git-ui-actions.ts:75-76` same for PR precondition.

### Docs today

`docs/architecture/agent-harness.md:51-67` — worktree before messages; existing
sessions keep branch/worktree; `baseCommitSha` set at create.  
`:158-182` — concurrency / lock residual limits. Neither states "base is frozen
on repair."

### Exemplars for DI bags

- `session-preview.ts` `SessionPreviewDeps` + `defaultDeps` pattern
- `agent-run-service.ts` `AgentRunDeps` — currently has `ensureSessionWorktree`;
  switch to `ensureSessionWorkspaceReady` (or add alongside and migrate callers)

### Conventions

- Imports via `#/lib/...`
- Vitest + `vi.hoisted` / `vi.mock` as in `session-worktree.test.ts`
- No comments unless essential
- Biome format (`pnpm check`)
- Commit style: `fix(session): ...` / `feat(session): ...`

---

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift | see executor block above | understand delta; STOP on behavioral mismatch |
| Typecheck | `pnpm typecheck` | exit 0 |
| Focused worktree tests | `pnpm --filter @ditto/web exec vitest run src/lib/session-worktree.test.ts` | all pass |
| Focused agent-run | `pnpm --filter @ditto/web exec vitest run src/lib/agent-run-service.test.ts` | all pass |
| Focused agent-git | `pnpm --filter @ditto/web exec vitest run src/lib/agent-git-handler.test.ts` | all pass |
| Focused session-git | `pnpm --filter @ditto/web exec vitest run src/lib/session-git.test.ts src/integrations/trpc/routers/session-git.test.ts src/components/session-git-actions.test.tsx` | all pass |
| Focused preview | `pnpm --filter @ditto/web exec vitest run src/lib/session-preview.test.ts` | all pass |
| Broader web tests | `pnpm test` (root) or `pnpm --filter @ditto/web test` | all pass |
| Lint/format | `pnpm check` | exit 0 |
| Full (heavy) | `pnpm verify` | exit 0 — use at end of each phase, not every step |

`apps/web` script is `vitest run`; pass file filters after `vitest run`. From repo root, `pnpm --filter @ditto/web exec vitest run <files>` is the reliable form.

---

## Scope

**In scope** (only these may be modified, plus their tests):

- `apps/web/src/lib/session-worktree.ts`
- `apps/web/src/lib/session-worktree.test.ts`
- `apps/web/src/lib/agent-run-service.ts`
- `apps/web/src/lib/agent-run-service.test.ts`
- `apps/web/src/lib/agent-git-handler.ts`
- `apps/web/src/lib/agent-git-handler.test.ts`
- `apps/web/src/integrations/trpc/routers/session-git.ts`
- `apps/web/src/integrations/trpc/routers/session-git.test.ts`
- `apps/web/src/lib/session-git.ts` (workflow union + any pure helper needed for worktree unavailable)
- `apps/web/src/lib/session-git.test.ts`
- `apps/web/src/lib/session-git-ui-actions.ts` (unavailable message for `worktree` if touched by union)
- `apps/web/src/components/session-git-actions.tsx`
- `apps/web/src/components/session-git-actions.test.tsx`
- `apps/web/src/lib/session-preview.ts`
- `apps/web/src/lib/session-preview.test.ts`
- `docs/architecture/agent-harness.md` (base freeze note + concurrency section)
- `plans/README.md` (status only, when done)

**Out of scope** (do NOT touch):

- `apps/web/src/lib/session-git.ts` mutation bodies beyond workflow type / status soft-path helpers
- `syncSessionBranch` baseCommitSha update behavior
- `apps/web/src/lib/agent-run.ts` lock-around-entire-run (keep as-is)
- `apps/web/src/lib/project-sandbox.ts`, backup, secrets, JWT, C1 export
- Preview port/process code beyond worktree resolve wiring
- Collapsing context loaders; moving message insert under lock
- Schema/migrations (no new columns)
- `packages/sandbox-runner/**`

---

## Git workflow

- Branch: `advisor/028-session-workspace-readiness`
- Prefer isolated worktree from `b52f806` or current master if still at/after that SHA
- Commits (recommended):
  1. `fix(session): preserve baseCommitSha on worktree repair`
  2. `feat(session): centralize session workspace readiness`
- Optional docs-only slice may fold into each phase commit
- Do NOT push, open PR, merge, or deploy unless the operator asks

---

## Phase 1 — base preserve + empty backfill + invert test + short harness note

Goal: fix the data bug with minimal surface area. Callers still use
`ensureSessionWorktree`. No readiness API yet.

### Step 1.1: Drift check

Run the drift commands in the executor block. Confirm
`ensureSessionWorktree` still matches Current state (repair overwrites base;
test expects `newsha`).

**Verify**: drift understood; no STOP mismatch → proceed.

### Step 1.2: Fix `ensureSessionWorktree` base semantics

In `apps/web/src/lib/session-worktree.ts`, change the post-reuse path so:

1. **Reuse** (unchanged intent): existing branch + path exists → prepare that
   path; return stored branch/base/path (`baseCommitSha: existing.baseCommitSha ?? ""` OK for return shape).
2. **Repair** (branch known, path missing):  
   - Do **not** call `syncPrimaryWorkspaceFromGitHub`.  
   - Ensure branch ref exists / `git worktree add` canonical path as today.  
   - **baseCommitSha** =
     - if `existing.baseCommitSha` is non-null and non-empty → **keep it**
     - else → one-time backfill: `git rev-parse HEAD` on primary → that SHA  
   - Return `workspacePath: sessionWorktreePath(sessionId)` (canonical).
3. **Create** (`!existing?.branchName`): keep current sync-primary + HEAD base +
   branch + worktree behavior.

Suggested structure (illustrative — match repo style, no drive-by refactors):

```ts
const canonicalPath = sessionWorktreePath(options.sessionId);
const branchName = existing?.branchName ?? sessionBranchName(options.sessionId);

// reuse when path exists (Phase 1: still reuse whatever path is stored)
if (existing?.branchName && existing.workspacePath) {
  const pathCheck = await sandbox.exists(existing.workspacePath);
  if (pathCheck.exists) {
    await prepareSessionWorktreeFs(sandbox, existing.workspacePath);
    return {
      branchName: existing.branchName,
      baseCommitSha: existing.baseCommitSha ?? "",
      workspacePath: existing.workspacePath,
    };
  }
}

// create vs repair split:
const isCreate = !existing?.branchName;
if (isCreate) {
  await syncPrimaryWorkspaceFromGitHub({ ... });
}
// ensure .git, branch, worktree add at canonicalPath, prepare...

// Non-empty stored base is frozen. null/""/whitespace → one-time HEAD backfill
// (create always uses HEAD; repair with empty base also backfills).
const storedBase = existing?.baseCommitSha?.trim() ?? "";
let baseCommitSha: string;
if (!isCreate && storedBase.length > 0) {
  baseCommitSha = storedBase;
} else {
  const headResult = await execOrThrow(sandbox, "git rev-parse HEAD", { cwd: WORKSPACE_PATH, ... });
  baseCommitSha = headResult.stdout.trim();
}

return { branchName, baseCommitSha, workspacePath: canonicalPath /* or existing branch name on repair */ };
```

On repair, prefer returning **stored** `existing.branchName` (not recomputed)
if present so rename drift is not introduced.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/session-worktree.test.ts
```

Will fail until Step 1.3 inverts the test — that is expected if you run tests
mid-edit; finish 1.3 before declaring step done.

### Step 1.3: Invert / extend tests

In `apps/web/src/lib/session-worktree.test.ts`:

1. Change `"recreates worktree when stored path is missing"`:
   - `expect(result.baseCommitSha).toBe("oldsha")`
   - Still assert no `syncPrimaryWorkspaceFromGitHub`
   - Still assert `git worktree add` was invoked
   - Assert `workspacePath` is canonical
2. Add `"backfills empty baseCommitSha from primary HEAD on repair"`:
   - existing branch set, base `null` or `""`, path missing
   - HEAD mock → `"backfillsha"`
   - expect `baseCommitSha === "backfillsha"`
   - no sync primary
3. Keep create + reuse tests green (create still gets HEAD/synced sha).

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/session-worktree.test.ts
```

→ all pass, including inverted + new backfill test.

### Step 1.4: Brief docs note (base freeze)

In `docs/architecture/agent-harness.md` Runtime path section (~lines 51-67),
add one or two sentences:

- `baseCommitSha` is set when the session branch/worktree is first created (or
  one-time backfilled if empty).
- Repairing a missing worktree **must not** overwrite a non-empty
  `baseCommitSha`.

Do not rewrite the whole section.

**Verify**: read the paragraph; `pnpm check` still OK on docs (or skip if check
ignores md). Prefer:

```bash
pnpm check
pnpm typecheck
```

### Step 1.5: Phase 1 commit

```text
fix(session): preserve baseCommitSha on worktree repair
```

**Verify**: `git log -1 --oneline` shows the commit; working tree clean for
Phase 1 files; Phase 2 not started in that commit.

---

## Phase 2 — readiness API + four callers + tests + harness concurrency

Goal: one API owns mode detection, lock hook, FS, and ownership D1 bind.
Callers delete local bind copies.

### Step 2.1: Types + readiness API (locked shapes — do not invent alternatives)

In `apps/web/src/lib/session-worktree.ts` add **exactly these** public exports
(names may vary only if Biome/import conflicts force it — prefer these names):

```ts
import type { createDb } from "#/db";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";

export type SessionWorkspaceDb = ReturnType<typeof createDb>;

export type SessionWorkspaceLockMode = "acquire" | "assumeHeld" | "none";

export type SessionWorkspaceReadyMode = "create" | "reuse" | "repair";

export type SessionWorkspaceExisting = {
  branchName: string | null;
  baseCommitSha: string | null;
  workspacePath: string;
};

export type EnsureSessionWorkspaceReadyOptions = {
  env: Env;
  sandboxId: string;
  sessionId: string;
  githubRepo: string;
  installationId: number;
  projectId: string;
  userId: string;
  db: SessionWorkspaceDb;
  existing: SessionWorkspaceExisting;
  lock: SessionWorkspaceLockMode;
};

export type EnsureSessionWorkspaceReadyResult = {
  mode: SessionWorkspaceReadyMode;
  branchName: string;
  baseCommitSha: string;
  workspacePath: string;
  bound: boolean;
};

export type PrepareSessionWorkspaceIfPresentOptions = {
  env: Env;
  sandboxId: string;
  sessionId: string;
  existing: SessionWorkspaceExisting;
};

export type PrepareSessionWorkspaceIfPresentResult =
  | {
      ok: true;
      branchName: string;
      baseCommitSha: string;
      workspacePath: string;
    }
  | { ok: false; reason: "worktree" };
```

#### Call graph (mandatory)

```
prepareSessionWorkspaceIfPresent  →  prepare FS only if reuse-eligible; never lock; never D1 bind
ensureSessionWorkspaceReady
  → detectMode(existing, FS)
  → maybe withSessionWorkspaceLock (create/repair + lock===acquire only)
  → runFs(mode) using PRIVATE helpers (do NOT call public ensureSessionWorktree for mode detect)
  → bindSessionWorkspaceFields (ownership WHERE + returning)
```

**Refactor rule for Phase 2:**
1. Keep `prepareSessionWorktree` public (preview/tests may still use it).
2. Split today's `ensureSessionWorktree` body into **private** helpers, e.g.
   `runCreateWorktreeFs`, `runRepairWorktreeFs`, used by readiness.
3. **Either** delete the public `ensureSessionWorktree` export **or** leave it as a
   thin deprecated wrapper that only supports create/repair-at-canonical with
   Phase 1 base rules — **callers in the four sites must not use it**.
4. Readiness **must not** call a helper that still "reuses any existing.workspacePath
   even when non-canonical." Reuse path in readiness is **only**:
   `existing.branchName && existing.workspacePath === canonical && exists(canonical)`.

#### `detectMode` (readiness)

```ts
function detectMode(existing, canonical, pathExistsCanonical, pathExistsExisting): SessionWorkspaceReadyMode {
  if (!existing.branchName) return "create";
  if (existing.workspacePath === canonical && pathExistsCanonical) return "reuse";
  return "repair"; // missing OR non-canonical (even if old path exists)
}
```

#### Lock policy inside `ensureSessionWorkspaceReady`

```ts
async function withOptionalLock(lock, env, sandboxId, sessionId, run) {
  if (/* mode is reuse */) return await run(); // never acquire on reuse
  if (lock === "acquire") {
    return await withSessionWorkspaceLock({ env, sandboxId, sessionId, run });
  }
  // assumeHeld | none
  return await run();
}
```

FS+bind both run **inside** `run` so bind is covered by the short lock on create/repair.

#### Bind helper (copy pattern from `session-preview.ts:856-871`)

```ts
async function bindSessionWorkspaceFields(options: {
  db: SessionWorkspaceDb;
  sessionId: string;
  projectId: string;
  userId: string;
  previous: SessionWorkspaceExisting;
  next: { branchName: string; baseCommitSha: string; workspacePath: string };
}): Promise<boolean> {
  const prevBase = options.previous.baseCommitSha ?? "";
  const unchanged =
    options.previous.branchName === options.next.branchName &&
    prevBase === options.next.baseCommitSha &&
    options.previous.workspacePath === options.next.workspacePath;
  if (unchanged) return false;

  const [row] = await options.db
    .update(workspaceSessions)
    .set({
      branchName: options.next.branchName,
      baseCommitSha: options.next.baseCommitSha,
      workspacePath: options.next.workspacePath,
      updatedAt: sql`(unixepoch())`,
    })
    .where(
      and(
        eq(workspaceSessions.id, options.sessionId),
        eq(workspaceSessions.projectId, options.projectId),
        eq(workspaceSessions.userId, options.userId),
        eq(workspaceSessions.status, "active"),
      ),
    )
    .returning({ id: workspaceSessions.id });

  if (!row) {
    throw new Error(
      "Failed to bind session workspace: session not active or not found.",
    );
  }
  return true;
}
```

Need imports: `and`, `eq`, `sql` from `drizzle-orm`; `workspaceSessions` from `#/db/schema`.

#### `prepareSessionWorkspaceIfPresent` (gitStatus only — this is the ONLY prepare-only API)

```ts
export async function prepareSessionWorkspaceIfPresent(
  options: PrepareSessionWorkspaceIfPresentOptions,
): Promise<PrepareSessionWorkspaceIfPresentResult> {
  const canonical = sessionWorktreePath(options.sessionId);
  const branch = options.existing.branchName;
  if (!branch) return { ok: false, reason: "worktree" };
  if (options.existing.workspacePath !== canonical) {
    return { ok: false, reason: "worktree" };
  }
  const sandbox = getProjectSandbox(options.env, options.sandboxId);
  const check = await sandbox.exists(canonical);
  if (!check.exists) return { ok: false, reason: "worktree" };
  await prepareSessionWorktree({
    env: options.env,
    sandboxId: options.sandboxId,
    worktreePath: canonical,
  });
  return {
    ok: true,
    branchName: branch,
    baseCommitSha: options.existing.baseCommitSha?.trim() || "",
    workspacePath: canonical,
  };
}
```

Do **not** add `create: false` on `ensureSessionWorkspaceReady`. Two APIs only:
full readiness vs prepare-if-present.

#### Minimum tests in this step (same file)

| Test | Expect |
|------|--------|
| readiness repair missing path | base stays `oldsha`; acquire called when `lock:"acquire"` |
| readiness reuse | acquire **not** called even if `lock:"acquire"` |
| readiness non-canonical path | mode repair; returns canonical path; keeps base |
| prepare-if-present missing | `{ ok:false, reason:"worktree" }`; no worktree add |
| prepare-if-present ok | prepare once; ok true |
| bind zero rows | throws bind error message |

Mock `withSessionWorkspaceLock` via `vi.mock("#/lib/session-workspace-lock")` that
runs `run()` immediately and records calls — same spirit as agent-run lock mocks.

**Verify**:

```bash
pnpm typecheck
pnpm --filter @ditto/web exec vitest run src/lib/session-worktree.test.ts
```

→ all Phase 1 + new readiness tests pass.

### Step 2.2: Wire `prepareAgentRun`

File: `apps/web/src/lib/agent-run-service.ts`

- Extend `AgentRunDeps`: replace or add  
  `ensureSessionWorkspaceReady?: typeof ensureSessionWorkspaceReady`  
  (remove direct `ensureSessionWorktree` from deps once unused).
- Replace block ~498-531 with readiness:

```ts
const ready = await deps.ensureSessionWorkspaceReady({
  env,
  sandboxId: ensuredProject.sandboxId as string,
  sessionId,
  githubRepo: linkedGithubRepo,
  installationId: linkedInstallationId,
  projectId: input.projectId,
  userId,
  db,
  existing: {
    branchName: workspaceSession.branchName,
    baseCommitSha: workspaceSession.baseCommitSha,
    workspacePath: workspaceSession.workspacePath,
  },
  // Always pass lock: "acquire". Readiness MUST no-op acquire on reuse
  // and only wrap create/repair. Do not pre-detect mode in prepareAgentRun.
  lock: "acquire",
});
// Bind is already done inside readiness when changed — do NOT duplicate D1 update.
workspaceSession = {
  ...workspaceSession,
  branchName: ready.branchName,
  baseCommitSha: ready.baseCommitSha,
  workspacePath: ready.workspacePath,
};
sessionWorkspacePath = ready.workspacePath;
```

Important:
- Message insert stays **AFTER** readiness returns (create/repair lock already released).
- On failure: if `createdSession`, `deleteEmptySession` as today.
- If error is `SessionWorkspaceBusyError` → status **409**, body.error =
  busy message (exact class message string).
- Other errors → 409 with message as today.

Update `agent-run-service.test.ts` mocks accordingly (`ensureSessionWorkspaceReady`
instead of `ensureSessionWorktree`). Add case: readiness throws busy → 409 +
busy text; create session deleted on failure still holds.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/agent-run-service.test.ts
```

### Step 2.3: Wire `agent-git-handler` (full patch shape)

File: `apps/web/src/lib/agent-git-handler.ts`

1. Change import from `ensureSessionWorktree` to `ensureSessionWorkspaceReady`.
2. Delete the D1 `update(workspaceSessions)` block entirely.
3. Replace ensure+bind (~107-134) with:

```ts
const ready = await ensureSessionWorkspaceReady({
  env: options.env,
  sandboxId: project.sandboxId,
  sessionId: session.id,
  githubRepo: project.githubRepo,
  installationId: project.githubInstallationId,
  projectId: options.claims.projectId,
  userId: options.claims.userId,
  db: options.db,
  existing: {
    branchName: session.branchName,
    baseCommitSha: session.baseCommitSha,
    workspacePath: session.workspacePath,
  },
  lock: "assumeHeld",
});
```

4. Build return `session` from `ready`:

```ts
session: {
  id: session.id,
  branchName: ready.branchName,
  baseCommitSha: ready.baseCommitSha,
  workspacePath: ready.workspacePath,
  title: session.title,
},
```

5. Remove unused imports (`sql`, `workspaceSessions`) if no longer referenced.
6. Update `agent-git-handler.test.ts` mocks from `ensureSessionWorktree` to
   `ensureSessionWorkspaceReady` with the same resolved fields.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/agent-git-handler.test.ts
```

### Step 2.4: Wire session-git router — split status vs mutations + busy order

File: `apps/web/src/integrations/trpc/routers/session-git.ts`

**Critical:** Today `resolveSessionGitContext` runs **outside** mutation `try/catch`.
After readiness can throw `SessionWorkspaceBusyError`, every procedure must catch
busy **around readiness**, not only around the inner git call.

#### 2.4.1 Split resolver

Replace `resolveSessionGitContext` with:

```ts
async function resolveSessionGitAuthContext(options: { ctx; input }) {
  // Body of today's resolveSessionGitContext through ensureProjectSandbox
  // (live ~54-111), THEN decrypt knownSecrets (live ~150-155).
  // STOP before ensureSessionWorktree / D1 bind.
  // return {
  //   db, project, session, githubRepo, installationId, sandboxId, knownSecrets
  // }
}
```

#### 2.4.2 Shared helpers in the router file

```ts
function worktreeUnavailableStatus(session: {
  branchName: string | null;
}): SessionGitStatus {
  return {
    branch: session.branchName ?? "",
    dirty: false,
    ahead: 0,
    hasBranchChanges: false,
    remoteBranchExists: null,
    changedFiles: [],
    summary: "Session worktree is not ready.",
    pullRequest: null,
    workflow: { kind: "unavailable", reason: "worktree" },
  };
}

function mapSessionWorkspaceBusy(error: unknown): never {
  if (error instanceof SessionWorkspaceBusyError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  throw error;
}

async function resolveSessionGitReadyForMutation(options: {
  ctx;
  input: { projectId: string; sessionId: string };
}) {
  const auth = await resolveSessionGitAuthContext(options);
  try {
    const ready = await ensureSessionWorkspaceReady({
      env: options.ctx.env,
      sandboxId: auth.sandboxId,
      sessionId: auth.session.id,
      githubRepo: auth.githubRepo,
      installationId: auth.installationId,
      projectId: options.input.projectId,
      userId: options.ctx.user.id,
      db: auth.db,
      existing: {
        branchName: auth.session.branchName,
        baseCommitSha: auth.session.baseCommitSha,
        workspacePath: auth.session.workspacePath,
      },
      lock: "acquire",
    });
    return {
      ...auth,
      session: {
        id: auth.session.id,
        branchName: ready.branchName,
        baseCommitSha: ready.baseCommitSha,
        workspacePath: ready.workspacePath,
        title: auth.session.title,
      },
      project: {
        id: auth.project.id,
        userId: auth.project.userId,
        sandboxId: auth.sandboxId,
        status: auth.project.status,
      },
    };
  } catch (error) {
    mapSessionWorkspaceBusy(error);
  }
}
```

Import `SessionWorkspaceBusyError`, `ensureSessionWorkspaceReady`,
`prepareSessionWorkspaceIfPresent`.

**UI mutation lock interaction (Plan 026):**  
`resolveSessionGitReadyForMutation` runs **before**
`commitSessionChangesWithGeneratedMessage` /
`openSessionPullRequestWithGeneratedMetadata` acquire their outer lock.
On the common path mode is **reuse** (no readiness acquire). Never call
readiness with `lock:"acquire"` **inside** an already-held
`withSessionWorkspaceLock` without `assumeHeld`.

#### 2.4.3 `gitStatus` procedure

```ts
gitStatus: protectedProcedure.input(sessionInputSchema).query(async ({ ctx, input }) => {
  const auth = await resolveSessionGitAuthContext({ ctx, input });
  const prepared = await prepareSessionWorkspaceIfPresent({
    env: ctx.env,
    sandboxId: auth.sandboxId,
    sessionId: auth.session.id,
    existing: {
      branchName: auth.session.branchName,
      baseCommitSha: auth.session.baseCommitSha,
      workspacePath: auth.session.workspacePath,
    },
  });
  if (!prepared.ok) {
    return worktreeUnavailableStatus(auth.session);
  }
  return await getSessionGitStatus({
    env: ctx.env,
    sandboxId: auth.sandboxId,
    installationId: auth.installationId,
    githubRepo: auth.githubRepo,
    session: {
      id: auth.session.id,
      branchName: prepared.branchName,
      baseCommitSha: prepared.baseCommitSha,
      workspacePath: prepared.workspacePath,
      title: auth.session.title,
    },
  });
}),
```

#### 2.4.4 Each mutation (commit / sync / push / openPullRequest)

Pattern (apply to all four):

```ts
.mutation(async ({ ctx, input }) => {
  let resolved;
  try {
    resolved = await resolveSessionGitReadyForMutation({ ctx, input });
  } catch (error) {
    // mapSessionWorkspaceBusy already threw TRPCError for busy;
    // rethrow other auth errors
    throw error;
  }
  try {
    // existing mutation body using resolved.*
  } catch (error) {
    // existing SessionWorkspaceBusyError / metadata / secret maps
  }
}),
```

Because readiness busy is already mapped inside
`resolveSessionGitReadyForMutation`, the outer catch can stay as today for
mutation-time busy (nested lock). Do **not** leave readiness **outside** all try
blocks.

#### 2.4.5 Workflow union + UI copy (exact string)

In `apps/web/src/lib/session-git.ts`:

```ts
| { kind: "unavailable"; reason: "github" | "worktree" }
```

`resolveSessionGitWorkflow` only emits `reason: "github"` today — no change
required there unless tests construct workflows manually.

Exact user-facing string (use everywhere — summary, tooltip, ui-actions):

```text
Session worktree is not ready.
```

(with the period)

| Location | Change |
|----------|--------|
| `session-git-actions.tsx` unavailable tooltip | branch on `workflow.reason` |
| `session-git-ui-actions.ts` `preconditionMessage` | if `unavailable` && reason worktree → same string |
| tests | github case unchanged; add worktree case |

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run \
  src/lib/session-git.test.ts \
  src/integrations/trpc/routers/session-git.test.ts \
  src/components/session-git-actions.test.tsx
```

### Step 2.5: Wire preview `resolveSessionWorktree`

File: `apps/web/src/lib/session-preview.ts`

Replace custom prepare/lock/ensure/bind with readiness.

**Recommended pattern (no double-lock)**: readiness owns acquire for repair/create.

```ts
async function resolveSessionWorktree(deps, options): Promise<string> {
  if (!options.project.githubRepo || !options.project.githubInstallationId) {
    throw sessionPreviewError("not_ready");
  }
  try {
    const ready = await deps.ensureSessionWorkspaceReady({
      env: deps.env,
      sandboxId: options.sandboxId,
      sessionId: options.session.id,
      githubRepo: options.project.githubRepo,
      installationId: options.project.githubInstallationId,
      projectId: options.project.id,
      userId: options.session.userId,
      db: deps.db,
      existing: {
        branchName: options.session.branchName,
        baseCommitSha: options.session.baseCommitSha,
        workspacePath: options.session.workspacePath,
      },
      lock: "acquire", // readiness no-ops lock on reuse
    });
    return ready.workspacePath;
  } catch (error) {
    if (error instanceof SessionWorkspaceBusyError) {
      throw sessionPreviewError("busy");
    }
    // map bind failure / ensure failure → start_failed or not_ready as today
    ...
  }
}
```

Update `SessionPreviewDeps`: swap `ensureSessionWorktree` (+ optional remove
direct `withSessionWorkspaceLock` if unused elsewhere in file — **grep first**;
preview lease code may still need the project-level lease, not session lock).
Only remove session lock from worktree resolve; do not touch project preview
lease logic.

Update `session-preview.test.ts` mocks.

**Verify**:

```bash
pnpm --filter @ditto/web exec vitest run src/lib/session-preview.test.ts
```

### Step 2.6: Docs — concurrency section

Update `docs/architecture/agent-harness.md` Concurrency section (~158-182):

Document:

- Session workspace **readiness** centralizes create/reuse/repair.
- **create/repair** take a short session workspace lock; **reuse** is unlocked.
- Agent prepare acquires only for create/repair; message rows still insert after
  readiness releases.
- Agent git tools use readiness with `assumeHeld` (run already holds lock).
- UI gitStatus is prepare-only; missing tree → workflow `unavailable/worktree`.
- UI mutations use full readiness with acquire on create/repair.
- Preview repair uses readiness-owned acquire (no double-lock).
- `baseCommitSha` frozen after first set; repair preserves it (cross-link Phase 1 note).

**Verify**: prose matches implementation; no contradictory "always lock" claims.

### Step 2.7: Full test pass for Phase 2

Add/adjust tests listed in Test plan below. Then:

```bash
pnpm check
pnpm typecheck
pnpm --filter @ditto/web exec vitest run \
  src/lib/session-worktree.test.ts \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-git-handler.test.ts \
  src/lib/session-git.test.ts \
  src/integrations/trpc/routers/session-git.test.ts \
  src/components/session-git-actions.test.tsx \
  src/lib/session-preview.test.ts
```

Optional end-of-phase: `pnpm verify` if environment supports full runner install.

### Step 2.8: Phase 2 commit + index

```text
feat(session): centralize session workspace readiness
```

Update `plans/README.md` plan 028 row to DONE with branch tip SHA when executor
finishes (unless reviewer owns the index).

**Verify**: `git status` clean for in-scope files; only two logical commits (plus
plan index if separate).

---

## Test plan

Model after `apps/web/src/lib/session-worktree.test.ts` (hoisted mocks) and
`session-preview.test.ts` (deps bag).

### Phase 1 (`session-worktree.test.ts`)

| Case | Expect |
|------|--------|
| recreate when path missing | `baseCommitSha === "oldsha"`; worktree add; no sync |
| empty base on repair | backfill from HEAD mock; no sync |
| reuse existing path | unchanged base; prepare only |
| create new | sync + HEAD base (existing test) |

### Phase 2 (`session-worktree.test.ts` readiness suite)

| Case | Expect |
|------|--------|
| mode reuse | prepare only; lock acquire **not** called when `lock: "acquire"` |
| mode create | sync + branch + worktree; acquire called if `lock: "acquire"` |
| mode repair missing path | keep oldsha; canonical path; acquire if acquire |
| mode repair non-canonical path | bind canonical; keep base; may orphan old path |
| `lock: "assumeHeld"` create/repair | FS runs; acquire **not** called |
| bind writes only when changed | second call no update |
| bind zero rows | throws; operation fails |
| prepare-only missing tree | `{ ok: false, reason: "worktree" }`; no worktree add |
| prepare-only present | prepare; ok true |

### Caller tests

| File | Case |
|------|------|
| `agent-run-service.test.ts` | uses readiness; busy → 409 + busy message; fail still deletes empty session; messages after readiness |
| `agent-git-handler.test.ts` | assumeHeld readiness; no local bind SQL with id-only where |
| `session-git` router tests | gitStatus soft worktree unavailable; mutations call full readiness |
| `session-git.test.ts` | workflow unavailable reason worktree union |
| `session-git-actions.test.tsx` | UI copy for worktree unavailable |
| `session-preview.test.ts` | resolve uses readiness; busy maps to preview busy; no double lock mock expectations |

**Verification command** (all of the above must pass): see Step 2.7.

---

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Phase 1 commit exists: repair preserves non-empty `baseCommitSha`; empty backfills once; inverted test expects `oldsha`
- [ ] Phase 2 commit exists: `ensureSessionWorkspaceReady` (and prepare-only helper) exported from `session-worktree.ts`
- [ ] No production call sites of `ensureSessionWorktree` in the four callers:

```bash
rg -n "ensureSessionWorktree" apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-git-handler.ts \
  apps/web/src/integrations/trpc/routers/session-git.ts \
  apps/web/src/lib/session-preview.ts
```

→ no matches (readiness / prepare-if-present only).

- [ ] No id-only workspace bind remains in those four files:

```bash
rg -n "workspacePath: ensured|workspacePath: ready|workspacePath: repaired" \
  apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-git-handler.ts \
  apps/web/src/integrations/trpc/routers/session-git.ts \
  apps/web/src/lib/session-preview.ts
```

→ local `db.update(workspaceSessions).set({ branchName...})` for bind should be gone from callers (only inside `session-worktree.ts`). Confirm:

```bash
rg -n "update\(workspaceSessions\)" apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-git-handler.ts \
  apps/web/src/integrations/trpc/routers/session-git.ts \
  apps/web/src/lib/session-preview.ts
```

→ zero matches for bind (preview may still update other session fields elsewhere — if a match is non-bind, justify in the report; bind-only copies must be gone).

- [ ] `SessionGitWorkflow` unavailable reason includes `"worktree"`
- [ ] UI shows distinct worktree unavailable copy
- [ ] `docs/architecture/agent-harness.md` documents frozen base + readiness lock policy
- [ ] `pnpm check` exit 0
- [ ] `pnpm typecheck` exit 0
- [ ] Focused tests in Step 2.7 all pass
- [ ] No files outside Scope modified (`git status`)
- [ ] `syncSessionBranch` base update behavior unchanged (spot-check diff)
- [ ] Message insert in `prepareAgentRun` still after readiness
- [ ] `plans/README.md` status updated when executor completes

---

## STOP conditions

Stop and report (do not improvise) if:

1. Drift check shows behavioral change in in-scope files vs Current state excerpts.
2. Fixing bind/zero-row detection requires a D1/drizzle API that is unclear after
   one local experiment — report the attempted pattern.
3. Any step seems to require holding the agent lock across message insert + run.
4. Preview still wraps readiness in an outer `withSessionWorkspaceLock` (double
   lock) or readiness acquires while already inside ui-action lock without
   `assumeHeld`.
5. `getSessionGitStatus` cannot return a soft unavailable without a real
   worktree and a clean short-circuit in the router is blocked by type shape —
   report rather than inventing fake git status fields.
6. Non-canonical path repair would delete user data in the old path — never
   `rm -rf` the old path; orphan is OK; if something forces destructive cleanup,
   STOP.
7. A verification command fails twice after a reasonable fix.
8. Out-of-scope files appear necessary (mega-loader, C1 export, sandbox restore).
9. HEAD is not `b52f806` or a descendant that still matches excerpts — re-read
   live code; if base overwrite bug is already fixed differently, STOP and
   reconcile rather than dual-fixing.

---

## Maintenance notes

- **Future callers** that need a session worktree must use
  `ensureSessionWorkspaceReady` / prepare-only — do not reintroduce ad-hoc ensure+bind.
- **Reviewers** should scrutinize:
  - baseCommitSha never changes on repair/reuse
  - lock acquire only on create/repair for prepare/UI/preview
  - agent-git `assumeHeld` only (no nested acquire under run lock)
  - gitStatus never creates worktrees
  - D1 bind ownership WHERE + zero-row fail
  - message insert still after readiness in agent prepare
- **Deferred**: collapsing session/agent git context loaders; lock spanning
  messages+run; automatic cleanup of orphan non-canonical worktree dirs.
- **Interaction**: Plan 026 UI commit/PR holds session lock for snapshot+mutate —
  readiness for those mutations should complete before or inside existing outer
  locks without double-acquire. Prefer: resolve readiness (acquire only if
  create/repair) **before** the long metadata lock, or use assumeHeld when the
  mutation path already acquired. If UI mutation paths always run after a
  session already has a worktree (normal case = reuse unlocked), readiness is
  prepare-only and the existing mutation lock is unchanged.
- **Interaction**: Plan 027 preview repair — readiness replaces the bespoke
  lock+ensure in `resolveSessionWorktree`; project-level preview lease stays.

---

## Executor checklist (quick)

1. Drift at `b52f806`
2. Phase 1: base preserve + tests + harness sentence + commit
3. Phase 2: readiness API + bind helper + prepare-only
4. Wire prepareAgentRun, agent-git, session-git status/mutations, preview
5. Workflow `worktree` + UI copy
6. Harness concurrency docs
7. Tests + `pnpm check` + `pnpm typecheck`
8. Phase 2 commit; mark plan DONE in `plans/README.md`
