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

type GitHubAuthClient = Pick<
	typeof authClient,
	"linkSocial" | "getAccessToken"
>;

type GitHubRepositoryLoaderOptions = {
	auth?: GitHubAuthClient;
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
	auth = authClient,
	openAuthWindow = (url, target) => window.open(url, target),
	waitForAuthComplete,
	fetchRepos = fetch,
}: GitHubRepositoryLoaderOptions): Promise<GitHubRepo[]> {
	const authWindow = openAuthWindow("about:blank", "github-repository-access");

	try {
		const linkResult = (await auth.linkSocial({
			provider: "github",
			scopes: ["repo"],
			disableRedirect: true,
			callbackURL: "/auth/github-link-complete",
		})) as LinkSocialResult;

		if (linkResult.error) {
			throw new Error(
				linkResult.error.message || "Unable to request GitHub access.",
			);
		}

		if (!linkResult.data?.url) {
			throw new Error("GitHub authorization URL was not returned.");
		}

		if (!authWindow) {
			throw new Error("Allow pop-ups to connect GitHub repositories.");
		}

		authWindow.location.href = linkResult.data.url;
		await waitForAuthComplete(authWindow);

		const tokenResult = (await auth.getAccessToken({
			providerId: "github",
		})) as AccessTokenResult;

		if (tokenResult.error) {
			throw new Error(
				tokenResult.error.message || "Unable to get GitHub access token.",
			);
		}

		const accessToken =
			tokenResult.accessToken ?? tokenResult.data?.accessToken;
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
