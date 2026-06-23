# GitHub App Auth Import Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current client-side GitHub OAuth/repository import flow with a server-checked GitHub App installation flow that opens GitHub installation/configuration only when repository access is missing.

**Architecture:** Keep Better Auth as the user sign-in authority, but move GitHub App installation and repository checks behind a protected tRPC procedure. The client dialog asks the server for the authenticated user’s GitHub App import state, opens a GitHub install/configure popup only for `needs_installation` or `needs_repositories`, then refetches and renders the repository picker.

**Tech Stack:** React 19, TanStack Start/Router, tRPC 11, Better Auth 1.5, GitHub App REST APIs, Vitest, existing shadcn/cmdk dialog components.

---

## Research notes

- GitHub App installation URL format is `https://github.com/apps/APP-NAME/installations/new`; GitHub documents this as the direct third-party installation URL: https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party
- GitHub App setup URLs redirect users after installation. If “Redirect on update” is enabled, GitHub also redirects after users modify repository access: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url
- A GitHub App user access token can only access resources that both the user and the app can access. GitHub explicitly recommends `GET /user/installations` and `GET /user/installations/{installation_id}/repositories` to check installations and repositories for a user token: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- `GET /user/installations` returns installations accessible to the authenticated user access token. `GET /user/installations/{installation_id}/repositories` returns repositories the user can access for that installation: https://docs.github.com/en/rest/apps/installations
- Better Auth supports retrieving a social provider access token with `auth.api.getAccessToken` / `authClient.getAccessToken`, and supports additional social OAuth scope requests through `linkSocial`: https://www.better-auth.com/docs/concepts/oauth

## Scope decisions

- This plan assumes the existing `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` represent the GitHub App OAuth credentials, not a separate GitHub OAuth App. GitHub’s `/user/installations` endpoint only answers for the GitHub App associated with the user token.
- This plan does not add repository cloning/import execution. It stops at selecting a repository in the dialog, matching the current UI boundary.
- This plan keeps the public install URL in `VITE_GITHUB_APP_INSTALL_URL`, but makes it required and uses the same binding on the server through `ctx.env.VITE_GITHUB_APP_INSTALL_URL`.
- This plan replaces the current popup-based `authClient.linkSocial` import helper. Import should not relink GitHub on every repository picker open.

## File structure

- Modify `src/env.ts`: require `VITE_GITHUB_APP_INSTALL_URL`.
- Modify `alchemy.run.ts`: fail deployment setup when `VITE_GITHUB_APP_INSTALL_URL` is absent, bind the environment variable.
- Modify `src/lib/github-repositories.ts`: convert from client OAuth/popup code into pure server-safe GitHub App API helpers and shared types.
- Modify `src/lib/github-repositories.test.ts`: replace OAuth popup tests with GitHub App installation-state tests.
- Create `src/lib/github-app-install-popup.ts`: small browser-only helper for waiting on GitHub App installation/configuration popup completion.
- Create `src/lib/github-app-install-popup.test.ts`: tests for popup completion, close, timeout, and origin filtering.
- Modify `src/integrations/trpc/router.ts`: add a protected `github.importState` query that gets the Better Auth GitHub user access token and calls the GitHub App helper.
- Create `src/routes/auth/github-app-install-complete.tsx`: GitHub App setup URL landing route that posts a completion message to the opener and closes.
- Modify `src/components/new-project-dialog.tsx`: call tRPC for import state, open GitHub install/configure popup only when needed, render repository states and “Manage GitHub access” actions.
- Modify `README.md`: document GitHub App setup URL, redirect-on-update, and required environment variables.

---

### Task 1: Require and document GitHub App configuration

