# 028: Classify and fix the load-sensitive `runtime:verify` failures

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. A reviewer maintains `plans/README.md`; do not edit it or this file.
>
> **Drift check (run first)**: `git diff --stat 2f79ab0..HEAD -- apps/runtime/src/pi-durable-host.ts apps/runtime/src/pi-durable-checkpoint.fixture.ts apps/runtime/src/pi-durable-host.test.ts apps/runtime/src/pi-durable-checkpoints.test.ts apps/runtime/src/pi-durable-restore.test.ts apps/runtime/src/pi-durable-retention.test.ts apps/runtime/src/pi-durable-lifecycle.test.ts apps/runtime/src/pi-durable-workspace-actions.test.ts apps/runtime/vitest.config.ts`. It should print nothing. If it prints anything, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Priority**: P1 (blocks 026, and 026 blocks 019)
- **Effort**: M
- **Risk**: LOW for runtime behavior (the planned fix is test-only), MED for the diagnosis being wrong
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `2f79ab0`, 2026-10-24

## Hard rule

Do not raise any test deadline (`expect.poll` / `vi.waitFor` `timeout`, vitest `testTimeout`), and do not skip, quarantine, retry or reorder a test. Do not add `singleWorker`, `maxWorkers` or `fileParallelism` to `apps/runtime/vitest.config.ts`. Do not change `pi-durable-host.ts`. Step 5 below makes the one fixture change this plan allows, and only once Step 3 has proven its cause.

## Why this matters

`pnpm runtime:verify` (the `apps/runtime` Workers vitest suite, 23 files, 512 tests) fails about 1 run in 3 on a 4-core WSL2 machine. The failing test changes from run to run. Plan 026 tried to fix one upstream conformance case and found that it is no longer the main problem. Four other tests fail under CPU load, and serialising files (`singleWorker`) does not remove the failures. Until the suite passes reliably, it cannot join `pnpm verify` and CI. This plan tells real runtime races apart from test fixtures that depend on real time by accident, and fixes the second kind.

## Observed failures (from plan 026's run, 2026-10-24, at `2f79ab0`)

| ID | Test | Seen | Failure |
|---|---|---|---|
| F1a | `pi-durable-restore.test.ts:619` "delivers a restore pointer move that follows an undelivered publication as its own batch" | 1 of 3 default runs | `Matcher did not succeed in time` at `pi-durable-checkpoint.fixture.ts:621` (`complete`). Caused by `Error: Session is closed` from `HarnessImpl.#assertUsable` ← `PiDurableHost.receipts` (`pi-durable-host.ts:3545`) ← `PiDurableHost.reconcile` (`:3953`) |
| F1b | `pi-durable-checkpoints.test.ts:45` "keeps ordinary work queued until the baseline…" | `--no-file-parallelism` run | same stack, same cause |
| F1c | `pi-durable-retention.test.ts:291` "retires pairs other than current and previous…" | `--no-file-parallelism` run | same stack, same cause |
| F2 | `pi-durable-host.test.ts:1543` "combines wall-clock yield and native alarms with joined event resources" | 1 of 5 `singleWorker` runs | poll at `:1565` got `expected 'failed' to be 'closed'`. workerd logged "Network connection lost" |

`--maxWorkers=1` and `--no-file-parallelism` have no effect with `@cloudflare/vitest-pool-workers` 0.12.21: the suite still took about 51 s. Only `poolOptions.workers.singleWorker: true` serialises files, and the suite then takes 116 to 142 s.

## Current state and leading hypotheses

The advisor read the code. The executor must test these hypotheses, not assume them.

**Host budget timer.** `apps/runtime/src/pi-durable-host.ts`:

```ts
147: const WORK_MS = 1000;
148: const DRAIN_MS = 1000;
...
6458:   const workMs = this.dependencies.budgets?.workMs ?? WORK_MS;
6459:   const drainMs = this.dependencies.budgets?.drainMs ?? DRAIN_MS;
...
6471:   yield_at: now + workMs,
6472:   end_at: now + workMs + drainMs,
...
6498:   this.timer = setTimeout(
6499:     () => { void this.yield().catch(...) },
6505:     Math.max(0, this.active.yield_at - this.dependencies.now()),
6506:   );
```

