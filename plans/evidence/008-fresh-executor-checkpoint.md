# 008 fresh executor checkpoint

2026-10-11. Candidate remains unfinished and unaccepted.

Environment check confirmed PI_PROVIDER=openai-codex, PI_MODEL=gpt-6.1-sol and PI_REASONING_LEVEL=medium. No fallback. MAIN is read-only. Execution remains the existing detached checkout at 2487d56291fb6196672b36cd9f9c632ef2dfa9c5, with empty staging.

Before source edits, archived all 37 intended source files plus targeted recent evidence in `artifacts/008/fresh-executor-20261011T121747Z/preserved-source-evidence.tar.gz`. `source-sha256.json`, `base.diff` and `status.txt` record exact entry bytes. Caches, dependencies and builds are excluded. Prior artifacts are untouched.

Read complete current MAIN continuation decision, parent plan, refresh, interruption checkpoint and dispatch review. Existing freshness prerequisite is resolved and will not be redone. Nine red full product runs remain historical failures, not passes. Latest failure is isolated-storage teardown in cold Stop. Reset-origin timing is a separate diagnosis, not a teardown fix. Existing source has join-hold hooks but cold Stop uses none and no reset itself.

## Chronology after preservation

All logs below are in `artifacts/008/fresh-executor-20261011T121747Z/`. Launcher prefix is always `sh .execution-008/clean-run.sh`.

- `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'cold Stop after disconnect'`, exit 0, one passed and 52 explicitly filtered. `cold-stop-entry.log`. This does not fix historical full-suite teardown.
- Eight-case affected sequence, exit 1, seven passed, unclosed-successor timeout plus isolated-storage error. `affected-entry.log`.
- Tagged boundary trace of unclosed successor, exit 1 with the real expected-denial bug at `recoverCandidate`: fresh proof selects the new unclosed successor, but the controller throws `fixture_recovery_proof_denied` instead of its bounded denied outcome. `successor-trace.log`.
- Changed only that mismatched-proof branch to return `{resetId, phase: "denied"}`. Guard and authority checks stay intact. Exact standalone regression then passed, `successor-denial.log`.
- Affected sequence still exceeded the unchanged five-second test budget, `affected-denial-fixed.log`. Trace showed 3.3 seconds already spent on first successful invocation/reset/recovery, followed by second request preparation. `affected-trace.log`.
- Streamlined only the unclosed-successor regression: direct actual private command delivery instead of a duplicate leased outbox drain, first successful instruction without an unnecessary held-final-permit fault, and second actual invocation held at existing join hook rather than waiting for another complete credential claim. Assert second predecessor is active before reset. No runtime deadlines or assertion weakening. Other tests retain outbox and held-permit coverage. `successor-transport-trace.log` passed two cases. Eight-case runs `affected-direct-transport.log` and `affected-successor-join.log` remained red. The latest `affected-minimal-successor.log` passed unclosed successor but timed out in the multi-page control recovery case. This is not a full product pass.

Temporary tagged boundary instrumentation is still present in the successor test for diagnosis and must be removed before handoff. Prior preserved artifacts are unchanged. No aggregates have been run. Next establish the earlier 28-case cold Stop sequence and separate test-budget pressure from genuine pending alarm/storage work. No aggregate gates until relevant product suite passes. Every test/toolchain command uses `sh .execution-008/clean-run.sh`. No deadline, takeover guard, dependency or isolation changes authorized.

## Later diagnosis and final stop

The 28-case prefix through cold Stop passed with 25 unrelated cases filtered, `cold-stop-prefix.log`. A full unfiltered run nevertheless reproduced cold Stop teardown, `product-full-default-1.log`, 27 passed and one failed before the suite completed. A tagged retirement probe showed the cold object had no alarm after retirement and advanced the next failure into a held credential case, `product-cold-retirement-trace.log`. This timing change is not proof of a teardown fix.

