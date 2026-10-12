# 008 teardown diagnosis and actual RPC abort evidence

Status: NOT QUALIFIED for issuer or production termination authority. Return for independent advisor review. Fixture RPC experiments passed cleanly, but the direct-RPC exception teardown limitation remains reproducible. B remains blocked and was not rerun or repaired.

## Preservation and scope

Execution checkout `/home/ayan/ditto-execution/plan-008-4WXvNW`, HEAD `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Main was read-only. Before any writes, archived and hashed all 37 baseline source files and 47 prior evidence/report files in `before.tar.gz` and `before.json`. Original qualification, continuation files and report were never edited. New files are confined to this artifact directory. Ending comparisons are in `preservation.json`.

Read the complete named main handoff/reviews/protocol, diagnosis skill, current CONTEXT and runtime specification. Main `docs/adr` is empty. No issuer, credential hook, production/existing fixture edit, install, dependency change, isolation bypass, private lifecycle API, GC, sleep, extended deadline, sqlite deletion, staging, commit, deployment, shared/live/retained database mutation or new checkout occurred. Only disposable local test state was manipulated. Synthetic values only; observations contain allowlisted errors, opaque identities, counts and encrypted association digests, not model/credential/encrypted payloads.

## Ranked hypotheses and evidence

`hypotheses.md` was written and surfaced before causal probes, after exact reproduction.

1. Retained host/RPC work after denied credential response. Revised: not necessary. A bare throwing RPC without Pi, held work or application storage reproduces the same teardown failure. No supported host continuation join was needed for the green callback-admitted case. This does not prove complete termination of arbitrary non-storage work.
2. Fresh passive SQL/cursor lifetime after reset. Rejected as a necessary cause. Removing application SQL, KV, sync, passive reads and reset still reproduces it. Actual admitted-work passive SQL probes pass when guard denial uses the supported callback seam.
3. Failed ordinary activation. Confirmed as the load-bearing trigger in original A when reached by direct fixture RPC. Omitting only that probe makes both admitted-work continuation tests green. Executing the identical inherited activation through `runInDurableObject` keeps the untouched guard denial and also makes both tests green.
4. Pinned pool reset limitation. Revised: narrower direct-RPC exception/stacked-storage cleanup limitation, not abort-specific. A bare synchronous throwing RPC with no application storage operations fails; primitive return passes. Underlying native reason for the lingering SQLite sidecar is not established.

## Reproduction and minimization

The unchanged original config reproduced `Expected .sqlite, got ...sqlite-shm` / `Isolated storage failed` after `A_CONTINUATION_OBSERVED`. Its second test did not execute.

Every test/toolchain command ran through the existing sanitized launcher with scripts disabled and isolated HOME/cache/store/TMP. Polling, test and runtime deadlines are unchanged; outer tool budget was 240 seconds. Exact command prefix for each credential run:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/008/qualification-executor/teardown-diagnosis/CONFIG > plans/evidence/artifacts/008/qualification-executor/teardown-diagnosis/LOG 2>&1
```

The first run instead used unchanged `../../plans/evidence/artifacts/008/qualification-executor/a-continuation.config.ts`, redirected to `exact-reproduction.log`. Exit 1.

Chronological executed commands and outcomes, with CONFIG / LOG substituted exactly:

| CONFIG | LOG | Exit and observation |
|---|---|---|
| no-activation.config.ts | no-activation.log | 0, 2 tests; only ordinary activation removed diagnostically |
| dispose-activation.config.ts | dispose-activation.log | 1, 2 body failures: pinned stub is not disposable; no activation occurred at this seam |
| callback-activation.config.ts | callback-activation.log | 0, 2 tests; same unchanged guard executed through supported callback |
| bare.config.ts | bare.log | 1; no-reset callback test passed, no-reset RPC error failed teardown; remaining reset matrix unexecuted |
| bare-sync.config.ts | bare-sync.log | 1; removing awaited KV from denied method did not remove teardown failure |
| bare-no-sql.config.ts | bare-no-sql.log | 1; removing SQL from denied method did not remove teardown failure |
| bare-caught.config.ts | bare-caught.log | 1; replacing Vitest rejects wrapper with explicit awaited try/catch did not remove teardown failure |
| separate-stub.config.ts | separate-stub.log | 1; distinct stub for actual guard-denial RPC did not fix original admitted-work teardown |
| rpc.config.ts | rpc.log | 1; actual RPC abort executed, first test failed incorrect expected remote=true; second actual RPC lost-outcome test passed; no isolated-storage failure |
| rpc-v2.config.ts | rpc-v2.log | 0, 2 admitted-work tests; distinct revision expects observed RPC remote=null, exact retained unique label/reset flag; all safety/retention assertions preserved |
| bare-no-read.config.ts | bare-no-read.log | 1; removing post-error passive read did not remove teardown failure |
| minimal.config.ts | minimal.log | 1, all-awaited KV put/sync then RPC throw, no Pi or reset/passive read |
| minimal-callback.config.ts | minimal-callback.log | 0, same KV put/sync and throw through supported callback |
| minimal-no-sync.config.ts | minimal-no-sync.log | 1, removing sync leaves same teardown failure |
| minimal-no-storage.config.ts | minimal-no-storage.log | 1, removing all application storage operations leaves same teardown failure |
| minimal-sync-throw.config.ts | minimal-sync-throw.log | 1, removing async from storage-free method leaves same teardown failure |
| minimal-return.config.ts | minimal-return.log | 0, replacing only the throw with a primitive return and asserting that return |

`bare-no-read` exited 1 even though the compound shell invocation returned 0 from the following advisor command. Its preserved log records the failure explicitly. No failed command was retried blindly. Some bare runs using Vitest rejects also reported an unhandled rejection; explicit awaited catch reproductions retain the isolated-storage failure without needing that extra error.

Smallest observed red reproduction:

```ts
export class Bare extends DurableObject {
 denied() { throw new Error("minimal-denied"); }
}
```

Test awaits `env.Bare.getByName("minimal").denied()` inside explicit try/catch, checks exact error message, then exits. `minimal-sync-throw.config.ts` keeps SQLite and normal isolated storage enabled. No application storage access, retained RPC target, alarm, Pi or abort is required. Changing the throw to a primitive return is green. The KV callback control also passes. These supplemental cases diagnose only and do not replace product admission.

Installed pool `dist/worker/lib/cloudflare/test-runner.mjs:118-133` awaits global waitUntil and its own abortAllDurableObjects before storage pop. Pool `dist/pool/index.mjs:6737-6748` enumerates persisted files and asserts each is `.sqlite`; observed sidecar violates that assumption. We read these files only. The documentation at https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage recommends awaited storage, explicit disposal of nonprimitive RPC results and response consumption. Retrieved current page says updated 2026-08-20 and describes a newer plugin; it is not evidence for this pinned pool. Our minimal case has no nonprimitive return/capability or storage promises to dispose. Pinned fixture stubs reject `using` with a disposal TypeError. No private API or dependency patch was attempted.

The supported alternate test seam executes original guard activation in `runInDurableObject`, rather than leaking through the failing direct error RPC path. It is not a general fix for framework RPC exception lifecycle or a production change. If that direct path must pass, a separately scoped upstream/pinned-runtime investigation or supported fix is needed. Do not disable isolation or ignore sidecars. Original unchanged reproduction remains red and preserved.

## Actual private RPC experiment

Only new `rpc-v2-entry.ts` adds `diagnosticAbort(requestKey)` to the isolated subclass. It reads retained intent and scope, validates request key, originating boot, complete scope, namespace/named DO identity, exact active generation-1 invocation and label. It durably records an execution marker, syncs, then calls the pinned single-argument `ctx.abort(label)`. Caller supplies no generation, predecessor or witness. HTTP remains 404 and response body is consumed. No production method exists.