`yield()` calls `await this.harness.close(BACKGROUND_CONTEXT)`, about line 6950. Later, if `this.dependencies.now() >= this.active.end_at`, it sets `host_invocations.state = 'failed'` and throws "Actual close exceeded end deadline", about lines 6959 to 6968.

**H-F1 (checkpoint fixture: virtual clock plus a real timer).** `pi-durable-checkpoint.fixture.ts` freezes the host clock at `control.now = Date.now() + 60000` (line ~365) and passes `now: () => control.now` (line ~403). It does not set `budgets`, so the host uses 1000/1000. The `setTimeout` at host line 6498 is a real timer, so 1 s of real time after an invocation starts, `yield()` closes the harness, whatever the virtual clock says. Under CPU load, a fixture's pair publication can take more than 1 s of real time. Every later `host.reconcile()` inside `complete()` (fixture lines 610 to 623) then throws "Session is closed", so the poll never reaches `"complete"`. That predicts F1a to F1c exactly. Other host fixtures already set an explicit budget, for example `pi-durable-effects.test.ts:68-80`:

```ts
const dependencies: HostFixtureDependencies = {
	now: () => now,
	authority: async () => { ... },
	budgets: { workMs: 10_000, drainMs: 1000 },
	operationMs: { model: 60_000, tool: 90_000 },
	...
```

The same `budgets: { workMs: 10_000, drainMs: 1000 }` appears in `pi-durable-models.test.ts:116`, `pi-durable-summary.test.ts:96`, `pi-durable-tools.test.ts:154` and `pi-durable-model-preparation.gate.test.ts:220`. The checkpoint fixture's `dependencies` object starts at `pi-durable-checkpoint.fixture.ts:402`:

```ts
const dependencies: HostFixtureDependencies = {
	now: () => control.now,
	fault: (point) => hostFault.at?.(point),
	retained: { ... },
```

**H-F2 (host test asserts a real-time property).** `pi-durable-host.test.ts:1543` deliberately sets `composition.dependencies.now = Date.now` (real clock) with the default 1000/1000 budgets, and polls for `"closed"` with `{ timeout: 2000, interval: 10 }`. Under load, closing can finish after `end_at` (1 s of drain). The host then correctly records `'failed'`. If that is the cause, the host is behaving as designed and the test is asserting a timing guarantee that a starved CPU cannot give. That is a maintainer decision, not an executor fix (see Step 6).

Other fixtures freeze the clock without setting `budgets`: `pi-durable-command.fixture.ts` (~84 to 96) and `pi-durable-candidate.fixture.ts` (~143 to 152). They may have the same weakness. They have not failed yet, so this plan only records them (Step 2) and does not change them.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `pnpm install --frozen-lockfile` | exit 0 |
| Runtime typecheck | `pnpm --filter @ditto/runtime typecheck` | exit 0 |
| One file, verbose | `pnpm --filter @ditto/runtime exec vitest run src/<file> --reporter=verbose` | all pass |
| Full runtime gate | `pnpm runtime:verify` | exit 0, `Tests 512 passed` |
| Lint | `pnpm check` | exit 0 |

Never symlink `node_modules` from another checkout. Kill leftover workerd with `pkill -9 -x workerd`. Never use `pkill -f`.

**Induced load** (use the same recipe everywhere so runs are comparable). Start 4 busy loops and record their PIDs, then kill them by PID:

```sh
LOAD_PIDS=""; for i in 1 2 3 4; do node -e 'for(;;){}' & LOAD_PIDS="$LOAD_PIDS $!"; done
# ... run the test ...
kill $LOAD_PIDS
```

Each Bash call starts a fresh shell, so start the loops, run the test and kill the loops in one command.

## Scope

**In scope**
- `apps/runtime/src/pi-durable-checkpoint.fixture.ts`: only the `budgets` line in Step 5.
- `plans/evidence/028-runtime-load-failures.md` (create).
- `plans/evidence/artifacts/028/*.log` (create).
- Temporary, uncommitted diagnostic edits (Step 3) to any `apps/runtime/src/*.test.ts` or fixture file. Revert them before committing. `git diff` must show only the Step 5 line.

**Out of scope**
- `apps/runtime/src/pi-durable-host.ts`, including `WORK_MS`/`DRAIN_MS` and the production budgets used by `pi-durable-product-session.ts:228`.
- `apps/runtime/vitest.config.ts`, root `package.json`, CI, and the pool patch under `patches/`.
- Any `expect.poll`/`vi.waitFor` timeout, and `pi-durable-host.test.ts` (F2 is reported only).
- `pi-durable-command.fixture.ts` and `pi-durable-candidate.fixture.ts` (recorded only).

