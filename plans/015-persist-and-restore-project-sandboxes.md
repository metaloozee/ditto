# Plan 015: Persist and restore project sandboxes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat 9e2fed0..HEAD -- alchemy.run.ts README.md src/db/schema.ts migrations src/lib/sandbox-bootstrap.ts src/lib/sandbox-backup.ts src/lib/sandbox-backup.test.ts src/lib/project-sandbox.ts src/lib/project-env-vars.ts src/integrations/trpc/routers/projects.ts src/integrations/trpc/routers/workspace.ts "src/routes/project.$projectId.tsx" types/env.d.ts plans/README.md`
> If any listed file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding. On a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e2fed0`, 2026-07-01

## Why this matters

Ditto already persists `projects.sandboxId`, but that only records the Durable
Object identity. It does not prove the Docker-backed local sandbox still has the
cloned repository in `/workspace` after a machine restart, Docker cleanup, local
Miniflare reset, or sandbox container restart.

The current reopen path trusts `status === "ready" && sandboxId`, so a project can
look ready while the actual workspace is empty or gone. This plan adds the missing
durability layer: create R2-backed workspace backups, persist the latest backup
handle on the project, verify workspace hydration when opening or starting work,
restore from backup when possible, and fall back to recloning from GitHub when no
usable backup exists.

This plan remains necessary even if Plan 016 changes the runner from a placeholder
database event to Flue. Flue supplies the project-coder harness and streaming
runtime; it does not make `/workspace` durable across sandbox container loss. Plan
016 should use the ensure/restore helpers from this plan instead of inventing a
second readiness path.

## Current state

Relevant files:

- `alchemy.run.ts` - defines Cloudflare resources and bindings through Alchemy.
- `src/db/schema.ts` - Drizzle schema for D1 tables, including `projects`.
- `src/lib/sandbox-bootstrap.ts` - clones GitHub repos into Cloudflare Sandbox,
  syncs `.env`, installs dependencies, and destroys temporary sandboxes.
- `src/integrations/trpc/routers/projects.ts` - creates projects and currently
  writes `sandboxId` only after bootstrap succeeds.
- `src/integrations/trpc/routers/workspace.ts` - gates workspace reads/runs on
  `status` and `sandboxId`, but does not verify `/workspace`.
- `src/routes/project.$projectId.tsx` - enables `workspace.get` based only on
  `status` and `sandboxId`.
- `node_modules/.pnpm/@cloudflare+sandbox@0.12.1/.../sandbox-C8l-pMlL.d.ts` -
  installed SDK type surface; use it as a local API reference if docs drift.

Current project schema has a durable `sandboxId`, but no durable backup metadata:

```ts
// src/db/schema.ts:42-54
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
```

Current Alchemy config binds D1 and Sandbox, but not an R2 bucket for backups:

```ts
// alchemy.run.ts:20-33
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
```

Current bootstrap creates and populates a sandbox, but does not back it up:

```ts
// src/lib/sandbox-bootstrap.ts:165-217
export async function bootstrapSandbox(options: {
	env: Env;
	sandboxId: string;
	githubRepo: string;
	installationId: number;
	envVars: SandboxEnvVar[];
}): Promise<{ sandboxId: string }> {
	const sandbox = getSandbox(
		options.env.Sandbox as Parameters<typeof getSandbox>[0],
		options.sandboxId,
		{
			enableDefaultSession: false,
		},
	);

	try {
		const token = await getInstallationAccessToken(
			options.env,
			options.installationId,
		);
		const repoUrl = `https://x-access-token:${token}@github.com/${options.githubRepo}.git`;
		const publicRepoUrl = `https://github.com/${options.githubRepo}.git`;

		await sandbox.gitCheckout(repoUrl, {
			targetDir: WORKSPACE_PATH,
			cloneTimeoutMs: CLONE_TIMEOUT_MS,
		});

		await runCommand(
			sandbox,
			`git remote set-url origin ${quoteShellArg(publicRepoUrl)}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to scrub Git remote URL",
			},
		);

		if (options.envVars.length > 0) {
			await sandbox.writeFile(
				`${WORKSPACE_PATH}/.env`,
				`${formatEnvFile(options.envVars)}\n`,
			);
		}

		await installDependencies(sandbox);

		return { sandboxId: options.sandboxId };
	} catch (error) {
		await sandbox.destroy();
		throw error;
	}
}
```

Current project creation authorizes the GitHub installation, sanitizes env-var
keys, generates a new `sandboxId`, and marks the project ready after bootstrap
succeeds. It still persists only the sandbox identity:

```ts
// src/integrations/trpc/routers/projects.ts:158-177
const sandboxId = crypto.randomUUID().toLowerCase();

try {
	await bootstrapSandbox({
		env: ctx.env,
		sandboxId,
		githubRepo: githubImport.repo,
		installationId: githubImport.installationId,
		envVars: sanitizedEnvVars,
	});

	const [updatedProject] = await db
		.update(projects)
		.set({
			sandboxId,
			status: "ready",
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(projects.id, projectId))
		.returning();
```

Current env-var updates now normalize and validate keys before saving, but they
still write directly into the sandbox if a `sandboxId` exists and do not check
whether `/workspace` is hydrated first:

```ts
// src/integrations/trpc/routers/projects.ts:312-318 (setEnvVar)
if (project.sandboxId) {
	await syncSandboxEnvFile({
		env: ctx.env,
		sandboxId: project.sandboxId,
		envVars: nextEnvVars,
	});
}
```

```ts
// src/integrations/trpc/routers/projects.ts:382-388 (deleteEnvVar)
if (project.sandboxId) {
	await syncSandboxEnvFile({
		env: ctx.env,
		sandboxId: project.sandboxId,
		envVars: nextEnvVars,
	});
}
```

Current workspace reads and run starts trust `ready + sandboxId`:

```ts
// src/integrations/trpc/routers/workspace.ts:49-54
if (project.status !== "ready" || !project.sandboxId) {
	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message: "Project sandbox is not ready yet.",
	});
}
```

```ts
// src/integrations/trpc/routers/workspace.ts:169-174
if (project.status !== "ready" || !project.sandboxId) {
	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message: "Project sandbox is not ready yet.",
	});
}
```

The route uses the same weak readiness signal before enabling `workspace.get`:

```tsx
// src/routes/project.$projectId.tsx:25-38
const project = projectQuery.data;
const isWorkspaceReady =
	project?.status === "ready" && Boolean(project.sandboxId);
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

Installed Sandbox SDK `0.12.1` exposes the APIs needed for this plan:

```ts
// node_modules/.pnpm/@cloudflare+sandbox@0.12.1/node_modules/@cloudflare/sandbox/dist/sandbox-C8l-pMlL.d.ts:1418-1451
exists(path: string, sessionId?: string): Promise<FileExistsResult>;
gitCheckout(repoUrl: string, options?: {
	branch?: string;
	targetDir?: string;
	sessionId?: string;
	/** Clone depth for shallow clones (e.g., 1 for latest commit only) */
	depth?: number;
	/** Maximum wall-clock time for the git clone subprocess in milliseconds */
	cloneTimeoutMs?: number;
}): Promise<GitCheckoutResult>;
...
createBackup(options: BackupOptions): Promise<DirectoryBackup>;
restoreBackup(backup: DirectoryBackup): Promise<RestoreBackupResult>;
```

The same installed SDK documents that backup handles are serializable and must be
stored by the app:

```ts
// node_modules/.pnpm/@cloudflare+sandbox@0.12.1/node_modules/@cloudflare/sandbox/dist/sandbox-C8l-pMlL.d.ts:1233-1244
/**
 * Handle representing a stored directory backup.
 * Serializable metadata returned by createBackup().
 * Store it anywhere and later pass it to restoreBackup().
 */
interface DirectoryBackup {
	/** Unique backup identifier */
	readonly id: string;
	/** Directory to restore into. Must be under `/workspace`, `/home`, `/tmp`, `/var/tmp`, or `/app`. */
	readonly dir: string;
	/** Whether this backup was created with local R2 binding mode. */
	readonly localBucket?: boolean;
}
```

The SDK also warns that production backup/restore mounts are not permanent after
a container restart, so the app must re-run restore from the stored handle:

```ts
// node_modules/.pnpm/@cloudflare+sandbox@0.12.1/node_modules/@cloudflare/sandbox/dist/sandbox-C8l-pMlL.d.ts:3398-3402
* **Mount Lifecycle**: The FUSE overlay mount persists only while the
* container is running. When the sandbox sleeps or the container restarts,
* the mount is lost and the directory becomes empty. Re-restore from the
* backup handle to recover. This is an ephemeral restore, not a persistent
* extraction.
```

Product constraints to honor:

```md
// PRODUCT.md:31-35
1. **Make the project feel tangible.** Users should always understand which project, repo, environment, model, and branch they are working with.
2. **Guide without patronizing.** Non-experts need clear choices and consequences; developers need fast paths and accurate technical labels.
3. **Keep AI actions inspectable.** Planning, scaffolding, edits, environment setup, and errors should be visible enough to build trust.
```

```md
// docs/repo-sandbox-coding-workspace-prd.md:72-76
### 8.1 Repository import
- User can choose a GitHub repository they have access to.
- The selected repo is cloned into a sandboxed workspace.
- The system can re-open the same workspace for the same repo/session identity.
```

```md
// docs/repo-sandbox-coding-workspace-prd.md:160-167
1. v1 uses one Cloudflare Sandbox per project.
2. Sessions, chats, and branches are logical records inside the project workspace; they do not create new sandboxes in v1.
...
7. Outside-world effects, including GitHub push or PR, production deploy, or sandbox destruction, remain explicit user actions and are out of scope for the foundation work.
8. Local project memory should live under `/workspace/.ditto/` in the sandbox in a future plan; database run events are the durable product event log for now.
```

Repo conventions to follow:

- TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`; avoid
  placeholder exports or unused helper arguments.
- The repo uses `#/*` imports for source files; match that convention.
- Biome uses tabs and double quotes; do not hand-format with spaces.
- tRPC errors use `TRPCError` with stable user-facing messages.
- D1 schema changes are represented in `src/db/schema.ts` plus generated SQL in
  `migrations/`.
- Current tests are absent; if you add pure helpers, add focused Vitest tests in
  colocated `*.test.ts` files.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install dependencies | `pnpm install --frozen-lockfile` | exits 0 and does not change `pnpm-lock.yaml` |
| Typecheck | `pnpm exec tsc --noEmit` | exits 0; advisor verified this at plan-writing time |
| Full tests | `pnpm test` | exits 0; currently reports no test files before this plan |
| Targeted tests | `pnpm exec vitest run src/lib/sandbox-backup.test.ts` | exits 0 after you add the test file |
| Lint | `pnpm lint` | exits 0; advisor observed existing warnings in `src/components/ui/grainient.tsx:297` and `src/components/ui/sidebar.tsx:85`; do not add warnings in touched files |
| Generate migration | `pnpm db:generate` | creates one new migration and updates `migrations/meta`; this mutates files and was not run by the advisor |
| Whitespace check | `git diff --check` | no output |
| Local manual verification | `pnpm dev` | local app starts; first sandbox operation may build/start Docker containers |

Do not run `pnpm format` as part of this plan; it writes broadly. Use Biome's
reported locations or your editor for touched files only.

## Suggested executor toolkit

- Use the `sandbox-sdk` skill if available. Confirm current `@cloudflare/sandbox`
  backup API docs before editing if the installed package version changed from
  `0.12.1`.
- Use the `wrangler` skill if available before changing generated Wrangler/Alchemy
  resource bindings.
- Reference docs:
  - https://developers.cloudflare.com/sandbox/
  - https://developers.cloudflare.com/sandbox/api/
  - https://alchemy.run/concepts/bindings/

## Scope

**In scope**:

- `alchemy.run.ts`
- `README.md`
- `src/db/schema.ts`
- `migrations/0003_*.sql` (create via `pnpm db:generate`; exact suffix is generated)
- `migrations/meta/_journal.json`
- `migrations/meta/0003_snapshot.json` (create via `pnpm db:generate`; exact name follows Drizzle)
- `src/lib/sandbox-backup.ts` (create)
- `src/lib/sandbox-backup.test.ts` (create)
- `src/lib/sandbox-bootstrap.ts`
- `src/lib/project-sandbox.ts` (create)
- `src/lib/project-env-vars.ts` (create only if extracting existing env-var helpers for reuse)
- `src/integrations/trpc/routers/projects.ts`
- `src/integrations/trpc/routers/workspace.ts`
- `src/routes/project.$projectId.tsx`
- `types/env.d.ts` only if Alchemy inference does not include the new bindings cleanly
- `plans/README.md`

**Out of scope**:

- Replacing the current synchronous bootstrap/restore request model with a queue
  or background worker.
- Changing the one-sandbox-per-project v1 decision.
- Adding branch/worktree/snapshot UI.
- Persisting `.env` contents in R2 backups; encrypted env vars already live in
  D1 and must be re-synced after restore.
- Solving future agent-run backup timing once a real file-mutating runner exists.
  Plan 016 is responsible for refreshing backups after successful mutating Flue
  runs if it executes after this plan. Add a maintenance note here instead of
  wiring runner-specific behavior in this plan.
- Editing generated `.alchemy/` or `.wrangler/` state by hand.
- Logging GitHub installation tokens, R2 secrets, private keys, or environment
  variable values. Reference secret types only.

## Git workflow

- Branch: `advisor/015-durable-sandbox-restore`
- Commit style: conventional commits; recent examples include
  `feat(projects): settings dialog & procedures` and
  `fix(workspace): replace D1 transaction in startRun`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add R2 backup infrastructure through Alchemy

Update `alchemy.run.ts` to create and bind an R2 bucket that the Sandbox SDK can
use for workspace backups.

Required shape:

1. Import `R2Bucket` from `alchemy/cloudflare` alongside the existing Cloudflare
   resources.
2. Define one deterministic bucket-name string near the D1 resource setup:

   ```ts
   const sandboxBackupBucketName = `${app.name}-${app.stage}-sandbox-backups`;
   const sandboxBackups = await R2Bucket("sandbox-backups", {
   	name: sandboxBackupBucketName,
   });
   ```

3. Bind the bucket and the SDK's backup configuration names into `website`:

   ```ts
   BACKUP_BUCKET: sandboxBackups,
   BACKUP_BUCKET_NAME: sandboxBackupBucketName,
   CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
   R2_ACCESS_KEY_ID: alchemy.secret(process.env.R2_ACCESS_KEY_ID),
   R2_SECRET_ACCESS_KEY: alchemy.secret(process.env.R2_SECRET_ACCESS_KEY),
   BACKUP_BUCKET_ENDPOINT: process.env.BACKUP_BUCKET_ENDPOINT ?? "",
   USE_LOCAL_BUCKET_BACKUPS: process.env.USE_LOCAL_BUCKET_BACKUPS ?? "",
   ```

The binding name `BACKUP_BUCKET` is load-bearing: the installed Sandbox SDK looks
for that exact R2 binding when `createBackup()` and `restoreBackup()` run.

`USE_LOCAL_BUCKET_BACKUPS` is also load-bearing for this app's wrapper code. It
must be set to `"true"` only for local development that intentionally uses the
Sandbox SDK local R2-binding backup path. In deployed environments, leave it empty
or `"false"`; missing R2 presigned-url credentials should fail clearly instead of
silently switching to local-bucket mode.

Keep the existing Sandbox Durable Object and container config unchanged.

Update `README.md` in the Cloudflare/deployment environment section to document
the new backup env vars by name only. Do not add example secret values. Include:

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- optional `BACKUP_BUCKET_ENDPOINT` for non-default R2 endpoints
- optional `USE_LOCAL_BUCKET_BACKUPS=true` for local development only

Also document that local development can use the local R2 binding path by setting
`USE_LOCAL_BUCKET_BACKUPS=true`, while a deployed Worker should set the R2
credentials so the SDK can use presigned URLs.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 2: Persist the latest sandbox backup handle on each project

Update `src/db/schema.ts` to add nullable backup metadata to `projects`:

```ts
sandboxBackup: text("sandboxBackup"),
sandboxBackupCreatedAt: integer("sandboxBackupCreatedAt", {
	mode: "timestamp",
}),
```

Then run `pnpm db:generate` to create the corresponding migration. Keep the
generated migration and metadata files in scope.

Do not change the existing `status` enum in this plan. Reuse `provisioning` as
the short-lived restore/rebootstrap state, `ready` as the hydrated-or-restored
state, and `failed` when restore/rebootstrap fails.

Update project select/return shapes in `src/integrations/trpc/routers/projects.ts`
only as needed so server code can read/write the new fields. Do **not** expose
the raw `sandboxBackup` JSON to the client. It is operational metadata, not UI
data. Keep `projects.list`, `projects.get`, `projects.create`, and
`workspace.get` response project objects omitting `sandboxBackup`. Do not expose
`sandboxBackupCreatedAt` either unless a visible restore-status UI is added in
this same plan.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0 after schema and select updates.

### Step 3: Add focused backup metadata helpers and tests

Create `src/lib/sandbox-backup.ts` for small pure helper functions. Keep this
module free of tRPC and database imports so it is easy to test.

Required exports:

```ts
import type { BackupOptions, DirectoryBackup } from "@cloudflare/sandbox";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export const SANDBOX_BACKUP_TTL_SECONDS = 365 * 24 * 60 * 60;

export const SANDBOX_BACKUP_EXCLUDES = [
	"node_modules",
	".pnpm-store",
	".yarn/cache",
	".next",
	"dist",
	"build",
	".cache",
	".turbo",
	".env",
	".env.*",
] as const;

export function serializeSandboxBackup(backup: DirectoryBackup): string;
export function parseSandboxBackup(value: string | null): DirectoryBackup | null;
export function hasPresignedBackupConfig(env: {
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_R2_ACCOUNT_ID?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	BACKUP_BUCKET_NAME?: string;
}): boolean;
export function shouldUseLocalBucketBackups(env: {
	USE_LOCAL_BUCKET_BACKUPS?: string;
}): boolean;
export function getSandboxBackupOptions(options: {
	env: Parameters<typeof hasPresignedBackupConfig>[0] &
		Parameters<typeof shouldUseLocalBucketBackups>[0];
	projectId: string;
}): BackupOptions;
```

Behavior requirements:

- `serializeSandboxBackup` stores only `id`, `dir`, and `localBucket` from the
  SDK's `DirectoryBackup`. Do not store access tokens, bucket credentials, env
  vars, or whole SDK objects.
- `parseSandboxBackup` returns `null` for `null`, malformed JSON, missing `id`,
  missing `dir`, `dir !== WORKSPACE_PATH`, or a non-boolean `localBucket`. It
  should not throw for bad DB values; callers will fall back to GitHub
  rebootstrap.
- `hasPresignedBackupConfig` returns `true` only when an account id,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `BACKUP_BUCKET_NAME` are all
  non-empty after trimming.
- `shouldUseLocalBucketBackups` returns `true` only when
  `USE_LOCAL_BUCKET_BACKUPS.trim() === "true"`.
- `getSandboxBackupOptions` returns:

  ```ts
  {
   dir: WORKSPACE_PATH,
   name: `project-${projectId}`,
   ttl: SANDBOX_BACKUP_TTL_SECONDS,
   excludes: [...SANDBOX_BACKUP_EXCLUDES],
   ...(shouldUseLocalBucketBackups(env) ? { localBucket: true } : {}),
  }
  ```

  If `shouldUseLocalBucketBackups(env)` is false and `hasPresignedBackupConfig(env)`
  is false, throw a regular `Error` with the message
  `Sandbox backups require R2 credentials or USE_LOCAL_BUCKET_BACKUPS=true.` before
  calling the Sandbox SDK. This prevents deployed misconfiguration from silently
  using the local-bucket backup path.

  Do not set `gitignore: true` in this first durable backup. This backup is meant
  to recover sandbox workspace state, including uncommitted user/agent edits,
  while excluding known bulky and sensitive paths explicitly.

Create `src/lib/sandbox-backup.test.ts` with Vitest coverage for:

- serializing and parsing a normal production backup handle
- serializing and parsing a local-bucket backup handle
- invalid JSON returns `null`
- missing `id` returns `null`
- missing `dir` returns `null`
- `dir` that is not `WORKSPACE_PATH` returns `null`
- `hasPresignedBackupConfig` requires all required fields
- `getSandboxBackupOptions` uses `localBucket: true` when presigned config is
  intentionally enabled through `USE_LOCAL_BUCKET_BACKUPS=true`
- `getSandboxBackupOptions` omits `localBucket` when presigned config is complete
- `getSandboxBackupOptions` throws when both local-bucket mode and presigned
  config are unavailable
- backup excludes include `.env` and `node_modules`

**Verify**: `pnpm exec vitest run src/lib/sandbox-backup.test.ts` -> exits 0.

### Step 4: Extend sandbox bootstrap with backup and restore operations

Update `src/lib/sandbox-bootstrap.ts` to centralize the Sandbox SDK operations
needed by both initial provisioning and later restore.

Required changes:

1. Import `type DirectoryBackup` from `@cloudflare/sandbox` and the helpers from
   `src/lib/sandbox-backup.ts`.
2. Add a small internal or exported `getProjectSandbox(env, sandboxId)` helper
   that wraps the existing `getSandbox(..., { enableDefaultSession: false })`
   pattern. Use it in `syncSandboxEnvFile`, `destroySandbox`, and the new
   helpers to avoid duplicated options.
3. Export `isSandboxWorkspaceHydrated(options)`:

   ```ts
   export async function isSandboxWorkspaceHydrated(options: {
   	env: Env;
   	sandboxId: string;
   }): Promise<boolean> {
   	const sandbox = getProjectSandbox(options.env, options.sandboxId);
   	const gitDir = await sandbox.exists(`${WORKSPACE_PATH}/.git`);
   	return gitDir.exists;
   }
   ```

   This plan is GitHub-repo focused. `.git` is the right hydration sentinel for
   GitHub-backed projects because it proves the repo was cloned or restored as a
   repo, not merely that an empty `/workspace` directory exists.

4. Export `backupSandboxWorkspace(options)`:

   ```ts
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

5. Export `restoreSandboxWorkspace(options)`:

   ```ts
   export async function restoreSandboxWorkspace(options: {
   	env: Env;
   	sandboxId: string;
   	backup: DirectoryBackup;
   	envVars: SandboxEnvVar[];
   }): Promise<void> {
   	const sandbox = getProjectSandbox(options.env, options.sandboxId);
   	await sandbox.restoreBackup(options.backup);
   	await syncSandboxEnvFile(options);
   	await installDependencies(sandbox);
   }
   ```

   Make the actual implementation type-correct; if passing all of `options` into
   `syncSandboxEnvFile` does not satisfy TypeScript, pass the exact fields.

6. Export `clearSandboxWorkspace(options)` and use it before any GitHub fallback
   rebootstrap into an existing sandbox. The helper must delete only the contents
   of the fixed `WORKSPACE_PATH`; it must never interpolate user input into the
   deletion command.

   Required safety guard:

   ```ts
   if (WORKSPACE_PATH !== "/workspace") {
   	throw new Error("Refusing to clear unexpected workspace path.");
   }
   ```

   Acceptable command shape inside the sandbox after the guard:

   ```ts
   await runCommand(sandbox, "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +", {
   	cwd: "/",
   	timeout: CLONE_TIMEOUT_MS,
   	errorPrefix: "Failed to clear sandbox workspace",
   });
   ```

   This is intentionally scoped to the sandbox container filesystem. Do not run
   host-level Docker, D1, or R2 deletion commands.

7. Change `bootstrapSandbox` to accept `projectId` and return the initial backup:

   ```ts
   export async function bootstrapSandbox(options: {
   	env: Env;
   	projectId: string;
   	sandboxId: string;
   	githubRepo: string;
   	installationId: number;
   	envVars: SandboxEnvVar[];
   }): Promise<{ sandboxId: string; backup: DirectoryBackup }>;
   ```

8. Inside `bootstrapSandbox`, before `sandbox.gitCheckout(...)`, call the same
   workspace-clear helper when reusing an existing sandbox ID. It is also safe for
   initial provisioning because `/workspace` should be empty. This prevents a
   failed restore from leaving stale files that make `gitCheckout` fail.
9. Inside `bootstrapSandbox`, after `installDependencies(sandbox)`, call
   `backupSandboxWorkspace({ env, sandboxId, projectId })` and return it. Keep
   the existing `catch` behavior that destroys the sandbox if any bootstrap step
   fails. That means a backup failure during initial provisioning should fail the
   provisioning attempt instead of creating a ready-but-unprotected project.

Do not include `.env` in backups. `syncSandboxEnvFile` should remain the source
of `.env` recreation after restore because project env vars are encrypted in D1.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 5: Store the initial backup during project creation

Update `src/integrations/trpc/routers/projects.ts` where `bootstrapSandbox` is
called.

Required behavior:

- Pass `projectId` into `bootstrapSandbox`.
- Destructure `{ sandboxId, backup }` from the result.
- Store `sandboxBackup: serializeSandboxBackup(backup)` and set
  `sandboxBackupCreatedAt` to the current unix timestamp in the same update that
  marks the project `ready`.
- Keep `envVars` omitted from response objects as today.
- Also omit `sandboxBackup` and `sandboxBackupCreatedAt` from the returned project
  response. If you use `.returning()` with the full row, destructure these fields
  out with `envVars` before returning.
- If provisioning fails, keep the existing `status: "failed"` update and stable
  `TRPCError` surface.

Representative target shape:

```ts
const { backup } = await bootstrapSandbox({
	env: ctx.env,
	projectId,
	sandboxId,
	githubRepo: githubImport.repo,
	installationId: githubImport.installationId,
	envVars: sanitizedEnvVars,
});

const [updatedProject] = await db
	.update(projects)
	.set({
		sandboxId,
		sandboxBackup: serializeSandboxBackup(backup),
		sandboxBackupCreatedAt: sql`(unixepoch())`,
		status: "ready",
		updatedAt: sql`(unixepoch())`,
	})
	.where(eq(projects.id, projectId))
	.returning();
```

Do not generate a new `sandboxId` on restore paths later in this plan. The v1
decision is one sandbox identity per project.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 6: Add an internal ensure/restore/rebootstrap coordinator

Create `src/lib/project-sandbox.ts`. This module coordinates DB state with the
sandbox operations from `src/lib/sandbox-bootstrap.ts`.

Required exports:

```ts
import type { createDb } from "#/db";
import { projects } from "#/db/schema";
import type { SandboxEnvVar } from "#/lib/sandbox-bootstrap";

export type EnsureProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: "connected" | "restored_from_backup" | "recreated_from_github";
};

export async function ensureProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
	envVars: SandboxEnvVar[];
}): Promise<EnsureProjectSandboxResult>;
```

Required behavior inside `ensureProjectSandbox`:

1. If `project.status !== "ready"` or `!project.sandboxId`, throw an `Error` with
   the stable message `Project sandbox is not ready yet.`.
2. If `project.githubRepo` or `project.githubInstallationId` is missing, throw
   `Project sandbox cannot be restored without a GitHub repository.`.
3. Call `isSandboxWorkspaceHydrated({ env, sandboxId })`.
4. If hydrated, return `{ project, state: "connected" }` without writing DB.
5. If not hydrated, acquire a restore lock by conditionally setting the project
   status from `ready` to `provisioning`:

   ```ts
   const [lockedProject] = await db
   	.update(projects)
   	.set({ status: "provisioning", updatedAt: sql`(unixepoch())` })
   	.where(
   		and(
   			eq(projects.id, project.id),
   			eq(projects.userId, project.userId),
   			eq(projects.status, "ready"),
   		),
   	)
   	.returning();
   ```

   If this returns no row, throw `Project sandbox is already being restored.`.

6. Parse `lockedProject.sandboxBackup` with `parseSandboxBackup`.
7. If a backup exists, try `restoreSandboxWorkspace`. If restore succeeds, create
   a fresh backup with `backupSandboxWorkspace` to renew the backup TTL and store
   that new handle. Before writing `ready`, call `isSandboxWorkspaceHydrated` again
   and require it to return `true`. Return `state: "restored_from_backup"`.
8. If there is no backup, the backup is malformed, the backup is expired, or
   `restoreSandboxWorkspace` fails, fall back to `bootstrapSandbox` using the
   same `sandboxId`, `githubRepo`, and `githubInstallationId`. Store the returned
   backup only after a post-bootstrap `isSandboxWorkspaceHydrated` check returns
   `true`, and return `state: "recreated_from_github"`.
9. On any successful restore or rebootstrap, update the project:

   ```ts
   status: "ready",
   sandboxBackup: serializeSandboxBackup(backup),
   sandboxBackupCreatedAt: sql`(unixepoch())`,
   updatedAt: sql`(unixepoch())`,
   ```

10. On final failure after both restore and fallback attempts, update the project
    to `status: "failed"` and throw a new sanitized `Error` with the message
    `Project sandbox restore failed. Please try again.`. Do not surface raw R2,
    GitHub token, or shell command output through the workspace router.

Keep the restore lock coarse and simple. Do not introduce a new lock table or
Durable Object coordinator in this plan.

Important edge cases:

- If restore succeeds but creating the fresh backup fails, treat the whole ensure
  as failed and leave the project `failed`. A ready project with no usable backup
  reintroduces the same bug this plan is fixing.
- Do not call `destroySandbox` when restore from backup fails before the GitHub
  fallback. A failed restore should not prevent reusing the same `sandboxId` for
  reclone.
- Clear `/workspace` inside the sandbox before GitHub fallback rebootstrap so a
  partially restored workspace cannot poison `gitCheckout`.
- If GitHub fallback fails after a restore failure, mark the project `failed` and
  surface the stable restore-failed message through the router layer.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 7: Use ensureProjectSandbox before workspace reads and run starts

Update `src/integrations/trpc/routers/workspace.ts` so both workspace entry
points verify and repair the sandbox before proceeding.

Required changes:

1. Import `ensureProjectSandbox` from `#/lib/project-sandbox`.
2. Reuse the existing env-var decrypt logic instead of duplicating it. If the
   helper is still private in `projects.ts`, extract the existing env-var helper
   functions into `src/lib/project-env-vars.ts` and update `projects.ts` to import
   them. Preserve the current behavior and error message for failed decrypts:
   `Failed to read project environment variables.` Keep the extraction small.
