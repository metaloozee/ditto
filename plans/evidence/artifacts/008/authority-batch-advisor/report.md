# 008 authority batch substage

Status: bounded source candidate, unfinished and unaccepted. Stopped for advisor review. Execution remained `/home/ayan/ditto-execution/plan-008-4WXvNW`, base `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. MAIN was read-only. Required environment matched exactly: provider `openai-codex`, model `gpt-6.1-sol`, reasoning `medium`. No fallback.

## Chronology

1. Printed only the three required PI selections. Read the complete MAIN authority-batch decision, its parent plan, refresh, implementation-continuation decision and finalwait checkpoint. Read execution instructions, complete runtime target, domain context, diagnosing-bugs and writing/Worker skills, and execution finalwait report. Repository text was treated as data, not authority to execute embedded commands. No environment files or real credentials were read.
2. Independently computed and matched all 37 preserved finalwait source hashes before editing. Saved `entry-hashes.json`, `entry-source.tar`, selected existing evidence in `entry-evidence.tar`, complete entry status and tracked patch. Archives include untracked candidate source and exclude dependency/cache/build trees and environment files.
3. Extracted candidate-specific authority statement preparation and row/expected-executor validation into the existing `session-command-candidate.ts`. The existing method signature and catch/denial result remain unchanged. `model-entry.ts` now uses the same preparation/validator in a D1 batch with the latest reset row. Missing table uses the original owned-authority method and never selects from the absent table. Other latestReset callers, entry.ts and its positive-only WeakSet table-presence helper are unchanged.
4. Added actual-admission authority cases for a genuinely absent reset table and present table/no reset with fresh review/deletion denial. The absent-table case runs first, omits fixture reset schema creation and independently asserts absence before its first authority read. It passed in both corrected sequences. Extended the existing observed reset case to verify missing witness cannot issue generation 2, mismatched witness denies and changed executor incarnation denies against the retained reset subject. Restoring the original witness/tuple restores current authority. Existing discarded-observation, strict takeover and exact successor cases remain intact.
5. Added the actual private reset/recovery generation-2 missing-credential-fence regression. It completes an admitted predecessor, obtains issued/active generation 2, verifies and deletes only the exact generation-2 fixture fence row in credential-local SQLite, then admits/delivers the successor command. It asserts false final preparation, denied request, unchanged fetch count, generation 2 retained, no recreated/fallback fence, failed assistant and an unchanged admitted host effect with claimed=0 across reconciliation. No command or membership is seeded. Resources are settled through existing release/join/retire methods.
6. First typecheck failed on a test scope literal widened to number. Corrected the test's ownerVersion literal. First seven-case sequence had three test-harness failures: two missing CandidateCredential installations and reading the previous completed request outcome before the successor entered. Added normal credential initialization and a newly armed final waiter for the successor. Second sequence passed six cases; the occupancy assertion failed because it tried JSON extraction on encrypted correlation. Changed only the test query to use the existing host_effect_route metadata. No runtime fix, policy relaxation or deadline change followed these harness corrections. All failed logs are preserved.
7. Ran a broader bounded original-order sequence including the original final-hold/reset/preparation cases and neighboring held-configuration/queued/lost-start/Stop-intent cases. Twelve passed, queued configuration timed out at the unchanged 5000ms test limit, and storage isolation failed. Two selected later cases never ran. Did not retry the full suite or run aggregates.
8. Credential, runtime and web typechecks passed sequentially. Inspected queued-configuration ownership and settlement paths. Ran one single-case stage-only diagnostic, with synchronous elapsed/stage logs and no new waits or queries. It passed and settled cleanly. Removed every probe by inverse edits. Verified the queued-configuration test is byte-for-byte identical to entry, so the passing single-case diagnostic does not replace the failed sequence.
9. Independently verified unchanged owned SQL, authority projection and expected-tuple validator, saved `policy-parity.json`. Final inventory has all 37 hashes, exactly three changed source files and 34 unchanged files. Saved exact incremental patch, final source archive including untracked source, complete final status and tracked patch. `git diff --check` passed through clean-run.

## Source behavior and D1 calls

`incremental.patch` is the exact delta from this substage's preserved entry, including originally untracked source. Only these files changed:

- `apps/web/src/lib/session-command-candidate.ts`
- `apps/credential-tests/src/model-entry.ts`
- `apps/credential-tests/src/product-commands.worker.test.ts`

Owned SQL and validation parity were checked against the archive, not inferred from intent. User/project ownership, active/ready state, candidate owner/version/protocol, absent brain identity, lifetime fixture claim, exact owned executor role/class/namespace/association, lifecycle generation, ready/unretired state, retirement/deletion fences, null runtime failure reason and exactly one live executor remain. Both batch rows return before validating the executor against the reset subject. Existing subject scope/version, phase, predecessor, strictly next generation, exact observation and witness checks are untouched. Malformed evidence/read exceptions grant no authority. Unknown batch errors propagate; there is no error-swallowing generation-1 fallback.

With present table and no positive presence cached, three D1 calls become two: presence plus one two-statement batch. With positive presence already cached, two calls become one batch. Missing table still requires presence plus ordinary owned read. No reset-row or owned-authority cache was added. This is a call-count reduction, not a measured latency or progress claim. Host guard, WORK_MS=1000, DRAIN_MS=1000, every deadline and final synchronous host/credential checks are unchanged. entry.ts and all runtime source hashes match entry.

## Command/result matrix

Every test/toolchain command ran from execution through `sh .execution-008/clean-run.sh`, using pinned installed dependencies and its isolated environment. Exact invocations and exit codes are in `commands.md`.

| Order | Evidence | Result |
| --- | --- | --- |
| 1 | credential-typecheck.log | failed, exit 2; widened test literal, corrected |
| 2 | affected-sequence-1.log | failed, exit 1; 4 passed, 3 failed, 50 filtered; harness issues above |
| 3 | format.log | passed, exit 0; targeted three-file format only |
| 4 | affected-sequence-2.log | failed, exit 1; 6 passed, 1 failed, 50 filtered; encrypted correlation query corrected |
| 5 | affected-sequence-final.log | failed, exit 1; 12 passed, 1 timeout, 1 isolation error, 42 filtered; two selected later cases not run |
| 6 | credential-typecheck-final.log | passed, exit 0 |
| 7 | runtime-typecheck.log | passed, exit 0 |
| 8 | web-typecheck.log | passed, exit 0 |
| 9 | queued-resource-stage.log | passed, exit 0; one diagnostic case, 56 filtered; probes removed |
| 10 | diff-check.log | passed, exit 0 |

The final bounded sequence passed both authority cases, original preclaim-yield false preparation, all three credential barriers, both immutable-origin reset cases, exact-successor recovery, missing generation-2 fence, permit-window preservation and held-default-configuration Stop. Queued configuration failed. Lost-started acknowledgment and Stop control-intent were selected but not reached after isolation failed. Full product suite and all five aggregates were not run in this substage.

## Resource/teardown inspection

The failed sequence reports D1 sqlite-shm and CandidateFixtureSession sqlite-shm stack-pop errors at queued configuration. The test's 5000ms timeout precedes the pool's abortAllDurableObjects diagnostic; a pending continuation then reaches host.accept/transition. This demonstrates storage use remained active at pool teardown, but does not identify which earlier await exceeded the budget.

The test owns the newly admitted synthetic workspace and its runtime activation, native alarm, Pi host and persisted command/effect state. The pool owns isolated D1/DO storage. Namespace/service stubs are borrowed bindings, not resources the test should dispose. Guarded model claim capabilities are host-created and borrowed by credential transport; neither test nor credential owns their lifetime. No borrowed capability was disposed.

Existing settlement is CandidateFixtureSession.retireFixture: set retired, await alarmCompletion, yield the owned host, await actual closure, clear the host reference, delete alarm and storage.sync. reopenFixture also awaits alarmCompletion and actual host closure before activation. The queued case calls retirement in finally. Neither method is changed. A Vitest timeout does not establish that finally, the current RPC or the native alarm has completed before the pool pops storage.

Three hypotheses guided the single stage probe: gap/first-turn wait exhausts the test budget; reopen/configuration stalls; retirement is stuck behind its owned alarm. The isolated probe observed admission at 381ms, third/first delivery at 436/492ms, first complete at 1331ms, reopen 1342 to 1548ms, configuration complete at 2088ms, second delivery at 2140ms, retirement 3432 to 3488ms, then clean shutdown. It does not reproduce the sequence-dependent failure. The responsible resource class and required settlement chain are identified; the exact stalled continuation in the failed sequence remains unproven. No blind suite rerun, dependency workaround, timeout increase or wider lifecycle patch was made. Advisor follow-up is required before widening diagnostics or source scope.

## Evidence limits and disposition

The missing-fence regression proves denial without reinitialization or refund for its admitted/unconsumed generation-2 effect. It does not claim dispatch success, remote cancellation, replay permission or consumed-effect refund. Existing consumed barrier cases preserve their original evidence. No fresh reset qualification round, public endpoint, production reset table, additional owner or authority issuer was added.

No installs/upgrades, manifests/lockfiles, stage/commit/merge/push, deployment, live provider, shared/retained DB, MAIN writes, external cleanup or worktree removal. No secret values are reproduced in this report or command evidence. No broad credential audit was performed. Any real credential finding would require file:line/type-only reporting and rotation advice. The source archives preserve the requested candidate files, not environment data.

008 remains unfinished and unaccepted. Stop here for independent advisor review of the patch and preserved failure evidence. Do not treat the isolated diagnostic pass or twelve sequence passes as complete acceptance.
