# Plan 041: Model durable Agent Runs in D1

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in **STOP conditions** occurs, stop and report — do
> not improvise, reopen a terminal record, move conversation authority out of
> D1, or add Pi/Workflow execution. When done, update this plan's row in
> `plans/README.md` and append redacted execution evidence to this file.
>
> **Cloud completion boundary**: Plan 039 is `DONE-local`; its paid-plan cloud
> cutover is deferred, so a deployed `ditto-ayan-db` is not currently proven to
> exist. Steps 1–7 are locally executable from a clean worktree. If they pass
> but Step 8 cannot start because the exact deployed ayan D1 is absent or the
> Alchemy v2 cloud graph is not converged, stop at the cloud boundary and mark
> this plan `DONE-local (BLOCKED for full DONE: deployed ayan D1 migration smoke
> unavailable)`. Do not claim `DONE`, do not create infrastructure from this
> plan, and do not start dependent production work. A present-but-failing
> remote migration/smoke is `BLOCKED`, not `DONE-local`.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat e3abdee..HEAD -- \
>   apps/web/src/db/schema.ts \
>   apps/web/src/db/index.ts \
>   apps/web/src/lib/agent-run-service.ts \
>   apps/web/src/lib/agent-control-service.ts \
>   apps/web/src/lib/workspace-session.ts \
>   apps/web/src/integrations/trpc/routers/workspace.ts \
>   apps/web/migrations \
>   apps/web/drizzle.config.ts \
>   alchemy.run.ts \
>   package.json apps/web/package.json
> ```
>
> If any listed file changed, compare the **Current state** excerpts with live
> code. STOP if D1 is no longer the application database, the current message
> lifecycle or ownership predicates changed, migrations are no longer generated
> from `apps/web/src/db/schema.ts`, or acceptance cannot be represented as one
> `D1Database.batch()` transaction. Preserve all unrelated work by using the
> clean worktree workflow below; never stash, reset, clean, or commit the
> maintainer's dirty checkout.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH — authoritative schema, idempotency, and lifecycle invariants
- **Depends on**: `plans/039-migrate-ayan-stack-to-alchemy-v2.md` (`DONE-local`;
  local implementation may proceed, but full DONE requires its deployed ayan D1
  prerequisite)
- **Category**: direction
- **Planned at**: commit `e3abdee`, 2026-08-11
- **Branch**: `advisor/041-model-durable-agent-runs-in-d1`
- **Execution status**: BLOCKED — Step 1 frozen install rejected locked `@cloudflare/workers-types@5.20260811.1` under the 4,320-minute minimum-release-age policy; retry after 2026-08-14 00:59:59 UTC

## Why this matters

Ditto currently persists chat messages but has no current-schema Agent Run,
Turn, Pi Agent Session, idempotency, control-intent, terminal-outcome, or
Execution Epoch record. The request-scoped stream invents a `runId` in memory,
while queued follow-ups do not enter D1 until PI starts them. That cannot be the
foundation for browser-independent Brain/Workflow ownership.

This plan adds only the D1-authoritative domain and persistence layer. It does
not run Pi, create a Brain Durable Object, start Workflow, alter the browser
protocol, or switch the current `/api/agent/*` routes. A later owner can consume
these contracts without making Brain SQLite, R2, Workflow state, browser memory,
PI JSONL, or an in-memory map authoritative for conversation or outcome truth.

## Non-negotiable domain decisions

1. **D1 is authority.** D1 owns Workspace Session identity, Pi Agent Session
   identity, Agent Runs, ordered Turns, complete user messages, pending/terminal
   assistant messages, Stop intent, terminal outcomes, idempotency, predecessor
   order, and the current Execution Epoch reference. Other stores may cache or
   checkpoint these facts but cannot replace them.
2. **One project Brain without a speculative table.** A Brain is project-scoped,
   so `projects.id` is the future deterministic Brain shard key. Do not add a
   `brains` table or Durable Object in this plan. Every new row carries
   `projectId`; every read/write also scopes by authenticated `userId` and
   Workspace Session.
3. **One Pi Agent Session per Workspace Session.** Use the existing
   `workspace_sessions.id` as the Pi Agent Session identity. A
   `pi_agent_sessions` row is one-to-one with that Workspace Session and stores
   only D1 coordination pointers such as `currentRunId`; it stores no PI JSONL,
   provider credential, browser state, or Brain SQLite payload.
4. **Agent Runs are attempts, never reusable containers.** A run has a stable
   identity, an increasing per-Pi-session sequence, an optional predecessor,
   immutable accepted input/ownership, mutable lifecycle fields only through
   compare-and-set, and one immutable terminal outcome. A terminal run is never
   reopened and never receives another Turn.
5. **Run vocabulary is exact.** Nonterminal states are `accepted`, `running`,
   `stopping`, and `finalizing`. Terminal outcomes are `completed`, `failed`,
   `cancelled`, and `interrupted`. Keep the existing message vocabulary
   (`pending`, `complete`, `failed`): user messages are `complete`; assistant
   rows start `pending` and become `complete` or `failed`. Do not rename legacy
   message `complete` to run `completed`.
6. **Turns are ordered exchanges.** Each Turn belongs to one run and has a
   positive, gap-free run-local sequence, one complete user-message ID, one
   pending/terminal assistant-message ID, one client request ID, the selected
   model specifier, and the optional canonical thinking level. Accepted message
   bytes are stored in full; oversized input is rejected, never truncated.
7. **Input routing is state-based.** Input targets the current run only while it
   is `accepted` or `running`. Input observed while the current run is
   `stopping`, `finalizing`, or terminal creates or joins exactly one ordered
   successor (`predecessorRunId`, next run sequence). Further input joins that
   accepted successor. It never appends to or reopens the predecessor.
8. **Acceptance is one D1 transaction.** Creating a run must atomically create
   that run, Turn 1, its complete user row, and its pending assistant row; lazy
   creation/update of the one Pi Agent Session pointer may be in the same batch.
   Appending a Turn must atomically create the Turn and both messages. There may
   be no visible run without Turn 1 and no orphan message pair.
9. **Idempotency is durable.** A nonempty client `requestId` is unique per user
   across Turns. An exact duplicate returns the already persisted run/Turn/
   message IDs. Reusing that ID with a different project, Workspace Session,
   message, model, or thinking level returns 409 and writes nothing. Handle the
   concurrent duplicate race by catching the unique conflict and reading the
   winner; do not rely on a pre-read alone.
10. **Control intent is durable.** Stop records a bounded request ID and
    timestamp before any later signal. It may move `accepted`/`running` to
    `stopping`; repeated Stop is idempotent. It does not directly produce a
    terminal outcome and cannot mutate `finalizing` or terminal records.
11. **Execution Epoch is a reference, not execution.** Each run has nullable
    positive `currentExecutionEpoch`. Foundation CAS operations can set/advance
    it monotonically and reject stale expected epochs. Do not add Operation
    Fences, events, checkpoints, Workflow IDs, or Brain SQLite state yet.
12. **No credential-shaped run storage.** Run/Turn rows may contain ownership,
    IDs, lifecycle timestamps, model/thinking metadata, bounded machine-safe
    outcome codes, and epoch references. They must not contain provider tokens,
    OAuth material, project environment values, callback JWTs, GitHub tokens,
    cookies, request headers, encrypted credentials, sandbox process env, or raw
    exception text.

## Lifecycle and routing tables

Implement these as exported constants/pure predicates in
`apps/web/src/lib/agent-run-persistence.ts`, then use the same predicates in
repository mutations and parameterized tests.

### Legal lifecycle transitions

| From | Legal next states | Required behavior |
|---|---|---|
| `accepted` | `running`, `stopping`, `finalizing` | `running` establishes a positive epoch; `stopping` persists Stop intent first; direct `finalizing` is allowed for pre-execution failure |
| `running` | `stopping`, `finalizing` | compare expected status and current epoch |
| `stopping` | `finalizing` | no new Turn may target this run |
| `finalizing` | `completed`, `failed`, `cancelled`, `interrupted` | all assistants for the run must already be terminal; set `finishedAt` and optional bounded outcome code in the same CAS |
| any terminal state | none | return the existing row for an exact duplicate operation or reject; never update lifecycle/outcome |

Do not add convenient direct edges to a terminal state. An executor/finalizer
that fails before Pi starts still records `accepted -> finalizing -> failed` or
`interrupted`.

### Input target table

| Current D1 run state | Target |
|---|---|
| no current run | new accepted run, sequence 1 |
| `accepted` | append next Turn to current run |
| `running` | append next Turn to current run |
| `stopping` | create/join one accepted successor |
| `finalizing` | create/join one accepted successor |
| terminal | create/join one accepted successor |

Concurrent input must still produce gap-free unique `(runId, sequence)` Turns
and at most one unique successor for a predecessor. A bounded retry after a CAS
or unique-index race is acceptable; a global/application mutex is not.

## Current state

### Domain vocabulary to preserve

`CONTEXT.md:8-16,47-73` defines the relevant boundaries:

```markdown
**Brain**:
The trusted, project-scoped coordinator that owns session agent state and has exclusive authority to mutate the Project Sandbox.

**Pi Runtime**:
The project-scoped Pi harness hosted by the Brain. It coordinates multiple Pi Agent Sessions but owns no conversation identity.

**Pi Agent Session**:
The durable Pi conversation state belonging to exactly one Workspace Session. A Brain coordinates many Pi Agent Sessions.

**Agent Run**:
One durably recorded attempt by a Pi Agent Session to perform work. A Workspace Session may have many Agent Runs; each has an immutable terminal outcome independent of a browser connection.

**Finalizing**:
The nonterminal Agent Run phase after Pi stops executing and before its checkpoint, workspace backup, messages, and outcome are durably published. New input starts a successor Agent Run.

**Turn**:
One ordered user-message and assistant-response exchange within an Agent Run. Follow-ups accepted while a run is active become later Turns in that run.

**Execution Epoch**:
The monotonic generation fencing one Agent Run attempt from stale Workflow calls, Brain results, events, checkpoints, and tool completions.
```

Use these names in code. Do not call Brain a runner/Worker, a Workspace Session a
sandbox session, or an Agent Run a request/stream.

### Current D1 schema authority

`apps/web/src/db/schema.ts:80-113` already defines owned Workspace Sessions:

```ts
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
		// ... branch/workspace fields ...
		status: text("status", { enum: [...WORKSPACE_SESSION_STATUSES] })
			.notNull()
			.default("active"),
		// ... timestamps ...
	},
	(table) => [
		index("workspace_sessions_projectId_idx").on(table.projectId),
		index("workspace_sessions_userId_idx").on(table.userId),
		// ...
	],
);
```

`apps/web/src/db/schema.ts:116-158` is the current conversation authority:

```ts
export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		sessionId: text("sessionId")
			.notNull()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["user", "assistant"] }).notNull(),
		content: text("content").notNull(),
		model: text("model"),
		tools: text("tools"),
		status: text("status", {
			enum: ["pending", "complete", "failed"],
		})
			.notNull()
			.default("complete"),
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

Keep these rows as conversation content authority. Do not move message content
into new run rows or duplicate it into Brain/Workflow state.

### Current request-owned acceptance is incomplete

`apps/web/src/lib/agent-run-service.ts:55-69` validates the current request but
has no durable client idempotency key:

```ts
export const MESSAGE_STATUSES = ["pending", "complete", "failed"] as const;

export const agentStreamBodySchema = z.object({
	projectId: z.string().min(1),
	sessionId: z.string().min(1).optional(),
	message: z.string().trim().min(1),
	model: z.string().min(1).refine(isProjectCoderModelSpecifier, {
		message: "Invalid model.",
	}),
	thinkingLevel: z.enum(PI_THINKING_LEVELS).optional(),
});
```

`apps/web/src/lib/agent-run-service.ts:550-579` invents `runId` only in memory
and batches only message rows plus recency:

```ts
const runId = deps.createId();
const userMessageId = deps.createId();
const assistantMessageId = deps.createId();
const [userRows, assistantRows] = await db.batch([
	db.insert(messages).values({
		id: userMessageId,
		sessionId,
		projectId: input.projectId,
		userId,
		role: "user",
		content: input.message,
		model: input.model,
		status: "complete",
	}).returning(),
	db.insert(messages).values({
		id: assistantMessageId,
		sessionId,
		projectId: input.projectId,
		userId,
		role: "assistant",
		content: "",
		status: "pending",
	}).returning(),
	workspaceSessionRecencyUpdate(db, sessionId),
]);
```

Do not wire the new persistence service into this current path in Plan 041. A
partial cutover would strand accepted durable runs because the current route has
no new lifecycle/finalization owner. Later Brain/Workflow plans replace the
owner atomically.

### Current follow-up and Stop are transient

`apps/web/src/lib/agent-control-service.ts:157-220` ownership-checks project and
Workspace Session, then creates a request ID and sends control directly to the
live sandbox runner. No control intent or queued Turn is authoritative in D1:

```ts
const project = await deps.loadProjectForUser({
	db,
	projectId: input.projectId,
	userId,
});
// ...
const session = await deps.loadOwnedActiveSession({
	db,
	projectId: input.projectId,
	sessionId: input.sessionId,
	userId,
});
// ...
const requestId = deps.createId();
const job = input.action === "follow_up"
	? { action: "follow_up" as const, requestId, runId: input.runId, /* ... */ }
	: { action: "stop" as const, requestId, runId: input.runId, /* ... */ };
