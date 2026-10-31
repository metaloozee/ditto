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

## Step 10: local smoke - passed

Run by the reviewer on 2026-10-31 in the executor worktree, with a copy of the maintainer's `.env.local`, Docker Desktop 29.6.2 via WSL integration, and fresh worktree-local `.alchemy` state. Stage `ayan`, local only; nothing was deployed. No browser sign-in was needed for these sub-steps.

| Sub-step | Result |
|---|---|
| 10.1 flag off unchanged | passed. `pnpm dev` on base `5883d58`, then on `d1cec9b` with `DITTO_CANDIDATE_RUNTIME` unset: `diff` of the two `apps/web/.alchemy/local/wrangler.jsonc` files prints nothing; `grep -c CandidateSessions` is `0`; `/` returns 200 on both. Worker name `ditto-website-ayan` matches `websiteName`. |
| 10.2 flag on | passed. With `DITTO_CANDIDATE_RUNTIME=1`, a throwaway `CANDIDATE_RUNTIME_KEYS` and `CANDIDATE_PREVIEW_HOST=localhost:5173`, Alchemy created `candidate-sandbox` (image built from the root `Dockerfile`) and `candidate-runtime`, then updated `website`. `wrangler.jsonc` has `CandidateSessions` with `script_name: "ditto-candidate-runtime-ayan"` and `CANDIDATE_PREVIEW` → service `ditto-candidate-runtime-ayan`, entrypoint `CandidatePreview`. `/` returns 200. |
| 10.3 preview hop | passed. `curl -H "Host: 10000-c-00000000-0000-4000-8000-000000000000-abc.localhost:5173" http://localhost:5173/` → `404 Not Found`. Both the product (unbound branch) and the runtime return that same body, so the evidence it crossed the binding is that a `ditto-candidate-runtime-ayan-PiDurableExecutionSession/*.sqlite` store appeared after the request: `CandidatePreview` called `previewAdmit` on a cold session, which refused. |

Observation: in local dev Alchemy also serves the runtime Worker on `http://localhost:1337/` despite `url: false`. Its default export answers `404 Not Found`. This is local only; a hosted plan should confirm `url: false` leaves no public route.
