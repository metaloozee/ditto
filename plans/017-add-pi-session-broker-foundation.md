# Plan 017: Add the Pi session-broker foundation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat e3d5209..HEAD -- package.json pnpm-lock.yaml Dockerfile alchemy.run.ts types/env.d.ts src/server.ts src/routes/__root.tsx "src/routes/project.$projectId.tsx" "src/routes/api.workspace.session.$sessionId.socket.ts" src/lib/agent-models.ts src/lib/user-preferences-store.ts src/lib/pi-rpc.ts src/lib/workspace-session-broker.ts src/hooks/use-workspace-session-socket.ts src/db/schema.ts migrations src/integrations/trpc/routers/workspace.ts src/components/composer.tsx src/components/ai-chat.tsx src/lib/flue-client.ts sandbox/pi plans/README.md`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/013-authorize-github-installation-use-server-side.md, plans/014-validate-sandbox-env-var-keys-before-provisioning.md, and plans/015-persist-and-restore-project-sandboxes.md
- **Category**: direction
- **Planned at**: commit `e3d5209`, 2026-07-01

## Why this matters

Ditto already has the durable product model for project agent work: project
ownership, workspace sessions, accepted runs, append-only run events, a
project-level mutating lock, cancellation, and sandbox restore/backup helpers.
What it does not have is a real runner.

The earlier Flue plan was rejected because it forced a second Worker runtime,
generated Durable Objects, and Sandbox ownership conflicts that do not fit the
current Alchemy/TanStack structure cleanly. A direct Pi runner can fit Ditto's
existing single Worker much better if a Durable Object becomes the live session
broker: the DO keeps the authenticated client WebSocket, coordinates one live Pi
RPC session inside the existing project sandbox, and writes the canonical event
log back to D1.

This plan intentionally does **not** add an exact xterm or raw terminal mirror
of Pi's TUI. The maintainer chose a structured Pi RPC event stream over a raw
terminal surface for this foundation. The browser stays in Ditto's existing chat
UI and receives live structured events over WebSocket while D1 remains the
durable history.

## Current state

Relevant files:

- `PRODUCT.md` - product positioning and design principles, especially
  inspectability and calm density.
- `docs/repo-sandbox-coding-workspace-prd.md` - product requirements for the
  repo-native sandbox workspace and the one-sandbox-per-project model.
- `package.json` - current dependencies still include Flue client packages and
  do not include Zustand.
- `Dockerfile` - current sandbox image only inherits the base Cloudflare sandbox
  image and does not install Pi.
- `alchemy.run.ts` - owns the single TanStack Worker, the `Sandbox` DO binding,
  the D1 database, and the backup bucket bindings.
- `src/server.ts` - current Worker entrypoint exports `Sandbox` and delegates
  all fetch traffic to TanStack Start.
- `src/integrations/trpc/routers/workspace.ts` - current project run lifecycle:
  sandbox ensure path, D1 row creation, lock acquisition, placeholder system
  event, cancel path, and answer path.
- `src/routes/project.$projectId.tsx` - workspace page that polls `workspace.get`
  every second while an active run exists.
- `src/components/composer.tsx` - hard-coded model list in local state; current
  submit path does not send a model to the server.
- `src/components/ai-chat.tsx` - current event renderer for canonical D1 session
  events.
- `src/routes/__root.tsx` and `src/lib/flue-client.ts` - stale Flue client
  provider wiring that should be removed if Pi replaces Flue.
- `src/lib/project-sandbox.ts` and `src/lib/sandbox-bootstrap.ts` - Plan 015
  ensure/restore/backup helpers that this plan must consume instead of
  duplicating sandbox readiness logic.

Product and repo constraints to preserve:

```md
// PRODUCT.md:31-35
1. **Make the project feel tangible.** Users should always understand which project, repo, environment, model, and branch they are working with.
2. **Guide without patronizing.** Non-experts need clear choices and consequences; developers need fast paths and accurate technical labels.
3. **Keep AI actions inspectable.** Planning, scaffolding, edits, environment setup, and errors should be visible enough to build trust.
4. **Prefer calm density.** The UI should support complex workflows without visual noise.
5. **Design for iteration.** Importing, chatting, editing, previewing, and revising should feel like one continuous loop.
```

