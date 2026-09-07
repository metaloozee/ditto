# 010: Reconnect through durable events and keep the existing UI truthful

Status: BLOCKED on 009. Base HEAD: `c963890`, branch `brain`. Effort: L, 4-7 days. Risk: medium-high. Unresolved recovery copy requires maintainer approval before UI implementation.

## Goal and prerequisites

Separate command response from event connection. Reconnection must show committed work and recovery position after browser/product restart, without starting containers. Fit the new states into existing composer, conversation, workspace status and preview alert areas. No new layout, terminal, code browser or chat redesign.

003 supplies authenticated commands, idempotency keys and receipts. 004 already serves committed `SnapshotV1` without waking containers and stores semantic sequence plus terminal projection intents. 006 supplies run/attempt/position, safe continuation, Stop and unknown-effect state. 007-009 supply checkpoint rollback markers, backup health, capacity/preview/archive/deleting state and allowed recovery choices. Canonical content is encrypted; public projections are redacted and contain no raw Pi state, key metadata, R2 references or preview bearer URLs.

The server event contract is additive for trusted owners. Legacy views keep old protocol behavior until 011. Production trusted routing remains disabled until release.

## Rechecked evidence and conventions

`apps/web/src/components/composer.tsx:146-149` currently tracks connection-derived booleans:

```ts
const [isStreaming, setIsStreaming] = useState(false);
const [controlReady, setControlReady] = useState(false);
const [controlPending, setControlPending] = useState(false);
const [stopping, setStopping] = useState(false);
```

`apps/web/src/lib/agent-stream-client.ts:95-107` exposes event callbacks but no durable event cursor. `apps/web/src/components/session-preview-pane.tsx:21-27` already has idle/starting/ready/stopping/saving/failed states and an existing alert area. Reuse them rather than adding a dashboard.

Existing behavioral UI exemplar, `apps/web/src/components/composer.test.tsx:100-104`:

```ts
render(<Composer projectId="proj-1" sessionId="sess-1" />);

const textarea = screen.getByRole("textbox");
fireEvent.change(textarea, { target: { value: "hello" } });
fireEvent.keyDown(textarea, { key: "Enter" });
```

Tests use jsdom, Testing Library accessible roles, and mocked browser transport. Existing `agent-message-parts` preserves text/tool interleaving and `chat-session-cache` is bounded optimistic memory, not a durable source. Follow these conventions. The earlier draft reported reading UI Skills routing; that skill read was not repeated or certified in this editorial pass. No CLI install or production UI change was made. Before implementation, load the smallest relevant accessibility/state skill context allowed in the executor environment.

## Files

Server/client: `apps/runtime/src/events.ts`, `session-runtime.ts`, `product-projector.ts`; `apps/web/src/lib/session-runtime-client.ts`, `agent-stream-client.ts`, `agent-stream-protocol.ts`, `agent-message-parts.ts`, `agent-message-storage.ts`, `chat-session-cache.ts`, `secret-redaction.ts`; `apps/web/src/routes/api.agent.stream.ts`, `api.agent.control.ts` and tests.

UI: `apps/web/src/components/composer.tsx`, `ai-chat.tsx`, `session-preview-pane.tsx`, associated tests; `apps/web/src/routes/project.$projectId.tsx` and `.test.tsx`. Read each complete component before editing and preserve existing layout/classes/copy unless the state change requires approved wording. New tests `apps/web/src/lib/session-runtime-events.test.ts`; add browser reconnect tests to existing client/component files, not a separate UI framework.

## Event contract and sequencing

`GET /api/agent/stream` authenticates owner and target, then obtains committed snapshot+cursor and subsequent events. Snapshot capture and attachment use one short coordinator serialization step: register a bounded subscriber at cursor S, capture immutable snapshot S, then emit retained events after S plus live committed events. If the attachment fails midway, reconnect by cursor. Do not await a browser writer inside coordinator state transitions.

Durable semantic `EventV1` carries monotonic sequence, run/command/message identifiers, reason and committed position. Persist it with the state transition. Duplicate events are idempotent. Cursor older than replay retention returns a replacement snapshot with cursor; malformed/foreign cursor is rejected. Event replay may be compacted only after canonical state remains reconstructible and replacement snapshot works. Keep canonical history for retained lifetime.

Transient tokens are scoped to run+attempt+committed position and optional stream chunk sequence. On replacement snapshot discard stale partial content. Final text/tool result is durable before completion event. D1 projection version can lag terminal coordinator state; observation explicitly distinguishes projection pending from an active run.

Byte budgets from 002 are enforced both Node-to-coordinator and coordinator-to-browser: finite frame size and subscriber queue, detach slow subscriber at bound and require reconnect. Large canonical records use encrypted bounded storage, not an ever-growing in-memory token array. Transient token loss is permissible, loss of final state is not.

## Redaction and UI behaviors

