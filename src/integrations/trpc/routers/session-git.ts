import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import {
	DITTO_GIT_AUTHOR_EMAIL,
	DITTO_GIT_AUTHOR_NAME,
} from "#/lib/ditto-git-identity";
import { authorizeGitHubRepositoryAccess } from "#/lib/github-authorization";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	commitSessionChanges,
	defaultCommitMessageForSession,
	GITHUB_APP_PR_PERMISSION_MESSAGE,
	GITHUB_APP_PUSH_PERMISSION_MESSAGE,
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
} from "#/lib/session-git";
import {
	commitSessionChangesWithBackup,
	openSessionPullRequestWithBackup,
	runSessionGitMutationWithBackup,
} from "#/lib/session-git-backup";
import { rethrowOrMapSessionGitMutationError } from "#/lib/session-git-trpc-errors";
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

	await ensureProjectSandbox({
		db,
		env: options.ctx.env,
		project,
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
		db,
		projectId: project.id,
		project: {
			id: project.id,
			userId: project.userId,
			sandboxId: project.sandboxId,
			status: project.status,
		},
		githubRepo: project.githubRepo,
		installationId: project.githubInstallationId,
		sandboxId: project.sandboxId,
		session: gitSession,
	};
}

function sessionAuthor() {
	return {
		authorName: DITTO_GIT_AUTHOR_NAME,
		authorEmail: DITTO_GIT_AUTHOR_EMAIL,
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
			const author = sessionAuthor();
			const message =
				input.message ??
				defaultCommitMessageForSession({
					id: resolved.session.id,
					title: resolved.session.title,
				});
			return await commitSessionChangesWithBackup({
				db: resolved.db,
				env: ctx.env,
				project: resolved.project,
				commit: () =>
					commitSessionChanges({
						env: ctx.env,
						sandboxId: resolved.sandboxId,
						installationId: resolved.installationId,
						githubRepo: resolved.githubRepo,
						session: resolved.session,
						message,
						...author,
					}),
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
			try {
				return await runSessionGitMutationWithBackup({
					db: resolved.db,
					env: ctx.env,
					project: resolved.project,
					run: () =>
						pushSessionBranch({
							env: ctx.env,
							sandboxId: resolved.sandboxId,
							installationId: resolved.installationId,
							githubRepo: resolved.githubRepo,
							session: resolved.session,
						}),
				});
			} catch (error) {
				rethrowOrMapSessionGitMutationError(error, {
					fallbackMessage: "Failed to push branch.",
					forbiddenWhenMessage: GITHUB_APP_PUSH_PERMISSION_MESSAGE,
				});
			}
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

			const pushIfAhead = async (): Promise<boolean> => {
				if (status.ahead <= 0) {
					return false;
				}
				try {
					await pushSessionBranch({
						env: ctx.env,
						sandboxId: resolved.sandboxId,
						installationId: resolved.installationId,
						githubRepo: resolved.githubRepo,
						session: resolved.session,
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Failed to push branch.";
					throw new TRPCError({
						code:
							message === GITHUB_APP_PUSH_PERMISSION_MESSAGE
								? "FORBIDDEN"
								: "BAD_GATEWAY",
						message,
					});
				}
				status = await getSessionGitStatus({
					env: ctx.env,
					sandboxId: resolved.sandboxId,
					installationId: resolved.installationId,
					githubRepo: resolved.githubRepo,
					session: resolved.session,
				});
				return true;
			};

			try {
				return await openSessionPullRequestWithBackup({
					db: resolved.db,
					env: ctx.env,
					project: resolved.project,
					pushIfNeeded: pushIfAhead,
					open: () =>
						openSessionPullRequest({
							env: ctx.env,
							sandboxId: resolved.sandboxId,
							installationId: resolved.installationId,
							githubRepo: resolved.githubRepo,
							session: resolved.session,
							title: input.title,
							body: input.body,
							baseBranch: input.baseBranch,
						}),
				});
			} catch (error) {
				rethrowOrMapSessionGitMutationError(error, {
					fallbackMessage: "Failed to open pull request.",
					forbiddenWhenMessage: GITHUB_APP_PR_PERMISSION_MESSAGE,
				});
			}
		}),
});
