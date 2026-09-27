# 004 execution review

Verdict: **REJECTED. Plan 004 is incomplete and unsafe to use as the prerequisite for 005.** The candidate passes its existing tests and inherited gates, but independent probes reproduce failures in authority checks, Stop, journal barriers, projections and scheduled recovery. Production trusted admission remains disabled, so these are failures in the local candidate, not evidence of an enabled production exploit.

## Candidate and scope

- Executor: `xai/grok-4.6`, agent `0caa8fd9-c49b-4aa`.
- Candidate: `/home/ayan/ditto-worktrees/plan-004-grok`, branch `grok/plan-004-coordinator`, base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`.
- Source remains uncommitted: seven modified files and nine new files. No staged changes.
- Advisor: `/home/ayan/ditto`. The advisor edited only `plans/`, read all candidate source/test changes, and ran verification in the isolated candidate.
- No source repair, merge, push, deployment, live database operation, real provider call or paid platform validation occurred during review.

The [scope manifest](004-review-evidence/scope.json) records the exact source hashes. The [tracked diff](004-review-evidence/candidate-tracked.diff) and [added-file diff](004-review-evidence/candidate-added.diff) preserve the reviewed candidate. Changes are within the plan's implementation/test seams, including the narrow new product adapter and necessary test/type wiring. Historical migrations, Alchemy, manifests/lockfiles, legacy policy and runner/brain source are unchanged. The scope is reasonable; the implementation does not satisfy it.

The improve skill's `references/closing-the-loop.md` was unavailable. Execution followed the explicit user-supplied isolated-executor and independent-review rules, without claiming compliance with an unread reference.

## Independent verification

Node `v24.21.0`, pnpm `11.8.0`, npm `12.0.2`.

| Gate | Advisor result |
|---|---|
| `pnpm verify` | PASS: Biome, web typecheck, 72 web files / 774 tests, web build, runner typecheck, 79 runner tests and runner build. |
| `pnpm check`, included above | PASS with 11 existing warnings. |
| `pnpm runtime:verify` | PASS: runtime typechecks and 24 tests. |
| `pnpm brain:verify` | PASS: 14 contracts tests, contracts build/typecheck, copied-consumer freshness, 43 brain tests and brain build/typecheck. |
| Exact phase-004 web command | PASS: journal, control and delivery, three files / 33 tests. |
| Exact runtime crypto command | PASS: four tests. |
| Inherited `003-repair-probes.cjs` | PASS: 23 checks / zero failures. |
| Independent `004-review-probes.cjs` | **FAIL: 30 checks / 29 failures.** |
| Diff and staged-source checks | PASS; no staged candidate files or advisor source edits. |

Logs are in [004-review-evidence](004-review-evidence/). Brain freshness selects three tests and skips three unrelated cases before the full 43-test suite runs. Runtime tests retain the installed workerd compatibility-date fallback from `2026-09-16` to `2026-03-10`. These are local results only.

Reproduce the independent checks from the advisor checkout:

```sh
node plans/004-review-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

The reviewed candidate exits 1 with 30 checks and 29 failures. Failures assert required behavior, not successful reproduction of a bug. The script loads actual candidate modules with TypeScript transpilation and disposable SQLite. It invokes captured production POST/GET handlers with mocked auth, and calls private coordinator/projector operations to inject faults and test their contracts. Only the two service-wiring probes substitute the platform base classes; those establish application routing and adapter behavior, not workerd RPC or Cloudflare isolation. No real model, tool or container executes. The foreign-owner observation check passes.

The 29 failed assertions are grouped below. They are not 29 unrelated implementation plans.

## Blocking findings

All source references below are relative to the candidate root and were read directly by the advisor.

### R1. The named service does not reach a functioning workspace coordinator

`apps/runtime/src/server.ts:159-183` builds the coordinator with reconstruction and authority adapters that always return null, a no-op projector, and owner/project identities of `unknown`. `:242-260` routes delivery and Stop by `commandId` but observation by `sessionId`. The Container exposes acceptance/control/snapshot only, not the effect/result/continuation operations required by the exit contract.

