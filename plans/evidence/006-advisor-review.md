# 006 initial advisor review

Verdict: BLOCKED for acceptance. The fixture candidate needs correction. No source integration, staging or commit is authorized or performed.

Reviewed base: `ef172efdfdc575247e39a953ed1b6f74c0d8cead`. Candidate: uncommitted changes in `/tmp/ditto-plan-006-o6dok7`. The candidate's implementation remains intact in that detached worktree. [Source identities and review artifacts](artifacts/006/initial-advisor-review/) preserve the exact inspected file hashes, independent gate logs and failing regression probes.

The separate executor and independent reviewer used `openai/gpt-6.1-sol` with medium reasoning. The reviewer returned partial findings before a provider safety error. The advisor read its probe, independently reproduced both reported counterexamples, and wrote separate regression assertions. This is not a completed independent-review pass.

## Independent checks

Commands ran sequentially in the execution worktree, without installation or source edits. Aggregate checks used:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm credentials:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm runtime:verify
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm verify
```

| Check | Result |
|---|---|
| `credentials:verify` | passed: typecheck, 17 actual Worker/SQLite tests and 3 standalone Node/workerd tests |
| `runtime:verify` | passed: typechecks, 208 Worker tests and 6 Node checks |
| `verify` | passed: repository checks/typecheck, credential tests, 815 web tests, web build, 79 runner tests, runner typecheck/build |
| Source hash recheck | passed: all 24 candidate implementation/configuration/migration/test files unchanged during review |
| Migration snapshot comparison | passed: only `codex_connections` added; existing tables and other schema metadata unchanged; predecessor snapshot ID matches |
| `git diff --check` | passed |
| Accepted credential envelope roundtrip regression | failed |
| Current credential record revision regression | failed |
| Actual Codex authentication/discovery/renewal/inference, PD38 | not run |
| Hosted service identity, eviction, provider networking, deployment and billing | not run |
| New real-cookie HTTP authentication smoke | not run; tests inject user identity |

The inherited warnings remain warnings. The executor's prior concurrent runtime assertion failure remains historical evidence, not hidden by the sequential passing rerun. Passing aggregate suites do not override the failing counterexamples below.

## Required corrections

### 1. Authenticate the current token-record revision

Evidence: `apps/web/src/lib/codex-credential-crypto.ts:25–27`, `apps/web/src/lib/codex-credential-do.ts:193–207,223–245`.

The encrypted record authenticates owner, constant token-record name, connection generation and format version, but not its current replacement revision. After a successful rotation, replacing only `sealed` with the earlier valid envelope succeeds while the current connection generation, renewal counter, status and projection version stay unchanged. The fixture DO then dispatches the previously spent refresh token again.

The advisor's real local workerd/SQLite regression confirms unchanged metadata before reading and observes two refresh dispatches where its assertion permits only one:

```sh
node --test plans/evidence/006-advisor-record-revision-probe.mjs
# exit 1: previously spent fixture refresh was dispatched again, 2 !== 1
```

This is a narrow storage-substitution counterexample, not a public RPC exploit or a claim that ordinary concurrent renewal fails. Production installation and renewal remain disabled. It also does not establish whole-database rollback protection.

Bind encryption/decryption to the expected current token-record revision and atomically commit that revision with the replacement. Keep renewal intent, connection generation and projection ordering coherent. An earlier envelope substituted into a current record must fail before dispatch. Add a permanent real SQLite regression without weakening existing cross-workspace, crash, reconnect and key-history assertions. Do not assume a metadata revision stored inside the same replayed envelope independently establishes freshness.

### 2. Align encryption acceptance with persisted-envelope bounds

Evidence: `apps/web/src/lib/codex-credential-crypto.ts:46–58,80–100`.

Each token may contain up to 8192 UTF-8 bytes. Encryption does not bound the serialized envelope; decryption rejects envelopes longer than 60,000 characters. Three accepted synthetic token values with JSON escaping produce an unreadable record. The reviewer reproduced 98,523 characters using backslashes. The advisor independently reproduced 295,131 characters using control characters. Plain 8192-byte token values roundtrip successfully.

```sh
node --test plans/evidence/006-advisor-envelope-probe.mjs
# exit 1: the plain case passes; the JSON-expanded case fails with credential_integrity
```

Make accepted persistence obey a coherent plaintext/envelope bound. Reject oversized serialization before committing installation or replacement, or define a bounded format whose reader accepts every successfully persisted record. Preserve fail-closed behavior after any ambiguous upstream rotation. Add permanent tests for escaping, total serialized size, accepted roundtrip and denied-write behavior. Do not silently truncate credentials or invent provider character restrictions.

### 3. Remove unrelated lockfile resolution changes

Evidence: candidate `pnpm-lock.yaml` diff, including existing `tsx`, `vite@7.3.6`, `@expo/env` and web dependency snapshots.

Adding the isolated test importer also changes existing resolutions: `tsx` esbuild `0.28.1` to `0.28.2`, runtime/contracts Vite 7 esbuild `0.28.1` to `0.27.3`, and `@expo/env` undici `7.28.0` to `7.29.0`. These are not just new credential-test peer snapshots. No compatibility evidence requires those changes for 006.

Restore unrelated pre-existing resolutions and constrain additions to the new compatible product test package. Preserve web Vitest 4 and the accepted runtime toolchain. If the package manager cannot express the added importer without changing an existing supported resolution, stop and report that exact constraint rather than treating the extra change as approved. Any changed installed resolution needs a fresh disposable-worktree verification; do not repair the main checkout.

## Confirmed limits and rejected suspicions

The plan permits fixture persistence/renewal while Ditto's supported hosted auth flow is unresolved. Connect correctly stays unavailable. No callback/device flow, foreign static client identity, token upload, billing fallback or plan 007 model proxy was added. Current official documentation supports the contract's distinction between the local dynamic-client Responses flow and legacy Codex access; it does not prove Ditto hosted authorization.

Reviewed ownership tests and source derive public authority from the authenticated product user and reject additional owner/role fields. Credential namespace and key bindings stay product-only. Keyring/storage helpers are JavaScript-private. The production class disables fixture installation and renewal. The ordinary renewal intent and generation checks reject straightforward concurrent refresh, stale reconnect replacement and late revocation results. D1 projections are update-only and generation/revocation fenced.

The reviewer's original combined probe prints both confirmed counterexamples, then fails a separate inherited-RPC property assertion. That trailing failure is not accepted as a disclosure finding: awaiting a stub property is not sufficient to prove secret access. The advisor's separate regression probes exclude it and assert only the confirmed behavior.

No live-provider or retained-workspace guarantee is accepted. Account-capability/model transport and admitted workspace operations remain later work. Real-cookie and hosted identity checks remain explicit gaps.

## Preservation and preparation caveat

Before advisor documentation was added, `git status --short` in `/home/ayan/ditto` was empty. No tracked main-checkout source was changed by execution/review. Only files under `plans/` were written there to preserve this verdict and its artifacts. Candidate implementation remains uncommitted and unintegrated.

The executor's initial frozen install ran inherited Lefthook postinstall and reported shared-hook synchronization. Hooks can be shared across worktrees. There is no pre-install hook-byte baseline, so unchanged shared hook bytes cannot be certified. The advisor did not restore, rewrite or delete hooks. Future disposable installs must disable lifecycle scripts unless separately needed and reviewed.

No existing-environment migration application, deployment, live subscription request, reset, staging, commit, push, merge or worktree removal occurred. Keep `/tmp/ditto-plan-006-o6dok7` and its uncommitted source/evidence for correction. 006 is BLOCKED for acceptance; 007 remains BLOCKED. The earlier READY status authorized the requested fixture execution, not the resulting failed acceptance gate.