**Files:**
- Modify: [src/env.ts](file:///d:/dev/ditto/src/env.ts)
- Modify: [alchemy.run.ts](file:///d:/dev/ditto/alchemy.run.ts)
- Modify: [README.md](file:///d:/dev/ditto/README.md)

**Interfaces:**
- Produces: `env.VITE_GITHUB_APP_INSTALL_URL` on the client side, and binds `VITE_GITHUB_APP_INSTALL_URL` to Cloudflare Worker Env (which populates `ctx.env.VITE_GITHUB_APP_INSTALL_URL` on the server).

- [ ] **Step 1: Make the install URL required in client env validation**

In [src/env.ts](file:///d:/dev/ditto/src/env.ts), add `VITE_GITHUB_APP_INSTALL_URL` under `client`:

```ts
	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_GITHUB_APP_INSTALL_URL: z.url(),
	},
```

- [ ] **Step 2: Fail Alchemy setup when the install URL is missing**

In [alchemy.run.ts](file:///d:/dev/ditto/alchemy.run.ts), add this validation check immediately after `config({ path: [".env.local", ".env"] })`:

```ts
if (!process.env.VITE_GITHUB_APP_INSTALL_URL) {
	throw new Error(
		"VITE_GITHUB_APP_INSTALL_URL must be set to https://github.com/apps/<app-slug>/installations/new",
	);
}
```

- [ ] **Step 3: Bind the install URL in the Alchemy worker bindings**

In [alchemy.run.ts](file:///d:/dev/ditto/alchemy.run.ts), bind the variable to the website worker:

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
		VITE_GITHUB_APP_INSTALL_URL: process.env.VITE_GITHUB_APP_INSTALL_URL,
	},
})
```

- [ ] **Step 4: Update README GitHub auth setup instructions**

Replace the paragraph after the env block in [README.md](file:///d:/dev/ditto/README.md) that starts with `GitHub OAuth must provide email access.` with:

```md
Use a GitHub App, not a separate GitHub OAuth App, for `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`. The app must grant `Email addresses: Read-only` so
Better Auth can sign users in, and it must grant the repository permissions
needed by Ditto's import flow.

Set the GitHub App setup URL to:

```text
http://localhost:5173/auth/github-app-install-complete
https://<worker-url>/auth/github-app-install-complete
```

Enable **Redirect on update** in the GitHub App setup URL settings. Ditto uses
that redirect to close the installation/configuration popup and refresh the
repository picker.

Set `VITE_GITHUB_APP_INSTALL_URL` to the public install URL:

```text
https://github.com/apps/<your-app-slug>/installations/new
```
```

- [ ] **Step 5: Run build to verify bindings compile and type definitions regenerate**

Run:
```bash
pnpm build
```
Expected: PASS, and TypeScript types for `CloudflareEnv` / `Env` include `VITE_GITHUB_APP_INSTALL_URL`.

- [ ] **Step 6: Commit the environment configuration updates**

Run:
```bash
git add src/env.ts alchemy.run.ts README.md
git commit -m "config: require github app installation URL env variable"
```

---

### Task 2: Rewrite the GitHub repository helper around GitHub App installation state

**Files:**
- Modify: [src/lib/github-repositories.test.ts](file:///d:/dev/ditto/src/lib/github-repositories.test.ts)
- Modify: [src/lib/github-repositories.ts](file:///d:/dev/ditto/src/lib/github-repositories.ts)

**Interfaces:**
- Produces: `getGitHubImportState` (async function) and its related export types `GitHubImportState`, `GitHubRepo`, `GitHubInstallationSummary` from `#lib/github-repositories`.

- [ ] **Step 1: Replace helper tests with failing GitHub App state tests**

Replace [src/lib/github-repositories.test.ts](file:///d:/dev/ditto/src/lib/github-repositories.test.ts) with this complete file:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	getGitHubImportState,
	toGitHubRepo,
} from "#/lib/github-repositories";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json", ...init.headers },
		...init,
	});
}

describe("toGitHubRepo", () => {
	it("maps GitHub API repository fields into dialog fields", () => {
		expect(
			toGitHubRepo(
				{
					id: 42,
					full_name: "acme/dashboard",
					html_url: "https://github.com/acme/dashboard",
					language: "TypeScript",
					private: true,
					stargazers_count: 7,
					default_branch: "main",
					updated_at: "2026-06-20T12:00:00Z",
				},
				{
					id: 123,
					accountLogin: "acme",
					htmlUrl: "https://github.com/settings/installations/123",
					repositorySelection: "selected",
				},
			),
		).toEqual({
			id: 42,
			name: "acme/dashboard",
			htmlUrl: "https://github.com/acme/dashboard",
			language: "TypeScript",
			isPrivate: true,
			stars: 7,
			defaultBranch: "main",
			updatedAt: "2026-06-20T12:00:00Z",
			installationId: 123,
			installationAccountLogin: "acme",
			installationHtmlUrl: "https://github.com/settings/installations/123",
			repositorySelection: "selected",
		});
	});
});

