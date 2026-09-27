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
	currentPairId?: string | null;
	previousPairId?: string | null;
	mutationGeneration?: number;
	expectedMutationGeneration?: number;
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

const DELETION_FENCE = `
	NOT EXISTS (
		SELECT 1 FROM runtime_deleted_target_fences f
		WHERE (f.targetKind = 'workspace_session' AND f.targetId = ?)
		   OR (f.targetKind = 'project' AND f.targetId = ?)
	)
`;

const SESSION_ACTIVE = `
	EXISTS (
		SELECT 1 FROM workspace_sessions s
		WHERE s.id = ?
			AND s.projectId = ?
			AND s.userId = ?
			AND s.runtimeOwner = 'trusted_v1'
			AND s.runtimeOwnerVersion = ?
			AND s.status IN ('active', 'archived')
	)
`;

const PROJECT_PRESENT = `
	EXISTS (
		SELECT 1 FROM projects p
		WHERE p.id = ?
			AND p.userId = ?
			AND p.status != 'deleting'
	)
`;

const TARGET_LEX_GUARD = `
	NOT EXISTS (
		SELECT 1 FROM runtime_projection_cursors c
		WHERE c.sessionId = ?
			AND c.targetKind = ?
			AND c.targetId = ?
			AND NOT (
				c.runtimeOwnerVersion < ?
				OR (c.runtimeOwnerVersion = ? AND c.coordinatorSeq < ?)
			)
	)
`;

export function hasTypedRecoveryPointer(payload: ProjectionPayload): boolean {
	return (
		Number.isSafeInteger(payload.mutationGeneration) &&
		Number.isSafeInteger(payload.expectedMutationGeneration) &&
		Object.hasOwn(payload, "currentPairId") &&
		Object.hasOwn(payload, "previousPairId")
	);
}

function membershipPredicate(): string {
	return `
		EXISTS (
			SELECT 1 FROM runtime_command_memberships m
			WHERE m.assistantMessageId = ?
				AND m.sessionId = ?
				AND m.commandId = ?
				AND m.runId = ?
		)
	`;
}

export function messageTerminalUpdateSql(): string {
	return `
		UPDATE messages
		SET status = ?,
			content = CASE WHEN ? IS NOT NULL THEN ? ELSE content END
		WHERE id = ?
			AND sessionId = ?
			AND projectId = ?
			AND userId = ?
			AND status = 'pending'
			AND ${PROJECT_PRESENT}
			AND ${SESSION_ACTIVE}
			AND ${DELETION_FENCE}
			AND ${membershipPredicate()}
			AND ${TARGET_LEX_GUARD}
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
			AND ${PROJECT_PRESENT}
			AND ${SESSION_ACTIVE}
			AND ${DELETION_FENCE}
			AND ${TARGET_LEX_GUARD}
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
		AND ${SESSION_ACTIVE}
		AND ${PROJECT_PRESENT}
		AND ${DELETION_FENCE}
		AND EXISTS (
			SELECT 1 FROM session_commands sc
			WHERE sc.id = ?
				AND sc.sessionId = ?
				AND sc.userId = ?
				AND sc.projectId = ?
				AND (sc.userMessageId = ? OR (? IS NULL AND sc.userMessageId IS NULL))
				AND (sc.assistantMessageId = ? OR (? IS NULL AND sc.assistantMessageId IS NULL))
				AND (
					(sc.targetRunId IS NOT NULL AND sc.targetRunId = ?)
					OR (sc.targetRunId IS NULL AND sc.id = ?)
				)
		)
		RETURNING commandId
	`;
}

export function cursorUpdateSql(targetPredicate: string): string {
	return `
		UPDATE runtime_projection_cursors
		SET runtimeOwnerVersion = ?, coordinatorSeq = ?, updatedAt = ?
		WHERE sessionId = ? AND targetKind = ? AND targetId = ?
			AND (
				runtimeOwnerVersion < ?
				OR (runtimeOwnerVersion = ? AND coordinatorSeq < ?)
			)
			AND ${targetPredicate}
	`;
}

export function cursorInsertSql(targetPredicate: string): string {
	return `
		INSERT INTO runtime_projection_cursors (
			sessionId, targetKind, targetId, runtimeOwnerVersion, coordinatorSeq, updatedAt
		)
		SELECT ?, ?, ?, ?, ?, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM runtime_projection_cursors
			WHERE sessionId = ? AND targetKind = ? AND targetId = ?
		)
		AND ${targetPredicate}
	`;
}

function messageAppliedPredicate(): string {
	return `
		EXISTS (
			SELECT 1 FROM messages
			WHERE id = ?
				AND sessionId = ?
				AND projectId = ?
				AND userId = ?
				AND status = ?
		)
		AND ${membershipPredicate()}
		AND ${PROJECT_PRESENT}
		AND ${SESSION_ACTIVE}
		AND ${DELETION_FENCE}
	`;
}