3. In `workspace.get`, after fetching the project and before reading sessions,
   replace the current `status + sandboxId` gate with:

   ```ts
   const envVars = await decryptEnvVars(
   	project.envVars,
   	ctx.env.BETTER_AUTH_SECRET,
   );
   let ensuredProject;
   let sandboxState;
   try {
   	const ensured = await ensureProjectSandbox({
   		db,
   		env: ctx.env,
   		project,
   		envVars,
   	});
   	ensuredProject = ensured.project;
   	sandboxState = ensured.state;
   } catch (error) {
   	throw new TRPCError({
   		code: "PRECONDITION_FAILED",
   		message:
   			error instanceof Error
   				? error.message
   				: "Project sandbox is not ready yet.",
   	});
   }
   ```

   Use `ensuredProject` internally for `projectResponse`, but strip
   `envVars`, `sandboxBackup`, and `sandboxBackupCreatedAt` before returning to
   the client.

4. Include a small sandbox state in the workspace response:

   ```ts
   sandbox: { state: sandboxState }
   ```

   This is not a public JSON report schema; it is an internal tRPC response.
   Keep it minimal.

5. In `workspace.startRun`, run the same ensure step before session/run creation.
   This defends the mutation path even if a client calls it without first calling
   `workspace.get`.
6. Preserve `startRun` error semantics. The current outer `catch` converts every
   error into `INTERNAL_SERVER_ERROR`; change it so `TRPCError` instances are
   rethrown unchanged. Wrap `ensureProjectSandbox` failures in a `TRPCError`
   before they reach the broad catch:

   ```ts
   try {
   	// decrypt env vars and ensure sandbox
   } catch (error) {
   	throw new TRPCError({
   		code:
   			error instanceof Error && error.message === "Project sandbox is already being restored."
   				? "CONFLICT"
   				: "PRECONDITION_FAILED",
   		message:
   			error instanceof Error
   				? error.message
   				: "Project sandbox is not ready yet.",
   	});
   }
   ```

   Then update the existing outer catch to start with:

   ```ts
   if (error instanceof TRPCError) {
   	throw error;
   }
   ```

