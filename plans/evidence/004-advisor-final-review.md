# 004 final advisor review

Disposition: **DONE for the independently reviewed local core-storage gate.** The corrected candidate is accepted for plan 004, not integrated. Plan 005's exact history and large-record work, complete L2 acceptance, hosted execution and product enablement have not passed.

Reviewed base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. Source remains uncommitted in `/tmp/ditto-plan-004-vO7JVp`. The executor used `xai/grok-4.7`, Medium reasoning. The preceding independent host reader used the same model and reasoning. Advisor implementation changes remain prohibited; advisor writes are under `plans/` only.

## Acceptance basis

The counter correction changes only `apps/runtime/src/pi-durable-storage.ts` and its test file, plus plan/evidence text. Compared every implementation/test increment with the mirrored `node_modules/004-counter-correction-baseline/apps/runtime/` files. Host, private-field helper, effects tests, host tests, encrypted-correction tests and runtime test configuration are byte-identical to the independently reviewed second correction. The first diff lookup used an incorrect flattened baseline path; the actual diff is preserved as `storage-increment-v2.diff`, not represented by the empty first lookup artifact.

Storage format is **3**, adapter compatibility `ditto-encrypted-storage-3`, crypto format 1. Old adapter/storage formats fail closed without migration. `durable_metadata` holds one authenticated counter envelope alongside its structural `next_id` and `next_seq` columns. Owner, workspace session and the counter pair enter AAD. Decryption must produce the exact canonical counter representation. Legal-range and retained-record lower-bound checks supplement authentication; they do not replace it. Empty and task-only commits still consume sequences even when no entry/revision records that sequence.

Counter metadata and ciphertext enter both the index token and commit snapshot. Reads, minting and commits verify changed metadata. Commit prepares the successor envelope from the verified snapshot outside the transaction, then rechecks before applying SQL. Its counter update, records and ID claims share one short synchronous transaction. Uncommitted minted IDs remain in memory and may be reminted after close/reopen. Honest committed gaps remain supported. Missing initial authentication is not silently synthesized on a later open.

The prior independently failing counter probes now pass unchanged. A regressed sequence cannot acquire a new valid commit tag, and a regressed ID cannot be minted into an existing task checkpoint. Permanent cases also cover live read/mint/commit corruption, counter-envelope/column mismatches, malformed/noncanonical/unsafe values, format rejection, changes during asynchronous encryption, honest gaps, empty/task-only commits, SQL rollback and reopen.

The advisor added a stronger independent atomicity probe under `plans/evidence/004-counter-advisor-atomic-probe.test.ts`. A wrapper delegates to the actual DO `transactionSync`, invokes the adapter's synchronous callback, witnesses the new entry, ID claim and changed counter envelope/columns inside that transaction, then throws before the callback returns. Workerd rolls all of them back. Reopen finds no entry, the old counter row is unchanged, and the uncommitted ID is reminted. This proves rollback after the counter update was applied, not just failure before it. It does not pretend to inject a platform commit failure after a successful callback.

All earlier repairs remain covered: public reads cannot see an entry from a subsequently rejected batch, a Pi failure cannot erase unrelated safety writes or public Stop receipts, close joins admitted operations, revision interpretation and indexed record routing authenticate correctly, and the host rejects live private-envelope changes before guarded I/O. Honest guarded encrypted turns no longer poison their own seal inventory. Retry sealing failures persist uncertainty and fence before close rather than authorizing a new attempt.

## Independent verification

Every verification command explicitly changed to `/tmp/ditto-plan-004-vO7JVp` and asserted its physical cwd. Commands used `env -i`, installed Node/pnpm paths, isolated CLI HOME, `CI=1`, and `NO_COLOR=1`. Corepack fetched the configured pnpm 11.8.0 executable into that isolated HOME cache. There was no repository dependency install, lockfile change, live provider call, main-checkout dependency repair, staging or commit.

| Check | Result | Log under `node_modules/004-counter-advisor-logs/` |
|---|---|---|
| `pnpm runtime:verify` | exit 0; both runtime typechecks, 6 Node checks, 182 Worker tests in 8 files | `runtime.log` |
| `pnpm verify` | exit 0; Biome 36 warnings and 1 info, web typecheck/build and 808 tests, runner typecheck/build and 79 tests | `verify.log` |
| Original counter safe-invariant probes | exit 0; 2 tests | `counter-probes.log` |
| Independent guarded host probes v3 | exit 0; 6 tests | `host-probes.log` |
| Additional original L1 regressions with retained binding and preserved mutable dependency object | exit 0; 31 passed, 22 excluded | `extra-encrypted-l1.log` |
| Independent rejection after complete SQL/counter application | exit 0; 1 test | `atomic-probe.log` |
| Prior metadata tamper and actual partial-SQL rollback probes | exit 0; 3 tests | `prior-storage-probes.log` |
| Eight source/test/config hashes and `git diff --check` | pass | `source-before.sha256` |

