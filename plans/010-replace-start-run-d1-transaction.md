# Plan 010: Replace startRun's D1 transaction with batched writes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat b9e3b83..HEAD -- docs/d1-start-run-atomic-write-fix-prd.md src/integrations/trpc/router.ts src/db/schema.ts src/db/index.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/008-project-scoped-agent-run-foundation.md and plans/009-scope-workspace-events-to-session.md, both already DONE at plan-writing time
- **Category**: bug
- **Planned at**: commit `b9e3b83`, 2026-06-26

## Why this matters

`workspace.startRun` currently uses Drizzle's `db.transaction(...)` against Cloudflare D1. Drizzle's D1 transaction implementation emits explicit SQL `begin`, `commit`, and `rollback` statements, which D1 rejects in this runtime. The immediate product impact is that sending a composer message can fail before the app creates the session, run, or initial events.

The fix must remove the unsupported transaction primitive without weakening Ditto's v1 workspace rule: many logical sessions may exist in one project, but only one mutating agent run may edit a project at a time. Related initial rows still need an all-or-nothing write path, so use D1-compatible `db.batch(...)` for the session/run/event write set and keep the project lock as a separate conditional update.

## Current state

Relevant files:

- `docs/d1-start-run-atomic-write-fix-prd.md` - PRD for this focused D1 reliability fix.
- `docs/repo-sandbox-coding-workspace-prd.md` - product decisions for v1 project/session/run semantics.
- `src/integrations/trpc/router.ts` - contains `workspace.startRun`, `workspace.get`, `workspace.cancelRun`, and related tRPC procedures.
- `src/db/schema.ts` - Drizzle schema for `projects`, `workspace_sessions`, `agent_runs`, and `agent_run_events`; no schema change is needed for this plan.
- `src/db/index.ts` - creates the Drizzle D1 database object.
- `src/lib/workspace-policy.ts` and `src/lib/workspace-policy.test.ts` - small pure workspace helpers and their current Vitest test pattern.

PRD requirements to honor:

```md
// docs/d1-start-run-atomic-write-fix-prd.md:9-11
Replace the unsupported D1 `db.transaction(...)` usage in `workspace.startRun` with a D1-compatible flow that preserves atomic creation of run-related records, keeps the single-editor lock semantics, and eliminates the local `Failed query: begin params:` failure.

This change is a focused backend reliability fix for the existing project/session/run model. It does not redesign multi-agent coordination beyond the current rule that many agents may read concurrently but only one mutating agent may edit a project at a time.
```

```md
// docs/d1-start-run-atomic-write-fix-prd.md:51-60
Use a two-phase flow inside `workspace.startRun`:

1. Acquire the mutating-agent lock with a single conditional project update.
2. Create the dependent records with Drizzle `db.batch(...)` so the run/session/event write set is atomic on D1.

This separates concurrency control from atomic row creation.

The lock step remains outside the batch because it is about who is allowed to become the single editor. The batch step handles the part where related rows should either all exist together or not exist at all.
```

```md
// docs/d1-start-run-atomic-write-fix-prd.md:62-86
### 7.1 Transaction removal
- `workspace.startRun` must no longer call `db.transaction(...)`.

### 7.2 Locking model
- Mutating runs must still enforce only one active editor per project.
- Read-only concurrency must remain possible for future non-mutating runs.
- Lock release on error must only clear the lock when the same run still owns it.

### 7.3 Atomic creation path
- New session path must atomically create:
  - `workspace_sessions`
  - `agent_runs`
  - initial `agent_run_events`
- Existing session path must atomically create:
  - `agent_runs`
  - any required session timestamp update
  - initial `agent_run_events`
- If one statement in the batch fails, none of the batched rows should persist.

### 7.4 Error handling
- Users must not see raw `Failed query: begin params:` messages.
- Conflicts for concurrent mutating runs must continue to surface as a stable app-level conflict error.
- Unexpected failures should surface as a stable start-run failure.
```

Product constraints from the broader workspace PRD:

```md
// docs/repo-sandbox-coding-workspace-prd.md:160-168
1. v1 uses one Cloudflare Sandbox per project.
2. Sessions, chats, and branches are logical records inside the project workspace; they do not create new sandboxes in v1.
3. A project can have multiple logical sessions or conversations. A durable session is created only when the first user message for that conversation is accepted; sidebar plus and new-chat draft actions must not create empty sessions.
4. Only one mutating agent run may operate on a project at a time. Multiple read-only runs or sessions may exist later, but mutation is serialized by a project-level lock.
5. The agent has broad permission inside its sandbox. Generic per-tool approvals are not part of v1.
6. The agent can pause with a `needs_input` event when it needs clarification; that is a question/resume mechanism, not a permission approval mechanism. The eventual answer UX should be a separate focused question-answer UI, not the normal composer starting another run.
7. Outside-world effects, including GitHub push or PR, production deploy, or sandbox destruction, remain explicit user actions and are out of scope for the foundation work.
8. Local project memory should live under `/workspace/.ditto/` in the sandbox in a future plan; database run events are the durable product event log for now.
```

Current D1 database setup:

```ts
// src/db/index.ts:1-7
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export function createDb(env: Pick<Env, "DB">) {
	return drizzle(env.DB, { schema });
}
```

Current schema fields used by this plan:

```ts
// src/db/schema.ts:33-63
export const projects = sqliteTable(
	"projects",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		description: text("description"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		githubRepo: text("githubRepo"),
		githubInstallationId: integer("githubInstallationId"),
		sandboxId: text("sandboxId"),
		activeAgentRunId: text("activeAgentRunId"),
		activeAgentRunStartedAt: integer("activeAgentRunStartedAt", {
			mode: "timestamp",
		}),
		status: text("status", {
			enum: ["provisioning", "ready", "failed"],
		})
			.notNull()
			.default("provisioning"),
		envVars: text("envVars"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [index("projects_userId_idx").on(table.userId)],
);
```

```ts
// src/db/schema.ts:65-156
export const workspaceSessions = sqliteTable(
	"workspace_sessions",
	{
		id: text("id").primaryKey(),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title"),
		branchName: text("branchName"),
		baseCommitSha: text("baseCommitSha"),
		workspacePath: text("workspacePath").notNull().default(WORKSPACE_PATH),
		memoryPath: text("memoryPath").notNull().default(PROJECT_MEMORY_PATH),
		status: text("status", { enum: [...WORKSPACE_SESSION_STATUSES] })
			.notNull()
			.default("active"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("workspace_sessions_projectId_idx").on(table.projectId),
		index("workspace_sessions_userId_idx").on(table.userId),
	],
);

export const agentRuns = sqliteTable(
	"agent_runs",
	{
		id: text("id").primaryKey(),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sessionId: text("sessionId")
			.notNull()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: text("status", { enum: [...AGENT_RUN_STATUSES] })
			.notNull()
			.default("pending"),
		isMutating: integer("isMutating", { mode: "boolean" })
			.notNull()
			.default(true),
		userMessage: text("userMessage").notNull(),
		question: text("question"),
		recommendedAnswer: text("recommendedAnswer"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		finishedAt: integer("finishedAt", { mode: "timestamp" }),
	},
	(table) => [
		index("agent_runs_projectId_idx").on(table.projectId),
		index("agent_runs_sessionId_idx").on(table.sessionId),
		index("agent_runs_userId_idx").on(table.userId),
		index("agent_runs_status_idx").on(table.status),
	],
);

export const agentRunEvents = sqliteTable(
	"agent_run_events",
	{
		id: integer("id", { mode: "number" }).primaryKey({
			autoIncrement: true,
		}),
		runId: text("runId"),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sessionId: text("sessionId"),
		type: text("type", { enum: [...AGENT_RUN_EVENT_TYPES] }).notNull(),
		payload: text("payload").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
```

Current `workspace.startRun` begins a D1 transaction and performs all reads and writes inside it:

```ts
// src/integrations/trpc/router.ts:366-380
startRun: protectedProcedure
	.input(
		z.object({
			projectId: z.string().min(1),
			sessionId: z.string().min(1).optional(),
			message: z.string().trim().min(1),
			isMutating: z.boolean().default(true),
		}),
	)
	.mutation(async ({ ctx, input }) => {
		const db = createDb(ctx.env);
		const runId = nanoid();

		return await db.transaction(async (tx) => {
```

Current lock and stale-lock behavior to preserve:

```ts
// src/integrations/trpc/router.ts:430-503
if (input.isMutating && project.activeAgentRunId) {
	const previousRunId = project.activeAgentRunId;
	const [existingRun] = await tx
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.id, previousRunId))
		.limit(1);

	if (
		!existingRun ||
		!existingRun.isMutating ||
		!isActiveAgentRunStatus(existingRun.status)
	) {
		await tx
			.update(projects)
			.set({
				activeAgentRunId: null,
				activeAgentRunStartedAt: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(
				and(
					eq(projects.id, input.projectId),
					eq(projects.activeAgentRunId, previousRunId),
				),
			);

		await tx.insert(agentRunEvents).values({
			runId: existingRun ? previousRunId : null,
			projectId: input.projectId,
			sessionId: existingRun?.sessionId ?? null,
			type: "error",
			payload: createAgentRunEventPayload({
				reason: "stale_lock_cleared",
				previousRunId,
			}),
		});
	}
}

if (input.isMutating) {
	const [lockedProject] = await tx
		.update(projects)
		.set({
			activeAgentRunId: runId,
			activeAgentRunStartedAt: sql`(unixepoch())`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, input.projectId),
				eq(projects.userId, ctx.user.id),
				isNull(projects.activeAgentRunId),
			),
		)
		.returning();

	if (!lockedProject) {
		await tx.insert(agentRunEvents).values({
			runId: null,
			projectId: input.projectId,
			sessionId: input.sessionId ?? null,
			type: "lock_rejected",
			payload: createAgentRunEventPayload({
				reason: "active_run_exists",
			}),
		});

		throw new TRPCError({
			code: "CONFLICT",
			message: "Another agent run is already editing this project.",
		});
	}
}
```

Current initial row creation that must move into D1-compatible `db.batch(...)`:

```ts
// src/integrations/trpc/router.ts:505-565
const createdSession = !selectedSession;
if (!selectedSession) {
	const [session] = await tx
		.insert(workspaceSessions)
		.values({
			id: nanoid(),
			projectId: input.projectId,
			userId: ctx.user.id,
			title: makeSessionTitleFromMessage(input.message),
			workspacePath: WORKSPACE_PATH,
			memoryPath: PROJECT_MEMORY_PATH,
			status: "active",
		})
		.returning();

	selectedSession = session;
}

const [run] = await tx
	.insert(agentRuns)
	.values({
		id: runId,
		projectId: input.projectId,
		sessionId: selectedSession.id,
		userId: ctx.user.id,
		status: "running",
		isMutating: input.isMutating,
		userMessage: input.message,
	})
	.returning();

await tx
	.update(workspaceSessions)
	.set({ updatedAt: sql`(unixepoch())` })
	.where(eq(workspaceSessions.id, selectedSession.id));

await tx.insert(agentRunEvents).values([
	{
		runId,
		projectId: input.projectId,
		sessionId: selectedSession.id,
		type: "message",
		payload: createAgentRunEventPayload({
			role: "user",
			text: input.message,
		}),
	},
	{
		runId,
		projectId: input.projectId,
		sessionId: selectedSession.id,
		type: "message",
		payload: createAgentRunEventPayload({
			role: "system",
			text: "Agent execution is queued. The LLM/tool runner will be connected in a later plan.",
		}),
	},
]);

return { run, session: selectedSession, createdSession };
```

Local Drizzle package evidence for why this fails and what to use instead:

```ts
// node_modules/.../drizzle-orm/d1/driver.d.ts:7-10
export declare class DrizzleD1Database<TSchema extends Record<string, unknown> = Record<string, never>> extends BaseSQLiteDatabase<'async', D1Result, TSchema> {
    static readonly [entityKind]: string;
    batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>;
}
```

```js
// node_modules/.../drizzle-orm/d1/session.js:35-52
async batch(queries) {
  const preparedQueries = [];
  const builtQueries = [];
  for (const query of queries) {
    const preparedQuery = query._prepare();
    const builtQuery = preparedQuery.getQuery();
    preparedQueries.push(preparedQuery);
    if (builtQuery.params.length > 0) {
      builtQueries.push(preparedQuery.stmt.bind(...builtQuery.params));
    } else {
      const builtQuery2 = preparedQuery.getQuery();
      builtQueries.push(
        this.client.prepare(builtQuery2.sql).bind(...builtQuery2.params)
      );
    }
  }
  const batchResults = await this.client.batch(builtQueries);
  return batchResults.map((result, i) => preparedQueries[i].mapResult(result, true));
}
```