Because `workspace.get` is currently a query, this introduces an idempotent repair
side effect at the workspace-open boundary. That is acceptable for this plan
because the product requirement is that reopening a project recovers the sandbox.
Do not add a background queue or polling state machine in this plan.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 8: Make env-var syncing restore-aware

Update `src/integrations/trpc/routers/projects.ts` in `setEnvVar` and
`deleteEnvVar`.

Current behavior writes `.env` if `project.sandboxId` exists. Change that to
ensure the sandbox is hydrated before syncing `.env`:

- Fetch the full project row with `.select().from(projects)` before calling
  `ensureProjectSandbox`. Avoid constructing partial fake project rows just to
  satisfy the helper type.
- After calculating `nextEnvVars`, call `ensureProjectSandbox` when
  `project.sandboxId` exists.
- Then call `syncSandboxEnvFile` using `ensured.project.sandboxId`.

Do not create a sandbox for scratch projects in this plan. If `sandboxId` is
missing, keep the current behavior of only updating encrypted env vars in D1.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 9: Keep the project route's user-facing state honest

Update `src/routes/project.$projectId.tsx` minimally so the loading/disabled text
matches the new behavior.

Required behavior:

- Keep enabling `workspace.get` when `project.status === "ready" && sandboxId`.
  The server will do the real hydration check.
