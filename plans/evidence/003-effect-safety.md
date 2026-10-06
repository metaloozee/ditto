# 003 executor investigation

Disposition: **BLOCKED at supported provider-correlation proof. Implementation is not complete.** No L1 acceptance or DONE claim. The existing 002 gates still pass. This investigation does not establish that Pi requires a private change or an upstream fix.

## Worktree and preservation

All shell commands explicitly changed directory to `/tmp/ditto-plan-003-998rQl`. Base is `cf7bfbcbfb1900392cac795d21cc32d4f5982520`, detached. The refreshed 003 plan was already modified at entry. Its exact entry hash and diff are retained in `node_modules/003-logs/baseline-hashes.log` and `baseline-plan.patch`.

Read the complete refreshed plan, project instructions, authoritative runtime specification, accepted cooperative-host-yield decision, 001 final acceptance, 002 final acceptance/completion/integration, candidate host and mandatory synthetic adapters, and the legacy journal/control tests. Relevant Cloudflare, Durable Objects and Workers skills were read. Official SQLite-storage and Worker-best-practices pages were retrieved for reference.

No application source was edited. The candidate host, mandatory adapters, inherited host tests, legacy implementation, L0, shared contracts, specification, product code, encrypted storage and historical evidence remain unchanged. `baseline-hashes.log` and `final-source-hashes.log` retain exact candidate-source hashes. No second ledger, task engine, private patch, raw-SQL tool interface or shadow transcript was added.

Only this evidence, the 003 status and the plan index are executor documentation changes. The original refreshed-plan amendment is preserved apart from its status line. The worktree remains uncommitted for independent review. No staging, commit, worktree creation/removal, main-checkout write, deployment, data reset, issue publication, live provider/executor effect, credential or `.env` read occurred. No subagent was spawned.

## Isolated locked dependencies and environment

Every install and verification command used `env -i`, the executable PATH below, `HOME=$PWD/node_modules/003-logs/home`, and no inherited credentials. Tests added `CI=1 NO_COLOR=1`. Workspace provisioning used `LEFTHOOK=0 pnpm install --frozen-lockfile`; the independent runner used `npm ci --prefix packages/sandbox-runner`. Both exited 0. Nothing reused the main checkout's installed dependencies.

```text
PATH=/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin:/home/ayan/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin
```

The initial install invocation lacked pnpm's directory in PATH and exited 127. The corrected frozen-lockfile invocation succeeded without configuration changes. Original and final package/lock hashes match for root `package.json`, `pnpm-lock.yaml` and runtime `package.json`. Workspace release-age policy remains `minimumReleaseAge: 0`; its bytes are unchanged. Runner package/lock bytes also remain unchanged according to Git. All dependencies, CLI HOME, build artifacts, logs and probes are ignored worktree-local files.

Installed versions are recorded with real resolved paths in `node_modules/003-logs/versions-final.log`.

| Component | Version |
|---|---|
| Pi Durable / pi-ai / Chord | 1.0.1 each |
| Worker pool | 0.12.21 |
| Pool-resolved Miniflare / workerd | 4.20260310.0 / 1.20260310.1 |
| Workers declarations | 4.20260702.1 |
| Runtime Vitest / TypeScript / TypeBox | 3.2.7 / 5.9.3 / 1.3.27 |
| Alchemy / Biome | 0.93.12 / 2.4.5 |
| Node / pnpm | 24.21.0 / 11.8.0 |
| Requested compatibility date | 2026-09-16, unchanged |
| Effective compatibility date | 2026-03-10, explicit installed-runtime fallback |
| Docker image | not run; no new image/digest |

Two earlier version-reading commands failed on package-export and transitive-path resolution. `versions-final.log` resolves the actual package files and succeeds. No dependency versions, release-age configuration or lockfiles were changed to address these diagnostic failures.

## Supported provider-correlation investigation

The existing fixture's provider ID `model-${providerCalls + 1}` is local to an instance. The host prefixes it with the invocation ID and stores attempt 1. That does not identify the same logical request across host replacement. Tool IDs already contain the public task/call identity, but need structured validation, message/command membership and operation-versus-attempt policy.

Inspected the pinned public `ProviderStreams`, `Provider`, `Models`, `GenerationHooks`, `CompactionHooks`, `HookApi`, `Harness.getTask`, `Harness.inspect`, task records and submission records. Read the shipped generation and compaction callers to check the actual request options and phase/retry behavior. These inspections did not modify pinned code.

Relevant installed paths and lines:

- `apps/runtime/node_modules/@earendil-works/pi-ai/dist/types.d.ts:202-207`: provider streaming operations receive model, transcript and options, without a Pi task/submission argument.
- `apps/runtime/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:510-525`: generation's public `beforeRequest` has a task-bearing `HookApi` and runs for recovered requests.
- `apps/runtime/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:545-558`: compaction has a range-selection hook, not a per-summary-request hook.
- `apps/runtime/node_modules/@earendil-works/pi-durable/dist/harness/generation.js:108-118`: the request hook precedes generation dispatch and the invocation signal is forwarded.
- `apps/runtime/node_modules/@earendil-works/pi-durable/dist/harness/compaction.js:81-84, 100-128`: selection invokes `beforeCompact`; summarization later forwards its signal but not task/attempt identity.

A disposable real Worker/DO SQLite probe uses only public Harness, Storage, task hooks and provider registration. It creates synthetic history, starts actual Pi compaction, holds the synthetic summary request, joins actual Harness close while remote work remains pending, opens the same SQLite passively, verifies the original task remains at `summarize`, attempt 1, and resumes that task. Its provider guard records option *names* only and denies any call lacking a hook-established task binding before synthetic dispatch.

Observed task IDs in the clean run were generation 8 and compaction 10. Normal generation and the first summary request mapped their supplied signal to those IDs. After actual close/reopen, the same compaction task attempted another provider call with an unmapped signal. `beforeCompact` ran once, not again during resumed summarization. The retained checkpoint still identified task 10 and attempt 1. Options had no task or attempt field. Synthetic dispatch count remained 2, counting the initial generation and initial summary; the reopened request was denied before dispatch. The original summary operation was still pending at the observation.

