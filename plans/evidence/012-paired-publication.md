# 012 paired checkpoint publication

Disposition: DONE for the local fixture scope, accepted with limits after one rejected review round; see the acceptance section at the end. Base `d02147f` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0.

## Refreshed design

The plan was refreshed against the integrated 008 to 011 code before coding:

- Pi storage already has an exact commit position. Every Pi commit advances `durable_metadata.next_seq` in the same synchronous transaction as its records, and every row body is already encrypted with owner, session and record binding. Document bases, revisions and split chunks live in the same runtime SQLite. So the context half of a pair is one synchronous read of those rows, not a reconstruction from product messages. The stop condition about an exact conversation and document position does not apply.
- The host had no notion of a baseline or of exclusive mutation ownership. The candidate composition already had a recovery-only admission switch, `ordinaryAllowed`, that keeps accepted work queued. Publication gates that switch.
- D1 already has `runtime_checkpoint_pointers` and an update-only `session` projection target in `apps/runtime/src/product-projector.ts`, keyed by the expected mutation generation and guarded by the projection cursor. Publication reuses it. The brain-era `runtime_checkpoint_pairs` table is not written; archive and context references stay in the runtime.
- No runtime binding to a Sandbox or R2 exists in any deployed composition yet. Publication is implemented and proven with fixture adapters and the miniflare R2 binding; composing it into a real session is left to 014, as for 011's adapters.

## Implementation

| Part | Location |
|---|---|
| Pointer move contract: one-generation moves, ordered chains, exact acknowledgments | `packages/runtime-contracts/src/checkpoint.ts` |
| Publisher: baseline sequence and later pairs under one 011 recovery scope, context snapshot, encrypted context object, read-back verification, single commit transaction, host-open recovery, cleanup that never deletes the current or previous pair | `apps/runtime/src/pi-durable-checkpoints.ts` |
| Host binding: `checkpoints` dependency; ordinary admission requires a committed baseline and no held scope; `checkpointPort()` exposes epoch, quiescence, block, effect watermark and authority; alarms deliver pointer moves; observation reports recovery health | `apps/runtime/src/pi-durable-host.ts` |
| Composition: a product session that can reach an executor enables the gate | `apps/runtime/src/pi-durable-product-session.ts` |
| Product application: generation-0 pointer row for owned pi_durable sessions; update-only application through the existing projector | `apps/web/src/lib/session-command-candidate.ts` |

### Manifest

`CheckpointManifestV1` records: pair id and sequence; kind (`baseline` or `boundary`); session and scope ids; the 011 `ArchiveArtifactV1`; the context object key, ciphertext length and digest, plaintext digest, exact position (`commitSeq`, `nextId`), conversation generation and a digest of the split-record write ids it references; archive, Pi storage and host compatibility versions; mutation generation; runtime epoch; executor generation; outstanding effects (always zero, `settled`); and for a baseline the seed digest and synchronized branch head. Manifests are immutable: an SQLite trigger rejects any update, and another rejects deleting the current or previous pair. Keys, digests and object references never reach the product or observation.

### Publication order

1. Refuse before any scope unless the executor is current and exclusive (one live executor), other writers report settled, and the kind fits the pointer (a baseline only without a pair, a boundary only after one).
2. Acquire the 011 mutation scope. Its authority is bound to the host: the host epoch, the executor generation read from product authority, quiescence and the host block state. Quiescence means no run being scheduled, running, recovering or stopping, no unresolved effect, no non-terminal Pi task and no placed submission.
3. Baseline only: restore the owned seed and synchronize the owned branch through 011's runtime-first, product-second, recheck-before-fetch sequence.
4. Read the effect watermark and the whole Pi storage snapshot in one synchronous read.
5. Capture the workspace archive (011, verified against the stored bytes).
6. Encrypt the snapshot with the runtime keyring, bound to owner, session and `checkpoint-context/<pair>`; upload it; read it back and prove length, ciphertext digest, plaintext digest and position.
7. Recheck authority and writers. In one SQLite transaction: confirm the scope, the effect watermark and the Pi position are unchanged; insert the manifest and its pins; move current to previous and set the new current; insert the pending pointer move; mark both objects published; record healthy recovery.
8. Release the scope and rearm deferred ordinary work and pointer delivery.

Any failure orphans the pair's objects, records degraded recovery and leaves the pointer unchanged. A stale result is never published.

### Delivery

