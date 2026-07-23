import { beforeEach, describe, expect, it, vi } from "vitest";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const execOrThrowMock = vi.hoisted(() => vi.fn());
const configureDittoGitIdentityMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);
const syncPrimaryWorkspaceFromGitHubMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue({
		branchName: "main",
		headSha: "syncedsha",
		updated: false,
	}),
);
const withSessionWorkspaceLockMock = vi.hoisted(() =>
	vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
);

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	execOrThrow: execOrThrowMock,
	configureDittoGitIdentity: configureDittoGitIdentityMock,
	syncPrimaryWorkspaceFromGitHub: syncPrimaryWorkspaceFromGitHubMock,
}));

vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: withSessionWorkspaceLockMock,
}));

const {
	ensureSessionWorkspaceReady,
	prepareSessionWorktree,
	prepareSessionWorkspaceIfPresent,
} = await import("./session-worktree");

function makeEnv(): Env {
	return {} as Env;
}

function makeSandbox(
	existsImpl: (path: string) => Promise<{ exists: boolean }>,
) {
	return {
		exists: vi.fn(existsImpl),
	};
}

function prepareCommand(): string {
	return String(execOrThrowMock.mock.calls.at(-1)?.[1] ?? "");
}

describe("prepareSessionWorktree", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("repairs broken or wrong-target node_modules symlinks", async () => {
		const sandbox = makeSandbox(async () => ({ exists: true }));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "", success: true });

		await prepareSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			worktreePath: "/workspace/.ditto/worktrees/sess-1",
		});

		const cmd = prepareCommand();
		expect(cmd).toContain(`PRIMARY='/workspace/node_modules'`);
		expect(cmd).toContain('CURRENT=$(readlink "$WT/node_modules"');
		expect(cmd).toContain('elif [ -L "$WT/node_modules" ]');
		expect(cmd).toContain('rm -f "$WT/node_modules"');
		expect(cmd).toContain('ln -s "$PRIMARY" "$WT/node_modules"');
		expect(cmd).toContain(
			'if [ "$CURRENT" = "$PRIMARY" ] || [ ! -e "$WT/node_modules" ]',
		);
	});

	it("keeps a correct symlink and still refreshes excludes", async () => {
		const sandbox = makeSandbox(async () => ({ exists: true }));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "", success: true });

		await prepareSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			worktreePath: "/workspace/.ditto/worktrees/sess-1",
		});

		const cmd = prepareCommand();
		expect(cmd).toContain('if [ "$CURRENT" = "$PRIMARY" ]; then');
		expect(cmd).toContain(
			'git -C "$WT" rm --cached --ignore-unmatch -- node_modules',
		);
		expect(cmd).toContain("'/node_modules'");
		// Real directory path is left alone (no wipe of non-symlink node_modules).
		expect(cmd).not.toContain("rm -rf");
	});
});

function makeBindDb(options?: { returningId?: string | null }) {
	const returningId =
		options && "returningId" in options ? options.returningId : "sess-1";
	const returning = vi.fn(async () =>
		returningId == null ? [] : [{ id: returningId }],
	);
	const where = vi.fn(() => ({ returning }));
	const set = vi.fn(() => ({ where }));
	const update = vi.fn(() => ({ set }));
	return { db: { update } as never, update, set, where, returning };
}

const readyBase = {
	env: makeEnv(),
	sandboxId: "sandbox-1",
	sessionId: "sess-1",
	githubRepo: "owner/repo",
	installationId: 42,
	projectId: "proj-1",
	userId: "user-1",
};

