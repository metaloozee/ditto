# 003 targeted diagnostic supplement

All five requested gaps are **reproduced** in the unchanged source. This supplement does not modify or replace prior evidence, plan status, implementation assertions or advisor acceptance. It is a diagnostic result, not a source fix or L1 acceptance.

## Scope and command

Only existing detached `/tmp/ditto-plan-003-998rQl` at `cf7bfbcbfb1900392cac795d21cc32d4f5982520` was used. `model.log` confirms `PI_MODEL=gpt-6.1-sol` and `PI_REASONING_LEVEL=medium`. Every shell command explicitly changes to that worktree. Application source and all old tests remain byte-identical to diagnostic entry; `source-before.sha256` and `source-preservation.log` verify host, adapter, effects tests and inherited host assertions. No source instrumentation, source fix, earlier evidence rewrite, subagent, commit, stage, dependency/private Pi change, credentials/.env read, deployment or live effect occurred.

Two ignored files supply the diagnostic composition:

- `apps/runtime/node_modules/003-diagnostic-probe/config.ts` imports the existing Worker configuration and narrows discovery to one ignored probe file. It uses the unchanged real Worker entry and SQLite DO class. Its absolute entry path is needed because Worker main resolves relative to the configuration location.
- `apps/runtime/node_modules/003-diagnostic-probe/diagnostic.test.ts` composes the real Pi Durable host, pinned public Pi interfaces, mandatory guarded adapters and synthetic counters. The existing test-only host-to-public-Harness lookup supplies public `waitForIdle`, `waitForTask` and `close`. No fake Pi task or terminal receipt is fabricated.

The command below was run twice against final diagnostic files. Both executions exit **1**, with **5 expected failing assertions**, no suite/import failure, timeout, unhandled error or isolated-storage error. Those red assertions express the requested safe behaviors.

```bash
cd /tmp/ditto-plan-003-998rQl && env -i \
  PATH=/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin:/home/ayan/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin \
  HOME=$PWD/node_modules/003-implementation-logs/home CI=1 NO_COLOR=1 \
  pnpm --filter @ditto/runtime exec vitest run \
  --config node_modules/003-diagnostic-probe/config.ts --reporter=verbose
```

Add `-t gap1`, `-t gap2`, `-t gap3`, `-t gap4` or `-t gap5` to isolate a case. The recorded repeated all-five command contains only these five cases, not baseline tests.

Logs and exact synthetic public records are under `node_modules/003-diagnostic-logs/`:

- `five-gaps-bounded-final.log`, `five-gaps-bounded-repeat.log`: final ignored probe files, both full red commands, all five test names, observations and failures. The observer now accepts a future corrected takeover's schedule refusal rather than treating refusal as a probe error.
- `five-gaps-final.log`, `five-gaps-repeat.log`: earlier complete all-five runs with the same permanent source and the same five observed failures.
- `observations-summary.json`: bounded extracts from `five-gaps-final.log` of native alarm calls, public terminal receipts, durable rows, exact logical operations and actual I/O counters. The concrete timestamps below refer to that captured run; later runs reproduce the same states and counters with their own clocks.
- `status.log`, `source-before.sha256`, `source-preservation.log`, `source-preservation-final.log`, `model.log`: exits, source identity and environment.

Inherited installed versions and pins are unchanged: Pi Durable/pi-ai/Chord 1.0.1, Worker pool 0.12.21, runtime Vitest 3.2.7, Miniflare 4.20260310.0, workerd 1.20260310.1, Node 24.21.0 and pnpm 11.8.0. The Worker still reports the effective compatibility date as 2026-03-10 instead of requested 2026-09-16. The user's independent broad gates passed the same permanent source, recorded separately in `node_modules/003-advisor-logs/runtime-implementation.log` and `verify-implementation.log`. No broad baseline gate was rerun for this diagnostic.

## 1. Terminal no-work alarm rearming

**Reproduced.** Exact red test: `gap1 native terminal no-work alarm consumes serviced reconciliation intent`.

A real successful guarded answer is settled, yielded/accounted and reopened on the same DO SQLite. Preconditions assert run complete, no live Pi tasks, and every effect `pi-committed`. The recorded model counter is one before reopen and zero after reopen; tool counters are zero. Members remain complete. The retained reconciliation deadline comes from real host accounting, not a fabricated SQL intent.

