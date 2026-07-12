import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "#/db";
import { messages, projects, workspaceSessions } from "#/db/schema";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import { archiveOwnedActiveSession } from "#/lib/workspace-session";
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

	const selectedMessages = selectedSession
		? await options.db
				.select()
				.from(messages)
				.where(
					and(
						eq(messages.sessionId, selectedSession.id),
						eq(messages.projectId, options.projectId),
						eq(messages.userId, options.userId),
					),
				)
				.orderBy(asc(messages.createdAt))
		: [];

	return {
		project: stripProjectSecrets(workspace.project),
		sandbox: { state: workspace.sandboxState },
		sessions,
		selectedSession,
		messages: selectedMessages,
		restoreFailed: workspace.restoreFailed,
	};
}

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

			await db
				.update(projects)
				.set({
					status: "ready",
					updatedAt: sql`(unixepoch())`,
				})
				.where(
					and(eq(projects.id, project.id), eq(projects.userId, ctx.user.id)),
				);

			return await loadWorkspaceView({
				db,
				env: ctx.env,
				projectId: input.projectId,
				userId: ctx.user.id,
				sessionId: input.sessionId,
			});
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

			const archived = await archiveOwnedActiveSession({
				db,
				projectId: input.projectId,
				sessionId: input.sessionId,
				userId: ctx.user.id,
			});

			if (!archived) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Session not found.",
				});
			}

			return archived;
		}),
});
