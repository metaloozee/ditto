# 008 continuation cache attempt

Status: stopped at the unchanged offline freshness prerequisite. No implementation source delta, acceptance or integration.

Executor environment reports `PI_PROVIDER=openai`, `PI_MODEL=gpt-6.1-sol`, `PI_REASONING_LEVEL=medium`. Session `01a12a42-8ad4-74a6-abc8-64ac8f86dbb3`. Writable checkout remained `/home/ayan/ditto-execution/plan-008-4WXvNW`, detached HEAD `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. MAIN was read only. No new worktree or commit.

Read the complete updated MAIN continuation, parent plan, refresh, dispatch increment review, dispatch fence review, independent private RPC test run, and EXECUTION continuation evidence. This attempt did not reach runtime source implementation or reopen private RPC qualification.

## Cache preparation

Preserved the interrupted executor's `continuation-20261011T0915Z` checkpoint unchanged, including its unexecuted script. Reviewed that script and wrote a separate chronological preparer under `plans/evidence/artifacts/008/continuation-20261011T091926Z/`.

The revised script uses installed npm's pacote and cacache, not an install command. It first copies matching public registry response entries from execution `.execution-008/cache/npm` into the authorized `.execution-008/home/.npm`. It fetches missing public registry metadata and tarballs. It validates the exact registry origin and disallows URL credentials. It traverses required and optional dependencies for resolution metadata, but skips tarballs for incompatible OS, CPU and libc packages. It never invokes package scripts, modifies project manifests/lockfiles, or extracts packages into installed dependencies. No private registry or credential input was supplied.

Every toolchain/cache/test command used `sh .execution-008/clean-run.sh`.

| Command after launcher prefix | Result | Artifact |
| --- | --- | --- |
| `node plans/evidence/artifacts/008/continuation-20261011T091926Z/prepare-public-cache.cjs` | exit 0 | `cache-preparation.log`, `cache-packages.json` |
| `npm test --prefix packages/session-brain -- --run src/pi-feasibility.test.ts -t contracts-consumer-freshness` | exit 1, two passed, one failed, three explicitly filtered | `contracts-freshness.log` |
| Read-only selected cacache metadata inspection | exit 0 | `vitest-cache-metadata.json` |
| Source/evidence/patch preservation check | exit 0 | `final-hashes.json`, `final.patch`, `preservation.json` |

The unchanged offline npm consumer case still fails at `pi-feasibility.test.ts:231` with `ENOTCACHED` for `https://registry.npmjs.org/vitest`. No test edit, offline bypass, project install or test retry occurred. The other two freshness cases pass. This is not a freshness pass.

The cache inspection confirms Vitest's public metadata and 3.2.7 tarball are present in the authorized default HOME cache. The metadata request uses abbreviated `application/vnd.npm.install-v1+json`, with `Vary: accept-encoding, accept`. Installed npm's `@npmcli/arborist/lib/arborist/build-ideal-tree.js:1458` requests `fullMetadata: true` for manifest resolution. The preparer did not fetch this full-JSON response variant. That mismatch is the concrete likely reason npm reports no usable cached response despite the abbreviated entry. It is a preparation defect, not evidence of a runtime or private RPC failure. No full-metadata repair followed the single authorized narrow test invocation. A next executor should prepare the needed fullMetadata variant rather than repeat runtime qualification or alter the freshness test.

## Preservation and unfinished work

All 37 final implementation source hashes still match `implementation-20261011T081337Z/final-source-hashes.json`. All 40 source/targeted evidence entries match the interrupted checkpoint. The complete tracked binary patch remains byte-identical to `continuation-20261011T0915Z/baseline.patch`; its exact hash and current manifest/lockfile inventory are in `preservation.json`. Staging is empty. Existing checkpoint archives, probes and qualification artifacts were not modified. Installed dependency files were not command targets; no before/after full installed-tree hash was captured, so no independent full-tree hash assertion is made.

Only new targeted evidence and the authorized execution-local public npm cache were written. Test-generated temporary fixture files are governed by the existing unchanged test. There were no source, manifest, lockfile, installed dependency, main cache or main source writes, deployment, live provider request, shared database mutation, cleanup, stage, commit, merge or push.

The remaining source implementation is untouched: host-owned invocation origin, exact reset/outside observation/proof journal, one newer-generation issuance, recovery-only barriers and priority-control reconciliation/activation, candidate predicates and private reactivation, valid-body stale-generation/deadline/scope regressions, and the original crash matrix. Final aggregate gates were not run against the partial candidate. The original B diagnostic remains unchanged and is not claimed fixed.
