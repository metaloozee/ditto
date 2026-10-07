# 005 private-state executor evidence

Disposition: **READY FOR REVIEW**, not DONE. Independent advisor acceptance is pending; this report does not close L2. No integration is authorized by these results.

Execution base: `923ab61916a1f9691b892f2263e3bc281fc65dd6`. Detached disposable worktree: `/tmp/ditto-plan-005-MmLBKB`. The accepted 004 core at `5173e12` is already integrated at this base. Read its plan, final advisor review and integration record before implementing.

## Changed files and ownership

- `apps/runtime/src/pi-durable-storage.ts`: bounded split representation and preparation/verification protocol inside the existing encrypted Pi backend; serialization/reconstruction/batch/backing ceilings; committed-reference enumeration. Format 4, adapter `ditto-encrypted-storage-4`.
- `apps/runtime/src/host-private.ts`: explicit plaintext and encrypted-envelope ceilings for retained safety/private fields. Unsupported content is rejected, not shortened.
- `apps/runtime/src/pi-durable-history.test.ts`: 21 real workerd behavior cases, including actual Harness/provider request preparation and exact recovered context.
- `plans/005-storage-history-and-large-records.md`, `plans/README.md` and this evidence: refreshed decisions and executor results.

No runtime enablement, R2 binding, Alchemy configuration, dependency manifest/lockfile, shared contracts/brain input, product route or sandbox-runner source changed. `runtime-crypto.ts` remains unchanged. No legacy importer, checkpoint restore, GC, benchmark or second generic repository was added.

## Contract checked against installed 1.0.1

Read the installed `@earendil-works/pi-durable` declarations in `dist/types.d.ts`, document declarations, SQLite materialization/copy implementation and the exported testing seam (`dist/testing/runner.js` and storage conformance cases). The existing registration continues to run upstream conformance over an actual SQLite-backed Durable Object.

The public Storage method is atomic `commit(writes, context): Promise<Seq>`; it does not expose a transaction handle or an asynchronous callback. Tasks and submissions replace complete records. Entries are immutable, newest-first and fork-aware. Document incarnations use half-open membership. Materialization selects the newest visible base, then applies ordered same-version Chord operations. A version change needs a base. Current-only documents reject historical content reads. Copies require matching kind/key/history/fork and an unchanged source in the same batch. Session scheduling and continuation remain upstream-owned.

The implementation preserves 004's serialized admitted reads/commits, synchronous metadata transaction, authenticated ID/sequence counter pair, ID claims, routing and revision interpretation checks, rollback, unrelated safety-write independence and close draining. Encryption/content preparation occurs before the metadata transaction. No manual transaction SQL or async synchronous callback is introduced. Format 3 and older storage are rejected without migration, not silently reinterpreted.

Current Cloudflare references retrieved during execution:

- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ — `transactionSync` rolls back when its synchronous callback throws; it cannot contain async preparation.
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

These references are implementation guidance, not hosted execution evidence.

## Representation and ceilings

All byte ceilings use serialized UTF-8, not JavaScript character count.

| Representation | Ceiling / policy |
|---|---|
| Incoming individual write and encrypted-record plaintext | 8 MiB, including its serialization wrappers |
| Incoming commit batch | 16 MiB serialized plaintext; at most 1,024 writes |
| JSON structure | 100,000 visited nodes including object keys; depth 64; cycles rejected |
| Inline plaintext | Through 32 KiB, inclusive |
| Split plaintext chunk | 16 KiB by default; final chunk may be shorter |
| Encrypted body or manifest | 64 KiB serialized, including nonce/tag/base64/key version/format overhead |
| Split reference | At most 4,096 chunks; total plaintext at most 8 MiB |
| Document | At most 4,096 retained revisions; reconstructed values and each applied delta's result pass the record/node/depth ceilings |
| Queryable routing string | 1 KiB serialized JSON |
| Accounted backend contents | 16 MiB of private bodies plus a conservative 4 KiB allowance per row; includes prepared orphans |
| Retained host private/safety field | 32 KiB plaintext, 64 KiB encrypted; reject unsupported size |
| Existing synthetic host command | Existing 8 KiB admission ceiling is unchanged |

