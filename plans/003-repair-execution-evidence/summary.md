# 003 repair execution evidence

Worktree: `/home/ayan/ditto-worktrees/plan-003-grok` detached at `d18bf57`.
Source left unstaged/uncommitted. No push, deploy, or shared DB work.

## Gates

| Command | Exit | Result |
|---|---|---|
| `pnpm --filter @ditto/web exec vitest run` eight focused files | 0 | 8 files / 113 tests |
| `pnpm --filter @ditto/runtime-contracts exec vitest run src/contracts.test.ts` | 0 | 14 tests |
| `pnpm check` | 0 | pass |
| `pnpm typecheck` | 0 | pass |
| `pnpm verify` | 0 | check, web typecheck, 70 web files / 751 tests, web build, runner typecheck, 79 runner tests, runner build |
| `pnpm runtime:verify` | 0 | 20 tests |
| `pnpm brain:verify` | 0 | contracts freshness + 43 brain tests |
| `git diff --check` | 0 | pass |

Logs: `narrow-final.log`, `contracts-pass.log`, `check-2.log`, `typecheck-2.log`, `verify.log`, `runtime-verify.log`, `brain-verify.log`, `advisor-probes.log`.

## Advisor probes

`node plans/003-review-probes.cjs` against this worktree: first six route checks PASS, then crash EXIT 2 (`database is not open`) because `asUser()` now uses captured POST handlers and the probe's `createDb` override still points at a closed `currentFixture`.

Needed probe adaptations (script not edited):
1. Keep `currentFixture` assigned to the live fixture before `asUser()` / close only after that fixture is done.
2. Logical 4.9s×5 budget probe: delivery starts remaining-bounded calls (`min(5s, remaining)`). A leftover 400ms remaining still starts a call; a logical transport that ignores timeout can overshoot 20s.
3. Successful handoff now stores `deliveryState=delivered` and leaves the ordinary backlog.

## Retained deviation

`session-command.ts` still imports `@ditto/runtime-contracts` via the source-relative `packages/runtime-contracts/src/*.js` path. Package/lockfile changes were out of scope.
