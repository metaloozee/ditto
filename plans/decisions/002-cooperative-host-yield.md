# Accepted decision: cooperative local waits for host yield

Status: accepted by the maintainer in the conversation approving the revised 002 approach. Prepared against `3d69820`. Implementation gate: not run under this contract.

This is the approved narrow amendment to `docs/specs/pi-durable-session-runtime.md` for resumed 002. Read both documents. The amendment changes the requirement for local cancellation, not the selected architecture or effect-safety requirements. Its exact spec edits appear below. The next executor applies them in the preserved execution worktree before coding. The advisor records decisions only under `plans/`; the spec has not yet received these edits.

## Decision and reason

Keep Pi Durable 1.0.1 unchanged for the next experiment. Keep one runtime DO and one execution sandbox per workspace session. Do not require Pi to forcibly terminate arbitrary trusted JavaScript.

Require all deployment-owned provider/execution adapters and trusted phase dependencies to end their local waits under the host invocation's cancellation signal/context. This includes request preparation, stream consumption and cleanup, hooks, tools and retry/sleep waits used by the slice. A wrapper that abandons an outer wait while its trusted continuation can still dispatch work does not conform.

A remote shell may ignore cancellation. Its local adapter wait must still end. The runtime must retain the admitted effect, executor identity, deadline and unresolved outcome. Canceling a wait proves neither process death nor rejection before dispatch. Missing results never authorize automatic shell replay.

Commit a host admission fence, effect-accounting state and wakeup/reconciliation intent before invoking actual Harness close. Host yield must not call user cancellation APIs or record a user-Stop/task-abort mark. For graceful yield, require actual close completion before opening a replacement Harness. Abrupt restart instead needs trusted prior-host termination evidence and durable closure accounting before takeover. It does not prove the graceful-close bound. A canceled close waiter is not close completion.

A reopened Harness may inspect state while a remote operation remains alive. It must not enable model/tool admission until reconciliation permits it. Replacement mutating work still requires trusted termination or isolation of the old executor and available capacity. Isolated live execution remains counted.

Late remote resolve/reject must remain observed without an unhandled rejection or another dispatch. Use the original operation, attempt, epoch and executor generation. Late evidence may enter a bounded trusted reconciliation handler; it must not publish through the sealed Harness or overwrite a newer run. A late result does not clear a fence automatically. The runtime makes that decision under current authority and effect policy.

Pi remains the sole task-continuation engine. The effect ledger records admission and evidence; it does not resume task phases or reconstruct conversations. A local timer may trigger yield at a persisted deadline. Durable intent and a platform alarm provide wakeup/recovery. A timer, browser or `waitUntil` alone cannot guarantee lifetime.

## Why the earlier failed gate does not settle this question

The earlier public-API reproduction remains valid. A custom task phase deliberately ignored its signal; actual close waited for that phase. The test did not pass a remote operation through a cooperative trusted adapter or prove whether Pi's built-in model/tool phases could then close.

The earlier verdict correctly rejected timeout-race replacement. Its broader inference that an upstream lifecycle change was necessarily required is superseded by this decision. No test result changes. No failed gate becomes a pass.

Retain `plans/evidence/002-host-lifecycle.md`, `002-advisor-review.md` and the existing test unchanged as historical evidence. The unpublished upstream issue draft is no longer the recommended next action. Only a failure of the conforming integration justifies a new upstream compatibility claim or a further host decision.

## Bounds and responsibility split

Use configurable local test budgets of 1,000 ms of scheduled work and 1,000 ms of cooperative drain. Before scheduling, persist a durable host invocation ID, host ownership generation, start time, and absolute yield/end deadlines at start + 1,000 ms and start + 2,000 ms. Duplicate delivery and retries of that invocation reuse its ID and deadlines. The host invocation ID is distinct from the Pi task, effect attempt and user-run epoch.

Only a guarded transition after actual prior close, or trusted prior-host termination following a crash, may durably account for that ended invocation and create the next ID with a fresh budget. Require fresh authority, effect and executor reconciliation before new scheduling. Passive open grants no new scheduling budget. Failed closure-accounting persistence keeps admission fenced. Restart takeover needs trusted prior-host termination evidence; deadline or lease expiry alone is insufficient. A fresh host budget must not extend existing effect deadlines or the first-interruption recovery deadline.

Actual Harness close must finish before its invocation-end deadline. An exceeded drain deadline fails the gate and prevents replacement. These are test safety bounds, not hosted guarantees or performance thresholds. Test duplicate wakeups before yield, during drain and after accounted close.

