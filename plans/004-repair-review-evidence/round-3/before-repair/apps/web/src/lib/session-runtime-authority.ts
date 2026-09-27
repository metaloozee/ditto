import { and, eq } from "drizzle-orm";
import type { createDb } from "#/db";
import {
	projects,
	sandboxIdentities,
	sessionCommandKeys,
	workspaceCapacityLeases,
	workspaceSessions,
} from "#/db/schema";
import { reconstructAdmittedCommandV1 } from "#/lib/session-command";
import {
	applyProductProjectionBatch,
	type D1Like,
	type ProjectionPayload,
} from "../../../runtime/src/product-projector.js";
import type {
	CurrentAuthority,
	ExecutionPrerequisites,
	ProductAdapters,
	ReconstructedAdmission,
} from "../../../runtime/src/session-runtime.js";

type Db = ReturnType<typeof createDb>;

export async function readCurrentTrustedAuthority(
	db: Db,
	input: {
		workspaceSessionId: string;
		userId: string;
		projectId: string;
	},
): Promise<CurrentAuthority | null> {
	const [session] = await db
		.select({
			id: workspaceSessions.id,
			userId: workspaceSessions.userId,
			projectId: workspaceSessions.projectId,
			status: workspaceSessions.status,
			runtimeOwner: workspaceSessions.runtimeOwner,
			runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
		})
		.from(workspaceSessions)
		.where(eq(workspaceSessions.id, input.workspaceSessionId))
		.limit(1);
	if (
		!session ||
		session.userId !== input.userId ||
		session.projectId !== input.projectId
	) {
		return null;
	}
	const [project] = await db
		.select({
			id: projects.id,
			userId: projects.userId,
			status: projects.status,
		})
		.from(projects)
		.where(
			and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)),
		)
		.limit(1);
	if (!project) return null;
	const identities = await db
		.select({
			identityId: sandboxIdentities.id,
			kind: sandboxIdentities.kind,
			incarnationId: sandboxIdentities.incarnationId,
			lifecycleGeneration: sandboxIdentities.lifecycleGeneration,
			state: sandboxIdentities.state,
			controllerClass: sandboxIdentities.controllerClass,
			retiredAt: sandboxIdentities.retiredAt,
		})
		.from(sandboxIdentities)
		.where(
			and(
				eq(sandboxIdentities.userId, input.userId),
				eq(sandboxIdentities.projectId, input.projectId),
				eq(sandboxIdentities.workspaceSessionId, input.workspaceSessionId),
			),
		);
	const processIdentities = identities.flatMap((row) => {
		if (
			typeof row.incarnationId !== "string" ||
			row.incarnationId.length === 0 ||
			row.retiredAt != null ||
			row.state === "destroyed" ||
			row.state === "destroying"
		) {
			return [];
		}
		return [
			{
				identityId: row.identityId,
				kind: row.kind,
				incarnationId: row.incarnationId,
				lifecycleGeneration: row.lifecycleGeneration,
				state: row.state,
				controllerClass: row.controllerClass,
			},
		];
	});
	const [lease] = await db
		.select({
			identityId: workspaceCapacityLeases.identityId,
			expiresAt: workspaceCapacityLeases.expiresAt,
		})
		.from(workspaceCapacityLeases)
		.where(
			and(
				eq(workspaceCapacityLeases.sessionId, input.workspaceSessionId),
				eq(workspaceCapacityLeases.userId, input.userId),
			),
		)
		.limit(1);
	const lifecycleGeneration =
		processIdentities.length === 0
			? 0
			: Math.max(...processIdentities.map((row) => row.lifecycleGeneration));
	return {
		userId: session.userId,
		projectId: session.projectId,
		workspaceSessionId: session.id,
		runtimeOwner: session.runtimeOwner,
		runtimeOwnerVersion: session.runtimeOwnerVersion,
		sessionStatus: session.status,
		projectStatus: project.status,
		lifecycleGeneration,
		processIdentities,
		capacityLeaseIdentityId: lease?.identityId ?? null,
		capacityExpiresAt: lease ? Number(lease.expiresAt) : null,
	};
}

export async function reconstructCoordinatorCommand(
	db: Db,
	commandId: string,
): Promise<ReconstructedAdmission | null> {
	const command = await reconstructAdmittedCommandV1(db, commandId);
	if (!command) return null;
	const [key] = await db
		.select({
			receiptId: sessionCommandKeys.receiptId,
			canonicalPayloadHash: sessionCommandKeys.canonicalPayloadHash,
		})
		.from(sessionCommandKeys)
		.where(eq(sessionCommandKeys.commandId, commandId))
		.limit(1);
	if (!key) return null;
	return {
		command,
		receiptId: key.receiptId,
		payloadHash: key.canonicalPayloadHash,
	};
}

export async function readTrustedExecutionPrerequisites(
	_db: Db,
	_input: {
		workspaceSessionId: string;
		userId: string;
		projectId: string;
	},
): Promise<ExecutionPrerequisites | null> {
	return null;
}

export function createProductAdapters(db: Db, d1: D1Like): ProductAdapters {
	return {
		reconstructCommand: (commandId) =>
			reconstructCoordinatorCommand(db, commandId),
		readCurrentAuthority: (input) => readCurrentTrustedAuthority(db, input),
		readExecutionPrerequisites: (input) =>
			readTrustedExecutionPrerequisites(db, input),
		applyProjections: (payloads: ProjectionPayload[], now: number) =>
			applyProductProjectionBatch(d1, payloads, now),
	};
}

export async function assertObservationMembership(options: {
	db: Db;
	userId: string;
	projectId: string;
	sessionId: string;
}): Promise<CurrentAuthority> {
	const authority = await readCurrentTrustedAuthority(options.db, {
		workspaceSessionId: options.sessionId,
		userId: options.userId,
		projectId: options.projectId,
	});
	if (
		!authority ||
		authority.userId !== options.userId ||
		authority.projectId !== options.projectId ||
		authority.workspaceSessionId !== options.sessionId
	) {
		throw new ObservationAccessError("not_found", "not_found");
	}
	return authority;
}

export class ObservationAccessError extends Error {
	constructor(
		readonly code: string,
		readonly category: string,
	) {
		super(category);
		this.name = "ObservationAccessError";
	}
}
