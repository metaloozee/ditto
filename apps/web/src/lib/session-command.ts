import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	messages,
	projects,
	runtimeDeletedTargetFences,
	sessionCommandKeys,
	sessionCommandSequences,
	sessionCommands,
	workspaceRuntimeWork,
	workspaceSessions,
} from "#/db/schema";
import {
	DEFAULT_PROJECT_CODER_MODEL,
	DEFAULT_THINKING_LEVEL,
} from "#/lib/agent-models";
import type { SessionRuntime } from "#/lib/session-runtime-client";
import { SESSION_RUNTIME_PROTOCOL_VERSION } from "#/lib/session-runtime-client";
import { isEmptyReturning } from "#/lib/session-runtime-ownership";
import { makeSessionTitleFromMessage } from "#/lib/workspace-policy";
import { WORKSPACE_QUEUE_TTL_MS } from "#/lib/workspace-runtime-capacity";
import {
	type BrowserCommandV1,
	type CommandV1,
	ContractParseError,
	parseBrowserCommandV1,
	parseCommandV1,
	parseReceiptV1,
	RECOVERY_COMMAND_KINDS,
	type ReceiptV1,
} from "../../../../packages/runtime-contracts/src/command.js";
import { decodeJsonText } from "../../../../packages/runtime-contracts/src/json.js";
import { RUNTIME_LIMITS } from "../../../../packages/runtime-contracts/src/limits.js";

type Db = ReturnType<typeof createDb>;

const MAX_CONFLICT_RETRIES = 4;
const COMMAND_PAYLOAD_VERSION = 1;

export class SessionCommandError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
		readonly category?: string,
	) {
		super(message);
		this.name = "SessionCommandError";
	}
}

export function isVersionedAgentCommand(body: unknown): boolean {
	return (
		typeof body === "object" &&
		body !== null &&
		!Array.isArray(body) &&
		Object.hasOwn(body, "version")
	);
}

export async function readBoundedAgentRequestText(
	request: Request,
	maxBytes = RUNTIME_LIMITS.commandBodyBytes,
): Promise<string> {
	const contentLength = request.headers.get("content-length");
	if (contentLength != null && contentLength !== "") {
		const length = Number(contentLength);
		if (Number.isFinite(length) && length > maxBytes) {
			throw new SessionCommandError(
				"contract_too_large",
				"JSON exceeds its byte limit.",
				400,
			);
		}
	}
	const reader = request.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel().catch(() => undefined);
			throw new SessionCommandError(
				"contract_too_large",
				"JSON exceeds its byte limit.",
				400,
			);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new SessionCommandError(
			"invalid_json",
			"Request body is not valid UTF-8.",
			400,
		);
	}
}

function nativeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

export function classifyAgentRequestBody(raw: string): {
	mode: "versioned" | "legacy" | "error";
	decoded?: unknown;
	error?: { status: number; body: unknown };
} {
	try {
		const decoded = decodeJsonText(raw, RUNTIME_LIMITS.commandBodyBytes);
		if (isVersionedAgentCommand(decoded)) {
			return { mode: "versioned", decoded };
		}
		return { mode: "legacy", decoded };
	} catch (error) {
		if (error instanceof ContractParseError) {
			const native = nativeJsonParse(raw);
			const versioned =
				isVersionedAgentCommand(native) || /"version"\s*:/.test(raw);
			if (
				versioned ||
				error.code === "duplicate_field" ||
				error.code === "contract_too_large"
			) {
				return {
					mode: "error",
					error: {
						status: 400,
						body: { error: error.message, code: error.code },
					},
				};
			}
			return {
				mode: "error",
				error: { status: 400, body: { error: "Invalid JSON body." } },
			};
		}
		throw error;
	}
}