Open-time injected options may lower ceilings, never raise them. Options are copied to prevent later caller mutation. Bounds are checked before encryption/persistence where possible and rechecked during recovery. Metadata growth is checked inside the rollback-capable transaction. Chunk capacity is checked before each insert. Unsupported work receives a size rejection instead of a substitute summary.

The accounted backend budget bounds adapter-visible bodies and the index/reconstruction inputs. It is **not** a measured physical SQLite file/index/page quota, platform entitlement, performance or hosted memory claim. Size validation serializes bounded JSON; it is not a streaming encoder. Node/depth and string-byte preflight constrain the graph before serialization. Small injected ceilings test denial without multi-megabyte allocations.

### Split representation

The new runtime-owned `private_chunks` table stores one ciphertext per `(write_id, ordinal)`, with record identity and a SQL 64 KiB ciphertext-body check. The record/revision column stores `{ kind: "split", manifest }`. The manifest carries crypto version, record/write identity, chunk count, plaintext length and digest, **without the chunks array**. Default manifests remain small regardless of private body size; the 64 KiB manifest ceiling is checked explicitly.

This reuses the verified crypto utility's independently randomized AES-256-GCM chunks and AAD binding to owner/session/record/ordinal/count/write/digest/length. That utility's in-memory manifest is only a preparation/reconstruction value; it is not persisted as one large SQLite row. No R2 adapter was selected, so no bucket or entrypoint injection was added. All capabilities/keys still enter through the existing entrypoint-supplied retained binding.

Preparation persists chunks outside the short metadata transaction, reads them back and authenticates their exact reconstruction before returning a reference. The live index includes chunk backing contents and is advanced only for the adapter's own synchronous inserts. Metadata commit rechecks that index and its existing snapshot/counter checks. The reference becomes authoritative only in the same synchronous transaction as the Pi records and authenticated successor counters.

Failure before the first chunk, between chunks, after upload/before metadata and after successful metadata acknowledgment loss is covered. Failed preparation or metadata rollback may leave encrypted orphan content. Orphans consume the budget but are absent from committed-reference enumeration; they never authorize recovery. Missing, corrupt, swapped-record or unknown-key referenced chunks block recovery. Content changed after verification but before metadata is also rejected. No automatic orphan deletion is implemented.

## Exact history and request evidence

`pi-durable-history.test.ts` exercises:

- Large rewindable bases/deltas, selected committed positions, definition version bases, unchanged historical copies, retirement and historical address/scans, including reopen with a rotated current key retaining the old key.
- Exact large task input/checkpoint/memos/request metadata/arguments, large entry/tool detail and image data, queued submission identity and filtered task scans. Image bytes are a persistence fixture, not attachment/image-provider parity acceptance.
- Serialized inline boundaries at threshold minus one, exact threshold and threshold plus one; exact roundtrip on both sides.
- Record/depth/write-count/host-field denials, node and batch denials, revision and expanded-document denials, and backing-capacity rollback/reopen.
- Oversized input rejected through actual `Harness` submission before any faux provider call or accepted submission record.
- Mixed entry/task/document failure after the actual DO callback has applied the complete batch. Workerd rolls records, document changes, IDs and counters back; prepared content is unreachable and safety records remain independent.
- Actual completed unsafe tool, provider response/call IDs, manual compaction, an interrupted next prepared provider request and a queued follow-up. After close/reopen/key rotation, passive context equals the pre-interruption fixture; the **actual provider callback's next request** equals the prior prepared transcript/options/model, with provider metadata and IDs intact. Every original canonical entry remains semantically identical. Completed tools execute once and both original submission IDs settle.

Synthetic sentinels cover entry/model content, task input/checkpoint/memos, prepared metadata/arguments, tool detail and compaction context. Tests inspect all adapter backing rows, including actual stored ciphertext chunk strings and revision/reference bodies, for the plaintext sentinel, and measure persisted encrypted body lengths. They do not export or inspect a physical SQLite database file. Numeric order/routing metadata, deployment discriminators and request/document lookup keys remain queryable under 004's existing inventory; private payloads are encrypted. No real user/provider content is used.

