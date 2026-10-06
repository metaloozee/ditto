# 004 counter correction

Disposition: **corrected candidate, not accepted.** No DONE claim. Base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. Worktree `/tmp/ditto-plan-004-vO7JVp`. Requested model xai/grok-4.7, Medium reasoning. The second correction review remains `plans/evidence/004-second-correction-advisor-review.md`. Historical probes, probe configs, advisor logs, and the second-correction baseline were not overwritten. The main archive `plans/evidence/artifacts/004/second-corrected-candidate.tar.gz` is not in this worktree and was not opened or modified.

## Baseline

Before source edits, the second correction was copied to ignored `node_modules/004-counter-correction-baseline/`. `source-before.sha256` records the copies.

`pi-durable-storage.ts` `ebb6d1abc8d2e785ac554faf1ab65e1218b06a217f2e07781f1f3ce0bd2fe7cb`. `pi-durable-host.ts` `9878d45010635519bf892c63540c27ead0d91b6bb220a60cb4f623b3d58bb0dc`. `host-private.ts` `d27693e838134f3a650f6818e76a7c53839c68f46a854fd861451899107ebf71`. Host and helper hashes are unchanged after the correction. Final storage hash `c89d206b30a64e65f989035a3c39d60419fc7090ae7bb491677b7c202bf9d908`. Final storage test hash `b151bdd74b46f913dfdac0fbb95e84d29a68a075997ff20f2fe72d04e200a045`.

## Protocol

Storage format is 3. Adapter compatibility is `ditto-encrypted-storage-3`. Format 2 and `ditto-encrypted-storage-2` are rejected. There is no implicit migration. Crypto format stays 1. Nonces and AAD construction are unchanged.

`durable_metadata` still holds `next_id` and `next_seq`. The same row now holds `counter_record`, an AES-GCM envelope. The plaintext is the canonical JSON `{"nextId":"<decimal>","nextSeq":N}`. The record id is `durable_metadata/counters/<nextId>/<nextSeq>`, so the tag is bound to those values. A fresh database writes an unauthenticated placeholder inside the schema transaction, then seals the initial pair outside it and applies that envelope in a short `transactionSync` only if the row is still the initial placeholder. A later open does not seal a missing or placeholder envelope.

Open, and any later read, commit, or mint whose index token changed, decrypts that envelope and checks it against the columns. The index token includes the counter columns and envelope, so a change during decryption fails the before/after check. Legal `next_id` is a canonical decimal of a safe integer at least 2, or the single exhausted successor `9007199254740992` after a commit of `Number.MAX_SAFE_INTEGER`. Legal `next_seq` is a safe integer at least 1. `next_id` must be greater than every retained record id. `next_seq` must be greater than every retained entry commit sequence, document `created_at`, `retired_at`, and revision sequence. It may be ahead of those maxima. Empty commits and task-only commits consume a sequence without an entry or revision row, so the maxima are a lower bound, not the authenticated value. A higher column with the old envelope fails. A lower column fails even when no retained row records that sequence. Corrupt values are not clamped.

Commit encrypts the successor envelope from the verified snapshot, not from a live reread taken after the await. `transactionSync` rejects an index-token change before SQL. The counter update is in the same batch as the records and id claims. A thrown SQL error rolls the envelope back with those rows. Uncommitted `mintId` values stay in memory until a successful commit. Close and reopen without that commit remints them. A successful commit can persist a gap. Public `commit` still returns a sequence and has no transaction handle or async callback.

## Tests

Permanent cases are in `apps/runtime/src/pi-durable-storage.test.ts`. They use the real DO and public Storage calls. The historical advisor probe file was not edited. Its rerun now passes the same safe-invariant assertions. The original failing log stays in `node_modules/004-second-correction-advisor-logs/counter-probes.log`.

The new cases deny a regressed sequence, deny a regressed id before mint, deny live corruption on read, mint, and commit, deny an old envelope against new columns and the reverse, reject negative, zero, noncanonical, blank, unsafe, and placeholder counter values, reject format 2, refuse a commit whose counter changes during encryption, keep an uncommitted mint across reopen, keep an id gap and an empty plus task-only sequence, and roll back the counter envelope with entry rows and id claims.

## Verification

Commands started in `/tmp/ditto-plan-004-vO7JVp` and asserted that physical cwd. They used `env -i`, `PATH=/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin:/home/ayan/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin`, `HOME=$PWD/node_modules/004-counter-correction-logs/home`, `CI=1`, and `NO_COLOR=1`. Node was v24.21.0. The first `pnpm` shim fetched pnpm 11.8.0 into that isolated HOME cache. That was a package-manager fetch, not a repo dependency install. Later commands reused the cache. No `.env` read, live provider, staging, or commit.

| Command | Result |
|---|---|
| `pnpm runtime:verify` first full run | failed, exit 2. Two task fixtures omitted `background` and `abortRequested`. `runtime-verify.log` |
| `pnpm runtime:verify` before formatter | passed, exit 0. Both runtime typechecks, 6 Node checks, 182 Worker tests in 8 files. `runtime-verify-2.log` |
| `pnpm verify` first full run | failed, exit 1. Biome formatter rejected the new storage files. Pre-existing 36 warnings and 1 info were also present. `verify.log` |
| `pnpm verify` after format | passed, exit 0. Biome 36 warnings and 1 info. Web typecheck, 808 web tests in 72 files, web build, runner typecheck, 79 runner tests in 11 files, runner build. `verify-2.log` |
| `pnpm runtime:verify` on the formatted source | passed, exit 0. Same 6 Node checks and 182 Worker tests. `runtime-verify-3.log` |
| Counter probe config | passed, exit 0. 2 tests. `counter-probes-final.log` |
| Host probe v3 config | passed, exit 0. 6 tests. `host-probes-v3-final.log` |
| Extra encrypted L1 preserved config, with the requested name filter | passed, exit 0. 31 passed, 22 skipped. `extra-encrypted-l1-preserved-final.log` |
| Brain verification | not run. Shared brain inputs did not change |

Effective compatibility remains the installed workerd `1.20260310.1` fallback `2026-03-10` against requested `2026-09-16`. `git diff --check` passed. No hosted or live claim.

## Limits

005 still owns exact document history and oversized external references. Product enablement, legacy import, deployment, and plaintext retained-user mode were not added. A stolen older envelope plus a full restore of older rows is a database rollback, which this correction does not claim to stop. Platform commit failure after a successful `transactionSync` callback remains unsupported. It was not faked. Historical probe files and earlier logs were not rewritten. Source remains uncommitted.
