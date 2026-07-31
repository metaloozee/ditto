import { describe, expect, it, vi } from "vitest";
import { quoteGitHubExportShellArg } from "#/lib/github-export";
import {
	buildCredentialRedactionSecrets,
	buildPrivilegedGitChildEnv,
	fetchGitHubBranchIsolated,
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
	if (
		command.startsWith("git fetch --no-tags ") &&
		command.includes(quoteGitHubExportShellArg(WORKTREE))
	) {
		expect(options?.cwd).toMatch(/^\/tmp\/ditto-privileged-git-/);
		expect(options?.env).toBeUndefined();
		return ok("");
	}
	if (
		command.includes("git rev-parse ") &&
		command.includes("refs/ditto-isolated")
	) {
		return ok(`${state.stagedSha ?? HEAD_SHA}\n`);
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
				call.command.startsWith("git fetch --no-tags ") &&
				call.command.includes(WORKTREE),
		);
		const headOrder = calls.findIndex(
			(call) => call.command === "git rev-parse HEAD",
		);
		expect(headOrder).toBeGreaterThanOrEqual(0);
		expect(stageOrder).toBeGreaterThan(headOrder);
		expect(mintOrder).toBeGreaterThan(stageOrder);

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
	});
});
