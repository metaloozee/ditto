# 018 product integration evidence

Executed against `34f18aa` in a detached worktree. Nothing staged or committed. **Browser QA: not run.** This plan makes no claim of visual or user-level acceptance.

## Baseline (before edits)

| Gate | Result |
|---|---|
| Drift check `git diff --stat b9b8e66..HEAD -- apps/web/src packages/runtime-contracts/src` | empty |
| `pnpm install --frozen-lockfile` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (79 files, 903 tests) |
| `pnpm check` | exit 0 (123 warnings, 11 infos) |

## Item map

| Item | Where |
|---|---|
| 1 Model button, thinking list, `model_unconfigured` message | `components/composer.tsx` `CandidateComposer` (the `ModelSelector` dialog from `ai-elements/model-selector`, a `<button>` with `MODEL_BUTTON_CLASS`, thinking `Select` listing the selected model's `thinking`). Models come from `listCandidateModels` via `useQuery` keyed `["candidate-models", projectId, sessionId]`. |
| 2 Account menu | `components/nav-user.tsx` `CodexConnectionMenu`; status query and connect/disconnect mutation in `lib/candidate-session-client.ts` `useCodexConnection` and `CODEX_CONNECTION_VIEWS`. The server function is imported lazily so the module graph of the composer and route stays free of `cloudflare:workers`. No `as { ... }` casts; narrowing uses `"status" in body` / `"code" in body`. |
| 3 Composer line | `CandidateComposer` `notice` (textarea and Send disabled, `[Connect]` for `disconnected`, reuses `useCodexConnection().runAction("connect")`). |
| 4 Recovery footer | `components/ai-chat.tsx` `MessageRow` `restoreFooter`, built in `Chat.restoreFooterFor` from `observation.assistants[].reason === "checkpoint_restored"` and `health.restore`; `[Review and resend]` calls `setInputText` with the preceding user message. Nothing resends automatically. |
| 5 Blocked archive | `components/ai-chat.tsx` `BlockedArchivePanel`, replaces `Composer` when `health.archive.status === "blocked"`. |
| 6 Project delete | Verified only. `DeleteProjectDialog` renders `deleteProjectMutation.error.message` (`project-settings-dialog.tsx`, the `role="alert"` paragraph). No client pre-disable added. |
| 7 Git | `components/session-git-actions.tsx` `CandidateSessionGitActions` (status and commit through `runWorkspaceAction`; `denied` maps through `describeWorkspaceDenial`; Sync, Push and Open PR disabled with `"Not available for this session yet."`). Preview: STOPPED, see below. |
| 8 Omitted | Continue, readiness, backup-health and projection-lag indicators, attachments: not built. |

Other pieces:

- `lib/candidate-session-client.ts` (new): `submitCandidateCommand` (retries a network error or 503 up to 3 times with the same serialized body, so the same idempotency key), `observeCandidate`, `listCandidateModels`, `runWorkspaceAction`, `probeCandidateRuntime`, `reduceObservation`, `newIdempotencyKey`, helpers, `useCandidateProbe`, `useCandidateObservation`, `useCodexConnection`.
- `lib/candidate-session-client.test.ts` (new, 13 tests): retry reuses identical body and key; 202 parses; stop goes to `/api/agent/control`; gives up after 3 retries; 409 throws with its code and is not retried; probe false only for `candidate_admission_ineligible`; reducer snapshot replacement, events after the cursor, duplicate and older events ignored, stale-cursor replacement snapshot discards earlier state, `changedAssistants` lists only moved assistants; poll cadence; current run selection; selection attach rule.
- `routes/project.$projectId.tsx` (wiring only): `useCandidateProbe` for new chats, `selectedSession.runtimeOwner === "pi_durable_v1"` for open sessions, `useCandidateObservation` with `onAssistantsChanged` invalidating `trpc.workspace.messages` for the session, and a `candidate` prop for `Chat`.
- `components/chat-navbar.tsx`: forwards a `candidate` flag to `SessionGitActions`.

## Send, Stop and observation behavior

- New chats use candidate mode only if `probeCandidateRuntime` returned true. Open sessions use it only if their row says `pi_durable_v1`. Otherwise the legacy composer renders (`LegacyComposer`).
- Send: `prompt`, or `follow_up` with `targetRunId` while a run is open (observed non-terminal run, else the newest prompt whose assistant has not settled). A new idempotency key per user action; the key is kept (keyed by kind, session, target, text and selection) across a failed attempt and cleared on success. `selection` is attached only when it differs from the last selection the server accepted for the session (initially `models.selection`).
- The receipt's `workspaceSessionId` becomes the session; for a new chat the composer navigates to the session route. The optimistic turn (user row and a pending "Thinking…" assistant row, queued follow-ups as `QueuedFollowUpRow`) is held in a module-level store keyed by session so it survives that navigation, and is dropped once the assistant message id is in the thread.
- Stop: `stop` with `targetRunId` = the run (the prompt's `commandId`). The "Stopping" state stays until that run is observed terminal (`complete`, `failed`, `canceled`).
- Polling (`useCandidateObservation`, `nextPollDelay`): `observeCandidate` with the last cursor; every **1000 ms** while a run is non-terminal or a held receipt's assistant has not appeared as settled; otherwise every **10000 ms**; immediately again when `more` is true; paused while `document.visibilityState === "hidden"` and resumed on visibility. Unmount clears the timer and never sends Stop.

## Legacy-path guarantees

- `Composer` is a thin wrapper: no `candidate` prop means `LegacyComposer`, which is the previous component body with its JSX moved into the shared `ComposerFrame` (same classes and container-query layout). `PROJECT_CODER_MODELS[0]` (`FIXED_MODEL`) is still used only by the legacy path.
- `SessionGitActions` without `candidate` renders the unchanged previous implementation (renamed `LegacySessionGitActions`).
- `Chat` uses its own composer streaming state unless `candidate` is set. The route adds hooks that issue no request for open legacy sessions; for a new chat it issues one `POST /api/agent/models` probe.
- No server, router, contract, runtime, package or migration file changed. No dependency added.

## STOPPED sub-items

1. **Preview start and stop for candidate sessions (item 7, preview part): STOPPED.** `WorkspaceActionResultV1` returns `{status:"preview_running", generation}` and `{status:"preview_stopped", generation}` with no preview URL. The preview pane's iframe needs a URL and no contract here supplies one. `session-preview-pane.tsx` is unchanged, so a candidate session's preview pane still calls the legacy `sessionPreview` procedures. Needs a contract that delivers the bearer preview URL (spec decision 15 describes "authenticated delivery of revocable bearer preview URLs").
2. **Item 5 button wiring, partial deviation.** The existing delete confirmation (`DeleteProjectDialog`) is private to `project-settings-dialog.tsx`, an out-of-scope file. The `[Delete project]` button is therefore the trigger of the existing `ProjectSettingsDialog`, whose danger zone opens the confirmation. This costs one extra click versus the approved behavior. A one-word `export` of `DeleteProjectDialog` (plus controlled open state) would give the direct path.

## Judgment calls to review

- Commit message: `git_commit` requires a non-empty `message` and there is no approved input, so `CandidateSessionGitActions` sends the constant `"Ditto session changes"`. It appears in Git history, not the UI.
- Non-copy failures reuse existing strings: `"Failed to run agent."`, `"Failed to queue message."`, `"Failed to stop agent."`, `"Git unavailable"`, `"Enter a message before sending."`, `"Changes committed."`, `"Nothing to commit."`. A models-query error is treated like `unavailable`.
- The Codex menu shows no status text while the status query is pending (the earlier starting point showed "Checking…", which is not approved copy).
- The recovery footer is skipped if `checkpointAt` does not format as a time.
- An observation event for an unknown run or assistant is added (run `epoch` 0) rather than dropped, so a run started after the snapshot is seen.
- Session readiness for candidate sessions still comes from the existing `checkSandbox` view (`connected` when no sandbox identity exists), unchanged.

## Gates

| Gate | Result |
|---|---|
| `pnpm --filter @ditto/web exec vitest run src/lib/candidate-session-client.test.ts` | pass (13) |
| `pnpm check` | exit 0 (123 warnings, 11 infos; same as baseline) |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (80 files, 916 tests) after one flaky run (below) |
| `pnpm build` | pass |
| `grep -n " as {" apps/web/src/components/nav-user.tsx` | no output |
| `grep -rn "PROJECT_CODER_MODELS\[0\]" apps/web/src/components` | matches `composer.tsx` (legacy path) |

Flake: one earlier `pnpm test` run failed `session-runtime-journal.test.ts` ("restore validates continuation 201 and budget-exhausted suffixes stay incomplete", 20 s timeout); a rerun of that file failed a different test in it once ("restore blocks missing prompt bytes and incompatible continuation formats"), then two further runs passed 36/36, and the full suite later passed 916/916. That file does not import any file changed here.

Existing component tests: none updated; all passed unmodified.

**Browser QA: not run.**
