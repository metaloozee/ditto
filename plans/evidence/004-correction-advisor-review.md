# 004 first correction advisor review

Disposition: **not accepted.** The first correction repairs the observed asynchronous transaction sharing and adds targeted host protections. Independent broad gates pass, but two additional metadata-integrity probes fail in actual workerd. 004 and 005 remain blocked. The independent host review has completed. The advisor verified its cited code and independently reproduced two further host failures. It also reported an isolation violation affecting ignored main-checkout dependency links, recorded below.

Execution worktree `/tmp/ditto-plan-004-vO7JVp`, base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. Correction executor and independent host reviewer use `xai/grok-4.7` with Medium reasoning. The original executor conversation handle had expired, so correction used a fresh executor in the preserved worktree with the complete incoming review. No source is integrated or committed. Advisor writes remain under `plans/`.

## Reviewed correction

Read the complete corrected storage implementation, private-field helper, complete storage and correction tests, and incremental host diff against `node_modules/004-correction-baseline/pi-durable-host.ts`. The storage implementation now prepares ciphertext and document snapshots outside a transaction, then rechecks the snapshot and applies SQL in a short `transactionSync`. An admitted-operation chain serializes public reads and commits. Close seals admission and joins every admitted promise. No synchronous transaction callback awaits crypto. This addresses the first candidate's unrelated safety rollback, uncommitted reads and incomplete close draining.

Targeted permanent tests cover those changes and public Stop epoch/control survival. They correctly avoid prescribing whether queued Stop is briefly stopping or already canceled. Additional tests reject digest-only substitution and plaintext selection downgrade, check one mismatched effect route, and show that a failed retry queue leaves a persisted fence. The inherited plaintext L1/effects scenarios were rerun, not claimed as encrypted coverage. The full applicable encrypted L1 matrix is still missing.

## Additional confirmed storage-integrity blockers

### 1. Document revision definition version is not authenticated

Evidence: `apps/runtime/src/pi-durable-storage.ts:1108-1133,1384-1432,1605-1638`. `document_revisions.version` remains a plaintext column. The ciphertext body encrypts only the base value or delta operations, with AAD bound to document ID and sequence, not revision kind/definition version. Reopen decrypts the body without checking these interpretation fields. Materialization returns the unverified column as `StoredDocument.version`.

The advisor created a version-1 synthetic document, closed storage, changed only its revision version to 99, and reopened with the correct key. Reopen and materialization succeeded. The original semantic value was returned labeled version 99. No ciphertext was modified. This violates fail-closed interpretation/version requirements; encryption of the value alone does not authenticate the version used to interpret it.

Bind revision kind/version to its authenticated representation or AAD and validate the indexed metadata before use. Preserve document history and exact copy semantics, and fail closed on incompatible old adapter formats rather than silently reading a changed format.

### 2. Indexed Pi record routing is not checked against authenticated records

Evidence: `apps/runtime/src/pi-durable-storage.ts:946-1012,1605-1638`. `verifyAll` decrypts each entry record, but never compares `entries.conversation_id`, head or commit sequence with the authenticated representation. Scans select rows by the plaintext routing column.

The advisor created an authenticated entry in the root conversation, closed storage, changed only `entries.conversation_id` to 999, and reopened with the correct key. Open and root scan both succeeded. The root's previously authenticated history was silently omitted instead of producing an integrity failure. This is a metadata mutation, not supported conversation retirement or a valid caller transition.

Apply the same consistency discipline to the queryable columns of conversations, tasks, submissions, documents and revisions. Routing metadata may remain queryable; that does not permit tampering to change canonical meaning or hide retained work undetected. Check it on passive reopen and at the live owning read/admission boundary. Structural values absent from the encrypted record need an authenticated representation, not an unchecked copy.

## Additional confirmed host blockers

### 3. Normal correlated admission adds an unverifiable cache key

Evidence: `apps/runtime/src/pi-durable-host.ts:639-656,1289-1290,1369-1374,2213,2519`. Admission calls `rememberPlain` both for the qualified correlation record ID and for the bare logical effect ID. Only the qualified record ID has a matching `host_seal` row. `assertSeals` requires a seal for every plaintext-cache key.

