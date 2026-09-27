# 004 repair round 1 review

Verdict: not accepted. Continue repair without another user decision.

The executor fixed several original examples, but it has not completed R1-R10. The advisor reproduced 24 remaining failures in 28 additional checks, including positive controls. These are local candidate failures; default production admission remains closed.

## Verification and scope

Candidate `/home/ayan/ditto-worktrees/plan-004-grok`, base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`. Eleven of the original sixteen source files changed in this repair. No new source file outside the original scope, staged source or source commit was found. The advisor read every repair diff hunk and checked its surrounding implementation.

Independent results:

| Command/check | Result |
|---|---|
| `pnpm verify` | PASS: 778 web tests, 79 runner tests, builds/typechecks; 11 existing check warnings |
| `pnpm runtime:verify` | PASS: 25 tests and typechecks |
| `pnpm brain:verify` | PASS: 43 brain tests and inherited contracts/freshness/build gates |
| Exact phase web tests | PASS: 37 tests |
| Exact runtime crypto test | PASS: 5 tests |
| Accepted 003 probes | PASS: 23 checks |
| Original 004 probes | Setup error before assertions, because the new routing method requires a product binding |
| Executor's adapted 004 probes, rerun independently | PASS: 30 checks |
| Additional advisor probes | FAIL: 28 checks, 24 failures |

The adapted original probes preserve their assertions and make reasonable setup changes for workspace routing and identity seeding. However, the product binding is entirely mocked and the seeded identity uses only the legacy capacity lease. Thus those probes do not establish the real service wiring or complete execution gates. The original final-content assertion became vacuously true after the batch rollback repair. The additional positive final-content probe now verifies an actual successful write and passes.

Evidence: [round-one evidence](004-repair-review-evidence/), including `scope.json`, full candidate diffs, `repair-source.diff` against the rejected candidate, original/adapted probe logs, and `extra-probes.log`. All source hashes stayed stable through review. Current Cloudflare Worker/Container/D1 documentation was retrieved as `muh4wngnmq9nik`; no platform execution or deployment occurred.

Reproduce the new checks:

```sh
node plans/004-repair-extra-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

The new script reuses the preserved original loader and disposable fixture. It seeds the candidate's current execution identity only to reach deeper effect paths. That setup is explicitly NOT evidence that the required brain/capacity/initial-pair gates have passed. API/setup changes may be needed after the next repair, but the assertions must remain meaningful and positive controls must run under valid trusted evidence.

## Remaining repairs

Paths below are relative to the candidate checkout. Probe IDs refer to `004-repair-extra-probes.cjs`.

### C1. R1/R10: replace actual product service stubs

`apps/runtime/src/server.ts:380-406` still returns null from reconstruction/authority and an empty projection result. The repair moved the null adapters from the Container into `ProductEntrypoint`. `createProductAdapters` is only used by the fixture; there is no real product service implementation connecting it to these operations. P01 calls the actual entrypoint with a real admitted command and disposable D1 and gets null.

Implement the real narrow product service adapter in the appropriate product-side source seam, expose it through the named entrypoint, and test that actual class together with `RuntimeEntrypoint` and `SessionRuntime`. Keep the runtime import graph free of product Env/auth/UI and retain disabled deployment/admission defaults. A narrowly necessary product entrypoint/export change is within this repair; moving the nulls again or supplying all results from test mocks is not a repair.

### C2. R2: require exact execution authority, not a legacy lease

`apps/web/src/lib/session-runtime-authority.ts:61-121` drops identity kind, stable identity and controller fields, accepts states beyond ready execution, and reads only a legacy `workspace_capacity_leases` expiry. `session-runtime.ts:307-325` therefore accepts a builder or brain as executor and a lease for an unrelated identity. It has no brain-capacity or initial-pair check. P03-P05 reproduce these admissions.

Use exact trusted identity roles, process/lifecycle authority and the proper execution prerequisite contract. Do not infer initial-pair or dual-pool admission from a legacy lease. This phase must fail closed while the real downstream prerequisites are unavailable. Positive tests may inject a coherent trusted prerequisite adapter or seed its authoritative records; they must still exercise all checks and must not expose a caller-controlled enable flag. Keep the future capacity allocator and real provider execution out of scope.

### C3. R3/R4: serialize effects and preserve unresolved writers across terminal runs

`session-runtime.ts:666-735` only checks previous attempts for the same logical tool. P06 admits a different tool while the first is admitted. `journal.ts:604-611` excludes failed runs from unresolved-writer checks, so P07 marks an effect unknown, then admits a replacement run's effect despite the old unknown outcome. `journal.ts:614-623` considers any nonempty isolation reference sufficient. P08 inserts an unrelated reference and starts a replacement while the old run remains stopping.

Enforce workspace-wide effect/mutation serialization. Preserve unresolved execution independently of whether its run is terminal. Isolation/termination evidence must match the precise old identity, incarnation, lifecycle and epoch and the new replacement where relevant. A string on an unrelated observation is not proof. Existing queued runs must also recheck the workspace barrier when they later admit an effect.

### C4. R4: latch every actual durability failure and validate effect membership

P09 injects a real `INSERT INTO effects` failure, then successfully admits a later tool. The continuation/result catch blocks do not cover effect or acceptance persistence. P10 admits an effect under run A using run B's assistant ID. See `session-runtime.ts:594-754`.

Wrap every required durability barrier, including command/effect state transitions and semantic projections, in the same fail-closed persistence policy. Keep the in-memory latch if durable latch persistence fails. Validate the originating assistant and logical operation against the exact consumed run/turn before admission. Preserve identical-result idempotence, which passes its positive control.

