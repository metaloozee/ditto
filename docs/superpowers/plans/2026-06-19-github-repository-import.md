# GitHub Repository Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mocked GitHub repository list in the new project dialog with repositories fetched after requesting GitHub repository OAuth scope.

**Architecture:** Keep the feature local to `src/components/new-project-dialog.tsx`. Add typed GitHub repository state, request additional GitHub OAuth scope with Better Auth when the GitHub path is selected, retrieve the access token, fetch GitHub repositories, and render loading/error/empty states in the existing command UI.

**Tech Stack:** React 19, Better Auth client, GitHub REST API, existing shadcn/cmdk dialog components.

---

### Task 1: Fetch GitHub repositories in the dialog

**Files:**
- Modify: `src/components/new-project-dialog.tsx`

- [ ] **Step 1: Import auth client**

Add this import near the existing local imports:

```ts
import { authClient } from "#/lib/auth-client";
```

- [ ] **Step 2: Replace mock repo type with runtime type**

Define a mutable `GitHubRepo` type with fields used by the UI:

```ts
type GitHubRepo = {
	name: string;
	language: string | null;
	isPrivate: boolean;
	stars: number;
};
```

Keep `LANGUAGE_COLORS`, but remove `MOCK_REPOS` usage from rendering paths.

- [ ] **Step 3: Add repository fetch state**

Inside `NewProjectDialog`, add:

```ts
const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
const [githubLoading, setGithubLoading] = useState(false);
const [githubError, setGithubError] = useState<string | null>(null);
```

Reset these in `resetState`.

- [ ] **Step 4: Add fetch helper callback**

Add a callback that requests scope, gets the token, calls GitHub, and maps response fields:

```ts
const loadGithubRepos = useCallback(async () => {
	setGithubLoading(true);
	setGithubError(null);
	setSelectedRepo(null);

	try {
		await authClient.linkSocial({
			provider: "github",
			scopes: ["repo"],
		});

		const tokenResult = await authClient.getAccessToken({
			providerId: "github",
		});

		if (!tokenResult.accessToken) {
			throw new Error("GitHub access token was not returned.");
		}

		const response = await fetch(
			"https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
			{
				headers: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${tokenResult.accessToken}`,
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
		);

		if (!response.ok) {
			throw new Error(`GitHub API request failed (${response.status}).`);
		}

		const repos = (await response.json()) as Array<{
			full_name: string;
			language: string | null;
			private: boolean;
			stargazers_count: number;
		}>;

		setGithubRepos(
			repos.map((repo) => ({
				name: repo.full_name,
				language: repo.language,
				isPrivate: repo.private,
				stars: repo.stargazers_count,
			})),
		);
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

- [ ] **Step 5: Trigger fetch when GitHub path is selected**

Make `handleChoosePath` async-safe and call `loadGithubRepos()` only for GitHub:

```ts
const handleChoosePath = useCallback(
	(chosen: OnboardingPath) => {
		setPath(chosen);
		setStep(chosen === "github" ? "github" : "scratch");

		if (chosen === "github") {
			void loadGithubRepos();
		}
	},
	[loadGithubRepos],
);
```

- [ ] **Step 6: Render loading, error, empty, and repo states**

In the GitHub `CommandList`, render:

```tsx
{githubLoading ? (
	<CommandEmpty>Loading repositories…</CommandEmpty>
) : githubError ? (
	<CommandEmpty>{githubError}</CommandEmpty>
) : githubRepos.length === 0 ? (
	<CommandEmpty>No repositories found.</CommandEmpty>
) : (
	<CommandGroup heading="Your repositories">
		{githubRepos.map((repo) => (
			<CommandItem key={repo.name} value={repo.name} onSelect={() => setSelectedRepo(repo.name)}>
				{/* existing repo item markup, using repo.language ?? "Unknown" */}
			</CommandItem>
		))}
	</CommandGroup>
)}
```

Disable Continue while loading or on error by updating `canContinue`:

```ts
step === "github"
	? selectedRepo !== null && !githubLoading && githubError === null
```

- [ ] **Step 7: Update summary lookup**

Change `GitHubSummary` to accept `repos: GitHubRepo[]` and find the selected repo from fetched state:

```tsx
<GitHubSummary repo={selectedRepo} repos={githubRepos} />
```

```ts
function GitHubSummary({ repo, repos }: { repo: string | null; repos: GitHubRepo[] }) {
	const repoData = repos.find((r) => r.name === repo);
	if (!repoData) return null;
	// existing markup
}
```

- [ ] **Step 8: Run checks**

Run:

```bash
pnpm lint
pnpm check
```

Expected: both commands pass or only report unrelated existing issues.
