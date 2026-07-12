import { and, eq, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import { workspaceSessions } from "#/db/schema";

export type WorkspaceSessionDb = ReturnType<typeof createDb>;

export type OwnedActiveSession = typeof workspaceSessions.$inferSelect;

/**
 * Load a workspace session owned by the user within the project that is
 * currently active. Archived / missing / other-user rows return null.
 */
export async function loadOwnedActiveSession(options: {
	db: WorkspaceSessionDb;
	projectId: string;
	sessionId: string;
	userId: string;
}): Promise<OwnedActiveSession | null> {
	const [session] = await options.db
		.select()
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
				eq(workspaceSessions.status, "active"),
			),
		)
		.limit(1);

	return session ?? null;
}

/**
 * Resolve which session a message-write path should use.
 *
 * - No explicit ID → caller should create a new active session.
 * - Explicit ID that is owned + active → use it.
 * - Explicit ID missing / archived / not owned → not_found (never create a replacement).
 */
export async function resolveSessionForMessageWrite(options: {
	db: WorkspaceSessionDb;
	projectId: string;
	userId: string;
	sessionId?: string | null;
}): Promise<
	| { kind: "create" }
	| { kind: "existing"; session: OwnedActiveSession }
	| { kind: "not_found" }
> {
	if (!options.sessionId) {
		return { kind: "create" };
	}

	const session = await loadOwnedActiveSession({
		db: options.db,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
	});

	if (!session) {
		return { kind: "not_found" };
	}

	return { kind: "existing", session };
}

/**
 * Archive an owned active session. Returns the session id on success, or null
 * when the session is missing, already archived, or not owned.
 */
export async function archiveOwnedActiveSession(options: {
	db: WorkspaceSessionDb;
	projectId: string;
	sessionId: string;
	userId: string;
}): Promise<{ id: string } | null> {
	const session = await loadOwnedActiveSession(options);
	if (!session) {
		return null;
	}

	await options.db
		.update(workspaceSessions)
		.set({ status: "archived" })
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
				eq(workspaceSessions.status, "active"),
			),
		);

	return { id: session.id };
}

/** Drizzle update fragment that bumps session recency with the D1 clock. */
export function workspaceSessionRecencyUpdate(
	db: WorkspaceSessionDb,
	sessionId: string,
) {
	return db
		.update(workspaceSessions)
		.set({ updatedAt: sql`(unixepoch())` })
		.where(eq(workspaceSessions.id, sessionId));
}