```md
// docs/repo-sandbox-coding-workspace-prd.md:160-167
1. v1 uses one Cloudflare Sandbox per project.
2. Sessions, chats, and branches are logical records inside the project workspace; they do not create new sandboxes in v1.
3. A durable session is created only when the first user message for that conversation is accepted.
4. Only one mutating agent run may operate on a project at a time.
5. The agent has broad permission inside its sandbox. Generic per-tool approvals are not part of v1.
6. The agent can pause with a `needs_input` event when it needs clarification.
7. Outside-world effects remain explicit user actions and are out of scope for the foundation work.
```

Current run acceptance path and placeholder event:

```ts
// src/integrations/trpc/routers/workspace.ts:164-171
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
// src/integrations/trpc/routers/workspace.ts:299-330
const runValues = {
	id: runId,
	projectId: input.projectId,
	sessionId,
	userId: ctx.user.id,
	status: "running" as const,
	isMutating: input.isMutating,
	userMessage: input.message,
};

const eventValues = [
	{
		runId,
		projectId: input.projectId,
		sessionId,
		type: "message" as const,
		payload: createAgentRunEventPayload({
			role: "user",
			text: input.message,
		}),
	},
	{
		runId,
		projectId: input.projectId,
		sessionId,
		type: "message" as const,
		payload: createAgentRunEventPayload({
			role: "system",
			text: "Agent execution is queued. The LLM/tool runner will be connected in a later plan.",
		}),
	},
];
```

Current D1-compatible project lock must remain intact:

```ts
// src/integrations/trpc/routers/workspace.ts:344-379
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

Current ensure/restore helper path from Plan 015:

```ts
// src/integrations/trpc/routers/workspace.ts:198-222
const envVars = await decryptEnvVars(
	project.envVars,
	ctx.env.BETTER_AUTH_SECRET,
);
const ensured = await ensureProjectSandbox({
	db,
	env: ctx.env,
	project,
	envVars,
});
project = ensured.project;
```

```ts
// src/lib/project-sandbox.ts:104-109
export async function ensureProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
	envVars: SandboxEnvVar[];
}): Promise<EnsureProjectSandboxResult> {
```

```ts
// src/lib/sandbox-bootstrap.ts:173-181
export async function backupSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
	projectId: string;
}): Promise<DirectoryBackup> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	return await sandbox.createBackup(
		getSandboxBackupOptions({ env: options.env, projectId: options.projectId }),
	);
}
```

Current workspace page already polls canonical D1 state during active runs:

```tsx
// src/routes/project.$projectId.tsx:28-36
const workspaceQuery = useQuery(
	trpc.workspace.get.queryOptions(
		{ projectId, sessionId },
		{
			enabled: isWorkspaceReady,
			refetchInterval: (query) =>
				query.state.data?.activeRun ? 1000 : false,
			retry: false,
		},
	),
);
```

Current root still wires Flue even though there is no Flue backend mount:

```tsx
// src/routes/__root.tsx:1-16,65-67
import { FlueProvider } from "@flue/react";
import { flueClient } from "#/lib/flue-client";

<FlueProvider client={flueClient}>
	{isAuthRoute ? children : <AppShell>{children}</AppShell>}
</FlueProvider>
```

```ts
// src/lib/flue-client.ts:1-7
import { createFlueClient } from "@flue/sdk";

const BASE_URL = import.meta.env.BASE_URL;

export const flueClient = createFlueClient({
	baseUrl: `https://${BASE_URL}/api/flue`,
});
```

Current model selection is local-only and not persisted:

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

Current Worker and sandbox ownership stay in one Alchemy/TanStack Worker:

```ts
// alchemy.run.ts:14-23,30-34,50-72
const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});

const database = await D1Database("database", {
	name: `${app.name}-${app.stage}-db`,
	migrationsDir: "./migrations",
	migrationsTable: "drizzle_migrations",
});

export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		Sandbox: sandbox,
	},
	wrangler: {
		main: "src/server.ts",
		transform: (spec) => ({
			...spec,
			containers: [
				{
					class_name: "Sandbox",
					image: "../../Dockerfile",
					instance_type: "lite",
					max_instances: 1,
				},
			],
			durable_objects: {
				...spec.durable_objects,
				bindings: [
					{ class_name: "Sandbox", name: "Sandbox" },
				],
			},
			migrations: [{ new_sqlite_classes: ["Sandbox"], tag: "v1" }],
		}),
	},
});
```

```ts
// src/server.ts:1-7
import handler from "@tanstack/react-start/server-entry";

export { Sandbox } from "@cloudflare/sandbox";

