import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authorizeGitHubRepositoryAccess } from "#/integrations/trpc/github-authorization";
import { getGitHubApp } from "#/lib/github-app";
import { getGitHubImportState } from "#/lib/github-repositories";
import { createTRPCRouter, protectedProcedure } from "../init";

const githubBranchPageSize = 100;

type GitHubBranchPayload = {
	name: string;
};

type GitHubBranchClient = {
	paginate: <T>(method: unknown, parameters?: unknown) => Promise<T[]>;
	rest: {
		repos: {
			listBranches: unknown;
		};
	};
};

export async function listGitHubBranchNames(
	octokit: GitHubBranchClient,
	input: { owner: string; repo: string },
): Promise<string[]> {
	const branches = await octokit.paginate<GitHubBranchPayload>(
		octokit.rest.repos.listBranches,
		{
			owner: input.owner,
			repo: input.repo,
			per_page: githubBranchPageSize,
		},
	);

	return branches.map((branch) => branch.name);
}

export const githubRouter = createTRPCRouter({
	importState: protectedProcedure.query(async ({ ctx }) => {
		const installUrl = ctx.env.VITE_GITHUB_APP_INSTALL_URL;
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

		return await getGitHubImportState({ accessToken, installUrl });
	}),

	listBranches: protectedProcedure
		.input(
			z.object({
				owner: z.string(),
				repo: z.string(),
				installationId: z.number(),
			}),
		)
		.query(async ({ ctx, input }) => {
			await authorizeGitHubRepositoryAccess({
				ctx,
				repo: `${input.owner}/${input.repo}`,
				installationId: input.installationId,
			});

			try {
				const app = getGitHubApp(ctx.env);
				const octokit = await app.getInstallationOctokit(input.installationId);

				return await listGitHubBranchNames(octokit, input);
			} catch (err) {
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message:
						err instanceof Error
							? err.message
							: "Failed to list branches. Please try again.",
				});
			}
		}),
});
