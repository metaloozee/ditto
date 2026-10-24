# 018: Connect product controls to the durable interface

Status: BLOCKED on missing product contracts (execution 2026-10-23). Layout/copy approved 2026-10-23 as option A (see "Approved layout and copy"). Only item 2 (account-menu Codex group) is backed; it sits uncommitted in `/home/ayan/ditto-execution/plan-018` (`nav-user.tsx` plus draft `plans/evidence/018-product-integration.md`). Missing, verified by the reviewer: account model discovery (`discoverModels`/`readConfigurationAuthority` return `unavailable` in `lib/session-runtime-product.ts`); any browser-visible candidate/legacy session flag (`runtimeOwner` is not returned to routes or components); blocked-archive and per-message restore fields; a route or tRPC procedure exposing `workspaceAction` (only in `lib/session-command-candidate.ts`) and a snapshot-plus-events observation endpoint. [021](021-candidate-product-exposure.md) exposes them; 018 resumes after 021 and must read `evidence/021-product-exposure.md` first. Correction: `projects.list` already returns `runtimeOwner` for active sessions. 017 is DONE. Base: `bcce03e`; reconciled at `1f93e9c` (2026-10-23), where the excerpt below and every test path in the steps still exist. Step 1's full refresh is still required. Phase: L5 product completion.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.1, 3.5, 5–6, 12, 14–15, 17–18; PD01–PD03, PD06–PD07, PD24, PD26–PD27, PD41–PD42; OD1, OD5–OD7.

## Outcome and boundaries

Wire existing chat, model/thinking, connection, Stop, queued-follow-up, recovery and lifecycle controls to authenticated intents, durable receipts and committed observations. The browser owns presentation and cursor only. It never runs Pi or controls execution lifetime.

Keep existing product layout and visual character. The spec defines behavior but not Codex connection placement or new recovery copy; the maintainer approved the placement and copy below. That approval is not permission for a broad redesign. Do not add automated UI tests, mount/render checks, visual snapshots or a browser test system under OD5. Existing inherited repository tests remain unless a separately justified change replaces obsolete behavior.

## Current code and scope

`apps/web/src/components/composer.tsx` currently selects one fixed model:

```ts
const FIXED_MODEL = PROJECT_CODER_MODELS[0];
```

It imports `streamAgentRun` and `sendAgentControl` from `agent-stream-client.ts`, and tracks streamed content/queued follow-ups in component state. `agent-models.ts` exposes fixed model/thinking choices. These are presentation conveniences, not authority for subscription entitlement or durable run state.

Scope: existing composer/chat/session action components, product connection controls once layout approved, stream-client/protocol/data mapping, model configuration queries and narrow product handlers. Follow existing React/TanStack query patterns and base controls. No new terminal/code-browser, sign-in replacement, raw Pi browser data, speculative global state layer or new UI dependency.

## Approved layout and copy (option A, 2026-10-23)

The maintainer selected this. Reuse existing primitives only; no new layout grid, no new UI dependency. Keep the composer's container-query layout (narrow <420px: textarea row, then Model · Thinking · spacer · Send).

1. **Model chip.** In `composer.tsx`, the `role="img"` logo `<span>` becomes a `<button type="button">` with the same size/border classes (`size-9 … @[420px]:size-11`), opening the existing `ModelSelector` command dialog from `components/ai-elements/model-selector.tsx`. List the account-backed models. Unavailable models stay listed, disabled, under a group heading "Unavailable on your plan". The Thinking `Select` stays in place and lists only levels valid for the selected model. A stale selection shows in the existing `messageError` slot (`#composer-message-error`): "<Model> is no longer available. Choose another model."
2. **Connection: account menu.** In `nav-user.tsx`, add a `DropdownMenuGroup` between the profile group and the Log out group (separated by `DropdownMenuSeparator`), showing "Codex" with the status label and one action:

   | `ConnectionStatus` | Label | Action |
   |---|---|---|
   | connected | Connected | Disconnect |
   | renewing | Renewing… | none |
   | reconnect_required | Sign-in expired | Reconnect |
   | disconnected | Not connected | Connect |
   | unavailable | Codex is unavailable right now | none |

   `ConnectionStatus` is in `apps/web/src/lib/codex-credential-do.ts`. The connect flow returns `codex_hosted_auth_unverified` (503) today (`lib/codex-connection.ts`); the Connect/Reconnect action must surface that error honestly, not fake success. No live connection is attempted in this plan.
3. **Connection: composer line.** When not connected, the textarea and Send are disabled (history stays readable), and one `text-xs` muted line renders in the `messageError` slot position: "Connect Codex to send messages." with a single `[Connect]` button. Other states with no send ability use the table label instead. This line must wrap at 320px, never clip.
4. **Recovery.** A footer under the affected assistant message, styled like the existing failed-row line in `ai-chat.tsx` ("Response interrupted — partial output saved."): "Restored from backup. Changes after <time> may be lost." plus, where in-progress commands are uncertain, "Commands in progress were not confirmed." One action, `[Review and resend]`, which submits a new idempotency key (intentional reapplication). If no committed backend field drives this state, STOP and report rather than invent one.
5. **Blocked archive.** Replace the composer with a panel matching the project-settings danger zone (`rounded-lg border border-destructive/20 bg-destructive/5 p-3`, `TriangleAlertIcon` tile). Title "Can't finish archiving". Body: "A preview or action didn't report whether it finished, so this session is read-only. Deleting the project is the only way to clear it." Single destructive `[Delete project]` button that opens the existing project delete confirmation (candidate deletion is project-level only, per 016; amended by the maintainer 2026-10-23); below 420px the button stacks under the text.
6. **Project delete refusal.** In `project-settings-dialog.tsx` danger zone, when the project has candidate sessions, disable the Delete Project button and replace the description with: "This project has sessions that can't be deleted yet. Archive or delete them first, then try again." Also show the router's refusal message if a delete is still refused.
7. Omitted by design: Continue action; readiness/backup-health indicators (no backend source); attachment display for image reads.

## Inherited backend limits

Reconcile at `1f93e9c` collected these from accepted 009–017 evidence. They change what the UI may offer. Confirm each against the evidence file before relying on it.

- Continuation is not end to end ([016](evidence/016-lifecycle.md), Limits). No composition builds the new session's workspace baseline from the seed's archive. Do not expose Continue to users unless the maintainer explicitly accepts that, or a backend plan closes it first. Stop and report if the approved design requires it.
- A blocked archive (unknown preview stop or unresolved effect) has no acknowledgment path; deletion is its only exit ([016](evidence/016-lifecycle.md), Acceptance). It needs a visible state and a review action. Include it in the layout/copy sketches.
- Router deletion of a project with candidate sessions is refused until `CandidateLifecycle` is composed into the product; only the credential fixture wires it today ([016](evidence/016-lifecycle.md)). A delete control must show that refusal honestly.
- Image reads return an error result, not an attachment ([009](evidence/009-tool-parity.md)). This awaits maintainer approval. Do not build attachment display for candidate tool results.
- Readiness, conversation generation, streaming deltas, push subscribers and backup health are not implemented in observation ([010](evidence/010-l3-acceptance.md)). Step 4's separate readiness/degradation display may have no backend source. Stop and report rather than inventing one.
- Multi-workspace execution stays disabled until 015's listed limits close ([015](evidence/015-resource-and-value-policy.md)).

## Steps and checks

1. Refresh this plan from backend contract/evidence files. Read the UI skill router and relevant existing components. Placement/copy is approved: implement "Approved layout and copy" exactly. Anything it does not specify, STOP and report instead of designing it.
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
