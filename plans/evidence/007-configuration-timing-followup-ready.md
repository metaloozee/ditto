# 007 configuration timing follow-up

Disposition: READY FOR REVIEW. Aggregate verification is now clean on the narrow follow-up candidate. This is not independent acceptance, configuration acceptance completion, or full 007 completion. Production remains unavailable and PD38 is not run.

## Candidate and scope

Work stayed in the existing detached `/home/ayan/ditto-execution/plan-007-recovery`, HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Main `/home/ayan/ditto` was read-only. No delegation, new worktree, install, dependency change, credential inspection/repair, live provider/account traffic, stage, commit, push, integration, reset, discard or deletion occurred. Tests used disposable synthetic storage and the existing mocked fixed `.invalid` destination.

Before any source edit, all 34 correction candidate identities and all six graph identities matched. The prior source archive still hashes to `dd7d3180ca631b342fadd63fd960dd54b7fba182d431bde1ea204b7f5a049f96`. The complete starting dirty candidate and its existing evidence were preserved in `configuration-timing-followup/preserved-dirty.tar.gz`, with the starting tracked diff, dirty status and per-file identities. The two historical strict contract files in the 34-file manifest were clean at HEAD, not dirty archive members; final comparison reads their unchanged HEAD bytes.

Only two source files changed relative to that preserved candidate:

- `apps/runtime/src/pi-durable-host.ts`
- `apps/credential-tests/src/codex-request-contract.worker.test.ts`

All artifacts below are under [artifacts/007/configuration-timing-followup](artifacts/007/configuration-timing-followup/).

| Artifact | SHA-256 |
| --- | --- |
| Preserved complete dirty candidate/evidence archive | `291ed3fb512c7ed500699d3bd61e2d5d8c33a9963ebac4dec0e85cd7393adc29` |
| Follow-up-only patch | `4960b756156effb9438213f3d2291261505a53483cbc12f5b14b5bde229ffe03` |
| Final complete 34-file source archive | `60c5dc68372676d72e773b1e2f72e5e6df4f49e9fb91871ce587bb4174f05783` |

`source.sha256` matches current files and every archived member. `final-state.json` identifies exactly those two source changes. All six graph files match both the graph manifest and HEAD. Every preserved original file matches except those two source files and the generated advisor acceptance Vitest `results.json` cache. That cache was automatically updated by running the unchanged advisor config; it was not restored or deleted. All original probes, fixture copies, configs, reports, red logs, other logs, archives and patches are unchanged. Staging is empty and `git diff --check` passes.

## Red-capable loop and measured cause

The first execution was the real unfiltered `pnpm credentials:verify` under the required sanitized environment. It failed with 160 passing tests and two 5000 ms timeouts:

- Original `actual custom_summary preparation survives close/reopen with an owned selection change`, observed 6243 ms.
- `configuration correction: authenticates complete outcome before new-intent`, observed 6155 ms.

The payload-digest case passed at 4567 ms. This reproduces the reported aggregate blocker; focused success was not treated as aggregate acceptance. The log and exit status are `baseline-credentials.log` and `baseline-exit.txt`.

Ranked hypotheses were repeated product/D1 authorization round trips, encrypted complete-ledger validation, supported Pi persistence/close, then fixture setup. Evidence-local copies of the original request suite wrapped only timing boundaries. They did not alter policy, assertions, deadlines or scheduler behavior. The copies import the actual host and actual D1/RPC/credential implementation. Supported conversation `configure` was timed without modifying its behavior. The fixture setup timer includes migrations, original seeded product records and synthetic connection installation. Timing rows are inclusive, so nested totals must not be added together.

The unfiltered timing copy also went red, with 138 passes and two timeouts. `timing-before-aggregate.json` records every test. Representative complete-outcome/new-intent measurements were:

- Fixture setup: 745 ms.
- Fifteen product configuration RPC calls: 4272 ms total, maximum 308 ms.
- Ten final/preliminary local-authority reads: 57 ms total.
- Seven complete-ledger scans: below 1 ms total at the Worker's millisecond timing resolution.
- Supported Pi configuration: 1 ms.
- Seven host durability joins: 29 ms total.
- Actual joined close: 6 ms.

The retained-summary case had 15 configuration RPC calls totaling 2468 ms, versus ledger 2 ms, Pi configuration 1 ms and two joined closes totaling 20 ms. Setup was 696 ms. Measurements therefore reject ledger cryptography, Pi mutation and close as the dominant cause of these aggregate timeouts.