describe("getGitHubImportState", () => {
	it("returns needs_installation when the user has no app installations", async () => {
		const fetchGitHub = vi.fn().mockResolvedValue(
			jsonResponse({ installations: [] }),
		);

		await expect(
			getGitHubImportState({
				accessToken: "token-123",
				installUrl: "https://github.com/apps/ditto/installations/new",
				fetchGitHub: fetchGitHub as unknown as typeof fetch,
			}),
		).resolves.toEqual({
			status: "needs_installation",
			installUrl: "https://github.com/apps/ditto/installations/new",
			installations: [],
			repositories: [],
		});
	});

	it("returns needs_repositories when installations exist but no repositories are selected", async () => {
		const fetchGitHub = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					installations: [
						{
							id: 123,
							account: { login: "acme" },
							repository_selection: "selected",
							html_url: "https://github.com/settings/installations/123",
							repositories_url:
								"https://api.github.com/user/installations/123/repositories",
						},
					],
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ repositories: [] }));

		await expect(
			getGitHubImportState({
				accessToken: "token-123",
				installUrl: "https://github.com/apps/ditto/installations/new",
				fetchGitHub: fetchGitHub as unknown as typeof fetch,
			}),
		).resolves.toEqual({
			status: "needs_repositories",
			installUrl: "https://github.com/apps/ditto/installations/new",
			installations: [
				{
					id: 123,
					accountLogin: "acme",
					htmlUrl: "https://github.com/settings/installations/123",
					repositorySelection: "selected",
				},
			],
			repositories: [],
		});
	});

	it("returns ready with repositories across accessible installations", async () => {
		const fetchGitHub = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					installations: [
						{
							id: 123,
							account: { login: "acme" },
							repository_selection: "selected",
							html_url: "https://github.com/settings/installations/123",
							repositories_url:
								"https://api.github.com/user/installations/123/repositories",
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					repositories: [
						{
							id: 42,
							full_name: "acme/dashboard",
							html_url: "https://github.com/acme/dashboard",
							language: "TypeScript",
							private: false,
							stargazers_count: 9,
							default_branch: "main",
							updated_at: "2026-06-20T12:00:00Z",
						},
					],
				}),
			);

		await expect(
			getGitHubImportState({
				accessToken: "token-123",
				installUrl: "https://github.com/apps/ditto/installations/new",
				fetchGitHub: fetchGitHub as unknown as typeof fetch,
			}),
		).resolves.toMatchObject({
			status: "ready",
			repositories: [
				{
					id: 42,
					name: "acme/dashboard",
					installationId: 123,
				},
			],
		});
	});

	it("throws a user-facing message for expired GitHub authorization", async () => {
		const fetchGitHub = vi.fn().mockResolvedValue(
			new Response("expired", { status: 401 }),
		);

		await expect(
			getGitHubImportState({
				accessToken: "expired-token",
				installUrl: "https://github.com/apps/ditto/installations/new",
				fetchGitHub: fetchGitHub as unknown as typeof fetch,
			}),
		).rejects.toThrow("GitHub authorization expired. Sign in again to continue.");
	});
});
```

- [ ] **Step 2: Run the focused helper tests and verify they fail**

Run:
```bash
pnpm vitest run src/lib/github-repositories.test.ts
```
Expected: FAIL (types and implementation don't match yet).

- [ ] **Step 3: Replace the helper implementation with the server-safe GitHub App module**

Replace [src/lib/github-repositories.ts](file:///d:/dev/ditto/src/lib/github-repositories.ts) with this complete file:

```ts
export type GitHubRepositorySelection = "all" | "selected";

export type GitHubInstallationSummary = {
	id: number;
	accountLogin: string;
	htmlUrl: string;
	repositorySelection: GitHubRepositorySelection;
};

export type GitHubRepo = {
	id: number;
	name: string;
	htmlUrl: string;
	language: string | null;
	isPrivate: boolean;
	stars: number;
	defaultBranch: string;
	updatedAt: string;
	installationId: number;
	installationAccountLogin: string;
	installationHtmlUrl: string;
	repositorySelection: GitHubRepositorySelection;
};

export type GitHubImportState =
	| {
			status: "needs_installation";
			installUrl: string;
			installations: [];
			repositories: [];
		}
	| {
			status: "needs_repositories";
			installUrl: string;
			installations: GitHubInstallationSummary[];
			repositories: [];
		}
	| {
			status: "ready";
			installUrl: string;
			installations: GitHubInstallationSummary[];
			repositories: GitHubRepo[];
		};

type GitHubApiInstallation = {
	id: number;
	account: { login: string };
	repository_selection: GitHubRepositorySelection;
	html_url: string;
	repositories_url: string;
};

type GitHubApiRepo = {
	id: number;
	full_name: string;
	html_url: string;
	language: string | null;
	private: boolean;
	stargazers_count: number;
	default_branch: string;
	updated_at: string;
};

type GetGitHubImportStateOptions = {
	accessToken: string;
	installUrl: string;
	fetchGitHub?: typeof fetch;
};

type InstallationWithRepositoriesUrl = GitHubInstallationSummary & {
	repositoriesUrl: string;
};

