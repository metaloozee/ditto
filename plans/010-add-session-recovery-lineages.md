# Add workspace-session recovery lineages

Status: TODO

Written against commit `62c99b4`. Complete plans 004 and 006 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in mutation callers, archive transport, runtime,
schema, and message settlement. Stop if recovery ownership changed.

## Goal

Give each workspace session its own mutation generation, current and previous
successful recovery archives, pending checkpoint state, and recovery health.
Create a checkpoint after every completed agent run and successful mutating Git
operation. Preview deferral comes in plan 011.

## Current state

`agent-run-service.ts` calls `persistProjectSandboxBackup()` after terminal
assistant persistence. `session-git-backup.ts` does the same after Git
mutations. Backup generations and handles live on `projects`, so one session's
backup captures every worktree in the shared sandbox.

## Files in scope

- `apps/web/src/db/schema.ts`, migration, and Drizzle metadata
- new `apps/web/src/lib/workspace-recovery.ts` and tests
- `apps/web/src/lib/sandbox-archive.ts` and tests
- `apps/web/src/lib/workspace-runtime.ts` and tests
- `apps/web/src/lib/agent-run-service.ts` and tests
- `apps/web/src/lib/session-git-backup.ts` and tests
- session Git and UI action modules only at mutation call sites
- workspace/session routers and UI state needed to expose recovery health
- archive and project cleanup modules
- `CONTEXT.md` and affected architecture docs

Do not add preview deferral, capacity queueing, idle shutdown, or destructive
legacy-column removal in this plan.

## WorkspaceRecovery interface

Expose these behaviors through one module:

```ts
type WorkspaceRecovery = {
	recordMutation(input: MutationInput): Promise<RecoveryState>;
	checkpoint(input: CheckpointInput): Promise<RecoveryState>;
	restore(input: RestoreInput): Promise<RestoreResult>;
	requireDurable(sessionId: string): Promise<void>;
};
```

`checkpoint` and `restore` require a `WorkspaceRuntime` lease with exclusive
filesystem access. A raw sandbox ID is not accepted. The module hides archive
IDs, R2 keys, generation reservation, promotion, fallback, and cleanup.

The interface returns reason-coded recovery state. It never returns D1 rows or
R2 metadata.

## Durable state

Store on the workspace session or normalized recovery tables:

- monotonically increasing mutation generation
- latest durable generation
- pending generation and first-pending timestamp
- current and previous successful archive IDs
- state `healthy`, `pending`, `degraded`, or `failed`
- reason code and retry metadata
- archive format and compatibility key through the archive module

Reserve a mutation generation only after the mutation has completed. Coalesce a
later mutation into the newest pending generation when a checkpoint is already
running. Promote only with a compare-and-set check that rejects an older
completion.

## Required behavior

1. After an agent run settles and its assistant message is terminal, reserve a
   mutation generation and attempt a checkpoint.
2. After a successful local commit, sync, merge, or other Git operation that
   changes workspace or Git state, reserve a generation and checkpoint.
3. Do not reserve a workspace mutation for a read-only status operation or
   pull-request creation that does not alter local state.
4. If a successful run's checkpoint fails, keep the assistant message complete.
   Mark recovery degraded, schedule a bounded retry, and report the recovery
   error separately.
5. Keep the current and previous successful generations. Delete older R2
   objects only after promotion, through retryable cleanup records.
6. Restore the newest compatible generation first. On corruption or restore
   failure, try the previous generation once.
7. If both generations fail, mark recovery failed and preserve both archives
   for diagnosis. Never restore the project seed silently.
8. `requireDurable()` blocks archive or runtime destruction while a mutation is
   pending or degraded. User deletion remains allowed and follows the deletion
   ordering in plan 011.

## Tests

Test through the recovery interface:

- agent success plus checkpoint success promotes the reserved generation
- agent success plus checkpoint failure leaves the assistant complete and marks
  recovery degraded
- failed agent runs still checkpoint completed filesystem mutations if the
  current agent contract says they may exist; document the chosen rule
- successful mutating Git operations reserve exactly one generation
- two concurrent checkpoints cannot promote out of order
- later mutations coalesce without losing the highest generation
- current restore failure falls back to previous
- two restore failures mark recovery failed without restoring the seed
- archive cleanup starts only after a new promotion
- archive and runtime destruction are blocked while durability is pending
- R2 object keys and archive content do not appear in user errors or logs

Use the in-memory SQLite pattern in `session-preview.test.ts` for state-machine
tests. Avoid hand-written Drizzle chains for new multi-row recovery behavior.

## Verification

```bash
pnpm db:generate
pnpm --filter @ditto/web test -- src/lib/workspace-recovery.test.ts src/lib/sandbox-archive.test.ts src/lib/workspace-runtime.test.ts src/lib/agent-run-service.test.ts src/lib/session-git-backup.test.ts
pnpm typecheck
pnpm build
pnpm verify
```

Run a local restore matrix with two generated checkpoints and one corrupted
current archive. Expected result: restore selects the previous archive and D1
records the fallback reason.

## Done criteria

- Each workspace session owns an independent recovery lineage.
- Every completed mutation reserves a generation.
- Current and previous restore fallback works locally.
- Checkpoint failure does not rewrite a successful assistant message or Git
  result.
- Runtime destruction cannot discard uncheckpointed session work.

## Maintenance note

Any new workspace mutation must call `recordMutation()` through the runtime
lease. Review new Git and agent actions for this requirement.

## Stop conditions

- If a caller can checkpoint without an exclusive runtime lease, stop and move
  the call behind `WorkspaceRuntime`.
- If a failed restore path silently returns the project seed, stop and remove
  that fallback.
- If checkpoint retry depends on an untracked floating promise, stop and add a
  durable retry record before returning.
