# Plan 003: Stream agent events in chat UI + architecture docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 61532eb..HEAD -- src/components/composer.tsx src/components/ai-chat.tsx src/routes/project.* README.md docs/ plans/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Prerequisite**: Plan 002 DONE (SSE contract at `POST /api/agent/stream`).
> If that route is missing, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-agent-run-orchestration.md
- **Category**: direction
- **Planned at**: commit `61532eb`, 2026-07-09
- **Executed**: 2026-07-09 — commits `08d7821` + `ad11a6f` on branch
  `advisor/003-agent-stream-ui` (worktree:
  `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f472e-9cb0-7f43-9325-6178cfbc00b0`;
  model `grok-composer-2.5-fast`)

## Why this matters

The chat UI already renders D1 history and a composer, but it never streams
model output or tool activity. PRODUCT.md requires AI actions to be
**inspectable**. This plan connects the composer to the SSE agent run, shows
streaming assistant text (and lightweight tool status), and documents
session-layer architecture plus the **deferred** concurrency hazard so future
agents do not invent a second persistence model.

## Current state

### Composer (`src/components/composer.tsx`)

- Calls `trpc.workspace.sendMessage.mutationOptions()`
- On success, invalidates project queries and navigates to
  `/project/$projectId/session/$sessionId` when `createdSession`
- No EventSource / fetch stream

### Chat (`src/components/ai-chat.tsx`)

- Renders static `messages` from props
- `AssistantMarkdown` supports `mode: "static" | "streaming"` via Streamdown
  but only `"static"` is used today
- Empty state says messages are stored in D1 (still true)

### Routes

- `project.$projectId.session.$sessionId.tsx` loads workspace view / messages
  via tRPC (read path can stay)

### SSE contract from plan 002 (do not invent a different one)

`POST /api/agent/stream` with JSON body
`{ projectId, sessionId?, message, model }` and cookie auth.

Events: `meta`, `agent`, `delta`, `error`, `done` (see plan 002 table).

### Conventions

- React 19 function components, `#/` imports
- Toasts via `sonner` (`toast.error`)
- Preferences: `useUserPreferencesStore` for model
- tRPC React: `useTRPC` + React Query invalidation
- Minimal comments; match existing component density
- PRODUCT.md: calm, inspectable AI — show tool names, not noisy debug dumps

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `pnpm test` | exit 0 |
| Check | `pnpm check` | exit 0 |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 |
| Doctor (optional) | `pnpm doctor` | advisory only |

## Suggested executor toolkit

- Skills: `baseline-ui`, `emil-design-eng` only if you add new chrome — prefer
  reusing existing Bubble/Message components
- Streamdown already in `ai-chat.tsx` for markdown streaming

## Scope

**In scope**:

- `src/components/composer.tsx` — call SSE stream instead of stub mutation
  flow (or mutation-for-session-create + stream; see steps)
- `src/components/ai-chat.tsx` — accept streaming assistant state; use
  Streamdown `mode="streaming"` while active
- `src/lib/agent-stream-client.ts` (create) — fetch SSE parser helper
- `src/lib/agent-stream-client.test.ts` (create) — pure parse tests
- `docs/architecture/agent-harness.md` (create) — architecture + concurrency
- `README.md` — link to the architecture doc
- `plans/README.md` status row

**Out of scope**:

- Worker/SSE server implementation (plan 002)
- Dockerfile / runner (plan 001)
- Implementing file locks / agent mutex
- Redesigning the whole chat layout
- Voice input / mic button behavior
- Git branch UI (`master` label) changes

## Git workflow

- Branch: `advisor/003-agent-stream-ui`
- Commits: e.g. `feat(chat): stream sandbox agent over SSE`
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Client SSE helper

Create `src/lib/agent-stream-client.ts`:

```ts
export type AgentStreamHandlers = {
  onMeta?: (data: MetaPayload) => void;
  onDelta?: (delta: string) => void;
  onAgent?: (event: unknown) => void;
  onError?: (message: string) => void;
  onDone?: (data: DonePayload) => void;
};

export async function streamAgentRun(
  input: {
    projectId: string;
    sessionId?: string;
    message: string;
    model: string;
  },
  handlers: AgentStreamHandlers,
  options?: { signal?: AbortSignal },
): Promise<void>
```

Implementation notes:

- `fetch("/api/agent/stream", { method: "POST", headers: {
  "Content-Type": "application/json", Accept: "text/event-stream" },
  body: JSON.stringify(input), credentials: "include", signal })`
- Read `response.body` with `ReadableStream` + `TextDecoder`
- Parse SSE frames (`event:` / `data:` / blank line). Do **not** use
  `EventSource` (GET-only).
- JSON.parse `data`; dispatch by event name
- Non-OK HTTP: throw Error with body text or status
- Export a pure `parseSseChunk(buffer: string): { frames: { event: string; data: string }[]; rest: string }` for unit tests

**Verify**: `pnpm test -- src/lib/agent-stream-client.test.ts` → pass

### Step 2: Composer uses the stream

Update `src/components/composer.tsx`:

1. Keep model selection UI as-is.
2. On submit:
   - If no `projectId` or `disabledReason`, return (unchanged).
   - Set local `isStreaming` / disable submit while active.
   - Call `streamAgentRun({ projectId, sessionId: sessionId ?? undefined, message: text, model }, handlers)`.
3. Handlers:
   - `onMeta`: if `createdSession` or new `sessionId`, `navigate` to session
     route (same as today). Store `assistantMessageId` in component state or
     lift via callback props if needed.
   - `onDelta`: need a way to show streaming text — see Step 3.
   - `onError`: `toast.error(message)`; clear streaming state.
   - `onDone`: clear streaming state; `refreshWorkspace()` invalidations
     (same queries as today).
4. Remove dependency on assistant stub from `sendMessage`. If plan 002 left
   `sendMessage` as user-message-only, **do not call it** from composer —
   stream route owns session creation + user message insert. If plan 002
   still requires a prepare mutation, call that first then stream with
   returned `sessionId` — match whatever 002 actually shipped (read the
   route + router before coding).

Pass streaming props into `Chat` if composer is sibling under the same parent:
inspect `project.$projectId.session.$sessionId.tsx` and
`project.$projectId.index.tsx` for how `Composer` / `Chat` are composed.
Prefer the **smallest** lift:

- Option A: parent holds `streamingText` / `toolStatus` state; composer
  callbacks set it; Chat renders it.
- Option B: Chat owns the stream call (composer only provides input) —
  only if composition makes A awkward.

**Verify**: `pnpm exec tsc --noEmit` → exit 0

### Step 3: Chat renders streaming assistant bubble

Update `src/components/ai-chat.tsx`:

- Extend props:

```ts
type ChatProps = {
  projectId?: string;
  sessionId?: string | null;
  disabledReason?: string;
  messages?: ChatMessage[];
  streaming?: {
    active: boolean;
    text: string;
    toolName?: string | null;
  };
};
```

- When `streaming?.active`, append a synthetic assistant row (or sticky footer
  bubble) using `AssistantMarkdown mode="streaming" text={streaming.text}`.
- If `toolName` set, show a single muted line above/beside the bubble, e.g.
  `Running tool: edit` — parse from `onAgent` when `event.type ===
  "tool_execution_start"` (field `toolName`). Keep this minimal (no full tool
  arg dumps — secrets risk + noise).
- Empty state copy: update to mention live agent runs when project is ready
  (one sentence; no marketing fluff).

**Verify**: `pnpm check` → exit 0

### Step 4: Wire parent route(s)

Update the project session route(s) so composer streaming state reaches Chat.
Read current files:

- `src/routes/project.$projectId.session.$sessionId.tsx`
- `src/routes/project.$projectId.index.tsx`
- `src/routes/project.$projectId.tsx` if layout owns chat

Keep data loading via existing tRPC workspace queries. After `onDone`,
invalidate so persisted messages replace the streaming bubble.

