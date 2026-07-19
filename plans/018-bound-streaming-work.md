# Plan 018: Bound stderr memory and batch streaming updates

> **Executor instructions**: Preserve final text, tool/text ordering, immediate
> terminal events, and scroll behavior. Use fake schedulers/timers in tests;
> never assert wall-clock timing.
>
> **Drift check (run first)**:
> `git diff --stat 576febe..HEAD -- src/lib/agent-run.ts src/lib/agent-run.test.ts src/lib/agent-run-service.ts src/lib/agent-run-service.test.ts src/components/composer.tsx src/components/ai-chat.tsx src/lib/agent-message-parts.ts`
> Also check uncommitted changes in `ai-chat.tsx` before editing. If those files
> drifted materially from the excerpts below, STOP and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/017-extract-agent-run-lifecycle.md` (DONE)
- **Category**: perf
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Reconciled at**: commit `576febe`, 2026-07-12 (post-017: stream sink is `agent-run-service.ts`)
- **Execution**: DONE — branch `advisor/018-bound-streaming-work`, commit
  `d3ec01b`; integrated into master through merge commit `09a5dac`.

## Why this matters

A ten-minute noisy runner appends all stderr even though only its last 400
characters are used. Token-sized assistant deltas also trigger repeated
growing-string/parts projections, SSE enqueue calls, React state updates, and
complete Markdown reparsing. Long coding answers therefore consume increasing
Worker/browser CPU and can stutter. This plan bounds diagnostic memory and
batches only contiguous text deltas while preserving event semantics.

## Current state (as of `576febe`)

### Unlimited stderr (`src/lib/agent-run.ts`)

```ts
// ~78
let stderrBuffer = "";

// ~243-245
if (event.type === "stderr" && event.data) {
  stderrBuffer += event.data;
}

// ~268-287 — only last 400 chars used at terminal
const stderrHint = redactSecrets(
  stderrBuffer.trim().slice(-400),
  secretValues,
);
```

### Per-delta parts scan + immediate emit (`src/lib/agent-run-service.ts`)

After plan 017, the SSE route (`src/routes/api.agent.stream.ts`) only encodes
events. The streaming sink is `executeAgentRun`:

```ts
// ~509-513
if (msg.kind === "assistant_delta") {
  parts = appendAssistantTextDelta(parts, msg.delta);
  assistantContent = partsToText(parts);
  emit({ event: "delta", data: { delta: msg.delta } });
}
```

### Per-delta React state (`src/components/composer.tsx`)

```ts
// ~302-318
onDelta: (delta) => {
  assistantTextRef.current += delta;
  partsRef.current = appendAssistantTextDelta(partsRef.current, delta);
  const nextParts = partsRef.current;
  onStreamingChange?.((previous) => {
    const base = previous ?? emptyStreaming(prompt);
    return {
      ...base,
      active: true,
      text: partsToText(nextParts),
      parts: nextParts,
      tools: partsToTools(nextParts),
    };
  });
},
```

### Unmemoized chat projections (`src/components/ai-chat.tsx`)

```ts
// ~347-371
const normalizedServerMessages = messages.map(normalizeMessage);
// ...
const overlay = pendingOverlay(cacheSessionId, messages);
const displayMessages = mergeMessages(
  normalizedServerMessages,
  overlay,
  cacheSessionId,
);
const displayIds = new Set(
  displayMessages.map((message) => String(message.id)),
);
```

Reducers live in `src/lib/agent-message-parts.ts` (`appendAssistantTextDelta`,
`partsToText`, `partsToTools`). Prefer that boundary for any projection helpers.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (worktree) | `pnpm install --frozen-lockfile` | exit 0 |
| Focused | `pnpm test -- src/lib/agent-run.test.ts src/lib/agent-delta-batcher.test.ts src/lib/agent-run-service.test.ts src/components/composer.test.tsx src/components/ai-chat.test.tsx` | all pass |
| Full | `pnpm verify` | exit 0 |

## Scope

**In scope**:

- `src/lib/agent-run.ts`, `src/lib/agent-run.test.ts`
- `src/lib/agent-delta-batcher.ts`, `src/lib/agent-delta-batcher.test.ts` (create)
- `src/lib/agent-run-service.ts`, `src/lib/agent-run-service.test.ts` (server sink batching)
- `src/components/composer.tsx`, `src/components/composer.test.tsx` (create/extend)
- `src/components/ai-chat.tsx`, `src/components/ai-chat.test.tsx` (extend existing)
- `src/lib/agent-message-parts.ts` only if a tiny pure projection helper is needed (prefer not)
- Do **not** update `plans/README.md` (reviewer maintains the index)

**Out of scope**:

- Message history pagination/virtualization (plan 020).
- Changing SSE event names, storage format, Markdown renderer, or tool grouping.
- Dropping intermediate tool events or delaying error/done delivery.
- WebSocket transport or cancellation.
- `src/routes/api.agent.stream.ts` (thin encode-only wrapper after 017 — leave it).
- `src/lib/agent-stream-client.ts` unless a pure re-export is required (prefer not).

## Conventions to match

- Vitest + `vi.fn` / fake timers. Existing agent tests mock sandbox/SSE streams;
  follow `src/lib/agent-run.test.ts` and `src/lib/agent-run-service.test.ts`.
- Import paths use `#/` alias.
- Biome formatting; no new dependencies.
- Prefer pure helpers with injected schedulers over globals.
- Component tests: `/** @vitest-environment jsdom */` + Testing Library; see
  `src/components/ai-chat.test.tsx` for mock patterns.
