# 004 second correction advisor review

Disposition: **not accepted.** The four first-correction blockers are repaired and independently tested. Two additional counter-integrity failures remain in actual workerd. 004 and 005 remain blocked. Source remains uncommitted in `/tmp/ditto-plan-004-vO7JVp`, at base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. No implementation is integrated into the main checkout.

The second executor and independent host reader used `xai/grok-4.7`, Medium reasoning. Advisor source changes remain prohibited. The host reader's transcript records 18 read calls and 18 grep calls, all against the disposable worktree. It ran no test, install or mutation. Main-checkout dependency repair remains unapproved and was not attempted.

## Reviewed corrections

Compared storage and host increments with `node_modules/004-second-correction-baseline/`, read the changed implementation and permanent tests, and reviewed the host/test/config diff from the base. Format 2 authenticates entry commit sequences and document revision sequence/kind/version. The index verifier compares queryable columns with authenticated records before scans and checks its token inside the synchronous commit callback. Plaintext aliases no longer enter the host seal inventory. Current ciphertext envelopes are compared with verified envelopes before dispatch and when private fields are read.

Independent reruns of the prior three storage probes pass. They prove actual partial-SQL rollback, rejection of revision-version tampering and rejection of history-routing tampering. Independent host probes isolate correlation, selection and prepared-envelope changes, each with no unauthorized provider I/O. Honest guarded model/tool execution and `expire()` pass. Retry failures use the actual capture queue, leave a pending durable intent, and fence before close; reopen denies missing evidence. The host reader found no additional confirmed host blocker. Its dispatch, retry-failure and fence claims were checked against the current source.

Meaningful encrypted L1 coverage now exists through the mandatory adapters. Besides the candidate's permanent encrypted tests, 31 original L1 regressions passed with a retained binding injected into `PiDurableHost.open`, preserving the same mutable dependency object. Those include unsafe Pi recovery, unavailable safety writes, both crash orders, conflicting results, tool replay policy, priority/held-preparation/uncooperative Stop, fixed recovery deadlines, lost submit acknowledgment, alarm settlement/no-work rearm, completed history, mixed producers, authority/competition changes, final compaction errors, the tool/summary reservation race, response-only expiry and trusted takeover. Six independent host cases also pass, including exact summary retry after reopen, unknown summary denial through two reopens and duplicate delivery of the original plaintext evidence. This is not a claim that every plaintext SQL assertion was mechanically run unchanged on ciphertext.

## Confirmed remaining blockers

### 1. A regressed durable sequence is accepted and reused

Evidence: `apps/runtime/src/pi-durable-storage.ts:456-469,485-506,1052-1064,1136-1138,1206,1284-1289,1665-1744`. `durable_metadata.next_seq` is read as a safe integer but has no authenticated representation or consistency check. The new index token omits the metadata row. Commit encrypts entries/revisions using the supplied counter, then increments it atomically. Snapshot rechecks establish that the corrupt counter stayed unchanged, not that it was valid.

The advisor committed root conversation sequence 1 and an entry at sequence 2, closed, changed only `next_seq` to 1, reopened with the correct binding and committed another entry. Open succeeded and the new commit returned sequence **1**, earlier than the already authenticated sequence **2**. No ciphertext, key or authenticated entry was altered. The new ciphertext authenticates the regressed sequence supplied by the corrupt metadata. This violates ordering and lets corrupted structural state acquire a new valid authentication tag.

### 2. A regressed durable ID is minted and overwrites an existing task

Evidence: `apps/runtime/src/pi-durable-storage.ts:456-469,515-519,1248-1266,1477-1483,1490-1535,1665-1744`. Open initializes `nextId` directly from plaintext `next_id`. `mintId` checks only safe-integer exhaustion. Existing task/submission IDs are intentionally upsertable for legitimate Pi updates, so global-ID checking does not distinguish a newly minted collision from an update.

The advisor persisted a running `pi.tool` task at ID **2**, with an authenticated original execution checkpoint, and closed. After changing only `next_id` to `2`, reopen succeeded, `mintId<TaskId>()` returned **2**, and the next supported task commit replaced that original checkpoint with a new one. The read returned `{ phase: 'execute', replacement: true }`. This is not merely an eventual uniqueness error on immutable entries. A corrupt counter causes newly allocated work to silently overwrite retained mutable work.

Both probes assert the safe invariant and fail on this candidate. They are not positive tests being counted as security acceptance. They mutate one structural column and then use public Storage calls, not private Pi APIs or whole-database replay. Complete database rollback resistance is not being demanded.

## Required correction

