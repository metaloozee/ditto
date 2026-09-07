# 004: Make the coordinator authoritative and encrypt its journal

Status: BLOCKED on 003. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-8 days. Risk: high.

## Target and prerequisite contract

D1 admission alone cannot supervise a run. Build `SessionRuntime extends Container` on the new runtime Worker, with short SQLite transitions, durable wakeup intents, encrypted continuation/effect records and retryable product projections. Pi and real repository execution arrive later, through the exact adapters defined here.

003 supplies authenticated versioned commands and receipt/message IDs, monotonic per-workspace sequences, outbox retry and priority Stop. 002 supplies `runtimeOwner` fencing, distinct lifecycle/run/mutation generations, permanent identities, versioned contracts and projection schema. 001 supplied the supported Container scheduling/identity recipe and pinned Pi feasibility evidence. `@ditto/runtime` has `typecheck` and `test`; `@ditto/runtime-contracts` has build/test/typecheck. Import portable contracts only into Node; no DO stub or D1/R2 credential enters a container.

No production/default routing switch, legacy key removal, provider request, or real mutating run is enabled here. Admission to actual execution remains closed until the downstream capacity and initial-pair gates exist. Deterministic transport faults in the test fixture are not Cloudflare evidence.

## Rechecked local evidence

`apps/web/src/lib/workspace-runtime-capacity.ts:627-657` currently marks a running work lease failed using `work_lease_expired`, then settles assistants and releases capacity. That must remain legacy-only. A dispatcher lease is not process liveness.

`apps/web/src/db/schema.ts:124-130` has assistant lifecycle `pending | complete | failed`. Preserve those product states even though coordinator runs have more states.

`apps/web/src/lib/crypto.ts:1-4`:

```ts
const ENCRYPTION_VERSION = "v1";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 310000;
```

The existing module supports AAD, but its project-value encryption and auth-secret derivation are not a runtime-state keyring. Do not repurpose `BETTER_AUTH_SECRET`.

Existing test shape, `apps/web/src/lib/crypto.test.ts:36-38`:

```ts
await expect(decryptText(payload, secret)).rejects.toThrow(
  /Failed to decrypt/,
);
```

Use generated, non-secret test keys for new tests and assert wrong-owner/missing-key failures through restore as well as focused crypto tests. Do not log keys or decrypted records.

## Files

New runtime files: `apps/runtime/src/session-runtime.ts`, `journal.ts`, `runtime-crypto.ts`, `product-projector.ts`, `reconcile.ts`, `runtime-crypto.test.ts`. Modify `apps/runtime/src/server.ts` and its inferred binding types from 001. New product tests: `apps/web/src/lib/session-runtime-journal.test.ts`, `session-runtime-control.test.ts`. Extend `apps/web/src/test/session-runtime-fixture.ts`, `session-runtime-client.ts`, and GET observation on `apps/web/src/routes/api.agent.stream.ts`.

Narrow shared DB/policy dependencies in `apps/web/src/lib/sandbox-authority.ts` and `workspace-runtime-capacity.ts`, without copying their policy into runtime. No broad auth or UI imports. Root Alchemy changes remain target/local-only until 011; runtime encryption key bindings must not be added to the product Worker.

## Internal schema and APIs

Coordinator SQLite contains:

- `commands`: immutable IDs/hash/message mapping, sequence, consumption state and target-run stop barriers; dedupe lifetime equals retained workspace.
- `runs`: state `queued|starting|running|recovering|stopping|complete|failed|canceled`, epoch, owner version, first interruption and recovery deadline, current brain/executor incarnations and blocked-review reason.
- `effects`: logical run/assistant/tool identity, attempt, state, encrypted validated arguments/result reference, expected incarnation, epoch, persisted individual deadline and replay policy.
- `continuations`: encrypted versioned snapshots/entries and committed execution position; `checkpoint_pairs` prepared/committed manifests arrive in 007.
- `events`: semantic sequence and redacted payload; `projections`: pending D1 changes keyed by `(workspaceSessionId, targetKind, targetId)` and ordered by `(runtimeOwnerVersion, coordinatorSeq)`; `wakeups`: durable reason/deadline/attempt intent.
- `process_observations`: trusted observation ID/source, stable identity/class, incarnation, lifecycle generation, observed run epoch, observation time, termination result or replacement identity plus isolation evidence reference. Keep unresolved-effect and capacity references until reconciled; these records are not container-authored proof.

