# 008 implementation continuation executor

Execution started 2026-10-11. Not accepted or integrated.

Writable checkout `/home/ayan/ditto-execution/plan-008-4WXvNW`, detached base `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. Harness reports `openai-codex/gpt-6.1-sol`, medium. MAIN was read only. No new worktree, dependency preparation, commit or integration.

Read the complete current MAIN handoff, parent plan, refresh, independent RPC run and dispatch-fence review, current execution sources and chronological evidence. Historical qualification-only scope is superseded by this turn. The passing local private-RPC seam is not reopened for qualification.

## Preservation before edits

Artifacts are under `plans/evidence/artifacts/008/implementation-20261011T081337Z/`.

`baseline-hashes.json` hashes every changed and untracked baseline file, including previous execution material. `baseline.diff` preserves the tracked binary diff. The initial compressed archive command exceeded its 30-second outer budget; its incomplete archive remains preserved and is not relied upon. The subsequent uncompressed `source-and-prior-evidence.tar` completed with 153 source and prior evidence files. Its hash is in `archive.sha256`. Generated `.execution-008/` toolchain/cache material remains intact and is included in the full hash inventory, not duplicated into the source archive.

## First implementation increment

Added the two narrow credential hooks. Candidate preparation captures the parsed original descriptor before ordinary preparation, freezes its subject/attempt and binds the exact descriptor, scope and original host generation. Default noncandidate preparation is null and its synchronous gate is a no-op. Final product/host checks remain. The candidate final gate synchronously reads LIVE credential SQLite immediately before fetch, with no intervening await. Storage failure reaches the existing denied path. The credential revision and abort signal remain checked; exact validated original window/command/effect bounds are retained by the existing policy object and checked after its final awaited positive result.

The existing private CandidateFixtureCredential composition owns the fence table. Generation-1 initialization does not reopen a closed row. Conditional closure binds exact scope/generation/reset ID, persists before acknowledgment, and retries idempotently. No successor reactivation exists yet; it must wait for the trusted fixture reset/recovery journal. No per-effect ledger, namespace, resource or public endpoint was added. Existing host/D1 accounting remains authoritative.

Added three real admitted-product regression cases at the nearest existing Worker suite. Each holds the real final positive permit after the real host claim, closes the local fence and releases the stale response. Variants cover acknowledgment loss and actual credential constructor replacement. The original B D1-only diagnostic, four advisor probes and private-RPC qualification artifacts are untouched. This increment is not the complete reset/recovery implementation or remaining matrix.

All toolchain invocations below used `sh .execution-008/clean-run.sh`, with original deadlines and isolated HOME/cache/store/TMP. Outer budgets were 120 seconds for typechecks/formatting, 240 seconds for focused Worker/probe tests, 300 seconds for contracts and 600 seconds for full Worker/brain commands. No test, host, effect or configuration deadline changed.

## Chronological commands and results

Log paths below are relative to `plans/evidence/artifacts/008/implementation-20261011T081337Z/`. Every command ran in the execution checkout and used the launcher prefix above.

| Command after launcher prefix | Exit and result | Log |
| --- | --- | --- |
| `pnpm --filter @ditto/credential-tests exec tsc --noEmit` | 0 | `credential-typecheck-1.log` |
| `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'credential-local'` | 1. Three assertions passed, 32 unrelated cases explicitly skipped, one unhandled `fixture_interruption` reset rejection | `dispatch-barrier-1.log` |
| Same focused command after supported reset callback correction | 0. Three cases passed, 32 explicitly skipped, clean teardown | `dispatch-barrier-2.log` |
| `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts src/codex-request-contract.worker.test.ts` | 0. All 177 tests passed across both files, 35 candidate and 142 historical. Duration 270.06 seconds. No skipped tests | `worker-regressions-1.log` |
| `pnpm exec biome check --write apps/web/src/lib/codex-credential-do.ts apps/web/src/lib/model-product-authority.ts apps/credential-tests/src/entry.ts apps/credential-tests/src/product-commands.worker.test.ts` | 0. Scoped formatting only | `scoped-biome-1.log` |
| `pnpm typecheck` | 0 | `web-typecheck.log` |
| `pnpm --filter @ditto/credential-tests exec tsc --noEmit` on final bytes | 0 | `credential-typecheck-final.log` |
| Focused barrier command on final bytes | 0. Three passed, 32 explicitly skipped | `dispatch-barrier-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts` | 0. Four unchanged advisor probes passed | `advisor-probes.log` |
| `pnpm contracts:verify` | 0. Typecheck/build and all 49 tests passed | `contracts-verify.log` |
| `pnpm brain:verify` | 1. Nested contracts passed all 49. Freshness check passed two cases and failed one; its existing script explicitly filters three other cases | `brain-verify.log` |

The first barrier run used the inherited synchronous `abortFixture` RPC solely for credential replacement after request settlement. Its handled reset still leaked an unhandled rejection through the pinned pool. The test now performs the same actual credential-object reset through a supported async `runInDurableObject` callback after storage sync and checks the exact reset result. It acquires a fresh stub and inspects durable closure afterward. No exception suppression, isolation disablement, dependency patch, fake replacement or removal of the reset assertion occurred. Both the first failure and native reset diagnostics remain in the logs. This is not another qualification of the already-passing session private-RPC seam, and does not change that seam.

The full 177-case run preceded the final formatting and an additional exact credential-DO owner identity check in closure. Those final bytes have web/credential typechecks and the three barrier tests, not a second full 177-case pass. Do not call the earlier full run a final-byte aggregate.

## Concrete verification prerequisite stop

`brain:verify` failed in the unchanged isolated npm consumer freshness test at `packages/session-brain/src/pi-feasibility.test.ts:231`. Its offline install reports `ENOTCACHED` for `https://registry.npmjs.org/vitest`. The test's worktree-local default cache lacks that registry metadata. The installed package runners themselves remain usable. No install, cache copy/preparation, registry fetch, freshness-test alteration or retry followed. This turn grants no permission to repair that prerequisite.

