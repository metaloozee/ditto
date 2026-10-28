# 026: Make `runtime:verify` stable under full-suite load and run it in CI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file.
>
> **Drift check (run first)**: `git diff --stat f025d17..HEAD -- apps/runtime/vitest.config.ts apps/runtime/package.json apps/runtime/src/pi-durable-storage.test.ts apps/runtime/src/pi-durable-storage.ts apps/runtime/src/pi-durable-local.ts patches pnpm-workspace.yaml package.json .github/workflows/ci.yml`. If any of these changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: TODO, READY (Revision 1)
- **Priority**: P1 (019 is blocked on it)
- **Effort**: M (profiling first; the fix is likely small)
- **Risk**: LOW for runtime behavior, MED for CI time
- **Depends on**: 028 (DONE with limits, `9b0ec04`..`88a0e54`)
- **Category**: test infrastructure / CI
- **Planned at**: commit `0f9c7c1`, 2026-10-24. **Revision 1** at `f025d17`, 2026-10-28.
- **Decision**: maintainer, 2026-10-28. Profile the slow conformance case and fix its cost. Do not gate CI on `singleWorker`.

## Hard rule

Do not raise the 5 s test deadline, skip, quarantine, retry or reorder the failing case to make it pass. Do not set `singleWorker`, `maxWorkers` or `fileParallelism` in `apps/runtime/vitest.config.ts`. 019 states the same rule. If the cost is upstream in `@earendil-works/pi-durable` and Ditto cannot remove it, STOP and report with the profile.

## Why this matters

CI runs only `pnpm verify`, which omits `runtime:verify` and `contracts:verify`. So CI has never run the runtime suite, and 019 cannot meet "Verification/CI genuinely includes the runtime checks".

The first execution (history below) and plan 028 narrowed the problem to one case. After 028's fixture fix, five unmodified full `pnpm runtime:verify` runs (`plans/evidence/028-runtime-load-failures.md`, Step 7) gave:

| Run | Result | "streams long document tails across root replacement deltas" |
|---|---|---|
| 1 | 512 passed | 4885 ms |
| 2 | 512 passed | 4536 ms |
| 3 | 512 passed | 3525 ms |
| 4 | 512 passed | 4612 ms |
| 5 | 1 failed | 8715 ms, `Test timed out in 5000ms` |

The case takes about 3 s even alone (2.2 to 3.5 s with files serialized), so it uses 45 to 97 percent of its deadline before any contention. Contention (H2 in the history) only pushes an already slow case over the line. 029's single recorded run passed 521 tests. This plan removes the case's own cost.

## Current state

- Root `package.json`:
  ```json
  "runtime:verify": "pnpm --filter @ditto/runtime typecheck && node --test apps/runtime/src/pi-durable-imports.test.mjs scripts/pi-durable-host-auth.test.mjs && pnpm --filter @ditto/runtime exec vitest run",
  "verify": "pnpm check && pnpm db:drift &&pnpm typecheck && pnpm credentials:verify && pnpm test && pnpm build && pnpm runner:verify",
  ```
- The case is registered by `registerStorageConformance` from `@earendil-works/pi-durable/testing` 1.0.1 (`apps/runtime/src/pi-durable-storage.test.ts:93-112`). Each conformance case gets a fresh DO and opens `EncryptedPiStorage` (`apps/runtime/src/pi-durable-storage.ts:561`, 2800 lines; `STORAGE_ROW_BYTES = 64 * 1024` at `:51`):
  ```ts
  registerStorageConformance(
  	{ describe, expect, it },
  	"encrypted DO SQLite",
  	async (use) => {
  		const stub = env.PI_HOST_STORAGE.getByName(
  			`conformance-${crypto.randomUUID()}`,
  		);
  		await runInDurableObject(stub, async (_instance, state) => {
  			const storage = await EncryptedPiStorage.open(
  				state.storage,
  				await binding(),
  			);
  			try {
  				await use(storage);
  			} finally {
  				await storage.close(BACKGROUND_CONTEXT);
  			}
  		});
  	},
  );
  ```
- The upstream case body (`node_modules/.pnpm/@earendil-works+pi-durable@1.0.1_*/node_modules/@earendil-works/pi-durable/dist/testing/storage-conformance.js:619-695`) does the following:
  - it creates a 512-row document;
  - it commits 24 small `delta` changes, then one full `["r", replacement]` replacement of 512 rows, then 24 more deltas, for **50 commits** in all;
  - it reads the document `asOf` three historical positions and `current` twice.

  So the cost is per-commit and per-historical-read work on a document of about 20 KB.