**Verify**: `pnpm exec tsc --noEmit` → exit 0

### Step 5: Architecture documentation

Create `docs/architecture/agent-harness.md` with these sections (complete
sentences, plain language; match PRODUCT vocabulary: project, sandbox,
workspace session):

1. **Goal** — AI edits run inside the project sandbox; Worker relays events.
2. **Persistence** — R2 backups via `createBackup`/`restoreBackup` (not bucket
   mounts on `/workspace`). Cite that bootstrap + post-run snapshot keep
   files durable across sleep. FUSE restore is ephemeral; re-restore on wake
   is handled by `ensureProjectSandbox`.
3. **Three session layers** — table from plan 002 (D1 conversation, sandbox
   shell session, PI jsonl under `/workspace/.ditto/sessions/`).
4. **Runtime path** — numbered list of the verified workflow (user message →
   SSE → harness → backup).
5. **Transport** — Sandbox DO ↔ container uses RPC transport (`transport:
   "rpc"`) so multi-step runs do not burn HTTP subrequest limits.
6. **Concurrency (deferred)** — Explicitly state:
   - Sandbox sessions share one filesystem and process space.
   - Two agent runs (two shell sessions) can race on the same files and
     corrupt the repo.
   - **Not implemented yet**: application-level mutex / lease / queue per
     `projectId`.
   - Future work should serialize mutating agent runs per project (e.g. D1
     lease row or single-flight in a Durable Object) before enabling
     multi-tab parallel agents.
7. **Security notes** — prompts via job files; secret redaction; API keys only
   as session env; never log `OPENCODE_API_KEY`.

Link from `README.md` under Notes:

```md
- Agent harness architecture: `docs/architecture/agent-harness.md`
```

**Verify**: file exists; `pnpm check` still exit 0

### Step 6: Final verification

Run full gates:

```bash
pnpm test
pnpm check
pnpm exec tsc --noEmit
```

Manually (if `pnpm dev` available): send a message in a ready project and
confirm streaming tokens appear; after completion, reload shows D1 message.
If no API key / sandbox in env, document that manual check was skipped.

## Test plan

- `src/lib/agent-stream-client.test.ts`:
  - partial SSE chunks reassemble
  - dispatches `delta` and `done`
  - ignores malformed data lines without throwing the whole parse loop
- No mandatory React component tests unless the repo already patterns them
  heavily (it does not).

## Done criteria

- [ ] Composer no longer depends on stub assistant text from tRPC
- [ ] Submitting a message opens `POST /api/agent/stream` with credentials
- [ ] Streaming assistant text renders via Streamdown `mode="streaming"`
- [ ] Tool start events can surface a minimal status line
- [ ] On `done`, queries invalidate and persisted messages load
- [ ] `docs/architecture/agent-harness.md` exists and includes the concurrency
      deferral section
- [ ] `README.md` links the architecture doc
- [ ] `pnpm test`, `pnpm check`, `pnpm exec tsc --noEmit` all exit 0
- [ ] No Worker harness redesign outside UI/docs scope
- [ ] `plans/README.md` status for 003 set to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002 SSE path or event names differ from this plan’s contract — adapt
  to **actual** 002 code after reading it; if events are missing entirely,
  STOP.
- Chat/composer composition requires large router refactors beyond the two
  project routes.
- Auth cookies are not sent to `/api/agent/stream` (credentials mode) and
  better-auth requires a different header — inspect `createAuth` usage and
  fix only the client fetch; if auth is impossible from browser fetch, STOP.
- Product owners require WebSocket client transport instead of SSE — out of
  scope; report.

## Maintenance notes

- When adding tool-call UI cards later, consume `agent` events; keep secret
  redaction on any tool args displayed.
- Concurrency locking should land as its own plan before multi-agent UX.
- Reviewers: ensure streaming bubble does not duplicate the final D1 message
  after invalidation (clear `streaming.active` on done before or as messages
  refresh).
