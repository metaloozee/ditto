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
	runPushThenOpenPullRequest,
	SESSION_GIT_OPEN_PR_DIRTY_MESSAGE,
	SessionGitExportPreconditionError,
	sessionGitOpenPullRequestBlocker,
} from "#/lib/session-git-export";
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
				const preview = await deps.getSessionGitStatus(gitCtx(ctx));
				if (preview.dirty) {
					throw new SessionGitMetadataError(
						"snapshot_failed",
						SESSION_GIT_OPEN_PR_DIRTY_MESSAGE,
					);
				}
				if (preview.workflow.kind === "open-pr-existing") {
					result = {
						url: preview.workflow.pullRequest.url,
						number: preview.workflow.pullRequest.number,
					};
					return;
				}
				const blocker = sessionGitOpenPullRequestBlocker(preview.workflow);
				if (blocker) {
					throw new SessionGitMetadataError("snapshot_failed", blocker);
				}

				const generated = await deps.generatePullRequestMetadata(gitCtx(ctx));

				try {
					const outcome = await runPushThenOpenPullRequest({
						ctx: { ...gitCtx(ctx), bypassWorkspaceLock: true },
						deps: {
							getSessionGitStatus: deps.getSessionGitStatus,
							pushSessionBranch: deps.pushSessionBranch,
							openSessionPullRequest: deps.openSessionPullRequest,
						},
						title: generated.title,
						body: generated.body,
						existingPullRequestPolicy: "shortCircuit",
						initialStatus: preview,
						onDidPush: () => {
							didPush = true;
						},
					});
					result = { ...outcome, title: generated.title };
				} catch (error) {
					if (error instanceof SessionGitExportPreconditionError) {
						throw new SessionGitMetadataError("snapshot_failed", error.message);
					}
					throw error;
				}
			},
		});
	} catch (error) {
		actionError = error;
	}

	if (didPush) {
		await deps.bestEffortPersistSessionGitBackup({
			db: ctx.db,
			env: ctx.env,
			project: ctx.project,
		});
	}
	if (actionError) throw actionError;
	if (!result) {
		throw new SessionGitMetadataError(
			"agent_failed",
			"Pull request action completed without a result.",
		);
	}
	return result;
}
