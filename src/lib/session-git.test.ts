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
	repositoryNameFromSlug: (githubRepo: string) => {
		const parts = githubRepo.split("/").filter(Boolean);
		if (parts.length < 2) {
			return undefined;
		}
		return parts[parts.length - 1];
	},
}));

const {
	GITHUB_APP_PUSH_PERMISSION_MESSAGE,
	commitSessionChanges,
	findOpenSessionPullRequest,
	getSessionGitStatus,
	openSessionPullRequest,
	parsePorcelainZ,
	pushSessionBranch,
} = await import("./session-git");

function mockNoOpenPullRequest() {
	getGitHubAppMock.mockReturnValue({
		getInstallationOctokit: vi.fn().mockResolvedValue({
			rest: {
				pulls: { list: vi.fn().mockResolvedValue({ data: [] }) },
				repos: {
					get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
				},
			},
		}),
	});
}

const WORKTREE = "/workspace/.ditto/worktrees/sess-1";
const TOKEN = `ghs_${"t".repeat(40)}`;
const STATUS_CMD = "git status --porcelain=v1 -z -uall";
const PREFLIGHT_BASE = "basebasebasebasebasebasebasebasebasebase";
const PREFLIGHT_HEAD = "headheadheadheadheadheadheadheadheadhead";
/** Synthetic only. */
const FIXTURE_SECRET = `ghp_${"b".repeat(36)}`;

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

/** NUL-join porcelain records (each record already includes XY + path). */
function porcelainZ(records: string[]): string {
	return `${records.join("\0")}\0`;
}

/**
 * Answer preflight git commands for a safe outgoing range.
 * Returns null when the command is not a preflight command.
 */
function answerSafePreflight(command: string): {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
} | null {
	if (command === "git rev-parse --verify HEAD") {
		return {
			success: true,
			stdout: `${PREFLIGHT_HEAD}\n`,
			stderr: "",
			exitCode: 0,
		};
	}
	if (command === "git rev-parse --verify @{upstream}") {
		return {
			success: true,
			stdout: `${PREFLIGHT_BASE}\n`,
			stderr: "",
			exitCode: 0,
		};
	}
	if (command.includes("git diff --name-status -z")) {
		return {
			success: true,
			stdout: "M\0src/a.ts\0",
			stderr: "",
			exitCode: 0,
		};
	}
	if (command.includes("git diff -U0")) {
		return {
			success: true,
			stdout: [
				"diff --git a/src/a.ts b/src/a.ts",
				"--- a/src/a.ts",
				"+++ b/src/a.ts",
				"@@ -0,0 +1 @@",
				"+export const ok = true;",
			].join("\n"),
			stderr: "",
			exitCode: 0,
		};
	}
	return null;
}

function answerBlockedPathPreflight(command: string): {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
} | null {
	if (command === "git rev-parse --verify HEAD") {
		return {
			success: true,
			stdout: `${PREFLIGHT_HEAD}\n`,
			stderr: "",
			exitCode: 0,
		};
	}
	if (command === "git rev-parse --verify @{upstream}") {
		return {
			success: true,
			stdout: `${PREFLIGHT_BASE}\n`,
			stderr: "",
			exitCode: 0,
		};
	}
	if (command.includes("git diff --name-status -z")) {
		return {
			success: true,
			stdout: "A\0nested/.env.local\0",
			stderr: "",
			exitCode: 0,
		};
	}
	return null;
}

