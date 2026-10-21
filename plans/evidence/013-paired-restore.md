# 013 paired restore and command dispositions

Disposition: DONE for the local fixture scope, accepted with limits after two rejected review rounds; see the acceptance section at the end. Base `93b5674` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0.

## Refreshed design

The plan was refreshed against the integrated 012 code and the pinned Pi Durable 1.0.1 API before coding:

- 012 manifests recorded the Pi storage position but not the conversation head. A restore needs the exact entry to fork from, so publication now records `context.head`: the active conversation, its last entry (or none for an empty baseline) and a digest of its model context. Publication reads the head and the position together and fails stale if the position moved.
- Pi has no rewind. The supported retirement recipe, proven first in a disposable test, is: `conversation.abort(ctx, { background: true })` withdraws queued inputs and aborts every live task, background ones included; then `conversation.fork(entry, { ownership: { kind: "ownerless" } })` starts a new conversation whose context equals the pair's context. Entry ids are global, so history from every generation stays readable. Old tasks never resume, because the host now drives only the active generation's conversation.
- The host had a single root conversation. It now has an active generation table, `host_generations`, and every former root use goes through the active conversation.
- 012 left the product pointer as an update-only projection. A restore moves it like a publication does, so the product and runtime agree on the restored pair.

## Implementation

| Part | Location |
|---|---|
| Restore command kind, positions and acknowledgment; restore completion and its exact acknowledgment; `checkpoint_restored` reason | `packages/runtime-contracts/src/product-command.ts`, `checkpoint.ts`, `projection.ts` |
| D1 barrier: `candidate_restore_barriers`, restore kind in `session_commands` | `apps/web/migrations/0024_candidate_restore_barrier.sql`, `apps/web/src/db/schema.ts` |
| Product admission, barrier, reconstruction and completion | `apps/web/src/lib/session-command-candidate.ts` |
| Pair restore under one exclusive scope, retained-lineage fallback, pointer move | `apps/runtime/src/pi-durable-checkpoints.ts` |
| Fence, dispositions, generation switch, completion, recovery-only denial | `apps/runtime/src/pi-durable-host.ts` |
| Composition hooks; no deployed restorer | `apps/runtime/src/pi-durable-product-session.ts` |

### Product barrier

One D1 batch inserts the restore command at the next sequence, the closed barrier with `cutoffSeq = commandSeq - 1`, the sequence advance, the idempotency key and the delivery work. The insert only succeeds when:

- the session is owned and still `pi_durable_v1`;
- `nextSequence - 1` equals the user's `expectedRecoveryPosition`;
- the product pointer names the user's pair at the expected mutation generation;
- no barrier is closed.

A failed condition returns `restore_stale` or `restore_in_progress` with no rows. A partial unique index allows one closed barrier per session. Duplicate keys return the original receipt before any barrier check; a changed payload conflicts. Ordinary prompt and follow-up inserts recheck the barrier inside their own batch, so a racing pair never commits on both sides of the cutoff. Stop and cancel stay available. Restore admission requires `restoreAvailable` from the composition and otherwise returns `restore_unavailable`.

A runtime refusal moves a closed barrier to `refused` and reopens admission; nothing was discarded, so no fate is awaited. A refused or completed barrier is final.

Completion moves the barrier to `complete` only for the exact restore, pair and cutoff, and only when every prompt or follow-up through the cutoff has a `complete` or `failed` assistant. Otherwise it answers `retry`. A trigger makes a completed barrier final. A repeated exact completion answers `already_applied`; a different one answers `blocked_membership`.

### Runtime order

1. Accept: compose the restorer or refuse. Then, in one transaction, store the product record and compare the named pair and mutation generation with the runtime pointer, which can be ahead of the product's. On a mismatch the row is `refusing`: the epoch is unchanged, ordinary work continues, and the refusal is sent until the product applies it. Otherwise insert `host_restores` as `fenced`, advance the host epoch and set the restore wakeup. Ordinary admission is denied from here until `complete`, with `EffectDenied("recovery")`, which does not shut the host down.
2. Retire, once every sequence through the cutoff is delivered: abort the active conversation with background tasks. For each prompt or follow-up through the cutoff, a submission Pi finished is marked complete with its answer; every other one gets the `restored` disposition and a failed assistant with reason `checkpoint_restored`. Remaining runs through the cutoff fail, stopping runs cancel, and the state becomes `retired`. Projections are delivered at once.
3. Restore, under the exclusive owner transition and one 011 recovery scope: the named pair must be the pointer's current or previous pair. Try it, then the current pair's previous pair. Each candidate checks host compatibility, reads back its context object and restores its archive. The host then forks at the pair's own head and checks the context digest. One transaction confirms the scope, moves the pointer, inserts the generation and marks the restore `restored`. Two unusable pairs block with per-pair evidence; the seed is never used.
4. Complete: deliver the pointer move and all assistant projections, then send the completion. A restore move does not chain from the move before it, so delivery ends a batch before it. Only `applied` or `already_applied` marks the restore `complete` and rearms ordinary work.

