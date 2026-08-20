# Add capacity, preview checkpointing, and idle lifecycle

Status: TODO

Written against commit `62c99b4`. Complete plans 006 and 010 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in runtime, preview, agent messages, Alchemy, and
server entrypoint code. Stop if limits or queue behavior changed.

## Goal

Finish the `WorkspaceRuntime` module with durable capacity work, queue recovery,
preview checkpoint deferral, ten-minute idle shutdown, archive, and deletion.
Keep one stable preview capability URL for each active workspace session.

## Current state

The current Worker provisions a project sandbox synchronously before it creates
messages. Preview code owns a project-level D1 lease and one of 32 ports inside
the shared sandbox. There is no persisted runtime work queue or global capacity
accounting.

`alchemy.run.ts` currently configures one `lite` instance. The approved spec
requires 20 global and two per-user running workspace sandboxes on a `basic`
instance, with a 15-minute maximum queue time.

## Files in scope

- `apps/web/src/db/schema.ts`, migration, and Drizzle metadata
- `apps/web/src/lib/workspace-runtime.ts` and tests
- a new durable runtime-work or capacity module only if it remains internal to
  the `WorkspaceRuntime` implementation
- `apps/web/src/lib/workspace-recovery.ts` and tests
- `apps/web/src/lib/session-preview.ts` and tests
- `apps/web/src/server.ts` and tests
- `apps/web/src/lib/agent-run-service.ts` and tests
- `apps/web/src/routes/api.agent.stream.ts` and tests
- workspace and preview tRPC routers and tests
- Composer, workspace status, and preview pane UI and tests
- `alchemy.run.ts`
- affected architecture, security, and product docs

Do not drop legacy columns or tables yet. Plan 012 performs final removal.

## Durable work interface

Keep `WorkspaceRuntime` as the external seam. Callers submit a serializable work
intent and receive a receipt. They do not call queue, lease, or lifecycle
helpers directly.

Supported intents include agent run, Git mutation, preview start, recovery
retry, archive, and destruction. Store only identifiers and validated bounded
input in a work row. Do not store `Request`, `Response`, `Error`, functions,
streams, or class instances.

Persist:

- FIFO sequence and creation time
- identity, session, user, and intent
- `queued`, `leased`, `running`, `complete`, `failed`, or `cancelled`
- lease token and expiry
- retry count and reason code
- queue expiry
- linked message IDs for agent work

## Queue and capacity behavior

1. On a first message, atomically create the workspace session, complete user
   message, pending assistant message, runtime work row, and queue record when
   capacity is unavailable.
2. Acquire capacity with one D1 compare-and-set operation that enforces both 20
   global and two per-user unexpired running leases.
3. Use FIFO order among eligible work. A cancelled or expired item cannot block
   later work.
4. Trigger a drain after enqueue, slot release, runtime observation change, and
   retry. Add a one-minute Alchemy cron as a restart-safe fallback. Keep Alchemy
   as the only deployment owner.
5. Add `scheduled()` to `apps/web/src/server.ts`. Await or track every drain
   promise. Leases make overlapping cron invocations harmless.
6. On 15-minute expiry, mark the assistant message failed with a retryable
   capacity reason. Keep the session and user message.
7. Cancellation marks pending assistant messages failed and releases any lease
   that the work still owns.
8. Immediate-capacity agent runs keep current SSE streaming. Queued runs persist
   the same final message and tool parts even if no browser request remains
   attached. The UI polls durable work state and message data.
9. Set the container to `basic`, `maxInstances: 20`, and `sleepAfter` equivalent
   to ten minutes. Verify current Alchemy and Sandbox types before editing.

Cloudflare cron invocations have a 15-minute wall-time limit. The agent command
limit remains ten minutes. A cron worker must process only work whose remaining
deadline fits the invocation; otherwise it leases fewer items and lets the next
drain continue.

Platform references:

- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/containers/platform-details/limits/