- The unencrypted upstream adapter is available for comparison: `SqliteStorage.open(fixtureDatabase(state.storage))`, with `SqliteStorage` from `@earendil-works/pi-durable/storage/sqlite` and `fixtureDatabase` from `apps/runtime/src/pi-durable-local.ts:29`. Exemplar: `apps/runtime/src/pi-durable-host.test.ts:209`.
- `apps/runtime/vitest.config.ts` has no parallelism settings. The machine used for the evidence so far has 4 cores (`nproc`).
- `patches/@cloudflare__vitest-pool-workers@0.12.21.patch` fixes a per-instance Proxy cost and an isolated-storage pop race (plans 008 and 010).

## Hypotheses, in order

- **P1, Ditto's adapter dominates.** `EncryptedPiStorage` work per commit or per historical read (encrypting or decrypting whole document rows, re-chunking at `STORAGE_ROW_BYTES`, replaying every delta from the base on each `asOf` read, or key import per operation) makes the case much slower than the plain adapter.
- **P2, upstream or platform dominates.** The plain `SqliteStorage` is also about 3 s, so the cost is in Pi Durable's document model, DO SQLite in workerd, or the test pool.

## Steps

1. **Baseline.** Run the drift check. Record `nproc`, Node and workerd versions. Run the case alone 3 times with `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts -t "streams long document tails"` and record each duration. Between runs, kill leftover `workerd` with `pkill -9 -x workerd` (never `pkill -f`).

2. **A/B against the plain adapter.** Create a throwaway file `apps/runtime/src/zz-026-profile.test.ts`. It calls `registerStorageConformance` twice, with the suite names "encrypted A/B" (the exact factory above) and "plain A/B" (`SqliteStorage.open(fixtureDatabase(state.storage))` inside `runInDurableObject`; it needs no `close`). Run only the case, 3 times each: `pnpm --filter @ditto/runtime exec vitest run src/zz-026-profile.test.ts -t "streams long document tails"`. Record both durations. P1 holds if encrypted is at least 2× plain. **Delete the file before Step 5** and confirm `git status` no longer lists it.

3. **Attribute the cost (P1 only).** In the same throwaway file, wrap the `EncryptedPiStorage` passed to `use` in a `Proxy` that times every async method call (`commit`, `document`, and whatever else the case calls) with `performance.now()`. Print a per-method total and call count with `console.log` once after the case. Then narrow inside the dominant method:
   - Temporarily time the internal helpers it calls, by adding `performance.now()` lines in `pi-durable-storage.ts` that you revert before Step 5. Check with `git diff --stat apps/runtime/src/pi-durable-storage.ts` (empty) after reverting.
   - Name the one helper or loop that accounts for most of the time, and record the numbers.

   If P2 holds instead, skip to the STOP condition "cost is upstream".

4. **Fix (P1 only).** Change `apps/runtime/src/pi-durable-storage.ts` so the dominant cost no longer scales as it does. Typical shapes are caching an imported key per binding, not re-encrypting unchanged rows, or reusing a decoded base across one read. Keep these unchanged:
   - the encrypted format (`ENCRYPTED_STORAGE_FORMAT`, `ADAPTER_COMPAT`);
   - the on-disk bytes for any existing row;
   - every integrity check.

   If the fix needs a format or compatibility change, STOP. Add one focused test in `pi-durable-storage.test.ts` that would fail if the fix's invariant broke. For example, a cached key must not survive a keyring change: the existing key-retention tests must still pass, and the new test covers the specific edge. Verify: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts` passes, and the case alone is now at most 50% of its Step 1 median. Record before and after.

5. **Five full runs.** With the throwaway file deleted and timing lines reverted, run `pnpm runtime:verify` five times in a row, killing `workerd` between runs. All five must pass. Record each suite duration and the case's duration.

6. **Gate CI.** In root `package.json`, change `verify` to run `pnpm contracts:verify && pnpm runtime:verify` right after `pnpm credentials:verify`. Fix the missing space in `pnpm db:drift &&pnpm typecheck` while there. Check that `.github/workflows/ci.yml` needs no new setup: it must already install root dependencies with Node 24 and run `pnpm verify`. If it does need setup, STOP. Run `pnpm verify` once.

