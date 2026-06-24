import { Octokit } from "octokit";

export type GitHubRepo = {
	id: number;
	name: string;
	owner: string;
	repoName: string;
	language: string | null;
	isPrivate: boolean;
	stars: number;
	installationId: number;
};

export type GitHubInstallation = {
	id: number;
	account: {
		login: string;
		avatarUrl: string;
	};
};

export type GitHubImportState = {
	installations: GitHubInstallation[];
	repositories: GitHubRepo[];
	installUrl: string;
};

export async function getGitHubImportState({
	accessToken,
	installUrl,
}: {
	accessToken: string;
	installUrl: string;
}): Promise<GitHubImportState> {
	const octokit = new Octokit({ auth: accessToken });

	const installationsResponse =
		await octokit.rest.apps.listInstallationsForAuthenticatedUser();
	const installations = installationsResponse.data.installations;

	const repositories: GitHubRepo[] = [];

	for (const inst of installations) {
		try {
			const reposResponse =
				await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
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
		installations: installations.map((i) => {
			const login = i.account && "login" in i.account ? i.account.login : "";
			const avatarUrl =
				i.account && "avatar_url" in i.account ? i.account.avatar_url : "";
			return {
				id: i.id,
				account: {
					login: login || "",
					avatarUrl: avatarUrl || "",
				},
			};
		}),
		repositories,
		installUrl,
	};
}
