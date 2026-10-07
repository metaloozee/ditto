# 005 initial advisor review

Disposition: correction required before local L2 acceptance. Candidate remains uncommitted in `/tmp/ditto-plan-005-MmLBKB`, base `923ab61916a1f9691b892f2263e3bc281fc65dd6`. Executor used `openai/gpt-6.1-sol`, Medium reasoning. No integration, deployment, live provider request, reset, staging or commit is authorized.

## Independent results

Advisor inspected every source/test increment against the plan, read the exact history test and storage/host-private code, reran gates using the executor's sanitized environment and exact worktree cwd assertion.

| Check | Status | Result / worktree log |
|---|---|---|
| `pnpm runtime:verify` | passed | Exit 0, runtime typechecks, 6 Node checks, 203 Worker tests; `node_modules/005-advisor-runtime.log` |
| `pnpm verify` | passed | Exit 0, web 808 tests, runner 79 tests, checks/typechecks/builds; `node_modules/005-advisor-verify.log` |
| Independent capacity rejection/reopen and guarded-context cases | passed | 2 tests; `node_modules/005-advisor-probes-initial.log` |
| Independent fresh initialization size-rejection probes | failed | 2 failed, 2 passed; `node_modules/005-advisor-probes-v2.log` |
| Source hashes and `git diff --check` | passed | Match executor identities |

No zero-test filters count as a pass. Worker tests use effective compatibility date `2026-03-10`, not hosted or requested-date evidence. Parent-source changes remain prohibited. Advisor tests/config are under `plans/evidence/` only.

## Blocker

`apps/runtime/src/pi-durable-storage.ts:584-599` validates positive option ranges, then `ensureSchema()` commits the schema and unauthenticated initial counter placeholder. Only afterward does `sealInitialCounters()` check the initial serialized-counter and backing budgets. With fresh storage and either `maxRecordBytes: 1` or `maxBackingBytes: 4096`, initial open rejects for size after creating all 11 adapter tables. A subsequent default-limit open skips initial sealing because the schema exists, and `verifyCounterRow()` fails integrity on the leftover placeholder.

These are new supported option inputs to 005, not ciphertext tampering or an unsupported migration. Rejecting an impossible budget is correct; permanently damaging a fresh store before rejecting it is not. Independent tests exercise actual workerd/DO SQLite and require a normal-limit open to succeed after the rejected open, without reset or synthesis of authentication on existing state. See `plans/evidence/005-advisor-probes.test.ts` and its config.

Required correction: validate that configured ceilings can accommodate initialization before any schema/content persistence, or prepare valid initial encrypted counters and atomically install them with the fresh schema. Never repair an existing unauthenticated counter implicitly. Preserve format-4 split verification, live index checks, counter authentication, short synchronous transactions and admission/close semantics. Add permanent coverage for both failures and an honest small-limit initialization. No GC, product enablement, dependency change or broad host refactor is needed.

## What survived review

Split chunks stay outside manifest rows and bind owner/session/record/write/ordinal/count/length/digest through the existing authenticated crypto. Content is read back before a reference is prepared; the metadata transaction rechecks live index and mutable snapshot, then commits records/ID claims/counters together. Capacity rejection can leave encrypted orphans, but the independent test confirms committed data remains readable on reopen and unreachable preparation is excluded from reference enumeration. Orphan retention/capacity consumption is explicit and is not a finding; GC remains 017.

Exact history tests exercise upstream materialization/copy/scans, large task and entry bodies, key rotation, full-batch rollback, and actual next provider request after compacted history/completed tool/queued-follow-up recovery. Permanent encrypted L1 tests rerun against format 4. The 32 KiB host-field limit does not itself cap cumulative transcript size: an independent guarded-host test completed six bounded prompts whose cumulative context exceeds the inline threshold. The initial suspicion that this field cap necessarily breaks ordinary longer conversations is rejected. Prepared-task tuples retain transcript positions/digests rather than duplicate all transcript bytes.

The conservative 16 MiB accounted backend budget is not a physical SQLite/index/page quota or measured memory/performance claim. Larger synthetic backend fixtures do not prove provider/attachment parity or arbitrary-sized host safety results. No hosted, actual-provider, Docker, browser, GC or checkpoint-restore acceptance is claimed.

## Preserved initial candidate

- `plans/evidence/artifacts/005/initial-candidate.diff`, SHA-256 `689b55580f66b671560e7cde45a8b21951bb5aab0aa645e7b03e67a8490be054`.
- `plans/evidence/artifacts/005/initial-candidate.tar.gz`, SHA-256 `0c0bb04493916db1101221d9f810cefbf852504c628bd78100ececfb8830fb78`.

Archive includes full initial source/tests/plan/evidence plus independent probes and gate logs. The untracked history test is in the archive, not the tracked-only diff. Candidate source identities remain those in executor evidence. All earlier 004 artifacts remain unchanged.
