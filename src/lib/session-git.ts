import {
	assertOutgoingGitRangeSafe,
	isSecretLikeGitPath,
} from "#/lib/git-secret-policy";
import {
	getGitHubApp,
	getInstallationAccessToken,
	repositoryNameFromSlug,
} from "#/lib/github-app";
import {
	buildExportCommitMessage,
	buildPullRequestTitle,
	buildSessionPullRequestBody,
	quoteGitHubExportShellArg,
	redactGitHubExportOutput,
} from "#/lib/github-export";
import {
	fetchPrimaryBranchFromGitHub,
	getProjectSandbox,
	installDependencies,
	scrubGithubRemote,
} from "#/lib/sandbox-bootstrap";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export { isSecretLikeGitPath } from "#/lib/git-secret-policy";

const GIT_COMMAND_TIMEOUT_MS = 120_000;

/** Actionable message when the GitHub App lacks write access (push). */
export const GITHUB_APP_PUSH_PERMISSION_MESSAGE =
	"GitHub App cannot push to this repository. Update the app permissions to include Contents (read & write) and Pull requests (read & write), then reinstall the app on the repository (or grant access if using selected repos).";

/** Actionable message when the GitHub App lacks write access (open PR). */
export const GITHUB_APP_PR_PERMISSION_MESSAGE =
	"GitHub App cannot open pull requests. Update the app permissions to include Contents (read & write) and Pull requests (read & write), then reinstall the app on the repository (or grant access if using selected repos).";

export class SessionGitSyncPreconditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionGitSyncPreconditionError";
	}
}

/**
 * Detect GitHub permission failures from git remote / Octokit errors without
 * matching unrelated failures (non-fast-forward, network, auth token shape).
 */
export function isGitHubAppPermissionDenied(message: string): boolean {
	if (/permission to .+ denied/i.test(message)) {
		return true;
	}
	if (/resource not accessible by integration/i.test(message)) {
		return true;
	}
	if (
		/HTTP 403|status code 403/i.test(message) &&
		/denied|permission|integration|accessible/i.test(message)
	) {
		return true;
	}
	return false;
}

function installationTokenOptions(
	githubRepo: string,
): { repositories: string[] } | undefined {
	const repoName = repositoryNameFromSlug(githubRepo);
	return repoName ? { repositories: [repoName] } : undefined;
}

export type SessionGitSession = {
	id: string;
	branchName: string;
	baseCommitSha?: string | null;
	workspacePath: string;
	title?: string | null;
};

type SessionGitContext = {
	env: Env;
	sandboxId: string;
	installationId: number;
	githubRepo: string;
	session: SessionGitSession;
	/**
	 * Decrypted project env values for secret preflight only.
	 * Server memory; never return to clients, logs, or job payloads.
	 */
	knownSecrets?: readonly string[];
	bypassWorkspaceLock?: boolean;
};

async function withGitMutationLock<T>(
	ctx: SessionGitContext,
	run: () => Promise<T>,
): Promise<T> {
	if (ctx.bypassWorkspaceLock) {
		return await run();
	}
	return await withSessionWorkspaceLock({
		env: ctx.env,
		sandboxId: ctx.sandboxId,
		sessionId: ctx.session.id,
		run,
	});
}

function publicRepoUrl(githubRepo: string): string {
	return `https://github.com/${githubRepo}.git`;
}

function tokenizedRepoUrl(githubRepo: string, token: string): string {
	return `https://x-access-token:${token}@github.com/${githubRepo}.git`;
}

function formatGitError(
	errorPrefix: string,
	output: string,
	secrets: readonly string[],
	exitCode?: number,
): string {
	const redacted = redactGitHubExportOutput(output, secrets);
	if (redacted) {
		return `${errorPrefix}: ${redacted}`;
	}
	return exitCode === undefined
		? errorPrefix
		: `${errorPrefix} (exit code ${exitCode})`;
}

