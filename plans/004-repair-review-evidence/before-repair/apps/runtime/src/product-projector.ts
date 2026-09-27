export type ProjectionTargetKind =
	| "command"
	| "message"
	| "session"
	| "membership";

export type ProjectionPayload = {
	targetKind: ProjectionTargetKind;
	targetId: string;
	workspaceSessionId: string;
	userId: string;
	projectId: string;
	ownerVersion: number;
	coordinatorSeq: number;
	status?: string;
	reasonCode?: string;
	expectedSourceStatus?: string;
	commandId?: string;
	runId?: string;
	runEpoch?: number;
	userMessageId?: string;
	assistantMessageId?: string;
	contentRedacted?: string;
};

export type ProjectionClassification =
	| "applied"
	| "already_applied"
	| "stale_owner"
	| "deleted"
	| "immutable_completed"
	| "blocked_membership"
	| "retry";

export type D1BatchStatement = {
	sql: string;
	params: unknown[];
};

export type D1Like = {
	batch: D1Database["batch"];
	prepare: D1Database["prepare"];
};

export type ProjectionApplyResult = {
	classification: ProjectionClassification;
	retry: boolean;
};

const CURSOR_CAS = `(
	NOT EXISTS (
		SELECT 1 FROM runtime_projection_cursors c
		WHERE c.sessionId = ?
			AND c.targetKind = ?
			AND c.targetId = ?
	)
	OR EXISTS (
		SELECT 1 FROM runtime_projection_cursors c
		WHERE c.sessionId = ?
			AND c.targetKind = ?
			AND c.targetId = ?
			AND (
				c.runtimeOwnerVersion < ?
				OR (c.runtimeOwnerVersion = ? AND c.coordinatorSeq < ?)
			)
	)
)`;

function cursorParams(
	sessionId: string,
	targetKind: string,
	targetId: string,
	ownerVersion: number,
	coordinatorSeq: number,
): unknown[] {
	return [
		sessionId,
		targetKind,
		targetId,
		sessionId,
		targetKind,
		targetId,
		ownerVersion,
		ownerVersion,
		coordinatorSeq,
	];
}

function membershipAndLifecycleSql(options: {
	sessionAlias: string;
	requirePendingAssistant?: boolean;
	expectedCommandStatus?: string;
}): string {
	const pending = options.requirePendingAssistant
		? "AND messages.status = 'pending'"
		: "";
	return `
		AND EXISTS (
			SELECT 1 FROM projects p
			WHERE p.id = ${options.sessionAlias}.projectId
				AND p.userId = ${options.sessionAlias}.userId
				AND p.status != 'deleting'
		)
		AND EXISTS (
			SELECT 1 FROM workspace_sessions s
			WHERE s.id = ${options.sessionAlias}.sessionId
				AND s.projectId = ${options.sessionAlias}.projectId
				AND s.userId = ${options.sessionAlias}.userId
				AND s.runtimeOwner = 'trusted_v1'
				AND s.runtimeOwnerVersion = ?
				AND s.status IN ('active', 'archived')
		)
		${pending}
	`;
}

export function messageTerminalUpdateSql(): string {
	return `
		UPDATE messages
		SET status = ?
		WHERE id = ?
			AND sessionId = ?
			AND projectId = ?
			AND userId = ?
			AND status = 'pending'
			AND EXISTS (
				SELECT 1 FROM projects p
				WHERE p.id = messages.projectId
					AND p.userId = messages.userId
					AND p.status != 'deleting'
			)
			AND EXISTS (
				SELECT 1 FROM workspace_sessions s
				WHERE s.id = messages.sessionId
					AND s.projectId = messages.projectId
					AND s.userId = messages.userId
					AND s.runtimeOwner = 'trusted_v1'
					AND s.runtimeOwnerVersion = ?
					AND s.status IN ('active', 'archived')
			)
			AND EXISTS (
				SELECT 1 FROM runtime_command_memberships m
				WHERE m.assistantMessageId = messages.id
					AND m.sessionId = messages.sessionId
					AND m.commandId = ?
					AND m.runId = ?
			)
			AND ${CURSOR_CAS}
		RETURNING id
	`;
}

export function commandUpdateSql(): string {
	return `
		UPDATE session_commands
		SET executionProjectionVersion = ?, reasonCode = ?
		WHERE id = ?
			AND sessionId = ?
			AND projectId = ?
			AND userId = ?
			AND executionProjectionVersion = ?
			AND EXISTS (
				SELECT 1 FROM projects p
				WHERE p.id = session_commands.projectId
					AND p.userId = session_commands.userId
					AND p.status != 'deleting'
			)
			AND EXISTS (
				SELECT 1 FROM workspace_sessions s
				WHERE s.id = session_commands.sessionId
					AND s.projectId = session_commands.projectId
					AND s.userId = session_commands.userId
					AND s.runtimeOwner = 'trusted_v1'
					AND s.runtimeOwnerVersion = ?
					AND s.status IN ('active', 'archived')
			)
			AND ${CURSOR_CAS}
		RETURNING id
	`;
}

