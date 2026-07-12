# Plan 020: Infinite-scroll conversation history (cursor + virtualize)

> **Executor instructions**: Preserve chronological order, optimistic overlay
> reconciliation, and scroll anchoring. Implement the server cursor and tests
> before changing rendering. Do not use array indexes as cursors or React keys.
> **Do not build page-number UI** (no “page 2 of N”, no page buttons between
> messages). History loads by scrolling up / a top “earlier messages” control
> only — continuous chat, not discrete pages.
>
> **Drift check (run first)**:
> `git diff --stat 09a5dac..HEAD -- src/integrations/trpc/routers/workspace.ts src/integrations/trpc/routers/workspace.test.ts src/routes/project.$projectId.tsx src/components/ai-chat.tsx src/components/ai-chat.test.tsx src/components/ui/message-scroller.tsx src/lib/chat-session-cache.ts src/db/schema.ts package.json pnpm-lock.yaml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code before proceeding; on mismatch,
> STOP and report.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/015-enforce-session-archive-lifecycle.md` (DONE),
  `plans/017-extract-agent-run-lifecycle.md` (DONE),
  `plans/019-trim-production-bundle.md` (DONE)
- **Category**: perf
- **Planned at**: commit `09a5dac`, 2026-07-12
  (rewritten from original draft at `5ad5e0c` after review + drift)
- **Execution status**: DONE (2026-07-12)
- **Branch**: `advisor/020-virtual-chat-history` @ `6403dd3`
- **Worktree**: `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f561f-b889-7ce2-993a-e033aa9176fd`
- **Note**: Steps 1–5 shipped; Step 6 virtualization deferred (content-visibility retained)

## Why this matters

Selecting a session currently loads **every** message in one
`ensureWorkspace` mutation, then mounts every Markdown/diff row. D1 payload,
JSON parse of tool parts, React tree size, and streaming rerenders all grow
without bound.

This plan:

1. Bounds the **server** read with a stable newest-first **cursor** (data-layer
   pages — not a UI pagination chrome).
2. Owns those pages on the client with **TanStack infinite query** so the user
   only ever scrolls a continuous timeline (load older by scrolling up).
3. Virtualizes heavy rows where `content-visibility` is not enough, without
   breaking `@shadcn/react` MessageScroller’s prepend anchoring.

## Product / UX contract (normative)

| Do | Do not |
|---|---|
| Continuous scroll through the conversation | Page numbers, “next/prev page”, segmented page views |
| Initial view = **newest** ~50 messages, stick near bottom | Initial load of entire history |
| Load older by near-top scroll and/or a small top control (“Load earlier messages”) | Jumping to a numbered page of mid-history |
| Prepend older messages in place (anchor preserved) | Force scroll-to-bottom when the user loaded history |
| Session change resets to that session’s newest page only | Sharing one infinite-query cache across sessions |

Server “pagination” here means **cursor chunks for the infinite query**, not
user-facing pages.

## Current state

Evidence at plan rewrite (`09a5dac`). Confirm before coding.

### Unbounded message load inside ensureWorkspace

`src/integrations/trpc/routers/workspace.ts` — `loadWorkspaceView` selects
**all** messages for the selected session, ordered only by second-resolution
`createdAt` (no rowid tie-break):

```116:137:src/integrations/trpc/routers/workspace.ts
	const selectedMessages = selectedSession
		? await options.db
				.select()
				.from(messages)
				.where(
					and(
						eq(messages.sessionId, selectedSession.id),
						eq(messages.projectId, options.projectId),
						eq(messages.userId, options.userId),
					),
				)
				.orderBy(asc(messages.createdAt))
		: [];

	return {
		project: stripProjectSecrets(workspace.project),
		sandbox: { state: workspace.sandboxState },
		sessions,
		selectedSession,
		messages: selectedMessages,
		restoreFailed: workspace.restoreFailed,
	};
```

There is **no** `workspace.messages` query procedure today — only
`ensureWorkspace` / `retryRestore` / `deleteSession`.

### Route passes the full array into Chat

`src/routes/project.$projectId.tsx`:

```130:138:src/routes/project.$projectId.tsx
				<Chat
					projectId={projectId}
					sessionId={selectedSession?.id ?? sessionId ?? null}
					branchName={selectedSession?.branchName ?? null}
					gitExportEnabled={Boolean(
						project.githubRepo && project.githubInstallationId,
					)}
					disabledReason={disabledReason}
					messages={workspace?.messages ?? []}
```

