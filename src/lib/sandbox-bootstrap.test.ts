import { beforeEach, describe, expect, it, vi } from "vitest";

const getSandboxMock = vi.hoisted(() => vi.fn());

vi.mock("@cloudflare/sandbox", () => ({
	getSandbox: getSandboxMock,
}));

const { restoreSandboxWorkspaceFromSnapshot } = await import(
	"./sandbox-bootstrap"
);

function makeFakeSandbox(options: {
	restored?: boolean;
	headSha?: string;
	hydrated?: boolean;
	hasPackageJson?: boolean;
}) {
	const restored = options.restored ?? true;
	const hydrated = options.hydrated ?? true;
	const hasPackageJson = options.hasPackageJson ?? false;

	return {
		restoreBackup: vi.fn().mockResolvedValue({ success: restored }),
		exec: vi.fn(async (command: string) => ({
			success: true,
			stdout:
				command === "git rev-parse HEAD"
					? `${options.headSha ?? "abc123"}\n`
					: "",
			stderr: "",
			exitCode: 0,
			command,
			duration: 10,
			timestamp: "2026-07-04T00:00:00.000Z",
		})),
		exists: vi.fn(async (path: string) => ({
			success: true,
			exists:
				(hasPackageJson && path.endsWith("package.json")) ||
				(hydrated && path.endsWith(".git")),
			path,
			timestamp: "2026-07-04T00:00:00.000Z",
		})),
		writeFile: vi.fn().mockResolvedValue({
			success: true,
			path: "/workspace/.env",
			timestamp: "2026-07-04T00:00:00.000Z",
		}),
	};
}

describe("restoreSandboxWorkspaceFromSnapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs restore, env-sync, install, and verifies hydration", async () => {
		const sandbox = makeFakeSandbox({
			restored: true,
			headSha: "abc123",
			hydrated: true,
			hasPackageJson: false,
		});
		getSandboxMock.mockReturnValue(sandbox);

		const result = await restoreSandboxWorkspaceFromSnapshot({
			env: { Sandbox: {} } as unknown as Env,
			sandboxId: "sandbox-1",
			directoryBackup: { id: "backup-1", dir: "/workspace" },
			envVars: [{ key: "KEY", value: "val" }],
			expectedDigest: "sha256:digest-1",
			baseCommitSha: "abc123",
		});

		expect(result).toEqual({ hydrated: true, commitMatch: true });
		expect(sandbox.restoreBackup).toHaveBeenCalledWith({
			id: "backup-1",
			dir: "/workspace",
		});
		expect(sandbox.writeFile).toHaveBeenCalled();
		expect(sandbox.exec).toHaveBeenCalledWith(
			"git rev-parse HEAD",
			expect.objectContaining({ cwd: "/workspace", timeout: 10_000 }),
		);
	});

	it("returns commitMatch: false when HEAD differs from baseCommitSha", async () => {
		const sandbox = makeFakeSandbox({
			headSha: "different-sha",
			hydrated: true,
		});
		getSandboxMock.mockReturnValue(sandbox);

		const result = await restoreSandboxWorkspaceFromSnapshot({
			env: { Sandbox: {} } as unknown as Env,
			sandboxId: "sandbox-1",
			directoryBackup: { id: "backup-1", dir: "/workspace" },
			envVars: [],
			expectedDigest: "sha256:digest-1",
			baseCommitSha: "abc123",
		});

		expect(result).toEqual({ hydrated: true, commitMatch: false });
	});

	it("skips commit comparison when baseCommitSha is null", async () => {
		const sandbox = makeFakeSandbox({
			headSha: "whatever",
			hydrated: true,
		});
		getSandboxMock.mockReturnValue(sandbox);

		const result = await restoreSandboxWorkspaceFromSnapshot({
			env: { Sandbox: {} } as unknown as Env,
			sandboxId: "sandbox-1",
			directoryBackup: { id: "backup-1", dir: "/workspace" },
			envVars: [],
			expectedDigest: "sha256:digest-1",
			baseCommitSha: null,
		});

		expect(result).toEqual({ hydrated: true, commitMatch: true });
		expect(sandbox.exec).not.toHaveBeenCalledWith(
			"git rev-parse HEAD",
			expect.anything(),
		);
	});

	it("throws when the workspace is not hydrated after restore", async () => {
		const sandbox = makeFakeSandbox({
			restored: true,
			hydrated: false,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			restoreSandboxWorkspaceFromSnapshot({
				env: { Sandbox: {} } as unknown as Env,
				sandboxId: "sandbox-1",
				directoryBackup: { id: "backup-1", dir: "/workspace" },
				envVars: [],
				expectedDigest: "sha256:digest-1",
				baseCommitSha: null,
			}),
		).rejects.toThrow("Restored sandbox workspace is not hydrated.");
	});
});
