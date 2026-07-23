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
	ensureSessionWorktree,
	ensureSessionWorkspaceReady,
	prepareSessionWorktree,
	prepareSessionWorkspaceIfPresent,
} = await import("./session-worktree");

const worktreeOptions = {
	githubRepo: "owner/repo",
	installationId: 42,
};

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

describe("ensureSessionWorktree", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a worktree with private runtime-file excludes", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.git") {
				return { exists: true };
			}
			if (path === "/workspace/.ditto/worktrees/sess-1") {
				return { exists: false };
			}
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "syncedsha\n", success: true });

		const result = await ensureSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
			...worktreeOptions,
		});

		expect(
			syncPrimaryWorkspaceFromGitHubMock.mock.invocationCallOrder[0],
		).toBeLessThan(
			execOrThrowMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
		expect(syncPrimaryWorkspaceFromGitHubMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			githubRepo: "owner/repo",
			installationId: 42,
		});
		expect(result).toEqual({
			branchName: "ditto/session-sess-1",
			baseCommitSha: "syncedsha",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});
		expect(configureDittoGitIdentityMock).toHaveBeenCalledWith(
			sandbox,
			"/workspace",
		);
		expect(execOrThrowMock).toHaveBeenCalledTimes(4);
		expect(execOrThrowMock.mock.calls[1]?.[1]).toContain("git branch");
		expect(execOrThrowMock.mock.calls[2]?.[1]).toContain("git worktree add");
		const cmd = prepareCommand();
		expect(cmd).toContain("rev-parse --git-path info/exclude");
		expect(cmd).toContain("'/node_modules'");
		expect(cmd).toContain("'/.env'");
		expect(cmd).toContain("'/.env.*'");
		expect(cmd).toContain("rm --cached --ignore-unmatch");
		expect(cmd).toContain('ln -s "$PRIMARY"');
		expect(cmd).toContain('[ -L "$WT/node_modules" ]');
		expect(cmd.indexOf("info/exclude")).toBeLessThan(cmd.indexOf("ln -s"));
	});

	it("reuses existing metadata when worktree path still exists", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.ditto/worktrees/sess-1") {
				return { exists: true };
			}
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const result = await ensureSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
			...worktreeOptions,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc123",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
		});

		expect(result).toEqual({
			branchName: "ditto/session-sess-1",
			baseCommitSha: "abc123",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});
		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
		expect(execOrThrowMock).toHaveBeenCalledTimes(1);
		expect(execOrThrowMock.mock.calls[0]?.[1]).toContain(
			"rev-parse --git-path info/exclude",
		);
	});

	it("recreates worktree when stored path is missing", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.git") {
				return { exists: true };
			}
			if (path === "/workspace/.ditto/worktrees/sess-1") {
				return { exists: false };
			}
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });

		const result = await ensureSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
			...worktreeOptions,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "oldsha",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
		});

		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
		expect(result.baseCommitSha).toBe("oldsha");
		expect(result.workspacePath).toBe("/workspace/.ditto/worktrees/sess-1");
		expect(
			execOrThrowMock.mock.calls.some((call) =>
				String(call[1]).includes("git worktree add"),
			),
		).toBe(true);
	});

	it("backfills empty baseCommitSha from primary HEAD on repair", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.git") {
				return { exists: true };
			}
			if (path === "/workspace/.ditto/worktrees/sess-1") {
				return { exists: false };
			}
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({
			stdout: "backfillsha\n",
			success: true,
		});

		const result = await ensureSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
			...worktreeOptions,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
		});

		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
		expect(result.baseCommitSha).toBe("backfillsha");
		expect(
			execOrThrowMock.mock.calls.some((call) =>
				String(call[1]).includes("git rev-parse HEAD"),
			),
		).toBe(true);
	});

	it("does not create branch or worktree when sync fails", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.git") {
				return { exists: true };
			}
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		syncPrimaryWorkspaceFromGitHubMock.mockRejectedValueOnce(
			new Error("sync failed"),
		);

		await expect(
			ensureSessionWorktree({
				env: makeEnv(),
				sandboxId: "sandbox-1",
				sessionId: "sess-1",
				...worktreeOptions,
			}),
		).rejects.toThrow("sync failed");

		expect(execOrThrowMock).not.toHaveBeenCalled();
	});
});

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

	it("mode reuse prepares only and does not acquire lock", async () => {
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

		expect(result.mode).toBe("reuse");
		expect(result.baseCommitSha).toBe("abc123");
		expect(result.bound).toBe(false);
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
		expect(execOrThrowMock).toHaveBeenCalledTimes(1);
		expect(String(execOrThrowMock.mock.calls[0]?.[1])).toContain(
			"rev-parse --git-path info/exclude",
		);
	});

	it("mode create syncs and acquires when lock is acquire", async () => {
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
			lock: "acquire",
		});

		expect(result.mode).toBe("create");
		expect(result.baseCommitSha).toBe("syncedsha");
		expect(result.bound).toBe(true);
		expect(withSessionWorkspaceLockMock).toHaveBeenCalledTimes(1);
		expect(syncPrimaryWorkspaceFromGitHubMock).toHaveBeenCalled();
	});

	it("mode repair missing path keeps oldsha and acquires", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.git",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });
		const { db } = makeBindDb();

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

		expect(result.mode).toBe("repair");
		expect(result.baseCommitSha).toBe("oldsha");
		expect(result.workspacePath).toBe("/workspace/.ditto/worktrees/sess-1");
		// D1 fields already match canonical — bind skipped even after FS repair.
		expect(result.bound).toBe(false);
		expect(withSessionWorkspaceLockMock).toHaveBeenCalledTimes(1);
		expect(syncPrimaryWorkspaceFromGitHubMock).not.toHaveBeenCalled();
	});

	it("mode repair non-canonical path binds canonical and keeps base", async () => {
		const sandbox = makeSandbox(async (path) => {
			if (path === "/workspace/.git") return { exists: true };
			if (path === "/workspace/old-path") return { exists: true };
			return { exists: false };
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "newsha\n", success: true });
		const { db } = makeBindDb();

		const result = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "oldsha",
				workspacePath: "/workspace/old-path",
			},
			lock: "none",
		});

		expect(result.mode).toBe("repair");
		expect(result.baseCommitSha).toBe("oldsha");
		expect(result.workspacePath).toBe("/workspace/.ditto/worktrees/sess-1");
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
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

		expect(result.mode).toBe("create");
		expect(withSessionWorkspaceLockMock).not.toHaveBeenCalled();
		expect(syncPrimaryWorkspaceFromGitHubMock).toHaveBeenCalled();
	});

	it("bind writes only when changed", async () => {
		const sandbox = makeSandbox(async (path) => ({
			exists: path === "/workspace/.ditto/worktrees/sess-1",
		}));
		getProjectSandboxMock.mockReturnValue(sandbox);
		execOrThrowMock.mockResolvedValue({ stdout: "", success: true });
		const { db, update } = makeBindDb();

		const first = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc123",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
			lock: "none",
		});
		expect(first.bound).toBe(false);
		expect(update).not.toHaveBeenCalled();

		const second = await ensureSessionWorkspaceReady({
			...readyBase,
			db,
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "abc123",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
			lock: "none",
		});
		expect(second.bound).toBe(false);
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
				lock: "none",
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
