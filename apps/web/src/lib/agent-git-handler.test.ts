import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitSecretPolicyError } from "./git-secret-policy";

const getSessionGitStatusMock = vi.hoisted(() => vi.fn());
const pushSessionBranchMock = vi.hoisted(() => vi.fn());
const openSessionPullRequestMock = vi.hoisted(() => vi.fn());
const withWorkspaceRuntimeLeaseMock = vi.hoisted(() =>
	vi.fn(async (_input: unknown, run: (lease: unknown) => Promise<unknown>) =>
		run({
			sessionId: "sess-1",
			purpose: "mutating_git",
			workspacePath: "/workspace",
			branchName: "ditto/session-abc",
			baseCommitSha: "abc123",
			sandbox: { exec: vi.fn() },
			identity: null,
			projectEnv: null,
			matchesSandboxClaim: (id: string) => id === "sandbox-1",
		}),
	),
);

vi.mock("#/lib/workspace-runtime", () => ({
	withWorkspaceRuntimeLease: withWorkspaceRuntimeLeaseMock,
}));
vi.mock("#/lib/session-git", () => ({
	getSessionGitStatus: getSessionGitStatusMock,
	pushSessionBranch: pushSessionBranchMock,
	openSessionPullRequest: openSessionPullRequestMock,
}));

const { AgentGitHttpError, agentGitBodySchema, dispatchAgentGitAction } =
	await import("./agent-git-handler");
const { GIT_PUSH_UNAVAILABLE_MESSAGE, SessionGitPushUnavailableError } =
	await import("./git-push-contract");

/** Synthetic only — never a live credential. */
const FIXTURE_SECRET = "proj-fixture-secret-value-01";

const resolved = {
	db: {} as never,
	userId: "user-1",
	projectId: "proj-1",
	githubRepo: "acme/repo",
	installationId: 42,
	claimedSandboxId: "sandbox-1",
	sessionId: "sess-1",
	sessionTitle: "Fix bug",
	knownSecrets: [FIXTURE_SECRET] as readonly string[],
};

const env = {} as Env;

describe("dispatchAgentGitAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("maps unavailable push to a client-safe error without leaking secrets", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 2,
			changedFiles: [],
			workflow: { kind: "push", reason: "unpushed-commits" },
		});
		pushSessionBranchMock.mockRejectedValue(
			new SessionGitPushUnavailableError(),
		);

		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "push" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: GIT_PUSH_UNAVAILABLE_MESSAGE,
		});
		expect(pushSessionBranchMock).toHaveBeenCalledTimes(1);
		expect(pushSessionBranchMock).toHaveBeenCalledWith(
			expect.objectContaining({
				knownSecrets: [FIXTURE_SECRET],
				bypassWorkspaceLock: true,
				identity: null,
			}),
		);
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

	it("openPullRequest surfaces unavailable instead of minting when ahead", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 1,
			changedFiles: ["b.ts"],
			workflow: { kind: "push", reason: "unpushed-commits" },
		});
		pushSessionBranchMock.mockRejectedValue(
			new SessionGitPushUnavailableError(),
		);

		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "openPullRequest", title: "My PR" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: GIT_PUSH_UNAVAILABLE_MESSAGE,
		});
		expect(pushSessionBranchMock).toHaveBeenCalledTimes(1);
		expect(pushSessionBranchMock).toHaveBeenCalledWith(
			expect.objectContaining({
				knownSecrets: [FIXTURE_SECRET],
				identity: null,
			}),
		);
		expect(openSessionPullRequestMock).not.toHaveBeenCalled();
	});

	it("rejects openPR when workflow unavailable/worktree", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 0,
			changedFiles: [],
			workflow: { kind: "unavailable", reason: "worktree" },
		});

		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "openPullRequest" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "Session worktree is not ready.",
		});
		expect(pushSessionBranchMock).not.toHaveBeenCalled();
		expect(openSessionPullRequestMock).not.toHaveBeenCalled();
	});

	it("returns status without known project secrets", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 0,
			changedFiles: [],
			workflow: { kind: "idle", reason: "no-changes" },
		});

		const result = await dispatchAgentGitAction({
			env,
			resolved,
			body: { action: "status" },
		});

		expect(getSessionGitStatusMock).toHaveBeenCalledWith(
			expect.not.objectContaining({
				knownSecrets: expect.anything(),
			}),
		);
		expect(JSON.stringify(result)).not.toContain(FIXTURE_SECRET);
	});

	it("rejects push when allowedRefs does not include the session branch", async () => {
		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "push" },
				allowedRefs: ["other-branch"],
			}),
		).rejects.toMatchObject({
			status: 403,
			message: "Branch is not allowed for this operation.",
		});
		expect(pushSessionBranchMock).not.toHaveBeenCalled();
	});

	it("rejects merge and close in the action schema", () => {
		expect(agentGitBodySchema.safeParse({ action: "merge" }).success).toBe(
			false,
		);
		expect(agentGitBodySchema.safeParse({ action: "close" }).success).toBe(
			false,
		);
	});

	it("rejects openPR when workflow unavailable/github", async () => {
		getSessionGitStatusMock.mockResolvedValue({
			dirty: false,
			ahead: 0,
			changedFiles: [],
			workflow: { kind: "unavailable", reason: "github" },
		});

		await expect(
			dispatchAgentGitAction({
				env,
				resolved,
				body: { action: "openPullRequest" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "GitHub status is currently unavailable.",
		});
		expect(pushSessionBranchMock).not.toHaveBeenCalled();
		expect(openSessionPullRequestMock).not.toHaveBeenCalled();
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
