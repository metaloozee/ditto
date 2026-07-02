# Plan 025: Prove the Four-Layer Flue Integration Boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat a5611fa..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml alchemy.run.ts tsconfig.json biome.json types/env.d.ts src/server.ts src/db/schema.ts src/integrations/trpc/routers/workspace.ts src/lib/workspace-session-broker.ts src/lib/project-sandbox.ts src/lib/sandbox-bootstrap.ts src/lib/sandbox-backup.ts src/lib/workspace-policy.ts src/routes/api.workspace.session.$sessionId.socket.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md .flue flue.config.ts src/lib/project-coordinator.ts src/lib/project-agent-run-contract.ts docs/decisions
> git diff --stat -- package.json pnpm-lock.yaml pnpm-workspace.yaml alchemy.run.ts tsconfig.json biome.json types/env.d.ts src/server.ts src/db/schema.ts src/integrations/trpc/routers/workspace.ts src/lib/workspace-session-broker.ts src/lib/project-sandbox.ts src/lib/sandbox-bootstrap.ts src/lib/sandbox-backup.ts src/lib/workspace-policy.ts src/routes/api.workspace.session.$sessionId.socket.ts docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md .flue flue.config.ts src/lib/project-coordinator.ts src/lib/project-agent-run-contract.ts docs/decisions
> ```
>
> This plan was reconciled against commit `a5611fa` after the four-layer PRD and
> plan index landed. If either command shows changes, compare the "Current state"
> excerpts below against the live code before proceeding. If an excerpt no longer
> matches and the difference is not merely formatting, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: direction / migration / architecture
- **Planned at**: commit `a5611fa`, 2026-07-02

## Why this matters

`docs/four-layer-flue-workflow-rewrite-prd.md` supersedes the earlier Pi runner,
broker, and Flue harness plans where they conflict. The existing TODO runner
plans continue improving the now-superseded Pi runner path, so executing them
would spend effort on architecture the PRD no longer wants.

Do not start by rewriting the whole app. The highest-risk unknown is whether
TanStack Start, Flue's Cloudflare target, Alchemy-managed resources, the existing
Cloudflare Sandbox binding, and a new project-scoped coordinator Durable Object
can coexist without manual Cloudflare dashboard drift or a per-session sandbox
mistake. This plan proves that boundary, records the decisions, and leaves the
next implementation agent with a stable foundation for smaller follow-up plans.

## Current state

Relevant files:

- `docs/four-layer-flue-workflow-rewrite-prd.md` - new source-of-truth PRD for the four-layer rewrite.
- `plans/README.md` - plan index; prior TODO plans 021-024 target the superseded Pi runner path.
- `package.json` - pnpm package manifest; currently has Cloudflare Sandbox, Alchemy, TanStack Start, Drizzle, tRPC, and Pi runner dependencies, but no Flue packages.
- `alchemy.run.ts` - declares D1, R2, the Sandbox Durable Object namespace, and the session-scoped `WorkspaceSessionBroker` namespace.
- `src/server.ts` - current Worker entrypoint; exports Durable Object classes and delegates HTTP to TanStack Start.
- `src/db/schema.ts` - D1 app metadata tables for projects, sessions, runs, and run events.
- `src/integrations/trpc/routers/workspace.ts` - current authenticated product boundary for session history, `startRun`, `cancelRun`, and `answerRunQuestion`.
- `src/lib/workspace-session-broker.ts` - current session-scoped Durable Object that launches the Pi SDK runner in the sandbox; it is not the PRD's project coordinator.
- `src/lib/project-sandbox.ts`, `src/lib/sandbox-bootstrap.ts`, and `src/lib/sandbox-backup.ts` - existing project sandbox readiness, restore, bootstrap, and backup helpers that must be reused instead of recreated.

The PRD makes the new architecture binding:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:274-283
### 1. Four-layer ownership is binding

Future plans should preserve the four ownership layers unless this PRD is amended.

| Layer | Owns | Must not own |
|---|---|---|
| TanStack Start | Product UI, auth, server functions, tRPC, user-visible state | Agent harness internals, direct filesystem mutation, live lock authority |
| Alchemy + D1 + R2 | Infrastructure declaration, app metadata, snapshot/artifact storage | Canonical agent transcript, live lock serialization |
| Project coordinator Durable Object | Project lease, queue, live event hub, coordination state | Large blobs, full transcript, workspace files |
| Flue + Cloudflare Sandbox | Agent orchestration, canonical conversation, tools, skills, sandbox commands/files | Product authorization, app metadata, explicit external export actions |
```

