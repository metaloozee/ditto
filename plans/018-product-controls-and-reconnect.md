# 018: Connect product controls to the durable interface

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop that item and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file.
>
> **Drift check (run first)**: `git diff --stat b9b8e66..HEAD -- apps/web/src packages/runtime-contracts/src`. If anything in scope changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: TODO (rewritten 2026-10-24 against the routes 021 and 022 delivered; the earlier BLOCKED history is in Git)
- **Priority**: P1 (L5 product completion)
- **Effort**: L
- **Risk**: MED (UI over new contracts; the legacy path must not change)
- **Depends on**: 021 (`94df040`), 022 (`cee075a`), migration repair (`cf017e7`). All DONE and green in CI at `b9b8e66`.
- **Planned at**: commit `b9b8e66`, 2026-10-24
- **Spec**: `docs/specs/pi-durable-session-runtime.md` decisions 3.1, 3.5, 6, 14, 15. OD5: no automated UI tests.

## Why this matters

The candidate (`pi_durable_v1`) backend now has product routes, but nothing in the UI uses them. The browser still runs every chat through the legacy SSE stream with one fixed model. This plan teaches the existing UI to drive candidate sessions through those routes: durable receipts, polled observation, the account's models, targeted Stop, recovery and blocked-archive states, Git and preview actions, and the Codex connection. Legacy sessions keep working unchanged.

## Contracts you will use (from `plans/evidence/021-product-exposure.md` and `022-selection-with-prompt.md`)

All are POST JSON, authenticated by session cookie. The user ID is never put in the body.

| Route | Body | Success |
|---|---|---|
| `/api/agent/stream` with a version-2 body | `BrowserCommandV2` (`packages/runtime-contracts/src/product-command.ts`): `{version:2, kind, idempotencyKey, projectId, sessionId?, text?, targetRunId?, selection?}` | **202** + `ReceiptV2` `{receiptId, commandId, workspaceSessionId, commandSeq, queueDeadlineAt, userMessageId?, assistantMessageId?}` |
| `/api/agent/control` with a version-2 body | `stop`: `{version:2, kind:"stop", idempotencyKey, projectId, sessionId, targetRunId}` | 202 + `ReceiptV2` |
| `/api/agent/observe` | `{version:1, projectId, sessionId, cursor?}` | 200 `RuntimeObservationV1` `{version:1, cursor, snapshot?, events, more}` |
| `/api/agent/models` | `{version:1, projectId, sessionId?}` | 200 `CandidateModelsV1` `{status:"available"\|"unavailable"\|"revoked"\|"disconnected", models:[{id, thinking[]}], selection\|null}` |
| `/api/agent/workspace-action` | `{version:1, kind:"git_status"\|"git_commit"\|"preview_start"\|"preview_stop", projectId, sessionId, message?}` | 200 `WorkspaceActionResultV1` (a `{status:"denied", reason}` result is still a 200) |

Errors are `{code}`. Codes you will see: `candidate_admission_ineligible` (400; no candidate service bound), `model_unconfigured`, `runtime_owner_mismatch` (409), `runtime_unavailable` (503), `observation_too_large` (502).

Facts:
- The run ID of a prompt is its `commandId`. Follow-ups and Stop target that run ID.
- `ObservationSnapshotV1` (`packages/runtime-contracts/src/projection.ts`) has `runs[{id,state,epoch}]`, `assistants[{id,run,state,reason,version,applied}]`, and `health {projectionLag, safetyStopped, recovery?, archive?{status}, restore?{checkpointAt, effectsUncertain}}`. A cursor read has no `snapshot`; a stale cursor gets a fresh one.
- Observation carries **no message text and no streaming deltas** (plan 010 limit). Text comes from the existing `trpc.workspace.messages` query.
- A session's kind is `runtimeOwner` on the session rows `trpc.projects.list` already returns. `"pi_durable_v1"` means candidate.
- `/api/agent/models` without `sessionId` doubles as the capability probe: 400 `candidate_admission_ineligible` means no candidate runtime is bound in this deployment. Any 200 means it is bound.

