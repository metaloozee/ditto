import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDb } from "#/db";
import {
	agentRunEvents,
	agentRuns,
	projects,
	snapshots,
	workspaceSessions,
} from "#/db/schema";
import { isProjectCoderModelSpecifier } from "#/lib/agent-models";
import {
	type ProjectCoordinatorState,
	RESTORE_IN_PROGRESS_MESSAGE,
} from "#/lib/project-coordinator";
import { decryptEnvVars } from "#/lib/project-env-vars";
import {
	acquireMutatingProjectLockProjection,
	clearProjectLockProjection,
} from "#/lib/project-lock-projection";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	createAgentRunEventPayload,
	isActiveAgentRunStatus,
	makeSessionTitleFromMessage,
	PROJECT_MEMORY_PATH,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";
import { createTRPCRouter, protectedProcedure } from "../init";

type BrokerControlPath = "/start" | "/reply" | "/abort";
type ProjectCoordinatorControlPath =
	| "/admit"
	| "/terminal"
	| "/begin-restore"
	| "/end-restore";
type FlueRunBridgeControlPath = "/start" | "/abort";

function compactBrokerError(error: unknown): string {
	const message =
		error instanceof Error ? error.message : "Broker request failed.";

	return message.length > 1000
		? `${message.slice(0, 1000)}...[truncated]`
		: message;
}

async function getBrokerErrorMessage(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown };
		if (typeof body.error === "string" && body.error.trim()) {
			return body.error;
		}
	} catch {
		// Fall back to the status-based message below when the broker body is not JSON.
	}

	return "Workspace session broker rejected the request.";
}

async function postWorkspaceSessionBroker(options: {
	env: Env;
	sessionId: string;
	path: BrokerControlPath;
	body: Record<string, unknown>;
}): Promise<void> {
	const brokerNamespace = options.env
		.WorkspaceSessionBroker as DurableObjectNamespace;
	const brokerId = brokerNamespace.idFromName(options.sessionId);
	const broker = brokerNamespace.get(brokerId) as {
		fetch(request: Request): Promise<Response>;
	};
	const response = await broker.fetch(
		new Request(`https://workspace-session-broker${options.path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(options.body),
		}),
	);

	if (!response.ok) {
		throw new TRPCError({
			code: response.status === 409 ? "CONFLICT" : "PRECONDITION_FAILED",
			message: await getBrokerErrorMessage(response),
		});
	}
}

async function postProjectCoordinator(options: {
	env: Env;
	projectId: string;
	path: ProjectCoordinatorControlPath;
	body: Record<string, unknown>;
}): Promise<Response> {
	const coordinatorNamespace = options.env
		.ProjectCoordinator as DurableObjectNamespace;
	const coordinatorId = coordinatorNamespace.idFromName(options.projectId);
	const coordinator = coordinatorNamespace.get(coordinatorId) as {
		fetch(request: Request): Promise<Response>;
	};

	return await coordinator.fetch(
		new Request(`https://project-coordinator${options.path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(options.body),
		}),
	);
}

async function notifyCoordinatorRestore(
	env: Env,
	projectId: string,
	phase: "begin" | "end",
	snapshotId?: string | null,
): Promise<void> {
	try {
		await postProjectCoordinator({
			env,
			projectId,
			path: phase === "begin" ? "/begin-restore" : "/end-restore",
			body: phase === "end" ? { snapshotId: snapshotId ?? null } : {},
		});
	} catch {
		// Best-effort: a coordinator notify failure must not break the restore.
	}
}

async function getProjectCoordinatorStatus(
	env: Env,
	projectId: string,
): Promise<ProjectCoordinatorState | null> {
	try {
		const coordinatorNamespace =
			env.ProjectCoordinator as DurableObjectNamespace;
		const coordinatorId = coordinatorNamespace.idFromName(projectId);
		const coordinator = coordinatorNamespace.get(coordinatorId) as {
			fetch(request: Request): Promise<Response>;
		};
		const response = await coordinator.fetch(
			new Request("https://project-coordinator/status"),
		);
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as ProjectCoordinatorState;
	} catch {
		// Degrade gracefully: callers treat null as not-restoring.
		return null;
	}
}

async function getProjectCoordinatorErrorMessage(
	response: Response,
): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown };
		if (typeof body.error === "string" && body.error.trim()) {
			return body.error;
		}
	} catch {
		// Fall back to the status-based message below when the coordinator body is not JSON.
	}

	return "Project coordinator rejected the request.";
}