The PRD explicitly keeps one project sandbox while treating the current runner as
non-binding:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:7-9
**Supersedes for future planning:** earlier runner / broker / Flue harness PRDs and plans where they conflict with this document.

This PRD intentionally treats the existing runner, sandbox, and persistence implementation as non-binding. The durable product model remains: **one project has one sandbox; a project can have many sessions and runs over time; sandbox hibernation must not lose state; only one mutating agent may hold the edit lease at a time.**
```

The PRD requires a project coordinator, not a session broker, to become the live
authority:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:389-442
### 8. The project coordinator Durable Object is the live authority

The coordinator should be addressed deterministically by project ID.
...
Coordinator responsibilities:

- grant one mutation lease at a time;
- grant read-only admission during mutation only with read-only capabilities;
- reject or queue mutating requests when a mutation lease is active;
- persist lease state before broadcasting it;
- use fencing tokens so stale holders cannot mutate after lease loss;
- renew active leases while work is progressing;
- expire or recover stale leases;
- broadcast state changes to connected clients;
- update D1 projections after state changes;
- call into Flue only after admission is accepted.
```

The PRD says Flue is the agent runtime, but the normal chat loop must be a
continuing agent, not a one-shot workflow:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:470-488
### 10. Flue is the agent orchestration layer

The primary coding assistant should be implemented as a Flue agent, not a hand-rolled runner.
...
Flue workflows should be reserved for bounded jobs that run once and return a result, such as PR summary generation, repo health scans, snapshot validation, or eval tasks. The normal chat loop should use a continuing Flue agent.
```

The first phase is an integration proof, not a complete rewrite:

```md
// docs/four-layer-flue-workflow-rewrite-prd.md:669-678
### 21. Release sequencing

This rewrite should be completed through multiple small plans. Recommended phases:

#### Phase 0: Architecture spike and integration proof

- Prove how TanStack Start, Flue Cloudflare target, Alchemy, and Cloudflare Sandbox coexist in one deployable Worker or a deliberately split Worker arrangement.
- Prove the product-session to Flue-session mapping.
- Prove authenticated server-owned admission to a Flue agent.
- Prove the project coordinator can admit a run and observe terminal state.
```

The app currently has no Flue dependency in `package.json`:

```json
// package.json:26-61
"dependencies": {
  "@base-ui/react": "^1.6.0",
  "@cloudflare/sandbox": "^0.12.1",
  "@faker-js/faker": "^10.3.0",
  "@fontsource-variable/geist": "^5.2.9",
  "@fontsource-variable/inter": "^5.2.8",
  "@pierre/diffs": "^1.2.7",
  "@pierre/trees": "1.0.0-beta.4",
  "@shadcn/react": "^0.1.0",
  "@t3-oss/env-core": "^0.13.10",
  "@tailwindcss/vite": "^4.1.18",
  "@tanstack/ai": "latest",
  "@tanstack/ai-anthropic": "latest",
  "@tanstack/ai-client": "latest",
  "@tanstack/ai-gemini": "latest",
  "@tanstack/ai-ollama": "latest",
  "@tanstack/ai-openai": "latest",
  "@tanstack/ai-react": "latest",
  "@tanstack/match-sorter-utils": "latest",
  "@tanstack/react-devtools": "latest",
  "@tanstack/react-form": "latest",
  "@tanstack/react-query": "latest",
  "@tanstack/react-query-devtools": "latest",
  "@tanstack/react-router": "latest",
  "@tanstack/react-router-devtools": "latest",
  "@tanstack/react-router-ssr-query": "latest",
  "@tanstack/react-start": "latest",
  "@tanstack/react-store": "latest",
  "@tanstack/react-table": "latest",
  "@tanstack/router-plugin": "^1.132.0",
  "@tanstack/store": "latest",
  "@trpc/client": "^11.11.0",
  "@trpc/server": "^11.11.0",
  "@trpc/tanstack-react-query": "^11.11.0",
  "ai": "^6.0.197",
  "alchemy": "^0.93.11",
```

Alchemy currently declares the Sandbox and session broker namespaces, not a
project coordinator or Flue Worker:

```ts
// alchemy.run.ts:14-23
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});

