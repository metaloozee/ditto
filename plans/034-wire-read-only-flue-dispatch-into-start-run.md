# Plan 034: Wire Read-Only Flue Dispatch Into `workspace.startRun`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report; do
> not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat df4631b..HEAD -- src/integrations/trpc/routers/workspace.ts src/routes/api.workspace.session.$sessionId.socket.ts src/routes/project.$projectId.tsx src/lib/flue-run-bridge.ts src/lib/project-coordinator.ts src/lib/project-run-projection.ts src/lib/workspace-session-broker.ts src/db/schema.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> git diff --stat -- src/integrations/trpc/routers/workspace.ts src/routes/api.workspace.session.$sessionId.socket.ts src/routes/project.$projectId.tsx src/lib/flue-run-bridge.ts src/lib/project-coordinator.ts src/lib/project-run-projection.ts src/lib/workspace-session-broker.ts src/db/schema.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the excerpts
> below against the live code before proceeding. If an excerpt no longer matches
> and the difference is not merely formatting, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: `plans/031-flue-dispatch-and-stream-adapter.md`, `plans/032-read-only-flue-project-coder-agent.md`, `plans/033-flue-run-bridge-durable-object.md`
- **Category**: migration / architecture
- **Planned at**: commit `df4631b`, 2026-07-03

## Why this matters

After the mapper, adapter, read-only Flue agent, and bridge Durable Object exist,
the product API needs a narrow integration slice. This plan wires only read-only
runs (`isMutating: false`) through the project coordinator and Flue bridge.
Mutating runs continue using the existing legacy broker path until Phase 3 adds
lease-fenced mutating Flue tools.

## Current state

Relevant files:

- `src/integrations/trpc/routers/workspace.ts` - authenticated product boundary for workspace load, `startRun`, `cancelRun`, and answers.
- `src/routes/api.workspace.session.$sessionId.socket.ts` - current authenticated socket proxy always forwards to `WorkspaceSessionBroker`.
- `src/routes/project.$projectId.tsx` - passes `activeRunId` to the chat and refetches when a socket is disconnected.
- `src/lib/flue-run-bridge.ts` - should exist from plan 033.
- `src/lib/project-coordinator.ts` - project-scoped admission and terminal authority.
- `src/lib/project-run-projection.ts` - D1 run projection helper may need to understand stream-coordinate-only Flue pointers.
- `src/lib/workspace-session-broker.ts` - legacy mutating path remains in production for mutating requests.

Current `startRun` schema already accepts a read-only mode flag, but the UI sends
mutating requests by default:

```ts
// src/integrations/trpc/routers/workspace.ts:217-227
startRun: protectedProcedure
	.input(
		z.object({
			projectId: z.string().min(1),
			sessionId: z.string().min(1).optional(),
			message: z.string().trim().min(1),
			modelSpecifier: z.string().refine(isProjectCoderModelSpecifier, {
				message: "Unknown project coder model.",
			}),
			isMutating: z.boolean().default(true),
		}),
	)
```

Current `startRun` locks only mutating runs in D1 and always posts to the legacy
session broker:

```ts
// src/integrations/trpc/routers/workspace.ts:391-426
if (input.isMutating) {
	const [lockedProject] = await db
		.update(projects)
		.set({ activeAgentRunId: runId, activeAgentRunStartedAt: sql`(unixepoch())`, updatedAt: sql`(unixepoch())` })
		.where(and(eq(projects.id, input.projectId), eq(projects.userId, ctx.user.id), isNull(projects.activeAgentRunId)))
		.returning();

	if (!lockedProject) {
		await db.insert(agentRunEvents).values({ type: "lock_rejected", ... });
		throw new TRPCError({ code: "CONFLICT", message: "Another agent run is already editing this project." });
	}

	ownsProjectLock = true;
}

// src/integrations/trpc/routers/workspace.ts:453-475
async function startBroker() {
	await postWorkspaceSessionBroker({
		env: ctx.env,
		sessionId,
		path: "/start",
		body: { sessionId, userId: ctx.user.id, projectId: input.projectId, sandboxId: project.sandboxId, runId, message: input.message, modelSpecifier: input.modelSpecifier, isMutating: input.isMutating },
	});
}
```

