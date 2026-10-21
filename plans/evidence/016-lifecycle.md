# 016 Archive, continuation and deletion fences

Disposition: DONE for the local fixture scope, accepted with limits after one review round with a blocker; see "Review" and "Acceptance". Base `bdcaaf4` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0. No reset, deployment, live provider request, real secret or shared database was used. Every value in tests is synthetic.

## Refreshed design

- Archive is a product command, `archive_session`, admitted through the same sequence as other commands. Its cutoff is its own sequence minus one, so every command accepted before it is inside the archive and nothing can be accepted after it.
- The product commits the archive intent in `candidate_archives` in the same batch as the command. From that commit, ordinary commands, restore, workspace actions and a second archive are refused with `session_archived`.
- The runtime host fences first: it records the archive and raises the epoch in one transition, before any I/O. Then it retires every command through the cutoff with the fate `session_archived`, stops preview with termination evidence, publishes a final pair when anything is unbacked or the conversation moved, seals the final model context as a continuation seed, delivers fates and projections, and asks the product to complete the archive with the exact pair, pointer generation and conversation generation.
- Only an exact completion retires the session: the product marks it archived, retires its identity, writes a retired fence and drops the workspace claim. The executor slot is released later, and only with termination evidence.
- Continuation creates a new session, identity, branch, pointer and sequence in one batch with its intent. The seed is read passively from the archived session, encrypted with an AAD bound to that session, and imported into the new session's root conversation as one entry after a digest check. The new session admits nothing until the intent is ready. No task, inbox, run or alarm is copied, and the new lineage starts with no previous pair.
- Deletion fences the project and each of its sessions, sets the project to `deleting`, cancels undelivered work, fails pending assistants and schedules a cleanup job, all in its first batch. Cleanup tears down executors with evidence, purges each session's runtime storage and removes product rows. Fences remain. The Codex connection is never touched.
- Legacy archive, continue and delete paths refuse candidate sessions with `runtime_owner_mismatch`, and candidate deletion refuses a project that still has a legacy session.

## Implementation

| Part | Location |
|---|---|
| Command kind, archive completion, continuation seed and import, browser continuation request, `session_archived` reason, `archived` workspace denial | `packages/runtime-contracts/src/{product-command,checkpoint,lifecycle,projection,workspace-action}.ts` |
| Archive intent, continuation intent, finality triggers, command kind | `apps/web/migrations/0026_candidate_lifecycle.sql`, `apps/web/src/db/schema.ts` |
| Archive admission, admission gates, exact completion | `apps/web/src/lib/session-command-candidate.ts` |
| Continuation, deletion, cleanup jobs with backoff, executor teardown | `apps/web/src/lib/candidate-lifecycle.ts` |
| Host archive steps, seed seal, passive seed read, passive acknowledgment, continuation import | `apps/runtime/src/pi-durable-host.ts` |
| Preview stop and final publish for archive | `apps/runtime/src/pi-durable-workspace.ts` |
| Passive history, export, import, purge and alarm routing | `apps/runtime/src/pi-durable-product-session.ts` |
| Legacy refusals | `workspace-session.ts`, `session-preview.ts`, `workspace-runtime.ts`, `routers/projects.ts` in `apps/web/src` |

## Checks

| Gate | Result |
|---|---|
| `pnpm contracts:verify` | passed, 66 tests |
| `pnpm runtime:verify` | import audit passed; runtime 501 of 502 tests passed, see the timeout note below |
| `pnpm verify` (check, typecheck, credentials, web, build, `runner:verify`) | passed: credentials 255 tests, web 875, runner 114 |

New tests: `lifecycle.test.ts` (contracts, 3), `pi-durable-lifecycle.test.ts` (runtime, 9) and six lifecycle tests in `product-commands.worker.test.ts` (credentials). The web tests for workspace sessions, recovery and preview run inside `pnpm verify`.

The upstream conformance test "streams long document tails across root replacement deltas" in `pi-durable-storage.test.ts` timed out at its 5-second limit, as recorded in 015. Before the review fixes, the full runtime gate failed once on this test and then passed with all 499 tests. On the final tree it timed out in both full runs, while every other test passed, and it passes alone in about 3 seconds with all 41 storage tests. 016 does not touch storage. No deadline was raised and no test was skipped. CI runs only `pnpm verify`.

### Mutation checks

Each mutation was applied alone and the nearest suite was run. 15 of 17 were caught.

