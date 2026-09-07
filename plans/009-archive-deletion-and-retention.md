# 009: Archive final state, revoke deletion authority and retain recovery safely

Status: BLOCKED on 008. Base HEAD: `c963890`, branch `brain`. Effort: M-L, 4-6 days. Risk: high data loss/revocation.

## Goal and prerequisite contract

Make archive/continue, deletion and garbage collection part of the coordinator-owned lifecycle. Deletion revokes authority first and survives partial cleanup. Archive retains a final committed pair. Continuing archived work creates new lineage without resuming its old pending operations.

008 supplies stopped-or-isolated process evidence, both capacity pools, serialized preview lifecycle and revocation. 007 supplies immutable committed pair references and current/previous fallback. 004 supplies encrypted canonical history, idempotent projections and scheduled intents. 002 supplies permanent identity/deletion tombstones and cleanup rows that survive product-row removal. 003 provides the authenticated admission/idempotency/outbox mechanism, not archive/continue/delete command kinds. This phase adds those strict wire variants, owned-target admission and coordinator delivery together before lifecycle execution.

This phase implements policies/tests only in authorized local fixtures. It does not delete live work or run cleanup in a shared bucket/DB. Neither spec approval nor implementation approval is authorization for production destruction. No raw runtime export or generic retry of unknown effects is added.

## Rechecked evidence and exemplar

`apps/web/src/lib/session-preview.ts:1292-1293` already names the correct initial ordering:

```ts
/** Revoke project authority before runtime and archive cleanup. */
export async function deleteProjectRuntime(
```

The function at 1317-1348 marks project deleting and retires known sandbox identities before cancellation/cleanup. It knows only current identity/runtime paths, not canonical DO history or trusted brains.

`apps/web/src/lib/workspace-runtime.ts:1408-1412` creates a new session when continuing archived work:

```ts
const createId = options.createId ?? nanoid;
const sessionId = createId();
const [created] = await options.db
  .insert(workspaceSessions)
  .values({
```

At 1428-1435 it copies archive pointers; target must instead establish explicit pair lineage and re-encrypt continuation for the new owner/session AAD.

Existing test exemplar from `apps/web/src/lib/workspace-recovery.test.ts:252-263` asserts successful durable generation and no abandoned archive. Use that fixture style for focused archive policy, but target deletion/continue assertions must begin at authenticated commands and inspect retained history/recovery plus identity denial.

## Files

Modify `apps/web/src/lib/session-preview.ts`, `workspace-runtime.ts`, `workspace-recovery.ts`, `sandbox-archive.ts`, `runtime-product-service.ts` and corresponding tests. Existing lifecycle tRPC adapters under `apps/web/src/integrations/trpc/routers/projects.ts` and `workspace.ts` should only submit/observe commands, not destroy runtimes themselves. Extend `apps/web/src/lib/session-command.ts`, `session-command-delivery.ts`, `session-command.test.ts` and `packages/runtime-contracts/src/command.ts` for lifecycle variants. New `apps/runtime/src/lifecycle.ts`, `retention.ts`; new `apps/web/src/lib/session-runtime-retention.test.ts`. Extend `session-runtime.ts`, `journal.ts`, `reconcile.ts`, contracts and cleanup projection types. Read the complete routers before changing them; no unrelated settings/auth redesign.

## Planned state transitions

Add strict `archive`, `continueArchived` and `deleteProject` variants to the existing contract package and service, not a new package. None creates chat message pairs or requires model configuration. `archive` targets an owned active workspace; `continueArchived` targets an owned archived source, with idempotency scoped to that source and immutable new-session IDs in the receipt. Both use the source workspace sequence and owner fence. Default prompt rejection of archived targets must not reject the explicit continue variant.

`deleteProject` is project-scoped: owner + project idempotency, server-created command/receipt IDs, durable deleting barrier and cleanup intent in one D1 acceptance decision. Use the 002 target-kind schema and extend the strict command union for this target without inventing a workspace ID, run ID or per-session sequence. Durable fan-out produces linked, idempotent priority deletion intents for every retained session coordinator and cleanup for builders. The project barrier denies new authority immediately, before fan-out completes; session intents serialize locally without waiting for ordinary sequence gaps or capacity. Model outage, repeated deletion, missing/retired target and crash during fan-out have explicit receipt/tombstone outcomes. Reuse the 002 key/tombstone/cleanup tables and 003 delivery mechanism.

`archive` command: deny new mutating admission, account for active execution, revoke preview, commit final paired checkpoint, preserve canonical history/pair references and project projections, then retire identities/stop runtimes. If checkpoint fails, do not mark archived or discard work. Unknown uncooperative execution blocks archive of that workspace until genuine quiescence is established. Independently isolating a replacement does not make the old tree consistent. An acknowledged checkpoint restore creates a distinct recovery lineage and new pair; never label it a final capture of the old unknown workspace. A final already-committed pair can be reused only when it matches current mutation/position with no unresolved writer.

`continueArchived` command: reauthorize owner/project and archived source; allocate new workspace session, branch, random execution/brain identities and lineage. Clone validated canonical content as data, rebind encryption AAD to the new session, and establish a fresh initial pair after branch creation. Preserve the original final pair and branch. No pending command/effect from the old run becomes executable in the new session. Idempotency returns the same new session on retry.

