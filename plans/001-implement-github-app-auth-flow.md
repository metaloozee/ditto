# Plan 001: Implement the GitHub App Auth Flow

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat bcd434a..HEAD -- src/env.ts src/components/new-project-dialog.tsx alchemy.run.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `bcd434a`, 2026-06-23

## Why this matters

The previous client-side GitHub OAuth flow requested broad `repo` permissions to all user repositories. Moving to a server-side **GitHub App** flow allows users to grant access to specific repositories, satisfying the principle of least privilege. Furthermore, retrieving installation access tokens on the server keeps secrets secure and lets the backend clone repositories directly inside the sandbox containers.

This plan configures the GitHub App authentication secrets, updates the tRPC router, adds branch selection directly inside the repository selection view, and sets bot commit credentials.

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

---

## Scope

**In scope**:
- `src/env.ts`
- `alchemy.run.ts`
- `src/lib/github-app-auth.ts` (create)
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

### Task 2: Server-Side GitHub App Token Helper

- [ ] **Step 1: Create token helper module**
  Create [src/lib/github-app-auth.ts](file:///d:/dev/ditto/src/lib/github-app-auth.ts) with jose-based JWT generation and token exchange:
  ```ts
  import { SignJWT, importPKCS8 } from "jose";

  async function generateGitHubAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  	// Normalize PEM newlines if passed in one-line format
  	const pem = privateKeyPem.replace(/\\n/g, "\n");
  	const privateKey = await importPKCS8(pem, "RS256");
  	return new SignJWT({})
  		.setProtectedHeader({ alg: "RS256" })
  		.setIssuedAt()
  		.setIssuer(appId)
  		.setExpirationTime("10m")
  		.sign(privateKey);
  }

  export async function getInstallationAccessToken(
  	appId: string,
  	privateKeyPem: string,
  	installationId: number
  ): Promise<string> {
  	const jwt = await generateGitHubAppJwt(appId, privateKeyPem);
  	const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
  		method: "POST",
  		headers: {
  			Accept: "application/vnd.github+json",
  			Authorization: `Bearer ${jwt}`,
  			"X-GitHub-Api-Version": "2022-11-28",
  		},
  	});
  	if (!res.ok) {
  		throw new Error(`Failed to generate installation access token: ${res.statusText}`);
  	}
  	const data = (await res.json()) as { token: string };
  	return data.token;
  }
  ```

**Verify**: Run `pnpm exec tsc --noEmit` -> compiles without errors.

---

### Task 3: Expose tRPC Queries for Installations & Branches

- [ ] **Step 1: Add endpoints in tRPC Router**
  In [src/integrations/trpc/router.ts](file:///d:/dev/ditto/src/integrations/trpc/router.ts), import the helpers and create the `github` sub-router:
  ```ts
  import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
  import { z } from "zod";
  import { getGitHubImportState } from "#/lib/github-repositories";
  import { getInstallationAccessToken } from "#/lib/github-app-auth";

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
  				const token = await getInstallationAccessToken(
  					ctx.env.GITHUB_APP_ID,
  					ctx.env.GITHUB_APP_PRIVATE_KEY,
  					input.installationId
  				);
  				const res = await fetch(
  					`https://api.github.com/repos/${input.owner}/${input.repo}/branches?per_page=100`,
  					{
  						headers: {
  							Accept: "application/vnd.github+json",
  							Authorization: `Bearer ${token}`,
  							"X-GitHub-Api-Version": "2022-11-28",
  						},
  					}
  				);
  				if (!res.ok) throw new Error(`GitHub API returned status ${res.status}`);
  				const branches = (await res.json()) as Array<{ name: string }>;
  				return branches.map((b) => b.name);
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
  - Define Git author configuration for the sandbox to use bot attribution: `Ditto Agent <agent@ditto.dev>`.

- [ ] **Step 3: Wire the installation complete message listener**
  Add a message listener to update the import state when the popup resolves with `github-app-install-complete`.

**Verify**: Build compiles and routes regenerate.

---

## STOP Conditions

Stop and report back if:
- Jose library cannot be imported in the Cloudflare Worker scope.
- Cloudflare environment lacks Cryptographic APIs needed by `jose`.