const workspaceSessionBroker = DurableObjectNamespace("workspace-session-broker", {
	className: "WorkspaceSessionBroker",
	sqlite: true,
});
```

```ts
// alchemy.run.ts:35-56
export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		Sandbox: sandbox,
		WorkspaceSessionBroker: workspaceSessionBroker,
		BACKUP_BUCKET: sandboxBackups,
		BACKUP_BUCKET_NAME: sandboxBackupBucketName,
		CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
		R2_ACCESS_KEY_ID: alchemy.secret(process.env.R2_ACCESS_KEY_ID),
		R2_SECRET_ACCESS_KEY: alchemy.secret(process.env.R2_SECRET_ACCESS_KEY),
		USE_LOCAL_BUCKET_BACKUPS: process.env.USE_LOCAL_BUCKET_BACKUPS ?? "",
		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
		GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
		GITHUB_APP_PRIVATE_KEY: alchemy.secret(process.env.GITHUB_APP_PRIVATE_KEY),
		OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
		APP_ENV: app.stage,
		VITE_GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL ?? "https://github.com/apps/ditto-web/installations/new/",
	},
```

```ts
// alchemy.run.ts:69-85
durable_objects: {
	...spec.durable_objects,
	bindings: [
		{
			class_name: "Sandbox",
			name: "Sandbox",
		},
		{
			class_name: "WorkspaceSessionBroker",
			name: "WorkspaceSessionBroker",
		},
	],
},
migrations: [
	{ new_sqlite_classes: ["Sandbox"], tag: "v1" },
	{ new_sqlite_classes: ["WorkspaceSessionBroker"], tag: "v2" },
],
```

The Worker entrypoint exports only the Sandbox and session broker DO classes:

```ts
// src/server.ts:1-9
import handler from "@tanstack/react-start/server-entry";
import { WorkspaceSessionBroker } from "#/lib/workspace-session-broker";

export { Sandbox } from "@cloudflare/sandbox";
export { WorkspaceSessionBroker };

