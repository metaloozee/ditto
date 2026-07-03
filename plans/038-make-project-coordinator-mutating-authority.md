# 038 - Make ProjectCoordinator the Mutating Run Authority

## Summary

- Priority: P1
- Effort: M
- Risk: High
- Category: architecture / concurrency
- PRD phase: Phase 3, step 1
- Depends on: 035, 037
- Planned at: `c7cdcba`
- Status: TODO

The PRD says `ProjectCoordinator` is the live authority for project-level run admission and the single mutating lease. The current Phase 2 implementation uses the coordinator for read-only Flue runs, but mutating runs still use the legacy `projects.activeAgentRunId` check and `WorkspaceSessionBroker`. Before adding mutating Flue tools, mutating admission and terminal release need to flow through the coordinator and update the D1 lock projection.

## Evidence

- `src/integrations/trpc/routers/workspace.ts` branches on `input.isMutating`.
- In the mutating branch, it still uses `projects.activeAgentRunId` and starts `WorkspaceSessionBroker`.
- The read-only branch already calls `ProjectCoordinator /admit`, then starts `FlueRunBridge`.
- `src/lib/project-coordinator.ts` already has `mode: "mutating" | "read_only"` and returns a `fencingToken` for mutating admission.
- `src/db/schema.ts` already has `projects.lockStatus`, `lockHolderRunId`, `lockFencingToken`, and `lockUpdatedAt`.
- `WorkspaceSessionBroker` does not currently notify `ProjectCoordinator /terminal` when legacy mutating runs finish.

## Goal

Route mutating run admission through `ProjectCoordinator`, persist the coordinator's mutating lease to the D1 project lock projection, and release the lease from terminal/cancel paths while keeping the legacy broker as the execution engine until plan 039.

## Non-Goals

- Do not add Flue mutating tools in this plan.
- Do not remove `WorkspaceSessionBroker`.
- Do not build a UI lock indicator.
- Do not implement a queue unless it is already required by existing coordinator behavior.
- Do not change the public `workspace.startRun` input or response shape except to include an internal fencing token if an existing contract helper already models it.

## Implementation Steps

1. Add a small D1 lock projection helper.
   - Prefer a pure helper in `src/lib/project-lock-projection.ts` or a local helper in `workspace.ts` if the logic is very small.
   - It should produce Drizzle update values for:
     - acquiring a mutating lock: `lockStatus = "mutating"`, `lockHolderRunId = runId`, `lockFencingToken = fencingToken`, `lockUpdatedAt = now`
     - clearing a lock: null holder/token and an idle/none status that matches the existing schema values
   - Add pure tests if extracted to `src/lib`.

2. Update mutating `workspace.startRun` admission.
   - Keep the existing project/session/message/run row creation behavior.
   - After creating the run row, call `ProjectCoordinator /admit` with:
     - `projectId`
     - `sessionId`
     - `runId`
     - `userId`
     - `mode: "mutating"`
   - If admission rejects, mark the run failed or canceled consistently with existing conflict behavior, insert an error/done event if the run row was already created, and return a conflict error to the client.
   - If admission accepts, update `projects` with the mutating lock projection and keep `activeAgentRunId` populated for backward compatibility with existing UI queries.
   - Pass the `fencingToken` into the legacy broker start body if the broker `StartRequest` can accept an optional field cleanly. It is acceptable for the broker to store but not enforce it in this plan.

3. Notify the coordinator from legacy broker terminal paths.
   - Update `src/lib/workspace-session-broker.ts`.
   - When a mutating run reaches completed, failed, or canceled, call `ProjectCoordinator /terminal` with `projectId`, `runId`, and status.
   - Clear the D1 lock projection at the same point the broker clears `activeAgentRunId`.
   - Preserve existing late-event and cancellation handling.

4. Keep read-only behavior intact.
   - The read-only Flue path should still call the coordinator as it does today.
   - Do not route read-only runs through the legacy broker.

5. Add or update tests.
   - Extend `src/lib/project-coordinator.test.ts` only if a coordinator decision gap is found.
   - Add pure lock projection tests if Step 1 extracts a helper.
   - Extend any existing workspace/broker tests to assert terminal notification payloads when feasible.
   - Update `src/lib/project-agent-run-contract.test.ts` if the existing contract helper is the lowest-friction way to assert that mutating admission forwards `fencingToken`.

6. Expose lock projection fields on project reads if currently omitted.
   - Check `src/integrations/trpc/routers/projects.ts`.
   - Include `lockStatus`, `lockHolderRunId`, `lockFencingToken`, and `lockUpdatedAt` in server-side selection/output only if the fields are missing.
   - Do not build UI around them in this plan.

## Tests

Run:

```sh
pnpm test -- src/lib/project-coordinator.test.ts src/lib/project-agent-run-contract.test.ts
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

## STOP Conditions

- If mutating admission cannot be added without changing the `workspace.startRun` public contract, stop and document the required product/API decision.
- If the broker cannot call `ProjectCoordinator` without adding a new binding, stop and update `alchemy.run.ts` plus tests deliberately. Do not silently skip terminal release.
- If D1 lock projection values do not have a clear enum/status mapping in the current schema, stop and choose the smallest additive representation before writing data.

## Acceptance Criteria

- Mutating `workspace.startRun` calls `ProjectCoordinator /admit` before starting execution.
- Mutating admission persists the D1 lock projection with the coordinator's fencing token.
- Mutating terminal/cancel paths call `ProjectCoordinator /terminal` and clear the D1 lock projection.
- Existing read-only Flue admission remains unchanged.
- Verification commands pass.
