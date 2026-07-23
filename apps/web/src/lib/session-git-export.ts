import type {
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
	SessionGitSession,
	SessionGitWorkflow,
} from "#/lib/session-git";

export const SESSION_WORKTREE_UNAVAILABLE_MESSAGE =
	"Session worktree is not ready.";

export const SESSION_GIT_OPEN_PR_DIRTY_MESSAGE =
	"Commit local changes before opening a pull request.";

/**
 * Returns a user-facing blocker message when the workflow cannot proceed to
 * push-then-open / open-PR. Returns null when the workflow is allowed:
 * open-pr | push | open-pr-existing.
 *
 * Messages MUST match session-git-ui-actions preconditionMessage (028 worktree split).
 */
export function sessionGitOpenPullRequestBlocker(
	workflow: SessionGitWorkflow,
): string | null {
	if (
		workflow.kind === "open-pr" ||
		workflow.kind === "push" ||
		workflow.kind === "open-pr-existing"
	) {
		return null;
	}
	if (workflow.kind === "merged-pr") {
		return "This session pull request has already been merged.";
	}
	if (workflow.kind === "closed-pr") {
		return "This session pull request is closed.";
	}
	if (workflow.kind === "unavailable") {
		return workflow.reason === "worktree"
			? SESSION_WORKTREE_UNAVAILABLE_MESSAGE
			: "GitHub status is currently unavailable.";
	}
	if (workflow.kind === "sync") {
		return `Sync the latest ${workflow.baseBranch} before opening a pull request.`;
	}
	// commit | idle | any future kind → same default as ui-actions
	return "This session has no changes to open as a pull request.";
}

export class SessionGitExportPreconditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionGitExportPreconditionError";
	}
}

export type SessionGitExportGitContext = {
	env: Env;
	sandboxId: string;
	installationId: number;
	githubRepo: string;
	session: SessionGitSession;
	knownSecrets?: readonly string[];
	/** Caller supplies; agent/UI-under-lock pass true. Router explicit omits/false. */
	bypassWorkspaceLock?: boolean;
};

export type SessionGitExportDeps = {
	getSessionGitStatus: typeof getSessionGitStatus;
	pushSessionBranch: typeof pushSessionBranch;
	openSessionPullRequest: typeof openSessionPullRequest;
};

export type ExistingPullRequestPolicy = "shortCircuit" | "open";

export type RunPushThenOpenPullRequestOptions = {
	ctx: SessionGitExportGitContext;
	deps: SessionGitExportDeps;
	title?: string;
	body?: string;
	baseBranch?: string;
	existingPullRequestPolicy: ExistingPullRequestPolicy;
	/**
	 * Invoked once immediately after a successful pushSessionBranch, before restatus.
	 * Adapters use this to set didPush for backup-after-failure paths.
	 */
	onDidPush?: () => void;
};

export type RunPushThenOpenPullRequestResult = {
	didPush: boolean;
	result: { url: string; number: number };
};

export async function runPushThenOpenPullRequest(
	options: RunPushThenOpenPullRequestOptions,
): Promise<RunPushThenOpenPullRequestResult> {
	const statusCtx = {
		env: options.ctx.env,
		sandboxId: options.ctx.sandboxId,
		installationId: options.ctx.installationId,
		githubRepo: options.ctx.githubRepo,
		session: options.ctx.session,
	};
	const mutateCtx = {
		...statusCtx,
		knownSecrets: options.ctx.knownSecrets,
		bypassWorkspaceLock: options.ctx.bypassWorkspaceLock,
	};

	let didPush = false;
	let status = await options.deps.getSessionGitStatus(statusCtx);

	if (status.dirty) {
		throw new SessionGitExportPreconditionError(
			SESSION_GIT_OPEN_PR_DIRTY_MESSAGE,
		);
	}

	if (
		status.workflow.kind === "open-pr-existing" &&
		options.existingPullRequestPolicy === "shortCircuit"
	) {
		return {
			didPush: false,
			result: {
				url: status.workflow.pullRequest.url,
				number: status.workflow.pullRequest.number,
			},
		};
	}

	if (status.workflow.kind === "push") {
		await options.deps.pushSessionBranch(mutateCtx);
		didPush = true;
		options.onDidPush?.();
		status = await options.deps.getSessionGitStatus(statusCtx);

		if (
			status.workflow.kind === "open-pr-existing" &&
			options.existingPullRequestPolicy === "shortCircuit"
		) {
			return {
				didPush,
				result: {
					url: status.workflow.pullRequest.url,
					number: status.workflow.pullRequest.number,
				},
			};
		}
	}

	const canOpen =
		status.workflow.kind === "open-pr" ||
		(status.workflow.kind === "open-pr-existing" &&
			options.existingPullRequestPolicy === "open");

	if (!canOpen) {
		const message =
			sessionGitOpenPullRequestBlocker(status.workflow) ??
			"This session has no changes to open as a pull request.";
		throw new SessionGitExportPreconditionError(message);
	}

	const opened = await options.deps.openSessionPullRequest({
		...statusCtx,
		title: options.title,
		body: options.body,
		baseBranch: options.baseBranch,
	});

	return {
		didPush,
		result: { url: opened.url, number: opened.number },
	};
}