All positives use actual CandidateProductCommands admission/drain, real local D1, encrypted host storage and mandatory private synthetic adapter. Only owned synthetic user/project/account prerequisites are seeded, not successful command/invocation/membership records. Boot capture remains fixture-local diagnostic evidence, not immutable production invocation-to-boot binding. Diagnostic pending marker prevents alarm activation, not termination proof or authority.

`rpc.config.ts` first revealed that real RPC abort does not expose remote=true. The distinct v2 preserved that failure, used the actual shape, unique per-request label for same-label controls and complete retained scope validation. This corrects a callback-derived observation expectation, not a weakened safety assertion. Structured v2 observations are in `rpc-v2-observations.json`.

| Executed outside control in v2 | remote | durableObjectReset | Result |
|---|---|---|---|
| Same-label ordinary callback error | absent | absent | rejected |
| Same-label spoofed callback error | true | true | rejected, callback fields remain spoofable |
| Same-label ordinary actual fixture RPC error | true | absent | rejected |
| Same-label spoofed actual fixture RPC error | true | absent | forged reset property stripped |
| Wrong request key actual RPC | true | absent | request-mismatch; no execution marker |
| Wrong originating boot actual RPC | true | absent | origin-mismatch; no execution marker |
| Exact originating-instance supported abort via actual RPC | absent | true | exact unique retained label |
| Second uninvoked delivery through old broken RPC stub | absent | true | OLD label, not a new completed request |
| Exact old broken-stub replay | absent | true | same old label, no new execution |
| Ordinary replacement activation through supported callback | absent | absent | Prior host termination required |
| Actual RPC abort outcome discarded, controller restart | not retained by controller | not retained by controller | outside observation table empty; NOT QUALIFIED, witness null |

The failed/uninvoked request actually calls the broken old RPC stub with a different request key. Fresh storage retains only the original exact execution marker and no second marker/callback execution. This is not a fabricated local rejection. Exact error fields alone still cannot distinguish a new invocation from stale-stub replay. Trusted exact delivery provenance, unique label, retained execution binding and fresh passive proof matter, but no generally accepted issuer classifier is implemented here. Different storage/reset causes and hosted behavior remain unqualified.

The lost-outcome case genuinely executes the RPC abort, validates and discards its outside result without recording it, then constructs a controller from only durable intent/proof and an empty local D1 outside-observation table. It remains NOT QUALIFIED despite a replacement nonce and retained execution flag. This control executed in both RPC runs, not merely authored. Callback lost-outcome controls also executed in the green no-activation and callback-activation diagnostic branches.

Final v2 retained exact receipts/messages, scope, named DO, invocation identity/generation/start/yield/end, admitted effect/deadline, encrypted association digest, one root/submission and unknown effect/occupancy. Original credential wait settled denied after D1 review fencing. Fresh passive reads created no additional root/submission. Authority is still generation 1, no priorTerminated, liveExecutors=1. Untouched predecessor guard denied ordinary replacement activation. Zero synthetic upstream fetches in both v2 tests. No host closure, effect refund, known remote completion, executor death, generation advance or witness is inferred.

## Pinned environment and unchanged probes

Installed package metadata from the preserved resolved inventory was checked against current package files: Node launcher 24.21.0, Vitest 3.2.7, Workers pool 0.12.21, Miniflare 4.20260310.0, workerd 1.20260310.1, workers types 4.20260605.1, Pi Durable 1.0.1. Qualification effective date remains 2026-03-10. Advisor config is unchanged; requested 2026-09-16 again falls back to installed 2026-03-10. No deadline/compatibility/dependency changes.

Executed twice during this work, including after final diagnostic probes:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts > plans/evidence/artifacts/008/qualification-executor/teardown-diagnosis/advisor-probes.log 2>&1
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts > plans/evidence/artifacts/008/qualification-executor/teardown-diagnosis/advisor-probes-final.log 2>&1
```

Both exit 0, four unchanged probes each. B, full original matrix, aggregates, typecheck, live provider and hosted checks were not run. No issuer/new credential hooks/final acceptance gates are accepted. Stop here for independent advisor review; the direct-RPC teardown limitation and production immutable binding remain separate blockers.
