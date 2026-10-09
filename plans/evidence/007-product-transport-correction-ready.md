# 007 synthetic product transport correction

Disposition: READY FOR REVIEW for the four advisor blockers only. This is executor verification, not independent acceptance. Full 007 is NOT DONE. Authenticated configuration intents, snapshots, payload-conflict idempotency and pre-conversation default validation remain the subsequent phase.

## Scope and preservation

Execution used the existing detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Main remained read-only. All 27 hashes in main `plans/evidence/artifacts/007/product-advisor-review/candidate-source.sha256` matched before edits. The unchanged reproduction commands then failed with exactly three runtime cases and two policy cases, with 56 explicitly filtered policy skips. Their new red outputs are `runtime-red.log` and `policy-red.log` in the correction artifact directory.

The original advisor archive, probes, configs and red logs were not edited. Every common advisor artifact in main and the worktree still matches byte-for-byte. `advisor-preservation.sha256` records 33 main/worktree identities. The original main candidate archive remains SHA-256 `7696b9dd92d2de73b56f243215f36c403c93a460661a123bcbbf510fb200aa11`.

The correction changes seven of the 27 candidate files:

- `apps/runtime/src/pi-durable-host.ts`
- `apps/runtime/src/pi-durable-models.ts`
- `apps/runtime/src/pi-durable-models.test.ts`
- `apps/web/src/lib/model-product-authority.ts`
- `apps/web/src/lib/codex-credential-do.ts`
- `apps/credential-tests/src/codex-request-contract.worker.test.ts`
- `docs/specs/pi-durable-session-runtime.md`

All other 20 candidate identities match the advisor baseline, including effects, summary, preparation, encryption helpers, schema/migration, contracts, entrypoints, configs and suite-registration script. Six dependency graph identities match HEAD. No new dependency, install, delegation, credential inspection, auth repair, live provider/account request, deployment, shared database mutation, legacy bypass, UI, staging, commit, push or integration occurred. The inherited brain freshness fixture still performs its existing disposable offline consumer-copy checks; no dependency repair was added.

Artifacts are under `plans/evidence/artifacts/007/product-correction/`. `correction-only.patch` compares actual bytes with the advisor archive, including untracked source files. `source.sha256` and `source.tar.gz` cover the complete corrected 27-file candidate. Archive SHA-256 is `5a6ae89b8dd948b89b516ac073dc8dfba4fa052ce8a08281c0c378709127a436`. `changed-files.json`, `graph.sha256`, `race-snapshots.json`, command logs and `counts.json` provide the detailed handoff. No HOME, environment file or dependencies are archived.

## Corrections and admission ordering

### Current host authority after the held product callback

The claim still irreversibly consumes its live latch, validates the exact Pi task, seals the consumed receipt in the existing admitted effect and joins the durability flush. It now awaits the bound exact product check before obtaining the final host authority. Immediately after that host read, it checks cancellation, the protected consumed receipt and the existing synchronous epoch/Stop/fence/uncertainty/deadline predicates. Nothing is awaited between the final host check and acknowledgment. No provider/configuration/public-command lane was added.

Merely reversing two awaits would expose product policy to a hold in the final host-authority read. The credential DO therefore performs another exact product permit query after the host acknowledgment and before fetch. That query checks the same reserved window, effect and request digest with current policy and current expiry. After it returns, cancellation and local credential revision are checked synchronously before reconstructed fetch. A permanent actual-host/D1 case holds the final host-authority return, revokes the D1 capability revision, releases the hold and proves zero fetches with one consumed host claim and one spent product allowance.

This is a bounded ordered admission protocol, not distributed atomicity. The host acknowledgment remains the local irrevocable admission point. Stop winning before it denies fetch. Stop after it cannot undo the admitted effect; the unchanged winning-order tests still retain the original start and late evidence. Product policy may conservatively deny after host acknowledgment. That denial never refunds or recreates the host claim. The additional product query is necessary to avoid moving the stale snapshot to the other authority domain.

Six permanent callback races cover `current=false`, executor/capacity change and invocation-generation change in both plaintext and retained encrypted hosts. Each rejects acknowledgment and retains `claimed=1`, receipt state `consumed`, effect state `admitted`, zero provider starts and denial on a repeated claim. The original flush/Stop/close/reopen/uncertainty cases remain intact.

### Separate generation domains

Product policy no longer compares host attempt generation with the D1 execution-identity lifecycle generation. Exact D1 lifecycle, incarnation, role, controller, ownership and retirement predicates remain unchanged. Host claim generation is still checked against the current host invocation by the host's final dispatch permit.

The permanent transport case creates invocation generation 1, forces the existing before-submission interruption seam, joins actual host yield/close, reopens under generation 2 and sends a real guarded request through private Worker RPC, credential DO and D1. The invocation rows are generation 1 `closed` and generation 2 `active`; the actual D1 identity remains lifecycle 1. One credential-bearing mocked request completes, one claim is consumed and the run completes. This is not only a descriptor-variable test. The unchanged advisor generation-2/lifecycle-1 policy case also passes.

### Current time across actual awaited D1 queries