async function getMutatingAdmissionFencingToken(
	response: Response,
): Promise<number> {
	const body = (await response.json()) as {
		admission?: { fencingToken?: unknown };
	};
	const fencingToken = body.admission?.fencingToken;

	if (typeof fencingToken !== "number") {
		throw new Error("Project coordinator did not return a fencing token.");
	}

	return fencingToken;
}

async function getFlueRunBridgeErrorMessage(
	response: Response,
): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown };
		if (typeof body.error === "string" && body.error.trim()) {
			return body.error;
		}
	} catch {
		// Fall back to the status-based message below when the bridge body is not JSON.
	}

	return "Flue run bridge rejected the request.";
}

async function postFlueRunBridge(options: {
	env: Env;
	sessionId: string;
	path: FlueRunBridgeControlPath;
	body: Record<string, unknown>;
}): Promise<void> {
	const bridgeNamespace = options.env.FlueRunBridge as DurableObjectNamespace;
	const bridgeId = bridgeNamespace.idFromName(options.sessionId);
	const bridge = bridgeNamespace.get(bridgeId) as {
		fetch(request: Request): Promise<Response>;
	};
	const response = await bridge.fetch(
		new Request(`https://flue-run-bridge${options.path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(options.body),
		}),
	);

	if (!response.ok) {
		throw new TRPCError({
			code: response.status === 409 ? "CONFLICT" : "PRECONDITION_FAILED",
			message: await getFlueRunBridgeErrorMessage(response),
		});
	}
}

async function getLatestCheckpointAt(
	db: ReturnType<typeof createDb>,
	projectId: string,
): Promise<Date | null> {
	const [latestCheckpoint] = await db
		.select({ completedAt: snapshots.completedAt })
		.from(snapshots)
		.where(
			and(
				eq(snapshots.projectId, projectId),
				eq(snapshots.status, "completed"),
			),
		)
		.orderBy(desc(snapshots.completedAt))
		.limit(1);

	return latestCheckpoint?.completedAt ?? null;
}

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
			const restoreFailed = project.status === "failed";
			if (!restoreFailed) {
				try {
					await notifyCoordinatorRestore(ctx.env, input.projectId, "begin");
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
				} finally {
					await notifyCoordinatorRestore(ctx.env, input.projectId, "end");
				}
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

			const activeMutatingRun = ensuredProject.activeAgentRunId
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
			const activeReadOnlyFlueRun =
				activeMutatingRun || !selectedSession
					? null
					: await db
							.select()
							.from(agentRuns)
							.where(
								and(
									eq(agentRuns.sessionId, selectedSession.id),
									eq(agentRuns.userId, ctx.user.id),
									eq(agentRuns.isMutating, false),
									isNotNull(agentRuns.flueAgentName),
								),
							)
							.orderBy(desc(agentRuns.createdAt))
							.limit(1)
							.then(([run]) =>
								run && isActiveAgentRunStatus(run.status) ? run : null,
							);
			const activeRun = activeMutatingRun ?? activeReadOnlyFlueRun;

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
			const coordinatorState = await getProjectCoordinatorStatus(
				ctx.env,
				input.projectId,
			);
			const restoring = coordinatorState?.snapshot.restoring ?? false;
			const latestSnapshotId =
				coordinatorState?.snapshot.latestSnapshotId ?? null;
			const lastCheckpointAt = await getLatestCheckpointAt(db, input.projectId);
			return {
				project: projectResponse,
				sandbox: { state: sandboxState },
				restoring,
				latestSnapshotId,
				lastCheckpointAt,
				restoreFailed,
				sessions,
				selectedSession,
				activeRun,
				events: events.reverse(),
			};
		}),

	retryRestore: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
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

			if (project.status !== "failed") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Project restore can only be retried after a failure.",
				});
			}

			const [retryProject] = await db
				.update(projects)
				.set({ status: "ready", updatedAt: sql`(unixepoch())` })
				.where(
					and(
						eq(projects.id, input.projectId),
						eq(projects.userId, ctx.user.id),
						eq(projects.status, "failed"),
					),
				)
				.returning();

			if (!retryProject) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Project restore can only be retried after a failure.",
				});
			}

			const envVars = await decryptEnvVars(
				retryProject.envVars,
				ctx.env.BETTER_AUTH_SECRET,
			);
			let ensuredProject = retryProject;
			let sandboxState:
				| "connected"
				| "restored_from_backup"
				| "recreated_from_github" = "connected";

			try {
				await notifyCoordinatorRestore(ctx.env, input.projectId, "begin");
				const ensured = await ensureProjectSandbox({
					db,
					env: ctx.env,
					project: retryProject,
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
			} finally {
				await notifyCoordinatorRestore(ctx.env, input.projectId, "end");
			}

			const {
				envVars: _envVars,
				sandboxBackup: _sandboxBackup,
				sandboxBackupCreatedAt: _sandboxBackupCreatedAt,
				...projectResponse
			} = ensuredProject;
			const coordinatorState = await getProjectCoordinatorStatus(
				ctx.env,
				input.projectId,
			);

			return {
				project: projectResponse,
				sandbox: { state: sandboxState },
				restoring: coordinatorState?.snapshot.restoring ?? false,
				latestSnapshotId: coordinatorState?.snapshot.latestSnapshotId ?? null,
				lastCheckpointAt: await getLatestCheckpointAt(db, input.projectId),
				restoreFailed: false,
				sessions: [],
				selectedSession: null,
				activeRun: null,
				events: [],
			};
		}),

	startRun: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1).optional(),
				message: z.string().trim().min(1),
				modelSpecifier: z.string().refine(isProjectCoderModelSpecifier, {
					message: "Unknown project coder model.",
				}),
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
					await notifyCoordinatorRestore(ctx.env, input.projectId, "begin");
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
				} finally {
					await notifyCoordinatorRestore(ctx.env, input.projectId, "end");
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
					modelSpecifier: input.modelSpecifier,
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

				async function releaseOwnedProjectLockAfterBatchFailure() {
					if (!ownsProjectLock) {
						return;
					}

					try {
						await db
							.update(projects)
							.set({
								...clearProjectLockProjection(new Date()),
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

				async function startMutatingFlueRun(fencingToken: number) {
					if (!project.sandboxId) {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Project sandbox is not ready yet.",
						});
					}

					await postFlueRunBridge({
						env: ctx.env,
						sessionId,
						path: "/start",
						body: {
							sessionId,
							userId: ctx.user.id,
							projectId: input.projectId,
							sandboxId: project.sandboxId,
							runId,
							message: input.message,
							modelSpecifier: input.modelSpecifier,
							isMutating: true,
							fencingToken,
						},
					});
				}

				async function markCoordinatorAdmissionRejected(
					response: Response,
				): Promise<never> {
					const reason = await getProjectCoordinatorErrorMessage(response);
					const userMessage =
						reason === RESTORE_IN_PROGRESS_MESSAGE
							? "Workspace is restoring. Try again in a moment."
							: reason;

					await db.batch([
						db
							.update(agentRuns)
							.set({
								status: "failed",
								finishedAt: sql`(unixepoch())`,
								updatedAt: sql`(unixepoch())`,
							})
							.where(eq(agentRuns.id, runId)),
						db.insert(agentRunEvents).values([
							{
								runId,
								projectId: input.projectId,
								sessionId,
								type: "lock_rejected" as const,
								payload: createAgentRunEventPayload({
									reason: userMessage,
								}),
							},
							{
								runId,
								projectId: input.projectId,
								sessionId,
								type: "done" as const,
								payload: createAgentRunEventPayload({ status: "failed" }),
							},
						]),
					]);

					throw new TRPCError({
						code: response.status === 409 ? "CONFLICT" : "PRECONDITION_FAILED",
						message: userMessage,
					});
				}

				async function admitMutatingRun(): Promise<number> {
					const admissionResponse = await postProjectCoordinator({
						env: ctx.env,
						projectId: input.projectId,
						path: "/admit",
						body: {
							projectId: input.projectId,
							runId,
							sessionId,
							userId: ctx.user.id,
							mode: "mutating",
						},
					});

					if (!admissionResponse.ok) {
						await markCoordinatorAdmissionRejected(admissionResponse);
					}

					try {
						const fencingToken =
							await getMutatingAdmissionFencingToken(admissionResponse);
						const [lockedProject] = await db
							.update(projects)
							.set({
								...acquireMutatingProjectLockProjection({
									runId,
									fencingToken,
									now: new Date(),
								}),
								activeAgentRunId: runId,
								activeAgentRunStartedAt: sql`(unixepoch())`,
								updatedAt: sql`(unixepoch())`,
							})
							.where(
								and(
									eq(projects.id, input.projectId),
									eq(projects.userId, ctx.user.id),
								),
							)
							.returning();

						if (!lockedProject) {
							throw new Error("Project lock projection update failed.");
						}

						ownsProjectLock = true;
						return fencingToken;
					} catch (error) {
						await notifyMutatingTerminalFailed();
						throw error;
					}
				}

				async function markAcceptedRunFailed(error: unknown) {
					await db.batch([
						db
							.update(agentRuns)
							.set({
								status: "failed",
								finishedAt: sql`(unixepoch())`,
								updatedAt: sql`(unixepoch())`,
							})
							.where(eq(agentRuns.id, runId)),
						db
							.update(projects)
							.set({
								...clearProjectLockProjection(new Date()),
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
							),
						db.insert(agentRunEvents).values([
							{
								runId,
								projectId: input.projectId,
								sessionId,
								type: "error" as const,
								payload: createAgentRunEventPayload({
									reason: compactBrokerError(error),
								}),
							},
							{
								runId,
								projectId: input.projectId,
								sessionId,
								type: "done" as const,
								payload: createAgentRunEventPayload({ status: "failed" }),
							},
						]),
					]);
				}

				async function notifyMutatingTerminalFailed() {
					await postProjectCoordinator({
						env: ctx.env,
						projectId: input.projectId,
						path: "/terminal",
						body: { projectId: input.projectId, runId, status: "failed" },
					});
				}

				async function notifyReadOnlyTerminalFailed() {
					await postProjectCoordinator({
						env: ctx.env,
						projectId: input.projectId,
						path: "/terminal",
						body: { projectId: input.projectId, runId, status: "failed" },
					});
				}

				async function startReadOnlyFlueRun() {
					if (!project.sandboxId) {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Project sandbox is not ready yet.",
						});
					}

					const admissionResponse = await postProjectCoordinator({
						env: ctx.env,
						projectId: input.projectId,
						path: "/admit",
						body: {
							projectId: input.projectId,
							runId,
							sessionId,
							userId: ctx.user.id,
							mode: "read_only",
						},
					});

					if (!admissionResponse.ok) {
						await markCoordinatorAdmissionRejected(admissionResponse);
					}

					try {
						await postFlueRunBridge({
							env: ctx.env,
							sessionId,
							path: "/start",
							body: {
								sessionId,
								userId: ctx.user.id,
								projectId: input.projectId,
								sandboxId: project.sandboxId,
								runId,
								message: input.message,
								modelSpecifier: input.modelSpecifier,
								isMutating: false,
							},
						});
					} catch (error) {
						await markAcceptedRunFailed(error);
						await notifyReadOnlyTerminalFailed();
					}
				}

				async function startCreatedRun() {
					if (input.isMutating) {
						const fencingToken = await admitMutatingRun();
						try {
							await startMutatingFlueRun(fencingToken);
						} catch (error) {
							await notifyMutatingTerminalFailed();
							throw error;
						}
						return;
					}

					await startReadOnlyFlueRun();
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

						try {
							await startCreatedRun();
						} catch (error) {
							if (!input.isMutating || error instanceof TRPCError) {
								throw error;
							}
							await markAcceptedRunFailed(error);
							return { run, session, createdSession };
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

					try {
						await startCreatedRun();
					} catch (error) {
						if (!input.isMutating || error instanceof TRPCError) {
							throw error;
						}
						await markAcceptedRunFailed(error);
						return { run, session, createdSession };
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
					...clearProjectLockProjection(new Date()),
					activeAgentRunId: null,
					activeAgentRunStartedAt: null,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(projects.activeAgentRunId, input.runId));

			if (run.isMutating && !run.flueAgentName) {
				await postProjectCoordinator({
					env: ctx.env,
					projectId: run.projectId,
					path: "/terminal",
					body: {
						projectId: run.projectId,
						runId: input.runId,
						status: "canceled",
					},
				});
			}

			try {
				if (run.flueAgentName || !run.isMutating) {
					await postFlueRunBridge({
						env: ctx.env,
						sessionId: run.sessionId,
						path: "/abort",
						body: { runId: input.runId },
					});
				} else {
					await postWorkspaceSessionBroker({
						env: ctx.env,
						sessionId: run.sessionId,
						path: "/abort",
						body: { runId: input.runId },
					});
				}
			} catch {
				// Durable cancellation is the user-facing boundary; abort is best effort.
			}

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

			await postWorkspaceSessionBroker({
				env: ctx.env,
				sessionId: run.sessionId,
				path: "/reply",
				body: {
					runId: input.runId,
					answer: input.answer,
				},
			});

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

	deleteSession: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);

			const [session] = await db
				.select({ id: workspaceSessions.id })
				.from(workspaceSessions)
				.where(
					and(
						eq(workspaceSessions.id, input.sessionId),
						eq(workspaceSessions.projectId, input.projectId),
						eq(workspaceSessions.userId, ctx.user.id),
					),
				)
				.limit(1);

			if (!session) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found.",
				});
			}

			await db
				.update(workspaceSessions)
				.set({ status: "archived" })
				.where(
					and(
						eq(workspaceSessions.id, input.sessionId),
						eq(workspaceSessions.projectId, input.projectId),
						eq(workspaceSessions.userId, ctx.user.id),
					),
				);

			return { id: session.id };
		}),
});
