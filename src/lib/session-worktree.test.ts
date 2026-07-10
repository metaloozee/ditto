import { beforeEach, describe, expect, it, vi } from "vitest";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const execOrThrowMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	execOrThrow: execOrThrowMock,
}));

const { ensureSessionWorktree } = await import("./session-worktree");

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

	it("creates branch, worktree, and symlinks on first ensure", async () => {
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
		execOrThrowMock.mockResolvedValue({ stdout: "deadbeef\n", success: true });

		const result = await ensureSessionWorktree({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			sessionId: "sess-1",
		});

		expect(result).toEqual({
			branchName: "ditto/session-sess-1",
			baseCommitSha: "deadbeef",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		});
		expect(execOrThrowMock).toHaveBeenCalledTimes(4);
		expect(execOrThrowMock.mock.calls[1]?.[1]).toContain("git branch");
		expect(execOrThrowMock.mock.calls[2]?.[1]).toContain("git worktree add");
		expect(execOrThrowMock.mock.calls[3]?.[1]).toContain("ln -s");
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
		expect(execOrThrowMock).not.toHaveBeenCalled();
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
			existing: {
				branchName: "ditto/session-sess-1",
				baseCommitSha: "oldsha",
				workspacePath: "/workspace/.ditto/worktrees/sess-1",
			},
		});

		expect(result.baseCommitSha).toBe("newsha");
		expect(
			execOrThrowMock.mock.calls.some((call) =>
				String(call[1]).includes("git worktree add"),
			),
		).toBe(true);
	});
});
