# 026: Make `runtime:verify` stable under full-suite load and run it in CI

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, do Step 6a if the condition says so, then stop and report. Do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file.
>
> **Drift check (run first)**: `git diff --stat 1af3c7b..HEAD -- apps/runtime/vitest.config.ts apps/runtime/package.json apps/runtime/src/pi-durable-storage.test.ts apps/runtime/src/pi-durable-storage.ts apps/runtime/src/pi-durable-local.ts patches pnpm-workspace.yaml package.json .github/workflows/ci.yml`. If any of these changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: DONE (Revision 2), reviewed 2026-10-29 and integrated at `f91135b`..`d9d5902`; CI run 40828427440 green ([evidence](evidence/026-runtime-verify-stability.md))
- **Priority**: P1 (019 is blocked on it)
- **Effort**: M (profiling first; the fix is likely small)
- **Risk**: LOW for runtime behavior, LOW for CI time (the whole CI job takes about 3 min; its limit is 30)
- **Depends on**: 028 (DONE with limits, `9b0ec04`..`88a0e54`)
- **Category**: test infrastructure / CI
- **Planned at**: commit `0f9c7c1`, 2026-10-24. Revision 1 at `f025d17`, 2026-10-28. **Revision 2** at `1af3c7b`, 2026-10-28.
- **Decisions** (maintainer, 2026-10-28):
  1. Profile the slow conformance case and fix its cost. Do not gate CI on `singleWorker`.
  2. Fix target: the case alone has a median of **≤ 1500 ms** over 3 runs. This replaces Revision 1's "≤ 50% of the Step 1 median". Under load the case ran 2.5 to 3× its time alone (8715 ms against about 3 s), so 1500 ms keeps it under the 5 s deadline.
  3. `contracts:verify` joins `pnpm verify` even if the runtime fix STOPs (Step 6a). `runtime:verify` joins only after the fix lands (Step 6b).
  4. Local `pnpm verify` is judged segment by segment (Step 7). `credentials:verify` has a known WSL-only flake in `product-commands.worker.test.ts`. The first green CI run after integration is the final arbiter.

## Hard rule

Do not raise the 5 s test deadline, skip, quarantine, retry or reorder the failing case to make it pass. Do not set `singleWorker`, `maxWorkers` or `fileParallelism` in `apps/runtime/vitest.config.ts`. 019 states the same rule. Do not patch `node_modules` or add a pnpm patch for `@earendil-works/pi-durable`.

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

The suite has grown since then: 030 recorded 523/523. Expect about 523 tests, not 512.

The case takes about 3 s even alone (2.2 to 3.5 s with files serialized), so it uses 45 to 97 percent of its deadline before any contention. Contention only pushes an already slow case over the line. This plan removes the case's own cost.

## Current state

- Root `package.json` (lines 17, 19, 22):
  ```json
  "contracts:verify": "pnpm --filter @ditto/runtime-contracts typecheck && pnpm --filter @ditto/runtime-contracts exec vitest run && pnpm --filter @ditto/runtime-contracts build",
  "runtime:verify": "pnpm --filter @ditto/runtime typecheck && node --test apps/runtime/src/pi-durable-imports.test.mjs scripts/pi-durable-host-auth.test.mjs && pnpm --filter @ditto/runtime exec vitest run",
  "verify": "pnpm check && pnpm db:drift &&pnpm typecheck && pnpm credentials:verify && pnpm test && pnpm build && pnpm runner:verify",
  ```
- `.github/workflows/ci.yml` has one `verify` job (`ubuntu-latest`, `timeout-minutes: 30`): Node 24, `pnpm install --frozen-lockfile`, `npm ci --prefix packages/sandbox-runner`, then `pnpm verify`. Its last 5 runs on `feat/pi-durable` passed, including `credentials:verify`. The run at `aaf7563` took 2 min 56 s.
- The case is registered by `registerStorageConformance` from `@earendil-works/pi-durable/testing` 1.0.1 (`apps/runtime/src/pi-durable-storage.test.ts:93-112`). Each conformance case gets a fresh DO and opens `EncryptedPiStorage` (`apps/runtime/src/pi-durable-storage.ts:561`, a 2800-line file; `STORAGE_ROW_BYTES = 64 * 1024` at `:51`):
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
  `binding()` (`pi-durable-storage.test.ts:59-78`) is module-private. A separate test file must copy it, together with `keyBytes` (`:55-57`) and the `importRuntimeKeyringFromBytes` import from `./runtime-crypto.ts`.
