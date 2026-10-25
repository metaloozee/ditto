# 026: Make `runtime:verify` stable under full-suite load and run it in CI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file.
>
> **Drift check (run first)**: `git diff --stat 0f9c7c1..HEAD -- apps/runtime/vitest.config.ts apps/runtime/package.json apps/runtime/src/pi-durable-storage.test.ts apps/runtime/src/pi-durable-storage.ts patches pnpm-workspace.yaml package.json .github/workflows/ci.yml`. If any of these changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: TODO, READY
- **Priority**: P1 (019 is blocked on it)
- **Effort**: M (investigation first; the fix is likely small)
- **Risk**: LOW for runtime behavior, MED for CI time
- **Depends on**: none
- **Category**: test infrastructure / CI
- **Planned at**: commit `0f9c7c1`, 2026-10-24

## Hard rule

Do not raise the 5 s test deadline, skip, quarantine, retry or reorder the failing case to make it pass. 019 states the same rule. If the cause is upstream in `@earendil-works/pi-durable` or `@cloudflare/vitest-pool-workers`, either fix it in the existing pnpm patch with evidence, or STOP and report.

## Why this matters

Since 015 the full `pnpm runtime:verify` run is load-sensitive. One upstream conformance case, "streams long document tails across root replacement deltas", times out at 5 s under full-suite load and passes alone in about 3 s:

- 015: three of four runs failed, also on base `c827cda` (`plans/evidence/015-resource-and-value-policy.md` line 55).
- 016: both final runs failed (`plans/evidence/016-lifecycle.md` line 38).
- 017: 510 of 511 passed, this case failing (`plans/evidence/017-l5-backend-acceptance.md` line 54).

CI runs only `pnpm verify`, which omits `runtime:verify` and `contracts:verify`. So CI has never run the runtime suite. 019 cannot meet "Verification/CI genuinely includes the runtime checks" until this case is stable.

## Current state

- `package.json`:
  ```json
  "runtime:verify": "pnpm --filter @ditto/runtime typecheck && node --test apps/runtime/src/pi-durable-imports.test.mjs scripts/pi-durable-host-auth.test.mjs && pnpm --filter @ditto/runtime exec vitest run",
  "verify": "pnpm check && pnpm typecheck && pnpm credentials:verify && pnpm test && pnpm build && pnpm runner:verify"
  ```
- The case comes from `registerStorageConformance` in `@earendil-works/pi-durable/testing` 1.0.1, registered in `apps/runtime/src/pi-durable-storage.test.ts` ~93 to 112. Each conformance case opens a new DO instance (`env.PI_HOST_STORAGE.getByName("conformance-<uuid>")`) and an `EncryptedPiStorage` inside `runInDurableObject`.
- `apps/runtime/vitest.config.ts` uses `defineWorkersConfig` with no `maxWorkers`, `fileParallelism` or `singleWorker` setting, so files run in parallel workers by default.
- `patches/@cloudflare__vitest-pool-workers@0.12.21.patch` already fixes two pool problems: a Proxy layer added per DO instance (O(instances) prototype lookups) and an isolated-storage pop that races SQLite close. See project history for plan 008 and 010.

## Hypotheses to test, in order

1. **Cumulative slowdown inside the storage file.** The case may get slower the more DO instances the file has created, like the 008 Proxy bug. Test: time the case when it runs first, and when it runs after the other conformance cases in the same file, with the rest of the suite excluded.
2. **CPU contention between parallel files.** The case is CPU-heavy (encryption of long document tails). Test: run the full suite with `--maxWorkers=1` once, and with the default once, and compare the case's duration. Also record the machine's core count.
3. **Encryption cost growth.** `EncryptedPiStorage` work for root replacement deltas may scale worse than linearly with tail length. Test: profile the case alone with `--inspect` or a CPU profile and look for one dominant frame.

## Steps

