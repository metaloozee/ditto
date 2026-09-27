# 004 repair round 3 review

Verdict: not accepted. Continue targeted repair under the user's existing authorization. Plan 005 remains blocked.

Round three fixes the earlier command/message CAS examples, projection and gap retries, current identity pointers, acceptance-write latching, and the randomized crypto assertion. The next independent checks find ten failures in thirteen checks. These remain defects in original R1-R10, not a request for another feature set.

## Reviewed candidate and gates

Candidate `/home/ayan/ditto-worktrees/plan-004-grok` remains on base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`, unstaged and uncommitted. Nine tracked source files are modified and ten are new. Nine files changed from round two. The advisor read every repair hunk and relevant surrounding code; the other ten source files match the previously reviewed hashes. All nineteen hashes remained stable through verification.

Evidence: [round-three directory](004-repair-review-evidence/round-3/). It contains the reconstructed and hash-verified round-two source, current scope and hashes, full candidate diffs, repair delta, and independent logs.

| Gate | Advisor result |
|---|---|
| `pnpm verify`, first run | FAIL: 789 web tests pass, one new restore test times out at 5 seconds; runner phase not reached |
| `pnpm verify`, separate diagnostic without the other verification suites | PASS: 790 web and 79 runner tests, builds and typechecks |
| `pnpm runtime:verify` | PASS: 25 tests and associated gates |
| `pnpm brain:verify` | PASS: 43 tests and associated gates |
| Exact phase web tests | PASS: 49 tests |
| Exact crypto test, five independent repetitions | PASS: 5 tests each |
| Runtime typecheck, root typecheck, `pnpm check` | PASS; check retains 11 existing warnings |
| Accepted 003 probes | PASS: 23 checks |
| Setup-adapted original and additional 004 probes | PASS: 30 and 28 checks |
| Parent round-two Q probes | PASS: 14 checks |
| New parent S probes | FAIL: 10 failures in 13 checks |

The first full verification failure is preserved in `pnpm-verify.log`; the separate passing diagnostic is `pnpm-verify-sequential-diagnostic.log`. Do not replace the failed result with the later pass. The timeout occurred in `session-runtime-journal.test.ts:834`, which creates and commits 201 continuations before testing restoration and then creates 26 more commands. Contention appears relevant, but no precise timing cause is claimed.

The round-three compatibility probe copies are unchanged from round two. Their assertions remain intact. The fixture now supplies current identity pointers and a recovery-pointer table. Those setup additions are legitimate. Q01 still measures the actual product/runtime/Container application chain with substituted platform base classes and real start-method interception, not actual Cloudflare isolation.

Reproduction:

```sh
node /home/ayan/ditto/plans/004-repair-round-3-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

`additional-probes.log` preserves the first twelve checks, nine failing. `additional-probes-complete.log` includes the additional time-budget check, thirteen checks with ten failures. There are no setup errors in either run. Positive controls verify owned recovery-pointer CAS, matched-brain canonical round-trip, and valid restart followed by effect admission.

## E1. Recovery-pointer SQL is not bound to the authorized workspace

`apps/runtime/src/product-projector.ts:sessionUpdateSql`, `sessionAppliedPredicate`, and their parameter builders authorize `payload.workspaceSessionId`, but select the pointer using the independent `payload.targetId`. They never require equality.

S02 creates user 2's session and pointer, then sends an envelope authorized for user 1's session with `targetId: 'sess-2'`. The foreign pointer advances from generation 1 to 2, a cursor is created under session 1, and the operation reports `applied`.

Require exact pointer-target/workspace identity in the target UPDATE, cursor predicates and zero-row classification. Prefer a target-specific typed contract that cannot express an unrelated session target, with runtime checks at the adapter boundary. Preserve real owned-pointer updates, typed value/source CAS, stale-envelope rejection, duplicate acknowledgment and no-upsert behavior. Do not implement archive publication or another phase's allocation logic.

## E2. Controller identity is still ignored

`session-runtime.ts:matchedBrain` checks kind, state, current identity pointer and incarnation, but ignores `controllerClass`. `effectAdmissionAllowed` likewise ignores the executor's controller class. `readCurrentTrustedAuthority` already supplies these fields.

- Both S04 variants admit an effect after changing the current brain controller to `Sandbox`, or the executor controller to `SessionRuntime`.
- S05 returns decrypted canonical content to the brain identity whose controller is now `Sandbox`.

Require the exact role/controller pair from current trusted identity records before effect admission, continuation commit and canonical read. Retained identities, caller-provided lifecycle values or matching pointers cannot excuse a wrong controller. Recheck the existing retirement, incarnation and per-identity lifecycle predicates without inventing equality between unrelated brain/executor lifecycle generations. Keep valid current-brain and executor positive cases passing. No runtime authentication or downstream transport implementation is requested.

## E3. Reconciliation bypasses the fatal persistence barrier

