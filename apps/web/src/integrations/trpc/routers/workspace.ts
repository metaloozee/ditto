import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "#/db";
import { messages, projects, workspaceSessions } from "#/db/schema";
import {
	decodeMessageCursor,
	encodeMessageCursor,
	MessageCursorError,
	messageCursorFromRow,
	messageCursorOlderThanInputs,
} from "#/lib/message-cursor";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	archiveSessionWithPreviewCleanup,
	SessionPreviewError,
} from "#/lib/session-preview";
import { loadOwnedActiveSession } from "#/lib/workspace-session";
import { createTRPCRouter, protectedProcedure } from "../init";

async function loadProjectOrThrow(options: {
	db: ReturnType<typeof createDb>;
	projectId: string;
	userId: string;
}) {
	const [project] = await options.db
		.select()
		.from(projects)
		.where(
			and(
				eq(projects.id, options.projectId),
				eq(projects.userId, options.userId),
			),
		)
		.limit(1);

	if (!project) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Project not found.",
		});
	}

	return project;
}

function stripProjectSecrets(project: typeof projects.$inferSelect) {
	const {
		envVars: _envVars,
		sandboxBackup: _sandboxBackup,
		sandboxBackupCreatedAt: _sandboxBackupCreatedAt,
		...rest
	} = project;

	return rest;
}

async function ensureProjectWorkspace(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<{
	project: typeof projects.$inferSelect;
	sandboxState: string;
	restoreFailed: boolean;
}> {
	if (options.project.status !== "ready" || !options.project.sandboxId) {
		return {
			project: options.project,
			sandboxState: options.project.status,
			restoreFailed: options.project.status === "failed",
		};
	}

	try {
		const ensured = await ensureProjectSandbox({
			db: options.db,
			env: options.env,
			project: options.project,
		});

		return {
			project: ensured.project,
			sandboxState: ensured.state,
			restoreFailed: false,
		};
	} catch {
		return {
			project: options.project,
			sandboxState: "failed",
			restoreFailed: true,
		};
	}
}

async function loadWorkspaceView(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	projectId: string;
	userId: string;
	sessionId?: string | null;
}) {
	const project = await loadProjectOrThrow(options);
	const [sessions, workspace] = await Promise.all([
		options.db
			.select()
			.from(workspaceSessions)
			.where(
				and(
					eq(workspaceSessions.projectId, options.projectId),
					eq(workspaceSessions.userId, options.userId),
					eq(workspaceSessions.status, "active"),
				),
			)
			.orderBy(desc(workspaceSessions.updatedAt)),
		ensureProjectWorkspace({
			db: options.db,
			env: options.env,
			project,
		}),
	]);

	const selectedSession = options.sessionId
		? (sessions.find((session) => session.id === options.sessionId) ?? null)
		: null;

	return {
		project: stripProjectSecrets(workspace.project),
		sandbox: { state: workspace.sandboxState },
		sessions,
		selectedSession,
		restoreFailed: workspace.restoreFailed,
	};
}

const messageRowid = sql<number>`rowid`.mapWith(Number);

export const workspaceRouter = createTRPCRouter({
	ensureWorkspace: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			return await loadWorkspaceView({
				db,
				env: ctx.env,
				projectId: input.projectId,
				userId: ctx.user.id,
				sessionId: input.sessionId,
			});
		}),

	retryRestore: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const project = await loadProjectOrThrow({
				db,
				projectId: input.projectId,
				userId: ctx.user.id,
			});

			const [restored] = await db
				.update(projects)
				.set({
					status: "ready",
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(
						eq(projects.id, project.id),
						eq(projects.userId, ctx.user.id),
						eq(projects.status, "failed"),
						sql`${projects.deletingAt} IS NULL`,
					),
				)
				.returning({ id: projects.id });

			if (!restored) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Project cannot be restored.",
				});
			}

			return await loadWorkspaceView({
				db,
				env: ctx.env,
				projectId: input.projectId,
				userId: ctx.user.id,
				sessionId: input.sessionId,
			});
		}),

	/**
	 * Cursor-paged messages for a session (newest page first).
	 * `nextCursor` fetches *older* messages; items are chronological within the page.
	 */
	messages: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1),
				cursor: z.string().min(1).optional(),
				/** Default 50; values above 100 are clamped to 100. */
				limit: z.number().int().min(1).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const db = createDb(ctx.env);
			const session = await loadOwnedActiveSession({
				db,
				projectId: input.projectId,
				sessionId: input.sessionId,
				userId: ctx.user.id,
			});

			if (!session) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found.",
				});
			}

			const limit = Math.min(input.limit ?? 50, 100);

			const baseConditions = and(
				eq(messages.sessionId, input.sessionId),
				eq(messages.projectId, input.projectId),
				eq(messages.userId, ctx.user.id),
			);

			let whereClause = baseConditions;
			if (input.cursor) {
				let decoded: ReturnType<typeof decodeMessageCursor>;
				try {
					decoded = decodeMessageCursor(input.cursor);
				} catch (error) {
					if (error instanceof MessageCursorError) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: error.message,
						});
					}
					throw error;
				}
				const older = messageCursorOlderThanInputs(decoded);
				const olderThan = or(
					lt(messages.createdAt, older.createdAtDate),
					and(
						eq(messages.createdAt, older.createdAtDate),
						lt(messageRowid, older.rowid),
					),
				);
				whereClause = and(baseConditions, olderThan);
			}

			const rows = await db
				.select({
					id: messages.id,
					sessionId: messages.sessionId,
					projectId: messages.projectId,
					userId: messages.userId,
					role: messages.role,
					content: messages.content,
					model: messages.model,
					tools: messages.tools,
					status: messages.status,
					createdAt: messages.createdAt,
					rowid: messageRowid,
				})
				.from(messages)
				.where(whereClause)
				.orderBy(desc(messages.createdAt), desc(messageRowid))
				.limit(limit + 1);

			const hasMore = rows.length > limit;
			const pageDesc = hasMore ? rows.slice(0, limit) : rows;
			const oldest = pageDesc[pageDesc.length - 1];
			const nextCursor =
				hasMore && oldest
					? encodeMessageCursor(
							messageCursorFromRow(oldest.createdAt, oldest.rowid),
						)
					: null;

			// Reverse to chronological (oldest → newest) for the client timeline.
			const items = pageDesc
				.slice()
				.reverse()
				.map(({ rowid: _rowid, ...item }) => item);

			return { items, nextCursor };
		}),

	deleteSession: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				sessionId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const db = createDb(ctx.env);

			try {
				return await archiveSessionWithPreviewCleanup({
					db,
					env: ctx.env,
					projectId: input.projectId,
					sessionId: input.sessionId,
					userId: ctx.user.id,
				});
			} catch (error) {
				if (error instanceof SessionPreviewError) {
					if (error.code === "not_found") {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Session not found.",
						});
					}
					if (error.code === "cleanup_failed" || error.code === "busy") {
						throw new TRPCError({
							code:
								error.code === "busy" ? "PRECONDITION_FAILED" : "BAD_GATEWAY",
							message: error.message,
						});
					}
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: error.message,
					});
				}
				throw error;
			}
		}),
});
