# 015 Resource admission and execution-only project values

Disposition: DONE for the local fixture scope, accepted with limits after one rejected review round; see "Review" and "Acceptance". Base `c827cda` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0. No reset, deployment, live provider request, real secret or shared database was used. Every value in tests is synthetic.

## Refreshed design

The plan was refreshed against the integrated 008 to 014 code before coding:

- 008 gave candidate sessions a provisional cap: the fixture admits one candidate workspace (`candidate_workspace_claims`, id 1) and runtime authority requires `liveExecutors === 1`. 015 adds the complete policy beside it and leaves that cap in place, because enabling several candidate workspaces is its own step.
- The legacy pool in `workspace-runtime-capacity.ts` (20 global, two per user, 15-minute queue TTL, lease TTL) stays the accounting for legacy sessions. Candidate work never takes a legacy brain reservation, and nothing in 015 releases legacy accounting.
- There is no brain-container pool in the target. Two candidate pools exist: execution, shared by agent executors, seed builders and preview, and model, for concurrent provider requests.
- A claim has no lease. It counts from acquisition until termination evidence releases it. An expired timer never proves that a process ended, so an isolated but live executor keeps its slot.
- The three clocks stay separate: the fixed 15-minute queue deadline from acceptance (the runtime applies it), 003's 15-minute recovery deadline from first interruption and 014's ten-minute preview backup deferral. Capacity waiting never resets any of them.
- Project values are decrypted in the product, only for one admitted shell operation, and travel to the executor in the environment of that one run. They never enter Pi configuration, the operation, its request file, the executor journal, builders, preview, Git children or archive helpers.

## Implementation

| Part | Location |
|---|---|
| Candidate capacity ledger: no lease, unique `(kind, ownerKey)`, released rows final by trigger | `apps/web/migrations/0025_candidate_capacity.sql` |
| Policy (execution 20 global and two per user, model 20 and two), acquire with both limits in one statement, evidence-only release, a seed-builder adapter that no seed path uses yet (see Limits) | `apps/web/src/lib/candidate-capacity.ts` |
| Queue drain: controls first, then FIFO by `fifoSeq`; ordinary work needs the session's executor claim keyed by identity and incarnation; a full global pool blocks later newcomers and a full user blocks only that user; rows left waiting are paged past, so they never hide later rows; work is handed over without a slot only five seconds after the command's own millisecond deadline, so the runtime can record nothing but the expiry | `CandidateProductCommands.drain` in `apps/web/src/lib/session-command-candidate.ts` |
| Preview start takes the session's executor claim or answers `{ status: "denied", reason: "capacity" }` | `CandidateProductCommands.workspaceAction`; denial in `packages/runtime-contracts/src/workspace-action.ts` |
| Model slot taken before `policy.reserve` and released with source `model_fetch_settled` after the fetch settles, or `model_not_dispatched` when the acquisition wait itself fails; a full pool answers `failed_known` without consuming an attempt | `CodexCredential.requestModel` in `apps/web/src/lib/codex-credential-do.ts` |
| Project value request and grant contracts, limits, redaction | `packages/runtime-contracts/src/project-values.ts` |
| Product delivery: role, scope, deadline and fresh authority before decryption, the same checks again after it | `apps/web/src/lib/candidate-project-values.ts`; fixture RPC `readCandidateProjectValues` |
| Runtime: values fetched inside the admitted dispatch for `bash` only, rechecked against cancellation and the deadline, refused before dispatch on any failure; every later tool result is redacted with all values granted since the composition opened | `createRemoteTools` and `sandboxExecutor` in `apps/runtime/src/pi-durable-tools.ts`; binding in `pi-durable-product-session.ts` |
| Runner: takes `DITTO_EXEC_VALUES` out of its environment first, gives values only to the bash child, refuses them for any other tool, refuses a malformed transport as a known rejection, redacts across output chunks before buffering, truncation or spill | `packages/sandbox-runner/src/tool-exec.ts`, `tool-exec-cli.ts` |

### Value delivery checks

The product answers `denied` with one reason, in this order:

1. `invalid`: the request does not parse.
2. `role`: the role is `builder`, `preview`, `git` or `archive`. Only `repository_command` is served. No ciphertext is read.
3. `scope`: the request names another workspace session.
4. `expired`: the deadline passed, or lies more than 15 minutes ahead.
5. `authority`: runtime authority is not current, its generation differs from the operation's executor generation, or more than one live executor is accounted.
6. `unavailable`: the owned, ready project row is missing or its values do not decrypt or validate.

Checks 4 and 5 run again after decryption.

The role check is defense in depth, not the main control. The runtime always asks as `repository_command`. Builders, preview, Git and archive helpers are kept from values by construction: none of them has a value binding, and the runner refuses values for every tool except bash. The authority check is bounded by the provisional single-executor cap: product authority does not yet report a real executor generation or identity for the request, and the runtime epoch is carried for audit but not compared. The runtime treats any refusal, failure, mismatched operation id or late grant as a known pre-dispatch rejection (`rejected` with reason `values` or `expired`). The command never runs without the values it was granted, and later work continues.

## Checks

| Gate | Result |
|---|---|
| `pnpm contracts:verify` | passed, 63 tests |
| `pnpm runtime:verify` | passed: import audit 9, runtime 493 tests |
| `pnpm verify` (check, typecheck, credentials 250 tests, web 875, build, `runner:verify` 114) | passed |

