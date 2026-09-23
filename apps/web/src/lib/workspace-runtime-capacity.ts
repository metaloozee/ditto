/**
 * Internal durable work queue and running-slot accounting for WorkspaceRuntime.
 * Callers must go through workspace-runtime.ts.
 */
import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	messages,
	runtimeCapacityPolicy,
	type WORKSPACE_WORK_INTENTS,
	type WORKSPACE_WORK_STATUSES,
	workspaceCapacityLeases,
	workspaceRuntimeWork,
	workspaceSessions,
} from "#/db/schema";
import { WorkspaceRuntimeError } from "#/lib/workspace-runtime-error";

type Db = ReturnType<typeof createDb>;

export const WORKSPACE_CAPACITY_GLOBAL_LIMIT = 20;
export const WORKSPACE_CAPACITY_PER_USER_LIMIT = 2;
export const WORKSPACE_QUEUE_TTL_MS = 15 * 60 * 1000;
export const WORKSPACE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS = 10 * 60 * 1000;
export const WORKSPACE_DRAIN_CRON = "* * * * *";
export const WORKSPACE_CRON_INVOCATION_LIMIT_MS = 15 * 60 * 1000;
export const WORKSPACE_CAPACITY_LEASE_TTL_MS = 20 * 60 * 1000;
export const WORKSPACE_WORK_LEASE_TTL_MS = 12 * 60 * 1000;
export const WORKSPACE_WORK_PAYLOAD_MAX_BYTES = 8 * 1024;
export const WORKSPACE_CRON_NON_AGENT_RESERVE_MS = 2 * 60 * 1000;
export const WORKSPACE_AGENT_COMMAND_RESERVE_MS = 10 * 60 * 1000;

export type WorkspaceWorkIntentKind = (typeof WORKSPACE_WORK_INTENTS)[number];
export type WorkspaceWorkStatus = (typeof WORKSPACE_WORK_STATUSES)[number];

export type WorkspaceWorkPayload = Record<
	string,
	string | number | boolean | null
>;

export type WorkspaceWorkIntent = {
	kind: WorkspaceWorkIntentKind;
	projectId: string;
	userId: string;
	sessionId?: string | null;
	identityId?: string | null;
	userMessageId?: string | null;
	assistantMessageId?: string | null;
	payload?: WorkspaceWorkPayload | null;
};

export type WorkspaceWorkReceipt = {
	workId: string;
	status: WorkspaceWorkStatus;
	queuePosition: number | null;
	queueExpiresAt: number | null;
	sessionId: string | null;
	intent: WorkspaceWorkIntentKind;
	reasonCode: string | null;
	userMessageId: string | null;
	assistantMessageId: string | null;
};

export type WorkspaceWorkRow = typeof workspaceRuntimeWork.$inferSelect;

const legacyWorkOwner = sql`(
	${workspaceRuntimeWork.runtimeOwner} = 'legacy'
	AND ${workspaceRuntimeWork.commandId} IS NULL
	AND ${workspaceRuntimeWork.protocolVersion} IS NULL
	AND (
		${workspaceRuntimeWork.sessionId} IS NULL
		OR EXISTS (
			SELECT 1 FROM ${workspaceSessions}
			WHERE ${workspaceSessions.id} = ${workspaceRuntimeWork.sessionId}
				AND ${workspaceSessions.runtimeOwner} = 'legacy'
				AND ${workspaceSessions.runtimeOwnerVersion} = ${workspaceRuntimeWork.runtimeOwnerVersion}
		)
	)
)`;

export type WorkspaceRuntimeWaitUntil = (promise: Promise<unknown>) => void;

export type { WorkspaceRuntimeCapacityEnv } from "#/lib/runtime-policy-types";

export type WorkspaceWorkExecutor = (options: {
	db: Db;
	work: WorkspaceWorkRow;
	now: () => number;
}) => Promise<void>;

export type DrainWorkspaceRuntimeOptions = {
	db: Db;
	waitUntil?: WorkspaceRuntimeWaitUntil;
	now?: () => number;
	createId?: () => string;
	execute?: WorkspaceWorkExecutor;
	invocationStartedAt?: number;
	invocationLimitMs?: number;
	sleep?: (ms: number) => Promise<void>;
};

function nowSeconds(nowMs: number): number {
	return Math.floor(nowMs / 1000);
}

function serializePayload(
	payload: WorkspaceWorkPayload | null | undefined,
): string | null {
	if (payload == null) {
		return null;
	}
	for (const value of Object.values(payload)) {
		if (value != null && typeof value === "object") {
			throw new WorkspaceRuntimeError(
				"invalid_payload",
				"Runtime work payload may contain only identifiers and bounded scalars.",
			);
		}
	}
	const json = JSON.stringify(payload);
	if (
		new TextEncoder().encode(json).byteLength > WORKSPACE_WORK_PAYLOAD_MAX_BYTES
	) {
		throw new WorkspaceRuntimeError(
			"invalid_payload",
			"Runtime work payload exceeds the bounded size limit.",
		);
	}
	return json;
}