```js
// node_modules/.../drizzle-orm/d1/session.js:63-72
async transaction(transaction, config) {
  const tx = new D1Transaction("async", this.dialect, this, this.schema);
  await this.run(sql.raw(`begin${config?.behavior ? " " + config.behavior : ""}`));
  try {
    const result = await transaction(tx);
    await this.run(sql`commit`);
    return result;
  } catch (err) {
    await this.run(sql`rollback`);
    throw err;
  }
}
```

Cloudflare's D1 worker API docs for `batch()` state that D1 executes batch statements sequentially and non-concurrently, and that if a statement fails the batch aborts or rolls back the sequence. Use that property only for the predeclared session/run/event SQL write set. Do not treat `db.batch(...)` as a general transaction around arbitrary JavaScript logic.

Existing helper and test style:

```ts
// src/lib/workspace-policy.ts:34-38
export function isActiveAgentRunStatus(status: string): boolean {
	return (
		status === "pending" || status === "running" || status === "needs_input"
	);
}
```

```ts
// src/lib/workspace-policy.test.ts:10-18
describe("workspace policy", () => {
	it("identifies only active agent run statuses", () => {
		expect(isActiveAgentRunStatus("pending")).toBe(true);
		expect(isActiveAgentRunStatus("running")).toBe(true);
		expect(isActiveAgentRunStatus("needs_input")).toBe(true);
		expect(isActiveAgentRunStatus("completed")).toBe(false);
		expect(isActiveAgentRunStatus("failed")).toBe(false);
		expect(isActiveAgentRunStatus("canceled")).toBe(false);
	});
```

Repo conventions to match:

- Package manager: `pnpm` 11, from `package.json` and `pnpm-lock.yaml`.
- TypeScript is strict and no-emit: `tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noEmit`.
- Imports use the `#/` alias for source modules, for example `import { createDb } from "#/db";` in `src/integrations/trpc/router.ts`.
- tRPC protected procedures throw `TRPCError` with concise user-facing messages.
- Drizzle SQLite/D1 queries in `router.ts` use `and`, `eq`, `isNull`, `desc`, and `sql` from `drizzle-orm`.
- Biome uses tabs and double quotes. Do not run `pnpm format` or `pnpm fix` unless the operator explicitly asks, because they mutate broad file sets.
- Recent commits use short Conventional Commit subjects, for example `fix(router): workspace.get bug`, `feat(sandbox): workspace sessions`, and `feat(router): new router for workspace related work`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Optional install if dependencies are missing | `pnpm install` | exit 0; no `package.json` or `pnpm-lock.yaml` changes |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0, no output |
| Unit tests | `pnpm test` | exit 0; at plan-writing time this is 1 test file and 5 tests passing |
| Repo lint | `pnpm lint` | exit 0; the pre-existing `src/components/ui/sidebar.tsx:85` `noDocumentCookie` warning may remain, but no new warnings in touched files |
| Scoped Biome check | `pnpm exec biome check src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts` | exit 0, no errors |
| Whitespace | `git diff --check` | exit 0, no output |
| Transaction removal check | `rg "db\.transaction" src/integrations/trpc/router.ts` | exit 1 with no matches |
| Batch usage check | `rg "db\.batch" src/integrations/trpc/router.ts` | exits 0 and shows the `workspace.startRun` batch call(s) |

Baseline verified at plan-writing time on commit `b9e3b83`:

- `pnpm exec tsc --noEmit --pretty false` passed with no output.
- `pnpm test` passed: 1 test file, 5 tests.
- `git diff --check` passed with no output.
- `pnpm lint` exited 0 with one existing warning in `src/components/ui/sidebar.tsx:85`; do not touch that file for this plan.

## Suggested executor toolkit

- If available, use a Cloudflare Workers/D1 best-practices skill before editing the D1 code path.
- Keep the Cloudflare D1 `batch()` docs handy: `https://developers.cloudflare.com/d1/worker-api/d1-database/#batch`.
- Do not use a React/frontend skill for this plan; UI changes are out of scope.

## Scope

**In scope** (the only files you should modify):