async function execGitOrThrow(
	sandbox: ReturnType<typeof getProjectSandbox>,
	command: string,
	options: {
		cwd: string;
		errorPrefix: string;
		secrets?: readonly string[];
	},
): Promise<Awaited<ReturnType<typeof sandbox.exec>>> {
	const result = await sandbox.exec(command, {
		cwd: options.cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});

	if (result.success) {
		return result;
	}

	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	throw new Error(
		formatGitError(
			options.errorPrefix,
			stderr || stdout,
			options.secrets ?? [],
			result.exitCode,
		),
	);
}

/**
 * One porcelain=v1 -z record. For renames/copies, `paths` is
 * [destination, source] (git -z order); safety checks use both real paths.
 */
export type PorcelainZEntry = {
	indexStatus: string;
	workTreeStatus: string;
	paths: string[];
};

/**
 * Parse `git status --porcelain=v1 -z` into real path records.
 * Fails closed on incomplete rename/copy or malformed records.
 */
export function parsePorcelainZ(porcelain: string): PorcelainZEntry[] {
	if (!porcelain) {
		return [];
	}
	const parts = porcelain.split("\0");
	const entries: PorcelainZEntry[] = [];
	let i = 0;
	while (i < parts.length) {
		const record = parts[i];
		if (record === undefined || record === "") {
			i += 1;
			continue;
		}
		// "XY path…" — two status chars, a space, then the path.
		if (record.length < 4) {
			throw new Error(
				"Failed to parse git status (ambiguous porcelain output).",
			);
		}
		const indexStatus = record[0] ?? "";
		const workTreeStatus = record[1] ?? "";
		if (record[2] !== " ") {
			throw new Error(
				"Failed to parse git status (ambiguous porcelain output).",
			);
		}
		const firstPath = record.slice(3);
		if (!firstPath) {
			throw new Error("Failed to parse git status (missing path).");
		}

		const isRenameOrCopy =
			indexStatus === "R" ||
			indexStatus === "C" ||
			workTreeStatus === "R" ||
			workTreeStatus === "C";

		if (isRenameOrCopy) {
			const secondPath = parts[i + 1];
			if (!secondPath) {
				throw new Error("Failed to parse git status (incomplete rename/copy).");
			}
			// Empirical git -z order: destination, then source.
			entries.push({
				indexStatus,
				workTreeStatus,
				paths: [firstPath, secondPath],
			});
			i += 2;
			continue;
		}

		entries.push({
			indexStatus,
			workTreeStatus,
			paths: [firstPath],
		});
		i += 1;
	}
	return entries;
}

/** UI-facing path labels; renames shown as `source -> destination`. */
export function formatPorcelainPathsForDisplay(
	entries: PorcelainZEntry[],
): string[] {
	return entries.map((entry) => {
		if (entry.paths.length >= 2) {
			const dest = entry.paths[0] ?? "";
			const source = entry.paths[1] ?? "";
			return `${source} -> ${dest}`;
		}
		return entry.paths[0] ?? "";
	});
}

function isIndexStaged(indexStatus: string): boolean {
	return indexStatus !== " " && indexStatus !== "?";
}

export type SessionGitPullRequestRef = {
	url: string;
	number: number;
	state: "open" | "closed" | "merged";
};

export type SessionGitHubState =
	| {
			kind: "available";
			remoteBranchExists: boolean;
			pullRequest: SessionGitPullRequestRef | null;
			baseBranch: string;
			baseBranchHeadSha: string | null;
			baseBranchBehind: boolean;
	  }
	| { kind: "unavailable" };

export type SessionGitWorkflow =
	| { kind: "commit" }
	| {
			kind: "push";
			reason: "unpushed-commits" | "remote-branch-missing";
	  }
	| { kind: "sync"; baseBranch: string }
	| { kind: "open-pr" }
	| { kind: "open-pr-existing"; pullRequest: SessionGitPullRequestRef }
	| { kind: "closed-pr"; pullRequest: SessionGitPullRequestRef }
	| { kind: "merged-pr"; pullRequest: SessionGitPullRequestRef }
	| { kind: "idle"; reason: "no-changes" }
	| { kind: "unavailable"; reason: "github" };