To obtain a truly past native timestamp without racing the seed execution, this case uses a fixed clock initially one second ahead, a 2-second work budget and 200-ms drain, then releases the DO event and waits only until the actual recorded reconciliation timestamp has passed wall time. It explicitly installs that recorded native deadline once before event release. The case's 10-second test cap bounds this real-time wait. It does not increase production budgets or suppress automatic alarms. `runDurableObjectAlarm` is called outside the DO event; native handler completion and storage are joined after each observation.

In the final run, native automatic delivery had already begun when both manual helper calls returned false. This is not represented as two helper-returned-true deliveries. The actual fixture's alarm counter and native get/set traces show two completed native handlers at the first join and a third at the second join:

| Native observation | Value |
|---|---|
| Durable `reconcile.deadline` | `1791222929298` |
| Handler 1 `storage.getAlarm()` | `null` |
| Handler 1 requested `storage.setAlarm()` | `1791222929298`, wall time `1791222929314` |
| Handler 2 `storage.getAlarm()` | `null` |
| Handler 2 requested `storage.setAlarm()` | `1791222929298`, wall time `1791222929321` |
| Handler 3 `storage.getAlarm()` | `null` |
| Handler 3 requested `storage.setAlarm()` | `1791222929298`, wall time `1791222929328` |
| Native alarm after first/second joins | `1791222929321` / `1791222929328` |
| Serviced intent after both joins | original `reconcile` row still present |

The installed runtime clamps each requested past timestamp to its current scheduling time. It does not clean up the host intent. Real `getAlarm() === null` in the running handler distinguishes platform handling from the host's explicit rearm. This agrees with the user's cited [official alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/). The test's cleanup joins native completion, host closure and storage and deletes the native alarm. It does not leave the immediate loop running.

The red assertion expects zero serviced reconcile/pi-retry intents and observes one. This case proves the reconciliation path. It does not separately seed a terminal pi-retry intent or claim an unbounded loop was allowed to run indefinitely.

## 2. Known final compaction error without summary

**Reproduced.** Exact red test: `gap2 known terminal compaction error is accounted without a summary entry`.

The real initial generation completes while the host run/member are still active, then public `host.compact('command')` submits the built-in manual compaction. Its mandatory guarded model adapter returns the synthetic nonretryable error `400 Synthetic terminal compaction error`. The adapter follows the unchanged result barrier and commits that AssistantMessage evidence before emitting Pi's error event. Public `waitForTask` joins the actual built-in terminal failure, then public host reconciliation is run.

Observed public original task 11 is `pi.compaction`, version 1, manual input, no abort request, terminal failed. Its error is `Summarization failed: 400 Synthetic terminal compaction error`, detail reason `model_error`. That error matches the original committed safety result. There are zero compaction summary entries in public history, one actual summary I/O and no retry. The original generation effect is `pi-committed`; the compaction effect remains `result-recorded`. The host run remains `running`, and its assistant member remains `pending`.

The red assertion expects zero unresolved result-recorded effects for original task 11 and observes one. This is a known nonretryable failure, not an unknown request or uncertain remote mutation. No replay or fabricated terminal success is needed to account for it. Retry-budget exhaustion was not separately tested because the request allowed either a nonretryable error or exhaustion.

## 3. Cross-kind check-to-insert race

**Reproduced.** Exact red test: `gap3 actual tool and manual compaction cannot both dispatch unresolved`.

The actual registered sequential unsafe tool holds its adapter preparation after a real generation produces its original tool call. Before that tool enters the guard, public host manual compaction is submitted for the same live command. Its real beforeCompact selection and prepared request reach the existing `prepareModel` seam. There is no invented background task, fake checkpoint or unguarded admission.

The existing authority seam holds the two actual `admitExact` authority calls and releases them together. A stack-name predicate selects that seam for this ignored diagnostic only. The authority value remains unchanged and valid. The existing synchronous admission fault seam merely records rows; it does not fault, insert, delay or alter policy. Actual dispatch callbacks also record rows before incrementing the fixture I/O counters.

The final observed order is:

1. Both held authority calls see only the original generation's `pi-committed` effect.
2. The first admission transaction starts with no unresolved effect and inserts the summary model effect.
3. The second admission transaction starts with that summary already **admitted**, then still inserts the unsafe tool effect.
4. The real tool dispatch callback sees both admitted rows and runs.
5. The real summary model dispatch callback sees both admitted rows and runs.

Public compaction task 12 is running in summarize phase. The actual original tool call is `shell-original`. Both operations retain their versioned exact correlations and actual first spending attempts. Both remote responses remain pending at observation. Counters are **one unsafe tool I/O and two model I/Os**, meaning the original generation plus the newly admitted summary. There are **two admitted unresolved rows**, one model and one tool.

