# 007 configuration corrections

Disposition: READY FOR REVIEW for both reproduced source defects. This is not independent acceptance. Configuration remains subject to advisor review and full 007 remains NOT DONE. The accepted transport archive is a reference baseline, not acceptance of this candidate.

## Source and preservation

All source writes stayed in detached `/home/ayan/ditto-execution/plan-007-recovery` at HEAD `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Main was read-only. No delegation, new worktree, reset, source discard, staging, commit, push, integration or worktree removal occurred.

Before editing, the 34 identities in `configuration/source.sha256` matched the execution candidate. All six `product-correction/graph.sha256` identities matched current files and HEAD. `configuration-correction/baseline.tar.gz` preserves those exact 34 files; the archive was subsequently checked against the original manifest. `baseline.patch` and `baseline-status.txt` preserve the starting tracked diff and dirty status. The original candidate archives and patches remain untouched in both checkouts.

Only two source files changed relative to that baseline:

- `apps/runtime/src/pi-durable-host.ts`
- `apps/credential-tests/src/codex-request-contract.worker.test.ts`

The final 34-file candidate, its hashes and the correction-only diff are in [artifacts/007/configuration-correction](artifacts/007/configuration-correction/). No dependency, manifest, lockfile, product policy, CommandV1, SnapshotV1, readiness contract or production entrypoint changed in this correction.

| Artifact | SHA-256 |
| --- | --- |
| Preserved correction baseline archive | `d9cd75903dfd67e5be107c64225821e3dbecbc2da87871f1160a29e59c88c6a0` |
| Final source archive | `dd7d3180ca631b342fadd63fd960dd54b7fba182d431bde1ea204b7f5a049f96` |
| Correction-only patch | `b41f834b685f7b112a60ee7cf266a1f95067a07815d09c8b240799c549d036fe` |
| Original configuration archive, unchanged | `782495f72e34ee81b546ccfbef72c5e091cced8b71dd41431fdb8efe2b19e442` |

The final source/archive/graph checks pass. Staging is empty and `git diff --check` passes. All 389 pre-existing non-cache artifact identities match the preflight inventory. Original probes, fixture copies, configs, evidence logs, red logs, patches and archives are unchanged.

Preservation qualification: running the immutable advisor configs automatically updated two generated Vitest `results.json` caches under `configuration-advisor/acceptance-cache/` and `configuration-advisor/cache/`. `immutable-verification.log` records these two differences; `final-preservation.txt` names their full paths. They were not used as evidence, repaired or deleted. No authoritative probe/config/log/archive changed. The supplementary snapshot probe uses a new correction-local cache.

The main checkout contains the candidate as an archive, not as current source. An attempted direct main-source manifest check was therefore invalid and is not counted. `main-archive-verification.txt` verifies all 34 original candidate identities inside the preserved main archive, read-only.

## Reproduction

The exact requested sanitized acceptance command ran before editing. `acceptance-red.log` records five failures: four plaintext/encrypted local-current/executor races returned `applied` and changed persisted Pi tables; the encrypted phase flip also admitted a newer intent and changed Pi.

The unchanged five probes pass after correction and again against the final source in `acceptance-final.log`. They report four `denied` acknowledgments with unchanged Pi fingerprints and an integrity-rejected encrypted reopen with unchanged Pi state. The 114 imported fixture cases are explicitly filtered skips, not counted as passes.

## Ordered configuration admission

`configurationAllowed()` now finishes the final awaited product callback and configuration evidence validation before obtaining the final fresh host authority snapshot. Cancellation and synchronous local guards follow that read. These guards retain epoch equality, current authority, executor/live-executor capacity, active invocation generation, host safety/storage fences, Stop and the existing yield deadline.

The final supported `root.configure()` call follows this admission in the existing owner lane. Default creation follows the same order before supported `Harness.root(context, { agent })`. No nested owner transition, public configure reentry, private scheduler patch or Pi fork was added.

This is ordered admission, not a distributed transaction. Product authority is validated first; evidence is authenticated; host authority is freshly read last; local guards decide admission to the supported Pi operation. Pi owns its subsequent commit. Product/local revocation after admission cannot retroactively provide a D1/Pi atomic rollback. The existing pending intent, durability join and postcondition recovery still account for separate host and Pi commits and lost acknowledgments.

Six registered races cover local current, executor capacity and active invocation generation for plaintext and encrypted hosts. Two default cases revoke local current or increase executor capacity during the final actual product callback and assert zero conversations. Two close cases hold the final callback, join bounded host close before releasing it, reject the waiting operation and reopen with the original pending intent accounted as unknown. Existing default, product revocation, preparation and close assertions remain intact.

The active-generation race holds actual credential preparation while configuration authority is held. Its product window remains consumed/reserved and its host claim remains unclaimed at the observation point. Configuration denial neither refunds accounting nor dispatches a model request. Host invocation generation and product identity lifecycle remain separate domains.

## Authenticated metadata decisions

`configurationLedger()` scans every configuration row, regardless of queryable phase. Each row passes the existing seals/opened-content checks, strict intent/ack/phase parsing and identity/payload recomputation before phase, duplicate/conflict or pending-block decisions. It also compares the raw row after awaited hashing and the full row inventory after the scan, rejecting changes during validation.

Initialization authenticates the ledger before inspecting whether a conversation exists or recovering pending work. Apparently complete rows cannot escape validation. Owned reads and configuration admission also authenticate all rows. Duplicate lookup and pending blocking use authenticated evidence, not SQL predicates on unauthenticated `state`. Final selection admission validates evidence after the held final product callback and before the fresh local authority read.

A validation failure denies the live host and throws; reopen rejects again from the unchanged corrupt evidence. No metadata is rewritten into agreement, no intent or seal is deleted, no old choice is replayed, and no pending work is automatically released. Existing unknown-outcome and equal-postcondition recovery behavior is preserved.

A bounded 128-entry per-host cache memoizes only the pure canonical subject/intent hash calculation. Every row is still opened, parsed and compared against current identity/payload/phase metadata. The cache stores no authority, phase, outcome or row-validation permit. Changed subject/intent bytes select a different hash input; changed row metadata or ciphertext still rejects. This avoids repeatedly awaiting identical cryptographic digests during full-ledger checks without caching authorization.

Sixteen registered cases cover pending and complete records, new-intent and reopen paths, and state/payload-digest/identity/ciphertext changes. They assert unchanged actual Pi fingerprints, unchanged corrupted evidence and zero provider requests. They leave the corrupted synthetic rows intact. The original three explicit-duplicate tamper assertions remain unchanged.

## Captured state

`snapshots.json` retains actual observations from final registered suites and a supplementary three-case actual-host snapshot probe. It includes:

- Final local authority reads ending in `current: false`, the denied acknowledgment and equal before/after persisted Pi table fingerprints for both encryption modes.
- Encrypted pending row identity, payload digest, original `pending` phase and tampered `complete` phase with the same ciphertext digest, integrity-rejected reopen and equal Pi fingerprints.
- Current/capacity/generation race observations, consumed product windows and host run/claim state.
- Actual mandatory-adapter request metadata for selected generation, in-flight changes, custom summaries and close/reopen retention. Prepared generation and summary requests retain faux-1/off while newly prepared summary work uses faux-2/low.

`snapshots.worker.test.ts` and `snapshots.config.ts` are correction-local evidence only. They import the unchanged advisor fixture copy and do not change registered production/test source. Their three passes and 114 filtered skips are recorded separately. Only fixed mocked `.invalid` traffic was allowed; no network credential values were captured.

## Verification

All commands used `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. Deadlines and original assertions were not changed. Zero-test runs are not counted.