A separate product-entrypoint probe split internal credential-status and product D1 policy work from the outer RPC boundary. In the aggregate complete-outcome/new-intent case, credential status remained 18–24 ms and policy 5–6 ms per call, while outer RPC latency had grown much larger than in the focused run. The measured amplification is repeated outer RPC work, not cached authority, ledger processing or a claim that D1 is intrinsically slow. The test-pool wrapper resolves the main Worker export through the runner for each RPC, but the exact mechanism of the growing transport overhead was not established.

One explicit hypothesis was rejected: removing the main fixture entrypoint's unrelated full-host re-export in an evidence-only experiment did not reduce this overhead. The storage-only experiment still failed three cases. It is preserved, and none of its fixture changes entered source. No original fixture setup, seeded records, defaults or assertions were removed. A per-call logging experiment also timed out in the two-session case and failed isolated-storage teardown. It is a failed diagnostic run, not a gate result. Quiet component instrumentation then captured all 140 cases without that teardown failure, while still recording two timeouts. These failures are all listed below.

## Narrow correction and authority ordering

`configurationAllowed()` no longer performs two preliminary product RPC callbacks and a preliminary local-authority read when `selection` is absent. Such operations read owned configuration or authenticate an existing receipt before any selection-specific admission. They still:

1. Match the exact query scope and capture the current epoch before awaited work.
2. Await the current product callback and parse its exact authenticated subject.
3. Authenticate every current ledger row's identity, payload and phase, including apparently complete rows, and compare the post-await inventory.
4. Await fresh final local authority and synchronously check cancellation, current authority, executor/live-executor capacity, active invocation generation, Stop, safety/storage fences, yield deadline and epoch equality.

No validation permit or authority is memoized. The existing bounded pure canonical identity-hash memo is unchanged. Ledger checks remain before every metadata decision. Selection-bearing authorization retains all three product callbacks and both local reads. Supported Pi configuration/default creation remains in the existing owner lane, after ledger validation and the fresh final host read. Capturing epoch earlier also prevents an epoch change during preliminary selection work from becoming the baseline for later admission.

There is no nested owner queue, private scheduler patch, Pi fork, replay, rollback, refund or changed uncertainty accounting. Historical CommandV1/SnapshotV1/readiness meanings and production availability remain unchanged. No distributed atomicity or historical configure-call provenance is claimed.

Two registered encrypted Worker regressions hold the real selection-free product RPC response, then revoke local current authority or executor capacity. Both assert a denied read, unchanged persisted Pi fingerprint and zero provider calls. These protect the retained final check, not a numeric call-count implementation detail. The existing unfiltered credential gate is the timing regression seam; the new safety tests are not claimed to reproduce the old performance failure alone.

## Before/after observations

The evidence timing copy stays frozen at the original 140 request cases, so its before/after comparison does not add the two new registered cases. It imports the final host implementation in the after run.

| Actual Worker boundary | Before aggregate | After aggregate |
| --- | --- | --- |
| Complete payload-digest/new-intent, total including setup/hooks | 4535 ms | 2286 ms |
| Complete outcome/new-intent, total including setup/hooks | 5190 ms | 2379 ms |
| Complete outcome/new-intent, configuration RPC count/total | 15 / 4272 ms | 11 / 1561 ms |
| Complete outcome/new-intent, fixture setup | 745 ms | 689 ms |
| Complete outcome/new-intent, ledger scans | 7 / below 1 ms | 7 / below 1 ms |
| Complete outcome/new-intent, supported Pi configure | 1 ms | 1 ms |
| Complete outcome/new-intent, durability joins | 7 / 29 ms | 7 / 27 ms |
| Complete outcome/new-intent, joined close | 6 ms | 5 ms |
| Original retained summary, total including setup/hooks | 4672 ms | 2934 ms |
| Original retained summary, configuration RPC count/total | 15 / 2468 ms | 11 / 1035 ms |
| Original retained summary, ledger scans | 9 / 2 ms | 9 / 1 ms |
| Original retained summary, joined closes | 2 / 20 ms | 2 / 20 ms |

The after timing aggregate passed all 140 cases. Its payload-reopen case included a 1693 ms outer RPC outlier and still passed at 3881 ms total. The correction removes unnecessary round trips and restores measured margin without extending deadlines or treating transport overhead as harmless.

