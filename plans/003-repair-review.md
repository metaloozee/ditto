# 003 repair review

Verdict: **ACCEPTED for plan 003's local admission/delivery scope.** Independent behavioral probes and all inherited verification gates pass on the final candidate. This supersedes the [rejected initial candidate](003-execution-review.md).

Integration update: the user subsequently authorized commits and a local branch merge. The exact accepted source landed on `brain` at `162e134`, through source commits `237affb` and `03af7f0`. The retained worktree `/home/ayan/ditto-worktrees/plan-003-grok` now uses branch `grok/plan-003-admission`. All 17 source hashes still match. All three verification gates and the 23 probes passed again on the merged revision. See the [integration record and logs](003-repair-evidence/integration/README.md).

The review below records the earlier acceptance of the uncommitted candidate at base `d18bf57`. No push, deployment, shared database migration, live credential access, paid-platform validation or real-user enablement was performed during review or integration. Local acceptance is not release approval.

## Candidate and scope

The user requested repair of R1-R8 with xAI Grok 4.6 in the existing worktree, followed by independent review and verification. Executor `5b86f37f-bc19-418` performed the repair and two targeted corrections. The advisor edited only files under `plans/`, read the actual implementation changes, and ran verification independently.

Before repair, all 17 original candidate files matched the first review. The [before-manifest](003-repair-evidence/before-manifest.json) records 697 regular files outside `plans/`, with [before-copies](003-repair-evidence/before/) of the candidate files.

The final repair changes ten of those files; 687 remain unchanged. It adds no source files beyond the six already introduced by the original candidate. The complete candidate still comprises 11 modified and six new source/test files relative to `d18bf57`.

- [Final source hashes and scope](003-repair-evidence/final/scope.json)
- [Repair-only diff](003-repair-evidence/final/repair.diff)
- [Complete tracked candidate diff](003-repair-evidence/final/candidate-tracked.diff)

The repair changes `session-command.ts`, `session-command.test.ts`, `session-command-delivery.ts`, `session-command-delivery.test.ts`, `session-runtime-client.ts`, `sqlite-d1-test-utils.ts`, `workspace-runtime.ts`, both agent routes, and `session-runtime-fixture.ts`. The remaining seven original candidate files are unchanged by the repair.

Historical migrations, Alchemy, dependency manifests/lockfiles, generated route source, runtime/brain/runner source and the accepted R5 policy boundary remain unchanged. The additional fault hooks in the existing SQLite test helper support the requested persistence tests.

The improve skill's `references/closing-the-loop.md` remains absent. Execution and review followed the explicit rules supplied by the user; no compliance with an unavailable reference is claimed.

## Final independent verification

All results below were independently obtained after the final source correction, in the executor worktree. Node `v24.21.0`, npm `12.0.2`, pnpm `11.8.0`.

| Gate | Result |
|---|---|
| Focused command, delivery, capacity, legacy ownership/service and route suites | PASS: eight files / 119 tests. |
| `pnpm verify` | PASS: check, web typecheck, 70 web files / 757 tests, web build, runner typecheck, 79 runner tests and runner build. |
| `pnpm check`, included above | PASS with 11 existing warnings. |
| `pnpm runtime:verify` | PASS: typechecks and 20 tests. |
| `pnpm brain:verify` | PASS: contracts typecheck/build and 14 tests, copied-consumer freshness check, brain typecheck/build and 43 tests. |
| Independent repair probes | PASS: 23 checks, zero failures. |
| Diff checks and unstaged-source checks | PASS. Advisor source unchanged; no staged candidate changes. |

[Final gate logs](003-repair-evidence/final/) and [independent probe output](003-repair-evidence/probes-accepted-candidate.log) are retained. Brain freshness selects three tests and skips three unrelated cases; the subsequent full brain suite runs all 43. Runtime tests retain the local-runtime compatibility fallback warning from `2026-09-16` to `2026-03-10`. These are local results, not Cloudflare platform evidence.

Reproduce the independent probes from the advisor checkout:

```sh
node plans/003-repair-probes.cjs /home/ayan/ditto-worktrees/plan-003-grok
```

Expected for the reviewed candidate: exit 0, 23 checks / zero failures. The script loads actual candidate modules, captured POST handlers and disposable SQLite databases. It substitutes auth, route registration, database construction, unused legacy entrypoints and service transport. It does not replace trusted admission/delivery decisions or implement a fake coordinator. Request data is synthetic. This is mocked-auth handler coverage, not real-cookie authentication proof.

The focused verification command was:

```sh
pnpm --filter @ditto/web exec vitest run \
  src/lib/session-command.test.ts \
  src/lib/session-command-delivery.test.ts \
  src/lib/workspace-runtime-capacity.test.ts \
  src/lib/agent-run-service.ownership.test.ts \
  src/routes/api.agent.stream.test.ts \
  src/routes/api.agent.control.test.ts \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-control-service.test.ts
```

## R1-R8 disposition

