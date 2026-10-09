# 007 remaining fixture executor preflight

Verdict: BLOCKED. This execution did not implement the remaining fixture contracts, product admission, mandatory provider adapter or authenticated configuration intents. Existing passing tests do not establish those missing guarantees. Full 007 remains incomplete and requires independent advisor review.

## Workspace and preservation

All commands ran in the existing detached `/home/ayan/ditto-execution/plan-007-recovery`. HEAD is `0ccc5b20c25a4e63017b3eebf6608dba62253479`. `PI_MODEL` reported `gpt-6.1-sol` and `PI_REASONING_LEVEL` reported `medium`. No fallback or delegation occurred.

Before any writes, all seven accepted hashes matched `/home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-final-review/source.sha256`. They matched again after verification. Staging was empty before and after verification. No source, spec, package manifest, dependency graph or existing evidence was changed. New files are this report and the logs in `plans/evidence/artifacts/007/remaining-boundary-preflight/`.

Read the full concrete handoff, full plan, accepted final prerequisite review, full worktree runtime spec, Cloudflare and Durable Objects skills, and the relevant product, credential and host boundaries. Main was read-only.

## Concrete verification blocker

The required `pnpm brain:verify` exits 1. Its nested contracts gate passes 14 tests and builds. The next command, `npm run contracts:check --prefix packages/session-brain`, fails before running its test:

```text
npm notice run vitest run src/pi-feasibility.test.ts -t contracts-consumer-freshness
sh: 1: vitest: not found
```

See `artifacts/007/remaining-boundary-preflight/brain-verify.log:16-18`. The read-only checks `test -d packages/session-brain/node_modules` and `test -x packages/session-brain/node_modules/.bin/vitest` both exit 1. This is an absent independent package dependency tree, not a failing runtime assertion. No install, dependency repair, dependency upgrade or PATH workaround was attempted. The supplied continuation prohibits installs. A separate decision about supplying the existing pinned session-brain dependencies is needed to make this required aggregate gate runnable.

Other aggregate commands were run sequentially to distinguish this blocker from the existing candidate's test state. Their green results do not replace brain verification or the unimplemented model suites.

## Admission ownership and race analysis

The required ownership remains unchanged:

- `apps/runtime/src/pi-durable-host.ts:1771-1980` owns exact runtime correlation, current run epoch, admission reservation and final local dispatch checks. The host's `admitExact` commits an exact admitted effect before its durability barrier; `dispatchPermit` checks current local authority before calling the deferred provider start. These are synthetic local host guarantees, not product request authorization.
- `apps/web/src/lib/session-runtime-product.ts` exposes reconstruction and current-authority reads but no model-request admission RPC. `session-runtime-authority.ts` returns D1 facts and a maximum lifecycle generation. It supplies neither an identity-specific request admission nor current host epoch authority.
- `apps/web/src/lib/codex-credential-do.ts:80-87` checks current connection ownership/generation/revocation. It does not establish workspace operation authority. Credential state authentication, revision checks and renewal behavior remain unchanged.
- `apps/web/src/lib/sandbox-authority.ts:214-218,268-275,534-538` explicitly limits legacy windows and denies trusted-brain windows. No legacy bypass was added.

The missing interleaving must still be proved by implementation, not inferred from these passing tests. A provider start that suspends on a fresh product check can overlap Stop after the host's last local dispatch check. A supplied epoch equal to an operation row remains unchanged while the host advances its current run epoch. Connection validity cannot close this gap. Conversely, a product callback that waits on the same provider/configuration lane held by its caller can deadlock. The implementation needs an exact attempt association and a bounded independent host-owned local transition, cooperating with product-owned fresh checks and credential attachment. No such transition or end-to-end admission linearization point was implemented in this execution. This is an unfinished engineering boundary, not evidence that the selected architecture is impossible.

No mock boolean, legacy row or supplied epoch was accepted as proof. No credential-bearing model request path was enabled. Production request/discovery remain unavailable.

## Commands and actual results

All pnpm commands used exactly this prefix from the execution worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

Actual order was the nearest existing runtime suites, the five sequential aggregate gates, then the four exact handoff narrow filters. Logs retain the real output. No zero-test invocation is counted as a pass.

| Command after the prefix | Exit | Actual coverage |
|---|---:|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts src/pi-durable-summary.test.ts src/pi-durable-model-preparation.gate.test.ts` | 0 | 182 existing tests across 3 files: effects 62, summary 118, preparation 2 |
| `pnpm contracts:verify` | 0 | typecheck, 14 tests, build |
| `pnpm brain:verify` | 1 | nested contracts passes 14; brain contracts freshness cannot start because vitest is missing; later brain gates not run |
| `pnpm credentials:verify` | 0 | typecheck, 22 existing Worker tests, 3 Node crash/RPC checks |
| `pnpm runtime:verify` | 0 | runtime/forbidden-binding typechecks, 6 Node checks, 337 Worker tests across 11 files |
| `pnpm verify` | 0 | Biome, web and credential typechecks, 22 credential Worker tests plus 3 Node checks, 815 web tests across 73 files, web build, runner typecheck, 79 runner tests across 11 files, runner build |
| `pnpm --filter @ditto/web exec vitest run src/lib/agent-models.test.ts` | 0 | 5 existing tests |
| `pnpm --filter @ditto/web exec vitest run src/lib/codex-request-contract.test.ts src/lib/codex-connection.test.ts` | 0 | only 7 existing connection tests; request-contract suite is absent and unverified |
| `pnpm --filter @ditto/credential-tests exec vitest run src/codex-credential-do.worker.test.ts src/codex-request-contract.worker.test.ts` | 0 | only 22 existing credential tests; request Worker suite is absent and unverified |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-models.test.ts src/pi-durable-effects.test.ts src/pi-durable-summary.test.ts src/pi-durable-model-preparation.gate.test.ts` | 0 | only 182 existing tests across 3 files; models suite is absent and unverified |

`git diff --check` exits 0. `git diff --cached --stat` is empty. Both accepted-hash checks report all seven files OK. These preservation checks were repeated after test execution.

The installed workerd reports the previously known fallback from requested `2026-09-16` to supported `2026-03-10`. This verification is disposable local Worker/SQLite and synthetic fixture evidence only.

## Remaining work and restrictions

All five handoff implementation steps remain unfinished, starting with product-owned exact admission and the host-owned exact attempt boundary. No new contract, operation persistence, authenticated configuration intent or provider transport is available for review. No new suites were registered. Existing summary guarantees remain preserved but do not complete model transport or product admission.

PD38 is not run. Live authentication, discovery, account entitlement, request transport, hosted deployment/eviction and billing behavior remain unverified and unavailable. No live request, credential inspection, auth repair, installation, deployment, shared-data mutation, integration, stage, commit, push or worktree deletion occurred. This report is not acceptance.
