import { beforeEach, describe, expect, it, vi } from "vitest";

const getSandboxMock = vi.hoisted(() => vi.fn());
const getInstallationAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@cloudflare/sandbox", () => ({
	getSandbox: getSandboxMock,
}));

vi.mock("#/lib/github-app", () => ({
	getInstallationAccessToken: getInstallationAccessTokenMock,
	repositoryNameFromSlug: (githubRepo: string) => {
		const parts = githubRepo.split("/").filter(Boolean);
		if (parts.length < 2) {
			return undefined;
		}
		return parts[parts.length - 1];
	},
}));

const {
	backupSandboxWorkspace,
	bootstrapSandbox,
	execOrThrow,
	fetchPrimaryBranchFromGitHub,
	isSandboxRunnerHealthy,
	isSandboxWorkspaceHydrated,
	installDependencies,
	restoreSandboxWorkspace,
	syncPrimaryWorkspaceFromGitHub,
} = await import("./sandbox-bootstrap");

const INSTALL_COMMAND_RE = /pnpm install|npm install|yarn install/;
const RETRY_SIGNAL_PATH = "/workspace/.ditto/primary-deps-install-retry";

function makeSandbox(
	options: {
		hasPackageJson?: boolean;
		hasPnpmLock?: boolean;
		hasYarnLock?: boolean;
		hydrated?: boolean;
		headSha?: string;
	} = {},
) {
	const hasPackageJson = options.hasPackageJson ?? true;
	const hasPnpmLock = options.hasPnpmLock ?? true;
	const hasYarnLock = options.hasYarnLock ?? false;
	const hydrated = options.hydrated ?? true;
	const headSha = options.headSha ?? "abc123";

	return {
		exists: vi.fn(async (path: string) => ({
			success: true,
			exists:
				(path.endsWith("package.json") && hasPackageJson) ||
				(path.endsWith("pnpm-lock.yaml") && hasPnpmLock) ||
				(path.endsWith("yarn.lock") && hasYarnLock) ||
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

	it("validates the baked runner manifest outside its package directory", async () => {
		const sandbox = makeSandbox();
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			isSandboxRunnerHealthy({
				env: { Sandbox: {} } as unknown as Env,
				sandboxId: "sandbox-1",
			}),
		).resolves.toBe(true);

		expect(sandbox.exec).toHaveBeenCalledWith(
			expect.stringContaining("/opt/ditto-runner/package.json"),
			expect.objectContaining({ cwd: "/" }),
		);
	});

	it("rejects an invalid baked runner manifest", async () => {
		const sandbox = makeSandbox();
		sandbox.exec.mockResolvedValueOnce({
			success: false,
			stdout: "",
			stderr: "ERR_INVALID_PACKAGE_CONFIG",
			exitCode: 1,
			command: "runner health check",
			duration: 1,
			timestamp: "2026-07-04T00:00:00.000Z",
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			isSandboxRunnerHealthy({
				env: { Sandbox: {} } as unknown as Env,
				sandboxId: "sandbox-1",
			}),
		).resolves.toBe(false);
	});

	it("restores a backup and skips install without package.json", async () => {
		const sandbox = makeSandbox({ hasPackageJson: false });
		getSandboxMock.mockReturnValue(sandbox);

		await restoreSandboxWorkspace({
			env: { Sandbox: {} } as unknown as Env,
			sandboxId: "sandbox-1",
			backup: { id: "backup-1", dir: "/workspace" },
		});

		expect(sandbox.restoreBackup).toHaveBeenCalledWith({
			id: "backup-1",
			dir: "/workspace",
		});
		expect(sandbox.writeFile).not.toHaveBeenCalled();
		expect(sandbox.exec).not.toHaveBeenCalled();
	});

	it("includes stdout and stderr when a command fails", async () => {
		const sandbox = makeSandbox();
		sandbox.exec.mockResolvedValueOnce({
			success: false,
			stdout: "ERR_PNPM_IGNORED_BUILDS: Ignored build scripts",
			stderr: "Corepack is about to download pnpm",
			exitCode: 1,
			command: "pnpm install",
			duration: 1,
			timestamp: "2026-07-04T00:00:00.000Z",
		});

		await expect(
			execOrThrow(sandbox as never, "pnpm install", {
				timeout: 1_000,
				errorPrefix: "Install failed",
			}),
		).rejects.toThrow(
			"Install failed: Corepack is about to download pnpm\nERR_PNPM_IGNORED_BUILDS: Ignored build scripts",
		);
	});

	it.each([
		{ manager: "pnpm", hasPnpmLock: true, hasYarnLock: false },
		{ manager: "yarn", hasPnpmLock: false, hasYarnLock: true },
	])("does not fall back to npm when $manager is unavailable", async ({
		manager,
		hasPnpmLock,
		hasYarnLock,
	}) => {
		const sandbox = makeSandbox({ hasPnpmLock, hasYarnLock });
		sandbox.exec.mockImplementation(async (command: string) => ({
			success: !command.startsWith("command -v"),
			stdout: "",
			stderr: "",
			exitCode: command.startsWith("command -v") ? 1 : 0,
			command,
			duration: 1,
			timestamp: "2026-07-04T00:00:00.000Z",
		}));
		getSandboxMock.mockReturnValue(sandbox);

		await expect(installDependencies(sandbox as never)).rejects.toThrow(
			`${manager} is required`,
		);
		expect(sandbox.exec).not.toHaveBeenCalledWith(
			"npm install",
			expect.anything(),
		);
	});

	it("enables Corepack before installing pnpm", async () => {
		const sandbox = makeSandbox();
		let corepackEnabled = false;
		sandbox.exec.mockImplementation(async (command: string) => {
			const success =
				command === "command -v 'corepack'" ||
				(command === "command -v 'pnpm'" && corepackEnabled) ||
				!command.startsWith("command -v");
			if (command === "corepack enable") {
				corepackEnabled = true;
			}
			return {
				success,
				stdout: success ? "/usr/local/bin/pnpm\n" : "",
				stderr: "",
				exitCode: success ? 0 : 1,
				command,
				duration: 1,
				timestamp: "2026-07-04T00:00:00.000Z",
			};
		});
		getSandboxMock.mockReturnValue(sandbox);

		await installDependencies(sandbox as never);

		expect(sandbox.exec).toHaveBeenCalledWith(
			"corepack enable",
			expect.objectContaining({ cwd: "/workspace" }),
		);
		expect(sandbox.exec).toHaveBeenCalledWith(
			"pnpm install --no-frozen-lockfile",
			expect.objectContaining({ cwd: "/workspace" }),
		);
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
			}),
		).resolves.toEqual({
			sandboxId: "sandbox-1",
			backup: { id: "backup-1", dir: "/workspace" },
		});

		expect(getInstallationAccessTokenMock).toHaveBeenCalledWith(
			expect.objectContaining({ Sandbox: {} }),
			42,
			{ repositories: ["repo"] },
		);
		expect(sandbox.exec).toHaveBeenCalledWith(
			"find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
			expect.objectContaining({ cwd: "/", timeout: 120_000 }),
		);
		expect(sandbox.gitCheckout).toHaveBeenCalledWith(
			"https://x-access-token:token-123@github.com/owner/repo.git",
			expect.objectContaining({ targetDir: "/workspace" }),
		);
		expect(sandbox.writeFile).not.toHaveBeenCalled();
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
			}),
		).rejects.toThrow("clone failed");

		expect(sandbox.destroy).toHaveBeenCalledTimes(1);
	});
});