New and changed tests: `project-values.test.ts` (contracts), `candidate-project-values.test.ts` (web), `pi-durable-tools.test.ts` and `pi-durable-capacity.test.ts` (runtime), `candidate-capacity.worker.test.ts` and `product-commands.worker.test.ts` (credentials, now in `credentials:verify`), `tool-exec.test.ts` and `tool-exec-cli.test.ts` (runner). The command fixture moved unchanged from `pi-durable-commands.test.ts` to `pi-durable-command.fixture.ts` so both runtime files share it.

The upstream conformance test "streams long document tails across root replacement deltas" in `pi-durable-storage.test.ts` timed out at its 5-second limit in three earlier full runtime runs in this container, and also on the unchanged base commit `c827cda` in a separate worktree. It passes alone in about 3 seconds and passed in the recorded run. 015 does not touch storage. No deadline was raised and no test was skipped.

### Mutation checks

Each mutation was applied alone and the nearest suite was run. All 21 were caught.

| Mutation | Caught by |
|---|---|
| Fetch values for every tool, not only bash | runtime tools |
| Skip runtime redaction; redact only bash results | runtime tools |
| Dispatch after a late grant; run after a denied grant | runtime tools |
| Write values into the request file | runtime tools |
| Pass raw chunks without streaming redaction; hold no prefix | runner |
| Let a value set an image shell variable | runner |
| Accept values for non-bash tools; keep the transport variable | runner |
| Run despite a malformed transport | runner CLI |
| Serve any role; skip the post-decryption recheck; skip the generation check; skip the 15-minute bound | web values |
| Raise the per-user limit; release without evidence | credentials capacity |
| Hand over waiting work at the bare deadline without the margin | credentials queue expiry |
| Skip slot release when no fetch started | credentials model slot |
| Page without skipping waiting rows | credentials drain (the drain never moves past them) |

## Limits

- The fixture still admits one candidate workspace and runtime authority still requires one live executor globally. Multi-workspace execution stays disabled until that cap is replaced by these claims in a separate step.
- Legacy and candidate pools are separate ledgers. During transition, a legacy session and a candidate session each count only in their own pool.
- FIFO across several sessions is implemented in the drain query but tested only through the single-session fixture.
- The candidate builder adapter is ready but no seed path uses it. Project seeds are still accounted in the legacy pool, so builders do not yet count against the candidate limits. They join when candidate projects get their own seed path.
- The acquisition-timeout release of a model slot is covered by review and code only; no test forces the wait to fail after the claim commits.
- Paging past waiting rows is checked only by a mutation in the single-session fixture. It pages by offset, so a Stop inserted or a row removed by another drainer during a drain can put one waiting row off to the next drain. Keyset paging should replace it before multi-workspace execution.
- Value delivery does not yet compare a real executor generation, identity or runtime epoch; it relies on the single-executor cap.
- The queue-expiry handover assumes product and runtime clocks agree within five seconds.
- Executor release has no caller until 016 adds termination evidence for archive and deletion. Until then an executor claim lasts for the session.
- Work of a released incarnation waits until its queue deadline and then expires; it never revives the released claim.
- If the credential object is evicted while a provider fetch is in flight, no settlement evidence arrives and that model claim stays live. No sweeper releases it yet; a repeated eviction could fill the model pool.
- Values shorter than eight characters are delivered but not redacted, matching the product's existing redaction rule.
- Redaction of later tool results uses the values granted since the session's composition opened. After a runtime restart, a value left in a file or a background process is not redacted until the next shell command is granted it again.
- A shell command that receives a value can still send it out through allowed public network traffic, or write it to a workspace file. Redaction covers output, errors, the journal and spilled output; it does not prevent exfiltration.
- Processes running as the same user in the sandbox can read the environment of the single `ditto-exec run` process while it runs.

## Review

Round 1, by an independent reviewer: REJECT, with these fixes requested.

- Must fix, done:
  - The drain compared the second-rounded queue time, so work could reach the runtime up to a second before its deadline without a slot. It now uses the command's millisecond deadline plus a five-second margin, and a test shows waiting work stays queued inside the margin.
  - A failed acquisition wait could leave a model slot live forever. It is now released with `model_not_dispatched`, by its own claim id only, and the timer is cleared on every early return.
  - The builder adapter is not wired. This is now stated in the implementation table and in Limits.
  - Gate and mutation results were missing. They are recorded above.
- Should fix, done:
  - Rows waiting for capacity could hide later rows. The drain now pages past them.
  - The value checks are now described as bounded by the single-executor cap.
  - The runtime now redacts every later tool result, not only the granting command's.
  - A malformed transport is now a known rejection instead of an executor failure.
  - Added tests: the CLI strips the transport variable, the model slot is released on denial, and the margin case.
  - The role check is now described as defense in depth.
- Not done:
  - Real executor identity and epoch checks for value delivery wait for multi-workspace authority. They are listed in Limits.

Round 2: ACCEPT WITH LIMITS, no must-fix items. Two narrow should-fix items were handled: the failure-path release now targets only this call's claim id (`releaseClaim`, tested), and offset paging, clock skew and the deferred epoch and identity checks are now in Limits.

## Acceptance

015 is accepted with limits for the local fixture scope. Multi-workspace execution stays disabled until these limits are closed: real executor generation, identity and epoch checks for value delivery; candidate builders joined to the pool; a sweeper for model claims left live by eviction; keyset paging and FIFO across sessions tested beyond one session; and executor release, which comes with 016.
