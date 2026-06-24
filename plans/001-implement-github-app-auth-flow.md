# Plan 001: Implement the GitHub App Auth Flow

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat bcd434a..HEAD -- src/env.ts src/components/new-project-dialog.tsx alchemy.run.ts src/lib/github-repositories.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `bcd434a`, 2026-06-24

## Why this matters

The previous client-side GitHub OAuth flow requested broad `repo` permissions to all user repositories. Moving to a server-side **GitHub App** flow allows users to grant access to specific repositories, satisfying the principle of least privilege. Furthermore, retrieving installation access tokens on the server keeps secrets secure and lets the backend clone repositories directly inside the sandbox containers.

Using the official `octokit` SDK simplifies this architecture dramatically. Rather than writing manual JWT signers (e.g. using `jose`), handling cryptographic key parsing in Cloudflare Workers, and writing custom token exchange endpoints, we can use the `App` class from `octokit` which provides native, Web Crypto-based signing and high-level REST methods for managing installation credentials and querying repositories/branches.

## Current State

- `src/env.ts`:
```ts
export const env = createEnv({
	server: {
		BETTER_AUTH_SECRET: z.string().min(1),
		GITHUB_CLIENT_ID: z.string().min(1),
		GITHUB_CLIENT_SECRET: z.string().min(1),
		BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
	},
	clientPrefix: "VITE_",
	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
	},
	// ...
```