```

Again, leave the route and runner control mechanics unchanged in this plan. Add
only the future durable contracts and tests.

### Ownership convention

`apps/web/src/lib/workspace-session.ts:13-31` is the existing pattern to match:

```ts
const [session] = await options.db
	.select()
	.from(workspaceSessions)
	.where(
		and(
			eq(workspaceSessions.id, options.sessionId),
			eq(workspaceSessions.projectId, options.projectId),
			eq(workspaceSessions.userId, options.userId),
			eq(workspaceSessions.status, "active"),
		),
	)
	.limit(1);
```

Every public persistence operation must take and predicate `userId`,
`projectId`, and `workspaceSessionId`; a bare run/request/message ID is never an
authorization boundary.

### Migration history and naming trap

`apps/web/migrations/0002_sparkling_agent_zero.sql` once created an unrelated
legacy `agent_runs` table. `apps/web/migrations/0006_late_wonder_man.sql:17-25`
then removed all legacy run infrastructure:

```sql
DROP TABLE `agent_run_events`;
DROP TABLE `agent_runs`;
DROP TABLE `run_artifacts`;
DROP TABLE `snapshots`;
ALTER TABLE `projects` DROP COLUMN `activeAgentRunId`;
ALTER TABLE `projects` DROP COLUMN `activeAgentRunStartedAt`;
ALTER TABLE `projects` DROP COLUMN `lockStatus`;
ALTER TABLE `projects` DROP COLUMN `lockHolderRunId`;
```

The current schema has no `agent_runs`; reusing that physical name is correct.
Do not resurrect legacy columns (`isMutating`, `userMessage`, `question`, Flue
IDs, snapshot IDs, project locks), event/artifact tables, or old status
vocabulary. Empty-history and existing-at-0011 tests must both prove migration
0012 creates only the new model.

`apps/web/drizzle.config.ts` is the migration convention:

```ts
export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./migrations",
	dialect: "sqlite",
})
```

Generate migration 0012 with `pnpm db:generate`; do not hand-create snapshots or
edit old migrations. A generated SQL correction is allowed only if Drizzle
cannot express a required SQLite constraint and the matching schema/snapshot
remain authoritative; if that occurs, STOP first and report the exact gap.

### Current D1 transaction layer

`apps/web/src/db/index.ts` exposes Drizzle's D1 client:

```ts
export function createDb(env: Pick<Env, "DB">) {
	return drizzle(env.DB, { schema });
}
```

The currently installed Drizzle D1 driver is `0.45.2`; its `db.batch()` delegates
to `D1Database.batch()`. Existing production code already uses this path for
message pairs. Do **not** use Drizzle's callback `db.transaction()` for this
plan: its installed D1 implementation issues separate `begin` / statements /
`commit`, while Cloudflare's current documented all-or-nothing primitive is
`D1Database.batch()`.

Current Cloudflare D1 docs state that batch statements execute sequentially as a
SQL transaction and a failure aborts/rolls back the sequence:
<https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>. The latest
retrieved Workers types at planning time (`@cloudflare/workers-types`
`5.20260811.1`) declare:

```ts
declare abstract class D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
  withSession(...): D1DatabaseSession;
}
```

Use parameterized prepared statements in one batch. Do not concatenate user
text into SQL, use the Cloudflare REST API from the Worker, or add a dependency.
Re-fetch the current D1 page and latest Workers types before implementation; if
`batch()` no longer has rollback semantics, STOP because atomic acceptance is
not expressible by the approved layer.

### Deployment ownership

`alchemy.run.ts:18-22` makes Alchemy v2 the migration owner:

```ts
const Database = Cloudflare.D1.Database("database", {
	name: "ditto-ayan-db",
	migrationsDir: path.join(repoRoot, "apps/web/migrations"),
	migrationsTable: "drizzle_migrations",
});
```

Do not use `wrangler d1 migrations apply` in parallel with Alchemy's
`drizzle_migrations` ownership. Remote schema inspection may use read-only
`wrangler d1 list/execute`; applying migration 0012 must happen through the
converged Alchemy v2 stage `dev` deployment.

## Target schema contract

Add these exports to `apps/web/src/db/schema.ts` after `messages` so all foreign
references are already available. Match existing camelCase physical columns and
`created_at` / `updated_at` timestamp conventions. Use Drizzle `check()` plus
SQLite `sql` expressions for enum/positive-number constraints; TypeScript text
`enum` alone is not a database CHECK.

### `agent_runs`

Required columns:

| Column | Contract |
|---|---|
| `id` | text primary key |
| `workspaceSessionId` | not-null FK to `workspace_sessions.id`, cascade with session deletion |
| `projectId` | not-null FK to `projects.id`, cascade |
| `userId` | not-null FK to `user.id`, cascade |
| `sequence` | positive integer, unique with Workspace Session |
| `predecessorRunId` | nullable self-FK; unique when non-null so one predecessor has at most one successor |
| `status` | exact run vocabulary; default `accepted`; database CHECK |
| `currentExecutionEpoch` | nullable positive integer; no credential or process handle |
| `stopRequestId` | nullable bounded client idempotency/control key |
| `stopRequestedAt` | nullable timestamp |
| `outcomeCode` | nullable bounded machine code only (`[a-z0-9_:-]`, max 128); never raw exception text |
| `acceptedAt` | not-null D1 timestamp default |
| `startedAt` | nullable timestamp |
| `finalizingAt` | nullable timestamp |
| `finishedAt` | nullable timestamp; set once with terminal outcome |
| `createdAt`, `updatedAt` | not-null D1 timestamps default |

Required indexes/constraints:

- unique `(workspaceSessionId, sequence)`;
- unique `predecessorRunId` (SQLite permits multiple nulls);
- indexes for `(projectId, workspaceSessionId, status)` and `userId`;
- CHECK `sequence > 0`;
- CHECK exact status vocabulary;
- CHECK `currentExecutionEpoch IS NULL OR currentExecutionEpoch > 0`;
- CHECK terminal rows have `finishedAt`, nonterminal rows do not; terminal rows
  may have an `outcomeCode`, nonterminal rows may not.

Do not add event, Workflow, fence, checkpoint, R2, backup, lease, sandbox,
process, provider-credential, or browser-delivery columns.

### `pi_agent_sessions`

Required columns:

| Column | Contract |
|---|---|
| `workspaceSessionId` | text primary key and FK to `workspace_sessions.id`; this is the Pi Agent Session ID |
| `projectId` | not-null FK to `projects.id` |
| `userId` | not-null FK to `user.id` |
| `currentRunId` | nullable FK to `agent_runs.id`; D1 routing pointer, not terminal authority |
| `createdAt`, `updatedAt` | not-null D1 timestamps default |

Add `(projectId, userId)` index. Do not add PI transcript/checkpoint JSON.

### `turns`

Required columns:

| Column | Contract |
|---|---|
| `id` | text primary key |
| `runId` | not-null FK to `agent_runs.id`, cascade |
| `workspaceSessionId` | not-null FK to `workspace_sessions.id`, cascade |
| `projectId` | not-null FK to `projects.id`, cascade |
| `userId` | not-null FK to `user.id`, cascade |
| `sequence` | positive run-local integer |
| `requestId` | nonempty client idempotency key, max 128 at service boundary |
| `userMessageId` | not-null FK to `messages.id`, unique |
| `assistantMessageId` | not-null FK to `messages.id`, unique |
| `modelSpecifier` | nonempty selected model metadata; never credential material |
| `thinkingLevel` | nullable existing PI vocabulary (`off` through `max`) |
| `createdAt` | not-null D1 timestamp default |

Required indexes/constraints:

- unique `(runId, sequence)`;
- unique `(userId, requestId)` for durable duplicate/conflict detection;
- unique user-message and assistant-message references;
- indexes for `(projectId, workspaceSessionId, runId)`;
- CHECK `sequence > 0` and exact nullable thinking-level vocabulary.

Do not add a second message-content column or a JSON request blob. Exact
idempotency comparison reads the owned Turn and its two authoritative message
rows and compares project/session/message/model/thinking fields.

## Persistence service contract

Create `apps/web/src/lib/agent-run-persistence.ts` and its colocated test. Keep
one concrete module rather than repository interfaces/factories with one
implementation. Export these narrow operations (names may vary slightly, but
responsibilities may not):

1. `acceptAgentInput(options)`
   - typed input: D1 db, authenticated `userId`, `projectId`, active
     `workspaceSessionId`, `requestId`, exact user `message`, `modelSpecifier`,
     optional `thinkingLevel`, injectable ID/clock for tests;
   - validate bounds before writes; reject whitespace-only or oversized message
     but preserve accepted text exactly (no `.trim()` transformation);
   - load duplicate by `(userId, requestId)` through Turn -> run -> both messages,
     with full ownership predicates;
   - exact duplicate returns the same persisted IDs/result with no write;
   - conflict returns `{ kind: "error", status: 409, code:
     "idempotency_conflict" }` with no input echoed;
   - load the owned active Workspace Session and its Pi Agent Session/current
     run; route by the table above;
   - create/join one successor when required, allocate run/Turn sequences, then
     submit all dependent writes in one D1 batch;
   - use conditional `INSERT ... SELECT`/CAS predicates for an active append so
     a concurrent Stop/finalize cannot append after state changed;
   - inspect `RETURNING` results; zero-row CAS retries routing, unique conflicts
     read the winner, and three failed attempts return a safe 409 busy result;
   - return persisted run/Turn/message records (or a bounded projection) plus
     `createdRun` and `duplicate` flags.
2. `loadOwnedAgentRun(options)`
   - requires user/project/Workspace Session/run IDs;
   - returns run with ordered Turns and messages or null;
   - never returns another user's row from a globally valid run/request ID.
3. `requestAgentRunStop(options)`
   - ownership-scoped and request-id bounded;
   - one batch/CAS persists `stopRequestId`, `stopRequestedAt`, and
     `status="stopping"` from accepted/running before any future signal;
   - repeated Stop returns existing intent; finalizing/terminal remains
     unchanged and returns a typed non-accepted result.
4. `transitionAgentRun(options)`
   - validates the exported legal-transition table;
   - predicates current status, ownership, and expected epoch;
   - `accepted -> running` sets `startedAt` and a positive epoch;
   - entering finalizing sets `finalizingAt` once;
   - terminal transition is legal only from finalizing and only when no Turn's
     assistant message remains pending; it sets status/outcomeCode/finishedAt in
     one CAS;
   - terminal or stale-epoch mutation returns a typed conflict and never writes.
5. `advanceAgentRunEpoch(options)`
   - ownership/status/expected-epoch CAS; next epoch must equal current + 1;
   - only nonterminal runs may advance; no external action is performed.
6. `settleTurnAssistant(options)`
   - ownership-scoped through Turn/run/message joins;
   - changes only that Turn's assistant from `pending` to `complete` or `failed`,
     persisting full already-redacted content and bounded serialized tools;
   - exact duplicate terminal settlement may return the row; conflicting
     re-settlement returns 409; never returns a terminal assistant to pending.

A typed result union is preferable to throwing for expected not-found,
idempotency conflict, stale CAS, terminal, and busy outcomes. Unexpected D1
errors may throw after preserving transaction rollback. Do not expose SQL errors,
input text, or stored content in error messages/logs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install root | `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| Install runner | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| Generate migration | `pnpm db:generate` | creates only migration `0012_*`, matching snapshot, and journal entry |
| Focused tests | `npm test --prefix apps/web -- --run src/db/agent-run-migration.test.ts src/lib/agent-run-persistence.test.ts src/lib/agent-run-service.test.ts src/lib/workspace-session.test.ts` | all selected tests pass; current route behavior unchanged |
| Typecheck | `npm run typecheck --prefix apps/web` | exit 0 |
| Biome check | `./node_modules/.bin/biome check apps/web/src/db/schema.ts apps/web/src/db/agent-run-migration.test.ts apps/web/src/lib/agent-run-persistence.ts apps/web/src/lib/agent-run-persistence.test.ts` | exit 0 |
| Full gate | `pnpm verify` | check, typecheck, all web tests/build, and runner verification pass |
| Remote inventory | `pnpm --filter @ditto/web exec wrangler d1 list --json` | valid JSON; exactly one `ditto-ayan-db` before cloud work |
| Alchemy plan | `pnpm exec alchemy deploy --stage dev --dry-run` | bounded migration/Worker plan; no new/replaced unrelated resource |
| Alchemy deploy | `pnpm exec alchemy deploy --stage dev --yes` | migration applies through the existing graph |
| Remote SQL | `pnpm --filter @ditto/web exec wrangler d1 execute ditto-ayan-db --remote --json --command '<read-only SQL>'` | valid JSON matching assertions below |