export function parseWorkspaceWorkPayload(
	raw: string | null,
): WorkspaceWorkPayload | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
			return null;
		}
		const out: WorkspaceWorkPayload = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (
				value == null ||
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean"
			) {
				out[key] = value;
			}
		}
		return out;
	} catch {
		return null;
	}
}

function toReceipt(
	row: WorkspaceWorkRow,
	queuePosition: number | null,
): WorkspaceWorkReceipt {
	return {
		workId: row.id,
		status: row.status,
		queuePosition,
		queueExpiresAt: row.queueExpiresAt,
		sessionId: row.sessionId,
		intent: row.intent,
		reasonCode: row.reasonCode,
		userMessageId: row.userMessageId,
		assistantMessageId: row.assistantMessageId,
	};
}

async function nextFifoSeq(db: Db): Promise<number> {
	const [row] = await db
		.select({
			max: sql<number>`coalesce(max(${workspaceRuntimeWork.fifoSeq}), 0)`,
		})
		.from(workspaceRuntimeWork)
		.limit(1);
	return Number(row?.max ?? 0) + 1;
}

function isCurrentLegacyWorkRow(
	row: WorkspaceWorkRow,
	expectedOwnerVersion: number,
): boolean {
	return (
		row.runtimeOwner === "legacy" &&
		row.commandId == null &&
		row.protocolVersion == null &&
		row.runtimeOwnerVersion === expectedOwnerVersion
	);
}

function workInsertSelectFields(values: {
	id: string;
	fifoSeq: number;
	intent: WorkspaceWorkIntent;
	payload: string | null;
	queueExpiresAt: number;
	runtimeOwnerVersion: number;
}) {
	return {
		id: sql<string>`${values.id}`.as("id"),
		fifoSeq: sql<number>`${values.fifoSeq}`.as("fifoSeq"),
		identityId: sql<string | null>`${values.intent.identityId ?? null}`.as(
			"identityId",
		),
		sessionId: sql<string | null>`${values.intent.sessionId ?? null}`.as(
			"sessionId",
		),
		projectId: sql<string>`${values.intent.projectId}`.as("projectId"),
		userId: sql<string>`${values.intent.userId}`.as("userId"),
		intent: sql<string>`${values.intent.kind}`.as("intent"),
		payload: sql<string | null>`${values.payload}`.as("payload"),
		status: sql<string>`${"queued"}`.as("status"),
		leaseToken: sql<string | null>`null`.as("leaseToken"),
		leaseExpiresAt: sql<number | null>`null`.as("leaseExpiresAt"),
		retryCount: sql<number>`0`.as("retryCount"),
		reasonCode: sql<string | null>`null`.as("reasonCode"),
		queueExpiresAt: sql<number>`${values.queueExpiresAt}`.as("queueExpiresAt"),
		userMessageId: sql<
			string | null
		>`${values.intent.userMessageId ?? null}`.as("userMessageId"),
		assistantMessageId: sql<
			string | null
		>`${values.intent.assistantMessageId ?? null}`.as("assistantMessageId"),
		protocolVersion: sql<number | null>`null`.as("protocolVersion"),
		runtimeOwner: sql<string>`${"legacy"}`.as("runtimeOwner"),
		runtimeOwnerVersion: sql<number>`${values.runtimeOwnerVersion}`.as(
			"runtimeOwnerVersion",
		),
		commandId: sql<string | null>`null`.as("commandId"),
		deliveryState: sql<string>`${"pending"}`.as("deliveryState"),
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
	};
}