- `src/integrations/trpc/router.ts` - required; rewrite only `workspace.startRun` and any tiny local helper needed immediately around it.
- `src/lib/workspace-policy.ts` - optional; only if you extract a pure helper that makes lock/error policy clearer.
- `src/lib/workspace-policy.test.ts` - optional; only if you change `src/lib/workspace-policy.ts`.
- `plans/README.md` - update only this plan's status row when execution completes.

**Read-only context** (read as needed, do not modify):

- `docs/d1-start-run-atomic-write-fix-prd.md`
- `docs/repo-sandbox-coding-workspace-prd.md`
- `src/db/schema.ts`
- `src/db/index.ts`

**Out of scope** (do NOT touch, even though related):

- `src/db/schema.ts`, `migrations/`, or `drizzle.config.ts` - no schema change or migration is needed.
- `src/db/index.ts` - `createDb` already returns the D1 Drizzle database with `batch` available.
- UI files such as `src/components/composer.tsx`, `src/components/ai-chat.tsx`, and `src/routes/project.$projectId.tsx`.
- Durable Objects, Sandbox SDK code, workspace worktrees, multi-editor coordination, stale-lock age/heartbeat logic, and GitHub push/PR behavior.
- A broad D1/tRPC integration test harness. The PRD explicitly says not to build one in this fix.
- Package/dependency changes.
- Generated router files or broad formatter output.

## Git workflow

- Branch convention if you create one: `advisor/010-d1-start-run-batch`.
- Commit message style: Conventional Commit. If committing, use `fix(workspace): replace D1 transaction in startRun`.
- Do not push or open a PR unless the operator instructed it.
- Preserve any pre-existing untracked files, including `docs/d1-start-run-atomic-write-fix-prd.md`; do not delete or stage unrelated work.

## Steps

### Step 1: Remove the unsupported transaction wrapper without changing the public procedure shape

In `src/integrations/trpc/router.ts`, edit only the `workspace.startRun` mutation.

Replace the `return await db.transaction(async (tx) => { ... })` wrapper with direct D1 operations on `db`. Keep the same input schema and return shape: `{ run, session, createdSession }`.

Required structure:

- Keep `const db = createDb(ctx.env);`.
- Keep `const runId = nanoid();`.
- Wrap the procedure body in `try/catch`.
- In the final catch, rethrow existing `TRPCError` instances unchanged, and convert all other errors to:

```ts
throw new TRPCError({
	code: "INTERNAL_SERVER_ERROR",
	message: "Failed to start agent run.",
});
```

Do not include the original database error message in the user-facing TRPC error. This is what prevents `Failed query: begin params:` or other raw Drizzle/D1 details from leaking to the composer.

Target control-flow shape:

```ts
.mutation(async ({ ctx, input }) => {
	const db = createDb(ctx.env);
	const runId = nanoid();

	try {
		// project lookup, session lookup, stale-lock cleanup, lock acquisition,
		// and batched row creation go here.
	} catch (error) {
		if (error instanceof TRPCError) {
			throw error;
		}

		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to start agent run.",
		});
	}
})
```

Move the existing project lookup, `assertProjectReady(project)`, optional session lookup, and archived-session check into that `try` block. Replace `tx` with `db` for those reads.

**Verify**: If you perform Step 1 as a pure mechanical `tx` to `db` replacement that leaves the old sequential writes in place, run `pnpm exec tsc --noEmit --pretty false` -> exit 0, no output. If you edit Steps 1-5 as one unit, defer this verification until Step 5; do not leave any remaining `tx` references.

### Step 2: Preserve current stale-lock cleanup before acquiring a new mutating lock

Still inside `workspace.startRun`, keep the existing stale-lock semantics for mutating runs:

- If `input.isMutating` is false, skip all project-lock cleanup and acquisition logic.
- If `input.isMutating` is true and `project.activeAgentRunId` is set, load that previous run by id.
- If the previous run is missing, non-mutating, or not active according to `isActiveAgentRunStatus(existingRun.status)`, clear the project lock with an ownership check.
- Preserve the existing diagnostic `agent_run_events` row with `type: "error"` and `reason: "stale_lock_cleared"`.

Use `db`, not `tx`. Run the stale-lock clear and diagnostic event insert in a small `db.batch([...])` so they remain all-or-nothing like they were inside the old transaction. The diagnostic event is not best-effort in this cleanup path: if D1 cannot write the event, the stale-lock clear should not silently succeed.

