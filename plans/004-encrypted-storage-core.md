# 004: Implement encrypted Pi storage and transactions

Status: BLOCKED on passed L1, plans 002 and 003. Base: `bcce03e`. Phase: L2, core storage.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.4, 4, 6, 10, 17–18; PD13, PD17–PD19, PD36; OD2, OD3, OD5.

## Outcome and scope

Implement the selected Pi Storage contract over actual runtime DO SQLite with application encryption of every private payload. The persistence implementation owns transaction mechanics, schema and versions. Runtime safety state remains runtime-owned and non-rewindable. Do not treat an encrypted final message as encrypted canonical state.

Scope: runtime storage/crypto implementation and tests, necessary schema/version metadata, real-worker test configuration and evidence. No product enablement, legacy continuation import, maintained fork, plaintext retained-user mode or deployment. 005 completes history/size acceptance before L2 passes.

## Current code and conventions

`apps/runtime/src/runtime-crypto.ts` already models authenticated record ownership:

```ts
export type RuntimeAad = {
	ownerId: string;
	workspaceSessionId: string;
	recordId: string;
	formatVersion: number;
};
```

Its AES-256-GCM utilities and keyring are reusable after review. `journal.ts` exposes a synchronous `transaction<T>(fn: () => T): T`, which cannot implement an upstream asynchronous transaction callback by assertion. Stock Pi SQLite stores plaintext. Use a conforming custom Storage backend or reviewed supported extension, not encryption around a SQL string facade.

Follow `apps/runtime/src/runtime-crypto.test.ts`: it injects deterministic synthetic key material, asserts ciphertext differs across writes, and tests wrong owner/session/record AAD. Never use live key values in fixtures or reports.

## Steps and checks

1. Read pinned upstream Storage and transaction contracts, the pinned package's exported conformance seam, documented as `registerStorageConformance` at the researched revision and passed L1 handoff protocol. Write the record inventory and encryption layout in evidence: entries, submissions, task checkpoints, prepared model requests, tool arguments/results, document bases/deltas/history and mixed writes. List only structural routing/order metadata left queryable. Define schema, engine/task/tool/provider/adapter compatibility versions and fail-closed reopen behavior before scheduling.
   Check: `pnpm --filter @ditto/runtime typecheck`, expected exit 0. If upstream exports differ, update this conditional plan's concrete methods before implementation; do not invent them.
2. Implement the storage backend using actual DO transactions. Preserve ordering, scans, rollback, unrelated-operation exclusion and expired-handle rejection. Prepare asynchronous encryption outside synchronous callbacks, then recheck mutable guards/versions before commit, or use the supported asynchronous transaction interface correctly. Never issue forbidden manual transaction SQL or substitute concurrency blocking for rollback. Connect the L1 safety handoff without a second transcript.
   Add `apps/runtime/src/pi-durable-storage.test.ts`. Run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-storage.test.ts` with the upstream conformance suite registered against the real DO adapter.
3. Encrypt before any persistence using unique nonces and AAD binding owner, workspace session, record identity and format. Keep runtime keys separate from product authentication and credential keys. Inspect raw synthetic SQLite rows to prove private sentinels are absent across each record family. Deny storage integrity failures before further model or executor admission.
   Same command plus `pnpm --filter @ditto/runtime exec vitest run src/runtime-crypto.test.ts`.
4. Confirm the selected upstream conformance export actually exists; if it does not, stop and resolve the supported conformance seam rather than silently replacing it with a weaker suite. Inject callback rejection, rollback failure, concurrent unrelated writes and post-transaction handle reuse. Reopen a real local DO and verify all-or-nothing changes, ordering and no scheduling before verification. Test tampering, record swaps, missing/unknown keys, rotated current key with historical key retained, and incompatible engine/task/adapter state.
   Same commands, expected all scenarios pass without plaintext fallback. Focused crypto/storage tests are permitted below the product interface because they prove backend semantics.
5. Remove synthetic plaintext storage from any candidate path which can later accept retained content. Keep it only in explicitly isolated L0/L1 fixtures if still needed. Run `pnpm runtime:verify` and `pnpm verify`; run retained brain verification when shared inputs change. Save results under `plans/evidence/004-encrypted-storage.md`.

## Done and handoff

Core conformance, crypto and transaction fault tests pass in workerd, not only Node. Inventory every representation, including future large references. 005 must prove exact document history and oversized content before claiming complete L2 acceptance or full PD19 coverage. Re-run L1's safety/crash protocols on the encrypted adapter before L2 exits. Benchmarks are not required.

Stop if conformance requires a fork, encryption would omit a representation, or the proposed transaction protocol cannot demonstrate both crash orders. Preserve evidence rather than weaken encryption. No reset, deployment, live request, staging or commit is authorized. Future schema/key changes must preserve referenced historical decryptability or explicitly block reopening until a tested migration is available.
