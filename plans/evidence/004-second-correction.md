# 004 second correction

Disposition: **corrected candidate, not accepted.** No DONE claim. Base `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`. Worktree `/tmp/ditto-plan-004-vO7JVp`. Requested model xai/grok-4.7, Medium reasoning. Incoming review copied to `plans/evidence/004-correction-advisor-review.md`. Historical probes, probe configs, advisor logs, and the first-correction baseline were not overwritten.

## Baseline

Before source edits, the first correction was copied to ignored `node_modules/004-second-correction-baseline/`. `pi-durable-storage.ts` `c9dfdd20de1032e8be495260d3293fe7027df0022d25b021e1a41a06ac371b32`. `pi-durable-host.ts` `b4eefa5475a6f9bf9929bdebb2e063f479f133c8f7370cc1e4e3c40b491db2ff`. `host-private.ts` `d27693e838134f3a650f6818e76a7c53839c68f46a854fd861451899107ebf71`.

## Protocol

Public Pi `Storage.commit` returns a sequence. It has no transaction handle and no async callback. Cloudflare `transactionSync` rolls back when its synchronous callback throws. `sql.exec` cannot issue `BEGIN` or `SAVEPOINT`. A successful callback cannot inject a platform commit failure from this adapter. That is an unsupported platform operation, not a waived persistence barrier: a live persistence failure still denies admission. The plan contract paragraph now says this. Adapter format is `ditto-encrypted-storage-2` and storage format is 2. Format 1 is rejected. There is no implicit migration.

Revision bodies are `{ seq, kind, version, payload }`. AAD binds document id, sequence, kind, and version. Entry bodies are `{ commitSeq, entry }`. AAD binds entry id and commit sequence. Queryable columns are checked against those authenticated values on open and again before each public read or commit. A filtered scan cannot hide a tampered row. Commit rechecks that index token inside `transactionSync` before applying SQL.

Host plaintext cache records the ciphertext envelope that was written. `assertSeals`, `opened`, selection, and prepared reads compare the current SQL envelope with that cache. Dispatch rechecks correlation, selection, and prepared immediately before provider or tool I/O. The bare effect-id cache alias is gone. Inbox still decrypts before submit and also rejects a changed envelope. A same-plaintext re-encryption is a live integrity denial, not a demonstrated command substitution.

## Defects

1. Changing `document_revisions.version` to 99, or kind to `delta`, fails reopen. Honest materialization still returns version 1 and the original value. Copy and history conformance still pass.
2. Changing entry `conversation_id`, `head`, or `commit_seq`, conversation owner, task status/background, submission request/status, or document `retired_at` fails the next owning read. The bad row does not disappear from a root scan.
3. A guarded encrypted model admission no longer poisons `expire()`. The following deadline check is a real deadline failure, not `Storage integrity failure`.
4. Replacing correlation and selection ciphertext after open, with seal digests unchanged, fails before provider I/O. Corrupt evidence and retry envelopes fail closed. Inbox swap denial remains.

Retry seal failure is the real `captureRetry` queue, not a replaced `privateQueue`. The queue records the failure and does not write retry ciphertext. Close fences before that seal finishes. A pending intent still fails reopen. Workerd reports a rejection created inside that queue as a test failure even when caught, so the queue records the failure instead of rejecting the promise. Close still fences first and later admission is denied.

## Encrypted L1

These use `EncryptedPiStorage`, the mandatory `HostGuard`, and `cooperativeFixture`. They are not the plaintext totals.

- Guarded model and tool round, settlement, and raw rows without the plaintext sentinel.
- Compaction retry attempts 1 and 2 share operation and prepared text. Follow-up membership completes. History ids stay unique and newest-first.
- Stop during held model preparation does not dispatch. A later completed run survives a stale Stop. An active uncooperative tool stays stopping and blocks reopen scheduling.
- Operation deadline and the original recovery deadline fail closed after the awaits.
- Close during held preparation does not dispatch, fences, and leaves the invocation closed. Reopen does not replay that attempt.
- Native alarm reopens with the retained binding and does not allocate a second invocation for the duplicate delivery.
- Lost tool-result persistence and a failed Pi terminal commit both block two reopens.
- A persistence barrier plus an unresolved shell blocks two reopens.
- Envelope swap, corrupt evidence, and corrupt retry evidence fail closed.

## Verification

Commands ran from `/tmp/ditto-plan-004-vO7JVp` under `env -i`, `CI=1`, `NO_COLOR=1`, and `HOME=$PWD/node_modules/004-second-correction-logs/home`. No `.env` read, no live provider, no staging, no commit.

| Command | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts src/pi-durable-encrypted-corrections.test.ts` | passed, exit 0. 38 tests. |
| `pnpm runtime:verify` first full run | failed, exit 2. Runtime typecheck rejected an authority hook return type. `runtime-verify-1.log` |
| `pnpm runtime:verify` second full run | passed, exit 0. Both runtime typechecks, 6 Node checks, 174 Worker tests in 8 files. `runtime-verify.log` |
| `pnpm verify` | passed, exit 0. Biome 36 warnings and no errors. Web typecheck, 808 web tests in 72 files, web build, runner typecheck, 79 runner tests in 11 files, runner build. `verify.log` |
| Brain verification | not run. Shared brain inputs did not change |

Effective compatibility remains the installed fallback `2026-03-10` against requested `2026-09-16`. No hosted or live claim.

## Limits

005 still owns exact document history and oversized external references. Product enablement, legacy import, R2 acceptance, deployment, and plaintext retained-user mode were not added. Platform commit failure after a successful `transactionSync` callback remains unsupported on the selected public Storage contract. It was not faked. Historical probe files and earlier logs were not rewritten.
