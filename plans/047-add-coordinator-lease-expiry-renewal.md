# Plan 047: Add Project Coordinator Lease Expiry and Renewal

> **Executor instructions**: Execute this as a focused reliability/security
> fix. Run every verification command. Stop if the live coordinator state shape
> has drifted.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat f09866f..HEAD -- src/lib/project-coordinator.ts src/lib/project-coordinator.test.ts src/lib/project-coordinator-sqlite.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-mutating-tools.test.ts .flue/lib/project-mutating-tools.ts src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/integrations/trpc/routers/workspace.ts plans/README.md
> git diff --stat -- src/lib/project-coordinator.ts src/lib/project-coordinator.test.ts src/lib/project-coordinator-sqlite.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-mutating-tools.test.ts .flue/lib/project-mutating-tools.ts src/lib/flue-run-bridge.ts src/lib/flue-run-bridge.test.ts src/integrations/trpc/routers/workspace.ts plans/README.md
> ```

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 038, 039
- **Category**: correctness / security
- **PRD phase**: Previous-phase gap from coordinator responsibilities
- **Planned at**: commit `f09866f`, 2026-07-04
- **Reconciled at**: commit `665a752`, 2026-07-05. Drift check found
  `src/lib/flue-run-bridge.ts` and `src/lib/flue-run-bridge.test.ts`
  changed since `f09866f` (plan 044 landed diff-artifact code). The drift
  is additive — it added `buildRunDiffArtifactEvents` and diff constants
  inside `finishRun`; it did not change `FlueRunBridgeState` (still has
  `activeRunId`, `isMutating`, `fencingToken`, `projectId`),
  `consumeFlueStream`, or the checkpoint path that Step 5 depends on. All
  coordinator and SQLite excerpts remain accurate. Plan is executable
  as written; the executor should expect extra diff-artifact code in
  `flue-run-bridge.ts` that is out of scope.

## Why this matters

The PRD says the Project Coordinator owns lease renewal and expiry, and user
story 40 says stale leases must expire or recover so a crashed run does not
block the project forever. The current coordinator has a fencing token, but no
`expiresAt`, no `/renew`, and no expiry check before rejecting a new mutating
run. A Worker crash or lost terminal event can leave `mutationLease` in
Durable Object SQLite indefinitely, blocking future mutating work even though
D1 stale-lock cleanup exists.

## Current state

- `src/lib/project-coordinator.ts:14` defines `ProjectCoordinatorLease` with
  `projectId`, `runId`, `sessionId`, `userId`, `mode`, `capabilities`,
  `fencingToken`, and `admittedAt`. There is no `expiresAt`.
- `src/lib/project-coordinator.ts:151` rejects any mutating admission when
  `baseState.mutationLease` exists. It does not test whether that lease is
  stale.
- `src/lib/project-coordinator.ts:245` validates project, run, and fencing
  token. It cannot reject expired leases because no expiry exists.
- `src/lib/project-coordinator-sqlite.ts:14` persists the mutation lease row
  without expiry.
- `.flue/lib/project-mutating-tools.ts:76` calls coordinator `/status` before
  each mutation and then uses `validateProjectCoordinatorLease`. This is the
  right enforcement point; after this plan, expired leases must fail here.
- `src/lib/flue-run-bridge.ts` owns active mutating stream consumption and is
  the right place to renew while events are still flowing.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Focused tests | `pnpm test -- src/lib/project-coordinator.test.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-mutating-tools.test.ts src/lib/flue-run-bridge.test.ts` | all pass |
| Full tests | `pnpm test` | all pass |
| Lint | `pnpm lint` | exit 0, only known warnings |
| Flue build | `pnpm flue:build` | exit 0, known warning only |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:
- `src/lib/project-coordinator.ts` — expiry field, pure expiry/renewal
  decisions, `/renew` route.
- `src/lib/project-coordinator-sqlite.ts` — persist `expires_at`.
- Coordinator tests.
- `.flue/lib/project-mutating-tools.ts` — validate expiry before mutating.
- `src/lib/flue-run-bridge.ts` — renew active mutating leases while stream
  consumption progresses.
- `plans/README.md` — status row.

**Out of scope**:
- FIFO mutating queue. The current product decision is reject, not queue.
- Multi-mutator worktrees.
- Operator dashboard controls.
- Changing D1 schema; coordinator expiry is DO-local SQLite state.

## Git workflow

- Branch: `advisor/047-coordinator-lease-expiry-renewal`
- Commit style: `fix(coordinator): expire stale mutation leases`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add expiry to the pure coordinator model

In `ProjectCoordinatorLease`, add:

```ts
expiresAt: string;
```

Add constants:

```ts
export const MUTATION_LEASE_TTL_MS = 5 * 60 * 1000;
export const MUTATION_LEASE_RENEWAL_THRESHOLD_MS = 60 * 1000;
```

When admitting a mutating run, set `expiresAt` to
`new Date(Date.parse(nowIso) + MUTATION_LEASE_TTL_MS).toISOString()`.

Before conflict rejection, if an existing lease is expired at `nowIso`, clear
it and admit the new request. Preserve `nextFencingToken` monotonicity.

**Verify**: `pnpm test -- src/lib/project-coordinator.test.ts` -> new pure
expiry tests pass.

### Step 2: Add renewal

Add a pure function:

```ts
renewProjectCoordinatorLease(state, { projectId, runId, fencingToken }, nowIso)
```

It should:

- Validate project/run/fencing token.
- Reject if the lease is expired.
- Extend `expiresAt` by `MUTATION_LEASE_TTL_MS`.
- Return a decision with status 202 or 409 and message.

Add `POST /renew` to `ProjectCoordinator.fetch`, parsing
`projectId`, `runId`, and `fencingToken`.

**Verify**: `pnpm test -- src/lib/project-coordinator.test.ts` -> renewal
success, stale token, wrong run, and expired lease tests pass.

### Step 3: Persist expiry in coordinator SQLite

Update `mutation_lease` schema creation to include `expires_at TEXT`.

Update `CoordinatorSqlRows`, `coordinatorRowsToState`, and
`coordinatorStateToRows` to round-trip expiry. For older DO rows that lack
`expires_at`, default to an already-expired timestamp so stale legacy leases do
not live forever. Do not drop tables.

**Verify**: `pnpm test -- src/lib/project-coordinator-sqlite.test.ts` -> new
round-trip and legacy-row tests pass.

### Step 4: Enforce expiry in mutating tools

Update `validateProjectCoordinatorLease` to accept a deterministic `nowIso`
parameter or read current time in a wrapper. The Flue mutating tools must reject
an expired lease before `writeFile`, `replace_text`, or mutating command
execution.

Extend `src/lib/project-mutating-tools.test.ts` with an expired lease state and
assert `write_file` rejects before `sandbox.writeFile`.

**Verify**: `pnpm test -- src/lib/project-mutating-tools.test.ts` -> pass.

### Step 5: Renew from `FlueRunBridge`

In `src/lib/flue-run-bridge.ts`, add a private `renewMutatingLeaseIfNeeded`
that:

- Runs only when `state.isMutating === true`, `state.projectId`,
  `state.activeRunId`, and `state.fencingToken` exist.
- Calls coordinator `/renew` with project/run/fencing token.
- Treats 409 as terminal failure for the run: insert a redacted `error` event
  and call `finishRun(runId, "failed")` or fail before the next mutation can
  proceed.
- Does not renew more often than the threshold to avoid request spam. Store a
  `lastLeaseRenewedAt?: string` in `FlueRunBridgeState`, or use the lease
  `expiresAt` returned by `/renew`.

Call it after receiving Flue stream events and before periodic checkpoints. Do
not renew read-only runs.

**Verify**: `pnpm test -- src/lib/flue-run-bridge.test.ts` -> new tests cover
renewal and renewal rejection.

### Step 6: Final verification

Run:

```sh
pnpm exec tsc --noEmit --pretty false
pnpm test -- src/lib/project-coordinator.test.ts src/lib/project-coordinator-sqlite.test.ts src/lib/project-mutating-tools.test.ts src/lib/flue-run-bridge.test.ts
pnpm test
pnpm lint
pnpm flue:build
git diff --check
```

## Test plan

- Coordinator pure tests:
  - admission sets `expiresAt`.
  - expired active lease is cleared before new admission.
  - non-expired lease still rejects second mutating admission.
  - renew extends expiry for matching run/token only.
- SQLite tests:
  - `expires_at` round-trips.
  - legacy missing expiry is treated as expired.
- Tool tests:
  - expired lease rejects before mutation.
- Bridge tests:
  - active mutating stream renews.
  - renewal 409 fails the run without granting further mutation.

## Done criteria

- [ ] Mutation leases have `expiresAt`.
- [ ] Stale mutation leases no longer block admission forever.
- [ ] Active mutating runs renew leases while making progress.
- [ ] Mutating tools reject expired leases before mutation.
- [ ] Verification commands pass.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Adding `expires_at` to DO SQLite requires a destructive migration.
- FlueRunBridge cannot renew without risking recursive terminal handling.
- Existing tests imply leases are intentionally non-expiring.
- The change requires D1 schema migrations.
- Verification fails twice after a reasonable fix attempt.

## Maintenance notes

This plan intentionally does not add FIFO queueing. It makes the current
reject-on-conflict policy recoverable. Future queue work must use the same
expiry semantics.