Late delivery of a command through the cutoff gets its recorded fate, never a new Pi submission. A result that arrives after the fence is recorded under its original operation and epoch.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-restore.test.ts` | passed, 16 tests on real DO storage: the retirement recipe, current-pair restore, an in-flight request, an unknown outcome, a late result, fallback, both pairs unusable, a delayed predecessor, the five-point crash matrix, a post-restore command, pointer lineage after fallback with a stale restore refused, a restore move behind an undelivered publication, and refusal without a restorer. The fixture product parses every batch with the real contract parser |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-checkpoints.test.ts` | passed, 12 tests, unchanged from 012 apart from the shared fixture move |
| `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t "restore\|racing\|checkpoint pointer"` | passed, 4 tests on real D1: stale and foreign restores commit nothing, restore unavailable, admission, duplicates, conflicts, `restore_in_progress` for prompt, follow-up and a second restore, Stop during the barrier, reconstruction, completion retry while an assistant is pending, wrong pair or cutoff or owner, exact completion, finality, reopened admission; a racing ordinary command against a restore; and a refusal that releases the barrier, is final and lets a new restore key in |
| `pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts` | passed, 20 tests, with migration 0024 applied |
| `pnpm contracts:verify` | passed, 58 tests |
| `pnpm runtime:verify` | passed, 470 Worker tests plus the Node checks |
| `pnpm verify` | passed: credentials 234, web 869, runner 107 |
| `pnpm check` | passed |
| `git diff --check` | clean |

### Mutation checks

Each change below was made alone and reverted; the named suite failed each time.

| Removed guard | Failing suite |
|---|---|
| Barrier recheck inside the ordinary insert | D1, 2 tests |
| Pending-assistant condition in completion | D1 |
| `nextSequence - 1 = expectedRecoveryPosition` in restore admission | D1 |
| Product `restoreAvailable` gate | D1 |
| Ordinary gate while a restore is unfinished | runtime, 2 tests |
| Cutoff scope of the retire sweep | runtime |
| Waiting for every sequence through the cutoff | runtime |
| Epoch advance at the fence | runtime, 2 tests |
| Pointer move at the generation commit | runtime |
| Retained-lineage check | runtime |
| Clearing previous after a fallback | runtime |
| Refusal before the fence without a restorer | runtime |
| Pointer delivery before completion | runtime |
| Batch split before a restore move | runtime, 2 tests |
| Stale check before the fence | runtime |
| Refusal only from a closed barrier | D1 |
| Publication deferral during a fenced restore | runtime |

Removing the ordinary-admission precheck alone fails nothing, because the in-batch recheck already refuses with no rows; the precheck only avoids credential and configuration reads.

## Crash matrix

Each case accepts commands 3 and 4 after pair 1 and a restore of pair 1 as command 5, loses the process at the named point, and opens a new host. Every case ends with: the restore `complete` once, one product application, two generations, commands 3 and 4 failed with `checkpoint_restored`, no new Pi submission, files at pair 1, and the next command answered from the restored context with exactly one provider call.

| Point | State left | Recovery |
|---|---|---|
| After the fence, before retirement | `fenced` | Reopen retires, restores and completes |
| Between dispositions | `fenced`, one disposition recorded | Dispositions repeat safely; recorded fates are kept |
| After files are restored, before the generation | `retired`, files at pair 1, scope held | Host open releases the scope; the restore runs again from the archive |
| After the generation, completion throws | `restored` | The next alarm sends the same completion |
| After the generation, acknowledgment lost | `restored`, product applied | The repeated completion answers `already_applied` |

