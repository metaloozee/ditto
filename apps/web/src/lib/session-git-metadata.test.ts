import { beforeEach, describe, expect, it, vi } from "vitest";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const operatorFallbackCredentialMock = vi.hoisted(() =>
	vi.fn((key: string) => ({ type: "api_key", key })),
);

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
}));

vi.mock("#/lib/account-provider-credentials", () => ({
	operatorFallbackCredential: operatorFallbackCredentialMock,
}));

const {
	collectCommitMetadataSnapshot,
	collectPullRequestMetadataSnapshot,
	generateGitMetadata,
	SessionGitMetadataError,
} = await import("./session-git-metadata");

const WORKTREE = "/workspace/.ditto/worktrees/sess-1";

function makeSandbox() {
	const exec = vi.fn();
	const writeFile = vi.fn().mockResolvedValue(undefined);
	const deleteFile = vi.fn().mockResolvedValue(undefined);
	const mkdir = vi.fn().mockResolvedValue(undefined);
	const shell = {
		id: "shell-1",
		writeFile,
		deleteFile,
		mkdir,
		exec: vi.fn(),
	};
	const sandbox = {
		exec,
		createSession: vi.fn().mockResolvedValue(shell),
		deleteSession: vi.fn().mockResolvedValue(undefined),
	};
	getProjectSandboxMock.mockReturnValue(sandbox);
	return { sandbox, shell, exec, writeFile, deleteFile, mkdir };
}

function ok(stdout = "", stderr = "") {
	return { success: true, exitCode: 0, stdout, stderr };
}

function fail(stderr = "raw git boom SECRET_SENTINEL_XYZ") {
	return { success: false, exitCode: 1, stdout: "", stderr };
}

const env = {
	OPENCODE_API_KEY: "sk-test-key-12345678901234567890",
} as Env;

const session = {
	id: "sess-1",
	branchName: "ditto/sess-1",
	baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	workspacePath: WORKTREE,
};

const baseCommitJob = {
	v: 1 as const,
	requestId: "req-1",
	kind: "commit" as const,
	model: "opencode/deepseek-v4-flash-free" as const,
	snapshot: {
		kind: "commit_snapshot" as const,
		branch: "ditto/s",
		headSha: "abc1234",
		changedPaths: [{ status: "M", path: "a.ts" }],
		diffStat: "stat",
		patch: "patch",
		patchTruncated: false,
		patchOriginalBytes: 5,
	},
};

