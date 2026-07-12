# Plan 017: Make the agent-run lifecycle transactional and testable

> **Executor instructions**: This is a high-risk extraction. Add
> characterization tests first, preserve event ordering and stored-format
> compatibility, and keep each commit green. Do not combine performance changes
> from plans 018/020 into this refactor.
>
> **Drift check (run first)**:
> `git diff --stat 5ad5e0c..HEAD -- src/routes/api.agent.stream.ts src/integrations/trpc/routers/workspace.ts src/lib/agent-stream-client.ts src/lib/agent-stream-client.test.ts src/db/schema.ts migrations docs/architecture/agent-harness.md`
> Plans 010/014/015 landed on HEAD `48d8923` (2026-07-12). Current-state
> excerpts below were rebased on that commit. Re-run the drift check against
> the `Reconciled at` SHA before implementing; if stream/session/backup APIs
> moved again, re-read those files and follow live behavior.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/010-sync-primary-before-session-worktree.md`,
  `plans/011-establish-verification-baseline.md`,
  `plans/014-version-and-deduplicate-backups.md`,
  `plans/015-enforce-session-archive-lifecycle.md`
- **Category**: bug, tests, tech-debt
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Reconciled at**: commit `48d8923`, 2026-07-12

## Why this matters

The ~450-line HTTP handler owns authentication, project hydration, session and
message creation, worktree preparation, runner execution, SSE reduction,
storage fallback, and backup finalization. It inserts a user row and blank
assistant before worktree setup, and unexpected stream failures do not persist
partial content or a terminal state. The same domain/storage logic lives in a
987-line module named `agent-stream-client`, while an obsolete tRPC mutation
duplicates an incomplete message-write path (covered only by its own unit
tests). This plan establishes a tested application service, terminal message
states, and clear transport/domain/storage boundaries without changing the
public SSE event names.

## Current state (as of `48d8923`)

- `api.agent.stream.ts` flow after auth/project/sandbox prep:
  - `resolveSessionForMessageWrite` (plan 015) at ~142–176 creates/reuses an
    owned active session.
  - Message insert batch at ~185–212 inserts user + empty assistant + recency
    **before** `ensureSessionWorktree` at ~227–269.
  - Worktree failure returns 409 but leaves the inserted messages (and a newly
    created empty session) in place — the phantom-message bug.
  - Success path persists content/tools at ~353–397 via
    `prepareAssistantMessageStorage` / minimal fallback; backup via
    `persistProjectSandboxBackup` (plan 014) at ~399–415.
  - Outer catch at ~425–436 emits `error`/`done` with empty content and does
    **not** update the assistant placeholder row.
- `src/routes/api.agent.stream.test.ts` already exists but only mirrors
  session-resolution/recency contracts from plan 015 — it does **not** invoke
  the real POST handler. Extend or replace it with full lifecycle DI tests;
  keep plan 015 session-authorization coverage (either via the service tests
  or retained thin shared-helper cases).
- `agent-stream-client.ts:45-181` = SSE parse/fetch transport;
  ~183–709 = event/domain/presentation reduction (including UI helpers used by
  `ai-chat.tsx`, `composer.tsx`, `edit-tool-diff.tsx`);
  ~710–987 = D1 storage codecs (`prepareAssistantMessageStorage`,
  `serializeAssistantPartsMinimalForStorage`, `parseStoredParts`, etc.).
- Worker imports reducers/codecs from that client-named module at
  `api.agent.stream.ts:10-19`.
- `workspace.ts` still defines `sendMessageSchema` (~18) and
  `workspace.sendMessage` (~210–305) which creates only a user message (no
  assistant, no runner). Product UI uses SSE only. The **only** non-definition
  references are unit tests in
  `src/integrations/trpc/routers/workspace.test.ts`
  (`describe("workspace.sendMessage session lifecycle")`). Delete the mutation
  **and** that describe block (keep `deleteSession` archival tests). This is
  not a STOP — tests are not product callers.
- `messages` table in `src/db/schema.ts:102-128` has no status column. Latest
  migration is `0008_chunky_sunset_bain.sql`; the new status migration will be
  `0009_*`.
- Preserve architecture vocabulary: workspace session, session git worktree,
  sandbox shell session, and PI agent session are different layers.
- Session writes must keep using `resolveSessionForMessageWrite` and
  `workspaceSessionRecencyUpdate` from `#/lib/workspace-session` (plan 015).