| Finding | Verified correction |
|---|---|
| R1: browser version enabled trusted admission | Both production handlers require server-owned eligibility. Default requests create no trusted session or command. Request-local injection enables only the local fixture. |
| R2: wrong model configuration and disconnected transport | Handlers and the scheduled drain use the shared narrow resolver in `session-runtime-client.ts`. Trusted admission does not read the product key. An unavailable default fails new model-requiring admission; supported protocol is checked. Eligible Stop/cancel and existing receipt replay remain model-independent. |
| R3: lost accepted settings | Normalized thinking settings persist in the bounded outbox payload. Reconstruction uses retained message references and the accepted outbox owner version. Missing/malformed/wrong-kind settings and missing or mismatched work/message mapping fail closed in the exercised cases. |
| R4: acknowledgment loss and backlog starvation | Delivery validates acknowledgment identity/position/receipt against persisted metadata and marks only delivery state accepted. Delivered rows leave retry selection. Lost acknowledgment retries the same IDs. A 26-command backlog progresses, and one workspace's missing predecessor no longer blocks other workspaces. Stop remains prioritized. |
| R5: duplicate JSON erased before parsing | Production handlers read a byte-bounded UTF-8 body and preserve raw input for strict versioned parsing. Literal/escaped duplicate fields, malformed/oversized bodies and unsupported/authority-bearing input reject without trusted writes. |
| R6: incorrect deadline/backoff accounting | Backoff starts after failure. The final service allowance is calculated after all pre-call persistence, including lease renewal, against both pass and lease deadlines. Exhaustion starts no RPC and does not increment attempts. Slow async calls remain retryable rather than becoming accepted handoffs. |
| R7: missing normalization | Prompt/follow-up normalization precedes hashing and storage; blank input rejects, equivalent trimmed requests replay, and interior text survives. |
| R8: tests bypassed handlers and transport faults | `asUser().command` invokes captured production routes with mocked auth. Tests cover receipt/message observation, all six unavailable recovery variants, delivery acknowledgment faults, backlog progression, timing, stale leases, storage failure and the production drain through its shared resolver. |

Delivery acknowledgment is not terminal execution. Tested assistants retain complete-user/pending-assistant state; trusted work does not enter the inherited legacy failure/expiry helpers. Tests do not count a simulated service acknowledgment as proof of real coordinator acceptance or execution.

The atomic admission behavior remains intact. Independent probes repeat failures at all nine first-session batch statements and observe no retained session/message/command/key/work or sequence rows. Original ownership/deletion race checks remain recorded in the first review, and the repair preserves the SQL predicates they exercised.

## Review iterations

The first repair passed the inherited gates but failed four independent cases: a persisted handoff read consumed an unaccounted part of the delivery budget, one workspace's gap suppressed all ordinary delivery, reconstruction substituted the live owner version for accepted authority, and missing settings produced a valid-looking command. The executor corrected those cases in the existing command/delivery modules and tests.

- [First repair probe failures](003-repair-evidence/probes-first.log)
- [First repair verification logs](003-repair-evidence/first-pass/)
- [Intermediate 22-check pass](003-repair-evidence/probes-final.log)

A further review found the same timing gap after the new lease-renewal write. The added probe advanced the clock by 120 ms during renewal in a 100 ms pass and observed an RPC still starting. The last correction calculates the final allowance after renewal and starts no RPC when exhausted.

- [Lease-renewal failure](003-repair-evidence/probes-renewal.log)
- [Final 23-check pass](003-repair-evidence/probes-accepted-candidate.log)

The final slow-read probe takes approximately 101 ms for a 100 ms test budget, including timeout handling and persistence cleanup, and leaves delivery pending. This establishes bounded dispatch decisions and call allowance, not a claim that D1 latency or event-loop scheduling can obey a hard real-time wall-clock deadline.

## Limits and downstream handoff

- Production defaults remain closed to trusted admission. The shared resolver has an unavailable default and request-local test injection; actual private binding deployment is not delivered or enabled here.
- Phase 004 still owns real coordinator acknowledgment durability, execution dedupe, sequence consumption, journal/projections and consumption-time ownership/lifecycle checks. Full T06/T07 acceptance remains pending there. Reconstruction preserves old accepted authority; it is not permission to execute under that authority after migration.
- Recovery variants remain rejected until their owning phases implement admission and handlers together. Model/tool/Git windows, Pi launch and real repository execution are not part of 003 acceptance.
- Real-cookie smoke and paid two-container/platform tests remain pending their later, separately authorized phases. No paid or live test result is inferred from local SQLite or transport mocks.
- Source-relative contracts imports remain a documented nonblocking package-boundary deviation. Changing dependency manifests/lockfiles was not authorized during this repair. Consumer freshness gates still pass.
- A few inherited test titles retain inconsistent T03/T04 labels. The required retry/conflict behaviors were verified by file and behavior, not ID-only test selection. Align labels before relying on ID-filtered CI; this is not a missing behavioral test.
- Receipt message-ID fields were not expanded solely to satisfy the old probe; mapping is observed through D1. An outbound post-tombstone call alone was not treated as evidence of unauthorized execution. The original review records those rejected interpretations.

## Next step

003 integration is complete. [004](004-coordinator-and-encrypted-journal.md) is ready for a separate local execution request in `/home/ayan/ditto-worktrees/plan-004-grok`, branch `grok/plan-004-coordinator`. It starts from current `brain`, has installed dependencies and committed plans, and passes all inherited gates plus the 23 repair probes. Preparing this baseline did not implement or start 004 and did not authorize deployment.
