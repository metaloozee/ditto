import {
	configureDittoGitIdentity,
	execOrThrow,
	getProjectSandbox,
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

export async function ensureSessionWorktree(options: {
	env: Env;
	sandboxId: string;
	sessionId: string;
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

	const primaryNodeModules = `${WORKSPACE_PATH}/node_modules`;
	await execOrThrow(
		sandbox,
		[
			"set -euo pipefail",
			`WT=${quoteShellArg(worktreePath)}`,
			`if [ -e ${quoteShellArg(primaryNodeModules)} ] && [ ! -e "$WT/node_modules" ]; then ln -s ${quoteShellArg(primaryNodeModules)} "$WT/node_modules"; fi`,
		].join("; "),
		{
			cwd: WORKSPACE_PATH,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to link session worktree dependencies",
		},
	);

	return {
		branchName,
		baseCommitSha,
		workspacePath: worktreePath,
	};
}