`onWorkspaceRefresh` invalidates project list / git status but **does not**
re-fetch messages (optimistic cache carries the UI after stream commit). After
this plan, refresh **must** invalidate the messages infinite query so the
newest page includes server-confirmed rows.

### Chat mounts every message + optimistic overlay

`src/components/ai-chat.tsx` normalizes the full `messages` prop, acknowledges
cache IDs against whatever was passed, and maps **all** rows into
`MessageScrollerItem`s:

```364:391:src/components/ai-chat.tsx
	const normalizedServerMessages = useMemo(
		() => messages.map(normalizeMessage),
		[messages],
	);

	// After server messages refresh, drop matching optimistic cache entries.
	useEffect(() => {
		if (!cacheSessionId || messages.length === 0) {
			return;
		}
		const removed = acknowledgeSessionMessages(
			cacheSessionId,
			messages.map((message) => message.id),
		);
		// ...
	}, [cacheSessionId, messages]);

	const displayMessages = useMemo(
		() => mergeMessages(normalizedServerMessages, overlay, cacheSessionId),
		[normalizedServerMessages, overlay, cacheSessionId],
	);
```

Optimistic reconciliation uses stable message IDs via
`src/lib/chat-session-cache.ts` (`seedSessionMessages` /
`listPendingSessionMessages` / `acknowledgeSessionMessages`, cap 100). Preserve
that contract. With infinite query, acknowledge against the **flattened loaded
pages** (optimistic rows are always newest; they land on the first page).

### Message table + ordering

`src/db/schema.ts` — text PK, second-resolution `createdAt`, normal SQLite
rowid table (not `WITHOUT ROWID`):

```102:137:src/db/schema.ts
export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		// ...
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("messages_sessionId_idx").on(table.sessionId),
		index("messages_projectId_idx").on(table.projectId),
	],
);
```

Use opaque cursor of oldest returned `(createdAt, rowid)`. Order tie-breaker is
`rowid`, never random `id`.

### MessageScroller already helps prepend + light virtualization

`src/components/ui/message-scroller.tsx` wraps `@shadcn/react` MessageScroller.
Items already use `content-visibility: auto` + `contain-intrinsic-size`. The
upstream Viewport defaults `preserveScrollOnPrepend={true}` and restores scroll
when children are prepended. Prefer that over hand-rolled
scrollHeight/offset math unless measurements prove it fails in tests.

Hooks available: `useMessageScrollerScrollable()` → `{ start, end }` (whether
there is room to scroll toward start/end). Use `start === false` (near top) as
the signal to fetch the previous (older) page when `hasPreviousPage`.

### tRPC + TanStack Query conventions

- Client: `useTRPC()` from `src/integrations/trpc/react.ts`
  (`@trpc/tanstack-react-query`).
- Queries: `useQuery(trpc.x.y.queryOptions(...))` (see
  `src/components/session-git-actions.tsx`, `project-settings-dialog.tsx`).
- **No** `useInfiniteQuery` usage in the repo yet. Use
  `trpc.workspace.messages.infiniteQueryOptions({ ... }, { initialPageParam,
  getNextPageParam / getPreviousPageParam })` with
  `useInfiniteQuery` from `@tanstack/react-query`.
- tRPC infinite procedures must accept a `cursor` field on input.

### Existing tests

- `src/integrations/trpc/routers/workspace.test.ts` — mocks `createDb`; only
  covers `deleteSession` archival. **There is no real D1/SQLite test harness**
  in app tests (do not invent miniflare just for this plan).
- `src/components/ai-chat.test.tsx` — jsdom, mocks MessageScroller; covers
  optimistic overlay acknowledgement.
- No `src/routes/project.$projectId.test.tsx` yet — create only if route
  ownership needs isolation tests.

### Auth policy to reuse

`loadOwnedActiveSession` in `src/lib/workspace-session.ts` — owned +
`status === "active"`. Message history for a session ID that is missing,
archived, or other-user → `NOT_FOUND` (same as plan 015).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Cursor unit tests | `pnpm test -- src/lib/message-cursor.test.ts` | all pass |
| Router tests | `pnpm test -- src/integrations/trpc/routers/workspace.test.ts` | cursor/auth/limit cases pass |
| UI tests | `pnpm test -- src/components/ai-chat.test.tsx` | overlay + load-earlier cases pass |
| Full gate | `pnpm verify` | exit 0 |
| Build | `pnpm build` | exit 0 |

## Suggested executor toolkit

- If available: `vercel-react-best-practices` when wiring memoized flatten of
  infinite pages and virtualizer measurement.