- Backup must keep using `persistProjectSandboxBackup` (plan 014) — do not
  reintroduce raw `createBackup` calls.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Generate migration | `pnpm db:generate` | one reviewed message-status migration |
| Focused tests | `pnpm test -- src/lib/agent-run-service.test.ts src/lib/agent-message-parts.test.ts src/lib/agent-message-storage.test.ts src/routes/api.agent.stream.test.ts` | all pass |
| Existing compatibility | `pnpm test -- src/lib/agent-stream-client.test.ts src/lib/agent-run.test.ts` | all pass |
| Full gate | `pnpm verify` | exit 0 |

## Scope

**In scope**:

- `src/routes/api.agent.stream.ts`, `src/routes/api.agent.stream.test.ts`
  (extend/replace the existing plan-015 helper mirror with real DI lifecycle tests)
- `src/lib/agent-run-service.ts`, test (create)
- `src/lib/agent-message-parts.ts`, test (create)
- `src/lib/agent-message-storage.ts`, test (create)
- `src/lib/agent-tool-presentation.ts` if needed for UI-only labels
- `src/lib/agent-stream-client.ts`, its existing test
- `src/integrations/trpc/routers/workspace.ts` and
  `src/integrations/trpc/routers/workspace.test.ts` (remove `sendMessage` + its
  describe block only)
- `src/db/schema.ts`, one generated migration (`0009_*`) and metadata
- import-only updates in components/modules that import moved exports
  (`src/components/ai-chat.tsx`, `composer.tsx`, `edit-tool-diff.tsx`,
  `src/lib/chat-session-cache.ts`, and any other importers of moved symbols)
- `docs/architecture/agent-harness.md`
- Do **not** update `plans/README.md` (reviewer maintains the index)

**Out of scope**:

- Changing SSE event names or the stored `tools` compatibility contract.
- Delta batching, virtualization, pagination, or bundle splitting.
- Retrying failed agent runs, cancellation, rate limits, or a run-ledger table.
- Changing worktree, model, backup-generation, or credential decisions.
- Re-auditing or rewriting plan 015 archive policy beyond what the service must
  reuse (`resolveSessionForMessageWrite`).

## Git workflow

- Branch: `advisor/017-agent-run-lifecycle`
- Suggested commits:
  1. `test(agent): characterize stream lifecycle`
  2. `refactor(agent): extract run service and codecs`
  3. `fix(chat): persist terminal assistant state`
- Do not push or open a PR unless instructed.

## Normative lifecycle

1. Authenticate/validate and load the owned ready project before constructing
   the SSE stream.
2. Resolve/create the D1 workspace session. If a newly created session cannot
   prepare its worktree, remove that empty session before returning 409. An
   existing session remains untouched on preparation failure.
3. Prepare the worktree before inserting messages.
4. Insert user plus assistant placeholder in one D1 batch; assistant starts
   with `status: "pending"`.
5. Emit `meta` only after both rows exist.
6. On success, persist final sanitized content/tools and `status: "complete"`
   before emitting successful `done`.
7. On runner/stream/storage failure, persist accumulated sanitized partial
   content plus `status: "failed"`; then emit `error` followed by failed `done`.
   Never claim success when terminal persistence failed.
8. Backup behavior remains exactly as established by plan 014.

## Steps

### Step 1: Add route-level characterization tests

Create a dependency-injected test seam around auth, DB, sandbox/worktree,
runner callbacks, and backup persistence. Invoke the real POST handler or its
thin request adapter. Lock down:

- unauthorized/malformed/project-not-ready responses;
- existing vs new session metadata;
- exact `meta -> agent/delta* -> error? -> done` ordering;
- normal storage, primary serialization failure with minimal fallback,
  fallback failure, worktree failure, runner throw after partial output, and
  backup metadata failure.

Tests should initially demonstrate the phantom/partial persistence failures;
do not alter expectations to match broken behavior after implementation.

**Verify**: focused route test -> characterization cases pass and explicit new
regressions fail for the intended reasons.

### Step 2: Split domain and storage modules without behavior changes

