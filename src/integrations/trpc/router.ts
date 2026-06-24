import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { getGitHubApp } from "#/lib/github-app";
import { getGitHubImportState } from "#/lib/github-repositories";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "./init";

const healthRouter = {
	public: publicProcedure.query(() => ({
		ok: true,
		visibility: "public" as const,
	})),
	protected: protectedProcedure.query(({ ctx }) => ({
		ok: true,
		visibility: "protected" as const,
		userId: ctx.user.id,
	})),
} satisfies TRPCRouterRecord;

const githubRouter = {
	importState: protectedProcedure.query(async ({ ctx }) => {
		const installUrl = ctx.env.VITE_GITHUB_APP_INSTALL_URL;
		const tokenResult = await ctx.auth.api.getAccessToken({
			body: { providerId: "github", userId: ctx.user.id },
			headers: ctx.request.headers,
		});
		const accessToken = tokenResult?.accessToken;
		if (!accessToken) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "GitHub authorization expired. Sign in again.",
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
			try {
				const app = getGitHubApp(ctx.env);
				const octokit = await app.getInstallationOctokit(input.installationId);
				const response = await octokit.rest.repos.listBranches({
					owner: input.owner,
					repo: input.repo,
					per_page: 100,
				});
				return response.data.map((b) => b.name);
			} catch (err) {
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message:
						err instanceof Error ? err.message : "Failed to load branches.",
				});
			}
		}),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	health: healthRouter,
	github: githubRouter,
});
export type TRPCRouter = typeof trpcRouter;
