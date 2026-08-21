import { describe, expect, it, vi } from "vitest";
import { quoteGitHubExportShellArg } from "#/lib/github-export";
import {
	buildBrokeredGitChildEnv,
	buildCredentialRedactionSecrets,
	buildPrivilegedGitChildEnv,
	CLOUDFLARE_CONTAINERS_CA_PATH,
	fetchGitHubBranchBrokered,
	fetchGitHubBranchIsolated,
	PRIVILEGED_GIT_LAUNCHER_SOURCE,
	PRIVILEGED_NODE_BIN,
	pushGitHubCommitIsolated,
	validateGitBranchRefs,
} from "./privileged-git";

const TOKEN = `ghs_${"s".repeat(40)}`;
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FETCH_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WORKTREE = "/workspace/.ditto/worktrees/sess-1";
const WORKSPACE = "/workspace";

type ExecCall = {
	command: string;
	options?: {
		cwd?: string;
		timeout?: number;
		env?: Record<string, string | undefined>;
	};
};

function ok(stdout = ""): {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	return { success: true, stdout, stderr: "", exitCode: 0 };
}

function fail(
	stderr: string,
	exitCode = 1,
): {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
} {
	return { success: false, stdout: "", stderr, exitCode };
}

function makeSandbox(
	handler: (
		command: string,
		options?: ExecCall["options"],
	) => ReturnType<typeof ok>,
) {
	const calls: ExecCall[] = [];
	const exec = vi.fn(async (command: string, options?: ExecCall["options"]) => {
		calls.push({ command, options });
		return handler(command, options);
	});
	return { sandbox: { exec }, calls, exec };
}

function isNetworkLauncherCommand(command: string): boolean {
	return (
		command.includes(quoteGitHubExportShellArg(PRIVILEGED_NODE_BIN)) &&
		command.includes("ditto-privileged-git-launcher.cjs")
	);
}

function parseNetworkEnv(options?: ExecCall["options"]): {
	gitArgs: string[];
	childEnv: Record<string, string>;
} {
	const gitArgs = JSON.parse(
		String(options?.env?.DITTO_PRIVILEGED_GIT_ARGS ?? "null"),
	) as string[];
	const childEnv = JSON.parse(
		String(options?.env?.DITTO_PRIVILEGED_GIT_CHILD_ENV ?? "null"),
	) as Record<string, string>;
	return { gitArgs, childEnv };
}

