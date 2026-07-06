# Plan 042: Restore from the Latest Valid Snapshot on Sandbox Wake

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 1d398af..HEAD -- src/lib/project-sandbox.ts src/lib/sandbox-bootstrap.ts src/lib/sandbox-backup.ts src/lib/r2-layout.ts src/lib/project-coordinator.ts src/integrations/trpc/routers/workspace.ts src/db/schema.ts src/lib/project-sandbox.test.ts src/lib/sandbox-backup.test.ts src/lib/r2-layout.test.ts plans/README.md
> git diff --stat -- src/lib/project-sandbox.ts src/lib/sandbox-bootstrap.ts src/lib/sandbox-backup.ts src/lib/r2-layout.ts src/lib/project-coordinator.ts src/integrations/trpc/routers/workspace.ts src/db/schema.ts src/lib/project-sandbox.test.ts src/lib/sandbox-backup.test.ts src/lib/r2-layout.test.ts plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. If an
> excerpt no longer matches and the difference is not merely formatting,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 040 (needs `snapshots` rows + manifests to restore from),
  041 (needs the `restoring` pause so a mutating run cannot start against a
  half-restored workspace)
- **Category**: architecture / durability / recovery
- **PRD phase**: Phase 4, step 3 (restore on sandbox wake/recreate)
- **Planned at**: commit `1d398af`, 2026-07-04

## Why this matters

The PRD restore policy: "if sandbox filesystem is missing, stale, or
untrusted, restore from the latest valid snapshot; if no snapshot exists,
rehydrate from GitHub baseline; while restore is active, mutating run
admission is paused; failed restore produces a stable project status and
recovery path." Today `ensureProjectSandbox` restores from the legacy
`projects.sandboxBackup` `DirectoryBackup` (written by `sandbox.createBackup`)
with no manifest, no digest, no per-snapshot validation, and no
`archiveRef`-driven restore. Plan 040 now writes a `snapshots` row + R2
manifest for each successful mutating run, and plan 041 pauses mutating
admission while restoring. This plan makes `ensureProjectSandbox` consult the
`snapshots` table, validate the manifest + digest before trusting a restore,
prefer the latest valid snapshot, fall back to GitHub rehydration when no
valid snapshot exists, and verify the restored workspace with a git sentinel —
closing the PRD's "Sandbox hibernation does not lose accepted workspace state"
acceptance criterion.

## Current state

- `src/lib/project-sandbox.ts` — `ensureProjectSandbox` (line 104):
  - Returns `{ project, state: "connected" }` if
    `isSandboxWorkspaceHydrated` (`.git` exists) is true.
  - Otherwise D1-CAS-locks `projects.status = "provisioning"`, reads
    `parseSandboxBackup(lockedProject.sandboxBackup)`, and:
    - if a stored backup exists, calls `restoreSandboxWorkspace({ env, sandboxId,
      backup, envVars })` (which runs `sandbox.restoreBackup(backup)`, then
      `syncSandboxEnvFile`, then `installDependencies`); on success it re-backs
      up via `backupSandboxWorkspace` and `storeReadyProjectBackup`, returning
      `restored_from_backup`. On `restoreSandboxWorkspace` throw it falls back
      to `recreateSandboxFromGitHub`.
    - if no stored backup, `recreateSandboxFromGitHub` (clone + install +
      backup), returning `recreated_from_github`.
  - On any outer throw, `markProjectRestoreFailed` sets `projects.status =
    "failed"` and throws `"Project sandbox restore failed. Please try again."`
- `src/lib/sandbox-bootstrap.ts`:
  - `isSandboxWorkspaceHydrated` (line 165) checks `${WORKSPACE_PATH}/.git`
    exists — the existing git sentinel.
  - `restoreSandboxWorkspace` (line 185) takes a `DirectoryBackup` and runs
    `sandbox.restoreBackup(options.backup)` then env-sync + install.
  - `backupSandboxWorkspace` (line 174) → `DirectoryBackup`.
  - `getProjectSandbox(env, sandboxId)` (line 12) → sandbox handle.
- `src/lib/sandbox-backup.ts` — `parseSandboxBackup` / `serializeSandboxBackup`
  round-trip `DirectoryBackup` (`{ id, dir, localBucket? }`) via the
  `projects.sandboxBackup` JSON column.