## Git workflow

- Work on the branch you are given, based on `2f79ab0`. If your worktree's HEAD is not `2f79ab0`, which means it was created from `origin/master`, run `git status --short` (it must be empty), then `git checkout -B exec-028 2f79ab0`.
- Commit in conventional style, matching `git log`, for example `test(runtime): give checkpoint fixture explicit host budgets` and `docs(plans): add 028 load-failure evidence`. Add no co-author trailer. Do not push.

## Steps

### Step 1: Reproduce F1 and F2 alone under induced load

Run each file 5 times under induced load and save each log to `plans/evidence/artifacts/028/repro-<file>-<n>.log`:

- `src/pi-durable-checkpoints.test.ts`
- `src/pi-durable-restore.test.ts`
- `src/pi-durable-retention.test.ts`
- `src/pi-durable-host.test.ts -t "combines wall-clock yield"`

Also run each one twice with no load.

**Verify**: write a table in the evidence file with file, load or no load, pass/fail, and the failing message. Expected: failures appear only under load. If F1 does not reproduce under load in 5 runs, raise the load to 8 loops once. If it still does not reproduce, continue anyway and say so.

### Step 2: List which host fixtures inherit the 1 s budget

Run `grep -n "budgets" apps/runtime/src/*.ts` and `grep -ln "PiDurableHost.open" apps/runtime/src/*.ts`. For every file that opens a host, record whether its clock is frozen (`now: () => control.now` or a captured `now`) or real (`Date.now`), and whether it sets `budgets`.

**Verify**: the evidence file has the table. At least `pi-durable-checkpoint.fixture.ts`, `pi-durable-command.fixture.ts` and `pi-durable-candidate.fixture.ts` appear as "frozen clock, no budgets".

### Step 3: Prove or disprove H-F1 with an A/B under load

Make a temporary, uncommitted edit that logs from the host timer:

```ts
// TEMP 028
console.log("[028-yield-timer]", this.active?.id)
```

Put it in the test file only, not the host. One way is to wrap `host.yield` inside the checkpoint fixture's `open()` so it logs when it is called outside the test's own `finally`. The simplest acceptable alternative is to have `complete()` log the `host_invocations` rows (`SELECT state FROM host_invocations`) when the poll's `reconcile` throws.

Then run an A/B with `src/pi-durable-checkpoints.test.ts`, `src/pi-durable-restore.test.ts` and `src/pi-durable-retention.test.ts` together, under induced load, 5 runs per arm:

- **A**: unchanged fixture.
- **B**: add `budgets: { workMs: 10_000, drainMs: 1000 },` to the checkpoint fixture's `dependencies` (the Step 5 line).

**Verify**: H-F1 holds only if both of these are true:
- every A-arm failure shows `Session is closed`, and the diagnostic shows the invocation was yielded or draining before the test's own `finally`;
- the B arm has 0 failures in 5 runs.

Record both arms. If A fails and B also fails, H-F1 is wrong: STOP. If A never fails, H-F1 is unproven: STOP.

### Step 4: Check that B does not change what the tests test

Under arm B, the tests that move `control.now` past an invocation's `yield_at`/`end_at` must still do so. Run:

```sh
grep -n "control.now\s*[+=]" apps/runtime/src/pi-durable-checkpoints.test.ts apps/runtime/src/pi-durable-restore.test.ts apps/runtime/src/pi-durable-retention.test.ts apps/runtime/src/pi-durable-lifecycle.test.ts apps/runtime/src/pi-durable-workspace-actions.test.ts apps/runtime/src/pi-durable-checkpoint.fixture.ts
```

For each hit that advances time, check that the advance is larger than 11 000 ms (the B-arm `workMs + drainMs`), or that the test does not depend on passing the invocation deadline.