Persistence failure must deny further effects immediately in the live instance. A new failure marker is best-effort while storage is unavailable, not a prerequisite for denial. Before dispatch, already-durable admission/effect records must be sufficient to deny unsafe recovery if a later result/failure write cannot commit. Deny scheduling while storage cannot be read. Test selective result-write failure and continuing storage unavailability, including reopen without a newly committed failure marker. A successful later write alone does not clear the barrier.

002 first proves real Pi generation/provider-stream and sequential-tool cancellation through supported registration. A custom cooperative task is not a substitute. Then it adds only the admission/effect records necessary to show safe host yield and blocked recovery across two reopens. A remote fixture must ignore cancellation while the local adapter cooperates.

003 must reuse that protocol and finish its full effect-safety contract. It owns complete logical correlation, atomic result barriers, targeted user Stop, run/message settlement, unknown-effect handling and the persisted 15-minute recovery deadline. Do not defer the minimal unresolved-effect barrier required by 002 to 003. Do not call 002 evidence full L1 acceptance.

Local fixtures retain the hard one-runtime/one-executor limit. A live isolated executor cannot be forgotten to make room for a replacement. No actual second live executor is permitted by this experiment.

## Exact specification edits for the next executor

Apply these edits only to `docs/specs/pi-durable-session-runtime.md`. Use exact matches, not line numbers. Stop if an old block has drifted. Do not edit the glossary, change deployment ownership, add an engine or weaken unchanged requirements.

### 1. Decision 7: replace the two final paragraphs

Old text:

```text
The inspected framework has no proven bounded host-pump integration for this use. Closing may wait on non-cooperative invocations. The first feasibility phase must prove supported interruption and reopen behavior without overlapping owners or private scheduler changes.

If supported interfaces cannot do this, stop dependent implementation. Report the required upstream change or alternative host decision. Do not hide the limitation with an endless alarm handler or a second continuation engine.
```

New text:

```text
The host uses cooperative local waits through supported Pi and adapter interfaces. Deployment-owned provider and execution adapters must end their local waits under the invocation's cancellation signal or context. Request preparation, hooks, stream consumption and cleanup, and retry waits must follow the same contract. An abandoned outer wait does not conform if its trusted continuation can still dispatch effects.

A remote command may ignore cancellation while its trusted local adapter cooperates. Ending the local wait does not establish remote termination, rejection before dispatch, or safe replay. Retain its admitted effect, executor identity, deadline and unresolved outcome. Unknown shell outcomes must never replay automatically.

Before host yield, commit a no-new-admission fence and durable interruption, effect-accounting and wakeup intent. If persistence fails, deny further effects immediately in the live instance. Recovery must deny unsafe effects from already-durable admission evidence when a new failure marker cannot commit. Deny scheduling while storage is unavailable. Then request actual Harness close. Host yield must not use user-Stop or task-abort operations. For graceful yield, require actual close completion before opening a replacement Harness. Abrupt restart requires trusted prior-host termination evidence and durable closure accounting before takeover; it does not prove graceful close. Canceling the close waiter is not proof that close completed.

A replacement Harness may open passively to reconcile while remote work remains alive. This grants no effect authority. Mandatory provider and execution adapters must deny new effects while outcomes remain unresolved. Replacement mutating work still requires trusted termination or isolation of the previous executor and available capacity. Live isolated execution remains counted.

Observe late remote results and failures against their original operation, attempt, epoch and executor generation. They must not dispatch more work, publish through a closed Harness, or overwrite current run state. A bounded trusted reconciliation handler may retain validated evidence. Only the runtime's guarded reconciliation decision may clear the admission fence.

The first feasibility phase must prove bounded actual close through Pi's built-in model and tool phases with conforming adapters, preserved continuation, and safe reopen. It must include a remote operation that ignores cancellation. Pi is not required to forcibly terminate arbitrary trusted JavaScript that violates this adapter contract.

If the conforming integration still cannot meet these requirements through supported interfaces, stop dependent implementation. Record the precise limitation and seek review of an upstream change or the host decision. Do not hide the limitation with an endless alarm handler, a private scheduler patch, a fork, or a second continuation engine.
```

### 2. Decision 9: distinguish three kinds of deadline

Old text:

```text
Tools and model attempts have finite persisted deadlines. The old whole-run timeout is not the new agent-run lifetime limit. Compaction and background work follow the same authority and Stop rules.
```

