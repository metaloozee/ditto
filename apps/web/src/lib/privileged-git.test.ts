import { describe, expect, it, vi } from "vitest";
import {
	buildBrokeredGitChildEnv,
	CLOUDFLARE_CONTAINERS_CA_PATH,
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
