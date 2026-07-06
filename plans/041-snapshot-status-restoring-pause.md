# Plan 041: Snapshot Status and Restoring Pause in the Project Coordinator

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
> git diff --stat 1d398af..HEAD -- src/lib/project-coordinator.ts src/lib/project-coordinator-sqlite.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-coordinator.test.ts src/lib/project-lock-projection.ts src/lib/project-lock-projection.test.ts src/integrations/trpc/routers/workspace.ts src/integrations/trpc/routers/projects.ts src/lib/project-sandbox.ts src/db/schema.ts 'src/routes/project.$projectId.tsx' plans/README.md
> git diff --stat -- src/lib/project-coordinator.ts src/lib/project-coordinator-sqlite.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-coordinator.test.ts src/lib/project-lock-projection.ts src/lib/project-lock-projection.test.ts src/integrations/trpc/routers/workspace.ts src/integrations/trpc/routers/projects.ts src/lib/project-sandbox.ts src/db/schema.ts 'src/routes/project.$projectId.tsx' plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. If an
> excerpt no longer matches and the difference is not merely formatting,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 040 (needs the `snapshots` table populated so
  `latestSnapshotId` is meaningful)
- **Category**: architecture / concurrency / UX
- **PRD phase**: Phase 4, step 2 (snapshot status visible; restore pauses
  mutating admission)
- **Planned at**: commit `1d398af`, 2026-07-04

## Why this matters

The PRD's restore policy says "while restore is active, mutating run admission
is paused" and "readers receive status indicating the workspace is restoring,"
and the coordinator state shape in the PRD includes
`snapshot: { latestSnapshotId: string | null; restoring: boolean }`. Today
`ProjectCoordinatorState` has only `mutationLease`, `activeReadOnlyRuns`,
`lastTerminal`, and `nextFencingToken` — no snapshot awareness. Restore is
signaled only by `projects.status = "provisioning"` inside `ensureProjectSandbox`
(a D1 row lock that prevents concurrent restores but does not gate coordinator
admission in a concurrent request). The project status API surfaces
`sandboxState: "connected" | "restored_from_backup" | "recreated_from_github"`
but never `latestSnapshotId` or an explicit "restoring" flag. This plan makes
the coordinator the restoring authority for mutating admission and surfaces
snapshot/restoring status to the UI, so a user can see "workspace is restoring"
and a mutating run cannot be admitted against a half-restored workspace.

## Current state

- `src/lib/project-coordinator.ts` — the Durable Object + pure decision
  functions. `ProjectCoordinatorState` (lines 22–32):
  ```ts
  export type ProjectCoordinatorState = {
    projectId?: string;
    mutationLease: ProjectCoordinatorLease | null;
    activeReadOnlyRuns: ProjectCoordinatorReadOnlyRun[];
    lastTerminal?: { runId: string; status: ProjectCoordinatorTerminalStatus; observedAt: string; };
    nextFencingToken: number;
  };
  ```
  `admitProjectRun(state, input, nowIso)` (line ~96) rejects a mutating
  admission with `status: 409` and `MUTATION_CONFLICT_MESSAGE` only when
  `baseState.mutationLease` is already set. There is **no restoring branch**:
  it does not check any `snapshot.restoring` flag. Read-only admission is
  unconditional. `observeProjectRunTerminal` clears the lease/RO run and sets
  `lastTerminal`.
- `src/lib/project-coordinator-sqlite.ts` — SQLite persistence. Tables
  (`coordinator_meta`, `mutation_lease`, `read_only_runs`, `last_terminal`) and
  `coordinatorRowsToState` / `coordinatorStateToRows` round-trip the state. No
  snapshot table exists.
- `src/lib/project-lock-projection.ts` — maps coordinator admission to the D1
  `projects` lock columns (`lockStatus`, `lockHolderRunId`, `lockFencingToken`,
  `lockUpdatedAt`). No snapshot fields.
- `src/integrations/trpc/routers/workspace.ts`:
  - `workspace.get` (line ~166) calls `ensureProjectSandbox` and returns
    `sandboxState: "connected" | "restored_from_backup" | "recreated_from_github"`.
    It does not return `latestSnapshotId` or a `restoring` flag.
  - `startRun` (line 337) calls `ensureProjectSandbox` at line 379 **before**
    `admitMutatingRun` / `startReadOnlyFlueRun`, so restore completes before
    admission in the same request. The gap is a *concurrent* request: a second
    `startRun` that passes `ensureProjectSandbox` (because the first restore
    finished and flipped `projects.status` back to `ready`) can race a
    mutating admission while the coordinator is unaware any restore happened.
