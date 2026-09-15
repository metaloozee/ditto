# 006: Run full Pi behind awaited durable continuation barriers

Status: BLOCKED on 005 and the exact 001 Pi recipe. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-8 days. Risk: high. Unsupported continuation is a stop condition, not a reason to replay a prompt.

## Target and prerequisite contracts

Move full Pi `0.85.1` into the trusted Node image for isolated target sessions, using the 001 restore/recovery recipe. Preserve the fixed model, supported thinking levels, compaction, image-owned Git metadata tools and queued follow-ups. Repository execution stays remote. Do not downgrade to `0.80.10`.

005 supplies an identity-validated HTTP bridge, seven remote tool handlers, model/Git/action broker, execution-only environment materialization and no local fallback. 004 owns encrypted canonical journal, effect states, Stop/epoch barriers, run lifecycle, read-only snapshots, pending D1 projection and durable scheduling. 003 provides accepted commands and per-follow-up message IDs. 001 must already have proven the precise public Pi hook/wrapper/restore recipe. Its results, not current global docs, are prerequisites.

Continuation contract includes full pinned Pi entries, selected leaf, compaction `firstKeptEntryId`, model/thinking settings, image-owned extension state, provider-specific metadata, original tool IDs, actual results, accepted/consumed command position and unresolved effects. Container-local JSONL is a reconstructible working copy. No untrusted archive reaches trusted executable/configuration paths.

No live owner/key cutover, Sandbox migration, new provider, terminal, unrestricted extension, blind replay or exactly-once billing promise is in scope. Real-user enablement remains blocked until paired recovery/capacity and release gates. Early execution tests use an isolated fake archive/capacity fixture, never bypass production preconditions.

## Rechecked local evidence

`packages/sandbox-runner/src/run-agent.ts:59`:

```ts
const pendingFollowUps: FollowUpCorrelation[] = [];
```

At 196 it subscribes to Pi events, and at 235 it waits for `session.prompt(options.prompt)`. That queue and session disk are not durable enough to reconstruct execution after container loss.

Installed Pi `packages/sandbox-runner/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:281-284`:

```js
_emit(event) {
    for (const l of this._eventListeners) {
        l(event);
```

An async subscription is not a persistence barrier. Compaction still uses `firstKeptEntryId`. At Pi `0.85.1`, `SessionManager.inMemory(cwd, options, entries)` accepts restored file entries; 001 proved `structuredClone` then `branch(leafId)` before `createAgentSession`. Direct `continue()` on an interrupted assistant/tool-result transcript still fails; recovery is journal-led, then a new session from the committed manager, then public `continue()`. Nested agent-core resolved to `0.85.1` from the installed coding-agent package in the 001 worktree. Do not reconstruct import by rewriting JSONL as if in-memory entries were unavailable.

`packages/sandbox-runner/src/locked-resource-loader.ts:37-44`:

```ts
noExtensions: true,
noSkills: true,
noPromptTemplates: true,
noThemes: true,
noContextFiles: true,
additionalExtensionPaths: [options.extensionPath],
systemPromptOverride: () => undefined,
appendSystemPromptOverride: () => [],
```

Use an explicit image-owned loader, not a repository cwd and a hope that discovery stays disabled. Existing behavior assertions in `locked-resource-loader.test.ts` cover hostile repo settings/resources and a missing image-owned extension.

## Files

Independent npm brain package from 001: `packages/session-brain/src/main.ts`, new `session.ts`, `continuation.ts`, `provider-barrier.ts`, `remote-tools.ts`, `resource-loader.ts`, `git-metadata.ts`; tests `continuation.test.ts`, `provider-barrier.test.ts`, `resource-loader.test.ts`, `pi-feasibility.test.ts`. `packages/session-brain/Dockerfile` includes pinned Pi and image-owned extensions only, no repository mount or repository dependency install.

Runtime modifications: `apps/runtime/src/session-runtime.ts`, `brain-transport.ts`, `journal.ts`, `reconcile.ts`. New boundary tests: `apps/web/src/lib/session-runtime-continuation.test.ts`. Reuse policy/text from `packages/sandbox-runner/src/locked-resource-loader.ts`, `runner-model.ts`, `run-git-metadata.ts`, `ditto-git-tools.ts`, but do not remove legacy files before 011. If a shared tool definition is necessary, move portable definitions into the already-created contracts package rather than importing a Node runner into workerd.

