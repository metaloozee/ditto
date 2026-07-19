import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/session-git", () => ({
	commitSessionChanges: vi.fn(),
	getSessionGitStatus: vi.fn(),
	openSessionPullRequest: vi.fn(),
	pushSessionBranch: vi.fn(),
}));

vi.mock("#/lib/session-git-backup", () => ({
	bestEffortPersistSessionGitBackup: vi.fn(),
}));

vi.mock("#/lib/session-git-metadata", () => ({
	generateCommitMetadata: vi.fn(),
	generatePullRequestMetadata: vi.fn(),
	SessionGitMetadataError: class SessionGitMetadataError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.name = "SessionGitMetadataError";
			this.code = code;
		}
	},
}));

vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: vi.fn(
		async ({ run }: { run: () => Promise<unknown> }) => await run(),
	),
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
}));

const { SessionWorkspaceBusyError } = await import(
	"#/lib/session-workspace-lock-error"
);
const {
	commitSessionChangesWithGeneratedMessage,
	openSessionPullRequestWithGeneratedMetadata,
} = await import("./session-git-ui-actions");

import type {
	SessionGitUiActionContext,
	SessionGitUiActionDeps,
} from "./session-git-ui-actions";

function makeCtx(): SessionGitUiActionContext {
	return {
		env: {} as Env,
		db: {} as SessionGitUiActionContext["db"],
		project: {
			id: "p1",
			userId: "u1",
			sandboxId: "s1",
			status: "ready",
		},
		sandboxId: "s1",
		installationId: 1,
		githubRepo: "acme/repo",
		session: {
			id: "sess-1",
			branchName: "ditto/sess-1",
			baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			workspacePath: "/workspace/.ditto/worktrees/sess-1",
		},
		knownSecrets: ["secretvalue1"],
	};
}

function makeDeps(overrides: Partial<SessionGitUiActionDeps> = {}) {
	const order: string[] = [];
	const deps: SessionGitUiActionDeps = {
		withSessionWorkspaceLock: vi.fn(async ({ run }) => {
			order.push("lock:enter");
			try {
				return await run();
			} finally {
				order.push("lock:exit");
			}
		}),
		getSessionGitStatus: vi.fn(),
		generateCommitMetadata: vi.fn(),
		generatePullRequestMetadata: vi.fn(),
		commitSessionChanges: vi.fn(),
		pushSessionBranch: vi.fn(),
		openSessionPullRequest: vi.fn(),
		bestEffortPersistSessionGitBackup: vi.fn(async () => {
			order.push("backup");
		}),
		...overrides,
	};
	return { deps, order };
}

describe("commitSessionChangesWithGeneratedMessage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("locks, generates, commits with bypass + verbatim message, then backups after release", async () => {
		const { deps, order } = makeDeps();
		deps.generateCommitMetadata = vi.fn(async () => {
			order.push("generate");
			return {
				kind: "commit" as const,
				message: "feat: exact message",
				requestId: "r1",
			};
		});
		deps.commitSessionChanges = vi.fn(async (args) => {
			order.push("commit");
			expect(args.message).toBe("feat: exact message");
			expect(args.bypassWorkspaceLock).toBe(true);
			expect(args.authorName).toBe("Ditto");
			return { commitSha: "abc", committed: true };
		});

		const result = await commitSessionChangesWithGeneratedMessage(
			makeCtx(),
			deps,
		);

		expect(result).toEqual({
			commitSha: "abc",
			committed: true,
			message: "feat: exact message",
		});
		expect(order).toEqual([
			"lock:enter",
			"generate",
			"commit",
			"lock:exit",
			"backup",
		]);
	});

	it("skips model/commit/backup on no-op snapshot", async () => {
		const { deps, order } = makeDeps();
		deps.generateCommitMetadata = vi.fn(async () => {
			order.push("generate");
			return { kind: "no_changes" as const };
		});

		const result = await commitSessionChangesWithGeneratedMessage(
			makeCtx(),
			deps,
		);
		expect(result).toEqual({ commitSha: null, committed: false });
		expect(deps.commitSessionChanges).not.toHaveBeenCalled();
		expect(order).toEqual(["lock:enter", "generate", "lock:exit"]);
	});

	it("does not backup when generation fails before mutation", async () => {
		const { deps, order } = makeDeps();
		deps.generateCommitMetadata = vi.fn(async () => {
			order.push("generate");
			throw new Error("model down");
		});

		await expect(
			commitSessionChangesWithGeneratedMessage(makeCtx(), deps),
		).rejects.toThrow("model down");
		expect(deps.commitSessionChanges).not.toHaveBeenCalled();
		expect(order).toEqual(["lock:enter", "generate", "lock:exit"]);
	});

	it("surfaces workspace busy errors from the outer lock", async () => {
		const { deps } = makeDeps({
			withSessionWorkspaceLock: vi.fn(async () => {
				throw new SessionWorkspaceBusyError();
			}),
		});
		await expect(
			commitSessionChangesWithGeneratedMessage(makeCtx(), deps),
		).rejects.toBeInstanceOf(SessionWorkspaceBusyError);
	});
});

