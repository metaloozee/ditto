# Plan 009: Scope workspace events to the selected session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f54e97a..HEAD -- src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/008-project-scoped-agent-run-foundation.md
- **Category**: bug
- **Planned at**: commit `f54e97a`, 2026-06-26

## Why this matters

Ditto v1 supports multiple logical sessions/conversations inside one project. The workspace API currently loads the selected session correctly, but then returns the latest 100 events for the entire project. Once the UI renders events, opening one conversation can show messages, tool output, or errors from another conversation in the same project. This plan makes the event log returned by `workspace.get` session-scoped so conversation views stay isolated while keeping the project-level mutating-run lock unchanged.

## Current state

Relevant files:

- `src/integrations/trpc/router.ts` — defines the `workspace.get`, `workspace.startRun`, `workspace.cancelRun`, and `workspace.answerRunQuestion` tRPC procedures.
- `src/lib/workspace-policy.ts` — shared workspace constants and small pure helpers.
- `src/lib/workspace-policy.test.ts` — existing Vitest coverage for workspace policy helpers; use it as the lightweight test pattern if you add a pure helper.

Product/documented constraints from `docs/repo-sandbox-coding-workspace-prd.md`:

- v1 uses one Cloudflare Sandbox per project.
- Sessions, chats, and branches are logical records inside the project workspace; they do not create new sandboxes in v1.
- A project can have multiple logical sessions or conversations.
- Only one mutating agent run may operate on a project at a time; mutation is serialized by a project-level lock.

Current `workspace.get` shape in `src/integrations/trpc/router.ts`:

```ts
// src/integrations/trpc/router.ts:293-315
const selectedSession = input.sessionId
  ? await db
      .select()
      .from(workspaceSessions)
      .where(
        and(
          eq(workspaceSessions.id, input.sessionId),
          eq(workspaceSessions.projectId, input.projectId),
          eq(workspaceSessions.userId, ctx.user.id),
        ),
      )
      .limit(1)
      .then(([session]) => {
        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found.",
          });
        }

        return session;
      })
  : null;
```

The bug is here: the event query ignores `selectedSession` / `input.sessionId` and returns project-wide events.

```ts
// src/integrations/trpc/router.ts:333-338
const events = await db
  .select()
  .from(agentRunEvents)
  .where(eq(agentRunEvents.projectId, input.projectId))
  .orderBy(desc(agentRunEvents.createdAt), desc(agentRunEvents.id))
  .limit(100);
```

Existing helper/test style:

```ts
// src/lib/workspace-policy.ts
export function isActiveAgentRunStatus(status: string): boolean {
  return status === "pending" || status === "running" || status === "needs_input";
}
```

```ts
// src/lib/workspace-policy.test.ts
it("identifies only active agent run statuses", () => {
  expect(isActiveAgentRunStatus("pending")).toBe(true);
});
```

Repo conventions to match:

- TypeScript is strict; prefer typed helpers over `any`.
- tRPC errors use `TRPCError` with concise user-facing messages.
- Drizzle queries use `and(...)`, `eq(...)`, `desc(...)`, and `.limit(...)` as seen in `src/integrations/trpc/router.ts`.
- Keep changes small and colocated. This is a bug fix, not an event-log redesign.
- Formatting/import order is enforced by Biome.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no output |
| Unit tests | `pnpm test` | exit 0, all tests pass |
| Scoped Biome check | `pnpm exec biome check src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts` | exit 0, no errors |
| Whitespace | `git diff --check` | exit 0, no output |

Note: at plan-writing time, the repo-wide `pnpm check` fails because other uncommitted files from plan 008 need formatting/import-order cleanup. Do not expand this plan just to fix unrelated formatting. Run the scoped Biome check above for the files you touch.

## Scope

**In scope** (the only files you should modify):

- `src/integrations/trpc/router.ts`
- `src/lib/workspace-policy.ts` — only if you add a pure helper for event-scope policy.
- `src/lib/workspace-policy.test.ts` — only if you add that helper.
- `plans/README.md` — only to update this plan's status row when done.

**Out of scope** (do NOT touch, even though related):

- UI event rendering in `src/components/ai-chat.tsx` or `src/components/composer.tsx`.
- Database schema or migrations. The current `agent_run_events.sessionId` column already exists.
- Project-level mutating-run lock behavior (`projects.activeAgentRunId`). It intentionally remains project-scoped.
- Adding pagination, streaming, or a full event viewer.
- Fixing unrelated Biome errors in other uncommitted files.

## Git workflow

- Branch convention if you create one: `advisor/009-scope-workspace-events-to-session`.
- Commit message style from recent history is Conventional Commits, e.g. `fix(routes): remove dead code`. Use `fix(workspace): scope events to sessions` if committing.
- Do not push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make `workspace.get` return only selected-session events

In `src/integrations/trpc/router.ts`, replace the project-wide event query in `workspace.get` with session-scoped behavior.

Required behavior:

