# 012: Publish initial and later paired checkpoints

Status: BLOCKED on 011. Base: `bcce03e`. Phase: L4.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.4, 4, 10–11, 14–15, 17; PD20–PD24; reference prerequisites for PD35, whose GC evidence belongs to 017; OD3–OD6.

## Outcome

The runtime publishes an immutable manifest only after a workspace archive and matching encrypted conversation/document content both exist and verify. Establish an initial pair after seed restore and branch synchronization, before the first agent mutation. A completed assistant stays complete if backup fails.

This plan proves publication, not old-generation retirement or restore. Keep retained-user enablement disabled until the complete L4 gate passes, even if the initial-baseline subgate succeeds here.

## Current state and scope

`apps/web/src/lib/workspace-recovery.ts` currently returns separate recovery status:

```ts
export type RecoveryState = {
	state: WorkspaceRecoveryStateName;
	reasonCode: string | null;
	mutationGeneration: number;
	durableGeneration: number;
	pending: boolean;
	/** False when a checkpoint is already running and this mutation coalesced. */
	shouldCheckpoint: boolean;
};
```

Its filesystem checkpoint is not a conversation pair. `apps/runtime/src/journal.ts` has projection intent and non-rewindable effect records worth preserving. Use 005's exact history/reference storage and 011's verified artifact interface, not a second continuation blob reconstructed from product messages.

Scope: runtime checkpoint state/publication and recovery adapter, product archive/recovery projections, initial seed-to-workspace sequence, focused tests. No per-tool archive requirement, whole-coordinator rollback, seed fallback after mutation, preview feature redesign or legacy import.

## Steps and verification

1. Refresh the plan against actual L3/L4 interfaces. Define immutable manifest fields: archive and encrypted content references/digests, committed conversation position/generation and required document state, compatibility versions, mutation generation, executor incarnation and outstanding-effect disposition. Structural identifiers may be queryable; private context must remain encrypted. Prepared content is never selected as a usable pair.
   Run `pnpm --filter @ditto/runtime typecheck` and `pnpm contracts:verify` if shared projections change.
2. Implement the initial baseline sequence under exclusive mutation ownership: restore seed, synchronize the owned branch through the already-guarded product mint-and-fetch policy, account for writers, capture matching files/context, and verify both. Baseline Git must use the narrow branch-sync operation supplied by 011's execution/privileged-access integration; it cannot wait for 014's broader UI Git wiring or send credentials to the runtime/sandbox. Stop if that policy is unavailable. In one runtime SQLite transaction, commit the immutable manifest, move current to previous, set current to the verified pair, and insert the local pending D1 projection intent. Apply D1 later through idempotent retries, never a cross-store transaction. Deny first agent mutation until this commit exists. Unknown external effects or unresolved writers prevent publication.
   Add `apps/runtime/src/pi-durable-checkpoints.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-checkpoints.test.ts`. Submit through command fixtures and assert no mutating dispatch before the baseline.
3. Capture later pairs at acknowledged quiescent run or Git mutation boundaries. Initially reject/defer when preview is active until 014 supplies proven quiescence. Keep current and previous successful pairs. Each recovery execution suboperation is individually admitted; avoid deadlock from recursively calling the runtime while holding its mutation scope.
   Same command. Test a concurrent tool/Git request, stale epoch after upload, writer uncertainty and duplicate publication acknowledgment.
4. Inject crashes before/after artifact creation, verification, manifest+projection commit and D1 application. Before commit, artifacts cannot restore; after commit, retries cannot produce a mixed pair. If backup fails after model success, preserve the completed assistant and show degraded recovery health. If D1 application fails after local pair commit, the pair stays published and projection lag remains visible; do not undo the pair or mark the assistant failed. Retry only still-valid prepared publication, never completed effects. Add reference protection tests for both retained pairs.
   Same command plus `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-projection.test.ts`.
5. Record `plans/evidence/012-paired-publication.md`, with per-crash-point results and an explicit initial-baseline verdict. Run `pnpm runtime:verify`, `pnpm verify`, and the existing `workspace-recovery.test.ts`/`sandbox-archive.test.ts` suites for reused code.

## Done, stops and maintenance

All publication crash cases pass using actual DO storage; the genuine local archive path produces a verified pair. Pair publication and pending projection are one local decision, not separate successful promises. Any current/previous pointer update preserves prior usable evidence.

Stop if Pi cannot expose the required exact conversation/document position or if quiescence cannot be established. Do not label a files-only archive a baseline. Refresh this conditional plan before implementation. No reset, deployment, real external requests, staging or commit. Future schema/engine upgrades must preserve the compatibility and decryptability of both retained pairs.