Protect the canonical counter pair against isolated corruption at passive open and live owning boundaries. Keep the counters in the existing storage schema, not a second transcript or scheduler. Authenticate their persisted interpretation, validate legal ranges and consistency with retained IDs/sequences, and update their authenticated representation in the same short synchronous batch as the records and ID claims. Do not silently clamp corrupt counters or rely only on maxima of entries/documents: task-only and empty commits also consume sequences. A lower bound alone does not authenticate corruption that moves counters forward.

Preserve honest minted-but-uncommitted IDs, gaps and reopen behavior required by the pinned public conformance contract. Preserve the pre-encryption/snapshot/apply protocol, public-operation serialization, close draining and safety/Pi independence. Check counter changes that occur during async preparation before SQL application. A failure after partial application must roll back the counters' authenticated representation along with records. No async transaction callback, manual transaction SQL, fork or platform rollback API is authorized.

Add permanent real-DO tests for these two counterexamples, live corruption, malformed/noncanonical/unsafe counter values, empty and task-only commits, honest gaps, rollback and reopen. Preserve existing failures and all earlier candidate/probe records. This is a correction to the decided storage-integrity contract, not a new architecture decision.

## Independent verification

All commands explicitly changed to `/tmp/ditto-plan-004-vO7JVp` and asserted its physical cwd. They used `env -i`, installed Node/pnpm paths, isolated CLI HOME, `CI=1` and `NO_COLOR=1`. No installs or live effects were used.

| Check | Result | Log under `node_modules/004-second-correction-advisor-logs/` |
|---|---|---|
| `pnpm runtime:verify` | exit 0; both runtime typechecks, 6 Node checks, 174 Worker tests in 8 files | `runtime.log` |
| `pnpm verify` | exit 0; Biome 36 warnings and 1 info, web types/build and 808 tests, runner types/build and 79 tests | `verify.log` |
| Prior storage counterexamples and actual SQL rollback | exit 0; 3 tests | `prior-storage-counterexamples.log` |
| Additional original L1 tests with preserved dependency object and retained binding | exit 0; 31 tests, 22 deliberately excluded cases including already-run encrypted tests and plaintext SQL-body assertions | `extra-encrypted-l1-preserved.log` |
| Independent host probes v3 | exit 0; 6 tests | `host-probes-v3.log` |
| Counter-integrity probes | exit 1; both safe-invariant tests fail | `counter-probes.log` |
| Source hashes and `git diff --check` | pass; six recorded implementation/test hashes unchanged through all checks | `source-before.sha256` |

The first advisor extra-L1 setup cloned the dependency object and severed later authority/preparation replacements. Its race timed out at 5 seconds and again at 20 seconds. These failed logs and the faulty setup remain preserved. The corrected separate setup preserves the original object; the race and 30 other tests pass. This is a probe defect, not a host deadlock.

Host-probe v1 attempted compaction after its prepared-envelope mutation had already denied the original request. V2 reconciled the original run to terminal before asking for live compaction. Both failed experiments remain preserved. V3 finishes baseline generation without reconciliation, then mutates the compaction preparation. It passes without weakening the no-I/O assertions.

The executor's initial runtime typecheck failure is preserved separately from its passing rerun. Installed workerd still falls back from requested compatibility date `2026-09-16` to effective `2026-03-10`. No hosted date, product enablement, live provider, Docker/browser, brain-input change, complete history/large-reference or full L2 acceptance is claimed.

## Contract and artifacts

The selected public Pi Storage exposes atomic `commit`, not transaction handles or async callbacks. Expired raw-SQL callback handles and platform commit/rollback failure after a successful `transactionSync` callback are not injectable caller operations here. This resolves their applicability without claiming a simulated platform failure. Actual partial SQL failure, close draining, non-rewindable safety writes and persistence admission barriers remain required and tested.

[`artifacts/004/second-corrected-candidate.diff`](artifacts/004/second-corrected-candidate.diff) preserves the tracked diff from base. [`artifacts/004/second-corrected-candidate.tar.gz`](artifacts/004/second-corrected-candidate.tar.gz) preserves full candidate implementation/tests/config, the second baseline, executor evidence/logs and all new advisor probes/logs, including failed experiments. CLI HOME is excluded. `gzip -t` passes. Archive SHA-256 `3a62fae8501540481c7a3dbeb95531a4acf643dc2f9e671dad3111a2a0239fc4`. Diff SHA-256 `c52d9528fe0f35eddc08685432c7d74ab8cb3d5f0f155ba17f3690e52311f239`. Earlier archives and the reviewer isolation incident remain unchanged.

Next execution is limited to the counter correction and its tests/evidence in the same preserved worktree. Do not integrate, stage, commit, install, deploy or clean up. Main-checkout dependency repair still needs separate approval.