New text:

```text
Tools and model attempts have finite persisted deadlines. Each host invocation has a durable identity, start time, and separate absolute yield and drain deadlines. Duplicate delivery or retries of that invocation must not extend its deadlines. A guarded transition may allocate a new invocation budget only after actual prior close or trusted prior-host termination, durable closure accounting, and reconciliation. A new host budget does not extend existing effect deadlines or the first-interruption recovery deadline. None of these deadlines proves remote termination or grants replacement mutation authority. Host yield preserves continuation without user cancellation; explicit Stop retains its epoch-first cancellation contract. The old whole-run timeout is not the new agent-run lifetime limit. Compaction and background work follow the same authority and Stop rules.
```

### 3. L1: replace its description and exit requirement

Old text:

```text
Use disposable synthetic storage to prove passive startup, bounded interruption and reopen, durable wakeups, Stop, and unknown-effect blocking.

Exit evidence must show one owner and no unintended user cancellation. An uncertain effect must block model and tool admission, including after another restart. Failure stops dependent architecture work.
```

New text:

```text
Use disposable synthetic storage to prove passive startup, bounded interruption and reopen through cooperative local adapters, durable wakeups, Stop, and unknown-effect blocking. Include a remote process that ignores cancellation while its trusted local wait ends.

Exit evidence must show actual Harness close within the persisted invocation deadline, no overlapping Harness admission owner, and no unintended user cancellation. Retain unresolved remote execution and capacity accounting after local close. An uncertain effect must block model and tool admission, including after another restart. Only trusted termination or isolation permits replacement mutation. Failure stops dependent architecture work.
```

### 4. PD09: replace its row

Old text:

```text
| PD09 | Host yields within a bounded invocation during model or tool work. | Durable progress remains recoverable. Infrastructure yield is not user cancellation. |
```

New text:

```text
| PD09 | Host yields during model or tool work through a cooperative local adapter while the remote operation may ignore cancellation. | Actual Harness close finishes within the persisted invocation deadline. Durable progress remains recoverable. Infrastructure yield is not user cancellation. Unresolved effects remain accounted for and deny new admission. |
```

### 5. PD14: replace its row

Old text:

```text
| PD14 | Shell ignores cancellation and a stale result arrives. | Block replacement writers until termination or isolation. Stale state cannot overwrite current work. Keep live capacity accounted for. |
```

New text:

```text
| PD14 | Shell ignores cancellation, its cooperative local wait ends, and a stale result arrives. | Ending the wait does not prove process death. Block replacement writers until trusted termination or isolation. Retain evidence under its original operation and epoch without overwriting current work. Keep live capacity accounted for. |
```

### 6. OD2: clarify its implementation consequence

Old text:

```text
| OD2 | Framework support | Stop and review library flaws. Seek an upstream issue or fix. No maintained fork. | Failed supported-lifecycle gates stop dependent work. No private scheduler patch or second engine. |
```

New text:

```text
| OD2 | Framework support | Stop and review library flaws. Seek an upstream issue or fix. No maintained fork. | Test supported lifecycle behavior with cooperative deployment-owned adapters before requiring upstream changes. An arbitrary trusted phase that ignores cancellation is not a conforming integration. Failure of the conforming gate stops dependent work. No private scheduler patch or second engine. |
```

## Cold review

A read-only cold review on `openai/gpt-6.1-sol` with Medium reasoning identified two gaps. Both are resolved here and in 002/003: durable invocation identity distinguishes legitimate new budgets from duplicate/retry clock resets; storage-failure denial does not require another successful write. Closure accounting, effect deadlines and the first-interruption recovery deadline remain separate. No runtime experiment accompanied these planning corrections.

## Verification and disposition

No runtime implementation or tests ran to make this decision. Revised host gate: `not run`. Earlier arbitrary-phase gate: `failed`, preserved as historical evidence. 002: READY for separate resumed execution. 003 and downstream plans: BLOCKED until their prerequisites pass.

The next executor runs `pnpm --filter @ditto/runtime typecheck`, the targeted `src/pi-durable-host.test.ts`, `pnpm runtime:verify`, `pnpm verify` and `git diff --check` as specified in 002. Record new results in `plans/evidence/002-host-lifecycle-resume.md` rather than rewriting historical failure evidence. No deployment, live request, issue publication, reset, staging, commit, integration or worktree cleanup is authorized.