type SyncSandboxState = {
	branch?: string;
	headSha: string;
	remoteSha: string;
	trackedStatus?: string;
	detached?: boolean;
	remoteAhead?: boolean;
	headBehind?: boolean;
	fetchFails?: boolean;
	fetchError?: string;
	installFails?: boolean;
	retrySignal?: boolean;
};

function makeSyncSandbox(state: SyncSandboxState) {
	const branch = state.branch ?? "main";
	let currentHeadSha = state.headSha;
	const remoteSha = state.remoteSha;
	const installCalls = { count: 0 };

	const sandbox = {
		exists: vi.fn(async (path: string) => ({
			success: true,
			exists:
				path === RETRY_SIGNAL_PATH
					? Boolean(state.retrySignal)
					: path === "/workspace/package.json" ||
						path === "/workspace/pnpm-lock.yaml",
			path,
			timestamp: "2026-07-04T00:00:00.000Z",
		})),
		exec: vi.fn(async (command: string) => {
			if (command === "git status --porcelain --untracked-files=no") {
				return {
					success: true,
					stdout: state.trackedStatus ?? "",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command === "git symbolic-ref --quiet --short HEAD") {
				if (state.detached) {
					return {
						success: false,
						stdout: "",
						stderr: "not a symbolic ref",
						exitCode: 1,
						command,
						duration: 1,
						timestamp: "2026-07-04T00:00:00.000Z",
					};
				}
				return {
					success: true,
					stdout: `${branch}\n`,
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command.startsWith("git fetch --no-tags")) {
				if (state.fetchFails) {
					return {
						success: false,
						stdout: "",
						stderr: state.fetchError ?? "fetch failed token-abc-12345",
						exitCode: 1,
						command,
						duration: 1,
						timestamp: "2026-07-04T00:00:00.000Z",
					};
				}
				return {
					success: true,
					stdout: "",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command === "git rev-parse HEAD") {
				return {
					success: true,
					stdout: `${currentHeadSha}\n`,
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command.startsWith("git rev-parse ")) {
				return {
					success: true,
					stdout: `${remoteSha}\n`,
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (
				command.includes("merge-base --is-ancestor") &&
				command.includes("refs/remotes/origin/") &&
				command.endsWith("HEAD")
			) {
				const remoteIsAncestor = state.remoteAhead ?? false;
				return {
					success: remoteIsAncestor,
					stdout: "",
					stderr: "",
					exitCode: remoteIsAncestor ? 0 : 1,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (
				command.includes("merge-base --is-ancestor HEAD") &&
				command.includes("refs/remotes/origin/")
			) {
				const headIsAncestor = state.headBehind ?? currentHeadSha !== remoteSha;
				return {
					success: headIsAncestor,
					stdout: "",
					stderr: "",
					exitCode: headIsAncestor ? 0 : 1,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command.startsWith("git merge --ff-only")) {
				currentHeadSha = remoteSha;
				return {
					success: true,
					stdout: "",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (INSTALL_COMMAND_RE.test(command)) {
				installCalls.count += 1;
				if (state.installFails) {
					return {
						success: false,
						stdout: "",
						stderr: "install failed",
						exitCode: 1,
						command,
						duration: 1,
						timestamp: "2026-07-04T00:00:00.000Z",
					};
				}
				return {
					success: true,
					stdout: "",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command === "command -v 'pnpm'") {
				return {
					success: true,
					stdout: "/usr/bin/pnpm\n",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command.startsWith("git remote get-url origin")) {
				return {
					success: true,
					stdout:
						"https://x-access-token:token-abc-12345@github.com/owner/repo.git\n",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command.startsWith("git remote set-url origin")) {
				return {
					success: true,
					stdout: "",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			if (command.includes(RETRY_SIGNAL_PATH)) {
				return {
					success: true,
					stdout: "",
					stderr: "",
					exitCode: 0,
					command,
					duration: 1,
					timestamp: "2026-07-04T00:00:00.000Z",
				};
			}
			return {
				success: true,
				stdout: "",
				stderr: "",
				exitCode: 0,
				command,
				duration: 1,
				timestamp: "2026-07-04T00:00:00.000Z",
			};
		}),
	};

	return { sandbox, installCalls, state };
}

describe("syncPrimaryWorkspaceFromGitHub", () => {
	const syncOptions = {
		env: { Sandbox: {} } as unknown as Env,
		sandboxId: "sandbox-1",
		githubRepo: "owner/repo",
		installationId: 42,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		getInstallationAccessTokenMock.mockResolvedValue("token-abc-12345");
	});

	it("fetches unchanged clean branch, skips install, scrubs origin", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "same123",
			remoteSha: "same123",
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).resolves.toEqual({
			branchName: "main",
			headSha: "same123",
			updated: false,
		});

		expect(getInstallationAccessTokenMock).toHaveBeenCalledWith(
			expect.objectContaining({ Sandbox: {} }),
			42,
			{ repositories: ["repo"] },
		);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git fetch --no-tags"),
			),
		).toBe(true);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				INSTALL_COMMAND_RE.test(String(call[0])),
			),
		).toBe(false);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git remote set-url origin"),
			),
		).toBe(true);
	});

	it("fast-forwards behind branch and installs dependencies once", async () => {
		const { sandbox, installCalls } = makeSyncSandbox({
			headSha: "oldsha",
			remoteSha: "newsha",
			headBehind: true,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).resolves.toEqual({
			branchName: "main",
			headSha: "newsha",
			updated: true,
		});

		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git merge --ff-only"),
			),
		).toBe(true);
		expect(installCalls.count).toBe(1);
	});

	it("rejects tracked changes before token mint or fetch", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "same123",
			remoteSha: "same123",
			trackedStatus: " M README.md\n",
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).rejects.toThrow(
			/uncommitted changes to tracked files/,
		);
		expect(getInstallationAccessTokenMock).not.toHaveBeenCalled();
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git fetch"),
			),
		).toBe(false);
	});

	it("allows untracked .ditto state without rejecting", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "same123",
			remoteSha: "same123",
			trackedStatus: "",
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			syncPrimaryWorkspaceFromGitHub(syncOptions),
		).resolves.toMatchObject({ updated: false });
	});

	it("rejects locally ahead branch without merge or reset", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "localsha",
			remoteSha: "remotesha",
			remoteAhead: true,
			headBehind: false,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).rejects.toThrow(
			/unpublished local commits/,
		);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git merge --ff-only"),
			),
		).toBe(false);
	});

	it("rejects diverged branch without merge, rebase, or reset", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "localsha",
			remoteSha: "remotesha",
			remoteAhead: false,
			headBehind: false,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).rejects.toThrow(
			/diverged from GitHub/,
		);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git merge --ff-only"),
			),
		).toBe(false);
	});

	it("redacts fetch token from errors and still scrubs origin", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "same123",
			remoteSha: "same123",
			fetchFails: true,
			fetchError: "auth failed for token-abc-12345",
		});
		getSandboxMock.mockReturnValue(sandbox);

		let thrownMessage = "";
		try {
			await syncPrimaryWorkspaceFromGitHub(syncOptions);
		} catch (error) {
			thrownMessage = error instanceof Error ? error.message : String(error);
		}
		expect(thrownMessage).toContain("[REDACTED]");
		expect(thrownMessage).not.toContain("token-abc-12345");
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git remote set-url origin"),
			),
		).toBe(true);
	});

	it("retries dependency install when retry signal exists at equal HEAD", async () => {
		const { sandbox, installCalls } = makeSyncSandbox({
			headSha: "same123",
			remoteSha: "same123",
			retrySignal: true,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(
			syncPrimaryWorkspaceFromGitHub(syncOptions),
		).resolves.toMatchObject({ updated: false });
		expect(installCalls.count).toBe(1);
		expect(
			sandbox.exec.mock.calls.some(
				(call) =>
					String(call[0]).includes("rm -f") &&
					String(call[0]).includes(RETRY_SIGNAL_PATH),
			),
		).toBe(true);
	});

	it("leaves retry signal when install fails after fast-forward", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "oldsha",
			remoteSha: "newsha",
			headBehind: true,
			installFails: true,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).rejects.toThrow(
			/install failed/,
		);
		expect(
			sandbox.exec.mock.calls.some(
				(call) =>
					String(call[0]).includes("touch") &&
					String(call[0]).includes(RETRY_SIGNAL_PATH),
			),
		).toBe(true);
	});

	it("rejects detached HEAD before fetch", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "detached",
			remoteSha: "detached",
			detached: true,
		});
		getSandboxMock.mockReturnValue(sandbox);

		await expect(syncPrimaryWorkspaceFromGitHub(syncOptions)).rejects.toThrow(
			/detached HEAD/,
		);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git fetch"),
			),
		).toBe(false);
	});
});

describe("fetchPrimaryBranchFromGitHub", () => {
	it("fetches the requested branch without changing the primary checkout", async () => {
		const { sandbox } = makeSyncSandbox({
			headSha: "old-main",
			remoteSha: "develop-sha",
		});
		getSandboxMock.mockReturnValue(sandbox);
		getInstallationAccessTokenMock.mockResolvedValue("token-abc-12345");

		await expect(
			fetchPrimaryBranchFromGitHub({
				env: { Sandbox: {} } as unknown as Env,
				sandboxId: "sandbox-1",
				githubRepo: "owner/repo",
				installationId: 42,
				branchName: "develop",
			}),
		).resolves.toEqual({ branchName: "develop", headSha: "develop-sha" });

		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).includes(
					"+refs/heads/develop:refs/remotes/origin/develop",
				),
			),
		).toBe(true);
		expect(
			sandbox.exec.mock.calls.some((call) =>
				String(call[0]).startsWith("git merge"),
			),
		).toBe(false);
	});
});