export async function getGitHubImportState({
	accessToken,
	installUrl,
	fetchGitHub = fetch,
}: GetGitHubImportStateOptions): Promise<GitHubImportState> {
	const installations = await listUserInstallations(fetchGitHub, accessToken);

	if (installations.length === 0) {
		return {
			status: "needs_installation",
			installUrl,
			installations: [],
			repositories: [],
		};
	}

	const repositoriesByInstallation = await Promise.all(
		installations.map(async (installation) => {
			const repos = await listInstallationRepositories(
				fetchGitHub,
				accessToken,
				installation,
			);
			return repos.map((repo) => toGitHubRepo(repo, installation));
		}),
	);
	const repositories = repositoriesByInstallation.flat();
	const summaries = installations.map(({ repositoriesUrl, ...summary }) => summary);

	if (repositories.length === 0) {
		return {
			status: "needs_repositories",
			installUrl,
			installations: summaries,
			repositories: [],
		};
	}

	return {
		status: "ready",
		installUrl,
		installations: summaries,
		repositories: repositories.sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt),
		),
	};
}

export function toGitHubRepo(
	repo: GitHubApiRepo,
	installation: GitHubInstallationSummary,
): GitHubRepo {
	return {
		id: repo.id,
		name: repo.full_name,
		htmlUrl: repo.html_url,
		language: repo.language,
		isPrivate: repo.private,
		stars: repo.stargazers_count,
		defaultBranch: repo.default_branch,
		updatedAt: repo.updated_at,
		installationId: installation.id,
		installationAccountLogin: installation.accountLogin,
		installationHtmlUrl: installation.htmlUrl,
		repositorySelection: installation.repositorySelection,
	};
}

async function listUserInstallations(
	fetchGitHub: typeof fetch,
	accessToken: string,
): Promise<InstallationWithRepositoriesUrl[]> {
	const installations = await githubJsonPages<GitHubApiInstallation>(
		fetchGitHub,
		"https://api.github.com/user/installations?per_page=100",
		accessToken,
		"installations",
	);

	return installations.map((installation) => ({
		id: installation.id,
		accountLogin: installation.account.login,
		htmlUrl: installation.html_url,
		repositorySelection: installation.repository_selection,
		repositoriesUrl: installation.repositories_url,
	}));
}

async function listInstallationRepositories(
	fetchGitHub: typeof fetch,
	accessToken: string,
	installation: InstallationWithRepositoriesUrl,
): Promise<GitHubApiRepo[]> {
	const separator = installation.repositoriesUrl.includes("?") ? "&" : "?";
	return githubJsonPages<GitHubApiRepo>(
		fetchGitHub,
		`${installation.repositoriesUrl}${separator}per_page=100`,
		accessToken,
		"repositories",
	);
}

async function githubJsonPages<T>(
	fetchGitHub: typeof fetch,
	firstUrl: string,
	accessToken: string,
	key: string,
): Promise<T[]> {
	const items: T[] = [];
	let nextUrl: string | null = firstUrl;

	while (nextUrl) {
		const response = await githubRequest(fetchGitHub, nextUrl, accessToken);
		const body = (await response.json()) as Record<string, T[]>;
		items.push(...(body[key] ?? []));
		nextUrl = getNextPageUrl(response.headers.get("link"));
	}

	return items;
}

async function githubRequest(
	fetchGitHub: typeof fetch,
	url: string,
	accessToken: string,
): Promise<Response> {
	const response = await fetchGitHub(url, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${accessToken}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	}).catch(() => {
		throw new Error(
			"Ditto could not reach GitHub. Check your connection and try again.",
		);
	});

	if (!response.ok) throw new Error(getGitHubApiErrorMessage(response));
	return response;
}

function getNextPageUrl(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	const nextLink = linkHeader
		.split(",")
		.map((part) => part.trim())
		.find((part) => part.includes('rel="next"'));
	return nextLink?.match(/<([^>]+)>/)?.[1] ?? null;
}

function getGitHubApiErrorMessage(response: Response): string {
	if (response.status === 401) {
		return "GitHub authorization expired. Sign in again to continue.";
	}
	if (
		response.status === 403 &&
		response.headers.get("x-ratelimit-remaining") === "0"
	) {
		return "GitHub rate limit reached. Wait a few minutes, then refresh repositories.";
	}
	if (response.status === 403) {
		return "GitHub refused repository access. Check GitHub App permissions, then try again.";
	}
	return `GitHub API request failed (${response.status}).`;
}
```

- [ ] **Step 4: Run the focused helper tests and verify they pass**

Run:
```bash
pnpm vitest run src/lib/github-repositories.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit the helper rewrite**

Run:
```bash
git add src/lib/github-repositories.ts src/lib/github-repositories.test.ts
git commit -m "refactor: rewrite github repositories helper around github app installation state"
```

---

### Task 3: Add the protected tRPC query that checks GitHub App access on the server

