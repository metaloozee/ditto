# 008: Account for both containers and supervise preview safely

Status: BLOCKED on 007. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-7 days plus paid measurements. Risk: high, especially lease expiry and quiescence.

## Goal and prerequisite contract

Introduce independent brain/execution capacity pools and durable lifecycle scheduling. Preview must survive ordinary turns but cannot defer recovery indefinitely or force a false checkpoint of an active shell.

007 supplies initial baseline and current/previous paired checkpoint/restore, an acknowledged Pi pause and capture/publication separation. 006 supplies live run/process incarnation reconciliation and unknown-effect blocking. 004 supplies priority controls, epochs, durable scheduler intents and projection. 002 supplies additive pool reservation schema. Product policy owns D1 reservations; runtime supplies current liveness observations. `@ditto/runtime` test/typecheck, contracts and brain gates are defined.

No live capacity allocation or paid test is authorized. Do not change port/layout, enable terminal/code tabs, expose runtime as public preview origin, or make lease expiry proof that a process died. Before the accounting boundary only the old allocator may run and trusted admission is closed. After the boundary, both legacy and trusted work use the single new ledger below. This phase proves the transition in disposable local fixtures; 011 owns separately approved operational migration.

## Rechecked local evidence

`apps/web/src/lib/workspace-runtime-capacity.ts:19-26`:

```ts
export const WORKSPACE_CAPACITY_GLOBAL_LIMIT = 20;
export const WORKSPACE_CAPACITY_PER_USER_LIMIT = 2;
export const WORKSPACE_QUEUE_TTL_MS = 15 * 60 * 1000;
export const WORKSPACE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS = 10 * 60 * 1000;
export const WORKSPACE_DRAIN_CRON = "* * * * *";
export const WORKSPACE_CRON_INVOCATION_LIMIT_MS = 15 * 60 * 1000;
export const WORKSPACE_CAPACITY_LEASE_TTL_MS = 20 * 60 * 1000;
```

`apps/web/src/server.ts:12-16` gives the current single Sandbox a ten-minute sleep. Its default preview proxy precedes product route handling. Target routing must check preview revocation on product before service-binding to runtime.

Existing test exemplar, `apps/web/src/lib/workspace-runtime-capacity.test.ts:185-187`:

```ts
expect(first).not.toBeNull();
expect(second).not.toBeNull();
expect(third).toBeNull();
```

The enclosing test acquires three sessions for one user. Extend concurrency behavior to two pools through accepted commands. Existing SQLite fixture and injected clocks at lines 1-109 are suitable. `session-preview.ts` already separates fixed command discovery, start/stop, interruption and restart functions at 267, 694, 925, 1043 and 1093.

## Files and APIs

Existing policy: `apps/web/src/lib/workspace-runtime-capacity.ts`, `workspace-runtime.ts`, `session-preview.ts`, `workspace-recovery.ts`, `workspace-policy.ts`, `apps/web/src/server.ts` and corresponding tests. New `apps/web/src/lib/session-runtime-capacity.test.ts`, `session-runtime-preview.test.ts`; runtime `apps/runtime/src/capacity-client.ts`, `preview.ts`; extend `session-runtime.ts`, `reconcile.ts`, `runtime-product-service.ts`, `session-command.ts`, `session-command.test.ts`, existing workspace tRPC preview adapters, contracts and Alchemy target configuration.

`reserveCapacity({ownerVersion, intentId, requiredPools, observedIdentities})` is a product named private-entrypoint call under 005's binding capability. Product freshly resolves a durable accepted-command/startup, builder-start or migration intent in D1 and derives allowed pools/identities, owner/version and expiry. No executing model/tool window is required before reservation and no caller-supplied list expands authority. Atomically validate intent/accounting version, reuse exact current live claims, check both global/per-user limits and insert all missing reservations, or insert none and queue. No held idle brain while executor acquisition waits. Existing claims are reused, not counted again.

`observeCapacity({reservationId, incarnation, observedState, observedAt})` accepts validated runtime observations under the matching D1 intent/reservation. Expiry changes a claim to reconciliation-needed, not free. Release requires platform-confirmed termination for that exact identity/incarnation; independently isolated replacement does not free the still-live old container. Separate delivery lease, brain execution lease, workspace mutation lease and capacity reservation semantics in code/types.

This phase adds strict session-scoped `start_preview`, `stop_preview` and `restart_preview` wire variants and authenticated admission, using the existing 003 idempotency/outbox service and coordinator sequence. Inputs contain only owned session, key and allowed action; server creates authority fields. No prompt message pair or configured model key is required. Existing preview entrypoints submit and observe these commands rather than bypassing coordinator serialization. Public preview capability is returned only to authenticated start access and never in ordinary snapshots/logs. Product origin validates session/revocation before binding to runtime; runtime proxies only that executor.

`restart_preview` follows 003's exact recovery-union contract: no chat messages or model/brain, execution capacity only, expected generation revalidation, and no clearing of unknown-effect review. Connect 007's model-free `retry_backup` independently; it leaves preview stopped and neither command repeats tools. Test both against stale observations and model outage.

## One coexistence capacity ledger

`runtime_capacity_reservations` is authoritative after the singleton `runtime_capacity_policy` commits `mode=unified` and its next accounting version. Fence new admissions/releases from old allocator code, inventory live and uncertain legacy sessions/builders/previews, and import claims conservatively into the new ledger under a durable migration intent. Unknown liveness counts as occupied; imports over configured limits block new starts rather than evict work. One atomic D1 decision commits imported claims and the accounting version; both legacy adapters and runtime service check that version in reserve/release transactions. Old writers must be fenced before the switch. Old lease rows become compatibility projections only; their expiry, cleanup or deletion cannot allocate/free real capacity. A crash before commit leaves trusted admission closed; a crash after commit uses only the new ledger. Never count two independently queried tables and call the sum atomic.

