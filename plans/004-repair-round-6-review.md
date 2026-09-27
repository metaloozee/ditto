# 004 repair round 6 review

Verdict: not accepted. Two reported invariants remain incomplete. Continue targeted repair; 005 stays blocked.

Round six restores outbox retry ownership, memory-latches the retry-intent write fault, and applies recovery expiry to stopping runs. Its terminal query now excludes unrelated runs. Two of four new checks still fail: effect dedupe skips schedule repair, and per-run terminal pagination executes every page within one callback despite the shared budget.

## Independent verification

Candidate `/home/ayan/ditto-worktrees/plan-004-grok`, base `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`. Nine tracked source files are modified and ten are new. Four files differ from round five. The advisor read every hunk of the 446-line delta and relevant surrounding code. Fifteen other source files match prior reviewed hashes. All nineteen hashes remained stable through verification; nothing is staged or committed.

[Round-six evidence](004-repair-review-evidence/round-6/) preserves scope/hashes, complete candidate diffs, the reconstructed/hash-verified round-five source, repair delta and independent logs.

| Gate | Advisor result |
|---|---|
| `pnpm verify` | PASS: 806 web, 79 runner tests, builds/typechecks |
| `pnpm runtime:verify` | PASS: 25 tests and associated gates |
| `pnpm brain:verify` | PASS: 43 tests and associated gates |
| Exact phase web command | PASS: 65 tests |
| Exact crypto command | PASS: 5 tests |
| Runtime typecheck, root typecheck, `pnpm check` | PASS; 11 existing warnings |
| Accepted 003 probes | PASS: 23 checks |
| Adapted original/additional 004 probes | PASS: 30 and 28 checks |
| Parent Q/S/U/V generations | PASS: 14, 13, 8 and 5 checks |
| New parent W probes | FAIL: 2 failures in 4 checks |

No probe setup adaptations were needed. The scheduler-only test now permits successful bounded retry rather than requiring its first transient error to escape. It still checks the actual fault and a healthy journal, so this is not weakening the invariant.

```sh
node /home/ayan/ditto/plans/004-repair-round-6-probes.cjs /home/ayan/ditto-worktrees/plan-004-grok
```

`additional-probes.log` records the initial four checks with no setup errors. `additional-probes-complete.log` retains the same verdict after strengthening W03 to follow returned wakeup deadlines and fail if retry ownership disappears before all assistants settle. W01 confirms sustained scheduling outage leaves delivery pending, then one later dispatcher retry arms a callback with only one run. W04 confirms a real retry-intent failure still blocks later admission when writing the durable fatal latch also fails.

## H1. Effect dedupe acknowledges without repairing its persisted wakeup

`apps/runtime/src/session-runtime.ts:admitEffect` calls `requireArmedSchedule` only inside `if (admitted.dispatched)`. Its existing-effect branch returns `dispatched: false`, bypassing schedule repair.

W02 drains the prior acceptance callback, then makes scheduling unavailable during a new effect admission. The effect marker and one trusted dispatch decision persist, while the RPC returns `schedule_unavailable`. Scheduling is then restored. Retrying the identical effect returns success, but no callback is armed and there are only the two failed scheduler attempts. The dispatch count remains one, which is correct; scheduling remains abandoned, which is not.

Repair the admitted-effect dedupe path as well as the first admission. Keep dispatch at most once. Derive the deadline from the persisted effect or authoritative pending work, not a retry caller's potentially different deadline. A duplicate must either repair the callback or return a retryable failure while retaining an autonomous retry owner. Do not overwrite the immutable effect or repeat its external dispatch to get a callback. Retain conflict, stale identity/epoch, terminal and unknown-outcome barriers.

## H2. LIMIT 25 per query is not a bounded reconciliation pass

`queueTerminalProjections` now loops over `listCommandsForRun(..., 25)` until the run has no more commands. There is no shared time check or persisted page continuation in that loop. All pages enqueue projections in the same callback, while reconciliation counts the entire operation as one intent.

W03 creates one prompt with sixty accepted follow-ups through the actual command/delivery API. After interruption expiry, the first membership page consumes six seconds of simulated time. The callback nevertheless reads all sixty-one commands over three pages and reports `processed: 1`. All sixty-one assistants eventually settle, so the current code preserves coverage but not the required work/time bound.

Persist run-level terminal-projection work and its progress together with the terminal decision, then drain that work in bounded pages under the existing shared reconciliation budget. A local journal record or existing operational metadata can carry the pending run, owner/reason and cursor; no new product deployment, archive or runner feature is needed. Count this work truthfully, stop starting pages when the work/time budget is exhausted, and schedule remaining durable work. Include pending terminal work in wakeup derivation and truthful projection-lag/snapshot reporting, even when no individual D1 projection rows are pending yet. Commit each page's projection enqueue and progress atomically so crashes cannot skip assistants.

Do not replace the loop with a one-page cap that drops later turns. Preserve exact membership, ordered owner/sequence CAS, old-run settlement, completed-message immutability, and the atomic terminal decision plus durable projection intent. W03 requires both a bounded first pass and eventual settlement of all sixty-one assistants over later passes. Its ordinary synthetic callbacks do not authorize browser-driven completion as a substitute for scheduling.

## Next repair contract

H1/H2 complete existing G1/G4 and original R4/R5/R7. No new design or permission decision is needed. Use `xai/grok-4.6`, high reasoning, in the same existing candidate, with no executor subagents.

Preserve closed production admission, accepted 002 R5 and legacy fences, all previous passing cases and historical evidence. No staging, commits, merges, pushes, deployment, dependency changes, historical migration edits, paid tests, live/shared databases, real providers or downstream runner/brain implementation are authorized.

Add repository regressions and run every previous probe generation plus W, exact phase tests, typechecks/check and full root/runtime/brain gates. New sanitized execution evidence belongs under the candidate's `plans/004-repair-execution-evidence/round-7/`. Document any necessary setup-only adaptation without changing assertions or dropping positive controls.

The advisor will independently review source and rerun the gates. The candidate remains unaccepted and uncommitted.