1. Redact before semantic event persistence, D1 projection and browser delivery. Reuse bounded `StreamingSecretRedactor` for split secrets and structured redaction for tool args/results/stderr/errors. Product-owned project-value materialization can provide trusted redaction processing, but no raw project values/key material may enter public snapshots or unencrypted journal records. Include secret shapes and exact authorized known values, including short values if project policy allows them; if current redaction deliberately excludes short strings, resolve that security policy explicitly rather than claiming all supplied values are removed.
2. New first prompt generates a stable client idempotency key once per submitted payload and retains it across network retry. Clear draft only after durable receipt; navigate using original server session ID on retry. Do not create a new key for each HTTP retry. After reload, recover receipts/history via authenticated state; do not store transcript/keys/capability URLs in local storage.
3. Show admitted/queued/coordinator-accepted separately from running. Accepted follow-ups are visible durable message pairs in FIFO order; canceled ones remain with failed assistant/reason. Newer typed text must not be cleared by an older acknowledgment. Thinking remains fixed model with `off|high|max`; existing disabled rules persist while a run is active.
4. Stop targets exact run, stays recorded intent until applied, and remains stopping while old execution is unresolved. A network failure must not display stopped. The event connection is not aborted as Stop policy. Browser navigation only detaches events.
5. Show recovering/failed-review with the affected operation and redacted known evidence. A generic Retry cannot repeat unknown shell. Use the exact 003 discriminants: `abandon_failed_run`, `retry_known_safe`, `acknowledge_uncertainty_and_start_new_action`, `restore_checkpoint_acknowledging_loss`, `retry_backup` and `restart_preview`. Snapshot allowed actions carry required run/operation/pair references and expected position/generation, never storage capabilities. Advertise only implemented actions currently allowed; server admission and consumption still revalidate. Abandon cannot display a still-live shell as stopped or free its capacity; the uncertainty action creates a NEW run/message pair and never replays old work. Safe retry is only for server-verified supported state without unknown effects. Restore requires exact pair and explicit unbacked-loss acknowledgment, cannot bypass old-writer isolation, and does not resume Pi. Inspect remains observational through existing views. Do not invent a terminal/code-browser view. For copy/action placement not determined by existing components, present 2-3 in-reply sketches and WAIT for maintainer approval before implementing.
6. Show interrupted later conversation after restore and the restored checkpoint position. Completed assistant remains complete on backup failure. Use persistent backup-pending/saving alerts. Preview Stop after backup failure leaves preview stopped and exposes independent `retry_backup` and `restart_preview` actions. Both are model-free with no new chat pair; backup retry never repeats tools or starts preview, and preview restart never clears unknown-effect review. Preview URLs remain ephemeral authenticated result data, never query cache/log/history/toast/copy persistence.
7. Opening history or attaching events cannot call default Container fetch or implicit provision. Cold preview is explicit and does not start brain. Keep history scrollable and pageable while runtime/recovery controls are unavailable. Use accessible announcements/focus/disabled state, no new animated layout.

## Ordered work and verification

1. Implement snapshot/event atomic attachment and replay through authenticated observation. T24 covers old cursor, duplicates, lost attachment, slow client, split UTF-8/secret and replacement partial state. T26 records zero brain/executor starts for history/snapshot/events with stopped containers. Verify `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-events.test.ts`.
2. Add strict versioned browser parser and cursor reducer. Reject malformed events instead of unsafe type casts; repair on snapshot/gap. Test reconnect after product restart, terminal-before-D1-projection and wrong-attempt deltas. Verify `pnpm --filter @ditto/web exec vitest run src/lib/agent-stream-client.test.ts src/lib/agent-stream-protocol.test.ts src/lib/agent-message-parts.test.ts src/lib/secret-redaction.test.ts`.
3. Implement specified state behavior in existing components, stopping for unresolved layout/copy. Keep optimistic cache dedupe by stable message ID until confirmed projections arrive. Verify `pnpm --filter @ditto/web exec vitest run src/components/composer.test.tsx src/components/ai-chat.test.tsx src/components/session-preview-pane.test.tsx 'src/routes/project.$projectId.test.tsx'`.
4. Test a complete command/disconnect/reconnect flow with a live local Pi fixture and explicitly labeled injected auth. The real-cookie adapter smoke is separately owned by 012. Reject stale allowed-action observations after owner/position/generation changes, and assert message/NEW-run rules and distinct stopped versus isolated-old-live display. Test the command/disconnect/reconnect flow through existing production handlers. Assert final message IDs/status, restored history marker, queue cancellation and backup warning, not just happy-path render. Run `pnpm --filter @ditto/web exec vitest run src/lib/session-runtime-events.test.ts src/lib/session-runtime-continuation.test.ts` then `pnpm typecheck`, `pnpm --filter @ditto/runtime typecheck`, `pnpm check`.

Expected results are exit 0 and no skipped required cases. Parent baseline reports old suites, not target UI/replay. `exec vitest run` is necessary for narrow selection under observed pnpm behavior. Paid slow-stream/provider/HTTP bridge tests remain part of 012.

## Done and maintenance

011 receives full user-visible observation and reason-coded blocked/read-only migration states. Done means T24/T26 pass, no subscription starts containers, slow clients cannot delay tool/model completion, final state survives transient loss, no split secret leaks, and component tests prove Stop/queue/recovery semantics without a new layout. Required copy decisions must be approved, not silently marked done.

STOP if browser connection owns run lifetime, event persistence can lag reported completion, raw provider/crypto/R2 data reaches history, unknown Retry repeats effects, or opening an archived conversation starts capacity. Any new event must declare durability, cursor/idempotency, redaction and replacement-snapshot behavior.