The three previously failed cases also pass individually against registered source: payload-digest 1137 ms, complete outcome 1130 ms, original retained summary 1922 ms. Each solo invocation reports one pass and 141 explicitly filtered skips. The earlier focused invocation covering those three and both new safety cases passed five tests with 137 filtered skips. Focused filtering is diagnostic only; every aggregate gate below was unfiltered.

## Required verification

Every command ran from the execution worktree under:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm <gate>
```

The first post-correction unfiltered `credentials:verify` passed before the required sequence. Then `contracts:verify`, `brain:verify`, `credentials:verify`, `runtime:verify`, `verify` ran sequentially and all exited zero on their first post-correction sequence. There was no retry-until-green loop. This supplies a second clean unfiltered credential gate; repository verification supplies a third.

| Gate | Exact result | Log |
| --- | --- | --- |
| First post-correction unfiltered credential gate | 164 Worker tests, 3 Node checks, typecheck | `after-credentials-unfiltered.log` |
| `contracts:verify` | 25 tests, typecheck/build | `sequence-contracts-verify.log` |
| `brain:verify` | 25 contracts, 3 freshness with 3 explicit filtered skips, 43 brain tests, typechecks/builds | `sequence-brain-verify.log` |
| Second post-correction unfiltered credential gate | 164 Worker tests, 3 Node checks, typecheck | `sequence-credentials-verify.log` |
| `runtime:verify` | 387 Worker tests, 6 Node checks, both typechecks | `sequence-runtime-verify.log` |
| `verify` | 164 credential Worker tests and 3 Node checks, 848 web tests, 79 runner tests, formatting/lint, typechecks/builds | `sequence-verify.log` |

The request suite is 142 tests, its original 140 plus two new safety regressions. Credential DO coverage remains 22. Original preparation, summary, effect, credential safety and configuration-close cases remain in the unfiltered suites. No deadline or original assertion changed; no absent/zero-test result counts as passing.

The payload-digest, complete-outcome and original retained-summary durations respectively were:

- First clean credential gate: 3841, 2419, 2922 ms.
- Second clean credential gate: 2362, 2443, 2968 ms.
- Repository credential gate: 2373, 2437, 2976 ms.

The immutable acceptance/original probe configs also pass unchanged:

- Configuration acceptance: 5 passes, 114 explicit filtered skips, `acceptance.log`.
- Original host: 4 passes, `original-host.log`.
- Original post-product host: 3 passes, `original-product-host.log`.
- Original product D1: 2 passes, 142 explicit filtered imported skips, `original-d1.log`.

`counts.json`, the sequence/probe/focused status files and the individual logs record exact results. The inherited local workerd compatibility-date warning remains. Nothing was installed, upgraded or repaired.

## Failures retained

Earlier advisor failures remain byte-identical under `configuration-correction-advisor/{credentials,timeout-focused,runtime,repository}.log`; the runtime and focused logs there are passing observations, not replacements for the failing aggregate logs. Every earlier executor failure and its eventual fourth passing sequence remain preserved under `configuration-correction/`. The prior correction-ready report and advisor rejection reports are not rewritten.

This follow-up also preserves all new red or diagnostic failures:

| Log | Result |
| --- | --- |
| `baseline-credentials.log` | 160 passed, 2 timeouts, original retained summary and complete-outcome/new-intent |
| `timing-before-aggregate.log` | 138 passed, 2 timeouts, complete-state/new-intent and complete-outcome/reopen |
| `timing-product-before.log` | 50 passed before abort, two-session timeout and isolated-storage teardown failure; incomplete diagnostic run |
| `timing-product-quiet-before.log` | 138 passed, 2 timeouts, lost-acknowledgment receipt and complete-ID/new-intent |
| `timing-storage-only-experiment.log` | 137 passed, 3 timeouts, retained generation, complete-payload/new-intent and complete-outcome/reopen; rejected experiment |
| `format-check.log` | One formatting failure on the newly added test callback line; corrected before the successful gate sequence |

Timing instrumentation and the rejected fixture variants exist only under the clearly named evidence directory. Registered source contains no timing wrapper or debug instrumentation. Nothing was deleted. Public Cloudflare testing/best-practice documentation was read-only; it did not authorize dependency or platform changes.

Independent review must determine acceptance of this exact archived candidate. Full 007, provider compatibility, hosted authentication and production activation remain outstanding.