1. If `input.sessionId` was provided and `selectedSession` was found, return only events whose `projectId` is `input.projectId` **and** whose `sessionId` is `selectedSession.id`.
2. If `input.sessionId` was not provided, return an empty event list (`[]`) for now. The project-level route is a draft/new-chat surface, not a specific conversation, so it must not show a mixed project event log.
3. Keep ordering and limit unchanged for session events: newest 100 by `createdAt`/`id`, then reverse before returning so the caller receives chronological order.
4. Keep `activeRun` lookup project-scoped; that is the intentional mutating-run lock signal.

Target code shape:

```ts
const events = selectedSession
  ? await db
      .select()
      .from(agentRunEvents)
      .where(
        and(
          eq(agentRunEvents.projectId, input.projectId),
          eq(agentRunEvents.sessionId, selectedSession.id),
        ),
      )
      .orderBy(desc(agentRunEvents.createdAt), desc(agentRunEvents.id))
      .limit(100)
  : [];
```

Then keep the return shape as:

```ts
return {
  project: toProjectResponse(project),
  sessions,
  selectedSession,
  activeRun,
  events: events.reverse(),
};
```

If TypeScript complains about `events.reverse()` due to union inference, give `events` an explicit type from `agentRunEvents.$inferSelect[]` or split the empty array into a typed constant. Do not use `any`.

**Verify**: `pnpm exec tsc --noEmit` → exit 0, no output.

### Step 2: Add or adjust a lightweight regression test if feasible without database harness work

There is no current tRPC/database integration test harness. Do not create a large D1/tRPC test harness in this small bug-fix plan.

If the Step 1 code can stay simple without a helper, skip this step and rely on typecheck plus code review. If you introduce a pure helper in `src/lib/workspace-policy.ts` to decide whether an event query should run for a selected session, add focused tests in `src/lib/workspace-policy.test.ts` following the existing `describe("workspace policy", ...)` style.

Acceptable helper scope example:

```ts
export function shouldLoadSessionEvents(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId);
}
```

Only add this if it makes the router clearer. Do not add a trivial helper solely to create a test.

**Verify**: `pnpm test` → exit 0, all tests pass.

### Step 3: Run scoped formatting/lint checks on touched files

Run Biome only on in-scope files because unrelated uncommitted files currently fail repo-wide formatting.

**Verify**: `pnpm exec biome check src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts` → exit 0, no errors.

If you did not touch `src/lib/workspace-policy.ts` or `src/lib/workspace-policy.test.ts`, it is still fine to include them in the command; they already exist.

### Step 4: Final safety checks

Run the full cheap verification gates that are currently passing or meaningful for this repo.

**Verify**:

- `pnpm exec tsc --noEmit` → exit 0, no output.
- `pnpm test` → exit 0, all tests pass.
- `git diff --check` → exit 0, no output.

Do not require repo-wide `pnpm check` for this plan unless unrelated formatting errors have already been fixed by another plan/commit.

## Test plan

- Primary regression is covered by code review and typecheck: `workspace.get` must not call `agentRunEvents` with only `projectId`.
- If a pure helper is added in `src/lib/workspace-policy.ts`, add tests in `src/lib/workspace-policy.test.ts` for:
  - session id present → events should load.
  - `undefined` or `null` session id → events should not load.
- Do not build a new database integration harness in this plan. That is larger than the bug fix and should be a separate verification-baseline plan if needed.

## Done criteria

All must hold:

- [ ] In `src/integrations/trpc/router.ts`, the `agentRunEvents` query inside `workspace.get` filters by both `agentRunEvents.projectId` and `agentRunEvents.sessionId`.
- [ ] `workspace.get` returns `events: []` when no selected session exists.
- [ ] No code path in `workspace.get` fetches project-wide events for conversation rendering.
- [ ] Project-level `activeRun` lookup remains project-scoped.
- [ ] `pnpm exec tsc --noEmit` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm exec biome check src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] No files outside the in-scope list are modified, except generated route files if an unrelated route generator has already changed them before this plan starts.
- [ ] `plans/README.md` row for plan 009 is updated from TODO to DONE when complete.

## STOP conditions

Stop and report back without improvising if:

- The `workspace.get` code no longer matches the excerpts in this plan.
- The live code has already implemented session-scoped event filtering; in that case, report that this plan is obsolete instead of changing code.
- The fix appears to require a schema or migration change.
- You find callers that intentionally depend on project-wide `workspace.get.events`; report the caller path and stop.
- Typecheck fails because of unrelated files outside this plan's scope.
- A scoped Biome check fails on files you did not touch and cannot be fixed without expanding scope.

## Maintenance notes

- When event rendering is added to the chat UI, reviewers should verify that the UI reads `workspace.get.events` only in the context of `selectedSession`.
- If a future project-level activity feed is added, implement it as a separate API field/procedure (for example `workspace.getProjectActivity`) instead of weakening this conversation-scoped `events` field.
- If read-only runs are later allowed concurrently, keep the event log scoped by session and use a separate explicit filter for cross-session/project activity.
