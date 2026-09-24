import { and, asc, eq, lte, notInArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	sessionCommandKeys,
	sessionCommands,
	workspaceRuntimeWork,
	workspaceSessions,
} from "#/db/schema";
import type { SessionRuntime } from "#/lib/session-runtime-client";
import {
	parseSessionRuntimeHandoffAck,
	SESSION_RUNTIME_CALL_TIMEOUT_MS,
	SessionRuntimeHandoffError,
	withSessionRuntimeCallTimeout,
} from "#/lib/session-runtime-client";

type Db = ReturnType<typeof createDb>;

export const TRUSTED_DELIVERY_MAX_PER_PASS = 25;
export const TRUSTED_DELIVERY_MAX_PASS_MS = 20_000;
export const TRUSTED_DELIVERY_BACKOFF_MIN_MS = 1_000;
export const TRUSTED_DELIVERY_BACKOFF_MAX_MS = 60_000;

export type DeliveryClock = {
	now: () => number;
	random?: () => number;
};

export type DeliveryBudget = {
	maxDeliveries?: number;
	maxMs?: number;
};

function backoffMs(attempts: number, random: () => number): number {
	const exp = Math.min(
		TRUSTED_DELIVERY_BACKOFF_MAX_MS,
		TRUSTED_DELIVERY_BACKOFF_MIN_MS * 2 ** Math.max(0, attempts - 1),
	);
	const jitter = 0.5 + random();
	return Math.max(
		TRUSTED_DELIVERY_BACKOFF_MIN_MS,
		Math.min(TRUSTED_DELIVERY_BACKOFF_MAX_MS, Math.floor(exp * jitter)),
	);
}

function trustedDeliveryOwner() {
	return sql`(
		${workspaceRuntimeWork.runtimeOwner} = 'trusted_v1'
		AND ${workspaceRuntimeWork.commandId} IS NOT NULL
		AND ${workspaceRuntimeWork.protocolVersion} IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM ${workspaceSessions}
			WHERE ${workspaceSessions.id} = ${workspaceRuntimeWork.sessionId}
				AND ${workspaceSessions.runtimeOwner} = 'trusted_v1'
				AND ${workspaceSessions.runtimeOwnerVersion} = ${workspaceRuntimeWork.runtimeOwnerVersion}
		)
	)`;
}

async function loadPersistedHandoff(options: {
	db: Db;
	commandId: string;
	ownerVersion: number;
}) {
	const [row] = await options.db
		.select({
			id: sessionCommands.id,
			kind: sessionCommands.kind,
			sessionId: sessionCommands.sessionId,
			commandSeq: sessionCommands.commandSeq,
			userId: sessionCommands.userId,
			projectId: sessionCommands.projectId,
			runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
			receiptId: sessionCommandKeys.receiptId,
		})
		.from(sessionCommands)
		.innerJoin(
			workspaceSessions,
			eq(workspaceSessions.id, sessionCommands.sessionId),
		)
		.innerJoin(
			sessionCommandKeys,
			eq(sessionCommandKeys.commandId, sessionCommands.id),
		)
		.where(
			and(
				eq(sessionCommands.id, options.commandId),
				eq(workspaceSessions.runtimeOwner, "trusted_v1"),
				eq(workspaceSessions.runtimeOwnerVersion, options.ownerVersion),
				eq(sessionCommandKeys.commandId, options.commandId),
			),
		)
		.limit(1);
	return row ?? null;
}

function ackMatchesPersisted(
	ack: ReturnType<typeof parseSessionRuntimeHandoffAck>,
	command: NonNullable<Awaited<ReturnType<typeof loadPersistedHandoff>>>,
): boolean {
	return (
		ack.commandId === command.id &&
		ack.ownerVersion === command.runtimeOwnerVersion &&
		ack.acceptedPosition === command.commandSeq &&
		ack.receiptId === command.receiptId &&
		command.commandSeq != null
	);
}

async function leaseDeliveryRow(options: {
	db: Db;
	workId: string;
	token: string;
	leaseExpiresAt: number;
	nowMs: number;
}) {
	const [leased] = await options.db
		.update(workspaceRuntimeWork)
		.set({
			deliveryState: "leased",
			deliveryLeaseToken: options.token,
			deliveryLeaseExpiresAt: options.leaseExpiresAt,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
				eq(workspaceRuntimeWork.deliveryState, "pending"),
				or(
					sql`${workspaceRuntimeWork.deliveryLeaseExpiresAt} IS NULL`,
					lte(workspaceRuntimeWork.deliveryLeaseExpiresAt, options.nowMs),
				),
				trustedDeliveryOwner(),
			),
		)
		.returning();
	return leased ?? null;
}