function commandAppliedPredicate(): string {
	return `
		EXISTS (
			SELECT 1 FROM session_commands
			WHERE id = ?
				AND sessionId = ?
				AND projectId = ?
				AND userId = ?
				AND executionProjectionVersion = ?
		)
		AND ${PROJECT_PRESENT}
		AND ${SESSION_ACTIVE}
		AND ${DELETION_FENCE}
	`;
}

function sessionAppliedPredicate(): string {
	return `
		EXISTS (
			SELECT 1 FROM runtime_checkpoint_pointers p
			WHERE p.sessionId = ?
				AND p.mutationGeneration = ?
				AND p.runtimeOwnerVersion = ?
				AND (
					(p.currentPairId = ?)
					OR (p.currentPairId IS NULL AND ? IS NULL)
				)
				AND (
					(p.previousPairId = ?)
					OR (p.previousPairId IS NULL AND ? IS NULL)
				)
		)
		AND ${PROJECT_PRESENT}
		AND ${SESSION_ACTIVE}
		AND ${DELETION_FENCE}
	`;
}

export function sessionUpdateSql(): string {
	return `
		UPDATE runtime_checkpoint_pointers
		SET currentPairId = ?,
			previousPairId = ?,
			mutationGeneration = ?,
			runtimeOwnerVersion = ?,
			updatedAt = ?
		WHERE sessionId = ?
			AND runtimeOwnerVersion = ?
			AND mutationGeneration = ?
			AND ${PROJECT_PRESENT}
			AND ${SESSION_ACTIVE}
			AND ${DELETION_FENCE}
			AND ${TARGET_LEX_GUARD}
		RETURNING sessionId
	`;
}

type StatementSpan = {
	payload: ProjectionPayload;
	targetIndex: number;
};

function projectParams(payload: ProjectionPayload): unknown[] {
	return [payload.projectId, payload.userId];
}

function sessionParams(payload: ProjectionPayload): unknown[] {
	return [
		payload.workspaceSessionId,
		payload.projectId,
		payload.userId,
		payload.ownerVersion,
	];
}

function fenceParams(payload: ProjectionPayload): unknown[] {
	return [payload.workspaceSessionId, payload.projectId];
}

function lexParams(payload: ProjectionPayload): unknown[] {
	return [
		payload.workspaceSessionId,
		payload.targetKind,
		payload.targetId,
		payload.ownerVersion,
		payload.ownerVersion,
		payload.coordinatorSeq,
	];
}

function membershipParams(payload: ProjectionPayload): unknown[] {
	return [
		payload.targetId,
		payload.workspaceSessionId,
		payload.commandId,
		payload.runId,
	];
}

function pushCursorStatements(
	statements: D1PreparedStatement[],
	prepare: D1Like["prepare"],
	payload: ProjectionPayload,
	now: number,
	predicate: string,
	predicateParams: unknown[],
): void {
	statements.push(
		prepare(cursorUpdateSql(predicate)).bind(
			payload.ownerVersion,
			payload.coordinatorSeq,
			now,
			payload.workspaceSessionId,
			payload.targetKind,
			payload.targetId,
			payload.ownerVersion,
			payload.ownerVersion,
			payload.coordinatorSeq,
			...predicateParams,
		),
	);
	statements.push(
		prepare(cursorInsertSql(predicate)).bind(
			payload.workspaceSessionId,
			payload.targetKind,
			payload.targetId,
			payload.ownerVersion,
			payload.coordinatorSeq,
			now,
			payload.workspaceSessionId,
			payload.targetKind,
			payload.targetId,
			...predicateParams,
		),
	);
}