## Exact execution recipe to implement

1. Trusted `main` exposes bounded readiness/work/control HTTP, scoped to the current brain incarnation. Readiness responds after resource validation, not after prompt completion. It never accepts repository paths as code locations. Worker starts/notifies the brain with admitted command/epoch/position only. The coordinator constructor and public history never start it.
2. Full `createAgentSession` is the agent implementation. Explicit fixed model, in-memory settings, supported thinking, image-owned ResourceLoader and strict tool allowlist. No default model fallback or global auth/config discovery. Disable user shell shortcuts unless routed through the same remote adapter. Audit custom tools, `pi.exec`, input expansion, attachments, image decoding, MIME detection, path normalization, temporary output and resource reload for implicit local execution/access.
3. A provider wrapper intercepts all normal, retry, compaction and metadata requests. It obtains journal admission first, records the complete provider response with original IDs/continuation metadata before releasing terminal response/tool calls to Pi, and records attempts including failed retries. Token deltas may stream transiently with run/attempt/position tags; terminal release waits for durability. Provider internal retries must be disabled or surfaced as individual authorized attempts as proven in 001.
4. Remote-tool wrapper journals the full logical tool ID, args, origin response, deadline and expected incarnation before dispatch, then awaits `result_recorded` acknowledgment before returning to Pi. Tool arrays are serialized per workspace session even if Pi defaults to parallel batches. Persistence failure latches the brain transport/epoch closed and requests termination; throwing a normal tool error alone is insufficient because Pi may recover from it.
5. Persist entry/leaf/compaction/extension/queue changes at the awaited seams proven in 001. Do not promise a generic async SessionManager append API. Before each next inference/effect, verify the complete expected continuation position is durable. Final assistant is durable before semantic completion. A failure after external model spend but before final response persistence records a distinct retryable model attempt, never "exactly once".
6. Keep pending follow-ups in the coordinator. Transfer one at a supported Pi turn boundary, with an explicit command-ID consumption record and its message pair. Persist consumption together with the corresponding Pi user entry/position before subsequent inference. Same text in two commands must not collide. Restart rehydrates pending instructions by ID, not Pi's text-based queue matching. Completed assistants retain status if later follow-ups fail or are canceled.
7. Reconstruct only supported positions from the 001 recipe. Validate the checkpoint, `structuredClone` entries, `SessionManager.inMemory(imageOwnedCwd, undefined, workingEntries)`, `branch(leafId)`, restore explicit settings. A local JSONL file may be a working copy after that import; it is not the trusted checkpoint. Completed logical tools return stored results; not-yet-admitted tools can dispatch under a new attempt; admitted unresolved shell work becomes unknown. Reconcile live executor incarnation first. Read-only retry creates a new observation; structured write recovery uses its expected-content check. No automatic shell compensation. No `agent.state.messages` patch.
8. DO restart may leave Node alive. Reconciliation compares incarnation/epoch/current position and attaches only to the matching process. Replacement requires 004's retained evidence: platform-confirmed termination of that incarnation, or independently verified new identity isolation with no shared workspace/process/mount. Revocation plus cancel acknowledgment, lease expiry or executor-local receipt is insufficient. If the old shell still reaches the target tree, replacement stays blocked. Isolation allows a new writer only on the separated tree, not a false claim that the old shell stopped; its capacity and external unknown effects remain tracked until actual termination/reconciliation. A lost platform observation leaves the gate BLOCKED. Unknown effects settle failed and block review. Restoring with loss requires the exact explicit recovery command in 003, not implicit retry.
9. Persist first-interruption time and 15-minute automatic recovery deadline. Backoff never resets it. Finite individual model/tool deadlines replace the old whole-run ten-minute limit. On recovery expiry revoke new admissions, request cancellation, fail pending assistants and retain unresolved processes/capacity for observation.

## Failed-run command handlers

