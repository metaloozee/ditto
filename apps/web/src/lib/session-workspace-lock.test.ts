import { beforeEach, describe, expect, it, vi } from "vitest";

const getProjectSandboxMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
}));

const { SessionWorkspaceBusyError } = await import(
	"./session-workspace-lock-error"
);
const { withSessionWorkspaceLock } = await import("./session-workspace-lock");

function result(success: boolean) {
	return { success, stdout: "", stderr: "", exitCode: success ? 0 : 1 };
}

describe("withSessionWorkspaceLock", () => {
	const exec = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		getProjectSandboxMock.mockReturnValue({ exec });
	});

	it("runs exclusively and releases the lock", async () => {
		exec.mockResolvedValue(result(true));
		const run = vi.fn().mockResolvedValue("ok");

		await expect(
			withSessionWorkspaceLock({
				env: {} as Env,
				sandboxId: "sandbox-1",
				sessionId: "session/1",
				run,
			}),
		).resolves.toBe("ok");

		expect(run).toHaveBeenCalledTimes(1);
		expect(String(exec.mock.calls[0]?.[0])).toContain(
			"/tmp/ditto-session-locks/session-1.lock",
		);
		expect(String(exec.mock.calls[1]?.[0])).toContain("rm -rf");
	});

	it("releases the lock when the operation fails", async () => {
		exec.mockResolvedValue(result(true));

		await expect(
			withSessionWorkspaceLock({
				env: {} as Env,
				sandboxId: "sandbox-1",
				sessionId: "session-1",
				run: async () => {
					throw new Error("failed");
				},
			}),
		).rejects.toThrow("failed");
		expect(String(exec.mock.calls[1]?.[0])).toContain("rm -rf");
	});

	it("rejects when another writer holds the lock", async () => {
		exec.mockResolvedValueOnce(result(false));
		const run = vi.fn();

		await expect(
			withSessionWorkspaceLock({
				env: {} as Env,
				sandboxId: "sandbox-1",
				sessionId: "session-1",
				run,
			}),
		).rejects.toBeInstanceOf(SessionWorkspaceBusyError);
		expect(run).not.toHaveBeenCalled();
		expect(exec).toHaveBeenCalledTimes(1);
	});
});
