import { TRPCError } from "@trpc/server";
import {
	getGitHubImportState,
	type GitHubImportState,
	type GitHubRepo,
} from "#/lib/github-repositories";

type GitHubAuthorizationContext = {
	env: {
		VITE_GITHUB_APP_INSTALL_URL: string;
	};
	auth: {
		api: {
			getAccessToken: (input: {
				body: {
					providerId: "github";
					userId: string;
				};
				headers: Headers;
			}) => Promise<{ accessToken?: string | null }>;
		};
	};
	request: {
		headers: Headers;
	};
	user: {
		id: string;
	};
};

type LoadGitHubImportState = (input: {
	accessToken: string;
	installUrl: string;
}) => Promise<GitHubImportState>;

export async function authorizeGitHubRepositoryAccess({
	ctx,
	repo,
	installationId,
	loadImportState = getGitHubImportState,
}: {
	ctx: GitHubAuthorizationContext;
	repo: string;
	installationId: number;
	loadImportState?: LoadGitHubImportState;
}): Promise<GitHubRepo> {
	const res = await ctx.auth.api.getAccessToken({
		body: {
			providerId: "github",
			userId: ctx.user.id,
		},
		headers: ctx.request.headers,
	});

	const accessToken = res.accessToken;
	if (!accessToken) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "GitHub Auth expired, sign in again.",
		});
	}

	const importState = await loadImportState({
		accessToken,
		installUrl: ctx.env.VITE_GITHUB_APP_INSTALL_URL,
	});
	const authorizedRepo = importState.repositories.find(
		(visibleRepo) =>
			visibleRepo.name === repo && visibleRepo.installationId === installationId,
	);

	if (!authorizedRepo) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "GitHub repository is not accessible to this user.",
		});
	}

	return authorizedRepo;
}
