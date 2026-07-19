# Plan 004: Remove Effect anti-patterns and deslop chat UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Working tree is intentionally dirty with the
> chat streaming WIP this plan targets. Confirm the excerpts below still match
> live files before editing. On mismatch, STOP and report.
>
> **Do not commit.** Leave changes unstaged in the working tree for the human.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (applies to current uncommitted WIP)
- **Category**: bug | perf | tech-debt
- **Planned at**: commit `523e5c0`, 2026-07-09 (plus uncommitted chat streaming changes)
- **Execution**: DONE — integrated by commit `6ac3b74`.
- **Reconciliation 2026-07-19**: the historical work remains integrated, but
  later pagination/cache work reintroduced a message-driven `useEffect` that
  mutates the session cache and calls `setCacheEpoch`; the plan's no-prop-sync
  Effect invariant no longer holds on current HEAD. Track any correction as a
  new plan rather than reopening this completed WIP plan.
- **React Doctor baseline**: 62/100 on `--scope changed` (2 errors, 8 warnings)

## Why this matters

The uncommitted chat streaming UI reintroduces classic React anti-patterns from
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect):
syncing `overlay` state from props/`messages` inside a `useEffect`, cascading
renders, and event-time work done after paint. React Doctor scores this at 62
and flags the Effect + compiler failures as the top fixes. Separately,
`ToolCallPart` is built but never rendered — tool call UI is dead during stream
and after commit. Cleaning this makes streaming correct, faster, and compiler-friendly.

## Current state

### Files

- `src/components/ai-chat.tsx` — chat list + overlay merge + tool/markdown rows
- `src/components/composer.tsx` — submit + SSE stream + model selector
- `src/lib/chat-session-cache.ts` — module-level Map for optimistic messages across session navigation
- `src/components/assistant-markdown.tsx` — Streamdown + hljs (leave mostly alone; only touch if needed for consistency)
- `src/components/ai-elements/task.tsx` — shadcn Task primitives (leave alone unless import path breaks)

### Anti-pattern 1 — Adjusting state when props change (Effect)

```tsx
// src/components/ai-chat.tsx ~348-390
const [overlay, setOverlay] = useState<MessageOverlay | null>(() =>
  initialOverlay(sessionId),
);

useEffect(() => {
  setOverlay((previous) => {
    if (sessionId) {
      const remaining = pruneSessionMessages(sessionId, messages);
      // ... prune / seed / filter previous ...
    }
    // ... more setState branches ...
    return previous;
  });
}, [messages, sessionId]);
```

This is exactly the React docs anti-pattern: "You don't need Effects to
transform data for rendering" / "adjusting state when props change." It causes
cascading renders and is flagged by React Compiler + react-doctor
(`setState` in effect body, `no-event-handler`).

`chat-session-cache.ts` already holds the optimistic messages. Overlay state
duplicates the cache and then re-syncs via Effect.

### Anti-pattern 2 — Tool parts never rendered (bug)

```tsx
// src/components/ai-chat.tsx AssistantParts
parts.map((part) => {
  if (part.type === "text") {
    return <AssistantMarkdown ... />;
  }
  return null; // tool parts dropped — ToolCallPart is dead code
});
```

`AssistantMessagePart` is a union of `text | tool`. Composer streams tool parts
via `applyAgentToolEventToParts`, but the list never shows them.

### Anti-pattern 3 — Dynamic component type during render

```tsx
const Icon = toolIcon(tool.name);
return <Icon className="size-3.5 shrink-0" />;
```

React Compiler: "Cannot create components during render."

### Other doctor findings (deslop)

| Finding | Location | Fix |
|---------|----------|-----|
| Empty default prop `messages = []` | `Chat` props | Module-level `EMPTY_MESSAGES` constant |
| Redundant `memo` / `useCallback` | `composer.tsx` ModelItem | Remove manual memoization (React Compiler present via babel plugin) |
| `filter().map()` chains | `mergeMessages`, model list | Single-pass loops where cheap |
| Dead wrapper `EmptyConversation` | wraps `ChatEmptyState` only | Inline / delete wrapper |
| Giant `Composer` (~313 lines) | optional | Light extract only if it is free; **do not** redesign stream orchestration |

### Conventions

- Path alias `#/*` → `./src/*`
- Biome for format/lint (`pnpm check`)
- Tests: Vitest (`pnpm test`)
- React 19 + React Compiler (`babel-plugin-react-compiler` in Vite)
- Prefer calculating during render over Effect-synced state
- Event side effects stay in event handlers (`handleStreamCommit`, `handleSubmit`)

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Unit tests | `pnpm test` | all pass |
| Lint/format check | `pnpm check` | exit 0 (or only pre-existing out-of-scope noise) |
| React Doctor (changed) | `npx react-doctor@latest --verbose --scope changed` | score **≥ 80**, **0 errors** on `ai-chat.tsx` / `composer.tsx` for the Effect + compiler issues listed above |
| Typecheck (if available) | `pnpm exec tsc --noEmit` | exit 0, or report if project has no clean tsc script |