function defaultPushHandler(
	command: string,
	options?: ExecCall["options"],
	state: {
		sourceHead?: string;
		stagedSha?: string;
		networkFail?: string;
		configExtra?: string;
	} = {},
): ReturnType<typeof ok> {
	if (command.startsWith("git check-ref-format ")) {
		return ok("");
	}
	if (command.includes("mkdir -m 0700") || command.includes("base64 -d")) {
		return ok("");
	}
	if (command.includes("git init --bare")) {
		return ok("");
	}
	if (command.includes("config --local --list")) {
		return ok(
			[
				"core.repositoryformatversion=0",
				"core.bare=true",
				"core.hookspath=/tmp/hooks",
				"credential.helper=",
				"core.askpass=",
				state.configExtra ?? "",
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	if (command === "git rev-parse HEAD") {
		expect(options?.cwd).toBe(WORKTREE);
		return ok(`${state.sourceHead ?? HEAD_SHA}\n`);
	}
	if (command === "git rev-parse --path-format=absolute --git-common-dir") {
		expect(options?.cwd).toBe(WORKTREE);
		return ok(`${WORKSPACE}/.git\n`);
	}
	if (command.startsWith("git cat-file -t ") && command.includes(HEAD_SHA)) {
		expect(options?.cwd).toBe(WORKTREE);
		return ok("commit\n");
	}
	// Staging uses alternates + update-ref (not fetch-from-worktree).
	if (
		command.includes("objects/info/alternates") &&
		command.includes("update-ref")
	) {
		expect(command).toContain(
			quoteGitHubExportShellArg(`${WORKSPACE}/.git/objects`),
		);
		expect(command).toContain("refs/ditto-isolated");
		expect(command).toContain(HEAD_SHA);
		expect(command).not.toContain("git fetch");
		expect(options?.env).toBeUndefined();
		return ok("");
	}
	if (
		command.includes("rev-parse") &&
		command.includes("refs/ditto-isolated")
	) {
		return ok(`${state.stagedSha ?? HEAD_SHA}\n`);
	}
	// Old fetch-from-worktree staging must never run.
	if (
		command.startsWith("git fetch --no-tags ") &&
		command.includes(quoteGitHubExportShellArg(WORKTREE))
	) {
		throw new Error(`unexpected fetch-from-worktree staging: ${command}`);
	}
	if (isNetworkLauncherCommand(command)) {
		if (state.networkFail) {
			return fail(state.networkFail, 128);
		}
		return ok("");
	}
	if (command.startsWith("rm -rf -- ")) {
		return ok("");
	}
	throw new Error(`unexpected command: ${command}`);
}

function defaultFetchHandler(
	command: string,
	options?: ExecCall["options"],
	state: {
		isolatedSha?: string;
		destSha?: string;
		networkFail?: string;
	} = {},
): ReturnType<typeof ok> {
	if (command.startsWith("git check-ref-format ")) {
		return ok("");
	}
	if (command.includes("mkdir -m 0700") || command.includes("base64 -d")) {
		return ok("");
	}
	if (command.includes("git init --bare")) {
		return ok("");
	}
	if (command.includes("config --local --list")) {
		return ok(
			[
				"core.repositoryformatversion=0",
				"core.bare=true",
				"core.hookspath=/tmp/hooks",
				"credential.helper=",
				"core.askpass=",
			].join("\n"),
		);
	}
	if (isNetworkLauncherCommand(command)) {
		if (state.networkFail) {
			return fail(state.networkFail, 128);
		}
		return ok("");
	}
	if (
		command.includes("rev-parse") &&
		command.includes("refs/ditto-isolated") &&
		command.includes("--git-dir=")
	) {
		return ok(`${state.isolatedSha ?? FETCH_SHA}\n`);
	}
	if (
		command.startsWith("git fetch --no-tags ") &&
		command.includes("/tmp/ditto-privileged-git-")
	) {
		expect(options?.cwd).toBe(WORKSPACE);
		expect(options?.env).toBeUndefined();
		return ok("");
	}
	if (
		command.startsWith("git rev-parse ") &&
		command.includes("refs/remotes/origin/")
	) {
		expect(options?.cwd).toBe(WORKSPACE);
		return ok(`${state.destSha ?? state.isolatedSha ?? FETCH_SHA}\n`);
	}
	if (command.startsWith("rm -rf -- ")) {
		return ok("");
	}
	throw new Error(`unexpected command: ${command}`);
}

describe("buildBrokeredGitChildEnv", () => {
	it("contains no token, x-access-token, or Authorization header", () => {
		const env = buildBrokeredGitChildEnv({
			homeDir: "/tmp/home",
			inheritedEnv: {
				HTTP_PROXY: "http://evil",
				DITTO_SENTINEL: "nope",
				GIT_ASKPASS: "/evil",
			},
		});
		const serialized = JSON.stringify(env);
		expect(serialized).not.toMatch(/ghs_|x-access-token|Authorization/i);
		expect(env).not.toHaveProperty("DITTO_SENTINEL");
		expect(env).not.toHaveProperty("HTTP_PROXY");
		expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(env.GIT_CONFIG_VALUE_0).toBe("never");
		expect(env.GIT_CONFIG_VALUE_3).toBe("");
		expect(env.GIT_CONFIG_VALUE_4).toBe("false");
		expect(env.GIT_CONFIG_VALUE_6).toBe("1");
		expect(env.GIT_SSL_CAINFO).toBe(CLOUDFLARE_CONTAINERS_CA_PATH);
		expect(env.GIT_CONFIG_VALUE_7).toBe(CLOUDFLARE_CONTAINERS_CA_PATH);
		expect(env.GIT_CONFIG_KEY_0).toBe("protocol.allow");
		expect(
			Object.values(env).every(
				(value) => !/authorization|x-access-token/i.test(value),
			),
		).toBe(true);
	});

	it("does not put the intercept CA on the token-bearing child env", () => {
		const tokenEnv = buildPrivilegedGitChildEnv({
			token: TOKEN,
			homeDir: "/tmp/home",
		});
		expect(tokenEnv).not.toHaveProperty("GIT_SSL_CAINFO");
		expect(Object.values(tokenEnv).join("\n")).not.toContain(
			CLOUDFLARE_CONTAINERS_CA_PATH,
		);
	});
});

describe("buildPrivilegedGitChildEnv", () => {
	it("drops inherited sentinel variables and clears proxy/helper injection", () => {
		const env = buildPrivilegedGitChildEnv({
			token: TOKEN,
			homeDir: "/tmp/home",
			inheritedEnv: {
				HTTP_PROXY: "http://evil",
				https_proxy: "http://evil",
				ALL_PROXY: "socks5://evil",
				GIT_DIR: "/evil/git",
				GIT_WORK_TREE: "/evil/wt",
				GIT_OBJECT_DIRECTORY: "/evil/objects",
				LD_PRELOAD: "/evil.so",
				SSH_AUTH_SOCK: "/evil/ssh",
				DITTO_SENTINEL: "should-not-leak",
				PATH: "/evil/bin",
			},
		});

		expect(env).not.toHaveProperty("DITTO_SENTINEL");
		expect(env).not.toHaveProperty("HTTP_PROXY");
		expect(env).not.toHaveProperty("https_proxy");
		expect(env).not.toHaveProperty("ALL_PROXY");
		expect(env).not.toHaveProperty("GIT_DIR");
		expect(env).not.toHaveProperty("GIT_WORK_TREE");
		expect(env).not.toHaveProperty("LD_PRELOAD");
		expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
		expect(env.PATH).toBe(
			"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		);
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(env.GIT_CONFIG_VALUE_1).toBe("never");
		expect(env.GIT_CONFIG_VALUE_2).toBe("always");
		expect(env.GIT_CONFIG_VALUE_4).toBe("");
		expect(env.GIT_CONFIG_VALUE_0).toContain("Authorization: Basic ");
		expect(env.GIT_CONFIG_VALUE_0).not.toContain(TOKEN);
		expect(
			Object.keys(env).every((key) => !key.toLowerCase().includes("proxy")),
		).toBe(true);
	});
});

describe("validateGitBranchRefs", () => {
	it("accepts shell-significant valid branch names and returns full refs", async () => {
		const branch = "feat/x;$(touch:/tmp/pwned)";
		const { sandbox, calls } = makeSandbox((command) => {
			if (command.startsWith("git check-ref-format ")) {
				const quoted = quoteGitHubExportShellArg(`refs/heads/${branch}`);
				expect(command).toBe(`git check-ref-format ${quoted}`);
				return ok("");
			}
			throw new Error(`unexpected: ${command}`);
		});

		const refs = await validateGitBranchRefs(sandbox, branch);
		expect(refs.branchName).toBe(branch);
		expect(refs.headRef).toBe(`refs/heads/${branch}`);
		expect(refs.remoteTrackingRef).toBe(`refs/remotes/origin/${branch}`);
		expect(refs.isolatedFetchRefspec).toBe(
			`+refs/heads/${branch}:refs/ditto-isolated`,
		);
		expect(refs.pushRefspecFrom(HEAD_SHA)).toBe(
			`${HEAD_SHA}:refs/heads/${branch}`,
		);
		expect(calls).toHaveLength(1);
	});

	it("rejects empty, option-like, full-ref, and newline branch names before git", async () => {
		const { sandbox, exec } = makeSandbox(() => ok(""));

		await expect(validateGitBranchRefs(sandbox, "")).rejects.toThrow(/empty/);
		await expect(validateGitBranchRefs(sandbox, "-bad")).rejects.toThrow(
			/option-like/,
		);
		await expect(
			validateGitBranchRefs(sandbox, "refs/heads/main"),
		).rejects.toThrow(/short branch name/);
		await expect(validateGitBranchRefs(sandbox, "main\n")).rejects.toThrow(
			/control characters/,
		);
		expect(exec).not.toHaveBeenCalled();
	});

	it("rejects when git check-ref-format fails", async () => {
		const { sandbox } = makeSandbox((command) => {
			if (command.startsWith("git check-ref-format ")) {
				return fail("invalid");
			}
			throw new Error(`unexpected: ${command}`);
		});
		await expect(validateGitBranchRefs(sandbox, "has space")).rejects.toThrow(
			/Invalid branch ref/,
		);
	});
});

describe("pushGitHubCommitIsolated", () => {
	it("stages exact SHA, mints token only after verification, and pushes public URL from temp cwd", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultPushHandler(command, options),
		);

		await pushGitHubCommitIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: "ditto/session-1",
			sourceCwd: WORKTREE,
			headRev: HEAD_SHA,
			mintToken,
		});

		expect(mintToken).toHaveBeenCalledTimes(1);

		const mintOrder = calls.findIndex((call) =>
			isNetworkLauncherCommand(call.command),
		);
		const stageOrder = calls.findIndex(
			(call) =>
				call.command.includes("objects/info/alternates") &&
				call.command.includes("update-ref"),
		);
		const headOrder = calls.findIndex(
			(call) => call.command === "git rev-parse HEAD",
		);
		const commonDirOrder = calls.findIndex(
			(call) =>
				call.command ===
				"git rev-parse --path-format=absolute --git-common-dir",
		);
		expect(headOrder).toBeGreaterThanOrEqual(0);
		expect(commonDirOrder).toBeGreaterThan(headOrder);
		expect(stageOrder).toBeGreaterThan(commonDirOrder);
		expect(mintOrder).toBeGreaterThan(stageOrder);
		expect(
			calls.some(
				(call) =>
					call.command.startsWith("git fetch --no-tags ") &&
					call.command.includes(WORKTREE),
			),
		).toBe(false);

		// mintToken is invoked only when network is about to run — after stage verify.
		const networkCall = calls[mintOrder];
		expect(networkCall.options?.cwd).toMatch(/^\/tmp\/ditto-privileged-git-/);
		expect(networkCall.options?.cwd).not.toBe(WORKTREE);
		expect(networkCall.command).not.toContain(TOKEN);
		expect(networkCall.command).not.toContain("x-access-token");
		expect(networkCall.command).not.toContain(WORKTREE);

		const { gitArgs, childEnv } = parseNetworkEnv(networkCall.options);
		expect(gitArgs).toEqual([
			"push",
			"--no-verify",
			"https://github.com/acme/repo.git",
			`${HEAD_SHA}:refs/heads/ditto/session-1`,
		]);
		expect(JSON.stringify(gitArgs)).not.toContain(TOKEN);
		expect(networkCall.options?.env?.DITTO_PRIVILEGED_GIT_CWD).toBe(
			networkCall.options?.cwd,
		);
		expect(networkCall.options?.env?.DITTO_PRIVILEGED_GIT_CWD).toMatch(
			/^\/tmp\/ditto-privileged-git-/,
		);
		expect(childEnv.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(childEnv.GIT_TERMINAL_PROMPT).toBe("0");
		expect(childEnv.credential_helper ?? childEnv.GIT_CONFIG_VALUE_4).toBe("");
		expect(childEnv.GIT_CONFIG_VALUE_1).toBe("never");
		expect(childEnv.GIT_CONFIG_VALUE_2).toBe("always");
		expect(
			Object.keys(childEnv).some((k) => k.toLowerCase().includes("proxy")),
		).toBe(false);

		expect(
			calls.some(
				(call) =>
					call.command.startsWith("git push") && call.options?.cwd === WORKTREE,
			),
		).toBe(false);
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("quotes shell-significant branch refspecs as one argument and never creates shell sentinels via unquoted expansion", async () => {
		const branch = "feat/semi;echo-pwned";
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) => {
			if (command.startsWith("git check-ref-format ")) {
				expect(command).toContain(
					quoteGitHubExportShellArg(`refs/heads/${branch}`),
				);
				return ok("");
			}
			return defaultPushHandler(command, options);
		});

		await pushGitHubCommitIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: branch,
			sourceCwd: WORKTREE,
			headRev: HEAD_SHA,
			mintToken,
		});

		const networkCall = calls.find((call) =>
			isNetworkLauncherCommand(call.command),
		);
		expect(networkCall).toBeDefined();
		const { gitArgs } = parseNetworkEnv(networkCall?.options);
		expect(gitArgs[3]).toBe(`${HEAD_SHA}:refs/heads/${branch}`);
		// Args are JSON env values, not shell-interpolated.
		expect(networkCall?.command).not.toContain(branch);
	});

	it("rejects HEAD mismatch before token mint and still cleans up", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultPushHandler(command, options, {
				sourceHead: "cccccccccccccccccccccccccccccccccccccccc",
			}),
		);

		await expect(
			pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			}),
		).rejects.toThrow(/HEAD changed after secret preflight/);

		expect(mintToken).not.toHaveBeenCalled();
		expect(calls.some((call) => isNetworkLauncherCommand(call.command))).toBe(
			false,
		);
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("rejects staged SHA mismatch before token mint and still cleans up", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultPushHandler(command, options, {
				stagedSha: "dddddddddddddddddddddddddddddddddddddddd",
			}),
		);

		await expect(
			pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			}),
		).rejects.toThrow(/does not match the preflight head revision/);

		expect(mintToken).not.toHaveBeenCalled();
		expect(calls.some((call) => isNetworkLauncherCommand(call.command))).toBe(
			false,
		);
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("rejects non-commit preflight objects before token mint", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) => {
			if (command.startsWith("git cat-file -t ")) {
				return ok("blob\n");
			}
			return defaultPushHandler(command, options);
		});

		await expect(
			pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			}),
		).rejects.toThrow(/not a commit object/);

		expect(mintToken).not.toHaveBeenCalled();
		expect(calls.some((call) => isNetworkLauncherCommand(call.command))).toBe(
			false,
		);
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("rejects invalid source git common-dir paths before token mint", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) => {
			if (command === "git rev-parse --path-format=absolute --git-common-dir") {
				return ok("../evil/.git\n");
			}
			return defaultPushHandler(command, options);
		});

		await expect(
			pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			}),
		).rejects.toThrow(/Source git directory path is invalid/);

		expect(mintToken).not.toHaveBeenCalled();
		expect(
			calls.some(
				(call) =>
					call.command.includes("objects/info/alternates") &&
					call.command.includes("update-ref"),
			),
		).toBe(false);
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("stages via object alternates instead of fetch-from-worktree (blobless clone safe)", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultPushHandler(command, options),
		);

		await pushGitHubCommitIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: "main",
			sourceCwd: WORKTREE,
			headRev: HEAD_SHA,
			mintToken,
		});

		const stage = calls.find(
			(call) =>
				call.command.includes("objects/info/alternates") &&
				call.command.includes("update-ref"),
		);
		expect(stage).toBeDefined();
		expect(stage?.command).toContain(
			quoteGitHubExportShellArg(`${WORKSPACE}/.git/objects`),
		);
		expect(stage?.command).toContain(
			quoteGitHubExportShellArg("refs/ditto-isolated"),
		);
		expect(stage?.command).toContain(quoteGitHubExportShellArg(HEAD_SHA));
		// Must not pack the partial clone into an empty bare (lazy-fetch disabled).
		expect(
			calls.some(
				(call) =>
					call.command.startsWith("git fetch --no-tags ") &&
					call.command.includes(WORKTREE),
			),
		).toBe(false);
		expect(mintToken).toHaveBeenCalledTimes(1);
	});

	it("does not consult repository-controlled remote names or source worktree as network cwd", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultPushHandler(command, options),
		);

		await pushGitHubCommitIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: "main",
			sourceCwd: WORKTREE,
			headRev: HEAD_SHA,
			mintToken,
		});

		for (const call of calls) {
			if (isNetworkLauncherCommand(call.command)) {
				expect(call.options?.cwd).not.toBe(WORKTREE);
				expect(call.command).not.toMatch(/\borigin\b/);
				const { gitArgs } = parseNetworkEnv(call.options);
				expect(gitArgs.join(" ")).not.toMatch(/\borigin\b/);
				expect(gitArgs.join(" ")).toContain("https://github.com/acme/repo.git");
			}
		}
	});

	it("redacts raw, encoded, and header credential forms from thrown errors", async () => {
		const secrets = buildCredentialRedactionSecrets(TOKEN);
		const mintToken = vi.fn(async () => TOKEN);
		const leak = `fail ${TOKEN} ${secrets[1]} ${secrets[2]} ${secrets[3]}`;
		const { sandbox } = makeSandbox((command, options) =>
			defaultPushHandler(command, options, { networkFail: leak }),
		);

		let message = "";
		try {
			await pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("[REDACTED]");
		for (const secret of secrets) {
			expect(message).not.toContain(secret);
		}
	});

	it("rejects invalid refs before token mint", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, exec } = makeSandbox((command) => {
			if (command.startsWith("git check-ref-format ")) {
				return fail("bad");
			}
			throw new Error(`unexpected: ${command}`);
		});

		await expect(
			pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "bad branch",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			}),
		).rejects.toThrow(/Invalid branch ref/);

		expect(mintToken).not.toHaveBeenCalled();
		expect(
			exec.mock.calls.some((call) =>
				String(call[0]).includes("git init --bare"),
			),
		).toBe(false);
	});

	it("rejects unexpected local config like core.sshCommand before token mint", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultPushHandler(command, options, {
				configExtra: "core.sshcommand=evil",
			}),
		);

		await expect(
			pushGitHubCommitIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken,
			}),
		).rejects.toThrow(/unexpected local configuration/);

		expect(mintToken).not.toHaveBeenCalled();
		expect(calls.some((call) => isNetworkLauncherCommand(call.command))).toBe(
			false,
		);
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("uses distinct temp directories for concurrent pushes and cleans each", async () => {
		const temps = new Set<string>();
		const make = () =>
			makeSandbox((command, options) => {
				if (options?.cwd?.startsWith("/tmp/ditto-privileged-git-")) {
					temps.add(options.cwd);
				}
				if (command.startsWith("rm -rf -- ")) {
					const match = /'(\/tmp\/ditto-privileged-git-[^']+)'/.exec(command);
					if (match) {
						temps.add(match[1]);
					}
				}
				return defaultPushHandler(command, options);
			});

		const a = make();
		const b = make();
		await Promise.all([
			pushGitHubCommitIsolated({
				sandbox: a.sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken: async () => TOKEN,
			}),
			pushGitHubCommitIsolated({
				sandbox: b.sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				sourceCwd: WORKTREE,
				headRev: HEAD_SHA,
				mintToken: async () => `${TOKEN}b`,
			}),
		]);

		expect(temps.size).toBeGreaterThanOrEqual(2);
		expect(a.calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
		expect(b.calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});
});

