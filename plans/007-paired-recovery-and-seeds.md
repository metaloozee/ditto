# 007: Publish paired checkpoints and preserve seed/archive policy

Status: BLOCKED on 006. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-8 days plus benchmarks. Risk: high data loss and false continuation.

## Target and prerequisite contracts

A saved assistant may describe an edit newer than the last archive. Restore filesystem and Pi continuation from the same committed pair, not the latest transcript plus an older tree. Relocate builder/archive execution behind runtime service bindings while preserving immutable seeds and token-free transport.

006 supplies full Pi pause/snapshot/restore at an acknowledged safe boundary, exact committed position, logical effect reconciliation and current incarnations. 004 supplies encrypted state, short SQLite commits, pending projections and scheduler. 005 supplies remote executor dispatch. This phase implements fixed-path bounded archive transport by reusing `sandbox-archive.ts`; it is not a completed 005 deliverable. No R2 authority enters containers. 002 supplies archive/pair metadata and ownership fences. `@ditto/runtime`, contracts and independent brain scripts already exist.

This phase does not stop live production containers or migrate retained work. New target operations are fixture-only until 008 proves capacity and 012 releases. Dependency-inclusive recovery stays disabled unless the stated benchmarks pass. No periodic VM snapshots or per-tool full archive is required.

## Rechecked local evidence

`apps/web/src/lib/sandbox-archive.ts:6-12`:

```ts
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_COMPATIBILITY_KEY = "ditto-workspace-archive-v1";
export const ARCHIVE_MAX_COMPRESSED_BYTES = 1024 * 1024 * 1024;
export const ARCHIVE_MAX_EXTRACTED_BYTES = 3 * 1024 * 1024 * 1024;
export const ARCHIVE_MAX_DISK_PERCENT = 70;
export const ARCHIVE_TEMP_PATH = "/tmp/ditto-workspace-archive.tar.gz";
export const ARCHIVE_CLI_PATH = "/opt/ditto-runner/dist/archive-cli.js";
```

Preserve ceilings and fixed paths. The same module contains incremental hashing rather than whole-archive buffering. `apps/web/src/lib/workspace-recovery.ts:1-7` explains that failed agent runs can still have filesystem mutations; assistant status and recovery health are separate.

`apps/web/src/lib/project-seed.ts:27-31` pins dependency-policy version and image revision `cloudflare/sandbox:0.12.3`; its compatibility key records `deps=source-only` at line 101. Its builder uses `env.Sandbox` at 78-83 today, so it must move to the runtime service without creating a brain for seed jobs.

Existing behavior exemplar, `apps/web/src/lib/workspace-recovery.test.ts:252-257`:

```ts
expect(state).toMatchObject({
  state: "healthy",
  mutationGeneration: 1,
  durableGeneration: 1,
  pending: false,
});
```

Extend observable behavior with matched continuation position. Do not copy direct checkpoint-helper assertions as the sole target acceptance boundary.

## Files and planned APIs

Existing `apps/web/src/lib/workspace-recovery.ts` and `.test.ts`, `sandbox-archive.ts` and `.test.ts`, `project-seed.ts` and `.test.ts`, `sandbox-bootstrap.ts`, `session-git-backup.ts`; runner `src/archive-cli.ts`, `archive.test.ts` and Dockerfile. New `apps/runtime/src/checkpoints.ts`, `seed-job.ts`, `apps/web/src/lib/session-runtime-recovery.test.ts`; extend `runtime-product-service.ts` and portable `CheckpointPairV1`/compatibility types. Use narrow shared policy dependencies; do not import product auth secrets into runtime.

`prepareCheckpoint({expectedEpoch, expectedMutationGeneration, expectedPosition, reason})` is coordinator-owned. `restorePair({pairId, expectedOwnerVersion, targetIdentities})` verifies coordinator commitment before reading archive bytes. Public commands carry recovery choice, not archive object keys. `seedJob({ownedProjectId, registeredBuilderIdentityId})` is a bounded runtime-service job, not `SessionRuntime` work.

## Archive dependency and transport handoff

Narrow `apps/web/src/lib/sandbox-archive.ts` to explicit `ArchiveDependencies { bucket, db, sandbox, now, createId }`, retaining only the bucket/DB/Sandbox methods actually used. Remove its global product `Env` dependency. `apps/web/src/lib/workspace-recovery.ts` and `project-seed.ts` assemble the legacy/product adapter; planned `apps/runtime/src/checkpoints.ts` and `seed-job.ts` assemble the runtime adapter from runtime bindings and the registered stable Sandbox handle. Reuse the current archive policy module, including limits, digest, registry and extraction rules. Resolve its `#` imports/type-only DB dependencies explicitly in the runtime build and prove the transitive graph excludes product auth initialization and global product bindings. This is not a blanket ban on importing narrow `apps/web/src/lib` policy. Only genuinely portable contract/validation code may move into the existing runtime-contracts package; no extra package.

