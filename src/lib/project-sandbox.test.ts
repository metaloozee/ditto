import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeSandboxBackup } from "./sandbox-backup";

const isSandboxWorkspaceHydratedMock = vi.hoisted(() => vi.fn());
const restoreSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const backupSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const bootstrapSandboxMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-bootstrap", () => ({
	isSandboxWorkspaceHydrated: isSandboxWorkspaceHydratedMock,
	restoreSandboxWorkspace: restoreSandboxWorkspaceMock,
	backupSandboxWorkspace: backupSandboxWorkspaceMock,
	bootstrapSandbox: bootstrapSandboxMock,
}));

const { ensureProjectSandbox } = await import("./project-sandbox");
const { projects } = await import("#/db/schema");

const projectId = "project-1";
const sandboxId = "sandbox-1";

const baseProject = {
	id: projectId,
	name: "Test Project",
	description: null,
	userId: "user-1",
	githubRepo: "owner/repo",
	githubInstallationId: 123,
	sandboxId,
	sandboxBackup: null,
	sandboxBackupCreatedAt: null,
	status: "ready" as const,
	envVars: null,
	createdAt: new Date("2026-07-04T00:00:00.000Z"),
	updatedAt: new Date("2026-07-04T00:00:00.000Z"),
};

function makeFakeDb(options: {
	lockedProject: typeof projects.$inferSelect | null;
	updatedProject?: typeof projects.$inferSelect;
}) {
	const returningQueue: unknown[][] = [];
	returningQueue.push(options.lockedProject ? [options.lockedProject] : []);
	if (options.updatedProject) {
		returningQueue.push([options.updatedProject]);
	}

	const setCalls: unknown[] = [];
	const returningMock = vi.fn(async () => returningQueue.shift() ?? []);
	const whereMock = vi.fn(() => ({ returning: returningMock }));
	const setMock = vi.fn((values: unknown) => {
		setCalls.push(values);
		return { where: whereMock };
	});
	const updateMock = vi.fn(() => ({ set: setMock }));

	return {
		db: { update: updateMock },
		setCalls,
		returningMock,
		updateMock,
	};
}

function makeEnv() {
	return {
		Sandbox: {},
		USE_LOCAL_BUCKET_BACKUPS: "true",
	} as unknown as Env;
}

describe("ensureProjectSandbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns connected when the workspace is already hydrated", async () => {
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });

		await expect(
			ensureProjectSandbox({
				db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
				envVars: [],
			}),
		).resolves.toMatchObject({ state: "connected", project: baseProject });

		expect(updateMock).not.toHaveBeenCalled();
	});

	it("restores from backup, re-backs up, and returns restored_from_backup", async () => {
		const storedBackup = serializeSandboxBackup({
			id: "backup-1",
			dir: "/workspace",
		});
		const lockedProject = {
			...baseProject,
			sandboxBackup: storedBackup,
			status: "provisioning" as const,
		};
		const updatedProject = {
			...baseProject,
			sandboxBackup: serializeSandboxBackup({
				id: "backup-2",
				dir: "/workspace",
			}),
			status: "ready" as const,
		};
		const { db, setCalls } = makeFakeDb({ lockedProject, updatedProject });

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);
		restoreSandboxWorkspaceMock.mockResolvedValue(undefined);
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-2",
			dir: "/workspace",
		});

		await expect(
			ensureProjectSandbox({
				db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
				envVars: [{ key: "KEY", value: "value" }],
			}),
		).resolves.toMatchObject({
			state: "restored_from_backup",
			project: updatedProject,
		});

		expect(restoreSandboxWorkspaceMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId,
			backup: { id: "backup-1", dir: "/workspace" },
			envVars: [{ key: "KEY", value: "value" }],
		});
		expect(backupSandboxWorkspaceMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId,
			projectId,
		});
		expect(setCalls[0]).toMatchObject({ status: "provisioning" });
		expect(setCalls[1]).toMatchObject({
			status: "ready",
			sandboxBackup: serializeSandboxBackup({
				id: "backup-2",
				dir: "/workspace",
			}),
		});
	});

	it("falls back to GitHub when restore from backup fails", async () => {
		const lockedProject = {
			...baseProject,
			sandboxBackup: serializeSandboxBackup({
				id: "backup-1",
				dir: "/workspace",
			}),
			status: "provisioning" as const,
		};
		const updatedProject = {
			...baseProject,
			status: "ready" as const,
		};
		const { db } = makeFakeDb({ lockedProject, updatedProject });

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);
		restoreSandboxWorkspaceMock.mockRejectedValue(new Error("restore failed"));
		bootstrapSandboxMock.mockResolvedValue({
			sandboxId,
			backup: { id: "github-backup", dir: "/workspace" },
		});
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "github-backup",
			dir: "/workspace",
		});

		await expect(
			ensureProjectSandbox({
				db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
				envVars: [],
			}),
		).resolves.toMatchObject({ state: "recreated_from_github" });

		expect(bootstrapSandboxMock).toHaveBeenCalled();
		expect(restoreSandboxWorkspaceMock).toHaveBeenCalled();
	});

	it("recreates from GitHub when there is no stored backup", async () => {
		const lockedProject = {
			...baseProject,
			sandboxBackup: null,
			status: "provisioning" as const,
		};
		const updatedProject = {
			...baseProject,
			status: "ready" as const,
		};
		const { db } = makeFakeDb({ lockedProject, updatedProject });

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);
		bootstrapSandboxMock.mockResolvedValue({
			sandboxId,
			backup: { id: "github-backup", dir: "/workspace" },
		});
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "github-backup",
			dir: "/workspace",
		});

		await expect(
			ensureProjectSandbox({
				db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
				envVars: [],
			}),
		).resolves.toMatchObject({ state: "recreated_from_github" });

		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
		expect(bootstrapSandboxMock).toHaveBeenCalled();
	});

	it("marks the project failed when all restore paths throw", async () => {
		const lockedProject = {
			...baseProject,
			sandboxBackup: null,
			status: "provisioning" as const,
		};
		const { db, setCalls } = makeFakeDb({ lockedProject });

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		bootstrapSandboxMock.mockRejectedValue(new Error("github failed"));

		await expect(
			ensureProjectSandbox({
				db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
				envVars: [],
			}),
		).rejects.toThrow("Project sandbox restore failed. Please try again.");

		expect(setCalls.at(-1)).toMatchObject({ status: "failed" });
	});
});