The observation test passes because it asserts this gap and denial. Its separate compliance counterpart requires the reopened provider call to retain the original supported hook binding and fails. **Neither result proves that the current host implements 003.** The probe is not a production adapter and does not claim complete command/run correlation.

Initial diagnostics are retained too. A relative probe Worker entry path failed before loading; its absolute path fixed configuration only. A first fixture produced no summary request until explicit synthetic assistant content was supplied. An initial hypothesis that selection and summarization always use different signals was falsified: their first uninterrupted invocation did retain the same binding. The actual reproduced gap is replacement after close, not normal first execution.

### Precise unresolved prerequisite

The per-invocation public-hook/signal bridge alone is insufficient for recovered compaction. Before extending the host ledger, establish a supported, validated binding from *each actual provider invocation* to the retained Pi task and logical request/attempt, including reopened summary requests and retries. Do not substitute a fixture counter, current run, latest task or body hash without proving causal ownership.

`Harness.inspect/getTask` expose stable public records and could support a different design. A strictly exclusive model-producing-task lane, with validated public checkpoint/request matching and deny-on-ambiguity, is a concrete alternative worth testing. Its cost is additional admission/serialization policy and adversarial proof for overlapping generation/compaction and phase changes. That design was **not implemented or falsified here**. Consequently this report is an unresolved integration-proof blocker, not a finding that supported integration is impossible. A new public per-request task/attempt binding would avoid that inference, but no upstream issue or package change is justified by this probe alone.

Execution stopped before source implementation rather than introducing an unproved correlation scheme or changing private task code. Advisor review should first resolve this prerequisite or return execution to the supported-public-record alternative. Plan steps 2-5 remain unexecuted.

## Retained 002 safety protocol

The existing single `host_effects` ledger is unchanged. Existing 002 tests remain the only Pi evidence for its two result crash orders:

1. Missing safety-result persistence leaves the original admitted effect and denies later effects, including when another failure marker cannot commit.
2. Durable safety evidence with a missing Pi tool-result commit leaves `result-recorded` as a barrier until the matching public terminal tool receipt exists.

A normal tool result is promoted on the original row only after the matching pinned `pi.tool` v1 terminal completion receipt. The safety transaction and Pi transaction are distinct; shared SQLite does not make them atomic. The inherited host suite still passes its authority-await cancellation, actual-close joining, yield-not-Stop, same-DO alarm reactivation, native alarm joining and historical negative assertions. No new result/Stop/settlement/recovery-policy acceptance follows from these passes.

## Commands and exact results

All log paths below are relative to ignored `node_modules/003-logs/`. All commands ran from the preserved worktree under the sanitized environment above.

| Command/check | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | passed, exit 0 | `install-frozen.log` |
| `npm ci --prefix packages/sandbox-runner` | passed, exit 0 | `runner-install.log` |
| `pnpm --filter @ditto/runtime typecheck` | passed, exit 0, both configurations | `baseline-types.log` |
| `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts src/lib/session-runtime-control.test.ts` | passed, exit 0, 51 tests in 2 files; legacy regression evidence only | `baseline-web.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts --reporter=verbose` | passed, exit 0, 53 tests | `baseline-host.log` |
| `pnpm runtime:verify` | passed, exit 0; both types, 6 Node checks, 81 Worker tests in 5 files | `baseline-runtime-verify.log` |
| `pnpm verify` | passed, exit 0; Biome with 14 existing warnings, web types, 808 web tests in 72 files, web build, runner types, 79 runner tests in 11 files, runner build | `baseline-verify.log` |
| Public-correlation observation probe | passed, exit 0, 1 real Worker test; diagnostic gap reproduction only | `correlation-reopen.log` |
| Same probe with compliance assertion | failed, exit 1, 1 real Worker test; expected original task ID, received undefined after reopen | `correlation-reopen-red.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts` | not run; new implementation suite was not created after stopping at step 1 | no log |
| `pnpm contracts:verify` | not run; contracts unchanged | no log |
| `git diff --check` | passed, exit 0 | `diff-check.log` |
| 003 effect/Stop completion and full L1 | not run; blocked, not accepted | this record |
| Docker, live Codex/provider, hosted authority/termination/isolation/capacity, product-handler Stop, product/transport restart, encryption, browser | not run; outside this synthetic investigation | no log |

Probe rerun commands:

```sh
cd /tmp/ditto-plan-003-998rQl
# Apply the sanitized environment above to each command.
pnpm --filter @ditto/runtime exec vitest run --config "$PWD/apps/runtime/node_modules/003-probe/config.ts" --reporter=verbose
pnpm --filter @ditto/runtime exec vitest run --config "$PWD/apps/runtime/node_modules/003-probe/red-config.ts" --reporter=verbose
```

The two configs and tests remain under ignored `apps/runtime/node_modules/003-probe/`. There is no green *implementation fix*: the passing test observes the deficiency, and the red test preserves the unmet correlation assertion. All initial failure logs remain alongside the final results. No zero-test result is counted.

## Unresolved 003 coverage

Complete validated command/run/message/submission/task/call/logical-operation/attempt correlation, durable request/tool deadlines, explicit replay policy, duplicate/conflict result handling, strengthened result-receipt validation, persistent unknown-effect run failure, priority exact-run epoch-first Stop, terminal run/member/projection-intent settlement, expiry handling, completed-ID preservation through compaction/follow-up faults, and the new effects suite remain **not run/unimplemented**. Existing host records contain only the already accepted 002 slice. Passing repository regressions are baseline results, not 003 acceptance.

## Resumed public-record lane investigation

Focused executor verdict: **passed for the tested pinned public-record association protocol; ready for advisor review and source-change instructions.** The earlier ephemeral-signal failure is not a plan-wide supported-integration blocker. No application implementation or L1 acceptance follows from this result. All preceding investigation text, first probes, failure assertions and historical logs are preserved unchanged.

The maintainer requested this bounded investigation after independently reproducing the first probes. Read the exact authorized main-checkout file `/home/ayan/ditto/plans/evidence/003-advisor-correlation-review.md` without writing the main checkout. Commands stayed in the existing detached `/tmp/ditto-plan-003-998rQl` at `cf7bfbc`. The environment reported `PI_MODEL=gpt-6.1-sol` and `PI_REASONING_LEVEL=medium`. No subagent was launched.

### Public association protocol exercised