Stopped at this concrete missing verification dependency, as the handoff requires. The remaining exact aggregates `credentials:verify`, `runtime:verify`, and `verify` were not run. The first two aggregate results are `0/1`; no all-green gate or 008 completion is claimed. No further source edits followed the brain failure.

## Exact final inventory and evidence limits

`final-source-hashes.json` contains all 37 intended candidate source hashes. This continuation changes exactly four files. `continuation-source.patch` is their exact delta against the archived entry baseline; `full-candidate.patch` preserves the complete tracked candidate diff against HEAD. `preservation.json` reports 33 untouched source files, zero changed prior evidence artifacts, unchanged HEAD and empty staging. `git diff --check` passes. The host file, its newer-generation/exact-predecessor guard, original four probes/configuration, versions, manifests and lockfiles were not edited in this continuation.

The local barrier tests establish zero new fetch invocations after acknowledged credential-local closure when a real positive final permit and real host claim were already held. They do not prove cancellation or prevent late network delivery for fetches invoked before closure. Existing host/D1 reservations remain consumed and no occupancy is released.

Credential replacement reloads the durable closed row and its exact idempotent closure receipt. The supplemental old-descriptor request in that variant uses an invalid empty synthetic body, so its denied result alone is NOT evidence that an otherwise valid old descriptor cannot dispatch after restart. A valid-body replacement regression is still required. Original D1-only B diagnostics remain byte-identical and historically red; they were not rerun or relabeled as fixed.

Remaining implementation is explicit, not a new trust-boundary objection: host-owned immutable invocation origin, fixture reset intent/outside observation/fresh proof journal, one exact newer-generation issuance, recovery-only barriers and complete priority-control scan/repair/activation; candidate generation/phase and review-null predicates; private readiness-bound reactivation; valid-body stale-generation/restart, deadline/window, scope-isolation cases; and the original real-D1/control crash matrix. Default authority still returns generation 1 and no witness. No fixture issuer or successful takeover was added. The passing private-RPC seam is available for the next implementation increment without a standalone qualification round.

Return this partial increment for independent advisor review. It is not ready for 008 acceptance or integration. No main source write, new worktree, stage, commit, push, deployment, live provider, shared/retained DB mutation, external cleanup or worktree removal occurred.
