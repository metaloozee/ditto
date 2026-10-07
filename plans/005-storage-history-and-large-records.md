# 005: Finish exact history and bounded private storage

Status: DONE for the independently accepted local scope, integrated into `feat/pi-durable` at `432e332`. Corrected 005 plus integrated 004 complete local L2 within the documented bounds. The user authorized commits and detached-worktree cleanup; see [integration](evidence/005-integration.md). Execution base: `923ab61916a1f9691b892f2263e3bc281fc65dd6`. Historical planning base: `bcce03e`. Phase: L2 completion.

004's format-3 core is accepted and integrated at `5173e12`. This candidate extends that backend rather than replacing its transaction, counter, routing-authentication or close-draining protocol. See [005 executor evidence](evidence/005-private-state-acceptance.md), the preserved [initial advisor blocker](evidence/005-advisor-initial-review.md), and [initialization correction evidence](evidence/005-initialization-correction.md). The [final advisor review](evidence/005-advisor-final-review.md) accepts local L2 after independently passing 208 Worker plus 6 Node checks, repository gates and all four advisor probes. Executor reports remain historical READY FOR REVIEW evidence.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 4, 6, 10–11, 14, 17; PD11, PD17–PD19, PD36; supplies reference prerequisites for PD35, whose GC test belongs to 017; OD2–OD5.

## Outcome

Reconstruct the exact Pi conversation, document history, prepared request and task state after interruption, including content larger than an inline SQLite record. Bounds may reject unsupported work before acceptance or split/offload it; they must not silently truncate context.

The runtime persistence implementation owns record references and crypto. Workspace recovery will later select conversation positions. It must not rewind effect/authority records. This plan supplies that capability but does not implement checkpoint restore or GC.

## Current code and scope

`apps/runtime/src/runtime-crypto.ts` defines a useful existing manifest shape:

```ts
export type RuntimeChunkManifestV1 = {
	version: 1;
	recordId: string;
	writeId: string;
	chunkCount: number;
	totalLength: number;
	digest: string;
	formatVersion: number;
	chunks: RuntimeCiphertextV1[];
};
```

Existing crypto limits include a 32 KiB inline ceiling, an 8 MiB total payload ceiling and 16 KiB chunks. The total ceiling is not permission to store an 8 MiB SQLite row. Those are old utility choices, not proof all Pi representations fit. `journal.ts` has large-record manifests/chunks and a separate custom continuation table. Reuse verified crypto mechanics, not the old continuation format.

Scope: storage implementation from 004, crypto/reference codecs, runtime-owned R2 adapter if needed, tests and evidence. Bindings are assembled at the entry point, not discovered in domain code. No benchmarks, dependency-inclusive archives, legacy importer, runtime enablement or deletion of existing records.

## Refreshed execution decisions

The installed `@earendil-works/pi-durable@1.0.1` Storage contract exposes atomic `commit(writes, context): Promise<Seq>`, complete task replacement, ascending filtered scans, newest-first fork-aware entries and half-open document incarnations. Document copies require an unchanged source in the batch and matching kind/key/history/fork. Materialization selects the newest base at the requested sequence, then applies same-version Chord deltas. The exported `registerStorageConformance` is registered against actual DO SQLite, not a synthetic repository.

The candidate uses storage format **4**, adapter `ditto-encrypted-storage-4`, crypto format 1. Earlier storage/adapter versions fail closed; no migration or continuation importer is added. A serialized plaintext record is inline through 32 KiB and otherwise splits into independently encrypted 16 KiB plaintext chunks in the same runtime-owned SQLite backend. The persisted manifest contains identities/count/length/digest/version, **not chunk bodies**. No R2 binding is selected and no entrypoint or Alchemy change is needed.

Ceilings are 8 MiB per serialized record/reconstructed value, 16 MiB per incoming batch, 64 KiB per encrypted body/manifest, 1,024 writes, 100,000 visited JSON nodes (including keys), depth 64, 4,096 revisions per document and 4,096 chunks per reference. Routing strings have a 1 KiB serialized ceiling. The backend has a 16 MiB accounted private-body budget including a conservative 4 KiB per-row allowance. It is not a physical SQLite-file quota or performance measurement. Injected options may lower, not raise, ceilings. Fresh initialization preflights the exact serialized/encrypted counter representation and all required backing rows before creating schema or content; insufficient limits leave no adapter tables and permit a later normal open without reset. Host safety/private fields explicitly reject above 32 KiB plaintext/64 KiB encrypted rather than silently truncating; the existing synthetic command ceiling remains 8 KiB.