## Scope

**In scope** (only these files):
- `src/components/ai-chat.tsx`
- `src/components/composer.tsx`
- `src/lib/chat-session-cache.ts` (only if pure-read helpers are needed)
- Optional tiny test: `src/lib/chat-session-cache.test.ts` **only if** you add pure helpers worth testing

**Out of scope** (do NOT touch):
- `src/lib/agent-stream-client.ts` / its tests (protocol is fine)
- `src/routes/api.agent.stream.ts`
- migrations, schema, styles (unless a class name rename is required by a deslop in-scope)
- `src/components/ai-elements/prompt-input.tsx` and other third-party-ish UI
- Splitting Composer into many files just to silence `no-giant-component` (skip if >15 min)
- Committing, pushing, branching

## Target design (authoritative)

### 1. Derive overlay during render — no Effect

Remove the `useEffect` that calls `setOverlay`. Keep the module cache as the
source of truth for optimistic messages after stream commit.

**Render path:**

```tsx
const EMPTY_MESSAGES: ChatMessage[] = [];

export function Chat({ messages = EMPTY_MESSAGES, sessionId, ... }: ChatProps) {
  const [streaming, setStreaming] = useState<ComposerStreamingState | null>(null);
  // Version bump so pure cache reads re-render after commit / prune writes
  const [cacheEpoch, setCacheEpoch] = useState(0);

  const normalizedServerMessages = messages.map(normalizeMessage); // fine during render; no need for useMemo with Compiler

  const displayMessages = mergeMessages(
    normalizedServerMessages,
    sessionId
      ? {
          sessionId,
          messages: readSessionMessages(sessionId), // pure read
        }
      : null,
    sessionId,
  );
  // void cacheEpoch so eslint/compiler keep the dep if you useMemo
  void cacheEpoch;
  // ...
}
```

`mergeMessages` already filters cache/overlay messages that appear in server
`messages` by id. Prefer **pure reads** during render:

- Do **not** call `pruneSessionMessages` during render if it mutates the Map.
- Either:
  - **A (preferred):** Change `pruneSessionMessages` usage so mutation happens only in `handleStreamCommit` / when server messages arrive via an explicit function called from the commit handler, OR add a pure `listUnackedSessionMessages(sessionId, serverMessages)` that only filters, and optionally prune (mutate) inside `handleStreamCommit` after seed, and/or when Chat receives new server messages — but **not** via Effect. If you need to prune when props change without Effect, prune as a side effect of the event that causes server messages to update is hard from Chat; **pure filter in merge is enough** for correctness. Lazy-prune inside `seedSessionMessages` / `readSessionMessages` is OK only if documented; simplest is: pure filter in `mergeMessages`/`displayMessages`, and mutate-prune only in `handleStreamCommit` (drop ids already on server when seeding next time) **or** leave cache entries until next seed and rely on pure filter (cache may retain acked ids briefly — OK for in-memory session cache).
- **B:** Keep a small `overlay` state **only** updated from `handleStreamCommit` (event handler), and reset on `sessionId` change using the React pattern of **key** on an inner component, not Effect:

```tsx
export function Chat(props: ChatProps) {
  return <ChatSession key={props.sessionId ?? "none"} {...props} />;
}
function ChatSession({ sessionId, messages = EMPTY_MESSAGES, ... }: ChatProps) {
  // state initializes from cache; no effect to reset
}
```

**Pick A with pure merge + cacheEpoch bump on commit** unless key-split is clearly simpler. Do not leave a `useEffect` that `setState`s from `messages`/`sessionId`.

`handleStreamCommit` must:
1. `seedSessionMessages(payload.sessionId, committed)`
2. `setCacheEpoch((n) => n + 1)` (or set overlay only here if you keep overlay state)
3. No navigation/side effects beyond what already exists

Delete unused helpers after the refactor (`initialOverlay` may remain as a pure helper or fold into merge).

### 2. Render tool parts

In `AssistantParts`:

```tsx
if (part.type === "text") {
  return (
    <div key={part.id} className="w-full min-w-0">
      <AssistantMarkdown mode={streaming ? "streaming" : "static"} text={part.text} />
    </div>
  );
}
if (part.type === "tool") {
  return <ToolCallPart key={part.id} tool={part.tool} streaming={streaming} />;
}
return null;
```

