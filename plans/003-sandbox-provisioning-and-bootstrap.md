# Plan 003: Sandbox Provisioning and Bootstrap

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report - do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 150dc21..HEAD -- package.json pnpm-lock.yaml README.md src/env.ts alchemy.run.ts src/lib/github-app.ts src/lib/github-repositories.ts Dockerfile src/server.ts src/lib/sandbox-bootstrap.ts src/integrations/trpc/router.ts src/components/new-project-dialog.tsx "src/routes/project.$projectId.tsx" src/routeTree.gen.ts types/env.d.ts vite.config.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plans/002-database-schema-and-trpc-projects.md
- **Category**: feature
- **Planned at**: commit `150dc21`, 2026-06-24

## Why this matters

The GitHub onboarding path already tells users that Ditto will initialize a sandbox, clone their repository, and install dependencies, but the current app still stops at inserting a `projects` row and closing the dialog. This plan connects that existing product promise to a real Cloudflare Sandbox-backed bootstrap flow.

This refresh intentionally narrows the work to the current app boundary. It covers initial sandbox creation for GitHub-backed projects, the server-side GitHub App signer inputs required to mint installation tokens, and the minimum UI/route surface needed for users to reach a created project afterward. It does **not** add branch selection back, does **not** build the full long-term workspace shell, and does **not** implement hibernation or draft-branch persistence yet.

This plan also keeps bootstrap synchronous inside `projects.create` for now. That is acceptable only as an early-stage simplification: the executor must add explicit command timeouts and stop if local testing suggests normal clone/install work does not fit reliably inside a single request.

## Current state

- `package.json` does not yet include the Sandbox SDK:

```json
  "dependencies": {
    "alchemy": "^0.93.11",
    "better-auth": "^1.5.3",
    "drizzle-orm": "^0.45.1",
    "nanoid": "^5.1.11",
    "octokit": "^5.0.5"
  }
```

- There is currently no root `Dockerfile` and no `src/server.ts`. The app is still relying on TanStack Start's default Worker entry.

- `src/env.ts` still only declares the OAuth-oriented GitHub env vars. There is no dedicated GitHub App signer input yet:

```ts
server: {
	BETTER_AUTH_SECRET: z.string().min(1),
	GITHUB_CLIENT_ID: z.string().min(1),
	GITHUB_CLIENT_SECRET: z.string().min(1),
	BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
}
```

In this repo, `src/env.ts` is useful for local typed/default consistency, but the authoritative server runtime contract still comes from Cloudflare/Alchemy bindings via `Env`. While touching this file for the GitHub App signer fields, also align the local `BETTER_AUTH_URL` default to `http://localhost:3000` and mirror that same local default in `alchemy.run.ts` so the repo has one authoritative local auth base URL across docs, env defaults, and local Worker bindings.

- `alchemy.run.ts` currently binds D1 and auth-related env vars, but does not add Sandbox container config, Durable Object bindings, migrations, or a custom Worker entrypoint:

```ts
export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
		APP_ENV: app.stage,
		VITE_GITHUB_APP_INSTALL_URL:
			process.env.VITE_GITHUB_APP_INSTALL_URL ??
			"https://github.com/apps/ditto-web/installations/new/",
	},
})
```

- `src/lib/github-app.ts` currently tries to build a GitHub App signer from the OAuth client credentials. That is not a safe bootstrap contract:

```ts
export function getGitHubApp(env: Env) {
	return new App({
		appId: env.GITHUB_CLIENT_ID,
		privateKey: env.GITHUB_CLIENT_SECRET,
	});
}

export async function getInstallationAccessToken(
	env: Env,
	installationId: number,
): Promise<string> {
	const app = getGitHubApp(env);
	const response = await app.octokit.rest.apps.createInstallationAccessToken({
		installation_id: installationId,
	});

	return response.data.token;
}
```