The service probes record three different object names for a command, its Stop and its snapshot. The actual Container method returns `command_missing`. Its effect and continuation methods are absent. The fixture instead reconstructs the command, obtains the real owner/session, and directly constructs a `SessionCoordinator` at `apps/web/src/test/session-runtime-fixture.ts:272-326`; this skips the broken service wiring.

Required repair: reconstruct and validate the durable command through the narrow trusted product adapter, resolve the permanent workspace identity, and route every operation to that one coordinator. Wire its real authority/projection adapters and required private operations. Test the named service/class path without enabling default admission, starting Pi, or deploying it. Keeping ordinary-user eligibility disabled is correct and must remain unchanged.

### R2. Admission does not enforce current ownership, lifecycle or identity

`session-runtime.ts:280-350` reads authority but does not compare its version with the reconstructed command and handoff version. It trusts `input.ownerVersion` when persisting the command. Consumption later runs synchronously without another authority check. `:414-552` checks only a subset of owner/session state before admitting an effect; it does not establish current process identity, lifecycle, owner version, active workspace status, project availability or the downstream execution prerequisites. `apps/web/src/lib/session-runtime-authority.ts:18-66` hardcodes lifecycle generation to 1.

Probes show an old version-1 command consumed after D1 advances to version 3, and a version-1 command acknowledged and stored with supplied version 99. Effects are admitted for archived sessions, deleting projects, lifecycle generation 900 and an executor incarnation with no identity record. Queued runs can admit effects without the required capacity/initial-pair gates.

Required repair: validate exact persisted owner/project/session/command identities and versions, read actual lifecycle/process authority, and recheck local epoch/barriers after asynchronous preparation. Consumption and trusted effect dispatch need fresh authoritative policy checks. Keep real execution closed until downstream gates exist; local fakes must exercise those checks rather than bypass them.

### R3. Stop falsely settles live execution and permits replacement

`session-runtime.ts:926-993` immediately changes a targeted run to `canceled`, without cancellation reconciliation or stopped/isolation evidence. It advances a workspace-wide epoch while leaving other runs' epochs unchanged. `:887-924` creates another queued run without examining unresolved writers, and effect admission accepts it.

With one admitted unresolved effect, Stop reports `canceled` and a new run admits another effect while the old effect remains `admitted`. Separately, stopping run A makes a follow-up for distinct later run B become `denied` because B no longer matches the global epoch.

Required repair: preserve `stopping`/blocked state until the exact old execution is accounted for, record cancellation intent, and deny replacement mutation while an old writer remains reachable. Apply the barrier to the targeted run without invalidating B. Platform termination or independently verified isolation is required where the plan calls for it; lease expiry and local flags are not substitutes.

### R4. Effect and continuation persistence barriers are incomplete

`session-runtime.ts:469-552` accepts an existing pending effect without comparing its arguments/incarnation and permits a second attempt while the first is admitted. `:640-650` marks an outcome unknown but does not fail/block the run. `:653-737` commits a continuation using only its position; it has no current run/owner/epoch/incarnation barrier and does not latch persistence failures.

Probes accept changed arguments and a different incarnation for the same pending effect, admit attempt 2 concurrently, and admit a different tool after an unknown outcome. A continuation still advances after Stop. Injecting an actual failed continuation INSERT rolls back that commit but leaves the fatal latch false; a subsequent effect is admitted.

Required repair: make the logical operation immutable, distinguish safe retries from possibly dispatched work, serialize effects, reconcile unknown outcomes, and enforce exact result/continuation authority. Every failed durability barrier must block subsequent admission, including when the journal cannot persist the latch itself. The current `forceFatalLatch()` test helper at `:801` does not establish that real persistence failure triggers this behavior. Preserve the implemented identical-result dedupe and conflict rejection while extending the missing cases.

### R5. Terminal assistants and command ordering remain incorrect