- `src/lib/project-sandbox.ts` — `ensureProjectSandbox` (line 104) sets
  `projects.status = "provisioning"` during restore (a D1 CAS lock), then
  `ready` on success or `failed` on failure. It does not notify the
  coordinator.
- `src/db/schema.ts` — `projects` has `status: "provisioning" | "ready" |
  "failed"`, `sandboxBackup`, `sandboxBackupCreatedAt`, and the lock columns.
  `snapshots` has `status: "pending" | "completed" | "failed"`. No
  `restoring` enum value and no `latestSnapshotId` column.
- `src/routes/project.$projectId.tsx` — the project workspace route that
  consumes `workspace.get`. Review its status surface before adding restoring
  UI.
- Repo conventions: coordinator state changes are persisted via
  `setState(state)` (which writes SQLite + is the source of truth) before
  responding; the pure decision functions in `project-coordinator.ts` are
  tested independently of the DO. Match that split: add a pure
  `beginRestore` / `endRestore` decision + an `isMutatingAdmissionBlocked`
  check, with unit tests, then wire the DO routes.

## Commands you will need

| Purpose    | Command                                      | Expected on success |
|------------|----------------------------------------------|---------------------|
| Typecheck  | `pnpm exec tsc --noEmit --pretty false`      | exit 0, no errors   |
| Unit tests | `pnpm test -- src/lib/project-coordinator.test.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-lock-projection.test.ts` | all pass |
| Full tests | `pnpm test`                                  | exit 0              |
| Lint       | `pnpm lint`                                  | exit 0 (only the 2 pre-existing warnings) |
| Flue build | `pnpm flue:build`                            | exit 0 (known DO migration warning only) |
| Whitespace | `git diff --check`                           | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/lib/project-coordinator.ts` — add `snapshot: { latestSnapshotId: string | null; restoring: boolean }` to state; add `beginRestore` / `endRestore` / `recordLatestSnapshot` decision functions; reject mutating admission while `restoring`; keep read-only admission allowed (PRD: readers receive status, read-only runs continue)
- `src/lib/project-coordinator-sqlite.ts` — add a `snapshot_state` SQLite table + row mapping
- `src/lib/project-coordinator-sqlite.test.ts` / `src/lib/project-coordinator.test.ts` — cover restoring blocks mutating, read-only still admitted, endRestore clears, recordLatestSnapshot
- `src/lib/project-lock-projection.ts` — (optional) carry `restoring` / `latestSnapshotId` into the lock projection if the router needs it; otherwise leave
- `src/integrations/trpc/routers/workspace.ts` — call coordinator `POST /begin-restore` + `POST /end-restore` around the `ensureProjectSandbox` restore path; reject mutating admission on 409-with-restoring with a clear message; return `restoring` + `latestSnapshotId` from `workspace.get`
- `src/integrations/trpc/routers/projects.ts` — if it surfaces project status, include the same fields (check first; only touch if needed)
- `src/routes/project.$projectId.tsx` — surface a "Restoring workspace…" status when `restoring` is true (honest, non-functional-while-restoring controls per PRD user story 25)
- `plans/README.md` — status row

**Out of scope** (do NOT touch):
- `src/lib/project-sandbox.ts` restore *logic* (plan 042 hardens restore-from-snapshot); this plan only wraps the existing `ensureProjectSandbox` call with coordinator begin/end-restore notifications
- `src/lib/flue-run-bridge.ts` — no changes here; checkpoint writing is plan 040
- The `flueWorker` bindings in `alchemy.run.ts` — the coordinator is bound to `website` already
- Adding a `mutatingQueue` or `pausedRun` to the coordinator — that is a Phase 3 follow-up / PRD open question #5; this plan adds only `snapshot.restoring`
- Periodic checkpoints — plan 043

## Git workflow

- Branch: `advisor/041-snapshot-status-restoring-pause`
- Commit per logical unit. Conventional Commits style (e.g.
  `feat(coordinator): pause mutating admission while workspace restores`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extend coordinator state with snapshot/restoring fields (pure)

In `src/lib/project-coordinator.ts`:

- Add to `ProjectCoordinatorState`:
  `snapshot: { latestSnapshotId: string | null; restoring: boolean }` with a
  default of `{ latestSnapshotId: null, restoring: false }` in
  `createInitialProjectCoordinatorState()`.
- Add pure functions (no I/O), each returning the next state:
  - `beginProjectRestore(state, nowIso)` → sets `snapshot.restoring = true`
    (idempotent; if already restoring, return unchanged state).
  - `endProjectRestore(state, { snapshotId | null }, nowIso)` → sets
    `snapshot.restoring = false` and, if a `snapshotId` is provided, sets
    `snapshot.latestSnapshotId`.
  - `recordLatestSnapshot(state, snapshotId)` → sets
    `snapshot.latestSnapshotId` without touching `restoring`.
- Modify `admitProjectRun`: when `input.mode === "mutating"` and
  `baseState.snapshot.restoring === true`, return a rejection with `status: 409`
  and a new exported constant
  `RESTORE_IN_PROGRESS_MESSAGE = "Workspace is restoring; mutating runs are paused."`.
  Read-only admission stays unconditional (PRD: read-only agents continue).
- Keep `validateProjectCoordinatorLease` unchanged (lease validation is about
  active mutation, not restore).

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 2: SQLite persistence for snapshot state

In `src/lib/project-coordinator-sqlite.ts`:

- Add a `snapshot_state` table (single row, `id = 1`,
  `latest_snapshot_id TEXT`, `restoring INTEGER NOT NULL DEFAULT 0`) to the
  schema-creation in `project-coordinator.ts` `ensureSchema()` (or a shared
  schema helper — match where the other tables are created).
- Extend `CoordinatorSqlRows` with `snapshotState` and
  `coordinatorRowsToState` / `coordinatorStateToRows` to round-trip it. Booleans
  map to 0/1.

**Verify**: `pnpm test -- src/lib/project-coordinator-sqlite.test.ts` → all
pass, including a new case that a state with `restoring: true` +
`latestSnapshotId: "snap-1"` round-trips through rows and back.

### Step 3: Coordinator DO routes

In `src/lib/project-coordinator.ts` `ProjectCoordinator.fetch`:

- Add `POST /begin-restore` → `setState(beginProjectRestore(state, now))`,
  return `202` with the new state.
- Add `POST /end-restore` (body `{ snapshotId: string | null }`) →
  `setState(endProjectRestore(state, body.snapshotId, now))`, return `202`.
- Add `POST /record-snapshot` (body `{ snapshotId: string }`) →
  `setState(recordLatestSnapshot(state, body.snapshotId))`, return `202`.
- `GET /status` already returns the full state (now including `snapshot`).

**Verify**: `pnpm test -- src/lib/project-coordinator.test.ts` → all pass,
including: `/admit` mutating while `restoring: true` returns 409 with
`RESTORE_IN_PROGRESS_MESSAGE`; read-only `/admit` while restoring returns 202;
`/end-restore` clears `restoring`.

### Step 4: Wire begin/end-restore around `ensureProjectSandbox`

In `src/integrations/trpc/routers/workspace.ts`:

- Add a small helper `notifyCoordinatorRestore(env, projectId, phase:
  "begin" | "end", snapshotId?)` that POSTs to `/begin-restore` or
  `/end-restore` (reuse the existing `postProjectCoordinator` helper).
- In `workspace.get` and `startRun`, wrap the `ensureProjectSandbox` call:
  call `notifyCoordinatorRestore(env, projectId, "begin")` before, and
  `notifyCoordinatorRestore(env, projectId, "end")` after (in a `finally`).
  Best-effort: a coordinator notify failure must not break the restore (catch
  and continue), but should be logged.
- In `admitMutatingRun`, the existing 409 path already calls
  `markCoordinatorAdmissionRejected`. Extend `getProjectCoordinatorErrorMessage`
  (or the reject handler) so a 409 whose body is
  `RESTORE_IN_PROGRESS_MESSAGE` yields a `TRPCError({ code: "CONFLICT",
  message: "Workspace is restoring. Try again in a moment." })` and inserts a
  `lock_rejected` event with that reason (the existing pattern).

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 5: Surface restoring + latestSnapshotId in `workspace.get`

In `workspace.get`:

- After `ensureProjectSandbox`, fetch coordinator `GET /status` (the router
  already calls the coordinator elsewhere; reuse the fetch helper) and read
  `state.snapshot`. Return `restoring: boolean` and
  `latestSnapshotId: string | null` in the procedure result. If the coordinator
  fetch fails, return `restoring: false, latestSnapshotId: null` rather than
  failing the whole status call (degrade gracefully).

**Verify**: `pnpm test -- src/integrations/trpc/routers/workspace.test.ts` (if
present; if not, add a minimal test or extend an existing one) → all pass. If
no router test exists, add a small one modeled after
`src/lib/project-lock-projection.test.ts` for the projection and rely on the
coordinator tests for the authority.

### Step 6: UI restoring status

In `src/routes/project.$projectId.tsx`:

- Read the new `restoring` / `latestSnapshotId` fields from the `workspace.get`
  result. When `restoring` is true, show an honest "Restoring workspace…"
  status (disable the composer submit per PRD user story 25: "I do not want to
  start work against a half-restored filesystem"). Use an existing status
  component pattern from this file; do not invent new design tokens. When
  `latestSnapshotId` is present, optionally show a small "Last checkpoint"
  indicator. Keep it minimal and non-blocking for read-only use.

**Verify**: `pnpm exec tsc --noEmit --pretty false` and `pnpm lint` → exit 0.

### Step 7: Final verification

```sh
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