- Change the pending disabled reason from only `Loading conversation...` to
  something that covers restore, for example `Checking project sandbox...`.
- If `workspace.data?.sandbox.state` is `"restored_from_backup"` or
  `"recreated_from_github"`, do not add a large UI feature. A small status line or
  toast is acceptable only if it fits the existing component patterns. If adding
  user-visible status requires touching broad chat UI files, skip it and leave a
  maintenance note.

Do not redesign the project page.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

### Step 10: Run final checks and manual restore verification

Run the automated checks:

1. `pnpm exec vitest run src/lib/sandbox-backup.test.ts` -> exits 0.
2. `pnpm test` -> exits 0.
3. `pnpm exec tsc --noEmit` -> exits 0.
4. `pnpm lint` -> exits 0; only pre-existing warnings in untouched files are
   allowed.
5. `git diff --check` -> no output.

Then manually verify the durable behavior locally:

1. Start the app with `pnpm dev`.
2. Create or reuse a GitHub-backed project and confirm it reaches `ready`.
3. Confirm the project row has a non-null `sandboxBackup` and
   `sandboxBackupCreatedAt`. Use the safest local D1 inspection method available
   in this repo and select only `id`, `status`, `sandboxId`, and
   `sandboxBackupCreatedAt`. Do not print `envVars`, `sandboxBackup`, encrypted
   values, or secrets.