- For Composer unit tests you will likely need to mock `streamAgentRun`,
  navigation, and preferences — keep mocks minimal and local to the test file.

## Git workflow

- Branch: `advisor/018-bound-streaming-work`
- Suggested commit: `perf(chat): batch streaming deltas`
- Do not push or open a PR unless instructed.

## Steps

### Step 0: Drift check + setup

1. Run the drift check command above. If in-scope files changed beyond trivial
   noise vs the excerpts, STOP.
2. `git checkout -b advisor/018-bound-streaming-work` (from worktree HEAD).
3. `pnpm install --frozen-lockfile` if `node_modules` is missing.

### Step 1: Replace stderr accumulation with a rolling tail

Add a small pure helper (can live at the bottom/top of `agent-run.ts` or a
tiny co-located export) that retains a bounded diagnostic tail as chunks
arrive. Keep enough data for the existing final 400-character message plus
Unicode boundary safety; cap storage at a documented constant no larger than a
few KiB (e.g. 2–4 KiB of retained characters is fine). Use the helper for both
nonzero exit and empty-response diagnostics. Do not change the public error
message shapes (still last 400 after trim + redact).

**Verify**: agent-run test feeds multiple chunks far above the cap, asserts
bounded retained length (if the helper is testable) or that a multi-MiB stream
does not grow memory unbounded via the helper unit test, exact final tail in
the error message, redaction still works, and unchanged error copy patterns
(`Agent exited with code N: …` / `Agent produced no response: …`).

### Step 2: Add a deterministic contiguous-delta batcher

Create `src/lib/agent-delta-batcher.ts` with a scheduler-injected batcher that
merges contiguous assistant text deltas and flushes at most once per
16ms/animation-frame interval. API sketch (adjust names to fit codebase style):

```ts
type ScheduleFn = (cb: () => void) => () => void; // returns cancel

export function createDeltaBatcher(options: {
  onFlush: (delta: string) => void;
  schedule?: ScheduleFn; // default: requestAnimationFrame or setTimeout(16)
}): {
  push: (delta: string) => void;
  flush: () => void; // sync flush pending text
  dispose: () => void; // flush remaining then cancel schedule; must not drop tail
};
```

Requirements:

- Merges contiguous `push` calls into one flush.
- Flushes synchronously before agent/tool events, error, done, disposal, and
  storage finalization so text/tool ordering remains exact (callers invoke
  `flush()` before non-text work).
- Disposal cannot drop a tail.
- Default schedule: prefer `setTimeout(0)`/`setTimeout(16)` that is injectable;
  do not require `requestAnimationFrame` in Workers.

**Verify**: fake-scheduler tests in `agent-delta-batcher.test.ts` prove many
token chunks become a bounded number of flushes, final concatenated bytes
match, and an intervening `flush()` before a tool-like boundary splits batches
correctly. Use fake timers only if you inject a real timer schedule; prefer an
explicit fake schedule list.

### Step 3: Use batching in the server event sink

In `executeAgentRun` (`agent-run-service.ts`):

