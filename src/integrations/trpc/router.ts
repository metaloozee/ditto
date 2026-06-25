import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import { projects } from "#/db/schema";
import { encryptText } from "#/lib/crypto";
import { getGitHubApp } from "#/lib/github-app";
import { getGitHubImportState } from "#/lib/github-repositories";
import { bootstrapSandbox } from "#/lib/sandbox-bootstrap";
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

const createProjectInput = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	githubRepo: z.string().optional(),
	githubInstallationId: z.number().int().positive().optional(),
	envVars: z
		.array(
			z.object({
				key: z.string(),
				value: z.string(),
			}),
		)
		.optional(),
});

type CreateProjectInput = z.infer<typeof createProjectInput>;

function toProjectResponse(project: typeof projects.$inferSelect) {
	const { envVars: _envVars, ...projectResponse } = project;
	return projectResponse;
}

function sanitizeEnvVars(envVars: CreateProjectInput["envVars"]) {
	return envVars
		?.map(({ key, value }) => ({ key: key.trim(), value }))
		.filter(({ key }) => key.length > 0);
}

const projectsRouter = {
	create: protectedProcedure
		.input(createProjectInput)
		.mutation(async ({ ctx, input }) => {
			const trimmedName = input.name.trim();
			if (!trimmedName) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Project name is required.",
				});
			}

			const hasGitHubRepo = input.githubRepo !== undefined;
			const hasGitHubInstallationId = input.githubInstallationId !== undefined;
			if (hasGitHubRepo !== hasGitHubInstallationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"githubRepo and githubInstallationId must be provided together.",
				});
			}

			const sanitizedEnvVars = sanitizeEnvVars(input.envVars);

			const encryptedEnvVars =
				sanitizedEnvVars && sanitizedEnvVars.length > 0
					? await encryptText(
							JSON.stringify(sanitizedEnvVars),
							ctx.env.BETTER_AUTH_SECRET,
						)
					: undefined;

			const db = createDb(ctx.env);
			const requiresBootstrap = hasGitHubRepo && hasGitHubInstallationId;
			const projectId = nanoid();
			const [project] = await db
				.insert(projects)
				.values({
					id: projectId,
					name: trimmedName,
					description: input.description,
					userId: ctx.user.id,
					githubRepo: input.githubRepo,
					githubInstallationId: input.githubInstallationId,
					status: requiresBootstrap ? "provisioning" : "ready",
					envVars: encryptedEnvVars,
				})
				.returning();

			if (!requiresBootstrap) {
				return toProjectResponse(project);
			}

			const sandboxId = crypto.randomUUID().toLowerCase();
			const githubRepo = input.githubRepo;
			const githubInstallationId = input.githubInstallationId;
			if (!githubRepo || !githubInstallationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"githubRepo and githubInstallationId must be provided together.",
				});
			}

			try {
				await bootstrapSandbox({
					env: ctx.env,
					sandboxId,
					githubRepo,
					installationId: githubInstallationId,
					envVars: sanitizedEnvVars ?? [],
				});

				const [updatedProject] = await db
					.update(projects)
					.set({
						sandboxId,
						status: "ready",
						updatedAt: sql`(unixepoch())`,
					})
					.where(eq(projects.id, projectId))
					.returning();

				return toProjectResponse(updatedProject);
			} catch (error) {
				await db
					.update(projects)
					.set({
						status: "failed",
						updatedAt: sql`(unixepoch())`,
					})
					.where(eq(projects.id, projectId));

				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						error instanceof Error
							? error.message
							: "Failed to provision sandbox.",
				});
			}
		}),

	list: protectedProcedure.query(async ({ ctx }) => {
		const db = createDb(ctx.env);
		const userProjects = await db
			.select()
			.from(projects)
			.where(eq(projects.userId, ctx.user.id))
			.orderBy(desc(projects.createdAt));

		return userProjects.map(toProjectResponse);
	}),

	get: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [project] = await db
				.select()
				.from(projects)
				.where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
				.limit(1);

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found.",
				});
			}

			return toProjectResponse(project);
		}),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	health: healthRouter,
	github: githubRouter,
	projects: projectsRouter,
});
export type TRPCRouter = typeof trpcRouter;