The stronger active-predecessor assertion exposed an idle-alarm join-hold race. `reset-minimal-final.log` is red with `closed` instead of `active`. The fixture hook now acknowledges only an active host invocation whose HOST-owned immutable origin matches the current constructor. `reset-owned-join.log` passed five reset cases with 48 explicit skips. Blocked ordinary fixture alarms no longer attempt activation. A replacement with no fixture gate also denies ordinary alarm admission when its latest unclosed invocation belongs to another constructor. Direct passive inspection still reaches the unchanged host guard. This resolved the observed cleanup guard error in `dispatch-reset-cleanup-final.log`; `dispatch-reset-origin-barrier.log` passed ten cases with 43 skips.

The successor test's first held-final-permit stage was restored before final source preservation. It still uses the actual private delivery method for both admitted instructions. The second invocation is retained by the existing join hold and must be active before the unobserved abort. Control-scan observations were parallelized only after recovery finished, with an additional exact page cursor assertion. The actual bounded recovery scan remains sequential to its explicit end marker.

Added a durability sync after fixture retirement deletes its alarm. No suppression, dependency patch or isolation change. All tagged source instrumentation was removed.

A source audit found an additional concrete candidate-fence issue: a missing credential row could initialize directly at a later generation. Preparation now initializes only generation 1. Later generations require the existing private readiness-bound reactivation. Existing valid-body stale-generation/replacement tests remain. A separate missing-row-at-generation-2 counterexample was not added or passed and remains an explicit coverage gap.

Claim-hold diagnosis now reports whether the real host acknowledgment was admitted. Request settlement resolves a never-entered hold as false. The three tests assert true instead of waiting forever or throwing an expected fixture denial through the pinned RPC pool. They still fail when the real claim was denied. Reset/natural-replacement preparation waits now run within their cleanup scope, and retirement releases the join hold even on preparatory failure.

Longer Vitest outer per-test budgets were used only for diagnosis, via `--testTimeout 15000`. No persisted host work/drain budget, effect/window/overall timeout, queue/recovery deadline or assertion-poll deadline changed. Original aggregate scripts and configurations are unchanged. This did not produce a full suite pass and is not offered as acceptance evidence.

The final full run, `product-boolean-claim-final.log`, remains red despite that outer budget. It reports 34 passed and four failed before all 53 declared cases completed, plus one unhandled isolated-storage error. Failures include zero model fetches for the initial admitted prompt, only two of three native-alarm turns, false instead of a real admitted claim in discarded-observation reset preparation, and a recovery-preparation timeout. The last two are not proof that reset or guard behavior failed after a valid admitted predecessor; their preparation never reached the expected hold reliably. Exact causal attribution to a deadline, D1 latency, native alarm or test pool is still MISSING. Do not call this a confirmed upstream framework impossibility.

Stopped here. No new broad qualification campaign, deadline increase, fake admission, assertion weakening or aggregate retry is authorized or needed to hide this result. The candidate is not ready for acceptance review as a completed 008 slice. It is a preserved implementation with an unresolved product-suite safety/progress/teardown blocker.

## Intended versus implemented versus evidence

The source matrix below describes inspected code and test bodies. It is not independent acceptance or a complete 37-file hunk review.

