import {
	configureDittoGitIdentity,
	execOrThrow,
	getProjectSandbox,
	syncPrimaryWorkspaceFromGitHub,
} from "#/lib/sandbox-bootstrap";
import {
	sessionBranchName,
	sessionWorktreePath,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";

const GIT_COMMAND_TIMEOUT_MS = 120_000;

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function prepareSessionWorktree(
	sandbox: ReturnType<typeof getProjectSandbox>,
	worktreePath: string,
): Promise<void> {
	const primaryNodeModules = `${WORKSPACE_PATH}/node_modules`;
	await execOrThrow(
		sandbox,
		[
			"set -euo pipefail",
			`WT=${quoteShellArg(worktreePath)}`,
			'EXCLUDE=$(git -C "$WT" rev-parse --git-path info/exclude)',
			'mkdir -p "$(dirname "$EXCLUDE")" && touch "$EXCLUDE"',
			`for PATTERN in '/node_modules' '/.env' '/.env.*'; do grep -Fqx -- "$PATTERN" "$EXCLUDE" || printf '%s\\n' "$PATTERN" >> "$EXCLUDE"; done`,
			`if [ "$(readlink "$WT/node_modules" 2>/dev/null || true)" = ${quoteShellArg(primaryNodeModules)} ]; then git -C "$WT" rm --cached --ignore-unmatch -- node_modules; fi`,
			`if [ -e ${quoteShellArg(primaryNodeModules)} ] && [ ! -e "$WT/node_modules" ]; then ln -s ${quoteShellArg(primaryNodeModules)} "$WT/node_modules"; fi`,
		].join("; "),
		{
			cwd: WORKSPACE_PATH,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to prepare session worktree",
		},
	);
}

export async function ensureSessionWorktree(options: {
	env: Env;
	sandboxId: string;
	sessionId: string;
	githubRepo: string;
	installationId: number;
	existing?: {
		branchName: string | null;
		baseCommitSha: string | null;
		workspacePath: string;
	};
}): Promise<{
	branchName: string;
	baseCommitSha: string;
	workspacePath: string;
}> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);
	const branchName = sessionBranchName(options.sessionId);
	const worktreePath = sessionWorktreePath(options.sessionId);
	const existing = options.existing;

	if (existing?.branchName && existing.workspacePath) {
		const pathCheck = await sandbox.exists(existing.workspacePath);
		if (pathCheck.exists) {
			await prepareSessionWorktree(sandbox, existing.workspacePath);
			return {
				branchName: existing.branchName,
				baseCommitSha: existing.baseCommitSha ?? "",
				workspacePath: existing.workspacePath,
			};
		}
	}

	const gitDir = await sandbox.exists(`${WORKSPACE_PATH}/.git`);
	if (!gitDir.exists) {
		throw new Error("Primary workspace is not a git repository.");
	}

	if (!existing?.branchName) {
		await syncPrimaryWorkspaceFromGitHub({
			env: options.env,
			sandboxId: options.sandboxId,
			githubRepo: options.githubRepo,
			installationId: options.installationId,
		});
	}

	const headResult = await execOrThrow(sandbox, "git rev-parse HEAD", {
		cwd: WORKSPACE_PATH,
		timeout: GIT_COMMAND_TIMEOUT_MS,
		errorPrefix: "Failed to resolve primary HEAD",
	});
	const baseCommitSha = headResult.stdout.trim();

	const quotedBranch = quoteShellArg(branchName);
	await execOrThrow(
		sandbox,
		`git show-ref --verify --quiet refs/heads/${quotedBranch} || git branch ${quotedBranch} HEAD`,
		{
			cwd: WORKSPACE_PATH,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to create session branch",
		},
	);

	const worktreeExists = await sandbox.exists(worktreePath);
	if (!worktreeExists.exists) {
		await execOrThrow(
			sandbox,
			`git worktree add ${quoteShellArg(worktreePath)} ${quotedBranch}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: GIT_COMMAND_TIMEOUT_MS,
				errorPrefix: "Failed to add session worktree",
			},
		);
	}

	await prepareSessionWorktree(sandbox, worktreePath);

	return {
		branchName,
		baseCommitSha,
		workspacePath: worktreePath,
	};
}
