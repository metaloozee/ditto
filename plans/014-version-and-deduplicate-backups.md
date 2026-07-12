# Plan 014: Version workspace backups and snapshot only after mutations

> **Executor instructions**: Preserve the existing best-effort durability
> policy for successful git operations, but never let an older snapshot replace
> a newer stored generation. Run reordered-concurrency tests before editing
> callers.
>
> **Drift check (run first)**:
> `git diff --stat a94c1fb..HEAD -- src/db/schema.ts migrations src/lib/project-sandbox.ts src/lib/project-sandbox.test.ts src/lib/agent-run.ts src/lib/agent-run.test.ts src/routes/api.agent.stream.ts src/lib/session-git-backup.ts src/lib/session-git-backup.test.ts docs/architecture/agent-harness.md`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/010-sync-primary-before-session-worktree.md`,
  `plans/011-establish-verification-baseline.md`
- **Category**: bug, perf
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Reconciled at**: commit `a94c1fb`, 2026-07-12 — plan 010 + secret redaction
  (012/013) touched agent-run/stream route/docs; backup write path and
  double-PR-snapshot still match original finding. Line numbers refreshed below.
- **Execution**: DONE (2026-07-12) — branch `advisor/014-version-backups` @
  `3b69d3d`, worktree
  `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f5548-2f95-7d23-953c-ea091eda8235`.
  Advisor review **APPROVE**.

## Why this matters

Whole-workspace backups can complete out of order. Their D1 handle is currently
updated unconditionally, so a snapshot invoked earlier can overwrite the
handle stored by a later snapshot and cold restore can lose newer worktree
state. Opening a PR also snapshots after a push and again after the external,
non-mutating PR API call. This plan gives every snapshot invocation a monotonic
generation and stores only the newest completed candidate, while eliminating
backups that follow no sandbox mutation.

## Current state (as of `a94c1fb`)

### Unconditional handle write — `src/lib/project-sandbox.ts`

```ts
// persistProjectSandboxBackup (lines 30–48): backup then storeReadyProjectBackup
// finalizeAgentRun (lines 51–61): store handle produced elsewhere
// storeReadyProjectBackup (lines 78–104): UPDATE with only id+userId predicates
async function storeReadyProjectBackup(options: { ... }) {
  const [updatedProject] = await options.db
    .update(projects)
    .set({
      status: "ready",
      sandboxBackup: serializeSandboxBackup(options.backup),
      sandboxBackupCreatedAt: sql`(unixepoch())`,
      updatedAt: sql`(unixepoch())`,
    })
    .where(
      and(
        eq(projects.id, options.project.id),
        eq(projects.userId, options.project.userId),
      ),
    )
    .returning();
  // no generation / ordering check
}
```

### Post-run split — create in runner, persist in route

`src/lib/agent-run.ts` (lines 306–330) creates the snapshot inside
`runAgentInSandbox` after the agent finishes:

```ts
backup = await backupSandboxWorkspace({ env, sandboxId, projectId });
backupStored = true;
// returns { ok, assistantText, backupStored, backup, backupError }
```

`src/routes/api.agent.stream.ts` (lines 404–418) later persists:

```ts
if (runResult.backupStored && runResult.backup) {
  ensuredProject = await finalizeAgentRun({
    db, project: ensuredProject, backup: runResult.backup,
  });
}
```

### Double backup on PR open — `src/lib/session-git-backup.ts` (54–76)

```ts
const didPush = await options.pushIfNeeded();
if (didPush) {
  await bestEffortPersistSessionGitBackup(...); // after push mutation
}
const result = await options.open();
await bestEffortPersistSessionGitBackup(...); // ALWAYS after open (external API)
```

### Schema — `src/db/schema.ts` (43–46)

```ts
sandboxBackup: text("sandboxBackup"),
sandboxBackupCreatedAt: integer("sandboxBackupCreatedAt", {
  mode: "timestamp",
}),
// no generation columns
```

### Existing tests

- `src/lib/project-sandbox.test.ts` — happy-path persist + ensure/restore
- `src/lib/agent-run.test.ts` — expects `backupSandboxWorkspace` after run
- `src/lib/session-git-backup.test.ts` — commit mutation/no-op; PR open with
  push failure path (1 backup) and no-push path (still 1 backup after open)

### Locked policy (plan 009)

Best-effort backup after successful git mutations; do not turn a completed push
into a reported failure when backup fails.

### Provisioning path (out of versioned helper)

`src/integrations/trpc/routers/projects.ts` and restore/recreate inside
`ensureProjectSandbox` call `storeReadyProjectBackup` / write `sandboxBackup`
directly. Leave those unconditional for first-provision and restore-refresh;
the versioned helper is for concurrent post-mutation snapshots.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Generate migration | `pnpm db:generate` | one reviewed migration for generation columns |
| Focused tests | `pnpm test -- src/lib/project-sandbox.test.ts src/lib/agent-run.test.ts src/lib/session-git-backup.test.ts` | all pass |
| Full gate | `pnpm verify` | exit 0 |

Fresh worktrees share git history but not `node_modules`. Run `pnpm install`
(and `pnpm runner:install` if `pnpm verify` needs the runner) before the first
verify command.

## Scope

**In scope**:

- `src/db/schema.ts`, one generated migration and migration metadata
- `src/lib/project-sandbox.ts`, `.test.ts`
- `src/lib/agent-run.ts`, `.test.ts`
- `src/routes/api.agent.stream.ts`
- `src/lib/session-git-backup.ts`, `.test.ts`
- `docs/architecture/agent-harness.md`
- `plans/README.md` status only (reviewer maintains the index — skip updating it)

**Out of scope**:

- Changing R2 backup format, mounting R2, deleting old backup objects, or
  changing restore/install behavior.
- A project-wide agent-run mutex or sandbox-per-session architecture.
- Making best-effort post-git backup failures roll back successful git work.
- Backing up after external-only GitHub API operations.
- Changing provisioning writes in `projects.ts` router or the restore/recreate
  paths inside `ensureProjectSandbox` (they may keep unconditional
  `storeReadyProjectBackup` for first ready state).

## Git workflow

- Branch: `advisor/014-version-backups`
- Suggested commit: `fix(sandbox): version workspace backups`
- Do not push or open a PR unless instructed.

## Implementation design (be explicit)

### Generation columns

Add to `projects` table (Drizzle schema + generated migration):

```ts
sandboxBackupRequestedGeneration: integer("sandboxBackupRequestedGeneration")
  .notNull()
  .default(0),
