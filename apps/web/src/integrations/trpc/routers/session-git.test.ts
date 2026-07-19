import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMocks = vi.hoisted(() => ({
	createDb: vi.fn(),
	authorizeGitHubRepositoryAccess: vi.fn(),
	decryptEnvVars: vi.fn(),
	ensureProjectSandbox: vi.fn(),
	ensureSessionWorktree: vi.fn(),
	loadOwnedActiveSession: vi.fn(),
	commitSessionChanges: vi.fn(),
	commitSessionChangesWithBackup: vi.fn(),
	commitSessionChangesWithGeneratedMessage: vi.fn(),
	openSessionPullRequestWithGeneratedMetadata: vi.fn(),
	openSessionPullRequest: vi.fn(),
	getSessionGitStatus: vi.fn(),
	pushSessionBranch: vi.fn(),
	bestEffortPersistSessionGitBackup: vi.fn(),
	runSessionGitMutationWithBackup: vi.fn(),
	syncSessionBranch: vi.fn(),
}));

vi.mock("#/db", () => ({
	createDb: resolveMocks.createDb,
}));

vi.mock("#/db/schema", () => ({
	projects: { id: "id", userId: "userId" },
	workspaceSessions: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => args),
	eq: vi.fn((...args: unknown[]) => args),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("#/lib/github-authorization", () => ({
	authorizeGitHubRepositoryAccess: resolveMocks.authorizeGitHubRepositoryAccess,
}));

vi.mock("#/lib/project-env-vars", () => ({
	decryptEnvVars: resolveMocks.decryptEnvVars,
}));

vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: resolveMocks.ensureProjectSandbox,
}));

vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorktree: resolveMocks.ensureSessionWorktree,
}));

vi.mock("#/lib/workspace-session", () => ({
	loadOwnedActiveSession: resolveMocks.loadOwnedActiveSession,
}));

vi.mock("#/lib/session-git", () => ({
	commitSessionChanges: resolveMocks.commitSessionChanges,
	GITHUB_APP_PR_PERMISSION_MESSAGE: "pr-perm",
	GITHUB_APP_PUSH_PERMISSION_MESSAGE: "push-perm",
	getSessionGitStatus: resolveMocks.getSessionGitStatus,
	openSessionPullRequest: resolveMocks.openSessionPullRequest,
	pushSessionBranch: resolveMocks.pushSessionBranch,
	SessionGitSyncPreconditionError: class SessionGitSyncPreconditionError extends Error {},
	syncSessionBranch: resolveMocks.syncSessionBranch,
}));

vi.mock("#/lib/session-git-backup", () => ({
	bestEffortPersistSessionGitBackup:
		resolveMocks.bestEffortPersistSessionGitBackup,
	commitSessionChangesWithBackup: resolveMocks.commitSessionChangesWithBackup,
	runSessionGitMutationWithBackup: resolveMocks.runSessionGitMutationWithBackup,
}));

vi.mock("#/lib/session-git-ui-actions", () => ({
	commitSessionChangesWithGeneratedMessage:
		resolveMocks.commitSessionChangesWithGeneratedMessage,
	openSessionPullRequestWithGeneratedMetadata:
		resolveMocks.openSessionPullRequestWithGeneratedMetadata,
}));

vi.mock("#/lib/session-git-metadata", () => ({
	SessionGitMetadataError: class SessionGitMetadataError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.name = "SessionGitMetadataError";
			this.code = code;
		}
	},
}));

vi.mock("#/lib/session-git-trpc-errors", () => ({
	rethrowOrMapSessionGitMutationError: (error: unknown) => {
		throw error;
	},
}));

vi.mock("#/lib/git-secret-policy", () => ({
	GitSecretPolicyError: class GitSecretPolicyError extends Error {},
}));

vi.mock("../init", () => ({
	createTRPCRouter: (routes: Record<string, unknown>) => routes,
	protectedProcedure: {
		input: () => ({
			query: (fn: unknown) => ({ query: fn }),
			mutation: (fn: unknown) => ({ mutation: fn }),
		}),
	},
}));