1. Run the drift check. Run `pnpm runtime:verify` three times on the clean tree and record each result and the case's duration. Kill leftover `workerd` processes between runs with `pkill -9 -x workerd`. Do not use `pkill -f`, which can match your own shell.
2. Test hypothesis 1. Record durations.
3. Test hypothesis 2. Record durations.
4. Test hypothesis 3 only if 1 and 2 do not explain the slowdown. Record the top frames.
5. Fix the cause:
   - For 1, find the growing structure and fix it in the existing pool patch or in `pi-durable-storage.ts`, with a before and after timing.
   - For 2, set a bounded parallelism in `apps/runtime/vitest.config.ts` only if the evidence shows contention is the whole cause. Record the suite's total time before and after. This counts as a fix only with the maintainer's acceptance, which the reviewer brings.
   - For 3, if the cost is in Ditto's adapter, fix it there with a focused test. If it is in Pi Durable, STOP and report with the profile.
6. Run `pnpm runtime:verify` five times in a row. All five must pass.
7. Add `pnpm contracts:verify` and `pnpm runtime:verify` to root `verify` after `credentials:verify`. Check that `.github/workflows/ci.yml` needs no new setup for them (it already installs root dependencies with Node 24). Run `pnpm verify` once.

## Checks

```sh
pnpm runtime:verify            # five consecutive passes
pnpm contracts:verify
pnpm verify
```

Write results to `plans/evidence/026-runtime-verify-stability.md`: environment, core count, each run's result and the case's duration, the hypothesis that held, the change, and suite time before and after.

## Stop conditions

- The fix would need a raised deadline, a skip, a retry or a reordering.
- The cause is inside `@earendil-works/pi-durable` and cannot be fixed in Ditto.
- Bounded parallelism makes the runtime suite take longer than CI's 30-minute job limit allows together with the rest of `pnpm verify`.
- A different runtime test starts failing in the five-run check.

## Done

Five consecutive full `runtime:verify` passes, `pnpm verify` includes `runtime:verify` and `contracts:verify`, and the cause is recorded. 019's "stable `runtime:verify`" dependency can then be rechecked.

## Maintenance

A future Pi Durable or pool upgrade must rerun the five-run check. If the pool patch changes, keep its sections for the Proxy fix, the SQLite close race and any new fix separate and commented.

## Execution result (2026-10-24, reviewer)

BLOCKED by the stop condition "a different runtime test starts failing". The evidence lives on the executor branch `exec-026` @ `4ea77c7`, in `plans/evidence/026-runtime-verify-stability.md` and `plans/evidence/artifacts/026/*.log`. The reviewer checked every number below against those logs.

- Baseline, 3 unmodified runs, default parallelism, about 50 s each: 2 passed. Run 2 failed in `pi-durable-restore.test.ts:622` ("Matcher did not succeed in time"). The target case passed every time, in 4605, 3338 and 3857 ms.
- H1 (cumulative slowdown) was rejected. The case took 2427 ms when it ran first and 2820 ms after 13 other conformance cases.
- H2 (contention) holds for the target case. With `@cloudflare/vitest-pool-workers` 0.12.21, `--maxWorkers=1` and `--no-file-parallelism` do not serialise files: the suite still took about 51 s, and the case took 3584 and 3510 ms. Only `poolOptions.workers.singleWorker: true` serialises files. The suite then takes 116 to 142 s and the case 2239 to 3516 ms.
- Five runs with `singleWorker` gave 4 passes. Run 2 failed in `pi-durable-host.test.ts:1565`: "expected 'failed' to be 'closed'", with workerd logging "Network connection lost". `--no-file-parallelism` also failed `pi-durable-checkpoints.test.ts:112` ("Session is closed") and `pi-durable-retention.test.ts:294`.

Lesson: the premise was too narrow. The target case is now the least flaky of the load failures. At least two of the other failures end in a wrong state or a closed session, not just a slow poll. Lengthening their polls would therefore be the same banned "raise the deadline" move, and it might hide a real teardown or alarm race. The executor's uncommitted `singleWorker: true` edit is not accepted.

Next step: maintainer decision. Option A is a diagnosis plan that reproduces each of the four other failures in isolation under induced load and classifies each one as a test-only timing issue or a runtime race. Option B is to accept `singleWorker` and gate CI on it. That costs about 2.5x suite time and still leaves 1 failure in 5 runs, so it does not meet "Done".
