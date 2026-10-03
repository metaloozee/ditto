# 015: Complete resource admission and execution-only project values

Status: BLOCKED on passed L4, plans 011–014. Base: `bcce03e`. Phase: L5.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3, 9, 12–15, 17; PD01, PD06, PD14, PD16, PD28, PD30, PD32–PD33; OD1, OD3, OD5–OD6.

## Outcome

Complete bounded admission across agent execution, seed builders, preview-only work, active runtimes and concurrent model requests. There is no brain-container pool in the target. Preserve live isolated executor accounting until termination is established.

Project values are decrypted product-side and delivered only to an already-admitted repository command. They never enter Pi configuration, builders, preview, Git children, archive helpers, container entrypoints or `.env` files. These policies must precede real values in this slice. Earlier plans already require bounded provisional admission, not an unbounded L3.

## Current code and scope

`apps/web/src/lib/workspace-runtime-capacity.ts` defines:

```ts
export const WORKSPACE_CAPACITY_GLOBAL_LIMIT = 20;
export const WORKSPACE_CAPACITY_PER_USER_LIMIT = 2;
export const WORKSPACE_QUEUE_TTL_MS = 15 * 60 * 1000;
```

`project-env-vars.ts` decrypts encrypted project values in the product process. `privileged-git.ts` builds an explicit closed child environment. Reuse those policies without exposing auth-secret dependencies to the runtime.

Scope: product admission/capacity/authority modules, runtime admission adapters, execution-only value delivery, relevant schema/contracts/tests. Preserve default 20 global/two per-user execution limits as configurable policy, not Cloudflare entitlement. Model/runtime limits need conservative explicit configuration, not benchmarks or a fabricated performance guarantee.

## Steps and verification

1. Refresh provisional admission from 008 and builder/preview paths from 011/014. Define authoritative claims, current owner/identity generations, operation deadlines, durable FIFO queue and fixed 15-minute queue expiry from acceptance. Keep this clock separate from 003's 15-minute recovery deadline from first interruption, the ten-minute preview deferral and capacity lease TTL; never reset one using another. Add model/runtime limits with bounded defaults justified as safety choices. Remove brain reservations only from candidate paths; do not bypass old-owner accounting before transition.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/workspace-runtime-capacity.test.ts src/lib/workspace-runtime-policy.test.ts src/lib/sandbox-authority.test.ts`.
2. Race agent, builder, preview and model demands for the last slots, duplicate claim acknowledgments and expiry. Reconcile actual runtime start before terminal queue expiry. Stop, revoke and cleanup bypass capacity. Lease expiration never proves process death; isolated but live old executors continue counting. Restart must not double-claim or free a live resource.
   Add `apps/runtime/src/pi-durable-capacity.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-capacity.test.ts src/pi-durable-commands.test.ts`.
3. Define execution-only project-value delivery tied to the exact admitted operation, lifecycle/epoch, identity and expiry. The product decrypts after fresh authority. Use narrow private transport; no reusable value-fetch capability goes to the sandbox. Recheck after async preparation. Deny builders, preview, Git and archive operations. Do not smuggle values through runtime configuration or persist them as plaintext command payloads.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/project-env-vars.test.ts src/lib/sandbox-egress-broker.test.ts src/lib/privileged-git.test.ts`; add denied-role and stale-operation cases through the execution interface.
4. Inspect command child environments and synthetic archive contents, output/stderr/errors and product projections. Allowed repository commands receive only their authorized values; every forbidden process receives none. Redact concrete synthetic values across chunks and structured output. Document the remaining possibility of exfiltration through allowed public traffic rather than promising complete prevention.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/secret-redaction.test.ts` and runtime tool/observation tests. Extend binding/import denial checks.
5. Save `plans/evidence/015-resource-and-value-policy.md`. Run `pnpm runtime:verify`, `pnpm runner:verify` if execution code changed, `pnpm contracts:verify` if contracts changed and `pnpm verify`.

## Acceptance and maintenance

Multi-workspace execution cannot be enabled until configured limits, expiry and live accounting pass. Model/resource claims and credential authority are distinct; a slot never grants permission to use credentials. A released model-capacity slot must not refund the separate one-attempt Git metadata allowance. No tuning/benchmark gate is added under OD3.

Stop if a lease alone releases a still-live executor, value delivery needs forbidden key sharing, or capacity waiting blocks priority control. Rebase this conditional plan on actual predecessors before coding. No reset, deployment, live secrets/requests, staging or commit. Future background or preview work must join the same accounting rather than treating idle agent state as free execution.