All pass with the known warnings only. Update `plans/README.md` status row.

## Test plan

- Extended `src/lib/project-coordinator.test.ts`: mutating admission rejected
  while `restoring: true` (409 + `RESTORE_IN_PROGRESS_MESSAGE`); read-only
  admission accepted while restoring; `endProjectRestore` clears `restoring`
  and sets `latestSnapshotId`; `beginProjectRestore` is idempotent;
  `recordLatestSnapshot` does not flip `restoring`.
- Extended `src/lib/project-coordinator-sqlite.test.ts`: snapshot_state
  round-trip; missing snapshot_state row defaults to
  `{ latestSnapshotId: null, restoring: false }`.
- New/extended router test: `workspace.get` returns `restoring` +
  `latestSnapshotId`; mutating `startRun` during restore returns CONFLICT with
  the restore message.
- Pattern after: `src/lib/project-coordinator.test.ts` (pure decision tests)
  and `src/lib/project-coordinator-sqlite.test.ts` (row mapping).

## Done criteria

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0; new tests for restoring-pause and snapshot status pass
- [ ] `ProjectCoordinatorState.snapshot` exists and persists across DO restarts
      (SQLite round-trip covered by tests)
- [ ] Mutating `/admit` returns 409 with `RESTORE_IN_PROGRESS_MESSAGE` while
      `snapshot.restoring === true`; read-only `/admit` still accepts
      (covered by tests)