sandboxBackupStoredGeneration: integer("sandboxBackupStoredGeneration")
  .notNull()
  .default(0),
```

SQLite/D1: existing rows get 0 via default. Do not hand-edit migration
snapshots except as generated by `pnpm db:generate`.

### Versioned `persistProjectSandboxBackup`

Refactor so the full flow is:

1. **Reserve generation** (atomic increment of `sandboxBackupRequestedGeneration`
   where `id` + `userId` match; return the new value as `candidateGeneration`).
   With Drizzle + D1/SQLite:

   ```ts
   const [row] = await db
     .update(projects)
     .set({
       sandboxBackupRequestedGeneration: sql`${projects.sandboxBackupRequestedGeneration} + 1`,
       updatedAt: sql`(unixepoch())`,
     })
     .where(and(eq(projects.id, id), eq(projects.userId, userId)))
     .returning({
       generation: projects.sandboxBackupRequestedGeneration,
       status: projects.status,
       sandboxId: projects.sandboxId,
     });
   ```

   If D1/drizzle cannot return the post-increment value reliably, STOP and
   report (do not invent a non-atomic select-then-update).

2. **Create backup** via `backupSandboxWorkspace` using the project's sandboxId.

3. **Conditional store** — update handle only when the candidate is still the
   newest successfully completable generation:

   ```ts
   .set({
     status: "ready",
     sandboxBackup: serializeSandboxBackup(backup),
     sandboxBackupCreatedAt: sql`(unixepoch())`,
     sandboxBackupStoredGeneration: candidateGeneration,
     updatedAt: sql`(unixepoch())`,
   })
   .where(
     and(
       eq(projects.id, id),
       eq(projects.userId, userId),
       // storedGeneration < candidateGeneration
       sql`${projects.sandboxBackupStoredGeneration} < ${candidateGeneration}`,
     ),
   )
   .returning();
   ```

4. **Result shape**: return enough for callers to know stored vs superseded.
   Suggested return:

   ```ts
   {
     project: typeof projects.$inferSelect; // latest row after attempt
     stored: boolean; // true if this candidate wrote the handle
     candidateGeneration: number;
   }
   ```

   Or keep returning the project row and use a separate field — either is fine
   if git wrappers and agent path still work. **Never throw** solely because
   the candidate was superseded (that is success for concurrency).

5. Keep `bestEffortPersistSessionGitBackup` swallowing real backup failures
   (network, sandbox errors) without failing the git mutation.

### `finalizeAgentRun` / post-run path

Goal: **one versioned snapshot attempt per completed run**, with generation
reserved immediately before `createBackup`, not at agent start.

Preferred approach (simplest, matches “share one persistence implementation”):

- Have `runAgentInSandbox` **stop creating backups itself**. Return
  `{ ok, assistantText, backupError?: undefined }` without `backup` /
  `backupStored`, **or** keep those fields but leave them unset and move
  backup to the route / a helper called once after the run.
- In `api.agent.stream.ts` after the run completes (success or failure —
  same policy as today: always try backup after a finished run), call
  `persistProjectSandboxBackup({ db, env, project })` (versioned) once.
  Map failure into `done.backupError` as today; map superseded as success
  (no backupError).
- Remove or thin `finalizeAgentRun` if it only did unconditional store of a
  pre-created handle. If other code imports it, re-export a thin wrapper or
  delete the re-export from `agent-run.ts` and update imports.

Alternative acceptable approach: keep create+persist inside one helper used
by both agent path and git path (`persistProjectSandboxBackup` already
creates then stores — use it for post-run too).

**Do not** reserve generation at agent start. **Do not** create backup without
going through the versioned store path when updating the project handle.

Keep SSE `done.backupError` field stable (string | absent). Runner success
(`ok`) must not flip false solely due to backup failure or supersession.

### Mutation-aware PR open

```ts
export async function openSessionPullRequestWithBackup<T>(...) {
  const didPush = await options.pushIfNeeded();
  if (didPush) {
    await bestEffortPersistSessionGitBackup(...);
  }
  return await options.open();
  // NO backup after open — open is external GitHub API only
}
```

Commit wrapper already backs up only when `committed`; push wrapper always
mutates remote tracking state via push — keep those behaviors.

### Tests to add/change

**`project-sandbox.test.ts`** (extend fake DB to support generation fields and
conditional where clauses):

1. **Reordered completion**: reserve gen1, reserve gen2, complete gen2 first
   (stores), complete gen1 second (superseded — handle stays gen2's backup id).
2. **Newer failure**: reserve gen1, reserve gen2, gen2's `backupSandboxWorkspace`
   throws; gen1 completes and stores (gen1 > stored 0).
3. Happy path still stores handle + sets `sandboxBackupStoredGeneration`.

Implement concurrency with deferred promises controlling when
`backupSandboxWorkspace` resolves, not with real timers if avoidable.

**`agent-run.test.ts`**:

- After change: either zero direct `backupSandboxWorkspace` calls from
  `runAgentInSandbox`, or exactly one versioned path — match chosen design.
- Success and failure runs still leave room for exactly one post-run backup
  attempt at the orchestration boundary (add a focused test if backup moves
  to a small exported helper; if it only lives in the route, test the helper
  used by the route, not the whole HTTP handler).

**`session-git-backup.test.ts`**:

- Ahead/open (pushIfNeeded true): **exactly one** persist call (after push).
- Already-pushed/open (pushIfNeeded false): **zero** persist calls.
- Commit no-op: zero; commit mutation: one; backup throw still returns git result.

### Docs

In `docs/architecture/agent-harness.md` Persistence + Git export sections:

- Note monotonic `sandboxBackupRequestedGeneration` /
  `sandboxBackupStoredGeneration`; only the newest completed candidate
  updates `sandboxBackup`.
- Note session-git backups run only after sandbox mutations (commit when
  committed, push, PR auto-push), not after external-only PR API calls.

## Steps

### Step 1: Add backup generation state

Add the two non-null integer columns with zero defaults. Generate, inspect,
and commit one Drizzle migration (`pnpm db:generate`). Do not hand-edit
snapshot metadata except as generated.

**Verify**: `pnpm db:generate` produces no second migration when rerun, and
`pnpm typecheck` exits 0.

### Step 2: Implement versioned snapshot persistence

Refactor `persistProjectSandboxBackup` as designed above. Write deferred-promise
concurrency tests first or alongside.

**Verify**: `pnpm test -- src/lib/project-sandbox.test.ts` — concurrency and
normal persistence tests pass.

### Step 3: Route all post-run snapshots through the versioned helper

Move post-run snapshot/persist to the versioned helper. Keep
`done.backupError` and run `ok` semantics stable. Do not reserve at agent start.

**Verify**: `pnpm test -- src/lib/agent-run.test.ts` plus any new helper tests →
exactly one versioned snapshot attempt per completed run.

### Step 4: Make git wrappers mutation-aware

Change `openSessionPullRequestWithBackup` to snapshot only when
`pushIfNeeded()` returned true.

**Verify**: `pnpm test -- src/lib/session-git-backup.test.ts` → ahead/open is
one backup, already-pushed/open is zero, commit no-op is zero.

### Step 5: Document and run the full gate

Update architecture docs. Run full verify.

**Verify**: `pnpm verify` → exit 0.

## Test plan

- Reordered generation completion, newer failure, stale conditional update.
- Agent success/failure each invokes at most one versioned backup.
- Git commit mutation, no-op commit, push, PR with auto-push, PR without push.
- Backup failure remains non-fatal to an already successful git mutation.
- Restore continues using the stored handle without generation-specific logic.

## Done criteria

- [x] Older candidate completion cannot replace a newer stored generation.
- [x] All new projects/backfilled rows start at generation zero.
- [x] PR creation without sandbox mutation creates no backup.
- [x] Post-run and git paths share one persistence implementation.
- [x] Migration, focused tests, and `pnpm verify` pass.

## STOP conditions

- D1 cannot atomically increment/return or conditionally update the generation
  with the current Drizzle version.
- The snapshot API's documented semantics say content is captured only at
  completion rather than invocation; generation ordering must then be
  redesigned, not guessed.
- Plan 010 or another live change has materially rewritten the agent route or
  backup helper beyond what this reconciled plan describes; stop and report.

## Maintenance notes

Every future call to `backupSandboxWorkspace` that updates a project handle
must go through the versioned helper. Reviewers should reject unconditional
`sandboxBackup` writes outside provisioning/migration/restore-refresh code.
