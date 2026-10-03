# 017: Verify retention and rehearse clean ownership transition

Status: BLOCKED on 016. Base: `bcce03e`. Phase: L5 completion, backend.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 4, 10–11, 14–18; PD18–PD19, PD34–PD37; OD3–OD6.

## Outcome

Bound cleanup without deleting canonical history or content needed by active recovery and current/previous pairs. Rehearse a clean transition using newly created disposable fixtures, with old commands and live old execution fenced before a new runtime owner acts.

This is not permission to reset existing local or hosted resources. All actual reset/deployment operations require separately named scope and approval. OD4 removes the import/backup delivery requirement, not operational consent or the obligation to preserve source/configuration/historical evidence.

## Current state and scope

`apps/web/src/db/schema.ts` uses owner/version fields:

```ts
runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull().default(1),
brainIdentityId: text("brainIdentityId"),
```

`apps/web/src/lib/session-runtime-client.ts` defaults trusted admission to false. `sandbox-archive.ts` has retryable archive cleanup; `journal.ts` keeps effect/security records apart from continuation. Reuse fencing and cleanup patterns, not old brain identities as candidate authority.

Scope: bounded retention/reference cleanup, disposable transition tests, local operator rehearsal documentation and evidence. No importer, data-preservation project, automatic existing-environment migration, paid deployment or source retirement yet. 019 handles implementation retirement after acceptance.

## Steps and checks

1. Refresh reference reachability from 005 and pairs/lifecycle from L4/016. Define retention ownership for canonical history through archive, active work, current/previous pairs, key versions, pending publication and recovery. Detailed denials retain 30 days; unreferenced transient output becomes eligible after 24 hours. Age alone cannot delete referenced private data. Keep minimal non-secret deletion/retirement fences permanently as required.
   Add `apps/runtime/src/pi-durable-retention.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-retention.test.ts`.
2. Implement bounded cleanup batches with durable progress/retries and a shared runtime wakeup deadline, not a second lifecycle scheduler. Race collection with publication/restore/active history reads, rotated keys, deletion fences and archive bytes shared by continued lineages. Interrupt every handoff. Assert referenced content and historical decryption survive, while abandoned unreferenced objects become collectible.
   Same command plus storage history, checkpoint and lifecycle tests. Use synthetic objects; never run the collector against existing resources in this implementation session.
3. Build a disposable local rehearsal with old queued deliveries, stopped and non-cooperative old executors, stale projections and old provider windows. Commit revocation/retirement before new owner creation. Require termination/isolation evidence and continued live-resource accounting. Assert no command import, accidental old submission, second mutation owner or row resurrection.
   Add `apps/runtime/src/pi-durable-transition.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-transition.test.ts` and existing `apps/web/src/lib/session-runtime-ownership.test.ts` through the web runner.
4. Write a dry-run operator checklist naming placeholders that must be filled for environment/resources, credentials/configuration preserved, late-delivery fences, live process accounting, separately requested reset, and post-transition checks. Do not provide an automatically executed destructive script. Failure stops new-owner enablement, not a return to an unfenced old engine.
   Verification: review the rehearsal's observed effects and run the transition test twice; second execution must remain idempotent without two owners.
5. Save `plans/evidence/017-l5-backend-acceptance.md`, mapping locally completed PD scenarios and outstanding provider/host/browser work. Run `pnpm runtime:verify`, `pnpm verify` and applicable runner/contracts/retained brain checks. L5 product completion also requires 018.

## Done and maintenance

GC preserves required content under faults and the clean-start rehearsal proves exclusive ownership using fixtures. Any unrun real process/host identity claim remains `not run`. No benchmark or dependency-inclusive archive test is required.

Stop if retention needs dropping referenced history/keys or transition cannot fence an old writer. Refresh this conditional plan before coding. No actual reset, deletion of existing user data, deployment, live request, staging or commit. Future retained record types must be added to reachability and cleanup tests before release.
