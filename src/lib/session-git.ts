import { getGitHubApp, getInstallationAccessToken } from "#/lib/github-app";
import {
	buildExportCommitMessage,
	buildPullRequestTitle,
	buildSessionPullRequestBody,
	quoteGitHubExportShellArg,
	redactGitHubExportOutput,
} from "#/lib/github-export";
import { getProjectSandbox, scrubGithubRemote } from "#/lib/sandbox-bootstrap";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const GIT_COMMAND_TIMEOUT_MS = 120_000;

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

function parsePorcelainPaths(porcelain: string): string[] {
	const paths: string[] = [];
	for (const line of porcelain.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		const path = line.slice(3).trim();
		if (path) {
			paths.push(path);
		}
	}
	return paths;
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
}> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;

	const statusResult = await execGitOrThrow(sandbox, "git status --porcelain", {
		cwd,
		errorPrefix: "Failed to read git status",
	});
	const porcelain = statusResult.stdout.trim();
	const changedFiles = parsePorcelainPaths(porcelain);
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
		const hasCommits = await sandbox.exec("git rev-parse HEAD", {
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		});
		if (hasCommits.success) {
			ahead = 1;
		}
	}

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

	const statusResult = await execGitOrThrow(sandbox, "git status --porcelain", {
		cwd,
		errorPrefix: "Failed to read git status",
	});
	if (!statusResult.stdout.trim()) {
		return { commitSha: null, committed: false };
	}

	await execGitOrThrow(sandbox, "git add -A", {
		cwd,
		errorPrefix: "Failed to stage changes",
	});

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

	const token = await getInstallationAccessToken(ctx.env, ctx.installationId);
	const pushUrl = tokenizedRepoUrl(ctx.githubRepo, token);
	const quotedPushUrl = quoteGitHubExportShellArg(pushUrl);

	try {
		await execGitOrThrow(
			sandbox,
			`git push ${quotedPushUrl} HEAD:refs/heads/${branchName}`,
			{
				cwd,
				errorPrefix: "Failed to push branch",
				secrets: [token],
			},
		);
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

export async function openSessionPullRequest(
	ctx: SessionGitContext & {
		title?: string;
		body?: string;
		baseBranch?: string;
		changedFileCount: number;
		projectId: string;
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

	const repoInfo = await octokit.rest.repos.get({ owner, repo });
	const base = ctx.baseBranch ?? repoInfo.data.default_branch;
	const head = ctx.session.branchName;

	const existing = await octokit.rest.pulls.list({
		owner,
		repo,
		head: `${owner}:${head}`,
		base,
		state: "open",
		per_page: 1,
	});
	if (existing.data[0]) {
		return {
			url: existing.data[0].html_url,
			number: existing.data[0].number,
		};
	}

	try {
		const created = await octokit.rest.pulls.create({
			owner,
			repo,
			head,
			base,
			title:
				ctx.title ?? buildPullRequestTitle({ sessionTitle: ctx.session.title }),
			body:
				ctx.body ??
				buildSessionPullRequestBody({
					projectId: ctx.projectId,
					sessionId: ctx.session.id,
					changedFileCount: ctx.changedFileCount,
				}),
		});
		return {
			url: created.data.html_url,
			number: created.data.number,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("403")) {
			throw new Error(
				"GitHub App cannot open pull requests. Update the app permissions to include Contents (read & write) and Pull requests (read & write), then reinstall the app.",
			);
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