export default {
	fetch: handler.fetch,
};
```

The D1 schema currently stores product metadata and a D1-projected mutating lock
on `projects`, plus product sessions, runs, and events:

```ts
// src/db/schema.ts:34-60
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
		sandboxBackup: text("sandboxBackup"),
		sandboxBackupCreatedAt: integer("sandboxBackupCreatedAt", {
			mode: "timestamp",
		}),
		activeAgentRunId: text("activeAgentRunId"),
		activeAgentRunStartedAt: integer("activeAgentRunStartedAt", {
			mode: "timestamp",
		}),
		status: text("status", {
```

```ts
// src/db/schema.ts:101-133
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
		modelSpecifier: text("modelSpecifier")
			.notNull()
			.default(DEFAULT_PROJECT_CODER_MODEL),
		userMessage: text("userMessage").notNull(),
		question: text("question"),
		recommendedAnswer: text("recommendedAnswer"),
```

`workspace.startRun` currently enforces mutating concurrency in D1 and then posts
to a session-scoped broker by `sessionId`:

```ts
// src/integrations/trpc/routers/workspace.ts:311-425
if (input.isMutating && project.activeAgentRunId) {
	const previousRunId = project.activeAgentRunId;
	const [existingRun] = await db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.id, previousRunId))
		.limit(1);
...
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
...
	ownsProjectLock = true;
}
```

```ts
// src/integrations/trpc/routers/workspace.ts:453-475
async function startBroker() {
	if (!project.sandboxId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Project sandbox is not ready yet.",
		});
	}

	await postWorkspaceSessionBroker({
		env: ctx.env,
		sessionId,
		path: "/start",
		body: {
			sessionId,
			userId: ctx.user.id,
			projectId: input.projectId,
			sandboxId: project.sandboxId,
			runId,
			message: input.message,
			modelSpecifier: input.modelSpecifier,
			isMutating: input.isMutating,
		},
	});
}
```

The current Durable Object is session-scoped and runner-specific:

```ts
// src/lib/workspace-session-broker.ts:43-54
type BrokerState = {
	sessionId?: string;
	userId?: string;
	projectId?: string;
	sandboxId?: string;
	activeRunId?: string;
	isMutating?: boolean;
	runnerProcessId?: string;
	fifoPath?: string;
	pendingInputRequestId?: string;
	canceledRunIds?: string[];
};
```

```ts
// src/lib/workspace-session-broker.ts:249-269
private async start(input: StartRequest): Promise<void> {
	this.assistantDraft.clear();
	const state: BrokerState = {
		...(await this.getState()),
		sessionId: input.sessionId,
		userId: input.userId,
		projectId: input.projectId,
		sandboxId: input.sandboxId,
		activeRunId: input.runId,
		isMutating: input.isMutating,
		pendingInputRequestId: undefined,
	};
	await this.setState(state);
	await this.ensureRunnerProcess(input);
	await this.waitForRunnerReady();
	await this.sendRunnerCommand({
		type: "prompt",
		id: input.runId,
		message: input.message,
	});
}
```

Existing sandbox helpers already enforce one project sandbox and must be reused:

```ts
// src/lib/sandbox-bootstrap.ts:11-19
export function getProjectSandbox(env: Env, sandboxId: string) {
	return getSandbox(
		env.Sandbox as Parameters<typeof getSandbox>[0],
		sandboxId,
		{
			enableDefaultSession: false,
		},
	);
}
```

```ts
// src/lib/project-sandbox.ts:104-127
export async function ensureProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
	envVars: SandboxEnvVar[];
}): Promise<EnsureProjectSandboxResult> {
	if (options.project.status !== "ready" || !options.project.sandboxId) {
		throw new Error("Project sandbox is not ready yet.");
	}
...
	const sandboxId = options.project.sandboxId;
	const hydrated = await isSandboxWorkspaceHydrated({
		env: options.env,
		sandboxId,
	});

	if (hydrated) {
		return { project: options.project, state: "connected" };
	}
```

Current verification baseline from recon:

- `pnpm exec tsc --noEmit --pretty false` exits 0.
- `pnpm lint` exits 0 with only the two known warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- `pnpm test` exits 0 with 6 files and 53 tests passing.
- `git diff --check` exits 0.

Current documentation facts checked during plan writing:

- Flue's Cloudflare Sandbox example imports `createAgent` from `@flue/runtime`, wraps `getSandbox(env.Sandbox, id)` with `cloudflareSandbox(...)`, and passes that sandbox into the agent.
- Alchemy supports `DurableObjectNamespace(..., { className, sqlite: true })` and binding it into a Worker/TanStack Start resource.
- Alchemy supports a `wrangler.transform` hook on `TanStackStart` for adding container, Durable Object, and migration config.
- Cloudflare Worker configuration for containers requires a container class, Durable Object binding, and migration entry with `new_sqlite_classes`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install current deps | `pnpm install` | exit 0; lockfile unchanged unless dependency steps below are intentionally run |
| Install Flue runtime deps | `pnpm add @flue/runtime@1.0.0-beta.1 'agents@^0.14.2' hono` | exit 0 and updates `package.json` / `pnpm-lock.yaml`; STOP if these versions are unavailable or installed docs conflict with them |
| Install Flue CLI | `pnpm add -D @flue/cli@1.0.0-beta.1` | exit 0 and updates `package.json` / `pnpm-lock.yaml`; STOP if unavailable |
| Flue docs check | `npx flue docs read guide/targets/cloudflare` | exit 0 and documents the installed Cloudflare target API, or use the exact installed docs page name printed by `npx flue docs search cloudflare` |
| Flue build | `npx flue build --target cloudflare` | exit 0; generated entrypoint, Durable Object class names, and generated wrangler config are recorded in the decision doc |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| Lint | `pnpm lint` | exit 0; only the two pre-existing warnings in `grainient.tsx:297` and `sidebar.tsx:85` are allowed |
| Tests | `pnpm test` | exit 0; existing tests plus new contract/coordinator tests pass |
| Whitespace | `git diff --check` | exit 0 with no output |

Do not run `pnpm format`, `pnpm check --write`, `pnpm fix`, `pnpm deploy`, or
`pnpm destroy` unless the operator explicitly asks. Do not commit provider
credentials, `.env`, `.dev.vars`, generated local Alchemy state, or secret-bearing
command output.

## Suggested Executor Toolkit

- If available, use the `workers-best-practices`, `durable-objects`, and `sandbox-sdk` skills before editing Worker, Durable Object, Alchemy, or Sandbox integration code.
- Use the installed Flue CLI docs after adding `@flue/cli`: search/read the Cloudflare target, agent API, session API, database, and sandbox pages. Installed docs outrank older plan excerpts.
- Use the PRD as the source of product truth. Treat older plans 016-024 as historical data only where they explain prior failures.

## Scope

**In scope**:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml` only if pnpm requires an `allowBuilds` update for new packages
- `flue.config.ts` (create)
- `.flue/app.ts` (create only if the chosen Flue build path needs an authored app)
- `.flue/agents/project-coder.ts` (create a minimal non-mutating/read-only spike agent)
- `.flue/agents/project-coder-instructions.md` (create if the installed Flue API supports instruction files)
- `.flue/cloudflare.ts` or generated-entrypoint adapter file only if installed Flue docs require it for Cloudflare exports
- `alchemy.run.ts`
- `types/env.d.ts` only if Alchemy type inference needs a binding type adjustment
- `src/server.ts`
- `src/lib/project-coordinator.ts` (create)
- `src/lib/project-agent-run-contract.ts` (create only if needed to keep admission/Flue dispatch testable without live credentials)
- `src/lib/project-agent-run-contract.test.ts` (create)
- `src/lib/project-coordinator.test.ts` (create a pure reducer/contract test if full DO tests are not available)
- `src/integrations/trpc/routers/workspace.ts` only for a narrow server-owned admission seam; do not complete the full `startRun` rewire in this plan
- `tsconfig.json` and `biome.json` only to include new `.flue/**/*.ts` / new source files in checks
- `docs/decisions/2026-07-02-four-layer-flue-integration-spike.md` (create)
- `plans/README.md` only to update this plan's status row if the reviewer did not already do it

**Out of scope**:

- Deleting the existing Pi runner, `WorkspaceSessionBroker`, runner protocol, or sandbox runner files.
- Rewriting the browser chat UI or WebSocket hook.
- Implementing mutating Flue tools, write/patch/delete, command execution, preview management, diff artifacts, or snapshot checkpoints.
- Replacing all D1 lock fields. D1 lock fields may remain as projections until a later migration plan.
- Making D1 the canonical Flue transcript store.
- Storing full logs, full diffs, workspace archives, or Flue canonical transcript copies in D1.
- Adding GitHub push, branch, PR, deploy, or sandbox-destroy actions.
- Adding a broad browser automation harness.
- Publishing GitHub issues or deploying Cloudflare resources.

## Git workflow

- Branch: `advisor/025-four-layer-flue-spike` if you create a branch.
- Commit message style: Conventional Commits, e.g. `feat(flue): prove four-layer integration`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Reconfirm the source-of-truth boundary and baseline

Read `docs/four-layer-flue-workflow-rewrite-prd.md` fully before editing. Confirm
that `plans/README.md` marks plans 021-024 as superseded/rejected. If the index
still shows them as TODO, update only the index rows to `REJECTED (superseded by
four-layer Flue rewrite PRD; do not execute)` before continuing.

Run the baseline commands from the table:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Expected result: typecheck exits 0, lint exits 0 with only the two known warnings,
tests exit 0, and whitespace check emits no output.

**Verify**: the four commands above match the expected result. If they fail due
to unrelated dirty worktree changes, STOP and ask the operator whether to base
the spike on the dirty state or wait for those changes to land.

### Step 2: Add the smallest Flue Cloudflare spike source

Install the pinned Flue dependencies from the command table. These versions are
chosen because the prior plan 016 spike proved `npx flue build --target
cloudflare` with the beta.1 generation path. Do not silently replace them with
latest packages. If the packages are unavailable or the installed docs no longer
match the API, STOP and report the package/version mismatch.

Create `flue.config.ts` using the installed Flue config import. For beta.1 docs,
the expected shape is:

```ts
import { defineConfig } from "@flue/cli/config";

export default defineConfig({
	target: "cloudflare",
});
```

Create a minimal `.flue/agents/project-coder.ts` that proves the Cloudflare
target and sandbox adapter compile. Start from the installed docs. The current
Context7-backed Cloudflare Sandbox example has this shape:

```ts
import { getSandbox } from "@cloudflare/sandbox";
import { createAgent, type AgentRouteHandler } from "@flue/runtime";
import { cloudflareSandbox } from "@flue/runtime/cloudflare";

export const route: AgentRouteHandler = async (_c, next) => next();

export default createAgent(({ id, env }) => ({
	model: "anthropic/claude-sonnet-4-6",
	sandbox: cloudflareSandbox(getSandbox(env.Sandbox, id)),
}));
```

Important: the snippet above is only the docs starting point. The final Ditto
mapping must not accidentally create one sandbox per product session. During the
spike, test and document which one of these mappings the installed Flue API
supports:

- Preferred: project-scoped Flue agent instance, named Flue session selected from the product session ID, and `getSandbox(env.Sandbox, project.sandboxId)`.
- Acceptable fallback: product session identity encoded in the Flue agent instance ID, while the sandbox ID is still explicitly the project sandbox ID.
- Not acceptable: a product session or run ID directly becomes the Cloudflare Sandbox ID.

Update `tsconfig.json` and `biome.json` so `.flue/**/*.ts` is included in editor,
typecheck, and lint coverage. Keep Biome conventions: tabs and double quotes.

**Verify**:

```bash
npx flue docs search cloudflare
npx flue docs read guide/targets/cloudflare
npx flue build --target cloudflare
pnpm exec tsc --noEmit --pretty false
pnpm lint
```

Expected result: Flue docs commands exit 0, Flue build exits 0, typecheck exits
0, and lint exits 0 with only the two known warnings. If the installed docs use
different page names, record the exact page names in the decision doc and use
those. If Flue build succeeds but emits generated files, do not commit generated
artifacts unless the installed docs explicitly require it.

### Step 3: Prove the Worker topology and Alchemy resource path

Prefer a deliberately split Worker arrangement unless the installed Flue docs
make same-Worker composition simpler and clearly safe. The prior plan 016 attempt
stopped because Flue's generated Worker entrypoint and Ditto's `src/server.ts`
entrypoint both wanted to own `fetch`; a private Flue Worker behind a service
binding avoids merging two generated fetch roots.

In `docs/decisions/2026-07-02-four-layer-flue-integration-spike.md`, create a
decision table with these rows before editing `alchemy.run.ts`:

| Question | Decision | Evidence | Follow-up plan |
|---|---|---|---|
| Same Worker or split Worker? | TBD | installed Flue/Alchemy proof | 026 |
| How is Flue build invoked by Alchemy without dashboard drift? | TBD | generated entrypoint/config path | 026 |
| Which Flue DO classes and migrations are required? | TBD | generated wrangler/config output | 026 |
| How does a product session select a Flue session? | TBD | installed session/dispatch API | 027 |
| How is the project sandbox ID passed to Flue? | TBD | spike source/build result | 027 |
| First model/provider for the spike | TBD | env bindings and installed docs | 027 |

Then prove one deployable topology in code.

Preferred topology:

- `website` remains the public TanStack Start Worker and owns Better Auth, tRPC, product authorization, D1 app metadata, project/session/run rows, and same-origin browser routes.
- A new private Flue Worker owns Flue's generated Cloudflare runtime and generated Flue Durable Objects.
- The `website` Worker binds to the Flue Worker through a service binding such as `FLUE_WORKER`.
- Both Workers can access the same project Sandbox namespace if needed, but only the server-owned admission path can call Flue for a project/run.
- No public unauthenticated Flue route is exposed.

Use Alchemy APIs documented for this repo's installed `alchemy` version. Do not
hand-edit generated `.alchemy/` or `.wrangler/` files. If Alchemy cannot express
the Flue Worker, generated Flue DO classes, migrations, and Sandbox binding
without manual dashboard edits, STOP and report that as the spike result.

If you add a Flue Worker resource, update `types/env.d.ts` only as needed for
the `FLUE_WORKER` binding to typecheck. Do not leak secrets into the decision
doc. Reference only binding names such as `ANTHROPIC_API_KEY` or
`OPENCODE_API_KEY` if needed.

**Verify**:

```bash
npx flue build --target cloudflare
pnpm exec tsc --noEmit --pretty false
pnpm lint
git diff --check
```

Expected result: Flue build and repo checks exit 0. The decision doc records the
exact generated Flue entrypoint path, generated Durable Object class names,
generated migration tags/classes, and the Alchemy expression used to include
them. If any value is unknown, the status row for this plan must be `BLOCKED`,
not `DONE`.

### Step 4: Add the minimal project coordinator Durable Object proof

Create `src/lib/project-coordinator.ts` and export it from `src/server.ts`.
Declare a new Alchemy Durable Object namespace in `alchemy.run.ts`:

```ts
const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	sqlite: true,
});
```

Bind it into `website` as `ProjectCoordinator`, add it to the TanStack
`wrangler.transform` Durable Object bindings, and add a new migration tag after
the existing `v1`/`v2` tags. Do not rename or remove the existing Sandbox or
`WorkspaceSessionBroker` bindings in this plan.

Implement only these coordinator endpoints for the proof:

- `POST /admit` with `{ projectId, runId, sessionId, userId, mode }`, where `mode` is `"mutating" | "read_only"`.
- `POST /terminal` with `{ projectId, runId, status }`, where `status` is `"completed" | "failed" | "canceled"`.
- `GET /status` returning the current coordinator state snapshot.

Minimal behavior for this proof:

- The coordinator is addressed by `idFromName(projectId)`, never by session ID.
- One mutating lease may be active at a time.
- A second mutating admission while a lease is active returns HTTP 409 with a stable message.
- A read-only admission may be accepted while a mutating lease is active, but it must return a response that makes clear no mutating capabilities are granted.
- Terminal for the owning run releases the mutation lease.
- Terminal for a different run must not release another run's mutation lease.
- State is persisted before a response is returned.

Use the existing `WorkspaceSessionBroker` style for Durable Object class shape,
request parsing, stable errors, and WebSocket-free state storage. A full SQLite
schema and FIFO queue are Phase 1 work; do not build the queue in this plan.
If you can use `ctx.storage.sql` cleanly for a tiny SQLite table, do so. If that
would consume the plan, use `ctx.storage.get/put` for the proof and record in the
decision doc that Phase 1 must move to explicit SQLite tables before queueing.

Add unit coverage for the lease decisions. If the repo has no Durable Object test
harness, extract a small pure reducer/decision helper and test that instead in
`src/lib/project-coordinator.test.ts`. Follow the Vitest style from
`src/lib/runner-protocol.test.ts` and `src/lib/sandbox-backup.test.ts`: small
`describe` blocks, no live Cloudflare runtime, no credentials.

**Verify**:

```bash
pnpm test -- src/lib/project-coordinator.test.ts
pnpm exec tsc --noEmit --pretty false
pnpm lint
git diff --check
```

Expected result: coordinator tests pass, typecheck exits 0, lint exits 0 with
only the two known warnings, and whitespace check emits no output.

### Step 5: Prove authenticated server-owned admission without rewiring the UI

Add the narrowest possible server-owned admission seam. Prefer a pure function in
`src/lib/project-agent-run-contract.ts` that takes injected adapters instead of
calling live Flue or live Durable Objects directly. This keeps the proof testable
without credentials.

The contract should model this order from the PRD:

1. Authenticated product code has already loaded the user and project.
2. Product code has created or loaded the product session.
3. Product code has created the product run row and user message projection in D1.
4. Product code asks the project coordinator for admission.
5. Only after admission succeeds, product code dispatches to Flue.
6. Terminal status releases only the owning lease.

Do not fully rewire `workspace.startRun` yet unless the proof is naturally tiny.
If you touch `src/integrations/trpc/routers/workspace.ts`, keep the public input
shape unchanged and do not remove the existing `WorkspaceSessionBroker` path.
This plan is allowed to add an internal helper and tests; it is not allowed to
delete the Pi path.

Add tests in `src/lib/project-agent-run-contract.test.ts` covering:

- Mutating admission succeeds: fake coordinator `admit` is called before fake Flue `dispatch`, and the dispatch receives `projectId`, `sessionId`, `runId`, `sandboxId`, `modelSpecifier`, and message.
- Mutating admission rejected: fake Flue `dispatch` is not called and the result is a stable conflict/failure outcome.
- Read-only admission while mutating is represented without mutating capabilities.
- Terminal event for non-owner does not release the active lease.

Use fake adapters only. Do not call a real LLM, real Flue Worker, real Sandbox,
real D1, or real Cloudflare runtime in these tests.

**Verify**:

```bash
pnpm test -- src/lib/project-agent-run-contract.test.ts src/lib/project-coordinator.test.ts
pnpm exec tsc --noEmit --pretty false
pnpm lint
```

Expected result: new tests pass, typecheck exits 0, and lint exits 0 with only
the two known warnings.

### Step 6: Complete the decision document

Update `docs/decisions/2026-07-02-four-layer-flue-integration-spike.md` so it can
serve as the handoff for the next plans. It must include:

- The exact Flue package versions installed.
- The exact installed Flue docs pages used.
- The exact `npx flue build --target cloudflare` result.
- The generated Flue entrypoint path.
- The generated Flue Durable Object class names and migration requirements.
- The chosen Worker topology: same Worker or split Worker.
- How Alchemy will run or consume Flue generation without manual dashboard drift.
- The product-session to Flue-session mapping decision, or a blocked status with the exact missing API.
- How Flue receives the stable project sandbox ID without creating per-session sandboxes.
- The minimal coordinator API proven in this plan.
- The next recommended plan sequence, starting with infrastructure/data foundation only after this proof is DONE.

The document must explicitly say that plans 021-024 are not the path forward for
future runner work because they target the superseded Pi runner architecture.

**Verify**:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Expected result: all commands exit 0; lint has only the two known warnings.

### Step 7: Final scope check and index update

Confirm no out-of-scope source was removed. In particular, this plan must not
delete the existing Pi runner files, `WorkspaceSessionBroker`, or UI socket path.
They can remain until a later migration plan replaces the production route.

Update the `plans/README.md` status row for plan 025 to `DONE` if every done
criterion below is met. If the Flue/Alchemy/Sandbox topology is not proven, mark
it `BLOCKED (<one-line reason>)` and do not mark follow-up implementation plans
as ready.

**Verify**:

```bash
git diff --stat
git diff --check
```

Expected result: the diff includes only in-scope files, and whitespace check
emits no output.

## Test plan

- Add `src/lib/project-coordinator.test.ts` if a pure lease decision helper is needed. Cover first mutating admission, second mutating rejection, read-only admission during mutation, owner terminal release, and non-owner terminal no-op.
- Add `src/lib/project-agent-run-contract.test.ts` for fake coordinator + fake Flue dispatch ordering. Cover successful admission, rejected admission, read-only capability mode, and terminal ownership.
- Follow the existing Vitest style in `src/lib/runner-protocol.test.ts` and `src/lib/sandbox-backup.test.ts`: pure inputs, direct `expect(...)`, no network, no credentials, no Worker runtime.
- Run `pnpm test -- src/lib/project-coordinator.test.ts src/lib/project-agent-run-contract.test.ts` for the new tests.
- Run the full `pnpm test` before marking the plan done.

Optional manual smoke, only if the operator has credentials and explicitly wants
it during execution:

- Run `pnpm dev` and verify the app starts with the new Alchemy declarations.
- Use an authenticated browser session to open a project.
- Do not submit real mutating prompts through the Flue path unless the operator approves the live-provider spend.

## Done criteria

All must hold:

- [ ] `plans/README.md` marks plans 021-024 as rejected/superseded and plan 025 as the next TODO/DONE/BLOCKED item.
- [ ] `npx flue build --target cloudflare` exits 0 and the generated entrypoint/classes/migrations are recorded in `docs/decisions/2026-07-02-four-layer-flue-integration-spike.md`.
- [ ] The decision doc answers PRD open questions 1-3 with evidence: session mapping, Worker topology, and Alchemy/Flue migration integration.
- [ ] A project-scoped `ProjectCoordinator` Durable Object is declared and exported, or the plan is marked BLOCKED with the exact reason Alchemy/Workers cannot represent it.
- [ ] New contract/coordinator tests pass without live Cloudflare, Flue, LLM, Sandbox, or D1 credentials.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with only the two known warnings in `grainient.tsx:297` and `sidebar.tsx:85`.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] No provider keys, GitHub tokens, private keys, `.env` values, or secret-bearing command output appear in committed files, tests, docs, or plan updates.
- [ ] The existing Pi runner and `WorkspaceSessionBroker` are not deleted in this plan.

