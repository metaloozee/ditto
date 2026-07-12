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
import { getProjectSandbox, scrubGithubRemote } from "#/lib/sandbox-bootstrap";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export { isSecretLikeGitPath } from "#/lib/git-secret-policy";

const GIT_COMMAND_TIMEOUT_MS = 120_000;

/** Actionable message when the GitHub App lacks write access (push). */
export const GITHUB_APP_PUSH_PERMISSION_MESSAGE =
	"GitHub App cannot push to this repository. Update the app permissions to include Contents (read & write) and Pull requests (read & write), then reinstall the app on the repository (or grant access if using selected repos).";

/** Actionable message when the GitHub App lacks write access (open PR). */
export const GITHUB_APP_PR_PERMISSION_MESSAGE =
	"GitHub App cannot open pull requests. Update the app permissions to include Contents (read & write) and Pull requests (read & write), then reinstall the app on the repository (or grant access if using selected repos).";

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
};

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
};

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

export async function getSessionGitStatus(ctx: SessionGitContext): Promise<{
	branch: string;
	dirty: boolean;
	ahead: number;
	changedFiles: string[];
	summary: string;
	pullRequest: SessionGitPullRequestRef | null;
}> {
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

	const pullRequest = await findOpenSessionPullRequest(ctx);

	return {
		branch,
		dirty,
		ahead,
		changedFiles,
		summary: buildStatusSummary({
			branch,
			dirty,
			changedCount: changedFiles.length,
			ahead,
		}),
		pullRequest,
	};
}

export async function commitSessionChanges(
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

export async function pushSessionBranch(
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
				state: "open";
				per_page: number;
			}) => Promise<{ data: Array<{ html_url: string; number: number }> }>;
		};
		repos: {
			get: (options: {
				owner: string;
				repo: string;
			}) => Promise<{ data: { default_branch: string } }>;
		};
	};
};

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
		return { url: pr.html_url, number: pr.number };
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
		return existingPr;
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