export function resolveSessionGitWorkflow(options: {
	dirty: boolean;
	ahead: number;
	hasBranchChanges: boolean;
	github: SessionGitHubState;
}): SessionGitWorkflow {
	if (options.dirty) {
		return { kind: "commit" };
	}

	if (options.github.kind === "available" && options.github.pullRequest) {
		const pullRequest = options.github.pullRequest;
		if (pullRequest.state === "merged") {
			return { kind: "merged-pr", pullRequest };
		}
		if (pullRequest.state === "closed") {
			return { kind: "closed-pr", pullRequest };
		}
	}

	if (
		options.github.kind === "available" &&
		options.github.baseBranchBehind &&
		options.github.baseBranch
	) {
		return { kind: "sync", baseBranch: options.github.baseBranch };
	}

	if (
		options.github.kind === "available" &&
		options.github.pullRequest?.state === "open" &&
		options.ahead <= 0
	) {
		return {
			kind: "open-pr-existing",
			pullRequest: options.github.pullRequest,
		};
	}

	if (!options.hasBranchChanges) {
		return { kind: "idle", reason: "no-changes" };
	}

	if (options.github.kind === "unavailable") {
		return { kind: "unavailable", reason: "github" };
	}

	if (options.ahead > 0) {
		return { kind: "push", reason: "unpushed-commits" };
	}

	if (!options.github.remoteBranchExists) {
		return { kind: "push", reason: "remote-branch-missing" };
	}

	if (options.github.pullRequest?.state === "open") {
		return {
			kind: "open-pr-existing",
			pullRequest: options.github.pullRequest,
		};
	}

	return { kind: "open-pr" };
}