New ignored probe files are `apps/runtime/node_modules/003-lane-probe/{fixture.ts,lane.test.ts,config.ts,tsconfig.json}`. Logs are separately retained under `node_modules/003-lane-logs/`. The probe composes the existing `PiDurableHost`, its one `host_effects` ledger and its injected mandatory guard with a synthetic guarded provider. It accesses that host's existing Harness only through the same checked test-only handle pattern used by the inherited safety tests, then calls public Pi methods. It creates no second Harness owner. There are no private Pi imports, patched task definitions, phase reconstruction, direct Pi-table SQL writes or alternate scheduling decisions.

A fixture-local correlation table, `probe_task_mapping`, stores only task/kind/conversation/owner, selection entry IDs and a source digest, prepared-request metadata and a semantic request digest. It is not an effect ledger or transcript. Effect admission, attempt association and result evidence remain on the candidate's original `host_effects` row. The existing evidence field holds bounded synthetic `{association}` metadata while the row is still `admitted`, then `{association,result}` only after the real guard's durable result barrier succeeds. This is experiment glue, not a proposed production schema change or completed 003 result protocol.

1. Generation `beforeRequest` records the **actual** public `api.taskId` and approved conversation. The adapter checks its current public `getTask` record, pinned v1 `request` checkpoint, immutable task owner, positive cutoff, model/thinking/request configuration and the normalized transcript digest. The public pi-ai `normalizeContext` utility accounts for actual provider normalization. A missing actual generation binding denies, rather than falling back to a different task.
2. Compaction `beforeCompact` records the **actual** task, conversation, owner and selected range metadata. The first uninterrupted summary must be bound by that hook's invocation signal, match its public `summarize` checkpoint and selected `firstKept`, and validate provider configuration. That bound first request durably establishes a semantic request digest and the full prepared tuple: `firstKept`, `tail`, model, thinking, stream options and finite positive max tokens. Message timestamps generated anew by the summarizer are excluded from the semantic digest; model-visible content is not discarded or reconstructed.
3. A summary request without the ephemeral binding may use only a preexisting trusted mapping **and** its previously established prepared tuple/digest. Public `inspect/getTask` must show exactly one eligible built-in producer on the approved conversation/version. Generation `request` and compaction `summarize` checkpoints count; actual waiting parents and retry-sleep checkpoints do not. Unsupported version, aborted/background state, foreign conversation, absent mapping, changed owner/range/configuration or ambiguity denies. It never chooses the latest task or guesses from the current run.
4. Every actual provider callback synchronously registers in a single adapter lane. The lane serializes association, asynchronous preparation, the existing host guard's admission awaits, metadata durability, final public-record checks and **the concrete synthetic dispatch start**, not merely an earlier scan. Dispatch returns a response promise; response waiting occurs outside the lane and follows invocation cancellation. Pending competing callbacks also deny independently of the task scan. The task/checkpoint and trusted mapping are reread, and epoch/fence/current authority are checked after preparation and immediately before dispatch initiation. Any denied association remains live-fenced; no later queued callback inherits permission.
5. Logical identity is the original task kind/ID plus a digest of its prepared cutoff/range/configuration tuple. Pi's checkpoint attempt is recorded separately from the dispatch-attempt allocation computed from existing rows for that logical request. The host invocation ID remains separate. Reads only provide association evidence. Pi alone advances `prepare`, `summarize`, retry sleep, classification and terminal state through its supported APIs.

All synthetic I/O starts inside the serialized mandatory adapter after durable admission and final checks. Hooks establish evidence; neither a hook's successful return nor a hook exception grants or enforces effect authority on its own. The registered model collection exposes no unguarded stock streaming path alongside the guarded provider.

### Unknown summary correction and real retry observations

The new unknown-summary case does **not** bypass the host ledger. The first summary is admitted through `HostGuard.admit`, its original association is durable on that admitted row, and the synthetic remote operation ignores cancellation. Actual host close is joined. The original effect remains unresolved after reopening real SQLite, so ordinary `host.schedule` rejects. A narrowly isolated defense probe calls public Pi resume on the same existing host handle, and the provider adapter rejects from the retained admitted-effect evidence before any dispatch or new association.

Pi then classifies that nonretryable denial and makes its original compaction task terminal failed. The second SQLite reopen asserts that terminal identity rather than expecting the terminal task to revive. A separate synthetic input through the same guarded public Harness exercises an actual subsequent generation request. It is also denied by the original unresolved row. Across both reopens, dispatch count remains **2**, consisting only of the seed generation and original summary. There are **4 actual provider callback attempts**, with two denied callbacks. Every original effect row is byte-for-byte unchanged; the original trusted mapping remains intact. The remote operation remains pending. The second defense input creates no effect row. Neither local close nor Pi terminal failure clears uncertainty.

The known-error case is separate. The first summary returns a completed synthetic retryable `503` error, durably records its original result through the candidate guard before Pi consumes it, and Pi commits its actual `retry` checkpoint. The host closes and reopens while retry sleep is retained. `host.schedule` grants one normal guarded new budget because there is no unresolved admitted effect. Pi's own sleep/retry phase then advances to `summarize` and invokes the provider again, without rerunning `beforeCompact`.

In the passing run, compaction task **10** retains `firstKept=9`, `tail=9`, model `faux/faux-1`, thinking `off` and `maxTokens=51`. Its logical key and request digest are identical across the two summary dispatches. The first dispatch is `via=hook`, Pi attempt **1**, dispatch attempt **1**. The second is `via=retained-exclusive`, Pi attempt **2**, dispatch attempt **2**. `beforeCompact` runs **once**, and total dispatch count is **3**, including the seed generation. The original completed-error row remains unchanged; a distinct admitted/result-recorded row records the separately allowed retry. This proves association for a real Pi retry, not exactly-once model spending.

### Exact targeted tests and results

`lane-final.log` and `lane-final-repeat.log` each contain **14 passed tests in one real Worker/DO SQLite file**, exit 0. The final repeat includes the strengthened invocation-signal and positive-range checks. Exact test names:

| Test | Result and I/O observation |
|---|---|
| `normal generation uses actual beforeRequest task and pinned request checkpoint` | passed; one dispatch, actual hook/task/cutoff association, terminal public receipt |
| `normal compaction validates trusted selection range and actual request configuration` | passed; two total dispatches, one selection hook, matching original task/range/config |
| `unknown admitted summary retains original ledger identity and denies actual resumed calls across two SQLite reopens` | passed; four provider callbacks, only two original dispatches, both subsequent calls denied, original ledger retained |
| `known completed summary error retries through real Pi after reopen with stable task range and separate dispatch attempt` | passed; three total dispatches, original task/range/logical ID, distinct retry attempt, one selection hook |
| `two actual competing compaction producers deny both before dispatch rather than selecting the latest task` | passed; both actual tasks reach `summarize`; no dispatch beyond seed, no new effect row |
| `public abort during asynchronous association preparation cancels the local wait and denies a phase-stale dispatch` | passed; public task becomes terminal aborted while preparation remains pending, zero summary dispatch; late gate release dispatches nothing |
| `authority change during asynchronous association preparation denies remote I/O` | passed; no summary dispatch or effect row |
| `epoch change during asynchronous association preparation denies remote I/O` | passed; no summary dispatch or effect row |
| `fence change during asynchronous association preparation denies remote I/O` | passed; no summary dispatch or effect row |
| `missing-mapping denies a real summary request before remote I/O` | passed; selection hook evidence alone cannot authorize dispatch |
| `request-config denies a real summary request before remote I/O` | passed; changed synthetic max-token configuration rejected before dispatch |
| `blocking compaction identifies its owned child while excluding the actual waiting generation parent` | passed; actual parent is waiting on owned compaction, child is uniquely eligible with matching owner, then parent resumes through its generation hook; three total dispatches |
| `trusted range mapping change during asynchronous preparation denies remote I/O` | passed; correlation-record mutation detected by full mapping recheck, no summary dispatch |
| `competing generation and summary requests are both observed and denied under one association lane` | passed; actual generation `request` and compaction `summarize` coexist; both denied, no dispatch beyond seed |

Commands used only the isolated HOME and executable PATH recorded above, substituting `HOME=$PWD/node_modules/003-lane-logs/home`:

```sh
cd /tmp/ditto-plan-003-998rQl
pnpm --filter @ditto/runtime exec vitest run --config "$PWD/apps/runtime/node_modules/003-lane-probe/config.ts" --reporter=verbose
pnpm --filter @ditto/runtime exec tsc -p "$PWD/apps/runtime/node_modules/003-lane-probe/tsconfig.json"
```

| Check | Exact outcome | Separate log |
|---|---|---|
| First targeted suite | failed, exit 1; 10 passed, 1 failed | `node_modules/003-lane-logs/lane-first.log` |
| Corrected 13-test suite | passed, exit 0; 13 tests | `lane-second.log` |
| Strengthened queued-provider registration | passed, exit 0; 13 tests | `lane-third.log` |
| Probe typecheck, first attempt | failed, exit 2; two hook-return typing errors | `probe-types-first.log` |
| Final probe typecheck | passed, exit 0; explicit `undefined` hook returns | `probe-types-final.log` |
| Final targeted suite | passed, exit 0; 14 tests | `lane-final.log` |
| Final probe typecheck repeated | passed, exit 0 | `probe-types-final-repeat.log` |
| Final targeted suite repeated | passed, exit 0; 14 tests | `lane-final-repeat.log` |
| Source/first-probe preservation and `git diff --check` | passed | `preserved-hashes.log`, `preservation.log`, `diff-check.log` |
| Full repository/host/runtime baseline reruns | not run this resumed investigation | earlier baseline results remain above, not relabeled |
| Application implementation, complete 003/L1, hosted/live/Docker/product/browser checks | not run | no authorization in this resumed investigation |

The first targeted failure was an incorrect test expectation that the denied compaction would still have a `summarize` checkpoint on its second reopen. Its ordinary nonretryable denial actually settles the task as failed. The corrected test asserts that terminal public receipt and tests a subsequent guarded generation call, while keeping the stronger original-ledger and zero-new-dispatch assertions. No original probe or historical red assertion was altered. Probe type errors were fixed with explicit `undefined` returns required by the public hook contracts, not type suppression.

No project dependency install or package/configuration change occurred in this resumed turn. Isolated HOME caused Corepack to fetch the already pinned pnpm 11.8.0 CLI on its first invocation; it did not install new project versions. Pi/Chord/pi-ai remain 1.0.1, Worker pool 0.12.21, Miniflare 4.20260310.0, workerd 1.20260310.1, runtime Vitest 3.2.7 and TypeScript 5.9.3. Node/pnpm remain 24.21.0/11.8.0. Requested/effective compatibility remains **2026-09-16 / 2026-03-10**, explicitly reported by each Worker run. No September or hosted claim.

### Residual limits and handoff

No causal counterexample was reproduced within this experiment's constrained registry: pinned built-in generation/compaction, an approved conversation, no deferred provider methods, no arbitrary trusted task/provider calls, all producing paths guarded, and one serialized adapter association/admission/dispatch lane. Both same-kind and mixed-kind competitors were rejected. The public-abort test covers a supported phase/lifecycle invalidation, not arbitrary private checkpoint rewriting.

The compaction fallback deliberately also requires a request digest/prepared tuple established by an earlier genuinely hook-bound summary request. A crash after range selection but **before that first association** has no such evidence and is denied. This is a conservative availability limitation, not permission to infer a caller or dispatch from one task count. Reconstructing a first recovered request without that association was not attempted. Broader extension sets, deferred/polling calls, SDK-internal network retries, unknown task versions and multi-conversation/background production need their own guards or denial; they are not positive coverage here. A digest matches a previously validated request, but does not grant authority or make a replay safe.

The known-result handoff used here remains two separate safety/Pi commits. The existing one-ledger result barrier is used, not a claimed cross-system transaction. Result-commit crashes, duplicate/conflict results, trusted reconciliation, run/message settlement, exact-run Stop and completed-ID preservation remain the unimplemented 003 source work. This investigation neither clears an unknown effect nor implements a retry scheduler.

The public-record alternative is feasible for the tested conservative protocol. The prior plan-wide blocker should not be inferred from the unchanged first signal probe. Application source is still byte-identical to entry, and no source implementation is authorized by this result. Await the advisor's source-change instructions. The old evidence section is preserved as historical investigation; this appended section is the current focused feasibility result.