Required stale cleanup batch shape:

```ts
await db.batch([
	db
		.update(projects)
		.set({
			activeAgentRunId: null,
			activeAgentRunStartedAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, input.projectId),
				eq(projects.userId, ctx.user.id),
				eq(projects.activeAgentRunId, previousRunId),
			),
		),
	db.insert(agentRunEvents).values({
		runId: existingRun ? previousRunId : null,
		projectId: input.projectId,
		sessionId: existingRun?.sessionId ?? null,
		type: "error",
		payload: createAgentRunEventPayload({
			reason: "stale_lock_cleared",
			previousRunId,
		}),
	}),
]);
```

Do not add time-based stale-lock reclaim, heartbeat logic, or lease expiration in this plan. The only stale behavior to preserve is the current status-based cleanup.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0, no output.

### Step 3: Pre-generate session/run/event values before acquiring any new lock

After project/session validation and stale-lock cleanup, but before acquiring a new mutating lock, compute the complete initial write set in JavaScript. This avoids a post-lock/pre-batch failure window: once this request owns the project lock, the next potentially failing persistence operation should be the inner `db.batch(...)` that has lock cleanup around it.

This is also the key D1 constraint: batch can make a known SQL statement list atomic, but it is not a general transaction around branching JavaScript.

Required values:

- `const createdSession = !selectedSession;`
- `const sessionId = selectedSession?.id ?? nanoid();`
- `const runValues = { id: runId, projectId: input.projectId, sessionId, userId: ctx.user.id, status: "running" as const, isMutating: input.isMutating, userMessage: input.message };`
- `const eventValues = [...]` containing the same user and queued system message events currently inserted at `src/integrations/trpc/router.ts:541-562`, but with `sessionId` instead of `selectedSession.id`.

If `createdSession` is true, prepare the new session values with the current defaults:

```ts
{
	id: sessionId,
	projectId: input.projectId,
	userId: ctx.user.id,
	title: makeSessionTitleFromMessage(input.message),
	workspacePath: WORKSPACE_PATH,
	memoryPath: PROJECT_MEMORY_PATH,
	status: "active",
}
```

Do not call `nanoid()` inside a batched statement. Generate ids before the batch so every dependent statement can reference the same ids.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0, no output after Step 5 is in place.

### Step 4: Acquire the mutating lock with one conditional project update

Before the `try` block or at the top of the mutation body, add a local boolean such as `let ownsProjectLock = false;` so batch-failure cleanup can tell whether this request acquired the lock.

For mutating runs, acquire the project lock using one atomic conditional `UPDATE ... WHERE activeAgentRunId IS NULL ... RETURNING` statement. This replaces the transaction's lock step and is the concurrency boundary for "one active mutating editor per project."

Required lock acquisition shape:

```ts
if (input.isMutating) {
	const [lockedProject] = await db
		.update(projects)
		.set({
			activeAgentRunId: runId,
			activeAgentRunStartedAt: sql`(unixepoch())`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, input.projectId),
				eq(projects.userId, ctx.user.id),
				isNull(projects.activeAgentRunId),
			),
		)
		.returning();

	if (!lockedProject) {
		await db.insert(agentRunEvents).values({
			runId: null,
			projectId: input.projectId,
			sessionId: input.sessionId ?? null,
			type: "lock_rejected",
			payload: createAgentRunEventPayload({
				reason: "active_run_exists",
			}),
		});

		throw new TRPCError({
			code: "CONFLICT",
			message: "Another agent run is already editing this project.",
		});
	}

	ownsProjectLock = true;
}
```

Do not lock read-only runs. Future read-only runs must still be able to create session/run/event rows without setting `projects.activeAgentRunId`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exit 0, no output after Step 5 is in place; if the only error before Step 5 is the unused `ownsProjectLock`, proceed to Step 5.

### Step 5: Create the initial rows with D1-compatible `db.batch(...)` and clean up the lock on batch failure

Replace the separate session/run/session-update/event writes with branch-specific `db.batch(...)` calls.

Wrap only the `db.batch(...)` section in an inner `try/catch`. If the batch fails and `ownsProjectLock` is true, attempt to release the lock with an ownership check before rethrowing. The outer catch from Step 1 will convert the failure into the stable `Failed to start agent run.` TRPC error.

