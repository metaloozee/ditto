# Plan 003: Extract the GitHub repository loader from the dialog

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c1853db..HEAD -- src/components/new-project-dialog.tsx src/lib`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-complete-github-oauth-popup-flow.md, plans/002-add-github-loading-timeout-and-copy-fix.md
- **Category**: tech-debt
- **Planned at**: commit `c1853db`, 2026-06-19

## Why this matters

`src/components/new-project-dialog.tsx` is already a large component that owns path selection, scratch-project fields, environment variables, GitHub OAuth, GitHub API fetching, and summary rendering. Keeping OAuth and API details embedded in the component makes the core GitHub import flow harder to test and increases the chance that future UI changes break authentication. Extracting a small repository loader gives the component a clear boundary: the dialog manages UI state; the loader handles GitHub auth/token/API mechanics.

This supports Ditto's product principle to keep importing and iteration continuous rather than disconnected or opaque (`PRODUCT.md:35`) while preserving clear loading/error states (`PRODUCT.md:39`).

## Current state

Relevant files:

- `src/components/new-project-dialog.tsx` — current large dialog and GitHub loader implementation.
- `src/lib/auth-client.ts` — exports the shared Better Auth client.
- `src/lib/github-repositories.ts` — create this file for the extracted loader.
- `src/lib/github-repositories.test.ts` — create this file for focused loader tests.

Current local GitHub types in `src/components/new-project-dialog.tsx`:

```tsx
// src/components/new-project-dialog.tsx:50-73
type GitHubRepo = {
	name: string;
	language: string | null;
	isPrivate: boolean;
	stars: number;
};

type GitHubApiRepo = {
	full_name: string;
	language: string | null;
	private: boolean;
	stargazers_count: number;
};

type AccessTokenResult = {
	accessToken?: string;
	data?: { accessToken?: string } | null;
	error?: { message?: string } | null;
};

type LinkSocialResult = {
	data?: { url?: string } | null;
	error?: { message?: string } | null;
};
```

Current mapping helper:

```tsx
// src/components/new-project-dialog.tsx:91-98
function toGitHubRepo(repo: GitHubApiRepo): GitHubRepo {
	return {
		name: repo.full_name,
		language: repo.language,
		isPrivate: repo.private,
		stars: repo.stargazers_count,
	};
}
```

Current embedded loader:

```tsx
// src/components/new-project-dialog.tsx:151-216
const loadGithubRepos = useCallback(async () => {
	setGithubLoading(true);
	setGithubError(null);
	setSelectedRepo(null);

	const authWindow = window.open("about:blank", "github-repository-access");

	try {
		const linkResult = (await authClient.linkSocial({
			provider: "github",
			scopes: ["repo"],
			disableRedirect: true,
		})) as LinkSocialResult;
		// ... token fetch, GitHub API fetch ...
		setGithubRepos(repos.map(toGitHubRepo));
	} catch (error) {
		// ... state handling ...
	} finally {
		setGithubLoading(false);
	}
}, []);
```

Repo conventions to match:

- App-local imports use `#/`, e.g. `import { authClient } from "#/lib/auth-client";`.
- Typescript is strict and `noUnusedLocals` is enabled.
- Use named exports for shared library helpers, as `src/lib/auth-client.ts` does.
- Biome formatting uses tabs and double quotes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no TypeScript errors |
| Tests | `pnpm test -- src/lib/github-repositories.test.ts` | exit 0, new tests pass |
| Lint | `pnpm lint` | exit 0 or only known pre-existing `src/components/ui/sidebar.tsx` cookie warnings |
| Full check | `pnpm check` | may fail on pre-existing UI import-order issues; must not introduce errors in touched files |

## Scope

**In scope** (the only files you should modify):

- `src/components/new-project-dialog.tsx`
- `src/lib/github-repositories.ts` (create)
- `src/lib/github-repositories.test.ts` (create)

**Out of scope**:

- Creating server-side GitHub proxy endpoints.
- Changing Better Auth provider configuration in `src/lib/auth.ts`.
- Changing UI component primitives under `src/components/ui/*`.
- Adding pagination/infinite scroll for repositories. Keep `per_page=100` behavior from the current implementation.
- Changing selected repo summary behavior or environment-variable UI.

## Git workflow

- Branch: `advisor/003-extract-github-repository-loader`.
- Commit message: `refactor: extract github repository loader`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Create the repository loader module

Create `src/lib/github-repositories.ts` with exported types and small testable functions. The module should accept dependencies so tests do not need real OAuth or real network.

Target public API:

```ts
import { authClient } from "#/lib/auth-client";

export type GitHubRepo = {
	name: string;
	language: string | null;
	isPrivate: boolean;
	stars: number;
};

type GitHubApiRepo = {
	full_name: string;
	language: string | null;
	private: boolean;
	stargazers_count: number;
};

type AccessTokenResult = {
	accessToken?: string;
	data?: { accessToken?: string } | null;
	error?: { message?: string } | null;
};

type LinkSocialResult = {
	data?: { url?: string } | null;
	error?: { message?: string } | null;
};

type GitHubRepositoryLoaderOptions = {
	openAuthWindow?: (url: string, target: string) => Window | null;
	waitForAuthComplete: (authWindow: Window) => Promise<void>;
	fetchRepos?: typeof fetch;
};

const GITHUB_REPOSITORIES_URL =
	"https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";

export function toGitHubRepo(repo: GitHubApiRepo): GitHubRepo {
	return {
		name: repo.full_name,
		language: repo.language,
		isPrivate: repo.private,
		stars: repo.stargazers_count,
	};
}

export async function loadGitHubRepositories({
	openAuthWindow = (url, target) => window.open(url, target),
	waitForAuthComplete,
	fetchRepos = fetch,
}: GitHubRepositoryLoaderOptions): Promise<GitHubRepo[]> {
	const authWindow = openAuthWindow("about:blank", "github-repository-access");

	try {
		const linkResult = (await authClient.linkSocial({
			provider: "github",
			scopes: ["repo"],
			disableRedirect: true,
			callbackURL: "/auth/github-link-complete",
		})) as LinkSocialResult;

		if (linkResult.error) {
			throw new Error(linkResult.error.message || "Unable to request GitHub access.");
		}

		if (!linkResult.data?.url) {
			throw new Error("GitHub authorization URL was not returned.");
		}

		if (!authWindow) {
			throw new Error("Allow pop-ups to connect GitHub repositories.");
		}

		authWindow.location.href = linkResult.data.url;
		await waitForAuthComplete(authWindow);

		const tokenResult = (await authClient.getAccessToken({
			providerId: "github",
		})) as AccessTokenResult;

		if (tokenResult.error) {
			throw new Error(tokenResult.error.message || "Unable to get GitHub access token.");
		}

		const accessToken = tokenResult.accessToken ?? tokenResult.data?.accessToken;
		if (!accessToken) {
			throw new Error("GitHub access token was not returned.");
		}

		const response = await fetchRepos(GITHUB_REPOSITORIES_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${accessToken}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			throw new Error(`GitHub API request failed (${response.status}).`);
		}

		const repos = (await response.json()) as GitHubApiRepo[];
		return repos.map(toGitHubRepo);
	} catch (error) {
		authWindow?.close();
		throw error;
	}
}
```

If Plan 001 or 002 changed callback/waiter names, match their final names. Keep the exported `GitHubRepo` type.

**Verify**: `pnpm exec tsc --noEmit` → exit 0 after the next step wires call sites; it may fail immediately after creating the file if imports are not yet used.

### Step 2: Wire the dialog to the loader

In `src/components/new-project-dialog.tsx`:

1. Remove local `GitHubRepo`, `GitHubApiRepo`, `AccessTokenResult`, `LinkSocialResult`, and `toGitHubRepo` definitions.
2. Remove direct `authClient` import.
3. Import the loader and type:

```ts
import {
	loadGitHubRepositories,
	type GitHubRepo,
} from "#/lib/github-repositories";
```

4. Keep the popup waiter in the component for now unless Plan 001/002 extracted it; pass it into the loader:

```ts
const repos = await loadGitHubRepositories({
	waitForAuthComplete: waitForGithubLinkComplete,
});
setGithubRepos(repos);
```

The `loadGithubRepos` callback in the component should now only manage UI state:

```ts
const loadGithubRepos = useCallback(async () => {
	setGithubLoading(true);
	setGithubError(null);
	setSelectedRepo(null);

	try {
		const repos = await loadGitHubRepositories({
			waitForAuthComplete: waitForGithubLinkComplete,
		});
		setGithubRepos(repos);
	} catch (error) {
		setGithubError(
			error instanceof Error
				? error.message
				: "Unable to load GitHub repositories.",
		);
		setGithubRepos([]);
	} finally {
		setGithubLoading(false);
	}
}, []);
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 3: Add tests for mapping and API behavior

Create `src/lib/github-repositories.test.ts`.

Test `toGitHubRepo`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadGitHubRepositories, toGitHubRepo } from "#/lib/github-repositories";
import { authClient } from "#/lib/auth-client";

describe("toGitHubRepo", () => {
	it("maps GitHub API repository fields into dialog fields", () => {
		expect(
			toGitHubRepo({
				full_name: "acme/dashboard",
				language: "TypeScript",
				private: true,
				stargazers_count: 42,
			}),
		).toEqual({
			name: "acme/dashboard",
			language: "TypeScript",
			isPrivate: true,
			stars: 42,
		});
	});
});
```

