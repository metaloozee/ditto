import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import {
	messages,
	projects,
	workspaceRuntimeWork,
	workspaceSessions,
} from "#/db/schema";
import { controlAgentRun } from "#/lib/agent-control-service";
import { createDeltaBatcher } from "#/lib/agent-delta-batcher";
import {
	type AssistantMessagePart,
	appendAssistantTextDelta,
	applyAgentToolEventToParts,
	finalizeAssistantParts,
	partsToText,
	partsToTools,
} from "#/lib/agent-message-parts";
import {
	prepareAssistantMessageStorage,
	serializeAssistantPartsMinimalForStorage,
} from "#/lib/agent-message-storage";
import {
	DEFAULT_PROJECT_CODER_MODEL,
	FALLBACK_MODEL_THINKING_LEVELS,
	isSupportedThinkingLevel,
	type PiThinkingLevel,
} from "#/lib/agent-models";
import { AGENT_COMMAND_TIMEOUT_MS, runAgentInSandbox } from "#/lib/agent-run";
import {
	DITTO_ACTION_CONTRACT_VERSION,
	DITTO_ACTION_OPERATION_TYPE,
} from "#/lib/ditto-action-contract";
import { OPENCODE_CONTRACT_VERSION } from "#/lib/open-code-contract";
import { decryptEnvVars } from "#/lib/project-env-vars";
import { createSandboxAuthority } from "#/lib/sandbox-authority";
import { redactSecrets } from "#/lib/secret-redaction";
import { makeSessionTitleFromMessage } from "#/lib/workspace-policy";
import { recordMutationAndCheckpoint } from "#/lib/workspace-recovery";
import {
	completeWork,
	ensureWorkspaceRuntimeReady,
	failWork,
	submitWorkspaceWork,
	WorkspaceRuntimeError,
	withWorkspaceRuntimeLease,
} from "#/lib/workspace-runtime";
import type { WorkspaceWorkRow } from "#/lib/workspace-runtime-capacity";
import {
	allocateWorkFifoSeq,
	parseWorkspaceWorkPayload,
	WORKSPACE_QUEUE_TTL_MS,
	type WorkspaceWorkPayload,
	type WorkspaceWorkReceipt,
	workspaceWorkInsertValues,
} from "#/lib/workspace-runtime-capacity";
import {
	type OwnedActiveSession,
	resolveSessionForMessageWrite,
	workspaceSessionRecencyUpdate,
} from "#/lib/workspace-session";