Required local helper shape before the branch-specific batches:

```ts
async function releaseOwnedProjectLockAfterBatchFailure() {
	if (!ownsProjectLock) {
		return;
	}

	try {
		await db
			.update(projects)
			.set({
				activeAgentRunId: null,
				activeAgentRunStartedAt: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(
				and(
					eq(projects.id, input.projectId),
					eq(projects.userId, ctx.user.id),
					eq(projects.activeAgentRunId, runId),
				),
			);
	} catch {
		// Keep the original start-run failure as the user-facing error.
	}
}
```

The ownership check `eq(projects.activeAgentRunId, runId)` is mandatory. Never clear a lock without proving this request still owns it.

New-session batch target shape:

```ts
if (createdSession) {
	try {
		const [[session], [run]] = await db.batch([
			db.insert(workspaceSessions).values(sessionValues).returning(),
			db.insert(agentRuns).values(runValues).returning(),
			db
				.update(workspaceSessions)
				.set({ updatedAt: sql`(unixepoch())` })
				.where(eq(workspaceSessions.id, sessionId)),
			db.insert(agentRunEvents).values(eventValues),
		]);

		if (!session || !run) {
			throw new Error("Batched startRun write did not return created rows.");
		}

		return { run, session, createdSession };
	} catch (error) {
		await releaseOwnedProjectLockAfterBatchFailure();
		throw error;
	}
}
```

Existing-session batch target shape:

```ts
try {
	const [[run], [session]] = await db.batch([
		db.insert(agentRuns).values(runValues).returning(),
		db
			.update(workspaceSessions)
			.set({ updatedAt: sql`(unixepoch())` })
			.where(eq(workspaceSessions.id, sessionId))
			.returning(),
		db.insert(agentRunEvents).values(eventValues),
	]);

	if (!session || !run) {
		throw new Error("Batched startRun write did not return created rows.");
	}

	return { run, session, createdSession };
} catch (error) {
	await releaseOwnedProjectLockAfterBatchFailure();
	throw error;
}
```

Keep this lock-release helper local to `workspace.startRun`. Do not create a repository/data-access layer.

TypeScript notes:

- Prefer branch-specific `db.batch([...])` calls over building a mutable array of queries. Drizzle's D1 `batch` type expects a non-empty tuple, and branch-specific calls infer types more reliably.
- Do not use `any` to silence batch typing. If a narrow type annotation is needed, use the inferred select types from `typeof workspaceSessions.$inferSelect` and `typeof agentRuns.$inferSelect`.
- Keep the existing return shape with actual `session` and `run` rows.

**Verify**:

- `pnpm exec tsc --noEmit --pretty false` -> exit 0, no output.
- `rg "db\.transaction" src/integrations/trpc/router.ts` -> exit 1 with no matches.
- `rg "db\.batch" src/integrations/trpc/router.ts` -> exits 0 and shows the new `workspace.startRun` batch call(s).

### Step 6: Keep tests small and only add policy tests if you added a pure helper

There is no existing tRPC/D1 integration test harness. Do not build one for this plan.

If all changes stay inside `src/integrations/trpc/router.ts`, do not add a test just to test implementation details. The primary regression checks are typecheck, transaction-removal search, code review, and manual D1 verification.

If you changed `src/lib/workspace-policy.ts`, add or update focused tests in `src/lib/workspace-policy.test.ts` following the existing `describe("workspace policy", ...)` style. Cover only the pure helper you added.

**Verify**: `pnpm test` -> exit 0, all tests pass.

### Step 7: Run scoped and full verification gates

Run the verification commands in this order:

1. `pnpm exec biome check src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts` -> exit 0, no errors.
2. `pnpm exec tsc --noEmit --pretty false` -> exit 0, no output.
3. `pnpm test` -> exit 0, all tests pass.
4. `pnpm lint` -> exit 0. The existing `src/components/ui/sidebar.tsx:85` `noDocumentCookie` warning may remain; there must be no new warnings in touched files.
5. `git diff --check` -> exit 0, no output.
6. `rg "db\.transaction" src/integrations/trpc/router.ts` -> exit 1 with no matches.
7. `rg "db\.batch" src/integrations/trpc/router.ts` -> exits 0 and shows the new `workspace.startRun` batch call(s).

### Step 8: Manual D1 verification when a local app environment is available