## Approved layout and copy (maintainer, option A, 2026-10-23; amendments 2026-10-24)

Reuse existing primitives. No new layout grid, no new UI dependency. Keep the composer's container-query layout.

1. **Model button.** In `composer.tsx`, for candidate sessions and new chats in candidate mode, the `role="img"` logo `<span>` becomes a `<button type="button">` with the same size and border classes. It opens the existing `ModelSelector` dialog (`components/ai-elements/model-selector.tsx`) listing `models`, with the model `id` as the label. The Thinking `Select` lists only the selected model's `thinking`. `CandidateModelsV1` lists only entitled models, so the "Unavailable on your plan" group has no data source and is omitted. A send refused with `model_unconfigured` while a selection was attached shows in the `messageError` slot: `"<model id> is no longer available. Choose another model."` and refetches models.
2. **Account menu.** In `nav-user.tsx`, a "Codex" group between the profile and Log out groups:

   | Status | Label | Action |
   |---|---|---|
   | connected | Connected | Disconnect |
   | renewing | Renewing… | none |
   | reconnect_required | Sign-in expired | Reconnect |
   | disconnected | Not connected | Connect |
   | unavailable | Codex is unavailable right now | none |

   A Connect or Reconnect that returns `codex_hosted_auth_unverified` shows the error toast `"Codex sign-in isn't available yet."`. Any other failure code shows `"Couldn't update the Codex connection."`.
3. **Composer line.** For a candidate session whose models `status` is not `available`, the textarea and Send are disabled and history stays readable. One `text-xs` muted line in the `messageError` slot position reads `"Connect Codex to send messages."` with a single `[Connect]` button when `status` is `disconnected`, or `"Codex is unavailable right now"` otherwise. It must wrap at 320px and never clip.
4. **Recovery footer.** Under an assistant message whose observation `reason` is `checkpoint_restored`, styled like the existing failed-row line in `ai-chat.tsx`: `"Restored from backup. Changes after <time> may be lost."`, where `<time>` is `health.restore.checkpointAt` formatted with the existing `formatMessageTime`. When `effectsUncertain` is true, add `"Commands in progress were not confirmed."`. One action, `[Review and resend]`, puts that turn's user text back into the composer. The user reviews it and sends, which creates a new idempotency key. Nothing resends automatically.
5. **Blocked archive.** When `health.archive.status === "blocked"`, replace the composer with a panel styled like the project-settings danger zone (`rounded-lg border border-destructive/20 bg-destructive/5 p-3`, `TriangleAlertIcon` tile). Title `"Can't finish archiving"`. Body `"A preview or action didn't report whether it finished, so this session is read-only. Deleting the project is the only way to clear it."`. A single destructive `[Delete project]` button opens the existing project delete confirmation. Below 420px the button stacks under the text.
6. **Project delete.** No client-side pre-disable. 021's server deletes candidate projects when the service is bound and otherwise refuses with a readable message, which the existing delete dialog already renders from `deleteProjectMutation.error.message`. Only verify this; don't change it.
7. **Git and preview for candidate sessions.** Status, commit, preview start and preview stop go through `/api/agent/workspace-action`. A `denied` result shows in the control's existing error slot with exactly one of these strings: busy `"The workspace is busy. Try again shortly."`, restore_in_progress `"A restore is in progress."`, archived `"This session is archived."`, backup_overdue `"Waiting for a backup before changes."`, blocked `"This session needs review."`, unavailable `"The workspace isn't available."`, capacity `"No workspace slot is free right now."`. Sync, Push and Open pull request have no candidate contract. For candidate sessions they are disabled, with the tooltip `"Not available for this session yet."`.
8. **Omitted by design:** Continue; readiness, backup-health and projection-lag indicators (no approved copy); attachment display.

## Current code

