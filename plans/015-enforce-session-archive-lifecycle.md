# Plan 015: Make session archival consistent across server and client state

> **Executor instructions**: This plan deliberately chooses honest archival,
> not physical deletion. Do not silently broaden it into worktree/D1 erasure.
> Run active-vs-archived authorization tests before changing UI copy.
>
> **Drift check (run first)**:
> `git diff --stat 5ad5e0c..HEAD -- src/integrations/trpc/routers/workspace.ts src/integrations/trpc/routers/projects.ts src/routes/api.agent.stream.ts src/components/app-sidebar.tsx src/components/ai-chat.tsx src/lib/chat-session-cache.ts src/lib/workspace-policy.ts`
> Also run `git diff -- src/components/ai-chat.tsx`; this file had a user-owned
> uncommitted change when the plan was written. STOP if it is still dirty and
> your execution environment does not isolate your edits.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/011-establish-verification-baseline.md`
- **Category**: bug, tech-debt
- **Planned at**: commit `5ad5e0c`, 2026-07-11

## Why this matters

The UI promises permanent deletion, but the server only sets `status` to
`archived`; archived IDs can still receive new agent messages. Conversation
activity also fails to refresh session recency, and optimistic messages remain
in a global browser map after server acknowledgement or archival. This plan
adopts explicit archival semantics, rejects archived sessions at every active
boundary, updates recency atomically with messages, and gives the cache a
bounded lifecycle.

## Current state

- `app-sidebar.tsx:291-307` labels the action Delete and promises permanent
  loss.
- `workspace.ts:289-329` only writes `status: "archived"`.
- `workspace.ts:333-353` and `api.agent.stream.ts:56-74` load a session without
  requiring `status === "active"`; session-git already demonstrates the
  correct predicate at `session-git.ts:77-88`.
- Sidebar sessions order by `workspaceSessions.updatedAt` at
  `projects.ts:415-424`, but message inserts at `api.agent.stream.ts:191-217`
  do not update it.
- `chat-session-cache.ts:16-55` has a module-level Map and no acknowledgement,
  eviction, or session cleanup operation.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `pnpm test -- src/lib/chat-session-cache.test.ts src/integrations/trpc/routers/workspace.test.ts src/routes/api.agent.stream.test.ts` | all pass |
| Component tests | `pnpm test -- src/components/app-sidebar.test.tsx src/components/ai-chat.test.tsx` | all pass |
| Full gate | `pnpm verify` | exit 0 |

## Scope

**In scope**:

- `src/integrations/trpc/routers/workspace.ts`, focused test (create)
- `src/routes/api.agent.stream.ts`, focused route/service test (create)
- `src/integrations/trpc/routers/projects.ts` only if response naming changes
- `src/components/app-sidebar.tsx`, test (create)
- `src/components/ai-chat.tsx`, test (create)
- `src/lib/chat-session-cache.ts`, test (create)
- `plans/README.md` status only

**Out of scope**:

- Permanent D1/message/worktree deletion, remote branch deletion, or backup
  compaction.
- An archived-session browser/restore feature.
- Changing active session branch/worktree behavior.
- Adding collaboration or shared ownership.

## Git workflow

- Branch: `advisor/015-session-archive-lifecycle`
- Suggested commit: `fix(chat): enforce session archive lifecycle`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Centralize active-session lookup

Add one narrow server helper for owned active sessions using the exact
`id + projectId + userId + status=active` predicate. Use it in the SSE route,
workspace operations, and session-git/agent-git where practical without
changing their public error shapes. Explicitly named archival operations may
load active or archived rows as required; ordinary chat/git operations may not.

If a caller supplies an archived session ID, return NOT_FOUND/404. Do not
silently create a replacement session when an explicit ID was supplied.

**Verify**: request/caller tests prove owned active success, archived rejection,
cross-user rejection, and absent explicit ID creating a new session.

### Step 2: Make UI language honest

Rename Delete Session to Archive Session and replace the permanent-loss copy
with clear copy that it disappears from the active sidebar and cannot receive
new messages. Keep the existing destructive confirmation styling only if the
design system uses it for reversible removal; otherwise use the normal action
variant. Do not add Restore in this plan.

**Verify**: component test clicks Archive, sees the new copy, invokes the
mutation once, and removes/invalidates the active entry.

### Step 3: Update recency atomically with message creation

In both active message-write paths that remain after plan 017, update
`workspaceSessions.updatedAt` using the D1 clock in the same `db.batch` as the
message rows. If plan 017 has removed `workspace.sendMessage`, update only the
SSE/service path. Test an older session becoming the newest after a message.

**Verify**: workspace/route tests pass and assert the timestamp update shares
the batch.

### Step 4: Add cache acknowledgement and cleanup

Extend `chat-session-cache.ts` with explicit operations to:

- remove messages acknowledged by server IDs;
- clear one session on archival;
- clear all cached data on logout/project boundary if the caller can observe
  that lifecycle;
- enforce a conservative per-session cap as a final memory bound.

Call acknowledgement after refreshed server messages arrive, not during the
optimistic window. Call session cleanup after successful archive.

**Verify**: cache tests cover pending retention, acknowledgement removal,
archive cleanup, cap behavior, and session isolation.

### Step 5: Run full verification

**Verify**: `pnpm verify` -> exit 0.

## Test plan

- Active, archived, missing, and other-user session access for SSE/workspace.
- Explicit archived ID never creates a new session.
- Archive mutation/UI language and query invalidation.
- Recency update in the message batch.
- Cache pending race, acknowledgement, archive, and cap.
- Follow Testing Library user-visible assertions; do not inspect React refs.

## Done criteria

- [x] No UI promises permanent deletion.
- [x] Archived sessions cannot run agents or git actions.
- [x] Explicit invalid/archived session IDs do not create replacements.
- [x] New messages update recency atomically.
- [x] Acknowledged/archived optimistic messages are evicted.
- [x] Focused tests and `pnpm verify` pass.

**Executed**: commit `39b756b` on `advisor/015-session-archive-lifecycle` (worktree), reviewed 2026-07-12.

## STOP conditions

- Product intent requires irreversible deletion rather than archival; that
  needs a separate design covering active runs, worktree cleanup, and backup
  durability.
- The pre-existing `ai-chat.tsx` working-tree change overlaps cache lifecycle
  code and cannot be preserved cleanly.
- Centralizing lookup changes a documented public tRPC error contract.

## Maintenance notes

If a Restore/Trash feature is added, it must be the only path that loads
archived sessions and must decide whether to recreate missing worktrees.
Permanent deletion remains a separate feature, not a rename of this mutation.