The direct npm app commands bypass the current root pnpm minimum-release-age
wrapper issue recorded in `plans/README.md`; final `pnpm verify` is still the
required clean-executor gate. Do not change supply-chain policy to make it pass.

## Suggested executor toolkit

- Read the current Cloudflare D1 `batch()` docs before Step 4:
  <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>.
- Retrieve latest Workers types exactly as the Workers skill requires; compare
  `D1Database`, `D1PreparedStatement`, and `D1Result` with the installed types.
- Use `cloudflare` and `workers-best-practices` for D1/Worker claims. Use
  `durable-objects` only to preserve the boundary that no Brain DO or Brain
  SQLite is added here. Sandbox stable/`@next` APIs are out of scope; do not
  migrate either package or image.
- Use installed Drizzle declarations/source when a D1 adapter type is unclear;
  do not add an ORM or transaction package.

## Scope

### In scope — the only source/generated files to modify

- `apps/web/src/db/schema.ts` — new typed tables, checks, indexes, FKs.
- `apps/web/migrations/0012_<drizzle-generated-name>.sql` — generated migration.
- `apps/web/migrations/meta/0012_snapshot.json` — generated snapshot.
- `apps/web/migrations/meta/_journal.json` — generated entry only.
- `apps/web/src/db/agent-run-migration.test.ts` — empty/existing migration tests.
- `apps/web/src/lib/agent-run-persistence.ts` — domain constants and concrete D1
  persistence/service operations.
