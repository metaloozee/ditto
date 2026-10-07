# 005 final advisor review

Disposition: **DONE for the independently reviewed local scope.** Corrected plan 005 plus integrated plan 004 complete the local L2 private-state gate in the reviewed execution worktree, within the limits below. Source is not integrated into the user's branch. No product enablement or hosted/provider acceptance is claimed.

Execution base: `923ab61916a1f9691b892f2263e3bc281fc65dd6`. Reviewed uncommitted worktree: `/tmp/ditto-plan-005-MmLBKB`. Both execution agents used the requested `openai/gpt-6.1-sol` with Medium reasoning. Advisor implementation edits remain prohibited; advisor tests, reviews and artifacts are under `plans/` only.

## Acceptance basis

Compared the entire initial source/test increment against plan 005, then compared the correction against the preserved initial candidate. Implementation changes are confined to `apps/runtime/src/pi-durable-storage.ts` and `apps/runtime/src/host-private.ts`; behavior coverage is in the new `apps/runtime/src/pi-durable-history.test.ts`. The correction changes storage initialization and adds five permanent tests. Host-private is byte-identical to the initially reviewed candidate. Existing host/effect/crypto/config source remains unchanged.

Storage format 4 and adapter `ditto-encrypted-storage-4` retain the existing Pi 1.0.1 contract and crypto format 1. The manifest row no longer carries a large ciphertext-chunk array. Independently encrypted chunks live in runtime-owned SQLite `private_chunks`, bound to owner/session/record/write/ordinal/count/length/digest by the existing AES-256-GCM implementation. Each stored body/reference has a 64 KiB serialized ceiling. No R2 adapter, implicit bucket capability, extra dependency, second storage repository, legacy importer, GC, restore or runtime enablement was added.

Async preparation persists and reads back chunk content before a reference becomes eligible for commit. The existing short synchronous metadata transaction rechecks index and mutable snapshots and atomically applies Pi records, ID claims and authenticated counters. Failed preparation can leave encrypted unreachable content, but no authoritative partial reference. The independent capacity probe confirms that rejection preserves committed data and normal reopen. Missing/corrupt/wrong-record/unknown-key referenced chunks block recovery. Complete-batch rollback, same-invocation read exclusion, unrelated safety-write independence and close draining remain covered.

Size limits cover serialized records/batches, encrypted rows and manifests, JSON nodes/depth, chunk/revision counts, reconstructed document values, routing strings and accounted backing bytes. They reject unsupported content instead of shortening it. Incoming writes are detached before async preparation, and options are copied. Initial configured ceilings are now checked against the actual prepared encrypted counter representation before fresh schema or chunk persistence. The same prepared ciphertext is reused, including split initial counters. Both previously failing advisor probes now pass unchanged: impossible initial record/backing budgets leave no schema, and a later default open/commit succeeds without reset. Existing unauthenticated counters are still rejected, never implicitly repaired. This is a size-denial repair, not a claim that every possible platform initialization crash is automatically recoverable.

The real workerd history tests cover large document bases/deltas, selected committed positions, version boundaries, historical copies/retirement/scans, task input/checkpoint/memos, model metadata, tool detail, queued submissions and image-storage fixtures. Raw backing rows contain no synthetic private sentinel. Key rotation retains historical decryptability. The actual Harness test completes an unsafe tool, compacts, interrupts an already prepared next request, queues a follow-up, reopens with rotated keys, compares recovered context and the actual next provider callback against the original request, preserves provider/call IDs and completes the original submission IDs without repeating the tool.

`enumerateCommittedReferences()` exposes current/canonical committed references, excludes preparation orphans and performs no deletion or scheduling. Future current/previous checkpoint and active-recovery reference sets must be explicitly pinned at publication and unioned with this enumeration. Mutable old task snapshots cannot be inferred from current records. This is the prerequisite contract for later retention, not implementation of checkpoint recovery or cleanup.

## Independent verification

Every command changed to the exact disposable worktree and asserted physical cwd. Verification used `env -i`, isolated HOME under that worktree's `node_modules`, fixed installed Node/pnpm paths, `CI=1` and `NO_COLOR=1`. Parent performed no dependency installation or main dependency repair.

