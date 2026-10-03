# 013: Restore files, context and accepted-command fate together

Status: BLOCKED on 012. Base: `bcce03e`. Phase: L4, restore safety gate.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.4, 5, 8–11, 17; PD05, PD11–PD14, PD20–PD24, PD40; OD2, OD4–OD6.

## Outcome and owner

A restored older workspace uses the matching conversation/document position. Later history stays inspectable as interrupted. Old tasks, submissions, retries and background work cannot execute. Security fences, idempotency, run epochs and external-effect records never rewind.

Workspace-session commands owns atomic restore intent, ordinary-admission barrier and command cutoff in D1. Runtime owns dispositions, exclusive mutation, active generation and durable restore completion. Recovery returns evidence; it cannot activate a generation independently.

## Current state and scope

`packages/runtime-contracts/src/command.ts` already defines the user acknowledgment shape:

```ts
kind: "restore_checkpoint_acknowledging_loss";
committedPairId: string;
expectedMutationGeneration: number;
expectedRecoveryPosition: number;
unbackedLossAcknowledged: true;
```

This does not prove a D1 cutoff/barrier exists. `session-command.ts` owns admission; `workspace-recovery.ts` currently restores files. Neither old behavior establishes safe Pi Durable generation retirement.

Scope: product command/schema barrier and completion acknowledgment, runtime dispositions/generation transitions, recovery adapter and focused tests. Do not expose raw Pi fork controls or import legacy JSONL. Because this protocol spans two owners, keep it one coherent change; if too large, split at the durable barrier implementation with mutation enablement still disabled, not at an unsafe partial restore.

## Steps and checks

1. Refresh the plan against 012's manifest and pinned Pi APIs. Prove a supported retirement/fencing recipe in a disposable fixture before wiring user recovery. Inventory all old tasks, queued submissions, retries, compaction and background work. A fork alone is insufficient. If public APIs cannot prevent old work resuming, stop and seek supported upstream resolution under OD2.
   Add `apps/runtime/src/pi-durable-restore.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-restore.test.ts`. Assert zero old-generation admissions after reopen/resume, including background tasks.
2. Validate the owned `restore_checkpoint_acknowledging_loss` command, its expected positions and `unbackedLossAcknowledged: true` before any rollback that discards unbacked work. No timeout implies this acknowledgment. Commit restore intent, admission barrier and the last accepted ordinary-command sequence as cutoff atomically in product D1. Allow history, Stop, revocation and cleanup. Track the restore control separately so its own disposition cannot cancel it. Make duplicate keys return original receipts. After owned duplicate-key lookup, reject new ordinary commands while the barrier is closed with a stable `restore_in_progress` conflict and no new command/message receipt. Existing keys still return their original receipt; conflicting payloads still conflict. Priority controls remain available and are not included as ordinary cutoff work. Do not silently queue, drop or submit a post-cutoff request.
   Extend `apps/web/src/lib/session-command.test.ts` and add `src/lib/session-restore-barrier.test.ts`; run `pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-restore-barrier.test.ts`.
3. Resolve every accepted command through the cutoff, including undelivered ones, from trusted product records. Persist bounded disposition batches and projection intents. Keep included commands included; keep completed-after-pair assistants complete as interrupted history; close interrupted/unstarted discarded commands with recovery reason and fail pending assistants. Advance sequence processing without deleting deduplication. Late delivery gets its recorded fate, never a new Pi submission.
   Same web command and runtime restore tests, with a crash before/after each batch and a delayed missing predecessor.
4. Refuse restore execution until the product barrier/cutoff is confirmed durable. Advance the runtime epoch and fence old admissions before restore I/O. Under exclusive mutation ownership, stop/isolate accounted execution, restore a verified current pair or its matching previous pair and establish the active conversation generation using the proven recipe. Late results remain attached to their original operation/epoch. Previous-pair fallback uses that pair's own conversation position, not the current pair's context. Corrupt both pairs and assert execution blocks with evidence preserved, never seed fallback. Keep known/unknown external effects and ownership fences unchanged. Replacement writer rules still apply after explicit loss acknowledgment.
   Runtime restore tests plus `pnpm --filter @ditto/web exec vitest run src/lib/workspace-recovery.test.ts` and a disposable Docker restore case.
5. Persist restore-completion evidence after matching files/generation/dispositions exist. Product admission reopens only on the exact durable completion acknowledgment. Drop that acknowledgment and reconcile it. Timeout alone must not release the barrier. Reapplication requires a new explicit action/key; old keys remain deduplicated.
   Inject crashes before/after cutoff, disposition batches, active-generation change and admission reopening. Assert no stranded or replayed accepted instruction at every point.
6. Run `pnpm runtime:verify`, `pnpm contracts:verify`, `pnpm verify` and retained brain checks if affected. Save the crash matrix under `plans/evidence/013-paired-restore.md` with versioned local evidence.

## Acceptance and maintenance

PD40 must pass through the authenticated command interface, not by directly inserting only delivered inbox rows. Files and context agree after current-to-previous paired fallback; stale generation effects remain denied after repeated restart. Keep restore and provider/host evidence separate.

This conditional plan requires actual predecessor APIs and exact retirement proof before execution. No reset, deployment, live requests, staging or commit. Stop rather than add a second continuation engine or whole-database rewind. Future command types must define a cutoff disposition before they can participate in ordinary admission.