- The upstream case body is in `node_modules/.pnpm/@earendil-works+pi-durable@1.0.1_*/node_modules/@earendil-works/pi-durable/dist/testing/storage-conformance.js:619-695`. It:
  - creates a 512-row document;
  - commits 24 small `delta` changes, then one full `["r", replacement]` replacement of 512 rows, then 24 more deltas, for **50 commits** in all;
  - reads the document `asOf` three historical positions (`createdAt`, `beforeReplacementAt`, `replacementAt`) and at `"current"` twice.

  So the cost is per-commit and per-historical-read work on a document of about 20 KB.
- The unencrypted upstream adapter is available for comparison: `SqliteStorage.open(fixtureDatabase(state.storage))`, with `SqliteStorage` from `@earendil-works/pi-durable/storage/sqlite` and `fixtureDatabase` from `apps/runtime/src/pi-durable-local.ts:29`. Exemplar: `apps/runtime/src/pi-durable-host.test.ts:209`. `SqliteStorage` has `close(context): Promise<void>`, so call it in `finally` just like the encrypted arm. Both arms then include close time.
- `apps/runtime/vitest.config.ts` has no parallelism settings. The machine used for the evidence so far has 4 cores (`nproc`). The CI runner is `ubuntu-latest`.
- `patches/@cloudflare__vitest-pool-workers@0.12.21.patch` fixes a per-instance Proxy cost and an isolated-storage pop race (plans 008 and 010).

## Hypotheses

Every timing below is the case's median over 3 runs alone. Read it from the case's line in `--reporter=verbose` output.