async function insertWorkRow(options: {
	db: Db;
	id: string;
	intent: WorkspaceWorkIntent;
	queueExpiresAt: number;
	nowMs: number;
}): Promise<WorkspaceWorkRow> {
	const payload = serializePayload(options.intent.payload);
	let runtimeOwnerVersion = 1;
	const sessionId = options.intent.sessionId ?? null;
	if (sessionId) {
		const [owner] = await options.db
			.select({
				runtimeOwner: workspaceSessions.runtimeOwner,
				runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
			})
			.from(workspaceSessions)
			.where(
				and(
					eq(workspaceSessions.id, sessionId),
					eq(workspaceSessions.userId, options.intent.userId),
				),
			)
			.limit(1);
		if (!owner || owner.runtimeOwner !== "legacy")
			throw new WorkspaceRuntimeError(
				"runtime_owner_mismatch",
				"Legacy runtime work is fenced for this session.",
			);
		runtimeOwnerVersion = owner.runtimeOwnerVersion;
	}
	let lastError: unknown;
	for (let attempt = 0; attempt < 5; attempt++) {
		const fifoSeq = await nextFifoSeq(options.db);
		try {
			const fields = workInsertSelectFields({
				id: options.id,
				fifoSeq,
				intent: options.intent,
				payload,
				queueExpiresAt: options.queueExpiresAt,
				runtimeOwnerVersion,
			});
			const [row] = sessionId
				? await options.db
						.insert(workspaceRuntimeWork)
						.select(
							options.db
								.select(fields)
								.from(workspaceSessions)
								.where(
									and(
										eq(workspaceSessions.id, sessionId),
										eq(workspaceSessions.userId, options.intent.userId),
										eq(workspaceSessions.runtimeOwner, "legacy"),
										eq(
											workspaceSessions.runtimeOwnerVersion,
											runtimeOwnerVersion,
										),
									),
								),
						)
						.returning()
				: await options.db
						.insert(workspaceRuntimeWork)
						.values({
							id: options.id,
							fifoSeq,
							identityId: options.intent.identityId ?? null,
							sessionId: null,
							projectId: options.intent.projectId,
							userId: options.intent.userId,
							intent: options.intent.kind,
							payload,
							status: "queued",
							queueExpiresAt: options.queueExpiresAt,
							userMessageId: options.intent.userMessageId ?? null,
							assistantMessageId: options.intent.assistantMessageId ?? null,
							runtimeOwner: "legacy",
							runtimeOwnerVersion,
						})
						.returning();
			if (row) {
				return row;
			}
			if (sessionId) {
				throw new WorkspaceRuntimeError(
					"runtime_owner_mismatch",
					"Legacy runtime work is fenced for this session.",
				);
			}
		} catch (error) {
			if (
				error instanceof WorkspaceRuntimeError &&
				error.code === "runtime_owner_mismatch"
			) {
				throw error;
			}
			lastError = error;
			const message = error instanceof Error ? error.message : String(error);
			if (
				options.intent.assistantMessageId &&
				/unique|constraint/i.test(message)
			) {
				const [existing] = await options.db
					.select()
					.from(workspaceRuntimeWork)
					.where(
						eq(
							workspaceRuntimeWork.assistantMessageId,
							options.intent.assistantMessageId,
						),
					)
					.limit(1);
				if (existing && isCurrentLegacyWorkRow(existing, runtimeOwnerVersion)) {
					return existing;
				}
				if (existing) {
					throw new WorkspaceRuntimeError(
						"runtime_owner_mismatch",
						"Legacy runtime work is fenced for this session.",
					);
				}
			}
			if (!/unique|constraint/i.test(message)) {
				throw error;
			}
		}
	}
	throw (
		lastError ??
		new WorkspaceRuntimeError(
			"work_insert_failed",
			"Failed to persist runtime work.",
		)
	);
}

async function accurateQueuePosition(
	db: Db,
	row: WorkspaceWorkRow,
	nowMs: number,
): Promise<number | null> {
	if (row.status !== "queued") {
		return null;
	}
	const now = nowSeconds(nowMs);
	const ahead = await db
		.select({ id: workspaceRuntimeWork.id })
		.from(workspaceRuntimeWork)
		.where(
			and(
				eq(workspaceRuntimeWork.status, "queued"),
				sql`${workspaceRuntimeWork.fifoSeq} < ${row.fifoSeq}`,
				sql`${workspaceRuntimeWork.queueExpiresAt} > ${now}`,
			),
		);
	return ahead.length + 1;
}

async function loadLegacyCapacityPolicy(
	db: Db,
): Promise<{ accountingMode: "legacy"; version: number }> {
	const [policy] = await db
		.select({
			accountingMode: runtimeCapacityPolicy.accountingMode,
			version: runtimeCapacityPolicy.version,
		})
		.from(runtimeCapacityPolicy)
		.where(eq(runtimeCapacityPolicy.id, 1))
		.limit(1);
	if (!policy || policy.accountingMode !== "legacy") {
		throw new WorkspaceRuntimeError(
			"capacity_accounting_unified",
			"Legacy capacity allocation is closed after accounting cutover.",
		);
	}
	return { accountingMode: "legacy", version: policy.version };
}

function matchingLegacyAccounting(version: number) {
	return sql`EXISTS (
		SELECT 1 FROM ${runtimeCapacityPolicy}
		WHERE ${runtimeCapacityPolicy.id} = 1
			AND ${runtimeCapacityPolicy.accountingMode} = 'legacy'
			AND ${runtimeCapacityPolicy.version} = ${version}
	)`;
}

function matchingLegacyAccountingMode() {
	return sql`EXISTS (
		SELECT 1 FROM ${runtimeCapacityPolicy}
		WHERE ${runtimeCapacityPolicy.id} = 1
			AND ${runtimeCapacityPolicy.accountingMode} = 'legacy'
	)`;
}