`session-runtime.ts:825-885` consumes follow-ups without persisting their run membership and denies some commands without terminal projections. `:999-1007` stores cancellation by command ID but cannot resolve the missing sequence until the canceled command itself arrives. `:1029-1066` settles only the originating assistant. `startRunFromPrompt` does not enforce the persisted queue deadline.

After a prompt, accepted follow-up and Stop, D1 contains assistant states `failed,pending` with projection lag zero. Stop delivered before its target prompt leaves that prompt canceled but its assistant pending. A durable cancellation still leaves N+1 waiting until N arrives. A prompt delivered after its 15-minute queue deadline becomes a queued run with a pending assistant.

Required repair: retain exact membership for every accepted turn; cancel/deny/expire work through durable decisions that also enqueue the correct assistant and command projections. A durable predecessor cancellation must advance ordering without executing the canceled instruction. Do not use dispatcher expiry to settle trusted execution.

### R6. The projector can acknowledge unapplied writes and settle unrelated assistants

`apps/runtime/src/product-projector.ts:182-208` inserts membership without verifying the referenced persisted command and its exact message mapping. `:294-327` updates/inserts the cursor regardless of whether the target UPDATE matched. `:439-492` applies each target in a separate D1 batch, treats every membership attempt as applied, and classifies zero-row writes after its own cursor advance. The successful UPDATE predicates omit deletion fences. `:117-150` changes message status but ignores `contentRedacted`; the `session` target has no target update at all.

Independent SQL probes establish:

- A membership for a nonexistent command can authorize failing another command's assistant.
- A command target remains at projection version 5 after an expected-source mismatch, yet its cursor advances to 9 and the result says `already_applied`.
- A retained deletion fence does not prevent the assistant UPDATE while the product row remains present.
- A later related command update failure leaves the assistant committed instead of rolling back both targets.
- A successful `complete` projection leaves the assistant's content empty despite supplied redacted final content.

Required repair: tie exact command/run/message membership, lifecycle and tombstone predicates to the actual target mutation. Commit related targets and their cursors in one bounded transactional batch. Advance a cursor only with an authorized target write or a correctly classified pre-existing result, never to manufacture that classification. Implement separate command/recovery target semantics and immutable completed assistants. Owner-change classification must use authoritative rechecks through the whole classification read, not just before it.

### R7. Durable scheduling does not guarantee another reconciliation pass

`session-runtime.ts:787-799` schedules only when projections exist, ignoring pending wakeup intents. Existing-command acknowledgment returns at `:305-316` without schedule repair. `recordInterruption` at `:805-813` persists a deadline but creates no deadline wakeup. `apps/runtime/src/reconcile.ts:67-87,150-166` counts up to 25 wakeups plus 25 projections, and next-deadline selection excludes recovery deadlines. Command consumption and run scans happen before the bounded loop and are unbounded.

A gapped accepted command has a persisted pending wakeup but zero scheduler calls. Once existing intents/projections drain, a persisted recovery deadline yields `nextDeadlineAt: null` and no scheduled callback. One reconciliation pass reports 50 processed intents.

Required repair: derive supported Container scheduling from all durable pending work, including recovery/effect deadlines and missing-predecessor retry. Repair the acceptance-commit/schedule crash gap and duplicate-ack path. Enforce one total work/time budget across transitions and projections, with durable backoff. The pinned Container scheduler deletes one-shot callbacks after catching their errors, so throwing alone cannot supply retry. The candidate correctly uses `Date` and does not override `alarm`; preserve those choices.

### R8. Encrypted storage has no validated restore/continuation read path

The coordinator writes ciphertext but never calls decryption or validates retained canonical content when rebuilding state. See `session-runtime.ts:231-248,653-737` and `journal.ts:180-260`. `apps/runtime/src/server.ts:159-183` also reconstructs identity from placeholders rather than retained authoritative ownership. Focused crypto functions correctly reject tampered ciphertext and missing keys, but the coordinator does not use that protection during restore.

