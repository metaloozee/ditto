import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	type PRIVILEGED_OPERATION_FAMILIES,
	privilegedOperations,
	type SANDBOX_IDENTITY_KINDS,
	type SANDBOX_IDENTITY_STATES,
	sandboxIdentities,
	workspaceSessions,
} from "#/db/schema";
import { OPENCODE_CONTRACT_DENIAL_LIMIT } from "#/lib/open-code-contract";

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
	controllerClass: string | null;
	controllerNamespace: string | null;
	incarnationId: string | null;
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
	runtimeOwnerVersion: number;
	runId: string | null;
	runEpoch: number | null;
	incarnationId: string | null;
	admissionReference: string | null;
	repository: string | null;
	allowedRefs: string[] | null;
	maxRequests: number | null;
	consumedRequests: number;
	contractDenials: number;
	contractState: string | null;
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
	incarnationId?: string | null;
	runEpoch?: number | null;
	runtimeOwnerVersion?: number;
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
		controllerClass: row.controllerClass ?? null,
		controllerNamespace: row.controllerNamespace ?? null,
		incarnationId: row.incarnationId ?? null,
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
		runtimeOwnerVersion: row.runtimeOwnerVersion,
		runId: row.runId ?? null,
		runEpoch: row.runEpoch ?? null,
		incarnationId: row.incarnationId ?? null,
		admissionReference: row.admissionReference ?? null,
		repository: row.repository,
		allowedRefs: parseAllowedRefs(row.allowedRefs),
		maxRequests: row.maxRequests,
		consumedRequests: row.consumedRequests,
		contractDenials: row.contractDenials,
		contractState: row.contractState ?? null,
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

function requireStoredMatch(
	stored: string | number | null | undefined,
	provided: string | number | null | undefined,
	code: string,
	message: string,
): void {
	if (stored == null) {
		return;
	}
	if (provided == null || provided !== stored) {
		throw new SandboxAuthorityError(code, message);
	}
}

async function loadLegacyWorkspaceAdmission(
	db: Db,
	identity: SandboxIdentityHandle,
): Promise<{ runtimeOwnerVersion: number }> {
	if (identity.workspaceSessionId == null) {
		return { runtimeOwnerVersion: 1 };
	}
	const [session] = await db
		.select({
			id: workspaceSessions.id,
			runtimeOwner: workspaceSessions.runtimeOwner,
			runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
		})
		.from(workspaceSessions)
		.where(eq(workspaceSessions.id, identity.workspaceSessionId))
		.limit(1);
	if (!session || session.runtimeOwner !== "legacy") {
		throw new SandboxAuthorityError(
			"runtime_owner_mismatch",
			"Workspace runtime ownership does not admit a legacy operation.",
		);
	}
	return { runtimeOwnerVersion: session.runtimeOwnerVersion };
}

function identityIncarnationMatchesSql(incarnationId: string | null) {
	return sql`(
		(
			${sandboxIdentities.incarnationId} IS NULL
			AND ${incarnationId} IS NULL
		)
		OR ${sandboxIdentities.incarnationId} = ${incarnationId}
	)`;
}

function storedNullableMatchesSql(
	column:
		| typeof privilegedOperations.incarnationId
		| typeof privilegedOperations.runEpoch,
	provided: string | number | null | undefined,
) {
	return sql`(
		${column} IS NULL
		OR ${column} = ${provided ?? null}
	)`;
}

function workspaceAdmissionSql(
	identityId: string,
	expectedOwnerVersion: number,
	options?: {
		lifecycleGeneration?: number;
		incarnationId?: string | null;
	},
) {
	const generationPredicate =
		options?.lifecycleGeneration == null
			? sql`TRUE`
			: sql`${sandboxIdentities.lifecycleGeneration} = ${options.lifecycleGeneration}`;
	const incarnationPredicate =
		options && "incarnationId" in options
			? identityIncarnationMatchesSql(options.incarnationId ?? null)
			: sql`TRUE`;
	return sql`EXISTS (
		SELECT 1 FROM ${sandboxIdentities}
		LEFT JOIN ${workspaceSessions}
			ON ${workspaceSessions.id} = ${sandboxIdentities.workspaceSessionId}
		WHERE ${sandboxIdentities.id} = ${identityId}
			AND ${sandboxIdentities.retiredAt} IS NULL
			AND ${sandboxIdentities.state} != 'destroyed'
			AND ${sandboxIdentities.kind} != 'trusted_brain'
			AND ${generationPredicate}
			AND ${incarnationPredicate}
			AND (
				${sandboxIdentities.workspaceSessionId} IS NULL
				OR (
					${workspaceSessions.runtimeOwner} = 'legacy'
					AND ${workspaceSessions.runtimeOwnerVersion} = ${expectedOwnerVersion}
				)
			)
	)`;
}