- `apps/web/src/components/composer.tsx` (895 lines): `const FIXED_MODEL = PROJECT_CODER_MODELS[0];` (~66). `streamAgentRun` and `sendAgentControl` come from `lib/agent-stream-client.ts`. Queued follow-ups live in component state. The `messageError` slot is `#composer-message-error`.
- `apps/web/src/components/ai-chat.tsx` (982 lines): `QueuedFollowUpRow` (~504); the failed-row line `"Response interrupted — partial output saved."` (~542); the `Composer` mount (~888).
- `apps/web/src/lib/agent-stream-client.ts`: `streamAgentRun` POSTs `/api/agent/stream` (~301); `sendAgentControl` POSTs `/api/agent/control` (~265). Legacy bodies only.
- `apps/web/src/routes/project.$projectId.tsx`: the chat page. It uses `trpc.projects.list` and `trpc.workspace.messages.infiniteQueryOptions` (~388) and invalidates them (~529–539).
- `apps/web/src/components/session-git-actions.tsx`: `trpc.sessionGit.gitStatus` (~470), `.commit` (~487), plus sync, push and openPullRequest.
- `apps/web/src/components/session-preview-pane.tsx`: `trpc.sessionPreview.start` (~116), `.stop` (~145).
- `apps/web/src/components/nav-user.tsx`: the dropdown with profile and Log out groups.
- **Account-menu starting point:** `/home/ayan/ditto-execution/plan-018/apps/web/src/components/nav-user.tsx` is an earlier, uncommitted, reviewed implementation of item 2 (`git -C /home/ayan/ditto-execution/plan-018 diff -- apps/web/src/components/nav-user.tsx`). Reuse it with these fixes: `codexConnection`'s return type is already typed by the server function, so drop the `as { status; body: unknown }` cast and the `(body as {...})` casts and narrow with `"code" in body` / `"status" in body`. Use the item 2 error strings.

Conventions: tabs; `unknown` until narrowed; TanStack Query patterns as in `project-settings-dialog.tsx` (`useMutation(trpc.x.mutationOptions())`); comment only for non-obvious constraints. Test helpers are pure functions in `lib/` with a `*.test.ts` beside them (pattern: `lib/agent-stream-client.test.ts`). **No component or render tests.**

## Scope

**In scope**: `apps/web/src/lib/candidate-session-client.ts` (+ `.test.ts`, create); `apps/web/src/components/composer.tsx`, `ai-chat.tsx`, `nav-user.tsx`, `session-git-actions.tsx`, `session-preview-pane.tsx`; `apps/web/src/routes/project.$projectId.tsx` (wiring only); existing component tests only where your change makes an assertion obsolete (name each in NOTES); `plans/evidence/018-product-integration.md` (create).

**Out of scope**: any server route, router, `lib/session-command*.ts`, `packages/*`, `apps/runtime`, migrations (never edit or generate any), new dependencies, new UI or browser test infrastructure, the legacy chat path's behavior.

## Steps

### Step 1: Baseline
`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm check`. Record the results in the evidence file.
**Verify**: pass, or record failures by test name.

### Step 2: Client library (tested)
Create `lib/candidate-session-client.ts`:
- `submitCandidateCommand(body: BrowserCommandV2): Promise<ReceiptV2>` POSTs `/api/agent/stream` (or `/api/agent/control` for `stop`). It expects 202 and parses with `parseReceiptV2`. On a network error or 503 it retries up to 3 times **with the same body, so the same `idempotencyKey`**. Any other non-202 throws `CandidateRequestError {status, code}`.
- `observeCandidate`, `listCandidateModels` and `runWorkspaceAction` POST their routes and throw `CandidateRequestError` on non-200.
- `probeCandidateRuntime(projectId): Promise<boolean>` returns false only on 400 `candidate_admission_ineligible`.
- `reduceObservation(state | null, observation)`. A `snapshot` replaces runs, assistants and health. `events` with `position > state.cursor` update the matching run or assistant `state`/`reason`/`version`. An event at or below the cursor is ignored as a duplicate. The cursor becomes `observation.cursor`. It returns `{ state, changedAssistants: string[] }`.
- `newIdempotencyKey()` uses `crypto.randomUUID()`.

Tests in `lib/candidate-session-client.test.ts` (mock `fetch` as `agent-stream-client.test.ts` does):
- a retry reuses the identical body and key;
- 202 parses the receipt;
- 409 throws with its code;
- the probe returns false only for `candidate_admission_ineligible`;
- the reducer: snapshot replacement, events after the cursor applied, duplicate and older events ignored, a stale-cursor replacement snapshot discards earlier state, and `changedAssistants` lists only assistants that changed.