async function releaseDeliveryAttempt(options: {
	db: Db;
	workId: string;
	token: string;
	attempts: number;
	nextAt: number;
}) {
	await options.db
		.update(workspaceRuntimeWork)
		.set({
			deliveryState: "pending",
			deliveryLeaseToken: null,
			deliveryLeaseExpiresAt: options.nextAt,
			deliveryAttempts: options.attempts,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.deliveryLeaseToken, options.token),
				eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
			),
		);
}

async function releaseUnusedLease(options: {
	db: Db;
	workId: string;
	token: string;
}) {
	await options.db
		.update(workspaceRuntimeWork)
		.set({
			deliveryState: "pending",
			deliveryLeaseToken: null,
			deliveryLeaseExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.deliveryLeaseToken, options.token),
				eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
			),
		);
}

async function renewDeliveryLease(options: {
	db: Db;
	workId: string;
	token: string;
	leaseExpiresAt: number;
}) {
	await options.db
		.update(workspaceRuntimeWork)
		.set({
			deliveryLeaseExpiresAt: options.leaseExpiresAt,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.deliveryLeaseToken, options.token),
				eq(workspaceRuntimeWork.deliveryState, "leased"),
				eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
			),
		);
}

async function markDeliveryAccepted(options: {
	db: Db;
	workId: string;
	token: string;
	attempts: number;
}) {
	const [updated] = await options.db
		.update(workspaceRuntimeWork)
		.set({
			deliveryState: "delivered",
			deliveryLeaseToken: null,
			deliveryLeaseExpiresAt: null,
			deliveryAttempts: options.attempts,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.id, options.workId),
				eq(workspaceRuntimeWork.deliveryLeaseToken, options.token),
				eq(workspaceRuntimeWork.deliveryState, "leased"),
				eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
			),
		)
		.returning({ id: workspaceRuntimeWork.id });
	return updated ?? null;
}

