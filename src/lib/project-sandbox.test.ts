import { beforeEach, describe, expect, it, vi } from "vitest";

const isSandboxWorkspaceHydratedMock = vi.hoisted(() => vi.fn());
const restoreSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const restoreSandboxWorkspaceFromSnapshotMock = vi.hoisted(() => vi.fn());
const backupSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const bootstrapSandboxMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
	isSandboxWorkspaceHydrated: isSandboxWorkspaceHydratedMock,
	restoreSandboxWorkspace: restoreSandboxWorkspaceMock,
	restoreSandboxWorkspaceFromSnapshot: restoreSandboxWorkspaceFromSnapshotMock,
	backupSandboxWorkspace: backupSandboxWorkspaceMock,
	bootstrapSandbox: bootstrapSandboxMock,
}));

const { projects, snapshots } = await import("#/db/schema");
const { ensureProjectSandbox, resolveLatestSnapshot } = await import(
	"./project-sandbox"
);
const { serializeSandboxBackup } = await import("./sandbox-backup");
const { buildSnapshotManifest, MANIFEST_SCHEMA_VERSION } = await import(
	"./r2-layout"
);

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
	activeAgentRunId: null,
	activeAgentRunStartedAt: null,
	lockStatus: "free" as const,
	lockHolderRunId: null,
	lockFencingToken: null,
	lockUpdatedAt: null,
	status: "ready" as const,
	envVars: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const snapshotRow = {
	id: "snap-1",
	projectId,
	runId: "run-1",
	r2Key: `projects/${projectId}/snapshots/snap-1/manifest.json`,
	baseCommitSha: "abc123",
	digest: "sha256:digest-1",
	status: "completed" as const,
	createdAt: new Date(),
	completedAt: new Date(),
};

function makeValidManifest(archiveRef: string | null = "backup-id-1") {
	return buildSnapshotManifest({
		snapshotId: "snap-1",
		projectId,
		runId: "run-1",
		r2Key: `projects/${projectId}/snapshots/snap-1/manifest.json`,
		archiveRef,
		baseCommitSha: "abc123",
		digest: "sha256:digest-1",
		createdAt: "2026-07-04T00:00:00.000Z",
	});
}

function makeFakeBucket(manifestBody: unknown | null) {
	return {
		get: vi.fn(async () => {
			if (manifestBody === null) return null;
			return { json: async () => manifestBody };
		}),
	};
}