**Files:**
- Modify: [src/integrations/trpc/router.ts](file:///d:/dev/ditto/src/integrations/trpc/router.ts)

**Interfaces:**
- Consumes: `getGitHubImportState` from `#lib/github-repositories`
- Produces: `github.importState` query on the client-facing tRPC router.

- [ ] **Step 1: Add imports for tRPC errors and the GitHub helper**

In [src/integrations/trpc/router.ts](file:///d:/dev/ditto/src/integrations/trpc/router.ts), replace the top imports:

```ts
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { getGitHubImportState } from "#/lib/github-repositories";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "./init";
```

- [ ] **Step 2: Add the GitHub router record**

Add this block above `trpcRouter`:

```ts
const githubRouter = {
	importState: protectedProcedure.query(async ({ ctx }) => {
		const installUrl = ctx.env.VITE_GITHUB_APP_INSTALL_URL;
		if (!installUrl) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "GitHub App install URL is not configured.",
			});
		}

		const tokenResult = await ctx.auth.api.getAccessToken({
			body: {
				providerId: "github",
				userId: ctx.user.id,
			},
			headers: ctx.request.headers,
		});
		const accessToken = tokenResult.accessToken ?? tokenResult.data?.accessToken;

		if (!accessToken) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "GitHub authorization expired. Sign in again to continue.",
			});
		}

		try {
			return await getGitHubImportState({
				accessToken,
				installUrl,
			});
		} catch (error) {
			throw new TRPCError({
				code: "BAD_GATEWAY",
				message:
					error instanceof Error
						? error.message
						: "Unable to load GitHub repositories.",
			});
		}
	}),
} satisfies TRPCRouterRecord;
```

- [ ] **Step 3: Register the GitHub router**

In [src/integrations/trpc/router.ts](file:///d:/dev/ditto/src/integrations/trpc/router.ts), register `github: githubRouter` on the root router:

```ts
export const trpcRouter = createTRPCRouter({
	health: healthRouter,
	github: githubRouter,
});
export type TRPCRouter = typeof trpcRouter;
```

- [ ] **Step 4: Run typechecking for the router and codebase**

Run:
```bash
pnpm build
```
Expected: PASS.

- [ ] **Step 5: Commit the tRPC server query**

Run:
```bash
git add src/integrations/trpc/router.ts
git commit -m "feat: expose github app import state query in trpc"
```

---

### Task 4: Add the GitHub App setup-url completion route and popup helper

**Files:**
- Create: [src/routes/auth/github-app-install-complete.tsx](file:///d:/dev/ditto/src/routes/auth/github-app-install-complete.tsx)
- Create: [src/lib/github-app-install-popup.ts](file:///d:/dev/ditto/src/lib/github-app-install-popup.ts)
- Create: [src/lib/github-app-install-popup.test.ts](file:///d:/dev/ditto/src/lib/github-app-install-popup.test.ts)

**Interfaces:**
- Produces: `/auth/github-app-install-complete` landing page.
- Produces: `waitForGitHubAppInstallComplete` function (async function) from `#lib/github-app-install-popup`.

- [ ] **Step 1: Create the popup helper test**

Create [src/lib/github-app-install-popup.test.ts](file:///d:/dev/ditto/src/lib/github-app-install-popup.test.ts) with this complete file:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
	waitForGitHubAppInstallComplete,
} from "#/lib/github-app-install-popup";

function popup(closed = false) {
	return { closed } as Window;
}

describe("waitForGitHubAppInstallComplete", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves completed when the setup route posts the completion message", async () => {
		const promise = waitForGitHubAppInstallComplete(popup());

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: window.location.origin,
				data: { type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE },
			}),
		);

		await expect(promise).resolves.toBe("completed");
	});

	it("ignores messages from another origin", async () => {
		const promise = waitForGitHubAppInstallComplete(popup(), 1_000);

		window.dispatchEvent(
			new MessageEvent("message", {
				origin: "https://example.com",
				data: { type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE },
			}),
		);
		vi.advanceTimersByTime(1_000);

		await expect(promise).rejects.toThrow(
			"GitHub installation timed out. Try again.",
		);
	});

	it("resolves closed when the user closes the popup", async () => {
		const installWindow = popup(false);
		const promise = waitForGitHubAppInstallComplete(installWindow);

		installWindow.closed = true;
		vi.advanceTimersByTime(500);

		await expect(promise).resolves.toBe("closed");
	});
});
```

- [ ] **Step 2: Run the popup helper test and verify it fails**

Run:
```bash
pnpm vitest run src/lib/github-app-install-popup.test.ts
```
Expected: FAIL (missing target helper file).

- [ ] **Step 3: Create the popup helper**

Create [src/lib/github-app-install-popup.ts](file:///d:/dev/ditto/src/lib/github-app-install-popup.ts) with this complete file:

```ts
export const GITHUB_APP_INSTALL_COMPLETE_MESSAGE =
	"github-app-install-complete";

