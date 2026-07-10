import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import { authorizeGitHubRepositoryAccess } from "#/lib/github-authorization";
import { decryptEnvVars } from "#/lib/project-env-vars";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	commitSessionChanges,
	defaultCommitMessageForSession,
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
} from "#/lib/session-git";
import { ensureSessionWorktree } from "#/lib/session-worktree";
import { createTRPCRouter, protectedProcedure } from "../init";

const sessionInputSchema = z.object({
	projectId: z.string().min(1),
	sessionId: z.string().min(1),
});

async function resolveSessionGitContext(options: {
	ctx: {
		env: Env;
		user: { id: string; name: string; email: string };
		auth: Parameters<typeof authorizeGitHubRepositoryAccess>[0]["ctx"]["auth"];
		request: { headers: Headers };
	};
	input: { projectId: string; sessionId: string };
}) {
	const db = createDb(options.ctx.env);
	const [project] = await db
		.select()
		.from(projects)
		.where(
			and(
				eq(projects.id, options.input.projectId),
				eq(projects.userId, options.ctx.user.id),
			),
		)
		.limit(1);

	if (!project) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Project not found.",
		});
	}

	if (!project.githubRepo || !project.githubInstallationId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Project is not linked to a GitHub repository.",
		});
	}

	if (project.status !== "ready" || !project.sandboxId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Project sandbox is not ready.",
		});
	}

	const [session] = await db
		.select()
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.input.sessionId),
				eq(workspaceSessions.projectId, options.input.projectId),
				eq(workspaceSessions.userId, options.ctx.user.id),
				eq(workspaceSessions.status, "active"),
			),
		)
		.limit(1);

	if (!session) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Session not found.",
		});
	}

	await authorizeGitHubRepositoryAccess({
		ctx: options.ctx,
		repo: project.githubRepo,
		installationId: project.githubInstallationId,
	});

	const envVars = await decryptEnvVars(
		project.envVars,
		options.ctx.env.BETTER_AUTH_SECRET,
	);
	await ensureProjectSandbox({
		db,
		env: options.ctx.env,
		project,
		envVars,
	});

	const ensured = await ensureSessionWorktree({
		env: options.ctx.env,
		sandboxId: project.sandboxId,
		sessionId: session.id,
		existing: {
			branchName: session.branchName,
			baseCommitSha: session.baseCommitSha,
			workspacePath: session.workspacePath,
		},
	});

	if (
		session.branchName !== ensured.branchName ||
		session.workspacePath !== ensured.workspacePath ||
		session.baseCommitSha !== ensured.baseCommitSha
	) {
		await db
			.update(workspaceSessions)
			.set({
				branchName: ensured.branchName,
				baseCommitSha: ensured.baseCommitSha,
				workspacePath: ensured.workspacePath,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(workspaceSessions.id, session.id));
	}

	const gitSession = {
		id: session.id,
		branchName: ensured.branchName,
		workspacePath: ensured.workspacePath,
		title: session.title,
	};

	return {
		projectId: project.id,
		githubRepo: project.githubRepo,
		installationId: project.githubInstallationId,
		sandboxId: project.sandboxId,
		session: gitSession,
	};
}

function sessionAuthor(ctx: {
	user: { id: string; name: string; email: string };
}) {
	const email = ctx.user.email?.trim();
	return {
		authorName: ctx.user.name?.trim() || "Ditto user",
		authorEmail: email?.includes("@")
			? email
			: `${ctx.user.id}+ditto@users.noreply.github.com`,
	};
}

export const sessionGitRouter = createTRPCRouter({
	gitStatus: protectedProcedure
		.input(sessionInputSchema)
		.query(async ({ ctx, input }) => {
			const resolved = await resolveSessionGitContext({ ctx, input });
			return await getSessionGitStatus({
				env: ctx.env,
				sandboxId: resolved.sandboxId,
				installationId: resolved.installationId,
				githubRepo: resolved.githubRepo,
				session: resolved.session,
			});
		}),

	commit: protectedProcedure
		.input(
			sessionInputSchema.extend({
				message: z.string().trim().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const resolved = await resolveSessionGitContext({ ctx, input });
			const author = sessionAuthor(ctx);
			return await commitSessionChanges({
				env: ctx.env,
				sandboxId: resolved.sandboxId,
				installationId: resolved.installationId,
				githubRepo: resolved.githubRepo,
				session: resolved.session,
				message:
					input.message ??
					defaultCommitMessageForSession({
						id: resolved.session.id,
						title: resolved.session.title,
					}),
				...author,
			});
		}),

	push: protectedProcedure
		.input(sessionInputSchema)
		.mutation(async ({ ctx, input }) => {
			const resolved = await resolveSessionGitContext({ ctx, input });
			const status = await getSessionGitStatus({
				env: ctx.env,
				sandboxId: resolved.sandboxId,
				installationId: resolved.installationId,
				githubRepo: resolved.githubRepo,
				session: resolved.session,
			});
			if (status.dirty) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Commit local changes before pushing.",
				});
			}
			if (status.ahead <= 0) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Nothing to push for this branch.",
				});
			}
			return await pushSessionBranch({
				env: ctx.env,
				sandboxId: resolved.sandboxId,
				installationId: resolved.installationId,
				githubRepo: resolved.githubRepo,
				session: resolved.session,
			});
		}),

	openPullRequest: protectedProcedure
		.input(
			sessionInputSchema.extend({
				title: z.string().trim().min(1).optional(),
				body: z.string().trim().min(1).optional(),
				baseBranch: z.string().trim().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const resolved = await resolveSessionGitContext({ ctx, input });
			let status = await getSessionGitStatus({
				env: ctx.env,
				sandboxId: resolved.sandboxId,
				installationId: resolved.installationId,
				githubRepo: resolved.githubRepo,
				session: resolved.session,
			});

			if (status.dirty) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Commit local changes before opening a pull request.",
				});
			}

			if (status.ahead > 0) {
				await pushSessionBranch({
					env: ctx.env,
					sandboxId: resolved.sandboxId,
					installationId: resolved.installationId,
					githubRepo: resolved.githubRepo,
					session: resolved.session,
				});
				status = await getSessionGitStatus({
					env: ctx.env,
					sandboxId: resolved.sandboxId,
					installationId: resolved.installationId,
					githubRepo: resolved.githubRepo,
					session: resolved.session,
				});
			}

			try {
				return await openSessionPullRequest({
					env: ctx.env,
					sandboxId: resolved.sandboxId,
					installationId: resolved.installationId,
					githubRepo: resolved.githubRepo,
					session: resolved.session,
					projectId: resolved.projectId,
					title: input.title,
					body: input.body,
					baseBranch: input.baseBranch,
					changedFileCount: status.changedFiles.length,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message:
						error instanceof Error
							? error.message
							: "Failed to open pull request.",
				});
			}
		}),
});
