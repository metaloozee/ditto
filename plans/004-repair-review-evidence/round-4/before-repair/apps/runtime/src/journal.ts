export type SqlValue = string | number | bigint | null;

export type CoordinatorSql = {
	query<T extends Record<string, SqlValue> = Record<string, SqlValue>>(
		sql: string,
		...params: SqlValue[]
	): T[];
	transaction<T>(fn: () => T): T;
};

export const JOURNAL_SCHEMA_VERSION = 1;
export const RECOVERY_DEADLINE_MS = 15 * 60 * 1000;
export const RECONCILE_MAX_INTENTS = 25;
export const RECONCILE_MAX_MS = 5_000;
export const WORK_RETRY_MS = 1_000;

export type CommandConsumptionState =
	| "accepted"
	| "consumed"
	| "canceled"
	| "denied";

export type RunState =
	| "queued"
	| "starting"
	| "running"
	| "recovering"
	| "stopping"
	| "complete"
	| "failed"
	| "canceled";

export type EffectState =
	| "prepared"
	| "admitted"
	| "result_recorded"
	| "outcome_unknown";

export type ProjectionState = "pending" | "applied" | "blocked";

export type WakeupState = "pending" | "scheduled" | "processed";

const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS journal_meta (
		key TEXT PRIMARY KEY NOT NULL,
		value TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS commands (
		command_id TEXT PRIMARY KEY NOT NULL,
		command_seq INTEGER NOT NULL,
		kind TEXT NOT NULL,
		owner_version INTEGER NOT NULL,
		receipt_id TEXT NOT NULL,
		payload_hash TEXT NOT NULL,
		user_message_id TEXT,
		assistant_message_id TEXT,
		target_run_id TEXT,
		target_command_id TEXT,
		accepted_at INTEGER NOT NULL,
		deadline_at INTEGER NOT NULL,
		consumption_state TEXT NOT NULL,
		stop_barrier INTEGER NOT NULL DEFAULT 0,
		ciphertext TEXT,
		ciphertext_ref TEXT
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS commands_seq_uidx ON commands (command_seq)`,
	`CREATE TABLE IF NOT EXISTS runs (
		run_id TEXT PRIMARY KEY NOT NULL,
		origin_command_id TEXT NOT NULL,
		state TEXT NOT NULL,
		epoch INTEGER NOT NULL,
		owner_version INTEGER NOT NULL,
		first_interruption_at INTEGER,
		recovery_deadline_at INTEGER,
		brain_incarnation TEXT,
		executor_incarnation TEXT,
		blocked_review_reason TEXT,
		assistant_message_id TEXT,
		user_message_id TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS effects (
		run_id TEXT NOT NULL,
		assistant_entry_id TEXT NOT NULL,
		tool_call_id TEXT NOT NULL,
		attempt INTEGER NOT NULL,
		state TEXT NOT NULL,
		args_ciphertext TEXT,
		result_ciphertext TEXT,
		result_ref TEXT,
		result_digest TEXT,
		expected_incarnation TEXT NOT NULL,
		epoch INTEGER NOT NULL,
		deadline INTEGER NOT NULL,
		outcome_policy TEXT NOT NULL,
		lifecycle_generation INTEGER NOT NULL,
		PRIMARY KEY (run_id, assistant_entry_id, tool_call_id, attempt)
	)`,
	`CREATE TABLE IF NOT EXISTS continuations (
		id TEXT PRIMARY KEY NOT NULL,
		position INTEGER NOT NULL,
		ciphertext TEXT,
		ciphertext_ref TEXT,
		format_version INTEGER NOT NULL,
		committed_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS events (
		sequence INTEGER PRIMARY KEY NOT NULL,
		kind TEXT NOT NULL,
		payload_redacted TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS projections (
		workspace_session_id TEXT NOT NULL,
		target_kind TEXT NOT NULL,
		target_id TEXT NOT NULL,
		owner_version INTEGER NOT NULL,
		coordinator_seq INTEGER NOT NULL,
		payload_redacted TEXT NOT NULL,
		state TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		last_error_class TEXT,
		PRIMARY KEY (
			workspace_session_id,
			target_kind,
			target_id,
			owner_version,
			coordinator_seq
		)
	)`,
	`CREATE TABLE IF NOT EXISTS wakeups (
		id TEXT PRIMARY KEY NOT NULL,
		reason TEXT NOT NULL,
		deadline_at INTEGER NOT NULL,
		attempt INTEGER NOT NULL DEFAULT 0,
		state TEXT NOT NULL,
		payload TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS process_observations (
		observation_id TEXT PRIMARY KEY NOT NULL,
		source TEXT NOT NULL,
		identity TEXT NOT NULL,
		class TEXT NOT NULL,
		incarnation TEXT NOT NULL,
		lifecycle_generation INTEGER NOT NULL,
		observed_run_epoch INTEGER,
		observed_at INTEGER NOT NULL,
		termination_result TEXT,
		replacement_identity TEXT,
		isolation_evidence_ref TEXT,
		unresolved_effects_ref TEXT,
		capacity_evidence_ref TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS large_record_manifests (
		record_id TEXT PRIMARY KEY NOT NULL,
		write_id TEXT NOT NULL,
		chunk_count INTEGER NOT NULL,
		total_length INTEGER NOT NULL,
		digest TEXT NOT NULL,
		format_version INTEGER NOT NULL,
		manifest_ciphertext TEXT NOT NULL,
		committed INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS large_record_chunks (
		record_id TEXT NOT NULL,
		ordinal INTEGER NOT NULL,
		ciphertext TEXT NOT NULL,
		byte_length INTEGER NOT NULL,
		PRIMARY KEY (record_id, ordinal)
	)`,
] as const;

function one<T extends Record<string, SqlValue>>(rows: T[]): T | undefined {
	return rows[0];
}

export function initializeJournalTables(sql: CoordinatorSql): void {
	for (const statement of SCHEMA_STATEMENTS) {
		sql.query(statement);
	}
}

export function initializeJournalSchema(
	sql: CoordinatorSql,
	identity: { ownerId: string; workspaceSessionId: string },
	now: number,
): void {
	sql.transaction(() => {
		initializeJournalTables(sql);
		const version = one(
			sql.query<{ value: string }>(
				"SELECT value FROM journal_meta WHERE key = ?",
				"schema_version",
			),
		);
		if (!version) {
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"schema_version",
				String(JOURNAL_SCHEMA_VERSION),
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"owner_id",
				identity.ownerId,
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"workspace_session_id",
				identity.workspaceSessionId,
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"fatal_latch",
				"0",
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"consumed_ordinary_seq",
				"0",
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"current_epoch",
				"1",
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"continuation_position",
				"0",
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"next_coordinator_seq",
				"1",
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"next_event_seq",
				"1",
			);
			sql.query(
				"INSERT INTO journal_meta (key, value) VALUES (?, ?)",
				"initialized_at",
				String(now),
			);
		} else if (version.value !== String(JOURNAL_SCHEMA_VERSION)) {
			throw new Error("journal_schema_incompatible");
		}
		const storedOwner = metaValue(sql, "owner_id");
		const storedSession = metaValue(sql, "workspace_session_id");
		if (
			storedOwner !== identity.ownerId ||
			storedSession !== identity.workspaceSessionId
		) {
			throw new Error("journal_identity_mismatch");
		}
	});
}

export function recordConstructorObservation(
	sql: CoordinatorSql,
	observation: {
		observationId: string;
		source: string;
		identity: string;
		className: string;
		incarnation: string;
		lifecycleGeneration: number;
		observedAt: number;
	},
): void {
	sql.query(
		`INSERT OR IGNORE INTO process_observations (
			observation_id, source, identity, class, incarnation, lifecycle_generation,
			observed_run_epoch, observed_at, termination_result, replacement_identity,
			isolation_evidence_ref, unresolved_effects_ref, capacity_evidence_ref
		) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL)`,
		observation.observationId,
		observation.source,
		observation.identity,
		observation.className,
		observation.incarnation,
		observation.lifecycleGeneration,
		observation.observedAt,
	);
}

export function metaValue(
	sql: CoordinatorSql,
	key: string,
): string | undefined {
	return one(
		sql.query<{ value: string }>(
			"SELECT value FROM journal_meta WHERE key = ?",
			key,
		),
	)?.value;
}

export function setMeta(sql: CoordinatorSql, key: string, value: string): void {
	sql.query(
		`INSERT INTO journal_meta (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key,
		value,
	);
}

export function isFatalLatched(sql: CoordinatorSql): boolean {
	return metaValue(sql, "fatal_latch") === "1";
}

export function latchFatal(sql: CoordinatorSql): void {
	setMeta(sql, "fatal_latch", "1");
}

export function currentEpoch(sql: CoordinatorSql): number {
	return Number(metaValue(sql, "current_epoch") ?? "1");
}

export function consumedOrdinarySeq(sql: CoordinatorSql): number {
	return Number(metaValue(sql, "consumed_ordinary_seq") ?? "0");
}

export function continuationPosition(sql: CoordinatorSql): number {
	return Number(metaValue(sql, "continuation_position") ?? "0");
}

export function nextCoordinatorSeq(sql: CoordinatorSql): number {
	const value = Number(metaValue(sql, "next_coordinator_seq") ?? "1");
	setMeta(sql, "next_coordinator_seq", String(value + 1));
	return value;
}

export function nextEventSeq(sql: CoordinatorSql): number {
	const value = Number(metaValue(sql, "next_event_seq") ?? "1");
	setMeta(sql, "next_event_seq", String(value + 1));
	return value;
}

export type CommandRow = {
	command_id: string;
	command_seq: number;
	kind: string;
	owner_version: number;
	receipt_id: string;
	payload_hash: string;
	user_message_id: string | null;
	assistant_message_id: string | null;
	target_run_id: string | null;
	target_command_id: string | null;
	accepted_at: number;
	deadline_at: number;
	consumption_state: string;
	stop_barrier: number;
	ciphertext: string | null;
	ciphertext_ref: string | null;
};

export function getCommand(
	sql: CoordinatorSql,
	commandId: string,
): CommandRow | undefined {
	return one(
		sql.query<CommandRow>(
			"SELECT * FROM commands WHERE command_id = ?",
			commandId,
		),
	);
}

export function getCommandBySeq(
	sql: CoordinatorSql,
	seq: number,
): CommandRow | undefined {
	return one(
		sql.query<CommandRow>("SELECT * FROM commands WHERE command_seq = ?", seq),
	);
}

export function insertCommand(
	sql: CoordinatorSql,
	row: CommandRow,
): CommandRow {
	sql.query(
		`INSERT INTO commands (
			command_id, command_seq, kind, owner_version, receipt_id, payload_hash,
			user_message_id, assistant_message_id, target_run_id, target_command_id,
			accepted_at, deadline_at, consumption_state, stop_barrier, ciphertext,
			ciphertext_ref
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.command_id,
		row.command_seq,
		row.kind,
		row.owner_version,
		row.receipt_id,
		row.payload_hash,
		row.user_message_id,
		row.assistant_message_id,
		row.target_run_id,
		row.target_command_id,
		row.accepted_at,
		row.deadline_at,
		row.consumption_state,
		row.stop_barrier,
		row.ciphertext,
		row.ciphertext_ref,
	);
	return row;
}

export function setCommandConsumption(
	sql: CoordinatorSql,
	commandId: string,
	state: CommandConsumptionState,
): void {
	sql.query(
		"UPDATE commands SET consumption_state = ? WHERE command_id = ?",
		state,
		commandId,
	);
}

export type RunRow = {
	run_id: string;
	origin_command_id: string;
	state: string;
	epoch: number;
	owner_version: number;
	first_interruption_at: number | null;
	recovery_deadline_at: number | null;
	brain_incarnation: string | null;
	executor_incarnation: string | null;
	blocked_review_reason: string | null;
	assistant_message_id: string | null;
	user_message_id: string | null;
	created_at: number;
	updated_at: number;
};

export function getRun(sql: CoordinatorSql, runId: string): RunRow | undefined {
	return one(sql.query<RunRow>("SELECT * FROM runs WHERE run_id = ?", runId));
}

export function listRuns(sql: CoordinatorSql): RunRow[] {
	return sql.query<RunRow>("SELECT * FROM runs ORDER BY created_at ASC");
}

export function insertRun(sql: CoordinatorSql, row: RunRow): void {
	sql.query(
		`INSERT INTO runs (
			run_id, origin_command_id, state, epoch, owner_version,
			first_interruption_at, recovery_deadline_at, brain_incarnation,
			executor_incarnation, blocked_review_reason, assistant_message_id,
			user_message_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.run_id,
		row.origin_command_id,
		row.state,
		row.epoch,
		row.owner_version,
		row.first_interruption_at,
		row.recovery_deadline_at,
		row.brain_incarnation,
		row.executor_incarnation,
		row.blocked_review_reason,
		row.assistant_message_id,
		row.user_message_id,
		row.created_at,
		row.updated_at,
	);
}

export function updateRunState(
	sql: CoordinatorSql,
	runId: string,
	patch: {
		state: RunState;
		updatedAt: number;
		blockedReviewReason?: string | null;
		firstInterruptionAt?: number | null;
		recoveryDeadlineAt?: number | null;
		epoch?: number;
	},
): void {
	sql.query(
		`UPDATE runs SET
			state = ?,
			updated_at = ?,
			blocked_review_reason = COALESCE(?, blocked_review_reason),
			first_interruption_at = COALESCE(?, first_interruption_at),
			recovery_deadline_at = COALESCE(?, recovery_deadline_at),
			epoch = COALESCE(?, epoch)
		 WHERE run_id = ?`,
		patch.state,
		patch.updatedAt,
		patch.blockedReviewReason ?? null,
		patch.firstInterruptionAt ?? null,
		patch.recoveryDeadlineAt ?? null,
		patch.epoch ?? null,
		runId,
	);
}

export function markFirstInterruption(
	sql: CoordinatorSql,
	runId: string,
	now: number,
): { firstInterruptionAt: number; recoveryDeadlineAt: number } {
	const run = getRun(sql, runId);
	if (!run) throw new Error("run_missing");
	if (run.first_interruption_at != null && run.recovery_deadline_at != null) {
		return {
			firstInterruptionAt: Number(run.first_interruption_at),
			recoveryDeadlineAt: Number(run.recovery_deadline_at),
		};
	}
	const firstInterruptionAt = now;
	const recoveryDeadlineAt = now + RECOVERY_DEADLINE_MS;
	sql.query(
		`UPDATE runs SET
			first_interruption_at = ?,
			recovery_deadline_at = ?,
			state = CASE WHEN state IN ('complete','failed','canceled') THEN state ELSE 'recovering' END,
			updated_at = ?
		 WHERE run_id = ? AND first_interruption_at IS NULL`,
		firstInterruptionAt,
		recoveryDeadlineAt,
		now,
		runId,
	);
	return { firstInterruptionAt, recoveryDeadlineAt };
}

export type EffectRow = {
	run_id: string;
	assistant_entry_id: string;
	tool_call_id: string;
	attempt: number;
	state: string;
	args_ciphertext: string | null;
	result_ciphertext: string | null;
	result_ref: string | null;
	result_digest: string | null;
	expected_incarnation: string;
	epoch: number;
	deadline: number;
	outcome_policy: string;
	lifecycle_generation: number;
};

export function getEffect(
	sql: CoordinatorSql,
	key: {
		runId: string;
		assistantEntryId: string;
		toolCallId: string;
		attempt: number;
	},
): EffectRow | undefined {
	return one(
		sql.query<EffectRow>(
			`SELECT * FROM effects
			 WHERE run_id = ? AND assistant_entry_id = ? AND tool_call_id = ? AND attempt = ?`,
			key.runId,
			key.assistantEntryId,
			key.toolCallId,
			key.attempt,
		),
	);
}

export function listEffectsForLogical(
	sql: CoordinatorSql,
	key: { runId: string; assistantEntryId: string; toolCallId: string },
): EffectRow[] {
	return sql.query<EffectRow>(
		`SELECT * FROM effects
		 WHERE run_id = ? AND assistant_entry_id = ? AND tool_call_id = ?
		 ORDER BY attempt ASC`,
		key.runId,
		key.assistantEntryId,
		key.toolCallId,
	);
}

export function listEffectsByRun(
	sql: CoordinatorSql,
	runId: string,
): EffectRow[] {
	return sql.query<EffectRow>(
		"SELECT * FROM effects WHERE run_id = ? ORDER BY attempt ASC",
		runId,
	);
}

export function listActiveEffects(sql: CoordinatorSql): EffectRow[] {
	return sql.query<EffectRow>(
		`SELECT * FROM effects WHERE state IN ('prepared', 'admitted', 'outcome_unknown')`,
	);
}

export function listUnresolvedWriters(sql: CoordinatorSql): EffectRow[] {
	return sql.query<EffectRow>(
		`SELECT * FROM effects
		 WHERE state IN ('prepared', 'admitted', 'outcome_unknown')`,
	);
}

export function hasUnresolvedWriter(sql: CoordinatorSql): boolean {
	return listUnresolvedWriters(sql).length > 0;
}

export function isolationEvidencePresent(
	sql: CoordinatorSql,
	match?: {
		identity: string;
		incarnation: string;
		lifecycleGeneration: number;
		epoch: number;
		replacementIdentity?: string;
	},
): boolean {
	if (!match) return false;
	return (
		(sql.query<{ n: number }>(
			`SELECT count(*) AS n FROM process_observations
			 WHERE isolation_evidence_ref IS NOT NULL AND isolation_evidence_ref != ''
			   AND identity = ?
			   AND incarnation = ?
			   AND lifecycle_generation = ?
			   AND observed_run_epoch = ?
			   AND (? IS NULL OR replacement_identity = ?)`,
			match.identity,
			match.incarnation,
			match.lifecycleGeneration,
			match.epoch,
			match.replacementIdentity ?? null,
			match.replacementIdentity ?? null,
		)[0]?.n ?? 0) > 0
	);
}

export function listPendingGapWakeups(sql: CoordinatorSql): {
	id: string;
	deadline_at: number;
}[] {
	return sql.query(
		`SELECT id, deadline_at FROM wakeups
		 WHERE reason = 'gap' AND state IN ('pending', 'scheduled')
		 ORDER BY deadline_at ASC`,
	);
}

export function nextWorkDeadline(
	sql: CoordinatorSql,
	now: number,
): number | null {
	const candidates: number[] = [];
	const wakeup = one(
		sql.query<{ deadline_at: number }>(
			`SELECT MIN(deadline_at) AS deadline_at FROM wakeups
			 WHERE state IN ('pending', 'scheduled')`,
		),
	);
	if (wakeup?.deadline_at != null) candidates.push(Number(wakeup.deadline_at));
	const recovery = one(
		sql.query<{ deadline_at: number }>(
			`SELECT MIN(recovery_deadline_at) AS deadline_at FROM runs
			 WHERE recovery_deadline_at IS NOT NULL
			   AND state NOT IN ('complete', 'failed', 'canceled')`,
		),
	);
	if (recovery?.deadline_at != null)
		candidates.push(Number(recovery.deadline_at));
	const effect = one(
		sql.query<{ deadline_at: number }>(
			`SELECT MIN(deadline) AS deadline_at FROM effects
			 WHERE state IN ('prepared', 'admitted')`,
		),
	);
	if (effect?.deadline_at != null) candidates.push(Number(effect.deadline_at));
	if (pendingProjectionCount(sql) > 0) {
		candidates.push(now + WORK_RETRY_MS);
	}
	return candidates.length === 0 ? null : Math.min(...candidates);
}

function futureWakeupExists(
	sql: CoordinatorSql,
	reason: string,
	now: number,
): boolean {
	return (
		Number(
			one(
				sql.query<{ n: number }>(
					`SELECT count(*) AS n FROM wakeups
					 WHERE reason = ? AND state IN ('pending', 'scheduled') AND deadline_at > ?`,
					reason,
					now,
				),
			)?.n ?? 0,
		) > 0
	);
}

export function persistFutureCoordinatorWork(
	sql: CoordinatorSql,
	now: number,
): void {
	const expected = consumedOrdinarySeq(sql) + 1;
	const predecessorMissing = getCommandBySeq(sql, expected) == null;
	const laterExists =
		Number(
			one(
				sql.query<{ n: number }>(
					"SELECT count(*) AS n FROM commands WHERE command_seq > ?",
					expected,
				),
			)?.n ?? 0,
		) > 0;
	if (
		predecessorMissing &&
		laterExists &&
		!futureWakeupExists(sql, "gap", now)
	) {
		sql.query(
			`INSERT OR IGNORE INTO wakeups (id, reason, deadline_at, attempt, state, payload)
			 VALUES (?, ?, ?, 0, 'pending', ?)`,
			`gap:${expected}:${now}`,
			"gap",
			now + WORK_RETRY_MS,
			JSON.stringify({ reason: "gap" }),
		);
	}
	if (
		pendingProjectionCount(sql) > 0 &&
		!futureWakeupExists(sql, "projection_retry", now)
	) {
		sql.query(
			`INSERT OR IGNORE INTO wakeups (id, reason, deadline_at, attempt, state, payload)
			 VALUES (?, ?, ?, 0, 'pending', ?)`,
			`projection-retry:${now}`,
			"projection_retry",
			now + WORK_RETRY_MS,
			JSON.stringify({ reason: "projection_retry" }),
		);
	}
}

export function insertEffect(sql: CoordinatorSql, row: EffectRow): void {
	sql.query(
		`INSERT INTO effects (
			run_id, assistant_entry_id, tool_call_id, attempt, state, args_ciphertext,
			result_ciphertext, result_ref, result_digest, expected_incarnation, epoch,
			deadline, outcome_policy, lifecycle_generation
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.run_id,
		row.assistant_entry_id,
		row.tool_call_id,
		row.attempt,
		row.state,
		row.args_ciphertext,
		row.result_ciphertext,
		row.result_ref,
		row.result_digest,
		row.expected_incarnation,
		row.epoch,
		row.deadline,
		row.outcome_policy,
		row.lifecycle_generation,
	);
}

export function updateEffectState(
	sql: CoordinatorSql,
	key: {
		runId: string;
		assistantEntryId: string;
		toolCallId: string;
		attempt: number;
	},
	patch: {
		state: EffectState;
		resultCiphertext?: string | null;
		resultRef?: string | null;
		resultDigest?: string | null;
	},
): void {
	sql.query(
		`UPDATE effects SET
			state = ?,
			result_ciphertext = COALESCE(?, result_ciphertext),
			result_ref = COALESCE(?, result_ref),
			result_digest = COALESCE(?, result_digest)
		 WHERE run_id = ? AND assistant_entry_id = ? AND tool_call_id = ? AND attempt = ?`,
		patch.state,
		patch.resultCiphertext ?? null,
		patch.resultRef ?? null,
		patch.resultDigest ?? null,
		key.runId,
		key.assistantEntryId,
		key.toolCallId,
		key.attempt,
	);
}

export type ProjectionRow = {
	workspace_session_id: string;
	target_kind: string;
	target_id: string;
	owner_version: number;
	coordinator_seq: number;
	payload_redacted: string;
	state: string;
	attempts: number;
	last_error_class: string | null;
};

export function insertProjection(
	sql: CoordinatorSql,
	row: Omit<ProjectionRow, "attempts" | "last_error_class"> & {
		attempts?: number;
		last_error_class?: string | null;
	},
): void {
	sql.query(
		`INSERT INTO projections (
			workspace_session_id, target_kind, target_id, owner_version,
			coordinator_seq, payload_redacted, state, attempts, last_error_class
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.workspace_session_id,
		row.target_kind,
		row.target_id,
		row.owner_version,
		row.coordinator_seq,
		row.payload_redacted,
		row.state,
		row.attempts ?? 0,
		row.last_error_class ?? null,
	);
}

export function listPendingProjections(
	sql: CoordinatorSql,
	limit: number,
): ProjectionRow[] {
	return sql.query<ProjectionRow>(
		`SELECT * FROM projections
		 WHERE state = 'pending'
		 ORDER BY owner_version ASC, coordinator_seq ASC
		 LIMIT ?`,
		limit,
	);
}

export function markProjection(
	sql: CoordinatorSql,
	row: ProjectionRow,
	state: ProjectionState,
	errorClass?: string | null,
): void {
	sql.query(
		`UPDATE projections
		 SET state = ?, attempts = attempts + 1, last_error_class = ?
		 WHERE target_kind = ? AND target_id = ? AND coordinator_seq = ?`,
		state,
		errorClass ?? null,
		row.target_kind,
		row.target_id,
		row.coordinator_seq,
	);
}

export function pendingProjectionCount(sql: CoordinatorSql): number {
	return Number(
		one(
			sql.query<{ n: number }>(
				"SELECT count(*) AS n FROM projections WHERE state = 'pending'",
			),
		)?.n ?? 0,
	);
}

export type WakeupRow = {
	id: string;
	reason: string;
	deadline_at: number;
	attempt: number;
	state: string;
	payload: string | null;
};

export function insertWakeup(sql: CoordinatorSql, row: WakeupRow): void {
	sql.query(
		`INSERT INTO wakeups (id, reason, deadline_at, attempt, state, payload)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		row.id,
		row.reason,
		row.deadline_at,
		row.attempt,
		row.state,
		row.payload,
	);
}

export function listDueWakeups(
	sql: CoordinatorSql,
	now: number,
	limit: number,
): WakeupRow[] {
	return sql.query<WakeupRow>(
		`SELECT * FROM wakeups
		 WHERE state IN ('pending', 'scheduled') AND deadline_at <= ?
		 ORDER BY deadline_at ASC
		 LIMIT ?`,
		now,
		limit,
	);
}

export function listPendingWakeups(sql: CoordinatorSql): WakeupRow[] {
	return sql.query<WakeupRow>(
		`SELECT * FROM wakeups
		 WHERE state IN ('pending', 'scheduled')
		 ORDER BY deadline_at ASC`,
	);
}

export function markWakeup(
	sql: CoordinatorSql,
	id: string,
	state: WakeupState,
	attempt?: number,
): void {
	if (attempt === undefined) {
		sql.query("UPDATE wakeups SET state = ? WHERE id = ?", state, id);
		return;
	}
	sql.query(
		"UPDATE wakeups SET state = ?, attempt = ? WHERE id = ?",
		state,
		attempt,
		id,
	);
}

export function insertEvent(
	sql: CoordinatorSql,
	event: {
		kind: string;
		payloadRedacted: string;
		createdAt: number;
	},
): number {
	const sequence = nextEventSeq(sql);
	sql.query(
		"INSERT INTO events (sequence, kind, payload_redacted, created_at) VALUES (?, ?, ?, ?)",
		sequence,
		event.kind,
		event.payloadRedacted,
		event.createdAt,
	);
	return sequence;
}

export function listEvents(sql: CoordinatorSql): {
	sequence: number;
	kind: string;
	payload_redacted: string;
	created_at: number;
}[] {
	return sql.query(
		"SELECT sequence, kind, payload_redacted, created_at FROM events ORDER BY sequence ASC",
	);
}

export function listCommands(sql: CoordinatorSql): CommandRow[] {
	return sql.query<CommandRow>(
		"SELECT * FROM commands ORDER BY command_seq ASC",
	);
}

export function commitLargeRecordChunks(
	sql: CoordinatorSql,
	manifest: {
		recordId: string;
		writeId: string;
		chunkCount: number;
		totalLength: number;
		digest: string;
		formatVersion: number;
		manifestCiphertext: string;
		chunks: { ordinal: number; ciphertext: string; byteLength: number }[];
	},
): void {
	if (manifest.chunks.length !== manifest.chunkCount) {
		throw new Error("chunk_manifest_incomplete");
	}
	if (!manifest.writeId || !manifest.manifestCiphertext) {
		throw new Error("chunk_manifest_incomplete");
	}
	sql.query(
		`INSERT INTO large_record_manifests (
			record_id, write_id, chunk_count, total_length, digest, format_version,
			manifest_ciphertext, committed
		) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
		manifest.recordId,
		manifest.writeId,
		manifest.chunkCount,
		manifest.totalLength,
		manifest.digest,
		manifest.formatVersion,
		manifest.manifestCiphertext,
	);
	for (const chunk of manifest.chunks) {
		sql.query(
			`INSERT INTO large_record_chunks (record_id, ordinal, ciphertext, byte_length)
			 VALUES (?, ?, ?, ?)`,
			manifest.recordId,
			chunk.ordinal,
			chunk.ciphertext,
			chunk.byteLength,
		);
	}
	const stored = one(
		sql.query<{ n: number }>(
			"SELECT count(*) AS n FROM large_record_chunks WHERE record_id = ?",
			manifest.recordId,
		),
	);
	if (Number(stored?.n ?? 0) !== manifest.chunkCount) {
		throw new Error("chunk_manifest_incomplete");
	}
	sql.query(
		"UPDATE large_record_manifests SET committed = 1 WHERE record_id = ?",
		manifest.recordId,
	);
}

export function readCommittedLargeRecord(
	sql: CoordinatorSql,
	recordId: string,
): {
	recordId: string;
	writeId: string;
	chunkCount: number;
	totalLength: number;
	digest: string;
	formatVersion: number;
	manifestCiphertext: string;
	chunks: { ordinal: number; ciphertext: string; byteLength: number }[];
} | null {
	const manifest = one(
		sql.query<{
			record_id: string;
			write_id: string;
			chunk_count: number;
			total_length: number;
			digest: string;
			format_version: number;
			manifest_ciphertext: string;
			committed: number;
		}>(
			`SELECT record_id, write_id, chunk_count, total_length, digest,
			        format_version, manifest_ciphertext, committed
			 FROM large_record_manifests WHERE record_id = ?`,
			recordId,
		),
	);
	if (!manifest || Number(manifest.committed) !== 1) return null;
	const chunks = sql.query<{
		ordinal: number;
		ciphertext: string;
		byte_length: number;
	}>(
		`SELECT ordinal, ciphertext, byte_length FROM large_record_chunks
		 WHERE record_id = ? ORDER BY ordinal ASC`,
		recordId,
	);
	if (chunks.length !== Number(manifest.chunk_count)) return null;
	return {
		recordId: manifest.record_id,
		writeId: manifest.write_id,
		chunkCount: Number(manifest.chunk_count),
		totalLength: Number(manifest.total_length),
		digest: manifest.digest,
		formatVersion: Number(manifest.format_version),
		manifestCiphertext: manifest.manifest_ciphertext,
		chunks: chunks.map((chunk) => ({
			ordinal: Number(chunk.ordinal),
			ciphertext: chunk.ciphertext,
			byteLength: Number(chunk.byte_length),
		})),
	};
}

export function listDueExpiredEffects(
	sql: CoordinatorSql,
	now: number,
	limit: number,
): EffectRow[] {
	return sql.query<EffectRow>(
		`SELECT * FROM effects
		 WHERE state IN ('prepared', 'admitted') AND deadline <= ?
		 ORDER BY deadline ASC
		 LIMIT ?`,
		now,
		limit,
	);
}

export function createNodeSqliteAdapter(db: {
	prepare: (sql: string) => {
		all: (...params: SqlValue[]) => unknown;
		run: (...params: SqlValue[]) => unknown;
	};
	exec: (sql: string) => unknown;
}): CoordinatorSql {
	return {
		query<T extends Record<string, SqlValue>>(
			sql: string,
			...params: SqlValue[]
		) {
			const statement = db.prepare(sql);
			const returnsRows =
				/\bRETURNING\b/i.test(sql) || /^\s*(SELECT|WITH)\b/i.test(sql);
			if (returnsRows) {
				return (statement.all(...params) as T[]) ?? [];
			}
			statement.run(...params);
			return [];
		},
		transaction<T>(fn: () => T): T {
			db.exec("BEGIN IMMEDIATE");
			try {
				const result = fn();
				db.exec("COMMIT");
				return result;
			} catch (error) {
				try {
					db.exec("ROLLBACK");
				} catch {
					// ignore rollback failure
				}
				throw error;
			}
		},
	};
}

export function createDurableObjectSqlAdapter(
	storageSql: {
		exec: (
			query: string,
			...bindings: SqlValue[]
		) => { toArray: () => unknown[] };
	},
	storage: { transactionSync: <T>(fn: () => T) => T },
): CoordinatorSql {
	return {
		query<T extends Record<string, SqlValue>>(
			sql: string,
			...params: SqlValue[]
		) {
			return storageSql.exec(sql, ...params).toArray() as T[];
		},
		transaction<T>(fn: () => T): T {
			return storage.transactionSync(fn);
		},
	};
}