- `vite.config.ts` only enables the Alchemy plugin when `.alchemy/local/wrangler.jsonc` already exists, so `pnpm build` alone is not enough to prove the generated Worker config is correct:

```ts
const hasAlchemyWranglerConfig = existsSync(".alchemy/local/wrangler.jsonc");
const alchemyPlugins =
	mode === "test" || !hasAlchemyWranglerConfig
		? []
		: [alchemy() as PluginOption];
```

- `types/env.d.ts` currently infers `Env` from `typeof website.Env`. If the transformed Sandbox binding does not flow into that inferred type automatically, this plan must patch the type definition explicitly:

```ts
import type { website } from "../alchemy.run.ts"

export type CloudflareEnv = typeof website.Env

declare global {
	type Env = CloudflareEnv
}
```

- `src/integrations/trpc/router.ts` now has the `projects` router, but `projects.create` still only inserts a database row and returns it. It does not provision a sandbox, update `sandboxId`, or change status after insert:

```ts
const [project] = await db
	.insert(projects)
	.values({
		id: nanoid(),
		name: trimmedName,
		description: input.description,
		userId: ctx.user.id,
		githubRepo: input.githubRepo,
		githubInstallationId: input.githubInstallationId,
		status: "provisioning",
		envVars: encryptedEnvVars,
	})
	.returning();

return toProjectResponse(project);
```

- `src/components/new-project-dialog.tsx` still treats the final submit as a pure local state transition. The ready step button is wired to `handleContinue`, which just closes the dialog:

```ts
const handleContinue = useCallback(() => {
	if (step === "github" || step === "scratch") {
		setStep("ready");
	} else if (step === "ready") {
		handleClose();
	}
}, [step, handleClose]);

{step === "ready" && (
	<ReadyStep
		...
		onSubmit={handleContinue}
	/>
)}
```

- The dialog already promises sandbox behavior in the GitHub path, so this plan should implement that promise rather than changing the copy:

```tsx
<ul className="flex flex-col gap-1.5 text-sm">
	<li>Initialize a secure sandbox environment</li>
	<li>Clone the repository into the sandbox</li>
	<li>Install dependencies automatically</li>
</ul>
```

- The current route surface does **not** include a project detail route. `src/routes/` currently contains `__root.tsx`, `index.tsx`, `sign-in.tsx`, `installation.completed.tsx`, `api.auth.$.ts`, and `api.trpc.$.tsx`, but nothing for `/project/$projectId`. If users should be able to reach a newly provisioned project after creation, this plan must add a real route for it.

