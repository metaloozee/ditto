# 004 encrypted storage correction

Disposition: **corrected candidate, not accepted.** No DONE claim. Base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. Worktree `/tmp/ditto-plan-004-vO7JVp`. Requested model xai/grok-4.7, Medium reasoning. The incoming review is preserved at `plans/evidence/004-advisor-review.md`. Historical probes, probe configs, and advisor logs were not overwritten.

## Baseline

Before source edits, the first candidate was copied to ignored `node_modules/004-correction-baseline/`. Diff SHA-256 `9b05ab61abecad2e50cfaac33affe15b0a6799b2a2261f96ebd45b7fa5b92141`, matching the reviewed first-candidate diff. Source copies: `pi-durable-storage.ts` `35475b82388e9210bb5e76084a132d88373842635e2c816469473221a397e064`, `pi-durable-host.ts` `856185ee838bff6e07c84812bcbd8bab93a0e2301db7a15c7d104dd37452dfe1`, `host-private.ts` `b561605c2bf0aec3e9fb912c505e6aa4f30dbce39bb12937647765eb535031f2`.

## Protocol

Pi `Storage.commit` returns a sequence. It has no transaction handle and no async callback. Cloudflare `transactionSync` runs a synchronous callback. If that callback throws, the transaction rolls back. `sql.exec` cannot issue `BEGIN` or `SAVEPOINT`. Docs: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ (transactionSync, SQL transactions).

The adapter encrypts outside any DO transaction, then applies the batch in one `transactionSync` after rechecking metadata, record ids, document rows, revision bodies, and current-address counts. A mismatch retries the capture. Host `transactionSync` during that await is not inside a Pi transaction, so a Pi rejection does not rewind it. Adapter reads and commits share one in-memory chain so a read started during an admitted commit observes the commit outcome, not a partial write. That chain does not wrap host SQL.

`close` sets closed synchronously and joins every admitted promise, including commits and document reads. Later calls throw. Schema creation uses `transactionSync` with no await inside the callback.

Public `Storage` has no expired handle. A successful `transactionSync` callback cannot be forced to fail its platform commit from this adapter. Injected rollback-failure and post-callback handle reuse remain unresolved plan obligations. They were not replaced with a raw SQL callback helper. `runRetainedTransaction` was removed.

## Defects

1. Safety writes no longer join a held Pi encryption. The permanent test advances a same-invocation epoch with `transactionSync` while entry encryption is held, then rejects encryption. The epoch stays 2. The public Stop test keeps the applied control and an epoch greater than 1, and later `schedule` throws. It does not require Stop to wait, or a particular `stopping` row.
2. A public `entry` read admitted during that held commit does not settle before rollback and does not return the rolled-back entry.
3. `close` does not resolve while the admitted commit is still held. A call after close throws.
4. Reopen compares `host_seal.digest` with the digest of decrypted plaintext. A digest-only change fails open before schedule. A live digest change fails `schedule` before provider I/O. Accept compares decrypted inbox plaintext, not the unsigned digest, and does not replace the cache on conflict. `host_effect_route` is checked against decrypted correlation on reveal and before schedule, expiry, and admission. A mismatched route fails the next open.
5. Retained unbound selection is ciphertext of `{"unbound":true}`, bound by the existing owner, session, and record AAD. Literal `pending` is a tamper, including a wrong-owner open. `bindTask` rechecks the stored selection and run epoch inside the write transition and does not update a changed selection. A mapping conflict is not recorded as a storage failure.

## Retry and bind risk

These were unproved follow-ups, not demonstrated dispatch bugs.

Retained `captureRetry` writes a structural `host_retry_intent` row in `transactionSync` before the async seal. The seal then writes ciphertext and marks the intent sealed in one synchronous transition. A pending intent on reopen throws `Missing retry evidence` and does not schedule. That is fail-closed missing evidence, not a reconstructed retry and not recovery of a missing first association. A crash before the intent row is the same publication gap the plaintext path already has. It is not claimed as a new proved dispatch bug.

`closeAndAccount` fences and syncs before awaiting the seal queue. A rejected queue still leaves `fenced = 1` and later `schedule` throws. The original public Pi receipt path is unchanged. Seal and Pi commit are not claimed to be one atomic transaction.

## Verification

Commands ran from `/tmp/ditto-plan-004-vO7JVp` under `env -i`, `CI=1`, `NO_COLOR=1`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, and `HOME=$PWD/node_modules/004-correction-logs/home`. No `.env` read, no live provider, no staging, no commit.

| Command | Result |
|---|---|
| `pnpm runtime:verify` first full run | failed, exit 1. One host test, `never abandons actual close when a public Storage cleanup fault overruns its deadline`, threw `Actual close exceeded end deadline` under the full suite. The same test passed alone. `runtime-verify.log` |
| `pnpm runtime:verify` second full run | passed, exit 0. Typecheck, 6 Node checks, 159 Worker tests in 8 files. `runtime-verify-2.log` |
| `pnpm verify` | passed, exit 0. Biome 36 warnings and no errors. Web typecheck, 808 web tests in 72 files, web build, runner typecheck, 79 runner tests in 11 files, runner build. `verify.log` |
| Brain verification | not run. Shared brain inputs did not change |

Focused storage and correction tests passed before the gates: 31 storage tests, including 23 upstream conformance cases, and 5 correction tests. Effective compatibility remains the installed fallback `2026-03-10` against requested `2026-09-16`. No hosted or live claim.

## Limits

005 still owns exact document history and oversized external references. The external reference shape is rejected. Product enablement, legacy import, R2 acceptance, deployment, and plaintext retained-user mode were not added. The inherited plaintext host and effect suites were rerun, not relabeled as encrypted coverage. Encrypted L1 coverage added here is the retained handoff cases already in the host suite plus the correction tests for Stop, close, seal, route, selection downgrade, and retry fencing. Full encrypted replay of every plaintext scenario was not claimed. Rollback-failure injection after a successful `transactionSync` callback remains an unresolved platform obligation.