If the operator has local auth and D1 environment variables configured, run the app and verify the user-facing failure is gone:

1. Run `pnpm dev`.
2. Open a ready project with a sandbox.
3. Send a composer message from the project route with no selected session.
4. Expected: the message starts a run, creates/navigates to a session, and does not show `Failed query: begin params:`.
5. Send another composer message in the existing session.
6. Expected: a run starts in the existing session and does not create a duplicate empty session.
7. Attempt a second overlapping mutating start against the same project if you can do so safely.
8. Expected: the second mutating start returns or displays `Another agent run is already editing this project.` rather than a raw database error.

Do not inspect, print, or copy `.env.local` values while doing manual verification.

## Test plan

- No broad D1/tRPC integration harness in this plan; the PRD explicitly excludes it.
- Required automated checks are typecheck, tests, scoped Biome check, lint, whitespace, and source search for transaction removal and batch usage.
- If no pure helper is added, no new unit test is required.
- If a pure helper is added to `src/lib/workspace-policy.ts`, add tests in `src/lib/workspace-policy.test.ts` following the existing pattern and keep them focused on that helper.
- Manual D1 verification should cover new-session start, existing-session start, and conflict behavior when the local environment supports it.

## Done criteria

All must hold:

- [ ] `workspace.startRun` in `src/integrations/trpc/router.ts` no longer calls `db.transaction(...)`.
- [ ] `workspace.startRun` uses `db.batch(...)` for the initial session/run/session-update/event write set.
- [ ] Mutating runs still acquire the project lock with a conditional update that includes `isNull(projects.activeAgentRunId)`.
- [ ] Read-only runs still skip project-lock acquisition and do not set `projects.activeAgentRunId`.
- [ ] If the batch fails after a mutating lock was acquired, cleanup only clears the project lock when `projects.activeAgentRunId` still equals the current `runId`.
- [ ] Existing conflict behavior remains a `TRPCError` with code `CONFLICT` and message `Another agent run is already editing this project.`.
- [ ] Unexpected non-TRPC failures from `workspace.startRun` surface as `Failed to start agent run.` without raw Drizzle/D1 query details.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0 with no output.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm exec biome check src/integrations/trpc/router.ts src/lib/workspace-policy.ts src/lib/workspace-policy.test.ts` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings in touched files; the pre-existing `src/components/ui/sidebar.tsx:85` warning may remain.
- [ ] `git diff --check` exits 0 with no output.
- [ ] `rg "db\.transaction" src/integrations/trpc/router.ts` has no matches.
- [ ] No files outside the in-scope list are modified by this plan, except pre-existing unrelated work that was already present before execution.
- [ ] `plans/README.md` status row for plan 010 is updated when execution completes.

## STOP conditions

Stop and report back without improvising if:

- The code at the locations in "Current state" does not match the live code after running the drift check.
- You discover another `db.transaction(...)` use outside `workspace.startRun` that appears necessary for this same user flow.
- Drizzle's `db.batch(...)` cannot be made to typecheck for the branch-specific tuple calls without using `any` or introducing a new data-access abstraction.
- The fix appears to require changes to `src/db/schema.ts`, `migrations/`, package dependencies, UI components, Durable Objects, or Sandbox SDK code.
- You cannot preserve the ownership-checked lock cleanup (`activeAgentRunId = runId`) after batch failure.
- You are tempted to add time-based stale lock reclaim, heartbeat/lease behavior, multi-editor worktrees, or a broad D1/tRPC integration harness.
- A verification command fails twice after a reasonable fix attempt.
- Manual verification would require reading or exposing secret values from `.env.local`.

## Maintenance notes

- D1 `batch` is appropriate here because the session/run/event statements are known before execution. Do not later expand this into a fake general transaction around arbitrary JavaScript work.
- Future agent-runner work must still release `projects.activeAgentRunId` when a mutating run reaches a terminal status. `workspace.cancelRun` already clears the lock for canceled runs; completion/failure paths should follow the same ownership-checked pattern.
- If lock contention becomes common, plan heartbeat/lease or per-session worktree behavior separately. Do not hide those larger product choices inside this reliability fix.
- Reviewers should scrutinize three things: no `db.transaction`, batch failure cleanup cannot clear another run's lock, and user-facing errors do not leak raw SQL/Drizzle messages.