describe("collectCommitMetadataSnapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses a temporary index, never real git add, and cleans temp files", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok(" M src/app.ts\0");
			}
			if (command === "git rev-parse HEAD") {
				return ok("abc1234deadbeef\n");
			}
			if (command.includes("read-tree HEAD")) {
				return ok();
			}
			if (command.includes("git add --")) {
				expect(command).toContain("GIT_INDEX_FILE=");
				expect(command).toContain("src/app.ts");
				return ok();
			}
			if (command.includes("diff --cached --name-status")) {
				return ok("M\0src/app.ts\0");
			}
			if (command.includes("diff --cached --stat")) {
				return ok(" 1 file changed, 1 insertion(+)\n");
			}
			if (command.includes("diff --cached") && command.includes(">")) {
				return ok();
			}
			if (command.startsWith("wc -c")) {
				return ok("42\n");
			}
			if (command.startsWith("head -c")) {
				return ok("diff --git a/src/app.ts b/src/app.ts\n");
			}
			if (command.startsWith("rm -f")) {
				return ok();
			}
			throw new Error(`unexpected command: ${command}`);
		});

		const result = await collectCommitMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
			knownSecrets: ["supersecretvalue"],
		});
		expect(result.kind).toBe("commit");
		if (result.kind !== "commit") return;
		expect(result.job.kind).toBe("commit");
		expect(result.job.snapshot.changedPaths).toEqual([
			{ status: "M", path: "src/app.ts" },
		]);
		expect(result.job.snapshot.patchOriginalBytes).toBe(42);
		expect(
			exec.mock.calls.some(
				([command]) =>
					typeof command === "string" &&
					command.includes("git add --") &&
					!command.includes("GIT_INDEX_FILE="),
			),
		).toBe(false);
		expect(
			exec.mock.calls.some(
				([command]) =>
					typeof command === "string" && command.startsWith("rm -f"),
			),
		).toBe(true);
		expect(JSON.stringify(result.job)).not.toContain("OPENCODE");
		expect(JSON.stringify(result.job)).not.toContain("DITTO_GIT");
		expect(JSON.stringify(result.job)).not.toContain("sessionTitle");
	});

	it("returns no_changes without model when only secret paths remain", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok("?? .env\0");
			}
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectCommitMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		expect(result).toEqual({ kind: "no_changes" });
	});

	it("fails closed when a secret-like path is already staged", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok("A  .env\0");
			}
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		await expect(
			collectCommitMetadataSnapshot({ env, sandboxId: "sbx", session }),
		).rejects.toThrow(/secret-like path is already staged/);
	});

	it("includes renames, spaces, and binary markers; omits secret paths", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok(" M my file.ts\0 D gone.ts\0?? .env.local\0");
			}
			if (command === "git rev-parse HEAD") return ok("abc1234\n");
			if (command.includes("read-tree") || command.includes("git add --")) {
				return ok();
			}
			if (command.includes("name-status")) {
				return ok("M\0my file.ts\0D\0gone.ts\0R100\0old.ts\0new.ts\0A\0.env\0");
			}
			if (command.includes("--stat")) return ok("stat\n");
			if (command.includes(">") || command.startsWith("wc -c")) {
				return command.startsWith("wc -c") ? ok("10\n") : ok();
			}
			if (command.startsWith("head -c")) {
				return ok("Binary files a/x and b/x differ\n");
			}
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectCommitMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		expect(result.kind).toBe("commit");
		if (result.kind !== "commit") return;
		expect(result.job.snapshot.changedPaths).toEqual([
			{ status: "M", path: "my file.ts" },
			{ status: "D", path: "gone.ts" },
			{ status: "R100", path: "new.ts", previousPath: "old.ts" },
		]);
		expect(result.job.snapshot.patch).toContain("Binary files");
	});

	it("marks truncation when the raw patch exceeds the bounded read", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok(" M a.ts\0");
			}
			if (command === "git rev-parse HEAD") return ok("abc1234\n");
			if (
				command.includes("read-tree") ||
				command.includes("git add --") ||
				command.includes("name-status") ||
				command.includes("--stat") ||
				command.includes(">")
			) {
				return command.includes("name-status") ? ok("M\0a.ts\0") : ok("stat");
			}
			if (command.startsWith("wc -c")) return ok(String(200_000));
			if (command.startsWith("head -c")) return ok("partial-patch");
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectCommitMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		expect(result.kind).toBe("commit");
		if (result.kind !== "commit") return;
		expect(result.job.snapshot.patchTruncated).toBe(true);
		expect(result.job.snapshot.patchOriginalBytes).toBe(200_000);
	});

	it("does not set patchTruncated when only diffStat is capped", async () => {
		const { exec } = makeSandbox();
		const hugeStat = `${"x".repeat(9 * 1024)}\n`;
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok(" M a.ts\0");
			}
			if (command === "git rev-parse HEAD") return ok("abc1234\n");
			if (
				command.includes("read-tree") ||
				command.includes("git add --") ||
				command.includes(">")
			) {
				return ok();
			}
			if (command.includes("name-status")) return ok("M\0a.ts\0");
			if (command.includes("--stat")) return ok(hugeStat);
			if (command.startsWith("wc -c")) return ok("20");
			if (command.startsWith("head -c")) return ok("small-patch");
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectCommitMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		expect(result.kind).toBe("commit");
		if (result.kind !== "commit") return;
		expect(result.job.snapshot.diffStat.length).toBeLessThan(hugeStat.length);
		expect(result.job.snapshot.patchTruncated).toBe(false);
	});

	it("sets patchTruncated when post-redaction patch requires a second cap", async () => {
		const { exec } = makeSandbox();
		// Raw read is 100 KiB; fill under that but with a known secret that expands
		// via redaction markers? Actually redaction shortens or keeps length with
		// [REDACTED]. To force post-redaction truncation, feed a patch slightly
		// under the raw read but over 96 KiB after the read returns it fully.
		const overFinal = "p".repeat(97 * 1024);
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok(" M a.ts\0");
			}
			if (command === "git rev-parse HEAD") return ok("abc1234\n");
			if (
				command.includes("read-tree") ||
				command.includes("git add --") ||
				command.includes(">") ||
				command.includes("--stat")
			) {
				return command.includes("name-status")
					? ok("M\0a.ts\0")
					: ok(command.includes("--stat") ? "stat" : "");
			}
			if (command.includes("name-status")) return ok("M\0a.ts\0");
			// Original size under raw-read ceiling so patchTruncated starts false.
			if (command.startsWith("wc -c")) return ok(String(overFinal.length));
			if (command.startsWith("head -c")) return ok(overFinal);
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectCommitMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		expect(result.kind).toBe("commit");
		if (result.kind !== "commit") return;
		expect(result.job.snapshot.patchTruncated).toBe(true);
		expect(
			Buffer.byteLength(result.job.snapshot.patch, "utf8"),
		).toBeLessThanOrEqual(96 * 1024);
	});

	it("maps command failures to static safe text without git stderr", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return fail("fatal: not a git repository SECRET_SENTINEL_XYZ");
			}
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		await expect(
			collectCommitMetadataSnapshot({ env, sandboxId: "sbx", session }),
		).rejects.toSatisfy((error: unknown) => {
			expect(error).toBeInstanceOf(SessionGitMetadataError);
			const message = (error as Error).message;
			expect(message).not.toContain("SECRET_SENTINEL_XYZ");
			expect(message).not.toContain("fatal:");
			expect(message).toBe("Failed to read git status.");
			return true;
		});
	});
});

describe("collectPullRequestMetadataSnapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses exact stored base ranges and oldest-first subjects", async () => {
		const { exec } = makeSandbox();
		const base = session.baseCommitSha as string;
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") return ok("");
			if (command.includes("rev-parse --verify")) return ok(`${base}\n`);
			if (command === "git rev-parse HEAD") return ok("abcdef0123456789\n");
			if (command.includes("git log --format=%s")) {
				expect(command).toContain("..HEAD");
				expect(command).toContain(base);
				return ok("feat: newest\nfix: oldest\n");
			}
			if (command.includes("name-status")) {
				expect(command).toContain("...HEAD");
				expect(command).toContain(base);
				return ok("M\0a.ts\0");
			}
			if (command.includes("--stat")) {
				expect(command).toContain("...HEAD");
				expect(command).toContain(base);
				expect(command).toContain(" -- ");
				expect(command).toContain("a.ts");
				return ok("stat");
			}
			if (command.includes("git diff") && command.includes(">")) {
				expect(command).toContain("...HEAD");
				expect(command).toContain(base);
				expect(command).toContain(" -- ");
				expect(command).toContain("a.ts");
				return ok();
			}
			if (command.startsWith("wc -c")) return ok("5\n");
			if (command.startsWith("head -c")) return ok("patch");
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectPullRequestMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		expect(result.job.snapshot.baseSha).toBe(base);
		expect(result.job.snapshot.commitSubjects).toEqual([
			"fix: oldest",
			"feat: newest",
		]);
		expect(
			exec.mock.calls.some(
				([command]) =>
					typeof command === "string" && command.includes("origin/"),
			),
		).toBe(false);
	});

	it("excludes secret-like paths from pathspecs and never leaks their patch content", async () => {
		const { exec } = makeSandbox();
		const base = session.baseCommitSha as string;
		const SENTINEL = "PATCH_SECRET_SENTINEL_VALUE_999";
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") return ok("");
			if (command.includes("rev-parse --verify")) return ok(`${base}\n`);
			if (command === "git rev-parse HEAD") return ok("abcdef0123456789\n");
			if (command.includes("git log --format=%s")) return ok("feat: safe\n");
			if (command.includes("name-status")) {
				return ok("M\0src/app.ts\0A\0.env.local\0");
			}
			if (
				command.includes("--stat") ||
				(command.includes("git diff") && command.includes(">"))
			) {
				// Must never request the secret path.
				expect(command).not.toContain(".env");
				expect(command).toContain("src/app.ts");
				return command.includes("--stat") ? ok(" 1 file changed\n") : ok();
			}
			if (command.startsWith("wc -c")) return ok("20\n");
			if (command.startsWith("head -c")) {
				// Safe-path-only read; secret content would only appear if pathspecs leaked.
				return ok("diff --git a/src/app.ts\n+safe\n");
			}
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectPullRequestMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
		});
		const serialized = JSON.stringify(result.job);
		expect(serialized).not.toContain(".env");
		expect(serialized).not.toContain(SENTINEL);
		expect(result.job.snapshot.changedPaths).toEqual([
			{ status: "M", path: "src/app.ts" },
		]);

		// If only secret paths remain, fail without model.
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") return ok("");
			if (command.includes("rev-parse --verify")) return ok(`${base}\n`);
			if (command === "git rev-parse HEAD") return ok("abcdef0123456789\n");
			if (command.includes("git log --format=%s")) return ok("feat: x\n");
			if (command.includes("name-status")) return ok("A\0.env\0");
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		await expect(
			collectPullRequestMetadataSnapshot({ env, sandboxId: "sbx", session }),
		).rejects.toMatchObject({
			code: "snapshot_failed",
			message: expect.stringContaining("No safe changes"),
		});
	});

	it("redacts known and shaped secrets in commit subjects before job write", async () => {
		const { exec } = makeSandbox();
		const base = session.baseCommitSha as string;
		const known = "knownsecretvalue99";
		const shaped = "sk-ant-abcdefghijklmnopqrstuvwxyz012345";
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") return ok("");
			if (command.includes("rev-parse --verify")) return ok(`${base}\n`);
			if (command === "git rev-parse HEAD") return ok("abcdef0123456789\n");
			if (command.includes("git log --format=%s")) {
				return ok(`feat: inject ${known}\nfix: token ${shaped}\n`);
			}
			if (command.includes("name-status")) return ok("M\0a.ts\0");
			if (command.includes("--stat")) return ok("stat");
			if (command.includes(">") || command.startsWith("wc -c")) {
				return command.startsWith("wc -c") ? ok("5") : ok();
			}
			if (command.startsWith("head -c")) return ok("patch");
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		const result = await collectPullRequestMetadataSnapshot({
			env,
			sandboxId: "sbx",
			session,
			knownSecrets: [known],
		});
		const serialized = JSON.stringify(result.job);
		expect(serialized).not.toContain(known);
		expect(serialized).not.toContain(shaped);
		expect(result.job.snapshot.commitSubjects.join(" ")).toContain("[REDACTED]");
	});

	it("fails closed when dirty or base missing", async () => {
		const { exec } = makeSandbox();
		exec.mockImplementation(async (command: string) => {
			if (command === "git status --porcelain=v1 -z -uall") {
				return ok(" M a.ts\0");
			}
			if (command.startsWith("rm -f")) return ok();
			throw new Error(command);
		});
		await expect(
			collectPullRequestMetadataSnapshot({ env, sandboxId: "sbx", session }),
		).rejects.toBeInstanceOf(SessionGitMetadataError);

		await expect(
			collectPullRequestMetadataSnapshot({
				env,
				sandboxId: "sbx",
				session: { ...session, baseCommitSha: null },
			}),
		).rejects.toThrow(/base commit is missing/);
	});
});