- `apps/web/src/lib/agent-run-persistence.test.ts` — state, idempotency,
  ownership, transaction, and race tests.
- `plans/041-model-durable-agent-runs-in-d1.md` — append redacted evidence/status.
- `plans/README.md` — update only Plan 041 status/evidence note.

### Generated/temporary artifacts allowed but never committed

- ignored `node_modules/**`, `.wrangler/**`, `.alchemy/**` created by normal
  verification;
- `/tmp/ditto-041-*` metadata-only cloud smoke files.

### Out of scope — do not touch

- `apps/web/src/lib/agent-run-service.ts`,
  `apps/web/src/lib/agent-control-service.ts`, or current runner/SSE behavior.
- `apps/web/src/routes/api.agent.stream.ts`,
  `apps/web/src/routes/api.agent.control.ts`, tRPC routers, browser components,
  cache, or route tree.
- `apps/web/src/db/index.ts`; the current typed Drizzle constructor is enough.
- Existing migrations `0000`–`0011`; never rewrite migration history.
- `alchemy.run.ts`, package manifests, lockfiles, Dockerfile, Worker entry, Env
  bindings, Sandbox package/image/transport, R2 backup behavior, or CI.
- Brain Durable Object/resource/SQLite, Pi runtime/session loading, Workflow,
  Operation Fences, event journals/cursors, checkpoints, leases, scheduling,
  reconciliation, recovery, browser gateway, or UI status changes.
