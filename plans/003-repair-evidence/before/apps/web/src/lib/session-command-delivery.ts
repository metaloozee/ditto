import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	sessionCommands,
	workspaceRuntimeWork,
	workspaceSessions,
} from "#/db/schema";
import type { SessionRuntime } from "#/lib/session-runtime-client";

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

async function loadPersistedCommand(options: {
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
			runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
		})
		.from(sessionCommands)
		.innerJoin(
			workspaceSessions,
			eq(workspaceSessions.id, sessionCommands.sessionId),
		)
		.where(
			and(
				eq(sessionCommands.id, options.commandId),
				eq(workspaceSessions.runtimeOwner, "trusted_v1"),
				eq(workspaceSessions.runtimeOwnerVersion, options.ownerVersion),
			),
		)
		.limit(1);
	return row ?? null;
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
				inArray(workspaceRuntimeWork.deliveryState, ["pending", "delivered"]),
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
	let delivered = 0;

	const reclaimExpired = await options.db
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
		)
		.returning({ id: workspaceRuntimeWork.id });
	void reclaimExpired;

	while (delivered < maxDeliveries && now() - startedAt < maxMs) {
		const remaining = maxMs - (now() - startedAt);
		if (remaining <= 0) break;
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
					inArray(workspaceRuntimeWork.deliveryState, ["pending", "delivered"]),
					or(
						sql`${workspaceRuntimeWork.deliveryLeaseExpiresAt} IS NULL`,
						lte(workspaceRuntimeWork.deliveryLeaseExpiresAt, now()),
					),
					trustedDeliveryOwner(),
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
			const token = createId();
			const row = await leaseDeliveryRow({
				db: options.db,
				workId: candidate.work.id,
				token,
				leaseExpiresAt: now() + Math.min(remaining, 5_000),
				nowMs: now(),
			});
			if (row) {
				leased = row;
				leasedKind = candidate.kind;
				break;
			}
		}
		if (!leased?.commandId) break;

		const command = await loadPersistedCommand({
			db: options.db,
			commandId: leased.commandId,
			ownerVersion: leased.runtimeOwnerVersion,
		});
		const attempts = leased.deliveryAttempts + 1;
		const nextAt = now() + backoffMs(attempts, random);
		try {
			if (!command) {
				await releaseDeliveryAttempt({
					db: options.db,
					workId: leased.id,
					token: leased.deliveryLeaseToken ?? "",
					attempts,
					nextAt,
				});
				delivered += 1;
				continue;
			}
			if (leasedKind === "stop" || command.kind === "stop") {
				await options.runtime.control({
					commandId: command.id,
					ownerVersion: command.runtimeOwnerVersion,
				});
			} else {
				await options.runtime.deliver({
					commandId: command.id,
					ownerVersion: command.runtimeOwnerVersion,
				});
			}
		} catch {
			await releaseDeliveryAttempt({
				db: options.db,
				workId: leased.id,
				token: leased.deliveryLeaseToken ?? "",
				attempts,
				nextAt,
			});
			delivered += 1;
			continue;
		}
		await releaseDeliveryAttempt({
			db: options.db,
			workId: leased.id,
			token: leased.deliveryLeaseToken ?? "",
			attempts,
			nextAt,
		});
		delivered += 1;
	}

	return { delivered };
}