export function legacyRequestRejection(
	runtimeOwner: string | null | undefined,
): SessionCommandError | null {
	if (!runtimeOwner || runtimeOwner === "legacy") return null;
	if (runtimeOwner === "blocked") {
		return new SessionCommandError(
			"runtime_blocked",
			"Workspace runtime is blocked.",
			409,
			"runtime_blocked",
		);
	}
	return new SessionCommandError(
		"upgrade_recovery",
		"Workspace runtime requires an upgraded client.",
		409,
		"upgrade_recovery",
	);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function canonicalAdmissionPayload(
	input: BrowserCommandV1,
): Record<string, unknown> {
	if (input.kind === "prompt") {
		return {
			kind: "prompt",
			text: input.text,
			thinkingLevel: input.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
		};
	}
	if (input.kind === "follow_up") {
		return {
			kind: "follow_up",
			targetRunId: input.targetRunId,
			text: input.text,
		};
	}
	if (input.kind === "stop") {
		return { kind: "stop", targetRunId: input.targetRunId };
	}
	if (input.kind === "cancel") {
		return { kind: "cancel", targetCommandId: input.targetCommandId };
	}
	return { kind: input.kind };
}

function normalizeAdmittedCommand(input: BrowserCommandV1): BrowserCommandV1 {
	if (input.kind === "prompt") {
		const text = input.text.trim();
		if (text.length === 0) {
			throw new SessionCommandError(
				"invalid_request",
				"Prompt text is required.",
				400,
			);
		}
		return {
			...input,
			text,
			thinkingLevel: input.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
		};
	}
	if (input.kind === "follow_up") {
		const text = input.text.trim();
		if (text.length === 0) {
			throw new SessionCommandError(
				"invalid_request",
				"Follow-up text is required.",
				400,
			);
		}
		return { ...input, text };
	}
	return input;
}

function durableOutboxPayload(input: BrowserCommandV1): string {
	if (input.kind === "prompt") {
		return JSON.stringify({
			commandKind: "prompt",
			thinkingLevel: input.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
		});
	}
	return JSON.stringify({ commandKind: input.kind });
}

function isUniqueConstraint(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /unique constraint failed/i.test(message);
}

function requiresModel(kind: BrowserCommandV1["kind"]): boolean {
	return kind === "prompt" || kind === "follow_up";
}

function needsMessagePair(kind: BrowserCommandV1["kind"]): boolean {
	return kind === "prompt" || kind === "follow_up";
}

function isRecoveryKind(kind: BrowserCommandV1["kind"]): boolean {
	return (RECOVERY_COMMAND_KINDS as readonly string[]).includes(kind);
}

function keyScope(input: BrowserCommandV1): {
	targetKind: "project" | "workspace_session";
	targetId: string;
} {
	if (input.kind === "prompt" && !input.sessionId) {
		return { targetKind: "project", targetId: input.projectId };
	}
	if (!input.sessionId) {
		throw new SessionCommandError(
			"invalid_request",
			"A workspace session is required.",
			400,
		);
	}
	return { targetKind: "workspace_session", targetId: input.sessionId };
}

function liveTrustedSession(options: {
	sessionId: string;
	userId: string;
	projectId: string;
	ownerVersion?: number;
}) {
	return and(
		eq(workspaceSessions.id, options.sessionId),
		eq(workspaceSessions.userId, options.userId),
		eq(workspaceSessions.projectId, options.projectId),
		eq(workspaceSessions.status, "active"),
		eq(workspaceSessions.runtimeOwner, "trusted_v1"),
		options.ownerVersion === undefined
			? sql`TRUE`
			: eq(workspaceSessions.runtimeOwnerVersion, options.ownerVersion),
		sql`NOT EXISTS (
			SELECT 1 FROM runtime_deleted_target_fences
			WHERE (targetKind = 'workspace_session' AND targetId = ${options.sessionId})
				OR (targetKind = 'project' AND targetId = ${options.projectId})
		)`,
		sql`EXISTS (
			SELECT 1 FROM ${projects}
			WHERE ${projects.id} = ${options.projectId}
				AND ${projects.userId} = ${options.userId}
				AND ${projects.status} != 'deleting'
		)`,
	);
}

function toReceipt(options: {
	key: typeof sessionCommandKeys.$inferSelect;
	command: typeof sessionCommands.$inferSelect;
}): ReceiptV1 {
	const receipt: ReceiptV1 = {
		version: 1,
		receiptId: options.key.receiptId,
		commandId: options.command.id,
		userId: options.command.userId,
		projectId: options.command.projectId,
		status: "admitted",
		projectionVersion: options.command.executionProjectionVersion,
		queueDeadlineAt: options.command.deadlineAt,
	};
	if (options.command.sessionId) {
		receipt.workspaceSessionId = options.command.sessionId;
	}
	if (options.command.commandSeq != null) {
		receipt.commandSeq = options.command.commandSeq;
	}
	if (options.command.kind === "stop") {
		receipt.stopState = "recorded";
	}
	return parseReceiptV1(receipt);
}

async function loadKey(options: {
	db: Db;
	userId: string;
	targetKind: "project" | "workspace_session";
	targetId: string;
	idempotencyKey: string;
}) {
	const [row] = await options.db
		.select()
		.from(sessionCommandKeys)
		.where(
			and(
				eq(sessionCommandKeys.userId, options.userId),
				eq(sessionCommandKeys.targetKind, options.targetKind),
				eq(sessionCommandKeys.targetId, options.targetId),
				eq(sessionCommandKeys.idempotencyKey, options.idempotencyKey),
			),
		)
		.limit(1);
	return row ?? null;
}

async function loadCommand(db: Db, commandId: string) {
	const [row] = await db
		.select()
		.from(sessionCommands)
		.where(eq(sessionCommands.id, commandId))
		.limit(1);
	return row ?? null;
}

function parseOutboxSettings(
	payload: string | null,
	expectedKind: string,
):
	| {
			ok: true;
			commandKind: string;
			thinkingLevel?: "off" | "high" | "max";
	  }
	| { ok: false } {
	if (!payload) return { ok: false };
	try {
		const parsed: unknown = JSON.parse(payload);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { ok: false };
		}
		const record = parsed as Record<string, unknown>;
		if (record.commandKind !== expectedKind) {
			return { ok: false };
		}
		if (expectedKind === "prompt") {
			if (
				record.thinkingLevel !== "off" &&
				record.thinkingLevel !== "high" &&
				record.thinkingLevel !== "max"
			) {
				return { ok: false };
			}
			return {
				ok: true,
				commandKind: "prompt",
				thinkingLevel: record.thinkingLevel,
			};
		}
		return { ok: true, commandKind: expectedKind };
	} catch {
		return { ok: false };
	}
}