- New credential, secret, encrypted-credential, env, cookie, auth-header,
  callback-token, process, Sandbox handle, Workflow payload, Brain SQLite, R2,
  or browser-memory storage in run/Turn rows.
- Plan 040. It is a no-GO contingency and must not be created on this accepted
  GO route.
- Any other plan, source refactor, cleanup, dependency upgrade, or doc rewrite.

## Clean worktree Git workflow

Do not alter the dirty root checkout. From its parent directory, create a fresh
worktree directly from the planned-at implementation commit:

```bash
set -euo pipefail
cd /home/ayan/ditto
test ! -e /home/ayan/ditto-worktrees/041-model-durable-agent-runs-in-d1
git worktree add \
  -b advisor/041-model-durable-agent-runs-in-d1 \
  /home/ayan/ditto-worktrees/041-model-durable-agent-runs-in-d1 \
  e3abdee
cd /home/ayan/ditto-worktrees/041-model-durable-agent-runs-in-d1
test -z "$(git status --short)"
```

If the branch/path already exists, STOP and ask whether to reuse or remove it;
do not delete it yourself. Do not copy the maintainer's `.env*`, generated
Alchemy/Wrangler state, or uncommitted files into the worktree. Cloud credentials
may be supplied through the operator's normal secure environment only.

Use Conventional Commits. Suggested logical commits:

1. `feat(db): model durable agent runs`
2. `test(db): verify agent run persistence`
3. `docs(plans): record Plan 041 evidence` (only after review/gates)

Do not push, open a PR, merge, or modify the maintainer's branch unless the
operator separately requests it.

## Steps

### Step 1: Establish a clean, green baseline and revalidate D1 batch

1. Run the drift check and clean-worktree assertions.
2. Bootstrap exact locked dependencies:

   ```bash
   pnpm install --frozen-lockfile
   npm ci --prefix packages/sandbox-runner
   ```

3. Re-fetch current D1 batch docs and latest Workers types. Confirm:
   - `D1Database.batch` still accepts prepared statements;
   - all statements are one SQL transaction;
   - one statement failure aborts/rolls back the entire sequence.
4. Inspect the installed Drizzle D1 adapter. Confirm `db.batch()` delegates to
   the binding batch and no package change is necessary.
5. Run current focused baseline plus typecheck:

   ```bash
   npm run typecheck --prefix apps/web
   npm test --prefix apps/web -- --run \
     src/db/session-preview-migration.test.ts \
     src/lib/agent-run-service.test.ts \
     src/lib/workspace-session.test.ts
   ```

**Verify**:

```bash
test -z "$(git status --short)"
node -p "require('./apps/web/node_modules/drizzle-orm/package.json').version"
rg -n 'batch<T.*D1PreparedStatement|class D1Database' \
  /tmp/ditto-041-workers-types*/package/index.d.ts
```

Expected: clean worktree; locked Drizzle `0.45.2`; current typecheck and focused
tests pass; current docs/types retain transactional batch. If not, STOP before
schema work. Do not substitute `db.transaction()`, a DO lock, or an app mutex.

### Step 2: Add the schema and generate migration 0012

1. Add exact run-state and terminal-state constant tuples in
   `agent-run-persistence.ts` or a dependency-free section importable by schema
   without a cycle. Prefer defining schema enum literals once in
   `schema.ts` and exporting them if that avoids a schema -> service import.
2. Add `agentRuns`, then `piAgentSessions`, then `turns` to `schema.ts` with the
   target columns/checks/indexes above. Resolve self/current-run references using
   Drizzle's supported lazy/reference typing; do not drop the FK or add a
   migration-only divergence merely to silence TypeScript.
3. Run `pnpm db:generate` exactly once and review the new SQL/snapshot/journal.
4. Confirm migration 0012 creates only the three new tables plus their
   indexes/checks and does not rebuild/drop existing auth/project/session/message
   tables. Confirm no legacy 0002 columns or tables return.

**Verify**:

```bash
set -euo pipefail
new_sql=(apps/web/migrations/0012_*.sql)
test "${#new_sql[@]}" -eq 1
test -f apps/web/migrations/meta/0012_snapshot.json
rg -n 'CREATE TABLE `agent_runs`|CREATE TABLE `pi_agent_sessions`|CREATE TABLE `turns`' "${new_sql[0]}"
rg -n 'accepted|running|stopping|finalizing|completed|failed|cancelled|interrupted' \
  apps/web/src/db/schema.ts "${new_sql[0]}"
! rg -n 'agent_run_events|run_artifacts|snapshots|isMutating|flue|activeAgentRun|lockHolder' \
  "${new_sql[0]}" apps/web/src/db/schema.ts
! git diff --name-only | rg '^(package.json|pnpm-lock.yaml|apps/web/package.json|apps/web/migrations/00(0[0-9]|1[01])_)'
```

Expected: one generated 0012 migration/snapshot; exact vocabulary and three
tables; old history untouched; no package change. If generation proposes an
existing-table rebuild/drop or cannot express the required constraints, STOP.

### Step 3: Verify empty and existing database migration paths

Create `apps/web/src/db/agent-run-migration.test.ts`, modeled on
`session-preview-migration.test.ts`, using Node's built-in `node:sqlite` only.
Keep test migration parsing compatible with the repository's
`--> statement-breakpoint` convention.

Required cases:

1. **Empty history**: apply migrations 0000 through 0012 to an empty in-memory
   database with `PRAGMA foreign_keys = ON`; assert all current core tables plus
   exactly the three new tables exist, legacy run tables are absent after 0006,
   and `PRAGMA foreign_key_check` is empty.