describe("parsePorcelainZ", () => {
	it("parses ordinary paths including spaces", () => {
		const raw = porcelainZ([" M file with spaces.ts", "?? nested/deep/ok.ts"]);
		expect(parsePorcelainZ(raw)).toEqual([
			{
				indexStatus: " ",
				workTreeStatus: "M",
				paths: ["file with spaces.ts"],
			},
			{
				indexStatus: "?",
				workTreeStatus: "?",
				paths: ["nested/deep/ok.ts"],
			},
		]);
	});

	it("parses rename with destination and source as real paths", () => {
		// Empirical -z order: destination, source
		const raw = "R  nested/.env\0src/a.ts\0";
		const entries = parsePorcelainZ(raw);
		expect(entries).toEqual([
			{
				indexStatus: "R",
				workTreeStatus: " ",
				paths: ["nested/.env", "src/a.ts"],
			},
		]);
	});

	it("parses copy records", () => {
		const raw = "C  dest/copy.ts\0src/orig.ts\0";
		expect(parsePorcelainZ(raw)).toEqual([
			{
				indexStatus: "C",
				workTreeStatus: " ",
				paths: ["dest/copy.ts", "src/orig.ts"],
			},
		]);
	});

	it("fails closed on incomplete rename", () => {
		expect(() => parsePorcelainZ("R  only-dest\0")).toThrow(
			/incomplete rename/,
		);
	});
});

