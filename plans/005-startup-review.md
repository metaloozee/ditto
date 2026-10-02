# 005 startup review

Verdict: R2 REQUIRES REPAIR. Named gates pass, but the advisor independently reproduced two authorization gaps with four failing boundary assertions and a passing positive control. Whole 005 remains unaccepted. Repair is running; continue automatically after verification without another user authorization.

Candidate `/home/ayan/ditto-worktrees/plan-005-codex`, branch `codex/plan-005-transport`, unchanged HEAD `13480bc7f4daf9489a0aa7cf7fea071a1115c8c3`. Implementation executor `4f07f880-6f93-412` completed the candidate. Read-only SQL/product reviewer `2edebcc2-1b8f-471` finished and identified the two blockers below. Repair executor `1377ee76-924f-487` is running with `openai-codex/gpt-6.1-sol`, High reasoning, in the same worktree. The earlier executor session was unavailable for resumption.

## Verified by advisor

- All 52 current source hashes match the executor manifest.
- All 52 before-copies match the independent shutdown checkpoint or HEAD for the two newly touched tracked files.
- Fifteen resumed changes were independently diffed and preserved in [review evidence](005-review-evidence/startup-resumed/). The earlier interrupted R2 changes also need review; a resumed-only diff is not sufficient coverage.
- All twelve exact gate invocations returned zero. Full verification reports 940 web, 97 runner, 26 runtime, 43 brain and 29 contracts tests passing, plus builds/typechecks/check. Eleven inherited lint warnings remain.
- Separate startup/dispatch/additive-migration selection: 110 PASS.
- Unchanged independent review probes: six PASS.
- Previous local named-capability experiment rerun on current source: exit zero. This remains local bundling/registration evidence, not deployment, container launch or HTTPS interception proof.
- All 52 source hashes still match after these runs.

Advisor read runtime launch/platform adapters, entrypoints, startup contracts, readiness and execution-admission policy, startup test cases, dispatch test delta, source-intent creation/configuration/migration-test/schema/fixture/doc hunks. Pinned Containers SDK start behavior was checked in installed source. The separate reviewer read the complete product startup SQL service, migration/view and corresponding authority cases, including inherited interrupted code. Its two findings were verified by advisor source reads and independent in-memory execution of the actual service/migration. Green gates did not establish complete authorization.

## Confirmed blockers

1. **Expected brain target ignored.** Admission persists `workspace_runtime_work.expectedIdentityId`, but migration 0022's command source view only reads current session links. Registration in `runtime-startup-service.ts:85-113` therefore adopts or creates a different brain despite an incompatible non-null persisted expected target. Repair must enforce the expected brain without comparing that scalar brain reference against the paired executor. Null initial intents must continue to permit assigned identities.
2. **Reservation owner incompletely checked.** Reserve checks `ownerId` but not `ownerKind`; observe/release resolution and guarded writes omit both. The released retry is also insufficiently scoped. A workspace command can reuse a builder-owned brain claim and release a foreign-target claim with otherwise matching termination evidence. Repair must check role-derived owner kind and target owner ID at every reuse/read/write/retry, including paired readiness and execution consumption. Terminated retired cleanup must remain valid.

The advisor preserved a reusable [in-memory probe](005-startup-boundary-probes.sh) and [pre-repair results](005-review-evidence/startup-resumed/authority-probes-red.log). S00 valid paired reservation PASS. S01 explicit brain target, S02 reservation owner kind, S03 release target owner and S04 released retry all FAIL. Probe exit is 1. The script writes no candidate source or database files.

`reservationGroupId` inequality alone was not confirmed as a bug. Later commands may legitimately reuse a live reservation from an earlier source. No new group policy or user decision is needed for these repairs.

## Next

On completion of repair executor `1377ee76-924f-487`, inspect its actual delta, rerun both advisor probe scripts and gates, and verify role-specific target enforcement plus reservation owner predicates at all affected boundaries. Preserve uncertainty/termination fencing and closed live eligibility. Then continue R3 model/Git brokering and R4 UI Git under the existing execution authorization. Paid gates remain NOT RUN, 006 remains blocked, and all source remains unstaged/uncommitted.