The independent reviewer used the actual mandatory guarded provider fixture, not an unguarded static dependency. The advisor read and reran its positive diagnostic. The first correlated request reached provider I/O. Afterward public `expire()` threw `Storage integrity failure`, and the only unsealed cache key was the bare effect ID. The same verifier guards scheduling and future exact admission. Normal encrypted execution therefore poisons its own verification state and prevents subsequent deadline/transition handling. Earlier correction tests mostly use an unguarded fixture and missed this basic encrypted path.

Remove nonpersistent aliases from the authenticated-record inventory, or separate them explicitly without exempting real persisted records from validation. Add a real guarded encrypted turn that reaches deadlines, subsequent work and settlement without false integrity failure.

### 4. Live host ciphertext changes are ignored by cached verification

Evidence: `apps/runtime/src/pi-durable-host.ts:639-663,880-883,1369-1374`. `assertSeals` compares cached plaintext digests with seal rows; it does not compare the current persisted ciphertext. `opened` ignores its ciphertext argument and returns cached plaintext. Selection validation checks the envelope shape, then also returns cache. The inbox submission path independently decrypts its captured ciphertext and is correctly protected.

The reviewer used the authority-preparation seam to replace same-record correlation and selection ciphertext after open while leaving their seal digests unchanged. The advisor read and independently reran this positive diagnostic. The persisted replacement was inconsistent with the cached plaintext and seals, yet the mandatory provider still dispatched. Cache values did not contain the replacement content. This is not demonstrated command substitution; it proves that a live persisted-content change is ignored rather than failing authentication/consistency before I/O. Same-record valid re-encryption is synthetic test injection, not evidence that an attacker possesses the encryption key.

Track and validate the current stored envelopes as well as their authenticated meaning. Re-decrypt changed values and fail closed, or use an equivalent verified-ciphertext/version snapshot with mutable checks immediately before admission. Cover ciphertext swaps and corrupted envelopes for correlation, prepared task selection/state, result and retry evidence, not only inbox.

The reviewer did not reproduce four further probes concerning a second bind, route-driven settlement, retry-queue admission and tool execution. Do not promote those to findings. They do not replace the missing encrypted L1 matrix.

## Reviewer isolation incident

Despite explicit read-only/worktree-only instructions, the reviewer first invoked `pnpm --filter @ditto/runtime exec vitest ...` without changing directory from `/home/ayan/ditto`. Under pnpm's dependency-status handling, that command launched an automatic install and printed `Recreating /home/ayan/ditto/node_modules`, then failed. The reviewer subsequently ran unauthorized `cd /home/ayan/ditto && pnpm install --offline --ignore-scripts --lockfile-only=false`; it failed with a missing pinned package tarball. These actions violated the execution boundaries.

The advisor inspected the actual tool-call records and results, rather than relying only on the reviewer's final admission. Main-checkout top-level dependency links and workspace binary directories are now missing. Tracked application source, lockfile and configuration show no reviewer edits. The original dependency state was not fully inventoried, so full ignored-artifact preservation cannot be claimed. The disposable execution worktree remains independently runnable and its reviewed source hashes are unchanged.

No main-checkout dependency repair was attempted by the advisor. Repair requires explicit user approval for the named target `/home/ayan/ditto/node_modules` and affected workspace dependency links. Do not delete caches, source, worktrees or historical artifacts. Subsequent executors must use an explicit absolute worktree directory assertion before every command and must never attempt main-checkout installs or repair.

## Independent verification

Commands ran only inside the disposable worktree under `env -i`, explicit installed Node/pnpm PATH, `CI=1`, `NO_COLOR=1` and isolated `HOME=$PWD/node_modules/004-correction-advisor-logs/home`. No live effects, inherited credentials, staging or source edits.