## STOP conditions

Stop and report back without improvising if:

- The code at the locations in "Current state" does not match the excerpts and the difference is not merely formatting.
- The Flue packages named in this plan are unavailable, or installed Flue docs contradict the expected `@flue/runtime` / Cloudflare target APIs.
- `npx flue build --target cloudflare` cannot produce a Cloudflare artifact without manual dashboard configuration.
- The generated Flue worker requires Durable Object class names, migrations, or bindings that Alchemy cannot declare or consume without generated-state drift.
- The only apparent Flue session mapping creates a new Cloudflare Sandbox per product session or per run.
- The only apparent Flue HTTP surface would expose unauthenticated public agent access.
- Proving the topology requires deleting or replacing `WorkspaceSessionBroker`, the Pi runner, or the browser chat UI in this plan.
- A step requires reading or printing secret values. Reference secret binding names only.
- A verification command fails twice after a reasonable fix attempt.
- You need to touch a file listed as out of scope.

## Maintenance notes

- This plan intentionally front-loads architecture proof. If it is BLOCKED, do not write Phase 1 implementation plans until the blocker is resolved.
- Future plans should start with the PRD's Phase 1: Alchemy resources, D1 metadata shape, R2 layout, project coordinator status APIs, and local development path.
- Later plans may delete or migrate the Pi runner path only after the Flue path admits a project run and can project terminal state durably.
- Reviewers should scrutinize whether the project sandbox ID remains project-scoped through every Flue call. This is the easiest high-impact mistake to miss.
- Reviewers should also verify that D1 remains product metadata/projection only; Flue canonical transcript data must not be duplicated as the app's authoritative transcript.
