import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/session-git", () => ({
	getSessionGitStatus: vi.fn(),
	pushSessionBranch: vi.fn(),
	openSessionPullRequest: vi.fn(),
}));

const {
	runPushThenOpenPullRequest,
	SESSION_GIT_OPEN_PR_DIRTY_MESSAGE,
	SESSION_WORKTREE_UNAVAILABLE_MESSAGE,
	SessionGitExportPreconditionError,
	sessionGitOpenPullRequestBlocker,
} = await import("./session-git-export");

type SessionGitWorkflow = Parameters<
	typeof sessionGitOpenPullRequestBlocker
>[0];

const pullRequest = {
	url: "https://example.com/pr/9",
	number: 9,
	state: "open" as const,
};

const session = {
	id: "sess-1",
	branchName: "ditto/sess-1",
	baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	workspacePath: "/workspace/.ditto/worktrees/sess-1",
};

function makeCtx(overrides: { bypassWorkspaceLock?: boolean } = {}) {
	return {
		env: {} as Env,
		sandboxId: "s1",
		installationId: 1,
		githubRepo: "acme/repo",
		session,
		knownSecrets: ["secret"],
		...overrides,
	};
}

describe("sessionGitOpenPullRequestBlocker", () => {
	const cases: Array<{
		workflow: SessionGitWorkflow;
		expected: string | null;
	}> = [
		{ workflow: { kind: "open-pr" }, expected: null },
		{
			workflow: { kind: "push", reason: "unpushed-commits" },
			expected: null,
		},
		{
			workflow: { kind: "open-pr-existing", pullRequest },
			expected: null,
		},
		{
			workflow: { kind: "unavailable", reason: "worktree" },
			expected: SESSION_WORKTREE_UNAVAILABLE_MESSAGE,
		},
		{
			workflow: { kind: "unavailable", reason: "github" },
			expected: "GitHub status is currently unavailable.",
		},
		{
			workflow: { kind: "merged-pr", pullRequest },
			expected: "This session pull request has already been merged.",
		},
		{
			workflow: { kind: "closed-pr", pullRequest },
			expected: "This session pull request is closed.",
		},
		{
			workflow: { kind: "sync", baseBranch: "main" },
			expected: "Sync the latest main before opening a pull request.",
		},
		{
			workflow: { kind: "idle", reason: "no-changes" },
			expected: "This session has no changes to open as a pull request.",
		},
		{
			workflow: { kind: "commit" },
			expected: "This session has no changes to open as a pull request.",
		},
	];

	it.each(cases)("$workflow.kind → $expected", ({ workflow, expected }) => {
		expect(sessionGitOpenPullRequestBlocker(workflow)).toBe(expected);
	});
});