| Mutation | Result |
|---|---|
| Lower the epoch at the archive fence | caught, runtime |
| Report the workspace open while archived | caught, runtime |
| Retire archived work with the restore reason | caught, runtime |
| Ignore a preview stop with unknown outcome | caught, runtime |
| Skip publishing an unbacked edit when the conversation did not move | caught, runtime |
| Always publish a new final pair | caught, runtime |
| Skip the seed digest check on import; accept a different source pair | caught, runtime |
| Admit an ordinary command after an archive intent | caught, credentials |
| Admit work in a continuation destination before it is ready | caught, credentials |
| Skip the archive check in `assertOpen` | caught, credentials |
| Release an executor without termination evidence | caught, credentials |
| Skip session fences on deletion; keep the project row after cleanup | caught, credentials |
| Continue from an active session | caught, credentials |
| Skip the "preview already unknown" check before stopping | survived: stopping a preview whose state is already unknown also returns unknown, so the archive blocks either way |
| Drop the pointer condition in the completion `UPDATE` | survived: the same pointer is compared just before the batch; the SQL condition only guards a concurrent pointer change, which the single-session fixture cannot produce |

## Limits

- Continuation is not end to end. No composition establishes the new session's workspace baseline from the seed's archive, and there is no reference protection for that shared archive object. The runtime test establishes the baseline by hand. Until a composition does this, a continued session would start from a fresh checkout while its context describes the archived files.
- A blocked archive, from an unknown preview stop or an unresolved effect, has no acknowledgment path to re-arm it. The evidence stays on the host, every admission stays closed and deletion is the only exit. It needs a user-visible state and a review action.
- Unresolved external effects block the archive instead of being carried to the continuation as review evidence.
- After an archive, ordinary commands are refused by the product. The runtime refuses them only through its admission gate and the archive fence; it has no separate defensive refusal per command kind.
- The passive acknowledgment of a lost completion marks the archive complete but does not record the archive command's own runtime fate. That command has no assistant message, so nothing stays pending. The rule that it runs only after archived authority lives in the product session and is not tested at that layer.
- R2 objects are not purged on deletion because no artifact store is composed; runtime storage and product rows are.
- A seed larger than 1 MiB is kept with the archive but cannot be continued.
- Only fixture model selections carry over, because the selection contract admits only fixture models today.
- The workspace claim is dropped at archive completion, before the executor's termination evidence. The executor slot itself is released only with evidence.
- Narrow races, each bounded by fences or later convergence:
  - A workspace action that passes the product check before an archive intent commits can reach the host before the archive does. Archive finalization stops preview and captures the change in the final pair. Restore has the same pattern.
  - The legacy deletion path checks for candidate sessions before it deletes, so a first candidate prompt in that gap is not covered by revocation-first fences.
  - Candidate deletion checks for legacy sessions before its fencing batch, not inside it.
  - A continuation import already in flight when the project is fenced can still write the destination's storage. The ready transition is fenced, so the user never sees it as ready, and cleanup purges it.
- D1 checks prompt and follow-up fates at the cutoff before completing; stop and cancel fates are left to the runtime. D1 stores the conversation generation without comparing it.
- Router deletion of a project with candidate sessions is refused until `CandidateLifecycle` is composed into the product; only the credential fixture wires it today.

## Review

Round 1, by an independent reviewer: one blocker, five should-fix items.

- Blocker, fixed: if the product committed the archive completion and the acknowledgment was lost, the host could never reopen, because runtime authority is gone for an archived session. The archive stayed `final` and could never be continued. `PiDurableHost.acknowledgeArchive` now moves `final` to `complete` from passive archived authority, which the product grants only after the exact completion. Tests cover a lost acknowledgment and show that a fenced or blocked archive is never completed this way.
- Should fix, done:
  - Candidate deletion refuses a project with legacy sessions, so legacy sandboxes and backups are never removed without legacy cleanup.
  - The continuation ready transition is fenced on the project and both sessions.
  - Test comments that claimed more than the tests check were corrected.
- Should fix, accepted as limits above: the blocked-archive exit, the destination baseline, the workspace-action race and the in-flight import race.

Round 2: no blocker remains. The reviewer asked that the baseline gap be stated plainly as making continuation not end to end, and that a blocked archive get a user-visible state. Both are in Limits.

## Acceptance

016 is accepted with limits for the local fixture scope. Before continuation is offered to users, a composition must establish the destination baseline from the seed's archive with reference protection, and a blocked archive needs a visible state and a review action.