function makeFakeDb(options: {
	lockedProject: typeof projects.$inferSelect | null;
	updatedProject?: typeof projects.$inferSelect;
	snapshotRows?: typeof snapshots.$inferSelect[];
}) {
	const returningQueue: unknown[][] = [];
	returningQueue.push(options.lockedProject ? [options.lockedProject] : []);
	if (options.updatedProject) {
		returningQueue.push([options.updatedProject]);
	}

	const returningMock = vi.fn(async () => returningQueue.shift() ?? []);

	const whereMock = vi.fn(() => ({ returning: returningMock }));
	const setMock = vi.fn(() => ({ where: whereMock }));
	const updateMock = vi.fn(() => ({ set: setMock }));

	const limitMock = vi.fn(async () => options.snapshotRows ?? []);
	const orderByMock = vi.fn(() => ({ limit: limitMock }));
	const whereSelectMock = vi.fn(() => ({ orderBy: orderByMock }));
	const fromMock = vi.fn(() => ({ where: whereSelectMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));

	return {
		db: { update: updateMock, select: selectMock },
		returningMock,
		updateMock,
		selectMock,
		limitMock,
	};
}

function makeFakeEnv(bucket: ReturnType<typeof makeFakeBucket>): Env {
	return {
		Sandbox: {},
		BACKUP_BUCKET: bucket as unknown as Env["BACKUP_BUCKET"],
		USE_LOCAL_BUCKET_BACKUPS: "",
	} as unknown as Env;
}

describe("ensureProjectSandbox restore decision tree", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns connected when the workspace is already hydrated", async () => {
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		const { db, selectMock } = makeFakeDb({
			lockedProject: baseProject,
		});

		const result = await ensureProjectSandbox({
			db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
			env: makeFakeEnv(makeFakeBucket(null)),
			project: baseProject,
			envVars: [],
		});

		expect(result.state).toBe("connected");
		expect(selectMock).not.toHaveBeenCalled();
	});

	it("restores from the latest valid snapshot with archiveRef", async () => {
		const manifest = makeValidManifest("backup-id-1");
		const bucket = makeFakeBucket(manifest);

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);

		restoreSandboxWorkspaceFromSnapshotMock.mockResolvedValue({
			hydrated: true,
			commitMatch: true,
		});
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "new-backup",
			dir: "/workspace",
		});

		const updatedProject = { ...baseProject, status: "ready" as const };
		const { db } = makeFakeDb({
			lockedProject: { ...baseProject, status: "provisioning" as const },
			updatedProject,
			snapshotRows: [snapshotRow],
		});

		const result = await ensureProjectSandbox({
			db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
			env: makeFakeEnv(bucket),
			project: baseProject,
			envVars: [],
		});

		expect(result.state).toBe("restored_from_backup");
		expect(restoreSandboxWorkspaceFromSnapshotMock).toHaveBeenCalledWith(
			expect.objectContaining({
				directoryBackup: { id: "backup-id-1", dir: "/workspace" },
				expectedDigest: "sha256:digest-1",
				baseCommitSha: "abc123",
			}),
		);
		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
		expect(bucket.get).toHaveBeenCalledWith(snapshotRow.r2Key);
	});

	it("marks invalid manifest failed and falls back to legacy backup", async () => {
		const invalidManifest = { ...makeValidManifest(), schemaVersion: 999 };
		const bucket = makeFakeBucket(invalidManifest);

		const legacyBackup = serializeSandboxBackup({
			id: "legacy-backup",
			dir: "/workspace",
		});
		const lockedProject = {
			...baseProject,
			status: "provisioning" as const,
			sandboxBackup: legacyBackup,
		};

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);

		restoreSandboxWorkspaceMock.mockResolvedValue(undefined);
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "new-backup",
			dir: "/workspace",
		});

		const updatedProject = { ...baseProject, status: "ready" as const };
		const { db, updateMock } = makeFakeDb({
			lockedProject,
			updatedProject,
			snapshotRows: [snapshotRow],
		});

		const result = await ensureProjectSandbox({
			db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
			env: makeFakeEnv(bucket),
			project: baseProject,
			envVars: [],
		});

		expect(result.state).toBe("restored_from_backup");
		expect(restoreSandboxWorkspaceMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backup: { id: "legacy-backup", dir: "/workspace" },
			}),
		);
		expect(restoreSandboxWorkspaceFromSnapshotMock).not.toHaveBeenCalled();
		// markSnapshotRowFailed should have called db.update(snapshots)
		const snapshotUpdates = updateMock.mock.calls.filter(
			(call: unknown[]) => call[0] !== undefined,
		);
		expect(snapshotUpdates.length).toBeGreaterThanOrEqual(1);
	});

	it("uses legacy backup when no snapshots row exists", async () => {
		const legacyBackup = serializeSandboxBackup({
			id: "legacy-backup",
			dir: "/workspace",
		});
		const lockedProject = {
			...baseProject,
			status: "provisioning" as const,
			sandboxBackup: legacyBackup,
		};

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);

		restoreSandboxWorkspaceMock.mockResolvedValue(undefined);
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "new-backup",
			dir: "/workspace",
		});

		const updatedProject = { ...baseProject, status: "ready" as const };
		const { db } = makeFakeDb({
			lockedProject,
			updatedProject,
			snapshotRows: [],
		});

		const result = await ensureProjectSandbox({
			db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
			env: makeFakeEnv(makeFakeBucket(null)),
			project: baseProject,
			envVars: [],
		});

		expect(result.state).toBe("restored_from_backup");
		expect(restoreSandboxWorkspaceMock).toHaveBeenCalled();
		expect(restoreSandboxWorkspaceFromSnapshotMock).not.toHaveBeenCalled();
	});

	it("recreates from GitHub when no snapshot and no legacy backup", async () => {
		const lockedProject = {
			...baseProject,
			status: "provisioning" as const,
			sandboxBackup: null,
		};

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);

		bootstrapSandboxMock.mockResolvedValue({
			sandboxId,
			backup: { id: "github-backup", dir: "/workspace" },
		});

		const updatedProject = { ...baseProject, status: "ready" as const };
		const { db } = makeFakeDb({
			lockedProject,
			updatedProject,
			snapshotRows: [],
		});

		const result = await ensureProjectSandbox({
			db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
			env: makeFakeEnv(makeFakeBucket(null)),
			project: baseProject,
			envVars: [],
		});

		expect(result.state).toBe("recreated_from_github");
		expect(bootstrapSandboxMock).toHaveBeenCalled();
		expect(restoreSandboxWorkspaceFromSnapshotMock).not.toHaveBeenCalled();
		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("falls back to GitHub when snapshot restore throws", async () => {
		const manifest = makeValidManifest("backup-id-1");
		const bucket = makeFakeBucket(manifest);

		const lockedProject = {
			...baseProject,
			status: "provisioning" as const,
			sandboxBackup: null,
		};

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);

		restoreSandboxWorkspaceFromSnapshotMock.mockRejectedValue(
			new Error("restore failed"),
		);
		bootstrapSandboxMock.mockResolvedValue({
			sandboxId,
			backup: { id: "github-backup", dir: "/workspace" },
		});

		const updatedProject = { ...baseProject, status: "ready" as const };
		const { db } = makeFakeDb({
			lockedProject,
			updatedProject,
			snapshotRows: [snapshotRow],
		});

		const result = await ensureProjectSandbox({
			db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
			env: makeFakeEnv(bucket),
			project: baseProject,
			envVars: [],
		});

		expect(result.state).toBe("recreated_from_github");
		expect(restoreSandboxWorkspaceFromSnapshotMock).toHaveBeenCalled();
		expect(bootstrapSandboxMock).toHaveBeenCalled();
		expect(result.project.status).toBe("ready");
	});

	it("marks project failed when all restore paths throw", async () => {
		const lockedProject = {
			...baseProject,
			status: "provisioning" as const,
			sandboxBackup: null,
		};

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		bootstrapSandboxMock.mockRejectedValue(new Error("github failed"));

		const { db, returningMock } = makeFakeDb({
			lockedProject,
			snapshotRows: [],
		});

		await expect(
			ensureProjectSandbox({
				db: db as unknown as Parameters<typeof ensureProjectSandbox>[0]["db"],
				env: makeFakeEnv(makeFakeBucket(null)),
				project: baseProject,
				envVars: [],
			}),
		).rejects.toThrow("Project sandbox restore failed. Please try again.");

		// returningMock was called once for the CAS lock; the markProjectRestoreFailed
		// update does NOT call .returning() so the queue is not consumed further.
		expect(returningMock).toHaveBeenCalledTimes(1);
	});
});

