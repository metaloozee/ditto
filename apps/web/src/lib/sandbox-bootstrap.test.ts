import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

const { execOrThrow, installDependencies } = await import(
	"./sandbox-bootstrap"
);

function result(success: boolean, stdout = "", stderr = "") {
	return { success, stdout, stderr, exitCode: success ? 0 : 1 };
}

describe("sandbox runtime helpers", () => {
	it("redacts configured environment values from command failures", async () => {
		const sandbox = {
			exec: vi.fn().mockResolvedValue(result(false, "", "failed secret-value")),
		};
		await expect(
			execOrThrow(sandbox as never, "false", {
				timeout: 100,
				errorPrefix: "Command failed",
				secrets: ["secret-value"],
			}),
		).rejects.toThrow("Command failed: failed [REDACTED]");
	});

	it("uses the lockfile-selected package manager", async () => {
		const exec = vi.fn(async (command: string) => {
			if (command.startsWith("command -v")) return result(true);
			return result(true);
		});
		const exists = vi.fn(async (path: string) => ({
			exists: path.endsWith("package.json") || path.endsWith("pnpm-lock.yaml"),
		}));
		await installDependencies({ exec, exists } as never);
		expect(exec).toHaveBeenCalledWith(
			"pnpm install --no-frozen-lockfile",
			expect.objectContaining({ cwd: "/workspace" }),
		);
	});

	it("skips dependency installation without package.json", async () => {
		const sandbox = {
			exec: vi.fn(),
			exists: vi.fn().mockResolvedValue({ exists: false }),
		};
		await installDependencies(sandbox as never);
		expect(sandbox.exec).not.toHaveBeenCalled();
	});
});