- Create a batcher whose `onFlush` appends parts and emits one `delta` event
  with the batched string.
- On `assistant_delta`: `batcher.push(msg.delta)` only — do **not** call
  `partsToText` per token.
- Before handling `agent_event`, `error`, run completion, catch path, or any
  terminal persistence: `batcher.flush()` then proceed.
- Derive `assistantContent` via `partsToText(parts)` once at terminal
  persistence (existing post-run block already does this — keep that).
- Do not batch meta/tool/error/done events.
- `dispose`/flush on all exit paths so no tail is lost.

**Verify**: extend `agent-run-service.test.ts`:

- Many tiny deltas → fewer `delta` events than inputs, concatenated content
  identical.
- Interleaved tool agent_event → delta before tool is flushed before tool
  updates parts; final parts/tools match unbatched reducer semantics.
- Error/done still immediately after any pending text; persistence content
  byte-identical.

### Step 4: Bound client React work

**Composer** (`composer.tsx`):

- Consume already-batched server deltas; still update refs first.
- Publish at most one `onStreamingChange` state update per received delta
  callback (server already batches; do not re-batch with timers on the client
  unless you inject a testable batcher — optional, only if server batch size
  still causes excessive updates). Minimum bar: avoid redundant
  `partsToTools`/`partsToText` thrash by computing once per callback from
  refs; do not call `onStreamingChange` with identical text if nothing
  changed.
- Prefer keeping tool events immediate (flush any local pending text, then
  update tools).
- Preserve settlement/navigation: one terminal commit even when error+done
  both arrive (existing `streamSettledRef` behavior).

**ai-chat** (`ai-chat.tsx`):

- Memoize `normalizedServerMessages`, `overlay`/`displayMessages`, and
  `displayIds` with `useMemo` by real dependencies (`messages`,
  `cacheSessionId`). Do not hide stale state behind incorrect memoization.
- Preserve stick-to-bottom / MessageScroller behavior and optimistic overlays.

**Verify**:

- `composer.test.tsx` (create): mock `streamAgentRun` to fire 100 tiny deltas
  + one tool event + done; assert final rendered/streamed text equals full
  concat, tool ordering correct, `onStreamingChange` call count bounded
  (e.g. ≤ number of deltas + meta/tool/done overhead, and ideally much lower
  if you add client batching; at minimum document the bound you enforce).
- `ai-chat.test.tsx`: existing cache tests still pass; add a small test that
  stable `messages` prop identity does not force remount of message content if
  practical, or that display still shows pending overlays correctly after
  memoization.

### Step 5: Commit + full verification

1. `pnpm test -- src/lib/agent-run.test.ts src/lib/agent-delta-batcher.test.ts src/lib/agent-run-service.test.ts src/components/composer.test.tsx src/components/ai-chat.test.tsx`
2. `pnpm verify` → exit 0
3. Commit: `perf(chat): batch streaming deltas` (body optional: bound stderr +
   batch contiguous deltas server-side + memoize chat projections).

## Test plan

- Very large stderr across chunk boundaries, Unicode tail, secret redaction.
- 1000 tiny text deltas, interleaved tool event, error, done, and disposal.
- Final content/parts/tools identical to unbatched reducer result.
- One terminal commit/navigation even when error and done both arrive.
- Existing optimistic overlay and scroll behavior remain user-visible.

## Done criteria

- [ ] Runner stderr memory has a fixed upper bound (helper/cap tested).
- [ ] Contiguous deltas are batched on the server; terminal/non-text events
      flush immediately.
- [ ] Final persisted/rendered text and tool ordering are unchanged.
- [ ] High-fragmentation tests bound emit/callback counts.
- [ ] Focused tests and `pnpm verify` pass.
- [ ] Work committed on `advisor/018-bound-streaming-work`.

## STOP conditions

- The PI event model permits a tool event to semantically precede text already
  delivered in the same callback and the batcher cannot preserve that order.
- Existing user-owned `ai-chat.tsx` changes overlap the memoization section
  (uncommitted local edits you did not make).
- Tests require real timers or browser network calls to pass.
- Drift check shows material changes to the sink/composer/run files beyond
  this plan's excerpts.

## Maintenance notes

New non-text event kinds must force a delta flush unless protocol ordering says
otherwise. Revisit the cadence only with measured INP/render data; do not tune
it by intuition.
