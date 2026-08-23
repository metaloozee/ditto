import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import { createTRPCRouter, protectedProcedure } from "#/integrations/trpc/init";
import { authorizeGitHubRepositoryAccess } from "#/lib/github-authorization";
import {
	compareAndSetProjectEnvVars,
	decryptEnvVars,
	encryptEnvVars,
	envVarsSchema,
	PROJECT_ENV_CAS_MAX_ATTEMPTS,
	sanitizeEnvVars,
	toEnvVarKeys,
} from "#/lib/project-env-vars";
import { buildProjectSeed } from "#/lib/project-seed";
import { destroySandbox } from "#/lib/sandbox-bootstrap";
import { redactSecrets } from "#/lib/secret-redaction";
import {
	deleteProjectRuntime,
	SessionPreviewError,
} from "#/lib/session-preview";

export const projectsRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().optional(),
				githubRepo: z.string().min(1),
				githubInstallationId: z.number().int().positive(),
				envVars: envVarsSchema.optional(),
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

			await authorizeGitHubRepositoryAccess({
				ctx,
				repo: input.githubRepo,
				installationId: input.githubInstallationId,
			});

			const sanitizedEnvVars = sanitizeEnvVars(input.envVars);
			const encryptedEnvVars = await encryptEnvVars(
				sanitizedEnvVars,
				ctx.env.BETTER_AUTH_SECRET,
			);

			const db = createDb(ctx.env);
			const projectId = nanoid();

			try {
				const { project } = await buildProjectSeed({
					env: ctx.env,
					db,
					userId: ctx.user.id,
					projectId,
					name: projectName,
					description: input.description,
					githubRepo: input.githubRepo,
					installationId: input.githubInstallationId,
					encryptedEnvVars,
				});

				const { envVars: _envVars, ...projectResponse } = project;
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
							? redactSecrets(
									err.message,
									sanitizedEnvVars.map((envVar) => envVar.value),
								)
							: "Failed to build project seed. Please try again.",
				});
			}
		}),

	rename: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1),
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

			const db = createDb(ctx.env);
			const [project] = await db
				.update(projects)
				.set({
					name: projectName,
					updatedAt: sql`(unixepoch())`,
				})
				.where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
				.returning({
					id: projects.id,
					name: projects.name,
					updatedAt: projects.updatedAt,
				});

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found.",
				});
			}

			return project;
		}),

	listEnvVars: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [project] = await db
				.select({ envVars: projects.envVars })
				.from(projects)
				.where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
				.limit(1);

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found.",
				});
			}

			const envVars = await decryptEnvVars(
				project.envVars,
				ctx.env.BETTER_AUTH_SECRET,
			);

			return toEnvVarKeys(envVars);
		}),

	setEnvVar: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				key: z.string(),
				value: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [nextEnvVar] = sanitizeEnvVars([
				{ key: input.key, value: input.value },
			]);

			if (!nextEnvVar) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Environment variable name is required.",
				});
			}

			const db = createDb(ctx.env);
			const secret = ctx.env.BETTER_AUTH_SECRET;

			for (let attempt = 0; attempt < PROJECT_ENV_CAS_MAX_ATTEMPTS; attempt++) {
				const [project] = await db
					.select({ envVars: projects.envVars })
					.from(projects)
					.where(
						and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)),
					)
					.limit(1);

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Project not found.",
					});
				}

				const expectedCiphertext = project.envVars;
				const current = await decryptEnvVars(expectedCiphertext, secret);
				const nextEnvVars = sanitizeEnvVars([...current, nextEnvVar]);
				const nextCiphertext = await encryptEnvVars(nextEnvVars, secret);

				const wrote = await compareAndSetProjectEnvVars({
					db,
					projectId: input.id,
					userId: ctx.user.id,
					expectedCiphertext,
					nextCiphertext,
				});

				if (wrote) {
					return toEnvVarKeys(nextEnvVars);
				}
			}

			throw new TRPCError({
				code: "CONFLICT",
				message:
					"Environment variables were updated concurrently. Please retry.",
			});
		}),

	deleteEnvVar: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				key: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const key = input.key.trim();

			if (!key) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Environment variable name is required.",
				});
			}

			const db = createDb(ctx.env);
			const secret = ctx.env.BETTER_AUTH_SECRET;

			for (let attempt = 0; attempt < PROJECT_ENV_CAS_MAX_ATTEMPTS; attempt++) {
				const [project] = await db
					.select({ envVars: projects.envVars })
					.from(projects)
					.where(
						and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)),
					)
					.limit(1);

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Project not found.",
					});
				}

				const expectedCiphertext = project.envVars;
				const current = await decryptEnvVars(expectedCiphertext, secret);
				const nextEnvVars = current.filter((envVar) => envVar.key !== key);

				if (nextEnvVars.length === current.length) {
					return toEnvVarKeys(current);
				}

				const nextCiphertext = await encryptEnvVars(nextEnvVars, secret);

				const wrote = await compareAndSetProjectEnvVars({
					db,
					projectId: input.id,
					userId: ctx.user.id,
					expectedCiphertext,
					nextCiphertext,
				});

				if (wrote) {
					return toEnvVarKeys(nextEnvVars);
				}
			}

			throw new TRPCError({
				code: "CONFLICT",
				message:
					"Environment variables were updated concurrently. Please retry.",
			});
		}),

	deleteProject: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			try {
				return await deleteProjectRuntime({
					db,
					env: ctx.env,
					projectId: input.id,
					userId: ctx.user.id,
					destroySandbox,
				});
			} catch (error) {
				if (error instanceof SessionPreviewError) {
					if (error.code === "not_found") {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Project not found.",
						});
					}
					if (error.code === "busy") {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: error.message,
						});
					}
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to delete project.",
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
