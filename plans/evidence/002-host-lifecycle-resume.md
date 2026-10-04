# 002 resumed host experiment

Disposition: partial implementation, not complete 002 acceptance. The public built-in cancellation gate passed. The guarded candidate's current tests pass, but the complete revised failure matrix is not proved. Keep 003 BLOCKED and L1 incomplete.

This record supplements, and does not replace, [historical execution evidence](002-host-lifecycle.md), [historical advisor review](002-advisor-review.md), and the [accepted cooperative-wait decision](../decisions/002-cooperative-host-yield.md). The arbitrary noncooperative-task result stays a failed host gate. Its passing reproduction test is not new acceptance evidence.

## Baseline and isolation

Execution stayed in the existing detached `/tmp/ditto-plan-002-9KCuBv`, HEAD `3d69820ead2daf3a5e22936ad23e1b3dd37c72ed`. No other worktree was created. At entry, tracked dirty files were `plans/002-bounded-host-lifecycle.md`, `003-effect-admission-and-stop.md`, and `README.md`. Untracked work was the historical `apps/runtime/src/pi-durable-host.test.ts`, `plans/decisions/`, `002-host-lifecycle.md`, `002-advisor-review.md`, and the unpublished `002-upstream-issue-draft.md`.

The entire historical test body, `passive reads admit nothing but close cannot bound a noncooperative invocation`, remains unchanged. New imports, helpers and tests surround it. Historical evidence SHA-256 remains:

- `002-host-lifecycle.md`: `4b5e1b2e887e7a577b219c45c6885004a32fb7c0cfa2d6dea9ed2bdb50cd6157`.
- `002-advisor-review.md`: `169a02b9db37e1c9132ebd81f78d80bfd1d6244e1bfecb6de74777876cbcee95`.

`pi-durable-local.ts` remains SHA-256 `d5ac03455881f7c523d665b075d8e15953bceb1066df16b961de5c80b8efe4f8`. `session-runtime.ts` remains `53238bab2c662ddad892a4f77ad5e9873d9e6342707e33151227768f5c26683b`. The legacy no-alarm assertion is unchanged and passes. Existing 003, decisions and upstream draft were not edited.

Applied exactly the six approved old/new replacements to `docs/specs/pi-durable-session-runtime.md`, in one exact-match edit. All six old blocks matched. A comparison against HEAD plus those six replacements confirms that the entire resulting spec equals that expected text. No other spec amendment was made.

Verification commands explicitly used this directory and `env -i PATH="$PATH" NO_COLOR=1 HOME="$PWD/node_modules/.plan-002-resume/home"`. Logs and generated home/cache state are under ignored worktree `node_modules/.plan-002-resume/`. Existing worktree dependencies were used. Corepack bootstrapped the pinned pnpm CLI into the sanitized local HOME on the first command. No project dependency installation, external credential file read, `.env` read, real provider request, control-plane call, Docker invocation, deployment, issue publication, stage, commit, reset or main-checkout write occurred. Inherited auth regression tests use their synthetic fixtures, not live credentials.

The requested executor model was `openai/gpt-6.1-sol` with High reasoning. Model selection belongs to the invoking harness; this implementation did not launch or switch to another model. The missing advisor `closing-the-loop.md` was not guessed or fetched. Execution followed 002's explicit requirements. No instruction-like repository text was used to authorize operations beyond the supplied project conventions.

## Exact installed environment

| Component | Installed version / effective setting |
|---|---|
| Pi Durable | 1.0.1 |
| pi-ai | 1.0.1 |
| Chord | 1.0.1 |
| TypeBox | 1.3.27, unchanged pin |
| Cloudflare Worker Vitest pool | 0.12.21 |
| Worker type declarations | 4.20260702.1 |
| Vitest | 3.2.7 |
| TypeScript | 5.9.3 |
| Node | 24.21.0 |
| pnpm | 11.8.0 |
| workerd | 1.20260310.1, existing installed runtime |
| Requested test compatibility date | 2026-09-16, unchanged |
| Effective test compatibility date | 2026-03-10, explicit installed-runtime fallback in logs |
| Compatibility flags | Existing `nodejs_compat`; pool adds its existing Node test-runner flags |

No September compatibility, hosted lifecycle, or image-digest claim follows from these tests. No Docker image was built or run in this execution.

## Public interfaces and actual phases

Read locked shipped declarations and implementations, not a guessed API or a development branch:

- `pi-ai/dist/models.d.ts`: `Provider.stream`, `streamSimple`, `MutableModels.setProvider`, `createModels`. `models.js` applies auth and lazily forwards the public provider event stream. The synthetic provider installs only bounded keyless auth, its static faux model catalogue, and guarded stream implementations. It does not inherit faux deferred-request methods that could bypass the guards.
- `pi-ai/dist/utils/event-stream.{d.ts,js}`: public `createAssistantMessageEventStream`, `push`, `end`, `result`. Cancellation ends both the local event iterator and its terminal result. Abandoning only `result()` would not suffice.
- `chord/dist/context/index.{d.ts,js}`: `withAbortSignal` and `awaitWithContext`. Only the adapter-local waiter ends. A separate observer handles the remote promise's eventual resolve or reject.
- `pi-durable/dist/harness/types.d.ts`: `defineTool`'s context, task/call identities, public registry and Harness operations. `Harness.open` and public `SqliteStorage.open` use the unchanged L0 `fixtureDatabase` facade over actual DO SQLite.
- `harness/generation.js`: actual `pi.generation` prepare, request, stream consumption/partial cleanup, classify, sequential tools and retry. The request supplies `runtime.signal`. `streamResponse` consumes the public stream, awaits its result, stops its throttle and awaits any pending partial commit. Retry uses `runtime.sleep(until, context)`.
- `harness/tool.js`: actual `pi.tool` call and execute phases, unsafe replay policy, context passed to the deployment-owned tool, progress cleanup and settlement. A canceled local execute wait returns through this built-in cleanup without invoking user abort.
- `harness/compaction.js`: inspected select/summarize/retry, including `completeSimple` with `runtime.signal`. Compaction is disabled in this slice. No compaction runtime pass is claimed.
- `harness/scheduler.js`, `harness/harness.js`, `session/session.js`: actual close seals scheduling, aborts invocation signals, joins invocation completion, then closes storage. Tests await that same close directly. There is no outer close-timeout race authorizing replacement.

`apps/runtime/src/pi-durable-cooperative-fixture.ts` supplies the synthetic provider and unsafe sequential tool. All execution goes through their mandatory admission/result callbacks. No stock local tool or remote-to-host fallback is installed. Two tool calls are offered, so the live first tool demonstrates that the second is not concurrently dispatched. Remote promises deliberately ignore cancellation. Local waits reject under Pi's invocation signal/context, while the remote promise stays pending. Late resolves and rejects remain observed and cannot resume the closed provider/tool continuation.

Step 1 passed before broad host implementation: real `Conversation.submit({ type: "input", ... })`, actual generation/provider streaming, and actual sequential tool execution. It did not substitute a cooperative custom task. It persisted a fence and admitted-effect records before close, awaited actual close, verified no abort mark and retained input/task state, and opened the replacement only afterward.

## Candidate protocol and budgets

`apps/runtime/src/pi-durable-host.ts` is disposable local host glue, not production routing. Only `pi-durable-test-entry.ts` exports its DO fixture, with a new test-only SQLite binding in `vitest.config.ts`. L0 and the legacy scheduler are unchanged.

There is one host invocation record, one admission/evidence table, an inbox, wakeup intents and a version/epoch/fence record. Pi alone owns tasks and conversation continuation. The host does not reconstruct task phases or add another continuation engine.

Default scheduled-work budget is **1000 ms**. Default cooperative drain is **1000 ms**. Before scheduling, SQLite stores a random host invocation ID, ownership generation, start time, absolute `yield_at = started + 1000` and `end_at = started + 2000`. These are distinct from Pi task IDs, original tool call IDs, effect IDs/attempts and the fixture run epoch. The synthetic epoch and effect attempt are 1. Budgets can be injected; acceptance tests use the stated defaults.

Duplicate deliveries carrying the invocation ID reuse its stored identity and deadlines before yield, during drain and after an accounted close. Opening is passive and allocates no budget. A fresh invocation is allocated only by scheduling after the prior record is closed and current authority and effect checks pass. Tests distinguish that transition from a duplicate of the old invocation. The real Pi retry `until` and the first-interruption recovery deadline remain unchanged across the next invocation.

Admission records identify kind, original operation, host invocation, epoch, attempt, executor generation where applicable, dispatch state and deadline. Their durability is awaited before the synthetic remote operation counter increments. Async authority/preparation is followed by fence/signal/generation checks. A completion records bounded synthetic result JSON before returning it to Pi. These records are not rewindable conversation documents.

Unresolved `admitted` records deny both model and execution admission. The live tool's executor generation remains 1 across local close and two passive reopens. That retained row is its conservative one-executor reservation. No second executor can be acquired while it remains unresolved. A transport cancellation, expired host deadline, or late promise completion does not change the row or clear the fence. This fixture has no automatic reconciliation-clearing API.