`facts` no longer exports a pre-await clock sample as authorization. Time-bearing parameters are evaluated at SQL binding, including the command and host-effect deadline predicates. `current`, final window lookup and `permit` return actual command/window deadline values and compare them against the current clock after the query completes. Successful reservation batches also require a fresh permit before returning a usable reservation. All conditional insertion, allowance, exact snapshot/lifecycle predicates and transactional increment behavior remain; no consumption is refunded.

Four permanent actual-D1 cases hold either the real capability read or final permit query and expire either command or window while the host effect deadline remains valid. The controlled policy clock advances beyond product expiry during the hold. Every case observes zero credential-bearing fetches, one spent allowance and one consumed host claim. The unchanged advisor reserve-at-100, expiry-150, clock-200-during-read case passes.

A reservation committed before its acknowledgment may remain `reserved` if cancellation or a post-commit permit failure prevents acknowledgment. It remains conservatively blocking and requires reconciliation. This correction adds no scheduler, refund or automatic evidence release and makes no claim that cancellation cancels an underlying SQL promise.

### Prepared response identity on known failures

The adapter preserves the actual prepared model/provider on `failed_known` and on its terminal error/abort responses. Result validation is unchanged. It advertises an explicitly synthetic supported `faux-2` record derived from the pinned faux fixture, since the pinned catalogue supplies only `faux-1`. This is not live account discovery or entitlement.

The inherited host-backed generation retry and summary-failure tests now run for both faux models, preserving every original assertion. A faux-2 known generation failure records a separate second admitted attempt, both request bodies select faux-2 and both host effects are Pi-committed. A faux-2 known summary failure spends exactly one summary attempt, settles the run as failed and leaves no admitted model effect. The actual registered adapter identity probe passes unchanged. Two focused registered-adapter terminal error/abort tests additionally verify faux-2 identity; those two tests use a narrow denial guard, not D1 authorization evidence.

## Verification

All commands ran from the worktree with `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. The aggregate gates ran sequentially in the required order: contracts, brain, credentials, runtime, repository. Each exited zero. Repository verification had its own 600-second shell allowance; no test deadline or observation budget changed. No zero-test result counts as a pass.

| Command | Result |
| --- | --- |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/007/product-advisor-review/post-product-check.config.ts` | 3 passed, previously 3 failed |
| `pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/007/product-advisor-review/generation-domain.config.ts -t 'advisor:'` | 2 passed, 64 explicitly filtered skips, previously 2 failed |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/007/advisor-model-claim.config.ts` | 4 unchanged host cases passed |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts -t 'configuration authority wait joins close by admitted deadline'` | 4 unchanged configuration-close cases passed, 114 filtered skips |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts src/pi-durable-effects.test.ts src/pi-durable-summary.test.ts src/pi-durable-model-preparation.gate.test.ts` | 232 passed: models 50, effects 62, summary 118, preparation 2 |
| `pnpm --filter @ditto/credential-tests exec vitest run src/codex-credential-do.worker.test.ts src/codex-request-contract.worker.test.ts` | 86 passed: credential 22, requests 64 |
| `pnpm --filter @ditto/web exec vitest run src/lib/agent-models.test.ts src/lib/codex-request-contract.test.ts src/lib/codex-connection.test.ts` | 45 passed |
| `pnpm contracts:verify` | typecheck, 16 tests and build passed |
| `pnpm brain:verify` | contracts 16; freshness feasibility 3 passed, 3 filtered skips; brain 43; typecheck/build passed |
| `pnpm credentials:verify` | typecheck, 86 Worker tests and 3 Node checks passed |
| `pnpm runtime:verify` | typechecks, 387 Worker tests and 6 Node checks passed |
| `pnpm verify` | Biome/typechecks/builds, 86 credential Worker and 3 Node checks, 848 web tests, 79 runner tests passed |
| `git diff --check`; `git diff --cached --stat` | whitespace clean; staging empty |

The first extended nearest runtime run passed 231 and failed one new abort-seam assertion. An already-aborted call was classified by the outer pinned Models wrapper before entering the adapter. The test now aborts inside the denial guard after adapter entry, exercising the intended terminal adapter branch rather than asserting behavior of the outer auth wrapper. Its final rerun passes all 232 cases. The initial failure remains in `runtime-nearest-initial.log`; original advisor reds remain immutable.

## Limits and next phase

Pinned Pi/provider behavior and Vitest 3.2.7 remain unchanged. Installed workerd retains the requested-date fallback from 2026-09-16 to 2026-03-10. Public Cloudflare SQLite storage documentation was consulted read-only; actual local Worker/D1/SQLite tests establish these corrections, not hosted deployment authority.

Request/response bounds remain 131072 encoded bytes, transcript 98304 bytes, 128 frames, 16384 bytes per frame and 65536 output bytes. Original finite cancellation, one-attempt summaries, successful result reuse, configuration/preparation ordering, encryption and bounded joined close remain covered by unchanged suites. Tests use only disposable synthetic records and mocked fixed `.invalid` outbound requests with external networking disabled.

Independent review of the actual correction diff, current hashes and race snapshots remains required. Authenticated configuration, live discovery/transport, retained workspace activation, hosted checks and PD38 are not completed or enabled. PD38 is not run. Nothing here authorizes integration, commit or deployment.