function statementsForPayload(
	prepare: D1Like["prepare"],
	payload: ProjectionPayload,
	now: number,
): { statements: D1PreparedStatement[]; targetIndex: number } {
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
				payload.projectId,
				payload.userId,
				payload.ownerVersion,
				payload.projectId,
				payload.userId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.commandId,
				payload.workspaceSessionId,
				payload.userId,
				payload.projectId,
				payload.userMessageId ?? null,
				payload.userMessageId ?? null,
				payload.assistantMessageId ?? null,
				payload.assistantMessageId ?? null,
				payload.runId,
				payload.runId,
			),
		);
		return { statements, targetIndex: 0 };
	}
	if (payload.targetKind === "message") {
		statements.push(
			prepare(messageTerminalUpdateSql()).bind(
				payload.status,
				payload.contentRedacted ?? null,
				payload.contentRedacted ?? null,
				payload.targetId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.userId,
				...projectParams(payload),
				...sessionParams(payload),
				...fenceParams(payload),
				...membershipParams(payload),
				...lexParams(payload),
			),
		);
		pushCursorStatements(
			statements,
			prepare,
			payload,
			now,
			messageAppliedPredicate(),
			[
				payload.targetId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.userId,
				payload.status,
				...membershipParams(payload),
				...projectParams(payload),
				...sessionParams(payload),
				...fenceParams(payload),
			],
		);
		return { statements, targetIndex: 0 };
	}
	if (payload.targetKind === "command") {
		const expectedSource = Number(payload.expectedSourceStatus ?? 0);
		statements.push(
			prepare(commandUpdateSql()).bind(
				payload.coordinatorSeq,
				payload.reasonCode ?? null,
				payload.targetId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.userId,
				expectedSource,
				...projectParams(payload),
				...sessionParams(payload),
				...fenceParams(payload),
				...lexParams(payload),
			),
		);
		pushCursorStatements(
			statements,
			prepare,
			payload,
			now,
			commandAppliedPredicate(),
			[
				payload.targetId,
				payload.workspaceSessionId,
				payload.projectId,
				payload.userId,
				payload.coordinatorSeq,
				...projectParams(payload),
				...sessionParams(payload),
				...fenceParams(payload),
			],
		);
		return { statements, targetIndex: 0 };
	}
	if (payload.targetKind === "session") {
		if (!hasTypedRecoveryPointer(payload)) {
			statements.push(prepare("SELECT 1 WHERE 0"));
			return { statements, targetIndex: 0 };
		}
		statements.push(
			prepare(sessionUpdateSql()).bind(
				payload.currentPairId ?? null,
				payload.previousPairId ?? null,
				payload.mutationGeneration,
				payload.ownerVersion,
				now,
				payload.targetId,
				payload.ownerVersion,
				payload.expectedMutationGeneration,
				...projectParams(payload),
				...sessionParams(payload),
				...fenceParams(payload),
				...lexParams(payload),
			),
		);
		pushCursorStatements(
			statements,
			prepare,
			payload,
			now,
			sessionAppliedPredicate(),
			[
				payload.targetId,
				payload.mutationGeneration,
				payload.ownerVersion,
				payload.currentPairId ?? null,
				payload.currentPairId ?? null,
				payload.previousPairId ?? null,
				payload.previousPairId ?? null,
				...projectParams(payload),
				...sessionParams(payload),
				...fenceParams(payload),
			],
		);
		return { statements, targetIndex: 0 };
	}
	return { statements, targetIndex: -1 };
}

async function sessionOwnerVersion(
	d1: D1Like,
	sessionId: string,
): Promise<number | null> {
	const row = await d1
		.prepare("SELECT runtimeOwnerVersion FROM workspace_sessions WHERE id = ?")
		.bind(sessionId)
		.first();
	if (!row) return null;
	return Number(row.runtimeOwnerVersion);
}

