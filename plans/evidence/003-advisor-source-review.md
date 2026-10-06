# 003 advisor source review

Status: initial candidate rejected for five independently reproduced defects; corrections in progress, not accepted. 003 and full L1 remain unaccepted. Source stays uncommitted in detached `/tmp/ditto-plan-003-998rQl` at `cf7bfbc`.

The advisor read the complete 2583-line candidate host, 347-line mandatory fixture and 937-line effects test, the appended executor evidence and changed-path scope. Only the candidate host/adapter, new effects tests and plan documents changed. Historical host assertions, fixture configuration, legacy code, L0, package/lock inputs and authoritative spec have no diff. No advisor source edits, stage, commit, integration or deployment occurred.

The candidate adds structured command/run/submission/task/effect membership, an exclusive provider association/admission lane, same-ledger result/Pi receipt barriers, targeted epoch-first Stop and run/member/projection settlement. It retains the known first-summary availability restriction. Legacy callback admission remains only in inherited fixture paths; the correlated DO composition injects the complete mandatory guard.

## Independent gates

Commands ran from the preserved worktree with `env -i`, the installed Node/pnpm executable PATH, `CI=1`, `NO_COLOR=1`, and `HOME=$PWD/node_modules/003-advisor-logs/home`. No credentials or live effects were used.

| Command | Result | Ignored worktree log |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0, both typechecks, 6 Node checks and 114 Worker tests in 6 files | `node_modules/003-advisor-logs/runtime-implementation.log` |
| `pnpm verify` | passed, exit 0, Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build | `node_modules/003-advisor-logs/verify-implementation.log` |
| `git diff --check` and protected-path diff | passed, no protected source/configuration changes | advisor tool output |
| Contracts | not run, unchanged |

These passes establish the candidate's current automated baseline, not completeness of the plan. Requested/effective workerd date remains 2026-09-16 / 2026-03-10. Hosted, live-provider, Docker, encryption, product handlers/restarts and browser acceptance are not run.

## Open review checks

A separate read-only reviewer on `openai/gpt-6.1-sol` with Medium reasoning is checking Stop races, terminal settlement and recovery deadlines. The original source executor on the same model/reasoning is constructing bounded diagnostic probes without modifying application source for these advisor-identified hypotheses:

1. Due reconciliation intent may be rearmed indefinitely after all commands and Pi work are terminal. `alarm` repairs the retained deadline before returning on an empty unsettled inbox; the serviced reconciliation intent is cleared only on the branch with an input. Official Cloudflare alarm documentation confirms `getAlarm` inside a running handler returns null unless that handler has rearmed it. Native lifecycle/resource joins are required to establish the actual behavior.
2. A final known compaction model error may retain `result-recorded` forever because the receipt validator recognizes retry evidence and successful summary placement but no failed terminal compaction outcome. This needs an actual exhausted or nonretryable summary response, not the existing error-once-then-success fixture.
3. Model and tool admission may interleave between the asynchronous `check` and the short admission transaction. The provider lane covers model callbacks only. A real simultaneous compaction/tool preparation case must establish or refute dispatch of both operations; a static suspicion is not a confirmed finding.

All three hypotheses and both deadline findings below are independently reproduced. Full gate passes did not cover these faults. Their corrections are required before acceptance.

## Deadline review findings

The separate read-only reviewer completed on `openai/gpt-6.1-sol` with Medium reasoning. The advisor verified both cited gaps against the fully read source. They require executable confirmation and correction before acceptance:

- `exactAuthority` and `dispatchPermit` verify state/epoch and invocation/effect deadlines but never compare `host_runs.recovery_at` to the current clock. `schedule` calls `expire` before asynchronous preparation only. Preparation or a remote result can cross the fixed recovery deadline without an alarm or explicit `expire` call and still encounter nonterminal authority. Existing expiry coverage manually invokes `expire` first and therefore does not test this race.
- The trusted abrupt-host takeover branch of `open` accounts for the old invocation without recording interruption/recovery state for affected nonterminal runs. Only graceful `closeAndAccount` records those facts. A known completed error with a retained Pi retry has no unknown admitted effect to independently block it, so this path can retain a null recovery deadline indefinitely.

The source executor added the exact diagnostic cases without modifying application source. Unknown requests that already block did not substitute for the known-error retry counterexamples.

## Independent red verification and correction brief

The advisor read the entire retained five-case diagnostic file and [diagnostic supplement](003-targeted-diagnostics.md), then independently ran the sanitized command `pnpm --filter @ditto/runtime exec vitest run --config node_modules/003-diagnostic-probe/config.ts --reporter=verbose`. It exited 1 with exactly five assertion failures and no timeout, unhandled error or SQLite cleanup failure. Log: `node_modules/003-advisor-logs/five-gaps-red.log` in the preserved worktree.

Observed defects:

1. Three native handlers rearmed the same serviced past reconciliation deadline after complete run/member settlement, no live Pi tasks and committed effects. The original intent survived.
2. A known nonretryable compaction error reached its matching real terminal failure receipt but retained a result barrier and pending member indefinitely.
3. Real summary and sequential tool admission passed the asynchronous check concurrently. The second short transition observed the first admitted row but inserted anyway; both actual dispatch callbacks saw two unresolved admissions and both performed I/O.
4. A real known-error retry held preparation across its persisted recovery deadline, dispatched and let Pi consume its result after expiry without an alarm or explicit expiry call.
5. Actual Harness closure followed by trusted takeover left interruption/recovery timestamps null and admitted a retry more than 15 minutes later.

The executor correction brief targets the existing host transitions and mandatory adapters, not a new scheduler. Consume serviced alarm intent before repairing the next native alarm, while retaining genuinely pending future work and uncertainty evidence. Account matching known terminal compaction failure without inventing a summary. Recheck the shared effect reservation synchronously inside admission and immediately before concrete dispatch, with typed conflict distinct from persistence failure. Enforce fixed run recovery expiry at final admission and result barriers after awaits, committing terminal/member/projection settlement before any later effect. During trusted abrupt takeover record first interruption and fixed recovery wakeup, preserving existing timestamps and using trusted termination time or an explicitly conservative durable bound rather than resetting the clock at a late reopen.

Permanent real Pi/SQLite regressions must cover all five and a separate response-only deadline crossing. Earlier red probes and evidence remain unchanged. An admission collision may conservatively deny both candidates, but must never dispatch both or masquerade as a storage failure. Source acceptance remains conditional on independent review of the incremental correction and fresh gates. No staging, commit, integration or deployment is authorized.