- `src/lib/r2-layout.ts` — after plan 040, `SnapshotManifest` carries an
  optional `archiveRef` (the `DirectoryBackup.id` needed to restore).
  `validateSnapshotManifest` is the type guard. `snapshotManifestKey(projectId,
  snapshotId)` is the R2 key.
- `src/db/schema.ts` — `snapshots` table (id, projectId, runId, r2Key,
  baseCommitSha, digest, status, createdAt, completedAt). `projects.sandboxBackup`
  holds the latest `DirectoryBackup`.
- `src/lib/project-coordinator.ts` — after plan 041, the coordinator exposes
  `snapshot.restoring` and `latestSnapshotId`, and `POST /begin-restore` /
  `/end-restore` / `/record-snapshot`.
- `alchemy.run.ts` — `BACKUP_BUCKET` (R2) and `DB` are bound to the `website`
  Worker, which is where `ensureProjectSandbox` runs (called from
  `workspace.get` / `startRun`).
- Repo conventions: restore errors throw short `Error` messages; the router
  wraps them in `TRPCError({ code: "PRECONDITION_FAILED" })`. Bounded sandbox
  commands use `sandbox.exec(cmd, { cwd: "/workspace", timeout })`. Secret
  exclusion is handled by `SANDBOX_BACKUP_EXCLUDES` / `SNAPSHOT_SECRET_EXCLUDES`;
  `.env` is regenerated from encrypted app data by `syncSandboxEnvFile` after
  restore (PRD: "regenerate environment files from encrypted app data after
  restore" — already satisfied; do not embed secrets in snapshots).

## Commands you will need

| Purpose    | Command                                      | Expected on success |
|------------|----------------------------------------------|---------------------|
| Typecheck  | `pnpm exec tsc --noEmit --pretty false`      | exit 0, no errors   |
| Unit tests | `pnpm test -- src/lib/project-sandbox.test.ts src/lib/sandbox-backup.test.ts src/lib/r2-layout.test.ts` | all pass |
| Full tests | `pnpm test`                                  | exit 0              |
| Lint       | `pnpm lint`                                  | exit 0 (only the 2 pre-existing warnings) |
| Flue build | `pnpm flue:build`                            | exit 0 (known DO migration warning only) |
| Whitespace | `git diff --check`                           | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/lib/project-sandbox.ts` — consult the `snapshots` table, validate the manifest, prefer the latest valid snapshot, fall back to GitHub, verify the git sentinel after restore
- `src/lib/project-sandbox.test.ts` (create if absent; extend if present) — cover the restore decision tree
- `src/lib/sandbox-bootstrap.ts` — add a manifest-validated restore helper (e.g. `restoreSandboxWorkspaceFromSnapshot`) that reads the manifest's `archiveRef`, reconstructs the `DirectoryBackup`, calls `sandbox.restoreBackup`, syncs env, installs deps, and verifies hydration
- `src/lib/sandbox-bootstrap.test.ts` (extend if present) — cover the manifest-validated path
- `src/lib/r2-layout.ts` — only if a small pure helper is needed to read/parse a manifest from an R2 body (otherwise keep unchanged)
- `plans/README.md` — status row

**Out of scope** (do NOT touch):
- `src/lib/flue-run-bridge.ts` — checkpoint writing is plan 040; do not change it here
- `src/lib/project-coordinator.ts` — restoring state is plan 041; this plan consumes it via the existing routes only if needed (the restoring pause is already wired by 041 around `ensureProjectSandbox`)
- The `flueWorker` bindings in `alchemy.run.ts` — restore runs in `website`
- Historical (non-latest) snapshot selection UI — out of v1 scope; restore always uses the latest `completed` snapshot
- Snapshot retention / pruning — deferred (PRD out of scope: "Retention/deletion product workflows")
- Periodic checkpoints — plan 043

## Git workflow

- Branch: `advisor/042-restore-from-latest-snapshot`
- Commit per logical unit. Conventional Commits style (e.g.
  `feat(durability): restore workspace from validated r2 snapshot`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a manifest-validated restore helper in `sandbox-bootstrap.ts`

Add `restoreSandboxWorkspaceFromSnapshot(options: { env, sandboxId,
directoryBackup, envVars, expectedDigest, baseCommitSha })` that:

1. Calls `sandbox.restoreBackup(options.directoryBackup)` (same primitive
   `restoreSandboxWorkspace` uses).
2. Calls `syncSandboxEnvFile({ env, sandboxId, envVars })` (regenerate `.env`
   from encrypted app data — PRD requirement, already implemented).
3. Calls `installDependencies(sandbox)`.
4. Verifies `isSandboxWorkspaceHydrated` (the `.git` sentinel).
5. Reads the post-restore `git rev-parse HEAD` via a bounded
   `sandbox.exec("git rev-parse HEAD", { cwd: "/workspace", timeout: 10_000 })`
   and compares it to `options.baseCommitSha` when `baseCommitSha` is non-null.
   Mismatch is not fatal (a mutating run may have left uncommitted changes),
   but record it: return a result `{ hydrated: boolean, commitMatch: boolean }`.
6. Returns the result; throws short `Error` messages on failure (match the
   existing `restoreSandboxWorkspace` style).

Do not delete `restoreSandboxWorkspace` — keep it as the simple path used when
no manifest exists (GitHub-rehydrate fallback still uses the backup primitive
indirectly).

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 2: Resolve the latest valid snapshot + manifest in `project-sandbox.ts`

Add a helper `resolveLatestSnapshot(db, projectId, bucket)` that:

1. Queries `snapshots` for the latest `status: "completed"` row for the project
   (`orderBy(desc(createdAt))`, `limit(1)`).
2. If none, returns `null`.
3. If found, reads the manifest object from `BACKUP_BUCKET.get(row.r2Key)`,
   parses it, and runs `validateSnapshotManifest`. If validation fails (or the
   R2 get returns null), return `{ invalid: true, row }` so the caller can
   record a `snapshot_failed`-style signal and fall back.
4. Returns `{ snapshotId, manifest, snapshotRow }` on success.

Keep this helper pure-ish / injectable (pass `db` and `bucket`) so it is
testable with fakes.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 3: Rewire `ensureProjectSandbox` to prefer the latest valid snapshot

Change the restore branch in `ensureProjectSandbox` (the `if (storedBackup)`
block and the no-backup branch) so the order is:

1. `connected` if hydrated — unchanged.
2. D1-CAS-lock `provisioning` — unchanged.
3. Resolve the latest valid snapshot via `resolveLatestSnapshot`.
   - **If a valid snapshot exists**: reconstruct the `DirectoryBackup` from
     `manifest.archiveRef` (and `dir: WORKSPACE_PATH`, plus `localBucket` if
     applicable) — verify the `archiveRef` shape with `parseSandboxBackup`-style
     guards. Call `restoreSandboxWorkspaceFromSnapshot`. On success, re-backup
     via `backupSandboxWorkspace`, `storeReadyProjectBackup`, and return
     `restored_from_backup`. On throw, fall through to GitHub rehydration
     (existing `recreateSandboxFromGitHub`).
   - **If no valid snapshot** (none, or manifest invalid): fall back to the
     existing `storedBackup` path (legacy `projects.sandboxBackup`) if present,
     else `recreateSandboxFromGitHub`. When the manifest was invalid, also
     insert a `snapshot_failed` event-equivalent: set the offending
     `snapshots` row `status = "failed"` (best-effort, non-blocking) so
     observability shows why a snapshot was skipped.
4. Outer failure still calls `markProjectRestoreFailed` and throws the stable
   message.

Do not change the `connected` / `recreated_from_github` result union shape.
The existing `workspace.get` callers depend on it.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 4: Tests for the restore decision tree

Add/extend `src/lib/project-sandbox.test.ts` with fake `db` / fake `bucket` /
fake sandbox cases:

- Hydrated workspace → `connected`, no R2 read, no snapshots query beyond a
  cheap short-circuit (or none).
- Not hydrated, latest `completed` snapshot with valid manifest →
  `restoreSandboxWorkspaceFromSnapshot` called with the manifest's
  `archiveRef`; result `restored_from_backup`.
- Not hydrated, latest snapshot manifest invalid (bad `schemaVersion` or
  missing digest) → snapshot row marked `failed`, falls back to legacy
  `projects.sandboxBackup` if present, else GitHub.
- Not hydrated, no `snapshots` row, legacy `projects.sandboxBackup` present →
  legacy restore path (unchanged behavior).
- Not hydrated, no snapshot, no legacy backup → `recreateSandboxFromGitHub`.
- Snapshot restore throws → GitHub fallback; outer success returns
  `recreated_from_github`; `projects.status` ends `ready`.
- All restore paths throw → `markProjectRestoreFailed` → `projects.status =
  "failed"` + stable error.

**Verify**: `pnpm test -- src/lib/project-sandbox.test.ts` → all pass. Then
`pnpm test` → exit 0.

### Step 5: Final verification

```sh
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

All pass with the known warnings only. Update `plans/README.md` status row.

## Test plan

- New/extended `src/lib/project-sandbox.test.ts` — the 7 cases in Step 4.
- Extended `src/lib/sandbox-bootstrap.test.ts` —
  `restoreSandboxWorkspaceFromSnapshot` runs restore → env-sync → install →
  hydration check; `baseCommitSha` mismatch returns `commitMatch: false`
  without throwing.
- Pattern after: `src/lib/sandbox-backup.test.ts` (pure round-trip shape) and
  any existing `project-sandbox` tests; if none exist, model the fake-sandbox
  pattern on `src/lib/flue-run-bridge.test.ts`.

## Done criteria

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0; new tests for the restore decision tree pass
- [ ] `ensureProjectSandbox` prefers the latest valid `snapshots` row +
      validated manifest over the legacy `projects.sandboxBackup` column;
      falls back to legacy backup, then GitHub rehydration; marks invalid
      snapshots `failed` (covered by tests)
- [ ] Restore regenerates `.env` from encrypted app data (existing
      `syncSandboxEnvFile` path preserved — no secrets in snapshots)
- [ ] Restore verifies the `.git` sentinel after restoring (covered by tests)
- [ ] Failed restore produces stable `projects.status = "failed"` + the
      existing error message (covered by tests)
- [ ] No files outside the in-scope list are modified
- [ ] `pnpm lint`, `pnpm flue:build`, `git diff --check` pass
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- `ensureProjectSandbox` or the `restoreSandboxWorkspace` primitive doesn't
  match the excerpts (drift since `1d398af`).
- `SnapshotManifest` does not carry `archiveRef` after plan 040 (plan 040 is a
  hard dependency; if 040 landed without `archiveRef`, stop — this plan cannot
  reconstruct the `DirectoryBackup` without it).
- `sandbox.restoreBackup` does not accept a `DirectoryBackup` reconstructed
  from `{ id: manifest.archiveRef, dir: "/workspace" }` (verify against
  `node_modules/@cloudflare/sandbox` types) — write a decision note and stop.
- `BACKUP_BUCKET` is not bound to the `website` Worker (restore runs in
  `website`).
- The restore fallback chain cannot be tested without a live sandbox container
  — keep tests on fakes (the repo convention) and note the manual smoke below.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The restore priority is now: latest valid `snapshots` manifest → legacy
  `projects.sandboxBackup` → GitHub rehydrate. Plan 040 keeps
  `projects.sandboxBackup` refreshed, so even if the `snapshots` manifest read
  fails, restore degrades to the legacy handle.
- `archiveRef` is the contract between the Ditto-owned manifest and the
  sandbox-SDK-owned restorable archive. If the sandbox SDK ever changes its
  `DirectoryBackup.id` format, both plan 040's checkpoint and this plan's
  restore must update together.
- Reviewer should scrutinize: (1) no secret is read out of R2 into a projected
  event or log (manifests carry only digest + base commit + excluded-path
  *names*); (2) `.env` is always regenerated from encrypted app data, never
  restored from a snapshot; (3) an invalid manifest degrades to a working
  restore path rather than bricking the project; (4) the
  `connected`/`restored_from_backup`/`recreated_from_github` union is
  unchanged.
- Manual smoke before deploy (requires a live sandbox + R2 credentials): run a
  mutating run to completion (plan 040 writes a snapshot), force the sandbox
  to hibernate / remove `/workspace/.git`, reload the project, confirm it
  restores from the snapshot and the chat history loads (PRD user story 9).
- Deferred: periodic checkpoints (plan 043); historical snapshot selection;
  retention/pruning.
