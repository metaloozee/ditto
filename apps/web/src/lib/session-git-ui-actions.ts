import type { createDb } from "#/db";
import {
	DITTO_GIT_AUTHOR_EMAIL,
	DITTO_GIT_AUTHOR_NAME,
} from "#/lib/ditto-git-identity";
import type { PersistProjectSandboxBackupProject } from "#/lib/project-sandbox";
import {
	commitSessionChanges,
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
	type SessionGitSession,
} from "#/lib/session-git";
import { bestEffortPersistSessionGitBackup } from "#/lib/session-git-backup";
import {
	generateCommitMetadata,
	generatePullRequestMetadata,
	SessionGitMetadataError,
} from "#/lib/session-git-metadata";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";

export type SessionGitUiActionContext = {
	env: Env;
	db: ReturnType<typeof createDb>;
	project: PersistProjectSandboxBackupProject;
	sandboxId: string;
	installationId: number;
	githubRepo: string;
	session: SessionGitSession;
	knownSecrets?: readonly string[];
};

export type SessionGitUiActionDeps = {
	withSessionWorkspaceLock: typeof withSessionWorkspaceLock;
	getSessionGitStatus: typeof getSessionGitStatus;
	generateCommitMetadata: typeof generateCommitMetadata;
	generatePullRequestMetadata: typeof generatePullRequestMetadata;
	commitSessionChanges: typeof commitSessionChanges;
	pushSessionBranch: typeof pushSessionBranch;
	openSessionPullRequest: typeof openSessionPullRequest;
	bestEffortPersistSessionGitBackup: typeof bestEffortPersistSessionGitBackup;
};

const defaultDeps: SessionGitUiActionDeps = {
	withSessionWorkspaceLock,
	getSessionGitStatus,
	generateCommitMetadata,
	generatePullRequestMetadata,
	commitSessionChanges,
	pushSessionBranch,
	openSessionPullRequest,
	bestEffortPersistSessionGitBackup,
};

function gitCtx(ctx: SessionGitUiActionContext) {
	return {
		env: ctx.env,
		sandboxId: ctx.sandboxId,
		installationId: ctx.installationId,
		githubRepo: ctx.githubRepo,
		session: ctx.session,
		knownSecrets: ctx.knownSecrets,
	};
}

function preconditionMessage(
	workflow: Awaited<ReturnType<typeof getSessionGitStatus>>["workflow"],
): string {
	if (workflow.kind === "merged-pr") {
		return "This session pull request has already been merged.";
	}
	if (workflow.kind === "closed-pr") {
		return "This session pull request is closed.";
	}
	if (workflow.kind === "unavailable") {
		return workflow.reason === "worktree"
			? "Session worktree is not ready."
			: "GitHub status is currently unavailable.";
	}
	if (workflow.kind === "sync") {
		return `Sync the latest ${workflow.baseBranch} before opening a pull request.`;
	}
	return "This session has no changes to open as a pull request.";
}

export async function commitSessionChangesWithGeneratedMessage(
	ctx: SessionGitUiActionContext,
	deps: SessionGitUiActionDeps = defaultDeps,
): Promise<{ commitSha: string | null; committed: boolean; message?: string }> {
	let committed = false;
	let commitSha: string | null = null;
	let message: string | undefined;

	await deps.withSessionWorkspaceLock({
		env: ctx.env,
		sandboxId: ctx.sandboxId,
		sessionId: ctx.session.id,
		run: async () => {
			const generated = await deps.generateCommitMetadata(gitCtx(ctx));
			if (generated.kind === "no_changes") {
				committed = false;
				commitSha = null;
				return;
			}
			const result = await deps.commitSessionChanges({
				...gitCtx(ctx),
				message: generated.message,
				authorName: DITTO_GIT_AUTHOR_NAME,
				authorEmail: DITTO_GIT_AUTHOR_EMAIL,
				bypassWorkspaceLock: true,
			});
			committed = result.committed;
			commitSha = result.commitSha;
			// Only surface the generated message when a commit was actually created.
			if (result.committed) {
				message = generated.message;
			}
		},
	});

	if (committed) {
		await deps.bestEffortPersistSessionGitBackup({
			db: ctx.db,
			env: ctx.env,
			project: ctx.project,
		});
	}

	return message === undefined
		? { commitSha, committed }
		: { commitSha, committed, message };
}

export async function openSessionPullRequestWithGeneratedMetadata(
	ctx: SessionGitUiActionContext,
	deps: SessionGitUiActionDeps = defaultDeps,
): Promise<{ url: string; number: number; title?: string }> {
	let didPush = false;
	let result: { url: string; number: number; title?: string } | undefined;
	let actionError: unknown;

	try {
		await deps.withSessionWorkspaceLock({
			env: ctx.env,
			sandboxId: ctx.sandboxId,
			sessionId: ctx.session.id,
			run: async () => {
				let status = await deps.getSessionGitStatus(gitCtx(ctx));

				if (status.dirty) {
					throw new SessionGitMetadataError(
						"snapshot_failed",
						"Commit local changes before opening a pull request.",
					);
				}

				if (status.workflow.kind === "open-pr-existing") {
					result = {
						url: status.workflow.pullRequest.url,
						number: status.workflow.pullRequest.number,
					};
					return;
				}

				if (
					status.workflow.kind !== "open-pr" &&
					status.workflow.kind !== "push"
				) {
					throw new SessionGitMetadataError(
						"snapshot_failed",
						preconditionMessage(status.workflow),
					);
				}

				const generated = await deps.generatePullRequestMetadata(gitCtx(ctx));

				if (status.workflow.kind === "push") {
					await deps.pushSessionBranch({
						...gitCtx(ctx),
						bypassWorkspaceLock: true,
					});
					didPush = true;
					status = await deps.getSessionGitStatus(gitCtx(ctx));
					if (status.workflow.kind === "open-pr-existing") {
						result = {
							url: status.workflow.pullRequest.url,
							number: status.workflow.pullRequest.number,
							title: generated.title,
						};
						return;
					}
					if (status.workflow.kind !== "open-pr") {
						throw new SessionGitMetadataError(
							"snapshot_failed",
							preconditionMessage(status.workflow),
						);
					}
				}

				const opened = await deps.openSessionPullRequest({
					...gitCtx(ctx),
					title: generated.title,
					body: generated.body,
				});
				result = {
					url: opened.url,
					number: opened.number,
					title: generated.title,
				};
			},
		});
	} catch (error) {
		actionError = error;
	}

	// Push mutates the remote/sandbox; always attempt backup after the lock
	// releases, including when the subsequent open-PR call failed.
	if (didPush) {
		await deps.bestEffortPersistSessionGitBackup({
			db: ctx.db,
			env: ctx.env,
			project: ctx.project,
		});
	}

	if (actionError) {
		throw actionError;
	}
	if (!result) {
		throw new SessionGitMetadataError(
			"agent_failed",
			"Pull request action completed without a result.",
		);
	}
	return result;
}