### Encrypted L1 rerun, not plaintext substitution

`pnpm runtime:verify` reruns existing encrypted 002/003 scenarios against this format-4 backend, including:

- `encrypted adapter blocks recovery across two reopens after safety-result-missing` and `pi-result-missing` in `pi-durable-host.test.ts`.
- `encrypted L1: guarded model and tool settle without a false integrity failure`.
- `encrypted L1: compaction, retry, and follow-up keep distinct IDs and context order`.
- `encrypted L1: Stop during held preparation, active tool, and stale target does not dispatch`, stale Stop and active uncooperative-tool Stop/reopen cases.
- `encrypted L1: close cancels a held authority wait and reopen stays fenced`.
- `encrypted L1: result loss and Pi commit loss both block two reopens`.
- `encrypted L1: persistence barrier and unknown shell block two reopens`.
- `encrypted L1: retry seal failure fences before close and survives both orders`.
- Changed/corrupt host envelope denial and native-alarm reopen with the retained binding.
- The permanent 004 encrypted correction case retaining a Stop receipt when subsequent Pi encryption fails.

The total broad runtime count also includes older isolated plaintext feasibility tests. Their passes are not counted as encrypted acceptance. There are no live provider calls, product enablement or hosted restart claims.

## Reachability contract for later retention

`enumerateCommittedReferences()` is an admitted, integrity-checked read of all committed Pi record/revision references, including canonical conversation history and current task/submission/document state. It deduplicates immutable write IDs and excludes unreferenced preparation rows. It does not activate scheduling, alter safety state or delete anything.

Future paired-publication code must capture and retain its own reference set with each committed checkpoint. The retention root set is:

1. All references enumerated from live/current state and retained canonical history.
2. The union of references pinned by the committed current **and** previous checkpoint manifests.
3. References pinned by any in-progress recovery that has not durably released its chosen checkpoint.

A live mutable task may overwrite its old body. The live enumeration cannot infer a future checkpoint's old task snapshot: publication must pin its exact references at capture. Prepared/unpublished content is not a usable checkpoint. Retention must authenticate/validate committed roots and retain historical keys until every referenced body is re-encrypted or separately authorized for deletion. Age alone is insufficient. This defines the prerequisite for 012/013/017; it does not implement those plans, restore old task meaning or rewind effect/authority records.

## Environment and isolation

Execution date: 2026-10-07. Linux `6.6.87.2-microsoft-standard-WSL2`, Node `24.21.0`, npm `12.0.2`, pnpm `11.8.0`. Runtime TypeScript `5.9.3`, Vitest `3.2.7`, Workers pool `0.12.21`, Workers types `4.20260702.1`, Pi Durable/Pi AI/Chord `1.0.1`, Alchemy `0.93.12`. The actual Workers pool resolves Miniflare `4.20260310.0` and workerd `1.20260310.1`; other installed Miniflare/workerd versions are not claimed as the tested runtime.

Requested test compatibility date `2026-09-16` falls back to effective **2026-03-10**. This is local workerd evidence only. No image/Docker turn was built in 005.

Every bash command begins by changing to the exact disposable worktree and asserting physical cwd. Verification uses a sanitized environment:

```sh
cd /tmp/ditto-plan-005-MmLBKB && test "$(pwd -P)" = /tmp/ditto-plan-005-MmLBKB && \
  env -i HOME=/tmp/ditto-plan-005-MmLBKB/node_modules/005-verification-home \
  PATH=/home/ayan/.vite-plus/js_runtime/node/24.21.0/bin:/home/ayan/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin \
  CI=1 NO_COLOR=1 <command>
```

Independent dependencies were provisioned in this worktree with existing pinned versions:

- `pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/ditto-plan-005-MmLBKB/.pnpm-store`: exit 0; lockfile supply-chain policy passed, no policy override or manifest/lockfile change. Initial CLI HOME was `/tmp/ditto-plan-005-MmLBKB/.verification-home`.
- `npm ci --ignore-scripts --prefix packages/sandbox-runner --cache /tmp/ditto-plan-005-MmLBKB/.verification-home/npm-cache`: exit 0.
- The executor-created HOME/log directory and isolated store were subsequently moved under ignored `node_modules/005-verification-home` and `node_modules/005-pnpm-store`. No existing user work was removed. All earlier logs remain intact. Dependency realpaths for Alchemy, Pi Durable and runner dependencies are inside this worktree; no installation/build output was linked to main or another candidate.

