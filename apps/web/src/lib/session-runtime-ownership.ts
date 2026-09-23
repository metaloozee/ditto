import { and, eq, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import { workspaceSessions } from "#/db/schema";

export const RUNTIME_OWNERS = [
	"legacy",
	"migrating",
	"trusted_v1",
	"blocked",
] as const;
export type RuntimeOwner = (typeof RUNTIME_OWNERS)[number];
type Db = ReturnType<typeof createDb>;
export type RuntimeOwnedSession = Pick<
	typeof workspaceSessions.$inferSelect,
	"id" | "runtimeOwner" | "runtimeOwnerVersion"
>;

export class RuntimeOwnershipError extends Error {
	constructor(
		readonly code:
			| "runtime_owner_mismatch"
			| "runtime_owner_transition_conflict",
		message: string,
	) {
		super(message);
		this.name = "RuntimeOwnershipError";
	}
}

export function assertRuntimeOwner(options: {
	session: RuntimeOwnedSession;
	expectedOwner: "legacy" | "trusted_v1";
	ownerVersion: number;
}): void {
	if (
		options.session.runtimeOwner !== options.expectedOwner ||
		options.session.runtimeOwnerVersion !== options.ownerVersion
	) {
		throw new RuntimeOwnershipError(
			"runtime_owner_mismatch",
			"Workspace runtime ownership changed.",
		);
	}
}

const transitions: Record<RuntimeOwner, readonly RuntimeOwner[]> = {
	legacy: ["migrating"],
	migrating: ["legacy", "trusted_v1", "blocked"],
	trusted_v1: ["migrating", "blocked"],
	blocked: ["migrating"],
};

export async function transitionRuntimeOwner(options: {
	db: Db;
	sessionId: string;
	from: RuntimeOwner;
	fromVersion: number;
	to: RuntimeOwner;
}): Promise<RuntimeOwnedSession> {
	if (!transitions[options.from].includes(options.to)) {
		throw new RuntimeOwnershipError(
			"runtime_owner_transition_conflict",
			`Transition ${options.from} -> ${options.to} is not allowed.`,
		);
	}
	const [updated] = await options.db
		.update(workspaceSessions)
		.set({
			runtimeOwner: options.to,
			runtimeOwnerVersion: sql`${workspaceSessions.runtimeOwnerVersion} + 1`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.runtimeOwner, options.from),
				eq(workspaceSessions.runtimeOwnerVersion, options.fromVersion),
			),
		)
		.returning({
			id: workspaceSessions.id,
			runtimeOwner: workspaceSessions.runtimeOwner,
			runtimeOwnerVersion: workspaceSessions.runtimeOwnerVersion,
		});
	if (!updated) {
		throw new RuntimeOwnershipError(
			"runtime_owner_transition_conflict",
			"Workspace runtime ownership changed before transition.",
		);
	}
	return updated;
}

export function matchingLegacyOwner(sessionId: string, ownerVersion: number) {
	return and(
		eq(workspaceSessions.id, sessionId),
		eq(workspaceSessions.runtimeOwner, "legacy"),
		eq(workspaceSessions.runtimeOwnerVersion, ownerVersion),
	);
}

export function legacyOwnerSql(sessionId: string, ownerVersion?: number) {
	return sql`EXISTS (SELECT 1 FROM workspace_sessions AS owner_session WHERE owner_session.id = ${sessionId} AND owner_session.runtimeOwner = 'legacy'${ownerVersion === undefined ? sql`` : sql` AND owner_session.runtimeOwnerVersion = ${ownerVersion}`})`;
}

export function legacyOwnedSessionRecencyUpdate(
	db: Db,
	sessionId: string,
	ownerVersion: number,
) {
	return db
		.update(workspaceSessions)
		.set({ updatedAt: sql`(unixepoch())` })
		.where(matchingLegacyOwner(sessionId, ownerVersion))
		.returning({ id: workspaceSessions.id });
}

export function ownershipConflictFromEmptyBatch(): {
	kind: "error";
	status: 409;
	body: { error: string };
} {
	return {
		kind: "error",
		status: 409,
		body: { error: "Workspace runtime ownership changed." },
	};
}

export function isEmptyReturning(rows: unknown): boolean {
	return !Array.isArray(rows) || rows.length === 0;
}