All-required-pool reservation reuses current claims and commits all missing claims together or none. Builders and preview reserve execution only. An isolated replacement may need an additional execution claim while the old one is live; it queues if limits prohibit both. Retain trusted observation ID/source/time, identity/incarnation/lifecycle generation/epoch and termination/isolation evidence with the reservation. Stale evidence for a previous incarnation cannot release a newer claim. Local migration and mixed-demand tests are required here, not a production deployment. 011 uses the proven transition only after separate approval.

## Ordered implementation and behavioral gates

1. Implement the single-ledger transition above and both configured pools, 20 global and 2 per user each. Route legacy and trusted reserve/release, builders and preview through the same atomic policy. Test simultaneous legacy + trusted + builder + preview demand, lost import commit acknowledgment, stale old-allocator calls, duplicate claim import/reuse, partial-pool denial and late termination for an old incarnation. Assert combined limits, no dual allocator and no legacy TTL freeing live work. Never reserve a brain for a builder.
2. Coordinate durable FIFO ordinary queue and its persisted 15-minute deadline with first execution admission. Both decisions pass through coordinator state. Dispatcher expiry redelivers/query-resolves, never independently fails an assistant. Lost handoff acknowledgment after start returns existing started outcome, not expiry. If unresolved, observation says expiry awaiting confirmation. A follow-up already admitted to a live run has no fresh capacity wait deadline. T22/T23 and T08 cover concurrency, cancellation, Stop bypass and late commands. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-capacity.test.ts src/lib/session-runtime-control.test.ts`.
3. Implement independent ten-minute brain/executor idle policies. Renew brain activity during live run and execution activity while required tools or unbacked preview need it. Use Container-supported scheduler from 001, never override alarm. Durable reconciliation handles missed startup, stale attempt, surviving process, pending pair/projection and lease uncertainty. Constructor observation alone cannot launch Pi. On recovery deadline failure retain uncertain process capacity. Extend T10/T15/T36 with process observations; a TTL cannot release a live slot.
4. Add the preview wire/admission variants above and prove same-key retries, conflicting payload rejection, owned-target checks and model-free admission before connecting existing preview adapters. Preserve one fixed preview command and port 10000, one current capability per workspace. Do not wake Pi for preview. Cold preview requires committed paired filesystem restore but reads continuation metadata without launching the brain. Show a restoring response until the app is ready. Public host remains product Worker; runtime has no public preview route. Revoked URLs fail before sandbox proxy/start. Preserve fresh HTML/streaming behavior without buffering arbitrary preview responses into memory as part of this change.
5. Persist first unbacked mutation time once, then coalesce newer mutation generation without resetting the deadline. A live preview can defer checkpoint initiation for at most ten minutes. Persistent observation marks backup pending. At deadline stop preview and new mutating-tool admission, then reconcile the actual in-flight tool:
   - read or structured write with expected-content check: wait for completion or its persisted individual deadline, then capture a valid pair only if the result is known and quiescence established;
   - arbitrary shell or unknown effect: request abort, record unknown, settle run failed, skip checkpoint and block review. Do not snapshot an apparently idle filesystem or restart execution automatically.
6. After valid capture, retry publication without repeating tool effects. Restart preview only for recent traffic or explicit user request. User Preview Stop leaves process stopped if backup fails; return distinct stopped-with-backup-failure observation for separate `retry_backup` and `restart_preview` actions in 010. Preview-created files/application DB writes remain disposable. T21 tests multiple mutations, old deadline, every tool class and publication outage. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-preview.test.ts src/lib/session-preview.test.ts src/lib/workspace-recovery.test.ts`.
7. Measure separate-image cold start, tool round trip, peak memory/disk, awake/idle cost and representative concurrency. Record P-Budget/P-Lifecycle evidence in this plan or 012, with versions/limits and approved thresholds. Limits may allow 40 awake containers and say nothing about affordability. If no budget approval or paid evidence, retain NOT RUN/BLOCKED and do not release.

Final local commands:

```sh
pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-runtime-capacity.test.ts src/lib/session-runtime-preview.test.ts src/lib/workspace-runtime-capacity.test.ts src/lib/session-preview.test.ts src/server.test.ts
pnpm --filter @ditto/runtime typecheck
pnpm typecheck
pnpm check
```

Expect all required named tests PASS and exit 0. The parent reported baseline tests/typechecks only, not new pool behavior or paid lifecycle. `exec vitest run` avoids the documented wrapper's full-suite selection.

## Done and handoff

009 receives single-ledger capacity reservation/release and evidence distinguishing termination from replacement isolation, final-checkpoint preconditions, preview revocation and persistent first-deadline policy. 010 receives queue/expiry-confirmation, stopping/blocked, preview restoring/saving and backup-degraded observation fields. Production trusted admission now has implementations for both mandatory start prerequisites, capacity and initial pair, but remains disabled until release.

Machine-checkable done: T21-T23 pass under concurrent mixed legacy/trusted/builder/preview demand and accounting-cutover crash cases, no extra reservation for reused live container, no partial-acquisition deadlock, no TTL frees a known live process, no brain starts on cold preview, and stale preview URL cannot proxy or wake. Deadline tests assert zero checkpoint capture for unknown shell.

STOP if both-pool reservation cannot be atomic, preview needs auth/project values, runtime must become public origin, expiry can race admission into contradictory terminal status, or stopping a shell is treated as proof of death. Maintain persisted deadlines across retries and track container observations separately from billing policy.
