import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import { messages, projects, workspaceSessions } from "#/db/schema";
import {
	assertCredentialConfig,
	createCredentialRepository,
	credentialSecretValues,
	FALLBACK_MODEL_SPECIFIER,
	FALLBACK_PROVIDER_ID,
	loadCredential,
	operatorFallbackCredential,
	type StoredCredential,
	toRuntimeCredential,
} from "#/lib/account-provider-credentials";
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
	FALLBACK_MODEL_THINKING_LEVELS,
	isPiThinkingLevel,
	isProjectCoderModelSpecifier,
	PI_THINKING_LEVELS,
	type PiThinkingLevel,
	parseModelSpecifier,
} from "#/lib/agent-models";
import { runAgentInSandbox } from "#/lib/agent-run";
import { decryptEnvVars } from "#/lib/project-env-vars";
import {
	ensureProjectSandbox,
	persistProjectSandboxBackup,
} from "#/lib/project-sandbox";
import { resolveOAuthCredential } from "#/lib/provider-auth-service";
import { redactSecrets } from "#/lib/secret-redaction";
import { ensureSessionWorktree } from "#/lib/session-worktree";
import { makeSessionTitleFromMessage } from "#/lib/workspace-policy";
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
	model: z.string().min(1).refine(isProjectCoderModelSpecifier, {
		message: "Invalid model.",
	}),
	// Optional for old clients; Composer sends the effective selected level.
	thinkingLevel: z.enum(PI_THINKING_LEVELS).optional(),
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

export type AgentRunPrepared = {
	kind: "ready";
	context: AgentRunContext;
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
	sessionId: string;
	createdSession: boolean;
	workspaceSession: OwnedActiveSession;
	ensuredProject: typeof projects.$inferSelect;
	sandboxState: string;
	sessionWorkspacePath: string;
	userMessageId: string;
	assistantMessageId: string;
	envVars: Awaited<ReturnType<typeof decryptEnvVars>>;
	secretValues: string[];
	runtimeCredentialJson: string;
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
	ensureProjectSandbox?: typeof ensureProjectSandbox;
	resolveSessionForMessageWrite?: typeof resolveSessionForMessageWrite;
	ensureSessionWorktree?: typeof ensureSessionWorktree;
	runAgentInSandbox?: typeof runAgentInSandbox;
	controlAgentRun?: typeof controlAgentRun;
	persistProjectSandboxBackup?: typeof persistProjectSandboxBackup;
	redactSecrets?: typeof redactSecrets;
	prepareAssistantMessageStorage?: typeof prepareAssistantMessageStorage;
	serializeAssistantPartsMinimalForStorage?: typeof serializeAssistantPartsMinimalForStorage;
	loadCredential?: typeof loadCredential;
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
	ensureProjectSandbox,
	resolveSessionForMessageWrite,
	ensureSessionWorktree,
	runAgentInSandbox,
	controlAgentRun,
	persistProjectSandboxBackup,
	redactSecrets,
	prepareAssistantMessageStorage,
	serializeAssistantPartsMinimalForStorage,
	loadCredential,
};

function mergeDeps(deps?: AgentRunDeps): Required<AgentRunDeps> {
	return { ...defaultDeps, ...deps };
}

async function deleteEmptySession(options: {
	db: ReturnType<typeof createDb>;
	sessionId: string;
	userId: string;
}): Promise<void> {
	await options.db
		.delete(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.userId, options.userId),
			),
		);
}

/**
 * Authenticate-adjacent prep: project, sandbox, session, worktree, then
 * message insert. Does not construct HTTP responses or SSE text.
 */