2. **Existing database**: apply 0000 through 0011, seed one user/project/active
   Workspace Session and a historical user/assistant message pair, record only
   counts/IDs, then apply 0012. Assert old rows/columns remain byte-for-byte,
   new tables are empty, and the new FK/index/check shape is present.
3. **Constraint shape**: seed a synthetic Pi Agent Session/run/Turn pair and
   prove duplicate run sequence, duplicate predecessor, duplicate
   `(userId, requestId)`, duplicate Turn message references, zero sequences,
   invalid state, invalid thinking level, and missing ownership parents fail.
4. **Cascade shape**: deleting the synthetic Workspace Session removes its Pi
   Agent Session/run/Turns/messages as intended without affecting another
   session.

Do not use production/user data or add fixtures/dependencies.

**Verify**:

```bash
npm test --prefix apps/web -- --run src/db/agent-run-migration.test.ts
```

Expected: every empty/existing/constraint/cascade case passes under real SQLite
with foreign keys enabled.

### Step 4: Implement atomic idempotent acceptance and successor routing

Implement `acceptAgentInput` in `agent-run-persistence.ts` against
`db.$client.prepare(...).bind(...)` plus one `db.$client.batch([...])` per
attempt. All SQL is static/parameterized. Keep generated IDs stable across
retries inside one call.

Order the work:

1. Validate IDs, exact non-whitespace message (maximum 32,000 UTF-16 code units,
   matching current follow-up bound), model, and thinking level before I/O.
2. Query an existing owned Turn by `(userId, requestId)`. Compare project,
   Workspace Session, exact user content, model, and nullable thinking level.
3. Resolve owned active Workspace Session and current Pi Agent Session/run.
4. Choose append/new/successor from the target table.
5. Compute positive run/Turn sequence from D1. Submit one batch that includes:
   - new run when required;
   - insert/update one Pi Agent Session current-run pointer when required;
   - complete user message;
   - pending empty assistant message;
   - Turn linking both messages;
   - Workspace Session recency update.
6. Every append insert must be conditional on the run still being
   `accepted|running`; every successor insert must be conditional on the
   predecessor/current-pointer state observed. Inspect each `RETURNING` result.
7. On zero-row CAS, retry routing. On uniqueness failure, read the request or
   successor winner and retry/return it. After three races return safe 409 busy.

Use the database transaction to do the hard work. Do not introduce an in-memory
lock, global map, Queue, DO, or `BEGIN`/`COMMIT` calls.

**Verify** with focused service tests:

- first input creates run sequence 1 + Turn sequence 1 + complete user + pending
  assistant + Pi current pointer atomically;
- second request while accepted/running appends Turn 2 without a new run;
- stopping/finalizing/each terminal state creates or joins one successor with
  next run sequence and Turn 1; predecessor remains byte-for-byte unchanged;
- exact duplicate before and after successor creation returns identical IDs and
  performs no second write;
- conflicting request-id reuse returns 409 and no write;
- simulated failure at each batch statement leaves no run/Turn/message/pointer
  partial state;
- concurrent same request yields one result; concurrent distinct successor
  inputs yield one successor with ordered Turns;
- concurrent Stop/finalize before append causes reroute, never late append.

```bash
npm test --prefix apps/web -- --run src/lib/agent-run-persistence.test.ts \
  -t 'accept|duplicate|conflict|rollback|successor|race'
```

Expected: all named acceptance/idempotency/rollback/routing cases pass.

### Step 5: Implement ownership-safe control, transition, epoch, and settlement

Add the remaining narrow operations from **Persistence service contract**.
Keep lifecycle timestamps D1/server assigned and CAS-protected.

Required test matrix:

1. Table-drive every `(from, to)` pair across all eight states; assert exactly
   the legal table succeeds and every terminal outgoing edge fails.
2. `accepted -> running` requires a positive first epoch; epoch advancement is
   exactly +1 and stale expected epoch fails without mutation.
3. Stop from accepted/running atomically stores intent + stopping; repeated Stop
   is idempotent; finalizing/terminal does not change.
4. Terminal settlement before finalizing fails; terminal settlement with any
   pending assistant fails; after assistant settlement it succeeds once and
   cannot change outcome/code/time.
5. Assistant pending -> complete/failed works once; pending bytes/tools are
   fully stored; terminal -> pending or conflicting terminal rewrite fails.
6. Every operation returns not-found/no-write for a foreign user, foreign
   project, wrong Workspace Session, archived session, or mismatched run/Turn/
   message ID — even when the target ID exists globally.
7. Outcome code rejects oversized/non-machine text so raw exceptions and
   credential-shaped diagnostics are not persisted in run rows.

**Verify**:

```bash
npm test --prefix apps/web -- --run src/lib/agent-run-persistence.test.ts \
  -t 'transition|epoch|stop|terminal|assistant|ownership'
```

Expected: complete legal/illegal transition table and ownership matrix pass.

### Step 6: Prove the current runtime is untouched

Plan 041 must not dual-write from the current route. Run current agent and
Workspace Session tests plus source guards:

```bash
set -euo pipefail
npm test --prefix apps/web -- --run \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-control-service.test.ts \
  src/lib/workspace-session.test.ts \
  src/routes/api.agent.stream.test.ts \
  src/routes/api.agent.control.test.ts

git diff --exit-code e3abdee -- \
  apps/web/src/lib/agent-run-service.ts \
  apps/web/src/lib/agent-control-service.ts \
  apps/web/src/routes/api.agent.stream.ts \
  apps/web/src/routes/api.agent.control.ts \
  apps/web/src/integrations/trpc/routers/workspace.ts \
  alchemy.run.ts Dockerfile package.json apps/web/package.json pnpm-lock.yaml
```

Expected: current tests pass and every out-of-scope diff is empty. The new
persistence module has no production caller yet; that is intentional.

### Step 7: Run local full verification and audit storage fields

Run:

```bash
set -euo pipefail
./node_modules/.bin/biome check \
  apps/web/src/db/schema.ts \
  apps/web/src/db/agent-run-migration.test.ts \
  apps/web/src/lib/agent-run-persistence.ts \
  apps/web/src/lib/agent-run-persistence.test.ts
npm run typecheck --prefix apps/web
npm test --prefix apps/web -- --run \
  src/db/agent-run-migration.test.ts \
  src/lib/agent-run-persistence.test.ts
pnpm verify
git diff --check
```

Audit changed schema/migration fields, without printing environment values:

```bash
! git diff -- apps/web/src/db/schema.ts apps/web/migrations/0012_*.sql \
  | rg -i 'credential|token|secret|authorization|cookie|header|envvar|oauth|private.?key|sandboxId|processId|workflow'
```

The grep may match a deliberate explanatory test name only; it must not match a
new persisted column. Review any match manually without outputting values.

**Verify**: all gates pass; only in-scope files changed; no dependency/lockfile
change; new run/Turn tables contain no credential-bearing field.

