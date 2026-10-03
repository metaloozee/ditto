# 005: Finish exact history and bounded private storage

Status: BLOCKED on 004. Base: `bcce03e`. Phase: L2 completion.
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

Stop on truncated substitutes, missing historical keys, unsupported task meaning or a reference protocol without proven failure handling. No reset, live model request, deployment, staging or commit. Future retention work must use committed reference reachability, not age alone; 017 will test cleanup with active recovery and current/previous pairs.