- Repo and platform notes to honor:

  - Cloudflare Sandbox docs require three wrangler sections: `containers`, `durable_objects.bindings`, and `migrations`.
  - Cloudflare Workers docs for TanStack Start say a custom `src/server.ts` entrypoint is where Durable Object exports belong.
  - Alchemy's TanStackStart docs say `src/server.ts` is auto-detected when present, and `wrangler.transform` can customize generated wrangler config.
  - Cloudflare Sandbox docs say the Docker image tag should match the exact installed `@cloudflare/sandbox` package version.
  - Adding a new file route in this repo also updates the tracked generated file `src/routeTree.gen.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install Sandbox SDK | `pnpm add @cloudflare/sandbox` | `package.json` and `pnpm-lock.yaml` updated |
| Resolve exact SDK version | `pnpm list @cloudflare/sandbox --depth 0` | output includes one installed version |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 |
| Lint | `pnpm lint` | exit 0 or warnings only |
| Build | `pnpm build` | exit 0 |
| Start local worker | `pnpm dev` | local dev starts and `.alchemy/local/wrangler.jsonc` is generated |

There is still no dedicated automated test harness for this area. Do not add one in this plan.

## Suggested executor toolkit

- Use the `sandbox-sdk` skill if it is available in the executor environment.
- Reference docs:
  - https://developers.cloudflare.com/sandbox/configuration/wrangler/
  - https://developers.cloudflare.com/sandbox/configuration/dockerfile/
  - https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
  - https://alchemy.run/providers/cloudflare/tanstack-start/

## Scope

**In scope**:
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- `plans/README.md`
- `src/env.ts`
- `alchemy.run.ts`
- `src/lib/github-app.ts`
- `Dockerfile` (create)
- `src/server.ts` (create)
- `src/lib/sandbox-bootstrap.ts` (create)
- `src/integrations/trpc/router.ts`
- `src/components/new-project-dialog.tsx`
- `src/routes/project.$projectId.tsx` (create)
- `src/routeTree.gen.ts`
- `types/env.d.ts`
- `.alchemy/local/wrangler.jsonc` (generated during verification)

**Out of scope**:
- `src/db/schema.ts` and database migrations from Plan 002
- `src/lib/crypto.ts`
- Any branch-selection UI or branch-aware clone logic
- Hibernation, draft-branch save/restore, or sandbox resume logic
- Creating anything larger than a minimal project status/detail page for the bootstrap result

## Git workflow

- Stay on the operator's current branch unless they instruct otherwise.
- Do not commit, push, or open a PR as part of this plan.
- If the operator later asks for a commit, recent history uses short Conventional Commit subjects such as `fix: dead code` and `refactor: github auth flow`.

## Steps

### Task 1: Split GitHub OAuth credentials from GitHub App signer credentials

- [ ] **Step 1: Extend the server env contract for GitHub App signing**
  Update `src/env.ts` to require dedicated server-only GitHub App signer fields:

  ```ts
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  ```

  Keep the existing `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` entries for Better Auth OAuth sign-in.
  Treat this file as a local typed/default layer only; the real server runtime contract is still defined by `alchemy.run.ts` bindings plus the inferred `Env` type.
  While you are there, change the default `BETTER_AUTH_URL` from `http://localhost:5173` to `http://localhost:3000` so the repo has one authoritative local auth base URL.

- [ ] **Step 2: Bind the new GitHub App signer env vars in `alchemy.run.ts`**
  Keep the existing bindings, but add:

  ```ts
  GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
  GITHUB_APP_PRIVATE_KEY: alchemy.secret(process.env.GITHUB_APP_PRIVATE_KEY),
  ```

  Use the same binding style the repo already uses for secrets.
  While you are editing this block, change the local fallback for `BETTER_AUTH_URL` from `""` to `"http://localhost:3000"` so local runtime bindings match the README and `src/env.ts`.

- [ ] **Step 3: Update `src/lib/github-app.ts` to use the dedicated App signer fields**
  Required behavior:

  - Keep Better Auth OAuth wiring untouched.
  - Build the `App` instance from `env.GITHUB_APP_ID` and `env.GITHUB_APP_PRIVATE_KEY`.
  - Normalize escaped newlines in the private key before passing it to `App`.
  - Keep `getInstallationAccessToken` exported.

- [ ] **Step 4: Make the README GitHub setup section internally consistent**
  Update `README.md` precisely, not just by appending two new env vars.

  Required README changes:

  - In `Deploy to Cloudflare Workers`, replace `pnpm alchemy login` with `pnpm exec alchemy login`, because there is no `alchemy` package script in `package.json`.
  - In `Setting up Better Auth`, keep the OAuth callback URLs section for Better Auth.
  - Keep `BETTER_AUTH_URL=http://localhost:3000` as the documented local auth URL.
  - Expand the env block to include:

  ```env
  GITHUB_APP_ID=
  GITHUB_APP_PRIVATE_KEY=
  ```

  - Replace the paragraph after that env block so it clearly says:
    - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are the Better Auth GitHub OAuth client credentials
    - `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` are the server-side GitHub App signer credentials used for installation tokens and sandbox bootstrap
    - `VITE_GITHUB_APP_INSTALL_URL` is the public GitHub App installation URL used by the onboarding dialog
  - Add one short setup note telling the operator where the two new GitHub App values come from:
    - `GITHUB_APP_ID` comes from the GitHub App settings page
    - `GITHUB_APP_PRIVATE_KEY` comes from a generated GitHub App private key PEM
  - Add one short permissions note for the GitHub App explaining that it must be installable on repositories the user selects and must grant the repository permissions needed for listing branches and cloning repository contents during bootstrap.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