export async function reconstructAdmittedCommandV1(
	db: Db,
	commandId: string,
): Promise<CommandV1 | null> {
	const command = await loadCommand(db, commandId);
	if (!command?.sessionId || command.commandSeq == null) return null;
	const [work] = await db
		.select()
		.from(workspaceRuntimeWork)
		.where(eq(workspaceRuntimeWork.commandId, command.id))
		.limit(1);
	if (
		!work ||
		work.commandId !== command.id ||
		work.sessionId !== command.sessionId ||
		work.userId !== command.userId ||
		work.projectId !== command.projectId ||
		work.runtimeOwner !== "trusted_v1"
	) {
		return null;
	}
	const [session] = await db
		.select({
			id: workspaceSessions.id,
			userId: workspaceSessions.userId,
			projectId: workspaceSessions.projectId,
		})
		.from(workspaceSessions)
		.where(eq(workspaceSessions.id, command.sessionId))
		.limit(1);
	if (
		!session ||
		session.userId !== command.userId ||
		session.projectId !== command.projectId
	) {
		return null;
	}
	const settings = parseOutboxSettings(work.payload, command.kind);
	if (!settings.ok) return null;
	const base = {
		version: 1 as const,
		commandId: command.id,
		commandSeq: command.commandSeq,
		userId: command.userId,
		projectId: command.projectId,
		workspaceSessionId: command.sessionId,
		runtimeOwnerVersion: work.runtimeOwnerVersion,
		acceptedAt: command.acceptedAt,
		deadlineAt: command.deadlineAt,
	};
	if (command.kind === "prompt") {
		if (
			!command.userMessageId ||
			!command.assistantMessageId ||
			settings.thinkingLevel === undefined
		) {
			return null;
		}
		const [userMessage] = await db
			.select({
				content: messages.content,
				sessionId: messages.sessionId,
				userId: messages.userId,
			})
			.from(messages)
			.where(eq(messages.id, command.userMessageId))
			.limit(1);
		const [assistantMessage] = await db
			.select({
				sessionId: messages.sessionId,
			})
			.from(messages)
			.where(eq(messages.id, command.assistantMessageId))
			.limit(1);
		if (
			!userMessage ||
			userMessage.sessionId !== command.sessionId ||
			userMessage.userId !== command.userId ||
			!assistantMessage ||
			assistantMessage.sessionId !== command.sessionId
		) {
			return null;
		}
		return parseCommandV1({
			...base,
			kind: "prompt",
			userMessageId: command.userMessageId,
			assistantMessageId: command.assistantMessageId,
			text: userMessage.content,
			thinkingLevel: settings.thinkingLevel,
		});
	}
	if (command.kind === "follow_up") {
		if (
			!command.userMessageId ||
			!command.assistantMessageId ||
			!command.targetRunId
		) {
			return null;
		}
		const [userMessage] = await db
			.select({
				content: messages.content,
				sessionId: messages.sessionId,
				userId: messages.userId,
			})
			.from(messages)
			.where(eq(messages.id, command.userMessageId))
			.limit(1);
		const [assistantMessage] = await db
			.select({
				sessionId: messages.sessionId,
			})
			.from(messages)
			.where(eq(messages.id, command.assistantMessageId))
			.limit(1);
		if (
			!userMessage ||
			userMessage.sessionId !== command.sessionId ||
			userMessage.userId !== command.userId ||
			!assistantMessage ||
			assistantMessage.sessionId !== command.sessionId
		) {
			return null;
		}
		return parseCommandV1({
			...base,
			kind: "follow_up",
			userMessageId: command.userMessageId,
			assistantMessageId: command.assistantMessageId,
			targetRunId: command.targetRunId,
			text: userMessage.content,
		});
	}
	if (command.kind === "stop" && command.targetRunId) {
		return parseCommandV1({
			...base,
			kind: "stop",
			targetRunId: command.targetRunId,
		});
	}
	if (command.kind === "cancel" && command.targetCommandId) {
		return parseCommandV1({
			...base,
			kind: "cancel",
			targetCommandId: command.targetCommandId,
		});
	}
	return null;
}

