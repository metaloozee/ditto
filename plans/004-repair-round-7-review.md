# 004 round 7 acceptance review

Verdict: **ACCEPTED LOCALLY for plan 004.** The repair loop is complete. This accepts the reviewed uncommitted source, not a deployment or the complete trusted runtime.

No source was staged, committed, merged or pushed. Plan 005's implementation prerequisite is satisfied locally; its execution has not started. Source integration requires separate authorization.

## Accepted source

- Worktree: `/home/ayan/ditto-worktrees/plan-004-grok`.
- Branch: `grok/plan-004-coordinator`.
- Base HEAD: `9db8c3846e3033fe08ea947fdd999ff51b3cfb82`.
- Scope: nine modified tracked source files and ten new source files.
- Exact accepted hashes: [round-seven scope](004-repair-review-evidence/round-7/scope.json).
- Complete source: [tracked diff](004-repair-review-evidence/round-7/candidate-tracked.diff), [added diff](004-repair-review-evidence/round-7/candidate-added.diff).

Executor `95618f3a-b8c1-458` used `xai/grok-4.6`. The advisor inspected the actual four-file, 665-line repair delta and surrounding source, rather than accepting the executor's report. The other fifteen files match earlier independently reviewed hashes. All nineteen source hashes remained stable through the final gates and completion probes. The parent checkout has no non-plan changes.

The accepted scope adds coordination, encrypted persistence and deterministic local contracts. Historical migrations, dependencies, deployment configuration, runner/brain implementation and accepted 002 R5/legacy policy boundaries remain unchanged.

## Independent gate results

| Gate | Result |
|---|---|
| `pnpm verify` | PASS: 808 web tests, 79 runner tests, builds/typechecks |
| `pnpm runtime:verify` | PASS: 25 tests and runtime gates |
| `pnpm brain:verify` | PASS: 43 brain tests, contracts/freshness/build gates |
| Exact phase web tests | PASS: 67 tests across journal, control and delivery |
| Exact runtime crypto test | PASS: 5 tests |
| Runtime typecheck, root typecheck, `pnpm check` | PASS; 11 existing warnings |
| Accepted 003 probes | PASS: 23 checks |
| Setup-adapted original 004 probes | PASS: 30 checks |
| Setup-adapted additional 004 probes | PASS: 28 checks |
| Parent Q/S/U/V/W generations | PASS: 14 + 13 + 8 + 5 + 4 checks |
| New completion J checks | PASS: 4 checks |

Total behavioral review checks: **129 passed, zero failures**. These supplement, not replace, repository tests and source review. All final independent commands passed on their first run against this source state. The historical crypto and timeout failures remain in their original round directories.

[Round-seven evidence](004-repair-review-evidence/round-7/) holds every independent log, the previous source reconstruction verified against round-six hashes, and the final delta. Brain freshness deliberately selects three tests and skips three unrelated cases before the full 43-test suite. The existing workerd compatibility-date fallback remains a local-tool limitation, not release evidence.

## Original findings closed within phase scope

| Requirement | Accepted behavior and evidence |
|---|---|
| R1: real coordinator wiring | Actual product entrypoint resolves persisted command identity; runtime delivery/control/observation route to one workspace SessionRuntime. Q01 and the repository application-path test exercise those actual methods and intercept start calls. |
| R2: current authority | Persisted owner/version and current project/session/identity/controller/incarnation/lifecycle checks gate consumption, effect admission and canonical access. Archived ordinary consumption is denied while control/history settlement remain usable. Production prerequisites remain closed; trusted fixtures prove positive operations. |
| R3: truthful Stop | Exact run barriers do not invalidate a distinct later run. Unresolved writers remain tracked and block replacement. Failed/timeout/wrong identity/class evidence cannot prove termination. Captured stable identity is distinct from incarnation. Valid stop evidence or a recorded result permits the appropriate terminal settlement without inventing an effect result. |
| R4: durable barriers | Effects serialize and preserve logical identity; result dedupe/conflicts and continuation caller/position/epoch checks hold. Real failed command/effect/continuation/terminal/retry writes latch later admission, including durable-latch write failure. Identical admitted-effect retry repairs scheduling without redispatching. |
| R5: every accepted turn | Membership, predecessor cancellation, late targeted commands, expired queues and old-run assistant settlement remain covered. Large terminal settlement retains durable page progress and eventually settles every assistant. |
| R6: product CAS | Exact target membership, current authority, deletion fences and lexicographic owner/sequence guards protect target and cursor together. Related batches roll back; completed assistants remain immutable; successful redacted final content is non-vacuous. Typed recovery pointers update actual owned targets without cross-workspace writes or resurrection. |
| R7: autonomous bounded work | Acceptance retains an armed callback or retryable outbox ownership. Effect dedupe repairs its persisted deadline. Reconciliation budgets include terminal pages, durable suffixes and truthful lag. Stop retry remains future-dated; fixed first-interruption expiry fails applicable nonterminal runs without asserting quiescence or releasing unresolved writers. |
| R8: canonical restoration | Worker-owned restoration validates required content, retained keys, AAD and supported record formats across bounded keyset passes. Incomplete restoration blocks admission, resumes later and revalidates on a new activation. Missing/corrupt/incompatible content stays fail-closed. |
| R9: authenticated chunks | Write identity, manifest/chunk ordering, digest/length and size limits prevent cross-write splicing and incomplete references. Inline and large round trips, corruption and key failures remain covered. |
| R10: meaningful tests | Actual application routing/start boundaries, real SQLite/D1 predicates, rollback faults, restart recovery, scheduler outages and positive controls replace the earlier constant counters and vacuous assertions. Platform substitutions are identified below. |

