# 004 repair review record

Status: ACCEPTED LOCALLY after round-seven independent review. All repository gates and 129 behavioral checks pass. See [acceptance review](../004-repair-round-7-review.md) and [accepted source hashes/logs](round-7/). Earlier rejections and failed logs remain historical evidence. Source is uncommitted; integration and 005 execution have not started.

The user authorized repairing R1-R10 with `xai/grok-4.6` and repeating targeted repair plus independent review until accepted or genuinely blocked. The advisor may edit only root `plans/`; source work belongs to the executor. No staging, commits, merges, pushes, deployment, live databases, real providers or paid platform operations are authorized.

## Dispatch

- Executor: `5bb27f77-19c0-4e5`, named `plan-004-repair`, model `xai/grok-4.6`, high reasoning.
- Source worktree: `/home/ayan/ditto-worktrees/plan-004-grok`.
- Branch: `grok/plan-004-coordinator`.
- Base: `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`.
- Starting candidate: seven modified source files and nine new source files. All match the initial review's SHA-256 manifest. No staged changes.
- Resume of original agent `0caa8fd9-c49b-4aa` returned `Agent not found`. The new executor received a self-contained handoff with the exact existing worktree, authoritative parent review paths and concrete repair instructions.
- The improve skill's `references/closing-the-loop.md` still returns ENOENT. The explicit user-authorized execution/review procedure governs this run.

The executor reads the parent's uncommitted plan/review/probes by absolute path. It may not edit those files. Its own sanitized logs and any documented probe-setup compatibility copy belong under the candidate's `plans/004-repair-execution-evidence/`.

## Preserved baseline

These are historical inputs, not repaired-candidate results:

| Input | SHA-256 |
|---|---|
| `plans/004-review-probes.cjs` | `17321792f22263c2545796d5e465d300c2fa9f4a99be550fbf55d29a99f3c431` |
| `plans/004-execution-review.md` | `dcbd881a16adeb9f1be77b5d333a8980ae25c04770b0bbf9b9af8ec65b8bdbf2` |
| `plans/004-review-evidence/scope.json` | `e9f8b412683ac3d3eb45f5f032c951e0f90ba64e6e284591f4b239561a2f3c8b` |

The initial 30-check probe run failed 29 checks. Existing phase/inherited gates passed. Historical logs/diffs remain in `../004-review-evidence/` and must not be overwritten by repair results.

## Round-two dispatch

Resume of executor `5bb27f77-19c0-4e5` returned `Agent not found` after its result was retrieved. A fresh `xai/grok-4.6` executor, `a8b07d37-43c7-4fe`, named `plan-004-repair-2`, received the preserved candidate, complete C1-C11 handoff and both independent probe files. The same isolation and safety rules apply. It must write new evidence to the candidate's `plans/004-repair-execution-evidence/round-2/`, not overwrite earlier results.

Round-one source hashes and complete diffs are preserved here. `before-repair/` reconstructs the original rejected source from its saved diffs and was checked against every original hash. `repair-source.diff` records all eleven repaired-file deltas. `scope.json`, `candidate-tracked.diff` and `candidate-added.diff` describe the reviewed round-one candidate. All hash checks were stable through its verification.

`extra-probes.log` records the 24 remaining failures; positive controls verify existing effect-result dedupe, inline continuation and successful final-content projection. Those successful controls do not imply the missing execution authority gates are satisfied. Original and executor-adapted probe logs distinguish setup incompatibility from passing assertions.

## Round-three dispatch

The user explicitly said Continue. Resume of `a8b07d37-43c7-4fe` again returned `Agent not found`. Fresh executor `b499ccb6-70b0-41b`, named `plan-004-repair-3`, uses `xai/grok-4.6` and received the existing uncommitted candidate, full D1-D6 handoff and all three independent probe generations. New executor evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-3/`.

Round-two hashes, full source diffs, repair delta and exact gate logs are preserved in `round-2/`. Q01 confirms the real product/runtime/Container class chain works locally with no start calls; Q11 confirms foreign-brain canonical reads are denied. The twelve failures concern projection CAS/cursor authorization, retry scheduling, truncated restore validation, current-brain/archived-consumption authority and acceptance-persistence latching. The failing crypto gate is a separate randomized-test defect and must not be erased by rerunning until green.

No source has been staged or committed. All no-production/no-live-database/no-provider restrictions remain in force. No additional user decision is needed for D1-D6.

## Round-four dispatch

Fresh executor `30d258b4-1450-482`, named `plan-004-repair-4`, uses `xai/grok-4.6`, high reasoning, in the same candidate. It received the complete E1-E6 handoff, original R1-R10 requirements and all four independent probe generations. New executor evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-4/`.

Round-three hashes and full source diffs are preserved in `round-3/`; all nineteen source hashes were stable through review. New checks confirm a cross-workspace recovery-pointer update, wrong-controller effect/read authorization, unlatching reconciliation write failure, missing/incompatible canonical content, unbounded short-batch restoration and stranded stopping runs. The review also rejects the new constant zero-start test and records the full-suite timeout without hiding its passing diagnostic rerun. Positive controls preserve owned recovery CAS, current-brain round-trip and valid restart/effect admission.