| Check | Status | Result / log in worktree `node_modules/` |
|---|---|---|
| Final `pnpm runtime:verify` | passed | Exit 0; both runtime typechecks, 6 Node checks, 208 Worker tests in 9 files; `005-advisor-final-runtime.log` |
| Final `pnpm verify` | passed | Exit 0; repository checks, web typecheck/build and 808 tests, runner typecheck/build and 79 tests; `005-advisor-final-verify.log` |
| Unchanged independent advisor probes | passed | Exit 0; all 4 tests, including both formerly failing initial-limit cases; `005-advisor-final-probes.log` |
| Initial independent broad gates | passed | 203 Worker plus 6 Node checks and repository gates; `005-advisor-runtime.log`, `005-advisor-verify.log` |
| Initial size-denial counterexamples | failed, preserved | Two failures and two passes before correction; `005-advisor-probes-v2.log` |
| `git diff --check`, source hashes, initial artifact hashes and `gzip -t` | passed | `plans/evidence/artifacts/005/accepted-source.sha256` and preserved artifacts |
| Shared brain, Docker, hosted, actual provider, browser and benchmarks | not run | Shared inputs/topology unchanged or outside this authorized local scope |

The 208 Worker count includes isolated plaintext feasibility tests; these do not substitute for encrypted acceptance. Named permanent encrypted L1 scenarios rerun on format 4 include guarded model/tool settlement, compaction/retry/follow-up identities, priority/active/stale Stop, held authority-wait close, safety-result/Pi-result loss, persistence barriers, retry-seal failure and unknown shell denial through two reopens. Core conformance, actual DO transaction faults and encrypted history/size scenarios run in workerd, not Node-only SQLite doubles.

Environment: Node 24.21.0, pnpm 11.8.0, TypeScript 5.9.3, Vitest 3.2.7, Workers pool 0.12.21, Workers types 4.20260702.1, Pi Durable/Pi AI/Chord 1.0.1, Alchemy 0.93.12, pool-resolved Miniflare 4.20260310.0 and workerd 1.20260310.1. Effective compatibility date is **2026-03-10**; the normal suite's requested 2026-09-16 falls back. This is local execution evidence, not hosted date, eviction, quotas or billing evidence.

## Limits and rejected concerns

- Defaults permit 8 MiB serialized records/reconstruction, 16 MiB incoming batches and accounted backing contents, 1,024 writes, 100,000 JSON nodes, depth 64, and 4,096 chunks/revisions. Backing accounting adds a conservative 4 KiB per row; it is not a physical SQLite file/index/page or measured memory quota.
- Prepared orphan chunks remain and can exhaust capacity. This is declared behavior; eager deletion would violate 005 scope. Later retention must use committed reachability and checkpoint/recovery pins, not age alone.
- Host private fields deliberately reject above 32 KiB plaintext/64 KiB encrypted. Existing synthetic command/result/request limits still apply. No arbitrary-sized safety-result, provider or attachment parity is accepted here.
- The concern that the host private-field cap necessarily truncates or blocks cumulative conversation context was refuted by six completed guarded bounded prompts. Prepared safety tuples refer to transcript positions/digests, not an embedded duplicate of the whole transcript. Larger direct-backend fixtures do not establish unrestricted guarded input/output support.
- Format 3 and older state still fail closed without migration. General freshness against replay of previously valid ciphertext/database snapshots is not claimed. Security/effect authority is never rewound with conversation history.
- No retained workspace enablement before L4's paired baseline. No live provider request, credential use, hosted execution, GC, paired restore or performance acceptance is included.

The initial [advisor review](005-advisor-initial-review.md) and failed probes remain valid historical evidence. The [executor report](005-private-state-acceptance.md) and [correction report](005-initialization-correction.md) retain their original READY FOR REVIEW disposition; this separate review supplies acceptance. The missing installed improve `references/closing-the-loop.md` was disclosed before dispatch; execution followed the user's supplied isolated-executor/independent-review contract.

## Preservation and handoff

Exact reviewed identities are recorded in `plans/evidence/artifacts/005/accepted-source.sha256`. Corrected source hashes:

- Storage: `bd62574e6a9c8f283c24261a70817b73d1973576efb3e43ccbac9e23d35ae3ff`.
- Host-private: `5cdf347498d007e43d5a2050600e1883009b23d3d9a898901609452b822538c5`.
- History tests: `c35c0802056fe7cce4dc22c84708735f16a112611878435b72e3c1c6201a2fe9`.

Both executor transcripts satisfy exact worktree file/command restrictions; neither contains staging/commit/merge/push/reset/destructive-deletion commands. Parent checked the initial and correction diffs directly and independently ran the final gates. Main application source, manifests/lockfiles and ignored dependencies are unchanged.

The accepted candidate archive contains full changed source/test files, plan/evidence, advisor probes and sanitized executor/advisor logs, excluding CLI HOME/dependencies. The tracked-only diff is supplemental; the new untracked history test is in the archive. Archive checksums are recorded in `plans/evidence/artifacts/005/accepted-artifacts.sha256`. Earlier rejected artifacts remain preserved.

Keep `/tmp/ditto-plan-005-MmLBKB` intact. Integration, staging, commits, worktree cleanup and main dependency repair require separate authorization. Plan 006 should be refreshed and executed only after the reviewed 005 source is integrated; this review does not execute it.