## Final repair and completion probes

H1 is closed. `admitEffect` schedules from persisted pending work after both first admission and identical admitted-effect dedupe. Only a new dispatch decision invokes the trusted dispatch hook. W02 observes one dispatch and a repaired callback after an outage. J04 changes the retry payload's deadline and confirms the actual callback retains the original persisted deadline.

H2 is closed. A terminal transaction now persists `terminal_projection_work`; reconciliation materializes its exact-run membership in bounded pages and commits projection enqueue plus progress together. The shared intent/time budget checks before subsequent pages. Each page has at most 25 membership rows. Remaining work contributes to scheduling and projection lag before individual D1 rows exist. W03 follows returned callback deadlines, stops if retry ownership is lost, and verifies all 61 assistants eventually settle.

The new work table stores only operational IDs, owner/epoch, status/reason and cursor state, not canonical text or secrets. It belongs to the checked journal schema. Its row is deleted after all corresponding per-target projection intents have been durably enqueued; those projection records retain retry responsibility. Canonical content still uses the runtime encryption/AAD format. Full retained-history deletion remains phase 009, as previously scoped.

The advisor added [completion probes](004-repair-round-7-probes.cjs):

- J01 fails the terminal-work INSERT after the run transition begins. Both roll back, and later admission is latched.
- J02 commits cursor 25, restarts the journal, observes pending lag and follows later callbacks. All 31 assistants settle and the terminal job disappears without losing its suffix.
- J03 fails the page cursor UPDATE. The page's new projection rows roll back with its cursor, and the fatal latch engages.
- J04 verifies changed retry input cannot extend the actual scheduled effect deadline or cause another dispatch.

No probe setup changes were required in the final round. Earlier compatibility copies remain unchanged and retain their reviewed assertions and positive controls.

## Verification recipe

Run in the accepted worktree:

```sh
pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts src/lib/session-runtime-control.test.ts src/lib/session-command-delivery.test.ts
pnpm --filter @ditto/runtime exec vitest run src/runtime-crypto.test.ts
pnpm --filter @ditto/runtime typecheck
pnpm typecheck
pnpm check
pnpm verify
pnpm runtime:verify
pnpm brain:verify
node /home/ayan/ditto/plans/003-repair-probes.cjs "$PWD"
node plans/004-repair-execution-evidence/round-3/004-repair-probes.cjs "$PWD"
node plans/004-repair-execution-evidence/round-3/extra-probes.cjs "$PWD"
for round in 2 3 4 5 6 7; do
  node "/home/ayan/ditto/plans/004-repair-round-$round-probes.cjs" "$PWD"
done
```

The original unadapted 30-check script is historical evidence and needs the documented service/authority setup. The accepted compatibility copy is the executable regression version for this candidate. Do not overwrite the original failure logs.

## Evidence limits and next boundary

Acceptance covers phase-004 local source and contracts only. No live providers, real Pi/tool execution, paid Cloudflare topology, actual remote process termination/isolation, R2 paired publication, capacity allocation, production credentials, shared database migration, deployment or trusted-user enablement was tested or authorized. Production admission and execution prerequisites remain fail-closed.

The route fixtures mock authenticated sessions. The named-service test substitutes platform base classes while invoking real application methods. These prove local ownership/routing/no-start behavior, not real-cookie HTTP authentication or workerd RPC isolation. Later platform and end-to-end gates remain mandatory.

No unresolved phase-004 blocker remains from this review. Before integrating this source, preserve the accepted nineteen hashes and rerun gates if integration changes them. Commit/merge authorization is separate. Plan 005 has not begun and must use the accepted 004 source rather than the old main-checkout implementation or historical drafting base.