`deleteProject` command: product first atomically records deleting state and durable revocation/cleanup intent, then retires all roles and closes operation authority before any runtime cleanup. D1 authority resolution must check project deleting/missing and tombstones so a crash while iterating identities still denies new admission. Coordinator also stores local deletion barrier. Delayed messages/results/projections cannot recreate removed rows. Cleanup can be retried without needing auth/provider keys for history operations.

## Ordered work and verification

1. Add the wire/admission variants above and route existing lifecycle adapters through them. Through authenticated tests, assert ownership rejection, same-key same receipt, conflicting payload rejection, model-free availability and deletion-fan-out crash recovery. Then inventory references: retained canonical entries, active effects, in-progress publication, current/previous/final pairs, cloned lineage, migration sources and pending projections. Each reference must pin underlying encrypted R2 records/archive bytes. Define reachability, not "delete anything older than N days". Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-retention.test.ts` after adding T32 reference-race fixtures.
2. Implement retention metadata: full canonical conversation/continuation, command idempotency keys and canonical payload hashes retained for workspace lifetime including archive; detailed denial records retain 30 days; unreferenced transient output eligible after 24 hours. Active runs and current/previous pairs pin all restoration dependencies. GC uses a stable mark/version check and revalidates references before deletion, so a concurrent pair commit or clone cannot lose content. Default unknown retention state to retain and report, not delete.
3. Implement archive/final pair and continue-new-lineage commands. Test final backup failure leaves archive blocked but completed assistants unchanged; retries do not duplicate archive/continue; original history and pair remain untouched; new AAD rejects old-session ciphertext swapping; pending effects are visible historical facts only. Cold reads of archived work start neither container.
4. Implement revoke-first deletion of all identities including builders and brains, close windows, priority cancellation, preview revocation, terminate/isolate runtimes, release capacity only after stopped evidence and enqueue content cleanup. Deleting state wins over any publication/projection race. Already-admitted effects can finish and be accounted for, but no new model/tool/Git request succeeds. T33 injects crash at every step, late command, stale callback and pending D1 projection. Retain 004's exact identity/incarnation/epoch observation fields and evidence source; revoked flags, TTLs and cancel acknowledgments never prove stopped. An independently isolated replacement leaves the old live claim occupied. Test observation/CAS incarnation races and assert old external outcomes stay unknown.
5. Use retryable cleanup jobs and minimal fences with no cascading foreign-key dependency on project, workspace-session or auth rows. Before removing those rows, durably enumerate/pin the cleanup manifest and record deletion barriers. Purge full canonical DO/D1/R2 content, idempotency keys and payload hashes through authorized deletion cleanup; never retain them indefinitely as tombstones. Minimal fences retain only opaque target/identity IDs, owner/version, retirement/deletion state/time and cleanup correlation, not instruction text, raw keys, secret payload hashes or bearer values. Cleanup manifests may retain necessary access-controlled object references only until deletion completes or visible intervention; encryption keys remain available while referenced encrypted content still needs authorized cleanup/restore. Preserve minimal non-secret retired identity and deleted-target tombstones. Do not call blanket DO deletion that erases identity evidence or Container scheduler state required to finish cleanup. If permanent tombstone lives in D1, retain sufficient local deletion barrier to deny late calls too.
Add real SQL/cross-store crash assertions for 004's projection CAS: update-only membership and lexicographic owner-version/sequence, no current-run-epoch rejection of an older run's own assistant, zero-row stale/deleted acknowledgment versus retryable outage, no completed-to-failed write. Race old-owner projections and new terminal projections with deleting project/session/auth rows. Assert cleanup jobs and minimal fences survive, removed targets are never upserted, eventual cleanup removes full keys/hashes/content, and late deliveries still deny without retained payloads.
6. Persist cleanup attempts/backoff and visible intervention after eight unsuccessful attempts; do not silently abandon cleanup. Retry state contains only object metadata/IDs in access-controlled storage. It does not contain decrypted content, model keys or preview capabilities. Operator-visible category/correlation identifies stuck cleanup, not arbitrary raw errors.

Final future commands:

```sh
pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-runtime-retention.test.ts src/lib/workspace-recovery.test.ts src/lib/sandbox-archive.test.ts src/lib/session-preview.test.ts src/lib/workspace-runtime.test.ts src/integrations/trpc/routers/projects.test.ts
pnpm --filter @ditto/runtime typecheck
pnpm typecheck
pnpm check
```

Expect exit 0 and every T32/T33 crash/race case exercised without real storage cleanup. Parent baseline is independent prior evidence only. The documented web `test --` wrapper may select all files; narrow `exec vitest run` is intended.

## Done, handoff and stop

010 receives observable archival/continuation/deleting/cleanup-intervention states and explicit allowed recovery actions. 011 receives immutable migration source pinning and ownership-safe lifecycle, not a destructive reset helper.

Done means T32/T33 PASS, archived final recovery retained, continue creates exactly one new lineage/branch/identity set, GC cannot remove pinned objects, and no delayed projection or delivery recreates deleted product records. Cleanup remains recoverable after deleting product rows, and all new privileged admissions fail immediately after initial deleting state.

STOP if cleanup requires removing identity tombstones, archive can succeed before final pair commit, new sessions resume old unknown tools, GC depends only on wall-clock age, or live resources are the only way to verify behavior. Any new R2 record type must declare reference ownership, retention, deletion and clone/AAD semantics before shipping.