**Verify**: `pnpm --filter @ditto/web exec vitest run src/lib/candidate-session-client.test.ts` passes.

### Step 3: Account menu
Port and fix the account menu (item 2) as described under Current code. Extract the status query and the connect/disconnect mutation into a small hook in the same file or in `lib/candidate-session-client.ts`, so Step 4's Connect button reuses it. Don't duplicate it.
**Verify**: `pnpm typecheck`; `grep -n " as {" apps/web/src/components/nav-user.tsx` prints nothing.

### Step 4: Composer and chat for candidate sessions
Branch on session kind at the chat page (`runtimeOwner === "pi_durable_v1"`). For new chats (no session yet), use candidate mode only when `probeCandidateRuntime` returned true. Legacy sessions and new chats without a bound runtime keep the exact current code path.

In candidate mode:
- **Models.** Load `listCandidateModels({projectId, sessionId?})`. Start from `selection`, or else the first model with its first thinking level. Items 1 and 3 apply.
- **Send.** Use the `prompt` kind (`follow_up` with `targetRunId` while a run is non-terminal). Generate a new idempotency key per user action and keep it across retries. Attach `selection` only when it differs from the last selection the server accepted for this conversation. Keep the first-prompt identity: the receipt's `workspaceSessionId` becomes the session, using the same handoff the legacy `onQueued` path uses.
- **Pending and queued.** After the receipt, show the user row and a pending assistant row, as the legacy optimistic rows do, but with no streamed text. Follow-ups show as `QueuedFollowUpRow` until their assistant appears in messages.
- **Observation.** Poll `observeCandidate` with the last cursor: every 1000 ms while any run is non-terminal or a receipt's assistant has not settled, otherwise every 10000 ms. Pause while `document.visibilityState === "hidden"`. Run `reduceObservation`. When `changedAssistants` is non-empty, invalidate `trpc.workspace.messages` for this session. Unmounting stops polling and never sends Stop.
- **Stop.** Use the `stop` kind with `targetRunId` = the prompt's `commandId`. Show the existing "Stopping" state until that run's observed state is terminal (`complete`, `failed` or `canceled`).
- **Recovery footer** (item 4) and **blocked-archive panel** (item 5) are driven only from the reduced observation.

**Verify**: `pnpm typecheck`; `pnpm test` (existing tests pass; record any updated obsolete assertion in NOTES).

### Step 5: Git and preview
Item 7, for candidate sessions only. Legacy procedures stay unchanged for legacy sessions.
**Verify**: `pnpm typecheck`; `pnpm test`.

### Step 6: Gates and evidence
Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Write `plans/evidence/018-product-integration.md`: what each approved item maps to (file and function), the polling cadence, the legacy-path guarantees, gate results, and **"Browser QA: not run"**. This plan makes no claim of visual or user-level acceptance.
**Verify**: all gates pass.

## Done criteria
- [ ] `lib/candidate-session-client.ts` and its tests exist and pass
- [ ] Every one of approved items 1–7 is implemented, or STOPPED with a reason in the evidence file
- [ ] `grep -rn "PROJECT_CODER_MODELS\[0\]" apps/web/src/components` still matches, for the legacy path only
- [ ] No files outside scope changed; no migration files touched; no new component or render tests
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass

## STOP conditions
- Drift in the excerpted code.
- A required fact isn't in the contracts above (for example, the chat page can't see `runtimeOwner` for the open session). Stop that item, report, and continue with the rest.
- A change seems to need a server, contract, runtime or migration edit.
- Keeping the legacy path unchanged turns out to be impossible for a step.
- A test fails twice after a reasonable fix.

## Maintenance notes
- Observation has no deltas. When streaming deltas land (plan 010 limit), extend `reduceObservation`. Don't add a second channel.
- The polling cadence is a presentation choice. A future push subscription replaces it without touching receipts.
- The health indicators omitted here need approved copy before anyone adds them.