describe("ensureSessionWorkspaceReady", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		withSessionWorkspaceLockMock.mockImplementation(
			async ({ run }: { run: () => Promise<unknown> }) => run(),
		);
	});

	it("reuse prepares only and does not acquire lock", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.ditto/worktrees/sess-1",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "", success: true });
		const { db, update } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc123",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
			lock: "acquire",
		});

		expect(result).toEqual({
			branchName: "ditto/session-sess-1",
			baseCommitSha: "abc123",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
		expect(execOrThrowMock).toHaveBeenCalledTimes(1);
		expect(String(execOrThrowMock.mock.calls[0]?.[1])).toContain(
			"rev-parse --git-path info/exclude",
		);
	});

	it("create syncs and acquires when lock is acquire", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.git",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "syncedsha\n", success: true });
		const { db, update } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: null,
				baseCommitSha: null,
				workspacePath: "/workspace",
			},
			lock: "acquire",
		});

		expect(result).toEqual({
			branchName: "ditto/session-sess-1",
			baseCommitSha: "syncedsha",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});
		expect(withSessionWorkspaceLockMock).toHaveBeenCalledTimes(1);
		expect(syncPrimaryWorkspaceFromGitHubMock).toHaveBeenCalled();
		expect(update).toHaveBeenCalled();
	});

	it("repair missing path keeps oldsha and acquires", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.git",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });
		const { db, update } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "oldsha",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
			lock: "acquire",
		});

		expect(result.baseCommitSha).toBe("oldsha");
		expect(result.workspacePath).toBe("/workspace/.ditto/worktrees/sess-1");
		// D1 fields already match canonical — bind skipped even after FS repair.
		expect(update).not.toHaveBeenCalled();
		expect(withSessionWorkspaceLockMock).toHaveBeenCalledTimes(1);
		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
	});

	it("repair empty baseCommitSha backfills from primary HEAD", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.git",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({
			stdout: "backfillsha\n",
			success: true,
		});
		const { db, update } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
			lock: "assumeHeld",
		});

		expect(result.baseCommitSha).toBe("backfillsha");
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalled();
		expect(
			execOrThrowMock.mock.calls.some((call) =>
				String(call[1]).includes("git rev-parse HEAD"),
			),
		).toBe(true);
	});

	it("repair non-canonical path binds canonical and keeps base", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.git") return { exists: true };
			if (path === "/workspace/old-path") return { exists: true };
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });
		const { db, update } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "oldsha",
				workspacePath: "/workspace/old-path",
			},
			lock: "assumeHeld",
		});

		expect(result.baseCommitSha).toBe("oldsha");
		expect(result.workspacePath).toBe("/workspace/.ditto/worktrees/sess-1");
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalled();
	});

	it("lock assumeHeld runs FS without acquire", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.git",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "syncedsha\n", success: true });
		const { db } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: null,
				baseCommitSha: null,
				workspacePath: "/workspace",
			},
			lock: "assumeHeld",
		});

		expect(result.baseCommitSha).toBe("syncedsha");
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
		expect(syncPrimaryWorkspaceFromGitHubMock).toHaveBeenCalled();
	});

	it("bind skips write when unchanged", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.ditto/worktrees/sess-1",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "", success: true });
		const { db, update } = makeBindDb();

		await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc123",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
			lock: "assumeHeld",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("bind zero rows throws", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.git",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });
		const { db } = makeBindDb({ returningId: null });

		await expect(
			ensureSessionWorkspaceReady({
				...readyBase,
				db,
				existing: {
					branchName: "ditto/session-sess-1",
					baseCommitSha: "oldsha",
					workspacePath: "/workspace/old-path",
				},
				lock: "assumeHeld",
			}),
		).rejects.toThrow(
			"Failed to bind session workspace: session not active or not found.",
		);
	});
});

describe("prepareSessionWorkspaceIfPresent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns worktree reason when path missing", async () => {
		const sandbox = makeSandbox(async () => ({ exists: false }));
		getProjectSandboxMock.mockReturnValue(sandbox);

		const result = await prepareSessionWorkspaceIfPresent({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
		});

		expect(result).toEqual({ ok: false, reason: "worktree" });
		expect(execOrThrowMock).not.toHaveBeenCalled();
	});

	it("prepares when canonical path exists", async () => {
		const sandbox = makeSandbox(async () => ({ exists: true }));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "", success: true });

		const result = await prepareSessionWorkspaceIfPresent({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
		});

		expect(result).toEqual({
			ok: true,
			branchName: "ditto/session-sess-1",
			baseCommitSha: "abc",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});
		expect(execOrThrowMock).toHaveBeenCalledTimes(1);
	});
});