export async function deliverSessionCommands(options: {
	db: Db;
	runtime: SessionRuntime;
	clock?: DeliveryClock;
	budget?: DeliveryBudget;
	createId?: () => string;
}): Promise<{ delivered: number }> {
	const now = options.clock?.now ?? Date.now;
	const random = options.clock?.random ?? Math.random;
	const createId = options.createId ?? nanoid;
	const maxDeliveries =
		options.budget?.maxDeliveries ?? TRUSTED_DELIVERY_MAX_PER_PASS;
	const maxMs = options.budget?.maxMs ?? TRUSTED_DELIVERY_MAX_PASS_MS;
	const startedAt = now();
	const passDeadlineAt = startedAt + maxMs;
	let delivered = 0;
	const blockedOrdinarySessions = new Set<string>();

	await options.db
		.update(workspaceRuntimeWork)
		.set({
			deliveryState: "pending",
			deliveryLeaseToken: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceRuntimeWork.deliveryState, "leased"),
				eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
				sql`${workspaceRuntimeWork.deliveryLeaseExpiresAt} IS NOT NULL`,
				lte(workspaceRuntimeWork.deliveryLeaseExpiresAt, now()),
				trustedDeliveryOwner(),
			),
		);

	while (delivered < maxDeliveries) {
		const remaining = maxMs - (now() - startedAt);
		if (remaining <= 0) break;
		const callTimeoutMs = Math.min(SESSION_RUNTIME_CALL_TIMEOUT_MS, remaining);
		if (callTimeoutMs <= 0) break;
		const blockedSessions = [...blockedOrdinarySessions];
		const blockedOrdinary = blockedSessions.length
			? or(
					eq(sessionCommands.kind, "stop"),
					notInArray(workspaceRuntimeWork.sessionId, blockedSessions),
				)
			: sql`TRUE`;
		const candidates = await options.db
			.select({
				work: workspaceRuntimeWork,
				kind: sessionCommands.kind,
				commandSeq: sessionCommands.commandSeq,
			})
			.from(workspaceRuntimeWork)
			.innerJoin(
				sessionCommands,
				eq(sessionCommands.id, workspaceRuntimeWork.commandId),
			)
			.where(
				and(
					eq(workspaceRuntimeWork.runtimeOwner, "trusted_v1"),
					eq(workspaceRuntimeWork.deliveryState, "pending"),
					or(
						sql`${workspaceRuntimeWork.deliveryLeaseExpiresAt} IS NULL`,
						lte(workspaceRuntimeWork.deliveryLeaseExpiresAt, now()),
					),
					trustedDeliveryOwner(),
					blockedOrdinary,
				),
			)
			.orderBy(
				sql`CASE ${sessionCommands.kind} WHEN 'stop' THEN 0 ELSE 1 END`,
				asc(sessionCommands.commandSeq),
				asc(workspaceRuntimeWork.fifoSeq),
			)
			.limit(8);

		let leased = null as typeof workspaceRuntimeWork.$inferSelect | null;
		let leasedKind: string | null = null;
		for (const candidate of candidates) {
			const sessionId = candidate.work.sessionId;
			const isStop = candidate.kind === "stop";
			if (!isStop && sessionId && blockedOrdinarySessions.has(sessionId)) {
				continue;
			}
			const token = createId();
			const row = await leaseDeliveryRow({
				db: options.db,
				workId: candidate.work.id,
				token,
				leaseExpiresAt: now() + callTimeoutMs,
				nowMs: now(),
			});
			if (row) {
				leased = row;
				leasedKind = candidate.kind;
				break;
			}
		}
		if (!leased?.commandId) break;

		const token = leased.deliveryLeaseToken ?? "";
		const remainingAfterLease = maxMs - (now() - startedAt);
		if (remainingAfterLease <= 0) {
			await releaseUnusedLease({
				db: options.db,
				workId: leased.id,
				token,
			});
			break;
		}

		const command = await loadPersistedHandoff({
			db: options.db,
			commandId: leased.commandId,
			ownerVersion: leased.runtimeOwnerVersion,
		});
		const remainingBeforeRenewal = passDeadlineAt - now();
		if (remainingBeforeRenewal <= 0) {
			await releaseUnusedLease({
				db: options.db,
				workId: leased.id,
				token,
			});
			break;
		}
		const renewedLeaseDeadlineAt =
			now() + Math.min(SESSION_RUNTIME_CALL_TIMEOUT_MS, remainingBeforeRenewal);
		await renewDeliveryLease({
			db: options.db,
			workId: leased.id,
			token,
			leaseExpiresAt: renewedLeaseDeadlineAt,
		});
		const remainingAfterRenewal = Math.min(
			passDeadlineAt - now(),
			renewedLeaseDeadlineAt - now(),
		);
		if (remainingAfterRenewal <= 0) {
			await releaseUnusedLease({
				db: options.db,
				workId: leased.id,
				token,
			});
			break;
		}
		const serviceTimeoutMs = Math.min(
			SESSION_RUNTIME_CALL_TIMEOUT_MS,
			remainingAfterRenewal,
		);
		const attempts = leased.deliveryAttempts + 1;
		try {
			if (!command || command.commandSeq == null) {
				await releaseDeliveryAttempt({
					db: options.db,
					workId: leased.id,
					token,
					attempts,
					nextAt: now() + backoffMs(attempts, random),
				});
				delivered += 1;
				continue;
			}
			const input = {
				commandId: command.id,
				ownerVersion: command.runtimeOwnerVersion,
			};
			const callStarted = now();
			const rawAck =
				leasedKind === "stop" || command.kind === "stop"
					? await withSessionRuntimeCallTimeout(
							() => options.runtime.control(input),
							serviceTimeoutMs,
							{ now },
						)
					: await withSessionRuntimeCallTimeout(
							() => options.runtime.deliver(input),
							serviceTimeoutMs,
							{ now },
						);
			if (
				now() > passDeadlineAt ||
				now() > renewedLeaseDeadlineAt ||
				now() - callStarted > serviceTimeoutMs
			) {
				throw new SessionRuntimeHandoffError(
					"runtime_timeout",
					"runtime_timeout",
				);
			}
			const ack = parseSessionRuntimeHandoffAck(rawAck);
			if (!ackMatchesPersisted(ack, command)) {
				throw new SessionRuntimeHandoffError(
					"invalid_ack",
					"Handoff acknowledgment does not match persisted command.",
				);
			}
			const accepted = await markDeliveryAccepted({
				db: options.db,
				workId: leased.id,
				token,
				attempts,
			});
			if (!accepted) {
				delivered += 1;
				continue;
			}
		} catch (error) {
			if (
				error instanceof SessionRuntimeHandoffError &&
				error.code === "missing_predecessor" &&
				leasedKind !== "stop" &&
				leased.sessionId
			) {
				blockedOrdinarySessions.add(leased.sessionId);
			}
			await releaseDeliveryAttempt({
				db: options.db,
				workId: leased.id,
				token,
				attempts,
				nextAt: now() + backoffMs(attempts, random),
			});
			delivered += 1;
			continue;
		}
		delivered += 1;
	}

	return { delivered };
}