Chunk content is prepared, persisted, read back and authenticated before committing its manifest reference. A short synchronous metadata transaction rechecks index/snapshot integrity and includes records, ID claims and authenticated counters. Preparation failures can leave encrypted orphan chunks, never authoritative references. Orphans consume the backing budget and are not eagerly deleted. A lost successful response is resolved by reading the committed state. Missing/corrupt referenced content blocks reopen and live recovery. Before-effect size rejection is tested through actual Harness submission; results whose host-private envelope exceeds its supported ceiling fail sealing instead of advancing with a shortened value.

`enumerateCommittedReferences()` returns references from current Pi records and all retained canonical document revisions, excluding prepared orphans. Future current/previous checkpoint manifests must pin the references needed at publication; future retention enumerates the union of canonical/live references, both committed checkpoint pin sets and any active recovery pin set. An overwritten mutable task's old reference is not automatically retained by the live scan: the checkpoint must retain its own captured reference set. No restore or GC implementation is included.

## Ordered work

1. Refresh this conditional plan from 004's actual backend. Read the upstream document materialization, historical scans, task checkpoint and mixed-commit contracts. Specify byte ceilings for serialized and encrypted forms, including encryption/manifest overhead, entry count, nesting and reconstruction. Decide deterministic inline versus split/offload policy. State how a request rejected for size fails before effects.
   Check: `pnpm --filter @ditto/runtime typecheck`, expected exit 0.
2. Implement exact base/delta/history storage and materialization. Test document histories at selected committed positions, compaction metadata, prepared provider state, tool results and submission inboxes together. Use synthetic unique sentinels in all private fields and inspect backing SQLite/R2 bytes for plaintext leaks.
   Add `apps/runtime/src/pi-durable-history.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts src/pi-durable-history.test.ts`.
3. Implement bounded encrypted split/offload when inline limits are exceeded. If R2 is selected, provision a runtime-owned local test binding through Alchemy and entrypoint injection; the existing website bucket is not implicitly available to the runtime. Product callers and sandboxes receive no object key or storage capability. Content must exist and verify before a transaction commits its reference. Record lengths/digests/versions and bind chunks to record/write identity. Inject failure before upload, between chunks, after content upload but before metadata, and after metadata acknowledgment loss. Prepared unreferenced content is not authoritative; missing/corrupt referenced content blocks recovery.
   Same command. Assert exact semantic round-trip for large task inputs, model requests, images if supported and document history, not a shortened summary. Test at threshold and over configured ceilings without requiring giant allocations.
4. Rotate keys while old content remains referenced. Reopen and reconstruct a compacted conversation with completed tools and a queued follow-up. Compare the actual next prepared provider context against the pre-interruption fixture, including provider metadata and IDs. Check mixed-write rollback leaves neither partial document changes nor a usable dangling reference.
   Same command in workerd. Extend `runtime-crypto.test.ts` only for new codec behavior.
5. Define a reference-enumeration contract for active state, canonical history and future current/previous checkpoint retention. Do not build a second generic storage repository or eagerly delete content. Record L2 evidence under `plans/evidence/005-private-state-acceptance.md`; run `pnpm runtime:verify` and `pnpm verify`.

## Acceptance and maintenance

L2 passes only if upstream conformance, actual DO rollback/reopen, encrypted history, size handling and exact reconstructed context all pass across 004/005. Re-run 002/003's host, Stop, persistence-failure and two-restart uncertainty scenarios against this encrypted backend; the earlier synthetic plaintext results alone cannot close L2. List environment, versions, commands and `passed`/`failed`/`not run`. Do not claim production performance or hosted quotas from these tests.

Executor implementation and command results are recorded in [005 evidence](evidence/005-private-state-acceptance.md) and the [initialization correction](evidence/005-initialization-correction.md). The [final advisor review](evidence/005-advisor-final-review.md) closes the reviewed local L2 gate. Exact reviewed source is committed at `e67043d` and merged at `432e332`. Evidence was archived before removing the detached execution worktree. See [integration](evidence/005-integration.md). No retained product, hosted, actual-provider, restore or GC acceptance is claimed.

Stop on truncated substitutes, missing historical keys, unsupported task meaning or a reference protocol without proven failure handling. No reset, live model request, deployment, staging or commit. Future retention work must use committed reference reachability, not age alone; 017 will test cleanup with active recovery and current/previous pairs.
