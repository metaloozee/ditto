# 030 evidence: seed and branch handoff for candidate sessions

Base commit `aaf7563` (worktree, uncommitted changes). Drift check `git diff --stat f025d17..HEAD` over the listed paths was empty. Toolchain: node v24.22.1, pnpm 11.8.0, web vitest 4.1.10, runtime and credential vitest 3.2.7. Dependencies installed inside the worktree (`pnpm install --frozen-lockfile`, `npm ci --prefix packages/sandbox-runner`).

## Generated migration

`pnpm db:generate` ran once. It wrote `apps/web/migrations/0028_curvy_vertigo.sql`, `apps/web/migrations/meta/0028_snapshot.json` and one `_journal.json` entry. Full SQL:

```sql
ALTER TABLE `archives` ADD `extractedBytes` integer;
```

No generated file was edited. `pnpm db:drift` prints `no drift`.

## Changes

- `schema.ts`: nullable `archives.extractedBytes`; `createArchiveBody` stores `cli.extractedBytes` in its `ready` update; `sandbox-archive.test.ts` asserts the stored value (12).
- `session-command-candidate.ts`: the fresh-session INSERT binds `branchName` to `ditto/<sessionId>`; `product-commands.worker.test.ts` asserts it.
- `candidate-baseline.ts` (new): `readCandidateBaselineSource`, with the denial order from the plan.
- `candidate-branch-fetch.ts`: `currentAuthority` exported; `candidateGitHubDeps` added.
- `CandidatePrivateProduct.readCandidateBaselineSource`, `loadExecutionSource`/`startBaseline` hooks, `PiDurableExecutionSession` source and baseline start, `CheckpointRestorer.establishBaseline`, `PiDurableHost.establishCandidateBaseline`.
- `CandidateFixtureProduct.readCandidateBaselineSource` delegates to the new module; `credentials:verify` lists `candidate-baseline.worker.test.ts`.

## Checks

| Check | Result |
| --- | --- |
| `pnpm db:drift` | passed (`no drift`) |
| `pnpm typecheck`, runtime typecheck, credential-tests typecheck | passed |
| `pnpm check` | passed (exit 0; warnings only, 5 format/import-order errors in new or edited files fixed with `biome check --write` on those files only) |
| `pnpm runtime:verify` (24 files, 523 tests) | passed |
| `pnpm runner:verify` (15 files, 138 tests) | passed |
| Web: `sandbox-archive`, `candidate-branch-fetch`, `project-seed` (26 tests) | passed |
| Runtime: execution, checkpoints, restore, workspace-actions (57 tests) | passed |
| `candidate-baseline.worker.test.ts` (10 tests) with `candidate-branch-fetch.worker.test.ts` (9) | passed |
| `crash.test.mjs` (3 tests) | passed |
| `product-commands.worker.test.ts` | flaky, see below |
| Combined `pnpm credentials:verify` | failed: 5 of 6 files passed (235 tests); `product-commands` had 2 failures plus "Isolated storage failed" |
| Files that must stay unchanged (`alchemy.run.ts`, `runtime-contracts`, authority/egress/privileged-git); earlier migrations `0000`-`0027` | unchanged (empty diff) |
| Docker, hosted, provider, browser | not run |

### product-commands flake

Run alone, the file passed 96/96 once (right after Step 2, which includes the new `branchName` assertion). Later runs failed on different, unrelated tests each time: 4 failures when another vitest suite ran concurrently (5000 ms matcher timeouts, for example "disposes a prompt whose selection is no longer entitled"), and 1 failure on a serial rerun ("settles final-hold preparation false...", `Test timed out in 5000ms`). No deadline was raised, no test skipped or retried. The failures are default-timeout expirations on WSL, consistent with the known "Isolated storage failed" flake; no failure involved `branchName`.

## Guarantees and limits

- `readCandidateBaselineSource` returns a strictly parsed `ArchiveArtifactV1` for a ready, measured project seed and one of seven denials otherwise; the worker test asserts the seed's `compatibilityKey` is `ARCHIVE_COMPATIBILITY_KEY` (not the build key) and that the result holds no installation id or token text.
- `candidateGitHubDeps` mints only after resolving the installation by scope project, user and repository; a mismatch or null installation throws before any mint (web vitest, fake D1).
- Host method: first call `published` and queued work then dispatches one tool; second call `deferred`/`baseline_exists` with no further sandbox command; after `yield` it returns `deferred`/`unavailable` with no sandbox command and no stream write.
- No test runs `PiDurableExecutionSession`; its hooks are covered by typecheck and the host-method test.
- `startBaseline` runs on every activation, including when `open` reuses a live host, so a failed baseline retries on the next command, observe or alarm. The publisher defers with `baseline_exists` once a baseline exists, and an in-flight attempt is not duplicated.
- Deployment wiring (production `CandidatePrivateProduct`, bindings, shared bucket) is not done.