## Source implementation for advisor review

Executor disposition: **READY FOR ADVISOR REVIEW.** Source steps 1–5 have now been implemented and exercised locally. This is not DONE, complete L1 acceptance, product enablement or permission to integrate. The initial BLOCKED heading and both investigations above are historical and remain unchanged. The advisor's public-record feasibility acceptance was read completely from the explicitly authorized main-checkout path before this source execution.

### Isolation and preserved inputs

Execution used only the existing detached `/tmp/ditto-plan-003-998rQl`, HEAD `cf7bfbcbfb1900392cac795d21cc32d4f5982520`. The session reported `PI_MODEL=gpt-6.1-sol`, `PI_REASONING_LEVEL=medium`. No subagent was launched. Every shell invocation explicitly changed directory to this worktree. Verification used:

```text
env -i
PATH=/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin:/home/ayan/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin
HOME=$PWD/node_modules/003-implementation-logs/home
CI=1
NO_COLOR=1
```

New ignored logs are under `node_modules/003-implementation-logs/`. `preedit-hashes.log` records the exact entry hashes before any source edit. `source-review-hashes.log`, `source-review.patch`, `preservation-review.log` and `gate-status.log` retain the final source identity, tracked implementation diff, unchanged protected paths and command exits. The new untracked effects test is preserved in the worktree and covered by its final hash. Historical host assertions, first probes, lane probes, 001/002 evidence, L0, legacy runtime/journal/control, the specification, package pins and lockfiles remain intact. No fixture entry or configuration change was needed because the existing Worker suite discovers the new test file.

No main-checkout write, second worktree, stage, commit, merge, push, issue publication, deployment, reset, deletion, credential or `.env` read, dependency install/change, private Pi modification, or live provider/executor effect occurred. Source and logs remain uncommitted for independent review. The worktree is preserved.

### What changed and who owns it

`apps/runtime/src/pi-durable-host.ts` remains the sole safety owner. It extends the existing `host_effects` table with versioned correlation, a separate `operation_deadline`, and bounded committed Pi retry evidence. It adds only command/run/member/task/control/review/projection-intent metadata. Accepted content remains in the existing inbox and Pi; the command mapping does not copy transcript content. There is no second effect ledger, transcript reconstruction, result replay engine or continuation scheduler.

- Acceptance stores stable command, run, user and assistant IDs and sequence membership. Submission acknowledgment loss is resolved through the supported `Storage.submissionByRequest` dedupe record. Hook-time public placed-submission and `Conversation.viewState` membership handle Pi starting before the host acknowledgment. Neither a latest task nor a streaming event establishes a run. Follow-ups wait for a supported predecessor turn boundary.
- The mandatory provider lane synchronously registers callbacks and covers association, request hashing, asynchronous preparation, durable admission, final public-record/authority rereads and actual synthetic dispatch initiation. Response waiting is outside that lane under invocation cancellation. Generation requires the actual hook binding. Compaction requires trusted selection/owner metadata and a first hook-bound prepared tuple/digest; resumed summary association requires that exact retained tuple/digest and one eligible producer. Waiting parents and retry sleep are excluded. Background, foreign, incompatible, competing and deferred paths do not gain authority.
- Logical model identity uses the retained task and prepared cutoff/range/configuration. Pi attempt, actual spending attempt and host invocation are separate. A synchronous public commit subscriber retains matching native retry evidence on the same result row. It neither calls Session APIs nor schedules task phases. Live and reopened known-error retry require that original result and matching committed Pi retry evidence; same-checkpoint resend is not automatic replay.
- Exact tool admission verifies the pinned original tool task, call, assistant entry, validated arguments, run membership, epoch, lifecycle generation and executor. Shell replay is prohibited. Read repeats require explicit new-observation policy and distinct original calls. Structured writes are denied without expected-content arguments and an explicitly supported executor capability. This fixture does not claim real write/edit replay support.
- Result evidence is bounded and validated before Pi can consume it. Identical results remain idempotent after reopen, without clearing any fence. Conflicts persist review blocks. Tool completion requires the original public terminal receipt and matching successful result entry/call/content, not an error/interruption receipt. Generation and compaction results require matching public committed evidence. Safety and Pi commits remain separate; both crash orders retain barriers.
- Storage failures immediately deny live effects. Failure markers are best-effort. Reopen derives failure and uncertainty from durable admitted effects when no new marker could commit. Healthy later writes do not clear denial. The explicit trusted storage-reconciliation action checks storage health, current authority and accounted-for dispositions; it cannot clear unresolved effects or permanent review blocks.
- Unknown admitted effects fail their affected run and pending assistants, retain the original operation/attempt/executor/deadline, and block the workspace across new command IDs and repeated SQLite reopens. A failed run never revives. Known completed mutations and context survive compaction/follow-up consumption and reopen without repetition.
- Exact-run Stop stores its control and advances the targeted run epoch before public cooperative cancellation. It does not acquire ordinary capacity or enter the provider lane. Missing predecessors and exhausted ordinary capacity do not delay it. A later-run task is never canceled by an old terminal run's control. Uncooperative remote shell execution remains unresolved and counted after local cancellation; stopping can instead become failed with a persistent block on reopen.
- First interruption and the fixed 15-minute recovery deadline are per run. Retry, host yield and reopen do not extend them. Finite model/tool deadlines are independent of host work/drain budgets. For historical 002 assertion compatibility, `host_effects.deadline` retains its original invocation endpoint; correlated execution uses the separate persisted `operation_deadline`. Terminal state, pending assistant settlement and bounded local projection intent commit together. Already-complete assistants stay complete. Public commit evidence reserves settlement wakeup intent, and the same alarm policy reconciles it without repeating I/O.

`pi-durable-cooperative-fixture.ts` supplies credential-free guarded generation, summary and tool adapters. The DO composition passes the complete guard. The older callback signature remains for inherited 002 fixture compatibility only. No unguarded stock provider/tool or remote networking path is registered by the correlated composition. Tests use the existing host's public Pi APIs; the checked test-only Harness handle is confined to tests. Production source has no Reflect/private-handle access, private imports or raw SQL supplied to tools.

### Red signals and corrections

All failed runs are retained, not relabeled as passing evidence.