- **P1, Ditto's adapter dominates.** The plain arm's median is ≤ 1500 ms and the encrypted arm's median is > 1500 ms. Work in `EncryptedPiStorage` per commit or per historical read is the excess. Candidates: encrypting or decrypting whole document rows, re-chunking at `STORAGE_ROW_BYTES`, replaying every delta from the base on each `asOf` read, or importing a key per operation.
- **P2, upstream or platform dominates.** The plain arm's median is > 1500 ms. No change in Ditto's adapter can meet the target.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Case alone | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts -t "streams long document tails" --reporter=verbose` | 1 passed; the case line shows its ms |
| Storage file | `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts` | all pass |
| Runtime gate | `pnpm runtime:verify` | exit 0, about 523 tests passed |
| Contracts gate | `pnpm contracts:verify` | exit 0 |
| Clean workerd | `pkill -9 -x workerd` | never `pkill -f` |

## Scope

**In scope**: `apps/runtime/src/pi-durable-storage.ts`, `apps/runtime/src/pi-durable-storage.test.ts`, root `package.json` (`verify` script only), `plans/evidence/026-runtime-verify-stability.md` (create). Also the throwaway `apps/runtime/src/zz-026-profile.test.ts`, which must be deleted before Step 5.

**Out of scope**: `apps/runtime/vitest.config.ts`, `patches/`, `.github/workflows/ci.yml`, `node_modules`, every other test file, and the `credentials:verify` script. The product-commands flake is not this plan's problem.

## Steps

1. **Baseline.** Run the drift check. Record `nproc`, `node --version` and the workerd version (`pnpm --filter @ditto/runtime exec workerd --version`, or the `workerd` version in `pnpm-lock.yaml`). Run "Case alone" 3 times and record each duration and the median. Kill leftover `workerd` between runs.

2. **A/B against the plain adapter.** Create the throwaway `apps/runtime/src/zz-026-profile.test.ts`. Copy `keyBytes` and `binding` into it. Call `registerStorageConformance` twice, with suite names "encrypted A/B" (the exact factory above) and "plain A/B" (`SqliteStorage.open(fixtureDatabase(state.storage))` inside `runInDurableObject`, closed in `finally` with `BACKGROUND_CONTEXT`). Run 3 times: `pnpm --filter @ditto/runtime exec vitest run src/zz-026-profile.test.ts -t "streams long document tails" --reporter=verbose`. Record both arms' durations and medians, and name the hypothesis that holds according to the definitions above.
   - P2 holds: STOP (see "Stop conditions"). Delete the throwaway file, then do Step 6a.

3. **Attribute the cost (P1 only).**
   1. **Clock calibration.** In the throwaway file, inside a `runInDurableObject` callback, time a synchronous busy loop: `const t = performance.now(); let x = 0; for (let i = 0; i < 5e7; i++) x += i; console.log("calibration", performance.now() - t, x);`. The Workers runtime may freeze the clock during synchronous CPU work. If calibration prints under 5 ms, in-worker timings cannot measure CPU work. In that case, count operations in steps 3.2 and 3.3 instead of timing them: calls, bytes encrypted and decrypted, rows decoded, and deltas replayed per read. Record which mode you used.
   2. **Per-method.** Wrap the `EncryptedPiStorage` passed to `use` in a `Proxy`. For each function-valued property, return a wrapper that calls `Reflect.get(target, prop, target).apply(target, args)`, with the original target as `this`, and adds the elapsed time (or count) to a per-method total. Print the totals once after `use` resolves.
   3. **Inside the dominant method.** Temporarily add timing or counting lines to the helpers it calls in `pi-durable-storage.ts`. Name the one helper or loop that accounts for most of the cost, and record the numbers. Revert those lines before Step 4. Verify: `git diff --stat apps/runtime/src/pi-durable-storage.ts` is empty.

4. **Fix (P1 only).** Change `apps/runtime/src/pi-durable-storage.ts` so the dominant cost no longer scales as it does. Typical shapes: cache an imported key per binding, stop re-encrypting unchanged rows, or reuse a decoded base across one read. Keep these unchanged:
   - the encrypted format (`ENCRYPTED_STORAGE_FORMAT`, `ADAPTER_COMPAT`);
   - the on-disk bytes for any existing row;
   - every integrity check.

   If the fix needs a format or compatibility change, STOP and do Step 6a. Add one focused test to `pi-durable-storage.test.ts` that fails if the fix's invariant breaks. For example, a cached key must not survive a keyring change; the existing key-retention tests must still pass. Verify both of these:
   - "Storage file" passes.
   - The "Case alone" median over 3 runs is ≤ 1500 ms. If it is not, STOP and do Step 6a.

   Record the before and after timings.

5. **Five full runs.** Delete the throwaway file and confirm `git status --short` does not list it. Run `pnpm runtime:verify` five times in a row, killing `workerd` between runs. All five must pass. Record each suite duration and the case's duration (run with `pnpm --filter @ditto/runtime exec vitest run --reporter=verbose` for the case time, or grep the default output).

6. **Gate CI.** First check that `.github/workflows/ci.yml` needs no new setup: it must still install root dependencies on Node 24 and run `pnpm verify`. If it needs new setup, STOP.
   - **6a (always, including after a STOP that says so).** In root `package.json`, insert `&& pnpm contracts:verify` right after `pnpm credentials:verify` in `verify`. Fix the missing space in `pnpm db:drift &&pnpm typecheck`. Verify: `pnpm contracts:verify` exits 0.
   - **6b (only after Step 5 passes).** Insert `&& pnpm runtime:verify` right after `pnpm contracts:verify`. Final `verify`:
     ```json
     "verify": "pnpm check && pnpm db:drift && pnpm typecheck && pnpm credentials:verify && pnpm contracts:verify && pnpm runtime:verify && pnpm test && pnpm build && pnpm runner:verify",
     ```

7. **Local verify, segment by segment.** Do not use a single `pnpm verify` run as the gate, because the WSL flake can fail it. Run each segment separately and record its exit code: `pnpm check`, `pnpm db:drift`, `pnpm typecheck`, `pnpm credentials:verify`, `pnpm contracts:verify`, `pnpm runtime:verify` (6b only), `pnpm test`, `pnpm build`, `pnpm runner:verify`. All must exit 0, with one allowed exception. `pnpm credentials:verify` may fail, but only if every failure is in `src/product-commands.worker.test.ts` and is either `Test timed out in 5000ms` or "Isolated storage failed". In that case, record the failing test names and rerun `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` once. Record that result too, whatever it is. Any other failure is a STOP. The reviewer confirms with the first CI run after integration.

## Checks

```sh
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts
pnpm runtime:verify            # five consecutive passes
pnpm contracts:verify
git status --short             # only pi-durable-storage.ts, pi-durable-storage.test.ts, package.json and the evidence file
git diff --stat -- apps/runtime/vitest.config.ts patches .github   # expect empty
test ! -e apps/runtime/src/zz-026-profile.test.ts && echo clean
```

Write results to `plans/evidence/026-runtime-verify-stability.md`. The first execution's file lives on branch `exec-026` @ `4ea77c7`; start a fresh file on this branch and link that branch in one line. Include:
- the environment, core count and versions;
- the Step 1 and Step 2 durations with medians, and which hypothesis held;
- the calibration result, and the Step 3 attribution table (times or counts);
- the change, with before and after timings for the case;
- the five full runs;
- the Step 7 segment table with exit codes, and any product-commands failures by name.

## Stop conditions

- The fix would need a raised deadline, a skip, a retry, a reordering, or any parallelism setting. Do Step 6a, then stop.
- P2 holds (the plain arm's median is > 1500 ms), or the dominant cost is inside `@earendil-works/pi-durable`. Report the A/B and the profile, do Step 6a, then stop.
- The fix cannot bring the case's median alone to ≤ 1500 ms. Do Step 6a, then stop.
- The fix changes the encrypted format, the compatibility strings, the bytes of existing rows, or removes an integrity check. Revert it, do Step 6a, then stop.
- A different runtime test fails in the five-run check. Record it with its error. Do not lengthen its poll. Do Step 6a, then stop.
- `ci.yml` needs new setup. Stop without Step 6a.
- A Step 7 segment fails for any reason other than the allowed product-commands flake signature.

## Done

- The case's median alone is ≤ 1500 ms over 3 runs, and the cause is named and fixed in Ditto's adapter.
- Five consecutive full `runtime:verify` passes.
- `verify` matches the final script in Step 6b exactly.
- Every Step 7 segment exits 0, except the allowed product-commands flake, which is recorded.
- `vitest.config.ts`, `patches/` and `.github/` are unchanged, and no throwaway file remains.

On a STOP that says "do Step 6a", the plan ends as BLOCKED with partial progress: `contracts:verify` is gated and `runtime:verify` is not.

## Maintenance

A future Pi Durable or pool upgrade must rerun the five-run check. Any cache the fix adds to `EncryptedPiStorage` must be invalidated wherever the keyring or binding can change, so review key rotation and retention (005) against it. If `product-commands.worker.test.ts` ever fails in CI, it needs its own plan; do not add retries to the gate.

## History

### Revision 2 (2026-10-28, review)

The maintainer settled decisions 2 to 4 above. Other changes in this revision: the planned-at SHA moved to `1af3c7b` (only `credentials:verify` changed in `package.json` since `f025d17`). Hypotheses now use absolute thresholds. The plain arm calls `close`, because `SqliteStorage` has one; Revision 1 said it needed none. Step 3 gained a clock calibration and a Proxy that binds `this`. Scope and command tables were added. The local `pnpm verify` gate is now judged per segment.

### First execution (2026-10-24, original hypotheses H1 to H3)

The original plan tested H1 (cumulative slowdown in the file), H2 (CPU contention between files) and H3 (encryption cost). It was BLOCKED; the record is kept as written.

BLOCKED by the stop condition "a different runtime test starts failing". The evidence lives on the executor branch `exec-026` @ `4ea77c7`, in `plans/evidence/026-runtime-verify-stability.md` and `plans/evidence/artifacts/026/*.log`. The reviewer checked every number below against those logs.

- Baseline, 3 unmodified runs, default parallelism, about 50 s each: 2 passed. Run 2 failed in `pi-durable-restore.test.ts:622` ("Matcher did not succeed in time"). The target case passed every time, in 4605, 3338 and 3857 ms.
- H1 (cumulative slowdown) was rejected. The case took 2427 ms when it ran first and 2820 ms after 13 other conformance cases.
- H2 (contention) holds for the target case. With `@cloudflare/vitest-pool-workers` 0.12.21, `--maxWorkers=1` and `--no-file-parallelism` do not serialise files: the suite still took about 51 s, and the case took 3584 and 3510 ms. Only `poolOptions.workers.singleWorker: true` serialises files. The suite then takes 116 to 142 s and the case 2239 to 3516 ms.
- Five runs with `singleWorker` gave 4 passes. Run 2 failed in `pi-durable-host.test.ts:1565`: "expected 'failed' to be 'closed'", with workerd logging "Network connection lost". `--no-file-parallelism` also failed `pi-durable-checkpoints.test.ts:112` ("Session is closed") and `pi-durable-retention.test.ts:294`.

Lesson: the premise was too narrow. The target case was the least flaky of the load failures. 028 later classified the others and fixed the checkpoint fixture. The executor's uncommitted `singleWorker: true` edit was not accepted.
