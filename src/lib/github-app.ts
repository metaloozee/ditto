import { App } from "octokit";

export function getGitHubApp(env: Env) {
	return new App({
		appId: env.GITHUB_CLIENT_ID,
		privateKey: env.GITHUB_CLIENT_SECRET,
	});
}

export async function getInstallationAccessToken(
	env: Env,
	installationId: number
): Promise<string> {
	const app = getGitHubApp(env);
	const response = await app.octokit.rest.apps.createInstallationAccessToken({
		installation_id: installationId,
	});
	
	return response.data.token;
}
