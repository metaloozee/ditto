import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import {
	agentRunEvents,
	agentRuns,
	projects,
	workspaceSessions,
} from "#/db/schema";
import { encryptText } from "#/lib/crypto";
import { getGitHubApp } from "#/lib/github-app";
import { getGitHubImportState } from "#/lib/github-repositories";
import { bootstrapSandbox } from "#/lib/sandbox-bootstrap";
import {
	createAgentRunEventPayload,
	isActiveAgentRunStatus,
	makeSessionTitleFromMessage,
	PROJECT_MEMORY_PATH,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";
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

function assertProjectReady(project: typeof projects.$inferSelect) {
	if (project.status !== "ready" || !project.sandboxId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Project sandbox is not ready yet.",
		});
	}
}

function isTerminalAgentRunStatus(status: string) {
	return status === "completed" || status === "failed" || status === "canceled";
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

const workspaceRouter = {
	get: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [project] = await db
				.select()
				.from(projects)
				.where(
					and(
						eq(projects.id, input.projectId),
						eq(projects.userId, ctx.user.id),
					),
				)
				.limit(1);

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found.",
				});
			}

			assertProjectReady(project);

			const sessions = await db
				.select()
				.from(workspaceSessions)
				.where(
					and(
						eq(workspaceSessions.projectId, input.projectId),
						eq(workspaceSessions.userId, ctx.user.id),
						eq(workspaceSessions.status, "active"),
					),
				)
				.orderBy(desc(workspaceSessions.updatedAt))
				.limit(25);

			const selectedSession = input.sessionId
				? await db
						.select()
						.from(workspaceSessions)
						.where(
							and(
								eq(workspaceSessions.id, input.sessionId),
								eq(workspaceSessions.projectId, input.projectId),
								eq(workspaceSessions.userId, ctx.user.id),
							),
						)
						.limit(1)
						.then(([session]) => {
							if (!session) {
								throw new TRPCError({
									code: "NOT_FOUND",
									message: "Conversation not found.",
								});
							}

							return session;
						})
				: null;

			const activeRun = project.activeAgentRunId
				? await db
						.select()
						.from(agentRuns)
						.where(
							and(
								eq(agentRuns.id, project.activeAgentRunId),
								eq(agentRuns.userId, ctx.user.id),
							),
						)
						.limit(1)
						.then(([run]) =>
							run?.isMutating && isActiveAgentRunStatus(run.status)
								? run
								: null,
						)
				: null;

			const events = selectedSession
				? await db
						.select()
						.from(agentRunEvents)
						.where(
							and(
								eq(agentRunEvents.projectId, input.projectId),
								eq(agentRunEvents.sessionId, selectedSession.id),
							),
						)
						.orderBy(desc(agentRunEvents.createdAt), desc(agentRunEvents.id))
						.limit(100)
				: [];

			return {
				project: toProjectResponse(project),
				sessions,
				selectedSession,
				activeRun,
				events: events.reverse(),
			};
		}),

	startRun: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1).optional(),
				message: z.string().trim().min(1),
				isMutating: z.boolean().default(true),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const runId = nanoid();

			return await db.transaction(async (tx) => {
				const [project] = await tx
					.select()
					.from(projects)
					.where(
						and(
							eq(projects.id, input.projectId),
							eq(projects.userId, ctx.user.id),
						),
					)
					.limit(1);

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Project not found.",
					});
				}

				assertProjectReady(project);

				let selectedSession: typeof workspaceSessions.$inferSelect | null =
					null;
				if (input.sessionId) {
					[selectedSession] = await tx
						.select()
						.from(workspaceSessions)
						.where(
							and(
								eq(workspaceSessions.id, input.sessionId),
								eq(workspaceSessions.projectId, input.projectId),
								eq(workspaceSessions.userId, ctx.user.id),
							),
						)
						.limit(1);

					if (!selectedSession) {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Conversation not found.",
						});
					}

					if (selectedSession.status === "archived") {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "This conversation is archived.",
						});
					}
				}

				if (input.isMutating && project.activeAgentRunId) {
					const previousRunId = project.activeAgentRunId;
					const [existingRun] = await tx
						.select()
						.from(agentRuns)
						.where(eq(agentRuns.id, previousRunId))
						.limit(1);

					if (
						!existingRun ||
						!existingRun.isMutating ||
						!isActiveAgentRunStatus(existingRun.status)
					) {
						await tx
							.update(projects)
							.set({
								activeAgentRunId: null,
								activeAgentRunStartedAt: null,
								updatedAt: sql`(unixepoch())`,
							})
							.where(
								and(
									eq(projects.id, input.projectId),
									eq(projects.activeAgentRunId, previousRunId),
								),
							);

						await tx.insert(agentRunEvents).values({
							runId: existingRun ? previousRunId : null,
							projectId: input.projectId,
							sessionId: existingRun?.sessionId ?? null,
							type: "error",
							payload: createAgentRunEventPayload({
								reason: "stale_lock_cleared",
								previousRunId,
							}),
						});
					}
				}

				if (input.isMutating) {
					const [lockedProject] = await tx
						.update(projects)
						.set({
							activeAgentRunId: runId,
							activeAgentRunStartedAt: sql`(unixepoch())`,
							updatedAt: sql`(unixepoch())`,
						})
						.where(
							and(
								eq(projects.id, input.projectId),
								eq(projects.userId, ctx.user.id),
								isNull(projects.activeAgentRunId),
							),
						)
						.returning();

					if (!lockedProject) {
						await tx.insert(agentRunEvents).values({
							runId: null,
							projectId: input.projectId,
							sessionId: input.sessionId ?? null,
							type: "lock_rejected",
							payload: createAgentRunEventPayload({
								reason: "active_run_exists",
							}),
						});

						throw new TRPCError({
							code: "CONFLICT",
							message: "Another agent run is already editing this project.",
						});
					}
				}

				const createdSession = !selectedSession;
				if (!selectedSession) {
					const [session] = await tx
						.insert(workspaceSessions)
						.values({
							id: nanoid(),
							projectId: input.projectId,
							userId: ctx.user.id,
							title: makeSessionTitleFromMessage(input.message),
							workspacePath: WORKSPACE_PATH,
							memoryPath: PROJECT_MEMORY_PATH,
							status: "active",
						})
						.returning();

					selectedSession = session;
				}

				const [run] = await tx
					.insert(agentRuns)
					.values({
						id: runId,
						projectId: input.projectId,
						sessionId: selectedSession.id,
						userId: ctx.user.id,
						status: "running",
						isMutating: input.isMutating,
						userMessage: input.message,
					})
					.returning();

				await tx
					.update(workspaceSessions)
					.set({ updatedAt: sql`(unixepoch())` })
					.where(eq(workspaceSessions.id, selectedSession.id));

				await tx.insert(agentRunEvents).values([
					{
						runId,
						projectId: input.projectId,
						sessionId: selectedSession.id,
						type: "message",
						payload: createAgentRunEventPayload({
							role: "user",
							text: input.message,
						}),
					},
					{
						runId,
						projectId: input.projectId,
						sessionId: selectedSession.id,
						type: "message",
						payload: createAgentRunEventPayload({
							role: "system",
							text: "Agent execution is queued. The LLM/tool runner will be connected in a later plan.",
						}),
					},
				]);

				return { run, session: selectedSession, createdSession };
			});
		}),

	cancelRun: protectedProcedure
		.input(z.object({ runId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [run] = await db
				.select()
				.from(agentRuns)
				.where(
					and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, ctx.user.id)),
				)
				.limit(1);

			if (!run) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Agent run not found.",
				});
			}

			if (isTerminalAgentRunStatus(run.status)) {
				return run;
			}

			const [updatedRun] = await db
				.update(agentRuns)
				.set({
					status: "canceled",
					finishedAt: sql`(unixepoch())`,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, input.runId))
				.returning();

			await db
				.update(projects)
				.set({
					activeAgentRunId: null,
					activeAgentRunStartedAt: null,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(projects.activeAgentRunId, input.runId));

			await db.insert(agentRunEvents).values({
				runId: input.runId,
				projectId: run.projectId,
				sessionId: run.sessionId,
				type: "done",
				payload: createAgentRunEventPayload({ status: "canceled" }),
			});

			return updatedRun;
		}),

	answerRunQuestion: protectedProcedure
		.input(
			z.object({
				runId: z.string().min(1),
				answer: z.string().trim().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const [run] = await db
				.select()
				.from(agentRuns)
				.where(
					and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, ctx.user.id)),
				)
				.limit(1);

			if (!run) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Agent run not found.",
				});
			}

			if (run.status !== "needs_input") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "This agent run is not waiting for input.",
				});
			}

			const [updatedRun] = await db
				.update(agentRuns)
				.set({
					status: "running",
					question: null,
					recommendedAnswer: null,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(agentRuns.id, input.runId))
				.returning();

			await db.insert(agentRunEvents).values({
				runId: input.runId,
				projectId: run.projectId,
				sessionId: run.sessionId,
				type: "message",
				payload: createAgentRunEventPayload({
					role: "user",
					text: input.answer,
					kind: "answer",
				}),
			});

			return updatedRun;
		}),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	health: healthRouter,
	github: githubRouter,
	projects: projectsRouter,
	workspace: workspaceRouter,
});
export type TRPCRouter = typeof trpcRouter;