| Requirement | Current implementation | PASSED / MISSING evidence |
| --- | --- | --- |
| Authenticated atomic receipts, owner/protocol/byte limits, exact retries and lifetime claim | Existing candidate command module, migration and route composition retained | Earlier 28-case real-D1 prefix passed. Final full run is incomplete; reliable final-byte product acceptance MISSING |
| Real leased delivery, immutable membership/start-or-expiry decisions, ordered Pi submissions and native alarms | Existing host remains sole run/effect owner; tests admit commands rather than seed successful membership | Source/tests exist. Final full run fails initial model progress and third native turn. Aggregate-load autonomous progress MISSING |
| Immutable invocation origin, exact original predecessor and original budgets | HOST-owned origin table written with invocation creation; fixture proof retains origin separately from current constructor | Narrow reset/origin cases passed before final formatting and Boolean diagnostics. Latest narrowed handoff then failed preparatory claim and teardown. Reliable final-byte proof matrix MISSING |
| Reset intent, local credential closure acknowledgment, local ordinary barrier, actual private RPC abort, retained unique outside observation and fresh passive proof | Existing controller journal and private session RPC path retained | Exact ten-case narrow run passed before last diagnostic edits. Lost observation stays denied. Final full reset preparation is red; full-suite proof MISSING |
| One exact newer generation/priorTerminated, failed/replaced origins denied, new successor needs own proof | Existing journal/authority; mismatched current successor proof now returns bounded denied outcome; origin-bound hold prevents idle-alarm false readiness | Standalone bounded-denial regression passed. Narrow active-successor witness cases passed. No guard weakening. Reliability under full suite MISSING |
| Recovery-only barrier, full bounded control scan including partial delivered Stop, no repeated epoch or revival | Existing host admission checks and fixture scan retained; fixture alarms check ordinary permission before opening | Ten-case narrow pass includes multi-page scan, epoch 2 retention and original projections. Original ordinary/control matrix still needs final full pass |
| Current successor boot, readiness/owned acknowledgment, private idempotent activation | Existing recovery gate and credential reactivation retained; nongate stale constructor ordinary admission now denied | Valid old-body, stale-boot, next-generation and closed-successor tests exist and passed narrowly. Exact final-byte full coverage MISSING |
| Immutable credential attempt, live synchronous SQLite fence and original permit bounds immediately before fetch | Existing inert default hooks and final gate unchanged; only generation-1 initialization added | Real acknowledged/lost-ack/replacement/window tests passed in ten-case narrow run. Dedicated missing-row generation-2 initialization counterexample MISSING |
| Original D1-only stale-positive diagnostic | Preserved without reclassification | Not rerun, not claimed fixed |
| Start/expiry lost acknowledgments, intent/outcome crashes, held configuration Stop, too-late cancel/delayed old Stop, mutable authority, queued configuration and three-denial exact halt | Existing expanded test bodies inspected; all use actual candidate admission, real D1/DO and private adapter where required | Cases exist among 53, not duplicate additions. Latest full run stops before most late cases. Final-byte full evidence MISSING |
| Default composition, encryption, exact host takeover guard, no extra effect ledger/namespace/scheduler | Preserved | Four byte-unchanged advisor probes passed; exact guard comparison passed. No new production binding or issuer |

## Final bytes, commands and preservation

Artifacts remain under `artifacts/008/fresh-executor-20261011T121747Z/`.

- `command-ledger.json` records all 35 exact launcher commands and exit statuses. Every red log remains. Filtered cases are never full passes.
- Final source inventory is exactly 37 intended files in `final-source-sha256.json`, archived in `final-intended-source.tar.gz`. Only `apps/credential-tests/src/entry.ts`, `model-entry.ts` and `product-commands.worker.test.ts` changed in this executor. The other 34 files match entry hashes. `fresh-executor-source.patch` is this executor's exact three-file delta; `final-candidate.diff` is the cumulative tracked diff against HEAD. Untracked intended source is in the inventory/archive, not omitted because Git diff cannot show it.
- `preservation-final.json` reports empty staging, unchanged HEAD and zero mismatches in the 15 archived entry evidence files. Its prior-evidence inventory hashes 215 files and is a current inventory, not invented before/after proof for every file.
- `guard-and-evidence-check.json` independently compares all 75 MAIN interruption copies against execution originals, with zero mismatches. MAIN's original runtime probe source/config/log match execution byte-for-byte. Four unchanged probes passed in `advisor-probes-handoff.log`.
- `dependency-graph-final.json` matches all ten non-root original graph hashes. Root metadata excluding scripts matches HEAD; its script-only 008 registration was inherited and not edited. No dependency, launcher, cache, manifest or lockfile changed here.
- Final credential TypeScript check passes on the exact final bytes, `credential-typecheck-final-bytes.log`. Web typecheck passed before the final fixture-only Boolean diagnostic change, `web-typecheck-handoff.log`; web source stayed byte-identical afterward. `git diff --check` passes, `diff-check-final.log`.
- Offline freshness remains resolved by the preserved unchanged `contracts-freshness-layout-corrected.log`. No cache preparation or repeat freshness test occurred.
- The five original final aggregates are NOT RUN in this executor. The product suite never became green, so running them now would violate the required sequencing. Historical aggregate outputs are not final-byte results.

MAIN remained read-only. No source integration, stage, commit, merge, push, deployment, live provider, shared/retained database mutation, external cleanup or worktree removal occurred. No completion or acceptance claim. Return this blocked candidate and concrete red evidence to the parent.
