# 037 - Resume Flue Streams and Fix Flue Run Pointers

## Summary

- Priority: P1
- Effort: M
- Risk: Medium
- Category: correctness / durability
- PRD phase: Phase 3 prerequisite
- Depends on: 035
- Planned at: `c7cdcba`
- Status: TODO

The PRD says UI reconnect must not lose run state, and Flue plus D1 are the canonical durable sources. The current `FlueRunBridge` stores stream offset/cursor in Durable Object storage, but it only starts the consumer loop from `/start`. If the DO restarts after dispatch, a reconnecting socket can receive a snapshot while no code resumes long-polling Flue. Also, the run projection helper treats a Flue pointer as invalid unless `flueSubmissionId` exists, even though the Phase 2 adapter explicitly allows `submissionId: null`.

## Evidence

- `src/lib/flue-run-bridge.ts` calls `this.ctx.waitUntil(this.consumeFlueStream(input.runId))` inside `start(...)`.
- `src/lib/flue-run-bridge.ts` `acceptSocket(...)` sends a snapshot but does not schedule stream consumption.
- `src/lib/flue-run-bridge.ts` `applyFlueStreamCursor(...)` stores `streamOffset`, `streamCursor`, and `streamClosed` in DO storage.
- `src/lib/flue-dispatch-adapter.ts` returns `submissionId: string | null`.
- `src/lib/project-run-projection.ts` `hasFluePointer(...)` currently requires both `flueAgentInstanceId` and `flueSubmissionId`.

## Goal

Make active Flue read-only runs resumable from durable stream coordinates after DO restart or browser reconnect, and make product projections correctly represent Flue runs that have stream coordinates but no `submissionId`.

## Non-Goals

- Do not add full assistant-delta replay from Flue into D1 mid-stream. This plan makes the consumer restartable; richer replay can be a later UX improvement.
- Do not add mutating Flue tools.
- Do not replace Flue durable streams with a custom stream format.
- Do not change the public tRPC response shape unless existing types force a nullable `submissionId` fix.

## Implementation Steps

1. Add a pure resume predicate.
   - In `src/lib/flue-run-bridge.ts`, export:

   ```ts
   export function shouldResumeFlueStream(state: FlueRunBridgeState): state is FlueRunBridgeState & {
     activeRunId: string;
     flueAgentName: string;
     flueAgentInstanceId: string;
   };
   ```

   - Return true only when:
     - `activeRunId` exists
     - `flueAgentName` exists
     - `flueAgentInstanceId` exists
     - `streamClosed !== true`
     - the run is not in `canceledRunIds`

2. Prevent duplicate consumers in one DO instance.
   - Add an in-memory field such as `private consumingRunId: string | null = null`.
   - Add a private `resumeFlueStreamIfNeeded(reason: "constructor" | "socket" | "start")` helper.
   - The helper reads state, checks `shouldResumeFlueStream`, skips if `consumingRunId === activeRunId`, then starts `ctx.waitUntil(...)`.
   - Wrap `consumeFlueStream(...)` in a `finally` that clears `consumingRunId` only if it still matches the run.

3. Schedule resume from reconnect and restored WebSockets.
   - In the constructor, after restoring hibernated WebSockets, call the helper through `this.ctx.waitUntil(...)` or another safe async boundary. Do not block construction on storage reads.
   - In `acceptSocket(...)`, send the snapshot as today, then call `resumeFlueStreamIfNeeded("socket")`.
   - Keep `/start` scheduling through the same helper after dispatch succeeds.

4. Persist latest stream offset to D1.
   - After every successful poll and `applyFlueStreamCursor(...)`, update `agent_runs.flueStreamOffset` with `pollResult.nextOffset`.
   - Keep this update small and idempotent. It is acceptable to write only when `nextOffset` changed.
   - This makes D1 projections reflect the last durable stream coordinate, not just the dispatch receipt offset.

5. Fix Flue pointer projection.
   - Update `src/lib/project-run-projection.ts`.
   - `hasFluePointer(...)` should require `flueAgentName` and `flueAgentInstanceId`, then accept either `flueSubmissionId` or `flueStreamOffset`.
   - Change `ProjectRunProjection["flue"].submissionId` to `string | null`, or otherwise preserve nullability without inventing a fake id.
   - Update `src/lib/project-run-projection.test.ts` for:
     - Flue pointer with stream offset but null submission id
     - no pointer when agent name/instance id is missing

6. Add bridge tests.
   - Extend `src/lib/flue-run-bridge.test.ts` for:
     - `shouldResumeFlueStream` true/false cases
     - duplicate consumer guard, if the existing test harness can observe it without brittle internals
     - offset persistence after poll, if the existing D1 fake can assert the update

## Tests

Run:

```sh
pnpm test -- src/lib/flue-run-bridge.test.ts src/lib/project-run-projection.test.ts
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
pnpm flue:build
git diff --check
```

## STOP Conditions

- If Durable Object constructors cannot safely call `ctx.waitUntil(...)` in the installed Workers runtime types, do not force it. Move resume scheduling to the first `fetch(...)` and `acceptSocket(...)`, then document the constructor limitation.
- If D1 offset updates inside the hot poll loop make tests brittle, extract a small helper and test the helper. Do not remove D1 offset persistence entirely.
- If fixing projection nullability cascades into public API breakage, stop and document the exact consumers before changing the external response contract.

## Acceptance Criteria

- A live Flue read-only run can resume stream consumption after a DO restart or WebSocket reconnect path.
- Duplicate stream consumers for the same active run are guarded in one DO instance.
- D1 `agent_runs.flueStreamOffset` advances after stream polls.
- `buildRunProjection(...)` correctly exposes Flue pointers when `submissionId` is null but stream coordinates exist.
- Verification commands pass.
