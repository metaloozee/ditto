# 007 configuration advisor review

Disposition: NOT ACCEPTED. The standard verification gates pass independently, but five additional actual-host Worker probes reproduce two correctness gaps. Full 007 remains NOT DONE. The previously accepted synthetic transport is a reference baseline, not acceptance of later host changes.

## Candidate and verification

The candidate remains dirty and uncommitted in detached `/home/ayan/ditto-execution/plan-007-recovery`, base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. All 34 candidate identities match `artifacts/007/configuration/source.sha256`. The archive SHA-256 is `782495f72e34ee81b546ccfbef72c5e091cced8b71dd41431fdb8efe2b19e442`; configuration-only patch SHA-256 is `3fdaa236eba5005a898e50a484ada592fa340801189a9a682acd1199aad2d1e1`. Both are preserved in main under `plans/`.

All six dependency graph identities match current files and HEAD. All 33 labeled original advisor artifacts remain unchanged. Strict persisted CommandV1 and SnapshotV1 source files remain unchanged. Whitespace checks pass and staging is empty. No advisor source edits occurred.

The advisor read the new configuration contracts/tests, unavailable production runtime methods and client contract, changed documentation, the complete new host configuration implementation and surrounding retained initialization. A separate reviewer read all product policy/composition modules and 50 new configuration tests, independently ran 19 additional boundary probes plus 29 existing boundary cases, and reported no confirmed defect in that narrower boundary. A recovery reviewer produced probes but terminated on a provider error without a final synthesis. The advisor inspected its fixture-copy changes, reproduced the relevant failures independently and distinguishes confirmed acceptance gaps from its other observations below.

Independent commands ran under `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. Required aggregate gates ran sequentially and exited zero. No test deadlines changed or zero-test passes were counted.

| Gate | Independent result |
| --- | --- |
| Original host probes | 4 passed |
| Original post-product host/adapter probes | 3 passed |
| Original product D1 probes | 2 passed, 114 explicitly filtered skips |
| `contracts:verify` | 25 tests, typecheck and build passed |
| `brain:verify` | 43 brain tests; contracts 25 and freshness 3 passed with 3 filtered skips; typechecks and builds passed |
| `credentials:verify` | 136 Worker tests and 3 Node checks passed |
| `runtime:verify` | 387 Worker tests and 6 Node checks passed, including four unchanged configuration-close regressions |
| `verify` | 848 web tests, 79 runner tests, 136 credential Worker tests and 3 Node checks, formatting, typechecks and builds passed |
| New configuration acceptance probes, repeated twice | 5 failed with the same actual-state observations, 114 explicitly filtered skips |

Independent gate logs, probes, configs and fixture copies are preserved in `artifacts/007/configuration-advisor/`. The copied fixture changes only import locations and exports of existing helpers, not authority or storage behavior. All network remains mocked fixed `.invalid` with other networking disabled.

## 1. Stale local authority across the final product callback

`apps/runtime/src/pi-durable-host.ts:1526–1536` obtains `local`, then awaits `finalProduct = c.authorize(...)`, then uses the old local snapshot in `configurationLocal(local)`. `configureOwned()` subsequently applies Pi configuration. The synchronous epoch check does not detect external authority or executor-capacity changes which leave that epoch unchanged.

Four probes hold the final real product RPC response in the selection-authorization path immediately before Pi configuration. While it is held, the actual host authority fixture changes either `current` to false or executor capacity to 2. Both plaintext and encrypted hosts still return `status: applied`, and their persisted Pi table fingerprint changes. Expected behavior is denial and an unchanged Pi selection. This is the same stale-snapshot pattern previously rejected in model admission, now introduced in configuration.

Correction must establish fresh final host authority and synchronous host checks after the awaited product callback. Define the configuration admission ordering around supported Pi mutation rather than claiming distributed atomicity. Do not move the race into a different check, patch Pi's private scheduler, or create a nested owner queue. Preserve fresh product validation, epoch/Stop/fences/deadlines and bounded joined close. If supported APIs cannot meet the required ordering, report the exact missing decision instead of accepting stale local authority.

## 2. Unauthenticated phase metadata controls recovery and pending blocking

`initializeOwnedConfiguration()` at `pi-durable-host.ts:1594–1599` selects only rows whose queryable `state` is pending. The new-intent guard at `:1692–1698` uses the same raw state filter. `configurationEvidence()` correctly compares the encrypted phase with the row's metadata, but only for rows the filters choose or a caller explicitly duplicates.

The encrypted probe interrupts after pending-intent durability, before Pi configuration. It changes only queryable metadata from pending to complete, leaving ciphertext and seals unchanged. Reopen skips the row's semantic integrity check. A new intent then applies faux-1/high and changes persisted Pi state. Only explicitly querying the old intent later detects the encrypted/raw phase mismatch. Tampered metadata thus bypasses pending accounting and allows a new mutation before the corrupt evidence is rejected.

Correction must authenticate every configuration row's identity, payload digest and phase before its metadata determines recovery, pending blocking or new configuration admission. Reject/quarantine mismatches before Pi mutation, including on reopen when the corrupted row appears complete. Do not rewrite the metadata into agreement, silently delete evidence, replay old choices or release pending work automatically. Extend checks beyond this one phase flip to payload/identity/ciphertext consistency wherever queryable fields determine admission.

## Reproduction and required correction evidence

From the existing worktree:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/credential-tests exec vitest run \
  --config "$PWD/plans/evidence/artifacts/007/configuration-advisor/acceptance-probes.config.ts" \
  -t '^advisor acceptance:'
```

Both `acceptance-probes-red.log` and `acceptance-probes-red-second.log` record four local-authority cases returning applied with changed Pi state, plus the phase case returning applied with changed Pi state. Keep these probes, fixture copy, config and red logs immutable. Correction must make the same five cases pass and add permanent registered regressions, including owned default initialization, active generation/takeover, pending-state tampering and held callback cancellation/close as appropriate.

After correction, rerun nearest contracts/configuration Worker suites, all nine original advisor probes and original configuration-close/preparation/summary/effect/credential behavior. Run contracts, brain, credentials, runtime and repository gates sequentially in the same sanitized environment. Preserve exact source hashes/archive and actual request/race observations. Return READY FOR REVIEW, not independent acceptance or full-plan completion.

## Observations that are not rejection grounds

An equal desired/current Pi selection can complete a pending intent on reopen without replay. This is intentional postcondition recovery under the documented configuration contract. It does not prove a specific historical configure call occurred, but configuration is not a provider side effect; the observed equal-state case alone is not an acceptance blocker.

The product reviewer noted that selection-free fixture reads still call credential status before ignoring its result. An unavailable status RPC could affect receipt-read availability. No failure was reproduced and production remains unavailable. This does not justify unrelated availability work in the correction.

Fixture-owned RPC context is not cookie or hosted authentication evidence. The executor states that limit. Production configuration/discovery/transport, retained activation, UI and hosted checks remain unavailable; PD38 is not run. No distributed transaction or exactly-once billing is claimed. No install, credentials inspection, live account/provider call, billing/model fallback, deployment, shared DB change, staging, commit or integration is authorized.