### C5. R4: continuation authority must identify the caller's exact run and brain

`session-runtime.ts:842-951` accepts only position and arbitrary snapshot, then borrows the newest nonterminal run. P11 stops A, queues B and successfully commits A's stale snapshot. P12 changes the owner during the second authority read; the commit still compares the run to the FIRST read's owner version and succeeds.

Require a narrow trusted caller context with exact run, brain incarnation, lifecycle/owner version and expected epoch/position. Check that same context after encryption and at the local commit. Never select another run to authorize an old caller. Keep real brain transport disabled until its later phase; the private coordinator target still needs this safe contract now.

### C6. R8: guard canonical reads and restore all referenced records

`readCanonicalContinuation` at `session-runtime.ts:397-419` has no authority check. P13 obtains plaintext after the project becomes deleting. `ensureCanonicalRestore` at `:328-395` validates arguments but ignores effect results and chunked continuations. P16/P17 corrupt those retained records, restart and still admit an effect.

Authorize canonical reads only for the matched current brain transport. Validate all retained canonical records/references needed for a resumed execution, including results and chunks, with compatibility and ownership checks. Missing referenced bytes or missing old keys must block. Use bounded/incremental restore validation rather than unbounded retained-history scans in one activation.

### C7. R8/R9: persist enough authenticated manifest data to read large continuations

The crypto helper now binds `writeId`, digest and total length, and the focused splicing test passes. But `commitContinuation` at `session-runtime.ts:899-929` does not persist the new `writeId`; the journal manifest schema has no such field. The read path only supports inline ciphertext. P15 commits a 40 KB continuation, restarts, then gets `continuation_missing`.

Persist the complete versioned authenticated manifest and lengths with its immutable chunks, and implement actual chunk reconstruction/readback. Test round-trip, restart, tampered chunk, missing chunk, manifest corruption and retained-key rotation through the journal. Do not merely extend the helper tests. Inline continuation round-trip already passes and should remain working.

### C8. R6: cursor authorization and classification remain wrong

`product-projector.ts:210-235,308-346` advances message cursors when the target merely ALREADY has the requested status, without proving the incoming write was authorized. P20 sends future owner 99 to an already failed assistant: the target UPDATE is rejected, but its cursor advances to owner 99/seq 999 before classification says immutable.

`classifyZeroRowProjection` checks command expected-source version before an already-applied cursor. P18 successfully applies a command projection, repeats it, and gets `blocked_membership` instead of idempotent acknowledgment.

Make target authorization and cursor advancement inseparable within the transaction. No unauthorized envelope may mutate even cursor metadata. Classify valid duplicate/equal-or-newer results before treating their old source status as unexpected. Preserve source-conflict blocking for truly unapplied writes and the successful related-batch rollback repair.

### C9. R6: membership still lacks exact run mapping; session target is a no-op

Membership now verifies command and message IDs, but not the command's actual run relationship. P19 maps real prompt B and its genuine message IDs to run A, then fails B's assistant under A. `statementsForPayload` returns no statement for `session`, and `applyProductProjectionBatch` classifies it as already applied. P21 reproduces that false success.

Validate prompt run identity and persisted follow-up target-run membership as well as messages. Implement separate recovery/session target semantics and its source-state/CAS checks, rather than acknowledging an unsupported target. Do not add real paired-checkpoint publication or a capacity allocator from later phases.

### C10. R7: scheduling remains incomplete and can spin

P23 drains previous work, calls `recordInterruption` and observes zero scheduler calls. The method writes a wakeup but does not schedule it. P24 lets an admitted effect pass its own deadline: it stays admitted and `nextWorkDeadline` returns a time in the past. P25 leaves an ordinary delivery gap: the explicit one-second wakeup is defeated by the unconditional `now` candidate for accepted commands.

Schedule new durable intents at their creation boundary and repair the local-commit/schedule crash gap on activation/redelivery. Handle effect deadlines and cancellation/recovery work before marking their intents processed. Persist future backoff and dedupe/rearm the appropriate Container schedule; do not loop immediately on gaps or unavailable D1. Avoid unbounded `listRuns`, `listCommands` and `listActiveEffects` scans in supposedly bounded passes, and check the five-second budget inside transition work. Keep total 25-intent accounting, which improved.

### C11. R5/R10: snapshots still lie about settled follow-ups

`snapshotLocked` at `session-runtime.ts:1474-1560` looks up each assistant's run by command ID. A follow-up command has a different ID from its target run. P26 observes its D1 assistant failed after Stop while the authenticated snapshot says pending. Canceled late prompts have a similar missing-run issue.

Derive message state from persisted command/run membership and terminal command decisions, not a prompt-only assumption. Reflect the in-memory fatal latch and blocked review state accurately. Queue visibility must not claim execution is running merely because a queued run row exists. Exercise authenticated snapshots for these cases.

## Test changes required

The candidate still routes most tests directly to `SessionCoordinator`, and `dispatchAttemptCount` is just an increment inside `admitEffect`, not an actual container/transport spy. The new tests do not cover the end-to-end named service or matched-brain read/commit contract. Replace misleading counters with injected boundary observations, keeping focused SQL/crypto tests where appropriate.

The original R1-R10 are not superseded by this list. C1-C11 name remaining defects within them, not new product scope. No user decision is needed. Preserve the repaired behavior already demonstrated, rerun all original checks plus these deeper checks under valid setup, and continue independent review after the next executor handoff.
