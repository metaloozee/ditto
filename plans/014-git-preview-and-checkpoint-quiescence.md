# 014: Serialize Git and preview with recovery

Status: BLOCKED on 013. Base: `bcce03e`. Phase: L4 completion.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3, 8–9, 11–15, 17; PD14, PD20, PD24–PD25, PD27, PD30–PD31; OD3, OD5–OD6.

## Outcome

UI Git and agent Git use the same runtime-owned typed mutation interface. Preview follows fixed command/port policy and never becomes a second mutation owner. Recovery can quiesce managed writers without claiming an uncertain shell has stopped.

The product origin remains the authenticated preview entry and revocation authority. Runtime Worker public fetch is not a preview origin. Push and PR creation stay disabled until the existing forbidden-ref/non-fast-forward gates have evidence; this plan does not grant that approval.

## Current code and scope

`apps/web/src/lib/session-git.ts` still imports `withSessionWorkspaceLock` and accepts direct Sandbox access. `session-preview.ts` similarly acquires `withWorkspaceRuntimeLease`. Those current orchestrators must not independently mutate candidate-owned workspaces.

`apps/web/src/lib/workspace-runtime-capacity.ts` defines the existing deadline:

```ts
export const WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS = 10 * 60 * 1000;
```

`privileged-git.ts` constructs a closed credential-free child environment with fixed image binaries. Preserve it, disabled hooks/helpers, no redirects, owned branch/repository checks and secret preflight.

Scope: session Git/preview product routers/adapters, runtime typed operations/mutation ownership, preview proxy/revocation, recovery deferral and tests. No code-browser/terminal feature, preview project values, GitHub credential movement, public-network denial fallback or UI redesign.

## Steps and tests

1. Refresh the plan from L4 runtime/execution contracts. Route UI and agent Git through workspace-session intents to the runtime; retain product-side fresh Git authority and token mint-and-fetch. Use shared bounded data contracts, not imports of product auth/Env into runtime policy. Validate refs/runtime intent before product authorization. Reserve one metadata model attempt atomically and never refund a failed attempt.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/session-git.test.ts src/lib/session-git-ui-actions.test.ts src/lib/privileged-git.test.ts src/lib/git-fetch-contract.test.ts src/lib/git-push-contract.test.ts src/lib/git-secret-policy.test.ts`. The push contract test must still assert `GIT_PUSH_ENABLED` is false; green policy tests alone do not satisfy the external enablement gate.
2. Admit Git under the same exclusive mutation ownership as tools, restore and archive. Publish a pair after quiescent Git mutation; do not mark a successful commit failed merely because backup degraded. Deny stale epoch/generation and expiry after async setup. Test UI Git racing agent shell and restore, with no lock recursion or wait cycle through product callbacks.
   Add `apps/runtime/src/pi-durable-workspace-actions.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-workspace-actions.test.ts src/pi-durable-checkpoints.test.ts`.
3. Route preview start/stop through the runtime. Cold start restores a committed current or previous matching pair without enabling Pi scheduling. If neither pair is usable, preview is unavailable; do not restore the seed or start Pi. Preserve port 10000, fixed supported command, product-origin proxy and authenticated revocable bearer URL delivery. Never send a capability URL to logs/history or project values to preview. Revoke URLs on lifecycle changes.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/session-preview.test.ts` plus runtime workspace-action and host tests.
4. Replace the unsafe old quiescence assumption: `apps/web/src/lib/session-preview.ts:1043–1071` catches interruption failures and permits checkpointing to proceed. Candidate recovery must consume explicit cleanup/termination evidence and fail closed instead. Persist the first unbacked-mutation deadline. Repeated mutations/preview traffic do not extend ten minutes. At expiry stop preview and deny new mutation admission. A bounded read or expected-content write may finish within its own deadline; cancel arbitrary shell/unknown work and keep uncertainty block rather than publish. Only verified quiescence allows pair capture. After success restart preview only for recent traffic or explicit demand. Backup retry and preview restart are different actions.
   Extend runtime workspace-action/checkpoint tests with a controlled clock and repeated mutations, ignored cancellation, restart and stale deadline deliveries.
5. Save `plans/evidence/014-l4-acceptance.md`, reconciling initial baseline, publication, command dispositions, restore and quiescence gates from 011–014. Run `pnpm runtime:verify`, `pnpm runner:verify` if runner changed, and `pnpm verify`.

## Acceptance and maintenance

L4 passes only with all preceding evidence. Candidate retained-workspace mutation may be considered afterward, but fixture/provider/host restrictions and separate operational approvals remain. Genuine local Docker tests establish only local termination behavior; hosted process/egress checks remain outstanding.

Stop on a second mutation route, unaccounted writer or a capture which cannot prove quiescence. Refresh concrete contracts before execution. No reset, deployment, live provider/Git request, staging or commit. New Git/preview operations must carry admission, revocation and checkpoint consequences through this same owner.