async function assertReplayAccess(options: {
	db: Db;
	userId: string;
	command: typeof sessionCommands.$inferSelect;
}): Promise<void> {
	const [project] = await options.db
		.select({
			id: projects.id,
			status: projects.status,
		})
		.from(projects)
		.where(
			and(
				eq(projects.id, options.command.projectId),
				eq(projects.userId, options.userId),
			),
		)
		.limit(1);
	if (!project || project.status === "deleting") {
		throw new SessionCommandError("not_found", "Project not found.", 404);
	}
	const [tombstone] = await options.db
		.select({
			targetKind: runtimeDeletedTargetFences.targetKind,
		})
		.from(runtimeDeletedTargetFences)
		.where(
			sql`(${runtimeDeletedTargetFences.targetKind} = 'project' AND ${runtimeDeletedTargetFences.targetId} = ${options.command.projectId})
				OR (${runtimeDeletedTargetFences.targetKind} = 'workspace_session' AND ${runtimeDeletedTargetFences.targetId} = ${options.command.sessionId})`,
		)
		.limit(1);
	if (tombstone) {
		throw new SessionCommandError(
			"deleted",
			"Workspace target has been deleted.",
			409,
			"deleted",
		);
	}
	if (!options.command.sessionId) {
		return;
	}
	const [session] = await options.db
		.select({
			id: workspaceSessions.id,
			userId: workspaceSessions.userId,
			status: workspaceSessions.status,
			runtimeOwner: workspaceSessions.runtimeOwner,
		})
		.from(workspaceSessions)
		.where(eq(workspaceSessions.id, options.command.sessionId))
		.limit(1);
	if (!session || session.userId !== options.userId) {
		throw new SessionCommandError("not_found", "Session not found.", 404);
	}
	if (session.status !== "active") {
		throw new SessionCommandError(
			"archived",
			"Workspace session is archived.",
			409,
			"archived",
		);
	}
	if (session.runtimeOwner === "blocked") {
		throw new SessionCommandError(
			"runtime_blocked",
			"Workspace runtime is blocked.",
			409,
			"runtime_blocked",
		);
	}
	if (session.runtimeOwner !== "trusted_v1") {
		throw new SessionCommandError(
			"upgrade_recovery",
			"Workspace runtime requires an upgraded client.",
			409,
			"upgrade_recovery",
		);
	}
}

async function assertFreshAccess(options: {
	db: Db;
	userId: string;
	input: BrowserCommandV1;
}): Promise<{ ownerVersion: number | null }> {
	const [project] = await options.db
		.select({
			id: projects.id,
			status: projects.status,
		})
		.from(projects)
		.where(
			and(
				eq(projects.id, options.input.projectId),
				eq(projects.userId, options.userId),
			),
		)
		.limit(1);
	if (!project) {
		throw new SessionCommandError("not_found", "Project not found.", 404);
	}
	if (project.status === "deleting") {
		throw new SessionCommandError(
			"deleted",
			"Project is deleting.",
			409,
			"deleted",
		);
	}
	if (
		requiresModel(options.input.kind) &&
		project.status !== "ready" &&
		options.input.kind === "prompt" &&
		!options.input.sessionId
	) {
		throw new SessionCommandError(
			"project_not_ready",
			"Project sandbox is not ready.",
			409,
		);
	}
	const [projectFence] = await options.db
		.select({
			targetId: runtimeDeletedTargetFences.targetId,
		})
		.from(runtimeDeletedTargetFences)
		.where(
			and(
				eq(runtimeDeletedTargetFences.targetKind, "project"),
				eq(runtimeDeletedTargetFences.targetId, options.input.projectId),
			),
		)
		.limit(1);
	if (projectFence) {
		throw new SessionCommandError(
			"deleted",
			"Workspace target has been deleted.",
			409,
			"deleted",
		);
	}
	if (!options.input.sessionId) {
		return { ownerVersion: null };
	}
	const [sessionFence] = await options.db
		.select({
			targetId: runtimeDeletedTargetFences.targetId,
		})
		.from(runtimeDeletedTargetFences)
		.where(
			and(
				eq(runtimeDeletedTargetFences.targetKind, "workspace_session"),
				eq(runtimeDeletedTargetFences.targetId, options.input.sessionId),
			),
		)
		.limit(1);
	if (sessionFence) {
		throw new SessionCommandError(
			"deleted",
			"Workspace target has been deleted.",
			409,
			"deleted",
		);
	}
	const [session] = await options.db
		.select({
			id: workspaceSessions.id,
			status: workspaceSessions.status,
			runtimeOwner: workspaceSessions.runtimeOwner,
			runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
		})
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.input.sessionId),
				eq(workspaceSessions.projectId, options.input.projectId),
				eq(workspaceSessions.userId, options.userId),
			),
		)
		.limit(1);
	if (!session) {
		throw new SessionCommandError("not_found", "Session not found.", 404);
	}
	if (session.status !== "active") {
		throw new SessionCommandError(
			"archived",
			"Workspace session is archived.",
			409,
			"archived",
		);
	}
	if (session.runtimeOwner === "blocked") {
		throw new SessionCommandError(
			"runtime_blocked",
			"Workspace runtime is blocked.",
			409,
			"runtime_blocked",
		);
	}
	if (session.runtimeOwner !== "trusted_v1") {
		throw new SessionCommandError(
			"upgrade_recovery",
			"Workspace runtime requires an upgraded client.",
			409,
			"upgrade_recovery",
		);
	}
	return { ownerVersion: session.runtimeOwnerVersion };
}