function liveOutboundOperationSql(
	ctx: TrustedOutboundHandlerContext,
	family: PrivilegedOperationFamily,
) {
	const callerVersionPredicate =
		ctx.runtimeOwnerVersion == null
			? sql`TRUE`
			: sql`${privilegedOperations.runtimeOwnerVersion} = ${ctx.runtimeOwnerVersion}`;
	return and(
		eq(privilegedOperations.identityId, ctx.identityId),
		eq(privilegedOperations.family, family),
		isNull(privilegedOperations.closedAt),
		sql`${privilegedOperations.expiresAt} > (unixepoch())`,
		eq(privilegedOperations.lifecycleGeneration, ctx.lifecycleGeneration),
		callerVersionPredicate,
		storedNullableMatchesSql(
			privilegedOperations.incarnationId,
			ctx.incarnationId,
		),
		storedNullableMatchesSql(privilegedOperations.runEpoch, ctx.runEpoch),
		sql`EXISTS (
			SELECT 1 FROM ${sandboxIdentities}
			LEFT JOIN ${workspaceSessions}
				ON ${workspaceSessions.id} = ${sandboxIdentities.workspaceSessionId}
			WHERE ${sandboxIdentities.id} = ${privilegedOperations.identityId}
				AND ${sandboxIdentities.retiredAt} IS NULL
				AND ${sandboxIdentities.state} != 'destroyed'
				AND ${sandboxIdentities.kind} != 'trusted_brain'
				AND ${sandboxIdentities.lifecycleGeneration} = ${privilegedOperations.lifecycleGeneration}
				AND ${sandboxIdentities.lifecycleGeneration} = ${ctx.lifecycleGeneration}
				AND ${sandboxIdentities.containerId} = ${ctx.containerId}
				AND ${identityIncarnationMatchesSql(ctx.incarnationId ?? null)}
				AND (
					${sandboxIdentities.workspaceSessionId} IS NULL
					OR (
						${workspaceSessions.runtimeOwner} = 'legacy'
						AND ${workspaceSessions.runtimeOwnerVersion} = ${privilegedOperations.runtimeOwnerVersion}
					)
				)
		)`,
	);
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
		contractState?: string | null;
		expiresAt: Date;
		runtimeOwnerVersion?: number;
		runId?: string | null;
		runEpoch?: number | null;
		incarnationId?: string | null;
		admissionReference?: string | null;
	}): Promise<PrivilegedOperationHandle>;
	updateOperationContractState(
		operationId: string,
		expected: string | null,
		next: string,
	): Promise<PrivilegedOperationHandle>;
	closeOperation(
		operationId: string,
		closeReason: string,
	): Promise<PrivilegedOperationHandle>;
	closeOpenFamily(
		identityId: string,
		family: PrivilegedOperationFamily,
		closeReason: string,
	): Promise<PrivilegedOperationHandle | null>;
	recordContractDenial(operationId: string): Promise<{
		denials: number;
		closed: boolean;
		identityId: string;
		workspaceSessionId: string | null;
	}>;
	withOperation<T>(
		input: {
			identityId: string;
			family: PrivilegedOperationFamily;
			type: string;
			contractVersion: number;
			repository?: string | null;
			allowedRefs?: string[] | null;
			maxRequests?: number | null;
			contractState?: string | null;
			expiresAt: Date;
			runtimeOwnerVersion?: number;
			runId?: string | null;
			runEpoch?: number | null;
			incarnationId?: string | null;
			admissionReference?: string | null;
		},
		run: (operation: PrivilegedOperationHandle) => Promise<T>,
	): Promise<T>;
	resolveOutboundRequest(
		ctx: TrustedOutboundHandlerContext,
		family: PrivilegedOperationFamily,
		options?: { consume?: boolean },
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
			if (identity.kind === "trusted_brain") {
				throw new SandboxAuthorityError(
					"trusted_windows_closed",
					"Trusted brain operation windows are not opened in this phase.",
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

			const admission = await loadLegacyWorkspaceAdmission(db, identity);
			if (
				input.runtimeOwnerVersion != null &&
				input.runtimeOwnerVersion !== admission.runtimeOwnerVersion
			) {
				throw new SandboxAuthorityError(
					"runtime_owner_mismatch",
					"Privileged operation runtime owner version does not match.",
				);
			}
			const id = nanoid();
			const correlationId = crypto.randomUUID();
			const openedAt = new Date();
			const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1000);
			const values = {
				id,
				identityId: input.identityId,
				lifecycleGeneration: identity.lifecycleGeneration,
				family: input.family,
				type: input.type,
				contractVersion: input.contractVersion,
				runtimeOwnerVersion: admission.runtimeOwnerVersion,
				runId: input.runId ?? null,
				runEpoch: input.runEpoch ?? null,
				incarnationId: input.incarnationId ?? identity.incarnationId,
				admissionReference: input.admissionReference ?? null,
				repository: input.repository ?? null,
				allowedRefs:
					input.allowedRefs != null ? JSON.stringify(input.allowedRefs) : null,
				maxRequests: input.maxRequests ?? null,
				consumedRequests: 0,
				contractDenials: 0,
				contractState: input.contractState ?? null,
				openedAt,
				expiresAt: input.expiresAt,
				correlationId,
				openSlot: "open" as const,
			};
			try {
				const [row] = await db
					.insert(privilegedOperations)
					.select(
						db
							.select({
								id: sql<string>`${values.id}`.as("id"),
								identityId: sql<string>`${values.identityId}`.as("identityId"),
								lifecycleGeneration:
									sql<number>`${values.lifecycleGeneration}`.as(
										"lifecycleGeneration",
									),
								family: sql<string>`${values.family}`.as("family"),
								type: sql<string>`${values.type}`.as("type"),
								contractVersion: sql<number>`${values.contractVersion}`.as(
									"contractVersion",
								),
								runtimeOwnerVersion:
									sql<number>`${values.runtimeOwnerVersion}`.as(
										"runtimeOwnerVersion",
									),
								runId: sql<string | null>`${values.runId}`.as("runId"),
								runEpoch: sql<number | null>`${values.runEpoch}`.as("runEpoch"),
								incarnationId: sql<string | null>`${values.incarnationId}`.as(
									"incarnationId",
								),
								admissionReference: sql<
									string | null
								>`${values.admissionReference}`.as("admissionReference"),
								repository: sql<string | null>`${values.repository}`.as(
									"repository",
								),
								allowedRefs: sql<string | null>`${values.allowedRefs}`.as(
									"allowedRefs",
								),
								maxRequests: sql<number | null>`${values.maxRequests}`.as(
									"maxRequests",
								),
								consumedRequests: sql<number>`0`.as("consumedRequests"),
								contractDenials: sql<number>`0`.as("contractDenials"),
								contractState: sql<string | null>`${values.contractState}`.as(
									"contractState",
								),
								openedAt: sql`(unixepoch())`.as("openedAt"),
								expiresAt: sql<number>`${expiresAtSeconds}`.as("expiresAt"),
								closedAt: sql`null`.as("closedAt"),
								closeReason: sql`null`.as("closeReason"),
								correlationId: sql<string>`${correlationId}`.as(
									"correlationId",
								),
								openSlot: sql<string>`${"open"}`.as("openSlot"),
								createdAt: sql`(unixepoch())`.as("createdAt"),
								updatedAt: sql`(unixepoch())`.as("updatedAt"),
							})
							.from(sandboxIdentities)
							.where(
								and(
									eq(sandboxIdentities.id, input.identityId),
									isNull(sandboxIdentities.retiredAt),
									sql`${sandboxIdentities.kind} != 'trusted_brain'`,
									sql`${sandboxIdentities.state} != 'destroyed'`,
									workspaceAdmissionSql(
										input.identityId,
										admission.runtimeOwnerVersion,
										{
											lifecycleGeneration: identity.lifecycleGeneration,
											incarnationId: identity.incarnationId,
										},
									),
								),
							),
					)
					.returning();
				if (!row) {
					throw new SandboxAuthorityError(
						"runtime_owner_mismatch",
						"Workspace runtime ownership does not admit a legacy operation.",
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

		async closeOpenFamily(identityId, family, closeReason) {
			const existing = await loadOpenOperation(db, identityId, family);
			if (!existing) {
				return null;
			}
			return this.closeOperation(existing.id, closeReason);
		},

		async recordContractDenial(operationId) {
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
				const identity = await loadIdentity(db, existing.identityId);
				return {
					denials: existing.contractDenials,
					closed: true,
					identityId: existing.identityId,
					workspaceSessionId: identity?.workspaceSessionId ?? null,
				};
			}
			const nextDenials = existing.contractDenials + 1;
			const updated = await db
				.update(privilegedOperations)
				.set({
					contractDenials: nextDenials,
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(
						eq(privilegedOperations.id, operationId),
						isNull(privilegedOperations.closedAt),
						eq(privilegedOperations.contractDenials, existing.contractDenials),
					),
				)
				.returning();
			const row = updated[0];
			if (!row) {
				const [again] = await db
					.select()
					.from(privilegedOperations)
					.where(eq(privilegedOperations.id, operationId))
					.limit(1);
				const identity = again
					? await loadIdentity(db, again.identityId)
					: null;
				return {
					denials: again?.contractDenials ?? nextDenials,
					closed: again?.closedAt != null,
					identityId: again?.identityId ?? existing.identityId,
					workspaceSessionId: identity?.workspaceSessionId ?? null,
				};
			}
			let closed = row.closedAt != null;
			if (row.contractDenials >= OPENCODE_CONTRACT_DENIAL_LIMIT && !closed) {
				await this.closeOperation(
					operationId,
					"opencode_contract_denial_limit",
				);
				closed = true;
			}
			const identity = await loadIdentity(db, row.identityId);
			return {
				denials: row.contractDenials,
				closed,
				identityId: row.identityId,
				workspaceSessionId: identity?.workspaceSessionId ?? null,
			};
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

		async updateOperationContractState(operationId, expected, next) {
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
				throw new SandboxAuthorityError(
					"operation_closed",
					"Privileged operation is closed.",
				);
			}
			const current = existing.contractState ?? null;
			if (current !== expected) {
				throw new SandboxAuthorityError(
					"contract_state_conflict",
					"Privileged operation contract state does not match.",
				);
			}
			const updated = await db
				.update(privilegedOperations)
				.set({
					contractState: next,
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(
						eq(privilegedOperations.id, operationId),
						isNull(privilegedOperations.closedAt),
						expected == null
							? isNull(privilegedOperations.contractState)
							: eq(privilegedOperations.contractState, expected),
					),
				)
				.returning();
			const row = updated[0];
			if (!row) {
				throw new SandboxAuthorityError(
					"contract_state_conflict",
					"Privileged operation contract state does not match.",
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

		async resolveOutboundRequest(ctx, family, options) {
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
			if (identity.kind === "trusted_brain") {
				throw new SandboxAuthorityError(
					"trusted_windows_closed",
					"Trusted brain callbacks are not admitted in this phase.",
				);
			}
			requireStoredMatch(
				identity.incarnationId,
				ctx.incarnationId,
				"incarnation_mismatch",
				"Sandbox incarnation does not match.",
			);
			await loadLegacyWorkspaceAdmission(db, identity);

			const consume = options?.consume !== false;
			const consumeBudget = sql`(
				${consume ? sql`TRUE` : sql`FALSE`} = FALSE
				OR ${privilegedOperations.maxRequests} IS NULL
				OR ${privilegedOperations.consumedRequests} < ${privilegedOperations.maxRequests}
			)`;
			const nextConsumed = sql`CASE
				WHEN ${consume ? sql`TRUE` : sql`FALSE`} = TRUE
					AND ${privilegedOperations.maxRequests} IS NOT NULL
				THEN ${privilegedOperations.consumedRequests} + 1
				ELSE ${privilegedOperations.consumedRequests}
			END`;
			const updated = await db
				.update(privilegedOperations)
				.set({
					consumedRequests: nextConsumed,
					updatedAt: sql`(unixepoch())`,
				})
				.where(and(liveOutboundOperationSql(ctx, family), consumeBudget))
				.returning();
			if (updated[0]) {
				return {
					identity,
					operation: toOperationHandle(updated[0]),
				};
			}

			const existing = await loadOpenOperation(db, identity.id, family);
			if (!existing) {
				throw new SandboxAuthorityError(
					"operation_not_open",
					`No open ${family} operation for this identity.`,
				);
			}
			if (existing.lifecycleGeneration !== identity.lifecycleGeneration) {
				throw new SandboxAuthorityError(
					"generation_mismatch",
					"Open operation lifecycle generation does not match identity.",
				);
			}
			if (existing.closedAt != null) {
				throw new SandboxAuthorityError(
					"operation_closed",
					"Privileged operation is closed.",
				);
			}
			if (existing.expiresAt.getTime() <= Date.now()) {
				throw new SandboxAuthorityError(
					"operation_expired",
					"Privileged operation has expired.",
				);
			}
			if (
				ctx.runtimeOwnerVersion != null &&
				ctx.runtimeOwnerVersion !== existing.runtimeOwnerVersion
			) {
				throw new SandboxAuthorityError(
					"runtime_owner_mismatch",
					"Privileged operation runtime owner version does not match.",
				);
			}
			requireStoredMatch(
				existing.incarnationId,
				ctx.incarnationId,
				"incarnation_mismatch",
				"Privileged operation incarnation does not match.",
			);
			requireStoredMatch(
				existing.runEpoch,
				ctx.runEpoch,
				"run_epoch_mismatch",
				"Privileged operation run epoch does not match.",
			);
			if (
				consume &&
				existing.maxRequests != null &&
				existing.consumedRequests >= existing.maxRequests
			) {
				throw new SandboxAuthorityError(
					"operation_exhausted",
					"Privileged operation request budget is exhausted.",
				);
			}
			throw new SandboxAuthorityError(
				"runtime_owner_mismatch",
				"Workspace runtime ownership does not admit a legacy operation.",
			);
		},
	};
}
