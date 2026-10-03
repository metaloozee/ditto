# 018: Connect product controls to the durable interface

Status: BLOCKED on 017 and a focused layout/copy decision before UI edits. Base: `bcce03e`. Phase: L5 product completion.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.1, 3.5, 5–6, 12, 14–15, 17–18; PD01–PD03, PD06–PD07, PD24, PD26–PD27, PD41–PD42; OD1, OD5–OD7.

## Outcome and boundaries

Wire existing chat, model/thinking, connection, Stop, queued-follow-up, recovery and lifecycle controls to authenticated intents, durable receipts and committed observations. The browser owns presentation and cursor only. It never runs Pi or controls execution lifetime.

Keep existing product layout and visual character. The spec defines behavior but not Codex connection placement or new recovery copy. Before touching layout/copy, show 2–3 focused in-reply sketches and wait for selection. This prerequisite is not permission for a broad redesign. Do not add automated UI tests, mount/render checks, visual snapshots or a browser test system under OD5. Existing inherited repository tests remain unless a separately justified change replaces obsolete behavior.

## Current code and scope

`apps/web/src/components/composer.tsx` currently selects one fixed model:

```ts
const FIXED_MODEL = PROJECT_CODER_MODELS[0];
```

It imports `streamAgentRun` and `sendAgentControl` from `agent-stream-client.ts`, and tracks streamed content/queued follow-ups in component state. `agent-models.ts` exposes fixed model/thinking choices. These are presentation conveniences, not authority for subscription entitlement or durable run state.

Scope: existing composer/chat/session action components, product connection controls once layout approved, stream-client/protocol/data mapping, model configuration queries and narrow product handlers. Follow existing React/TanStack query patterns and base controls. No new terminal/code-browser, sign-in replacement, raw Pi browser data, speculative global state layer or new UI dependency.

## Steps and checks

1. Refresh this plan from backend contract/evidence files. Read the UI skill router and relevant existing components. Confirm exact approved placement/copy for connection, account models/thinking and recovery actions. If still unspecified, pause for the sketches decision. Do not treat this plan as an approved visual design.
   Check: `pnpm typecheck` before changes; record baseline errors separately.
2. Retarget existing Git and preview controls to 014's typed intents rather than their legacy direct-mutation path. Adapt command clients to stable idempotency keys across retries, returning receipt/message/workspace IDs rather than treating HTTP success as start. Preserve first-prompt identity. Show accepted, queued and expired state from committed product data. Follow-ups each retain their message pair; targeted Stop uses the exact run and displays stopping until accounted for.
   Run backend/client behavior tests only: `pnpm --filter @ditto/web exec vitest run src/lib/agent-stream-client.test.ts src/lib/agent-stream-protocol.test.ts src/lib/session-command.test.ts`. Add reconnect/receipt transformation cases there, not render assertions.
3. Load account-backed model/capability results from privileged product access and submit configuration intents through the runtime. Remember selection per conversation; show only valid thinking choices. Prepared requests retain configuration while later requests change. Reject stale/unavailable options honestly; no fixed catalogue/API billing fallback. Disconnected users can still read history and perform permitted non-model lifecycle actions.
   Run `pnpm --filter @ditto/web exec vitest run src/lib/agent-models.test.ts src/lib/codex-connection.test.ts src/lib/codex-request-contract.test.ts` and runtime model tests.
4. Reconnect from committed snapshot plus later events; drop stale attempt deltas after snapshot replacement. Detach without Stop. Present run, readiness, recovery degradation and projection lag separately. Recovery actions show explicit loss/uncertainty acknowledgment and submit new keys for intentional reapplication. Never display internal archive/crypto/capability details as history.
   Run client/protocol tests and `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-observation.test.ts src/pi-durable-restore.test.ts`.
5. Run `pnpm typecheck`, `pnpm runtime:verify`, and `pnpm verify`. Record `plans/evidence/018-product-integration.md`, approved copy/layout decision and code-level evidence. Future independent browser QA remains `not run`; this plan neither creates that skill nor claims visual/user-level acceptance.

## Done and maintenance

Product controls consume only stable product contracts. Backend/client tests demonstrate receipt retry and reconnect behavior. No browser-owned execution lifetime or fixed entitlement assumptions remain for candidate sessions. Type checking and inherited verification pass without adding UI suites.

Stop on unresolved layout/copy or a backend contract which cannot express required state; do not invent UI scheduling/recovery policy. No live connection/request, reset, deployment, staging or commit. Future UI changes must preserve the distinction between acceptance, execution, backup health and projection state.