describe("fetchGitHubBranchIsolated", () => {
	it("fetches public URL in temp repo, transfers exact SHA, verifies destination", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultFetchHandler(command, options),
		);

		const result = await fetchGitHubBranchIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: "main",
			destinationCwd: WORKSPACE,
			mintToken,
		});

		expect(result).toMatchObject({
			branchName: "main",
			headSha: FETCH_SHA,
		});
		expect(mintToken).toHaveBeenCalledTimes(1);

		const networkCall = calls.find((call) =>
			isNetworkLauncherCommand(call.command),
		);
		expect(networkCall?.options?.cwd).toMatch(/^\/tmp\/ditto-privileged-git-/);
		expect(networkCall?.options?.cwd).not.toBe(WORKSPACE);
		expect(networkCall?.command).not.toContain(TOKEN);
		expect(networkCall?.command).not.toContain("x-access-token");
		expect(networkCall?.command).not.toContain(WORKSPACE);

		const { gitArgs, childEnv } = parseNetworkEnv(networkCall?.options);
		expect(gitArgs).toEqual([
			"fetch",
			"--no-tags",
			"https://github.com/acme/repo.git",
			"+refs/heads/main:refs/ditto-isolated",
		]);
		expect(childEnv.GIT_CONFIG_VALUE_1).toBe("never");
		expect(childEnv.GIT_CONFIG_VALUE_2).toBe("always");

		const transfer = calls.find(
			(call) =>
				call.command.startsWith("git fetch --no-tags ") &&
				call.options?.cwd === WORKSPACE,
		);
		expect(transfer).toBeDefined();
		expect(transfer?.options?.env).toBeUndefined();
		expect(transfer?.command).toContain(FETCH_SHA);
		expect(transfer?.command).toContain("refs/remotes/origin/main");
		expect(transfer?.command).not.toContain(TOKEN);

		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("fails closed when destination remote-tracking SHA mismatches", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultFetchHandler(command, options, {
				isolatedSha: FETCH_SHA,
				destSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			}),
		);

		await expect(
			fetchGitHubBranchIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				destinationCwd: WORKSPACE,
				mintToken,
			}),
		).rejects.toThrow(/does not match the isolated fetch SHA/);

		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("redacts credential material from fetch errors and cleans up", async () => {
		const secrets = buildCredentialRedactionSecrets(TOKEN);
		const mintToken = vi.fn(async () => TOKEN);
		const leak = `auth ${TOKEN} ${secrets[2]} ${secrets[3]}`;
		const { sandbox, calls } = makeSandbox((command, options) =>
			defaultFetchHandler(command, options, { networkFail: leak }),
		);

		let message = "";
		try {
			await fetchGitHubBranchIsolated({
				sandbox,
				githubRepo: "acme/repo",
				branchName: "main",
				destinationCwd: WORKSPACE,
				mintToken,
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("[REDACTED]");
		for (const secret of secrets) {
			expect(message).not.toContain(secret);
		}
		expect(calls.some((call) => call.command.startsWith("rm -rf -- "))).toBe(
			true,
		);
	});

	it("quotes shell-significant branch names in fetch refspecs without shell interpolation", async () => {
		const branch = "feat/x$(id)";
		const mintToken = vi.fn(async () => TOKEN);
		const { sandbox, calls } = makeSandbox((command, options) => {
			if (command.startsWith("git check-ref-format ")) {
				expect(command).toContain(
					quoteGitHubExportShellArg(`refs/heads/${branch}`),
				);
				return ok("");
			}
			if (
				command.startsWith("git rev-parse ") &&
				command.includes("refs/remotes/origin/")
			) {
				expect(command).toContain(
					quoteGitHubExportShellArg(`refs/remotes/origin/${branch}`),
				);
				return ok(`${FETCH_SHA}\n`);
			}
			return defaultFetchHandler(command, options);
		});

		await fetchGitHubBranchIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: branch,
			destinationCwd: WORKSPACE,
			mintToken,
		});

		const networkCall = calls.find((call) =>
			isNetworkLauncherCommand(call.command),
		);
		const { gitArgs } = parseNetworkEnv(networkCall?.options);
		expect(gitArgs[3]).toBe(`+refs/heads/${branch}:refs/ditto-isolated`);
		expect(networkCall?.command).not.toContain(branch);
	});
});