export const MESSAGE_STATUSES = ["pending", "complete", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const agentStreamBodySchema = z.object({
	projectId: z.string().min(1),
	sessionId: z.string().min(1).optional(),
	message: z.string().trim().min(1),
	// Optional for old clients; Composer sends the effective selected level.
	thinkingLevel: z.enum(FALLBACK_MODEL_THINKING_LEVELS).optional(),
});

export type AgentStreamBody = z.infer<typeof agentStreamBodySchema>;

export type AgentRunMetaPayload = {
	runId: string;
	sessionId: string;
	userMessageId: string;
	assistantMessageId: string;
	createdSession: boolean;
	sandboxState: string;
};

export type AgentRunDonePayload = {
	ok: boolean;
	assistantMessageId: string;
	content: string;
	tools?: ReturnType<typeof partsToTools>;
	parts?: AssistantMessagePart[];
	backupError?: string;
};

export type AgentRunStreamEvent =
	| { event: "meta"; data: AgentRunMetaPayload }
	| { event: "control_ready"; data: { runId: string } }
	| {
			event: "turn_done";
			data: {
				userMessageId: string;
				assistantMessageId: string;
				content: string;
				tools?: ReturnType<typeof partsToTools>;
				parts?: AssistantMessagePart[];
			};
	  }
	| {
			event: "turn_start";
			data: {
				requestId: string;
				userMessageId: string;
				assistantMessageId: string;
				text: string;
			};
	  }
	| {
			event: "queue_cancelled";
			data: {
				requestId: string;
				userMessageId: string;
				assistantMessageId: string;
			};
	  }
	| { event: "delta"; data: { delta: string } }
	| { event: "agent"; data: { event: unknown; occurredAt: number } }
	| { event: "error"; data: { message: string } }
	| { event: "done"; data: AgentRunDonePayload };

export type AgentRunHttpError = {
	kind: "error";
	status: number;
	body: { error: string; issues?: z.ZodIssue[] };
};

export type AgentRunPrepared =
	| {
			kind: "ready";
			context: AgentRunContext;
	  }
	| {
			kind: "queued";
			context: AgentRunContext;
			receipt: WorkspaceWorkReceipt;
	  };

export type AgentRunContext = {
	db: ReturnType<typeof createDb>;
	env: Env;
	userId: string;
	projectId: string;
	message: string;
	model: string;
	thinkingLevel?: PiThinkingLevel;
	runId: string;
	workId: string;
	sessionId: string;
	createdSession: boolean;
	workspaceSession: OwnedActiveSession;
	ensuredProject: typeof projects.$inferSelect;
	sandboxState: string;
	userMessageId: string;
	assistantMessageId: string;
	envVars: Awaited<ReturnType<typeof decryptEnvVars>>;
	secretValues: string[];
};

export type AgentRunDeps = {
	createId?: () => string;
	/** Injectable clock for deterministic lifecycle timestamps in tests. */
	now?: () => number;
	loadProjectForUser?: (options: {
		db: ReturnType<typeof createDb>;
		projectId: string;
		userId: string;
	}) => Promise<typeof projects.$inferSelect | null>;
	decryptEnvVars?: typeof decryptEnvVars;
	resolveSessionForMessageWrite?: typeof resolveSessionForMessageWrite;
	ensureWorkspaceRuntimeReady?: typeof ensureWorkspaceRuntimeReady;
	submitWorkspaceWork?: typeof submitWorkspaceWork;
	withWorkspaceRuntimeLease?: typeof withWorkspaceRuntimeLease;
	runAgentInSandbox?: typeof runAgentInSandbox;
	createAuthority?: typeof createSandboxAuthority;
	controlAgentRun?: typeof controlAgentRun;
	recordMutationAndCheckpoint?: typeof recordMutationAndCheckpoint;
	redactSecrets?: typeof redactSecrets;
	prepareAssistantMessageStorage?: typeof prepareAssistantMessageStorage;
	serializeAssistantPartsMinimalForStorage?: typeof serializeAssistantPartsMinimalForStorage;
};

const defaultDeps: Required<AgentRunDeps> = {
	createId: () => nanoid(),
	now: () => Date.now(),
	loadProjectForUser: async ({ db, projectId, userId }) => {
		const [project] = await db
			.select()
			.from(projects)
			.where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
			.limit(1);
		return project ?? null;
	},
	decryptEnvVars,
	resolveSessionForMessageWrite,
	ensureWorkspaceRuntimeReady,
	submitWorkspaceWork,
	withWorkspaceRuntimeLease,
	runAgentInSandbox,
	createAuthority: createSandboxAuthority,
	controlAgentRun,
	recordMutationAndCheckpoint,
	redactSecrets,
	prepareAssistantMessageStorage,
	serializeAssistantPartsMinimalForStorage,
};

function mergeDeps(deps?: AgentRunDeps): Required<AgentRunDeps> {
	return { ...defaultDeps, ...deps };
}

/**
 * Persist session + messages + runtime work before capacity or provision.
 * Does not construct HTTP responses or SSE text.
 */
export async function prepareAgentRun(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	userId: string;
	input: AgentStreamBody;
	deps?: AgentRunDeps;
	waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<AgentRunPrepared | AgentRunHttpError> {
	const deps = mergeDeps(options.deps);
	const { db, env, userId, input } = options;

	if (!env.OPENCODE_API_KEY?.trim()) {
		return {
			kind: "error",
			status: 500,
			body: { error: "Server credentials are not configured." },
		};
	}

	const model = DEFAULT_PROJECT_CODER_MODEL;

	// Reject unsupported explicit levels before project/session/message side effects.
	if (
		input.thinkingLevel !== undefined &&
		!isSupportedThinkingLevel(input.thinkingLevel)
	) {
		return {
			kind: "error",
			status: 400,
			body: {
				error: "Unsupported thinking level for selected model.",
			},
		};
	}

	const project = await deps.loadProjectForUser({
		db,
		projectId: input.projectId,
		userId,
	});

	if (!project) {
		return {
			kind: "error",
			status: 404,
			body: { error: "Project not found." },
		};
	}

	if (project.status !== "ready") {
		return {
			kind: "error",
			status: 409,
			body: { error: "Project sandbox is not ready." },
		};
	}

	if (!project.githubRepo || project.githubInstallationId == null) {
		return {
			kind: "error",
			status: 409,
			body: { error: "Project is not linked to a GitHub repository." },
		};
	}

	const envVars = await deps.decryptEnvVars(
		project.envVars,
		env.BETTER_AUTH_SECRET,
	);

	const ensuredProject = project;
	const sandboxState = "connected";

	const resolved = await deps.resolveSessionForMessageWrite({
		db,
		projectId: input.projectId,
		userId,
		sessionId: input.sessionId,
	});

	if (resolved.kind === "not_found") {
		return {
			kind: "error",
			status: 404,
			body: { error: "Session not found." },
		};
	}

	const createdSession = resolved.kind === "create";
	const sessionId =
		resolved.kind === "existing" ? resolved.session.id : deps.createId();
	const runId = deps.createId();
	const workId = deps.createId();
	const userMessageId = deps.createId();
	const assistantMessageId = deps.createId();
	const nowMs = deps.now();
	const queueExpiresAt =
		Math.floor(nowMs / 1000) + Math.floor(WORKSPACE_QUEUE_TTL_MS / 1000);
	const fifoSeq = await allocateWorkFifoSeq(db);
	const workValues = workspaceWorkInsertValues({
		id: workId,
		fifoSeq,
		queueExpiresAt,
		intent: {
			kind: "agent_run",
			projectId: input.projectId,
			userId,
			sessionId,
			userMessageId,
			assistantMessageId,
			payload: {
				runId,
				model,
				thinkingLevel: input.thinkingLevel ?? null,
			},
		},
	});

	const batchStatements = [];
	if (createdSession) {
		batchStatements.push(
			db
				.insert(workspaceSessions)
				.values({
					id: sessionId,
					projectId: input.projectId,
					userId,
					title: makeSessionTitleFromMessage(input.message),
					status: "active",
				})
				.returning(),
		);
	}
	batchStatements.push(
		db
			.insert(messages)
			.values({
				id: userMessageId,
				sessionId,
				projectId: input.projectId,
				userId,
				role: "user",
				content: input.message,
				model,
				status: "complete",
			})
			.returning(),
		db
			.insert(messages)
			.values({
				id: assistantMessageId,
				sessionId,
				projectId: input.projectId,
				userId,
				role: "assistant",
				content: "",
				status: "pending",
			})
			.returning(),
		db.insert(workspaceRuntimeWork).values(workValues).returning(),
		workspaceSessionRecencyUpdate(db, sessionId),
	);

	const batchResult = await db.batch(batchStatements as never);
	const sessionRows = createdSession
		? (batchResult[0] as OwnedActiveSession[] | undefined)
		: undefined;
	const userOffset = createdSession ? 1 : 0;
	const userRows = batchResult[userOffset] as Array<{ id: string }> | undefined;
	const assistantRows = batchResult[userOffset + 1] as
		| Array<{ id: string }>
		| undefined;

	let workspaceSession: OwnedActiveSession | null =
		resolved.kind === "existing"
			? resolved.session
			: (sessionRows?.[0] ?? null);

	if (!workspaceSession) {
		const [loaded] = await db
			.select()
			.from(workspaceSessions)
			.where(eq(workspaceSessions.id, sessionId))
			.limit(1);
		workspaceSession = loaded ?? null;
	}

	if (!workspaceSession || !userRows?.[0] || !assistantRows?.[0]) {
		return {
			kind: "error",
			status: 500,
			body: { error: "Failed to persist messages." },
		};
	}

	const secretValues = [
		env.OPENCODE_API_KEY,
		...envVars.map((envVar) => envVar.value),
	].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	const context: AgentRunContext = {
		db,
		env,
		userId,
		projectId: input.projectId,
		message: input.message,
		model,
		thinkingLevel: input.thinkingLevel,
		runId,
		workId,
		sessionId,
		createdSession,
		workspaceSession,
		ensuredProject,
		sandboxState,
		userMessageId,
		assistantMessageId,
		envVars,
		secretValues,
	};

	const receipt = await deps.submitWorkspaceWork({
		env,
		db,
		workId,
		intent: {
			kind: "agent_run",
			projectId: input.projectId,
			userId,
			sessionId,
			userMessageId,
			assistantMessageId,
			payload: {
				runId,
				model,
				thinkingLevel: input.thinkingLevel ?? null,
			},
		},
		waitUntil: options.waitUntil,
		now: deps.now,
		createId: deps.createId,
	});

	if (receipt.status === "queued") {
		return { kind: "queued", context, receipt };
	}

	return { kind: "ready", context };
}

export async function loadAgentRunContextFromWork(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	work: WorkspaceWorkRow;
	payload: WorkspaceWorkPayload | null;
	deps?: AgentRunDeps;
}): Promise<AgentRunContext | null> {
	const deps = mergeDeps(options.deps);
	const { work, env } = options;
	if (!work.sessionId || !work.userMessageId || !work.assistantMessageId) {
		return null;
	}
	const project = await deps.loadProjectForUser({
		db: options.db,
		projectId: work.projectId,
		userId: work.userId,
	});
	if (!project) {
		return null;
	}
	const [session] = await options.db
		.select()
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, work.sessionId),
				eq(workspaceSessions.userId, work.userId),
			),
		)
		.limit(1);
	if (!session) {
		return null;
	}
	const [userMessage] = await options.db
		.select()
		.from(messages)
		.where(eq(messages.id, work.userMessageId))
		.limit(1);
	if (!userMessage) {
		return null;
	}
	const envVars = await deps.decryptEnvVars(
		project.envVars,
		env.BETTER_AUTH_SECRET,
	);
	const payload = options.payload ?? parseWorkspaceWorkPayload(work.payload);
	const runId = typeof payload?.runId === "string" ? payload.runId : work.id;
	const model =
		typeof payload?.model === "string"
			? payload.model
			: (userMessage.model ?? "");
	const thinkingRaw = payload?.thinkingLevel;
	const thinkingLevel =
		thinkingRaw === "off" || thinkingRaw === "high" || thinkingRaw === "max"
			? thinkingRaw
			: undefined;
	const secretValues = [
		env.OPENCODE_API_KEY,
		...envVars.map((envVar) => envVar.value),
	].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return {
		db: options.db,
		env,
		userId: work.userId,
		projectId: work.projectId,
		message: userMessage.content,
		model,
		thinkingLevel,
		runId,
		workId: work.id,
		sessionId: session.id,
		createdSession: false,
		workspaceSession: session,
		ensuredProject: project,
		sandboxState: "connected",
		userMessageId: work.userMessageId,
		assistantMessageId: work.assistantMessageId,
		envVars,
		secretValues,
	};
}