4. Stop local dev.
5. Remove or invalidate only the local sandbox container/workspace state needed
   to simulate an empty sandbox. Do not delete the D1 project row or R2 backup
   storage. If there is no known safe, sandbox-only way to do this in the current
   environment, stop this manual section and report that destructive restore
   simulation remains unverified. Do not use `alchemy destroy`, `wrangler d1
   delete`, `wrangler r2 object delete`, `docker system prune`, or any host-level
   command that can remove unrelated containers or persistent data.
6. Restart `pnpm dev` and open the same project.
7. Expected result: `workspace.get` restores from backup or reclones from GitHub,
   then the chat workspace loads instead of permanently reporting "Project
   sandbox is not ready yet."
8. Confirm `.env` is recreated from encrypted D1 env vars after restore without
   storing `.env` in the backup.

If you cannot safely simulate container/workspace loss without deleting D1/R2
state, stop and report what manual verification remains instead of improvising
with destructive commands.

## Test plan

- New file: `src/lib/sandbox-backup.test.ts`
- Required cases:
  - backup handle serialization and parsing
  - malformed stored backup JSON returns `null`
  - local-bucket versus presigned backup option selection
  - production-misconfiguration case where neither local-bucket mode nor presigned
    config exists
  - backup excludes include `.env` and dependency/build directories
