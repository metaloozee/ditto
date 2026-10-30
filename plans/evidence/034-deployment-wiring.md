# 034 deployment wiring evidence

## Step 9: full gate (`pnpm verify`) - failed (pre-existing failure in one file)

The combined `pnpm verify` run exited 1 inside `credentials:verify`. Every other stage of the chain was then run on its own.

| Stage | Result |
|---|---|
| `pnpm check` | passed (exit 0) |
| `pnpm db:drift` | passed |
| `pnpm typecheck` | passed |
| `credentials:verify`, combined run | failed: `product-commands.worker.test.ts` hit the known isolated-storage error (timeout, then `.sqlite-shm` assertion), and `candidate-branch-fetch.worker.test.ts` failed one test |
| `codex-credential-do.worker.test.ts` alone | passed, 22 tests |
| `codex-request-contract.worker.test.ts` alone | passed, 142 tests |
| `product-commands.worker.test.ts` alone | passed, 100 tests (96 at baseline, +4 new) |
| `candidate-capacity.worker.test.ts` alone | passed, 6 tests |
| `candidate-baseline.worker.test.ts` alone | passed, 10 tests |
| `candidate-preview.worker.test.ts` alone | passed, 1 test |
| `candidate-branch-fetch.worker.test.ts` alone | failed, 1 of 9: `passes a valid request upstream with authorization and returns no token` expects `token <t>`, receives `Basic ...` |
| `node --test crash.test.mjs` | passed, 3 tests |
| `pnpm contracts:verify` | passed |
| `pnpm runtime:verify` | passed |
| `pnpm test` | passed twice (82 files, 960 tests). The gate chain stopped before reaching it, and one earlier standalone run exited 1 with its output discarded, so that failure has no recorded cause |
| `pnpm build` | passed |
| `pnpm runner:verify` | passed |

The `candidate-branch-fetch` failure is not caused by this plan. It fails identically with the working tree detached at base commit `5883d58`. The test asserts `authorization` is `token <t>`, while `apps/web/src/lib/git-fetch-contract.ts:678` produces `Basic base64(x-access-token:<t>)`. None of these files changed in this plan.

## Step 10: local smoke - not run

Maintainer-run. It needs the maintainer's `.env.local`, Docker and a browser sign-in. Sub-steps 10.1 (flag-off wrangler diff), 10.2 (flag-on graph) and 10.3 (preview host `curl` expecting 404) are all `not run`.
