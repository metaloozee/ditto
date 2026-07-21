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

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	execOrThrow: execOrThrowMock,
	configureDittoGitIdentity: configureDittoGitIdentityMock,
	syncPrimaryWorkspaceFromGitHub: syncPrimaryWorkspaceFromGitHubMock,
}));

const { ensureSessionWorktree } = await import("./session-worktree");

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
		const prepareCommand = String(execOrThrowMock.mock.calls[3]?.[1]);
		expect(prepareCommand).toContain("rev-parse --git-path info/exclude");
		expect(prepareCommand).toContain("'/node_modules'");
		expect(prepareCommand).toContain("'/.env'");
		expect(prepareCommand).toContain("'/.env.*'");
		expect(prepareCommand).toContain("rm --cached --ignore-unmatch");
		expect(prepareCommand).toContain("ln -s");
		expect(prepareCommand.indexOf("info/exclude")).toBeLessThan(
			prepareCommand.indexOf("ln -s"),
		);
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
		expect(result.baseCommitSha).toBe("newsha");
		expect(
			execOrThrowMock.mock.calls.some((call) =>
				String(call[1]).includes("git worktree add"),
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
