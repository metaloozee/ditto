import { App } from "octokit";

/** Product GitHub App credentials. Not a runtime policy dependency. */
export type GitHubAppCredentials = {
	readonly GITHUB_APP_ID: string;
	readonly GITHUB_APP_PRIVATE_KEY: string;
};

export function getGitHubApp(env: GitHubAppCredentials): App {
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
 */
export async function getInstallationAccessToken(
	env: GitHubAppCredentials,
	installationId: number,
	options?: {
		repositories?: string[];
	},
): Promise<string> {
	const app = getGitHubApp(env);

	const response = await app.octokit.rest.apps.createInstallationAccessToken({
		installation_id: installationId,
		...(options?.repositories?.length
			? { repositories: options.repositories }
			: {}),
	});

	return response.data.token;
}

/** Short name from `owner/repo` for installation token repository scoping. */
export function repositoryNameFromSlug(githubRepo: string): string | undefined {
	const parts = githubRepo.split("/").filter(Boolean);
	if (parts.length < 2) {
		return undefined;
	}
	return parts[parts.length - 1];
}