## Preview and checkpoint behavior

1. One session sandbox uses one fixed preview port. Remove the project-wide
   32-port allocator and project preview lease.
2. Keep the existing stable capability URL. Reapply `exposePort()` after a cold
   restore so forwarding targets the new runtime.
3. Record recent preview traffic as runtime observation in trusted Sandbox
   Durable Object storage. Do not write D1 on every preview request.
4. When a mutation settles during a live preview, reserve the generation, mark
   it pending, and start the first-pending timer. Later mutations update the
   pending generation without resetting the timer.
5. Show a persistent backup-pending warning. Do not report the pending
   generation as durable.
6. After ten minutes, stop the preview process, checkpoint, and restart it only
   when trusted observation records recent traffic. Show a workspace-saving
   state during the interruption.
7. On user Stop, stop the process first. If recovery is pending, checkpoint
   before completing Stop.
8. If that checkpoint fails, keep preview stopped and show separate Retry
   Backup and Restart Preview actions.
9. Treat preview-created filesystem changes as disposable. Tests must prove
   that a preview process cannot cause its own changes to be promised as a
   durable agent generation.

Use the existing preview pane alert area and workspace status UI. Do not create
a new dashboard or modal flow.

## Idle, archive, and deletion

- A sleeping runtime owns no running capacity lease.
- A live preview with pending recovery remains active until the forced
  checkpoint settles.
- Archive requires a final checkpoint, revokes preview forwarding, retires the
  runtime identity, and preserves the final recovery archive.
- Continuing archived work creates a new workspace session, branch, identity,
  and recovery lineage from the final archive.
- Deletion first tombstones product and identity records, closes operations,
  cancels work, revokes preview URLs, destroys and retires sandboxes, then
  schedules R2 deletion. Permanent identity tombstones survive project-row
  deletion.

## Tests

Cover:

- global and per-user capacity races
- FIFO order, cancellation, queue expiry, lease expiry, and cron restart
- queued first-message rows are atomic and assistant messages always settle
- no duplicate agent run after overlapping drain invocations
- sleeping runtime releases capacity and cold demand restores before work
- preview pending generation, coalescing, forced checkpoint, recent-traffic
  restart, and failed checkpoint actions
- stable preview URL after cold restore and URL revocation after archive/delete
- archive blocks on degraded recovery
- deletion revokes authority before storage cleanup and keeps a permanent
  identity tombstone
- all async cleanup is awaited, returned, or attached to the execution context

## Verification

```bash
pnpm db:generate
pnpm --filter @ditto/web test -- src/lib/workspace-runtime.test.ts src/lib/workspace-recovery.test.ts src/lib/session-preview.test.ts src/lib/agent-run-service.test.ts src/routes/api.agent.stream.test.ts src/components/session-preview-pane.test.tsx
pnpm typecheck
pnpm build
pnpm verify
```

Run a local capacity test with more than two sessions for one user and more than
20 synthetic users. Restart the local Worker while items are queued. Expected
result: limits hold, order survives, and every assistant message becomes
complete or failed.

## Done criteria

- D1 queue and capacity leases survive Worker restarts.
- The first message and pending assistant are durable before queueing.
- Sleeping runtimes do not consume capacity.
- Preview deferral never exceeds ten minutes without an attempted checkpoint.
- Archive and deletion preserve or intentionally delete recovery state in the
  specified order.

## Maintenance note

Change capacity, queue, idle, and checkpoint timers through named deployment
configuration with state-machine tests. Do not add route-local timeouts or
capacity counters.

## Stop conditions

- If cron work can exceed the platform's 15-minute invocation limit, stop and
  split the durable work or use a separately approved Workflow design.
- If immediate and queued agent execution use different message-settlement
  logic, stop and route both through the same implementation.
- If preview traffic observation requires putting the public URL or token in
  logs or D1, stop and keep the observation inside the trusted Sandbox object.