Implement and enable admission for `abandon_failed_run`, `retry_known_safe` and `acknowledge_uncertainty_and_start_new_action` here using 003's exact union and payload-conflict rules. Revalidate exact source run/position and owner at consumption. Abandon is model-free with no messages/capacity; it never clears a live-writer barrier or frees a slot. Safe retry requires supported verified state with no unresolved effects, creates a fresh linked run and pending assistant attached to the retained user instruction, preserves the old failed assistant and original logical effect IDs in the validated continuation, and never repeats completed effects. A fresh run ID must not rekey completed effects into new work. The uncertainty action requires new text, its own user/assistant pair and NEW run, and acknowledgment of the exact still-unknown operation set. It cannot replay the failed command or resolve old external outcomes. Both Pi-starting actions require configured model, all missing capacity, usable paired baseline and actual termination/isolation evidence; only then can the corresponding review barrier reopen. 007 adds explicit paired restore/backup handlers; 008 adds `restart_preview`. Until those start prerequisites exist, fixture implementations do not enable real-user execution.

## Behavior tests and commands

Primary `session-runtime-continuation.test.ts` uses the authenticated command fixture with real Pi child process and deterministic provider/executor. Fault switches belong to storage/HTTP/process adapters; assertions read receipts, snapshots, events and resulting files.

- T09: detach all browser clients and recreate product handler; accepted work completes or recovers without client execution.
- T10: recreate coordinator with Node still running; one logical process/run continues.
- T11/T12: kill after provider response, tool result, compaction and each follow-up consumption boundary; branch/summary/IDs survive and no completed effect repeats.
- T13/T14: lose shell result acknowledgment, then persistence failure at every awaited boundary; no replay or later effect.
- T15/T16: uncooperative shell and late old-epoch result/model admission; same-tree replacement blocked, legitimate old in-flight evidence retained without overwriting a newer position. Forge cancel acknowledgments and stale termination observations, rotate incarnation between observation and CAS, and prove denial. With independently isolated new identity, permit only separated replacement while keeping the old live capacity claim and unknown external effects.
- T35/T36: retry model with separate spend attempts and enforce fixed recovery deadline while unresolved processes remain tracked.
- T29: hostile repository files cannot load/override trusted resources or reach local tools; malicious attachment/paths remain data.

Add command-boundary tests for all three failed-run variants: same-key retries, conflicting acknowledgment sets, stale expected position, new-message allocation exactly once, no old-effect replay, abandon with live shell, and model/capacity rejection without reopening review.

Before each standalone brain test/typecheck/build, run `pnpm contracts:verify` then `npm run contracts:check --prefix packages/session-brain`. If npm copied the dependency, use 002's verified refresh recipe before expecting that check to pass; a build does not refresh a stale copy. `brain:verify` includes these prerequisites. After each small adapter change run its test, then:

```sh
pnpm contracts:verify
npm run contracts:check --prefix packages/session-brain
npm test --prefix packages/session-brain -- src/pi-feasibility.test.ts src/continuation.test.ts src/provider-barrier.test.ts src/resource-loader.test.ts
pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-continuation.test.ts src/lib/session-runtime-control.test.ts src/lib/session-runtime-security.test.ts
npm run typecheck --prefix packages/session-brain
pnpm brain:verify
npm test --prefix packages/sandbox-runner -- src/locked-resource-loader.test.ts
pnpm --filter @ditto/runtime typecheck
pnpm typecheck
pnpm check
```

All should exit 0 with no skipped crash position. These scripts were defined in 001/002. The npm local contracts dependency must consume current built output. Parent baseline does not establish these new tests; real HTTPS/model/restart isolation remains P-Model/P-Restart NOT RUN until paid authorization.

## Done, handoff and maintenance

007 receives a real pause-at-safe-boundary acknowledgment, immutable `ContinuationV1` snapshot/restore API, precise current execution position and unresolved-effect state. `pauseForCheckpoint(expectedEpoch)` denies new mutations and returns only once no unaccounted tool can write. It is not an instruction to kill a shell and assume consistency.

Done requires T09-T16/T29/T35/T36 passing through authenticated commands, no completed logical operation replayed across restart, exact queue/compaction IDs preserved, and failure-barrier tests admitting zero later effects. No ten-minute whole-run cap exists on target runs.

STOP on unsupported SDK state, private-field monkeypatch requirement, lossy provider conversion, local fallback, implicit retry of unknown shell, missing final-answer barrier, or an inability to distinguish a surviving process. Pi/adapter/journal versions move together. Every pinned upgrade reruns 001 and this phase, with a migration or reason-coded recovery block for incompatible retained state.