The 31 additional encrypted L1 checks include unsafe Pi recovery, both persistence crash orders, unavailable failure markers, conflicting results, tool replay policy, priority/held-preparation/uncooperative Stop, fixed deadlines, lost submit acknowledgment, completed IDs/context, native alarm settlement and no-work rearm, mixed producers, authority/competition changes, final compaction errors, tool/summary reservation, response-only expiry and trusted takeover. The focused host probes independently isolate correlation, selection and prepared-envelope swaps, exact committed summary retry after reopen, unknown summary denial across two reopens and original-result idempotence. The excluded cases include already-run permanent encrypted cases and tests whose SQL assertions expect plaintext bodies; they are not claimed as unchanged encrypted tests.

Executor initial typecheck and formatting failures remain preserved separately from its passing reruns. Historical rejected candidates, positive bug diagnostics, advisor probe defects, close-overrun timing evidence and isolated-storage cleanup failures remain historical evidence, not overwritten passes or claimed framework fixes. The supported runtime still falls back from requested compatibility date `2026-09-16` to effective `2026-03-10`. This is local workerd evidence only.

## Contract and limits

The pinned public Pi Storage exposes atomic `commit` and a sequence, not a transaction handle or async callback. Expired raw-SQL callback handles and failure of platform commit/rollback after a successful synchronous callback are not injectable operations on that selected contract. Their applicability is resolved without adding a different interface or waiving live persistence barriers. Actual synchronous application failure, ordering, safety-write independence and close draining are demonstrated.

Authentication establishes the counter pair's identity and meaning, not general freshness against replay of previously valid same-record ciphertext or database snapshots. No general partial/full database anti-rollback guarantee is claimed. Safety receipts remain separately runtime-owned and must not be rewound with Pi history.

005 still owns exact document history, oversized state, verified external references and final key-retention/size acceptance. Chunked crypto and existing conformance coverage are not complete PD19 or L2 acceptance. No product enablement, legacy import, deployment, hosted date proof, live-provider validation or Docker/browser test is included. Shared brain inputs did not change, so brain verification was not run.

The executor transcript records 40 bash calls, each with the required exact worktree cwd assertion, and no explicit install command. Its write/edit tool calls target only the two storage files and plan/evidence text. Main tracked application source, lockfile and configuration remain unchanged. The earlier reviewer damaged ignored main dependency links; that incident is still recorded and repair remains unapproved.

## Preserved candidate

[`artifacts/004/accepted-core-candidate.diff`](artifacts/004/accepted-core-candidate.diff) preserves the tracked diff from the base. [`artifacts/004/accepted-core-candidate.tar.gz`](artifacts/004/accepted-core-candidate.tar.gz) retains complete candidate implementation/tests/config, counter baseline, executor evidence/logs and advisor probes/logs. It excludes CLI HOME. `gzip -t` passes.

- Archive SHA-256 `c9891d84d01b899030ac7ed2b0561b63850c26d4746bc14d5a2f8c911819b5da`.
- Diff SHA-256 `4a5e61433738e3053749818e4523f079f1802b74fa7c394039eccd5961185ca9`.
- Exact reviewed source identities are in [`artifacts/004/accepted-core-source.sha256`](artifacts/004/accepted-core-source.sha256).

The second-correction rejected archive and diff still match their recorded hashes. Earlier archives and the [reviewer isolation incident](artifacts/004/reviewer-isolation-incident.md) are unchanged. Executor evidence is copied to [004-counter-correction.md](004-counter-correction.md). Read the [first review](004-advisor-review.md), [first correction review](004-correction-advisor-review.md) and [second correction review](004-second-correction-advisor-review.md) for the rejected candidates and counterexamples.

## Next handoff

No further 004 correction is required for this reviewed core gate. Integration, staging, commits, worktree cleanup and main dependency repair still require separate authorization. Preserve `/tmp/ditto-plan-004-vO7JVp` and integrate exactly the reviewed source if requested. 005 is ready to be planned against that integrated implementation, but is not executed or accepted by this review. Complete L2 remains pending.
