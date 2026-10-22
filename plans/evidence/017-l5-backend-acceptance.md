# 017 Retention and clean-start rehearsal; L5 backend acceptance

Disposition: DONE for the local fixture scope, accepted with limits after two review rounds with no blocker; see "Review" and "Acceptance". Base `d937a85` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0. No reset, deletion of existing data, deployment, live provider request, real secret or shared database was used. The collector never ran against an existing resource. Every value in tests is synthetic.

L5 product completion also needs 018, which waits on Ayan's approval of the control layout.

## Retention design

The runtime retains, as roots:

- Canonical history: every committed Pi record and the writes it references, for the session's lifetime, archive included.
- The current and previous pairs.
- Any pair an unapplied checkpoint projection names, so a lagging product never points at collected content.
- An archive's final pair, and the target of an unfinished restore.
- Every write pinned by a pair that is still retained.

Everything else is transient. It is marked when first seen and collected only if it is still unreferenced one retention period (24 hours) later. Age alone never deletes a root. The steps:

1. A pair outside the roots that still has pins or published objects is marked.
2. After the period its pins are deleted and its context object is handed to deletion. Its archive object is handed to deletion only if this session's own recovery ledger shows a completed upload of that key. A project seed or a continued lineage's source archive is never this session's object, so it stays.
3. Orphaned objects are deleted from the store unless a retained manifest names the key. A failed delete backs off on its own key, from 60 seconds doubling up to 24 hours, so it never blocks other keys.
4. Unreferenced Pi storage writes, from failed preparations or superseded bodies, are marked when no committed record references them and no pair pins them. After the period they are deleted inside the storage admission lane, which rereads references and pins first, so a commit cannot interleave. The integrity index is reset after the delete.

Collection waits while a recovery scope is held or a checkpoint object is still prepared, which covers live publication, restore and UI Git. Manifest rows stay; they are small immutable metadata. Keys are never touched, so historical records keep decrypting after rotation.

The host runs one bounded step per due `retention` wakeup in its existing wakeup table; there is no second scheduler. It never runs when the host is sealed or behind a storage barrier, or when the session is archived; a denied host or an unfinished restore moves a past-due wakeup on instead of spinning the alarm. A step that finds nothing waiting ends the wakeup, and a later alarm with pairs re-arms it 24 hours out, so an idle session does not keep waking.

Detailed denials: no candidate record type stores detailed denials today. Denials are returned to the caller and not retained, so the 30-day rule has nothing to apply to yet. A future retained denial record must join retention and its tests before release.

| Part | Location |
|---|---|
| Collector, roots, marks, retries, fault seam | `apps/runtime/src/pi-durable-retention.ts` |
| Unreferenced write listing and admitted collection | `EncryptedPiStorage.unreferencedWrites`, `collectWrites` in `apps/runtime/src/pi-durable-storage.ts` |
| Host wakeup, composed store | `advanceRetention` and `checkpoints.store` in `apps/runtime/src/pi-durable-host.ts` |

## Clean-start rehearsal

The rehearsal is the credential test "clean-start rehearsal fences old authority and accounts for its executor before a new owner acts, with no import, old submission or second owner" in `apps/credential-tests/src/product-commands.worker.test.ts`. It runs in the credential pool because the transition needs product D1 and the runtime Durable Object together, and the runtime pool has no D1. The plan named `apps/runtime/src/pi-durable-transition.test.ts`; that file was not added.

Observed effects, with the fixture's single candidate workspace:

- The old session has a completed command, an undelivered command and an executor that never proves termination.
- Revocation commits first (deletion's first batch). The rehearsal then runs twice. Each pass: cleanup fails for lack of termination evidence, the executor claim stays live, the project stays deleting, a new owner in another project is refused with `fixture_capacity_exhausted`, a late command for the old session is refused with `runtime_owner_mismatch`, the undelivered work stays failed and runtime authority stays revoked. The second pass changes nothing.
- When termination evidence arrives, cleanup completes, the claim is released and the old runtime storage is purged.
- The new owner starts with one command at sequence 1. A repeated request returns the same receipt. Nothing from the old session is imported; its runtime work rows are gone; its deletion and retired-identity fences remain. The new session's runtime holds only its own command, and the command completes.

The dry-run operator checklist is [017-clean-start-checklist.md](017-clean-start-checklist.md). It runs nothing and authorizes nothing.

## Checks

| Gate | Result |
|---|---|
| `pnpm contracts:verify` | passed, 66 tests |
| `pnpm runtime:verify` | 510 of 511 passed. The one failure is the known upstream timeout in `pi-durable-storage.test.ts` "streams long document tails across root replacement deltas" under full-suite load; it passed alone in 3.2 s |
| `pnpm verify` (check, typecheck, credentials, web, build, `runner:verify`) | passed: credentials 256, web 875, runner 114 |

New tests: `pi-durable-retention.test.ts` (runtime, 9) and the clean-start rehearsal (credentials). The web ownership test `session-runtime-ownership.test.ts` runs inside `pnpm verify`.

### Mutation checks

Each mutation was applied alone and the retention suite was run. 10 of 11 were caught.

| Mutation | Result |
|---|---|
| Collect without waiting the period | caught |
| Retain only the current pair | caught |
| Ignore pairs named by unapplied projections | caught |
| Collect while publication is in flight | caught |
| Mark pinned writes | caught |
| Delete any archive, not only this session's uploads | caught |
| Retry a failing delete on every pass | caught |
| Skip the reference recheck inside the admission lane | caught |
| Run retention for an archived session | caught |
| Re-arm the wakeup when nothing waits | caught |
| Never unmark an id that left the candidate set | survived: write ids are never reused, so an unreferenced write cannot become referenced again, and a pair is rechecked against the roots just before retirement |

## PD map for L5 backend

| ID | Local status | Evidence |
|---|---|---|
| PD01–PD03 | passed in fixtures | 006 to 008, 016 |
| PD04–PD06 | passed in fixtures | 003, 008, 013 |
| PD07–PD10 | passed in fixtures | 002, 003, 008, 010 |
| PD11–PD16 | passed in fixtures | 003 to 005, 008, 009, 013, 015 |
| PD17–PD19 | passed in fixtures | 004, 005; 017 adds collection with rotated keys and pins |
| PD20–PD23 | passed in fixtures | 011 to 013 |
| PD24–PD25 | passed in fixtures | 010, 012, 014, 016 |
| PD26–PD27 | backend passed in fixtures; product controls pending | 010, 014, 016; 018 |
| PD28–PD31 | passed in fixtures and Docker where recorded | 006 to 009, 011, 014, 015 |
| PD32–PD33 | passed in fixtures with a single candidate workspace | 008, 015 |
| PD34 | passed in fixtures | 016 |
| PD35 | passed in fixtures | 017 |
| PD36 | passed in fixtures | 004, 005 storage compatibility; host task version block |
| PD37 | passed in fixtures, single workspace | 017 |
| PD38 | not run | 020, needs approval |
| PD39 | not run | 019 |
| PD40 | passed in fixtures | 013 |
| PD41–PD42 | backend passed in fixtures; product controls pending | 006, 007, 011; 018 |

No hosted, paid-platform or browser check has run for any row.

## Limits

- No composition supplies a real artifact store to the host, so objects are deleted only in fixtures. Without a store, pins are released and objects stay orphaned for a later composition.
- Collection begins about 48 hours after the first pair: one period to arm, one to age.
- An archived session keeps everything, including pairs older than its final pair and unreferenced writes. A blocked archive and a pair named by a rejected projection are kept indefinitely. These are leaks, not losses.
- A denied host that is never archived or deleted wakes once a day.
- Retired archive objects are found through the recovery ledger's completed upload rows. If that ledger is ever pruned, those archives leak.
- Fixture records stay inline, so the host-level tests use synthetic pins; split writes and their collection are covered at the storage level.
- The rotated-key check shows retention keeps historical records readable; it does not test a full re-encryption.
- The rehearsal shows exclusivity only through the fixture's single-workspace cap and the session fences. It does not test a second owner of the same workspace session, because nothing can create one: a pi_durable_v1 session has no owner transition, which the web ownership tests cover.
- The rehearsal does not include a stale old projection or an open old provider window. Late projections for deleted targets are covered by the credential test "settles late follow-ups as failed ... and never recreates a deleted target"; provider windows are covered by 006 and 007 and are not exercised across a transition.
- The checklist leaves the legacy engine's fence and projection paths as placeholders.

## Review

Round 1, by an independent reviewer: no blocker, six should-fix items, all fixed.

- A past-due wakeup during a restore or on a denied host made the alarm spin. It is now moved forward.
- Every session with a pair woke daily forever. A step with nothing waiting now ends the wakeup.
- A failing delete retried every minute and could starve other keys. It now backs off per key and the scan skips it.
- A fault case never threw. It moved to the storage-level test, where it does.
- The shared-archive guard was untested. A test now removes a pair's upload record and shows its archive stays.
- The rehearsal's late admit accepted any error. It now expects `runtime_owner_mismatch`, and the retired identity fence is asserted. The missing runtime transition file, stale projection and provider window are recorded in Limits.

Round 2: nothing must still be fixed. The reviewer asked that this file not claim same-session exclusivity; Limits states what the rehearsal shows.

## Acceptance

017 is accepted with limits for the local fixture scope. Before release, a composition must supply the artifact store, and the legacy engine's fence and projection checks must be filled in the checklist before any real clean start.

## CI correction

CI failed on `2fe70ae`: the clean-start rehearsal ended with "Isolated storage failed" because the purged session's SQLite was still open when the test pool popped storage. The local `pnpm verify` result recorded above did not reproduce in CI.

Cause: `PiDurableProductSession.alarmHost` read runtime authority, then called `activate`, which reads it again. When deletion revoked authority between the two reads, the alarm threw `Candidate authority denied` instead of taking the denied path, and the failed alarm kept the session open past the pool's wait. The 016 deletion test had the same race; in isolation it failed 4 of 4 runs before the fix.

Fix: `alarmHost` rereads authority when activation fails and treats a revoked scope as denied; other errors still throw. The regression test "an alarm whose authority is revoked between its check and host activation settles without throwing" uses a fixture fault that revokes authority after one read. It failed 3 of 3 before the fix. After it, the regression, deletion and clean-start tests each passed 3 of 3 alone, and `pnpm runtime:verify` passed 511 of 511. The full credential suite times out on unrelated tests on the local WSL machine with and without the fix, so CI is the gate for it.