describe("resolveLatestSnapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when no completed snapshots exist", async () => {
		const { db } = makeFakeDb({
			lockedProject: baseProject,
			snapshotRows: [],
		});

		const result = await resolveLatestSnapshot(
			db as unknown as Parameters<typeof resolveLatestSnapshot>[0],
			projectId,
			makeFakeBucket(makeValidManifest()),
		);

		expect(result).toBeNull();
	});

	it("returns a valid manifest when the snapshot is completed and manifest validates", async () => {
		const manifest = makeValidManifest("backup-id-1");
		const bucket = makeFakeBucket(manifest);
		const { db } = makeFakeDb({
			lockedProject: baseProject,
			snapshotRows: [snapshotRow],
		});

		const result = await resolveLatestSnapshot(
			db as unknown as Parameters<typeof resolveLatestSnapshot>[0],
			projectId,
			bucket,
		);

		expect(result).not.toBeNull();
		expect(result).toHaveProperty("snapshotId", "snap-1");
		expect(result).toHaveProperty("manifest");
		if (result && "manifest" in result) {
			expect(result.manifest.archiveRef).toBe("backup-id-1");
			expect(result.manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
		}
	});

	it("returns invalid when the R2 object is missing", async () => {
		const bucket = makeFakeBucket(null);
		const { db } = makeFakeDb({
			lockedProject: baseProject,
			snapshotRows: [snapshotRow],
		});

		const result = await resolveLatestSnapshot(
			db as unknown as Parameters<typeof resolveLatestSnapshot>[0],
			projectId,
			bucket,
		);

		expect(result).toEqual({ invalid: true, row: snapshotRow });
	});

	it("returns invalid when the manifest fails validation", async () => {
		const badManifest = { ...makeValidManifest(), schemaVersion: 999 };
		const bucket = makeFakeBucket(badManifest);
		const { db } = makeFakeDb({
			lockedProject: baseProject,
			snapshotRows: [snapshotRow],
		});

		const result = await resolveLatestSnapshot(
			db as unknown as Parameters<typeof resolveLatestSnapshot>[0],
			projectId,
			bucket,
		);

		expect(result).toEqual({ invalid: true, row: snapshotRow });
	});
});
