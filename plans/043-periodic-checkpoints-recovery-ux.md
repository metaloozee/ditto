# Plan 043: Periodic Checkpoints for Long Mutating Runs and Checkpoint/Restore Recovery UX

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
> git diff --stat 1d398af..HEAD -- src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/lib/run-snapshot-checkpoint.ts src/lib/run-snapshot-checkpoint.test.ts src/lib/project-sandbox.ts src/integrations/trpc/routers/workspace.ts src/lib/workspace-policy.ts 'src/routes/project.$projectId.tsx' src/components/ai-chat.tsx plans/README.md
> git diff --stat -- src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/lib/run-snapshot-checkpoint.ts src/lib/run-snapshot-checkpoint.test.ts src/lib/project-sandbox.ts src/integrations/trpc/routers/workspace.ts src/lib/workspace-policy.ts 'src/routes/project.$projectId.tsx' src/components/ai-chat.tsx plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. If an
> excerpt no longer matches and the difference is not merely formatting,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 040 (reuses the checkpoint helper), and benefits from 041
  (restoring status) + 042 (restore path) but no hard code dependency on them
- **Category**: durability / UX / observability
- **PRD phase**: Phase 4, step 4 (periodic checkpoints; snapshot status and
  failure recovery UX)
- **Planned at**: commit `1d398af`, 2026-07-04

## Why this matters

The PRD: "Long-running mutating runs may checkpoint periodically," and user
story 24/25: "I want snapshot metadata visible in project status, so that I
know whether the workspace has a durable checkpoint" and "I want to know when
a sandbox is restoring, so that I do not start work against a half-restored
filesystem." Plan 040 writes a single final-run checkpoint; plan 041 surfaces
restoring status; plan 042 restores from the latest snapshot. This plan adds
periodic mid-run checkpoints so a long mutating run that is interrupted (Worker
restart, eviction, crash) still leaves a recent durable checkpoint, and adds
honest recovery UX so a failed checkpoint or failed restore shows a stable,
recoverable status instead of a silent gap or an internal error. This is the
polish that makes Phase 4 satisfy the PRD kill metric "More than 2% of
successful mutating runs fail to checkpoint" being observable and recoverable.

## Current state

- `src/lib/flue-run-bridge.ts` — after plan 040, `finishRun` calls
  `checkpointMutatingRun` once on a successful mutating run. The consumer loop
  `consumeFlueStream` (lines ~430–500) iterates Flue stream events in a
  `while (true)` loop, calling `this.ctx.waitUntil(...)` for long-poll batches.
  There is **no periodic checkpoint trigger** mid-loop today. The bridge uses
  `this.ctx.storage` for state and has `setWebSocketAutoResponse("ping",
  "pong")`; it does not currently use Durable Object alarms.
- `src/lib/run-snapshot-checkpoint.ts` — after plan 040, the pure
  `buildSnapshotCheckpointPlan` / `computeWorkspaceDigest` helpers exist and
  are reusable. The `FlueRunBridge.checkpointMutatingRun` method is the live
  checkpoint entry point.
- `src/lib/workspace-policy.ts` — after plan 040, `AGENT_RUN_EVENT_TYPES`
  includes `snapshot_started`, `snapshot_completed`, `snapshot_failed`.
- `src/lib/project-sandbox.ts` — after plan 042, restore marks invalid
  snapshots `failed` and falls back. Failed restore sets
  `projects.status = "failed"`.
- `src/routes/project.$projectId.tsx` and `src/components/ai-chat.tsx` — the
  project workspace route and chat component. After plan 041 the route shows a
  "Restoring workspace…" status. There is no "last checkpoint" indicator and
  no checkpoint/restore failure recovery affordance.
- `src/integrations/trpc/routers/workspace.ts` — `workspace.get` returns project
  status; after plan 041 it returns `restoring` + `latestSnapshotId`. There is
  no `lastCheckpointAt` and no operator/user recovery action for a failed
  restore.
- Repo conventions: Durable Object alarms are set via
  `this.ctx.storage.setAlarm(timestamp)` and handled in `async alarm()`. The
  bridge already uses `this.ctx.waitUntil` for background work. Events are
  inserted via `db.insert(agentRunEvents).values([...])` and broadcast via the
  frame vocabulary. UI status follows the honest/non-functional-while-busy
  pattern established in plan 041.

## Commands you will need