At this point, commit the local implementation if requested. If no deployed
ayan D1 exists, proceed only to Step 8 preflight, then record `DONE-local` at the
explicit cloud boundary. Do not start a dependent production plan.

### Step 8: Preflight the mandatory deployed ayan D1 smoke

This step is mandatory for full `DONE` and must run only when the operator has
already completed/refreshed Plan 039's paid-plan cloud cutover. It is not
permission to create the stack.

1. Confirm secure Cloudflare authentication without printing credentials.
2. Inventory remote D1 and project only metadata:

   ```bash
   set -euo pipefail
   umask 077
   pnpm --filter @ditto/web exec wrangler d1 list --json \
     >/tmp/ditto-041-d1-list.json
   jq -e '[.[] | select(.name == "ditto-ayan-db")] | length == 1' \
     /tmp/ditto-041-d1-list.json
   ```

3. Confirm Alchemy stage `dev` local state already owns the deployed graph and a
   dry run is understandable. If the database is absent, state is absent, the
   dry run proposes creating/adopting/replacing D1 or unrelated resources, or
   Plan 039 cloud acceptance is not recorded, STOP. Mark local completion
   accurately; do not run deploy.
4. Record metadata-only pre-migration counts (not row values) for `projects`,
   `workspace_sessions`, and `messages`, plus current `drizzle_migrations`
   count, under mode-0600 `/tmp/ditto-041-before.json`.
5. Capture a D1 time-travel bookmark/backup reference if the current authorized
   Alchemy/D1 deployment procedure provides it, recording only the non-secret
   identifier. Do not claim rollback from a local file dump.

**Verify**: exactly one existing `ditto-ayan-db`, converged existing Alchemy v2
ownership, bounded migration-only dry run, and pre-counts captured. Absence is
the expected current blocker and is not a failure of local code; any ambiguous
remote ownership is a hard STOP.

### Step 9: Deploy migration 0012 through Alchemy and smoke it

Only after Step 8 passes:

```bash
set -euo pipefail
pnpm exec alchemy deploy --stage dev --dry-run \
  | tee /tmp/ditto-041-plan.txt
pnpm exec alchemy deploy --stage dev --yes \
  | tee /tmp/ditto-041-deploy.txt
```

Do not paste deploy output into evidence until reviewed for secret-bearing
values. Then run metadata-only remote assertions with
`wrangler d1 execute ... --remote --json`:

1. `drizzle_migrations` count equals the checked-in top-level SQL migration
   count and increased by exactly one from Step 8.
2. `sqlite_master` contains exactly `agent_runs`, `pi_agent_sessions`, and
   `turns` plus the expected named indexes/checks.
3. `PRAGMA table_info` confirms required columns/nullability/defaults.
4. `PRAGMA foreign_key_list` confirms the declared parents/deletion actions.
5. `PRAGMA foreign_key_check` returns no rows.
6. `PRAGMA integrity_check` returns `ok`.
7. Pre-existing `projects`, `workspace_sessions`, and `messages` counts exactly
   equal Step 8 counts; new tables have zero rows because the current runtime is
   intentionally not wired.
8. A second Alchemy dry run reports `Plan: no changes`.

Example table presence query (safe metadata only):

```bash
pnpm --filter @ditto/web exec wrangler d1 execute ditto-ayan-db \
  --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_runs','pi_agent_sessions','turns') ORDER BY name" \
  | jq -e '.[0].results | map(.name) == ["agent_runs","pi_agent_sessions","turns"]'
```

If Wrangler's JSON envelope has changed, inspect keys/schema only and update the
`jq` projection; do not weaken the semantic assertion. If migration fails,
counts change, FKs fail, or convergence is not clean, mark `BLOCKED`, preserve
recovery identifiers, and stop. Do not hand-edit remote schema or apply the
migration again with Wrangler.

### Step 10: Record evidence and finish

Append an **Execution evidence** section containing only:

- date, executor, branch/worktree, implementation commit;
- exact installed Drizzle, Wrangler, and retrieved Workers-types versions;
- local empty/existing migration, transition, acceptance/idempotency/race,
  ownership, typecheck, focused, and full-gate PASS/FAIL;
- exact changed-file list;
- remote database name and non-secret ID/bookmark if Step 8 ran;
- migration count before/after, schema/FK/integrity/count/convergence PASS/FAIL;
- no row contents, prompts, message text, credentials, env values, generated
  configs, cookies, headers, or deploy output bodies;
- the first unrun/failed cloud gate and accurate status.

Status rules:

- `DONE`: all local gates and Steps 8–9 deployed smoke pass.
- `DONE-local (BLOCKED for full DONE: deployed ayan D1 migration smoke unavailable)`:
  all local gates pass, but the exact remote D1/accepted Plan 039 cloud graph is
  absent or not authorized. No dependent production work may start.
- `BLOCKED (<first failed gate>)`: local invariants fail, current D1 batch cannot
  express acceptance, or a present remote migration/smoke fails.

Final local checks:

```bash
set -euo pipefail
pnpm verify
git diff --check
git status --short
git diff --name-only e3abdee..HEAD
```

Expected: verification green and every changed source/generated path is in
Scope.

## Test plan

### Migration tests

`apps/web/src/db/agent-run-migration.test.ts`, following
`session-preview-migration.test.ts`:

- all migrations on empty DB;
- existing 0011 DB with preserved rows;
- exact tables/columns/defaults/checks/indexes/FKs;
- historical legacy run tables stay absent;
- constraint and cascade matrix.

### Persistence tests

`apps/web/src/lib/agent-run-persistence.test.ts`:

- accepted first run is one atomic run/Turn/user/pending-assistant result;
- active follow-up ordering;
- successor routing for stopping/finalizing/all terminals;
- exact duplicate and conflicting idempotency reuse;
- failure at every batch position rolls back all writes;
- duplicate/successor/Stop-finalize races;
- all legal/illegal lifecycle transitions;
- monotonic/stale epochs;
- Stop intent ordering/idempotency;
- assistant terminal immutability and terminal-run pending-assistant guard;
- cross-user/project/session ownership denial on every public operation;
- rejected credential-shaped/out-of-bound outcome metadata.

Use a test-only minimal D1 `prepare/bind/batch` shim backed by `node:sqlite` if
needed to execute the exact production SQL and rollback semantics. Keep it in
the test file; do not add a production adapter interface or dependency solely
for tests.

### Regression tests

Re-run current request-owned agent service/control/route and Workspace Session
tests to prove no behavior cutover occurred.

## Done criteria

ALL local criteria must hold, and cloud criteria must hold for full DONE:

- [ ] `agent_runs`, `pi_agent_sessions`, and `turns` exist in schema and one
      generated 0012 migration/snapshot/journal entry.
- [ ] Existing migrations 0000–0011 and existing rows are unchanged.
- [ ] Exact eight-state run vocabulary and legal transition table are tested.
- [ ] Terminal run outcome cannot change or reopen.
- [ ] Run and Turn sequences are positive, unique, ordered, and race-tested.
- [ ] Acceptance atomically creates run + Turn 1 + complete user + pending
      assistant; injected batch failures leave none of them.
