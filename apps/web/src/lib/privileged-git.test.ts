import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildBrokeredGitChildEnv,
	CLOUDFLARE_CONTAINERS_CA_PATH,
	fetchGitHubBranchBrokered,
	fetchGitHubBranchIntoRepositoryBrokered,
	validateGitBranchRefs,
} from "./privileged-git";

const SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function ok(stdout = "") {
	return { success: true, stdout, stderr: "", exitCode: 0 };
}

describe("brokered Git", () => {
	it("uses a closed credential-free network environment", () => {
		const env = buildBrokeredGitChildEnv({
			homeDir: "/tmp/home",
			inheritedEnv: { HTTP_PROXY: "http://evil", GIT_ASKPASS: "/evil" },
		});
		const serialized = JSON.stringify(env);
		expect(serialized).not.toMatch(/ghs_|x-access-token|authorization/i);
		expect(env).not.toHaveProperty("HTTP_PROXY");
		expect(env).not.toHaveProperty("GIT_CURL_VERBOSE");
		expect(env.GIT_SSL_CAINFO).toBe(CLOUDFLARE_CONTAINERS_CA_PATH);
		expect(env.GIT_CONFIG_VALUE_4).toBe("false");
	});

	it("validates branch refs before constructing refspecs", async () => {
		const sandbox = { exec: vi.fn().mockResolvedValue(ok()) };
		const refs = await validateGitBranchRefs(sandbox, "ditto/session-1");
		expect(refs.headRef).toBe("refs/heads/ditto/session-1");
		expect(refs.destinationFetchRefspecFrom(SHA)).toBe(
			`${SHA}:refs/remotes/origin/ditto/session-1`,
		);
		expect(String(sandbox.exec.mock.calls[0]?.[0])).toContain(
			"git check-ref-format",
		);
	});

	it("fetches through the broker then imports the exact SHA locally", async () => {
		type ExecOptions = {
			cwd?: string;
			timeout?: number;
			env?: Record<string, string | undefined>;
		};
		const calls: Array<{ command: string; options?: ExecOptions }> = [];
		const sandbox = {
			exec: vi.fn(async (command: string, options?: ExecOptions) => {
				calls.push({ command, options });
				if (command.includes("config --local --list")) {
					return ok(
						"core.repositoryformatversion=0\ncore.bare=true\ncore.hookspath=/tmp/hooks\ncredential.helper=\ncore.askpass=\n",
					);
				}
				if (command.includes("--git-dir=") && command.includes("rev-parse")) {
					return ok(`${SHA}\n`);
				}
				if (
					command.includes("git rev-parse") &&
					command.includes("refs/remotes/origin/")
				) {
					return ok(`${SHA}\n`);
				}
				return ok();
			}),
		};
		const result = await fetchGitHubBranchIntoRepositoryBrokered({
			sandbox,
			githubRepo: "owner/repo",
			branchName: "main",
			destinationCwd: "/workspace",
		});
		expect(result.headSha).toBe(SHA);
		const network = calls.find((call) =>
			call.command.includes("ditto-privileged-git-launcher.cjs"),
		);
		expect(network).toBeDefined();
		expect(JSON.stringify(network)).not.toMatch(
			/ghs_|x-access-token|authorization/i,
		);
		expect(
			calls.some(
				(call) =>
					call.command.startsWith("git fetch --no-tags ") &&
					call.command.includes(`${SHA}:refs/remotes/origin/main`),
			),
		).toBe(true);
	});
});

describe("fetchGitHubBranchBrokered with real git", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});

	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@t",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@t",
			},
		}).trim();

	/** Runs sandbox commands locally; only the GitHub hop becomes a fetch from upstream. */
	function localSandbox(upstream: string) {
		return {
			exec: async (
				command: string,
				options?: { cwd?: string; env?: Record<string, string | undefined> },
			) => {
				let script = command;
				const gitArgs = options?.env?.DITTO_PRIVILEGED_GIT_ARGS;
				if (gitArgs) {
					const refspec = (JSON.parse(gitArgs) as string[]).at(-1);
					script = `git --git-dir='${options?.env?.DITTO_PRIVILEGED_GIT_CWD}' fetch -q '${upstream}' '${refspec}'`;
				}
				const result = spawnSync("sh", ["-c", script], {
					cwd: options?.cwd ?? "/",
					encoding: "utf8",
				});
				return {
					success: result.status === 0,
					exitCode: result.status ?? 1,
					stdout: result.stdout,
					stderr: result.stderr,
				};
			},
		};
	}

	it("moves a restored workspace with the branch checked out to the fetched head", async () => {
		const root = mkdtempSync(join(tmpdir(), "ditto-fetch-"));
		dirs.push(root);
		const upstream = join(root, "upstream");
		const workspace = join(root, "workspace");
		execFileSync("git", ["init", "-q", "-b", "main", upstream]);
		execFileSync("sh", ["-c", "echo one > a && echo gone > b"], {
			cwd: upstream,
		});
		git(upstream, "add", ".");
		git(upstream, "commit", "-qm", "seed");
		git(root, "clone", "-q", upstream, workspace);
		git(upstream, "rm", "-q", "b");
		git(upstream, "commit", "-qm", "next");
		const head = git(upstream, "rev-parse", "HEAD");

		const fetched = await fetchGitHubBranchBrokered({
			sandbox: localSandbox(upstream),
			githubRepo: "acme/app",
			branchName: "main",
			destinationCwd: workspace,
		});

		expect(fetched.headSha).toBe(head);
		expect(git(workspace, "symbolic-ref", "--short", "HEAD")).toBe("main");
		expect(git(workspace, "status", "--porcelain")).toBe("");
		expect(existsSync(join(workspace, "b"))).toBe(false);
	});
});