## Checks

```sh
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts
pnpm runtime:verify            # five consecutive passes
pnpm contracts:verify
pnpm verify
git status --short             # only pi-durable-storage.ts, pi-durable-storage.test.ts, package.json and the evidence file
git diff --stat -- apps/runtime/vitest.config.ts patches   # expect empty
```

Write results to `plans/evidence/026-runtime-verify-stability.md` (the first execution's file lives on branch `exec-026`. Start a fresh file on this branch and link that branch in one line). Include:
- the environment and core count;
- the Step 1 and Step 2 durations, and which hypothesis held;
- the Step 3 attribution table;
- the change, with before and after timings for the case;
- the five full runs;
- the `pnpm verify` result.

## Stop conditions

- The fix would need a raised deadline, a skip, a retry, a reordering, or any parallelism setting.
- P2 holds: the plain adapter is within 2× of the encrypted one, or the dominant cost is inside `@earendil-works/pi-durable`. Report the A/B and the profile. Do not patch `node_modules` or add a pnpm patch for Pi Durable without maintainer approval.
- The fix changes the encrypted format, the compatibility strings, the bytes of existing rows, or removes an integrity check.
- A different runtime test fails in the five-run check. Record it with its error and stop. Do not lengthen its poll.
- `ci.yml` needs new setup, or `pnpm verify` would exceed CI's 30-minute job limit.

## Done

- The case alone runs in at most half its Step 1 median, with the cause named and fixed in Ditto's adapter.
- Five consecutive full `runtime:verify` passes.
- `pnpm verify` includes `contracts:verify` and `runtime:verify` and passes once.
- `vitest.config.ts` and `patches/` are unchanged, and no throwaway file remains.

## Maintenance

A future Pi Durable or pool upgrade must rerun the five-run check. Any cache the fix adds to `EncryptedPiStorage` must be invalidated wherever the keyring or binding can change. Review key rotation and retention (005) against it.

## History: first execution (2026-10-24, original hypotheses H1 to H3)

The original plan tested H1 (cumulative slowdown in the file), H2 (CPU contention between files) and H3 (encryption cost). It was BLOCKED; the record is kept as written.


### Execution result (2026-10-24, reviewer)

BLOCKED by the stop condition "a different runtime test starts failing". The evidence lives on the executor branch `exec-026` @ `4ea77c7`, in `plans/evidence/026-runtime-verify-stability.md` and `plans/evidence/artifacts/026/*.log`. The reviewer checked every number below against those logs.

- Baseline, 3 unmodified runs, default parallelism, about 50 s each: 2 passed. Run 2 failed in `pi-durable-restore.test.ts:622` ("Matcher did not succeed in time"). The target case passed every time, in 4605, 3338 and 3857 ms.
- H1 (cumulative slowdown) was rejected. The case took 2427 ms when it ran first and 2820 ms after 13 other conformance cases.
- H2 (contention) holds for the target case. With `@cloudflare/vitest-pool-workers` 0.12.21, `--maxWorkers=1` and `--no-file-parallelism` do not serialise files: the suite still took about 51 s, and the case took 3584 and 3510 ms. Only `poolOptions.workers.singleWorker: true` serialises files. The suite then takes 116 to 142 s and the case 2239 to 3516 ms.
- Five runs with `singleWorker` gave 4 passes. Run 2 failed in `pi-durable-host.test.ts:1565`: "expected 'failed' to be 'closed'", with workerd logging "Network connection lost". `--no-file-parallelism` also failed `pi-durable-checkpoints.test.ts:112` ("Session is closed") and `pi-durable-retention.test.ts:294`.

Lesson: the premise was too narrow. The target case is now the least flaky of the load failures. At least two of the other failures end in a wrong state or a closed session, not just a slow poll. Lengthening their polls would therefore be the same banned "raise the deadline" move, and it might hide a real teardown or alarm race. The executor's uncommitted `singleWorker: true` edit is not accepted.

Next step: maintainer decision. Option A is a diagnosis plan that reproduces each of the four other failures in isolation under induced load and classifies each one as a test-only timing issue or a runtime race. Option B is to accept `singleWorker` and gate CI on it. That costs about 2.5x suite time and still leaves 1 failure in 5 runs, so it does not meet "Done".