- Structural pattern: there are no current test files. Keep tests as small Vitest
  unit tests using `describe`, `it`, and `expect`; do not introduce a broad test
  harness.
- Manual integration coverage is required for actual Sandbox restore because the
  repo does not currently have a Miniflare/Sandbox integration test harness.

## Done criteria

All must hold:

- [ ] `alchemy.run.ts` binds `BACKUP_BUCKET` and the required backup env names.
- [ ] `src/db/schema.ts` includes `sandboxBackup` and
  `sandboxBackupCreatedAt` on `projects`.
- [ ] One new Drizzle migration adds the backup columns.
- [ ] `projects.create` stores the initial serialized `DirectoryBackup` before
  marking GitHub-backed projects `ready`.
- [ ] Opening a ready project no longer trusts `sandboxId` alone; it verifies
  `/workspace/.git` through the Sandbox SDK.
- [ ] Missing workspace restores from stored backup when possible.
- [ ] Missing or unusable backup falls back to recloning from GitHub using the
  existing `sandboxId`.
- [ ] Restore and rebootstrap paths both re-check `/workspace/.git` before
  marking the project `ready`.
- [ ] `.env` is excluded from backups and recreated through `syncSandboxEnvFile`.
- [ ] Client-facing project responses omit `sandboxBackup` and
  `sandboxBackupCreatedAt`.
