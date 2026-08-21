import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	type PRIVILEGED_OPERATION_FAMILIES,
	privilegedOperations,
	type SANDBOX_IDENTITY_KINDS,
	type SANDBOX_IDENTITY_STATES,
	sandboxIdentities,
} from "#/db/schema";

type Db = ReturnType<typeof createDb>;

export type SandboxIdentityKind = (typeof SANDBOX_IDENTITY_KINDS)[number];
export type SandboxIdentityState = (typeof SANDBOX_IDENTITY_STATES)[number];
export type PrivilegedOperationFamily =
	(typeof PRIVILEGED_OPERATION_FAMILIES)[number];

export type SandboxIdentityHandle = {
	id: string;
	kind: SandboxIdentityKind;
	sandboxId: string;
	containerId: string;
	userId: string;
	projectId: string;
	workspaceSessionId: string | null;
	lifecycleGeneration: number;
	state: SandboxIdentityState;
	retiredAt: Date | null;
};

export type PrivilegedOperationHandle = {
	id: string;
	identityId: string;
	lifecycleGeneration: number;
	family: PrivilegedOperationFamily;
	type: string;
	contractVersion: number;
	repository: string | null;
	allowedRefs: string[] | null;
	maxRequests: number | null;
	consumedRequests: number;
	openedAt: Date;
	expiresAt: Date;
	closedAt: Date | null;
	closeReason: string | null;
	correlationId: string;
};

export type TrustedOutboundHandlerContext = {
	identityId: string;
	lifecycleGeneration: number;
	containerId: string;
};

export type ResolvedOutboundOperation = {
	identity: SandboxIdentityHandle;
	operation: PrivilegedOperationHandle;
};

export class SandboxAuthorityError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "SandboxAuthorityError";
		this.code = code;
	}
}