async function replayExisting(options: {
	db: Db;
	userId: string;
	hash: string;
	key: typeof sessionCommandKeys.$inferSelect;
}): Promise<ReceiptV1> {
	const command = await loadCommand(options.db, options.key.commandId);
	if (!command) {
		throw new SessionCommandError(
			"conflict",
			"Command idempotency record is incomplete.",
			409,
			"conflict",
		);
	}
	await assertReplayAccess({
		db: options.db,
		userId: options.userId,
		command,
	});
	if (options.key.canonicalPayloadHash !== options.hash) {
		throw new SessionCommandError(
			"conflict",
			"Idempotency key was already used with a different payload.",
			409,
			"conflict",
		);
	}
	return toReceipt({ key: options.key, command });
}

function insertUserMessage(
	db: Db,
	values: {
		id: string;
		sessionId: string;
		projectId: string;
		userId: string;
		content: string;
		ownerVersion: number | null;
	},
) {
	return db
		.insert(messages)
		.select(
			db
				.select({
					id: sql<string>`${values.id}`.as("id"),
					sessionId: sql<string>`${values.sessionId}`.as("sessionId"),
					projectId: sql<string>`${values.projectId}`.as("projectId"),
					userId: sql<string>`${values.userId}`.as("userId"),
					role: sql<"user">`'user'`.as("role"),
					content: sql<string>`${values.content}`.as("content"),
					model: sql<string>`${DEFAULT_PROJECT_CODER_MODEL}`.as("model"),
					tools: sql<string | null>`null`.as("tools"),
					status: sql<"complete">`'complete'`.as("status"),
					createdAt: sql`(unixepoch())`.as("createdAt"),
				})
				.from(workspaceSessions)
				.where(
					liveTrustedSession({
						sessionId: values.sessionId,
						userId: values.userId,
						projectId: values.projectId,
						ownerVersion: values.ownerVersion ?? undefined,
					}),
				),
		)
		.returning({ id: messages.id });
}

function insertAssistantMessage(
	db: Db,
	values: {
		id: string;
		sessionId: string;
		projectId: string;
		userId: string;
		ownerVersion: number | null;
	},
) {
	return db
		.insert(messages)
		.select(
			db
				.select({
					id: sql<string>`${values.id}`.as("id"),
					sessionId: sql<string>`${values.sessionId}`.as("sessionId"),
					projectId: sql<string>`${values.projectId}`.as("projectId"),
					userId: sql<string>`${values.userId}`.as("userId"),
					role: sql<"assistant">`'assistant'`.as("role"),
					content: sql<string>`${""}`.as("content"),
					model: sql<string | null>`null`.as("model"),
					tools: sql<string | null>`null`.as("tools"),
					status: sql<"pending">`'pending'`.as("status"),
					createdAt: sql`(unixepoch())`.as("createdAt"),
				})
				.from(workspaceSessions)
				.where(
					liveTrustedSession({
						sessionId: values.sessionId,
						userId: values.userId,
						projectId: values.projectId,
						ownerVersion: values.ownerVersion ?? undefined,
					}),
				),
		)
		.returning({ id: messages.id });
}