export async function acquireCapacitySlot(options: {
	db: Db;
	sessionId: string;
	userId: string;
	identityId?: string | null;
	nowMs: number;
	createId?: () => string;
}): Promise<{ id: string; leaseToken: string; expiresAt: number } | null> {
	const policy = await loadLegacyCapacityPolicy(options.db);
	const now = nowSeconds(options.nowMs);
	const expiresAt = now + Math.floor(WORKSPACE_CAPACITY_LEASE_TTL_MS / 1000);
	const createId = options.createId ?? nanoid;
	const token = createId();

	const [renewed] = await options.db
		.update(workspaceCapacityLeases)
		.set({
			leaseToken: token,
			expiresAt,
			identityId: options.identityId ?? null,
			userId: options.userId,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceCapacityLeases.sessionId, options.sessionId),
				sql`${workspaceCapacityLeases.expiresAt} > ${now}`,
				matchingLegacyAccounting(policy.version),
			),
		)
		.returning({
			id: workspaceCapacityLeases.id,
			leaseToken: workspaceCapacityLeases.leaseToken,
			expiresAt: workspaceCapacityLeases.expiresAt,
		});
	if (renewed) {
		return renewed;
	}

	const id = createId();
	await options.db.run(sql`
		INSERT INTO workspace_capacity_leases (
			id, sessionId, userId, identityId, leaseToken, expiresAt, created_at, updated_at
		)
		SELECT
			${id},
			${options.sessionId},
			${options.userId},
			${options.identityId ?? null},
			${token},
			${expiresAt},
			unixepoch(),
			unixepoch()
		WHERE (
			SELECT count(*) FROM workspace_capacity_leases
			WHERE expiresAt > ${now}
		) < ${WORKSPACE_CAPACITY_GLOBAL_LIMIT}
		AND (
			SELECT count(*) FROM workspace_capacity_leases
			WHERE userId = ${options.userId} AND expiresAt > ${now}
		) < ${WORKSPACE_CAPACITY_PER_USER_LIMIT}
		AND NOT EXISTS (
			SELECT 1 FROM workspace_capacity_leases
			WHERE sessionId = ${options.sessionId} AND expiresAt > ${now}
		)
		AND EXISTS (
			SELECT 1 FROM runtime_capacity_policy
			WHERE id = 1
				AND accountingMode = 'legacy'
				AND version = ${policy.version}
		)
	`);

	const [inserted] = await options.db
		.select()
		.from(workspaceCapacityLeases)
		.where(
			and(
				eq(workspaceCapacityLeases.sessionId, options.sessionId),
				eq(workspaceCapacityLeases.leaseToken, token),
			),
		)
		.limit(1);
	if (!inserted) {
		await loadLegacyCapacityPolicy(options.db);
		return null;
	}
	return {
		id: inserted.id,
		leaseToken: inserted.leaseToken,
		expiresAt: inserted.expiresAt,
	};
}

export async function releaseCapacitySlot(options: {
	db: Db;
	sessionId: string;
	leaseToken?: string | null;
	nowMs: number;
}): Promise<boolean> {
	const now = nowSeconds(options.nowMs);
	const accounting = matchingLegacyAccountingMode();
	if (options.leaseToken) {
		const released = await options.db
			.delete(workspaceCapacityLeases)
			.where(
				and(
					eq(workspaceCapacityLeases.sessionId, options.sessionId),
					eq(workspaceCapacityLeases.leaseToken, options.leaseToken),
					accounting,
				),
			)
			.returning({ id: workspaceCapacityLeases.id });
		if (released[0]) {
			return true;
		}
	}
	const expired = await options.db
		.delete(workspaceCapacityLeases)
		.where(
			and(
				eq(workspaceCapacityLeases.sessionId, options.sessionId),
				lte(workspaceCapacityLeases.expiresAt, now),
				accounting,
			),
		)
		.returning({ id: workspaceCapacityLeases.id });
	if (expired[0]) {
		return true;
	}
	const forced = await options.db
		.delete(workspaceCapacityLeases)
		.where(
			and(eq(workspaceCapacityLeases.sessionId, options.sessionId), accounting),
		)
		.returning({ id: workspaceCapacityLeases.id });
	return Boolean(forced[0]);
}

export async function purgeExpiredCapacitySlots(
	db: Db,
	nowMs: number,
): Promise<number> {
	const now = nowSeconds(nowMs);
	const deleted = await db
		.delete(workspaceCapacityLeases)
		.where(
			and(
				lte(workspaceCapacityLeases.expiresAt, now),
				matchingLegacyAccountingMode(),
			),
		)
		.returning({ id: workspaceCapacityLeases.id });
	return deleted.length;
}

export async function hasUnexpiredCapacitySlot(options: {
	db: Db;
	sessionId: string;
	nowMs: number;
}): Promise<boolean> {
	const now = nowSeconds(options.nowMs);
	const [row] = await options.db
		.select({ id: workspaceCapacityLeases.id })
		.from(workspaceCapacityLeases)
		.where(
			and(
				eq(workspaceCapacityLeases.sessionId, options.sessionId),
				sql`${workspaceCapacityLeases.expiresAt} > ${now}`,
			),
		)
		.limit(1);
	return Boolean(row);
}