The D1 side covers a lost completion acknowledgment through `already_applied`, a completion while an assistant is pending through `retry`, and a racing ordinary admission.

A publication while a restore is fenced or retired is deferred with `restore_pending`, because the restore named the current pair. The delayed-predecessor test covers it.

## Limits

- No deployed composition constructs a restorer, so restore is reachable only in fixtures. `restoreAvailable` stays unset in every deployed product composition, and the runtime refuses a restore before its fence without one. The web UI has no restore control.
- The plan's planned web files `session-restore-barrier.test.ts` and new cases in `session-command.test.ts` were not added. The D1 barrier is tested on real D1 in the credential-tests product suite, next to 012's pointer tests, because that suite already composes the candidate product. The web suite only gained the migration.
- No single test drives product D1 and the runtime together. The runtime tests use an in-memory product with the same pointer and completion rules; the D1 test marks the discarded assistant failed directly, standing in for the runtime's projection.
- No Docker restore case ran. Files are restored through 011's verified archive restore, which has its own Docker coverage; here they use 011's fixture adapters.
- A process lost between the fork and the generation commit leaves an orphan ownerless conversation. It is never driven and holds no task.
- An unknown in-flight effect blocks the restore before files change. A blocked restore keeps the product barrier closed; no reconcile or new restore path exists yet. The evidence for an unknown effect stays in host safety, not in the restore row.
- Retirement waits until every command through the cutoff is delivered. A command the product never delivers would hold the restore; delivery is retried by the product drain.
- A rejected pointer move stops checkpoint delivery, as in 012, and a restore then waits for it indefinitely with degraded health.
- After a restore the discarded pair's manifest and objects stay in the runtime until retention, which belongs to 017. They are no longer current or previous, so nothing offers or restores them.
- A restore against a product pointer that lags the runtime is refused, and the user has to restore again once the product catches up.
- After a fallback the pointer keeps no previous pair, so a later failure of the restored pair has no fallback until the next publication.
- Context comes from forking the live Pi storage at the pair's head; the encrypted context object is only read back and verified. Restore therefore does not survive loss of the session database.
- Manifests published before this change lack `head`. No deployed session has any, so no migration path exists.
- The schema definition for `candidate_restore_barriers` does not repeat the migration's shape checks and finality trigger, and 0022 to 0024 have no drizzle snapshots.
- Stale-generation denial after restart is shown for one reopen per case.
- A user can only name the current pair. Going back to the previous pair happens only as a fallback.
- Any publication between product admission and runtime acceptance turns the restore into a refusal; the user retries with a new key.
- If the product answers a refusal with anything but `applied` or `already_applied`, the runtime keeps the row `refusing` with evidence and refuses later restores. No realistic trigger is known, and nothing surfaces it yet.
- The runtime test for a restore move behind an undelivered publication names a pair the product never saw; it proves the batch split, not product admission.
- L4 is not complete. 014 adds Git and preview quiescence.

## Acceptance

First independent review: REJECT. Two blocking findings:

1. A restore never moved the checkpoint pointer, and fallback picked the highest earlier sequence. After a fallback the discarded pair stayed current and retained, and a later fallback could restore it and revive work the user had discarded. The pointer now moves inside the generation transaction, fallback follows the retained pointer, a discarded pair is refused as `not_retained`, and the pointer reaches the product before the completion.
2. A composition without a restorer could fence the host and close the barrier forever. The runtime now refuses before its fence, and product admission requires `restoreAvailable`.

It also noted that a late result from a retired generation shut the host down, and that a post-cutoff Stop exempted its target from the retire sweep; both were fixed.

Second review: REJECT. Both earlier fixes were confirmed. Two new blocking findings:

1. A restore move does not chain from the move before it, so a batch holding an undelivered publication and the restore move failed the contract parser on every retry and stalled completion. Delivery now ends a batch before such a move.
2. A restore named against a product pointer that lags the runtime fenced the host, discarded work and then blocked as `not_retained` with the barrier closed for good. The runtime now compares the pair and generation before its fence and sends a refusal that releases the barrier without discarding anything.

Third review: ACCEPT WITH LIMITS, no blocking findings. It verified both corrections, that a refusal cannot release a fenced restore, and that no earlier finding regressed. It noted that a boundary publication after the fence could move the pointer away from the named pair; publication is now deferred while a restore is fenced or retired. Its other limits are recorded above.
