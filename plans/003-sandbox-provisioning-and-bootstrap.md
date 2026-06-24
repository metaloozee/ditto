# Plan 003: Sandbox Provisioning and Bootstrap

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat bcd434a..HEAD -- package.json alchemy.run.ts src/integrations/trpc/router.ts src/components/new-project-dialog.tsx`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plans/001-implement-github-app-auth-flow.md, plans/002-database-schema-and-trpc-projects.md
- **Category**: feature
- **Planned at**: commit `bcd434a`, 2026-06-24

## Why this matters

To provide an AI coding agent with a workspace, each project must have an isolated, secure execution environment. This plan integrates the **Cloudflare Sandbox SDK**, configures container bindings, and implements the server-side bootstrap flow that clones repositories using scoped installation tokens and installs dependencies.

Using the official `octokit` integration, the server can inspect the remote repository directly before running container tasks. For example, to prevent dataloss when containers hibernate (auto-stopped after 10 minutes of inactivity), the plan implements an hibernation handler that pushes uncommitted file modifications to a draft branch (`ditto/draft-workspace`) and pulls from it on wake-up. By checking the remote branch with `octokit` instead of executing slow shell commands like `git ls-remote` inside the container, we increase reliability and decrease boot times.

---

## Current State

- `package.json` current dependencies block:
```json
  "dependencies": {
    "better-auth": "^1.5.3",
    "drizzle-orm": "^0.45.1",
    "react": "^19.2.0"
    // ...
  }
```

- `alchemy.run.ts` current bindings block:
```typescript
export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
		APP_ENV: app.stage,
	},
})
```

- `src/components/new-project-dialog.tsx` `handleContinue` execution path (around lines 187-194):
```typescript
	const handleContinue = useCallback(() => {
		if (step === "github" || step === "scratch") {
			setStep("ready");
		} else if (step === "ready") {
			handleClose();
		}
	}, [step, handleClose]);
