import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import { createTRPCRouter, protectedProcedure } from "#/integrations/trpc/init";
import { encryptText } from "#/lib/crypto";
import { bootstrapSandbox } from "#/lib/sandbox-bootstrap";

export const projectsRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const projectName = input.name.trim();
			if (!projectName) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Project name is required.",
				});
			}

			const hasGithubRepo = input.githubRepo !== undefined;
			const hasGithubInstallationId = input.githubInstallationId !== undefined;
			if (hasGithubRepo !== hasGithubInstallationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Github Repository and Installation ID is required.",
				});
			}

			const sanitizedEnvVars = input.envVars
				?.map(({ key, value }) => ({
					key: key.trim(),
					value: value.trim(),
				}))
				.filter(({ key }) => key.length > 0);

			const encryptedEnvVars =
				sanitizedEnvVars && sanitizedEnvVars.length > 0
					? await encryptText(
							JSON.stringify(sanitizedEnvVars),
							ctx.env.BETTER_AUTH_SECRET,
						)
					: undefined;

			const db = createDb(ctx.env);
			const requiresBootstrap = hasGithubRepo && hasGithubInstallationId;
			const projectId = nanoid();

			const [project] = await db
				.insert(projects)
				.values({
					id: projectId,
					name: projectName,
					description: input.description,
					userId: ctx.user.id,
					githubRepo: input.githubRepo,
					githubInstallationId: input.githubInstallationId,
					status: requiresBootstrap ? "provisioning" : "ready",
					envVars: encryptedEnvVars,
				})
				.returning();

			if (!requiresBootstrap) {
				const { envVars: _envVars, ...projectResponse } = project;
				return projectResponse;
			}

			const sandboxId = crypto.randomUUID().toLowerCase();

			try {
				await bootstrapSandbox({
					env: ctx.env,
					sandboxId,
					githubRepo: input.githubRepo!,
					installationId: input.githubInstallationId!,
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

				const { envVars: _envVars, ...projectResponse } = updatedProject;
				return projectResponse;
			} catch (err) {
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
						err instanceof Error
							? err.message
							: "Failed to provision sandbox. Please try again.",
				});
			}
		}),

	list: protectedProcedure.query(async ({ ctx }) => {
		const db = createDb(ctx.env);
		const [userProjects, activeSessions] = await db.batch([
			db
				.select({
					id: projects.id,
					name: projects.name,
					description: projects.description,
					userId: projects.userId,
					githubRepo: projects.githubRepo,
					githubInstallationId: projects.githubInstallationId,
					sandboxId: projects.sandboxId,
					activeAgentRunId: projects.activeAgentRunId,
					activeAgentRunStartedAt: projects.activeAgentRunStartedAt,
					status: projects.status,
					createdAt: projects.createdAt,
					updatedAt: projects.updatedAt,
				})
				.from(projects)
				.where(eq(projects.userId, ctx.user.id))
				.orderBy(desc(projects.createdAt)),
			db
				.select()
				.from(workspaceSessions)
				.where(
					and(
						eq(workspaceSessions.userId, ctx.user.id),
						eq(workspaceSessions.status, "active"),
					),
				)
				.orderBy(desc(workspaceSessions.updatedAt)),
		]);

		const sessionsByProjectId = new Map<
			string,
			(typeof workspaceSessions.$inferSelect)[]
		>();

		for (const session of activeSessions) {
			const projectSessions = sessionsByProjectId.get(session.projectId) ?? [];

			projectSessions.push(session);
			sessionsByProjectId.set(session.projectId, projectSessions);
		}

		return userProjects.map((project) => {
			return {
				...project,
				sessions: sessionsByProjectId.get(project.id) ?? [],
			};
		});
	}),

	get: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [project] = await db
				.select({
					id: projects.id,
					name: projects.name,
					description: projects.description,
					userId: projects.userId,
					githubRepo: projects.githubRepo,
					githubInstallationId: projects.githubInstallationId,
					sandboxId: projects.sandboxId,
					activeAgentRunId: projects.activeAgentRunId,
					activeAgentRunStartedAt: projects.activeAgentRunStartedAt,
					status: projects.status,
					createdAt: projects.createdAt,
					updatedAt: projects.updatedAt,
				})
				.from(projects)
				.where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
				.limit(1);

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found.",
				});
			}

			return project;
		}),
});
