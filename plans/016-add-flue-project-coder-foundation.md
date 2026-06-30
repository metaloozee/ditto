# Plan 016: Add the Flue project-coder foundation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat c52ca55..HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml flue.config.ts tsconfig.json biome.json alchemy.run.ts types/env.d.ts src/server.ts src/routes src/lib/flue-client.ts src/lib/agent-models.ts src/lib/user-preferences-store.ts src/db/schema.ts migrations src/integrations/trpc/routers/workspace.ts src/components/composer.tsx src/components/ai-chat.tsx .flue docs/flue-agent-harness-prd.md plans/README.md`
> If any listed file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding. On a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/013-authorize-github-installation-use-server-side.md and plans/014-validate-sandbox-env-var-keys-before-provisioning.md
- **Category**: direction
- **Planned at**: commit `c52ca55`, 2026-06-30

## Why this matters

Ditto has the product-side workspace model: projects, sessions, agent runs,
events, project-level mutating locks, cancellation, and a draft UI. It does not
yet have a real Flue harness, so accepted project prompts only create database
records and a placeholder system message.

This plan adds the first real Flue-powered project coder while preserving Ditto's
product boundary: `workspace.startRun` remains the only path that accepts a
project composer prompt, D1 remains the canonical product event log, and Flue
provides the durable model/session/streaming harness. The first implementation
must prove the same-worker composition between TanStack Start, Alchemy, and
Flue before broad tool work proceeds.

The maintainer explicitly decided these points for this plan: use Flue's
client-side streaming directly, support selectable models, store selected-model
preference in a global Zustand store, give the agent full sandbox access once
the route composition is proven, allow read-only work later without a lock but
require the project lock before edits, defer branch/PR export and implement
commit-only export later, and store future oversized logs/diffs as D1 references
to R2 artifacts. The maintainer also does not want regression tests or backward
compatibility code for existing sessions/runs/events at this early stage.

## Current state

Relevant files:

- `docs/flue-agent-harness-prd.md` - PRD for this feature and the release
  phases this plan starts.
- `package.json` - has `@flue/react` and `@flue/sdk`, but not
  `@flue/runtime`, `@flue/cli`, `hono`, `agents`, or `zustand`.
- `src/lib/flue-client.ts` - creates the browser Flue client with the wrong base
  URL shape.
- `src/routes/__root.tsx` - already wraps the app in `FlueProvider`.
- `src/integrations/trpc/routers/workspace.ts` - creates sessions/runs/events
  and the mutating lock, but only records a placeholder system event.
- `src/db/schema.ts` - defines `agent_runs` without a model specifier.
- `src/components/composer.tsx` - has a local hard-coded model selector and calls
  `workspace.startRun` without a model.
- `src/components/ai-chat.tsx` - renders D1 `agent_run_events` and can already
  display assistant `message` events.
- `alchemy.run.ts` - owns the Cloudflare Worker, D1, Sandbox binding, and
  container configuration through Alchemy.
- `src/server.ts` - current Worker entrypoint delegates all HTTP to TanStack
  Start.

Current dependency state:

```json
// package.json:26-32
"dependencies": {
  "@base-ui/react": "^1.6.0",
  "@cloudflare/sandbox": "^0.12.1",
  "@faker-js/faker": "^10.3.0",
  "@flue/react": "1.0.0-beta.1",
  "@flue/sdk": "1.0.0-beta.1",
```

```json
// package.json:94-117
"devDependencies": {
  "@biomejs/biome": "2.4.5",
  "@cloudflare/vite-plugin": "^1.42.1",
  "@cloudflare/workers-types": "^4.20260605.1",
  ...
  "wrangler": "^4.70.0"
}
```

Current Flue client bug:

```ts
// src/lib/flue-client.ts:1-7
import { createFlueClient } from "@flue/sdk";

const BASE_URL = import.meta.env.BASE_URL;

export const flueClient = createFlueClient({
	baseUrl: `https://${BASE_URL}/api/flue`,
});
```

Flue docs and the installed `@flue/sdk` types expect a same-origin browser base
URL such as `"/api/flue"`:

```ts
// node_modules/@flue/sdk/dist/index.d.mts:6-14
interface HttpClientOptions {
  /** URL where the public `flue()` sub-app is mounted, including any pathname. */
  baseUrl: string;
  /** Custom HTTP implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Headers merged into each HTTP request. */
  headers?: RequestHeaders;
  /** Bearer token added to HTTP requests. */
  token?: string;
}
```

The root already provides the Flue client:

```tsx
// src/routes/__root.tsx:1-16,65-67
import { FlueProvider } from "@flue/react";
import { flueClient } from "#/lib/flue-client";

<FlueProvider client={flueClient}>
	{isAuthRoute ? children : <AppShell>{children}</AppShell>}