- [ ] `workspace.get` returns `restoring` and `latestSnapshotId`; the UI shows
      "Restoring workspace…" and disables mutating submit while restoring
- [ ] No files outside the in-scope list are modified
- [ ] `pnpm lint`, `pnpm flue:build`, `git diff --check` pass
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The coordinator state or SQLite schema doesn't match the excerpts (drift
  since `1d398af`).
- `ensureProjectSandbox` is not called in both `workspace.get` and `startRun`
  (verify line 379 and ~214); if the call sites moved, update the wrapping
  points accordingly and note it.
- Adding `snapshot.restoring` requires changing the `flueWorker` bindings (it
  must not — the coordinator is in `website`).
- The UI route does not consume `workspace.get`'s result in a way that lets
  you add a restoring status without a broader refactor — stop and report
  rather than rearchitecting the route.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The coordinator is now the restoring authority for mutating admission; the
  D1 `projects.status = "provisioning"` lock remains as the concurrent-restore
  guard, and the coordinator `restoring` flag is the admission guard. They
  must agree: `ensureProjectSandbox` begin/end must be wrapped by coordinator
  begin/end-restore in the same code path.
- `latestSnapshotId` is set by plan 040's checkpoint (via
  `recordLatestSnapshot` after a successful checkpoint) and by plan 042's
  restore (via `endProjectRestore` with the snapshot used). Keep both call
  sites in sync.
- Reviewer should scrutinize: (1) read-only admission is never blocked by
  restore (PRD invariant); (2) coordinator notify failures during restore do
  not abort the restore; (3) `workspace.get` degrades gracefully if the
  coordinator is unreachable.
- Deferred: `mutatingQueue` / `pausedRun` (PRD open Q5 — currently "reject not
  queue"); periodic checkpoints (plan 043); restore-from-snapshot validation
  (plan 042).
