# Frontend architecture

## Goal

The frontend presents projects and conversations as a calm workspace while
keeping agent activity and Git state inspectable. It is a React 19 application
built with TanStack Start and file-based TanStack Router routes.

## Application shell and routes

`apps/web/src/router.tsx` constructs a router and a fresh Query Client context, enables
SSR query integration, and wraps the route tree in the tRPC/React Query provider.
`apps/web/src/routes/__root.tsx` owns document metadata, global CSS, the development-only
devtools import, and the application shell. `/sign-in` bypasses the shell; all
other pages render inside `AppShell` with the project sidebar, tooltip provider,
and toasts.

| Route | Purpose |
|---|---|
| `/` | Authentication-aware project dashboard and create-project entry point |
| `/sign-in` | GitHub OAuth sign-in and redirect for an existing session |
| `/installation/completed` | Notifies the opener that GitHub App installation completed, then closes |
| `/project/$projectId` | Parent project workspace and data orchestration |
| `/project/$projectId/` | New-conversation view for a project |
| `/project/$projectId/session/$sessionId` | Existing conversation view |
| `/api/auth/$` | better-auth request handler |
| `/api/trpc/$` | tRPC fetch adapter |
| `/api/agent/stream` | Cookie-authenticated agent SSE endpoint |
| `/api/agent/control` | Cookie-authenticated follow-up and Stop endpoint for the active PI agent session |
| `/api/agent/git` | JWT-authenticated callback used by sandbox agent tools |

`apps/web/src/routeTree.gen.ts` is generated from these files. Do not edit it directly.

## Browser data flow

The root context creates:

- one `QueryClient` with SuperJSON dehydration/hydration;
- one typed tRPC client using `httpBatchStreamLink` at `/api/trpc`; and
- a tRPC options proxy used by route components.

Components call `useQuery`, `useInfiniteQuery`, and `useMutation` with options
from `useTRPC()`. Server state belongs in React Query. Local view state stays in
components. The thinking-level preference is persisted in Zustand/local storage.
The preference store clamps unsupported persisted values to `off`, `high`, or
`max` when local storage rehydrates. Ditto uses one model,
`opencode/deepseek-v4-flash-free`; the composer does not query a provider
catalog or send a model field.

The project workspace route coordinates the main read model:

1. load owned project metadata;
2. page D1 messages for an explicit session URL immediately (ownership-checked,
   sandbox-independent);
3. when D1 status is `ready`, run `workspace.checkSandbox`; auto-call
   `workspace.provisionSandbox` only on `needs_restore`;
4. resolve the selected active session from the check/provision/retry payload;
5. reverse newest-first pages into an oldest-to-newest timeline;
6. toast only while this tab's provision work is in flight; keep inline status
   bars for check errors and restore failure; disable sandbox-backed controls
   until readiness succeeds; and
7. invalidate `projects.get` and the check query from readiness paths — never
   `projects.list`.

## Chat composition

`Chat` is the timeline coordinator. It combines server messages with a bounded
module-memory optimistic cache, normalizes stored assistant parts, renders empty
states and history loading, and owns the transient streaming overlay.

`Composer` owns one long-lived stream request:

1. clamp the persisted thinking preference to `off`, `high`, or `max`;
2. call `streamAgentRun` with the effective abstract thinking level (no model field);
3. use `meta` to bind server-generated session/message IDs;
4. append exact text-delta bytes and reduce PI tool events into ordered
   assistant parts without moving text across tool boundaries;
5. after `control_ready`, send follow-ups through the separate JSON control
   request without starting another stream;
6. commit each `turn_done` pair, promote the matching queued draft at
   `turn_start`, and commit the final pair at overall `done`; and
7. navigate a newly created conversation to its canonical session URL.

The composer action follows this matrix:

| State | Draft | Action |
|---|---|---|
| Idle | Empty | Submit disabled |
| Idle | Non-empty | Submit starts `/api/agent/stream` |
| Starting, before `control_ready` | Any | Disabled |
| Streaming/control-ready | Non-empty | Queue message through `/api/agent/control` |
| Streaming/control-ready | Empty or whitespace | Stop through `/api/agent/control` |
| Control pending or stopping | Any | Disabled until acknowledgement or terminal SSE |

Accepted follow-ups appear after the active assistant in FIFO order with a
visible and announced `Queued` status. This projection is transient, not a
browser scheduler or durable queue. The textarea is cleared only after a
follow-up acknowledgement and only if the user has not typed newer text.

The browser SSE parser is deliberately small and event-oriented. The server is
the authority for turn boundaries, terminal success, and durable message state.
The Stop control does not abort the SSE fetch: a browser abort or disconnect
stops local consumption but does not cancel the sandbox process.

### Thinking-level preference