- tRPC infinite query docs:
  https://trpc.io/docs/client/tanstack-react-query/usage#infiniteQueryOptions
- Do **not** add `@tanstack/react-virtual` until Step 5; pin exact
  `3.14.5` (or the current registry patch of 3.x if 3.14.5 is gone — never
  `latest`).

## Scope

**In scope**:

- `src/lib/message-cursor.ts` (new) + `src/lib/message-cursor.test.ts` (new) —
  encode/decode/compare only
- `src/integrations/trpc/routers/workspace.ts` + `workspace.test.ts`
- `src/routes/project.$projectId.tsx` (+ optional route test if needed)
- `src/components/ai-chat.tsx` + `ai-chat.test.tsx`
- `src/components/ui/message-scroller.tsx` only if virtualizer needs a thin
  integration hook (prefer not rewriting the scroller API)
- `src/lib/chat-session-cache.ts` only if paged acknowledgement needs a
  documented helper (prefer no behavior change)
- `package.json` / `pnpm-lock.yaml` only for pinned `@tanstack/react-virtual`
- `plans/README.md` status row only

**Out of scope**:

- Page-number UI, URL `?page=`, or segmented history screens
- Search / jump-to-message, retention/deletion, message editing, run ledger
- Changing stored message/tool JSON formats
- Infinite loading of the **session list** in the sidebar
- Replacing Markdown/diff renderers or Composer streaming protocol
- Introducing a full D1/miniflare test stack (use pure cursor tests + caller
  mocks consistent with existing router tests)

## Git workflow

- Branch: `advisor/020-virtual-chat-history`
- Suggested commits (conventional, match recent history):
  1. `feat(chat): cursor-page session messages`
  2. `feat(chat): infinite-query message history`
  3. `perf(chat): virtualize message history` (only if Step 5 ships)
- Do not push or open a PR unless instructed.

## Normative API

Add protected **query** `workspace.messages`:

```ts
// input
{
  projectId: string;
  sessionId: string;
  cursor?: string; // opaque; omit for newest page
  limit?: number;  // default 50, max 100
}

// output
{
  items: MessageRow[]; // chronological (oldest → newest within the page)
  nextCursor: string | null; // cursor to fetch *older* messages; null = no more
}
```

Rules:

1. Resolve session with `loadOwnedActiveSession`; null → `NOT_FOUND`.
2. Select `messages` + SQLite `rowid` (via Drizzle `sql` expression used only for
   order/cursor — **strip rowid from public items**).
3. Order **descending** by `(createdAt, rowid)`, fetch `limit + 1` to detect
   more, build `nextCursor` from the oldest **returned** row’s
   `(createdAt, rowid)`, reverse the page to chronological for `items`.
4. Cursor predicate for subsequent pages: strictly older than cursor, i.e.
   `(createdAt < c.createdAt) OR (createdAt = c.createdAt AND rowid < c.rowid)`.
5. Cursor codec lives in `src/lib/message-cursor.ts`: opaque base64url or
   similar of a versioned payload `{ v:1, t: number /* unix sec */, r: number }`.
   Reject malformed / wrong version with `BAD_REQUEST`. Never put raw SQL in the
   cursor.
6. `ensureWorkspace` / `retryRestore` continue to return project, sandbox,
   sessions, selectedSession, restoreFailed — **`messages` field becomes empty
   array or is removed**. Prefer **remove** `messages` from the ensure payload
   and fix all TypeScript call sites in the same change so nothing keeps
   depending on unbounded history.

## Client data ownership (normative)

In `ProjectWorkspacePage` (or a small colocated hook):

```ts
const messagesQuery = useInfiniteQuery(
  trpc.workspace.messages.infiniteQueryOptions(
    { projectId, sessionId: selectedSessionId, limit: 50 },
    {
      enabled: Boolean(selectedSessionId) && canLoadWorkspace,
      initialPageParam: undefined as string | undefined,
      // "next" page = older history (tRPC pageParam → input.cursor)
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  ),
);

const serverMessages = useMemo(
  () =>
    // pages[0] is newest chunk; each page.items is chronological.
    // Flatten oldest→newest for display:
    [...(messagesQuery.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.items),
  [messagesQuery.data?.pages],
);
```

Notes for the executor:

- Query key **must** include `sessionId` (tRPC input does this). Changing
  session discards old pages from the active render automatically.