Current workspace load only exposes active mutating runs, so read-only Flue runs
would not show as active without a small query change:

```ts
// src/integrations/trpc/routers/workspace.ts:169-185
const activeRun = ensuredProject.activeAgentRunId
	? await db
			.select()
			.from(agentRuns)
			.where(and(eq(agentRuns.id, ensuredProject.activeAgentRunId), eq(agentRuns.userId, ctx.user.id)))
			.limit(1)
			.then(([run]) =>
				run?.isMutating && isActiveAgentRunStatus(run.status) ? run : null,
			)
	: null;
```

Current socket route always proxies to the legacy broker:

```ts
// src/routes/api.workspace.session.$sessionId.socket.ts:39-46
const brokerNamespace = env.WorkspaceSessionBroker as DurableObjectNamespace;
const brokerId = brokerNamespace.idFromName(sessionId);
const broker = brokerNamespace.get(brokerId) as {
	fetch(request: Request): Promise<Response>;
};

return await broker.fetch(request);
```

The PRD target flow requires authorization and D1 metadata before coordinator
admission, and Flue only after admission:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:535-549
1. Browser sends a chat message to TanStack Start through tRPC or a server function.
2. TanStack Start authenticates the user.
3. TanStack Start validates project access and GitHub authorization.
4. TanStack Start creates or loads the product session.
5. TanStack Start creates a product run record in D1.
6. TanStack Start writes user message metadata / projection to D1.
7. TanStack Start asks the project coordinator for admission.
8. Coordinator grants read-only admission or mutation lease, queues, or rejects.
9. On admission, coordinator starts or resumes the Flue agent operation.
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prerequisite tests | `pnpm test -- src/lib/flue-dispatch-adapter.test.ts src/lib/flue-run-bridge.test.ts` | exits 0 |
| Full tests | `pnpm test` | exits 0 |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85` |
| Flue build | `pnpm flue:build` | exits 0 with only known generated-wrangler migration warning |
| Whitespace | `git diff --check` | exits 0 with no output |

Do not deploy or run live LLM prompts unless explicitly approved.

## Scope

**In scope**:

- `src/integrations/trpc/routers/workspace.ts`
- `src/routes/api.workspace.session.$sessionId.socket.ts`
- `src/lib/project-run-projection.ts` and `src/lib/project-run-projection.test.ts` only if stream-coordinate Flue pointers need projection support
- `plans/README.md` only to update this plan's status row if instructed

**Out of scope**:

- UI mode toggle for read-only vs mutating.
- Mutating Flue path; mutating runs must continue using `WorkspaceSessionBroker` in this plan.
- Deleting legacy Pi runner, runner protocol, sandbox runner, or broker.
- D1 schema/migrations.
- Changing `.flue/agents/project-coder.ts`, Flue adapter, or bridge implementation except for small compile fixes discovered during integration.
- GitHub export actions, snapshots, diff generation, write tools, lease-fenced mutation.

## Git workflow

- Branch: `advisor/034-wire-readonly-flue-start-run` if you create a branch.
- Commit message style: Conventional Commits, e.g. `feat(flue): route read-only runs through bridge`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Verify prerequisites landed

Confirm these files exist:

- `src/lib/flue-dispatch-adapter.ts`
- `.flue/agents/project-coder.ts` with read-only tools from plan 032
- `src/lib/flue-run-bridge.ts`

Run:

```bash
pnpm test -- src/lib/flue-dispatch-adapter.test.ts src/lib/flue-run-bridge.test.ts
pnpm flue:build
```

Expected result: tests pass and Flue build exits 0 with only the known warning. If
any prerequisite is missing, STOP and execute the dependency plan first.

### Step 2: Add small helpers for coordinator and bridge POSTs

In `src/integrations/trpc/routers/workspace.ts`, add helper functions near
`postWorkspaceSessionBroker`.

Add `postProjectCoordinator`:

```ts
async function postProjectCoordinator(options: {
	env: Env;
	projectId: string;
	path: "/admit" | "/terminal";
	body: Record<string, unknown>;
}): Promise<Response>
```

It should address `env.ProjectCoordinator.idFromName(projectId)` and return the
raw `Response` so `startRun` can distinguish 202 from 409.

Add `postFlueRunBridge`:

```ts
async function postFlueRunBridge(options: {
	env: Env;
	sessionId: string;
	path: "/start" | "/abort";
	body: Record<string, unknown>;
}): Promise<void>
```

It should address `env.FlueRunBridge.idFromName(sessionId)`, mirror
`postWorkspaceSessionBroker` error compaction behavior, and throw `TRPCError` on
non-ok responses.

Do not change existing broker helper behavior.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0 after Step 3 if
new binding types are available from plan 033.

### Step 3: Expose active read-only Flue runs from `workspace.get`

Change the `activeRun` computation in `workspace.get` so it still prioritizes the
project's mutating `activeAgentRunId`, but can also return a selected session's
active read-only Flue run.

Target behavior:

- If `ensuredProject.activeAgentRunId` points to an active mutating run owned by the user, return it exactly as today.
- Else, if `selectedSession` is present, query the latest `agent_runs` row for that session/user where `isMutating === false`, `status` is active (`pending`, `running`, or `needs_input`), and `flueAgentName` is not null.
- Return that read-only Flue run as `activeRun` so the existing chat receives `activeRunId`, opens the socket, and blocks duplicate submits while the read-only run is active.

Do not expose another user's run. Keep all filters server-side.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 4: Branch `startRun` dispatch by mutating mode

Keep all existing session creation, run creation, user message event insertion,
sandbox readiness, and mutating D1 lock logic unless the branch requires a small
extraction.

After the D1 batch that creates the session/run/message succeeds:

- If `input.isMutating === true`, call the existing `startBroker()` unchanged.
- If `input.isMutating === false`, call a new `startReadOnlyFlueRun()`.

`startReadOnlyFlueRun()` behavior:

1. Require `project.sandboxId` or throw `PRECONDITION_FAILED`.
2. Ask `ProjectCoordinator /admit` with `{ projectId, runId, sessionId, userId: ctx.user.id, mode: "read_only" }`.
3. If coordinator returns non-ok, insert `lock_rejected` and `done`/`failed` events for the accepted run, update `agent_runs.status` to `failed`, and throw `TRPCError` with `CONFLICT` for 409 or `PRECONDITION_FAILED` otherwise.
4. Call `FlueRunBridge /start` with `{ sessionId, userId, projectId, sandboxId, runId, message, modelSpecifier, isMutating: false }`.
5. If bridge start fails after admission, mark the run failed, insert `error` and `done` events, and notify `ProjectCoordinator /terminal` with `{ projectId, runId, status: "failed" }`.

Do not set `projects.activeAgentRunId` for read-only runs. That D1 field remains
the mutating-lock projection until Phase 3 changes the lock model.

Keep the public `startRun` input and return shape unchanged.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 5: Route cancellation to the Flue bridge for read-only Flue runs

In `cancelRun`, keep the durable D1 cancellation update first, as today.

Then branch best-effort abort routing:

- If `run.flueAgentName` is non-null or `run.isMutating === false`, call `postFlueRunBridge({ sessionId: run.sessionId, path: "/abort", body: { runId } })`.
- Otherwise call the existing `postWorkspaceSessionBroker({ path: "/abort" })`.

Keep abort best-effort: swallow bridge/broker errors after D1 has marked the run
canceled. The bridge must gate late events by D1 canceled status from plan 033.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 6: Proxy session sockets to the bridge for Flue-backed runs

Edit `src/routes/api.workspace.session.$sessionId.socket.ts`.

After the existing auth/session ownership check, query the latest run for that
session/user:

- order by `agentRuns.createdAt` descending and limit 1;
- select `flueAgentName`, `isMutating`, and `status`.

Proxy to `env.FlueRunBridge.idFromName(sessionId)` when the latest run is
Flue-backed (`flueAgentName` non-null) or read-only (`isMutating === false`) and
not obviously stale. Otherwise proxy to `WorkspaceSessionBroker` as today.

Do not change the browser socket URL. The existing hook should continue to call:

```ts
/api/workspace/session/${sessionId}/socket
```

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm lint
```