export function membershipInsertSql(): string {
	return `
		INSERT INTO runtime_command_memberships (
			commandId, sessionId, runId, userMessageId, assistantMessageId, runEpoch
		)
		SELECT ?, ?, ?, ?, ?, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM runtime_command_memberships WHERE commandId = ?
		)
		AND EXISTS (
			SELECT 1 FROM workspace_sessions s
			WHERE s.id = ?
				AND s.userId = ?
				AND s.projectId = ?
				AND s.runtimeOwner = 'trusted_v1'
				AND s.runtimeOwnerVersion = ?
				AND s.status IN ('active', 'archived')
		)
		AND EXISTS (
			SELECT 1 FROM projects p
			WHERE p.id = ?
				AND p.userId = ?
				AND p.status != 'deleting'
		)
		RETURNING commandId
	`;
}

export function cursorUpdateSql(): string {
	return `
		UPDATE runtime_projection_cursors
		SET runtimeOwnerVersion = ?, coordinatorSeq = ?, updatedAt = ?
		WHERE sessionId = ? AND targetKind = ? AND targetId = ?
			AND (
				runtimeOwnerVersion < ?
				OR (runtimeOwnerVersion = ? AND coordinatorSeq < ?)
			)
	`;
}

export function cursorInsertSql(): string {
	return `
		INSERT INTO runtime_projection_cursors (
			sessionId, targetKind, targetId, runtimeOwnerVersion, coordinatorSeq, updatedAt
		)
		SELECT ?, ?, ?, ?, ?, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM runtime_projection_cursors
			WHERE sessionId = ? AND targetKind = ? AND targetId = ?
		)
	`;
}

function statementsForPayload(
	prepare: D1Like["prepare"],
	payload: ProjectionPayload,
	now: number,
): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [];
	if (payload.targetKind === "membership") {
		statements.push(
			prepare(membershipInsertSql()).bind(
				payload.commandId,
				payload.workspaceSessionId,
				payload.runId,
				payload.userMessageId ?? null,
				payload.assistantMessageId ?? null,
				payload.runEpoch ?? null,
				payload.commandId,
				payload.workspaceSessionId,
				payload.userId,
				payload.projectId,
				payload.ownerVersion,
				payload.projectId,
				payload.userId,
			),
		);
	} else if (payload.targetKind === "message") {
		statements.push(
			prepare(messageTerminalUpdateSql()).bind(
				payload.status,
				payload.targetId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.userId,
				payload.ownerVersion,
				payload.commandId,
				payload.runId,
				...cursorParams(
					payload.workspaceSessionId,
					"message",
					payload.targetId,
					payload.ownerVersion,
					payload.coordinatorSeq,
				),
			),
		);
	} else if (payload.targetKind === "command") {
		statements.push(
			prepare(commandUpdateSql()).bind(
				payload.coordinatorSeq,
				payload.reasonCode ?? null,
				payload.targetId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.userId,
				Number(payload.expectedSourceStatus ?? 0),
				payload.ownerVersion,
				...cursorParams(
					payload.workspaceSessionId,
					"command",
					payload.targetId,
					payload.ownerVersion,
					payload.coordinatorSeq,
				),
			),
		);
	}
	if (payload.targetKind !== "membership") {
		statements.push(
			prepare(cursorUpdateSql()).bind(
				payload.ownerVersion,
				payload.coordinatorSeq,
				now,
				payload.workspaceSessionId,
				payload.targetKind,
				payload.targetId,
				payload.ownerVersion,
				payload.ownerVersion,
				payload.coordinatorSeq,
			),
		);
		statements.push(
			prepare(cursorInsertSql()).bind(
				payload.workspaceSessionId,
				payload.targetKind,
				payload.targetId,
				payload.ownerVersion,
				payload.coordinatorSeq,
				now,
				payload.workspaceSessionId,
				payload.targetKind,
				payload.targetId,
			),
		);
	}
	return statements;
}

