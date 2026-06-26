# D1-Compatible startRun Atomic Write Fix PRD

**Owner:** Ayan
**Status:** Draft
**Date:** 2026-06-26

## 1. Overview

Replace the unsupported D1 `db.transaction(...)` usage in `workspace.startRun` with a D1-compatible flow that preserves atomic creation of run-related records, keeps the single-editor lock semantics, and eliminates the local `Failed query: begin params:` failure.

This change is a focused backend reliability fix for the existing project/session/run model. It does not redesign multi-agent coordination beyond the current rule that many agents may read concurrently but only one mutating agent may edit a project at a time.

## 2. Problem Statement

`workspace.startRun` in `src/integrations/trpc/router.ts` currently uses Drizzle's `db.transaction(...)` against Cloudflare D1. In the Worker runtime, Drizzle's D1 transaction implementation issues SQL `begin` / `commit`, which Cloudflare D1 rejects.

As a result, sending a message from the composer fails before the app's actual run-creation logic executes, surfacing a raw low-level error to the user.

The current flow also relies on the transaction for cleanup guarantees across:
- project lock acquisition
- optional session creation
- run creation
- initial event insertion

Without a D1-compatible replacement, the product cannot reliably start runs in local or deployed D1-backed environments.

## 3. Goals

1. Make `workspace.startRun` work on Cloudflare D1 without using unsupported SQL transactions.
2. Preserve the current concurrency rule: many readers, one mutating editor per project.
3. Preserve atomic creation of the initial session/run/event write set so partial junk rows are not persisted when one statement fails.
4. Keep the change small and local to the existing router/database flow.
5. Replace raw database error leakage with stable application-level failures.

## 4. Non-Goals

- Supporting multiple simultaneous mutating agents in the same project.
- Introducing worktree-based mutating concurrency.
- Moving lock coordination to a Durable Object in this fix.
- Adding a new repository or data-access abstraction layer.
- Building a large D1/tRPC integration test harness.

## 5. Current Runtime Findings

- The app uses Cloudflare D1 through Drizzle in `src/db/index.ts`.
- `workspace.startRun` currently wraps the send flow in `db.transaction(...)`.
- Drizzle's D1 driver exposes `db.batch(...)`, which maps to D1's supported batch API.
- D1 does not support explicit SQL `BEGIN` / `COMMIT` in this runtime.
- D1's supported batch primitive is suitable for atomic execution of a predeclared SQL write set, but it does not replace full transaction semantics around arbitrary JavaScript logic.

## 6. Proposed Approach

Use a two-phase flow inside `workspace.startRun`:

1. Acquire the mutating-agent lock with a single conditional project update.
2. Create the dependent records with Drizzle `db.batch(...)` so the run/session/event write set is atomic on D1.

This separates concurrency control from atomic row creation.

The lock step remains outside the batch because it is about who is allowed to become the single editor. The batch step handles the part where related rows should either all exist together or not exist at all.

## 7. Functional Requirements

### 7.1 Transaction removal
- `workspace.startRun` must no longer call `db.transaction(...)`.

### 7.2 Locking model
- Mutating runs must still enforce only one active editor per project.
- Read-only concurrency must remain possible for future non-mutating runs.
- Lock release on error must only clear the lock when the same run still owns it.

### 7.3 Atomic creation path
- New session path must atomically create:
  - `workspace_sessions`
  - `agent_runs`
  - initial `agent_run_events`
- Existing session path must atomically create:
  - `agent_runs`
  - any required session timestamp update
  - initial `agent_run_events`
- If one statement in the batch fails, none of the batched rows should persist.

### 7.4 Error handling
- Users must not see raw `Failed query: begin params:` messages.
- Conflicts for concurrent mutating runs must continue to surface as a stable app-level conflict error.
- Unexpected failures should surface as a stable start-run failure.

## 8. Architecture

### 8.1 Lock acquisition

Use one conditional `UPDATE ... WHERE ... RETURNING` statement on the `projects` row to acquire the mutating lease.

Representative SQL shape:

```sql
UPDATE projects
SET
  activeAgentRunId = :runId,
  activeAgentRunStartedAt = unixepoch(),
  updated_at = unixepoch()
WHERE
  id = :projectId
  AND userId = :userId
  AND activeAgentRunId IS NULL
RETURNING *;
```

Success means the caller owns the edit lock. Failure means another mutating run already holds it.

This step should stay a single atomic statement to avoid a read-then-write race.

### 8.2 Batched write set

After lock acquisition succeeds, create the related records through Drizzle `db.batch(...)`.

Important rules:
- pre-generate `runId`
- pre-generate `sessionId` when creating a new session
- only include SQL statements with a fully known write set
- do not depend on unsupported transaction behavior across arbitrary JS branching

Representative new-session batch contents:
- insert `workspace_sessions`
- insert `agent_runs`
- insert initial user/system `agent_run_events`

Representative existing-session batch contents:
- insert `agent_runs`
- update `workspace_sessions.updatedAt` if still required
- insert initial user/system `agent_run_events`

### 8.3 Failure cleanup

If lock acquisition succeeds but the later batched write step fails, attempt to release the project lock with an ownership check.

Representative SQL shape:

```sql
UPDATE projects
SET
  activeAgentRunId = NULL,
  activeAgentRunStartedAt = NULL,
  updated_at = unixepoch()
WHERE
  id = :projectId
  AND activeAgentRunId = :runId;
```

This prevents one failed request from clearing a lock that has already been replaced by a newer run.

## 9. Why This Fix Is Appropriate

- It removes the unsupported D1 transaction primitive causing the current composer failure.
- It keeps the important no-partial-write guarantee for initial record creation.
- It preserves the current many-readers / one-editor product rule.
- It stays local to the existing tRPC router and D1 usage pattern.
- It remains compatible with a future upgrade to a Durable Object-based lock coordinator if contention or lifecycle complexity grows.

## 10. Limitations

This fix does not create a full general-purpose transaction boundary around all logic in `startRun`.

Specifically:
- lock acquisition and batched row creation remain separate phases
- arbitrary JavaScript work between database operations is not made transactional
- this does not solve future worktree or multi-editor coordination

That limitation is acceptable for this change because the initial row-creation set remains atomic and the lock can be safely released on failure.

## 11. Files In Scope

- Modify: `src/integrations/trpc/router.ts`
- Possibly modify: `src/lib/workspace-policy.ts`
- Possibly modify: `src/lib/workspace-policy.test.ts`

## 12. Acceptance Criteria

1. Sending a message from the composer no longer throws `Failed query: begin params:` on local D1.
2. `workspace.startRun` no longer uses `db.transaction(...)`.
3. Starting a run with a new session persists either all required initial rows or none of them.
4. Starting a run in an existing session persists either all required initial rows or none of them.
5. A concurrent second mutating request for the same project still returns the existing conflict behavior.
6. If batched writes fail after lock acquisition, the project lock is cleared only when owned by the failed run.
7. Existing read-only behavior is unchanged.
8. The user sees an application-level error instead of a raw Drizzle query error.

## 13. Verification

### Manual verification
- Send a message in a project with no existing session.
- Send a message in an existing session.
- Attempt two overlapping mutating sends against the same project and confirm conflict behavior.

### Code verification
- Confirm `workspace.startRun` uses Drizzle `db.batch(...)` rather than `db.transaction(...)`.
- If any pure helper is added for lock ownership or stale-lock policy, cover it with focused tests in `src/lib/workspace-policy.test.ts`.

### Explicit non-requirement
- Do not add a broad new D1/tRPC integration harness as part of this fix.

## 14. Open Questions

- Should this fix also introduce stale-lock reclaim behavior, or should it stay minimal and preserve the current lock semantics?
- Should batch failures produce a generic error message, or should the app distinguish between validation, conflict, and internal persistence failures more clearly?
- Should the lock timestamp later evolve into a heartbeat/lease timestamp for stronger crash recovery?

## 15. Next Step

Use this PRD to implement a D1-compatible rewrite of `workspace.startRun` that replaces `db.transaction(...)` with a conditional lock step plus Drizzle `db.batch(...)` for atomic initial writes.
