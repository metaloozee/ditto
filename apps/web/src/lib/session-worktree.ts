import { and, eq, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import { workspaceSessions } from "#/db/schema";
import {
	configureDittoGitIdentity,
	execOrThrow,
	getProjectSandbox,
	syncPrimaryWorkspaceFromGitHub,
} from "#/lib/sandbox-bootstrap";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";
import {
	sessionBranchName,
	sessionWorktreePath,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";

const GIT_COMMAND_TIMEOUT_MS = 120_000;

export type SessionWorkspaceDb = ReturnType<typeof createDb>;

export type SessionWorkspaceLockMode = "acquire" | "assumeHeld" | "none";

export type SessionWorkspaceReadyMode = "create" | "reuse" | "repair";

export type SessionWorkspaceExisting = {
	branchName: string | null;
	baseCommitSha: string | null;
	workspacePath: string;
};

export type EnsureSessionWorkspaceReadyOptions = {
	env: Env;
	sandboxId: string;
	sessionId: string;
	githubRepo: string;
	installationId: number;
	projectId: string;
	userId: string;
	db: SessionWorkspaceDb;
	existing: SessionWorkspaceExisting;
	lock: SessionWorkspaceLockMode;
};

export type EnsureSessionWorkspaceReadyResult = {
	mode: SessionWorkspaceReadyMode;
	branchName: string;
	baseCommitSha: string;
	workspacePath: string;
	bound: boolean;
};

export type PrepareSessionWorkspaceIfPresentOptions = {
	env: Env;
	sandboxId: string;
	sessionId: string;
	existing: SessionWorkspaceExisting;
};

export type PrepareSessionWorkspaceIfPresentResult =
	| {
			ok: true;
			branchName: string;
			baseCommitSha: string;
			workspacePath: string;
	  }
	| { ok: false; reason: "worktree" };

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

async function assertPrimaryGitRepo(
	sandbox: ReturnType<typeof getProjectSandbox>,
): Promise<void> {
	const gitDir = await sandbox.exists(`${WORKSPACE_PATH}/.git`);
	if (!gitDir.exists) {
		throw new Error("Primary workspace is not a git repository.");
	}
}

async function resolvePrimaryHeadSha(
	sandbox: ReturnType<typeof getProjectSandbox>,
): Promise<string> {
	const headResult = await execOrThrow(sandbox, "git rev-parse HEAD", {
		cwd: WORKSPACE_PATH,
		timeout: GIT_COMMAND_TIMEOUT_MS,
		errorPrefix: "Failed to resolve primary HEAD",
	});
	return headResult.stdout.trim();
}

async function ensureBranchAndWorktree(
	sandbox: ReturnType<typeof getProjectSandbox>,
	branchName: string,
	worktreePath: string,
): Promise<void> {
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
}

function resolveBaseCommitSha(options: {
	isCreate: boolean;
	existingBase: string | null | undefined;
	headSha: string;
}): string {
	// Non-empty stored base is frozen. null/""/whitespace → one-time HEAD backfill
	// (create always uses HEAD; repair with empty base also backfills).
	const storedBase = options.existingBase?.trim() ?? "";
	if (!options.isCreate && storedBase.length > 0) {
		return storedBase;
	}
	return options.headSha;
}

async function runCreateWorktreeFs(options: {
	env: Env;
	sandboxId: string;
	sessionId: string;
	githubRepo: string;
	installationId: number;
}): Promise<{
	branchName: string;
	baseCommitSha: string;
	workspacePath: string;
}> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);
	await assertPrimaryGitRepo(sandbox);
	await syncPrimaryWorkspaceFromGitHub({
		env: options.env,
		sandboxId: options.sandboxId,
		githubRepo: options.githubRepo,
		installationId: options.installationId,
	});
	const baseCommitSha = await resolvePrimaryHeadSha(sandbox);
	const branchName = sessionBranchName(options.sessionId);
	const workspacePath = sessionWorktreePath(options.sessionId);
	await ensureBranchAndWorktree(sandbox, branchName, workspacePath);
	return { branchName, baseCommitSha, workspacePath };
}

async function runRepairWorktreeFs(options: {
	env: Env;
	sandboxId: string;
	sessionId: string;
	existing: SessionWorkspaceExisting;
}): Promise<{
	branchName: string;
	baseCommitSha: string;
	workspacePath: string;
}> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);
	await assertPrimaryGitRepo(sandbox);
	const branchName =
		options.existing.branchName ?? sessionBranchName(options.sessionId);
	const workspacePath = sessionWorktreePath(options.sessionId);
	const storedBase = options.existing.baseCommitSha?.trim() ?? "";
	let baseCommitSha: string;
	if (storedBase.length > 0) {
		baseCommitSha = storedBase;
	} else {
		baseCommitSha = await resolvePrimaryHeadSha(sandbox);
	}
	await ensureBranchAndWorktree(sandbox, branchName, workspacePath);
	return { branchName, baseCommitSha, workspacePath };
}