The red assertion expects one admitted operation and observes two. Public Pi scheduling does not prevent this interleaving. The observed dispatch callbacks also prove that the final permit fails to deny the already-admitted competing operation; this is not merely a static check-to-insert suspicion.

## 4. Fixed recovery deadline crossed during preparation

**Reproduced.** Exact red test: `gap4 model dispatch after awaited preparation respects fixed recovery deadline`.

A real compaction returns a retryable known `503 Synthetic known summary error` and reaches its public retry checkpoint with retained native retry evidence. Graceful host yield accounts for the known result; reopen preserves the same logical request and actual retry task. The first error row is `pi-committed`, not admitted unknown work.

The host clock is set to `recovery_at - 100`, the existing run is scheduled, and the actual retried summary request holds at `prepareModel`. The clock then advances to `recovery_at + 100`, still within the new invocation budget and before its newly calculated finite operation deadline. The probe releases preparation without calling expire or alarm.

Final recorded `recovery_at` is `1791223889916`; dispatch and result consumption occur with host clock `1791223890016`. The reopened fixture performs **one model I/O** rather than zero. Safety stores the second result, and the public original compaction task 11 reaches terminal completed with write submission 13. Thus the response was also consumed by Pi after the fixed deadline; it was not merely prepared or admitted. The second spending row is `result-recorded`, attempt/Pi attempt 2, the original known error row is `pi-committed`, and the run remains running with its expired recovery timestamp.

The red assertion expects zero reopened provider calls and observes one. This case covers dispatch after the awaited preparation and result acceptance after that already-expired deadline. A separate case where only the response wait crosses the deadline was not needed for this counterexample and was not run.

## 5. Abrupt trusted takeover omits first interruption

**Reproduced.** Exact red test: `gap5 trusted abrupt takeover fixes first interruption and recovery deadline`.

A real compaction reaches the same known retryable error checkpoint. The public explicit storage-reconciliation method accounts for its matching known receipt without performing run completion. Before abrupt closure, both the successful generation and known summary error are `pi-committed`; the run remains running and its member pending. The probe then calls the actual public Harness `close`, joins it and storage, without host yield. It supplies the existing authority seam with generation 2, executor 1 and `priorTerminated` exactly matching the real prior invocation ID.

The real trusted `PiDurableHost.open` takeover succeeds. Its retained run still has **null `interrupted_at` and null `recovery_at`**, and remains running. The probe advances time from the termination/open clock `1791222990170` to `1791223890270`, **15 minutes plus 100 ms later**, then schedules the existing command.

The reopened provider counter becomes **one**. Original compaction task 11 completes successfully, and its second spending row records generation 2, Pi attempt 2 and spending attempt 2. There is no unknown original request, replayed successful operation, extra command ID or replacement executor. The persisted recovery timestamp remains null.

The red assertion expects the fixed deadline `1791223890170` after takeover and observes null. The attempted retry after 15 minutes is also observed, not inferred from that null alone.

## Probe failures retained and diagnostic limits

Earlier diagnostic attempts are retained alongside final logs:

- `gaps12-first.log` failed because the ignored config's relative Worker main resolved under the probe directory. Only the ignored config changed to an absolute unchanged real entry path.
- `gaps12-second.log` seeded past native alarms during active seed work and hit native cancellation/isolated-stack cleanup diagnostics. It is not accepted as alarm proof. `gaps12-third.log` proved native null/rearm and stale intent with a future wall deadline, but not past scheduling.
- `gap1-native-past.log` initially asserted manual helper true; that assertion was wrong because automatic native delivery had already begun. `gap1-native-observed.log` recorded the actual automatic native handlers, real null get calls, past set calls and runtime clamp. Final repeated logs use these concrete observations and the real serviced-intent failure.
- `gaps345-first.log` reproduced race and deadline crossing, but the first abrupt-takeover setup called ordinary run reconciliation and settled the initial completed root turn before takeover. It therefore hit terminal-run refusal and did not test gap 5. The final setup uses explicit public storage reconciliation to preserve the active known-error run; `gap5-second.log` and both final repeated runs reproduce the actual missing deadline and late retry.

The final probes retain native event/storage and actual Harness closure joins. They bound synthetic waits and resolve fixture remote promises during cleanup. All actual I/O counters measure credential-free synthetic adapters. No hosted behavior, live provider, filesystem mutation, further Stop scenario, product restart or external executor assertion is introduced. Source fixes, updated implementation acceptance and new broad gates remain pending user authorization.