---

### Task 2: Add the Sandbox SDK runtime scaffolding

- [ ] **Step 1: Install `@cloudflare/sandbox`**
  Run:

  ```bash
  pnpm add @cloudflare/sandbox
  ```

  Expected:

  - `package.json` gains `@cloudflare/sandbox`
  - `pnpm-lock.yaml` updates

- [ ] **Step 2: Create a root `Dockerfile` that matches the exact installed SDK version**
  Create `Dockerfile` in the repo root.

  Resolve the exact installed version with:

  ```bash
  pnpm list @cloudflare/sandbox --depth 0
  ```

  Then mirror that exact version in the Dockerfile base image tag.

  Required shape:

  - Use the Cloudflare Sandbox base image.
  - Match the Docker tag to the exact installed npm package version.
  - Do **not** override the base image entrypoint.
  - Keep the image minimal; this repo only needs JavaScript/TypeScript tooling for now.

  Example shape:

  ```dockerfile
  FROM docker.io/cloudflare/sandbox:<exact-installed-version>
  ```

- [ ] **Step 3: Create `src/server.ts` and export the Sandbox Durable Object**
  Create a custom Worker entrypoint at `src/server.ts`.

  Required behavior:

  - Re-export `Sandbox` from `@cloudflare/sandbox` as a named export.
  - Preserve TanStack Start's fetch handling.
  - Use `src/server.ts`, not `src/entry-server.tsx`.

  A minimal valid shape is:

  ```ts
  import handler from "@tanstack/react-start/server-entry";

  export { Sandbox } from "@cloudflare/sandbox";

  export default {
  	fetch: handler.fetch,
  };
  ```

- [ ] **Step 4: Update `alchemy.run.ts` to generate the required wrangler config**
  Keep the existing D1 config and bindings, but add Sandbox configuration through `TanStackStart(..., { wrangler: ... })`.

  Required behavior:

  - Set `wrangler.main` to `"src/server.ts"`.
  - Use `wrangler.transform` to add the Cloudflare Sandbox wrangler sections.
  - Ensure the generated spec contains exactly one `Sandbox` container entry, one `Sandbox` Durable Object binding, and one migration tag for the `Sandbox` class.
  - Keep existing env bindings intact.

  The resulting wrangler spec must include the equivalent of:

  ```ts
  containers: [
  	{
  		class_name: "Sandbox",
  		image: "./Dockerfile",
  		instance_type: "lite",
  		max_instances: 1,
  	},
  ],
  durable_objects: {
  	bindings: [{ class_name: "Sandbox", name: "Sandbox" }],
  },
  migrations: [{ new_sqlite_classes: ["Sandbox"], tag: "v1" }],
  ```

  Use the repo's current object style and avoid duplicating pre-existing wrangler config when merging.

- [ ] **Step 5: Ensure the Worker `Env` type includes the Sandbox binding**
  After wiring the new wrangler config, confirm that app code can refer to `env.Sandbox` without falling back to `any`.

  Required behavior:

  - Prefer letting `typeof website.Env` infer the binding automatically.
  - If that inference does not happen, update `types/env.d.ts` explicitly so `Env` includes `Sandbox` with the correct Durable Object namespace type.
  - Keep the existing `website.Env`-based pattern intact; do not introduce a second parallel env typing system.

**Verify**:

- `pnpm exec tsc --noEmit` -> exits 0.
- `pnpm dev` -> starts successfully.
- Read `.alchemy/local/wrangler.jsonc` after `pnpm dev` starts and confirm it now contains:
  - `main` pointing at `src/server.ts`
  - one `Sandbox` entry under `containers`
  - one `Sandbox` Durable Object binding
  - one `Sandbox` migration tag