| Log | Actual finding and correction |
|---|---|
| `red-effects.log` | Before source edits, the identical-result regression failed, 1 test, because a second result update returned no row. The final test exercises actual completed evidence, including reopen, rather than arbitrary result JSON. |
| `types-first.log` | Initial integration typecheck failed. Harness has no direct entry reader; the supported injected public Storage contract supplies exact entry reads. A checkpoint narrowing and tool-arguments type error were corrected without private APIs or type suppression. Later type logs pass. |
| `effects-first.log` | 6 failures / 9 passes. A subsequent denial overwrote the original review reason; the marker now preserves it. Already-settled Pi tasks needed explicit guarded defense input on reopen. Compaction's manual public receipt is a write submission, not always an entry ID; receipt validation now follows its actual public submission/entry pair. |
| `effects-second.log`, `effects-third.log`, `effects-fourth.log` | Each retained one submission-ack expectation failure. Public inspect lists unfinished submissions only, and the start/ack race may settle or deny the first request before the host fault is observed. The test now observes stable original user-entry IDs, one command mapping, terminal fate and at most one total spending dispatch. It does not assume an unfinished inspect record or force a terminal task to revive. |
| `host-first.log`, `host-second.log` | Each had 4 failures / 49 passes. New denial wording and the new effect deadline differed from historical assertions. Historical assertions were not changed. Denial retains both reason categories, and the old immutable endpoint remains alongside the separately enforced operation deadline. `host-third.log` then passed all 53. |
| `effects-gate.log`, `host-gate.log`, `runtime-gate.log`, `options-probe.log` | The strict additional-option check rejected Pi Models' own undefined `apiKey`, `headers`, `env` placeholders. The fixture never reached its awaited dispatch-entry signal, causing a test timeout and collateral isolated-storage `.sqlite-shm` cleanup diagnostics. A names-only probe identified the three fields. The guard now allows only their undefined keyless placeholders, rejects any credential-bearing value, and excludes them from persisted request metadata. No package/runtime change, timeout increase, disabled isolation or weakened dispatch assertion was used. Debug instrumentation was removed. |
| `effects-options.log`, `host-options.log` | After that correction, all 33 new effects and 53 inherited host tests passed. Final complete gates below pass too. The failed cleanup diagnostics above are not claimed as a workerd repair. |

`effects-fifth.log` passed 31 tests and `effects-sixth.log` passed 32 during incremental coverage. Those are earlier source results, not substitutes for the final 33-test suite. `verify-gate.log` passed the unrelated repository gate while the strict options defect still failed runtime tests; it is not runtime acceptance.

### Final environment and gates

`versions-review.log` resolves the actual isolated installed package paths. Pi Durable / pi-ai / Chord are **1.0.1** each; Worker pool **0.12.21**, Miniflare **4.20260310.0**, workerd **1.20260310.1**, runtime Vitest **3.2.7**, TypeScript **5.9.3**, TypeBox **1.3.27**, Node **24.21.0**, pnpm **11.8.0**. Pins and lockfiles are unchanged. Requested compatibility date remains **2026-09-16**; the installed runtime explicitly falls back to **2026-03-10**. No September, hosted or image-digest claim is made. No Docker image was run this source execution.

All commands below ran from the preserved worktree with the sanitized environment above. `gate-status.log` records exact exits, including earlier failures. These final command logs supersede only their earlier candidate results, not historical investigations.