export async function prepareAgentRun(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	userId: string;
	input: AgentStreamBody;
	deps?: AgentRunDeps;
}): Promise<AgentRunPrepared | AgentRunHttpError> {
	const deps = mergeDeps(options.deps);
	const { db, env, userId, input } = options;

	try {
		assertCredentialConfig({
			AI_CREDENTIALS_ENCRYPTION_KEY: env.AI_CREDENTIALS_ENCRYPTION_KEY,
			BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
			OPENCODE_API_KEY: env.OPENCODE_API_KEY,
		});
	} catch {
		return {
			kind: "error",
			status: 500,
			body: { error: "Server credentials are not configured." },
		};
	}

	const parsedModel = parseModelSpecifier(input.model);
	if (!parsedModel) {
		return {
			kind: "error",
			status: 400,
			body: { error: "Invalid model." },
		};
	}

	// Resolve account credential / fallback before side effects.
	let runtimeCredential: StoredCredential | null = null;
	/** Exact authorized model capabilities; undefined = legacy catalog without levels. */
	let authorizedThinkingLevels: readonly PiThinkingLevel[] | undefined;
	const credentialDb = createCredentialRepository(db);
	const owned = await deps.loadCredential({
		db: credentialDb,
		userId,
		providerId: parsedModel.providerId,
		encryptionKey: env.AI_CREDENTIALS_ENCRYPTION_KEY,
	});
	if (owned?.status === "needs_relogin") {
		return {
			kind: "error",
			status: 409,
			body: {
				error: "Provider requires re-login. Reconnect it in Account Settings.",
			},
		};
	}
	if (owned?.status === "connected") {
		const catalogModel = owned.models.find(
			(m) =>
				m.providerId === parsedModel.providerId &&
				m.modelId === parsedModel.modelId,
		);
		const inCatalog = Boolean(catalogModel);
		// Exact fallback remains the only operator exception when not in catalog.
		if (!inCatalog && input.model !== FALLBACK_MODEL_SPECIFIER) {
			return {
				kind: "error",
				status: 409,
				body: {
					error:
						"Selected model is not available for this provider connection.",
				},
			};
		}
		// Exact fallback always uses canonical app capabilities (catalog may be legacy/stale).
		if (input.model === FALLBACK_MODEL_SPECIFIER) {
			authorizedThinkingLevels = FALLBACK_MODEL_THINKING_LEVELS;
		} else if (catalogModel?.thinkingLevels) {
			authorizedThinkingLevels = catalogModel.thinkingLevels;
		}
		if (input.model === FALLBACK_MODEL_SPECIFIER && !inCatalog) {
			runtimeCredential = operatorFallbackCredential(env.OPENCODE_API_KEY);
		} else {
			try {
				runtimeCredential = toRuntimeCredential(
					owned.credential,
					parsedModel.providerId,
				);
			} catch {
				if (owned.credential.type !== "oauth") {
					return {
						kind: "error",
						status: 409,
						body: {
							error:
								"Provider session expired. Reconnect it in Account Settings.",
						},
					};
				}
				const refreshed = await resolveOAuthCredential({
					db: credentialDb,
					env,
					userId,
					providerId: parsedModel.providerId,
					stored: owned.credential,
					version: owned.version,
				});
				if (!refreshed.ok) {
					return {
						kind: "error",
						status: 409,
						body: {
							error:
								refreshed.code === "busy"
									? "Provider credentials are busy. Try again shortly."
									: "Provider session expired. Reconnect it in Account Settings.",
						},
					};
				}
				runtimeCredential = refreshed.runtime;
			}
		}
	} else if (input.model === FALLBACK_MODEL_SPECIFIER) {
		runtimeCredential = operatorFallbackCredential(env.OPENCODE_API_KEY);
		authorizedThinkingLevels = FALLBACK_MODEL_THINKING_LEVELS;
	} else if (
		parsedModel.providerId === FALLBACK_PROVIDER_ID &&
		input.model !== FALLBACK_MODEL_SPECIFIER
	) {
		return {
			kind: "error",
			status: 409,
			body: {
				error:
					"Connect an OpenCode credential in Account Settings to use this model.",
			},
		};
	} else {
		return {
			kind: "error",
			status: 409,
			body: {
				error: "Connect this provider in Account Settings to use its models.",
			},
		};
	}

	// Reject unsupported explicit levels before project/session/message side effects.
	if (input.thinkingLevel !== undefined) {
		if (
			!isPiThinkingLevel(input.thinkingLevel) ||
			!authorizedThinkingLevels ||
			!authorizedThinkingLevels.includes(input.thinkingLevel)
		) {
			return {
				kind: "error",
				status: 400,
				body: {
					error: "Unsupported thinking level for selected model.",
				},
			};
		}
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

	if (project.status !== "ready" || !project.sandboxId) {
		return {
			kind: "error",
			status: 409,
			body: { error: "Project sandbox is not ready." },
		};
	}

	const envVars = await deps.decryptEnvVars(
		project.envVars,
		env.BETTER_AUTH_SECRET,
	);

	let ensuredProject = project;
	let sandboxState: string;
	try {
		const ensured = await deps.ensureProjectSandbox({
			db,
			env,
			project,
		});
		ensuredProject = ensured.project;
		sandboxState = ensured.state;
	} catch (error) {
		return {
			kind: "error",
			status: 409,
			body: {
				error:
					error instanceof Error ? error.message : "Failed to prepare sandbox.",
			},
		};
	}

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

	let sessionId: string;
	let createdSession = false;
	let workspaceSession: OwnedActiveSession | null;

	if (resolved.kind === "existing") {
		workspaceSession = resolved.session;
		sessionId = workspaceSession.id;
	} else {
		sessionId = deps.createId();
		const [createdRows] = await db.batch([
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
		]);
		workspaceSession = createdRows?.[0] ?? null;
		createdSession = true;
	}

	if (!workspaceSession || !sessionId) {
		return {
			kind: "error",
			status: 500,
			body: { error: "Failed to create workspace session." },
		};
	}

	const linkedGithubRepo = ensuredProject.githubRepo;
	const linkedInstallationId = ensuredProject.githubInstallationId;
	if (!linkedGithubRepo || linkedInstallationId == null) {
		if (createdSession) {
			await deleteEmptySession({ db, sessionId, userId });
		}
		return {
			kind: "error",
			status: 409,
			body: { error: "Project is not linked to a GitHub repository." },
		};
	}

	let sessionWorkspacePath: string;
	try {
		const ensuredWorktree = await deps.ensureSessionWorktree({
			env,
			sandboxId: ensuredProject.sandboxId as string,
			sessionId,
			githubRepo: linkedGithubRepo,
			installationId: linkedInstallationId,
			existing: {
				branchName: workspaceSession.branchName,
				baseCommitSha: workspaceSession.baseCommitSha,
				workspacePath: workspaceSession.workspacePath,
			},
		});

		if (
			workspaceSession.branchName !== ensuredWorktree.branchName ||
			workspaceSession.workspacePath !== ensuredWorktree.workspacePath ||
			workspaceSession.baseCommitSha !== ensuredWorktree.baseCommitSha
		) {
			await db
				.update(workspaceSessions)
				.set({
					branchName: ensuredWorktree.branchName,
					baseCommitSha: ensuredWorktree.baseCommitSha,
					workspacePath: ensuredWorktree.workspacePath,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(workspaceSessions.id, sessionId));
			workspaceSession = {
				...workspaceSession,
				branchName: ensuredWorktree.branchName,
				baseCommitSha: ensuredWorktree.baseCommitSha,
				workspacePath: ensuredWorktree.workspacePath,
			};
		}

		sessionWorkspacePath = ensuredWorktree.workspacePath;
	} catch (error) {
		if (createdSession) {
			await deleteEmptySession({ db, sessionId, userId });
		}
		return {
			kind: "error",
			status: 409,
			body: {
				error:
					error instanceof Error
						? error.message
						: "Failed to prepare session worktree.",
			},
		};
	}

	const runId = deps.createId();
	const userMessageId = deps.createId();
	const assistantMessageId = deps.createId();
	const [userRows, assistantRows] = await db.batch([
		db
			.insert(messages)
			.values({
				id: userMessageId,
				sessionId,
				projectId: input.projectId,
				userId,
				role: "user",
				content: input.message,
				model: input.model,
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
		workspaceSessionRecencyUpdate(db, sessionId),
	]);

	if (!userRows?.[0] || !assistantRows?.[0]) {
		return {
			kind: "error",
			status: 500,
			body: { error: "Failed to persist messages." },
		};
	}

	const runtimeCredentialJson = JSON.stringify(runtimeCredential);
	const secretValues = [
		...credentialSecretValues(runtimeCredential),
		runtimeCredentialJson,
		env.OPENCODE_API_KEY,
		...envVars.map((envVar) => envVar.value),
	].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	return {
		kind: "ready",
		context: {
			db,
			env,
			userId,
			projectId: input.projectId,
			message: input.message,
			model: input.model,
			thinkingLevel: input.thinkingLevel,
			runId,
			sessionId,
			createdSession,
			workspaceSession,
			ensuredProject,
			sandboxState,
			sessionWorkspacePath,
			userMessageId,
			assistantMessageId,
			envVars,
			secretValues,
			runtimeCredentialJson,
		},
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
		const runResult = await deps.runAgentInSandbox({
			env: context.env,
			sandboxId: context.ensuredProject.sandboxId as string,
			projectId: context.projectId,
			userId: context.userId,
			conversationId: context.sessionId,
			runId: context.runId,
			cwd: context.sessionWorkspacePath,
			model: context.model,
			thinkingLevel: context.thinkingLevel,
			prompt: context.message,
			runtimeCredentialJson: context.runtimeCredentialJson,
			envVars: context.envVars,
			onRunnerMessage: async (msg) => {
				if (msg.kind === "assistant_delta") {
					deltaBatcher.push(msg.delta);
					return;
				}
				// Flush pending text before tools/errors so ordering is preserved.
				deltaBatcher.flush();
				if (msg.kind === "ready") {
					emit({ event: "control_ready", data: { runId: context.runId } });
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
						const settled = await settleTurn(currentTurn, "complete");
						emit({
							event: "turn_done",
							data: {
								userMessageId: currentTurn.userMessageId,
								assistantMessageId: currentTurn.assistantMessageId,
								content: settled.content,
								...(settled.tools.length > 0 ? { tools: settled.tools } : {}),
								...(settled.parts.length > 0 ? { parts: settled.parts } : {}),
							},
						});

						knownPendingAssistants.add(msg.event.assistantMessageId);
						const [userRows, assistantRows] = await context.db.batch([
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
							workspaceSessionRecencyUpdate(context.db, context.sessionId),
						]);
						if (!userRows?.[0] || !assistantRows?.[0]) {
							throw new Error("Failed to persist follow-up messages.");
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
		});

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
			return;
		}

		let backupError: string | undefined;
		try {
			const backupResult = await deps.persistProjectSandboxBackup({
				db: context.db,
				env: context.env,
				project: context.ensuredProject,
			});
			context.ensuredProject = backupResult.project;
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
	}
}