### 3. Fix dynamic Icon for React Compiler

Do not assign a component to a local and render as `<Icon />`. Prefer a small
`ToolGlyph` component with a switch that returns concrete elements:

```tsx
function ToolGlyph({ name, className }: { name: string; className?: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell")) {
    return <TerminalIcon className={className} />;
  }
  // ... same mapping as toolIcon ...
  return <WrenchIcon className={className} />;
}
```

Use `<ToolGlyph name={tool.name} className="size-3.5 shrink-0" />`. Remove
`toolIcon` if unused.

### 4. Deslop (same files)

- `const EMPTY_MESSAGES: ChatMessage[] = []` for default prop.
- Remove `EmptyConversation` if it only forwards to `ChatEmptyState`.
- `composer.tsx`: remove `memo` on `ModelItem` and unnecessary `useCallback` wrappers **if** behavior stays identical; keep handlers clear.
- Replace trivial `filter().map()` with one loop where it stays readable (e.g. merge extras).
- Nested ternary for `StatusIcon` in `ToolCallPart` — convert to if/else or small helper (deslop: no nested ternaries).
- Do not add comments that narrate obvious code.
- Do not expand scope into prompt-input or stream client.

### 5. Preserve behavior

Must still:
- Show optimistic user + streaming assistant rows while stream active
- After stream commit, show committed messages even before router/query refetch (cache bridge)
- Navigate to new session only after stream settles when `createdSession` (already in Composer — do not break)
- Hide optimistic rows once server/`displayMessages` includes those ids
- Not clear streaming mid-flight when `sessionId` prop is still null

## Implementation steps

### Step 1 — Drift check

Confirm `ai-chat.tsx` still has the `useEffect` + `setOverlay` block and
`AssistantParts` returning null for non-text. Confirm `ToolCallPart` exists.

### Step 2 — Fix `ai-chat.tsx` (core)

1. Remove Effect-based overlay sync.
2. Implement pure derive + event-handler cache updates as in Target design.
3. Render tool parts.
4. Fix ToolGlyph / Icon compiler issue.
5. EMPTY_MESSAGES + deslop dead wrappers / nested ternaries / filter-map.

### Step 3 — Light deslop `composer.tsx`

Remove redundant memo/useCallback if safe. Single-pass model list filter if
easy. **Do not** rewrite stream state machine.

### Step 4 — Cache module (only if needed)

If pure list helper is cleaner, add:

```ts
export function listPendingSessionMessages(
  sessionId: string,
  serverMessages: Array<{ id: string | number }>,
): CachedChatMessage[] {
  const current = sessionMessages.get(sessionId) ?? [];
  if (current.length === 0) return [];
  const serverIds = new Set(serverMessages.map((m) => String(m.id)));
  return current.filter((m) => !serverIds.has(String(m.id)));
}
```

Keep `pruneSessionMessages` for optional mutation from commit handler, or stop
exporting if unused.

### Step 5 — Verify

```bash
pnpm test
pnpm check
npx react-doctor@latest --verbose --scope changed
```

Expected doctor: no errors for `setState` in effect / components-during-render
on these files; score ≥ 80 preferred. If score still low solely due to
`no-giant-component` on Composer, note it in NOTES and do not force a split.

## Done criteria (machine-checkable)

1. `rg -n "useEffect" src/components/ai-chat.tsx` → **no matches** (or only imports removed entirely).
2. `rg -n "setOverlay" src/components/ai-chat.tsx` → no matches **or** only event-handler paths (not inside `useEffect`).
3. `AssistantParts` renders `part.type === "tool"` via `ToolCallPart`.
4. No `const Icon = toolIcon(...)` + `<Icon />` pattern.
5. `messages = EMPTY_MESSAGES` (module const), not `messages = []`.
6. `pnpm test` exit 0.
7. `npx react-doctor@latest --verbose --scope changed` → **0 errors** for the previous Effect/compiler errors on `ai-chat.tsx` (warnings may remain for giant Composer).

## STOP conditions

- Removing the Effect causes lost optimistic messages after navigate-to-session (repro mentally: new session, stream completes, navigate, server list empty briefly) — if pure cache read fails, fix with `key={sessionId}` split + cache seed, still **without** props-sync Effect; if still stuck, STOP and report.
- React Doctor still reports setState-in-effect after your change → you left an Effect; remove it.
- Any need to change SSE protocol or DB schema → STOP.
- Tests fail for reasons outside in-scope files → STOP and report.

## Maintenance note

Future chat features should treat `chat-session-cache` as the bridge across
session route transitions. Do not reintroduce Effect to mirror props into React
state. Prefer keys for full reset, pure derivation for merges, and event
handlers for writes.