Move reducer/types (`AssistantMessagePart`, tool-event reduction, finalization,
text/tool projections) into `agent-message-parts.ts`. Move size limits,
serialization, minimal fallback, and legacy parsing into
`agent-message-storage.ts`. Move UI-only labels/formatters to
`agent-tool-presentation.ts`. Leave fetch/SSE parsing in
`agent-stream-client.ts`, re-exporting temporarily only if needed to keep
callers green during the sequence.

Move tests beside the owning module while preserving every legacy-format case.
The Worker must import only parts/storage modules, never browser transport or
presentation.

**Verify**: existing and new focused tests plus `pnpm typecheck` -> pass after
each move.

### Step 3: Add assistant terminal status

Add `messages.status` with values `pending | complete | failed`. Backfill
existing assistant messages as complete and user messages as complete; default
new rows to complete so unrelated inserts remain compatible. Generate and
inspect one migration. Update only selected row types/UI behavior needed to
render failed partial messages; do not add a run ledger.

**Verify**: migration generation is stable on rerun; storage/schema tests pass.

### Step 4: Extract `agent-run-service`

Move project/session/worktree/message/runner/backup orchestration into a server-
only application service with explicit injected dependencies for tests. It
should produce typed stream events or invoke a typed event sink; it must not
construct `Response`, parse cookies, or format SSE text. Implement the
normative lifecycle above.

Keep the route responsible only for auth, request validation, mapping service
errors to HTTP, encoding typed events with `encodeSseEvent`, and closing the
stream. Ensure outer error handling persists failed status/partial content.

**Verify**: service tests and real route adapter tests -> all cases pass.

### Step 5: Remove the obsolete tRPC write path

Confirm product code has no callers:
`rg -n "workspace\.sendMessage|sendMessageSchema|sendMessage:" src` — expect
only the mutation definition in `workspace.ts` and the
`workspace.sendMessage session lifecycle` tests in `workspace.test.ts`.
Delete the mutation, `sendMessageSchema`, and that entire describe block.
Keep `deleteSession` tests. SSE/service becomes the sole message-write path.

**Verify**: the grep returns no matches and `pnpm typecheck` passes.

### Step 6: Document and run full verification

Update the architecture runtime path with prepare-before-insert and terminal
message status. Keep plan 014 backup generation text intact.

**Verify**: `pnpm verify` -> exit 0.

## Test plan

- Full success with text and tools; persisted row complete before done.
- New/existing session worktree failure leaves no phantom message; new empty
  session is cleaned up.
- Runner failure after partial delta persists failed partial assistant.
- Both storage fallback levels and terminal DB failure.
- Backup failure remains represented without corrupting message status.
- Legacy stored tool/part JSON remains parseable.
- Cross-user/archived policy remains covered by plan 015 tests.

## Done criteria

- [x] Route is a thin HTTP/SSE adapter around a tested application service.
- [x] Worktree preparation precedes message insertion.
- [x] Every inserted assistant reaches complete or failed status.
- [x] Worker imports no browser transport/presentation module.
- [x] `workspace.sendMessage` is removed with no callers.
- [x] Migration, compatibility tests, and `pnpm verify` pass.

## Execution record

- **Verdict**: APPROVE (2026-07-12)
- **Branch**: `advisor/017-agent-run-lifecycle`
- **Worktree**: `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f557c-88fd-7930-b9ac-53d24c9639e1`
- **Commits**: `6622a93` extract modules; `576febe` transactional lifecycle + status
- **Reviewer notes**: Suggested commit split 2+3 combined so status lands with the service. Re-exports remain on `agent-stream-client` for compat; Worker/route do not import it.

## STOP conditions

- A live **product** caller of `workspace.sendMessage` exists (UI, other
  routers, non-test client code). Unit tests of the mutation itself are not a
  STOP — delete them with the mutation.
- Stored message schema is consumed by an undocumented external API that cannot
  accept an additive status field.
- Plan 014's backup API is no longer `persistProjectSandboxBackup` from
  `#/lib/project-sandbox` (or its contract changed incompatibly).
- Extraction changes SSE ordering or stored JSON despite compatibility tests.

## Maintenance notes

Future run states belong in the application service, not the route. Keep
storage codecs backward-compatible and UI formatting out of server imports.
Plan 018 should optimize only after these boundaries and tests are green.