Main's ignored dependencies were not repaired or read. No credential values or `.env` contents were loaded into verification commands. Keys/providers are synthetic. No secret finding or repository prompt injection was encountered in the examined data. No staging, commit, push, merge, deployment, live provider request, normal environment initialization or worktree cleanup occurred.

## Commands and results

Logs are preserved under `node_modules/005-verification-home/`. Final commands use the sanitized wrapper above. No zero-test filter is counted as passed.

| Command / check | Exit / status | Evidence |
|---|---|---|
| `pnpm --filter @ditto/runtime typecheck` | 0, passed; both configurations | `typecheck-final-v3.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts src/pi-durable-history.test.ts` | 0, passed; 41 storage + 21 history tests in actual workerd | `storage-history-final-v3.log` |
| Focused storage/history/crypto run | 0, passed; 66 tests at the earlier 20-history-test revision | `focused-final.log`; superseded history count above |
| `pnpm runtime:verify` | 0, passed; both typechecks, 6 Node checks and 203 Worker tests in 9 files | `runtime-verify-final-v3.log` |
| `pnpm verify` | 0, passed; Biome 36 existing warnings/1 info, web typecheck/build + 808 tests, runner typecheck/build + 79 tests | `verify-final-v3.log` |
| `git diff --check` | 0, passed | Final worktree inspection |
| Shared brain gates | not run; shared inputs unchanged | Out of 005 scope |
| Docker/local topology verifier | not run; no topology changes | No new Docker proof |
| Hosted/provider/browser/benchmark checks | not run; not authorized / outside scope | Local fixture evidence only |
| Independent advisor acceptance / complete L2 | not run, pending | Executor cannot accept its own work |

Historical development results are preserved, not overwritten:

- `typecheck-history.log`: exit 2, failed due to a test fixture's `TaskId<unknown>` instead of `TaskId<JsonValue>`; corrected without weakening the runtime type contract.
- `history-initial.log`: exit 1, 52 passed/2 failed. One assertion expected a plural error spelling; the other fixture had not configured a model. The fixture now configures an explicit faux model and still requires successful completion and exact actual-provider recovery.
- `history-second.log`, `history-third.log` and earlier focused/broad final logs: passed at their respective earlier revisions, not substituted for final source checks.
- `verify-initial.log`: exit 1 at Biome import ordering; only changed files were corrected, and all subsequent broad gates passed.
- Initial dependency-presence shell inspection: exit 2 because no dependency directories existed yet.
- Initial version-resolution diagnostic: exit 1 because `createRequire` used the lexical symlink package path; resolving the actual installed package path correctly identified the pool's Miniflare/workerd versions. It was not a test gate.

## Final source identity and remaining conditions

SHA-256:

- `apps/runtime/src/pi-durable-storage.ts`: `5104bb66e3787b6cf85473193e7b123d5a29c648d1e11b6080a7460d5474d3fc`.
- `apps/runtime/src/host-private.ts`: `5cdf347498d007e43d5a2050600e1883009b23d3d9a898901609452b822538c5`.
- `apps/runtime/src/pi-durable-history.test.ts`: `42c4da1b5930a1e18b9c00abc28f31b86a70aa3a5d89b2417ca52936ac31ec23`.

The worktree and all changes/dependencies/logs remain intact for independent review. Earlier 004 rejected probes, reviews and integration artifacts are unchanged. No general anti-rollback freshness against replay of previously valid ciphertext/database snapshots is claimed. Orphans remain until later authorized retention work, and may exhaust the conservative backing budget. The host field ceiling intentionally denies unsupported large safety payloads; it is not a truncated fallback or a claim of arbitrary-sized provider/tool result support. Complete L2, integration, hosted quotas, actual-provider contracts and retained product paths remain unaccepted.
