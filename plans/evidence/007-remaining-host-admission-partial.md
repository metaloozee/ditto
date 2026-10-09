# 007 partial host admission execution

Verdict: BLOCKED on unfinished implementation. The cache and baseline environment blockers are resolved. This execution produced a host-side exact-attempt candidate, not the complete remaining fixture implementation. There is no finding that the required ownership architecture is impossible. Full 007 requires more implementation and independent advisor review.

## Workspace and preservation

Used only existing detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Actual settings were `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-6.1-sol`, `PI_REASONING_LEVEL=medium`. No model fallback or delegation occurred. Main was read-only.

Before edits, all seven accepted hashes matched the maintainer's `source.sha256`. The full handoff, plan, accepted review, authoritative worktree spec, local instructions, domain context, actual freshness fixture, prior brain failure logs and Cloudflare/DO skills were read. The Cloudflare SQLite storage API was retrieved. No credentials were inspected.

New or changed source in this execution, relative to the accepted candidate:

- `packages/runtime-contracts/src/model.ts`: new bounded strict V1 attempt association, separate from persisted command V1.
- `packages/runtime-contracts/src/model.test.ts`: new duplicate/unknown/schema/bounds tests.
- `packages/runtime-contracts/src/index.ts`: exports the new contract.
- `apps/runtime/src/pi-durable-host.ts`: durable one-shot claim receipt and host-created exact attempt passed to deferred model starts.
- `apps/runtime/src/pi-durable-models.test.ts`: ten actual Worker/SQLite host-boundary tests, five in plaintext and five encrypted.
- `apps/runtime/src/pi-durable-summary.test.ts`: only forwards the new dispatch argument through the existing recording adapter.
- `apps/runtime/src/pi-durable-model-preparation.gate.test.ts`: only forwards the same argument through its recording adapter.

The two inherited test changes are exact adapter-only replacements against the accepted archive. Assertions, clocks, deadlines, faults and cleanup are unchanged, including all four close-deadline regressions. See `artifacts/007/remaining-implementation/accepted-test-preservation.log` and `incremental.patch`. The accepted cooperative fixture, effects tests, summary policy and spec are unchanged. Current source hashes are in `source.sha256` in that artifact directory. Inherited dirty source and planning files were preserved.

No package manifests or lockfiles changed. Before/after identities of root `package.json`, `pnpm-lock.yaml`, brain `package.json` and `package-lock.json` match. `git diff --check` passes; staging remains empty.

## Authorized public-cache preparation

All npm and verification commands used this prefix in the execution worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

Ran two preparation commands, both exit 0:

```sh
npm cache add vitest@3.2.6 --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund
npm install --prefix node_modules/.fixture-cache-preparation --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
```

The disposable preparation manifest contains only the existing fixture's Vitest range `^3.2.0` and the already-installed TypeScript file dependency. npm added 52 packages under worktree `node_modules`. Preparation manifests/lockfiles are disposable ignored files, not repository graph edits. The cache is under sanitized HOME. No personal/global cache was copied. Lifecycle scripts, audit and funding were disabled. Logs are `cache-vitest.log` and `cache-preparation.log`.

The unchanged offline fixture then passes in `brain:verify`. Its `npm_config_offline=true` enforcement remains intact. The baseline command passed nested contracts 14 tests, freshness 3 selected tests and the full brain suite 43 tests, with typechecks and builds.

## What the host candidate proves

The new contract is an association, not an authorization permit. It contains effect, logical operation, run, command, assistant, Pi task, host epoch, attempt, host invocation generation, deadline and canonical request metadata digest. `generation` is the host invocation generation, not a projected D1 maximum lifecycle generation. It contains no credential or account entitlement.

Both generation and accepted custom-summary admission mint the association from the existing exact effect ledger, after the nonrefundable admission reservation. Digest/receipt persistence happens before the existing final task/authority checks; there is no new asynchronous preparation between those final checks and the deferred start. Successful custom-summary reuse still bypasses new dispatch and spending.

The host-created local capability accepts only that exact parsed association. It obtains current local authority, re-reads the actual Pi task and its prepared association, and checks the current run epoch, Stop/fence, uncertainty, effect receipt, encrypted seals and finite deadline. A synchronous storage transition conditionally changes `host_model_dispatch.claimed` from 0 to 1. A durability barrier and final local dispatch check precede a successful return. Concurrent/repeated claims cannot obtain another dispatch reservation. Unknown/admitted effects remain in the original ledger rather than being refunded or deleted.

The local claim reservation linearizes at the conditional `claimed=1` transaction after `dispatchPermit`. A successful acknowledgment also requires durability and the final synchronous local check. Stop winning before that check denies the callback even if a reservation was persisted. If the acknowledged claim wins first, Stop cannot undo already-admitted work. The actual provider-start control test proves one start and retained admitted evidence after Stop.

The held-check tests use a deterministic suspended transport wait, then the real host capability. They call actual epoch-first `host.stop`, verify the epoch advanced beyond the original association, and verify zero provider starts after release. The old supplied epoch is not accepted merely because it equals an operation record. Revocation and deadline tests also deny before provider start. Exact identity/digest mutations and repeated consumption are rejected.