export default {
	fetch: handler.fetch,
};
```

Current sandbox image does not install Pi or any Ditto-specific runner assets:

```dockerfile
// Dockerfile:1
FROM docker.io/cloudflare/sandbox:0.12.1
```

Pi and Cloudflare docs facts this plan must honor:

- Pi CLI is distributed as `@earendil-works/pi-coding-agent`; the current npm
  registry reports `0.80.3` published on 2026-06-30.
- Pi RPC mode is started with `pi --mode rpc --no-session` and uses strict JSONL:
  commands on stdin, a single authoritative `response` for each command, and
  streamed events on stdout.
- Pi RPC supports `prompt`, `steer`, `follow_up`, and `abort` commands.
- Pi supports explicit extensions with `-e ./my-extension.ts`; `--no-extensions`
  disables discovery. Non-interactive runs can use `--no-approve` to avoid
  trusting project-local `.pi` resources while still keeping plain context files
  such as `AGENTS.md` and `CLAUDE.md` in scope.
- Pi RPC translates `ctx.ui.input(...)` and related extension UI methods into
  `extension_ui_request` events on stdout and expects matching
  `extension_ui_response` commands on stdin.
- Cloudflare Durable Objects are the recommended place for long-lived WebSocket
  coordination. Use `this.ctx.acceptWebSocket(server)` for hibernation, and use
  `serializeAttachment()` / `deserializeAttachment()` to restore per-connection
  state after hibernation.
- The current installed `@cloudflare/sandbox@0.12.1` type surface in this repo
  exposes `createSession()`, `getSession()`, `startProcess()`, `streamProcessLogs()`,
  `exec()`, and `terminal(request)`, but it does **not** expose the newer
  `stdin` or `execInteractive` APIs mentioned in the latest docs. This plan must
  target the installed API surface unless the executor intentionally introduces a
  Sandbox SDK version bump as a separate, explicit step.

Repo conventions to match:

- TypeScript is strict. Prefer explicit narrow types and small parser helpers over
  `any` or `@ts-ignore`.
- Imports inside `src/` use the `#/` alias, for example `import { createDb } from "#/db";`.
- Formatting uses tabs and double quotes.
- Server-side auth uses `createAuth(env).api.getSession({ headers: request.headers })`;
  see `src/routes/api.auth.$.ts:1-10` and `src/integrations/trpc/init.ts:5-22`.
- Workspace writes stay D1-compatible via conditional updates plus `db.batch(...)`.
- UI stays dark, compact, and inspectable; reuse the existing chat and composer
  components instead of adding an IDE-like terminal pane.
- Recent commits use Conventional Commits, for example `fix(env): remove optional BACKUP_BUCKET_ENDPOINT and enforce required R2 credentials`.

Verification baseline captured at plan-writing time on `e3d5209`:

- `pnpm exec tsc --noEmit --pretty false` exits 0.
- `pnpm test` exits 0 with 3 files / 23 tests passing.
- `pnpm lint` exits 0 with existing warnings only in
  `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`.
- `git diff --check` exits 0.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Remove stale Flue deps | `pnpm remove @flue/react @flue/sdk` | exits 0 and updates `package.json` / `pnpm-lock.yaml` |
| Add model store dep | `pnpm add zustand` | exits 0 and updates `package.json` / `pnpm-lock.yaml` |
| Generate DB migration | `pnpm db:generate` | exits 0 and creates one migration for the `agent_runs` model field (and any explicitly planned broker metadata fields only) |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0 with only the two pre-existing warnings in `grainient.tsx:297` and `sidebar.tsx:85` |
| Existing tests | `pnpm test` | exits 0 |
| Whitespace | `git diff --check` | exits 0 with no output |

For local end-to-end verification in the isolated executor worktree:

| Purpose | Command | Expected on success |
|---|---|---|
| App dev server | `pnpm dev` | starts the Alchemy/TanStack Worker; first run may build the Sandbox container image |
| Manual normal run | submit one project composer prompt in the browser | creates a Ditto run, streams live broker events over WebSocket, persists terminal D1 events, and releases the lock |
| Manual ask-user run | submit a prompt that requires clarification | Pi emits `extension_ui_request`, Ditto renders inline answer UI, user reply resumes the same run |
| Manual cancel | click Stop while a run is active | Ditto marks the run canceled, sends `abort`, and late Pi output does not overwrite `canceled` |