Yield seals live admission immediately, then commits the durable fence, interruption/reconciliation intent and future wakeup before calling actual Harness close. Native safety transitions use short synchronous `storage.transactionSync` callbacks and then `storage.sync`. Provider/tool I/O is outside them and outside `blockConcurrencyWhile`. Closure accounting is a separate durable transition after actual close. If it fails, takeover remains blocked. An unaccounted invocation needs a matching trusted prior-termination fixture and a newer owning generation before passive reopen. Tests supply that local evidence only after cleanup has really closed the old Harness. This is not proof of hosted takeover or remote executor termination.

Any safety read/write failure sets immediate live denial, with no dependency on committing a new failure marker. Retained pre-dispatch evidence continues denying unsafe recovery after availability returns. Continuing safety-store unavailability rejects activation as well. Fault injection targets the safety read/transition interface over real SQLite; it does not simulate a Cloudflare storage outage or fail every internal Pi SQLite operation.

Pi commits and safety writes do not share an asserted atomic transaction. Inbox `submitting` intent precedes public Pi submission, and stable `requestId` is retained when mapping acknowledgment fails. Tests cover crashes before and after that submission commit. The dispatched/missing-result ordering is covered by selective result-write failure, including Pi's subsequent provider and second-tool attempts being denied. The reverse ordering, safety result durable but Pi result commit lost, still needs a dedicated crash test. Sharing the database is not evidence that this missing test passed.

### Scheduling-enabling operations

The candidate keeps Harness/conversation handles private. Public input submission and resume occur only in `schedule`, following durable invocation/intent and guard checks. Passive history/context/watch operations do not resume. `compact`, conversation abort, submission abort, `abortTask`, reset, submission/task/idle waits and invocation-bound conversation controls are not exposed by this candidate. The inspected library automatically schedules for several of those APIs. Future adapters and controls must put them behind the same guarded transitions. No such API was used to implement yield.

### Wakeups

One intent table reserves runnable input, yield, reconciliation, retry, effect, projection and checkpoint deadlines. The repair path reads the earliest retained deadline, checks existing alarm state and does not replace an earlier alarm with a later one. Acceptance is durable before acknowledgment and before model execution. Fault tests retain intent after a dropped alarm write, explicitly activate/reopen, then invoke the real fixture DO's alarm through `runDurableObjectAlarm`. Duplicate handler delivery preserves one invocation and one provider admission. Read/handler failure denies later effects. Unresolved effects remain fenced.

The candidate does not implement product projections or checkpoints. Those deadlines are reservations tested for ordering, not completed work.

## Tests and fault disposition

| Test / experiment | Outcome | Observation and limits |
|---|---|---|
| Historical `passive reads admit nothing but close cannot bound a noncooperative invocation` | passed reproduction; historical host gate failed | Entire body unchanged. Arbitrary noncooperation still does not bound close. |
| `actually closes during %s while remote work stays pending`, request/stream/tool | passed | Real Pi paths, local cancellation, actual close before persisted end deadline, remote pending, no user abort, late resolve/reject observed, passive post-close reopen. |
| `fences %s, accounts actual close, retains effects across two passive reopens`, request/stream/tool | passed | Absolute deadlines and duplicate identities; one unresolved effect survives. Provider collection and execution guard deny admission after each reopen. No new dispatch or automatic fence clearing. |
| `denies effects after result persistence fails, continuing unavailability=%s` | passed, both variants | Pi attempts a subsequent provider request and second tool after the recoverable tool error. Dispatch counters stay at one each. Safety storage unavailability also rejects reopen. Pre-dispatch tool evidence remains without a new failure marker. |
| `rechecks after asynchronous authority preparation and never dispatches after close` | passed | A pending authority/preparation wait cannot create a tool admission after sealing. |
| `retains intent and requires closure evidence after crash at %s` | passed, before-submit/after-submit/after-close/account | Retained intent and submission counts; failed closure accounting cannot establish replacement authority. Synthetic termination evidence is local-only. |
| `closes the real built-in retry sleep and allocates one new budget only after accounted close` | passed | Actual Pi retry phase, no user cancellation, passive reopen, exactly one guarded new budget, original retry and recovery deadlines retained. |
| `automatic yield awaits actual close before the absolute 2000 ms end deadline` | passed with injected wakeup | Real wall-clock 1000 ms timer, real DO SQLite, cooperative remote tool, actual close/accounting before 2000 ms. Its wakeup port records intent/deadlines without a native timed alarm. |
| `repairs a dropped platform alarm from retained acceptance and handles duplicate delivery` | passed | Native DO storage alarms and actual DO handler, under controlled future clock; durable intent repairs on reopen. |
| `selects the earliest reserved wakeup, preserves an earlier alarm, and fences a failed handler` | passed | Real SQLite/alarm state and injected continuing safety-storage failure. |
| Combined wall-clock timer and native timed alarm variant | failed experiment | Assertions reached actual bounded close, but the Worker pool failed isolated-storage cleanup with an unexpected `.sqlite-shm` file. Repeated probes failed; one debug probe hit the command timeout. This is not an upstream Pi close failure or a passed combined-platform gate. |
| Reverse result/Pi-commit crash order, actual unsafe-tool recovery invocation under retained uncertainty across two reopens | not run completely | Current host rejects scheduling before uncertain recovery, and directly verifies mandatory provider/execution admission denial. It does not prove Pi's unsafe recovery handler ran behind those guards on both reopens. |
| Version/authority/capacity rejection and invocation-end overrun fault matrix | not run completely | Guards exist, but dedicated adversarial tests are still missing. |

