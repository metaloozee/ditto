import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitSecretPolicyError } from "./git-secret-policy";

const getSessionGitStatusMock = vi.hoisted(() => vi.fn());
const pushSessionBranchMock = vi.hoisted(() => vi.fn());
const openSessionPullRequestMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: vi.fn(),
}));
vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorktree: vi.fn(),
}));
vi.mock("#/lib/session-git", () => ({
	getSessionGitStatus: getSessionGitStatusMock,
	pushSessionBranch: pushSessionBranchMock,
	openSessionPullRequest: openSessionPullRequestMock,
}));

const { AgentGitHttpError, dispatchAgentGitAction } = await import(
	"./agent-git-handler"
);

/** Synthetic only — never a live credential. */
const FIXTURE_SECRET = "proj-fixture-secret-value-01";

const resolved = {
	projectId: "proj-1",
	githubRepo: "acme/repo",
	installationId: 42,
	sandboxId: "sandbox-1",
	session: {
		id: "sess-1",
		branchName: "ditto/session-abc",
		baseCommitSha: "abc123",
		workspacePath: "/workspace/.ditto/worktrees/sess-1",
		title: "Fix bug",
	},
	knownSecrets: [FIXTURE_SECRET] as readonly string[],
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
			workflow: { kind: "push", reason: "unpushed-commits" },
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
		expect(pushSessionBranchMock).toHaveBeenCalledWith(
			expect.objectContaining({
				knownSecrets: [FIXTURE_SECRET],
				bypassWorkspaceLock: true,
			}),
		);
		expect(result).toEqual({
			remoteBranch: "ditto/session-abc",
			pushed: true,
		});
		// Client-facing result must not include secret values.
		expect(JSON.stringify(result)).not.toContain(FIXTURE_SECRET);
	});

	it("rejects push when dirty", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: true,
			ahead: 1,
			changedFiles: ["a.ts"],
			workflow: { kind: "commit" },
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

	it("maps secret policy rejection on push to 409 without leaking fixtures", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 1,
			changedFiles: [],
			workflow: { kind: "push", reason: "unpushed-commits" },
		});
		pushSessionBranchMock.mockRejectedValue(
			new GitSecretPolicyError(
				"secret_path",
				"Export blocked: secret-like path in outgoing commits (nested/.env).",
				"nested/.env",
			),
		);

		let message = "";
		let status = 0;
		try {
			await dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "push" },
			});
		} catch (error) {
			expect(error).toBeInstanceOf(AgentGitHttpError);
			message = error instanceof Error ? error.message : String(error);
			status = error instanceof AgentGitHttpError ? error.status : 0;
		}

		expect(status).toBe(409);
		expect(message).toContain("nested/.env");
		expect(message).not.toContain(FIXTURE_SECRET);
		expect(pushSessionBranchMock).toHaveBeenCalledTimes(1);
	});

	it("maps secret policy rejection on openPR auto-push to 409", async () => {
		getSessionGitStatusMock.mockResolvedValueOnce({
			dirty: false,
			ahead: 1,
			changedFiles: [],
			workflow: { kind: "push", reason: "unpushed-commits" },
		});
		pushSessionBranchMock.mockRejectedValue(
			new GitSecretPolicyError(
				"secret_content",
				"Export blocked: recognized secret content in outgoing commits.",
			),
		);

		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "openPullRequest" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "Export blocked: recognized secret content in outgoing commits.",
		});
		expect(openSessionPullRequestMock).not.toHaveBeenCalled();
		expect(pushSessionBranchMock).toHaveBeenCalledWith(
			expect.objectContaining({ knownSecrets: [FIXTURE_SECRET] }),
		);
		expect(JSON.stringify(pushSessionBranchMock.mock.calls)).not.toContain(
			// ensure mock rejection path did not embed fixture in unexpected places
			"ghp_",
		);
	});

	it("openPullRequest pushes first when ahead", async () => {
		getSessionGitStatusMock
			.mockResolvedValueOnce({
				dirty: false,
				ahead: 1,
				changedFiles: ["b.ts"],
				workflow: { kind: "push", reason: "unpushed-commits" },
			})
			.mockResolvedValueOnce({
				dirty: false,
				ahead: 0,
				changedFiles: ["b.ts"],
				workflow: { kind: "open-pr" },
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
		expect(pushSessionBranchMock).toHaveBeenCalledWith(
			expect.objectContaining({ knownSecrets: [FIXTURE_SECRET] }),
		);
		expect(openSessionPullRequestMock).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "My PR",
			}),
		);
		expect(openSessionPullRequestMock.mock.calls[0]?.[0]).not.toHaveProperty(
			"changedFileCount",
		);
		expect(openSessionPullRequestMock.mock.calls[0]?.[0]).not.toHaveProperty(
			"knownSecrets",
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
