import { App } from "octokit";

/** Narrow env slice required to mint/revoke installation tokens. */
export type GitHubAppEnv = {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
};

export type InstallationTokenContentsPermission = "read" | "write";

export function getGitHubApp(env: GitHubAppEnv): App {
	return new App({
		appId: env.GITHUB_APP_ID,
		privateKey: env.GITHUB_APP_PRIVATE_KEY,
	});
}

/**
 * Mint a short-lived installation access token.
 *
 * When `repositories` is set, pass **short repo names only** (e.g. `skills`),
 * not `owner/repo` — that is what the GitHub Apps API expects. Scoping fails
 * earlier if the installation cannot access the named repo.
 *
 * Optional `contents` requests exact Contents permission for Trusted Git
 * Executor smart-HTTP phases. Existing callers omit it and keep prior behavior.
 */
export async function getInstallationAccessToken(
	env: GitHubAppEnv,
	installationId: number,
	options?: {
		repositories?: string[];
		contents?: InstallationTokenContentsPermission;
	},
): Promise<string> {
	const app = getGitHubApp(env);

	const response = await app.octokit.rest.apps.createInstallationAccessToken({
		installation_id: installationId,
		...(options?.repositories?.length
			? { repositories: options.repositories }
			: {}),
		...(options?.contents
			? { permissions: { contents: options.contents } }
			: {}),
	});

	return response.data.token;
}

const REVOKE_FAILED_MESSAGE = "installation token revoke failed";

/**
 * Revoke an installation access token (DELETE /installation/token).
 * Success is exactly HTTP 204. Never includes the token in thrown errors.
 */
export async function revokeInstallationAccessToken(
	token: string,
): Promise<void> {
	if (typeof token !== "string" || token.length < 8) {
		throw new Error(REVOKE_FAILED_MESSAGE);
	}

	let response: Response;
	try {
		response = await fetch("https://api.github.com/installation/token", {
			method: "DELETE",
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
				"user-agent": "ditto-trusted-git-executor",
			},
		});
	} catch {
		throw new Error(REVOKE_FAILED_MESSAGE);
	}

	if (response.status !== 204) {
		throw new Error(REVOKE_FAILED_MESSAGE);
	}
}

/** Short name from `owner/repo` for installation token repository scoping. */
export function repositoryNameFromSlug(githubRepo: string): string | undefined {
	const parts = githubRepo.split("/").filter(Boolean);
	if (parts.length < 2) {
		return undefined;
	}
	return parts[parts.length - 1];
}