describe("openSessionPullRequestWithGeneratedMetadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns existing PR without model or backup", async () => {
		const { deps, order } = makeDeps();
		deps.getSessionGitStatus = vi.fn(async () => {
			order.push("status");
			return {
				dirty: false,
				workflow: {
					kind: "open-pr-existing" as const,
					pullRequest: {
						url: "https://example.com/pr/1",
						number: 1,
						state: "open" as const,
					},
				},
			} as Awaited<ReturnType<SessionGitUiActionDeps["getSessionGitStatus"]>>;
		});

		const result = await openSessionPullRequestWithGeneratedMetadata(
			makeCtx(),
			deps,
		);
		expect(result).toEqual({
			url: "https://example.com/pr/1",
			number: 1,
		});
		expect(deps.generatePullRequestMetadata).not.toHaveBeenCalled();
		expect(deps.pushSessionBranch).not.toHaveBeenCalled();
		expect(order).toEqual(["lock:enter", "status", "lock:exit"]);
	});

	it("generates, opens with verbatim metadata, no backup when push not needed", async () => {
		const { deps, order } = makeDeps();
		deps.getSessionGitStatus = vi.fn(async () => {
			order.push("status");
			return {
				dirty: false,
				workflow: { kind: "open-pr" as const },
			} as Awaited<ReturnType<SessionGitUiActionDeps["getSessionGitStatus"]>>;
		});
		deps.generatePullRequestMetadata = vi.fn(async () => {
			order.push("generate");
			return {
				title: "Exact title",
				body: "Exact body",
				requestId: "r1",
			};
		});
		deps.openSessionPullRequest = vi.fn(async (args) => {
			order.push("open");
			expect(args.title).toBe("Exact title");
			expect(args.body).toBe("Exact body");
			return { url: "https://example.com/pr/2", number: 2 };
		});

		const result = await openSessionPullRequestWithGeneratedMetadata(
			makeCtx(),
			deps,
		);
		expect(result).toEqual({
			url: "https://example.com/pr/2",
			number: 2,
			title: "Exact title",
		});
		expect(order).toEqual([
			"lock:enter",
			"status",
			"generate",
			"open",
			"lock:exit",
		]);
	});

	it("pushes with bypass, backups after lock even when open fails", async () => {
		const { deps, order } = makeDeps();
		let statusCalls = 0;
		deps.getSessionGitStatus = vi.fn(async () => {
			statusCalls += 1;
			order.push(`status:${statusCalls}`);
			if (statusCalls === 1) {
				return {
					dirty: false,
					workflow: {
						kind: "push" as const,
						reason: "unpushed-commits" as const,
					},
				} as Awaited<ReturnType<SessionGitUiActionDeps["getSessionGitStatus"]>>;
			}
			return {
				dirty: false,
				workflow: { kind: "open-pr" as const },
			} as Awaited<ReturnType<SessionGitUiActionDeps["getSessionGitStatus"]>>;
		});
		deps.generatePullRequestMetadata = vi.fn(async () => {
			order.push("generate");
			return { title: "T", body: "B", requestId: "r1" };
		});
		deps.pushSessionBranch = vi.fn(async (args) => {
			order.push("push");
			expect(args.bypassWorkspaceLock).toBe(true);
			return { remoteBranch: "ditto/sess-1", pushed: true };
		});
		deps.openSessionPullRequest = vi.fn(async () => {
			order.push("open");
			throw new Error("pr failed");
		});

		await expect(
			openSessionPullRequestWithGeneratedMetadata(makeCtx(), deps),
		).rejects.toThrow("pr failed");

		expect(order).toEqual([
			"lock:enter",
			"status:1",
			"generate",
			"push",
			"status:2",
			"open",
			"lock:exit",
			"backup",
		]);
	});

	it("does not generate when dirty", async () => {
		const { deps } = makeDeps();
		deps.getSessionGitStatus = vi.fn(async () => ({
			dirty: true,
			workflow: { kind: "commit" as const },
		})) as unknown as SessionGitUiActionDeps["getSessionGitStatus"];

		await expect(
			openSessionPullRequestWithGeneratedMetadata(makeCtx(), deps),
		).rejects.toThrow(/Commit local changes/);
		expect(deps.generatePullRequestMetadata).not.toHaveBeenCalled();
	});
});