async function leaseNextWork(options: {
	db: Db;
	nowMs: number;
	createId: () => string;
	remainingMs: number;
}): Promise<WorkspaceWorkRow | null> {
	const now = nowSeconds(options.nowMs);
	const leaseExpiresAt = now + Math.floor(WORKSPACE_WORK_LEASE_TTL_MS / 1000);
	const token = options.createId();
	const skipAgent = options.remainingMs < WORKSPACE_AGENT_COMMAND_RESERVE_MS;
	const skipOther = options.remainingMs < WORKSPACE_CRON_NON_AGENT_RESERVE_MS;
	if (skipOther) {
		return null;
	}

	const candidates = await options.db
		.select()
		.from(workspaceRuntimeWork)
		.where(
			and(
				eq(workspaceRuntimeWork.status, "queued"),
				sql`${workspaceRuntimeWork.queueExpiresAt} > ${now}`,
				legacyWorkOwner,
			),
		)
		.orderBy(asc(workspaceRuntimeWork.fifoSeq))
		.limit(8);

	for (const candidate of candidates) {
		if (skipAgent && candidate.intent === "agent_run") {
			continue;
		}
		const [leased] = await options.db
			.update(workspaceRuntimeWork)
			.set({
				status: "leased",
				leaseToken: token,
				leaseExpiresAt,
				updatedAt: sql`(unixepoch())`,
			})
			.where(
				and(
					eq(workspaceRuntimeWork.id, candidate.id),
					eq(workspaceRuntimeWork.status, "queued"),
					sql`${workspaceRuntimeWork.queueExpiresAt} > ${now}`,
					legacyWorkOwner,
				),
			)
			.returning();
		if (leased) {
			return leased;
		}
	}
	return null;
}

async function markWorkStatus(options: {
	db: Db;
	workId: string;
	from: WorkspaceWorkStatus | WorkspaceWorkStatus[];
	to: WorkspaceWorkStatus;
	leaseToken?: string | null;
	reasonCode?: string | null;
}): Promise<WorkspaceWorkRow | null> {
	const from = Array.isArray(options.from) ? options.from : [options.from];
	const conditions = [
		eq(workspaceRuntimeWork.id, options.workId),
		inArray(workspaceRuntimeWork.status, from),
		legacyWorkOwner,
	];
	if (options.leaseToken) {
		conditions.push(eq(workspaceRuntimeWork.leaseToken, options.leaseToken));
	}
	const [row] = await options.db
		.update(workspaceRuntimeWork)
		.set({
			status: options.to,
			reasonCode: options.reasonCode ?? null,
			...(options.to === "complete" ||
			options.to === "failed" ||
			options.to === "cancelled" ||
			options.to === "queued"
				? { leaseToken: null, leaseExpiresAt: null }
				: {}),
			updatedAt: sql`(unixepoch())`,
		})
		.where(and(...conditions))
		.returning();
	return row ?? null;
}

export async function markWorkRunning(options: {
	db: Db;
	workId: string;
	leaseToken: string;
}): Promise<WorkspaceWorkRow | null> {
	return markWorkStatus({
		db: options.db,
		workId: options.workId,
		from: "leased",
		to: "running",
		leaseToken: options.leaseToken,
	});
}

export async function completeWork(options: {
	db: Db;
	workId: string;
	leaseToken?: string | null;
	reasonCode?: string | null;
}): Promise<WorkspaceWorkRow | null> {
	return markWorkStatus({
		db: options.db,
		workId: options.workId,
		from: ["leased", "running"],
		to: "complete",
		leaseToken: options.leaseToken,
		reasonCode: options.reasonCode,
	});
}

export async function failWork(options: {
	db: Db;
	workId: string;
	leaseToken?: string | null;
	reasonCode: string;
}): Promise<WorkspaceWorkRow | null> {
	return markWorkStatus({
		db: options.db,
		workId: options.workId,
		from: ["queued", "leased", "running"],
		to: "failed",
		leaseToken: options.leaseToken,
		reasonCode: options.reasonCode,
	});
}

export async function settleAssistantFailed(options: {
	db: Db;
	assistantMessageId: string | null;
	userId: string;
	sessionId: string | null;
	runtimeOwnerVersion: number;
}): Promise<void> {
	if (!options.assistantMessageId) {
		return;
	}
	await options.db
		.update(messages)
		.set({
			status: "failed",
		})
		.where(
			and(
				eq(messages.id, options.assistantMessageId),
				eq(messages.userId, options.userId),
				eq(messages.status, "pending"),
				sql`EXISTS (SELECT 1 FROM ${workspaceSessions} WHERE ${workspaceSessions.id} = ${options.sessionId} AND ${workspaceSessions.runtimeOwner} = 'legacy' AND ${workspaceSessions.runtimeOwnerVersion} = ${options.runtimeOwnerVersion})`,
			),
		);
}

