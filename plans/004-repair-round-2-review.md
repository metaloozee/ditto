# 004 repair round 2 review

Verdict: not accepted. Continue targeted repair under the existing user authorization.

The candidate improves the real product entrypoint, large-continuation round-trip, effect serialization and exact continuation-call fields. It still violates the original projection, recovery scheduling, canonical restoration and authority requirements. No architecture choice or production permission is needed to fix these local defects.

## Independent verification

Candidate: `/home/ayan/ditto-worktrees/plan-004-grok`, base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`. Nine tracked source files are modified and ten source files are new. Twelve files differ from round one. Source hashes remained stable through review; no source was staged or committed.

| Gate | Advisor result |
|---|---|
| `pnpm verify` | PASS: 780 web tests, 79 runner tests, builds/typechecks; 11 existing warnings |
| `pnpm brain:verify` | PASS: 43 brain tests plus contracts/freshness/build gates |
| Exact phase web tests | PASS: 39 tests |
| `pnpm runtime:verify` | FAIL: 24 tests pass, one crypto assertion fails; runtime typechecks passed |
| Accepted 003 probes | PASS: 23 checks |
| Executor's setup-adapted original 004 probes | PASS: 30 checks |
| Executor's setup-adapted additional probes | PASS: 28 checks |
| New independent round-two probes | FAIL: 14 checks, 12 failures |

Evidence is preserved under [round-two evidence](004-repair-review-evidence/round-2/). It includes full source hashes/diffs, the repair delta, gate logs, both adapted probe logs and `additional-probes.log`. The advisor read every repair hunk and relevant surrounding code. The product entrypoint/export is a justified narrow source addition, not an unauthorized routing or deployment switch.

The adapted probes retain their assertions. Setup changes for the new product class, trusted prerequisite fixture, continuation caller fields and awaited interruption scheduling are justified. They are not sufficient acceptance evidence by themselves.

```sh
node plans/004-repair-round-2-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

Q01 now exercises the actual product entrypoint, runtime entrypoint and Container class together with disposable D1/SQLite and substituted platform base classes. Acceptance, duplicate receipt and observation share one workspace object, with no start-method calls. This establishes local application wiring, not Cloudflare isolation. Q11 also confirms a different brain incarnation is denied canonical reads.

## Required fixes

### D1. Restore real projection CAS, not only cursor CAS

`apps/runtime/src/product-projector.ts` removed the per-target cursor guard from `messageTerminalUpdateSql` and `commandUpdateSql`. Cursor statements now run first, but their predicates omit owner authority, deletion fences and exact command/run membership. A target UPDATE does not check whether those cursor statements succeeded.

- Q02 applies command sequence 10, then supplies sequence 9 with the target's current source version. The target regresses to 9 and the adapter reports applied.
- Q03 sends owner 99 for a pending assistant. Its target is unchanged, but the cursor becomes owner 99 and classification says already applied.
- Q04 supplies the wrong run for a pending assistant. It manufactures cursor sequence 50 and likewise reports already applied.

Repair the whole transaction invariant. A target mutation must require an incoming lexicographically newer owner/sequence and all source/membership/lifecycle/fence predicates. Cursor advancement must require the SAME authority and a successful authorized transition or a genuinely validated pre-existing result. Moving the cursor statements before the target does not achieve this by itself. Restore the target-side version guard and make rejection leave both target and cursor unchanged. Preserve duplicate acknowledgment and rollback of related targets.

Also complete the session/recovery target promised by the plan. Current `sessionUpdateSql` only increments `workspace_sessions.productProjectionVersion`; it ignores the requested recovery change and treats the magic source string `healthy` as permission. That is not a recovery-pointer projection. Use a typed target-specific source/version/value contract against the existing `runtime_checkpoint_pointers` records, or an explicitly applicable product target, with actual values and cursor committed together. Do not implement later-phase archive publication or allocation, and do not silently acknowledge unsupported target fields.

### D2. Schedule every pending projection and every later gap retry

`journal.ts:nextWorkDeadline` now considers wakeups, run recovery and effect deadlines but excludes pending projections. `processReconcilePass` marks due wakeups processed before leaving failed or budget-deferred projections behind.

- Q05 injects D1 failure during terminal projection. Four pending projections remain, `nextDeadlineAt` is null and no schedule is made.
- Q06 leaves 29 projections after a bounded pass; no next pass is scheduled.
- Q07 fires the first missing-predecessor retry. Consumption sees the existing due gap intent and does not create another; the pass then marks that intent processed. The command remains accepted with no future retry.