describe("launcher source hygiene", () => {
	it("launcher source is valid JS with escaped newlines", () => {
		expect(PRIVILEGED_GIT_LAUNCHER_SOURCE).toContain("invalid cwd\\n");
		expect(PRIVILEGED_GIT_LAUNCHER_SOURCE).not.toMatch(
			/invalid cwd"\s*\n\s*"\)/,
		);
		new Function(PRIVILEGED_GIT_LAUNCHER_SOURCE);
	});

	it("launcher payload contains no credential and does not merge process.env", async () => {
		const mintToken = vi.fn(async () => TOKEN);
		let launcherEncoded: string | undefined;
		const { sandbox } = makeSandbox((command, options) => {
			const match = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d/.exec(
				command,
			);
			if (match) {
				launcherEncoded = match[1];
			}
			return defaultPushHandler(command, options);
		});

		await pushGitHubCommitIsolated({
			sandbox,
			githubRepo: "acme/repo",
			branchName: "main",
			sourceCwd: WORKTREE,
			headRev: HEAD_SHA,
			mintToken,
		});

		expect(launcherEncoded).toBeDefined();
		const source = atob(launcherEncoded ?? "");
		expect(source).toContain("spawnSync");
		expect(source).not.toContain("process.env,");
		expect(source).not.toContain("...process.env");
		expect(source).not.toContain(TOKEN);
		expect(source).not.toContain("x-access-token");
		expect(source).toContain("DITTO_PRIVILEGED_GIT_CHILD_ENV");
		expect(source).toContain("DITTO_PRIVILEGED_GIT_CWD");
		expect(source).toContain("cwd");
		expect(source).toContain("/tmp/ditto-privileged-git-");
	});
});

