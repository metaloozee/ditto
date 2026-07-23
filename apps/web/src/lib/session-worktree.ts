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

async function prepareSessionWorktreeFs(
	sandbox: ReturnType<typeof getProjectSandbox>,
	worktreePath: string,
): Promise<void> {
	const primaryNodeModules = `${WORKSPACE_PATH}/node_modules`;
	const primaryQ = quoteShellArg(primaryNodeModules);
	await execOrThrow(
		sandbox,
		[
			"set -euo pipefail",
			`WT=${quoteShellArg(worktreePath)}`,
			`PRIMARY=${primaryQ}`,
			'EXCLUDE=$(git -C "$WT" rev-parse --git-path info/exclude)',
			'mkdir -p "$(dirname "$EXCLUDE")" && touch "$EXCLUDE"',
			`for PATTERN in '/node_modules' '/.env' '/.env.*'; do grep -Fqx -- "$PATTERN" "$EXCLUDE" || printf '%s\\n' "$PATTERN" >> "$EXCLUDE"; done`,
			'CURRENT=$(readlink "$WT/node_modules" 2>/dev/null || true)',
			'if [ -e "$PRIMARY" ]; then',
			'  if [ "$CURRENT" = "$PRIMARY" ]; then',
			'    git -C "$WT" rm --cached --ignore-unmatch -- node_modules',
			'  elif [ -L "$WT/node_modules" ]; then',
			'    rm -f "$WT/node_modules"',
			'    ln -s "$PRIMARY" "$WT/node_modules"',
			'    git -C "$WT" rm --cached --ignore-unmatch -- node_modules',
			'  elif [ ! -e "$WT/node_modules" ]; then',
			'    ln -s "$PRIMARY" "$WT/node_modules"',
			'    git -C "$WT" rm --cached --ignore-unmatch -- node_modules',
			"  fi",
			'elif [ -n "$CURRENT" ]; then',
			'  if [ "$CURRENT" = "$PRIMARY" ] || [ ! -e "$WT/node_modules" ]; then',
			'    rm -f "$WT/node_modules"',
			"  fi",
			"fi",
		].join("\n"),
		{
			cwd: WORKSPACE_PATH,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to prepare session worktree",
		},
	);
}

export async function prepareSessionWorktree(options: {
	env: Env;
	sandboxId: string;
	worktreePath: string;
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await prepareSessionWorktreeFs(sandbox, options.worktreePath);
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
	const existing = options.existing;
	const isCreate = !existing?.branchName;
	const branchName =
		existing?.branchName ?? sessionBranchName(options.sessionId);
	const worktreePath = sessionWorktreePath(options.sessionId);

	// Phase 1: still reuse whatever path is stored when it exists on FS.
	if (existing?.branchName && existing.workspacePath) {
		const pathCheck = await sandbox.exists(existing.workspacePath);
		if (pathCheck.exists) {
			await prepareSessionWorktreeFs(sandbox, existing.workspacePath);
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

	if (isCreate) {
		await syncPrimaryWorkspaceFromGitHub({
			env: options.env,
			sandboxId: options.sandboxId,
			githubRepo: options.githubRepo,
			installationId: options.installationId,
		});
	}

	// Non-empty stored base is frozen. null/""/whitespace → one-time HEAD backfill
	// (create always uses HEAD; repair with empty base also backfills).
	const storedBase = existing?.baseCommitSha?.trim() ?? "";
	let baseCommitSha: string;
	if (!isCreate && storedBase.length > 0) {
		baseCommitSha = storedBase;
	} else {
		const headResult = await execOrThrow(sandbox, "git rev-parse HEAD", {
			cwd: WORKSPACE_PATH,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to resolve primary HEAD",
		});
		baseCommitSha = headResult.stdout.trim();
	}

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

	await prepareSessionWorktreeFs(sandbox, worktreePath);

	return {
		branchName,
		baseCommitSha,
		workspacePath: worktreePath,
	};
}