Derive the next wakeup from all durable work with a persisted future retry time. Re-arm unresolved gap work after the due intent is processed, rather than mistaking that due intent for an already scheduled future retry. Test a complete sequence of callbacks with an advancing clock and no browser calls, not just the first schedule. Preserve bounded 25-intent/5-second work and future backoff. Every terminal/projection-producing transition must leave durable future work until acknowledgment.

### D3. Never mark a partially checked journal restored

`SessionCoordinator.ensureCanonicalRestore` persists `canonical_restore_offset` across activations, silently selects only 200 effects and 200 continuations, and marks the restore `ok` after breaking its command loop on the time budget.

- Q08 completes one validation, tampers with that command, restarts again and admits an effect. The persisted offset skips the previously checked row.
- Q09 corrupts continuation 201. Restart checks only the first 200 and admits an effect.
- Q10 exhausts the restore time budget with a corrupt command after the first 25. The method returns success and sets `canonicalRestore` to `ok` despite the unchecked suffix.

Use bounded staged/keyset traversal with an explicit incomplete state. Admission stays closed until every record required for the restored state is validated. Resume progress across bounded passes, but do not trust an old activation's validation offset after keyring/state changes without authenticated evidence. Reset/revalidate on a new activation or bind any reusable validation proof to the full state/key identity. Never drop a suffix to meet a time or row limit. Validate actual referenced result/chunk bytes and format compatibility, not only existence. Tests need repeated restarts, more than 200 records and budget exhaustion as well as the single-record corruption cases that already pass.

### D4. Bind the current brain and reject archived ordinary consumption

`readCurrentTrustedAuthority` reads all retained identity rows but omits the workspace's authoritative `brainIdentityId` and `sandboxIdentityId` pointers. `matchedBrain` accepts any ready retained brain. Q12 switches the current brain pointer and still commits under the old ready brain.

`assertFreshAuthority` only rejects a deleted workspace. Q14 accepts N+1, archives the workspace, then delivers N; both ordinary prompts become queued runs. The effect gate's separate archived check does not establish the required consumption policy.

Carry and validate exact current identity pointers and relevant controller/lifecycle fields through the trusted adapter. Require the current brain for continuation access/commit. Revalidate active lifecycle at ordinary consumption, including after awaited prerequisite/reconstruction work. Controls and terminal projection for archived history must still work; do not blanket-reject those paths. Admission to real execution remains closed until the later prerequisite implementation exists.

### D5. Apply fatal persistence policy to acceptance and all other critical transitions

The new `admitEffect` catch block fixes its INSERT failure, but `acceptCommand` still commits through an unwrapped transaction. Q13 fails a real command INSERT while another run exists, then admits another effect in that run.

Audit every durability transition: acceptance, controls, effects/results, continuation, uncertainty/terminal settlement and interruption. Unexpected storage failure must latch later admission, even if the durable latch write itself fails. Validation/conflict errors should retain their intended categories rather than being mislabeled as persistence errors. A common internal transition wrapper is justified if it prevents further missing catch paths; this is not a request for a broad refactor.

### D6. Make the crypto privacy test deterministic and meaningful

Independent `pnpm runtime:verify` failed in `runtime-crypto.test.ts:142` because random encoded ciphertext happened to contain the three-character string `xxx`. The test encrypts 40,000 repetitions of `x`, then searches the complete random envelope for `xxx`. That is not a valid plaintext-leak detector and it is genuinely flaky.

Replace the fixture/assertion with a sufficiently distinctive full synthetic plaintext marker and a meaningful encoded-record scan, while retaining authenticated round-trip, nonce/AAD, chunk-integrity and missing-key assertions. Do not lower the encryption requirement, stub randomness, skip the test or rerun until green and claim the original gate passed. Preserve this failed log and rerun the repaired test repeatedly before the final runtime gate.

## Next handoff

These are remaining defects in original R1-R10, not a new feature set. Preserve the fixes already established, especially real product-service wiring and non-vacuous large-continuation round-trip. Add Q01 and the relevant regressions to the repository's nearest test seams so they are not maintained only in advisor scripts.

Run all previous behavioral checks and these new checks under valid setup. Passing the original examples must not be achieved by introducing another authorization or durability hole. Source stays uncommitted; production defaults and all user prohibitions remain unchanged.