```

---

## Scope

**In scope**:
- `package.json`
- `alchemy.run.ts`
- `src/entry-server.tsx` (create or modify if present)
- `src/lib/sandbox-bootstrap.ts` (create)
- `src/integrations/trpc/router.ts`
- `src/components/new-project-dialog.tsx`

**Out of scope**:
- Defining encryption helper (covered in Plan 002).
- Implementing UI changes outside of the onboarding dialog.

---

## Steps

### Task 1: SDK Installation & Worker Bindings

- [ ] **Step 1: Install the Cloudflare Sandbox SDK**
  Run:
  ```bash
  pnpm install @cloudflare/sandbox
  ```
  Expected: package is successfully installed.

- [ ] **Step 2: Re-export the Sandbox class in Server Entry**
  Create or edit the custom server entrypoint (e.g. `src/entry-server.tsx` or `src/server.ts` depending on TanStack Start configuration) to export the `Sandbox` Durable Object class so that Cloudflare Workers can bind and resolve it:
  ```typescript
  import { createStartHandler } from "@tanstack/react-start/server";
  import { getRouter } from "./router";

  export { Sandbox } from "@cloudflare/sandbox"; // REQUIRED export for bindings

  export default createStartHandler({
  	createRouter: getRouter,
  });
  ```

- [ ] **Step 3: Configure Container and Durable Object bindings in Alchemy**
  In [alchemy.run.ts](file:///d:/dev/ditto/alchemy.run.ts), register the container and Durable Object configurations:
  ```typescript
  export const website = await TanStackStart("website", {
  	url: true,
  	bindings: {
  		DB: database,
  		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
  		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
  		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
  		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
  		GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
  		GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
  		VITE_GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL ?? "",
  	},
  	containers: [
  		{
  			class_name: "Sandbox",
  			image: "./Dockerfile", // Base image containing Node/Git
  			instance_type: "lite",
  			max_instances: 5,
  		},
  	],
  	durable_objects: {
  		bindings: [{ class_name: "Sandbox", name: "Sandbox" }],
  	},
  	migrations: [{ new_sqlite_classes: ["Sandbox"], tag: "v1" }],
  });
  ```

**Verify**: Run `pnpm build` -> compiles and generates types successfully.

---

### Task 2: Implement the Sandbox Bootstrap Runner

- [ ] **Step 1: Create the bootstrap helper**
  Create [src/lib/sandbox-bootstrap.ts](file:///d:/dev/ditto/src/lib/sandbox-bootstrap.ts):
  ```typescript
  import { getSandbox } from "@cloudflare/sandbox";
  import { getGitHubApp, getInstallationAccessToken } from "./github-app";

  interface BootstrapOptions {
  	env: Env;
  	projectId: string;
  	githubRepo: string;
  	installationId: number;
  	branch: string;
  	envVars: Array<{ key: string; value: string }>;
  }

  export async function bootstrapSandbox({
  	env,
  	projectId,
  	githubRepo,
  	installationId,
  	branch,
  	envVars,
  }: BootstrapOptions): Promise<string> {
  	// 1. Get installation token and app client
  	const token = await getInstallationAccessToken(env, installationId);
  	const app = getGitHubApp(env);
  	const octokit = await app.getInstallationOctokit(installationId);

  	// 2. Initialize/Get container instance
  	const sandbox = getSandbox(env.Sandbox, projectId);

  	try {
  		// Create workspace directory
  		await sandbox.mkdir("/workspace", { recursive: true });

  		// Configure Git Bot Attribution credentials
  		await sandbox.exec(`git config --global user.name "Ditto Agent"`);
  		await sandbox.exec(`git config --global user.email "agent@ditto.dev"`);

  		// 3. Check if draft workspace branch exists on remote using Octokit
  		let targetBranch = branch;
  		const [owner, repo] = githubRepo.split("/");
  		try {
  			await octokit.rest.repos.getBranch({
  				owner,
  				repo,
  				branch: "ditto/draft-workspace",
  			});
  			targetBranch = "ditto/draft-workspace";
  		} catch {
  			// Branch does not exist, use default/selected branch
  		}

  		// Clone repository
  		const cloneRes = await sandbox.exec(
  			`git clone --branch ${targetBranch} --depth 1 https://x-access-token:${token}@github.com/${githubRepo}.git /workspace`
  		);
  		if (!cloneRes.success) {
  			throw new Error(`Git clone failed: ${cloneRes.stderr}`);
  		}

  		// Scrub credentials from Git config URL
  		await sandbox.exec(`git -C /workspace config remote.origin.url "https://github.com/${githubRepo}.git"`);

  		// 4. Write environment variables to .env
  		if (envVars.length > 0) {
  			const envContent = envVars.map((v) => `${v.key}=${v.value}`).join("\n");
  			await sandbox.writeFile("/workspace/.env", envContent);
  		}

  		// 5. Run dependency installation
  		const installRes = await sandbox.exec(`cd /workspace && pnpm install --no-frozen-lockfile || npm install`);
  		if (!installRes.success) {
  			throw new Error(`Dependency installation failed: ${installRes.stderr}`);
  		}

  		return sandbox.id;
  	} catch (err) {
  		await sandbox.destroy();
  		throw err;
  	}
  }

  // 6. Hibernation Handler (invoked on container inactivity or shutdown)
  export async function hibernateSandbox(env: Env, projectId: string, githubRepo: string, installationId: number) {
  	const sandbox = getSandbox(env.Sandbox, projectId);
  	const token = await getInstallationAccessToken(env, installationId);

  	// Re-inject token to perform git push
  	await sandbox.exec(`git -C /workspace config remote.origin.url "https://x-access-token:${token}@github.com/${githubRepo}.git"`);
  	
  	// Check for uncommitted modifications
  	const statusRes = await sandbox.exec(`git -C /workspace status --porcelain`);
  	if (statusRes.stdout.trim().length > 0) {
  		await sandbox.exec(`git -C /workspace checkout -b ditto/draft-workspace || git -C /workspace checkout ditto/draft-workspace`);
  		await sandbox.exec(`git -C /workspace add -A`);
  		await sandbox.exec(`git -C /workspace commit -m "ditto: save workspace draft"`);
  		await sandbox.exec(`git -C /workspace push -f origin ditto/draft-workspace`);
  	}
  	
  	await sandbox.destroy();
  }
  ```

**Verify**: Run `pnpm exec tsc --noEmit` -> compiles without errors.

---

### Task 3: Trigger Bootstrapping and Handle UI States

- [ ] **Step 1: Trigger bootstrap during project creation**
  In the `projects.create` mutation inside [src/integrations/trpc/router.ts](file:///d:/dev/ditto/src/integrations/trpc/router.ts), fetch the created project and boot the sandbox synchronously before returning:
  ```typescript
  import { bootstrapSandbox } from "#/lib/sandbox-bootstrap";
  import { createDb } from "#/db";

  // Inside projects.create mutation
  const db = createDb(ctx.env);
  
  // Create database record...
  // Parse env variables...
  const envVarsParsed = input.envVars ?? [];

  try {
  	if (input.githubRepo && input.githubInstallationId) {
  		const sandboxId = await bootstrapSandbox({
  			env: ctx.env,
  			projectId: projectId,
  			githubRepo: input.githubRepo,
  			installationId: input.githubInstallationId,
  			branch: input.branch ?? "main",
  			envVars: envVarsParsed,
  		});

  		await db
  			.update(projects)
  			.set({ sandboxId, status: "ready" })
  			.where(eq(projects.id, projectId));
  	}
  } catch (err) {
  	await db
  		.update(projects)
  		.set({ status: "failed" })
  		.where(eq(projects.id, projectId));
  	
  	throw new TRPCError({
  		code: "INTERNAL_SERVER_ERROR",
  		message: err instanceof Error ? err.message : "Failed to initialize project sandbox.",
  	});
  }
  ```

- [ ] **Step 2: Update UI onboarding dialog**
  In [src/components/new-project-dialog.tsx](file:///d:/dev/ditto/src/components/new-project-dialog.tsx):
  - On `onSubmit` (in the `ReadyStep`), call the `projects.create` mutation.
  - Show a spinning loader modal saying: `"Spinning up sandbox and downloading code..."` or `"Installing dependencies..."` while the request is pending.
  - On success, redirect the user to `/project/${projectId}`.

**Verify**: Run final builds and type checks.

---

## STOP Conditions

Stop and report back if:
- Cloudflare Workers limits memory/CPU and causes timeout error during `pnpm install`.
- Sandbox container fails to authenticate with the provided `x-access-token` token during git push or git clone.
