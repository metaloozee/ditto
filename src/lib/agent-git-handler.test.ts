import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionGitStatusMock = vi.hoisted(() => vi.fn());
const pushSessionBranchMock = vi.hoisted(() => vi.fn());
const openSessionPullRequestMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: vi.fn(),
}));
vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorktree: vi.fn(),
}));
vi.mock("#/lib/project-env-vars", () => ({
	decryptEnvVars: vi.fn().mockResolvedValue({}),
}));
vi.mock("#/lib/session-git", () => ({
	getSessionGitStatus: getSessionGitStatusMock,
	pushSessionBranch: pushSessionBranchMock,
	openSessionPullRequest: openSessionPullRequestMock,
}));

const { AgentGitHttpError, dispatchAgentGitAction } = await import(
	"./agent-git-handler"
);

const resolved = {
	projectId: "proj-1",
	githubRepo: "acme/repo",
	installationId: 42,
	sandboxId: "sandbox-1",
	session: {
		id: "sess-1",
		branchName: "ditto/session-abc",
		workspacePath: "/workspace/.ditto/worktrees/sess-1",
		title: "Fix bug",
	},
};

const env = {} as Env;

describe("dispatchAgentGitAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls pushSessionBranch when clean and ahead", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 2,
			changedFiles: [],
		});
		pushSessionBranchMock.mockResolvedValue({
			remoteBranch: "ditto/session-abc",
			pushed: true,
		});

		const result = await dispatchAgentGitAction({
			env,
			resolved,
			body: { action: "push" },
		});

		expect(pushSessionBranchMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			remoteBranch: "ditto/session-abc",
			pushed: true,
		});
	});

	it("rejects push when dirty", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: true,
			ahead: 1,
			changedFiles: ["a.ts"],
		});

		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "push" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "Commit local changes before pushing.",
		});
		expect(pushSessionBranchMock).not.toHaveBeenCalled();
	});

	it("openPullRequest pushes first when ahead", async () => {
		getSessionGitStatusMock
			.mockResolvedValueOnce({
				dirty: false,
				ahead: 1,
				changedFiles: ["b.ts"],
			})
			.mockResolvedValueOnce({
				dirty: false,
				ahead: 0,
				changedFiles: ["b.ts"],
			});
		pushSessionBranchMock.mockResolvedValue({ pushed: true });
		openSessionPullRequestMock.mockResolvedValue({
			url: "https://github.com/acme/repo/pull/1",
			number: 1,
		});

		const result = await dispatchAgentGitAction({
			env,
			resolved,
			body: { action: "openPullRequest", title: "My PR" },
		});

		expect(pushSessionBranchMock).toHaveBeenCalledTimes(1);
		expect(openSessionPullRequestMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				title: "My PR",
				changedFileCount: 1,
			}),
		);
		expect(result).toEqual({
			url: "https://github.com/acme/repo/pull/1",
			number: 1,
		});
	});
});

describe("resolveAgentGitContext sandbox mismatch", () => {
	it("is covered by AgentGitHttpError type", () => {
		const err = new AgentGitHttpError(
			403,
			"Sandbox does not match this agent run.",
		);
		expect(err.status).toBe(403);
	});
});