Then add loader tests using spies/mocks. If direct `vi.spyOn(authClient.linkSocial...)` does not work because Better Auth's client methods are not configurable, STOP and report; do not rewrite app auth to satisfy the test. Otherwise test:

- links GitHub with `scopes: ["repo"]`, `disableRedirect: true`, and `callbackURL: "/auth/github-link-complete"`.
- sets popup location to the returned auth URL.
- calls `getAccessToken` after waiting.
- calls GitHub API with `Authorization: Bearer <token>`.
- closes popup and throws if GitHub API returns non-OK.

Example shape:

```ts
describe("loadGitHubRepositories", () => {
	it("links GitHub, waits for auth, and fetches repositories", async () => {
		vi.spyOn(authClient, "linkSocial").mockResolvedValue({
			data: { url: "https://github.com/login/oauth/authorize" },
			error: null,
		} as never);
		vi.spyOn(authClient, "getAccessToken").mockResolvedValue({
			accessToken: "token-123",
			error: null,
		} as never);

		const popup = {
			closed: false,
			close: vi.fn(),
			location: { href: "about:blank" },
		} as unknown as Window;
		const fetchRepos = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [
				{
					full_name: "acme/dashboard",
					language: "TypeScript",
					private: false,
					stargazers_count: 3,
				},
			],
		});

		const repos = await loadGitHubRepositories({
			openAuthWindow: () => popup,
			waitForAuthComplete: async () => undefined,
			fetchRepos: fetchRepos as unknown as typeof fetch,
		});

		expect(popup.location.href).toBe("https://github.com/login/oauth/authorize");
		expect(fetchRepos).toHaveBeenCalledWith(
			expect.stringContaining("https://api.github.com/user/repos"),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
			}),
		);
		expect(repos).toEqual([
			{
				name: "acme/dashboard",
				language: "TypeScript",
				isPrivate: false,
				stars: 3,
			},
		]);
	});
});
```

**Verify**: `pnpm test -- src/lib/github-repositories.test.ts` → exit 0.

### Step 4: Remove duplicate GitHub API logic from the component

Confirm these no longer appear in `src/components/new-project-dialog.tsx`:

```bash
rg "authClient|GitHubApiRepo|AccessTokenResult|LinkSocialResult|toGitHubRepo|api.github.com/user/repos" src/components/new-project-dialog.tsx
```

Expected: no matches for those names in the component. If `GitHubRepo` remains, it should be a type import from `#/lib/github-repositories`, not a local type.

**Verify**: the `rg` command above exits 1 (no matches) except for an imported `GitHubRepo` type if your search includes that term.

### Step 5: Run final checks

Run:

```bash
pnpm exec tsc --noEmit
pnpm test -- src/lib/github-repositories.test.ts
pnpm lint
```

Expected:

- Typecheck exits 0.
- New tests exit 0.
- Lint exits 0 or only known pre-existing sidebar cookie warnings.

## Test plan

New tests in `src/lib/github-repositories.test.ts`:

- `toGitHubRepo` maps `full_name`, `language`, `private`, and `stargazers_count`.
- `loadGitHubRepositories` requests GitHub repo scope and callback URL.
- `loadGitHubRepositories` waits for auth before requesting token.
- `loadGitHubRepositories` sends correct GitHub API headers.
- `loadGitHubRepositories` throws user-facing errors for link failure, missing token, and non-OK GitHub response.

Existing repo has no source tests at planning time, so keep tests focused and avoid broad React rendering setup.

## Done criteria

- [ ] `src/lib/github-repositories.ts` owns GitHub OAuth/token/API/mapping logic.
- [ ] `src/components/new-project-dialog.tsx` only manages dialog UI state and calls `loadGitHubRepositories`.
- [ ] No direct `authClient` import remains in `src/components/new-project-dialog.tsx`.
- [ ] No GitHub API URL string remains in `src/components/new-project-dialog.tsx`.
- [ ] `src/lib/github-repositories.test.ts` exists and passes.
- [ ] `pnpm exec tsc --noEmit` exits 0.
- [ ] `pnpm lint` exits 0 or only known pre-existing sidebar cookie warnings.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 or 002 has not landed, because this extraction should preserve the final callback and timeout behavior.
- Better Auth client methods cannot be mocked in Vitest without changing auth-client construction.
- Extracting the loader requires changing the public UI behavior of the dialog.
- The executor finds an existing GitHub repository helper elsewhere in the repo that was missed; report it instead of creating a duplicate module.
- Tests require installing new dependencies.

## Maintenance notes

This module is still client-side and therefore exposes the GitHub access token to browser JavaScript. That matches the current implementation but should be revisited if repository cloning moves server-side. Reviewers should check that the extraction did not change the exact GitHub scopes, callback URL, API endpoint, or error messages established by Plans 001 and 002.