async function persistAdmission(options: {
	db: Db;
	userId: string;
	input: BrowserCommandV1;
	hash: string;
	now: number;
	createId: () => string;
	ownerVersion: number | null;
}): Promise<ReceiptV1> {
	const createSession =
		options.input.kind === "prompt" && !options.input.sessionId;
	const sessionId = options.input.sessionId ?? options.createId();
	const commandId = options.createId();
	const receiptId = options.createId();
	const keyId = options.createId();
	const workId = options.createId();
	const userMessageId = needsMessagePair(options.input.kind)
		? options.createId()
		: null;
	const assistantMessageId = needsMessagePair(options.input.kind)
		? options.createId()
		: null;
	const acceptedAt = options.now;
	const deadlineAt = acceptedAt + WORKSPACE_QUEUE_TTL_MS;
	const queueExpiresAt = Math.floor(deadlineAt / 1000);
	const scope = keyScope(options.input);
	const title =
		options.input.kind === "prompt"
			? makeSessionTitleFromMessage(options.input.text)
			: "Session";
	const ownerVersion = createSession ? 1 : options.ownerVersion;

	const sessionInsert = options.db
		.insert(workspaceSessions)
		.select(
			options.db
				.select({
					id: sql<string>`${sessionId}`.as("id"),
					projectId: projects.id,
					userId: projects.userId,
					title: sql<string>`${title}`.as("title"),
					branchName: sql<string | null>`null`.as("branchName"),
					baseCommitSha: sql<string | null>`null`.as("baseCommitSha"),
					status: sql<"active">`'active'`.as("status"),
					previewStartedAt: sql<Date | null>`null`.as("previewStartedAt"),
					sandboxIdentityId: sql<string | null>`null`.as("sandboxIdentityId"),
					runtimeLeaseId: sql<string | null>`null`.as("runtimeLeaseId"),
					runtimeLeaseExpiresAt: sql<Date | null>`null`.as(
						"runtimeLeaseExpiresAt",
					),
					runtimeFailureReasonCode: sql<string | null>`null`.as(
						"runtimeFailureReasonCode",
					),
					runtimeOwner: sql<"trusted_v1">`'trusted_v1'`.as("runtimeOwner"),
					runtimeOwnerVersion: sql<number>`1`.as("runtimeOwnerVersion"),
					brainIdentityId: sql<string | null>`null`.as("brainIdentityId"),
					runtimeProtocolVersion: sql<
						number | null
					>`${SESSION_RUNTIME_PROTOCOL_VERSION}`.as("runtimeProtocolVersion"),
					runtimeJournalVersion: sql<number | null>`null`.as(
						"runtimeJournalVersion",
					),
					productProjectionVersion: sql<number>`0`.as(
						"productProjectionVersion",
					),
					createdAt: sql`(unixepoch())`.as("createdAt"),
					updatedAt: sql`(unixepoch())`.as("updatedAt"),
				})
				.from(projects)
				.where(
					and(
						eq(projects.id, options.input.projectId),
						eq(projects.userId, options.userId),
						eq(projects.status, "ready"),
						sql`NOT EXISTS (
							SELECT 1 FROM runtime_deleted_target_fences
							WHERE targetKind = 'project' AND targetId = ${options.input.projectId}
						)`,
					),
				),
		)
		.returning({ id: workspaceSessions.id });

	const sequenceInsert = options.db
		.insert(sessionCommandSequences)
		.select(
			options.db
				.select({
					sessionId: workspaceSessions.id,
					nextSequence: sql<number>`1`.as("nextSequence"),
					updatedAt: sql<number>`${acceptedAt}`.as("updatedAt"),
				})
				.from(workspaceSessions)
				.where(
					liveTrustedSession({
						sessionId,
						userId: options.userId,
						projectId: options.input.projectId,
						ownerVersion: ownerVersion ?? undefined,
					}),
				),
		)
		.onConflictDoNothing()
		.returning({ sessionId: sessionCommandSequences.sessionId });

	const commandInsert = options.db
		.insert(sessionCommands)
		.select(
			options.db
				.select({
					id: sql<string>`${commandId}`.as("id"),
					userId: sql<string>`${options.userId}`.as("userId"),
					targetKind: sql<"workspace_session">`'workspace_session'`.as(
						"targetKind",
					),
					targetId: sql<string>`${sessionId}`.as("targetId"),
					projectId: sql<string>`${options.input.projectId}`.as("projectId"),
					sessionId: sql<string>`${sessionId}`.as("sessionId"),
					kind: sql<string>`${options.input.kind}`.as("kind"),
					commandSeq: sessionCommandSequences.nextSequence,
					targetRunId: sql<string | null>`${
						options.input.kind === "follow_up" || options.input.kind === "stop"
							? options.input.targetRunId
							: null
					}`.as("targetRunId"),
					targetCommandId: sql<string | null>`${
						options.input.kind === "cancel"
							? options.input.targetCommandId
							: null
					}`.as("targetCommandId"),
					payloadVersion: sql<number>`${COMMAND_PAYLOAD_VERSION}`.as(
						"payloadVersion",
					),
					userMessageId: sql<string | null>`${userMessageId}`.as(
						"userMessageId",
					),
					assistantMessageId: sql<string | null>`${assistantMessageId}`.as(
						"assistantMessageId",
					),
					payloadDigest: sql<string>`${options.hash}`.as("payloadDigest"),
					acceptedAt: sql<number>`${acceptedAt}`.as("acceptedAt"),
					deadlineAt: sql<number>`${deadlineAt}`.as("deadlineAt"),
					admissionVersion: sql<number>`1`.as("admissionVersion"),
					executionProjectionVersion: sql<number>`0`.as(
						"executionProjectionVersion",
					),
					reasonCode: sql<string | null>`null`.as("reasonCode"),
				})
				.from(workspaceSessions)
				.innerJoin(
					sessionCommandSequences,
					eq(sessionCommandSequences.sessionId, workspaceSessions.id),
				)
				.where(
					liveTrustedSession({
						sessionId,
						userId: options.userId,
						projectId: options.input.projectId,
						ownerVersion: ownerVersion ?? undefined,
					}),
				),
		)
		.returning({ id: sessionCommands.id });

	const sequenceIncrement = options.db
		.update(sessionCommandSequences)
		.set({
			nextSequence: sql`${sessionCommandSequences.nextSequence} + 1`,
			updatedAt: acceptedAt,
		})
		.where(
			and(
				eq(sessionCommandSequences.sessionId, sessionId),
				sql`EXISTS (SELECT 1 FROM session_commands WHERE id = ${commandId})`,
			),
		)
		.returning({ sessionId: sessionCommandSequences.sessionId });

	const keyInsert = options.db
		.insert(sessionCommandKeys)
		.select(
			options.db
				.select({
					id: sql<string>`${keyId}`.as("id"),
					userId: sql<string>`${options.userId}`.as("userId"),
					targetKind: sql<string>`${scope.targetKind}`.as("targetKind"),
					targetId: sql<string>`${scope.targetId}`.as("targetId"),
					idempotencyKey: sql<string>`${options.input.idempotencyKey}`.as(
						"idempotencyKey",
					),
					commandKind: sql<string>`${options.input.kind}`.as("commandKind"),
					canonicalPayloadHash: sql<string>`${options.hash}`.as(
						"canonicalPayloadHash",
					),
					commandId: sql<string>`${commandId}`.as("commandId"),
					receiptId: sql<string>`${receiptId}`.as("receiptId"),
					createdAt: sql<number>`${acceptedAt}`.as("createdAt"),
				})
				.from(workspaceSessions)
				.where(
					and(
						liveTrustedSession({
							sessionId,
							userId: options.userId,
							projectId: options.input.projectId,
							ownerVersion: ownerVersion ?? undefined,
						}),
						sql`EXISTS (SELECT 1 FROM session_commands WHERE id = ${commandId})`,
					),
				),
		)
		.returning({ id: sessionCommandKeys.id });

	const workInsert = options.db
		.insert(workspaceRuntimeWork)
		.select(
			options.db
				.select({
					id: sql<string>`${workId}`.as("id"),
					fifoSeq:
						sql<number>`coalesce((select max(${workspaceRuntimeWork.fifoSeq}) from ${workspaceRuntimeWork}), 0) + 1`.as(
							"fifoSeq",
						),
					identityId: sql<string | null>`null`.as("identityId"),
					sessionId: sql<string | null>`${sessionId}`.as("sessionId"),
					projectId: sql<string>`${options.input.projectId}`.as("projectId"),
					userId: sql<string>`${options.userId}`.as("userId"),
					intent: sql<"agent_run">`'agent_run'`.as("intent"),
					payload: sql<string | null>`${durableOutboxPayload(
						options.input,
					)}`.as("payload"),
					status: sql<"queued">`'queued'`.as("status"),
					leaseToken: sql<string | null>`null`.as("leaseToken"),
					leaseExpiresAt: sql<number | null>`null`.as("leaseExpiresAt"),
					retryCount: sql<number>`0`.as("retryCount"),
					reasonCode: sql<string | null>`null`.as("reasonCode"),
					queueExpiresAt: sql<number>`${queueExpiresAt}`.as("queueExpiresAt"),
					userMessageId: sql<string | null>`${userMessageId}`.as(
						"userMessageId",
					),
					assistantMessageId: sql<string | null>`${assistantMessageId}`.as(
						"assistantMessageId",
					),
					protocolVersion: sql<
						number | null
					>`${SESSION_RUNTIME_PROTOCOL_VERSION}`.as("protocolVersion"),
					runtimeOwner: sql<"trusted_v1">`'trusted_v1'`.as("runtimeOwner"),
					runtimeOwnerVersion:
						sql<number>`coalesce(${workspaceSessions.runtimeOwnerVersion}, 1)`.as(
							"runtimeOwnerVersion",
						),
					commandId: sql<string | null>`${commandId}`.as("commandId"),
					deliveryState: sql<"pending">`'pending'`.as("deliveryState"),
					deliveryLeaseToken: sql<string | null>`null`.as("deliveryLeaseToken"),
					deliveryLeaseExpiresAt: sql<number | null>`null`.as(
						"deliveryLeaseExpiresAt",
					),
					deliveryAttempts: sql<number>`0`.as("deliveryAttempts"),
					startupRoles: sql<string | null>`null`.as("startupRoles"),
					startupPools: sql<string | null>`null`.as("startupPools"),
					expectedIdentityId: sql<string | null>`null`.as("expectedIdentityId"),
					startupDeadline: sql<number | null>`null`.as("startupDeadline"),
					createdAt: sql`(unixepoch())`.as("createdAt"),
					updatedAt: sql`(unixepoch())`.as("updatedAt"),
				})
				.from(workspaceSessions)
				.where(
					and(
						liveTrustedSession({
							sessionId,
							userId: options.userId,
							projectId: options.input.projectId,
							ownerVersion: ownerVersion ?? undefined,
						}),
						sql`EXISTS (SELECT 1 FROM session_commands WHERE id = ${commandId})`,
					),
				),
		)
		.returning({ id: workspaceRuntimeWork.id });

	const recencyUpdate = options.db
		.update(workspaceSessions)
		.set({ updatedAt: sql`(unixepoch())` })
		.where(
			liveTrustedSession({
				sessionId,
				userId: options.userId,
				projectId: options.input.projectId,
				ownerVersion: ownerVersion ?? undefined,
			}),
		)
		.returning({ id: workspaceSessions.id });

	const statements = [];
	if (createSession) statements.push(sessionInsert);
	statements.push(sequenceInsert);
	if (userMessageId && assistantMessageId && options.input.kind !== "stop") {
		if (options.input.kind === "prompt" || options.input.kind === "follow_up") {
			statements.push(
				insertUserMessage(options.db, {
					id: userMessageId,
					sessionId,
					projectId: options.input.projectId,
					userId: options.userId,
					content: options.input.text,
					ownerVersion,
				}),
				insertAssistantMessage(options.db, {
					id: assistantMessageId,
					sessionId,
					projectId: options.input.projectId,
					userId: options.userId,
					ownerVersion,
				}),
			);
		}
	}
	statements.push(
		commandInsert,
		sequenceIncrement,
		keyInsert,
		workInsert,
		recencyUpdate,
	);

	const batchResult: unknown[] = await options.db.batch(statements as never);
	if (
		isEmptyReturning(batchResult[batchResult.length - 3]) ||
		isEmptyReturning(batchResult[batchResult.length - 2]) ||
		isEmptyReturning(batchResult[batchResult.length - 1])
	) {
		throw new SessionCommandError(
			"runtime_owner_mismatch",
			"Workspace runtime ownership changed.",
			409,
			"upgrade_recovery",
		);
	}

	const key = await loadKey({
		db: options.db,
		userId: options.userId,
		targetKind: scope.targetKind,
		targetId: scope.targetId,
		idempotencyKey: options.input.idempotencyKey,
	});
	const command = key ? await loadCommand(options.db, key.commandId) : null;
	if (!key || !command) {
		throw new SessionCommandError(
			"runtime_owner_mismatch",
			"Workspace runtime ownership changed.",
			409,
			"upgrade_recovery",
		);
	}
	return toReceipt({ key, command });
}