describe("generateGitMetadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs the static CLI with only operator credential env and cleans up", async () => {
		const { sandbox, shell } = makeSandbox();
		shell.exec.mockResolvedValue({
			success: true,
			exitCode: 0,
			stdout:
				'{"v":1,"kind":"result","requestId":"req-1","result":{"kind":"commit","message":"feat: add app"}}\n',
			stderr: "",
		});

		const result = await generateGitMetadata({
			env,
			sandboxId: "sbx",
			cwd: WORKTREE,
			job: baseCommitJob,
		});

		expect(result.result).toEqual({ kind: "commit", message: "feat: add app" });
		expect(sandbox.createSession).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: WORKTREE,
				env: {
					DITTO_PI_CREDENTIAL: JSON.stringify({
						type: "api_key",
						key: env.OPENCODE_API_KEY,
					}),
				},
			}),
		);
		const sessionEnv = sandbox.createSession.mock.calls[0][0].env;
		expect(sessionEnv).not.toHaveProperty("DITTO_GIT_CALLBACK_URL");
		expect(sessionEnv).not.toHaveProperty("DITTO_GIT_CALLBACK_TOKEN");
		expect(sessionEnv).not.toHaveProperty("GITHUB_TOKEN");
		expect(shell.exec.mock.calls[0][0]).toContain(
			"/opt/ditto-runner/dist/git-metadata-cli.js",
		);
		expect(shell.deleteFile).toHaveBeenCalled();
		expect(sandbox.deleteSession).toHaveBeenCalledWith("shell-1");
	});

	it("rejects jobs over the 128 KiB raw ceiling before writeFile", async () => {
		const { shell, writeFile } = makeSandbox();
		const paths = Array.from({ length: 200 }, (_, i) => ({
			status: "M",
			path: `src/${"p".repeat(900)}_${i}.ts`,
		}));
		const hugeJob = {
			...baseCommitJob,
			snapshot: {
				...baseCommitJob.snapshot,
				changedPaths: paths,
				diffStat: "s".repeat(8 * 1024),
				patch: "x".repeat(96 * 1024),
			},
		};
		expect(Buffer.byteLength(JSON.stringify(hugeJob), "utf8")).toBeGreaterThan(
			128 * 1024,
		);
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: hugeJob as typeof baseCommitJob,
			}),
		).rejects.toMatchObject({
			code: "snapshot_failed",
			message: expect.stringContaining("size limit"),
		});
		expect(writeFile).not.toHaveBeenCalled();
		expect(shell.exec).not.toHaveBeenCalled();
	});

	it("rejects secret-bearing output and invalid multi-line stdout", async () => {
		const { shell } = makeSandbox();
		shell.exec.mockResolvedValueOnce({
			success: true,
			exitCode: 0,
			stdout: `{"v":1,"kind":"result","requestId":"req-1","result":{"kind":"commit","message":"feat: ${env.OPENCODE_API_KEY}"}}\n`,
			stderr: "",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toMatchObject({ code: "output_rejected" });

		shell.exec.mockResolvedValueOnce({
			success: true,
			exitCode: 1,
			stdout: "one\ntwo\n",
			stderr: "raw secret boom",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toSatisfy((error: unknown) => {
			expect(error).toBeInstanceOf(SessionGitMetadataError);
			expect((error as Error).message).not.toContain("raw secret boom");
			return true;
		});
	});

	it("rejects malformed JSON, request mismatch, process failure; cleans up", async () => {
		const { sandbox, shell } = makeSandbox();

		shell.exec.mockResolvedValueOnce({
			success: true,
			exitCode: 0,
			stdout: "not-json\n",
			stderr: "",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toMatchObject({ code: "agent_failed" });
		expect(shell.deleteFile).toHaveBeenCalled();
		expect(sandbox.deleteSession).toHaveBeenCalled();

		shell.exec.mockResolvedValueOnce({
			success: true,
			exitCode: 0,
			stdout:
				'{"v":1,"kind":"result","requestId":"other","result":{"kind":"commit","message":"feat: x"}}\n',
			stderr: "",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toMatchObject({ code: "output_rejected" });

		shell.exec.mockRejectedValueOnce(new Error("process died SENTINEL_PROC"));
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toSatisfy((error: unknown) => {
			expect((error as Error).message).not.toContain("SENTINEL_PROC");
			expect((error as Error).message).toBe("Metadata agent failed.");
			return true;
		});
		expect(sandbox.deleteSession).toHaveBeenCalled();
	});

	it("maps protocol errors to SessionGitMetadataError codes with static text", async () => {
		const { shell } = makeSandbox();
		shell.exec.mockResolvedValue({
			success: true,
			exitCode: 1,
			stdout:
				'{"v":1,"kind":"error","requestId":"req-1","code":"missing_result"}\n',
			stderr: "",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toMatchObject({
			code: "missing_result",
			message: "Metadata agent did not return typed output.",
		});
	});

	it("rejects legacy protocol output key and error message field", async () => {
		const { shell } = makeSandbox();
		shell.exec.mockResolvedValueOnce({
			success: true,
			exitCode: 0,
			stdout:
				'{"v":1,"kind":"result","requestId":"req-1","output":{"kind":"commit","message":"feat: x"}}\n',
			stderr: "",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toMatchObject({ code: "output_rejected" });

		shell.exec.mockResolvedValueOnce({
			success: true,
			exitCode: 1,
			stdout:
				'{"v":1,"kind":"error","requestId":"req-1","code":"agent_failed","message":"provider secrets"}\n',
			stderr: "",
		});
		await expect(
			generateGitMetadata({
				env,
				sandboxId: "sbx",
				cwd: WORKTREE,
				job: baseCommitJob,
			}),
		).rejects.toMatchObject({ code: "output_rejected" });
	});
});