function parseAllowedRefs(raw: string | null): string[] | null {
	if (raw == null) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			!Array.isArray(parsed) ||
			!parsed.every((item): item is string => typeof item === "string")
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function toIdentityHandle(
	row: typeof sandboxIdentities.$inferSelect,
): SandboxIdentityHandle {
	return {
		id: row.id,
		kind: row.kind,
		sandboxId: row.sandboxId,
		containerId: row.containerId,
		userId: row.userId,
		projectId: row.projectId,
		workspaceSessionId: row.workspaceSessionId,
		lifecycleGeneration: row.lifecycleGeneration,
		state: row.state,
		retiredAt: row.retiredAt ?? null,
	};
}

function toOperationHandle(
	row: typeof privilegedOperations.$inferSelect,
): PrivilegedOperationHandle {
	return {
		id: row.id,
		identityId: row.identityId,
		lifecycleGeneration: row.lifecycleGeneration,
		family: row.family,
		type: row.type,
		contractVersion: row.contractVersion,
		repository: row.repository,
		allowedRefs: parseAllowedRefs(row.allowedRefs),
		maxRequests: row.maxRequests,
		consumedRequests: row.consumedRequests,
		openedAt: row.openedAt,
		expiresAt: row.expiresAt,
		closedAt: row.closedAt ?? null,
		closeReason: row.closeReason,
		correlationId: row.correlationId,
	};
}

async function loadIdentity(
	db: Db,
	identityId: string,
): Promise<SandboxIdentityHandle | null> {
	const [row] = await db
		.select()
		.from(sandboxIdentities)
		.where(eq(sandboxIdentities.id, identityId))
		.limit(1);
	return row ? toIdentityHandle(row) : null;
}

async function loadOpenOperation(
	db: Db,
	identityId: string,
	family: PrivilegedOperationFamily,
): Promise<PrivilegedOperationHandle | null> {
	const [row] = await db
		.select()
		.from(privilegedOperations)
		.where(
			and(
				eq(privilegedOperations.identityId, identityId),
				eq(privilegedOperations.family, family),
				isNull(privilegedOperations.closedAt),
			),
		)
		.limit(1);
	return row ? toOperationHandle(row) : null;
}

async function closeOpenOperationsForIdentity(
	db: Db,
	identityId: string,
	closeReason: string,
): Promise<void> {
	const openRows = await db
		.select()
		.from(privilegedOperations)
		.where(
			and(
				eq(privilegedOperations.identityId, identityId),
				isNull(privilegedOperations.closedAt),
			),
		);
	for (const row of openRows) {
		await db
			.update(privilegedOperations)
			.set({
				closedAt: sql`(unixepoch())`,
				closeReason,
				openSlot: row.id,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(privilegedOperations.id, row.id));
	}
}

export type SandboxAuthority = {
	registerIdentity(input: {
		kind: SandboxIdentityKind;
		sandboxId: string;
		containerId: string;
		userId: string;
		projectId: string;
		workspaceSessionId?: string | null;
		state?: SandboxIdentityState;
	}): Promise<SandboxIdentityHandle>;
	rotateGeneration(identityId: string): Promise<SandboxIdentityHandle>;
	retireIdentity(identityId: string): Promise<SandboxIdentityHandle>;
	getIdentity(identityId: string): Promise<SandboxIdentityHandle | null>;
	openOperation(input: {
		identityId: string;
		family: PrivilegedOperationFamily;
		type: string;
		contractVersion: number;
		repository?: string | null;
		allowedRefs?: string[] | null;
		maxRequests?: number | null;
		expiresAt: Date;
	}): Promise<PrivilegedOperationHandle>;
	closeOperation(
		operationId: string,
		closeReason: string,
	): Promise<PrivilegedOperationHandle>;
	withOperation<T>(
		input: {
			identityId: string;
			family: PrivilegedOperationFamily;
			type: string;
			contractVersion: number;
			repository?: string | null;
			allowedRefs?: string[] | null;
			maxRequests?: number | null;
			expiresAt: Date;
		},
		run: (operation: PrivilegedOperationHandle) => Promise<T>,
	): Promise<T>;
	resolveOutboundRequest(
		ctx: TrustedOutboundHandlerContext,
		family: PrivilegedOperationFamily,
	): Promise<ResolvedOutboundOperation>;
};

export function createSandboxAuthority(db: Db): SandboxAuthority {
	return {
		async registerIdentity(input) {
			const id = nanoid();
			const [row] = await db
				.insert(sandboxIdentities)
				.values({
					id,
					kind: input.kind,
					sandboxId: input.sandboxId,
					containerId: input.containerId,
					userId: input.userId,
					projectId: input.projectId,
					workspaceSessionId: input.workspaceSessionId ?? null,
					lifecycleGeneration: 1,
					state: input.state ?? "provisioning",
				})
				.returning();
			if (!row) {
				throw new SandboxAuthorityError(
					"identity_insert_failed",
					"Failed to register sandbox identity.",
				);
			}
			return toIdentityHandle(row);
		},

		async rotateGeneration(identityId) {
			const identity = await loadIdentity(db, identityId);
			if (!identity) {
				throw new SandboxAuthorityError(
					"identity_not_found",
					"Sandbox identity not found.",
				);
			}
			if (identity.retiredAt != null || identity.state === "destroyed") {
				throw new SandboxAuthorityError(
					"identity_retired",
					"Cannot rotate a retired sandbox identity.",
				);
			}
			await closeOpenOperationsForIdentity(
				db,
				identityId,
				"lifecycle_generation_rotated",
			);
			const [row] = await db
				.update(sandboxIdentities)
				.set({
					lifecycleGeneration: identity.lifecycleGeneration + 1,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(sandboxIdentities.id, identityId))
				.returning();
			if (!row) {
				throw new SandboxAuthorityError(
					"identity_not_found",
					"Sandbox identity not found.",
				);
			}
			return toIdentityHandle(row);
		},

		async retireIdentity(identityId) {
			const identity = await loadIdentity(db, identityId);
			if (!identity) {
				throw new SandboxAuthorityError(
					"identity_not_found",
					"Sandbox identity not found.",
				);
			}
			await closeOpenOperationsForIdentity(db, identityId, "identity_retired");
			const [row] = await db
				.update(sandboxIdentities)
				.set({
					state: "destroyed",
					retiredAt: sql`(unixepoch())`,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(sandboxIdentities.id, identityId))
				.returning();
			if (!row) {
				throw new SandboxAuthorityError(
					"identity_not_found",
					"Sandbox identity not found.",
				);
			}
			return toIdentityHandle(row);
		},

		async getIdentity(identityId) {
			return loadIdentity(db, identityId);
		},

		async openOperation(input) {
			const identity = await loadIdentity(db, input.identityId);
			if (!identity) {
				throw new SandboxAuthorityError(
					"identity_not_found",
					"Sandbox identity not found.",
				);
			}
			if (identity.retiredAt != null || identity.state === "destroyed") {
				throw new SandboxAuthorityError(
					"identity_retired",
					"Cannot open an operation on a retired identity.",
				);
			}
			const existing = await loadOpenOperation(
				db,
				input.identityId,
				input.family,
			);
			if (existing) {
				throw new SandboxAuthorityError(
					"operation_already_open",
					`An open ${input.family} operation already exists for this identity.`,
				);
			}

			const id = nanoid();
			const correlationId = crypto.randomUUID();
			const openedAt = new Date();
			try {
				const [row] = await db
					.insert(privilegedOperations)
					.values({
						id,
						identityId: input.identityId,
						lifecycleGeneration: identity.lifecycleGeneration,
						family: input.family,
						type: input.type,
						contractVersion: input.contractVersion,
						repository: input.repository ?? null,
						allowedRefs:
							input.allowedRefs != null
								? JSON.stringify(input.allowedRefs)
								: null,
						maxRequests: input.maxRequests ?? null,
						consumedRequests: 0,
						openedAt,
						expiresAt: input.expiresAt,
						correlationId,
						openSlot: "open",
					})
					.returning();
				if (!row) {
					throw new SandboxAuthorityError(
						"operation_insert_failed",
						"Failed to open privileged operation.",
					);
				}
				return toOperationHandle(row);
			} catch (error) {
				if (
					error instanceof Error &&
					/unique|constraint/i.test(error.message)
				) {
					throw new SandboxAuthorityError(
						"operation_already_open",
						`An open ${input.family} operation already exists for this identity.`,
					);
				}
				throw error;
			}
		},

		async closeOperation(operationId, closeReason) {
			const [existing] = await db
				.select()
				.from(privilegedOperations)
				.where(eq(privilegedOperations.id, operationId))
				.limit(1);
			if (!existing) {
				throw new SandboxAuthorityError(
					"operation_not_found",
					"Privileged operation not found.",
				);
			}
			if (existing.closedAt != null) {
				return toOperationHandle(existing);
			}
			const [row] = await db
				.update(privilegedOperations)
				.set({
					closedAt: sql`(unixepoch())`,
					closeReason,
					openSlot: existing.id,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(privilegedOperations.id, operationId))
				.returning();
			if (!row) {
				throw new SandboxAuthorityError(
					"operation_not_found",
					"Privileged operation not found.",
				);
			}
			return toOperationHandle(row);
		},

		async withOperation(input, run) {
			const operation = await this.openOperation(input);
			try {
				return await run(operation);
			} finally {
				await this.closeOperation(operation.id, "with_operation_settled");
			}
		},

		async resolveOutboundRequest(ctx, family) {
			const identity = await loadIdentity(db, ctx.identityId);
			if (!identity) {
				throw new SandboxAuthorityError(
					"identity_not_found",
					"Sandbox identity not found.",
				);
			}
			if (identity.retiredAt != null || identity.state === "destroyed") {
				throw new SandboxAuthorityError(
					"identity_retired",
					"Sandbox identity is retired.",
				);
			}
			if (identity.lifecycleGeneration !== ctx.lifecycleGeneration) {
				throw new SandboxAuthorityError(
					"generation_mismatch",
					"Sandbox lifecycle generation does not match.",
				);
			}
			if (identity.containerId !== ctx.containerId) {
				throw new SandboxAuthorityError(
					"container_mismatch",
					"Sandbox container identity does not match.",
				);
			}

			const operation = await loadOpenOperation(db, identity.id, family);
			if (!operation) {
				throw new SandboxAuthorityError(
					"operation_not_open",
					`No open ${family} operation for this identity.`,
				);
			}
			if (operation.lifecycleGeneration !== identity.lifecycleGeneration) {
				throw new SandboxAuthorityError(
					"generation_mismatch",
					"Open operation lifecycle generation does not match identity.",
				);
			}
			if (operation.closedAt != null) {
				throw new SandboxAuthorityError(
					"operation_closed",
					"Privileged operation is closed.",
				);
			}
			if (operation.expiresAt.getTime() <= Date.now()) {
				throw new SandboxAuthorityError(
					"operation_expired",
					"Privileged operation has expired.",
				);
			}

			if (operation.maxRequests != null) {
				const nextConsumed = operation.consumedRequests + 1;
				if (nextConsumed > operation.maxRequests) {
					throw new SandboxAuthorityError(
						"operation_exhausted",
						"Privileged operation request budget is exhausted.",
					);
				}
				const updated = await db
					.update(privilegedOperations)
					.set({
						consumedRequests: nextConsumed,
						updatedAt: sql`(unixepoch())`,
					})
					.where(
						and(
							eq(privilegedOperations.id, operation.id),
							isNull(privilegedOperations.closedAt),
							eq(
								privilegedOperations.consumedRequests,
								operation.consumedRequests,
							),
						),
					)
					.returning();
				if (!updated[0]) {
					throw new SandboxAuthorityError(
						"operation_exhausted",
						"Privileged operation request budget is exhausted.",
					);
				}
				return {
					identity,
					operation: toOperationHandle(updated[0]),
				};
			}

			return { identity, operation };
		},
	};
}