export async function admitSessionCommand(options: {
	db: Db;
	runtime: SessionRuntime;
	authenticatedUserId: string;
	input: unknown;
	now?: () => number;
	createId?: () => string;
}): Promise<ReceiptV1> {
	const now = options.now ?? Date.now;
	const createId = options.createId ?? nanoid;
	const input = normalizeAdmittedCommand(parseBrowserCommandV1(options.input));
	if (isRecoveryKind(input.kind)) {
		throw new SessionCommandError(
			"unimplemented_command",
			"Recovery command is not admitted until its handler exists.",
			409,
			"unimplemented_command",
		);
	}

	const hash = await sha256Hex(canonicalJson(canonicalAdmissionPayload(input)));
	const scope = keyScope(input);
	const existing = await loadKey({
		db: options.db,
		userId: options.authenticatedUserId,
		targetKind: scope.targetKind,
		targetId: scope.targetId,
		idempotencyKey: input.idempotencyKey,
	});
	if (existing) {
		return replayExisting({
			db: options.db,
			userId: options.authenticatedUserId,
			hash,
			key: existing,
		});
	}

	const access = await assertFreshAccess({
		db: options.db,
		userId: options.authenticatedUserId,
		input,
	});
	if (requiresModel(input.kind)) {
		const configuration = await options.runtime.modelConfiguration();
		if (configuration.protocolVersion !== SESSION_RUNTIME_PROTOCOL_VERSION) {
			throw new SessionCommandError(
				"runtime_protocol_mismatch",
				"Runtime protocol is incompatible.",
				409,
				"runtime_protocol_mismatch",
			);
		}
		if (!configuration.configured) {
			throw new SessionCommandError(
				"model_unconfigured",
				"Model configuration is unavailable.",
				409,
				"model_unconfigured",
			);
		}
	}

	for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
		try {
			return await persistAdmission({
				db: options.db,
				userId: options.authenticatedUserId,
				input,
				hash,
				now: now(),
				createId,
				ownerVersion: access.ownerVersion,
			});
		} catch (error) {
			if (!isUniqueConstraint(error)) throw error;
			const raced = await loadKey({
				db: options.db,
				userId: options.authenticatedUserId,
				targetKind: scope.targetKind,
				targetId: scope.targetId,
				idempotencyKey: input.idempotencyKey,
			});
			if (raced) {
				return replayExisting({
					db: options.db,
					userId: options.authenticatedUserId,
					hash,
					key: raced,
				});
			}
		}
	}
	throw new SessionCommandError(
		"conflict",
		"Command admission conflicted.",
		409,
		"conflict",
	);
}

export async function handleSessionCommandRequest(options: {
	db: Db;
	runtime: SessionRuntime;
	authenticatedUserId: string;
	body: unknown;
	now?: () => number;
	createId?: () => string;
}): Promise<{ status: number; body: unknown }> {
	try {
		const receipt = await admitSessionCommand({
			db: options.db,
			runtime: options.runtime,
			authenticatedUserId: options.authenticatedUserId,
			input: options.body,
			now: options.now,
			createId: options.createId,
		});
		return { status: 202, body: receipt };
	} catch (error) {
		if (error instanceof SessionCommandError) {
			return {
				status: error.status,
				body: {
					error: error.message,
					code: error.code,
					category: error.category,
				},
			};
		}
		if (error instanceof ContractParseError) {
			return {
				status: 400,
				body: { error: error.message, code: error.code },
			};
		}
		throw error;
	}
}