Do not run `pnpm format`, `pnpm check --write`, `pnpm fix`, `pnpm deploy`, or
`pnpm destroy` unless the operator explicitly asks. Do not commit provider
credentials, `.env`, generated `.alchemy/` state, or secret-bearing command
output.

## Suggested executor toolkit

- Use `durable-objects` if available before implementing the broker lifecycle and
  WebSocket hibernation.
- Use `sandbox-sdk` if available before writing the Pi process bridge or Dockerfile
  changes.
- Use `workers-best-practices` if available before adding the authenticated
  WebSocket route and DO fetch endpoints.
- Pi docs to consult during execution:
  - `https://pi.dev/docs/latest/rpc`
  - `https://pi.dev/docs/latest/extensions`
  - `https://pi.dev/docs/latest/providers`
- Cloudflare docs to consult during execution:
  - `https://developers.cloudflare.com/durable-objects/best-practices/websockets/`
  - `https://developers.cloudflare.com/durable-objects/api/state/`
  - `https://developers.cloudflare.com/sandbox/api/commands/`

## Scope

**In scope**:

- `package.json`
- `pnpm-lock.yaml`
- `Dockerfile`
- `alchemy.run.ts`
- `types/env.d.ts` only if new Worker bindings require an inference adjustment
- `src/server.ts`
- `src/routes/__root.tsx`
- `src/routes/project.$projectId.tsx`
- `src/routes/api.workspace.session.$sessionId.socket.ts` (create)
- `src/lib/agent-models.ts` (create)
- `src/lib/user-preferences-store.ts` (create)
- `src/lib/pi-rpc.ts` (create)
- `src/lib/workspace-session-broker.ts` (create)
- `src/hooks/use-workspace-session-socket.ts` (create)
- `src/db/schema.ts`
- `migrations/`
- `src/integrations/trpc/routers/workspace.ts`
- `src/components/composer.tsx`
- `src/components/ai-chat.tsx`
- `src/lib/flue-client.ts` (delete)
- `sandbox/pi/ditto-ask-user.ts` (create)
- `sandbox/pi/package.json` only if the explicit extension needs a local runtime dependency such as `typebox`
- `plans/README.md` only to update this plan's status row when done

**Out of scope**:

- Exact xterm or raw terminal mirroring of Pi's TUI. Do not add
  `@cloudflare/sandbox/xterm`, `@xterm/xterm`, or a terminal pane in this plan.
- Flue backend mounts, Flue Workers, `.flue/` source, or `@flue/runtime`.
- Project-local Pi extension discovery from imported repos. Do not trust or load
  `.pi/extensions`, project package-managed extensions, or project-local dynamic
  settings.
- Commit/PR export, branch management UI, or GitHub write actions.
- Broad regression or integration harnesses.
- Storing full terminal transcripts, full diffs, or other unbounded artifacts in
  D1. Keep payloads compact.
- Changing the one-sandbox-per-project model or allowing concurrent mutating runs.

## Git workflow

- Branch: `advisor/017-pi-session-broker-foundation` if you create a branch.
- Commit style: Conventional Commits, for example `feat(workspace): add pi session broker`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Capture the selected model on each agent run and remove the stale Flue shell

Replace the abandoned Flue client/provider surface and make model selection a
first-class persisted field before introducing the broker.

1. Remove `@flue/react` and `@flue/sdk` from `package.json` and `pnpm-lock.yaml`.
2. Add `zustand` as the global user-preference store dependency.
3. Delete `src/lib/flue-client.ts`.
4. Remove `FlueProvider` and the `flueClient` import from `src/routes/__root.tsx`.
5. Create `src/lib/agent-models.ts` with a verified OpenCode Go-oriented list.
   Use only model identifiers verified in Pi's current model catalog. Start with:

```ts
export const PROJECT_CODER_MODELS = [
	{
		id: "opencode-go/qwen3.7-plus",
		name: "Qwen3.7 Plus",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
	{
		id: "opencode-go/kimi-k2.6",
		name: "Kimi K2.6",
		provider: "opencode-go",
		providerName: "OpenCode Go",
	},
] as const;

export const DEFAULT_PROJECT_CODER_MODEL = PROJECT_CODER_MODELS[0].id;
export const PROJECT_CODER_MODEL_IDS = PROJECT_CODER_MODELS.map(
	(model) => model.id,
);
```

6. Create `src/lib/user-preferences-store.ts` with Zustand `persist`, storing only
   the selected model under a stable key such as `ditto-user-preferences-v1`.