| Purpose    | Command                                      | Expected on success |
|------------|----------------------------------------------|---------------------|
| Typecheck  | `pnpm exec tsc --noEmit --pretty false`      | exit 0, no errors   |
| Unit tests | `pnpm test -- src/lib/flue-run-bridge.test.ts src/lib/run-snapshot-checkpoint.test.ts` | all pass |
| Full tests | `pnpm test`                                  | exit 0              |
| Lint       | `pnpm lint`                                  | exit 0 (only the 2 pre-existing warnings) |
| Flue build | `pnpm flue:build`                            | exit 0 (known DO migration warning only) |
| Whitespace | `git diff --check`                           | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/lib/flue-run-bridge.ts` — add periodic mid-run checkpointing (alarm- or event-count-driven) that reuses `checkpointMutatingRun`; ensure the final checkpoint still runs in `finishRun`
- `src/lib/flue-run-bridge.test.ts` — cover periodic checkpoint trigger and that a periodic checkpoint failure does not kill the run
- `src/lib/workspace-policy.ts` — only if a new event type is needed (e.g. `snapshot_periodic`); otherwise reuse `snapshot_started`/`snapshot_completed`/`snapshot_failed`
- `src/integrations/trpc/routers/workspace.ts` — return `lastCheckpointAt` and a `restoreFailed` flag in `workspace.get`; add a `retryRestore` procedure (operator/user recovery action) that re-runs `ensureProjectSandbox`
- `src/routes/project.$projectId.tsx` — show a "Last checkpoint" timestamp and a recovery affordance when `restoreFailed` is true
- `plans/README.md` — status row

**Out of scope** (do NOT touch):
- `src/lib/project-coordinator.ts` — coordinator state is settled by plan 041
- `src/lib/project-sandbox.ts` restore logic — settled by plan 042 (this plan only adds a `retryRestore` caller, not new restore logic)
- `alchemy.run.ts` bindings — no new bindings needed
- Multi-mutator / worktree concurrency — Phase 6
- Evals / regression suites / richer observability dashboards — Phase 6

## Git workflow

- Branch: `advisor/043-periodic-checkpoints-recovery-ux`
- Commit per logical unit. Conventional Commits style (e.g.
  `feat(durability): periodic checkpoints and restore recovery ux`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Periodic mid-run checkpoint trigger in `FlueRunBridge`

Decide the trigger mechanism (pick the simplest that the installed runtime
supports; verify before implementing):

- **Preferred: Durable Object alarm.** In `start(...)`, after a mutating run is
  admitted and dispatch succeeds, set
  `this.ctx.storage.setAlarm(Date.now() + PERIODIC_CHECKPOINT_INTERVAL_MS)`
  (e.g. 120_000 ms — make it a named constant). Implement
  `async alarm(): Promise<void>` that, if the run is still active and
  `isMutating === true` and not canceled, calls `checkpointMutatingRun(state,
  runId)` (reuse the plan 040 method, but emit `snapshot_started`/
  `snapshot_completed`/`snapshot_failed` events with a `periodic: true` flag in
  the payload so the UI can distinguish final vs periodic), then re-arms the
  alarm if the run is still active. Clear the alarm in `finishRun` /
  `clearCanceledRun` / `failRunAfterDispatchError`.
- **Fallback: event-count trigger.** If alarms are unavailable or awkward in
  this DO setup, checkpoint every N projected `tool_finished` events during
  `consumeFlueStream` (e.g. every 8 tool-finished events), gated on
  `isMutating === true` and not canceled.

Document the chosen mechanism in a one-line comment. The final checkpoint in
`finishRun` (plan 040) stays unchanged and still runs.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 2: Make periodic checkpoint failures non-fatal

Ensure `checkpointMutatingRun` (when invoked periodically) catches all throws,
emits a `snapshot_failed` event with `periodic: true`, and never interrupts
`consumeFlueStream`. A periodic checkpoint failure must not change the run
status or stop the stream. Reuse the plan 040 failure path.

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts` → new cases pass:
periodic checkpoint success inserts a `snapshots` row with `periodic: true`
event metadata; periodic checkpoint failure emits `snapshot_failed` and the run
continues; alarm is cleared on terminal.

### Step 3: Surface `lastCheckpointAt` and `restoreFailed` in `workspace.get`

In `src/integrations/trpc/routers/workspace.ts` `workspace.get`:

- Return `lastCheckpointAt` from the latest `completed` `snapshots` row for the
  project (`orderBy(desc(completedAt))`, `limit(1)`, select `completedAt`).
- Return `restoreFailed: boolean` = `project.status === "failed"` (the existing
  `ensureProjectSandbox` failure marker). Keep the existing `sandboxState`
  union unchanged.

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0.

### Step 4: Add a `retryRestore` procedure

Add `workspace.retryRestore` (`protectedProcedure`, input
`{ projectId: z.string().min(1) }`) that:

1. Loads the project, verifies ownership (`userId`).
2. Flips `projects.status` from `"failed"` back to `"provisioning"` (D1 CAS),
   then calls `ensureProjectSandbox`. This re-runs the plan 042 restore chain
   (latest valid snapshot → legacy backup → GitHub).
3. Returns the same shape `workspace.get` returns (so the UI can refresh).
4. Throws `TRPCError({ code: "PRECONDITION_FAILED" })` if the project is not
   in `"failed"` status (don't retry a healthy project).

This is the PRD's "manual recovery controls for stuck projects" lite (user
scope; full operator controls are out of scope for v1).

**Verify**: `pnpm exec tsc --noEmit --pretty false` → exit 0. Add/extend a
router test if the harness exists; otherwise cover via the
`ensureProjectSandbox` tests in plan 042.

### Step 5: Recovery UX in the project route

In `src/routes/project.$projectId.tsx`:

- When `lastCheckpointAt` is present, show a small "Last checkpoint: <relative
  time>" indicator near the project status (reuse existing date-format
  utilities; no new design tokens).
- When `restoreFailed` is true, show an honest "Workspace restore failed"
  status with a "Retry restore" button that calls `workspace.retryRestore`.
  While retrying, show the same "Restoring workspace…" state from plan 041 and
  disable mutating submit. Keep it minimal and non-blocking for read-only use.

**Verify**: `pnpm exec tsc --noEmit --pretty false` and `pnpm lint` → exit 0.

### Step 6: Final verification

```sh
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

All pass with the known warnings only. Update `plans/README.md` status row.

## Test plan

- Extended `src/lib/flue-run-bridge.test.ts`: periodic checkpoint success
  (alarm or event-count); periodic checkpoint failure is non-fatal and emits
  `snapshot_failed`; alarm cleared on terminal/cancel.
- New/extended router test for `workspace.retryRestore`: a `failed` project is
  retried; a non-`failed` project is rejected with `PRECONDITION_FAILED`.
- Pattern after: `src/lib/flue-run-bridge.test.ts` (fake service binding +
  fake sandbox + driving the consumer loop) and the existing router test
  patterns.

## Done criteria

- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0
- [ ] `pnpm test` exits 0; new tests for periodic checkpoint + retryRestore pass
- [ ] A long mutating run produces periodic checkpoints (alarm- or
      event-count-driven) reusing the plan 040 helper; the final checkpoint in
      `finishRun` still runs (covered by tests)
- [ ] A periodic checkpoint failure does not interrupt the run or change its
      status; it emits `snapshot_failed` with `periodic: true` (covered by tests)
- [ ] `workspace.get` returns `lastCheckpointAt` and `restoreFailed`;
      `workspace.retryRestore` re-runs restore for a `failed` project
- [ ] The UI shows "Last checkpoint" and a "Retry restore" affordance when
      `restoreFailed` is true
- [ ] No files outside the in-scope list are modified
- [ ] `pnpm lint`, `pnpm flue:build`, `git diff --check` pass
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The bridge or checkpoint helper doesn't match the excerpts (drift since
  `1d398af`, or plan 040 landed with a different `checkpointMutatingRun`
  signature — re-read it before wiring periodic calls).
- Durable Object alarms are not available in this runtime / DO setup (verify
  `this.ctx.storage.setAlarm` exists in the installed `cloudflare:workers`
  types) — fall back to the event-count trigger and note the decision.
- `ensureProjectSandbox` cannot be safely re-invoked from `retryRestore`
  because the D1 CAS lock doesn't accept a `failed` → `provisioning`
  transition (verify the CAS `where` clause in `ensureProjectSandbox`) —
  adjust the transition or stop and report.
- A periodic checkpoint would change the run's terminal status (it must not).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The periodic checkpoint interval is a tunable constant; set it conservatively
  (e.g. 120s) to avoid R2 write amplification. The PRD kill metric "% of
  successful mutating runs that fail to checkpoint" should be evaluated with
  both final and periodic checkpoints counted.
- `retryRestore` is the user-facing recovery action; a future operator-level
  recovery control (force-clear lease, force-restore from a specific snapshot)
  is deferred and should be planned separately if support needs it.
- Reviewer should scrutinize: (1) periodic checkpoints never mutate the run
  status; (2) alarms are always cleared on terminal/cancel so a dead run does
  not keep checkpointing; (3) `retryRestore` enforces ownership and only
  retries `failed` projects; (4) the UX is honest about what is non-functional
  while restoring/retrying.
- Deferred to Phase 6: richer observability for checkpoint/restore rates,
  evals, multi-mutator concurrency via worktrees.
