# 029 evidence: brokered branch fetch for candidate sessions

Base commit `5a5b012` (detached worktree, uncommitted changes). Drift check over the listed paths was empty.

## Step 1: seams

- (a) `setOutboundHandler(methodName, params)`, static `outboundHandlers`, `enableInternet` and `interceptHttps` are declared on `Container` in `@cloudflare/containers@0.3.7` (`dist/lib/container.d.ts`), which `@cloudflare/sandbox@0.12.3` extends. The sandbox `.d.ts` itself only mentions the registry in a comment. True.
- (b) `projects.githubRepo` and `projects.githubInstallationId` exist (`schema.ts:120-121`).
- (c) `prepareCandidateRuntimeAuthority` selects `identityId`, `incarnationId`, `lifecycleGeneration`, `controllerNamespace`.
- (d) `apps/credential-tests/vitest.config.ts` binds D1 `DB`; the tests apply every migration under `apps/web/migrations`.
- `pnpm typecheck` exited 0 before changes. No migration was needed.

## Checks

| Check | Result |
| --- | --- |
| `npm test --prefix packages/sandbox-runner -- workspace-git.test.ts` (19 tests) | passed |
| `pnpm runner:verify` | passed |
| Runtime vitest: execution, artifacts, checkpoints, restore (62 tests) | passed |
| `pnpm runtime:verify` (24 files, 521 tests) | passed |
| `pnpm --filter @ditto/credential-tests typecheck` | passed |
| `candidate-branch-fetch.worker.test.ts` (9 tests) | passed |
| Other credential worker files, each run alone, and `crash.test.mjs` | passed |
| Combined `pnpm credentials:verify` | failed: known "Isolated storage failed" flake (`.sqlite-shm` assertion in `product-commands`); each part passes alone |
| `pnpm typecheck`, `pnpm check` (warnings only) | passed |
| `sh plans/evidence/artifacts/029/docker-fetch.sh ditto-sandbox:029` | passed (`--network none`) |
| `sh plans/evidence/artifacts/025/docker-workspace.sh ditto-sandbox:029` | passed |
| Hosted, provider, browser | not run |

Docker cases printed `invalid_args` (bad slug, ref outside heads), `dirty_worktree`, and `git_failed` within 1 s with HEAD unchanged.

## What the tests show

- Open binds repository and `allowedRefs` to the owned branch, else the default branch; denies foreign, legacy, retired, malformed-branch and concurrent opens.
- The broker sends `Authorization` upstream only, returns no token, refuses receive-pack, another repository, a ref outside the window, a second container, an exhausted budget, an expired window and a closed window, each without an upstream call or token mint. A 302 is not followed.
- The composed `establishBaseline` publishes with a fake branch authority: `setOutboundHandler("candidateGit", scope)` runs before the fetch command, the window closes when the fetch fails, and a denied open runs no fetch.

## Limits and deviations

- No test reaches real GitHub or real container interception. `setOutboundHandler` routing and the CA path are proved by types and Docker refusals only.
- `apps/credential-tests/tsconfig.json` gained `paths` for `#/*` because the reused `git-fetch-contract.ts` imports `#/lib/git-pkt-line`.
- Request shape `fetchBranch` also carries `branch` (owned branch for the checkout).
- The window opener also closes expired open windows for the identity so an abandoned window cannot block later opens.
- `mintToken(repository)` and `github` are injected as planned; production wiring (installation id lookup, Worker bindings) is not part of this plan.