export async function expireQueuedWork(options: {
	db: Db;
	nowMs: number;
}): Promise<WorkspaceWorkRow[]> {
	const now = nowSeconds(options.nowMs);
	const expired = await options.db
		.update(workspaceRuntimeWork)
		.set({
			status: "failed",
			reasonCode: "capacity_queue_expired",
			leaseToken: null,
			leaseExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.status, "queued"),
				lte(workspaceRuntimeWork.queueExpiresAt, now),
				legacyWorkOwner,
			),
		)
		.returning();
	for (const row of expired) {
		await settleAssistantFailed({
			db: options.db,
			assistantMessageId: row.assistantMessageId,
			userId: row.userId,
			sessionId: row.sessionId,
			runtimeOwnerVersion: row.runtimeOwnerVersion,
		});
	}
	return expired;
}

export async function reclaimExpiredWorkLeases(options: {
	db: Db;
	nowMs: number;
}): Promise<void> {
	const now = nowSeconds(options.nowMs);
	const leased = await options.db
		.update(workspaceRuntimeWork)
		.set({
			status: "queued",
			leaseToken: null,
			leaseExpiresAt: null,
			retryCount: sql`${workspaceRuntimeWork.retryCount} + 1`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.status, "leased"),
				isNotNull(workspaceRuntimeWork.leaseExpiresAt),
				lte(workspaceRuntimeWork.leaseExpiresAt, now),
				legacyWorkOwner,
			),
		)
		.returning();
	void leased;

	const running = await options.db
		.update(workspaceRuntimeWork)
		.set({
			status: "failed",
			reasonCode: "work_lease_expired",
			leaseToken: null,
			leaseExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.status, "running"),
				isNotNull(workspaceRuntimeWork.leaseExpiresAt),
				lte(workspaceRuntimeWork.leaseExpiresAt, now),
				legacyWorkOwner,
			),
		)
		.returning();
	for (const row of running) {
		await settleAssistantFailed({
			db: options.db,
			assistantMessageId: row.assistantMessageId,
			userId: row.userId,
			sessionId: row.sessionId,
			runtimeOwnerVersion: row.runtimeOwnerVersion,
		});
		if (row.sessionId) {
			await releaseCapacitySlot({
				db: options.db,
				sessionId: row.sessionId,
				nowMs: options.nowMs,
			});
		}
	}
}

export async function cancelWorkspaceWorkRow(options: {
	db: Db;
	workId: string;
	userId: string;
	nowMs: number;
}): Promise<WorkspaceWorkRow | null> {
	const [row] = await options.db
		.select()
		.from(workspaceRuntimeWork)
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.userId, options.userId),
			),
		)
		.limit(1);
	if (!row) {
		return null;
	}
	if (
		row.status === "complete" ||
		row.status === "failed" ||
		row.status === "cancelled"
	) {
		return row;
	}
	const [cancelled] = await options.db
		.update(workspaceRuntimeWork)
		.set({
			status: "cancelled",
			reasonCode: "cancelled",
			leaseToken: null,
			leaseExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.userId, options.userId),
				inArray(workspaceRuntimeWork.status, ["queued", "leased", "running"]),
				legacyWorkOwner,
			),
		)
		.returning();
	if (!cancelled) {
		return row;
	}
	await settleAssistantFailed({
		db: options.db,
		assistantMessageId: cancelled.assistantMessageId,
		userId: cancelled.userId,
		sessionId: cancelled.sessionId,
		runtimeOwnerVersion: cancelled.runtimeOwnerVersion,
	});
	if (cancelled.sessionId) {
		await releaseCapacitySlot({
			db: options.db,
			sessionId: cancelled.sessionId,
			nowMs: options.nowMs,
		});
	}
	return cancelled;
}

export async function cancelProjectWork(options: {
	db: Db;
	projectId: string;
	userId: string;
	nowMs: number;
}): Promise<number> {
	const open = await options.db
		.select()
		.from(workspaceRuntimeWork)
		.where(
			and(
				eq(workspaceRuntimeWork.projectId, options.projectId),
				eq(workspaceRuntimeWork.userId, options.userId),
				inArray(workspaceRuntimeWork.status, ["queued", "leased", "running"]),
			),
		);
	for (const row of open) {
		await cancelWorkspaceWorkRow({
			db: options.db,
			workId: row.id,
			userId: options.userId,
			nowMs: options.nowMs,
		});
	}
	return open.length;
}

export async function loadWorkspaceWork(options: {
	db: Db;
	workId: string;
	userId: string;
	nowMs: number;
}): Promise<WorkspaceWorkReceipt | null> {
	const [row] = await options.db
		.select()
		.from(workspaceRuntimeWork)
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.userId, options.userId),
			),
		)
		.limit(1);
	if (!row) {
		return null;
	}
	return toReceipt(
		row,
		await accurateQueuePosition(options.db, row, options.nowMs),
	);
}

