# 007 locked dependency installation and new gate failure

Verdict: BLOCKED. The authorized locked installation succeeded without changing manifests or lockfiles. The required brain gate now runs, but its offline contracts-copy fixture fails on absent public registry metadata. Remaining fixture implementation was not performed. This report does not declare an architectural impossibility or advisor acceptance.

## Exact installation

Used only the existing detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. No worktree was created. Model/reasoning remain the same as the preceding execution.

Inspected the existing package manifest and lockfile before installing. `packages/session-brain/package-lock.json` exists with lockfile version 3. Actual npm is `12.0.2`, matching the manifest requirement. Node is `v24.21.0`, satisfying `>=22.19.0`.

From the execution worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true npm ci --ignore-scripts --prefix packages/session-brain
```

Exit 0. npm reports 274 packages added and 276 audited. Lifecycle scripts were disabled. The install output reports nine vulnerability advisories; no audit fix, graph refresh or upgrade was attempted. See `artifacts/007/remaining-fixture-resume/install.log`.

Before/after hashes are in `artifacts/007/remaining-fixture-resume/dependencies-before.sha256` and `dependencies-after.sha256`. Both are identical:

| File | SHA-256 |
|---|---|
| `package.json` | `7c358c265a166f74781a300907f0222dfa98018ba726cf1df803c0548f777afa` |
| `pnpm-lock.yaml` | `66846c99c052aad263b936415ca0a0f9f9f9c107d285d884e3c9ed40d0465d49` |
| `packages/session-brain/package.json` | `902fa2068fc706023a3f1cae1075da5fece28307fdc67a28ad4632fab44de36d` |
| `packages/session-brain/package-lock.json` | `ff3709491f18ad55294511d36c5a72d7c21a3eca345025df9c4c7aeffedaf320` |

The installed package tree resolves to the execution worktree's `packages/session-brain/node_modules`. Its runtime-contracts file dependency resolves to the sibling `packages/runtime-contracts` in the same execution worktree, not main. npm cache/log state is under the sanitized worktree HOME. No main-checkout installation or source change occurred.

## Actual gate result

From the execution worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm brain:verify
```

Exit 1. See `artifacts/007/remaining-fixture-resume/brain.log`.

- Nested `contracts:verify` passes typecheck, 14 tests and the existing build.
- Brain `contracts:check` now starts Vitest successfully.
- The imported emitted JS/declarations freshness assertion passes.
- The external-sentinel symlink rejection passes.
- The isolated npm-copy/refresh assertion fails. Actual count is 2 passed, 1 failed, 3 intentionally filtered skips.
- Later brain typecheck, full tests and build do not run because the command is chained with `&&`.

The failing test constructs a disposable copy of runtime-contracts, preserving its Vitest devDependency, substitutes the already-installed TypeScript file dependency, and runs `npm install --ignore-scripts` with `npm_config_offline=true`. Relevant source is `packages/session-brain/src/pi-feasibility.test.ts:160-176,194-231`. npm fails at the first temporary contracts fixture install:

```text
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/vitest failed: cache mode is 'only-if-cached' but no cached response is available.
```

This is missing cached registry metadata for the test's range resolution, not missing installed Vitest, unsupported npm/Node engines, a stale actual contracts file dependency or an admission assertion failure. The successful locked `npm ci` does not establish that npm has the range-resolution metadata needed by this separate offline fixture install.

No test was weakened, no offline restriction was removed, no cache was copied from another HOME, and no additional cache-priming install or registry operation was attempted. The authorization covers the exact session-brain `npm ci`; it does not cover another dependency installation or cache repair. Resolving the offline fixture's cache prerequisite or approving a focused test-fixture correction needs a separate scope decision. The graph must remain unchanged.

## Preservation and unfinished boundary

All seven accepted hashes matched before installation and after the brain gate. `git diff --check` passes and staging remains empty. No source/spec/manifest/lockfile or existing test/evidence was edited. This report and `artifacts/007/remaining-fixture-resume/` are the only new planning evidence for this continuation. The installed ignored dependency tree and build output are not an implementation diff.

The previously documented admission boundary remains unfinished. The Pi host must own current epoch, Stop, exact admitted attempt and final dispatch authority. Product must own fresh identity-specific ownership/lifecycle/operation/model checks. Credential attachment must remain in the credential DO. A held product check overlapping Stop still needs an executable exact-attempt proof; a synchronous callback must not wait on its caller's held host lane. No caller-supplied epoch, operation-row equality or fixture boolean was substituted for that proof. No end-to-end linearization point or race guarantee was implemented.

All five handoff implementation steps remain incomplete. No new request/configuration contracts or provider adapters were added. Earlier passing aggregate results remain historical preflight evidence, not new implementation verification. They were not rerun or claimed here. PD38 is not run. Live discovery/transport remain unavailable.

No live model/account request, credential inspection, auth repair, billing fallback, deployment, shared-data mutation, integration, staging, commit, push or worktree deletion occurred. Only the narrowly authorized locked installation and the required local synthetic verification ran.