Expected result: both pass with only the known lint warnings.

### Step 7: Adjust Flue pointer projection only if needed

Plan 031's direct Flue HTTP route returns stream coordinates and may not return a
public submission id. If any current code needs `buildRunProjection(...)` to show
a Flue pointer for read-only runs, update `src/lib/project-run-projection.ts` so
it treats agent name + instance id + stream offset as a usable Flue pointer even
when `flueSubmissionId` is null.

Preserve existing behavior for populated submission ids. Update
`src/lib/project-run-projection.test.ts` with a focused case:

- a run with `flueAgentName`, `flueAgentInstanceId`, `flueStreamOffset`, and null `flueSubmissionId` still gets a non-null `flue` projection.

If no code consumes this projection during Phase 2, skip this step to minimize
scope.

**Verify**:

```bash
pnpm test -- src/lib/project-run-projection.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected result: tests/typecheck pass.

### Step 8: Run the full baseline

Run:

```bash
pnpm flue:build
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm lint
git diff --check
```

Expected result: Flue build exits 0 with only the known generated-wrangler DO
migration warning; tests pass; typecheck exits 0; lint exits 0 with only the two
known warnings; whitespace check emits no output.

## Test plan

- This plan can rely mostly on typecheck plus existing pure tests because the changed code is tRPC/route glue around tested bridge/adapter pieces.
- Add or update `project-run-projection.test.ts` only if Step 7 changes projection logic.
- Do not add a broad browser automation harness.
- Optional manual smoke after all verification passes and the operator approves credentials/provider spend:
  1. Start local dev with `pnpm dev`.
  2. Use an authenticated project with a ready sandbox.
  3. Submit a read-only run through a direct tRPC call or temporary local test harness with `isMutating: false`.
  4. Confirm D1 run rows include Flue agent fields/stream offset, chat streams assistant deltas, terminal state persists, and mutating submits still use the legacy path.

## Done criteria

All must hold:

- [ ] Mutating `workspace.startRun` behavior remains on `WorkspaceSessionBroker` and existing D1 mutating lock projection.
- [ ] Read-only `workspace.startRun` creates product session/run/message rows, asks `ProjectCoordinator /admit`, then starts `FlueRunBridge /start`.
- [ ] Read-only runs do not set `projects.activeAgentRunId`.
- [ ] `workspace.get` exposes active read-only Flue runs for the selected session.
- [ ] Session socket route proxies Flue-backed/read-only sessions to `FlueRunBridge` without changing the browser URL.
- [ ] `cancelRun` sends best-effort abort to `FlueRunBridge` for Flue/read-only runs and to `WorkspaceSessionBroker` for legacy mutating runs.
- [ ] Public tRPC input/return shape remains unchanged.
- [ ] `pnpm flue:build` exits 0 with only the known warning.
- [ ] `pnpm test`, `pnpm exec tsc --noEmit --pretty false`, `pnpm lint`, and `git diff --check` pass.
- [ ] No files outside the in-scope list are modified.

## STOP conditions

Stop and report back if:

- Plans 031, 032, or 033 have not landed.
- The current `startRun` structure has drifted enough that this plan would require a broad rewrite instead of a narrow branch.
- Correct read-only Flue wiring requires changing the public tRPC input or return shape.
- You need to expose a UI read-only/mutating toggle to complete this plan.
- You need to remove or replace the mutating legacy broker path.
- You need a D1 schema/migration change.
- Flue bridge start cannot be made best-effort fail-safe after coordinator admission.
- A verification command fails twice after a reasonable fix attempt.
- You need to touch a file listed out of scope.

## Maintenance notes

- This is a foundation slice, not the final agent loop. Users still submit mutating runs through the existing UI path unless a caller explicitly sends `isMutating: false`.
- Phase 3 should move mutating work to Flue only after lease-fenced write tools exist.
- Reviewers should check that a failed bridge start always settles the D1 run and coordinator read-only admission. Stuck read-only coordinator entries are the main reliability risk in this plan.