async function persistAssistantTerminal(options: {
	context: AgentRunContext;
	assistantMessageId: string;
	content: string;
	parts: AssistantMessagePart[];
	status: "complete" | "failed";
	deps: Required<AgentRunDeps>;
}): Promise<{ toolsColumn: string | null }> {
	const { context, assistantMessageId, content, parts, status, deps } = options;
	const { toolsColumn } = deps.prepareAssistantMessageStorage(parts);

	try {
		await context.db
			.update(messages)
			.set({
				content,
				tools: toolsColumn,
				status,
			})
			.where(
				and(
					eq(messages.id, assistantMessageId),
					eq(messages.userId, context.userId),
				),
			);
		return { toolsColumn };
	} catch (error) {
		console.error(
			"Failed to persist assistant message tools; retrying with minimal serialization.",
			error instanceof Error ? error.message : error,
		);
		const fallbackTools = deps.serializeAssistantPartsMinimalForStorage(parts);
		try {
			await context.db
				.update(messages)
				.set({
					content,
					tools: fallbackTools,
					status,
				})
				.where(
					and(
						eq(messages.id, assistantMessageId),
						eq(messages.userId, context.userId),
					),
				);
			return { toolsColumn: fallbackTools };
		} catch (fallbackError) {
			console.error(
				"Minimal tools serialization also failed.",
				fallbackError instanceof Error ? fallbackError.message : fallbackError,
			);
			throw fallbackError;
		}
	}
}