describe("fetchGitHubBranchBrokered", () => {
	function brokeredFetchHandler(
		command: string,
		options?: ExecCall["options"],
	): ReturnType<typeof ok> {
		if (command.startsWith("git check-ref-format ")) {
			return ok("");
		}
		if (command.includes("mkdir -m 0700") || command.includes("base64 -d")) {
			return ok("");
		}
		if (command.includes("git init --bare")) {
			return ok("");
		}
		if (command.includes("config --local --list")) {
			return ok(
				[
					"core.repositoryformatversion=0",
					"core.bare=true",
					"core.hookspath=/tmp/hooks",
					"credential.helper=",
					"core.askpass=",
				].join("\n"),
			);
		}
		if (isNetworkLauncherCommand(command)) {
			return ok("");
		}
		if (
			command.includes("rev-parse") &&
			command.includes("refs/ditto-isolated") &&
			command.includes("--git-dir=")
		) {
			return ok(`${FETCH_SHA}\n`);
		}
		if (command.includes("git init --template=") && command.includes("mkdir")) {
			return ok("");
		}
		if (
			command.startsWith("git fetch --no-tags ") &&
			command.includes("/tmp/ditto-privileged-git-")
		) {
			expect(options?.cwd).toBe(WORKSPACE);
			expect(options?.env).toBeUndefined();
			return ok("");
		}
		if (command.includes("git checkout --force")) {
			expect(options?.cwd).toBe(WORKSPACE);
			return ok("");
		}
		if (command === "git rev-parse HEAD") {
			expect(options?.cwd).toBe(WORKSPACE);
			return ok(`${FETCH_SHA}\n`);
		}
		if (command.startsWith("rm -rf -- ")) {
			return ok("");
		}
		throw new Error(`unexpected command: ${command}`);
	}

	it("network child env has no token, x-access-token, or Authorization", async () => {
		const { sandbox, calls } = makeSandbox((command, options) =>
			brokeredFetchHandler(command, options),
		);

		const result = await fetchGitHubBranchBrokered({
			sandbox,
			githubRepo: "acme/repo",
			branchName: "main",
			destinationCwd: WORKSPACE,
		});

		expect(result.headSha).toBe(FETCH_SHA);
		const networkCall = calls.find((call) =>
			isNetworkLauncherCommand(call.command),
		);
		expect(networkCall).toBeDefined();
		expect(networkCall?.command).not.toContain(TOKEN);
		expect(networkCall?.command).not.toContain("x-access-token");
		const { gitArgs, childEnv } = parseNetworkEnv(networkCall?.options);
		expect(gitArgs).toEqual([
			"fetch",
			"--no-tags",
			"https://github.com/acme/repo.git",
			"+refs/heads/main:refs/ditto-isolated",
		]);
		const serialized = JSON.stringify(childEnv);
		expect(serialized).not.toMatch(/ghs_|x-access-token|Authorization/i);
		expect(childEnv.GIT_CONFIG_VALUE_0).toBe("never");
		expect(Object.values(childEnv).join("\n")).not.toMatch(/Authorization/i);
	});
});
