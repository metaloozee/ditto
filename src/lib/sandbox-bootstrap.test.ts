import { beforeEach, describe, expect, it, vi } from "vitest";

const getSandboxMock = vi.hoisted(() => vi.fn());
const getInstallationAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@cloudflare/sandbox", () => ({
	getSandbox: getSandboxMock,
}));

vi.mock("#/lib/github-app", () => ({
	getInstallationAccessToken: getInstallationAccessTokenMock,
}));

const {
	backupSandboxWorkspace,
	bootstrapSandbox,
	isSandboxWorkspaceHydrated,
	restoreSandboxWorkspace,
} = await import("./sandbox-bootstrap");

function makeSandbox(
	options: {
		hasPackageJson?: boolean;
		hasPnpmLock?: boolean;
		hydrated?: boolean;
		headSha?: string;
	} = {},
) {
	const hasPackageJson = options.hasPackageJson ?? true;
	const hasPnpmLock = options.hasPnpmLock ?? true;
	const hydrated = options.hydrated ?? true;
	const headSha = options.headSha ?? "abc123";

	return {
		exists: vi.fn(async (path: string) => ({
			success: true,
			exists:
				(path.endsWith("package.json") && hasPackageJson) ||
				(path.endsWith("pnpm-lock.yaml") && hasPnpmLock) ||
				(path.endsWith(".git") && hydrated),
			path,
			timestamp: "2026-07-04T00:00:00.000Z",
		})),
		restoreBackup: vi.fn().mockResolvedValue({ success: true }),
		writeFile: vi.fn().mockResolvedValue({
			success: true,
			path: "/workspace/.env",
			timestamp: "2026-07-04T00:00:00.000Z",
		}),
		exec: vi.fn(async (command: string) => ({
			success: true,
			stdout: command === "git rev-parse HEAD" ? `${headSha}\n` : "",
			stderr: "",
			exitCode: 0,
			command,
			duration: 10,
			timestamp: "2026-07-04T00:00:00.000Z",
		})),
		gitCheckout: vi.fn().mockResolvedValue(undefined),
		createBackup: vi.fn().mockResolvedValue({
			id: "backup-1",
			dir: "/workspace",
		}),
		destroy: vi.fn().mockResolvedValue(undefined),
	};
}

describe("sandbox bootstrap helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("checks whether the workspace is hydrated", async () => {
		const sandbox = makeSandbox({ hydrated: true });
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			isSandboxWorkspaceHydrated({
				env: { Sandbox: {} } as unknown as Env,
				sandboxId: "sandbox-1",
			}),
		).resolves.toBe(true);

		expect(sandbox.exists).toHaveBeenCalledWith("/workspace/.git");
	});

	it("restores a backup, syncs env vars, and skips install without package.json", async () => {
		const sandbox = makeSandbox({ hasPackageJson: false });
		getSandboxMock.mockReturnValue(sandbox);

		await restoreSandboxWorkspace({
			env: { Sandbox: {} } as unknown as Env,
			sandboxId: "sandbox-1",
			backup: { id: "backup-1", dir: "/workspace" },
			envVars: [{ key: "KEY", value: "value" }],
		});

		expect(sandbox.restoreBackup).toHaveBeenCalledWith({
			id: "backup-1",
			dir: "/workspace",
		});
		expect(sandbox.writeFile).toHaveBeenCalledWith(
			"/workspace/.env",
			'KEY="value"\n',
		);
		expect(sandbox.exec).not.toHaveBeenCalled();
	});

	it("creates a backup with the workspace backup options", async () => {
		const sandbox = makeSandbox();
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			backupSandboxWorkspace({
				env: {
					Sandbox: {},
					USE_LOCAL_BUCKET_BACKUPS: "true",
				} as unknown as Env,
				sandboxId: "sandbox-1",
				projectId: "project-1",
			}),
		).resolves.toEqual({ id: "backup-1", dir: "/workspace" });

		expect(sandbox.createBackup).toHaveBeenCalledWith(
			expect.objectContaining({
				dir: "/workspace",
				name: "project-project-1",
				localBucket: true,
			}),
		);
	});

	it("bootstraps the repository, installs deps, and captures a backup", async () => {
		const sandbox = makeSandbox();
		getSandboxMock.mockReturnValue(sandbox);
		getInstallationAccessTokenMock.mockResolvedValue("token-123");

		await expect(
			bootstrapSandbox({
				env: {
					Sandbox: {},
					USE_LOCAL_BUCKET_BACKUPS: "true",
				} as unknown as Env,
				projectId: "project-1",
				sandboxId: "sandbox-1",
				githubRepo: "owner/repo",
				installationId: 42,
				envVars: [{ key: "KEY", value: "value" }],
			}),
		).resolves.toEqual({
			sandboxId: "sandbox-1",
			backup: { id: "backup-1", dir: "/workspace" },
		});

		expect(getInstallationAccessTokenMock).toHaveBeenCalledWith(
			expect.objectContaining({ Sandbox: {} }),
			42,
		);
		expect(sandbox.exec).toHaveBeenCalledWith(
			"find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
			expect.objectContaining({ cwd: "/", timeout: 120_000 }),
		);
		expect(sandbox.gitCheckout).toHaveBeenCalledWith(
			"https://x-access-token:token-123@github.com/owner/repo.git",
			expect.objectContaining({ targetDir: "/workspace" }),
		);
		expect(sandbox.writeFile).toHaveBeenCalledWith(
			"/workspace/.env",
			'KEY="value"\n',
		);
		expect(sandbox.exec).toHaveBeenCalledWith(
			"pnpm install --no-frozen-lockfile",
			expect.objectContaining({ cwd: "/workspace" }),
		);
	});

	it("destroys the sandbox if bootstrap fails", async () => {
		const sandbox = makeSandbox();
		getSandboxMock.mockReturnValue(sandbox);
		getInstallationAccessTokenMock.mockResolvedValue("token-123");
		sandbox.gitCheckout.mockRejectedValue(new Error("clone failed"));

		await expect(
			bootstrapSandbox({
				env: {
					Sandbox: {},
					USE_LOCAL_BUCKET_BACKUPS: "true",
				} as unknown as Env,
				projectId: "project-1",
				sandboxId: "sandbox-1",
				githubRepo: "owner/repo",
				installationId: 42,
				envVars: [],
			}),
		).rejects.toThrow("clone failed");

		expect(sandbox.destroy).toHaveBeenCalledTimes(1);
	});
});
