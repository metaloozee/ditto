# 010 settlement, observation and L3 acceptance

Disposition: DONE for the local fixture scope; see the acceptance section at the end. Base `b7728f0` on `feat/pi-durable`. Executed 2026-10-20 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0.

## Refreshed design

The plan was written against `bcce03e`. It was refreshed against the integrated 008 and 009 host before coding:

- The host already wrote local `host_projections` rows (assistant, run, state, version) inside the same SQLite transaction as each terminal decision: `terminal()`, the per-command completion account, and `failCandidateMember()`. Nothing delivered them to D1, so candidate assistants stayed `pending` in the product.
- `applyProductProjectionBatch` already implemented update-only, version-ordered D1 application with deletion fences, owner checks, membership checks and a per-target cursor. It was hard-coded to the `trusted_v1` owner.
- The product already exposed a `messages` row per assistant and created D1 run membership when a start or expiry decision was reconciled. Canceled and late commands never get a decision, so they have no membership.
- Pi records hold the canonical encrypted answer. The product stores redacted text. The two stay separate: the host stores only the answer entry ID and reads the text from encrypted Pi storage at delivery time.

## Implementation

| Part | Location |
|---|---|
| Contracts: `ProjectionIntentV1`, exact result parsing, stable reasons, observation snapshot and events, byte and count bounds | `packages/runtime-contracts/src/projection.ts` |
| Host: projection reason, answer entry and acknowledged version columns; `host_events` written by SQLite triggers in the same transaction as each run or assistant change; `deliverProjections()` from the durable alarm with a `projection` wakeup; read-only static `PiDurableHost.observe()` | `apps/runtime/src/pi-durable-host.ts` |
| Product session: candidate `applyProjections` dependency and owned `observe()` that never activates the host | `apps/runtime/src/pi-durable-product-session.ts` |
| Projector: runtime owner is now a parameter (`trusted_v1` default, `pi_durable_v1` for the candidate) | `apps/runtime/src/product-projector.ts` |
| Product: `CandidateProductCommands.applyProjections()` (ownership-scoped, redacts content, adds missing membership for canceled or late commands, waits for an expiry decision's own membership) and `observe()` behind the owned-session check | `apps/web/src/lib/session-command-candidate.ts` |
| Fixture product and session wiring, fault switches for apply failures | `apps/credential-tests/src/model-entry.ts` |
| Test pool: wait for closed Durable Object SQLite files before isolated-storage push and pop | `patches/@cloudflare__vitest-pool-workers@0.12.21.patch`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` |

Settlement rules:

- A terminal decision, its pending projection intents and its semantic events commit in one runtime SQLite transaction. D1 application happens later; there is no cross-store transaction.
- Assistant statuses stay `pending`, `complete` and `failed`. A completed assistant is never re-projected: later failures only change members that are still `pending`.
- Failed assistants carry one stable reason: `run_failed`, `run_stopped`, `command_canceled`, `command_expired`, `command_failed` or `target_run_terminal`.
- Delivery sends at most 16 intents per call, one call at a time; closure waits for the call in flight. Only a result array that answers every intent, in order, for the exact assistant and version, retires intents whose outcome is not `retry`. A thrown call, a short or reordered array, a wrong version or a `retry` outcome keeps the intent and reserves a `projection` wakeup 5 seconds later. The wakeup re-arms immediately only when every sent intent settled and more remain. Delivery never reruns a model or tool.
- An answer that cannot be read from Pi records keeps only its own intent pending; the rest of the batch is still sent.
- Complete content is capped at 64,000 UTF-8 bytes. The cut moves back to whitespace so a secret-shaped token is never split before the product redacts it.
- A retained `expired` decision is reconciled even when its run is already terminal or a cancel for the same command arrives first. The first review found the terminal-run case: the decision was disposed as `target_run_terminal` and never reached D1. The second review found the cancel case: the cancel disposed the record, so the expiry was never reconciled and the product answered `retry` forever. A cancel now answers `too_late` for a retained expiry. Both regression tests fail without their fix.
- Disposition reasons are stable: canceled maps to `command_canceled`, expired to `command_expired`, stopped to `run_stopped`, target-run-terminal to `target_run_terminal`, and anything else to `command_failed`.
- Product application is update-only. It never inserts message rows; a deleted message is acknowledged as `deleted` and stays absent. Late versions lose to the per-target cursor.

Observation rules:

- `PiDurableHost.observe(storage, cursor?)` reads committed host tables directly. It never opens Pi, never writes, and never changes alarms or wakeups.
- Without a cursor, or with a cursor beyond committed history, it returns a snapshot (runs, terminal assistants with reasons and acknowledgment, projection lag, safety stop) and the head position. Snapshot and head are read in one synchronous step, so no commit falls between them.
- With a valid cursor it returns up to 256 events after it, in position order, with `more` when the page is full. Repeating a cursor returns the same page.
- Events and snapshots hold identifiers, states, reasons and versions only. They hold no prompt text, answer text, crypto metadata, framework records or executor authority.
- The product handler checks session ownership before calling the runtime, and the session checks the scope and runtime authority before reading.
- The product redacts content with `redactSecrets` and then drops everything from an unterminated private key header, so a block cut by the byte cap or by the model never reaches D1.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime-contracts exec vitest run src/projection.test.ts` | passed, 2 tests: exact intents, reason and content rules, bounds; missing, short, reordered, wrong-version and unknown-outcome acknowledgments rejected |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-projection.test.ts` | passed, 6 tests: cold Stop settles all three pending assistants with `run_stopped`; late follow-ups fail with `target_run_terminal` while the completed assistant stays complete and carries the Pi answer; thrown, short, wrong-version, `retry` and lost acknowledgments keep the intent with a 5 s wakeup, and a reopened host redelivers the same version once; an injected fault before the terminal transaction leaves no projection and no event, and the retry commits both; a retained expiry whose run became terminal is still reconciled with the same decision and fails its assistant with `command_expired`; the same holds when a cancel for that command arrives before the retry |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-observation.test.ts` | passed, 3 tests: untouched storage creates no tables or alarm; snapshot then later events have consecutive positions with no gap, duplicate reads are identical, a stale cursor gets a replacement snapshot, no prompt or answer text appears; event pages are bounded and reading changes no alarm, wakeup, effect, provider call or product call |
| Product suite `apps/credential-tests/src/product-commands.worker.test.ts` | passed, 66 tests, including four new product-handler tests: a real admitted prompt settles its D1 assistant to `complete` with a synthetic `sk-` sentinel redacted, and owned observation works without opening the host or changing its alarm while a foreign user is denied; thrown, short and lost product acknowledgments keep the intent and a fourth delivery settles it with one model call; late follow-ups settle `failed` in D1 while the earlier assistant stays complete, and a deleted message is acknowledged but never recreated; an answer ending in an unterminated private key header is stored as `Synthetic partial [REDACTED]` |
| Product suite repeated 11 times with the final tree | 11 of 11 passed, with no isolated-storage failure and no stall |
| `pnpm contracts:verify` | passed, 54 tests |
| `pnpm brain:verify` | passed, 43 tests, plus 3 passed and 3 skipped in the existing suite |
| `pnpm credentials:verify` | passed, 230 tests plus 3 node tests |
| `pnpm runtime:verify` | passed, 417 tests plus 7 node tests |
| `pnpm verify` | passed: credentials 230, web 861, runner 95 |
| `pnpm typecheck` and `git diff --check` | passed |

## Product-suite teardown failure

After projection delivery was wired, the product suite failed about one run in three with `Isolated storage failed ... Expected .sqlite, got ...sqlite-shm` for a `CandidateFixtureSession`, usually followed by a stalled run. Clean `b7728f0` passed 16 of 16 runs.

Bisection with 8-run samples per variant:

- Removing delivery and projection wakeups together: 8 of 8 passed.
- Removing only the product call, only the Pi answer read, only the event triggers, only the projection wakeup, only the post-delivery wakeup repair, or only the delivery serialization: each still failed.
- Replacing both the product call and the Pi answer read with local results: 8 of 8 passed.
- Running delivery under `blockConcurrencyWhile`: 8 of 8 passed with the old tests, 8 of 10 with the new ones.

So the failure needs delivery to await non-storage I/O. A probe at the failing moment found the object's `-shm` and `-wal` files present and no open descriptor for them one second later. `@cloudflare/vitest-pool-workers` 0.12.21 calls `abortAllDurableObjects()` and then immediately unlinks storage; an object that was awaiting I/O at test end closes its SQLite connection after that, so the pop meets its `-shm` file and leaves storage half restored, which stalls later tests.

The fix is in the existing pnpm patch for that package: before pushing or popping isolated storage, the pool waits up to 5 seconds for `.sqlite-shm` and `.sqlite-wal` files to disappear. No test, deadline or production timing changed for this. The `blockConcurrencyWhile` variant was not kept because a slow product call would hold the object's input gate and risk the 30 second limit.

## Not implemented or not run

- Readiness and the active conversation generation from plan step 1 are not part of the snapshot. Health holds projection lag and safety stop only.
- Transient streaming deltas are not implemented. Observation exposes committed facts only, so old-attempt deltas after restart cannot appear; the delta contract in step 1 remains open for the plan that adds streaming.
- Exact-value redaction of project secrets is not implemented. Product-side pattern redaction (`redactSecrets`) runs on assistant content before D1. No project secret is fetched to build a redaction list, as the plan requires. Events and snapshots carry no free text.
- Backup health is not reported. It arrives with paired backups in 012, and backup-failure integration must be rerun then.
- Observation is a request/response read. There is no push subscriber, so the subscriber buffer and slow-subscriber detachment rules have no runtime component yet.
- PD38, PD39, live provider requests, hosted checks, retained activation and UI are not run.
- Retries never give up. An answer that can never be read, or an intent the product keeps answering with `retry`, retries every 5 seconds while the host is awake and never becomes `failed`. Batches take the first 16 pending rows, so 16 such rows would block the rest.
- A missing Pi answer entry projects as `complete` with no content, and nothing reports it.
- `blocked_membership` and `stale_owner` outcomes retire the intent while the D1 assistant stays `pending`; another product path must settle it.
- When the host is closed and runtime authority reads as not current, the alarm skips delivery. Pending intents wait for the next activation, which re-arms the wakeup.
- `host_events` is never pruned. Snapshots are bounded by count and silently truncate past the bound. The acknowledgment flag appears only in snapshots, not in events.
- The test-pool patch continues after 5 seconds without an error if SQLite files remain, so the race could return as a stall instead of a clear failure. Tests still end while an alarm-started delivery may be in flight; the patch tolerates that rather than removing it.

## Acceptance

The first independent review rejected 010 for the retained expiry on a terminal run. The second independent review rejected it for the same defect reached through a cancel, and otherwise found the expiry, late follow-up, deleted-target and Stop paths correct, no hot alarm loop, no secret path into events, snapshots or runtime storage, and the test-pool patch a sound test-infrastructure fix. Both defects are fixed with regression tests, and the second review's limits and evidence overstatements are recorded above. A third independent review of the cancel fix ACCEPTED it: it traced every disposition site and found none that can overwrite an unreconciled expiry. It noted one non-blocking gap: a `started` decision whose reconciliation failed, on a run that then ends, is disposed as `target_run_terminal` without reconciliation, and the product still settles that assistant because only `command_expired` waits for existing membership. It did not check a retained expiry for a command the product can no longer reconstruct.

Disposition: DONE for the local fixture scope, with the limits listed above. Live provider requests, hosted checks, PD38 and PD39 were not run.