describe("runPushThenOpenPullRequest", () => {
	const getSessionGitStatus = vi.fn();
	const pushSessionBranch = vi.fn();
	const openSessionPullRequest = vi.fn();
	const deps = {
		getSessionGitStatus,
		pushSessionBranch,
		openSessionPullRequest,
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws on dirty without push/open", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: true,
			workflow: { kind: "commit" },
		});

		await expect(
			runPushThenOpenPullRequest({
				ctx: makeCtx(),
				deps,
				existingPullRequestPolicy: "open",
			}),
		).rejects.toMatchObject({
			name: "SessionGitExportPreconditionError",
			message: SESSION_GIT_OPEN_PR_DIRTY_MESSAGE,
		});
		expect(pushSessionBranch).not.toHaveBeenCalled();
		expect(openSessionPullRequest).not.toHaveBeenCalled();
	});

	it("shortCircuits existing before push", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "open-pr-existing", pullRequest },
		});

		const outcome = await runPushThenOpenPullRequest({
			ctx: makeCtx(),
			deps,
			existingPullRequestPolicy: "shortCircuit",
		});

		expect(outcome).toEqual({
			didPush: false,
			result: { url: pullRequest.url, number: pullRequest.number },
		});
		expect(openSessionPullRequest).not.toHaveBeenCalled();
		expect(pushSessionBranch).not.toHaveBeenCalled();
	});

	it("opens existing when policy is open", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "open-pr-existing", pullRequest },
		});
		openSessionPullRequest.mockResolvedValue({
			url: pullRequest.url,
			number: pullRequest.number,
		});

		const outcome = await runPushThenOpenPullRequest({
			ctx: makeCtx(),
			deps,
			title: "T",
			body: "B",
			baseBranch: "main",
			existingPullRequestPolicy: "open",
		});

		expect(outcome.didPush).toBe(false);
		expect(openSessionPullRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "T",
				body: "B",
				baseBranch: "main",
			}),
		);
		expect(pushSessionBranch).not.toHaveBeenCalled();
	});

	it("opens once for open-pr without push", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "open-pr" },
		});
		openSessionPullRequest.mockResolvedValue({
			url: "https://example.com/pr/2",
			number: 2,
		});

		const outcome = await runPushThenOpenPullRequest({
			ctx: makeCtx(),
			deps,
			title: "Title",
			body: "Body",
			baseBranch: "develop",
			existingPullRequestPolicy: "open",
		});

		expect(outcome).toEqual({
			didPush: false,
			result: { url: "https://example.com/pr/2", number: 2 },
		});
		expect(pushSessionBranch).not.toHaveBeenCalled();
		expect(openSessionPullRequest).toHaveBeenCalledTimes(1);
		expect(openSessionPullRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Title",
				body: "Body",
				baseBranch: "develop",
			}),
		);
	});

	it("pushes then opens and calls onDidPush once", async () => {
		getSessionGitStatus
			.mockResolvedValueOnce({
				dirty: false,
				workflow: { kind: "push", reason: "unpushed-commits" },
			})
			.mockResolvedValueOnce({
				dirty: false,
				workflow: { kind: "open-pr" },
			});
		pushSessionBranch.mockResolvedValue({ pushed: true });
		openSessionPullRequest.mockResolvedValue({
			url: "https://example.com/pr/3",
			number: 3,
		});
		const onDidPush = vi.fn();

		const outcome = await runPushThenOpenPullRequest({
			ctx: makeCtx({ bypassWorkspaceLock: true }),
			deps,
			existingPullRequestPolicy: "open",
			onDidPush,
		});

		expect(outcome).toEqual({
			didPush: true,
			result: { url: "https://example.com/pr/3", number: 3 },
		});
		expect(pushSessionBranch).toHaveBeenCalledTimes(1);
		expect(pushSessionBranch).toHaveBeenCalledWith(
			expect.objectContaining({ bypassWorkspaceLock: true }),
		);
		expect(onDidPush).toHaveBeenCalledTimes(1);
		expect(openSessionPullRequest).toHaveBeenCalledTimes(1);
	});

	it("pushes then shortCircuits existing without open", async () => {
		getSessionGitStatus
			.mockResolvedValueOnce({
				dirty: false,
				workflow: { kind: "push", reason: "unpushed-commits" },
			})
			.mockResolvedValueOnce({
				dirty: false,
				workflow: { kind: "open-pr-existing", pullRequest },
			});
		pushSessionBranch.mockResolvedValue({ pushed: true });

		const outcome = await runPushThenOpenPullRequest({
			ctx: makeCtx(),
			deps,
			existingPullRequestPolicy: "shortCircuit",
		});

		expect(outcome).toEqual({
			didPush: true,
			result: { url: pullRequest.url, number: pullRequest.number },
		});
		expect(openSessionPullRequest).not.toHaveBeenCalled();
	});

	it("pushes then throws blocker when restatus is sync", async () => {
		getSessionGitStatus
			.mockResolvedValueOnce({
				dirty: false,
				workflow: { kind: "push", reason: "unpushed-commits" },
			})
			.mockResolvedValueOnce({
				dirty: false,
				workflow: { kind: "sync", baseBranch: "main" },
			});
		pushSessionBranch.mockResolvedValue({ pushed: true });

		await expect(
			runPushThenOpenPullRequest({
				ctx: makeCtx(),
				deps,
				existingPullRequestPolicy: "open",
			}),
		).rejects.toMatchObject({
			name: "SessionGitExportPreconditionError",
			message: "Sync the latest main before opening a pull request.",
		});
		expect(openSessionPullRequest).not.toHaveBeenCalled();
	});

	it("throws sync message without push", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "sync", baseBranch: "main" },
		});

		await expect(
			runPushThenOpenPullRequest({
				ctx: makeCtx(),
				deps,
				existingPullRequestPolicy: "open",
			}),
		).rejects.toMatchObject({
			message: "Sync the latest main before opening a pull request.",
		});
		expect(pushSessionBranch).not.toHaveBeenCalled();
	});

	it("throws worktree unavailable exactly", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "unavailable", reason: "worktree" },
		});

		await expect(
			runPushThenOpenPullRequest({
				ctx: makeCtx(),
				deps,
				existingPullRequestPolicy: "open",
			}),
		).rejects.toBeInstanceOf(SessionGitExportPreconditionError);

		await expect(
			runPushThenOpenPullRequest({
				ctx: makeCtx(),
				deps,
				existingPullRequestPolicy: "open",
			}),
		).rejects.toMatchObject({
			message: SESSION_WORKTREE_UNAVAILABLE_MESSAGE,
		});
		expect(pushSessionBranch).not.toHaveBeenCalled();
		expect(openSessionPullRequest).not.toHaveBeenCalled();
	});

	it("propagates push failure without calling onDidPush", async () => {
		getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "push", reason: "unpushed-commits" },
		});
		pushSessionBranch.mockRejectedValue(new Error("push boom"));
		const onDidPush = vi.fn();

		await expect(
			runPushThenOpenPullRequest({
				ctx: makeCtx(),
				deps,
				existingPullRequestPolicy: "open",
				onDidPush,
			}),
		).rejects.toThrow("push boom");
		expect(onDidPush).not.toHaveBeenCalled();
		expect(openSessionPullRequest).not.toHaveBeenCalled();
	});
});