export async function classifyZeroRowProjection(
	d1: D1Like,
	payload: ProjectionPayload,
): Promise<ProjectionClassification> {
	const ownerAt = async (): Promise<number | null> =>
		sessionOwnerVersion(d1, payload.workspaceSessionId);
	const started = await ownerAt();
	if (started == null) return "deleted";

	const recheck = async (): Promise<ProjectionClassification | null> => {
		const current = await ownerAt();
		if (current == null) return "deleted";
		if (current !== started) return "retry";
		if (current > payload.ownerVersion) return "stale_owner";
		return null;
	};

	const fence = await d1
		.prepare(
			`SELECT targetKind FROM runtime_deleted_target_fences
			 WHERE (targetKind = 'workspace_session' AND targetId = ?)
			    OR (targetKind = 'project' AND targetId = ?)`,
		)
		.bind(payload.workspaceSessionId, payload.projectId)
		.first();
	const afterFence = await recheck();
	if (afterFence) return afterFence;
	if (fence) return "deleted";

	const session = await d1
		.prepare(
			`SELECT runtimeOwner, runtimeOwnerVersion, status, userId, projectId
			 FROM workspace_sessions WHERE id = ?`,
		)
		.bind(payload.workspaceSessionId)
		.first();
	const afterSession = await recheck();
	if (afterSession) return afterSession;
	if (!session) return "deleted";
	if (
		session.runtimeOwner !== "trusted_v1" ||
		session.userId !== payload.userId ||
		session.projectId !== payload.projectId
	) {
		return "blocked_membership";
	}

	const cursor = await d1
		.prepare(
			`SELECT runtimeOwnerVersion, coordinatorSeq FROM runtime_projection_cursors
			 WHERE sessionId = ? AND targetKind = ? AND targetId = ?`,
		)
		.bind(payload.workspaceSessionId, payload.targetKind, payload.targetId)
		.first();
	const afterCursor = await recheck();
	if (afterCursor) return afterCursor;
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

	if (payload.targetKind === "message") {
		const message = await d1
			.prepare(
				`SELECT id, status, sessionId, userId, projectId FROM messages WHERE id = ?`,
			)
			.bind(payload.targetId)
			.first();
		const afterMessage = await recheck();
		if (afterMessage) return afterMessage;
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
		const afterMembership = await recheck();
		if (afterMembership) return afterMembership;
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
		const afterCommand = await recheck();
		if (afterCommand) return afterCommand;
		if (!command) return "deleted";
		if (
			command.sessionId !== payload.workspaceSessionId ||
			command.userId !== payload.userId ||
			command.projectId !== payload.projectId
		) {
			return "blocked_membership";
		}
		if (
			Number(command.executionProjectionVersion) !==
			Number(payload.expectedSourceStatus ?? 0)
		) {
			return "blocked_membership";
		}
	}

	if (payload.targetKind === "membership") {
		const command = await d1
			.prepare(
				`SELECT id, sessionId, userId, projectId, userMessageId, assistantMessageId, targetRunId, kind
				 FROM session_commands WHERE id = ?`,
			)
			.bind(payload.commandId ?? payload.targetId)
			.first();
		const afterCommand = await recheck();
		if (afterCommand) return afterCommand;
		if (!command) return "blocked_membership";
		const runMatches =
			command.targetRunId != null
				? command.targetRunId === payload.runId
				: command.id === payload.runId;
		if (
			command.sessionId !== payload.workspaceSessionId ||
			command.userId !== payload.userId ||
			command.projectId !== payload.projectId ||
			!runMatches ||
			(payload.assistantMessageId != null &&
				command.assistantMessageId !== payload.assistantMessageId) ||
			(payload.userMessageId != null &&
				command.userMessageId !== payload.userMessageId)
		) {
			return "blocked_membership";
		}
		const existing = await d1
			.prepare(
				"SELECT commandId FROM runtime_command_memberships WHERE commandId = ?",
			)
			.bind(payload.commandId ?? payload.targetId)
			.first();
		if (existing) return "already_applied";
		return "blocked_membership";
	}

	if (payload.targetKind === "session") {
		if (!hasTypedRecoveryPointer(payload)) return "blocked_membership";
		const row = await d1
			.prepare(
				`SELECT sessionId, runtimeOwnerVersion, mutationGeneration, currentPairId, previousPairId
				 FROM runtime_checkpoint_pointers WHERE sessionId = ?`,
			)
			.bind(payload.targetId)
			.first();
		const afterTarget = await recheck();
		if (afterTarget) return afterTarget;
		if (!row) return "blocked_membership";
		if (
			Number(row.mutationGeneration) !==
				Number(payload.expectedMutationGeneration) ||
			Number(row.runtimeOwnerVersion) !== payload.ownerVersion
		) {
			return "blocked_membership";
		}
	}

	return "blocked_membership";
}

function targetMatched(result: D1Result<unknown> | undefined): boolean {
	const changes = Number(result?.meta?.changes ?? 0);
	const returned = Array.isArray(result?.results) ? result.results.length : 0;
	return changes > 0 || returned > 0;
}

export async function applyProductProjectionBatch(
	d1: D1Like,
	payloads: ProjectionPayload[],
	now: number,
): Promise<ProjectionApplyResult[]> {
	if (payloads.length === 0) return [];
	const statements: D1PreparedStatement[] = [];
	const spans: StatementSpan[] = [];
	for (const payload of payloads) {
		const prepared = statementsForPayload(d1.prepare.bind(d1), payload, now);
		spans.push({
			payload,
			targetIndex:
				prepared.targetIndex < 0
					? -1
					: statements.length + prepared.targetIndex,
		});
		statements.push(...prepared.statements);
	}
	let batchResult: D1Result<unknown>[];
	try {
		batchResult = (await d1.batch(statements)) as D1Result<unknown>[];
	} catch {
		return payloads.map(() => ({
			classification: "retry" as const,
			retry: true,
		}));
	}
	const results: ProjectionApplyResult[] = [];
	for (const span of spans) {
		if (span.targetIndex < 0) {
			results.push({ classification: "already_applied", retry: false });
			continue;
		}
		const ownerBefore = await sessionOwnerVersion(
			d1,
			span.payload.workspaceSessionId,
		);
		if (targetMatched(batchResult[span.targetIndex])) {
			results.push({ classification: "applied", retry: false });
			continue;
		}
		const ownerAfter = await sessionOwnerVersion(
			d1,
			span.payload.workspaceSessionId,
		);
		if (ownerBefore !== ownerAfter) {
			results.push({ classification: "retry", retry: true });
			continue;
		}
		const classification = await classifyZeroRowProjection(d1, span.payload);
		results.push({
			classification,
			retry: classification === "retry",
		});
	}
	return results;
}
