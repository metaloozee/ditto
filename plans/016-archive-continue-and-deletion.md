# 016: Finish archive, continuation and deletion fences

Status: BLOCKED on 015. Base: `bcce03e`. Phase: L5.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.4, 5, 8–9, 11, 14–16; PD14, PD24, PD27, PD34, PD40; OD4–OD6.

## Outcome

Archiving requires stopped or isolated execution, a final committed pair and revoked preview authority. Continuing archived work creates a new workspace session, branch, runtime/executor identities and recovery lineage. It must not resume old pending tasks.

Project deletion first revokes authority and ordinary admission, then cancels work, revokes preview, accounts for/terminates execution and schedules retryable content cleanup. Minimal non-secret retirement/deletion fences survive content removal. A late command, artifact or projection cannot recreate deleted records.

## Current state and scope

`apps/web/src/lib/workspace-session.ts` currently performs a plain product status update:

```ts
await options.db
	.update(workspaceSessions)
	.set({ status: "archived" })
```

That is not enough for the target archive contract. `apps/web/src/lib/workspace-runtime.ts:1246–1311` currently continues by copying archive references into a new session with `branchName: null`. Replace that orchestration with explicit new-branch/context setup and reference protection. The schema retains sandbox identity IDs without a foreign key because tombstones must survive deletion. Reuse that intent; do not cascade away authority fences.

The active archive/deletion paths also live in `apps/web/src/lib/session-preview.ts:1151–1439`, `archiveSessionWithPreviewCleanup` and `deleteProjectRuntime`, called by the product routers and `workspace-runtime.ts:1071–1100`. Rerouting only `archiveOwnedActiveSession` leaves a bypass. Replace/fence every candidate-owned entry to these paths; keep old-owner branches isolated until retirement.

Scope: owned workspace lifecycle handlers, runtime archive/continue transitions, project deletion orchestration, product schema/fences and focused tests. Project deletion remains an owned project operation, not a synthetic workspace command. No actual project removal or production cleanup is authorized by this plan.

## Steps and checks

1. Refresh runtime lifecycle and pair interfaces from L4. Route archive through the current runtime owner and enforce final-pair, writer and preview preconditions. History reads remain passive. If final capture fails, preserve completed assistant success and expose archive/recovery failure rather than falsely marking the session archived.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/workspace-session.test.ts src/lib/workspace-recovery.test.ts src/lib/session-preview.test.ts`; add `apps/runtime/src/pi-durable-lifecycle.test.ts` and run it with the runtime pool.
2. Continue an archived pair into new owned IDs and a new branch/recovery lineage. Initialize context using the proven L4 generation recipe without reusing old task/inbox execution authority. Keep original history/pair references intact in the source lineage. The destination starts with one newly committed initial manifest and `previous` unset, not a copied `previousArchiveId`. Immutable workspace archive bytes may be shared with explicit reference protection. Conversation content must be copied through authorized archived-state access and re-encrypted under the destination workspace/record AAD from 004, not reused as ciphertext bound to the source session. Copy no runnable tasks, inbox authority or alarms. Preserve unresolved external-effect evidence and any review block until an explicit acknowledgment and safe executor accounting permit new action. Test duplicate continuation requests and unauthorized archive IDs, interrupted setup and cleanup retry. No legacy continuation importer.
   Run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-lifecycle.test.ts src/pi-durable-restore.test.ts` through product lifecycle intents.
3. Make deletion's first durable product transition block admission and retire authority before cleanup. Runtime/provider/execution adapters freshly observe revocation independent of projection lag. Preserve a resumable cleanup intent across D1, runtime SQLite, credential status where applicable and R2. Deleting a project must not disconnect even the same user's project-independent Codex connection or delete another workspace's retained references. Keep the deletion/retirement fence after removing the product row. A busy lease leaves deletion pending and fenced, never reverted to ready. Archive abandonment must check all surviving lineage references.
   Add deletion races to the same lifecycle tests and existing product ownership tests. Assert no fresh privileged call after revocation commit.
4. Race deletion with queued/undelivered commands, running shell, checkpoint upload, projection, renewal and preview. Account for already-admitted external requests; revocation cannot undo them. Late writes are update-only/owner-version checked; discard unreferenced prepared artifacts safely. Keep Stop/cleanup independent of normal admission capacity and retain unresolved executor accounting.
   Same command plus `src/pi-durable-projection.test.ts` and `src/pi-durable-capacity.test.ts`.
5. Save `plans/evidence/016-lifecycle.md`; run `pnpm runtime:verify`, `pnpm verify` and affected contracts/runner/retained brain gates. Record local fixtures only; no live resource operations.

## Acceptance and maintenance

Archived lineage cannot restart old tasks. Deletion is revocation-first and converges under retries without record resurrection. Cleanup failure leaves safe visible state and durable intent, not new authority. Histories can be inspected without executor activation.

Stop if continuation needs whole-coordinator cloning, if deleting content erases a required fence, or if archived work must retain a live writer. Refresh this conditional plan's paths/interfaces before implementation. No reset, deployment, live request, staging or commit. Every new durable record must later declare its deletion/retention owner.