Canonical content is encrypted before SQLite or R2. Keep only operational indexes and non-content IDs/times/state plaintext. `RuntimeCiphertextV1` uses AES-256-GCM, unique 96-bit nonce, 128-bit tag, key version and canonical AAD `['ditto-runtime', ownerId, workspaceSessionId, recordId, formatVersion]`. An immutable record rewrite uses a new nonce. Keyring bindings identify current write version and retained read versions; missing/tampered/wrong-owner ciphertext fails closed. No fallback plaintext. Large records use bounded authenticated chunks with manifest-bound ordering and total length; only commit a reference after all required bytes are durable. Decrypt in Worker code, return plaintext only to the matched current brain transport. Never expose key/version/reference metadata in public history.

Production coordinator methods are private-service operations, not test setters:

- `acceptCommand` stores acceptance and wakeup intent atomically before acknowledgment. Missing ordinary sequences wait; priority Stop does not.
- `readSnapshot` serves committed redacted state without default Container proxy.
- `admitEffect` validates owner/epoch/deadline/incarnation and commits prepared/admitted transitions through trusted dispatch logic. A container cannot request an arbitrary operation window.
- `recordEffectResult` accepts exact matching pending operation/attempt, commits actual result or encrypted reference, dedupes identical acknowledgment and rejects conflicts.
- `commitContinuation` compares expected position and atomically commits next position plus semantic events/projections.
- `reconcile` is a bounded scheduler callback, never a run loop held open by a caller.

Any R2/D1 crossing records durable intent and a retryable acknowledgment. There is no cross-store transaction. Do not hold `blockConcurrencyWhile` across encryption I/O, external transport, Pi readiness or callbacks. Encrypt bounded payload outside the short commit and verify epoch/position again at commit.

## Projection CAS and execution evidence

For each target, coordinator sequence is monotonic across runs within an owner version. Compare `(incomingOwnerVersion, incomingSeq)` lexicographically with the target row's persisted pair. `runEpoch` is correlation with the persisted command/run/message mapping, not an equality check against the currently active run; settling run A's pending assistants must work after run B advances the epoch. After ownership transfer, only the new owner can regenerate outstanding projections from validated imported canonical state under its new version; stale-owner envelopes cannot authorize themselves.

`product-projector.ts` uses update-only SQL, in a bounded transactional batch for related rows. Its CAS requires: target ID and exact workspace/project/user membership; project present and not deleting; workspace present with the current expected trusted owner/version and status `active` or `archived` for terminal-message settlement, never migrating/deleted authority; command and recovery updates also require their exact expected source status; persisted command/run membership containing the exact assistant ID; and stored version less than incoming owner-version/sequence, expressed as `storedOwnerVersion < incomingOwnerVersion OR (storedOwnerVersion = incomingOwnerVersion AND storedSeq < incomingSeq)`, with initial cursor `(0, 0)`. A terminal assistant write additionally requires `status='pending'`. Completed assistants never become failed, and retries do not create replacements. Command and recovery-pointer targets use their own key/version and expected source status, not the newest assistant's cursor. Versions, target status and redacted content update together. No upsert and no broad `WHERE sessionId` assistant settlement.

A successful zero-row CAS is not a database outage. Re-read bounded metadata to classify already-applied/equal-or-newer, stale owner, deleted target/tombstone, or immutable completed assistant as an acknowledged no-op. Unexpected membership/status mismatch is blocked for investigation, not success or recreation. A thrown/unavailable D1 transaction remains pending and retries. If owner changes during classification, retry the authoritative read. Tests exercise real SQL with old-run/new-run terminal reordering, cross-owner callbacks, duplicate projection, partial batch failure and project/session deletion races; assert no unrelated assistant changes and no completed-to-failed transition.

Stopped evidence requires a supported platform-confirmed termination observation for the exact identity/incarnation being fenced. Replacement may instead use independently verified isolation: a newly registered platform identity with no shared workspace, process or mount reachable by the old writer, plus revoked old admission. Record both identities and the trusted boundary evidence. This permits replacement only, not release of the old live container's capacity. A D1 retired flag, lease expiry, in-sandbox receipt or cancel acknowledgment alone proves neither condition. Unproved platform evidence leaves replacement/release BLOCKED. Isolation never resolves old external effects or establishes quiescence of the old workspace. 001 proves the platform observation recipe; 006/008 implement its use and races.

## Ordered work and behavior tests