const { sessionGitRouter } = await import("./session-git");
const { SessionGitMetadataError } = await import("#/lib/session-git-metadata");
const { SessionWorkspaceBusyError } = await import(
	"#/lib/session-workspace-lock-error"
);

function setupResolved() {
	const db = {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(async () => [
						{
							id: "proj-1",
							userId: "user-1",
							githubRepo: "acme/repo",
							githubInstallationId: 9,
							status: "ready",
							sandboxId: "sbx-1",
							envVars: null,
						},
					]),
				})),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async () => undefined),
			})),
		})),
	};
	resolveMocks.createDb.mockReturnValue(db);
	resolveMocks.loadOwnedActiveSession.mockResolvedValue({
		id: "sess-1",
		branchName: "ditto/sess-1",
		baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		workspacePath: "/workspace/.ditto/worktrees/sess-1",
		title: "Add billing",
	});
	resolveMocks.ensureSessionWorktree.mockResolvedValue({
		branchName: "ditto/sess-1",
		baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		workspacePath: "/workspace/.ditto/worktrees/sess-1",
	});
	resolveMocks.decryptEnvVars.mockResolvedValue([
		{ key: "SECRET", value: "secretvalue1" },
	]);
	resolveMocks.authorizeGitHubRepositoryAccess.mockResolvedValue(undefined);
	resolveMocks.ensureProjectSandbox.mockResolvedValue(undefined);
	return db;
}

const ctx = {
	env: { OPENCODE_API_KEY: "sk-test-key-12345678901234567890" } as Env,
	user: { id: "user-1", name: "U", email: "u@example.com" },
	auth: {},
	request: { headers: new Headers() },
};

type MockMutation = {
	mutation: (args: {
		ctx: typeof ctx;
		input: Record<string, unknown>;
	}) => Promise<unknown>;
};

function asMutation(procedure: unknown): MockMutation {
	return procedure as MockMutation;
}