The fixed model supports `off`, `high`, and `max`. The browser stores an abstract
preference with `high` as its default. An older persisted value such as
`medium` is clamped to `high` on rehydrate. The selector shows only those three
levels and is disabled while a run is active. The server remains the final
authority; browser clamping is only the request/UI convenience layer.

## Assistant message model

Assistant output is not modeled as only Markdown. It is an ordered list:

```ts
type AssistantMessagePart =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; tool: StreamToolCall };
```

This preserves interleaving between explanation and tool calls. Consecutive
non-edit tools are grouped into one collapsible activity block. Edit calls are
rendered independently through a lazily loaded diff component. Tool start/end
timestamps are assigned by the Worker so elapsed durations survive persistence
and reloads.

D1's `messages.tools` column stores the parts JSON for assistant messages. The
parser still accepts the legacy flat tool array and can reconstruct text from
`messages.content`. Payload depth, array size, and strings are bounded before
storage; if serialization fails, a minimal tool representation is retried.

## Optimistic message cache

`apps/web/src/lib/chat-session-cache.ts` bridges the interval between stream completion
and the next D1 message query. It is intentionally not a durable store:

- entries are keyed by workspace session;
- merges deduplicate by message ID;
- each session is capped at 100 entries;
- IDs confirmed by server pages are acknowledged and removed; and
- archiving a session clears its entries.

This prevents successful streamed responses from disappearing during route
navigation without creating a second source of truth.

## Sidebar and project management

`AppSidebar` loads the user's projects and active sessions from D1 only
(`projects.list`), marks the route's current project/session, and hosts search,
project creation, settings, session archive, and account actions. It does not
call `workspace.checkSandbox` / `workspace.provisionSandbox`, observe sandbox
stubs, or spin on D1 `provisioning` — cold-wake loading belongs to the project
workspace route.

- `NewProjectDialog` lists repositories authorized through GitHub, collects
  project environment variables, and starts provisioning.
- `ProjectSettingsDialog` renames or deletes a project and manages encrypted
  environment variable keys/values. Values are write-only in the UI.
- `SessionGitActions` renders the state machine returned by
  `sessionGit.gitStatus`; it does not independently infer Git workflow policy.
- `ChatNavbar` owns a right-sidebar tools trigger (`aria-pressed`) immediately
  right of Git actions. The trigger requires an active session id and a ready
  workspace; while `disabled`, Git actions are not mounted (they would query the
  sandbox). The sidebar trigger stays usable.
- `Chat` composes a controlled tools pane: desktop uses shadcn `ResizablePanelGroup`
  (default ~32% chat / ~68% tools, drag handle between) with padding so
  `rounded-lg` reads; mobile uses the existing Sheet primitive at near-full
  width. Closing hides the pane without stopping the preview server.
- `SessionToolsPane` is the `bg-muted` `rounded-lg` container with a header that
  navigates Preview / Terminal / Code. Terminal and Code stay disabled.
- `SessionPreviewPane` keeps only ephemeral component state (idle/starting/ready/
  stopping/failed). Start/Restart/Stop call `sessionPreview` mutations. The iframe
  uses `referrerpolicy="no-referrer"` and a restrictive sandbox. Capability URLs
  stay in component memory only — no toast, copy, query cache, or storage.
- `NavUser` handles user identity display and sign-out.

## UI layers

| Layer | Paths | Rule |
|---|---|---|
| Product components | `apps/web/src/components/*.tsx` | Know Ditto concepts and perform product orchestration |
| AI presentation | `apps/web/src/components/ai-elements` | Reusable model/task presentation pieces |
| UI primitives | `apps/web/src/components/ui` | Base UI/shadcn-derived controls without product data access |
| Styling | `apps/web/src/styles.css` | Tailwind v4 theme tokens, dark palette, typography, and global behavior |

Product components may compose primitives; primitives must not import project,
agent, database, or Git services. `cn` is the shared Tailwind class merger.

## Accessibility and loading behavior

The component layer uses semantic buttons/forms, dialog primitives, labels,
alerts, focus rings, keyboard submission, loading/disabled states, and screen
reader text for icon-only controls. Message history preserves scroll anchors
when older pages prepend. During sandbox cold wake, D1 history stays visible,
scrollable, and pageable while composer submit/model controls, empty-state
suggestions, Git actions, and tools/preview entry points are disabled. A
provision toast announces this tab's restore work; inline status bars
(`alert` + Retry) cover check errors and restore failure above the chat — not an
overlay on `ChatNavbar` and not a full-page error that replaces history. Warm
visits that are already connected stay silent. Expensive diagnostic UI is lazy-loaded,
and development devtools are dynamically imported so neither enters the
production path.

## Tests

Component tests use Vitest, jsdom, and Testing Library. They focus on product
coordination boundaries: streamed chat rendering, composer lifecycle, sidebar
archival/navigation, project creation, session Git workflow, and tool grouping.
Primitive UI files generally rely on their upstream behavior and product-level
coverage rather than one test file per wrapper.