The native timed-alarm experiment was separated from the timer-only test for diagnosis, not counted as fixed. Controlled-clock native alarms and injected-wakeup wall-clock close are separate passing observations. They do not erase the failed combined experiment. Debug instrumentation is removed. Test cleanup awaits host close and deletes only the current test fixture's alarm.

## Commands and final repository checks

All paths below are relative to this execution worktree. Logs are under `node_modules/.plan-002-resume/logs/`.

| Command / gate | Outcome | Log / result |
|---|---|---|
| `pnpm --filter @ditto/runtime typecheck` | passed | `types-final.log`, both runtime configurations, exit 0 |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts` | passed current scoped suite | `host-final.log`, 18 tests in 1 file, exit 0 |
| Repeated targeted current suite | passed | `host-final-repeat.log`, 18 tests, exit 0 |
| `pnpm runtime:verify` | passed | `runtime-verify-final.log`, 6 Node checks and 46 Worker tests in 5 files, exit 0 |
| `pnpm verify` | passed | `verify-final.log`, Biome/typechecks, 808 web tests, web build, 79 runner tests and runner build, exit 0; existing warnings retained |
| `git diff --check` | passed | No whitespace errors, after final documentation edits |
| Exact six-replacement spec comparison and preservation hashes | passed | Spec equals HEAD plus the six approved replacements. Historical evidence/L0/legacy hashes unchanged. Historical test body unchanged. |
| Contracts and retained brain gates | not run | Their shared inputs did not change. |
| Complete revised 002 acceptance | not run completely; BLOCKED | Missing required crash/failure coverage and failed combined timed-alarm experiment need review. Green scoped commands do not override that disposition. |
| Complete L1 / 003 | not run; BLOCKED | 003 requires accepted complete 002 and still owns full Stop/settlement/result-recovery behavior. |

Early logs remain as failures: `step1-types.log` contains the initial generic provider options type mismatch, repaired without changing packages. `guarded-host.log` and `sync-debug.log` contain the initial unset-model fixture timeout. Passive history had created the root before scheduling; root creation options do not reconfigure an existing root. Guarded `root.configure` fixed that fixture error. `matrix-host.log` also includes an incorrect unversioned task-kind SQL query, replaced with actual task record inspection. `matrix-host-retry.log`, `automatic-yield-probe.log`, and `alarm-debug.log` retain the native timed-alarm cleanup failures. `matrix-with-wakeup-fixture.log` records the diagnostic separated suite. No failed experiment is labeled a host pass.

## Limits and handoff

Stop here for review of the incomplete gate, not an assumed Pi lifecycle blocker. The conforming built-in paths returned through public unpatched interfaces. There is no reason from this experiment alone to require the historical upstream issue or choose another engine.

Before 002 can pass, independently check the protocol, finish its missing result/Pi-commit crash ordering and adversarial version/authority/deadline tests, exercise actual unsafe recovery behind guards or review the stronger scheduling denial against the plan, and resolve or explicitly assess the native timed-alarm test-runtime failure. Do not unblock 003 on the strength of this partial suite. Reuse this one admission/evidence table if the candidate is accepted; do not add a second ledger.

Provider validation is synthetic only. Docker execution, hosted eviction/termination/isolation/capacity, product-worker or credential-free transport restart integration, real subscription access, encryption, full coding-tool parity, full Stop/run/message settlement, and browser checks are **not run**. No user content or credentials entered the plaintext fixture. The runtime fixture requires local composition/attachment; it is not a deployed alarm-activation implementation. No lease, timer, timeout, canceled transport wait, or mocked termination identity proves remote process death.

Exact incremental file scope: `apps/runtime/src/pi-durable-cooperative-fixture.ts`, `pi-durable-host.ts`, additions to the preserved `pi-durable-host.test.ts`, `pi-durable-test-entry.ts`, `apps/runtime/vitest.config.ts`, the six approved spec replacements, status/evidence links in `plans/002-bounded-host-lifecycle.md` and `plans/README.md`, and this new evidence file. All changes remain uncommitted in the preserved detached worktree. The advisor has not reviewed this execution or independently rerun these final gates yet.