| Command | Final outcome | Log under `node_modules/003-implementation-logs/` |
|---|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts --reporter=verbose` | passed, exit 0, 33 tests in 1 real Worker/SQLite file | `effects-review.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts --reporter=verbose` | passed, exit 0, 53 inherited tests, unchanged assertions and native lifecycle joins | `host-review.log` |
| `pnpm --filter @ditto/runtime typecheck` | passed, exit 0, both configurations | `types-review.log` |
| `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts src/lib/session-runtime-control.test.ts` | passed, exit 0, 51 tests in 2 files; legacy regression evidence only | `web-review.log` |
| `pnpm runtime:verify` | passed, exit 0, both types, 6 Node checks, 114 Worker tests in 6 files | `runtime-review.log` |
| `pnpm verify` | passed, exit 0, Biome, web types, 808 web tests in 72 files, web build, runner types, 79 runner tests in 11 files, runner build | `verify-review.log` |
| `pnpm contracts:verify` | not run, contracts unchanged | no log |
| Protected-path diff and hashes | passed, exit 0; host assertions/config, L0, legacy implementation, specification, package/lock inputs unchanged | `preservation-review.log`, `source-review-hashes.log` |
| `git diff --check` | passed after documentation append, exact exit in final preservation log | `diff-check-review.log` |
| Independent source review / complete L1 | not run; advisor decision pending | this handoff |

Biome reports 29 warnings, including the preexisting warning set and additional fixture/test non-null/void-union warnings. There are no errors, suppressions or lint configuration changes. They remain visible for review.

### Exact new test names

All 33 names below passed in `effects-review.log`. The same file also passes in the final 114-Worker repository runtime gate.

1. `identical durable result delivery is idempotent`
2. `actual Pi unsafe recovery attempts the next tool and model but neither dispatches through two reopens`
3. `completed synthetic mutations and follow-up membership survive reopen without repetition`
4. `conflicting result persists review block across reopen and new command`
5. `healthy later writes cannot clear a storage barrier but current trusted reconciliation can account for an undispatched admission`
6. `actual generation and unsafe tool persist structured exact membership before dispatch`
7. `lost shell result commit denies actual tool/model callbacks across two SQLite reopens, unavailable=false`
8. `lost shell result commit denies actual tool/model callbacks across two SQLite reopens, unavailable=true`
9. `unavailable failure marker is unnecessary for reopen denial from durable admitted shell`
10. `safety result before failed Pi commit is not original successful tool receipt`
11. `shell-replay is denied on actual registered tool before executor I/O`
12. `implicit-read is denied on actual registered tool before executor I/O`
13. `unsupported-write is denied on actual registered tool before executor I/O`
14. `read repeats are explicit new observations on distinct original calls, never replay of an unresolved call`
15. `priority exact-run Stop bypasses missing predecessor and exhausted ordinary executor capacity`
16. `Stop during async model preparation commits revocation before cancellation and stale release dispatches nothing`
17. `uncooperative shell Stop is stopping, cancellation receipt is not termination`
18. `delayed old-run Stop never cancels later run or revives terminal completion`
19. `first interruption recovery deadline is fixed across two real reopens and expiry settles pending membership atomically`
20. `lost submit acknowledgment resolves public dedupe without duplicate spending`
21. `alarm settles committed submissions and pending projection intent without allocating another invocation or repeating I/O`
22. `completed model IDs and context survive close/reopen without repeating completed command`
23. `public committed retry evidence authorizes a separate summary attempt without reopening or guessing current task`
24. `known completed summary error retries after reopen with retained logical request and separately recorded spending`
25. `first summary association missing after close is denied rather than inferred from a sole retained producer`
26. `owned blocking compaction excludes its actual waiting generation parent and preserves command membership`
27. `mixed actual generation and compaction producers deny both under one lane`
28. `unknown admitted summary blocks actual recovered requests through two SQLite reopens`
29. `authority during summary preparation denies actual dispatch`
30. `mapping during summary preparation denies actual dispatch`
31. `competition during summary preparation denies actual dispatch`
32. `finite operation expiry fails run but retains original executor and deadline`
33. `normal compaction establishes hook-bound tuple and preserves completed summary across reopen`

### Coverage boundaries and remaining review

The original unknown shell and summary retain their logical identity, spending attempt, epoch, executor, invocation and operation deadline through two actual SQLite reopens. Unsafe Pi recovery attempts actual later tool/model callbacks, but mandatory adapters dispatch zero new I/O. New command IDs cannot evade the workspace block. Storage unavailability is separately exercised with no committed marker. Both result crash orders, native retry evidence, priority Stop, stale callbacks, uncooperative execution, completed-result/context preservation, follow-up membership, fixed recovery expiry and local atomic assistant/projection settlement have implementation evidence.

The code remains disposable plaintext local feasibility glue. Missing first summary association is deliberately denied. Unsupported task versions/background/deferred/foreign paths remain disabled or rejected, not positively supported. Expected-content write replay has rejection policy but no real write/edit adapter or successful remote replay claim. Conservative bounded receipt reads may retain a barrier rather than guess when evidence is not available. No explicit uncertainty acknowledgment, filesystem recovery, projection transport or product admission/routing is introduced. An isolated live executor cannot free the hard one-executor fixture capacity. Local cancellation and Pi receipts do not prove hosted process termination.

Docker, hosted termination/isolation/capacity/eviction, actual Codex/provider networking, encryption, product-handler Stop under gaps/capacity, product/transport restart, browser and coding-tool parity are **not run**. Product-handler repetition belongs to 008 and projection transport to later work; no product-level claim follows from these local tests. Independent advisor review of every source hunk and fresh gate reruns remain required before accepting 003 or complete L1. Nothing is staged, committed or integrated.

## Advisor defect corrections for renewed source review

Executor disposition: **READY FOR ADVISOR REVIEW**, not DONE or complete L1. The advisor rejected the initial candidate for five reproduced defects. This append records the corrections and fresh checks on the corrected source. All preceding evidence and the targeted diagnostic supplement remain historical and unchanged.

### Isolation, continuation and retained artifacts

The interrupted correction executor's work was continued only in detached `/tmp/ditto-plan-003-998rQl`, HEAD `cf7bfbcbfb1900392cac795d21cc32d4f5982520`. The complete current host, mandatory fixture and effects tests, refreshed plan, accepted 002 review, diagnostic supplement and authorized read-only main-checkout advisor review were inspected. No agent was spawned. Every shell invocation explicitly changed to this worktree. No main-checkout write, stage, commit, merge, push, deployment, deletion/reset, credentials or `.env` read, live provider/executor effect, package/private Pi/lock/configuration change or install occurred.

Correction logs are under ignored `node_modules/003-correction-logs/`. The interrupted executor had already captured the exact pre-correction source in `baseline/apps/runtime/src/` and `baseline.sha256`, written seven permanent regressions and run them red before correcting the host. Those baseline bytes and logs remain intact. The continuation removed one temporary synthetic-counter console observation and scoped Biome formatting to the host and new effects test only. It did not replace alarm policy, change historical assertions or add a scheduler.

The exact final incremental diff against that preserved candidate is `incremental.patch`, including the new untracked test. `final-source.sha256` identifies the final code below. `protected-paths.sha256` and `preservation-final.log` verify 53 protected tracked inputs against HEAD, including all other tracked runtime files, historical host assertions, runtime configuration/L0, contracts, legacy runtime/tests, specification, 001/002 evidence and package/lock inputs. The mandatory fixture is unchanged relative to correction entry. It remains modified relative to HEAD by the earlier candidate implementation. The ignored original diagnostic file/config and diagnostic supplement also retain their correction-entry hashes. The original 33 effects tests retain their assertions; the new adapter injection is only a fixture seam for actual guarded callbacks.

| Final source | SHA-256 |
|---|---|
| `apps/runtime/src/pi-durable-host.ts` | `193fd4406d4e7853589be6214c3621b38e2849a912273db73412aaa0bbc589ac` |
| `apps/runtime/src/pi-durable-cooperative-fixture.ts` | `b1d08d07e4112b95b8329cc40df5a94791bf666ef9594ccd0d77e21ff0dec6e5` |
| `apps/runtime/src/pi-durable-effects.test.ts` | `bf94586ac631d975b2f2c3f210681af2cdd197f3488cc16d4bcc9f87ae0937c2` |

### Corrected host transitions

1. Shared effect reservation now checks unresolved effects inside the short admission transaction and again immediately before dispatch. Typed `EffectDenied` separates reservation, recovery-deadline and authority policy from persistence failure. A reservation denial itself neither installs a storage-failure marker nor live-fences the winning callback. The actual simultaneous manual-summary/sequential-tool regression allows conservative denial of both but asserts at most one unresolved admission and at most one new dispatch. There is still one `host_effects` ledger, not a cross-kind callback coordinator.
2. Matching original terminal failed `pi.compaction` receipts account for known nonretryable or retry-exhausted model errors. Validation checks the pinned task/input, latest operation attempt, retained owner/mapping/prepared tuple/digest/range/model and exact error. The same effect becomes `pi-committed`; terminal run, pending members and projection intent settle in one local transaction. Already-complete assistants remain complete. No summary entry is fabricated.
3. Exact run authority compares the fixed `recovery_at` against the current clock. Model/tool wrappers expire on that typed denial. The result barrier rechecks inside its transition and after durability before returning evidence to Pi. Separate actual known-error retry tests cross the deadline during held preparation and during response waiting. They do not call alarm or explicit expiry first. Both fail pending membership; the response-only case retains its admitted effect and Pi does not consume it as successful completion.
4. Graceful yield and trusted abrupt takeover share interruption accounting. Takeover without an exact trusted termination timestamp uses the old invocation's durable `started` as a conservative lower bound. Existing interruption/recovery timestamps remain unchanged and recovery wakeup intent is retained. This may expire recovery up to one invocation early. It never resets the clock at a late reopen or claims that invocation start was actual termination. The permanent case joins public Harness close and storage, then supplies exact higher-generation `priorTerminated` evidence and verifies denial past the original bound with a known completed-error retry.
5. Alarm handling consumes serviced due reconciliation/Pi-retry/settlement intent before native repair. Submitted/settled inbox wakeups are consumed without deleting accepted inbox work. Repair retains meaningful future reservations, recovery and explicit retry/effect/projection/checkpoint intents, and preserves unrelated earlier native alarms. A native alarm that was rearmed from a now-consumed intent can be replaced by the next retained deadline. No effects, uncertainty rows or Pi continuation records are deleted. The actual native no-work regression joins platform event completion/storage and checks null in-handler `getAlarm`, no past rearm, no serviced intents and no remaining native alarm. Inherited earliest-alarm, dropped-alarm, same-DO reactivation and resource-join assertions remain unchanged and pass.

### Permanent red-to-green evidence

`permanent-red.log` and `permanent-red-second.log` retain seven failed correction cases against the preserved candidate host before fixes. The second run has seven assertion failures and 33 skipped original tests, not zero discovered tests. `permanent-green-first.log` records the earlier correction pass; it is not substituted for fresh final verification. `permanent-final.log` now passes all seven against the formatted final source:

- `correction: native settled no-work alarms consume serviced reconciliation without past rearm`
- `correction: known final compaction error settles original run, retryable=false`
- `correction: known final compaction error settles original run, retryable=true`
- `correction: actual tool/manual-summary race reserves at most one operation and dispatch`
- `correction: fixed recovery expiry is enforced after held preparation`
- `correction: response-only recovery expiry rejects result before Pi consumes it`
- `correction: trusted abrupt takeover fixes recovery from the prior durable bound`

The original five ignored diagnostic assertions were not edited. Their earlier `historical-probes-green.log` is retained, but **fresh full diagnostic execution does not pass**: `diagnostics-final.log` has four passes and gap 3's bounded observation timeout. `diagnostic-race-repeat.log` reproduces that timeout alone. The wait is after both authority gates release and requires `executionCalls + providerCalls >= 2`, meaning a new dispatch beyond the seed generation. Current conservative denial can leave no new dispatch, so this wait does not reach its assertions. The historical race probe requires exactly one admission/dispatch, while the correction brief permits denying both. No timeout increase or historical assertion change was made. The permanent regression reaches the actual shared race and asserts the required at-most-one admission/dispatch plus absence of a storage-failure marker. This diagnostic discrepancy remains explicit for advisor review; neither failed command is reported as green.

### Fresh final environment and gates

All final commands used `env -i`, the same executable PATH recorded above, `HOME=$PWD/node_modules/003-correction-logs/home`, `CI=1` and `NO_COLOR=1`. `final-gate-status.log` records exact exits. Logs below are relative to that correction directory.

| Command | Outcome | Log |
|---|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts --reporter=verbose` | passed, exit 0, 40 tests | `effects-final.log` |
| Same command with `-t correction:` | passed, exit 0, 7 correction tests, 33 skipped | `permanent-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts --reporter=verbose` | passed, exit 0, 53 inherited tests | `host-final.log` |
| `pnpm --filter @ditto/runtime typecheck` | passed, exit 0, both configurations | `types-final.log` |
| `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts src/lib/session-runtime-control.test.ts` | passed, exit 0, 51 legacy tests in 2 files | `web-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run --config node_modules/003-diagnostic-probe/config.ts --reporter=verbose` | failed, exit 1, 4 passed / 1 observation timeout | `diagnostics-final.log` |
| Same ignored-probe command with `-t gap3` | failed, exit 1, same observation timeout | `diagnostic-race-repeat.log` |
| `pnpm runtime:verify` | passed, exit 0, both types, 6 Node checks and 121 Worker tests in 6 files | `runtime-final.log` |
| `pnpm verify` | passed, exit 0, Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build | `verify-final.log` |
| `pnpm contracts:verify` | not run, contracts unchanged | no log |
| Source formatting | passed, exit 0, only host/effects files written | `format-final.log` |
| Protected inputs and `git diff --check` | passed | `preservation-final.log`, `protected-paths.sha256`, `diff-check-final.log` |
| Independent corrected-source acceptance / complete L1 | not run | advisor pending |

Biome reports 29 warnings, no errors or suppression/configuration changes. Two version-resolution attempts failed on package exports and the transitive workerd path. Those failed logs remain as `versions-final.log` and `versions-resolved-final.log`. The successful `versions-verified-final.log` resolves actual installed package files and records Node 24.21.0, pnpm 11.8.0, Pi Durable/pi-ai/Chord 1.0.1, Worker pool 0.12.21, Miniflare 4.20260310.0, workerd 1.20260310.1, Vitest 3.2.7, TypeScript 5.9.3, TypeBox 1.3.27, Biome 2.4.5 and Alchemy 0.93.12. No dependency or configuration correction was needed. Requested/effective workerd compatibility remains **2026-09-16 / 2026-03-10**, not September runtime validation.

Hosted behavior, live provider/executor effects, Docker/image acceptance, encryption, product handlers/restarts, projection transport, browser and coding-tool parity are **not run**. The conservative takeover bound and missing first-summary association availability limit remain. Source is uncommitted and preserved for independent advisor review of the exact correction hunks and fresh gates. No integration is authorized by these results.