Then run all five checkpoint-fixture files with no load, with B applied: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-checkpoints.test.ts src/pi-durable-restore.test.ts src/pi-durable-retention.test.ts src/pi-durable-lifecycle.test.ts src/pi-durable-workspace-actions.test.ts --reporter=verbose`.

**Verify**: all pass. Also confirm no test silently became a no-op: the per-file test counts must match arm A's counts. If a test advanced time to pass the old 2 s window and now asserts something different or passes vacuously, STOP and report which one.

### Step 5: Apply the fixture fix

Revert every TEMP 028 diagnostic. Keep only this line in `pi-durable-checkpoint.fixture.ts`, inside `const dependencies: HostFixtureDependencies = {`, right after `now: () => control.now,`:

```ts
budgets: { workMs: 10_000, drainMs: 1000 },
```

Add no comment. The sibling fixtures don't carry one either.

**Verify**:
- `git diff --stat` → 1 file, 1 insertion.
- `grep -rn "TEMP 028" apps/runtime` → no output.
- `pnpm --filter @ditto/runtime typecheck` → exit 0.
- `pnpm check` → exit 0.
- Commit.

### Step 6: Classify F2 without fixing it

Using the Step 1 F2 logs, add a temporary log of `host_invocations` (`started`, `yield_at`, `end_at`, `state`) next to `Date.now()` at the moment the poll at `pi-durable-host.test.ts:1565` gives up. Run it 5 times under load. Revert the log.

**Verify**: the evidence file states one of the following.
- **(a)** In every failure, close finished after `end_at`. The host's `'failed'` is correct, so the test asserts a real-time property. Report options for the maintainer, and do not implement them: give that test explicit budgets, or move it out of the default suite. Both count as a deadline change, so they need the maintainer.
- **(b)** Close finished before `end_at`, but the state was still `'failed'`. That is a possible runtime race. STOP and report it with the rows.

### Step 7: Full-suite check under default parallelism

Do not add `singleWorker`. Run unmodified `pnpm runtime:verify` 5 times in a row, killing workerd between runs, and save the logs as `full-<n>.log`. Record each result, the run's duration, and the duration of "streams long document tails across root replacement deltas".

**Verify**: report the results honestly. This step does not require five passes, because F2 may still fail (it is out of scope) and the conformance case runs close to its 5 s deadline. For every failure, record the test name and message, and whether it is F1, F2 or new. A new failing test is not a STOP here. Report it.

Write `plans/evidence/028-runtime-load-failures.md` with the environment (`nproc`, OS), the tables from Steps 1 to 7, the H-F1 verdict, the F2 class, and any new failures. Commit it with the logs.

## Test plan

No new test file. The fix restores the intended isolation of existing tests from real-time budgets. The A/B under induced load in Step 3 is the regression evidence. The per-file test counts in Step 4 guard against tests becoming vacuous.

## Done criteria

- [ ] H-F1 is proven: the A arm fails with `Session is closed`, and the B arm has 0 failures in 5 loaded runs.
- [ ] The only source change is one `budgets` line in `apps/runtime/src/pi-durable-checkpoint.fixture.ts` (`git diff 2f79ab0 --stat -- apps` shows 1 file, +1).
- [ ] `pnpm --filter @ditto/runtime typecheck` and `pnpm check` exit 0.
- [ ] The five checkpoint-fixture files pass with no load, with unchanged test counts.
- [ ] The evidence file names F2's class, (a) or (b), with the invocation rows.
- [ ] The evidence file has 5 full `runtime:verify` results from Step 7.
- [ ] `grep -rn "TEMP 028" apps/runtime` prints nothing.

## STOP conditions

- The drift check prints a change to `pi-durable-host.ts` lines 140 to 150 or 6450 to 6510, or to the checkpoint fixture's `dependencies` block.
- Step 3: the B arm still fails, or the A arm never fails.
- Step 4: a test depended on the old 2 s invocation window.
- Step 6 lands on class (b).
- A fix would need anything in "Out of scope" or the Hard rule.

## Maintenance notes

- Any new host fixture with a frozen clock must set explicit `budgets`. Otherwise the host's real `setTimeout` closes the harness after 1 s of real time. `pi-durable-command.fixture.ts` and `pi-durable-candidate.fixture.ts` still rely on the defaults. Step 2 records them, and they are the next suspects if their tests start failing under load.
- Production `PiDurableProductSession` (`pi-durable-product-session.ts:228`) also uses the 1000/1000 defaults. This plan does not judge whether that is right.
- After this lands, plan 026 resumes from its Step 6 with default parallelism. Its unaccepted `singleWorker` edit should not be reused.