async function countAheadWithoutUpstream(
	sandbox: ReturnType<typeof getProjectSandbox>,
	cwd: string,
	branch: string,
): Promise<number> {
	const quotedOriginBranch = quoteGitHubExportShellArg(`origin/${branch}`);
	const aheadResult = await sandbox.exec(
		`git rev-list --count ${quotedOriginBranch}..HEAD`,
		{ cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
	);
	if (aheadResult.success) {
		return Number.parseInt(aheadResult.stdout.trim(), 10) || 0;
	}

	const unpushedResult = await sandbox.exec(
		"git rev-list --count HEAD --not --remotes=origin",
		{ cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
	);
	if (unpushedResult.success) {
		return Number.parseInt(unpushedResult.stdout.trim(), 10) || 0;
	}

	const hasCommits = await sandbox.exec("git rev-parse HEAD", {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
	if (hasCommits.success) {
		return 1;
	}
	return 0;
}

async function syncBranchTrackingAfterPush(
	sandbox: ReturnType<typeof getProjectSandbox>,
	cwd: string,
	branchName: string,
): Promise<void> {
	const quotedRemoteRef = quoteGitHubExportShellArg(
		`refs/remotes/origin/${branchName}`,
	);
	const quotedUpstream = quoteGitHubExportShellArg(`origin/${branchName}`);

	await sandbox.exec(`git update-ref ${quotedRemoteRef} HEAD`, {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
	await sandbox.exec(`git branch --set-upstream-to=${quotedUpstream}`, {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
}

function buildStatusSummary(options: {
	branch: string;
	dirty: boolean;
	changedCount: number;
	ahead: number;
}): string {
	if (options.dirty) {
		const fileWord = options.changedCount === 1 ? "file" : "files";
		return `${options.changedCount} changed ${fileWord} on ${options.branch}`;
	}
	if (options.ahead > 0) {
		const commitWord = options.ahead === 1 ? "commit" : "commits";
		return `${options.ahead} ${commitWord} ahead on ${options.branch}`;
	}
	return `Clean working tree on ${options.branch}`;
}

async function hasSessionBranchChanges(
	sandbox: ReturnType<typeof getProjectSandbox>,
	cwd: string,
	baseCommitSha: string | null | undefined,
	fallbackAhead: number,
): Promise<boolean> {
	if (!baseCommitSha) {
		return fallbackAhead > 0;
	}

	const quotedBase = quoteGitHubExportShellArg(baseCommitSha);
	const result = await sandbox.exec(
		`git diff --quiet ${quotedBase}...HEAD --`,
		{
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		},
	);
	if (result.success) {
		return false;
	}
	if (result.exitCode === 1) {
		return true;
	}
	return fallbackAhead > 0;
}

export type SessionGitStatus = {
	branch: string;
	dirty: boolean;
	ahead: number;
	hasBranchChanges: boolean;
	remoteBranchExists: boolean | null;
	changedFiles: string[];
	summary: string;
	pullRequest: SessionGitPullRequestRef | null;
	workflow: SessionGitWorkflow;
};

export async function getSessionGitStatus(
	ctx: SessionGitContext,
): Promise<SessionGitStatus> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;

	const statusResult = await execGitOrThrow(
		sandbox,
		"git status --porcelain=v1 -z -uall",
		{
			cwd,
			errorPrefix: "Failed to read git status",
		},
	);
	const entries = parsePorcelainZ(statusResult.stdout);
	const changedFiles = formatPorcelainPathsForDisplay(entries);
	const dirty = changedFiles.length > 0;

	const branchResult = await execGitOrThrow(
		sandbox,
		"git rev-parse --abbrev-ref HEAD",
		{ cwd, errorPrefix: "Failed to resolve branch" },
	);
	const branch = branchResult.stdout.trim() || ctx.session.branchName;

	let ahead = 0;
	const upstreamResult = await sandbox.exec(
		"git rev-parse --abbrev-ref --symbolic-full-name @{upstream}",
		{ cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
	);
	if (upstreamResult.success) {
		const aheadResult = await sandbox.exec(
			"git rev-list --count @{upstream}..HEAD",
			{ cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
		);
		if (aheadResult.success) {
			ahead = Number.parseInt(aheadResult.stdout.trim(), 10) || 0;
		}
	} else {
		ahead = await countAheadWithoutUpstream(sandbox, cwd, branch);
	}

	const hasBranchChanges = await hasSessionBranchChanges(
		sandbox,
		cwd,
		ctx.session.baseCommitSha,
		ahead,
	);
	const github = await getSessionGitHubState(ctx);
	const pullRequest = github.kind === "available" ? github.pullRequest : null;
	const workflow = resolveSessionGitWorkflow({
		dirty,
		ahead,
		hasBranchChanges,
		github,
	});

	return {
		branch,
		dirty,
		ahead,
		hasBranchChanges,
		remoteBranchExists:
			github.kind === "available" ? github.remoteBranchExists : null,
		changedFiles,
		summary: buildStatusSummary({
			branch,
			dirty,
			changedCount: changedFiles.length,
			ahead,
		}),
		pullRequest,
		workflow,
	};
}

async function commitSessionChangesUnlocked(
	ctx: SessionGitContext & {
		message: string;
		authorName: string;
		authorEmail: string;
	},
): Promise<{ commitSha: string | null; committed: boolean }> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;

	const statusResult = await execGitOrThrow(
		sandbox,
		"git status --porcelain=v1 -z -uall",
		{
			cwd,
			errorPrefix: "Failed to read git status",
		},
	);
	const entries = parsePorcelainZ(statusResult.stdout);
	if (entries.length === 0) {
		return { commitSha: null, committed: false };
	}

	// Fail closed if a secret-like path is already in the index.
	for (const entry of entries) {
		if (!isIndexStaged(entry.indexStatus)) {
			continue;
		}
		for (const path of entry.paths) {
			if (isSecretLikeGitPath(path)) {
				throw new Error(
					`Refusing to commit: secret-like path is already staged (${path}).`,
				);
			}
		}
	}

	// Stage only paths from entries that do not involve any secret-like path
	// (rename/copy to .env must not stage the source either).
	const stageableFiles: string[] = [];
	const seenStageable = new Set<string>();
	for (const entry of entries) {
		if (entry.paths.some(isSecretLikeGitPath)) {
			continue;
		}
		for (const path of entry.paths) {
			if (!seenStageable.has(path)) {
				seenStageable.add(path);
				stageableFiles.push(path);
			}
		}
	}
	if (stageableFiles.length === 0) {
		return { commitSha: null, committed: false };
	}

	// Stage only explicit safe paths — never `git add -A` + best-effort reset.
	const addArgs = stageableFiles.map(quoteGitHubExportShellArg).join(" ");
	await execGitOrThrow(sandbox, `git add -- ${addArgs}`, {
		cwd,
		errorPrefix: "Failed to stage changes",
	});

	const stagedResult = await sandbox.exec("git diff --cached --name-only -z", {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
	if (!stagedResult.success) {
		throw new Error("Failed to verify staged changes.");
	}
	const stagedPaths = stagedResult.stdout
		.split("\0")
		.map((p) => p.trim())
		.filter(Boolean);
	if (stagedPaths.length === 0) {
		return { commitSha: null, committed: false };
	}
	for (const path of stagedPaths) {
		if (isSecretLikeGitPath(path)) {
			throw new Error(
				`Refusing to commit: secret-like path is staged (${path}).`,
			);
		}
	}

	const quotedMessage = quoteGitHubExportShellArg(ctx.message);
	const quotedName = quoteGitHubExportShellArg(ctx.authorName);
	const quotedEmail = quoteGitHubExportShellArg(ctx.authorEmail);
	await execGitOrThrow(
		sandbox,
		`git -c user.name=${quotedName} -c user.email=${quotedEmail} commit -m ${quotedMessage}`,
		{ cwd, errorPrefix: "Failed to commit changes" },
	);

	const headResult = await execGitOrThrow(sandbox, "git rev-parse HEAD", {
		cwd,
		errorPrefix: "Failed to resolve commit",
	});

	return {
		commitSha: headResult.stdout.trim(),
		committed: true,
	};
}

export async function commitSessionChanges(
	ctx: Parameters<typeof commitSessionChangesUnlocked>[0],
): ReturnType<typeof commitSessionChangesUnlocked> {
	return await withGitMutationLock(ctx, () =>
		commitSessionChangesUnlocked(ctx),
	);
}

async function syncSessionBranchUnlocked(
	ctx: SessionGitContext & { baseBranch: string },
): Promise<{
	baseBranch: string;
	baseCommitSha: string;
	updated: boolean;
}> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;
	const statusResult = await execGitOrThrow(
		sandbox,
		"git status --porcelain=v1 -z -uall",
		{
			cwd,
			errorPrefix: "Failed to read git status before syncing",
		},
	);
	if (statusResult.stdout) {
		throw new SessionGitSyncPreconditionError(
			"Commit local changes before syncing with the base branch.",
		);
	}

	const primary = await fetchPrimaryBranchFromGitHub({
		env: ctx.env,
		sandboxId: ctx.sandboxId,
		githubRepo: ctx.githubRepo,
		installationId: ctx.installationId,
		branchName: ctx.baseBranch,
	});
	const quotedBaseHead = quoteGitHubExportShellArg(primary.headSha);
	const alreadyIntegrated = await sandbox.exec(
		`git merge-base --is-ancestor ${quotedBaseHead} HEAD`,
		{ cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
	);
	if (alreadyIntegrated.success) {
		await installDependencies(sandbox, cwd);
		return {
			baseBranch: primary.branchName,
			baseCommitSha: primary.headSha,
			updated: false,
		};
	}
	if (alreadyIntegrated.exitCode !== 1) {
		throw new Error(
			"Failed to compare the session with the latest base branch.",
		);
	}

	const mergeResult = await sandbox.exec(
		`git merge --no-edit ${quotedBaseHead}`,
		{
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		},
	);
	if (!mergeResult.success) {
		const abortResult = await sandbox.exec("git merge --abort", {
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		});
		if (!abortResult.success) {
			throw new Error(
				"Sync failed and the conflicting merge could not be aborted. Resolve the session worktree manually.",
			);
		}
		throw new SessionGitSyncPreconditionError(
			`The latest ${primary.branchName} conflicts with this session. The merge was aborted without changing the session.`,
		);
	}
	await installDependencies(sandbox, cwd);

	return {
		baseBranch: primary.branchName,
		baseCommitSha: primary.headSha,
		updated: true,
	};
}

export async function syncSessionBranch(
	ctx: Parameters<typeof syncSessionBranchUnlocked>[0],
): ReturnType<typeof syncSessionBranchUnlocked> {
	return await withGitMutationLock(ctx, () => syncSessionBranchUnlocked(ctx));
}

async function pushSessionBranchUnlocked(
	ctx: SessionGitContext,
): Promise<{ remoteBranch: string; pushed: boolean }> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;
	const branchName = ctx.session.branchName;
	const publicUrl = publicRepoUrl(ctx.githubRepo);

	// Preflight must run before minting an installation token so UI push, agent
	// push, and open-PR auto-push share one secret egress gate.
	await assertOutgoingGitRangeSafe({
		sandbox,
		cwd,
		branchName,
		knownSecrets: ctx.knownSecrets,
	});

	// Token mint + push share the same try so scoped-token API 403s map cleanly.
	// Scrub remotes in finally even if mint fails (no-op if remotes never changed).
	let token: string | undefined;
	try {
		token = await getInstallationAccessToken(
			ctx.env,
			ctx.installationId,
			installationTokenOptions(ctx.githubRepo),
		);
		const pushUrl = tokenizedRepoUrl(ctx.githubRepo, token);
		const quotedPushUrl = quoteGitHubExportShellArg(pushUrl);

		await execGitOrThrow(
			sandbox,
			`git push ${quotedPushUrl} HEAD:refs/heads/${branchName}`,
			{
				cwd,
				errorPrefix: "Failed to push branch",
				secrets: [token],
			},
		);

		try {
			await syncBranchTrackingAfterPush(sandbox, cwd, branchName);
		} catch {
			// Push already succeeded; tracking sync is best-effort.
		}
	} catch (error) {
		const raw = error instanceof Error ? error.message : String(error);
		const message =
			token != null ? redactGitHubExportOutput(raw, [token]) || raw : raw;
		if (
			isGitHubAppPermissionDenied(raw) ||
			isGitHubAppPermissionDenied(message)
		) {
			throw new Error(GITHUB_APP_PUSH_PERMISSION_MESSAGE);
		}
		if (message !== raw) {
			throw new Error(message);
		}
		throw error;
	} finally {
		await scrubGithubRemote(sandbox, cwd, publicUrl);
		await scrubGithubRemote(sandbox, WORKSPACE_PATH, publicUrl);
	}

	return { remoteBranch: branchName, pushed: true };
}

export async function pushSessionBranch(
	ctx: Parameters<typeof pushSessionBranchUnlocked>[0],
): ReturnType<typeof pushSessionBranchUnlocked> {
	return await withGitMutationLock(ctx, () => pushSessionBranchUnlocked(ctx));
}

type PullRequestClient = {
	rest: {
		pulls: {
			create: (options: {
				owner: string;
				repo: string;
				head: string;
				base: string;
				title: string;
				body: string;
			}) => Promise<{ data: { html_url: string; number: number } }>;
			list: (options: {
				owner: string;
				repo: string;
				head: string;
				base: string;
				state: "open" | "all";
				per_page: number;
			}) => Promise<{
				data: Array<{
					html_url: string;
					number: number;
					state?: "open" | "closed";
					merged_at?: string | null;
				}>;
			}>;
		};
		repos: {
			get: (options: {
				owner: string;
				repo: string;
			}) => Promise<{ data: { default_branch: string } }>;
			getBranch: (options: {
				owner: string;
				repo: string;
				branch: string;
			}) => Promise<{ data: { commit?: { sha?: string } } }>;
		};
	};
};

function githubErrorStatus(error: unknown): number | null {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return null;
	}
	const status = (error as { status?: unknown }).status;
	return typeof status === "number" ? status : null;
}

function mapPullRequest(
	pullRequest: Awaited<
		ReturnType<PullRequestClient["rest"]["pulls"]["list"]>
	>["data"][number],
): SessionGitPullRequestRef {
	return {
		url: pullRequest.html_url,
		number: pullRequest.number,
		state: pullRequest.merged_at
			? "merged"
			: pullRequest.state === "closed"
				? "closed"
				: "open",
	};
}

async function getSessionGitHubState(
	ctx: SessionGitContext,
): Promise<SessionGitHubState> {
	try {
		const app = getGitHubApp(ctx.env);
		const octokit = (await app.getInstallationOctokit(
			ctx.installationId,
		)) as PullRequestClient;
		const [owner, repo] = ctx.githubRepo.split("/");
		if (!owner || !repo) {
			return { kind: "unavailable" };
		}

		const base = (await octokit.rest.repos.get({ owner, repo })).data
			.default_branch;
		const baseBranchHeadSha = (
			await octokit.rest.repos.getBranch({ owner, repo, branch: base })
		).data.commit?.sha;
		const pullRequests = await octokit.rest.pulls.list({
			owner,
			repo,
			head: `${owner}:${ctx.session.branchName}`,
			base,
			state: "all",
			per_page: 1,
		});
		const pullRequest = pullRequests.data[0]
			? mapPullRequest(pullRequests.data[0])
			: null;

		let remoteBranchExists = true;
		try {
			await octokit.rest.repos.getBranch({
				owner,
				repo,
				branch: ctx.session.branchName,
			});
		} catch (error) {
			if (githubErrorStatus(error) !== 404) {
				throw error;
			}
			remoteBranchExists = false;
		}

		return {
			kind: "available",
			remoteBranchExists,
			pullRequest,
			baseBranch: base,
			baseBranchHeadSha: baseBranchHeadSha ?? null,
			baseBranchBehind: Boolean(
				ctx.session.baseCommitSha &&
					baseBranchHeadSha &&
					ctx.session.baseCommitSha !== baseBranchHeadSha,
			),
		};
	} catch (error) {
		console.error("getSessionGitHubState failed", error);
		return { kind: "unavailable" };
	}
}

const SESSION_COMMIT_LOG_LIMIT = 20;

function parseCommitSubjectsFromGitLog(stdout: string): string[] {
	const subjects: string[] = [];
	for (const line of stdout.split("\n")) {
		const subject = line.trim();
		if (!subject) {
			continue;
		}
		if (/^merge /i.test(subject)) {
			continue;
		}
		subjects.push(subject);
	}
	return subjects;
}

async function gitLogCommitSubjectsForRevRange(
	sandbox: ReturnType<typeof getProjectSandbox>,
	cwd: string,
	revRange: string,
): Promise<string[] | null> {
	const result = await sandbox.exec(
		`git log --format=%s -n ${SESSION_COMMIT_LOG_LIMIT} ${revRange}`,
		{
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		},
	);
	if (!result.success) {
		return null;
	}
	return parseCommitSubjectsFromGitLog(result.stdout);
}

export async function findOpenSessionPullRequest(
	ctx: SessionGitContext,
	baseBranch?: string,
): Promise<SessionGitPullRequestRef | null> {
	try {
		const app = getGitHubApp(ctx.env);
		const octokit = (await app.getInstallationOctokit(
			ctx.installationId,
		)) as PullRequestClient;
		const [owner, repo] = ctx.githubRepo.split("/");
		if (!owner || !repo) {
			return null;
		}

		const base =
			baseBranch ??
			(await octokit.rest.repos.get({ owner, repo })).data.default_branch;
		const head = ctx.session.branchName;

		const existing = await octokit.rest.pulls.list({
			owner,
			repo,
			head: `${owner}:${head}`,
			base,
			state: "open",
			per_page: 1,
		});
		const pr = existing.data[0];
		if (!pr) {
			return null;
		}
		return { url: pr.html_url, number: pr.number, state: "open" };
	} catch (error) {
		console.error("findOpenSessionPullRequest failed", error);
		return null;
	}
}

async function collectSessionCommitSubjects(
	ctx: SessionGitContext,
	base: string,
): Promise<string[]> {
	try {
		const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
		const cwd = ctx.session.workspacePath;
		const quotedBase = quoteGitHubExportShellArg(base);

		const localRangeSubjects = await gitLogCommitSubjectsForRevRange(
			sandbox,
			cwd,
			`${quotedBase}..HEAD`,
		);
		if (localRangeSubjects !== null) {
			return localRangeSubjects;
		}

		const quotedOriginBase = quoteGitHubExportShellArg(`origin/${base}`);
		const originRangeSubjects = await gitLogCommitSubjectsForRevRange(
			sandbox,
			cwd,
			`${quotedOriginBase}..HEAD`,
		);
		if (originRangeSubjects !== null) {
			return originRangeSubjects;
		}

		const headTip = await sandbox.exec("git log --format=%s -n 1 HEAD", {
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		});
		if (!headTip.success) {
			return [];
		}
		return parseCommitSubjectsFromGitLog(headTip.stdout).slice(0, 1);
	} catch {
		return [];
	}
}

function parseChangedFilePathsFromDiffNameOnly(stdout: string): string[] {
	const paths: string[] = [];
	for (const line of stdout.split("\n")) {
		const path = line.trim();
		if (path) {
			paths.push(path);
		}
	}
	return paths;
}

async function gitDiffNameOnlyForRevRange(
	sandbox: ReturnType<typeof getProjectSandbox>,
	cwd: string,
	revRange: string,
): Promise<string[] | null> {
	const result = await sandbox.exec(`git diff --name-only ${revRange}`, {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
	if (!result.success) {
		return null;
	}
	return parseChangedFilePathsFromDiffNameOnly(result.stdout);
}

/** Changed paths for the PR range (merge-base…HEAD), with base/origin fallbacks. */
async function collectSessionChangedFiles(
	ctx: SessionGitContext,
	base: string,
): Promise<string[]> {
	try {
		const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
		const cwd = ctx.session.workspacePath;
		const quotedBase = quoteGitHubExportShellArg(base);

		const localRangeFiles = await gitDiffNameOnlyForRevRange(
			sandbox,
			cwd,
			`${quotedBase}...HEAD`,
		);
		if (localRangeFiles !== null) {
			return localRangeFiles;
		}

		const quotedOriginBase = quoteGitHubExportShellArg(`origin/${base}`);
		const originRangeFiles = await gitDiffNameOnlyForRevRange(
			sandbox,
			cwd,
			`${quotedOriginBase}...HEAD`,
		);
		if (originRangeFiles !== null) {
			return originRangeFiles;
		}

		return [];
	} catch {
		return [];
	}
}

export async function openSessionPullRequest(
	ctx: SessionGitContext & {
		title?: string;
		body?: string;
		baseBranch?: string;
	},
): Promise<{ url: string; number: number }> {
	const app = getGitHubApp(ctx.env);
	const octokit = (await app.getInstallationOctokit(
		ctx.installationId,
	)) as PullRequestClient;
	const [owner, repo] = ctx.githubRepo.split("/");
	if (!owner || !repo) {
		throw new Error("Invalid GitHub repository slug.");
	}

	const base =
		ctx.baseBranch ??
		(await octokit.rest.repos.get({ owner, repo })).data.default_branch;
	const head = ctx.session.branchName;

	const existingPr = await findOpenSessionPullRequest(ctx, base);
	if (existingPr) {
		return { url: existingPr.url, number: existingPr.number };
	}

	const needsDefaultTitle = ctx.title === undefined;
	const needsDefaultBody = ctx.body === undefined;
	const commitSubjects =
		needsDefaultTitle || needsDefaultBody
			? await collectSessionCommitSubjects(ctx, base)
			: undefined;
	const changedFiles = needsDefaultBody
		? await collectSessionChangedFiles(ctx, base)
		: undefined;

	try {
		const created = await octokit.rest.pulls.create({
			owner,
			repo,
			head,
			base,
			title:
				ctx.title ??
				buildPullRequestTitle({
					sessionTitle: ctx.session.title,
					commitSubjects,
				}),
			body:
				ctx.body ??
				buildSessionPullRequestBody({
					sessionId: ctx.session.id,
					sessionTitle: ctx.session.title,
					commitSubjects,
					changedFiles,
				}),
		});
		return {
			url: created.data.html_url,
			number: created.data.number,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isGitHubAppPermissionDenied(message)) {
			throw new Error(GITHUB_APP_PR_PERMISSION_MESSAGE);
		}
		throw error;
	}
}

export function defaultCommitMessageForSession(session: {
	id: string;
	title?: string | null;
}): string {
	return buildExportCommitMessage({
		sessionTitle: session.title,
		runId: session.id,
	});
}