</FlueProvider>
```

Current `workspace.startRun` input and placeholder event:

```ts
// src/integrations/trpc/routers/workspace.ts:135-142
startRun: protectedProcedure
	.input(
		z.object({
			projectId: z.string().min(1),
			sessionId: z.string().min(1).optional(),
			message: z.string().trim().min(1),
			isMutating: z.boolean().default(true),
		}),
	)
```

```ts
// src/integrations/trpc/routers/workspace.ts:272-281
{
	runId,
	projectId: input.projectId,
	sessionId,
	type: "message" as const,
	payload: createAgentRunEventPayload({
		role: "system",
		text: "Agent execution is queued. The LLM/tool runner will be connected in a later plan.",
	}),
}
```

Current D1-compatible lock and batch behavior must be preserved:

```ts
// src/integrations/trpc/routers/workspace.ts:296-331
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
```

Current run schema lacks model capture:

```ts
// src/db/schema.ts:96-125
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
```

Current event vocabulary supports the Flue mapping this plan needs:

```ts
// src/lib/workspace-policy.ts:12-23
export const AGENT_RUN_EVENT_TYPES = [
	"message",
	"tool_started",
	"tool_finished",
	"command_output",
	"file_changed",
	"diff_ready",
	"needs_input",
	"lock_rejected",
	"done",
	"error",
] as const;
```

Current composer stores selected model only in local component state and sends no
model to the server:

```tsx
// src/components/composer.tsx:376-428
const [text, setText] = useState("");
const [model, setModel] = useState(models[0].id);
...
const result = await startRunMutation.mutateAsync({
	projectId,
	sessionId: sessionId ?? undefined,
	message: message.text,
	isMutating: true,
});
```

Current Cloudflare/Alchemy entrypoint:

```ts
// alchemy.run.ts:20-35
export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		Sandbox: sandbox,
		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
		GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
		GITHUB_APP_PRIVATE_KEY: alchemy.secret(process.env.GITHUB_APP_PRIVATE_KEY),
		APP_ENV: app.stage,
		VITE_GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL ?? "https://github.com/apps/ditto-web/installations/new/",
	},
	wrangler: {
		main: "src/server.ts",
```

```ts
// src/server.ts:1-7
import handler from "@tanstack/react-start/server-entry";

export { Sandbox } from "@cloudflare/sandbox";

export default {
	fetch: handler.fetch,
};
```

Flue routing and Cloudflare docs facts to honor:

```md
// node_modules/@flue/sdk/docs/guide/project-layout.md:80-89
Flue selects one source directory in this order:
1. `.flue/` — A self-contained Flue source area inside a larger application.
2. `src/` — The recommended layout for new projects.
3. The project root — A compact layout for small dedicated projects.
The first matching directory wins. Flue does not merge layouts.
```

```md
// node_modules/@flue/sdk/docs/guide/routing.md:108-122
Mounting `flue()` does not make every discovered agent or workflow directly invocable.
Each module opts into its public transports:
Agent `route` -> HTTP prompts at `POST /agents/:name/:id` and event streaming at `GET /agents/:name/:id` beneath the mount path.
An agent used only through application-owned `dispatch(...)` calls does not need a public transport export.
```

```md
// node_modules/@flue/sdk/docs/api/agent-api.md:185-205
`createAgent(...)` may return `AgentRuntimeConfig | Promise<AgentRuntimeConfig>`.
`AgentCreateContext` includes `id`, `env`, and optional `payload`.
```

That async initializer is important: this plan should use Ditto's workspace
session id as the Flue agent instance id, query D1 for that session's project,
and attach the project's existing `sandboxId` to the Flue agent. Do not use the
run id as the Flue agent id because that would make it difficult to attach the
existing project sandbox and would lose Flue conversation continuity for the
workspace session.

PRD constraints to honor:

```md
// docs/flue-agent-harness-prd.md:151-156
- Ditto must expose a same-origin Flue route under `/api/flue`.
- The Flue route must be protected by Better Auth or an equivalent server-side auth boundary.
- Requests to project-scoped Flue resources must verify the authenticated user owns the project and run/session being accessed.
- The browser Flue client must point at the same-origin `/api/flue` mount.
- The Flue route must not expose unauthenticated public agents.
- The implementation must support Cloudflare Workers deployment.
```

```md
// docs/flue-agent-harness-prd.md:179-185
- `workspace.startRun` remains the product boundary for accepting a user instruction.
- A Flue run must not bypass Ditto's authorization, session creation, run creation, event creation, or mutating lock acquisition.
- Terminal states must set `agent_runs.finishedAt`.
- Terminal states must release `projects.activeAgentRunId` only when the run owns the lock.
- Failed Flue execution must surface a stable product error and must not leak provider keys, GitHub tokens, encrypted env vars, or raw private keys.
```

```md
// docs/flue-agent-harness-prd.md:227-234
- The harness must use the project's existing `sandboxId`.
- The harness must not create a new sandbox per session.
- The harness must call the same sandbox readiness or ensure path used by the workspace router before execution.
- Once Plan 015 lands, successful mutating runs must refresh the project sandbox backup after writes are complete.
- The harness must re-sync `.env` from encrypted D1 env vars after restore paths; backups must not include `.env`.
- The harness must treat `/workspace/.git` as the GitHub-backed hydration sentinel once sandbox restore is implemented.
```

Repo conventions to match:

- TypeScript is strict; do not use `any` to silence unknown Flue event shapes.
- Imports use the `#/` alias in `src/` files, for example `import { createDb } from "#/db";`.
- Formatting uses tabs and double quotes per `biome.json`.
- Server procedures use `protectedProcedure`, `zod` input validation, and concise `TRPCError` messages.
- Drizzle D1 writes use conditional updates and `db.batch(...)`; do not add explicit SQL `BEGIN`, `COMMIT`, or `db.transaction(...)` to the workspace path.
- UI should stay dark, compact, and code-review oriented. Reuse existing composer/model-selector components instead of adding a second selector.
- Recent commits use Conventional Commits, for example `fix(github): pagination`.

Verification baseline captured at plan-writing time:

- `pnpm exec tsc --noEmit --pretty false` exits 0.
- `pnpm test` exits 0 with `src/lib/github-repositories.test.ts` passing 5 tests.
- `pnpm lint` exits 0 with existing warnings only in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- `git diff --check` exits 0.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install runtime deps | `pnpm add @flue/runtime@1.0.0-beta.1 'agents@^0.14.2' hono zustand` | exits 0 and updates `package.json`/`pnpm-lock.yaml` |
| Install Flue CLI | `pnpm add -D @flue/cli@1.0.0-beta.1` | exits 0 and updates `package.json`/`pnpm-lock.yaml` |
| Generate DB migration | `pnpm db:generate` | exits 0 and creates one migration for `agent_runs.modelSpecifier` |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0; only pre-existing warnings in `grainient.tsx:297` and `sidebar.tsx:85` are allowed |
| Existing tests | `pnpm test` | exits 0; no new regression tests required by this plan |
| Whitespace | `git diff --check` | exits 0 with no output |
| Flue docs check | `npx flue docs read guide/routing` | exits 0 after `@flue/cli` is installed |
| Flue Cloudflare build | `npx flue build --target cloudflare` | exits 0 or reaches a documented STOP condition about TanStack/Alchemy composition |

For local end-to-end verification with credentials, also use:

| Purpose | Command | Expected on success |
|---|---|---|
| App dev server | `pnpm dev` | starts the Alchemy/TanStack local Worker without type/build errors |
| Manual prompt | submit one project composer prompt in the browser | creates a Ditto run, admits one Flue prompt, streams assistant activity, then writes terminal D1 events |

Do not run `pnpm format`, `pnpm check --write`, `pnpm fix`, `pnpm deploy`, or
`pnpm destroy` unless the operator explicitly asks. Do not commit provider
credentials, `.env`, `.dev.vars`, generated local Alchemy state, or secret-bearing
command output.

## Suggested executor toolkit

- Use current installed Flue docs after installing `@flue/cli`: `npx flue docs search routing`, `npx flue docs read guide/routing`, `npx flue docs read guide/building-agents`, and `npx flue docs read ecosystem/deploy/cloudflare`.
- If the installed docs use `defineAgent` instead of `createAgent`, update all Flue packages together and follow the installed docs. Do not mix website examples from a different Flue version with pinned beta.1 packages.
- Use `vercel-react-best-practices` if available before changing React streaming/rendering state.
- Use `workers-best-practices` or `wrangler` if available before changing Cloudflare Worker/Alchemy configuration.

## Scope

**In scope**:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml` only if pnpm requires an `allowBuilds` update for new packages
- `flue.config.ts` (create)
- `.flue/app.ts` (create)
- `.flue/agents/project-coder.ts` (create)
- `.flue/agents/project-coder.md` or `.flue/agents/project-coder-instructions.md` (create)
- `tsconfig.json`
- `biome.json`
- `alchemy.run.ts`
- `types/env.d.ts` only if the Alchemy type inference requires a small import/type adjustment
- `src/server.ts` only if the proven same-worker mount strategy needs Worker-level dispatch composition
- `src/routes/api.flue.$.ts` or `src/routes/api.flue.$.tsx` only if the proven strategy mounts Flue through a TanStack API route
- `src/lib/flue-client.ts`
- `src/lib/agent-models.ts` (create)
- `src/lib/user-preferences-store.ts` (create)
- `src/db/schema.ts`
- `migrations/`
- `src/integrations/trpc/routers/workspace.ts`
- `src/components/composer.tsx`
- `src/components/ai-chat.tsx`
- `plans/README.md` only to update this plan's status row when done

**Out of scope**:

- Generic per-tool approval UX.
- Branch creation, PR creation, GitHub issue mutation, GitHub push, or production deploy.
- The commit-only export flow. Record it as a future plan; do not implement it here.
- R2 artifact storage for large diffs/command outputs. The decision is D1 metadata rows plus R2 artifacts, but this plan must only keep event payloads compact and defer artifact implementation.
- Rich diff UI and changed-file review UI.
- A workflow for the basic chat loop. This PRD explicitly wants an addressable project coding agent, not a workflow, for the ordinary conversation path.
- Broad regression tests. The maintainer explicitly asked for no regression tests in this early-stage plan.
- Backward compatibility for existing sessions/runs/events. If a migration needs a default value for D1 to accept the schema change, use one, but do not add compatibility branches to preserve historical behavior.
- Rewriting unrelated plans or source files.

## Git workflow

- Branch: `advisor/016-flue-project-coder-foundation` if you create a branch.
- Commit style: Conventional Commits, for example `feat(flue): add project coder foundation`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Prove the Flue/TanStack/Alchemy mount strategy before broad edits

This is the highest-risk part of the plan. Flue Cloudflare docs assume Flue owns
the generated Worker artifact, while Ditto currently uses Alchemy/TanStack Start
with `src/server.ts` as the Worker entrypoint. Prove one viable same-origin mount
strategy before making UI or schema changes.

Preferred strategy:

1. Add `@flue/runtime`, `@flue/cli`, `agents`, and `hono` with the install
   commands above.
2. Create minimal `flue.config.ts`:

```ts
import { defineConfig } from "@flue/cli/config";

export default defineConfig({
	target: "cloudflare",
});
```

3. Create a temporary minimal `.flue/app.ts` Hono app that mounts `flue()` under
   `/api/flue`. Do not leave it unauthenticated in the final implementation.
4. Create a temporary minimal `.flue/agents/project-coder.ts` that exports an
   HTTP route and a harmless agent using the installed Flue API. With beta.1,
   installed docs use `createAgent(...)`; newer docs may use `defineAgent(...)`.
5. Run `npx flue docs read guide/routing` and confirm the installed docs match
   the API you are using.
6. Run `npx flue build --target cloudflare`.
7. Confirm whether the generated Flue worker can be composed with Ditto's current
   Alchemy/TanStack entrypoint without replacing D1/Sandbox bindings or breaking
   `pnpm dev`.

Acceptable mount outcomes:

- Outcome A: TanStack route adapter works. Add a `src/routes/api.flue.$.ts` route
  that forwards GET/POST/HEAD requests to the Flue Hono sub-app, and Flue's
  generated Cloudflare Durable Object classes/bindings are still present at
  build/runtime.
- Outcome B: Flue app owns the Worker fetch path. `.flue/app.ts` mounts
  `/api/flue` and delegates all non-Flue requests to the TanStack Start handler
  exported from `src/server.ts`, while Alchemy still provides D1, Sandbox,
  Better Auth, GitHub, and provider bindings.

If neither outcome can build and run locally with the existing Alchemy-managed
bindings, STOP and report the exact blocker. Do not continue with model stores,
schema changes, or UI streaming until this is resolved.

**Verify**: `npx flue docs read guide/routing` -> exits 0 and documents the
installed route API. Then `npx flue build --target cloudflare` -> exits 0, or you
hit the STOP condition above with a concrete error.

### Step 2: Add final Flue config and source layout

Keep all Flue-authored source under `.flue/`. Do not put agents or workflows in
`src/agents`, root `agents`, or mixed layouts.

Final `flue.config.ts` should use the installed config import and Cloudflare
target. With beta.1 docs, that is:

```ts
import { defineConfig } from "@flue/cli/config";

export default defineConfig({
	target: "cloudflare",
});
```

Update TypeScript and Biome so `.flue/**/*.ts` participates in editor/typecheck
and lint verification. `tsconfig.json` currently includes `"**/*.ts"`, but add
`.flue/**/*.ts` explicitly because Flue docs warn hidden directories can be
missed by editor tooling. Add `.flue/**/*.ts` to `biome.json` includes so the new
source follows repo formatting.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0, or only reports
errors from the temporary Flue files that the next step will fix.

### Step 3: Add model constants and Zustand user preference storage

Create `src/lib/agent-models.ts` with a small, explicit OpenCode Go-oriented
model list. Use current Flue/Pi model specifiers confirmed from
`https://flueframework.com/models.json` and Pi provider docs.

Use this initial list unless the operator gives a different preferred order:

```ts
export const PROJECT_CODER_MODELS = [
	{
		id: "opencode-go/kimi-k2.7-code",
		name: "Kimi K2.7 Code",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/qwen3.7-plus",
		name: "Qwen 3.7 Plus",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
] as const;

export const DEFAULT_PROJECT_CODER_MODEL = PROJECT_CODER_MODELS[0].id;
export const PROJECT_CODER_MODEL_IDS = PROJECT_CODER_MODELS.map(
	(model) => model.id,
);
```

Create `src/lib/user-preferences-store.ts` using Zustand's `persist` middleware.
Persist only the selected model and keep the storage key stable, for example
`ditto-user-preferences-v1`. Follow the Zustand docs pattern:

```ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_PROJECT_CODER_MODEL, PROJECT_CODER_MODEL_IDS } from "#/lib/agent-models";

type UserPreferencesState = {
	selectedProjectCoderModel: string;
	setSelectedProjectCoderModel: (model: string) => void;
};

export const useUserPreferencesStore = create<UserPreferencesState>()(
	persist(
		(set) => ({
			selectedProjectCoderModel: DEFAULT_PROJECT_CODER_MODEL,
			setSelectedProjectCoderModel: (model) => {
				set({
					selectedProjectCoderModel: PROJECT_CODER_MODEL_IDS.includes(model)
						? model
						: DEFAULT_PROJECT_CODER_MODEL,
				});
			},
		}),
		{
			name: "ditto-user-preferences-v1",
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({
				selectedProjectCoderModel: state.selectedProjectCoderModel,
			}),
		},
	),
);
```

If server rendering reports `localStorage` access errors, use Zustand's documented
SSR/hydration controls instead of moving preferences into component-local state.
Do not fall back to `useState`; the maintainer explicitly asked for a global
Zustand preference store.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 4: Capture the selected model on each agent run

Add `modelSpecifier` to `agent_runs` in `src/db/schema.ts`. This can be
non-null with `DEFAULT_PROJECT_CODER_MODEL` as the database/default insert value,
or nullable if Drizzle/D1 migration constraints make the non-null default noisy.
Do not add compatibility behavior for old runs beyond what D1 requires to apply
the migration.

Update `workspace.startRun` input to accept `modelSpecifier`. Validate it against
`PROJECT_CODER_MODEL_IDS`; reject unknown values with `BAD_REQUEST` and a stable
message such as `Unsupported model selected.`. Put the selected model on
`runValues` and return it as part of the existing `run` row.

Generate a migration with `pnpm db:generate`. Review the generated SQL before
continuing. It should only update the `agent_runs` schema metadata/SQL needed for
the new column.

**Verify**: `pnpm db:generate` -> creates one migration. Then
`pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 5: Bind OpenCode Go credentials without exposing secrets

Add an `OPENCODE_API_KEY` Worker binding through Alchemy so Flue/Pi can reach
OpenCode Go models. The Pi provider docs say both OpenCode Zen and OpenCode Go
use the `OPENCODE_API_KEY` environment variable, with OpenCode Go's auth-file key
being `opencode-go`.

In `alchemy.run.ts`, add only the binding, not a plaintext value:

```ts
OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
```

Do not log, print, commit, or copy the secret value. If TypeScript Env inference
requires it, let `types/env.d.ts` continue to infer from `website.Env`; do not
hand-write a duplicate secret type unless inference fails.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 6: Create the authenticated Flue app mount

Create `.flue/app.ts` using the mount strategy proven in Step 1.

Required behavior:

1. Mount Flue under `/api/flue`.
2. Protect every public Flue route with Better Auth session checks.
3. For `POST /api/flue/agents/project-coder/:id`, interpret `id` as a Ditto
   `workspace_sessions.id`, not a run id or sandbox id.
4. Verify the authenticated user owns that workspace session and its project.
5. Verify there is an active `agent_runs` row for the session and user before
   admitting a prompt.
6. Clone and parse the POST body before `next()` and reject the request if the
   submitted `message` does not match the active run's `userMessage`. Use
   `request.clone()` so Flue can still read the original request body.
7. For `GET` and `HEAD` stream requests, require session ownership but do not
   require the run to still be active; users should be able to reconnect to the
   stream/history for a session they own.
8. Do not expose unauthenticated agents, workflows, runs, channels, or admin
   endpoints.

Use the existing auth/data helpers as patterns:

```ts
// src/integrations/trpc/init.ts:12-21
const auth = createAuth(env);
const session = await auth.api.getSession({
	headers: request.headers,
});
```

```ts
// src/integrations/trpc/routers/workspace.ts:179-190
[selectedSession] = await db
	.select()
	.from(workspaceSessions)
	.where(
		and(
			eq(workspaceSessions.id, input.sessionId),
			eq(workspaceSessions.projectId, input.projectId),
			eq(workspaceSessions.userId, ctx.user.id),
		),
	)
	.limit(1);
```

If the proven mount strategy uses a TanStack file route instead of `.flue/app.ts`
as the top-level app, put the same auth/resource checks in the route adapter
before forwarding to the Flue sub-app.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0. Then manually
request `/api/flue/openapi.json` while signed out and confirm it returns 401/404,
not public agent metadata.

### Step 7: Create the `project-coder` agent with the existing project sandbox

Create `.flue/agents/project-coder.ts` and a Markdown instructions file.

Use the installed Flue API. With the currently installed beta.1 docs, the agent
module shape is `createAgent(...)`:

```ts
import { getSandbox } from "@cloudflare/sandbox";
import { createAgent, type AgentRouteHandler } from "@flue/runtime";
import { cloudflareSandbox } from "@flue/runtime/cloudflare";
import { and, desc, eq } from "drizzle-orm";
import { createDb } from "../../src/db";
import { agentRuns, projects, workspaceSessions } from "../../src/db/schema";
import { DEFAULT_PROJECT_CODER_MODEL } from "../../src/lib/agent-models";
import { WORKSPACE_PATH } from "../../src/lib/workspace-policy";
import instructions from "./project-coder-instructions.md" with { type: "markdown" };

export const route: AgentRouteHandler = async (_c, next) => next();

export default createAgent(async ({ id, env }) => {
	const db = createDb(env as Env);
	const [session] = await db
		.select({
			projectId: workspaceSessions.projectId,
			sandboxId: projects.sandboxId,
			projectStatus: projects.status,
		})
		.from(workspaceSessions)
		.innerJoin(projects, eq(projects.id, workspaceSessions.projectId))
		.where(eq(workspaceSessions.id, id))
		.limit(1);

	if (!session || session.projectStatus !== "ready" || !session.sandboxId) {
		throw new Error("Project sandbox is not ready.");
	}

	const [run] = await db
		.select({ modelSpecifier: agentRuns.modelSpecifier })
		.from(agentRuns)
		.where(eq(agentRuns.sessionId, id))
		.orderBy(desc(agentRuns.createdAt))
		.limit(1);

	return {
		model: run?.modelSpecifier ?? DEFAULT_PROJECT_CODER_MODEL,
		instructions,
		sandbox: cloudflareSandbox(getSandbox(env.Sandbox, session.sandboxId)),
		cwd: WORKSPACE_PATH,
	};
});
```

Adjust imports/types to match installed Flue and Drizzle type constraints. Keep
the behavior, not necessarily the exact formatting. If `createAgent` has become
`defineAgent` after a deliberate Flue package upgrade, use the installed docs and
update all Flue package versions together.

Instruction file requirements:

- Identify the agent as Ditto's project coding agent.
- Tell it to work repo-natively inside `/workspace`.
- Tell it it may inspect, edit, run, and verify inside the sandbox once admitted
  by Ditto.
- Tell it never to push, create branches on GitHub, open PRs, deploy, destroy
  sandboxes, or mutate external services; those are explicit Ditto product
  actions.
- Tell it to ask for clarification rather than guessing when required context is
  missing.
- Tell it to keep user-facing responses concise and evidence-based.
- Tell it not to print secrets, `.env` values, provider keys, GitHub tokens, or
  private keys.

Do not create `.flue/workflows/*` in this plan.

**Verify**: `npx flue build --target cloudflare` -> exits 0. Then
`pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 8: Dispatch Flue admission from `workspace.startRun`

Change `workspace.startRun` so it still owns session/run/event/lock creation,
then admits exactly one prompt to Flue after the D1 batch succeeds.

Required behavior:

1. Keep project/session authorization and sandbox readiness checks before run
   creation.
2. Keep the conditional mutating lock update exactly as a D1-compatible single
   update; do not reintroduce `db.transaction(...)`.
3. Remove the placeholder system event.
4. Insert the initial user `message` event exactly once with `schemaVersion: 1`.
5. Persist `modelSpecifier` on the run.
6. After the batch returns `{ run, session, createdSession }`, call Flue using
   the workspace session id as the Flue agent instance id:

```ts
await serverFlueClient.agents.send("project-coder", session.id, {
	message: input.message,
});
```

7. Build the server Flue client with an absolute same-origin base URL derived
   from `ctx.request.url`, for example `${new URL(ctx.request.url).origin}/api/flue`.
8. Forward the incoming request cookies/headers needed by Better Auth so the
   Flue route middleware sees the same authenticated user. Do not forward
   provider keys, GitHub tokens, or env var values.
9. If Flue admission fails, update the run to `failed`, set `finishedAt`, insert
   an `error` event with a stable redacted message, insert a `done` event with
   `status: "failed"`, and release `projects.activeAgentRunId` only when it
   equals the failed `runId`.
10. Return `{ run, session, createdSession }` only after Flue admission returns
   202/accepted.

If same-origin server-side fetch to `/api/flue` causes recursion, missing auth,
or runtime failure in the proven mount strategy, STOP and report. Do not fall
back to browser-only admission that can leave D1 runs stuck in `running` when the
browser tab closes after `workspace.startRun`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0. Manual local
verification should show a failed Flue admission marks the D1 run failed and
releases the mutating lock.

### Step 9: Persist Flue terminal events back to Ditto's D1 event log

D1 remains canonical for Ditto product state. Flue's stream gives live UI
updates, but terminal assistant messages and run status must be written to
`agent_run_events` and `agent_runs`.

Use Flue's `observe(...)` in the Flue application entrypoint or another
installed-version-supported server-side observer. The installed docs say:

```md
// node_modules/@flue/sdk/docs/guide/observability.md:51-86
Register `observe(...)` in your application entrypoint when you need telemetry
across workflows and continuing agents. The observer receives activity handled by
that running application context. Streaming deltas are best-effort live progress;
use `message_end` as the authoritative completed assistant message.
```

Required mapping for this plan:

- Ignore `text_delta` for D1 persistence. The browser uses Flue streaming for
  live deltas; D1 stores the authoritative completed assistant message.
- On `message_end` where the message role is assistant, extract text content and
  insert an `agent_run_events` row with `type: "message"` and payload
  `{ role: "assistant", text, schemaVersion: 1 }`.
- On Flue prompt success terminal signal, update the active Ditto run for that
  workspace session to `completed`, set `finishedAt`, insert a `done` event with
  `{ status: "completed", schemaVersion: 1 }`, and release the project lock only
  when `projects.activeAgentRunId` equals that run id.
- On Flue prompt failure terminal signal, update the active Ditto run to
  `failed`, set `finishedAt`, insert an `error` event with a stable redacted
  message, insert a `done` event with `{ status: "failed", schemaVersion: 1 }`,
  and release the project lock only when owned by that run.
- If a Ditto run was canceled before late Flue events arrive, do not resurrect it
  to `completed` or `failed`. Ignore late assistant/done events for canceled
  runs unless you need a redacted diagnostic `error` event.

The observer will receive Flue's `instanceId`; this plan uses Ditto
`workspace_sessions.id` as the Flue instance id. Resolve the current active run
by querying `agent_runs` for that `sessionId`, `status` in `pending/running/needs_input`,
and the newest `createdAt`/`id`. Because this plan only dispatches one run at a
time for a project, that lookup is sufficient. Do not enable read-only concurrent
runs in this plan.

Keep observer writes lightweight and redacted. If the installed Flue observer API
does not provide a safe way to access `env.DB` and complete D1 writes reliably in
Cloudflare, STOP and report. Do not move canonical event persistence to the
browser.

**Verify**: Submit one local prompt with credentials. Expected D1/session UI
sequence: user `message`, live Flue streamed assistant text, persisted assistant
`message`, `done` with `completed`, `agent_runs.status === "completed"`, and
`projects.activeAgentRunId === null` for mutating runs.

### Step 10: Wire the composer to the persisted model preference and live stream

Update `src/components/composer.tsx` to use `PROJECT_CODER_MODELS` and
`useUserPreferencesStore` instead of the local hard-coded `models` array/state.

Required behavior:

1. The selected model is read from the Zustand store.
2. Selecting a model updates the Zustand store and closes the model selector.
3. `workspace.startRun` receives `modelSpecifier: selectedProjectCoderModel`.
4. The composer still disables submit while a run is active.
5. The Stop action still calls `workspace.cancelRun`.
6. The UI labels should show OpenCode Go model names and provider icons if
   available. If `models.dev` has no `opencode-go` logo, use the existing
   `opencode` provider logo rather than a broken image.

Update `src/lib/flue-client.ts` to:

```ts
import { createFlueClient } from "@flue/sdk";

export const flueClient = createFlueClient({
	baseUrl: "/api/flue",
});
```

Update `src/components/ai-chat.tsx` to use Flue client streaming directly for
the selected session while an active run exists. The simplest acceptable shape is
a transient assistant bubble sourced from `useFlueAgent({ name: "project-coder", id: sessionId ?? undefined })` that appears only while Flue status is `submitted`, `streaming`, or `connecting`. D1 events remain the canonical rendered history after terminal persistence catches up.

Do not replace the existing D1 event list with Flue-only state. Do not render fake
changed files, fake diffs, fake command output, or fake verification status.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0. In the browser,
select a non-default model, reload, and confirm the same model remains selected.

### Step 11: Preserve cancellation semantics without overpromising runtime abort

Keep `workspace.cancelRun` as the product cancellation boundary. It should mark
the Ditto run canceled, set `finishedAt`, release the project lock, and insert a
`done` event.

If Flue exposes a supported cancellation API in the installed docs, call it from
`cancelRun` or a small helper. If the installed Flue version does not expose
prompt cancellation after admission, do not invent one. In that case, document in
code comments and UI copy that Stop cancels the Ditto run/lock and causes late
Flue events to be ignored, but admitted provider work may finish in the
background.

Observer persistence from Step 9 must check run status before writing terminal
updates so late Flue completion cannot overwrite a canceled Ditto run.

**Verify**: Start a run, click Stop, and confirm the UI/D1 state shows
`canceled`, the lock is released, and any late Flue events do not change the run
back to `completed`.

### Step 12: Final verification and cleanup

Run the full verification baseline:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

Expected results:

- Typecheck exits 0.
- Lint exits 0 with only the two pre-existing warnings in
  `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- Tests exit 0. Do not add regression tests unless the operator changes the
  instruction.
- Whitespace check exits 0.

Then run the relevant Flue/build check for the mount strategy chosen in Step 1:

```bash
npx flue build --target cloudflare
```

Expected result: exits 0 and does not require committing secrets or generated
local state.

Finally inspect scope:

```bash
git status --short
```

Expected result: only in-scope files changed.

## Test plan

The maintainer explicitly requested no regression tests for this early-stage
work and no backward compatibility for existing sessions/runs/events. Do not add
new Vitest regression files in this plan unless the maintainer changes that
instruction.

Verification is therefore command and manual-smoke based:

- `pnpm exec tsc --noEmit --pretty false` covers TypeScript integration.
- `pnpm lint` covers Biome linting for touched source, with only known existing
  warnings allowed.
- `pnpm test` ensures the existing GitHub import tests still pass.
- `npx flue build --target cloudflare` proves Flue source discovery and
  Cloudflare build compatibility.
- Manual local prompt verifies `workspace.startRun` -> Flue admission -> client
  stream -> D1 assistant/done events -> lock release.
- Manual cancellation verifies canceled runs are not overwritten by late Flue
  events.

## Done criteria

All must hold:

- [ ] `@flue/runtime`, `@flue/cli`, `agents`, `hono`, and `zustand` are installed
  without mixing incompatible Flue package versions.
- [ ] `.flue/agents/project-coder.ts` exists and no `.flue/workflows/*` basic
  chat workflow was added.
- [ ] `/api/flue` is same-origin and authenticated.
- [ ] Project-scoped Flue access verifies the authenticated user owns the Ditto
  workspace session/project.
- [ ] `workspace.startRun` remains the only project composer acceptance path.
- [ ] `workspace.startRun` creates the D1 session/run/user event and admits one
  Flue prompt; it does not leave stuck locks when Flue admission fails.
- [ ] The selected model is stored in a Zustand persisted preference and captured
  on each `agent_runs` row.
- [ ] The default selectable model is `opencode-go/kimi-k2.7-code` unless the
  operator chose a different OpenCode Go model during execution.
- [ ] The agent uses the existing project `sandboxId`, not a new sandbox per
  session or per run.
- [ ] Assistant output is streamed through Flue in the UI while D1 remains the
  canonical persisted event log.
- [ ] Terminal success/failure/cancellation sets `agent_runs.finishedAt` and
  releases `projects.activeAgentRunId` only when owned by that run.
- [ ] No provider key, GitHub token, private key, encrypted env var, `.env`
  value, or secret-bearing command output is logged or persisted in event
  payloads.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings in touched files.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] `npx flue build --target cloudflare` exits 0, or the executor stopped at a
  documented STOP condition before broad edits.
- [ ] `plans/README.md` status row for Plan 016 is updated.

## STOP conditions

Stop and report back without improvising if:

- Step 1 cannot prove a same-origin `/api/flue` mount that works with both Flue
  Cloudflare Durable Objects and the existing Alchemy/TanStack Worker.
- The installed Flue API differs from this plan and requires a package-wide Flue
  upgrade decision.
- The Flue build requires replacing Alchemy-managed D1/Sandbox bindings rather
  than composing with them.
- The code at the locations in "Current state" does not match the excerpts.
- `createAgent`/`defineAgent` cannot asynchronously query D1 to resolve the
  workspace session's project sandbox.
- The Flue observer API cannot reliably persist terminal events to D1 from the
  server side.
- Server-side Flue admission from `workspace.startRun` cannot preserve the Better
  Auth session for the `/api/flue` route.
- Implementing full sandbox access would require creating a new sandbox per run
  or per session.
- A step requires storing or printing provider keys, GitHub tokens, encrypted env
  vars, private keys, or `.env` values.
- A step requires adding generic tool approvals, branch/PR export, R2 artifacts,
  or rich diff UI.
- A verification command fails twice after a reasonable fix attempt.
- The fix appears to require touching files outside the in-scope list.

## Maintenance notes

- Future read-only concurrent runs must not reuse the "newest active run by
  session" lookup from the observer without adding a stronger run/submission
  correlation. This plan intentionally keeps all project composer runs serialized
  through the current mutating path.
- Future file-write and command tools must check the Ditto lock before mutating
  `/workspace`. Read-only inspection can be allowed without the mutating lock
  only after a follow-up plan defines that boundary.
- Future large diffs and long command outputs should use D1 metadata references
  plus R2 artifacts. Do not grow `agent_run_events.payload` into an unbounded log
  store.
- Once Plan 015 lands, successful mutating Flue runs should refresh the project
  sandbox backup after writes complete and should verify `/workspace/.git` before
  execution.
- The commit-only GitHub export flow is a separate product action and should not
  be hidden inside the agent loop.
- Reviewers should scrutinize authentication and lock ownership more than UI
  polish. The dangerous failure modes are public Flue agents, stuck locks,
  wrong-user stream access, and secret leakage.