Pointer moves go to the product in version order, up to 16 per batch. Only `applied` and `already_applied` retire a move. A retry or thrown call leaves it pending with a retry wakeup. A rejected move stops delivery, because every later move depends on it, and stays visible as degraded recovery with lag.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-checkpoints.test.ts` | passed, 12 tests on real DO storage, including the miniflare R2 binding for the baseline. Removing any of these makes a test fail: the baseline gate, the held-scope gate, the scheduling counter, the effect-watermark, Pi-position or scope recheck at commit, the context read-back, host-open recovery, the release-time rearm, the open-time delivery wakeup, the retained-object guard in cleanup, the writer and executor checks, and the stop-after-retry and stop-after-rejection rules |
| `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t "checkpoint pointer"` | passed: real D1 applies moves update-only in generation order, acknowledges a repeated move, rejects a skipped generation and a foreign owner |
| `pnpm contracts:verify` | passed, 56 tests, including the pointer move contract |
| `pnpm --filter @ditto/web exec vitest run src/lib/workspace-recovery.test.ts src/lib/sandbox-archive.test.ts` | passed, 27 tests |
| `pnpm brain:verify`, `credentials:verify`, `runtime:verify`, `check` | passed: brain 43 plus 3, credentials 231, runtime 454 plus 8 Node checks |
| `pnpm verify` | passed: credentials 231, web 869, runner 107 |
| `git diff --check` | clean |

The 011 fixture adapters moved unchanged into `apps/runtime/src/pi-durable-recovery.fixture.ts` so both suites share them.

## Crash points

| Point | Result |
|---|---|
| After the archive upload, process lost | No manifest, pointer unchanged. Reopening releases the scope; cleanup deletes the archive. Retry publishes a whole pair. Ordinary work resumes on its own wakeup. |
| After the context upload, process lost | Same; cleanup deletes the archive and the context object. |
| After read-back verification, process lost | Same. |
| Inside the commit transaction | The transaction rolls back: no manifest, pin, pointer move or projection row. Cleanup deletes both objects after reopening. |
| After the commit, process lost | The pair stays current and whole. Reopening releases the scope and adds a pointer-delivery wakeup; the next alarm applies the move. A retry publishes the next pair over it; previous is the committed pair. |
| Product application lost after D1 applied | The move stays pending; the next delivery is `already_applied` and retires it. The pair is never undone. |
| Product retry, or a rejected move | Pending, or rejected and degraded; later moves are not delivered out of order. |

## Initial-baseline verdict

PASS for the local fixture scope. Ordinary work accepted before the baseline is not submitted to Pi and makes no provider call. The baseline restores the seed, synchronizes the branch, captures matching files and context, verifies both, and only then opens admission; the queued command then runs. A denied branch authority or a missing seed publishes nothing and admission stays closed. This does not enable retained users: L4 is not complete.

## Limits

- No deployed composition constructs the publisher. The runtime has no Sandbox or R2 binding in any session yet, so baseline and boundary publication run only in fixtures. A product session subclass that supplies `remoteExecutor()` enables the gate and must also compose the publisher, or ordinary work stays denied. 014 composes it with Git and preview quiescence.
- Host-open recovery assumes nothing from an earlier host instance is still running. A reopen in the same isolate while an old publication is mid-step marks its admitted extraction or fetch `unknown`, which blocks the workspace, and the old publication then fails its commit check. The production composition must tie the publisher to the host instance's lifetime.
- The manifest records the executor generation from product authority and the constant executor slot. `LocalAuthority` carries no sandbox incarnation id yet.
- The context snapshot copies every Pi storage row, including all revisions and chunks, as one encrypted object with a 32 MiB plaintext cap. A larger session fails publication with `context_failed` and stays degraded. There is no split format. The workspace archive itself is not application-encrypted, as designed in 011.
- Writers outside the host are an injected check, read before the scope and again before the commit. Nothing reports preview yet, so a preview writer would go unnoticed until 014.
- A rejected pointer move has no reconcile path. It stops delivery and stays visible as degraded recovery with lag.
- Deferred publications are not recorded in health; only failures and successes are.
- Pairs older than the previous one are never deleted, and completed uploads become orphans only through host-open recovery. Retention belongs to 017.
- No lost-process test covers a baseline lost during seed extraction; 011 covers the unknown-extraction rule itself. The commit crash point is an exception inside the transaction, which SQLite rolls back.
- The product apply method uses runtime owner version 1, like the existing terminal projection path.
- L4 is not complete. Retained-user enablement stays off until 014 records the full L4 gate.

## Acceptance

First independent review: REJECT. Four blocking findings:

1. After a boundary publication released its scope, nothing rearmed deferred ordinary work or the new pointer move. The publisher now rearms both after every publication once a baseline exists.
2. Quiescence missed a run that was still `queued` while being scheduled, so a scope could be acquired mid-schedule and the run then wedged. A scheduling counter now makes the host non-quiescent for the whole schedule, and the `queued` to `running` transition checks admission with no await in between.
3. A rejected pointer move vanished from health, and every later move was rejected in turn while health said healthy. Rejection now stops delivery and shows as degraded with lag. The product creates the generation-0 pointer row for owned sessions that lack one.
4. The crash tests threw in-process, and nothing recovered a held scope after a real restart, which would deny ordinary work forever. Host open now runs checkpoint recovery, and the crash tests leave the publication hanging and reopen the host.

Second review: ACCEPT WITH LIMITS, no blocking findings. It asked that a failed rearm not replace the publication result, now fixed, and named the same-isolate reopen and baseline-extraction crash limits recorded above.