---

### Task 3: Create a minimal sandbox bootstrap helper for GitHub-backed projects

- [ ] **Step 1: Create `src/lib/sandbox-bootstrap.ts`**
  Add a small server-only helper module that provisions a sandbox for a GitHub-backed project and returns the durable sandbox id.

  Required API shape:

  ```ts
  type SandboxEnvVar = { key: string; value: string };

  export async function bootstrapSandbox(options: {
  	env: Env;
  	sandboxId: string;
  	githubRepo: string;
  	installationId: number;
  	envVars: SandboxEnvVar[];
  }): Promise<{ sandboxId: string }>;
  ```

  Required behavior:

  - Reuse `getInstallationAccessToken` from `#/lib/github-app`.
  - Do **not** accept or use a branch argument.
  - Do **not** derive `sandboxId` by lowercasing `projectId`.
  - Generate `sandboxId` separately as a lowercase-safe identifier before calling the helper, for example with `crypto.randomUUID()`, and pass that explicit id into `bootstrapSandbox(...)`.
  - Create the sandbox with `getSandbox(env.Sandbox, sandboxId, { enableDefaultSession: false })` or an equivalent explicit-session-safe pattern.
  - Clone the repository into `/workspace` using the installation token.
  - Clone the remote default branch by omitting `--branch` entirely.
  - Immediately scrub the tokenized remote URL back to `https://github.com/<owner>/<repo>.git` after cloning.
  - If env vars exist, write them to `/workspace/.env`.
  - Serialize env var values safely for `.env` syntax. Do not use a naive `KEY=value` join. At minimum, wrap values in double quotes and escape embedded backslashes, double quotes, and newlines so free-form user input still produces a valid `.env` file.
  - Install dependencies using lockfile-aware logic instead of assuming pnpm only. At minimum support:
    - `pnpm-lock.yaml` -> `corepack enable` + `pnpm install --no-frozen-lockfile`
    - `yarn.lock` -> `corepack enable` + `yarn install`
    - `package-lock.json` or no recognized lockfile -> `npm install`
  - Before any install attempt, check whether `/workspace/package.json` exists.
  - If the repo has no `package.json`, skip dependency installation entirely and treat that as a successful bootstrap rather than a failure.
  - Use explicit timeouts for the expensive shell commands, especially clone and dependency install, and surface timeout failures clearly.
  - Use explicit `cwd` or absolute paths for commands; do not rely on shell state carrying across exec calls.
  - On failure, call `sandbox.destroy()` before rethrowing.

  Important simplifications for this plan:

  - Do not implement hibernation, draft branches, or `git push` logic.
  - Do not expose preview ports yet.
  - Do not read encrypted env vars from the database. This helper is called during `projects.create`, so it should consume the already-sanitized plain input values from the request path.

**Verify**: `pnpm exec tsc --noEmit` -> exits 0.

---

### Task 4: Wire sandbox provisioning into `projects.create`