const DEFAULT_INSTALL_TIMEOUT_MS = 2 * 60 * 1000;

export type GitHubAppInstallWindowResult = "completed" | "closed";

export function waitForGitHubAppInstallComplete(
	installWindow: Window,
	timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS,
): Promise<GitHubAppInstallWindowResult> {
	return new Promise((resolve, reject) => {
		let intervalId: number | undefined;
		let timeoutId: number | undefined;

		const cleanup = () => {
			if (intervalId !== undefined) window.clearInterval(intervalId);
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
			window.removeEventListener("message", handleMessage);
		};
		const finish = (result: GitHubAppInstallWindowResult) => {
			cleanup();
			resolve(result);
		};
		const fail = (message: string) => {
			cleanup();
			reject(new Error(message));
		};
		const handleMessage = (event: MessageEvent) => {
			if (
				event.origin === window.location.origin &&
				event.data?.type === GITHUB_APP_INSTALL_COMPLETE_MESSAGE
			) {
				finish("completed");
			}
		};

		window.addEventListener("message", handleMessage);
		intervalId = window.setInterval(() => {
			if (installWindow.closed) finish("closed");
		}, 500);
		timeoutId = window.setTimeout(() => {
			fail("GitHub installation timed out. Try again.");
		}, timeoutMs);
	});
}
```

- [ ] **Step 4: Create the GitHub App setup-url route**

Create [src/routes/auth/github-app-install-complete.tsx](file:///d:/dev/ditto/src/routes/auth/github-app-install-complete.tsx) with this complete file:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { GITHUB_APP_INSTALL_COMPLETE_MESSAGE } from "#/lib/github-app-install-popup";

export const Route = createFileRoute("/auth/github-app-install-complete")({
	component: GitHubAppInstallComplete,
});

function GitHubAppInstallComplete() {
	useEffect(() => {
		window.opener?.postMessage(
			{ type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE },
			window.location.origin,
		);
		window.close();
	}, []);

	return (
		<main className="flex min-h-svh items-center justify-center p-6 text-center">
			<p className="text-sm text-muted-foreground">
				GitHub App setup complete. You can close this window.
			</p>
		</main>
	);
}
```

- [ ] **Step 5: Run focused popup tests and verify they pass**

Run:
```bash
pnpm vitest run src/lib/github-app-install-popup.test.ts
```
Expected: PASS.

- [ ] **Step 6: Regenerate TanStack route types**

Run:
```bash
pnpm build
```
Expected: PASS, and `src/routeTree.gen.ts` contains the `/auth/github-app-install-complete` route.

- [ ] **Step 7: Commit the install completion route and helper**

Run:
```bash
git add src/routes/auth/github-app-install-complete.tsx src/lib/github-app-install-popup.ts src/lib/github-app-install-popup.test.ts src/routeTree.gen.ts
git commit -m "feat: implement github app installation completion route and helper"
```

---

### Task 5: Rewrite the new project dialog import flow