1. Implement crypto/keyring validation and serialization before storing any canonical record. T31 covers tamper, owner/session/record swaps, invalid nonce/tag, missing keys, rotated key with retained old decryption, and no plaintext writes. Verify `pnpm --filter @ditto/runtime exec vitest run src/runtime-crypto.test.ts`.
2. Implement SQLite transitions and acceptance+wakeup transaction. Reconcile scheduled intent after any crash between local commit and supported Container `schedule`. Scheduler callback processes at most 25 intents or 5 seconds of transition work and records the next wakeup. Constructor initializes schema/observations only; activation does not launch Pi. Extend authenticated fixture to real coordinator logic with disposable persistent SQLite, not mutable in-memory run state. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts`.
3. Implement command ordering, target-run barriers and Stop. Complete T06 by losing the acceptance acknowledgment and observing one logical execution decision through receipts/snapshots. Complete T07 in `session-runtime-control.test.ts`: deliver N+1 before N, observe no ordinary consumption past the gap, then deliver N or its durable cancellation and observe ordered advancement. Phase 003's outbound-delivery assertions alone cannot satisfy these cases. Stop advances epoch and durably denies new model/tools immediately, cancels unapplied targeted commands including late predecessors, and records cooperative cancellation intent. It does not stop a distinct later run. Before remote admission, both fresh D1 authority and local epoch/barrier must pass; DO revocation cannot wait for projection. Existing in-flight effects may reconcile, but cannot advance superseded state. T08 asserts priority and recorded/applied difference; T15/T16 are introduced with fake uncooperative execution and strengthened in 006. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-control.test.ts`.
4. Implement prepared/admitted/result-recorded/outcome-unknown transitions, write-once logical identity, conflicting-result rejection and fatal persistence latch. Only trusted coordinator dispatch moves an effect to admitted. A crash after that marker but before known dispatch may conservatively be unknown. Never reinterpret it as definitely unexecuted. Model attempts have their own IDs and allowance/deadline records. Journal failure blocks later admissions even if the brain tries again.
5. Commit terminal run state and pending product projection in one SQLite transaction. Idempotent D1 updates use the per-target lexicographic CAS and zero-row classification above, not a current-run-epoch filter. Do not upsert deleted product rows or rewrite already-completed assistants failed. On terminal failure settle every remaining pending assistant for the run. Archive health is separate. T25 fails D1 through terminal settlement, serves terminal snapshot with projection lag, then retries the same projection and observes correct assistants. Old projections cannot overwrite new ones.
6. Add minimal authenticated receipt/snapshot observation, model-free and no container wake. All tests assert that command+observation boundary, except focused storage/crypto tests. Public errors are category+trusted correlation ID. Logs use allowlisted IDs, versions, timings, status and byte counts, never caught raw exception bodies or provider content.

Final phase commands:

```sh
pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-journal.test.ts src/lib/session-runtime-control.test.ts src/lib/session-command-delivery.test.ts
pnpm --filter @ditto/runtime exec vitest run src/runtime-crypto.test.ts
pnpm --filter @ditto/runtime typecheck
pnpm typecheck
pnpm check
```

Expect all named tests and static gates exit 0 without skips. The parent baseline is recorded separately in README; no target result is preclaimed. Use `exec vitest run` rather than the documented wrapper that selected all web suites.

## Exit contract, stop and maintenance

005 receives a private coordinator bridge target, authority-gated effect admission, result/continuation acknowledgment barrier, per-run Stop fence, encrypted journal and read-only observation. 006 receives durable execution positions and fixed first-interruption deadline support. Set automatic recovery deadline to first interruption +15 minutes; retry does not reset it. Expiry settles failed but retains unresolved execution/capacity evidence.

Done is machine-checkable when full T06/T07, T08/T25/T31 and journal crash tests pass, snapshot calls start neither container, and persistence-failure tests show zero subsequent admitted effects. No raw canonical content appears in SQLite/R2 fixture scans or captured logs. Full canonical content, command keys and payload hashes remain only for retained lifetime and are purged by 009's deletion cleanup; minimal late-delivery fences/cleanup records survive project/session/auth-row deletion without secret payload retention. External execution is still gated off.

STOP on plaintext storage, missing key fallback, default fetch waking history, a local transaction waiting for Pi, projection-based-only revocation, or a dispatcher that can settle trusted execution. Every new terminal path must add a projection in the same local commit. Every new record type must declare encryption/AAD, compatibility and retention behavior.
