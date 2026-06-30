import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import { authorizeGitHubRepositoryAccess } from "#/integrations/trpc/github-authorization";
import { createTRPCRouter, protectedProcedure } from "#/integrations/trpc/init";
import { decryptText, encryptText } from "#/lib/crypto";
import {
	bootstrapSandbox,
	destroySandbox,
	type SandboxEnvVar,
	syncSandboxEnvFile,
} from "#/lib/sandbox-bootstrap";

const envVarSchema = z.object({
	key: z.string(),
	value: z.string(),
});

const envVarsSchema = z.array(envVarSchema);

function toEnvVarKeys(envVars: SandboxEnvVar[]): Array<{ key: string }> {
	return envVars.map(({ key }) => ({ key }));
}

function sanitizeEnvVars(
	envVars: SandboxEnvVar[] | undefined,
): SandboxEnvVar[] {
	const envVarsByKey = new Map<string, string>();

	for (const envVar of envVars ?? []) {
		const key = envVar.key.trim();
		if (key.length === 0) {
			continue;
		}

		envVarsByKey.set(key, envVar.value.trim());
	}

	return Array.from(envVarsByKey, ([key, value]) => ({ key, value }));
}

async function encryptEnvVars(
	envVars: SandboxEnvVar[],
	secret: string,
): Promise<string | null> {
	if (envVars.length === 0) {
		return null;
	}

	return await encryptText(JSON.stringify(envVars), secret);
}

async function decryptEnvVars(
	encryptedEnvVars: string | null,
	secret: string,
): Promise<SandboxEnvVar[]> {
	if (!encryptedEnvVars) {
		return [];
	}

	try {
		const plaintext = await decryptText(encryptedEnvVars, secret);
		return envVarsSchema.parse(JSON.parse(plaintext));
	} catch {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to read project environment variables.",
		});
	}
}

export const projectsRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().optional(),
				githubRepo: z.string().optional(),
				githubInstallationId: z.number().int().positive().optional(),
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

			const hasGithubRepo = input.githubRepo !== undefined;
			const hasGithubInstallationId = input.githubInstallationId !== undefined;
			if (hasGithubRepo !== hasGithubInstallationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Github Repository and Installation ID is required.",
				});
			}

			const githubImport =
				input.githubRepo !== undefined &&
				input.githubInstallationId !== undefined
					? {
							repo: input.githubRepo,
							installationId: input.githubInstallationId,
						}
					: null;

			if (githubImport) {
				await authorizeGitHubRepositoryAccess({
					ctx,
					repo: githubImport.repo,
					installationId: githubImport.installationId,
				});
			}

			const sanitizedEnvVars = sanitizeEnvVars(input.envVars);
			const encryptedEnvVars = await encryptEnvVars(
				sanitizedEnvVars,
				ctx.env.BETTER_AUTH_SECRET,
			);

			const db = createDb(ctx.env);
			const projectId = nanoid();

			const [project] = await db
				.insert(projects)
				.values({
					id: projectId,
					name: projectName,
					description: input.description,
					userId: ctx.user.id,
					githubRepo: githubImport?.repo,
					githubInstallationId: githubImport?.installationId,
					status: githubImport ? "provisioning" : "ready",
					envVars: encryptedEnvVars,
				})
				.returning();

			if (!githubImport) {
				const { envVars: _envVars, ...projectResponse } = project;
				return projectResponse;
			}

			const sandboxId = crypto.randomUUID().toLowerCase();

			try {
				await bootstrapSandbox({
					env: ctx.env,
					sandboxId,
					githubRepo: githubImport.repo,
					installationId: githubImport.installationId,
					envVars: sanitizedEnvVars,
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
			const [project] = await db
				.select({
					envVars: projects.envVars,
					sandboxId: projects.sandboxId,
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

			const envVars = await decryptEnvVars(
				project.envVars,
				ctx.env.BETTER_AUTH_SECRET,
			);
			const nextEnvVars = sanitizeEnvVars([...envVars, nextEnvVar]);
			const encryptedEnvVars = await encryptEnvVars(
				nextEnvVars,
				ctx.env.BETTER_AUTH_SECRET,
			);

			if (project.sandboxId) {
				await syncSandboxEnvFile({
					env: ctx.env,
					sandboxId: project.sandboxId,
					envVars: nextEnvVars,
				});
			}

			await db
				.update(projects)
				.set({
					envVars: encryptedEnvVars,
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)),
				);

			return toEnvVarKeys(nextEnvVars);
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
			const [project] = await db
				.select({
					envVars: projects.envVars,
					sandboxId: projects.sandboxId,
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

			const envVars = await decryptEnvVars(
				project.envVars,
				ctx.env.BETTER_AUTH_SECRET,
			);
			const nextEnvVars = envVars.filter((envVar) => envVar.key !== key);

			if (nextEnvVars.length === envVars.length) {
				return toEnvVarKeys(envVars);
			}

			const encryptedEnvVars = await encryptEnvVars(
				nextEnvVars,
				ctx.env.BETTER_AUTH_SECRET,
			);

			if (project.sandboxId) {
				await syncSandboxEnvFile({
					env: ctx.env,
					sandboxId: project.sandboxId,
					envVars: nextEnvVars,
				});
			}

			await db
				.update(projects)
				.set({
					envVars: encryptedEnvVars,
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)),
				);

			return toEnvVarKeys(nextEnvVars);
		}),

	deleteProject: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [project] = await db
				.select({ id: projects.id, sandboxId: projects.sandboxId })
				.from(projects)
				.where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
				.limit(1);

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found.",
				});
			}

			if (project.sandboxId) {
				await destroySandbox({
					env: ctx.env,
					sandboxId: project.sandboxId,
				});
			}

			await db
				.delete(projects)
				.where(
					and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)),
				);

			return { id: project.id };
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