export async function classifyZeroRowProjection(
	d1: D1Like,
	payload: ProjectionPayload,
): Promise<ProjectionClassification> {
	const fence = await d1
		.prepare(
			`SELECT targetKind FROM runtime_deleted_target_fences
			 WHERE (targetKind = 'workspace_session' AND targetId = ?)
			    OR (targetKind = 'project' AND targetId = ?)`,
		)
		.bind(payload.workspaceSessionId, payload.projectId)
		.first();
	if (fence) return "deleted";

	const session = await d1
		.prepare(
			`SELECT runtimeOwner, runtimeOwnerVersion, status, userId, projectId
			 FROM workspace_sessions WHERE id = ?`,
		)
		.bind(payload.workspaceSessionId)
		.first();
	if (!session) return "deleted";

	const ownerVersion = Number(session.runtimeOwnerVersion);
	if (ownerVersion > payload.ownerVersion) return "stale_owner";
	if (
		session.runtimeOwner !== "trusted_v1" ||
		session.userId !== payload.userId ||
		session.projectId !== payload.projectId
	) {
		return "blocked_membership";
	}

	if (payload.targetKind === "message") {
		const message = await d1
			.prepare(
				`SELECT id, status, sessionId, userId, projectId FROM messages WHERE id = ?`,
			)
			.bind(payload.targetId)
			.first();
		if (!message) return "deleted";
		if (
			message.sessionId !== payload.workspaceSessionId ||
			message.userId !== payload.userId ||
			message.projectId !== payload.projectId
		) {
			return "blocked_membership";
		}
		if (message.status === "complete" || message.status === "failed") {
			return "immutable_completed";
		}
		const membership = await d1
			.prepare(
				`SELECT commandId, runId, assistantMessageId FROM runtime_command_memberships
				 WHERE assistantMessageId = ? AND sessionId = ?`,
			)
			.bind(payload.targetId, payload.workspaceSessionId)
			.first();
		if (
			!membership ||
			membership.commandId !== payload.commandId ||
			membership.runId !== payload.runId
		) {
			return "blocked_membership";
		}
	}

	if (payload.targetKind === "command") {
		const command = await d1
			.prepare(
				`SELECT id, sessionId, userId, projectId, executionProjectionVersion
				 FROM session_commands WHERE id = ?`,
			)
			.bind(payload.targetId)
			.first();
		if (!command) return "deleted";
		if (
			command.sessionId !== payload.workspaceSessionId ||
			command.userId !== payload.userId ||
			command.projectId !== payload.projectId
		) {
			return "blocked_membership";
		}
	}

	const cursor = await d1
		.prepare(
			`SELECT runtimeOwnerVersion, coordinatorSeq FROM runtime_projection_cursors
			 WHERE sessionId = ? AND targetKind = ? AND targetId = ?`,
		)
		.bind(payload.workspaceSessionId, payload.targetKind, payload.targetId)
		.first();
	if (cursor) {
		const storedOwner = Number(cursor.runtimeOwnerVersion);
		const storedSeq = Number(cursor.coordinatorSeq);
		if (
			storedOwner > payload.ownerVersion ||
			(storedOwner === payload.ownerVersion &&
				storedSeq >= payload.coordinatorSeq)
		) {
			return "already_applied";
		}
	}

	if (ownerVersion !== payload.ownerVersion) return "blocked_membership";
	return "blocked_membership";
}

export async function applyProductProjectionBatch(
	d1: D1Like,
	payloads: ProjectionPayload[],
	now: number,
): Promise<ProjectionApplyResult[]> {
	const results: ProjectionApplyResult[] = [];
	for (const payload of payloads) {
		const ownerBefore = await d1
			.prepare(
				"SELECT runtimeOwnerVersion FROM workspace_sessions WHERE id = ?",
			)
			.bind(payload.workspaceSessionId)
			.first();
		try {
			const prepared = statementsForPayload(d1.prepare.bind(d1), payload, now);
			const batchResult = await d1.batch(prepared);
			const first = batchResult[0];
			const changes = Number(first?.meta?.changes ?? 0);
			const returned = Array.isArray(first?.results) ? first.results.length : 0;
			if (payload.targetKind === "membership") {
				results.push({
					classification: "applied",
					retry: false,
				});
				continue;
			}
			if (changes > 0 || returned > 0) {
				results.push({ classification: "applied", retry: false });
				continue;
			}
			const ownerAfter = await d1
				.prepare(
					"SELECT runtimeOwnerVersion FROM workspace_sessions WHERE id = ?",
				)
				.bind(payload.workspaceSessionId)
				.first();
			if (
				Number(ownerBefore?.runtimeOwnerVersion) !==
				Number(ownerAfter?.runtimeOwnerVersion)
			) {
				results.push({ classification: "retry", retry: true });
				continue;
			}
			const classification = await classifyZeroRowProjection(d1, payload);
			results.push({
				classification,
				retry: classification === "retry",
			});
		} catch {
			results.push({ classification: "retry", retry: true });
		}
	}
	return results;
}

void membershipAndLifecycleSql;