- [ ] Exact duplicate request IDs return identical persisted IDs; conflicting
      reuse returns 409 with no write, including concurrent races.
- [ ] Input during stopping/finalizing/terminal targets one ordered successor;
      predecessor never changes.
- [ ] Stop intent persists before any future signal and is idempotent.
- [ ] Current Execution Epoch is nullable/positive, monotonic, and stale-CAS
      protected.
- [ ] User message bytes are complete; accepted content is not truncated.
- [ ] Assistant messages are pending then terminal and cannot return to pending.
- [ ] Every public query/mutation scopes user + project + Workspace Session and
      passes cross-ownership tests.
- [ ] No credential/process/Workflow/Brain/R2/browser field exists in run/Turn
      rows; D1 remains conversation/outcome authority.
- [ ] Current Pi/Sandbox/SSE/control/browser behavior is unchanged and not
      dual-writing the new tables.
- [ ] No Brain DO/SQLite, Workflow, event journal, fence, checkpoint, lease,
      Sandbox `@next`, dependency, lockfile, or infrastructure change exists.
- [ ] Focused tests, typecheck, Biome, `pnpm verify`, and `git diff --check` pass.
- [ ] Exactly one pre-existing deployed `ditto-ayan-db` received migration 0012
      through Alchemy stage `dev`; migration count/schema/FKs/integrity/old-row
      counts/convergence passed. **Required for full DONE.**
- [ ] Evidence and `plans/README.md` status use DONE/DONE-local/BLOCKED exactly as
      defined; no cloud evidence is invented.

## STOP conditions

Stop and report back — do not improvise — if:

- A terminal Agent Run must reopen, accept another Turn, change terminal outcome,
  or be reused as a retry container.
- Conversation/Turn/outcome truth would need to live in browser memory, PI
  memory/JSONL, Brain SQLite, Workflow state, R2, Sandbox files, or an in-memory
  map instead of D1.
- Provider/project/GitHub credentials, cookies, headers, encrypted credentials,
  environment values, callback tokens, or raw exceptions would need persisted
  run/Turn fields.
- Current D1 `batch()` docs/types no longer guarantee one rollback-capable SQL
  transaction, or the acceptance bundle cannot be expressed with prepared
  statements and bounded CAS retries.
- Drizzle generation requires modifying old migrations, rebuilding/dropping an
  existing current table, losing rows, or diverging schema/snapshot/SQL.
- Existing databases may still contain the pre-0006 legacy `agent_runs` shape at
  the 0011 boundary; do not use `CREATE TABLE IF NOT EXISTS` to hide that drift.
- A state outside the exact vocabulary or a direct non-finalizing terminal edge
  is required.
- Gap-free run/Turn ordering or one-successor-per-predecessor cannot be enforced
  under concurrent requests with current D1 constraints.
- Exact duplicate/conflicting request reuse cannot be distinguished from D1
  rows without persisting a credential-bearing/raw request blob.
- Ownership-safe access would require trusting a run/request/message ID without
  user + project + Workspace Session predicates.
- The current `/api/agent/*`, runner, Sandbox, browser, or Workflow path must be
  wired or changed to make local tests pass. That cutover belongs later.
- An event table, generic repository framework, global lock, new dependency,
  package/lockfile change, Brain/Workflow resource, Sandbox migration, or
  unrelated refactor appears necessary.
- The baseline or a required verification fails twice after one reasonable
  in-scope correction.
- Cloud preflight finds zero/multiple `ditto-ayan-db` databases, absent/ambiguous
  Alchemy state, uncompleted Plan 039 cloud ownership, or a dry run that creates,
  adopts, replaces, deletes, or mutates unrelated resources. Record DONE-local
  if local gates passed; do not create the missing stack.
- A present remote migration fails, changes old row counts, leaves FK/integrity
  errors, or does not converge. Mark BLOCKED and do not hand-edit/reapply.
- Any evidence step would reveal message contents, prompts, credentials, env
  values, cookies, headers, generated secret-bearing config, or raw deploy
  output.

## Maintenance notes

- Plan 041 is a dormant, tested persistence foundation until a later plan makes
  Brain/Workflow the owner. Reviewers should reject any opportunistic current
  route dual-write because it creates durable rows without a durable finalizer.
- Future Brain work should derive one Brain stub from trusted `projectId`; it
  must not introduce a second conversation/outcome database. Brain SQLite may
  cache sessions/checkpoints/fences but D1 remains authoritative.
- Future Workflow/finalization work must preserve this transition table, advance
  epochs with CAS, settle pending assistants before terminal outcome, and add
  checkpoint/backup requirements before terminal completion rather than
  weakening current invariants.
- If future product requirements need multiple kinds of control intent, add a
  dedicated ordered control table then. One durable Stop intent is enough for
  this plan; do not scaffold a generic command bus now.
- Review the generated migration more closely than the TypeScript enum types:
  SQLite CHECKs, unique predecessor/request/order constraints, and FK actions are
  what protect data outside application typechecking.
- Plan 040 remains absent. It is a mutually exclusive no-GO contingency, not a
  prerequisite or compatibility layer for this GO-route foundation.

## Execution evidence (redacted)

- Date: 2026-08-11. Executor: isolated worktree on branch
  `advisor/041-model-durable-agent-runs-in-d1`; no deploy, push, merge, or PR
  was performed.
- Install preflight: frozen pnpm and sandbox-runner npm installs passed after
  the explicitly authorized minimum-release-age override; Drizzle was 0.45.2.
- Local implementation: migration 0012, ownership-safe persistence, bounded
  CAS/retry handling, batch result inspection, successor routing, and the
  expanded migration/persistence matrices are present. No credential, token,
  prompt, cookie, header, environment value, or deploy-output body was recorded.
- Verification: exact acceptance filter passed (3 tests); exact transition,
  epoch, stop, terminal, assistant, and ownership filter passed (4 tests);
  migration plus persistence suite passed (2 files, 12 tests); current runtime
  regression suite passed (5 files, 67 tests); typecheck and Biome passed;
  full `pnpm verify` passed; `git diff --check` passed; storage-field source
  guard passed.
- Cloud boundary: read-only D1 inventory found 0 exact `ditto-ayan-db` name
  matches. The required Plan 039-owned, converged remote graph therefore
  could not be demonstrated. Steps 8–9 were skipped and status is
  `DONE-local` / STOPPED at the cloud boundary; no infrastructure was created,
  adopted, replaced, or mutated.
- Final revision verification: migration plus persistence passed (2 files,
  15 tests); acceptance filter passed 5 tests; transition/epoch/stop/terminal/
  assistant/ownership filter passed 6 tests; runtime regression passed 67
  tests; typecheck, Biome, `pnpm verify`, source guards, storage guard, and
  `git diff --check` all passed.