The final successful aggregate sequence is recorded in `gates-status-fourth.txt`, with these logs:

| Gate | Final result | Log |
| --- | --- | --- |
| `contracts:verify` | 25 tests, typecheck and build | `contracts-verify-fourth.log` |
| `brain:verify` | 43 brain, 25 contracts, 3 freshness tests with 3 filtered skips; typechecks/builds | `brain-verify-fourth.log` |
| `credentials:verify` | 162 Worker tests and 3 Node checks; typecheck | `credentials-verify-fourth.log` |
| `runtime:verify` | 387 Worker tests and 6 Node checks; both typechecks | `runtime-verify-fourth.log` |
| `verify` | 848 web, 79 runner, 162 credential Worker and 3 Node checks; formatting, typechecks and builds | `verify-fourth.log` |

The credential request suite has 140 tests: the original 114 plus 26 correction regressions. Credential DO coverage remains 22 tests. The nearest contracts run passed 25; the nearest models/effects/summary/preparation run passed 232. The full final credential and repository gates also run all 140 request cases unfiltered.

Final immutable probes pass separately:

- Five new advisor acceptance probes: `acceptance-final.log`.
- Four original host probes: `advisor-model-claim.config.ts-final.log`.
- Three original post-product host probes: `product-advisor-review-post-product-check.config.ts-final.log`.
- Two original D1 probes: `advisor-d1-final.log`, with 140 explicitly filtered imported skips.
- Four original configuration-close cases: `original-close-final.log`, with 114 filtered skips.

`counts.json` retains exact aggregate counts. `toolchain.txt` records the local Node/pnpm/platform. The inherited runtime compatibility-date warning remains: installed local workerd supports 2026-03-10 and falls back from the requested later date. Nothing was upgraded or repaired.

Earlier failures remain preserved. The first full request run timed out in the unchanged retained-summary case; its focused rerun passed. Later aggregate attempts hit unchanged 5-second limits in new complete-row cases and existing receipt/retry cases. No deadline was increased. The final implementation memoizes pure identity hashes, and correction-only tests reuse one isolated synthetic DO and omit unrelated command acceptance except for active-generation races. Original test setup defaults and assertions are preserved. The final complete sequential gate set passes without filtered aggregate tests.

Two initial old-host probe invocations used the credential package to execute runtime configs and failed before any tests. Correct runtime-package invocations pass. An extra advisor diagnostic finding script was also run: its two bug-presence assertions now fail because corrupted reopen rejects and stale authority is denied. Its equal-current-selection cases pass. That script is not one of the nine original safety probes or the five acceptance probes, and its bug-presence failures are not counted as passing acceptance evidence.

## Limits

Fixture authentication is deployment-owned injected RPC context, not cookie/hosted authentication. Production configuration/discovery/transport remains unavailable. No retained activation, UI, 008 rollout, provider/account call, model/billing fallback, dependency install/repair/upgrade, deployment or shared database operation occurred. PD38 is not run.

No historical side-effect provenance is inferred from an equal recovered Pi selection. Equal-current postcondition recovery is intentionally allowed without replay. The unconfirmed credential-status availability concern was not changed. Summary one-attempt policy, nonrefundable admitted/uncertain accounting, mandatory adapter validation and request preparation semantics remain covered by the original suites.

Independent advisor acceptance and full-plan disposition are still outstanding.