`session-runtime.ts:reconcile` catches failures from `processReconcilePass`, logs and schedules a retry without latching. That catch includes failed local terminal transitions, not merely retryable D1 projection or scheduling failure.

S06 gives an existing run a due recovery deadline and injects an actual `UPDATE runs SET ...` failure. Reconciliation returns successfully, and a later effect in that run is admitted. The transaction rolled back, but the required admission barrier did not engage.

Apply the critical local-persistence policy to reconciliation's consumption, uncertainty, terminal and event/projection-enqueue transitions. A failed local journal transition must memory-latch even if durable latch persistence also fails. Keep D1 projection outages pending and retryable; do not conflate those remote failures with local journal failure. Preserve deliberate conflict/validation categories. Audit the remaining durability catches rather than repairing only the exact injected UPDATE.

## E4. Restoration still accepts missing content and incompatible records

`ensureCanonicalRestore` skips commands with null ciphertext without checking whether the command kind requires canonical bytes. It does not select or validate continuation `format_version`. `decryptContinuationRow` compares chunk manifest identity/digest/length/count but omits stored format compatibility.

All three S07 variants admit a new effect after restart:

1. A prompt's `ciphertext` and `ciphertext_ref` are both removed.
2. A continuation row's `format_version` changes to 999.
3. A large continuation's `large_record_manifests.format_version` changes to 999.

Validate required content according to record kind/state, exclusive inline/reference representation, compatibility metadata and referenced bytes. A control command legitimately without content must remain usable. Do not silently accept an absent prompt, incompatible continuation, contradictory format metadata or incomplete result. Preserve retained-key reads and inline/chunked positive round trips.

S10 also proves the five-second budget is enforced only at the end of full 25-row batches. A real command decryption advances an injected clock by six seconds. Restoration still starts another continuation decryption, then returns `ok`. Check the shared budget before further work across record-type boundaries and short batches, not only when a batch is full. Incomplete work must retain resumable progress, deny admissions and schedule another bounded pass. Completing validation in one large unbounded invocation is not an acceptable fix for suffix truncation.

## E5. Stop never settles after the last known effect finishes

S08 admits an effect, applies Stop, records that exact effect's result, and reconciles after both the Stop wakeup and original effect deadline. The run remains `stopping`, its assistant remains `pending`, and `nextDeadlineAt` becomes null.

`recordEffectResult` changes the effect to `result_recorded`, but no reconciliation path converts a stopping run with no unresolved writers into its canceled terminal state and pending assistant projections. The earlier P27 assertion only checked the immediate stopping state and existence of a wakeup. That was not evidence of eventual settlement.

Add bounded reconciliation for stopping runs once authoritative journal evidence establishes that their admitted effects have completed or have valid isolation/termination evidence. Commit canceled terminal state and all required assistant projections atomically. Do not treat an unknown outcome, an elapsed deadline or a schedule callback as proof that a writer stopped. Keep the distinct later-run and unresolved-writer tests passing. Re-arm unresolved Stop work until terminal or explicitly blocked with truthful observation.

## E6. Make the regression tests exercise the claimed boundaries

The new `session-runtime-journal.test.ts` test named `ProductEntrypoint routes acceptance and observation to one workspace without starts` uses `const starts = 0`, a hand-written `deliver` function, and direct `SessionCoordinator` calls. Its zero-start assertion cannot fail when the real runtime wrapper starts a container. This repeats the original R10 issue despite independent Q01 proving that a better local test is possible.

Port the actual product/runtime/SessionRuntime application path used by Q01 into an appropriate repository test. Platform base substitution is acceptable for local unit evidence if clearly stated, but invoke the actual application methods and intercept real start boundaries. Do not substitute another hand-written router or constant counter. Paid/workerd isolation evidence remains separately not run.

Stabilize the 201-record restoration test without weakening its suffix and budget assertions. Prefer efficient deterministic fixture construction, or a justified scoped test timeout if the actual operations require it. Do not raise all suite timeouts, skip records or drop the corrupt-tail assertion. Keep the failed gate log and distinguish any diagnostic rerun from original results.

## Next repair contract

Use `xai/grok-4.6`, high reasoning, in the existing isolated candidate. The executor must not spawn agents. Preserve prior source and evidence, accepted 002 R5 and legacy fences, default fail-closed admission, named-service boundaries and all original R1-R10 requirements.

Run all four behavioral generations plus accepted 003 probes, the exact phase tests, and full `pnpm verify`, `pnpm runtime:verify`, `pnpm brain:verify`, typechecks and check. Write new sanitized evidence to the candidate's `plans/004-repair-execution-evidence/round-4/`. Any setup-only probe adaptation requires a documented diff with unchanged behavioral assertions and meaningful positive controls.

No staging, commits, merges, pushes, deployment, paid tests, live/shared database operations, real providers, dependency changes, historical migration edits or downstream brain/runner implementation are authorized. The advisor will independently inspect source and repeat gates again. No user decision currently blocks these repairs.
