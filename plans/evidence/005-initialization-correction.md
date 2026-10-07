# 005 initialization size-denial correction

Disposition: **READY FOR REVIEW**, not DONE. Independent advisor acceptance and complete L2 remain pending. Execution base: `923ab61916a1f9691b892f2263e3bc281fc65dd6`; detached worktree: `/tmp/ditto-plan-005-MmLBKB`. Correction executor used the requested `openai/gpt-6.1-sol`, Medium reasoning.

## Defect and correction

The [initial advisor review](005-advisor-initial-review.md) reproduced permanent fresh-store poisoning: valid positive but insufficient initialization limits rejected only after persisting the schema and unauthenticated counter placeholder. Default reopen then correctly failed integrity.

`apps/runtime/src/pi-durable-storage.ts` now prepares the actual initial encrypted counters in memory on the fresh-schema path, before any schema or chunk insertion. It checks the exact serialized plaintext length, each encrypted body/reference row, chunk count and total accounted backing bytes (including the existing 4 KiB per-row allowance). Split initialization accounts for the manifest and every ciphertext chunk. The same prepared encrypted value is passed into the existing sealing path; it is not re-encrypted after preflight. Low valid limits are not replaced with an arbitrary minimum or default.

Existing-schema opens still verify the existing authenticated counters; they never synthesize a replacement for an unauthenticated placeholder. Format/version rejection and plaintext-storage rejection precede fresh initialization preparation. Encryption remains outside synchronous transactions. Persisted split chunks are still read back and authenticated before installing the counter reference. Live index/snapshot checks, ID claims, metadata rollback, admission ordering and close draining are unchanged. No format, host-private, crypto utility, runtime enablement, dependency, R2, restore or GC change is included in this correction.

Five permanent real workerd tests were added to the existing `pi-durable-history.test.ts`:

- Initial `maxRecordBytes: 1` rejection leaves no adapter tables, then default open/commit/close/reopen succeeds without reset.
- Initial `maxBackingBytes: 4096` rejection has the same empty-storage and subsequent-use assertions.
- Initial split counters with `inlineMaxBytes: 1`, `chunkBytes: 8`, `maxBackingBytes: 8192` reject without persisted schema/chunks and permit subsequent default use.
- Honest `maxRecordBytes: 256`, `maxBackingBytes: 14000` initialize, commit and reopen successfully.
- Honest split initialization with `inlineMaxBytes: 1`, `chunkBytes: 8`, `maxRecordBytes: 256`, `maxBackingBytes: 200000` produces a committed split-counter reference and survives commit/reopen under those limits.

The advisor probes/config were not edited. Both previously failing initialization probes now pass alongside the capacity-rejection/reopen and guarded cumulative-context probes.

## Checks

All commands used the required physical-cwd assertion and sanitized environment:

```sh
cd /tmp/ditto-plan-005-MmLBKB && test "$(pwd -P)" = /tmp/ditto-plan-005-MmLBKB && \
  env -i HOME=/tmp/ditto-plan-005-MmLBKB/node_modules/005-verification-home \
  PATH=/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin:/home/ayan/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin \
  CI=1 NO_COLOR=1 <command>
```

Logs below are under `node_modules/005-verification-home/`. Every listed command exited 0; no zero-test filter is counted as a pass.

| Command | Status / exact result | Log |
|---|---|---|
| `pnpm --filter @ditto/runtime typecheck` | passed, both TS configurations | `correction-typecheck-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts src/pi-durable-history.test.ts` | passed, 41 storage + 26 history = 67 Worker tests | `correction-storage-history-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/005-advisor-probes.config.ts` | passed, 4 independent probes | `correction-advisor-probes-final.log` |
| `pnpm runtime:verify` | passed, both typechecks, 6 Node checks + 208 Worker tests in 9 files | `correction-runtime-verify.log` |
| `pnpm verify` | passed, repository check/typechecks/builds, 808 web + 79 runner tests | `correction-verify.log` |
| `pnpm exec biome check --write apps/runtime/src/pi-durable-storage.ts apps/runtime/src/pi-durable-history.test.ts` | passed; formatting only in the two correction source/test files | `correction-format.log` |
| `git diff --check` | passed | final worktree inspection |
| Hosted/live provider/deployment/GC/restore | not run, not authorized | no such acceptance claimed |

Focused checks and advisor probes also passed before formatting; those separate logs remain preserved. Broad gates ran after formatting; final focused checks/probes/typecheck were rerun against the formatted source.

Resolved versions were recorded in `correction-versions.log`: Node `24.21.0`, TypeScript `5.9.3`, Vitest `3.2.7`, Workers pool `0.12.21`, Workers types `4.20260702.1`, Pi Durable/Pi AI/Chord `1.0.1`, Alchemy `0.93.12`, pool-resolved Miniflare `4.20260310.0`, workerd `1.20260310.1`. Worker tests use effective compatibility date **2026-03-10** (normal runtime test config requests `2026-09-16` and falls back); advisor config explicitly uses `2026-03-10`. This is actual local DO SQLite evidence, not hosted proof or requested-date proof.

## Source identity and preservation

SHA-256 of the corrected source:

- `apps/runtime/src/pi-durable-storage.ts`: `bd62574e6a9c8f283c24261a70817b73d1973576efb3e43ccbac9e23d35ae3ff`.
- `apps/runtime/src/pi-durable-history.test.ts`: `c35c0802056fe7cce4dc22c84708735f16a112611878435b72e3c1c6201a2fe9`.
- `apps/runtime/src/host-private.ts`: unchanged initial-candidate hash `5cdf347498d007e43d5a2050600e1883009b23d3d9a898901609452b822538c5`.

Preserved advisor probes/config hashes:

- `plans/evidence/005-advisor-probes.test.ts`: `7256c70f697143daecece386fb57dc690cb0b739a353ad349c9fcb802bef9a57`.
- `plans/evidence/005-advisor-probes.config.ts`: `1f4b5624cfb60b58087d1a41063032614d35ce895022f86f3d23c856f62752a2`.

The initial candidate archive/diff remain unchanged at their initial-review hashes:

- `plans/evidence/artifacts/005/initial-candidate.diff`: `689b55580f66b671560e7cde45a8b21951bb5aab0aa645e7b03e67a8490be054`.
- `plans/evidence/artifacts/005/initial-candidate.tar.gz`: `0c0bb04493916db1101221d9f810cefbf852504c628bd78100ececfb8830fb78`.

Original executor evidence, failed advisor logs, historical reviews/artifacts and all prior uncommitted changes remain intact. No main-checkout file or dependency was changed. No installation, credential loading, staging, commit, merge, push, reset, deletion, live-provider call or deployment occurred. The disposable worktree is left intact for independent advisor review. Remaining conditions and scope limits from the original evidence still apply; this executor does not accept L2 or authorize integration.
