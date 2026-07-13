import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import {
	DITTO_GIT_AUTHOR_EMAIL,
	DITTO_GIT_AUTHOR_NAME,
} from "#/lib/ditto-git-identity";
import { GitSecretPolicyError } from "#/lib/git-secret-policy";
import { authorizeGitHubRepositoryAccess } from "#/lib/github-authorization";
import { decryptEnvVars } from "#/lib/project-env-vars";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	commitSessionChanges,
	defaultCommitMessageForSession,
	GITHUB_APP_PR_PERMISSION_MESSAGE,
	GITHUB_APP_PUSH_PERMISSION_MESSAGE,
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
	SessionGitSyncPreconditionError,
	syncSessionBranch,
} from "#/lib/session-git";
import {
	commitSessionChangesWithBackup,
	openSessionPullRequestWithBackup,
	runSessionGitMutationWithBackup,
} from "#/lib/session-git-backup";
import { rethrowOrMapSessionGitMutationError } from "#/lib/session-git-trpc-errors";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import { ensureSessionWorktree } from "#/lib/session-worktree";
import { loadOwnedActiveSession } from "#/lib/workspace-session";
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

	const session = await loadOwnedActiveSession({
		db,
		projectId: options.input.projectId,
		sessionId: options.input.sessionId,
		userId: options.ctx.user.id,
	});

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
		githubRepo: project.githubRepo,
		installationId: project.githubInstallationId,
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
		baseCommitSha: ensured.baseCommitSha,
		workspacePath: ensured.workspacePath,
		title: session.title,
	};

	// Server-only secret values for push preflight; never returned to clients.
	const envVars = await decryptEnvVars(
		project.envVars,
		options.ctx.env.BETTER_AUTH_SECRET,
	);
	const knownSecrets = envVars.map((envVar) => envVar.value);

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
		knownSecrets,
	};
}

function mapSessionGitExportError(error: unknown): never {
	if (error instanceof GitSecretPolicyError) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: error.message,
		});
	}
	if (error instanceof TRPCError) {
		throw error;
	}
	throw error;
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
			try {
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
			} catch (error) {
				if (error instanceof SessionWorkspaceBusyError) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: error.message,
					});
				}
				throw error;
			}
		}),

	sync: protectedProcedure
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
			if (status.workflow.kind !== "sync") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "This session is already synchronized with its base branch.",
				});
			}
			const baseBranch = status.workflow.baseBranch;
			try {
				const result = await runSessionGitMutationWithBackup({
					db: resolved.db,
					env: ctx.env,
					project: resolved.project,
					run: () =>
						syncSessionBranch({
							env: ctx.env,
							sandboxId: resolved.sandboxId,
							installationId: resolved.installationId,
							githubRepo: resolved.githubRepo,
							session: resolved.session,
							baseBranch,
						}),
				});

				if (result.baseCommitSha !== resolved.session.baseCommitSha) {
					await resolved.db
						.update(workspaceSessions)
						.set({
							baseCommitSha: result.baseCommitSha,
							updatedAt: sql`(unixepoch())`,
						})
						.where(eq(workspaceSessions.id, resolved.session.id));
				}

				return result;
			} catch (error) {
				if (error instanceof SessionGitSyncPreconditionError) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: error.message,
					});
				}
				rethrowOrMapSessionGitMutationError(error, {
					fallbackMessage: "Failed to sync session with the base branch.",
					forbiddenWhenMessage: GITHUB_APP_PUSH_PERMISSION_MESSAGE,
				});
			}
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
			if (status.workflow.kind !== "push") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						status.workflow.kind === "sync"
							? `Sync the latest ${status.workflow.baseBranch} before pushing.`
							: "Nothing to push for this branch.",
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
							knownSecrets: resolved.knownSecrets,
						}),
				});
			} catch (error) {
				if (error instanceof GitSecretPolicyError) {
					mapSessionGitExportError(error);
				}
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
				if (status.workflow.kind !== "push") {
					return false;
				}
				try {
					await pushSessionBranch({
						env: ctx.env,
						sandboxId: resolved.sandboxId,
						installationId: resolved.installationId,
						githubRepo: resolved.githubRepo,
						session: resolved.session,
						knownSecrets: resolved.knownSecrets,
					});
				} catch (error) {
					if (error instanceof GitSecretPolicyError) {
						mapSessionGitExportError(error);
					}
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
					open: () => {
						if (
							status.workflow.kind !== "open-pr" &&
							status.workflow.kind !== "open-pr-existing"
						) {
							const message =
								status.workflow.kind === "merged-pr"
									? "This session pull request has already been merged."
									: status.workflow.kind === "closed-pr"
										? "This session pull request is closed."
										: status.workflow.kind === "unavailable"
											? "GitHub status is currently unavailable."
											: status.workflow.kind === "sync"
												? `Sync the latest ${status.workflow.baseBranch} before opening a pull request.`
												: "This session has no changes to open as a pull request.";
							throw new TRPCError({
								code: "PRECONDITION_FAILED",
								message,
							});
						}
						return openSessionPullRequest({
							env: ctx.env,
							sandboxId: resolved.sandboxId,
							installationId: resolved.installationId,
							githubRepo: resolved.githubRepo,
							session: resolved.session,
							title: input.title,
							body: input.body,
							baseBranch: input.baseBranch,
						});
					},
				});
			} catch (error) {
				rethrowOrMapSessionGitMutationError(error, {
					fallbackMessage: "Failed to open pull request.",
					forbiddenWhenMessage: GITHUB_APP_PR_PERMISSION_MESSAGE,
				});
			}
		}),
});