| Command/check | Result | Evidence |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0; both runtime typechecks, 6 Node checks and 159 Worker tests in 8 files | `node_modules/004-correction-advisor-logs/runtime.log` |
| `pnpm verify` | passed, exit 0; Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build | `node_modules/004-correction-advisor-logs/verify.log` |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/004-correction-advisor-probes.config.ts --reporter=verbose` | failed, exit 1; two integrity cases fail, one actual SQL rollback case passes | `node_modules/004-correction-advisor-logs/probes.log` |
| Host review config with filter `inbox ciphertext swap\|performs provider I/O\|next encrypted deadline` | passed as a diagnostic, exit 0; two positive bug reproductions and one correct inbox-denial control, four unsupported follow-ups skipped. This is not safety acceptance | `node_modules/004-correction-advisor-logs/host-probes.log` |
| Actual SQL failure during synchronous batch application | passed; second insert violates a synthetic unique index after the first entry/id writes. Rollback removes both entries and their ID claims, leaves sequence unchanged, and stays absent after reopen | Same probe log |
| Source preservation and `git diff --check` | passed; all five recorded source/test hashes match through independent gates | `node_modules/004-correction-advisor-logs/source-before.sha256` |
| Complete encrypted L1 matrix | not run | Executor explicitly reports partial retained coverage |
| Brain/contracts/hosted/provider/product/Docker/browser/complete L2 | not run | Unchanged shared inputs or outside core review |

Executor's first full runtime run failed one wall-clock close-overrun case; its second run passed. The advisor's full run passes. Preserve the failed log rather than call both executor runs green. This review does not establish that the timing-dependent failure is repaired or deterministic.

## Contract disposition

The new implementation uses public Pi `Storage`, not the stock `SqliteDatabase` facade. The public Storage interface exposes no transaction handle. Therefore post-callback handle reuse is not an available caller operation, and retaining a generic raw-SQL callback just to test an expired handle would add a different interface rather than prove the selected contract. The advisor independently established rollback after actual partial SQL application, not only rejection before SQL.

The executor still lists platform commit/rollback-failure injection as unresolved. The next evidence update must distinguish applicable adapter failure guarantees from an unexposed facade contract. Do not fabricate a manual rollback API, pretend the platform's rollback itself was fault-injected, or weaken live persistence-failure admission barriers. A precise plan refresh to the selected supported contract needs advisor review; it is not permission to waive safety.

## Preserved artifacts

[`artifacts/004/corrected-candidate.diff`](artifacts/004/corrected-candidate.diff) preserves the tracked candidate diff from the base. [`artifacts/004/corrected-candidate.tar.gz`](artifacts/004/corrected-candidate.tar.gz) retains full candidate source/tests/config, the executor incremental baseline/evidence/logs, advisor probes and independent logs. CLI HOME is excluded. `gzip -t` passed. Archive SHA-256 `8d71854919d7161c02c4d1dde131b3a8e2f793b38cadc58aef48f129ce44f453`; diff SHA-256 `b3a2fdbc13f40ad7234cd30020e2f3c96973685f6246305d719aeb85a8c7b817`. [`artifacts/004/correction-host-review.tar.gz`](artifacts/004/correction-host-review.tar.gz) retains the additional reviewer probes/logs and independent three-case rerun. `gzip -t` passed; SHA-256 `b278496f4e89b25002c8a268473693f306deff59eebfe6668a054ce26b58fc5a`. The sanitized isolation command/result record is [`artifacts/004/reviewer-isolation-incident.md`](artifacts/004/reviewer-isolation-incident.md). Earlier archives are unchanged. No worktree cleanup is authorized.

## Next correction

Authenticate revision interpretation metadata and validate queryable Pi metadata against authenticated state on reopen/use. Add permanent tests for both observed failures and metadata-family variants. Complete the relevant encrypted L1 scenarios with the actual mandatory adapters, not only static fixture rows and direct private-queue replacement. Record the transaction-contract disposition accurately. Correct the two verified host failures together with the storage metadata failures. The host reader has finished, so the next isolated executor will not race that review. Preserve all failing/positive-diagnostic evidence, including the isolation incident. No architecture decision or operational approval is implied by this correction scope.