The capability has no wait on `providerQueue` or `ownerQueue`, and invokes no public runtime command. An exact claim completes while the original provider response is held. This is executable local no-reentrant-lane evidence.

These tests do NOT perform fresh D1 product checks or a credential-bearing model fetch. The held wait is not a product authorization boolean and is not presented as proof of the missing product owner. `ModelDispatch` is currently a local closure, not a reviewed private service-binding RPC capability. No end-to-end product/credential admission linearization point is established. Existing fixture providers may still ignore this new capability; a mandatory adapter is unfinished. This partial interface must not be treated as production authorization.

## Actual verification

All required handoff commands were run sequentially. The last aggregate sequence is contracts, brain, credentials, runtime, repository, whitespace and empty staging. No zero-test invocation is counted.

| Command | Invocations | Actual result |
| --- | ---: | --- |
| web `agent-models.test.ts` | 1 | 5 existing tests pass |
| web request-contract + connection filter | 1 | 7 connection tests pass; request-contract suite is absent, not verified |
| credential request-contract + credential-DO filter | 1 | 22 existing credential tests pass; request-contract Worker suite is absent, not verified |
| runtime effects/summary/preparation nearest | 1 | 182 existing tests pass |
| runtime new models suite | 2 | first 8 tests pass; expanded suite 10 tests pass |
| runtime models/effects/summary/preparation nearest | 2 | 192 tests across 4 files pass each, including 118 summary tests and 10 new host tests |
| direct runtime `tsc --noEmit` | 2 | first failed on two recording adapters not forwarding the newly required argument; corrected adapters then pass |
| `contracts:verify` | 2 | 16 tests across 2 files, typecheck and build pass each |
| `brain:verify` | 3 | baseline passes with contracts 14; both post-change runs pass with contracts 16, freshness 3 selected and full brain 43, typechecks/builds |
| `credentials:verify` | 2 | 22 Worker tests plus 3 standalone Node crash/RPC checks and typecheck pass each |
| `runtime:verify` | 2 | runtime/forbidden-binding typechecks, 347 Worker tests across 12 files and 6 Node checks pass each |
| `verify` | 3 | first fails only on formatting of the new host throw; formatting corrected; both subsequent runs pass |

Both passing repository gates include Biome, web/credential typechecks, credential 22 Worker plus 3 Node checks, web 815 tests across 73 files, web build, runner typecheck, runner 79 tests across 11 files and runner build. The final gate logs are `contracts-final.log`, `brain-last.log`, `credentials-final.log`, `runtime-final.log` and `repository-final.log`.

The narrow-test invocation count is eight. Aggregate invocation count is twelve, including the baseline brain run and the formatting-failed repository run. Counts are per invocation, not summed into unique coverage. The three additional Biome invocations comprise two scoped formatting/check runs and one repository diagnostic check. They are recorded separately and do not replace tests.

The installed workerd retains the known compatibility-date fallback from requested `2026-09-16` to supported `2026-03-10`. These are disposable local Worker/SQLite results, not hosted eviction or provider evidence.

## Unfinished work

1. Complete the missing product-owned fresh exact admission path and bound private capability transport. Ownership, exact applicable identity/role/retirement/lifecycle, runtime-owner version, connection generation and model entitlement checks still need implementation and real denial/race Worker tests. Do not relax legacy trusted-brain rejection. The new host primitive alone does not complete step 1.
2. Add complete bounded synthetic request/account schemas, product-owned reconstruction, credential-DO-only credential attachment and bounded streaming to a mocked fixed `.invalid` destination. Preserve post-async credential-state checks. No request transport was added here.
3. Add durable trusted-runtime operation windows, one-open-family enforcement, expiry, three-denial close/review and actual affected-run halt. Compose a mandatory private provider adapter for generation, retry, custom summary/fallback and reserved Git metadata. Existing effect accounting remains intact; new product operation policy is absent.
4. Add authenticated configuration-intent and snapshot contracts, owner/session authentication, persistent canonical payload conflict/idempotency, validated defaults before conversation creation and mutable entitlement checks. Account discovery must retain stable unavailable/revoked live outcomes. Prepared request behavior is preserved but the authenticated adapter is absent.
5. Add the missing web/credential suites and aggregate registration without dropping crash/RPC checks. New host tests are automatically discovered by existing `runtime:verify`; repository verification has not been expanded to include the remaining runtime/credential model suites. Complete independent advisor review of actual diff and gates before any READY or full-007 acceptance.

No environment authorization is needed to explain this unfinished state. This is an incomplete execution, not an environmental or architectural impossibility verdict. Do not confuse passing inherited gates with completion of the handoff.

PD38 is not run. Production model discovery/transport remain unavailable. No live provider/account request, auth repair, billing fallback, credential inspection, deployment, shared-data mutation, legacy bypass, retained workspace activation, UI change, dependency upgrade, main source edit, staging, commit, push, integration, new worktree or worktree deletion occurred.
