import { beforeEach, describe, expect, it, vi } from "vitest";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const getInstallationAccessTokenMock = vi.hoisted(() => vi.fn());
const getGitHubAppMock = vi.hoisted(() => vi.fn());
const scrubGithubRemoteMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	scrubGithubRemote: scrubGithubRemoteMock,
}));

vi.mock("#/lib/github-app", () => ({
	getInstallationAccessToken: getInstallationAccessTokenMock,
	getGitHubApp: getGitHubAppMock,
}));

const {
	commitSessionChanges,
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
} = await import("./session-git");

const WORKTREE = "/workspace/.ditto/worktrees/sess-1";
const TOKEN = `ghs_${"t".repeat(40)}`;

function makeEnv(): Env {
	return {} as Env;
}

function makeSession() {
	return {
		id: "sess-1",
		branchName: "ditto/session-sess-1",
		workspacePath: WORKTREE,
		title: "Fix billing",
	};
}

function makeSandbox(
	execImpl: (
		command: string,
		options?: { cwd?: string },
	) => Promise<{
		success: boolean;
		stdout: string;
		stderr: string;
		exitCode: number;
	}>,
) {
	return { exec: vi.fn(execImpl) };
}

describe("session git", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getInstallationAccessTokenMock.mockResolvedValue(TOKEN);
		scrubGithubRemoteMock.mockResolvedValue(undefined);
	});

	it("returns clean status when porcelain is empty", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === "git status --porcelain") {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git rev-parse --abbrev-ref HEAD") {
				return {
					success: true,
					stdout: "ditto/session-sess-1\n",
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.includes("@{upstream}")) {
				return {
					success: false,
					stdout: "",
					stderr: "no upstream",
					exitCode: 1,
				};
			}
			if (command === "git rev-parse HEAD") {
				return { success: true, stdout: "abc\n", stderr: "", exitCode: 0 };
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const status = await getSessionGitStatus({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 1,
			githubRepo: "acme/repo",
			session: makeSession(),
		});

		expect(status.dirty).toBe(false);
		expect(status.ahead).toBe(1);
		expect(status.changedFiles).toEqual([]);
	});

	it("no-ops commit on a clean tree", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === "git status --porcelain") {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const result = await commitSessionChanges({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 1,
			githubRepo: "acme/repo",
			session: makeSession(),
			message: "feat: test",
			authorName: "Ada",
			authorEmail: "ada@users.noreply.github.com",
		});

		expect(result).toEqual({ commitSha: null, committed: false });
		expect(sandbox.exec).toHaveBeenCalledTimes(1);
	});

	it("commits when porcelain has changes", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === "git status --porcelain") {
				return {
					success: true,
					stdout: " M src/a.ts\n",
					stderr: "",
					exitCode: 0,
				};
			}
			if (command === "git add -A") {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command.startsWith("git -c user.name=")) {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git rev-parse HEAD") {
				return { success: true, stdout: "deadbeef\n", stderr: "", exitCode: 0 };
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const result = await commitSessionChanges({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 1,
			githubRepo: "acme/repo",
			session: makeSession(),
			message: "feat: apply Fix billing",
			authorName: "Ada",
			authorEmail: "ada@users.noreply.github.com",
		});

		expect(result).toEqual({ commitSha: "deadbeef", committed: true });
	});

	it("pushes with installation token and scrubs remotes", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command.startsWith("git push --set-upstream")) {
				expect(command).toContain(TOKEN);
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const result = await pushSessionBranch({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 42,
			githubRepo: "acme/repo",
			session: makeSession(),
		});

		expect(result).toEqual({
			remoteBranch: "ditto/session-sess-1",
			pushed: true,
		});
		expect(getInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("redacts installation token from push errors", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command.startsWith("git push --set-upstream")) {
				return {
					success: false,
					stdout: "",
					stderr: `remote error with ${TOKEN}`,
					exitCode: 1,
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		let message = "";
		try {
			await pushSessionBranch({
				env: makeEnv(),
				sandboxId: "sandbox-1",
				installationId: 42,
				githubRepo: "acme/repo",
				session: makeSession(),
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("[REDACTED]");
		expect(message).not.toContain(TOKEN);
	});

	it("returns an existing pull request when one is already open", async () => {
		const pulls = {
			list: vi.fn().mockResolvedValue({
				data: [{ html_url: "https://github.com/acme/repo/pull/9", number: 9 }],
			}),
			create: vi.fn(),
		};
		const repos = {
			get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
		};
		getGitHubAppMock.mockReturnValue({
			getInstallationOctokit: vi.fn().mockResolvedValue({
				rest: { pulls, repos },
			}),
		});

		const result = await openSessionPullRequest({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 1,
			githubRepo: "acme/repo",
			session: makeSession(),
			projectId: "project-1",
			changedFileCount: 2,
		});

		expect(result).toEqual({
			url: "https://github.com/acme/repo/pull/9",
			number: 9,
		});
		expect(pulls.create).not.toHaveBeenCalled();
	});
});