async function runReuseWorktreeFs(options: {
	env: Env;
	sandboxId: string;
	existing: SessionWorkspaceExisting;
	canonicalPath: string;
}): Promise<{
	branchName: string;
	baseCommitSha: string;
	workspacePath: string;
}> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await prepareSessionWorktreeFs(sandbox, options.canonicalPath);
	return {
		branchName: options.existing.branchName as string,
		baseCommitSha: options.existing.baseCommitSha ?? "",
		workspacePath: options.canonicalPath,
	};
}

async function bindSessionWorkspaceFields(options: {
	db: SessionWorkspaceDb;
	sessionId: string;
	projectId: string;
	userId: string;
	previous: SessionWorkspaceExisting;
	next: { branchName: string; baseCommitSha: string; workspacePath: string };
}): Promise<boolean> {
	const prevBase = options.previous.baseCommitSha ?? "";
	const unchanged =
		options.previous.branchName === options.next.branchName &&
		prevBase === options.next.baseCommitSha &&
		options.previous.workspacePath === options.next.workspacePath;
	if (unchanged) return false;

	const [row] = await options.db
		.update(workspaceSessions)
		.set({
			branchName: options.next.branchName,
			baseCommitSha: options.next.baseCommitSha,
			workspacePath: options.next.workspacePath,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
				eq(workspaceSessions.status, "active"),
			),
		)
		.returning({ id: workspaceSessions.id });

	if (!row) {
		throw new Error(
			"Failed to bind session workspace: session not active or not found.",
		);
	}
	return true;
}

function detectMode(
	existing: SessionWorkspaceExisting,
	canonical: string,
	pathExistsCanonical: boolean,
): SessionWorkspaceReadyMode {
	if (!existing.branchName) return "create";
	if (existing.workspacePath === canonical && pathExistsCanonical) {
		return "reuse";
	}
	return "repair"; // missing OR non-canonical (even if old path exists)
}

export async function ensureSessionWorkspaceReady(
	options: EnsureSessionWorkspaceReadyOptions,
): Promise<EnsureSessionWorkspaceReadyResult> {
	const canonical = sessionWorktreePath(options.sessionId);
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const pathCheck = await sandbox.exists(canonical);
	const mode = detectMode(options.existing, canonical, pathCheck.exists);

	const run = async (): Promise<EnsureSessionWorkspaceReadyResult> => {
		let next: {
			branchName: string;
			baseCommitSha: string;
			workspacePath: string;
		};
		if (mode === "reuse") {
			next = await runReuseWorktreeFs({
				env: options.env,
				sandboxId: options.sandboxId,
				existing: options.existing,
				canonicalPath: canonical,
			});
		} else if (mode === "create") {
			next = await runCreateWorktreeFs({
				env: options.env,
				sandboxId: options.sandboxId,
				sessionId: options.sessionId,
				githubRepo: options.githubRepo,
				installationId: options.installationId,
			});
		} else {
			next = await runRepairWorktreeFs({
				env: options.env,
				sandboxId: options.sandboxId,
				sessionId: options.sessionId,
				existing: options.existing,
			});
		}

		const bound = await bindSessionWorkspaceFields({
			db: options.db,
			sessionId: options.sessionId,
			projectId: options.projectId,
			userId: options.userId,
			previous: options.existing,
			next,
		});

		return { mode, ...next, bound };
	};

	// Reuse never acquires. create/repair acquire only when lock==="acquire".
	if (mode === "reuse" || options.lock !== "acquire") {
		return await run();
	}
	return await withSessionWorkspaceLock({
		env: options.env,
		sandboxId: options.sandboxId,
		sessionId: options.sessionId,
		run,
	});
}

export async function prepareSessionWorkspaceIfPresent(
	options: PrepareSessionWorkspaceIfPresentOptions,
): Promise<PrepareSessionWorkspaceIfPresentResult> {
	const canonical = sessionWorktreePath(options.sessionId);
	const branch = options.existing.branchName;
	if (!branch) return { ok: false, reason: "worktree" };
	if (options.existing.workspacePath !== canonical) {
		return { ok: false, reason: "worktree" };
	}
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const check = await sandbox.exists(canonical);
	if (!check.exists) return { ok: false, reason: "worktree" };
	await prepareSessionWorktree({
		env: options.env,
		sandboxId: options.sandboxId,
		worktreePath: canonical,
	});
	return {
		ok: true,
		branchName: branch,
		baseCommitSha: options.existing.baseCommitSha?.trim() || "",
		workspacePath: canonical,
	};
}

/** @deprecated Prefer ensureSessionWorkspaceReady. Kept for Phase 1 base rules. */
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

	await assertPrimaryGitRepo(sandbox);

	if (isCreate) {
		await syncPrimaryWorkspaceFromGitHub({
			env: options.env,
			sandboxId: options.sandboxId,
			githubRepo: options.githubRepo,
			installationId: options.installationId,
		});
	}

	const headSha = await resolvePrimaryHeadSha(sandbox);
	const baseCommitSha = resolveBaseCommitSha({
		isCreate,
		existingBase: existing?.baseCommitSha,
		headSha,
	});

	await ensureBranchAndWorktree(sandbox, branchName, worktreePath);

	return {
		branchName,
		baseCommitSha,
		workspacePath: worktreePath,
	};
}