export async function loadQueuedWorkForSession(options: {
	db: Db;
	sessionId: string;
	userId: string;
	nowMs: number;
}): Promise<WorkspaceWorkReceipt | null> {
	const [row] = await options.db
		.select()
		.from(workspaceRuntimeWork)
		.where(
			and(
				eq(workspaceRuntimeWork.sessionId, options.sessionId),
				eq(workspaceRuntimeWork.userId, options.userId),
				eq(workspaceRuntimeWork.runtimeOwner, "legacy"),
				inArray(workspaceRuntimeWork.status, ["queued", "leased", "running"]),
				legacyWorkOwner,
			),
		)
		.orderBy(asc(workspaceRuntimeWork.fifoSeq))
		.limit(1);
	if (!row) {
		return null;
	}
	return toReceipt(
		row,
		await accurateQueuePosition(options.db, row, options.nowMs),
	);
}

async function tryStartWork(options: {
	db: Db;
	work: WorkspaceWorkRow;
	nowMs: number;
	createId: () => string;
}): Promise<WorkspaceWorkRow> {
	if (options.work.status !== "queued") {
		return options.work;
	}
	const now = nowSeconds(options.nowMs);
	if (options.work.queueExpiresAt <= now) {
		const [expired] = await options.db
			.update(workspaceRuntimeWork)
			.set({
				status: "failed",
				reasonCode: "capacity_queue_expired",
				updatedAt: sql`(unixepoch())`,
			})
			.where(
				and(
					eq(workspaceRuntimeWork.id, options.work.id),
					eq(workspaceRuntimeWork.status, "queued"),
					legacyWorkOwner,
				),
			)
			.returning();
		if (expired) {
			await settleAssistantFailed({
				db: options.db,
				assistantMessageId: expired.assistantMessageId,
				userId: expired.userId,
				sessionId: expired.sessionId,
				runtimeOwnerVersion: expired.runtimeOwnerVersion,
			});
			return expired;
		}
		return options.work;
	}

	if (!options.work.sessionId) {
		return options.work;
	}

	const token = options.createId();
	const leaseExpiresAt = now + Math.floor(WORKSPACE_WORK_LEASE_TTL_MS / 1000);
	const [leased] = await options.db
		.update(workspaceRuntimeWork)
		.set({
			status: "leased",
			leaseToken: token,
			leaseExpiresAt,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.work.id),
				eq(workspaceRuntimeWork.status, "queued"),
				legacyWorkOwner,
			),
		)
		.returning();
	if (!leased) {
		const [current] = await options.db
			.select()
			.from(workspaceRuntimeWork)
			.where(eq(workspaceRuntimeWork.id, options.work.id))
			.limit(1);
		return current ?? options.work;
	}

	const slot = await acquireCapacitySlot({
		db: options.db,
		sessionId: leased.sessionId as string,
		userId: leased.userId,
		identityId: leased.identityId,
		nowMs: options.nowMs,
		createId: options.createId,
	});
	if (!slot) {
		const [requeued] = await options.db
			.update(workspaceRuntimeWork)
			.set({
				status: "queued",
				leaseToken: null,
				leaseExpiresAt: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(
				and(
					eq(workspaceRuntimeWork.id, leased.id),
					eq(workspaceRuntimeWork.status, "leased"),
					eq(workspaceRuntimeWork.leaseToken, token),
					legacyWorkOwner,
				),
			)
			.returning();
		return requeued ?? leased;
	}

	const running = await markWorkRunning({
		db: options.db,
		workId: leased.id,
		leaseToken: token,
	});
	return running ?? leased;
}

export async function persistWorkspaceWork(options: {
	db: Db;
	intent: WorkspaceWorkIntent;
	workId?: string;
	nowMs: number;
	createId?: () => string;
}): Promise<WorkspaceWorkRow> {
	const createId = options.createId ?? nanoid;
	if (options.intent.assistantMessageId) {
		const [existing] = await options.db
			.select()
			.from(workspaceRuntimeWork)
			.where(
				eq(
					workspaceRuntimeWork.assistantMessageId,
					options.intent.assistantMessageId,
				),
			)
			.limit(1);
		if (existing) {
			let expectedVersion = existing.runtimeOwnerVersion;
			if (options.intent.sessionId) {
				const [owner] = await options.db
					.select({
						runtimeOwner: workspaceSessions.runtimeOwner,
						runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
					})
					.from(workspaceSessions)
					.where(
						and(
							eq(workspaceSessions.id, options.intent.sessionId),
							eq(workspaceSessions.userId, options.intent.userId),
						),
					)
					.limit(1);
				if (!owner || owner.runtimeOwner !== "legacy") {
					throw new WorkspaceRuntimeError(
						"runtime_owner_mismatch",
						"Legacy runtime work is fenced for this session.",
					);
				}
				expectedVersion = owner.runtimeOwnerVersion;
			}
			if (!isCurrentLegacyWorkRow(existing, expectedVersion)) {
				throw new WorkspaceRuntimeError(
					"runtime_owner_mismatch",
					"Legacy runtime work is fenced for this session.",
				);
			}
			return existing;
		}
	}
	const queueExpiresAt =
		nowSeconds(options.nowMs) + Math.floor(WORKSPACE_QUEUE_TTL_MS / 1000);
	return insertWorkRow({
		db: options.db,
		id: options.workId ?? createId(),
		intent: options.intent,
		queueExpiresAt,
		nowMs: options.nowMs,
	});
}

export async function submitPersistedWork(options: {
	db: Db;
	work: WorkspaceWorkRow;
	nowMs: number;
	createId?: () => string;
}): Promise<WorkspaceWorkReceipt> {
	const started = await tryStartWork({
		db: options.db,
		work: options.work,
		nowMs: options.nowMs,
		createId: options.createId ?? nanoid,
	});
	return toReceipt(
		started,
		await accurateQueuePosition(options.db, started, options.nowMs),
	);
}

async function drainOnce(options: DrainWorkspaceRuntimeOptions): Promise<void> {
	const now = options.now ?? Date.now;
	const createId = options.createId ?? nanoid;
	const invocationStartedAt = options.invocationStartedAt ?? now();
	const invocationLimitMs =
		options.invocationLimitMs ?? WORKSPACE_CRON_INVOCATION_LIMIT_MS;
	const execute = options.execute;

	await purgeExpiredCapacitySlots(options.db, now());
	await expireQueuedWork({ db: options.db, nowMs: now() });
	await reclaimExpiredWorkLeases({ db: options.db, nowMs: now() });

	while (true) {
		const remaining = invocationLimitMs - (now() - invocationStartedAt);
		if (remaining < WORKSPACE_CRON_NON_AGENT_RESERVE_MS) {
			break;
		}
		const leased = await leaseNextWork({
			db: options.db,
			nowMs: now(),
			createId,
			remainingMs: remaining,
		});
		if (!leased) {
			break;
		}
		if (!leased.sessionId && leased.intent !== "destruction") {
			await failWork({
				db: options.db,
				workId: leased.id,
				leaseToken: leased.leaseToken,
				reasonCode: "session_required",
			});
			await settleAssistantFailed({
				db: options.db,
				assistantMessageId: leased.assistantMessageId,
				userId: leased.userId,
				sessionId: leased.sessionId,
				runtimeOwnerVersion: leased.runtimeOwnerVersion,
			});
			continue;
		}

		if (leased.sessionId) {
			const slot = await acquireCapacitySlot({
				db: options.db,
				sessionId: leased.sessionId,
				userId: leased.userId,
				identityId: leased.identityId,
				nowMs: now(),
				createId,
			});
			if (!slot) {
				await options.db
					.update(workspaceRuntimeWork)
					.set({
						status: "queued",
						leaseToken: null,
						leaseExpiresAt: null,
						updatedAt: sql`(unixepoch())`,
					})
					.where(
						and(
							eq(workspaceRuntimeWork.id, leased.id),
							eq(workspaceRuntimeWork.status, "leased"),
							eq(workspaceRuntimeWork.leaseToken, leased.leaseToken ?? ""),
							legacyWorkOwner,
						),
					);
				break;
			}
		}

		const running = await markWorkRunning({
			db: options.db,
			workId: leased.id,
			leaseToken: leased.leaseToken ?? "",
		});
		if (!running) {
			continue;
		}
		if (!execute) {
			break;
		}
		try {
			await execute({
				db: options.db,
				work: running,
				now,
			});
			await completeWork({
				db: options.db,
				workId: running.id,
				leaseToken: running.leaseToken,
			});
		} catch (error) {
			const code =
				error instanceof WorkspaceRuntimeError
					? error.code
					: "execution_failed";
			await failWork({
				db: options.db,
				workId: running.id,
				leaseToken: running.leaseToken,
				reasonCode: code,
			});
			await settleAssistantFailed({
				db: options.db,
				assistantMessageId: running.assistantMessageId,
				userId: running.userId,
				sessionId: running.sessionId,
				runtimeOwnerVersion: running.runtimeOwnerVersion,
			});
		}
	}
}

export async function drainWorkspaceRuntimeQueue(
	options: DrainWorkspaceRuntimeOptions,
): Promise<void> {
	const promise = drainOnce(options);
	options.waitUntil?.(promise);
	await promise;
}

export async function allocateWorkFifoSeq(db: Db): Promise<number> {
	return nextFifoSeq(db);
}

export function workspaceWorkInsertValues(options: {
	id: string;
	fifoSeq: number;
	intent: WorkspaceWorkIntent;
	queueExpiresAt: number;
	runtimeOwnerVersion?: number;
}): typeof workspaceRuntimeWork.$inferInsert {
	return {
		id: options.id,
		fifoSeq: options.fifoSeq,
		identityId: options.intent.identityId ?? null,
		sessionId: options.intent.sessionId ?? null,
		projectId: options.intent.projectId,
		userId: options.intent.userId,
		intent: options.intent.kind,
		payload: serializePayload(options.intent.payload),
		status: "queued",
		queueExpiresAt: options.queueExpiresAt,
		userMessageId: options.intent.userMessageId ?? null,
		assistantMessageId: options.intent.assistantMessageId ?? null,
		runtimeOwner: "legacy",
		runtimeOwnerVersion: options.runtimeOwnerVersion ?? 1,
	};
}
