# 026 evidence: runtime:verify stability (second execution, Revision 2)

First execution (BLOCKED): branch `exec-026` @ `4ea77c7`.

## Environment
- WSL2 Linux 6.6, `nproc` = 4, Node v26.13.0 (CI uses 24), pnpm 11.8.0, vitest 3.2.7, workerd falling back to compat date 2026-03-10. Base 1af3c7b.

## Step 1 baseline ("streams long document tails across root replacement deltas", alone)
2459, 2371, 2291 ms. Median 2371 ms.

## Step 2 A/B (same file, both arms, 3 runs)
| Run | encrypted | plain |
|---|---|---|
| 1 | 5185 ms (timed out) | 522 ms |
| 2 | 3004 ms | 340 ms |
| 3 | 4526 ms | 329 ms |
Plain median 340 ms (<= 1500), encrypted median 4526 ms (> 1500). **P1 holds.** (Encrypted arm is slower here than alone, ~2.4 s, because both arms share one worker.)

## Step 3 attribution
- Clock calibration: 5e7-iteration loop printed 203 ms, so in-worker timing works. Mode used: timing.
- Per-method (Proxy on the storage): `commit` 51 calls, 2225 ms; `document` 5 calls, 234 ms; `mintId` 0 ms.
- Prototype-level timing (encrypted run, ms): prepareDocumentStatements 51/1995, materializeCaptured 54/2126, decodeRevision 1377/187, decodeJson 1578/195, decodePlaintext 1579/50, indexToken 213/40, assertBackingBounds 264/15, captureCommitSnapshot 102/12.
- Dominant helper: `boundedJson` (called per delta in the `materializeCaptured` tail replay and on each final value): 3108 calls, 2140 ms, i.e. ~all of the cost. Decrypt is only ~190 ms. Inside it, `new TextEncoder().encode(...)` per visited string (and a full-document encode of the serialized JSON) allocates per node; a 512-row document is hit up to ~26 times per commit.
- Temporary timing lines in `pi-durable-storage.ts` were reverted before the fix (`git diff --stat` was empty).

## Change
`apps/runtime/src/pi-durable-storage.ts`: add `utf8ByteLength` (counts exactly like TextEncoder, lone surrogate = 3 bytes) and use it in `boundedJson` in place of `new TextEncoder().encode(...).byteLength` (two sites). No format, compat string, on-disk byte, or limit change. Every check kept.
Test: `pi-durable-storage.test.ts` "bounds record size by UTF-8 bytes, not string length" (maxRecordBytes 256: 80 ASCII chars accepted, 40 emoji = 80 UTF-16 units but 160 bytes rejected). Verified it fails when `utf8ByteLength` returns `value.length`.

Case alone after fix: 448, 446, 440 ms. Median 446 ms (was 2371 ms).
`src/pi-durable-storage.test.ts`: 42 passed.

## Step 5: five full `pnpm runtime:verify` runs
| Run | Result | Suite duration | Case |
|---|---|---|---|
| 1 | 524 passed, exit 0 | 54.79 s | not captured (default reporter) |
| 2 | 524 passed | 50.23 s | 611 ms |
| 3 | 524 passed | 50.11 s | 639 ms |
| 4 | 524 passed | 54.27 s | 692 ms |
| 5 | 524 passed | 52.66 s | 690 ms |

## Step 6
`ci.yml` needs no new setup (Node 24, pnpm install, npm ci runner, pnpm verify). `verify` script now matches the Step 6b script exactly.

## Step 7 segments (local, Node 26)
| Segment | Exit | Note |
|---|---|---|
| pnpm check | 1 then 0 | First run failed on one error: my formatting in `pi-durable-storage.ts` (fixed with biome format). Rerun after fix: exit 0 (123 warnings, 11 infos, all pre-existing in other files). |
| pnpm db:drift | 0 | |
| pnpm typecheck | 0 | |
| pnpm credentials:verify | 1 | Only `product-commands.worker.test.ts`: "generation-2 admission denies a missing credential fence..." (timeout 5000ms) and "queued configuration uses the next selection across a sequence gap..." (timeout 5000ms), plus "Isolated storage failed". Matches the allowed flake signature. |
| rerun product-commands once | 1 | "native alarms drain delivery order 3,1,2 ..." (4714 ms) plus "Isolated storage failed"; 35 passed. Same signature, different test name. |
| pnpm contracts:verify | 0 | |
| pnpm runtime:verify | 0 | |
| pnpm test | 1 | 18 failures, all `apps/web/src/components/composer.test.tsx`: `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` (line 82). 80 files passed, 902 tests passed. Untouched file; likely Node 26 vs CI Node 24 `localStorage` global, not verified. |
| pnpm build | 0 | |
| pnpm runner:verify | 0 | |

## Reviewer rerun (2026-10-29, Node 24)

The Node 26 `pnpm test` failure comes from Node 26 itself: its `localStorage` global is a getter that returns `undefined` unless `--localstorage-file` is passed. Run on Node 24.14.1, `composer.test.tsx` passed 18/18. The reviewer added `.node-version` (`24`); the local Node shim honors it and resolves v24.22.2, which matches CI's `node-version: "24"`.

Every Step 7 segment rerun on Node 24.22.2 in the executor worktree:

| Segment | Exit | Note |
|---|---|---|
| pnpm check | 0 | |
| pnpm db:drift | 0 | |
| pnpm typecheck | 0 | |
| pnpm credentials:verify | 1 | Allowed flake only: "queued configuration uses the next selection across a sequence gap and preserves committed preparation" (`Test timed out in 5000ms`) plus "Isolated storage failed"; 240 passed |
| rerun product-commands once | 0 | 96/96 |
| pnpm contracts:verify | 0 | 70/70 |
| pnpm runtime:verify | 0 | 524/524 |
| pnpm test | 0 | 920/920 |
| pnpm build | 0 | |
| pnpm runner:verify | 0 | 138/138 |

The reviewer also reran "Case alone" 3 times (424, 421, 424 ms), ran the storage file (42/42), and checked that the new test fails when `utf8ByteLength` is replaced with `.length`.
