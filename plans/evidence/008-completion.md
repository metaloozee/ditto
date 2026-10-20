# 008 completion and acceptance

Disposition: DONE for the accepted disposable local fixture scope. Integrated into `feat/pi-durable` at `e9e3684` (candidate source) and `12fb71a` (test-pool patch). This record supersedes the BLOCKED checkpoints, which remain as history.

## What unblocked the product suite

The full product suite failed with a queued-configuration 5000 ms timeout, slower later tests and an isolated-storage teardown failure. The cause was in test tooling, not the candidate. `@cloudflare/vitest-pool-workers` 0.12.21 wraps each Durable Object and `WorkerEntrypoint` prototype in a new Proxy inside the constructor (`createProxyPrototypeClass` in `dist/worker/lib/cloudflare/test-internal.mjs`). Every service-binding RPC instantiation added one Proxy layer, so prototype lookups grew with the number of instances. A CPU profile attributed about 75% of workerd runner CPU to that Proxy `get` trap. The teardown error only followed the timeout, because the killed test left DO and D1 work in flight.

`patches/@cloudflare__vitest-pool-workers@0.12.21.patch` wraps the prototype once per class and keeps per-instance `receiver` lookup unchanged. It is registered through `patchedDependencies` in `pnpm-workspace.yaml`. No test, deadline or candidate behavior changed. `12fb71a` also moved `CANDIDATE_FIXTURE_RESET_SCHEMA` into `apps/credential-tests/src/candidate-fixture-schema.ts`, because workerd rejects non-handler exports from a Worker main module (`crash.test.mjs`).

The `e9e3684` candidate is the 37-file source from `plans/evidence/artifacts/008/command-read-batch-advisor/final-source.tar`, restored byte for byte over `2487d56`.

## Aggregate gates on `12fb71a`

Run sequentially on 2026-10-20 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0, frozen lockfile install. No deadline was raised and no test was filtered.

| Gate | Result | Counts |
|---|---|---|
| `pnpm contracts:verify` | passed | 49 tests |
| `pnpm brain:verify` | passed | contracts 49, brain 3 passed plus 3 skipped, 43 recovery tests |
| `pnpm credentials:verify` | passed | 226 Worker tests including all 62 product-command cases, plus Node crash test |
| `pnpm runtime:verify` | passed | 401 Worker tests plus Node checks |
| `pnpm verify` | passed | Biome check, typecheck, credentials 226, web 861, build, runner 79 |
| `git diff --check` | passed | |
| GitHub Actions `verify` on push | passed | run 39464658523 |

Environment notes, not product changes:

- `brain:verify` needs npm 12.0.2 exactly (`pi-feasibility.test.ts`) and spawns the hard-coded launcher `/home/ayan/.vite-plus/bin/node` (`pi-recovery.test.ts:29`). The container provided both.
- The offline `contracts-consumer-freshness` case needs npm's full-metadata cache entry for Vitest. One online `npm install --ignore-scripts` of a scratch copy of `packages/runtime-contracts` populated it. The test was not changed.

## Independent review

A separate reviewer checked the done criteria against the actual code and tests and returned ACCEPT WITH LIMITS. Every step-4 matrix row and step-3 assertion maps to a named test in `product-commands.worker.test.ts`, `pi-durable-commands.test.ts`, the web suites or `product-command.test.ts`. The product suite admits all commands through product policy and does not seed `session_commands` or `runtime_command_memberships`. No brain identity, second scheduler, private Pi API or implicit owner migration was found. Default composition stays unavailable: without `PI_DURABLE_PRODUCT_COMMANDS`, admission returns `candidate_admission_ineligible`.

Recorded limits:

1. The recovery-deadline assertion is covered only by host-level tests in `pi-durable-effects.test.ts`, which use synthetic membership through the same `exactAuthority` check. There is no candidate-level test.
2. Capacity saturation is proven through the single lifetime workspace claim. No test holds the slot from a different session while Stop arrives. This matches the PD32 fixture bound.
3. Archived projects and unsupported thinking are denied structurally (ready-status predicate; V2 bodies cannot carry `thinkingLevel`), not by dedicated tests.
4. `12fb71a` also changed `pnpm-lock.yaml` beyond the patch hash: it adds the missing `apps/credential-tests` importer block and re-resolves the esbuild peer of web build tooling from 0.28.1 to 0.28.2. Runtime dependencies are unchanged.

## Coverage claims and limits

PD01 to PD06, PD33: passed through product admission and real Worker integration. PD07 to PD10: passed for local restart and wakeups only. PD11: command and follow-up mapping only; coding tools are 009. PD16: local fencing and pending projection intent; D1 settlement is 010. PD32: single-workspace bound only. PD42: synthetic capabilities only. PD38, PD39, Docker coding-tool parity, observations, L3 completion, retained activation, UI and hosted checks: not run.
