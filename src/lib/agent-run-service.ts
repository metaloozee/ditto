import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import { messages, projects, workspaceSessions } from "#/db/schema";
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
import { isProjectCoderModelSpecifier } from "#/lib/agent-models";
import { runAgentInSandbox } from "#/lib/agent-run";
import { decryptEnvVars } from "#/lib/project-env-vars";
import {
	ensureProjectSandbox,
	persistProjectSandboxBackup,
} from "#/lib/project-sandbox";
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
});

export type AgentStreamBody = z.infer<typeof agentStreamBodySchema>;

export type AgentRunMetaPayload = {
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
	| { event: "delta"; data: { delta: string } }
	| { event: "agent"; data: { event: unknown } }
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
};

export type AgentRunDeps = {
	createId?: () => string;
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
	persistProjectSandboxBackup?: typeof persistProjectSandboxBackup;
	redactSecrets?: typeof redactSecrets;
	prepareAssistantMessageStorage?: typeof prepareAssistantMessageStorage;
	serializeAssistantPartsMinimalForStorage?: typeof serializeAssistantPartsMinimalForStorage;
};

const defaultDeps: Required<AgentRunDeps> = {
	createId: () => nanoid(),
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
	persistProjectSandboxBackup,
	redactSecrets,
	prepareAssistantMessageStorage,
	serializeAssistantPartsMinimalForStorage,
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

	const secretValues = [
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
		},
	};
}

async function persistAssistantTerminal(options: {
	context: AgentRunContext;
	content: string;
	parts: AssistantMessagePart[];
	status: "complete" | "failed";
	deps: Required<AgentRunDeps>;
}): Promise<{ toolsColumn: string | null }> {
	const { context, content, parts, status, deps } = options;
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
					eq(messages.id, context.assistantMessageId),
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
						eq(messages.id, context.assistantMessageId),
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
			sessionId: context.sessionId,
			userMessageId: context.userMessageId,
			assistantMessageId: context.assistantMessageId,
			createdSession: context.createdSession,
			sandboxState: context.sandboxState,
		},
	});

	let assistantContent = "";
	let parts: AssistantMessagePart[] = [];
	let terminalPersisted = false;

	// Batch contiguous assistant text deltas so SSE emit work stays bounded.
	// Non-text events force a sync flush so text/tool ordering stays exact.
	const deltaBatcher = createDeltaBatcher({
		onFlush: (delta) => {
			parts = appendAssistantTextDelta(parts, delta);
			emit({ event: "delta", data: { delta } });
		},
	});

	try {
		const runResult = await deps.runAgentInSandbox({
			env: context.env,
			sandboxId: context.ensuredProject.sandboxId as string,
			projectId: context.projectId,
			userId: context.userId,
			conversationId: context.sessionId,
			cwd: context.sessionWorkspacePath,
			model: context.model,
			prompt: context.message,
			envVars: context.envVars,
			onRunnerMessage: async (msg) => {
				if (msg.kind === "assistant_delta") {
					deltaBatcher.push(msg.delta);
					return;
				}
				// Flush pending text before tools/errors so ordering is preserved.
				deltaBatcher.flush();
				if (msg.kind === "agent_event") {
					emit({ event: "agent", data: { event: msg.event } });
					const nextParts = applyAgentToolEventToParts(parts, msg.event);
					if (nextParts) {
						parts = nextParts;
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

		const textFromParts = partsToText(parts);
		if (textFromParts.trim().length > 0) {
			assistantContent = textFromParts;
		} else if (runResult.assistantText) {
			assistantContent = runResult.assistantText;
			parts = appendAssistantTextDelta(parts, runResult.assistantText);
		} else {
			assistantContent = "";
		}

		assistantContent = redact(assistantContent, context.secretValues);

		const fullParts = finalizeAssistantParts(parts);
		const fullTools = partsToTools(fullParts);

		const terminalStatus: "complete" | "failed" = runResult.ok
			? "complete"
			: "failed";

		try {
			await persistAssistantTerminal({
				context,
				content: assistantContent,
				parts,
				status: terminalStatus,
				deps,
			});
			terminalPersisted = true;
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
					assistantMessageId: context.assistantMessageId,
					content: assistantContent,
					...(fullTools.length > 0 ? { tools: fullTools } : {}),
					...(fullParts.length > 0 ? { parts: fullParts } : {}),
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
				ok: runResult.ok && terminalPersisted,
				assistantMessageId: context.assistantMessageId,
				content: assistantContent,
				...(fullTools.length > 0 ? { tools: fullTools } : {}),
				...(fullParts.length > 0 ? { parts: fullParts } : {}),
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

		assistantContent = redact(
			partsToText(parts) || assistantContent,
			context.secretValues,
		);
		const fullParts = finalizeAssistantParts(parts);
		const fullTools = partsToTools(fullParts);

		if (!terminalPersisted) {
			try {
				await persistAssistantTerminal({
					context,
					content: assistantContent,
					parts,
					status: "failed",
					deps,
				});
				terminalPersisted = true;
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
				assistantMessageId: context.assistantMessageId,
				content: assistantContent,
				...(fullTools.length > 0 ? { tools: fullTools } : {}),
				...(fullParts.length > 0 ? { parts: fullParts } : {}),
				...(message ? { backupError: message } : {}),
			},
		});
	}
}