describe("session git", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getInstallationAccessTokenMock.mockResolvedValue(TOKEN);
		scrubGithubRemoteMock.mockResolvedValue(undefined);
		mockNoOpenPullRequest();
	});

	it("returns clean status when porcelain is empty", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
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
			if (
				command.includes("git rev-list --count") &&
				command.includes("origin/")
			) {
				return {
					success: false,
					stdout: "",
					stderr: "bad revision",
					exitCode: 128,
				};
			}
			if (command === "git rev-list --count HEAD --not --remotes=origin") {
				return { success: true, stdout: "3\n", stderr: "", exitCode: 0 };
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
		expect(status.ahead).toBe(3);
		expect(status.changedFiles).toEqual([]);
		expect(status.pullRequest).toBeNull();
	});

	it("reports ahead 0 when origin tracking ref matches HEAD without upstream", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
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
			if (
				command.includes("git rev-list --count") &&
				command.includes("origin/ditto/session-sess-1")
			) {
				return { success: true, stdout: "0\n", stderr: "", exitCode: 0 };
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

		expect(status.ahead).toBe(0);
	});

	it("reports ahead 0 when upstream is configured", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
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
					success: true,
					stdout: "origin/ditto/session-sess-1\n",
					stderr: "",
					exitCode: 0,
				};
			}
			if (command === "git rev-list --count @{upstream}..HEAD") {
				return { success: true, stdout: "0\n", stderr: "", exitCode: 0 };
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

		expect(status.ahead).toBe(0);
	});

	it("includes open pull request metadata in git status", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
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
			if (command.includes("git rev-list --count")) {
				return { success: true, stdout: "0\n", stderr: "", exitCode: 0 };
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		getGitHubAppMock.mockReturnValue({
			getInstallationOctokit: vi.fn().mockResolvedValue({
				rest: {
					pulls: {
						list: vi.fn().mockResolvedValue({
							data: [
								{
									html_url: "https://github.com/acme/repo/pull/12",
									number: 12,
								},
							],
						}),
					},
					repos: {
						get: vi
							.fn()
							.mockResolvedValue({ data: { default_branch: "main" } }),
					},
				},
			}),
		});

		const status = await getSessionGitStatus({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 1,
			githubRepo: "acme/repo",
			session: makeSession(),
		});

		expect(status.pullRequest).toEqual({
			url: "https://github.com/acme/repo/pull/12",
			number: 12,
		});
	});

	it("no-ops commit on a clean tree", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
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
			if (command === STATUS_CMD) {
				return {
					success: true,
					stdout: porcelainZ([" M src/a.ts"]),
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git add -- ")) {
				expect(command).toContain("src/a.ts");
				expect(command).not.toContain("git add -A");
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git diff --cached --name-only -z") {
				return {
					success: true,
					stdout: "src/a.ts\0",
					stderr: "",
					exitCode: 0,
				};
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

	it("commits paths with spaces via explicit git add", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
				return {
					success: true,
					stdout: porcelainZ([" M path with spaces/a.ts"]),
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git add -- ")) {
				expect(command).toContain("'path with spaces/a.ts'");
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git diff --cached --name-only -z") {
				return {
					success: true,
					stdout: "path with spaces/a.ts\0",
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git -c user.name=")) {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git rev-parse HEAD") {
				return { success: true, stdout: "abc123\n", stderr: "", exitCode: 0 };
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
			message: "feat: spaces",
			authorName: "Ada",
			authorEmail: "ada@users.noreply.github.com",
		});

		expect(result.committed).toBe(true);
	});

	it("does not commit when only secret-like paths changed", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
				return {
					success: true,
					stdout: porcelainZ(["?? .env", "?? .env.local"]),
					stderr: "",
					exitCode: 0,
				};
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
			message: "feat: secrets",
			authorName: "Ada",
			authorEmail: "ada@users.noreply.github.com",
		});

		expect(result).toEqual({ commitSha: null, committed: false });
		expect(sandbox.exec).toHaveBeenCalledTimes(1);
	});

	it("does not stage nested .env.* paths", async () => {
		const commands: string[] = [];
		const sandbox = makeSandbox(async (command) => {
			commands.push(command);
			if (command === STATUS_CMD) {
				return {
					success: true,
					stdout: porcelainZ([" M src/a.ts", "?? nested/deep/.env.local"]),
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git add -- ")) {
				expect(command).toContain("src/a.ts");
				expect(command).not.toContain(".env");
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git diff --cached --name-only -z") {
				return {
					success: true,
					stdout: "src/a.ts\0",
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git -c user.name=")) {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git rev-parse HEAD") {
				return { success: true, stdout: "cafebabe\n", stderr: "", exitCode: 0 };
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
			message: "feat: without secrets",
			authorName: "Ada",
			authorEmail: "ada@users.noreply.github.com",
		});

		expect(result).toEqual({ commitSha: "cafebabe", committed: true });
		expect(commands.some((c) => c === "git add -A")).toBe(false);
		expect(commands.some((c) => c.startsWith("git reset"))).toBe(false);
	});

	it("does not stage rename-to-secret paths (unstaged delete + untracked dest)", async () => {
		const commands: string[] = [];
		const sandbox = makeSandbox(async (command) => {
			commands.push(command);
			if (command === STATUS_CMD) {
				// Unstaged rename appearance before `git add` detects rename.
				return {
					success: true,
					stdout: porcelainZ([" D src/a.ts", "?? nested/.env", " M src/b.ts"]),
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git add -- ")) {
				// Must not use display-form rename strings; never stage .env dest.
				expect(command).not.toContain(" -> ");
				expect(command).not.toContain(".env");
				expect(command).toContain("src/b.ts");
				// Source delete alone is still a non-secret path; may be staged.
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git diff --cached --name-only -z") {
				return {
					success: true,
					stdout: "src/b.ts\0",
					stderr: "",
					exitCode: 0,
				};
			}
			if (command.startsWith("git -c user.name=")) {
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command === "git rev-parse HEAD") {
				return { success: true, stdout: "bead\n", stderr: "", exitCode: 0 };
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
			message: "feat: no rename secret",
			authorName: "Ada",
			authorEmail: "ada@users.noreply.github.com",
		});

		expect(result.committed).toBe(true);
		const addCmd = commands.find((c) => c.startsWith("git add -- "));
		expect(addCmd).toBeDefined();
		expect(addCmd).not.toContain("nested/.env");
		expect(addCmd).not.toContain(" -> ");
	});

	it("rejects already-staged rename destination matching .env policy", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
				// -z order: destination, source; index status R = staged rename
				return {
					success: true,
					stdout: "R  nested/.env\0src/a.ts\0",
					stderr: "",
					exitCode: 0,
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		await expect(
			commitSessionChanges({
				env: makeEnv(),
				sandboxId: "sandbox-1",
				installationId: 1,
				githubRepo: "acme/repo",
				session: makeSession(),
				message: "feat: staged rename secret",
				authorName: "Ada",
				authorEmail: "ada@users.noreply.github.com",
			}),
		).rejects.toThrow(/already staged \(nested\/\.env\)/);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git add"),
			),
		).toBe(false);
	});

	it("rejects already-staged copy destination matching .env policy", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
				return {
					success: true,
					stdout: "C  .env.local\0src/template\0",
					stderr: "",
					exitCode: 0,
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		await expect(
			commitSessionChanges({
				env: makeEnv(),
				sandboxId: "sandbox-1",
				installationId: 1,
				githubRepo: "acme/repo",
				session: makeSession(),
				message: "feat: staged copy secret",
				authorName: "Ada",
				authorEmail: "ada@users.noreply.github.com",
			}),
		).rejects.toThrow(/already staged \(\.env\.local\)/);
	});

	it("rejects when a secret-like path is already staged", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (command === STATUS_CMD) {
				return {
					success: true,
					stdout: porcelainZ(["A  .env", " M src/a.ts"]),
					stderr: "",
					exitCode: 0,
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		await expect(
			commitSessionChanges({
				env: makeEnv(),
				sandboxId: "sandbox-1",
				installationId: 1,
				githubRepo: "acme/repo",
				session: makeSession(),
				message: "feat: bad stage",
				authorName: "Ada",
				authorEmail: "ada@users.noreply.github.com",
			}),
		).rejects.toThrow(/already staged/);
		expect(sandbox.exec).toHaveBeenCalledTimes(1);
	});

	it("pushes with installation token and scrubs remotes", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerSafePreflight(command);
			if (preflight) {
				return preflight;
			}
			if (command.startsWith("git push ")) {
				expect(command).toContain(TOKEN);
				expect(command).not.toContain("--set-upstream");
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command.startsWith("git update-ref ")) {
				expect(command).toContain("refs/remotes/origin/ditto/session-sess-1");
				expect(command).not.toContain(TOKEN);
				expect(command).not.toContain("x-access-token");
				return { success: true, stdout: "", stderr: "", exitCode: 0 };
			}
			if (command.startsWith("git branch --set-upstream-to=")) {
				expect(command).toContain("origin/ditto/session-sess-1");
				expect(command).not.toContain(TOKEN);
				expect(command).not.toContain("x-access-token");
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
		expect(getInstallationAccessTokenMock).toHaveBeenCalledWith(
			expect.anything(),
			42,
			{ repositories: ["repo"] },
		);
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("blocks push preflight before minting a token when secret path is present", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerBlockedPathPreflight(command);
			if (preflight) {
				return preflight;
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
				knownSecrets: [FIXTURE_SECRET],
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("nested/.env.local");
		expect(message).not.toContain(FIXTURE_SECRET);
		expect(getInstallationAccessTokenMock).not.toHaveBeenCalled();
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git push "),
			),
		).toBe(false);
	});

	it("redacts installation token from push errors and still scrubs remotes", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerSafePreflight(command);
			if (preflight) {
				return preflight;
			}
			if (command.startsWith("git push ")) {
				expect(command).not.toContain("--set-upstream");
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
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("maps git push 403 permission denied to an actionable app permissions message", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerSafePreflight(command);
			if (preflight) {
				return preflight;
			}
			if (command.startsWith("git push ")) {
				return {
					success: false,
					stdout: "",
					stderr: `remote: Permission to acme/repo.git denied to ditto-web[bot].\nfatal: unable to access 'https://x-access-token:${TOKEN}@github.com/acme/repo.git/': The requested URL returned error: 403`,
					exitCode: 128,
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

		expect(message).toBe(GITHUB_APP_PUSH_PERMISSION_MESSAGE);
		expect(message).not.toContain(TOKEN);
		expect(message).not.toContain("x-access-token");
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("does not map non-permission push failures to the app permissions message", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerSafePreflight(command);
			if (preflight) {
				return preflight;
			}
			if (command.startsWith("git push ")) {
				return {
					success: false,
					stdout: "",
					stderr:
						" ! [rejected] HEAD -> ditto/session-sess-1 (non-fast-forward)",
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

		expect(message).toContain("non-fast-forward");
		expect(message).not.toBe(GITHUB_APP_PUSH_PERMISSION_MESSAGE);
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("maps installation token mint permission failures to the app permissions message", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerSafePreflight(command);
			if (preflight) {
				return preflight;
			}
			throw new Error("unexpected git command during token-mint failure");
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		getInstallationAccessTokenMock.mockRejectedValue(
			new Error(
				"HttpError: Resource not accessible by integration - https://docs.github.com/rest/apps/apps#create-an-installation-access-token-for-an-app",
			),
		);

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

		expect(message).toBe(GITHUB_APP_PUSH_PERMISSION_MESSAGE);
		// Scrub still runs even though push never executed.
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("does not map bare status code 403 to the app permissions message", async () => {
		const sandbox = makeSandbox(async (command) => {
			const preflight = answerSafePreflight(command);
			if (preflight) {
				return preflight;
			}
			throw new Error("unexpected git command during token-mint failure");
		});
		getProjectSandboxMock.mockReturnValue(sandbox);
		getInstallationAccessTokenMock.mockRejectedValue(
			new Error("Request failed with status code 403"),
		);

		await expect(
			pushSessionBranch({
				env: makeEnv(),
				sandboxId: "sandbox-1",
				installationId: 42,
				githubRepo: "acme/repo",
				session: makeSession(),
			}),
		).rejects.toThrow("Request failed with status code 403");
		expect(scrubGithubRemoteMock).toHaveBeenCalledTimes(2);
	});

	it("creates a pull request using commit subjects and changed files from the branch range", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (
				command.includes("git log --format=%s") &&
				command.includes("'main'..HEAD")
			) {
				return {
					success: true,
					stdout: "feat: add skills readme\n",
					stderr: "",
					exitCode: 0,
				};
			}
			if (
				command.includes("git diff --name-only") &&
				command.includes("'main'...HEAD")
			) {
				return {
					success: true,
					stdout: "README.md\nsrc/skills.ts\n",
					stderr: "",
					exitCode: 0,
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const pulls = {
			list: vi.fn().mockResolvedValue({ data: [] }),
			create: vi.fn().mockResolvedValue({
				data: {
					html_url: "https://github.com/acme/repo/pull/2",
					number: 2,
				},
			}),
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
		});

		expect(result).toEqual({
			url: "https://github.com/acme/repo/pull/2",
			number: 2,
		});
		const logCommand = sandbox.exec.mock.calls.find((call) =>
			String(call[0]).includes("git log --format=%s"),
		)?.[0];
		expect(logCommand).toContain("git log --format=%s -n 20");
		expect(logCommand).toContain("'main'..HEAD");
		expect(logCommand).not.toMatch(/git log --format=%s -n 20$/);
		const diffCommand = sandbox.exec.mock.calls.find((call) =>
			String(call[0]).includes("git diff --name-only"),
		)?.[0];
		expect(diffCommand).toContain("git diff --name-only");
		expect(diffCommand).toContain("'main'...HEAD");
		expect(pulls.create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Add skills readme",
				body: expect.stringContaining("Add skills readme."),
			}),
		);
		const body = pulls.create.mock.calls[0]?.[0]?.body as string;
		expect(body).toContain("Session ID: sess-1");
		expect(body).toContain("Files changed:");
		expect(body).toContain("- README.md");
		expect(body).toContain("- src/skills.ts");
		expect(body).not.toMatch(/from the latest status/i);
	});

	it("falls back to origin/base ranges when the local base ref is missing", async () => {
		const sandbox = makeSandbox(async (command) => {
			if (
				command.includes("git log --format=%s") &&
				command.includes("'main'..HEAD")
			) {
				return {
					success: false,
					stdout: "",
					stderr: "bad revision",
					exitCode: 128,
				};
			}
			if (
				command.includes("git log --format=%s") &&
				command.includes("'origin/main'..HEAD")
			) {
				return {
					success: true,
					stdout: "feat: session-only change\n",
					stderr: "",
					exitCode: 0,
				};
			}
			if (
				command.includes("git diff --name-only") &&
				command.includes("'main'...HEAD")
			) {
				return {
					success: false,
					stdout: "",
					stderr: "bad revision",
					exitCode: 128,
				};
			}
			if (
				command.includes("git diff --name-only") &&
				command.includes("'origin/main'...HEAD")
			) {
				return {
					success: true,
					stdout: "src/only.ts\n",
					stderr: "",
					exitCode: 0,
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});
		getProjectSandboxMock.mockReturnValue(sandbox);

		const pulls = {
			list: vi.fn().mockResolvedValue({ data: [] }),
			create: vi.fn().mockResolvedValue({
				data: {
					html_url: "https://github.com/acme/repo/pull/3",
					number: 3,
				},
			}),
		};
		const repos = {
			get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
		};
		getGitHubAppMock.mockReturnValue({
			getInstallationOctokit: vi.fn().mockResolvedValue({
				rest: { pulls, repos },
			}),
		});

		await openSessionPullRequest({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 1,
			githubRepo: "acme/repo",
			session: makeSession(),
		});

		const originRangeCommand = sandbox.exec.mock.calls.find((call) => {
			const command = String(call[0]);
			return (
				command.includes("git log --format=%s") &&
				command.includes("origin/main") &&
				command.includes("..HEAD")
			);
		})?.[0];
		expect(originRangeCommand).toContain("'origin/main'..HEAD");
		const originDiffCommand = sandbox.exec.mock.calls.find((call) => {
			const command = String(call[0]);
			return (
				command.includes("git diff --name-only") &&
				command.includes("origin/main") &&
				command.includes("...HEAD")
			);
		})?.[0];
		expect(originDiffCommand).toContain("'origin/main'...HEAD");
		const body = pulls.create.mock.calls[0]?.[0]?.body as string;
		expect(body).toContain("- src/only.ts");
	});

	it("maps findOpenSessionPullRequest list results", async () => {
		const pulls = {
			list: vi.fn().mockResolvedValue({
				data: [{ html_url: "https://github.com/acme/repo/pull/4", number: 4 }],
			}),
		};
		const repos = {
			get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
		};
		getGitHubAppMock.mockReturnValue({
			getInstallationOctokit: vi.fn().mockResolvedValue({
				rest: { pulls, repos },
			}),
		});

		const result = await findOpenSessionPullRequest({
			env: makeEnv(),
			sandboxId: "sandbox-1",
			installationId: 9,
			githubRepo: "acme/repo",
			session: makeSession(),
		});

		expect(result).toEqual({
			url: "https://github.com/acme/repo/pull/4",
			number: 4,
		});
		expect(repos.get).toHaveBeenCalledTimes(1);
		expect(pulls.list).toHaveBeenCalledWith(
			expect.objectContaining({
				head: "acme:ditto/session-sess-1",
				base: "main",
				state: "open",
			}),
		);
	});

	it("skips repos.get when baseBranch is provided to findOpenSessionPullRequest", async () => {
		const pulls = {
			list: vi.fn().mockResolvedValue({
				data: [{ html_url: "https://github.com/acme/repo/pull/5", number: 5 }],
			}),
		};
		const repos = {
			get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
		};
		getGitHubAppMock.mockReturnValue({
			getInstallationOctokit: vi.fn().mockResolvedValue({
				rest: { pulls, repos },
			}),
		});

		const result = await findOpenSessionPullRequest(
			{
				env: makeEnv(),
				sandboxId: "sandbox-1",
				installationId: 9,
				githubRepo: "acme/repo",
				session: makeSession(),
			},
			"develop",
		);

		expect(result).toEqual({
			url: "https://github.com/acme/repo/pull/5",
			number: 5,
		});
		expect(repos.get).not.toHaveBeenCalled();
		expect(pulls.list).toHaveBeenCalledWith(
			expect.objectContaining({
				head: "acme:ditto/session-sess-1",
				base: "develop",
				state: "open",
			}),
		);
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
		});

		expect(result).toEqual({
			url: "https://github.com/acme/repo/pull/9",
			number: 9,
		});
		expect(pulls.create).not.toHaveBeenCalled();
		// openSessionPullRequest resolves base once; find reuses it (no second get)
		expect(repos.get).toHaveBeenCalledTimes(1);
	});
});