- `alchemy.run.ts`:
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
	},
})
```

- `src/components/new-project-dialog.tsx` (around lines 371-381):
```tsx
{selectedRepo && (
	<div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
		<GitBranchIcon
			aria-hidden="true"
			className="size-4 text-muted-foreground"
		/>
		<span className="text-sm">
			Selected: <span className="font-medium">{selectedRepo}</span>
		</span>
	</div>
)}
```

- `src/lib/github-repositories.ts` currently fetches user repositories via raw fetch:
```ts
export async function loadGitHubRepositories(...) { ... }
```

---

## Scope

**In scope**:
- `src/env.ts`
- `alchemy.run.ts`
- `src/lib/github-app.ts` (create)
- `src/lib/github-repositories.ts`
- `src/integrations/trpc/router.ts`
- `src/routes/auth/github-app-install-complete.tsx` (create)
- `src/components/new-project-dialog.tsx`

**Out of scope**:
- Creating database schemas or running migrations (covered in Plan 002).
- Provisioning containers or cloning code (covered in Plan 003).

---

## Steps

### Task 1: Environment Variables & Secrets Configuration

- [ ] **Step 1: Require GitHub App configurations in env validation**
  In [src/env.ts](file:///d:/dev/ditto/src/env.ts), add the following schemas under `server` and `client`:
  ```ts
  server: {
  	BETTER_AUTH_SECRET: z.string().min(1),
  	GITHUB_CLIENT_ID: z.string().min(1),
  	GITHUB_CLIENT_SECRET: z.string().min(1),
  	BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
  	GITHUB_APP_ID: z.string().min(1),
  	GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  },
  client: {
  	VITE_APP_TITLE: z.string().min(1).optional(),
  	VITE_GITHUB_APP_INSTALL_URL: z.string().url(),
  }
  ```

- [ ] **Step 2: Bind variables in worker configuration**
  In [alchemy.run.ts](file:///d:/dev/ditto/alchemy.run.ts), add these to the `bindings` object:
  ```ts
  GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
  VITE_GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL ?? "",
  ```

- [ ] **Step 3: Update local .env file**
  Add dummy configurations in `.env.local` or `.env` for local testing:
  ```text
  GITHUB_APP_ID=123456
  GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
  VITE_GITHUB_APP_INSTALL_URL=https://github.com/apps/ditto/installations/new
  ```

**Verify**: Run `pnpm build` -> type definitions compile successfully and website compiles.

---

### Task 2: Server-Side GitHub App Helper

- [ ] **Step 1: Create GitHub App helper module**
  Create [src/lib/github-app.ts](file:///d:/dev/ditto/src/lib/github-app.ts) using the official `App` class from `octokit`:
  ```ts
  import { App } from "octokit";

  export function getGitHubApp(env: Env) {
  	// Normalize PEM newlines if passed in one-line format
  	const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  	return new App({
  		appId: env.GITHUB_APP_ID,
  		privateKey,
  	});
  }

  export async function getInstallationAccessToken(
  	env: Env,
  	installationId: number
  ): Promise<string> {
  	const app = getGitHubApp(env);
  	const { token } = await app.getInstallationAccessToken({
  		installationId,
  	});
  	return token;
  }
  ```

**Verify**: Run `pnpm exec tsc --noEmit` -> compiles without errors.

---

### Task 3: Expose tRPC Queries for Installations, Repositories, & Branches

- [ ] **Step 1: Update repository loader to support App-installed repositories**
  In [src/lib/github-repositories.ts](file:///d:/dev/ditto/src/lib/github-repositories.ts), implement `getGitHubImportState` using the authenticated user's access token:
  ```ts
  import { Octokit } from "octokit";

  export async function getGitHubImportState({
  	accessToken,
  	installUrl,
  }: {
  	accessToken: string;
  	installUrl: string;
  }) {
  	const octokit = new Octokit({ auth: accessToken });

  	// Get all installations the user has access to
  	const installationsResponse = await octokit.rest.apps.listInstallationsForAuthenticatedUser();
  	const installations = installationsResponse.data.installations;

  	const repositories: Array<{
  		id: number;
  		name: string;
  		owner: string;
  		repoName: string;
  		language: string | null;
  		isPrivate: boolean;
  		stars: number;
  		installationId: number;
  	}> = [];

  	// Load repositories across all installations
  	for (const inst of installations) {
  		try {
  			const reposResponse = await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
  				installation_id: inst.id,
  			});
  			for (const repo of reposResponse.data.repositories) {
  				repositories.push({
  					id: repo.id,
  					name: repo.full_name,
  					owner: repo.owner.login,
  					repoName: repo.name,
  					language: repo.language || null,
  					isPrivate: repo.private,
  					stars: repo.stargazers_count,
  					installationId: inst.id,
  				});
  			}
  		} catch (err) {
  			console.error(`Failed to list repos for installation ${inst.id}:`, err);
  		}
  	}

  	return {
  		installations: installations.map((i) => ({
  			id: i.id,
  			account: {
  				login: i.account?.login || "",
  				avatarUrl: i.account?.avatar_url || "",
  			},
  		})),
  		repositories,
  		installUrl,
  	};
  }
  ```

- [ ] **Step 2: Add endpoints in tRPC Router**
  In [src/integrations/trpc/router.ts](file:///d:/dev/ditto/src/integrations/trpc/router.ts), import the helper modules and create the `github` sub-router:
  ```ts
  import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
  import { z } from "zod";
  import { getGitHubImportState } from "#/lib/github-repositories";
  import { getGitHubApp } from "#/lib/github-app";

  const githubRouter = {
  	importState: protectedProcedure.query(async ({ ctx }) => {
  		const installUrl = ctx.env.VITE_GITHUB_APP_INSTALL_URL;
  		const tokenResult = await ctx.auth.api.getAccessToken({
  			body: { providerId: "github", userId: ctx.user.id },
  			headers: ctx.request.headers,
  		});
  		const accessToken = tokenResult.accessToken ?? tokenResult.data?.accessToken;
  		if (!accessToken) {
  			throw new TRPCError({
  				code: "UNAUTHORIZED",
  				message: "GitHub authorization expired. Sign in again.",
  			});
  		}
  		return await getGitHubImportState({ accessToken, installUrl });
  	}),

  	listBranches: protectedProcedure
  		.input(
  			z.object({
  				owner: z.string(),
  				repo: z.string(),
  				installationId: z.number(),
  			})
  		)
  		.query(async ({ ctx, input }) => {
  			try {
  				const app = getGitHubApp(ctx.env);
  				const octokit = await app.getInstallationOctokit(input.installationId);
  				const response = await octokit.rest.repos.listBranches({
  					owner: input.owner,
  					repo: input.repo,
  					per_page: 100,
  				});
  				return response.data.map((b) => b.name);
  			} catch (err) {
  				throw new TRPCError({
  					code: "BAD_GATEWAY",
  					message: err instanceof Error ? err.message : "Failed to load branches.",
  				});
  			}
  		}),
  } satisfies TRPCRouterRecord;
  ```
  Register `github: githubRouter` on the root router.

**Verify**: Run `pnpm build` -> compiles without errors.

---

### Task 4: UI Branch Selection & Installation Redirect

- [ ] **Step 1: Create completion landing page**
  Create [src/routes/auth/github-app-install-complete.tsx](file:///d:/dev/ditto/src/routes/auth/github-app-install-complete.tsx):
  ```tsx
  import { createFileRoute } from "@tanstack/react-router";
  import { useEffect } from "react";

  export const Route = createFileRoute("/auth/github-app-install-complete")({
  	component: GitHubAppInstallComplete,
  });

  function GitHubAppInstallComplete() {
  	useEffect(() => {
  		window.opener?.postMessage({ type: "github-app-install-complete" }, window.location.origin);
  		window.close();
  	}, []);

  	return (
  		<main className="flex min-h-svh items-center justify-center p-6 text-center">
  			<p className="text-sm text-muted-foreground">GitHub App setup complete. Closing...</p>
  		</main>
  	);
  }
  ```

- [ ] **Step 2: Add branch state and selection to the dialog**
  In [src/components/new-project-dialog.tsx](file:///d:/dev/ditto/src/components/new-project-dialog.tsx):
  - Integrate a query or call to `github.importState` to load installations and repositories.
  - Implement a popup window workflow targeting `VITE_GITHUB_APP_INSTALL_URL` if they choose to install or configure the GitHub App.
  - Add state variables for `selectedBranch` (string | null), `branches` (string[]), and `branchesLoading` (boolean).
  - When `selectedRepo` changes, call the `github.listBranches` query using the repository owner/repo name and `installationId` from the state. Set the default branch once loaded.
  - Render the branch selection dropdown directly inside the repository selection view (below the selected repository banner), allowing the user to select their target branch before proceeding to the final step:
  ```tsx
  {selectedRepo && (
  	<div className="flex flex-col gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
  		<div className="flex items-center gap-2">
  			<GitBranchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
  			<span className="text-sm">
  				Selected: <span className="font-medium">{selectedRepo}</span>
  			</span>
  		</div>
  		<div className="flex items-center gap-2">
  			<span className="text-xs text-muted-foreground">Branch:</span>
  			<select
  				className="bg-background text-foreground text-xs rounded border border-input px-2 py-1"
  				value={selectedBranch || ""}
  				onChange={(e) => setSelectedBranch(e.target.value)}
  			>
  				{branches.map((b) => (
  					<option key={b} value={b}>{b}</option>
  				))}
  			</select>
  		</div>
  	</div>
  )}
  ```

- [ ] **Step 3: Wire the installation complete message listener**
  Add a message listener to reload/refetch the import state when the popup resolves and sends a message with type `github-app-install-complete`.

**Verify**: Build compiles and routes regenerate.

---

## STOP Conditions

Stop and report back if:
- Cloudflare environment lacks Cryptographic APIs needed by `octokit`.
- Octokit encounters bundler compatibility issues or polyfill errors when running within the Cloudflare Worker scope.
