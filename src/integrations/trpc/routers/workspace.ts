import { TRPCError } from "@trpc/server";
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
import { decryptEnvVars } from "#/lib/project-env-vars";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	createAgentRunEventPayload,
	isActiveAgentRunStatus,
	makeSessionTitleFromMessage,
	PROJECT_MEMORY_PATH,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";
import { createTRPCRouter, protectedProcedure } from "../init";

export const workspaceRouter = createTRPCRouter({
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

			const envVars = await decryptEnvVars(
				project.envVars,
				ctx.env.BETTER_AUTH_SECRET,
			);
			let ensuredProject = project;
			let sandboxState:
				| "connected"
				| "restored_from_backup"
				| "recreated_from_github" = "connected";
			try {
				const ensured = await ensureProjectSandbox({
					db,
					env: ctx.env,
					project,
					envVars,
				});
				ensuredProject = ensured.project;
				sandboxState = ensured.state;
			} catch (error) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						error instanceof Error
							? error.message
							: "Project sandbox is not ready yet.",
				});
			}

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

			const activeRun = ensuredProject.activeAgentRunId
				? await db
						.select()
						.from(agentRuns)
						.where(
							and(
								eq(agentRuns.id, ensuredProject.activeAgentRunId),
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

			const {
				envVars: _envVars,
				sandboxBackup: _sandboxBackup,
				sandboxBackupCreatedAt: _sandboxBackupCreatedAt,
				...projectResponse
			} = ensuredProject;
			return {
				project: projectResponse,
				sandbox: { state: sandboxState },
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

			let ownsProjectLock = false;

			try {
				let [project] = await db
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

				try {
					const envVars = await decryptEnvVars(
						project.envVars,
						ctx.env.BETTER_AUTH_SECRET,
					);
					const ensured = await ensureProjectSandbox({
						db,
						env: ctx.env,
						project,
						envVars,
					});
					project = ensured.project;
				} catch (error) {
					throw new TRPCError({
						code:
							error instanceof Error &&
							error.message === "Project sandbox is already being restored."
								? "CONFLICT"
								: "PRECONDITION_FAILED",
						message:
							error instanceof Error
								? error.message
								: "Project sandbox is not ready yet.",
					});
				}

				let selectedSession: typeof workspaceSessions.$inferSelect | null =
					null;

				if (input.sessionId) {
					[selectedSession] = await db
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
					const [existingRun] = await db
						.select()
						.from(agentRuns)
						.where(eq(agentRuns.id, previousRunId))
						.limit(1);

					if (
						!existingRun ||
						!existingRun.isMutating ||
						!isActiveAgentRunStatus(existingRun.status)
					) {
						await db.batch([
							db
								.update(projects)
								.set({
									activeAgentRunId: null,
									activeAgentRunStartedAt: null,
									updatedAt: sql`(unixepoch())`,
								})
								.where(
									and(
										eq(projects.id, input.projectId),
										eq(projects.userId, ctx.user.id),
										eq(projects.activeAgentRunId, previousRunId),
									),
								),
							db.insert(agentRunEvents).values({
								runId: existingRun ? previousRunId : null,
								projectId: input.projectId,
								sessionId: existingRun?.sessionId ?? null,
								type: "error",
								payload: createAgentRunEventPayload({
									reason: "stale_lock_cleared",
									previousRunId,
								}),
							}),
						]);
					}
				}

				const createdSession = !selectedSession;
				const sessionId = selectedSession?.id ?? nanoid();
				const runValues = {
					id: runId,
					projectId: input.projectId,
					sessionId,
					userId: ctx.user.id,
					status: "running" as const,
					isMutating: input.isMutating,
					userMessage: input.message,
				};

				const eventValues = [
					{
						runId,
						projectId: input.projectId,
						sessionId,
						type: "message" as const,
						payload: createAgentRunEventPayload({
							role: "user",
							text: input.message,
						}),
					},
					{
						runId,
						projectId: input.projectId,
						sessionId,
						type: "message" as const,
						payload: createAgentRunEventPayload({
							role: "system",
							text: "Agent execution is queued. The LLM/tool runner will be connected in a later plan.",
						}),
					},
				];

				const sessionValues = createdSession
					? {
							id: sessionId,
							projectId: input.projectId,
							userId: ctx.user.id,
							title: makeSessionTitleFromMessage(input.message),
							workspacePath: WORKSPACE_PATH,
							memoryPath: PROJECT_MEMORY_PATH,
							status: "active" as const,
						}
					: null;

				if (input.isMutating) {
					const [lockedProject] = await db
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
						await db.insert(agentRunEvents).values({
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

					ownsProjectLock = true;
				}

				async function releaseOwnedProjectLockAfterBatchFailure() {
					if (!ownsProjectLock) {
						return;
					}

					try {
						await db
							.update(projects)
							.set({
								activeAgentRunId: null,
								activeAgentRunStartedAt: null,
								updatedAt: sql`(unixepoch())`,
							})
							.where(
								and(
									eq(projects.id, input.projectId),
									eq(projects.userId, ctx.user.id),
									eq(projects.activeAgentRunId, runId),
								),
							);
					} catch {
						// Keep the original start-run failure as the user-facing error.
					}
				}

				if (createdSession && sessionValues) {
					try {
						const [[session], [run]] = await db.batch([
							db.insert(workspaceSessions).values(sessionValues).returning(),
							db.insert(agentRuns).values(runValues).returning(),
							db
								.update(workspaceSessions)
								.set({ updatedAt: sql`(unixepoch())` })
								.where(eq(workspaceSessions.id, sessionId)),
							db.insert(agentRunEvents).values(eventValues),
						]);

						if (!session || !run) {
							throw new Error(
								"Batched startRun write did not return created rows.",
							);
						}

						return { run, session, createdSession };
					} catch (error) {
						await releaseOwnedProjectLockAfterBatchFailure();
						throw error;
					}
				}

				try {
					const [[run], [session]] = await db.batch([
						db.insert(agentRuns).values(runValues).returning(),
						db
							.update(workspaceSessions)
							.set({ updatedAt: sql`(unixepoch())` })
							.where(eq(workspaceSessions.id, sessionId))
							.returning(),
						db.insert(agentRunEvents).values(eventValues),
					]);

					if (!session || !run) {
						throw new Error(
							"Batched startRun write did not return created rows.",
						);
					}

					return { run, session, createdSession };
				} catch (error) {
					await releaseOwnedProjectLockAfterBatchFailure();
					throw error;
				}
			} catch (error) {
				if (error instanceof TRPCError) {
					throw error;
				}

				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						error instanceof Error
							? error.message
							: "Failed to start the agent.",
				});
			}
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

			if (["completed", "failed", "canceled"].includes(run.status)) {
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
});