Implement the exact stable Sandbox `readFile`/`writeFile` streaming recipe proved in 001. The Worker owns the Sandbox handle and invokes the fixed image-owned archive CLI at `/opt/ditto-runner/dist/archive-cli.js` against `/workspace` and `/tmp/ditto-workspace-archive.tar.gz`. Capture completes with a bounded CLI result before Worker reads the fixed archive path; restore streams Worker-fetched bytes into that fixed temp path, awaits write completion, verifies count/digest, then invokes validated extraction. Encode/chunk only as the pinned SDK requires, with byte/frame bounds and backpressure, never a whole 1 GiB byte array. Register ready/prepared metadata only after CLI and stream finalization succeed; partial writes/uploads remain nonrestorable preparation.

Persist transfer intent before I/O with pair/archive ID held only in Worker storage, expected owner/epoch/incarnations/generation/position, direction, fixed-path operation, limits/deadline and stage. Worker checks current authority at dispatch and CAS finalization; a late completion cannot publish after Stop/deletion or an incarnation change. Reconciliation resumes metadata finalization from verified immutable bytes, or discards only that intent's isolated temporary/prepared data when unreferenced. It never repeats tools or trusts a container's success receipt as authority. No public upload endpoint, per-chunk bearer capability, R2 key/object key/signed URL or bucket mount enters either container. If stable streaming support is not proved in 001, STOP rather than invent a new transport.

## Recovery handlers delivered here

Enable `restore_checkpoint_acknowledging_loss` and `retry_backup` from 003 only when their admission and coordinator handlers are implemented together. Explicit restore revalidates the exact pair and expected generation/position and loss acknowledgment, requires 004/006 stop-or-isolation evidence, allocates execution capacity under 008 policy when enabled, and starts no brain. Unlike automatic current/previous fallback, it cannot silently substitute a different pair for the user's exact choice. The replacement has a distinct recovery lineage; old external effects remain unknown and its old live container retains capacity until termination. `retry_backup` is model-free, creates no messages, never repeats a tool, and cannot clear unknown-effect review. Reuse valid captured bytes for publication-only retry; otherwise require genuinely quiescent capture. Until 008 supplies real capacity, these handlers remain executable only in isolated fixtures.

## Ordered implementation

1. Define immutable pair compatibility: archive format, repository/source commit, frozen workspace base, dependency input hashes and manager/version, Node version/arch, execution/brain image revision, Pi/adapter/journal versions and dependency-policy revision. Compatibility validation is strict and versioned. Restore rejects unsupported state rather than silently converting it.
2. Establish initial pair after compatible seed restore and owned default-branch synchronization, before first agent mutation. Freeze the resulting base commit; later turns do not move it automatically. Seed builders remain distinct random Sandbox identities with execution-pool admission, a coordinator-equivalent bounded git window, no SessionRuntime/brain/model/project values, and permanent retirement after completion or failed-job cleanup. Until 008's real pool exists, executable target builder startup is closed outside tests. Product resolves GitHub/default-branch ownership, registers builder and calls runtime; runtime never receives the GitHub App key.
3. Implement publication as recoverable stages with immutable IDs:
   1. Acquire coordinator-exclusive workspace mutation ownership and persist checkpoint intent/expected position.
   2. Pause Pi at safe boundary, resolve admitted tools and quiesce managed preview/writers. Preview deferral policy comes in 008; do not claim a process is stopped because a lock expired.
   3. Capture archive and Pi continuation at the same mutation/position with no intervening write.
   4. Stream fixed-path archive through runtime Worker R2 binding, compute/verify byte count and digest, record prepared archive in D1. Container receives no object key, R2 key, signed URL, mount, nonce or bearer token.
   5. Encrypt and persist immutable continuation bytes and compatibility metadata. Prepared records remain unavailable for restore.
   6. Commit `CheckpointPairV1` and pending D1 pointer projection together in coordinator SQLite, compare-and-set expected epoch/generation/position. If state changed during I/O, reject publication and retain/cleanup preparation.
   7. Project current/previous pointers idempotently, then enqueue cleanup of unreferenced older pairs. 009 implements full retention tracing; until then retain rather than prematurely delete.