- [ ] **Step 1: Extend the existing `projects.create` mutation in `src/integrations/trpc/router.ts`**
  Reuse the existing `createProjectInput`, `toProjectResponse`, and user scoping logic. Keep `health`, `github`, `projects.list`, and `projects.get` intact.

  Required behavior:

  - Import `sql` from `drizzle-orm` if needed for timestamp updates.
  - Import `bootstrapSandbox`.
  - Keep the existing name trimming, GitHub pair validation, and env-var sanitization.
  - Compute whether this project needs immediate sandbox bootstrap based on whether both `githubRepo` and `githubInstallationId` are present.
  - For scratch/non-GitHub projects, insert the row with `status: "ready"` and return it without bootstrap.
  - For GitHub-backed projects:
    - insert the row with `status: "provisioning"`
    - generate a separate lowercase-safe `sandboxId` before bootstrap and pass it to `bootstrapSandbox(...)`
    - call `bootstrapSandbox(...)` using the sanitized plain env vars
    - update the row with `sandboxId`, `status: "ready"`, and `updatedAt: sql\`(unixepoch())\``
    - return the updated row with `envVars` omitted
  - On bootstrap failure for a GitHub-backed project:
    - update the row to `status: "failed"`
    - set `updatedAt: sql\`(unixepoch())\``
    - throw `TRPCError({ code: "INTERNAL_SERVER_ERROR", ... })`

  Response requirement:

  - The final returned response must reflect the post-bootstrap state (`ready` + `sandboxId` for successful GitHub imports), not the original inserted `provisioning` row.

  Keep the implementation minimal. If you need a tiny local helper for `sanitizeEnvVars`, keep it in this file.

**Verify**:

- `pnpm exec tsc --noEmit` -> exits 0.
- `pnpm dev` -> still starts successfully.
- Read `.alchemy/local/wrangler.jsonc` and confirm the Sandbox entries added in Task 2 are still present.

---

### Task 5: Add a minimal project status route and wire the GitHub submit flow to it

- [ ] **Step 1: Create a real project detail/status route**
  Create `src/routes/project.$projectId.tsx` as the smallest useful landing page for a newly created project.

  Required behavior:

  - Read `projectId` from the route params.
  - Query `trpc.projects.get` for that id.
  - Render a small status page showing, at minimum:
    - project name
    - description if present
    - GitHub repo if present
    - status
    - sandbox id if present
  - Handle loading and error states plainly; do not design a large workspace shell in this plan.

  This route exists to make bootstrap results reachable. It is not the final project workspace.

- [ ] **Step 2: Submit the GitHub flow through the existing tRPC router**
  Update `src/components/new-project-dialog.tsx` so the GitHub ready-step submit actually calls `projects.create`.

  Required behavior:

  - Add a mutation using TanStack Query + the existing `useTRPC()` context.
  - Keep the existing stepper structure, GitHub repository picker, popup-install flow, and environment variable editor.
  - Resolve the selected GitHub repo object from `githubRepos` before submit. `selectedRepo` is the full repository name; the matching `GitHubRepo` object already includes `repoName` and `installationId`.
  - For the GitHub path, submit:
    - `name: selectedGitHubRepo.repoName`
    - `githubRepo: selectedGitHubRepo.name`
    - `githubInstallationId: selectedGitHubRepo.installationId`
    - `envVars`
  - While the mutation is pending:
    - disable dialog navigation controls
    - change the primary action label to a pending state such as `Initializing...`
    - show a small inline status message in the ready step for the GitHub path, for example `Spinning up sandbox and installing dependencies...`
    - block non-button closes as well; `Dialog` currently closes through `onOpenChange={handleClose}`, so update that path to ignore overlay/Escape close attempts while provisioning is in progress
    - disable or hide the built-in header close button while provisioning is in progress
  - If the mutation succeeds, navigate to `/project/${projectId}` using the returned project id.
  - On success, explicitly close/reset the controlled dialog before or during navigation so the modal does not remain open on the destination route.
  - If the mutation fails, keep the dialog open and show the error inline in the ready step.
  - Leave the scratch path unchanged in this plan. The scratch UI currently collects additional fields (`projectOverview`, `framework`) that are not yet persisted by the backend, so do not silently drop them here and do not wire scratch submit to `projects.create` in this plan.

  Current-product constraint:

  - The new `/project/${projectId}` route should be minimal and honest about the current state of provisioning.
  - Do not expand it into the full long-term workspace experience.

**Verify**: `pnpm build` -> exits 0 and the new route compiles into the route tree.

## Test plan

Do not add a new automated test setup in this plan.

Instead, verify with the repo's existing checks:

- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `pnpm dev`
- Read back `Dockerfile`, `src/server.ts`, `src/lib/sandbox-bootstrap.ts`, and `.alchemy/local/wrangler.jsonc` to confirm the Worker export, Docker base image, bootstrap logic, and generated Sandbox bindings match the plan.

## Done criteria

All of the following must hold:

- [ ] `package.json` and `pnpm-lock.yaml` include `@cloudflare/sandbox`
- [ ] `src/env.ts`, `alchemy.run.ts`, `src/lib/github-app.ts`, and `README.md` distinguish OAuth client credentials from GitHub App signer credentials
- [ ] `Dockerfile` exists and uses a Cloudflare Sandbox image tag that matches the exact installed package version
- [ ] `src/server.ts` exists, re-exports `Sandbox`, and preserves TanStack Start fetch handling
- [ ] `alchemy.run.ts` configures `src/server.ts`, Sandbox container config, Durable Object binding, and migration through `TanStackStart(..., { wrangler: ... })`
- [ ] `.alchemy/local/wrangler.jsonc` reflects the Sandbox container, Durable Object binding, and migration after `pnpm dev`
- [ ] `types/env.d.ts` or `typeof website.Env` gives typed access to `env.Sandbox`
- [ ] `src/lib/sandbox-bootstrap.ts` exists and clones the remote default branch without any branch input
- [ ] `projects.create` handles non-GitHub inputs as `ready` without bootstrap and GitHub-backed inputs as `ready` only after bootstrap succeeds
- [ ] Successful GitHub-backed project creation updates `sandboxId` and returns it to the client while still omitting encrypted `envVars`
- [ ] `src/routes/project.$projectId.tsx` exists as a minimal status/details page for created projects
- [ ] `src/routeTree.gen.ts` updates to include the new project route
- [ ] `src/components/new-project-dialog.tsx` submits only the GitHub path through `projects.create`, shows pending/error states, blocks overlay/Escape close while pending, explicitly closes the controlled dialog on success, and navigates to the new project route
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0 or only reports pre-existing warnings outside the files touched by this plan
- [ ] `pnpm build` exits 0
- [ ] `pnpm dev` starts successfully
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The live code in `src/env.ts`, `alchemy.run.ts`, `src/lib/github-app.ts`, `src/integrations/trpc/router.ts`, or `src/components/new-project-dialog.tsx` no longer matches the excerpts in "Current state".
- Adding Sandbox support to the generated Worker requires changing files outside this plan's scope, other than the auto-updated `pnpm-lock.yaml`, `src/routeTree.gen.ts`, and generated `.alchemy/local/wrangler.jsonc`.
- `pnpm dev` cannot generate `.alchemy/local/wrangler.jsonc` or cannot start because Docker/container support is unavailable locally.
- The Sandbox SDK or container config requires a different Alchemy integration pattern than `wrangler.main` plus `wrangler.transform`.
- Local testing shows ordinary GitHub clone/install work is too slow or too fragile for a synchronous `projects.create` request even with explicit timeouts; at that point, stop and split provisioning into a background workflow plan instead of stretching this design.
- Making the new `/project/${projectId}` route genuinely useful appears to require a much larger workspace shell, project navigation system, or chat integration than this plan allows.

## Maintenance notes

- This plan deliberately defers hibernation, draft-branch persistence, and preview-port exposure. Those should be separate follow-up work once the basic bootstrap loop is stable.
- If the GitHub auth/environment contract changes again later, the main touch points are `src/env.ts`, `alchemy.run.ts`, and `src/lib/github-app.ts`; the sandbox bootstrap flow itself should stay mostly unchanged.
- If a richer project workspace route is introduced later, it can replace the minimal `/project/${projectId}` status page from this plan.
- Reviewers should look closely at token scrubbing after clone, lockfile-aware dependency installation, generated wrangler config, and whether `projects.create` returns the updated post-bootstrap row rather than the initial insert row.