**Files:**
- Modify: [src/components/new-project-dialog.tsx](file:///d:/dev/ditto/src/components/new-project-dialog.tsx)

**Interfaces:**
- Consumes: `env` from `#env`
- Consumes: `github.importState` query from `#integrations/tanstack-query/root-context` (via `trpcClient`)
- Consumes: `waitForGitHubAppInstallComplete` from `#lib/github-app-install-popup`
- Consumes: `GitHubImportState`, `GitHubRepo` types from `#lib/github-repositories`

- [ ] **Step 1: Replace GitHub repository imports and add validation env import**

In [src/components/new-project-dialog.tsx](file:///d:/dev/ditto/src/components/new-project-dialog.tsx), replace lines 47-50:

```ts
import {
	type GitHubRepo,
	loadGitHubRepositories,
} from "#/lib/github-repositories";
```

with the updated imports (including `env` from `src/env.ts` to access the installation URL validated and exported at runtime):

```ts
import { env } from "#/env";
import { trpcClient } from "#/integrations/tanstack-query/root-context";
import {
	waitForGitHubAppInstallComplete,
	type GitHubAppInstallWindowResult,
} from "#/lib/github-app-install-popup";
import type {
	GitHubImportState,
	GitHubRepo,
} from "#/lib/github-repositories";
```

- [ ] **Step 2: Replace state variables**

In [src/components/new-project-dialog.tsx](file:///d:/dev/ditto/src/components/new-project-dialog.tsx), replace these states (around line 117):

```ts
	const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
	const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
	const [githubLoading, setGithubLoading] = useState(false);
	const [githubError, setGithubError] = useState<string | null>(null);
```

with the new state variables representing the full GitHub Import State object returned from the server:

```ts
	const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
	const [githubImportState, setGithubImportState] =
		useState<GitHubImportState | null>(null);
	const [githubLoading, setGithubLoading] = useState(false);
	const [githubError, setGithubError] = useState<string | null>(null);
```

And add this derived value immediately below the state declarations to keep compatibility with other repository-picker render sites:

```ts
	const githubRepos = githubImportState?.repositories ?? [];
```

- [ ] **Step 3: Reset the import state**

In the `resetState` callback (around line 127), replace:

```ts
		setGithubRepos([]);
```

with:

```ts
		setGithubImportState(null);
```

- [ ] **Step 4: Add helper to choose the correct GitHub access URL**

Add this helper function immediately above `export function NewProjectDialog`:

```ts
function getGitHubAccessUrl(state: GitHubImportState | null) {
	if (state?.status === "needs_repositories" && state.installations.length === 1) {
		return state.installations[0].htmlUrl;
	}
	return state?.installUrl ?? env.VITE_GITHUB_APP_INSTALL_URL;
}
```

- [ ] **Step 5: Replace `loadGithubRepos` callback with server state loader**

Replace the entire `loadGithubRepos` callback implementation (lines 146-164) with `loadGithubImportState`:

```ts
	const loadGithubImportState = useCallback(
		async ({
			installWindow,
			autoOpenGitHub,
		}: {
			installWindow?: Window | null;
			autoOpenGitHub?: boolean;
		} = {}) => {
			setGithubLoading(true);
			setGithubError(null);
			setSelectedRepo(null);

			try {
				const state = await trpcClient.github.importState.query();
				setGithubImportState(state);

				if (state.status === "ready") {
					if (installWindow && !installWindow.closed) installWindow.close();
					return;
				}

				if (!autoOpenGitHub) return;

				const popup = installWindow;
				if (!popup) {
					throw new Error(
						"GitHub installation could not open. Allow pop-ups for Ditto and try again.",
					);
				}

				popup.location.href = getGitHubAccessUrl(state);
				const result: GitHubAppInstallWindowResult =
					await waitForGitHubAppInstallComplete(popup);
				const refreshedState = await trpcClient.github.importState.query();
				setGithubImportState(refreshedState);

				if (refreshedState.status !== "ready") {
					setGithubError(
						result === "closed"
							? "GitHub App access was not updated. Select repositories in GitHub, then try again."
							: "GitHub App access did not include any repositories. Select repositories in GitHub, then try again.",
					);
				}
			} catch (error) {
				setGithubError(
					error instanceof Error
						? error.message
						: "Unable to load GitHub repositories.",
				);
				setGithubImportState(null);
			} finally {
				setGithubLoading(false);
			}
		},
		[],
	);
```

- [ ] **Step 6: Update GitHub path selection callback and write status message**

Replace `handleChoosePath` (around line 166) to synchronously open and register the blank popup to avoid browser blockers, and write a status message to prevent a flash of a blank page:

```ts
	const handleChoosePath = useCallback(
		(chosen: OnboardingPath) => {
			setPath(chosen);
			setStep(chosen === "github" ? "github" : "scratch");

			if (chosen === "github") {
				const installWindow = window.open(
					"about:blank",
					"ditto-github-app-installation",
					"popup,width=600,height=720",
				);
				if (installWindow) {
					installWindow.document.write(
						"<p style='font-family:sans-serif; text-align:center; margin-top:20px; color:#666;'>Checking GitHub status...</p>",
					);
				}
				void loadGithubImportState({
					installWindow,
					autoOpenGitHub: true,
				});
			}
		},
		[loadGithubImportState],
	);
```

- [ ] **Step 7: Add a manual access-management callback**

Add this callback right below `handleChoosePath`:

```ts
	const handleManageGitHubAccess = useCallback(async () => {
		const installWindow = window.open(
			getGitHubAccessUrl(githubImportState),
			"ditto-github-app-installation",
			"popup,width=600,height=720",
		);
		await loadGithubImportState({
			installWindow,
			autoOpenGitHub: false,
		});
		if (!installWindow) return;
		try {
			await waitForGitHubAppInstallComplete(installWindow);
		} catch (error) {
			setGithubError(
				error instanceof Error
					? error.message
					: "GitHub installation did not complete.",
			);
			return;
		}
		await loadGithubImportState();
	}, [githubImportState, loadGithubImportState]);
```

- [ ] **Step 8: Disable input only when no repositories are loaded**

In the `CommandInput` component (around line 630), change the `disabled` prop to let the user search existing repositories while loading/checking background updates:

```tsx
							<CommandInput
								placeholder="Search repositories..."
								disabled={githubLoading || githubRepos.length === 0}
							/>
```

- [ ] **Step 9: Replace repository picker empty/error branches**

Replace the error and list-empty state checks inside the GitHub list container (lines rendering `githubError` and empty list items) with:

```tsx
						<CommandList className="max-h-[300px] min-h-[200px]">
							{githubLoading ? (
								<CommandEmpty>Checking GitHub App access…</CommandEmpty>
							) : githubError ? (
								<RepositoryStateMessage
									title="Couldn’t load repositories"
									description={githubError}
									action="Manage GitHub access"
									onAction={handleManageGitHubAccess}
								/>
							) : githubImportState?.status === "needs_installation" ? (
								<RepositoryStateMessage
									title="Install the GitHub App"
									description="Ditto needs the GitHub App installed before it can list repositories."
									action="Install app"
									onAction={handleManageGitHubAccess}
								/>
							) : githubImportState?.status === "needs_repositories" ? (
								<RepositoryStateMessage
									title="Select repositories in GitHub"
									description="The GitHub App is installed, but no repositories are available to Ditto."
									action="Configure repositories"
									onAction={handleManageGitHubAccess}
								/>
							) : githubRepos.length === 0 ? (
								<RepositoryStateMessage
									title="No repositories loaded"
									description="Refresh GitHub access to check your available repositories."
									action="Refresh"
									onAction={() => loadGithubImportState()}
								/>
							) : (
```

Keep the existing repository mapping block right after the final `: (`.

- [ ] **Step 10: Add the "Manage GitHub access" action bar**

Inside the GitHub dialog rendering block, directly underneath the `Command` block and before the selection banner, insert this helper footer:

```tsx
					<div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
						<p className="text-xs text-muted-foreground">
							Don’t see the repository you need?
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void handleManageGitHubAccess()}
						>
							Manage GitHub access
						</Button>
					</div>
```

- [ ] **Step 11: Add the RepositoryStateMessage private helper component**

Add the private UI state helper to the bottom of [src/components/new-project-dialog.tsx](file:///d:/dev/ditto/src/components/new-project-dialog.tsx):

```tsx
function RepositoryStateMessage({
	title,
	description,
	action,
	onAction,
}: {
	title: string;
	description: string;
	action: string;
	onAction: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
			<h3 className="text-sm font-medium text-foreground">{title}</h3>
			<p className="mt-2 text-xs text-muted-foreground max-w-[280px]">
				{description}
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="mt-4"
				onClick={onAction}
			>
				{action}
			</Button>
		</div>
	);
}
```

- [ ] **Step 12: Run build to verify type check and compile success**

Run:
```bash
pnpm build
```
Expected: PASS.

- [ ] **Step 13: Commit the dialog changes**

Run:
```bash
git add src/components/new-project-dialog.tsx
git commit -m "feat: update project onboarding dialog to use server-safe github app installation state"
```

---

### Task 6: Manual QA for the complete auth-import workflow

**Files:**
- No source changes expected

- [ ] **Step 1: Start the application development server**

Run:
```bash
pnpm dev
```
Expected: dev server starts.

- [ ] **Step 2: Verify signed-in user with existing installation and repositories**

In the browser:
1. Sign in with Better Auth/GitHub.
2. Open **New Project**.
3. Choose **Import from GitHub**.
Expected: the server checks GitHub App access, any reserved blank popup closes, and the repository picker appears with repositories sorted by `updated_at` descending.

- [ ] **Step 3: Verify no-installation path**

Using a GitHub user/account that has not installed the app:
1. Sign in.
2. Open **New Project**.
3. Choose **Import from GitHub**.
Expected: the reserved popup navigates to `https://github.com/apps/<your-app-slug>/installations/new`. After installation, GitHub redirects to `/auth/github-app-install-complete`, the popup closes, and the repository picker refreshes.

- [ ] **Step 4: Verify empty-repository installation path**

Using an installation configured with no selected repositories:
1. Open **Import from GitHub**.
2. Confirm the dialog shows **Select repositories in GitHub**.
3. Click **Configure repositories**.
4. Select at least one repository in GitHub.
Expected: after GitHub redirects to `/auth/github-app-install-complete`, the popup closes and the selected repository appears in the picker.

- [ ] **Step 5: Verify add-more-repositories path**

With at least one repository already visible:
1. Click **Manage GitHub access**.
2. Add another repository in GitHub.
3. Return to Ditto after the popup closes.
Expected: the newly selected repository appears without signing in again.

- [ ] **Step 6: Run final QA checking (lint, test, build)**

Run:
```bash
pnpm lint
pnpm test
pnpm build
```
Expected: PASS.

- [ ] **Step 7: Commit any QA polish fixes**

If QA required changes, run:
```bash
git add src docs README.md alchemy.run.ts
git commit -m "fix: polish github app import workflow"
```
Expected: no commit is created if QA required no code changes.
