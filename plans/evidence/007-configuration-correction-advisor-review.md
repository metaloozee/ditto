# 007 configuration correction advisor review

Disposition: NOT ACCEPTED pending reliable aggregate verification. The two functional reproductions are fixed in the current candidate, and all five unchanged acceptance probes pass independently. However, both independent credential and repository gates fail at the unchanged 5-second limits. Full 007 remains NOT DONE.

## Reviewed candidate

The executor changed only `apps/runtime/src/pi-durable-host.ts` and `apps/credential-tests/src/codex-request-contract.worker.test.ts` relative to the preserved 34-file configuration baseline. The advisor inspected every correction hunk and the surrounding configuration/retained-state implementation. All 34 current source hashes match `configuration-correction/source.sha256`; archive SHA-256 is `dd7d3180ca631b342fadd63fd960dd54b7fba182d431bde1ea204b7f5a049f96`, and correction patch SHA-256 is `b41f834b685f7b112a60ee7cf266a1f95067a07815d09c8b240799c549d036fe`. The advisor independently compared baseline archive identities and confirmed exactly those two changed files.

All six dependency graph identities match current files and HEAD. All 389 non-cache preservation identities match. Only the two generated Vitest results caches changed, as the executor explicitly recorded. No original probe, configuration, red log, fixture copy, archive or patch changed. Whitespace passes and staging is empty. Source remains dirty, uncommitted and unintegrated in the same detached worktree at base `0ccc5b20c25a4e63017b3eebf6608dba62253479`.

## Functional correction observations

- Configuration product work and ledger authentication now finish before the fresh final local-authority read and synchronous local checks. The four unchanged held-product authority/capacity probes return denied and retain the exact persisted Pi fingerprint in both encryption modes.
- Ledger validation now scans every row, including apparently complete rows, authenticates identity/payload/phase, and compares rows after hashing plus the complete inventory after validation. Recovery, duplicate lookup and pending blocking consume authenticated evidence. The unchanged encrypted phase-flip probe rejects reopen without changing Pi or repairing the corrupt evidence.
- The 128-entry identity memo caches only canonical cryptographic identity results, not authority or ledger validation. Current row content and metadata remain checked. The registered correction cases add current/capacity/active-generation, default initialization, bounded close and a pending/complete corruption matrix.
- Supported Pi configuration follows ordered admission. This is not D1/Pi distributed atomicity or historical configure-call provenance. Mutable provider entitlement is still checked independently at request admission. Production configuration/discovery/transport remains unavailable.

These observations do not waive the aggregate gate failures below.

## Independent commands and results

Commands ran under `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. No test deadline changed. Logs are preserved in main and worktree `plans/evidence/artifacts/007/configuration-correction-advisor/`.

| Gate | Independent result |
| --- | --- |
| Unchanged new configuration acceptance probes | 5 passed, 114 explicitly filtered skips |
| Original model/host/product probes | 4 + 3 + 2 passed; product command explicitly filtered 140 imported cases |
| `contracts:verify` | 25 tests, typecheck and build passed |
| `brain:verify` | 43 brain tests, contracts 25 and freshness 3 with 3 filtered skips; typechecks/builds passed |
| `credentials:verify` | FAILED, 161 passed and one 5-second timeout |
| Focused timeout case | 1 passed, 139 explicitly filtered skips; not aggregate acceptance |
| `runtime:verify` | 387 Worker tests and 6 Node checks passed, including original configuration-close cases |
| `verify` | FAILED during credential verification, 160 passed and two 5-second timeouts; later web/runner/build stages did not complete |

The first chain stopped at the failed credential gate. The advisor then ran the single failed case, followed by runtime and repository verification to establish whether the issue was isolated. It was not. The executor also records earlier timeouts in this area before its eventual passing fourth sequence. A passing focused case or another attempt until green does not establish reliable aggregate verification.

### Exact failures

`credentials.log` reports:

- `configuration correction: authenticates complete payload_digest before new-intent`, observed test duration 5819 ms, limit 5000 ms.

`repository.log` reports:

- `actual custom_summary preparation survives close/reopen with an owned selection change`, the existing mandatory-adapter retained-summary case.
- `configuration correction: authenticates complete outcome before new-intent`.

Both repository failures are test timeouts at 5000 ms. Full-suite complete-record cases are commonly near the limit, and an original preparation regression also crosses it. `timeout-focused.log` passes the first case alone. No semantic assertion failure was established in these runs; no harmless environmental cause was established either.

## Required narrow follow-up

Diagnose and correct aggregate timing without weakening the safety/evidence assertions or increasing deadlines. Use actual host/D1/RPC/Pi paths. Measure setup, product/local reads, ledger scans, supported Pi persistence and close to locate unnecessary work rather than assuming the timeout cause. The current configuration path repeatedly performs product/local authority checks and complete-ledger validation. Any optimization must retain fresh final local admission and authenticated current metadata before every decision; cached authority or unvalidated phase is not acceptable.

Keep the five acceptance probes, nine original probes, old fixture copies and red logs unchanged. Preserve both independently failing aggregate logs before editing. Existing configuration/default/idempotency/ownership/preparation/summary/credential assertions and original fixture defaults stay intact. Test-only fixture overhead may be removed if measurements show it is unrelated to the behavior being asserted; explicitly account for what was removed. Do not skip tests, filter aggregate gates, increase timeouts, retry until green, or relax bounded close to obtain a pass.

After the narrow change, demonstrate the original failing cases both alone and in the complete unfiltered credential suite. Then run the required contracts, brain, credentials, runtime and repository sequence under the same sanitized environment. A second clean unfiltered credential run should establish that the observed instability is actually corrected. Preserve earlier failures and report exact counts, timings, source diff/hashes and measured cause. Return READY FOR REVIEW or a precise BLOCKED result, not independent acceptance.

No install, credential/auth inspection or repair, live network/provider/account request, model/billing fallback, UI, retained activation, shared DB mutation, deployment, stage/commit/push/integration or worktree deletion is authorized. Main source remains read-only. PD38 remains not run.