- [ ] `pnpm exec vitest run src/lib/sandbox-backup.test.ts` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm exec tsc --noEmit` exits 0.
- [ ] `pnpm lint` exits 0 with no new warnings in touched files.
- [ ] `git diff --check` prints nothing.
- [ ] `plans/README.md` status row for Plan 015 is updated if this plan was
  executed directly.

## STOP conditions

Stop and report back without improvising if:

- The installed `@cloudflare/sandbox` version no longer exposes
  `createBackup`, `restoreBackup`, or `DirectoryBackup` with the semantics shown
  in this plan.
- Alchemy's current `R2Bucket` API differs from the documented `R2Bucket(name,
  { name })` shape and cannot be verified quickly from local docs/types.
- D1 migration generation would require changing unrelated existing migrations.
- TypeScript forces broad router or schema rewrites outside the files listed in
  scope.
- Workspace restore requires deleting user/project data outside the sandbox
  workspace.
- You discover a project type that is ready with `sandboxId` but intentionally
  has no GitHub repo; this plan is only for GitHub-backed project sandboxes.
- Any command would print secret values, GitHub tokens, private keys, or raw
  encrypted env-var contents.

## Maintenance notes

- Future real file-mutating agent execution must call `backupSandboxWorkspace`
  after successful mutating runs, otherwise the latest agent edits may not be in
  the durable backup. Plan 016 should wire this hook when it replaces the current
  placeholder run with the Flue project coder.
- The backup TTL is intentionally long but not infinite. If product expectations
  become permanent archival storage, revisit R2 lifecycle policy and backup
  retention explicitly.
- Reviewers should scrutinize secret handling: `.env` must stay out of backups,
  GitHub installation tokens must never be logged, and R2 secrets must only pass
  through bindings/env.
- `workspace.get` will perform an idempotent repair side effect. If the project
  later adds a background job system, this can be moved behind an explicit
  restore mutation/job without changing the underlying backup metadata model.