A persistent journal can restart with corrupted command ciphertext and still admit an effect. Reinitializing retained state with only a new key, omitting the key needed to decrypt its existing records, also admits an effect. There is no matched-brain continuation read operation to establish the required restore-time behavior.

Required repair: provide the Worker-owned bounded canonical read/restore path, validate retained versioned state and its owner/session/record bindings before continuation or effect admission, and fail closed on missing keys or invalid records. Redacted history may remain readable where safe; it must not imply canonical state is resumable. Do not move decryption into the container or use the auth secret.

### R9. Chunk manifests are not authenticated as one record version

`runtime-crypto.ts:119-127,324-424` binds each chunk to record ID, ordinal and chunk count, but stores total length and whole-record digest in an unauthenticated manifest. Two writes of the same record ID with the same chunk count can be spliced. The probe combines one authenticated chunk from each write and supplies the digest of the known synthetic combination; decryption accepts a record that was never written as a whole.

Required repair: authenticate the manifest and its complete ordered chunk references, lengths and write identity, or bind those values into the authenticated per-chunk context. Enforce total payload/chunk limits before allocation. Keep fresh nonces and retained read keys. Test cross-write splicing, reordered/truncated chunks and manifest tampering, as well as actual journal restore. This is a stored-record integrity defect, not a break of AES-GCM itself.

### R10. The new tests bypass the boundaries that would reveal these failures

Most journal/control assertions call `coordinator()` and its mutable SQL directly instead of observing the production command/snapshot service. The only no-wake assertion reads `containerWakeCount`, initialized to zero at `session-runtime.ts:218` and never connected to a container start method. The persistence test sets the latch manually. The deletion test inserts a fence but checks only row count, so it misses the forbidden status write. The cancellation test delivers N after canceling it, so it does not prove cancellation alone resolves the gap.

Required repair: test the named service and production Container adapter with injected storage/transport/process faults, while asserting authenticated receipts/snapshots and actual attempted container/effect calls. Keep focused SQL/crypto tests for storage invariants. Introduce the missing cross-owner, real persistence failure, partial batch, unresolved-writer and restore checks. Do not rename the current shallow tests as full T06/T07/T15/T16/T25/T26/T31 coverage.

## Retained value and rejected interpretations

The candidate has useful local SQLite schemas, transactional acceptance/dedupe, encrypted command/effect writes, focused AES-GCM/AAD/key-rotation checks, result conflict rejection, authenticated GET ownership checks, and several projection retry tests. Those can remain foundations for repair; none changes the verdict.

Not findings: keeping default trusted admission unavailable, keeping real provider/Pi/tool execution off, retaining legacy fences, leaving Alchemy/live bindings untouched, and retaining the approved R5 product adapter boundary. Those are required safety choices. A factored coordinator implementation behind one Container class is not itself a forbidden third coordinator. Fixed synthetic test keys are not discovered credentials.

The adapter omission is different from deliberately disabled public routing: the plan requires a usable private/local coordinator implementation even while admission remains disabled for ordinary users. Similarly, accepting unknown process evidence conservatively is correct; declaring cancellation complete and admitting replacement without that evidence is not.

## Handoff

Do not merge this candidate or start 005. Repair must use the existing isolated worktree without overwriting its source or historical evidence. No repair executor was dispatched by this review.

Recommended repair order:

1. R1 and R10: make the private service/Container path testable and real while preserving closed defaults.
2. R2, R3 and R4: establish authority, per-run Stop, execution serialization and durability barriers.
3. R6 and R5: repair transactional projections and complete per-turn settlement/ordering.
4. R7, R8 and R9: complete autonomous recovery scheduling and validated encrypted continuation restoration.
5. Re-run every phase/inherited gate and independent probes; review the changed source again. Refresh probes if APIs change, but preserve their behavioral assertions.

The review covers the candidate's source and local contracts. It does not certify later Pi integration, capacity allocation, paired R2 publication, full deletion cleanup, real-cookie authentication, live Cloudflare process identity/isolation, paid topology, deployment or cutover.