7. Add `modelSpecifier` to `agent_runs` in `src/db/schema.ts`.
   Use a non-null default of `DEFAULT_PROJECT_CODER_MODEL` unless Drizzle/D1 makes
   the migration noisy; if so, use the smallest D1-compatible fallback that still
   avoids historical compatibility branches.
8. Update `workspace.startRun` input validation to accept `modelSpecifier`, reject
   unknown values with `BAD_REQUEST`, and persist the chosen model on the run row.
9. Generate the migration with `pnpm db:generate` and review the SQL before moving on.

Do not introduce any Pi runner logic in this step. This step only removes the
abandoned Flue shell and makes the model choice durable.

**Verify**: `pnpm db:generate` -> creates one migration. Then
`pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 2: Bake Pi and a deterministic Ditto ask-user extension into the sandbox image

Install Pi once in the sandbox image instead of performing network installs at
runtime inside every project sandbox.

1. Update `Dockerfile` so it still starts from `docker.io/cloudflare/sandbox:0.12.1`
   but also installs Pi globally with an exact version:

```dockerfile
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.3
```

2. Create `sandbox/pi/ditto-ask-user.ts` as a tiny explicit Pi extension loaded by
   the Pi CLI, not by project-local discovery. The extension should register an
   `ask_user` tool that calls `ctx.ui.input(question, placeholder)` and returns a
   structured result.
3. In `alchemy.run.ts`, add the Pi provider secret binding to the existing
   `website` Worker bindings only:

```ts
OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
```

   Do not log, print, or duplicate the secret anywhere else.
4. Prefer authoring the extension without extra dependencies by passing a plain
   JSON-schema-shaped `parameters` object to `pi.registerTool(...)`. If the Pi CLI
   rejects plain JSON schema and requires a helper package such as `typebox`, add a
   minimal `sandbox/pi/package.json` and install only that local dependency in the
   image. Do **not** add Pi extension helper packages to the root web app.
5. Copy the extension directory into the image at a stable path such as
   `/opt/ditto/pi/`.
6. The eventual Pi launch command in the broker must use these hardening flags:

```text
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
--no-session
--no-extensions
--no-skills
--no-prompt-templates
--no-themes
--no-approve
-e /opt/ditto/pi/ditto-ask-user.ts
```

Why these flags matter:

- `PI_SKIP_VERSION_CHECK=1` and `PI_TELEMETRY=0` prevent noisy background network
  calls from the sandbox runner.
- `--no-session` keeps Ditto, not Pi, as the durable session of record.
- `--no-extensions`, `--no-skills`, `--no-prompt-templates`, and `--no-themes`
  disable surprise project-local dynamic resources.
- `--no-approve` keeps project-local `.pi` dynamic config untrusted in
  non-interactive mode while leaving plain context files available.

Do not add a raw terminal client in this step.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 3: Add the WorkspaceSessionBroker Durable Object and authenticated socket route

Use one Durable Object per Ditto `workspace_sessions.id` as the live session
broker. The DO owns the browser WebSocket connection and the Pi process
coordination for that logical conversation.

1. In `alchemy.run.ts`, define a new Durable Object namespace for
   `WorkspaceSessionBroker` and bind it into `website` alongside `Sandbox`.
2. Extend the existing `wrangler.transform` block to add the DO binding and a new
   migration tag for `WorkspaceSessionBroker` while preserving the existing
   `Sandbox` container and migration configuration.
3. Export `WorkspaceSessionBroker` from `src/server.ts` alongside `Sandbox`; keep
   `handler.fetch` as the default Worker fetch.
4. Create `src/lib/workspace-session-broker.ts` with a Durable Object class that:
   - rehydrates hibernated sockets in the constructor using
     `this.ctx.getWebSockets()` and `deserializeAttachment()`
   - sets a WebSocket auto-response for lightweight heartbeats if supported by the
     current compat date
   - keeps only minimal live state in storage: session id, user id, project id,
     sandbox id, active run id, Pi process metadata, and any pending UI request id
5. Add `src/routes/api.workspace.session.$sessionId.socket.ts` as the authenticated
   same-origin WebSocket entrypoint. Match the auth pattern used in
   `src/routes/api.auth.$.ts` and `src/integrations/trpc/init.ts`:
   - import `env` from `cloudflare:workers`
   - resolve the Better Auth session from request headers
   - reject unauthenticated requests with 401
   - verify the user owns the requested `workspace_sessions.id` and project
   - forward the upgrade request to the DO stub only after server-side auth passes
6. The DO should expose HTTP fetch subpaths for internal control messages:
   - `POST /start`
   - `POST /reply`
   - `POST /abort`

Do not start Pi yet in this step. Focus on authenticated socket admission and DO
binding/migration correctness first.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0. Then request the
socket route while signed out and confirm it returns 401/403 rather than upgrading.

### Step 4: Implement the Pi RPC bridge inside the Durable Object using the installed Sandbox APIs

This is the highest-risk part of the plan. Use only the current installed
`@cloudflare/sandbox@0.12.1` APIs unless you deliberately add a Sandbox SDK upgrade
and re-verify the whole plan.

1. Create `src/lib/pi-rpc.ts` with the small, explicit helpers the DO needs:
   - JSONL line buffering and parsing
   - shell-safe command builders for writing one JSON line into a named pipe
   - typed discriminators for Pi RPC `response`, `message_update`, `message_end`,
     `tool_execution_start`, `tool_execution_update`, `tool_execution_end`,
     `extension_ui_request`, `agent_end`, and `extension_error`
2. Inside the DO, derive one sandbox execution session per Ditto workspace session.
   Use the Ditto `workspace_sessions.id` as the Sandbox SDK session id so the shell
   state and Pi process belong to the logical conversation instead of one prompt.
3. Resolve the project sandbox with `getProjectSandbox(env, sandboxId)` from the
   existing Plan 015 helpers. Do not create a new sandbox.
4. Start Pi as a background process with a named pipe for stdin because the current
   installed SDK does not expose `stdin` or `execInteractive`:
   - create a broker dir such as `/tmp/ditto/pi/<sessionId>`
   - create `rpc.in` with `mkfifo`
   - launch Pi via `sandbox.startProcess(...)` using a command shape equivalent to:

```bash
bash -lc 'set -euo pipefail; mkdir -p /tmp/ditto/pi/<sessionId>; rm -f /tmp/ditto/pi/<sessionId>/rpc.in; mkfifo /tmp/ditto/pi/<sessionId>/rpc.in; exec env PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 pi --mode rpc --no-session --no-extensions --no-skills --no-prompt-templates --no-themes --no-approve -e /opt/ditto/pi/ditto-ask-user.ts --provider <provider> --model <model> < /tmp/ditto/pi/<sessionId>/rpc.in'
```

5. Give the Pi process a deterministic `processId` derived from the Ditto session
   id so the DO can detect and reuse an already-running Pi process after reconnection.
6. Send Pi commands by shell-safely writing one JSON object plus newline into the
   FIFO with `sandbox.exec(...)`.
7. Stream Pi stdout from the running process using `onOutput` or
   `streamProcessLogs(processId)` and parse complete JSONL lines only.

Important constraints:

- Pi RPC output must stay clean JSONL. If shell prompts or echoed commands appear
  in stdout, the process launch shape is wrong; STOP rather than inventing a
  fragile parser for shell noise.
- The DO must serialize command writes so two client actions cannot interleave
  JSON into the FIFO.
- Write broker state incrementally to DO storage. Cloudflare does not provide
  shutdown hooks; do not rely on in-memory cleanup to preserve correctness.
- Do not use `DurableObjectState.waitUntil()` as a lifecycle crutch. Durable
  Objects remain active while they have pending I/O, WebSockets, or active work.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 5: Wire `workspace.startRun`, `answerRunQuestion`, and `cancelRun` to the broker while keeping D1 canonical

Keep Ditto's product boundaries and D1 durability model intact.

1. Preserve the Plan 015 ensure/restore path in `workspace.startRun` exactly as the
   precondition for launching Pi. Do not duplicate sandbox readiness logic in the DO.
2. Preserve the existing conditional project lock update and D1 batched initial row
   creation.
3. Remove the placeholder system event.
4. Persist exactly one initial user `message` event when a run is accepted.
5. After the batch succeeds, call the broker `POST /start` endpoint with the
   accepted `runId`, `sessionId`, user message, selected `modelSpecifier`, and the
   mutating flag.
6. The broker should send the Pi RPC `prompt` command and wait for its single
   authoritative `response` before returning 202/accepted to `workspace.startRun`.
7. Update `workspace.startRun` so Flue-specific base URLs or same-origin `/api/flue`
   fetches are not used anywhere.
8. Update `answerRunQuestion` so after it writes the user answer event and sets the
   run back to `running`, it also forwards a matching Pi `extension_ui_response` to
   the broker. If there is no pending UI request id for the session, STOP and report
   instead of silently degrading to a plain follow-up message.
9. Update `cancelRun` so it keeps Ditto as the cancellation boundary, writes the
   durable canceled state first, and then tells the broker to send `abort`. The
   broker must ignore late Pi events once the run is canceled.

Do not rename the tRPC procedures in this plan. The public API remains
`workspace.startRun`, `workspace.answerRunQuestion`, and `workspace.cancelRun`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0. Then run `pnpm dev`,
submit one prompt in the browser, and confirm the existing polling UI shows a real
assistant `message` plus terminal `done`/`error` events from D1 instead of the
placeholder system text.

### Step 6: Map Pi RPC events into D1 events, broker socket frames, and backup refresh

D1 stays canonical, while the WebSocket carries live transient state.

Required mapping:

1. `message_update` text deltas:
   - send live delta frames over the broker WebSocket
   - do not persist deltas to D1
2. `message_end` assistant message:
   - extract assistant text
   - insert D1 `message` event with `role: "assistant"`
3. `tool_execution_start`:
   - insert D1 `tool_started`
4. `tool_execution_update`:
   - send live progress frames over the broker WebSocket
   - persist only a compact `command_output` excerpt if there is a meaningful final
     command/tool result; do not stream unbounded logs into D1
5. `tool_execution_end`:
   - insert `tool_finished` or `error`
   - inspect sandbox/git state and emit `file_changed` / `diff_ready` if files changed
6. `extension_ui_request`:
   - set `agent_runs.status = "needs_input"`
   - store the pending request id in DO storage
   - update `agent_runs.question` and optionally `recommendedAnswer`
   - insert a D1 `needs_input` event with structured question metadata
   - send a live broker frame that the chat UI can render as an inline answer prompt
7. Pi terminal success:
   - for mutating runs, call `backupSandboxWorkspace(...)` and store the serialized
     backup before marking the run `completed`
   - insert `done` completed, set `finishedAt`, and release the lock only when
     `projects.activeAgentRunId` still equals that run id
8. Pi terminal failure or extension error:
   - insert stable redacted `error` and failed `done`
   - set `finishedAt`
   - release the lock only when owned by that run
9. Late output after `canceled`:
   - do not resurrect the run to `completed` or `failed`

Keep payloads compact. If a diff or tool result is too large, emit a short summary
only. Do not introduce R2 artifact storage in this plan.

**Verify**: With `pnpm dev` running, submit one mutating prompt in the browser and
confirm the D1/session UI sequence is:
user `message` -> real assistant `message` -> `done` completed ->
`agent_runs.status === "completed"` -> refreshed `projects.sandboxBackupCreatedAt` ->
`projects.activeAgentRunId === null`.

### Step 7: Add the live broker WebSocket client and inline question UX in the existing chat UI

Use the new DO socket for live progress while keeping D1 as the load/reconnect
source of truth.

1. Create `src/hooks/use-workspace-session-socket.ts` using native `WebSocket`.
2. Connect only when a selected session exists.
3. Use the same-origin route from Step 3.
4. The socket protocol should be structured JSON frames for live deltas, state
   snapshots, and `needs_input` requests. Do not send raw terminal bytes.
5. Update `src/routes/project.$projectId.tsx` so the workspace page still loads
   canonical history from `workspace.get`, keeps polling as a fallback when the
   socket is disconnected, and passes live socket state into `Chat`.
6. Update `src/components/ai-chat.tsx` to merge canonical D1 events with transient
   live events for the active session. The simplest acceptable shape is:
   - canonical D1 events remain the primary rendered history
   - one transient assistant bubble shows streaming text while a run is active
   - one inline question card appears when the latest broker frame or D1 event is
     `needs_input`
7. Update `src/components/composer.tsx` to use the Zustand model store, send
   `modelSpecifier`, keep the Stop action wired to `workspace.cancelRun`, and keep
   the compact existing model-selector UI.

Do not add a terminal panel, xterm surface, or IDE-like chrome.

**Verify**: In the browser, send a prompt and confirm live assistant text appears
before the persisted D1 assistant message. Then refresh the page and confirm the
canonical D1 history still renders correctly. Finally, use a prompt that triggers
`ask_user` and confirm the inline answer UI resumes the same run.

### Step 8: Final verification and cleanup

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
- Tests exit 0.
- Whitespace check exits 0.

Then run the local manual flows from the command table with `pnpm dev`:

1. Normal prompt completes and persists canonical D1 events.
2. `ask_user` flow pauses and resumes the same run.
3. Stop cancels the run and late Pi output does not overwrite `canceled`.
4. Browser refresh during an active run reconnects the socket or falls back to D1
   polling without losing the canonical history.

Finally inspect scope:

```bash
git status --short
```

Expected result: only in-scope files changed.

## Test plan

The maintainer previously rejected broad new regression harness work for this
foundation area, and that still applies here. Do not add large integration or
browser test suites in this plan.

Verification is command and manual-smoke based:

- `pnpm exec tsc --noEmit --pretty false` covers TypeScript integration.
- `pnpm lint` covers Biome linting for touched files.
- `pnpm test` ensures the existing repository tests still pass.
- The browser verification flows in Steps 5-8 validate the Pi broker, D1
  persistence, backup refresh, cancel semantics, and ask-user UX.

If a small pure helper is extracted for JSONL chunk buffering or RPC command
construction and it is straightforward to unit-test without building a broader
harness, one focused Vitest file is acceptable. Do not expand that into a large
new test surface.

## Done criteria

All must hold:

- [ ] Flue root dependencies and provider wiring are removed.
- [ ] `agent_runs` captures a persisted `modelSpecifier`.
- [ ] Pi is installed deterministically in the sandbox image via `Dockerfile`.
- [ ] The sandbox runner starts Pi in RPC mode with explicit hardening flags and no
      project-local dynamic Pi resources.
- [ ] `WorkspaceSessionBroker` Durable Object exists, is bound in Alchemy, and has
      a migration.
- [ ] The same-origin authenticated WebSocket route proxies only owned sessions to
      the broker.
- [ ] `workspace.startRun` remains the only accepted new-instruction boundary.
- [ ] `workspace.startRun` uses the Plan 015 ensure path and no longer inserts the
      placeholder system event.
- [ ] The broker persists canonical D1 assistant/tool/done/error/needs-input events.
- [ ] Successful mutating runs refresh the sandbox backup before being marked
      completed.
- [ ] `workspace.cancelRun` keeps canceled runs canceled even if Pi exits later.
- [ ] The browser receives live structured Pi events over WebSocket in the existing
      chat UI.
- [ ] The inline answer UI resumes the same run through a real Pi
      `extension_ui_request` / `extension_ui_response` flow.
- [ ] No exact xterm/TUI mirror was added.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings in touched files.
- [ ] `pnpm test` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] `plans/README.md` status row for Plan 017 is updated.

## STOP conditions

Stop and report back without improvising if:

- The code at the locations in "Current state" no longer matches the excerpts.
- Plan 015's `ensureProjectSandbox` or backup helpers are missing, renamed, or no
  longer usable from the runner path.
- The installed `@cloudflare/sandbox@0.12.1` API cannot keep the Pi RPC process
  interactive with the named-pipe bridge and the fix would require an unplanned
  Sandbox SDK upgrade.
- Pi RPC stdout is polluted with shell prompts or non-JSON noise that prevents a
  deterministic JSONL parser.
- The broker cannot authenticate the same-origin WebSocket route without exposing
  unauthenticated session access.
- `workspace.answerRunQuestion` cannot correlate a Ditto reply with a pending Pi
  UI request id.
- Implementing the browser surface would require an exact xterm terminal mirror or
  any raw terminal-byte transport in this plan.
- A verification command fails twice after a reasonable fix attempt.
- The fix appears to require touching files outside the in-scope list.

## Maintenance notes

- Exact Pi TUI mirroring is intentionally deferred. A future follow-up can use
  `sandbox.terminal(request)` and `@cloudflare/sandbox/xterm` to mirror the same
  sandbox session if the product later wants a raw terminal view.
- The broker should remain the only place that knows how Pi RPC commands map to
  Ditto run/event state. Do not duplicate RPC parsing logic in routes or UI.
- If read-only concurrent runs are added later, revisit the assumption that one
  DO keyed by `workspace_sessions.id` plus one active mutating run per project is
  enough.
- Reviewers should scrutinize: session ownership on the WebSocket route, lock
  release ownership checks, late-event handling after cancel, and whether Pi is
  launched with project-local dynamic resources disabled.
- If the team later decides to move from the FIFO bridge to newer Sandbox SDK
  `stdin` or `execInteractive` APIs, that should be a separate explicit migration,
  not an incidental change during this foundation plan.
