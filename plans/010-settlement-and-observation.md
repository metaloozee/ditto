# 010: Settle messages and expose committed observations

Status: BLOCKED on 009. Base: `bcce03e`. Phase: L3 completion.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.4–3.5, 5, 7, 14, 17; PD07, PD16, PD24, PD26–PD27; OD5–OD6.

## Outcome

A terminal runtime decision and pending product projection intents commit together in one runtime SQLite transaction. D1 application happens later; there is no cross-store transaction. Projection failures retry without browser presence or rerunning model/tools. Every settled run eventually leaves each assistant complete or failed. Completed assistants remain complete if a later follow-up or backup fails.

Expose product-safe snapshots and monotonic semantic events, never raw Pi records/views/watches. Run lifecycle, readiness, backup health and projection lag remain separate facts. Reading history or attaching an observer must not enable Pi scheduling or wake the execution sandbox.

## Current state and scope

`apps/runtime/src/journal.ts` already retains projections with target identity, owner version and coordinator sequence. `apps/web/src/lib/session-runtime-product.ts` exposes:

```ts
async applyProjections(
	payloads: ProjectionPayload[],
	now: number,
): Promise<ProjectionApplyResult[]> {
```

`apps/web/src/lib/secret-redaction.ts` supplies structured redaction and a streaming holdback for split secrets. Reuse behavior after checking the new event payloads; canonical encrypted content and product redacted content are distinct stores.

Scope: runtime projection mapper/local journal, narrow product apply adapter, command snapshot/event handlers, shared product contracts, redaction tests. No UI redesign or raw framework browser protocol. Keep product routes independent of runtime storage/Pi; move shared data contracts out of cross-Worker implementation imports as needed.

## Steps and checks

1. Refresh runtime/message membership from 008. Define snapshot cursor, active run/conversation generation, separate health facts and stable reason outcomes. Semantic events have monotonic committed positions; transient deltas carry run, attempt and committed position. Keep crypto metadata, archive references, framework records and executor authority private.
   Run `pnpm contracts:verify` and `pnpm --filter @ditto/runtime typecheck`.
2. Implement terminal transition plus pending projections atomically in local runtime storage. Use idempotent update-only product application for the exact owner/target/version. Crash before/after local commit and D1 acknowledgment, deny deleted targets, and reject late versions without overwriting newer state. Retry via durable host wakeups, never by executing the completed command again. A missing, short or empty projection acknowledgment is not successful application; retain unmatched intents. Assistant statuses stay `pending`, `complete`, `failed`; cancellation settles remaining pending assistants as failed with a reason.
   Add `apps/runtime/src/pi-durable-projection.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-projection.test.ts`. Assert all pending assistants of a failed/stopped multi-follow-up run settle and prior successes remain complete.
3. Build snapshot-then-later-events attachment without a commit gap. Duplicate delivery is harmless; stale cursor receives a replacement snapshot. Bound event/output size and subscriber buffers. Detach slow subscribers without backpressuring the engine. Test reconnect during commit, old-attempt deltas after restart and observer loss during a run through the product handler as well as the runtime seam. Preserve authenticated observation membership checks. Subscriber detachment cannot roll back committed progress.
   Add `apps/runtime/src/pi-durable-observation.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-observation.test.ts src/pi-durable-host.test.ts`. Assert read-only access causes zero scheduling/executor activation.
4. Redact split secrets, stderr, structured arguments/results, errors and stored product messages before any observation/projection. Use synthetic sentinel secrets only. Do not send project secret values to an unrelated trusted module merely to build a redaction list; preserve execution-only delivery policy and perform exact-value redaction at product-side or already-authorized execution output seams. Runtime pattern holdback does not authorize fetching project secrets for a redaction list.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/secret-redaction.test.ts src/lib/agent-message-storage.test.ts` plus new observation/projection tests.
5. Write `plans/evidence/010-l3-acceptance.md`, including all L3 predecessor outcomes, commands, limits and outstanding PD38/hosted checks. Run `pnpm runtime:verify` and `pnpm verify`; include retained brain verification where applicable. L3 is still synthetic-only until L4's baseline.

## Done, stops and maintenance

Receipts, terminal messages, snapshots and events demonstrate the contract through authenticated product handlers. No test depends on a public test-only Pi control. Injected-auth is not PD39. Backup-failure integration must be rerun after 012, rather than claiming a mocked backup proves paired recovery.

Stop on projections that recreate rows, reads that enable scheduling, or redaction requiring forbidden credential propagation. Refresh concrete interfaces from passed predecessor evidence before execution. No reset, deployment, live request, staging or commit. Future event additions require byte bounds, redaction review and cursor/reconnect tests.