/**
 * Stream the agent run: emit typed events to `emit`. Never constructs Response
 * or SSE text. Persists terminal assistant status before successful/failed done.
 */
export async function executeAgentRun(options: {
	context: AgentRunContext;
	emit: (event: AgentRunStreamEvent) => void;
	deps?: AgentRunDeps;
}): Promise<void> {
	const deps = mergeDeps(options.deps);
	const { context, emit } = options;
	const redact = deps.redactSecrets;

	emit({
		event: "meta",
		data: {
			runId: context.runId,
			sessionId: context.sessionId,
			userMessageId: context.userMessageId,
			assistantMessageId: context.assistantMessageId,
			createdSession: context.createdSession,
			sandboxState: context.sandboxState,
		},
	});

	type CurrentTurn = {
		userMessageId: string;
		assistantMessageId: string;
		text: string;
		parts: AssistantMessagePart[];
	};
	let currentTurn: CurrentTurn = {
		userMessageId: context.userMessageId,
		assistantMessageId: context.assistantMessageId,
		text: context.message,
		parts: [],
	};
	const terminalAssistants = new Set<string>();
	const knownPendingAssistants = new Set<string>([context.assistantMessageId]);

	// Batch contiguous assistant text deltas so SSE emit work stays bounded.
	// Non-text events force a sync flush so text/tool ordering stays exact.
	const deltaBatcher = createDeltaBatcher({
		onFlush: (delta) => {
			currentTurn.parts = appendAssistantTextDelta(currentTurn.parts, delta);
			emit({ event: "delta", data: { delta } });
		},
	});

	const settleTurn = async (
		turn: CurrentTurn,
		status: "complete" | "failed",
	) => {
		const content = redact(partsToText(turn.parts), context.secretValues);
		const parts = finalizeAssistantParts(turn.parts, deps.now());
		const tools = partsToTools(parts);
		await persistAssistantTerminal({
			context,
			assistantMessageId: turn.assistantMessageId,
			content,
			parts,
			status,
			deps,
		});
		terminalAssistants.add(turn.assistantMessageId);
		knownPendingAssistants.delete(turn.assistantMessageId);
		return { content, parts, tools };
	};

	const requestStop = async () => {
		await deps.controlAgentRun({
			db: context.db,
			env: context.env,
			userId: context.userId,
			input: {
				action: "stop",
				projectId: context.projectId,
				sessionId: context.sessionId,
				runId: context.runId,
			},
		});
	};

	const failKnownPending = async () => {
		for (const assistantMessageId of knownPendingAssistants) {
			try {
				await persistAssistantTerminal({
					context,
					assistantMessageId,
					content:
						assistantMessageId === currentTurn.assistantMessageId
							? redact(partsToText(currentTurn.parts), context.secretValues)
							: "",
					parts:
						assistantMessageId === currentTurn.assistantMessageId
							? finalizeAssistantParts(currentTurn.parts, deps.now())
							: [],
					status: "failed",
					deps,
				});
				terminalAssistants.add(assistantMessageId);
				knownPendingAssistants.delete(assistantMessageId);
			} catch (error) {
				console.error(
					"Failed to terminally persist a known pending assistant.",
					error instanceof Error ? error.message : error,
				);
			}
		}
	};

	try {
		const runResult = await deps.withWorkspaceRuntimeLease(
			{
				env: context.env,
				db: context.db,
				userId: context.userId,
				projectId: context.projectId,
				sessionId: context.sessionId,
				purpose: "agent_run",
				lock: "acquire",
			},
			async (lease) => {
				if (!lease.identity) {
					throw new WorkspaceRuntimeError(
						"identity_required",
						"Workspace session has no sandbox identity for model access.",
					);
				}
				const identity = lease.identity;
				const authority = deps.createAuthority(context.db);
				const expiresAt = new Date(Date.now() + AGENT_COMMAND_TIMEOUT_MS);
				return await authority.withOperation(
					{
						identityId: identity.id,
						family: "model",
						type: "agent_run",
						contractVersion: OPENCODE_CONTRACT_VERSION,
						maxRequests: null,
						expiresAt,
					},
					async () =>
						await authority.withOperation(
							{
								identityId: identity.id,
								family: "ditto_action",
								type: DITTO_ACTION_OPERATION_TYPE,
								contractVersion: DITTO_ACTION_CONTRACT_VERSION,
								allowedRefs: [lease.branchName],
								maxRequests: null,
								expiresAt,
							},
							async () =>
								deps.runAgentInSandbox({
									env: context.env,
									sandbox: lease.sandbox,
									projectId: context.projectId,
									userId: context.userId,
									conversationId: context.sessionId,
									runId: context.runId,
									cwd: lease.workspacePath,
									model: context.model,
									thinkingLevel: context.thinkingLevel,
									prompt: context.message,
									envVars: lease.projectEnv ?? context.envVars,
									bypassWorkspaceLock: true,
									onRunnerMessage: async (msg) => {
										if (msg.kind === "assistant_delta") {
											deltaBatcher.push(msg.delta);
											return;
										}
										// Flush pending text before tools/errors so ordering is preserved.
										deltaBatcher.flush();
										if (msg.kind === "ready") {
											emit({
												event: "control_ready",
												data: { runId: context.runId },
											});
											return;
										}
										if (msg.kind === "control_event") {
											if (msg.event.type === "follow_up_cancelled") {
												emit({
													event: "queue_cancelled",
													data: {
														requestId: msg.event.requestId,
														userMessageId: msg.event.userMessageId,
														assistantMessageId: msg.event.assistantMessageId,
													},
												});
												return;
											}
											if (msg.event.type === "stop_requested") return;

											try {
												const settled = await settleTurn(
													currentTurn,
													"complete",
												);
												emit({
													event: "turn_done",
													data: {
														userMessageId: currentTurn.userMessageId,
														assistantMessageId: currentTurn.assistantMessageId,
														content: settled.content,
														...(settled.tools.length > 0
															? { tools: settled.tools }
															: {}),
														...(settled.parts.length > 0
															? { parts: settled.parts }
															: {}),
													},
												});

												knownPendingAssistants.add(
													msg.event.assistantMessageId,
												);
												const [userRows, assistantRows] =
													await context.db.batch([
														context.db
															.insert(messages)
															.values({
																id: msg.event.userMessageId,
																sessionId: context.sessionId,
																projectId: context.projectId,
																userId: context.userId,
																role: "user",
																content: msg.event.text,
																model: context.model,
																status: "complete",
															})
															.returning(),
														context.db
															.insert(messages)
															.values({
																id: msg.event.assistantMessageId,
																sessionId: context.sessionId,
																projectId: context.projectId,
																userId: context.userId,
																role: "assistant",
																content: "",
																status: "pending",
															})
															.returning(),
														workspaceSessionRecencyUpdate(
															context.db,
															context.sessionId,
														),
													]);
												if (!userRows?.[0] || !assistantRows?.[0]) {
													throw new Error(
														"Failed to persist follow-up messages.",
													);
												}
												currentTurn = {
													userMessageId: msg.event.userMessageId,
													assistantMessageId: msg.event.assistantMessageId,
													text: msg.event.text,
													parts: [],
												};
												emit({
													event: "turn_start",
													data: {
														requestId: msg.event.requestId,
														userMessageId: msg.event.userMessageId,
														assistantMessageId: msg.event.assistantMessageId,
														text: msg.event.text,
													},
												});
											} catch (error) {
												await requestStop().catch(() => undefined);
												await failKnownPending();
												throw error;
											}
											return;
										}
										if (msg.kind === "agent_event") {
											// One server-assigned occurrence time for SSE + reducer.
											const occurredAt = deps.now();
											emit({
												event: "agent",
												data: { event: msg.event, occurredAt },
											});
											const nextParts = applyAgentToolEventToParts(
												currentTurn.parts,
												msg.event,
												occurredAt,
											);
											if (nextParts) {
												currentTurn.parts = nextParts;
											}
										}
										if (msg.kind === "error") {
											emit({
												event: "error",
												data: {
													message: redact(msg.message, context.secretValues),
												},
											});
										}
									},
								}),
						),
				);
			},
		);

		// Flush any remaining batched text before terminal persistence / done.
		deltaBatcher.dispose();

		if (
			!partsToText(currentTurn.parts).trim() &&
			runResult.assistantText &&
			terminalAssistants.size === 0
		) {
			currentTurn.parts = appendAssistantTextDelta(
				currentTurn.parts,
				runResult.assistantText,
			);
		}

		const terminalStatus: "complete" | "failed" = runResult.ok
			? "complete"
			: "failed";
		let settled: Awaited<ReturnType<typeof settleTurn>>;
		try {
			settled = await settleTurn(currentTurn, terminalStatus);
		} catch (persistError) {
			const message = redact(
				persistError instanceof Error
					? persistError.message
					: "Failed to persist assistant message.",
				context.secretValues,
			);
			emit({ event: "error", data: { message } });
			emit({
				event: "done",
				data: {
					ok: false,
					assistantMessageId: currentTurn.assistantMessageId,
					content: redact(partsToText(currentTurn.parts), context.secretValues),
					backupError: message,
				},
			});
			if (context.workId) {
				await failWork({
					db: context.db,
					workId: context.workId,
					reasonCode: "persist_failed",
				});
			}
			return;
		}

		let backupError: string | undefined;
		try {
			const recovery = await deps.recordMutationAndCheckpoint({
				db: context.db,
				env: context.env,
				userId: context.userId,
				projectId: context.projectId,
				sessionId: context.sessionId,
			});
			if (recovery.state === "degraded" || recovery.state === "failed") {
				backupError = redact(
					recovery.reasonCode
						? `Workspace recovery ${recovery.state}: ${recovery.reasonCode}`
						: `Workspace recovery ${recovery.state}.`,
					context.secretValues,
				);
			}
		} catch (error) {
			backupError = redact(
				error instanceof Error
					? error.message
					: "Failed to persist backup metadata.",
				context.secretValues,
			);
		}

		// Never claim success when the run failed or terminal persistence failed.
		emit({
			event: "done",
			data: {
				ok:
					runResult.ok &&
					terminalAssistants.has(currentTurn.assistantMessageId),
				assistantMessageId: currentTurn.assistantMessageId,
				content: settled.content,
				...(settled.tools.length > 0 ? { tools: settled.tools } : {}),
				...(settled.parts.length > 0 ? { parts: settled.parts } : {}),
				...(backupError ? { backupError } : {}),
			},
		});
	} catch (error) {
		// Ensure no pending text is lost on the failure path.
		deltaBatcher.dispose();

		const message = redact(
			error instanceof Error ? error.message : "Agent stream failed.",
			context.secretValues,
		);

		const assistantContent = redact(
			partsToText(currentTurn.parts),
			context.secretValues,
		);
		const fullParts = finalizeAssistantParts(currentTurn.parts, deps.now());
		const fullTools = partsToTools(fullParts);

		if (!terminalAssistants.has(currentTurn.assistantMessageId)) {
			try {
				await persistAssistantTerminal({
					context,
					assistantMessageId: currentTurn.assistantMessageId,
					content: assistantContent,
					parts: fullParts,
					status: "failed",
					deps,
				});
				terminalAssistants.add(currentTurn.assistantMessageId);
				knownPendingAssistants.delete(currentTurn.assistantMessageId);
			} catch (persistError) {
				console.error(
					"Failed to persist failed assistant message.",
					persistError instanceof Error ? persistError.message : persistError,
				);
			}
		}

		emit({ event: "error", data: { message } });
		emit({
			event: "done",
			data: {
				ok: false,
				assistantMessageId: currentTurn.assistantMessageId,
				content: assistantContent,
				...(fullTools.length > 0 ? { tools: fullTools } : {}),
				...(fullParts.length > 0 ? { parts: fullParts } : {}),
				...(message ? { backupError: message } : {}),
			},
		});
		if (context.workId) {
			await failWork({
				db: context.db,
				workId: context.workId,
				reasonCode: "execution_failed",
			});
		}
		return;
	}

	if (context.workId) {
		await completeWork({
			db: context.db,
			workId: context.workId,
		});
	}
}