No additional user decision is needed for E1-E6. The source remains unstaged and uncommitted. Plan 005 stays blocked.

## Round-five dispatch

Resume of `30d258b4-1450-482` returned `Agent not found`. Fresh executor `497c0d88-6aa9-415`, named `plan-004-repair-5`, uses `xai/grok-4.6`, high reasoning, in the same candidate. It received the F1-F4 review, all original requirements and every prior probe generation. New executor evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-5/`.

Round-four source hashes, full diffs and independent logs are preserved in `round-4/`. All nineteen hashes stayed stable during review. New checks find failed termination results accepted as evidence, stable identity confused with incarnation, Stop retries scheduled in the past, reconciliation time/row bounds bypassed and a healthy journal permanently latched after one scheduler failure. A positive check confirms bounded restoration completes across later passes and allows valid execution admission under trusted fixtures.

No source has been staged or committed. No new user decision is needed for F1-F4. Plan 005 remains blocked.

## Round-six dispatch

Completed executor `497c0d88-6aa9-415` was no longer available through the agent-result tool. Its candidate summary and source were reviewed directly. Fresh executor `55ef57a3-84fd-452`, named `plan-004-repair-6`, uses `xai/grok-4.6`, high reasoning, in the same candidate. It received the G1-G4 handoff, original requirements and all prior probe generations. New executor evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-6/`.

Round-five hashes, full diffs and independent logs are preserved in `round-5/`. All nineteen source hashes stayed stable through review. V02 shows a transient first scheduler failure leaves a delivered outbox row with zero callbacks even after another dispatcher drain. V03 confirms the retry helper swallows a real journal write failure. V04 shows Stop bypasses the persisted recovery deadline. V05 shows one terminal projection scans all sixty-one commands. V01 confirms ordinary delivery successfully arms a callback.

No source is staged or committed. No new user decision is needed for G1-G4. Plan 005 remains blocked.

## Round-seven dispatch

Fresh executor `95618f3a-b8c1-458`, named `plan-004-repair-7`, uses `xai/grok-4.6`, high reasoning, in the existing candidate. It received the H1/H2 review, original requirements and every preceding probe generation. New executor evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-7/`.

Round-six source hashes, complete diffs and independent logs are preserved in `round-6/`. All nineteen hashes stayed stable through review. W02 catches effect dedupe returning success without repairing scheduling after admission persisted through an outage. W03 catches all sixty-one membership rows being processed in three pages within one expired-budget callback. W01 proves sustained outage retains outbox ownership and later deduped recovery; W04 proves the memory latch still blocks admission when its durable write also fails.

No source is staged or committed. No new user decision is needed for H1/H2. Plan 005 remains blocked.

## Final independent acceptance

The advisor reviewed round-seven source, confirmed all nineteen hashes stayed stable, and independently passed root/runtime/brain gates, phase tests, all previous probe generations and four new completion checks. No source is staged or committed and the parent has no non-plan changes.

J01 proves a failed terminal-work INSERT rolls back terminal state and latches admission. J02 restores a persisted page cursor after restart and settles all thirty-one assistants through future callbacks. J03 proves a failed cursor commit rolls back its page projections. J04 confirms a changed retry payload cannot extend the scheduled effect deadline or redispatch the effect. H1/H2 and original R1-R10 are closed within phase-004 local scope.

The repeat-repair loop has stopped at acceptance. No further executor is running for 004. Source integration requires separate authorization; 005 must use these accepted files and has not started. Platform, live-provider and production-enablement evidence remain outside this acceptance.

## Independent review procedure

After executor completion:

1. Inspect actual source changes against both the accepted base and the preserved rejected-candidate diffs. Read every changed/new file. Check default admission remains closed, public history does not wake containers, and no source scope or permission boundary was crossed.
2. Map R1-R10 to implementation and behavioral tests. Verify the actual private named-service/Container path, not merely direct `SessionCoordinator` fixture calls.
3. Run the original probes. Where repaired APIs require new setup, preserve their assertions in an independent updated probe, document the adaptation and keep the original baseline. Fixture incompatibility is neither a failed invariant nor a passing test.
4. Add positive controls under valid trusted authority. A blanket denial cannot prove a working coordinator. In particular, confirm matched effect/result dedupe, continuation commit/read, command ordering, terminal content and projection retries. Test final-content success separately from the deliberately rolled-back batch; a rollback must not make that content assertion vacuously pass.
5. Inject real persistence/scheduling/authority faults. Confirm failures cross the intended code path before interpreting the result. Preserve command, assistant and run identities when testing later epochs and ownership races.
6. Independently run all plan commands and inherited gates, including the 23 accepted 003 probes. Keep exact exit statuses and test counts. Do not use a build/test pass as a substitute for behavioral evidence.
7. Send concrete remaining defects to the executor for another repair round. Stop only for acceptance or a genuine decision/permission blocker. Do not ask the user to coordinate routine corrections.

No source commit or merge follows acceptance without a separate explicit request.