describe("sessionGitRouter commit/openPullRequest metadata wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupResolved();
	});

	it("delegates absent commit message to generated orchestration", async () => {
		resolveMocks.commitSessionChangesWithGeneratedMessage.mockResolvedValue({
			commitSha: "abc",
			committed: true,
			message: "feat: add billing",
		});
		const result = await asMutation(sessionGitRouter.commit).mutation({
			ctx,
			input: { projectId: "proj-1", sessionId: "sess-1" },
		});
		expect(result).toEqual({
			commitSha: "abc",
			committed: true,
			message: "feat: add billing",
		});
		expect(
			resolveMocks.commitSessionChangesWithGeneratedMessage,
		).toHaveBeenCalled();
		expect(resolveMocks.commitSessionChangesWithBackup).not.toHaveBeenCalled();
	});

	it("keeps explicit commit message on the legacy path without generation", async () => {
		resolveMocks.commitSessionChangesWithBackup.mockImplementation(
			async ({ commit }) => commit(),
		);
		resolveMocks.commitSessionChanges.mockResolvedValue({
			commitSha: "abc",
			committed: true,
		});
		await asMutation(sessionGitRouter.commit).mutation({
			ctx,
			input: {
				projectId: "proj-1",
				sessionId: "sess-1",
				message: "chore: manual",
			},
		});
		expect(resolveMocks.commitSessionChanges).toHaveBeenCalledWith(
			expect.objectContaining({ message: "chore: manual" }),
		);
		expect(
			resolveMocks.commitSessionChangesWithGeneratedMessage,
		).not.toHaveBeenCalled();
	});

	it("maps metadata failures to actionable BAD_GATEWAY without side effects", async () => {
		resolveMocks.commitSessionChangesWithGeneratedMessage.mockRejectedValue(
			new SessionGitMetadataError("missing_result", "no tool"),
		);
		await expect(
			asMutation(sessionGitRouter.commit).mutation({
				ctx,
				input: { projectId: "proj-1", sessionId: "sess-1" },
			}),
		).rejects.toMatchObject({
			code: "BAD_GATEWAY",
			message: expect.stringContaining("No commit was created"),
		});
	});

	it("maps busy lock to PRECONDITION_FAILED", async () => {
		resolveMocks.commitSessionChangesWithGeneratedMessage.mockRejectedValue(
			new SessionWorkspaceBusyError(),
		);
		await expect(
			asMutation(sessionGitRouter.commit).mutation({
				ctx,
				input: { projectId: "proj-1", sessionId: "sess-1" },
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("delegates absent PR metadata to generated orchestration", async () => {
		resolveMocks.openSessionPullRequestWithGeneratedMetadata.mockResolvedValue({
			url: "https://example.com/pr/3",
			number: 3,
			title: "Add billing",
		});
		const result = (await asMutation(sessionGitRouter.openPullRequest).mutation(
			{
				ctx,
				input: { projectId: "proj-1", sessionId: "sess-1" },
			},
		)) as { title: string };
		expect(result.title).toBe("Add billing");
		expect(
			resolveMocks.openSessionPullRequestWithGeneratedMetadata,
		).toHaveBeenCalled();
		expect(resolveMocks.openSessionPullRequest).not.toHaveBeenCalled();
	});

	it("keeps explicit PR fields on the deterministic path", async () => {
		resolveMocks.getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "open-pr" },
		});
		resolveMocks.openSessionPullRequest.mockResolvedValue({
			url: "https://example.com/pr/4",
			number: 4,
		});
		await asMutation(sessionGitRouter.openPullRequest).mutation({
			ctx,
			input: {
				projectId: "proj-1",
				sessionId: "sess-1",
				title: "Manual title",
				body: "Manual body",
			},
		});
		expect(resolveMocks.openSessionPullRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Manual title",
				body: "Manual body",
			}),
		);
		expect(
			resolveMocks.openSessionPullRequestWithGeneratedMetadata,
		).not.toHaveBeenCalled();
	});

	it("keeps title-only, body-only, and explicit-base callers non-generated", async () => {
		resolveMocks.getSessionGitStatus.mockResolvedValue({
			dirty: false,
			workflow: { kind: "open-pr" },
		});
		resolveMocks.openSessionPullRequest.mockResolvedValue({
			url: "https://example.com/pr/5",
			number: 5,
		});

		for (const input of [
			{ projectId: "proj-1", sessionId: "sess-1", title: "Only title" },
			{ projectId: "proj-1", sessionId: "sess-1", body: "Only body" },
			{ projectId: "proj-1", sessionId: "sess-1", baseBranch: "develop" },
		]) {
			resolveMocks.openSessionPullRequestWithGeneratedMetadata.mockClear();
			resolveMocks.openSessionPullRequest.mockClear();
			await asMutation(sessionGitRouter.openPullRequest).mutation({
				ctx,
				input,
			});
			expect(
				resolveMocks.openSessionPullRequestWithGeneratedMetadata,
			).not.toHaveBeenCalled();
			expect(resolveMocks.openSessionPullRequest).toHaveBeenCalled();
		}
	});

	it("maps snapshot_failed with controlled message and never leaks raw stderr sentinels", async () => {
		const SENTINEL = "RAW_GIT_STDERR_SENTINEL_abc123";
		resolveMocks.commitSessionChangesWithGeneratedMessage.mockRejectedValue(
			new SessionGitMetadataError(
				"snapshot_failed",
				"Commit local changes before drafting pull request metadata.",
			),
		);
		// Controlled precondition text is preserved.
		await expect(
			asMutation(sessionGitRouter.commit).mutation({
				ctx,
				input: { projectId: "proj-1", sessionId: "sess-1" },
			}),
		).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: "Commit local changes before drafting pull request metadata.",
		});

		// Even if an internal bug put a sentinel into the error, agent_failed path
		// uses a static BAD_GATEWAY message (not the raw error text).
		resolveMocks.commitSessionChangesWithGeneratedMessage.mockRejectedValue(
			new SessionGitMetadataError("agent_failed", SENTINEL),
		);
		await expect(
			asMutation(sessionGitRouter.commit).mutation({
				ctx,
				input: { projectId: "proj-1", sessionId: "sess-1" },
			}),
		).rejects.toSatisfy((error: unknown) => {
			const err = error as { code?: string; message?: string };
			expect(err.code).toBe("BAD_GATEWAY");
			expect(err.message).not.toContain(SENTINEL);
			expect(err.message).toContain("No commit was created");
			return true;
		});
	});
});