4. Implement interruption reconciliation at every stage. Completed uploads can finish metadata publication without re-running tools. Failed preparation is cleaned only when no committed pair or active intent references it. A D1 current pointer without coordinator commitment is never selected. A committed pair with delayed projection is usable through coordinator authority.
5. Implement restore into a rotated lifecycle generation/new expected incarnation. Verify compressed byte count, digest, format, compatibility, extracted-size and peak-disk ceilings; reject path traversal, symlink/hardlink escapes, devices/sockets and outside-workspace writes. Independently verify image-owned execution adapter health rather than trusting files in the archive. Failed partial extraction is discarded only in the isolated replacement workspace owned by this restore; never erase retained user work without acknowledged loss.
6. Try current committed pair, then previous committed pair, restoring both tree and continuation for the chosen pair. Preserve both failure evidence and block if neither works. Never restore project seed over a mutated workspace. After sandbox loss, later conversation remains visible as interrupted history, not replayed as current files. Keep post-checkpoint external effects unresolved even when local files roll back. Read-only/expected-write recovery policy is explicit; shell unknown is not retried.
7. Preserve assistant completion if backup fails, mark recovery degraded, retry publication/checkpoint separately, and block archive until a final pair commits. Managed preview mutations outside a quiescent capture remain disposable. Initial and normal checkpoints use quiescent run or mutating Git boundaries, not arbitrary timer snapshots.

## Test/benchmark ownership

Primary new boundary test `session-runtime-recovery.test.ts` owns T17-T20. Submit prompt/Git/recovery commands, kill at each of the seven publication stages, restart coordinator and inspect snapshots plus files. Test current/previous continuation identities, not only archive IDs. Include stop/deletion intent racing publication, wrong generations, R2/D1 failure, truncated stream, and successful assistant followed by failed backup.

Add dependency-graph checks and adapter tests for streamed read/write backpressure, byte ceilings, finalization failure, truncated transfer, stale incarnation and deletion during finalization. Add recovery-command same-key/conflict tests, stale pair/generation/loss acknowledgment rejection, live-writer isolation denial and publication-only retry with zero tool/model/container starts. Retain archive traversal/extraction and seed ownership tests. New target archive adapter health must not require old Pi CLI presence in executor after 011. T18 explicitly kills executor after a journaled edit before archive, restores the older pair and sees interrupted later history. T19 corrupts current then previous and asserts no seed restore.

Dependency benchmark gate P-Dependencies: at least ten cold restores for each source-only+install and dependency-inclusive path, across representative small/medium/large repositories. Record p95 ready-to-run, archive/extracted/image/temp bytes, permissions/native-module failures and measured disk. At least 30% p95 improvement in each representative path with every safety check passing is required to enable inclusion. Any failure selects source-only. Record dependency policy separately as `enabled` or `disabled-source-only`, and benchmark evidence separately as PASS/FAIL/NOT RUN. Selecting tested source-only is an allowed policy outcome, never a benchmark PASS. P-Archive remains mandatory under either policy. Archive limits remain 1 GiB compressed, 3 GiB extracted and <=70% peak disk including both images' relevant capacity, workspace, archive and temp use. Do not inherit the historical fixed `basic` sizing instruction.

Future commands, after 002's contracts build/consumer-freshness prerequisites before any brain invocation:

```sh
pnpm contracts:verify
npm run contracts:check --prefix packages/session-brain
pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-recovery.test.ts src/lib/workspace-recovery.test.ts src/lib/sandbox-archive.test.ts src/lib/project-seed.test.ts src/lib/session-git-backup.test.ts
npm test --prefix packages/sandbox-runner -- src/archive.test.ts src/remote-tool.test.ts
npm run typecheck --prefix packages/sandbox-runner
pnpm runner:verify
pnpm --filter @ditto/runtime typecheck
npm run typecheck --prefix packages/session-brain
pnpm typecheck
pnpm check
```

Expect exit 0 and all injected stages exercised. Define a proposed `apps/runtime/src/archive-benchmark.test.ts` before its command `pnpm --filter @ditto/runtime exec vitest run src/archive-benchmark.test.ts`; it uses local disposable repositories only, outputs bounded measurements and skips nothing when a benchmark is claimed PASS. This benchmark and near-ceiling paid transfer P-Archive are NOT RUN here. Do not describe a fixture stream as a paid archive benchmark.

## Handoff, done and stop

008 receives `checkpoint` with safe quiescence and reusable captured bytes, cold paired restore without Pi startup, initial-baseline gate, source-only seed builder and pending-since timestamp support. 009 receives immutable pair references and cleanup intents.

Done requires T17-T20 passing, zero restore of prepared pairs in crash tests, matching archive/continuation fallback, immutable frozen base and source-only fallback tests. No uncheckpointed work is destroyed by phase commands. Dependency inclusion stays off if benchmark rows are NOT RUN/FAIL.

STOP if streaming requires exposing R2 authority, archive size exceeds measured disk, safe boundary cannot be established, continuation is newer than restored tree, or existing mutated work would fall back to seed. Changes to archive format, dependency fingerprint, image or Pi version require compatibility and fallback tests, not a renamed compatibility string alone.