- Pass into `Chat`: `messages={serverMessages}`, plus
  `hasMoreHistory={messagesQuery.hasNextPage}`,
  `isLoadingMoreHistory={messagesQuery.isFetchingNextPage}`,
  `onLoadEarlier={() => void messagesQuery.fetchNextPage()}`.
- On stream success (`onWorkspaceRefresh`), invalidate with
  `queryClient.invalidateQueries(trpc.workspace.messages.infiniteQueryFilter({ projectId, sessionId }))`
  (and keep existing project/git invalidations). Do **not** reintroduce
  unbounded ensureWorkspace messages.
- **No** page index state in the route URL.

### Why infinite query (not classic pagination UI)

Chat is a single continuous timeline. Users scroll; they do not navigate
numbered pages. Cursor pages exist only so the network/D1 stay bounded.
`useInfiniteQuery` is the correct TanStack primitive: it owns page arrays,
`hasNextPage` / `fetchNextPage`, and session-scoped keys without inventing UI
page state.

## Steps

### Step 1: Pure cursor codec + tests

Create `src/lib/message-cursor.ts` with `encodeMessageCursor`,
`decodeMessageCursor`, and a helper to build the Drizzle/SQL older-than
predicate inputs. Unit-test:

- round-trip stable for same `(t, r)`
- rejects garbage, empty, wrong version
- ordering compare: same second different rowid

**Verify**: `pnpm test -- src/lib/message-cursor.test.ts` → all pass.

### Step 2: Router tests for `workspace.messages` (fail first)

Extend `workspace.test.ts` following existing caller+mock style (do **not**
bootstrap real D1). Mock a chainable select that:

- records `where` / `orderBy` / `limit` arguments if easy, **or**
- returns scripted rows for page 1 / page 2 including same-`createdAt` pairs

Cases:

1. Newest page (no cursor): ≤ limit items, chronological, `nextCursor` set when
   more exist.
2. Second page with cursor: no duplicate IDs vs page 1, stable order.
3. Final page: `nextCursor === null`.
4. `limit` default 50, cap 100 (`limit: 500` clamped or rejected — pick **clamp
   to 100** and assert).
5. Malformed cursor → `BAD_REQUEST`.
6. Archived / missing / cross-user session → `NOT_FOUND` via
   `loadOwnedActiveSession` mock returning null.
7. `ensureWorkspace` response no longer includes unbounded messages (empty or
   field removed).

**Verify**: tests fail only because the procedure is missing / ensure still
returns full messages.

### Step 3: Implement bounded query; stop loading messages in ensure

Implement `workspace.messages` per Normative API. Strip `messages` loading from
`loadWorkspaceView` (both ensure and retryRestore paths). Keep session list +
sandbox ensure behavior unchanged.

Select shape sketch:

```ts
const rowid = sql<number>`rowid`.mapWith(Number);
// select { ...message columns, rowid }
// where session/project/user + optional older-than cursor
// orderBy desc(createdAt), desc(rowid)
// limit(limit + 1)
```

**Verify**: `pnpm test -- src/integrations/trpc/routers/workspace.test.ts` →
pass; `pnpm typecheck` → no callers still require ensure.messages.

### Step 4: Infinite query ownership in the project route

Wire `useInfiniteQuery` as in “Client data ownership”. Pass flattened
chronological messages + load-earlier props into `Chat`. Invalidate the
messages infinite query from `onWorkspaceRefresh`.

**Verify**:

- Manual or unit: with mocked trpc/query client if you add a route test —
  initial request has no cursor and limit ≤ 50.
- Session B must not render session A’s pages (query key isolation).
- `pnpm typecheck` exit 0.

### Step 5: Load-earlier UX + scroll anchoring in Chat

Update `Chat` props:

```ts
hasMoreHistory?: boolean;
isLoadingMoreHistory?: boolean;
onLoadEarlier?: () => void;
```

UI:

1. When `hasMoreHistory`, render a compact control at the **top** of the
   scroller content (“Load earlier messages” / spinner while
   `isLoadingMoreHistory`). Optional: when `useMessageScrollerScrollable().start`
   is false (user is at/near top) and `hasMoreHistory` and not already
   fetching, call `onLoadEarlier` once (guard with a ref to avoid loops).
2. Rely on MessageScroller’s `preserveScrollOnPrepend` (default true). Do not
   force `scrollToEnd` when older pages prepend.
3. Keep optimistic overlay merge at the **end** (newest) of the flattened
   list. Acknowledgement uses all currently loaded server IDs.
4. **Never** render page numbers or multi-page tabs.

**Verify**: extend `ai-chat.test.tsx`:

- Top control visible iff `hasMoreHistory`.
- Clicking it calls `onLoadEarlier`.
- Existing optimistic overlay tests still pass with a partial server page.
- (If practical with mocks) prepending messages does not clear displayed
  mid-list text.

### Step 6: Virtualize message rows (only if still needed)

`MessageScrollerItem` already sets `content-visibility: auto`. That reduces
paint/layout for off-screen rows but **still runs React** for every message
(Markdown, tool groups, lazy diffs). Add `@tanstack/react-virtual@3.14.5` only
if profiling or a 500-row test shows main-thread cost remains high after Steps
1–5.

If adding the virtualizer:

- Key by stable message `id`, dynamic `measureElement`, overscan ≥ 5.
- Virtual window must still use `MessageScrollerItem` with `messageId` so the
  scroller’s register/anchor logic keeps working.
- Streaming optimistic rows remain real items at the end of the list.
- If MessageScroller’s child MutationObserver / spacer model breaks under
  absolute-positioned virtual rows → **STOP** (see STOP conditions). Ship
  Steps 1–5 without virtualization rather than forking the scroller.

**Verify**: with 500 synthetic messages in a unit/integration test, assert the
number of mounted message bodies is bounded by window+overscan (if virtualizer
shipped); otherwise assert content-visibility class remains and history still
loads via infinite query only.

### Step 7: Full verification

**Verify**: `pnpm verify` → exit 0. Update `plans/README.md` status for 020 to
`DONE` (or leave for reviewer if dispatched).

## Test plan

| Area | Where | Cases |
|---|---|---|
| Cursor codec | `message-cursor.test.ts` | round-trip, reject bad, same-second rowid order |
| Router | `workspace.test.ts` | pages, limits, auth, malformed cursor, ensure without messages |
| Chat | `ai-chat.test.tsx` | load-earlier affordance, overlay + partial page, no regression on ack |
| Optional route | `project.$projectId.test.tsx` | session key isolation / invalidate on refresh — only if cheap |

Pattern exemplars: existing `workspace.test.ts` (caller mocks),
`ai-chat.test.tsx` (jsdom + scroller mock).

## Done criteria

- [ ] Initial history fetch returns ≤ 50 messages (server-enforced).
- [ ] `ensureWorkspace` no longer returns the full message history.
- [ ] Client uses `useInfiniteQuery` / `infiniteQueryOptions` for messages;
      **no** page-number UI anywhere.
- [ ] Every loaded message appears exactly once; order stable chronological
      including same-second rows (rowid).
- [ ] Older pages prepend without forcing scroll-to-bottom; MessageScroller
      prepend preservation remains enabled.
- [ ] Optimistic streaming + `chat-session-cache` acknowledgement still correct
      with only the newest page loaded.
- [ ] `onWorkspaceRefresh` invalidates the messages infinite query.
- [ ] `pnpm test -- src/lib/message-cursor.test.ts src/integrations/trpc/routers/workspace.test.ts src/components/ai-chat.test.tsx` passes.
- [ ] `pnpm verify` exits 0.
- [ ] No files outside Scope modified (`git status`).

## STOP conditions

Stop and report (do not improvise) if:

- Drift check shows "Current state" excerpts no longer match.
- D1/Drizzle cannot expose stable SQLite `rowid` for `messages` (table rebuilt
  as `WITHOUT ROWID`, or select rejects `rowid`). Do **not** substitute random
  message IDs; propose a monotonic sequence migration instead.
- Integrating `@tanstack/react-virtual` breaks MessageScroller
  registration/prepend restore. Ship cursor + infinite query without
  virtualization and report.
- Pre-existing local edits to `ai-chat.tsx` conflict and cannot be preserved.
- A step’s verification fails twice after a reasonable fix attempt.
- Fix appears to require out-of-scope files (Composer protocol, schema format
  change, session list infinite load).

## Maintenance notes

- Any `messages` table rebuild must preserve `(createdAt, rowid)` ordering or
  **version** the cursor (`v: 2`) and reject old cursors cleanly.
- Keep `limit` server-enforced; never trust the client.
- Future history search / jump-to-id should be a **separate** query, not a
  bypass that loads unbounded rows into this infinite query.
- Reviewers: confirm there is no page chrome; confirm ensureWorkspace payload
  no longer carries full history; confirm invalidate-on-refresh; confirm
  same-second ordering tests exist.
- Deferred: true windowing virtualization if Step 6 STOPs; session-list
  virtualization; message search.
