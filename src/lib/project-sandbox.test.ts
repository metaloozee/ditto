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

const { ensureProjectSandbox, persistProjectSandboxBackup } = await import(
	"./project-sandbox"
);
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
	sandboxBackup: null as string | null,
	sandboxBackupCreatedAt: null as Date | null,
	sandboxBackupRequestedGeneration: 0,
	sandboxBackupStoredGeneration: 0,
	status: "ready" as const,
	envVars: null,
	createdAt: new Date("2026-07-04T00:00:00.000Z"),
	updatedAt: new Date("2026-07-04T00:00:00.000Z"),
};

type ProjectRow = typeof projects.$inferSelect;

/**
 * Fake D1 state machine for versioned backup tests.
 * Tracks requested/stored generation and the stored backup handle.
 */
function makeVersionedDb(initial: ProjectRow = { ...baseProject }) {
	const state = {
		project: { ...initial } as ProjectRow,
	};

	const setCalls: unknown[] = [];
	const updateMock = vi.fn(() => {
		let pendingSet: Record<string, unknown> = {};
		const chain = {
			set(values: Record<string, unknown>) {
				pendingSet = values;
				setCalls.push(values);
				return chain;
			},
			where(_condition?: unknown) {
				return chain;
			},
			returning(fields?: Record<string, unknown>) {
				return (async () => {
					const set = pendingSet;
					// Reserve generation: increment requestedGeneration
					if (
						set.sandboxBackupRequestedGeneration !== undefined &&
						set.sandboxBackup === undefined
					) {
						state.project = {
							...state.project,
							sandboxBackupRequestedGeneration:
								state.project.sandboxBackupRequestedGeneration + 1,
							updatedAt: new Date(),
						};
						if (fields && "generation" in fields) {
							return [
								{
									generation: state.project.sandboxBackupRequestedGeneration,
									status: state.project.status,
									sandboxId: state.project.sandboxId,
								},
							];
						}
						return [state.project];
					}

					// Conditional store: only if storedGeneration < candidate
					if (
						set.sandboxBackup !== undefined &&
						typeof set.sandboxBackupStoredGeneration === "number"
					) {
						const candidate = set.sandboxBackupStoredGeneration;
						if (state.project.sandboxBackupStoredGeneration < candidate) {
							state.project = {
								...state.project,
								status: "ready",
								sandboxBackup: set.sandboxBackup as string,
								sandboxBackupCreatedAt: new Date(),
								sandboxBackupStoredGeneration: candidate,
								updatedAt: new Date(),
							};
							return [state.project];
						}
						// Superseded — empty returning
						return [];
					}

					// Provisioning lock / unconditional restore store / failed mark
					if (set.status === "provisioning") {
						if (state.project.status !== "ready") {
							return [];
						}
						state.project = {
							...state.project,
							status: "provisioning",
							updatedAt: new Date(),
						};
						return [state.project];
					}

					if (set.status === "failed") {
						state.project = {
							...state.project,
							status: "failed",
							updatedAt: new Date(),
						};
						return [state.project];
					}

					// Unconditional storeReadyProjectBackup
					if (set.sandboxBackup !== undefined) {
						state.project = {
							...state.project,
							status: (set.status as ProjectRow["status"]) ?? "ready",
							sandboxBackup: set.sandboxBackup as string,
							sandboxBackupCreatedAt: new Date(),
							updatedAt: new Date(),
						};
						return [state.project];
					}

					return [state.project];
				})();
			},
		};
		return chain;
	});

	const selectMock = vi.fn(() => {
		const chain = {
			from() {
				return chain;
			},
			where() {
				return chain;
			},
			limit() {
				return Promise.resolve([state.project]);
			},
		};
		return chain;
	});

	return {
		db: { update: updateMock, select: selectMock },
		setCalls,
		updateMock,
		getState: () => state.project,
	};
}

/** Queue-based fake used by ensureProjectSandbox tests (unchanged control flow). */
function makeFakeDb(options: {
	lockedProject: ProjectRow | null;
	updatedProject?: ProjectRow;
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("persistProjectSandboxBackup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a backup and stores the handle with stored generation", async () => {
		const { db, getState } = makeVersionedDb();

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "bak-1",
			dir: "/workspace",
		});

		const result = await persistProjectSandboxBackup({
			db: db as unknown as Parameters<
				typeof persistProjectSandboxBackup
			>[0]["db"],
			env: makeEnv(),
			project: {
				id: projectId,
				userId: "user-1",
				sandboxId,
				status: "ready",
			},
		});

		expect(backupSandboxWorkspaceMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId,
			projectId,
		});
		expect(result.stored).toBe(true);
		expect(result.candidateGeneration).toBe(1);
		expect(result.project.sandboxBackup).toContain("bak-1");
		expect(result.project.sandboxBackupStoredGeneration).toBe(1);
		expect(getState().sandboxBackupStoredGeneration).toBe(1);
		expect(getState().sandboxBackupRequestedGeneration).toBe(1);
	});

	it("throws when sandbox is not ready", async () => {
		const { db } = makeVersionedDb();

		await expect(
			persistProjectSandboxBackup({
				db: db as unknown as Parameters<
					typeof persistProjectSandboxBackup
				>[0]["db"],
				env: makeEnv(),
				project: {
					id: projectId,
					userId: "user-1",
					sandboxId: null,
					status: "ready",
				},
			}),
		).rejects.toThrow(/not ready/i);

		expect(backupSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("does not let an older candidate replace a newer stored generation", async () => {
		const { db, getState } = makeVersionedDb();

		const gen1Backup = deferred<{ id: string; dir: string }>();
		const gen2Backup = deferred<{ id: string; dir: string }>();
		let backupCall = 0;
		backupSandboxWorkspaceMock.mockImplementation(() => {
			backupCall += 1;
			return backupCall === 1 ? gen1Backup.promise : gen2Backup.promise;
		});

		const persistOpts = {
			db: db as unknown as Parameters<
				typeof persistProjectSandboxBackup
			>[0]["db"],
			env: makeEnv(),
			project: {
				id: projectId,
				userId: "user-1",
				sandboxId,
				status: "ready" as const,
			},
		};

		// Reserve gen1 then gen2 (both in flight before either backup resolves).
		const p1 = persistProjectSandboxBackup(persistOpts);
		// Allow gen1 reserve to complete and hit backup mock before gen2 starts.
		await Promise.resolve();
		const p2 = persistProjectSandboxBackup(persistOpts);
		await Promise.resolve();

		// Resolve gen2 first — should store.
		gen2Backup.resolve({ id: "bak-gen2", dir: "/workspace" });
		const r2 = await p2;
		expect(r2.stored).toBe(true);
		expect(r2.candidateGeneration).toBe(2);
		expect(getState().sandboxBackup).toContain("bak-gen2");
		expect(getState().sandboxBackupStoredGeneration).toBe(2);

		// Resolve gen1 later — must not replace.
		gen1Backup.resolve({ id: "bak-gen1", dir: "/workspace" });
		const r1 = await p1;
		expect(r1.stored).toBe(false);
		expect(r1.candidateGeneration).toBe(1);
		expect(getState().sandboxBackup).toContain("bak-gen2");
		expect(getState().sandboxBackupStoredGeneration).toBe(2);
	});

	it("allows an older candidate to store when a newer candidate fails", async () => {
		const { db, getState } = makeVersionedDb();

		const gen1Backup = deferred<{ id: string; dir: string }>();
		const gen2Backup = deferred<{ id: string; dir: string }>();
		let backupCall = 0;
		backupSandboxWorkspaceMock.mockImplementation(() => {
			backupCall += 1;
			return backupCall === 1 ? gen1Backup.promise : gen2Backup.promise;
		});

		const persistOpts = {
			db: db as unknown as Parameters<
				typeof persistProjectSandboxBackup
			>[0]["db"],
			env: makeEnv(),
			project: {
				id: projectId,
				userId: "user-1",
				sandboxId,
				status: "ready" as const,
			},
		};

		const p1 = persistProjectSandboxBackup(persistOpts);
		await Promise.resolve();
		const p2 = persistProjectSandboxBackup(persistOpts);
		await Promise.resolve();

		// gen2 fails — nothing stored yet.
		gen2Backup.reject(new Error("backup gen2 failed"));
		await expect(p2).rejects.toThrow(/backup gen2 failed/);
		expect(getState().sandboxBackupStoredGeneration).toBe(0);
		expect(getState().sandboxBackupRequestedGeneration).toBe(2);

		// gen1 succeeds and may store.
		gen1Backup.resolve({ id: "bak-gen1", dir: "/workspace" });
		const r1 = await p1;
		expect(r1.stored).toBe(true);
		expect(r1.candidateGeneration).toBe(1);
		expect(getState().sandboxBackup).toContain("bak-gen1");
		expect(getState().sandboxBackupStoredGeneration).toBe(1);
	});
});

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
			}),
		).resolves.toMatchObject({
			state: "restored_from_backup",
			project: updatedProject,
		});

		expect(restoreSandboxWorkspaceMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId,
			backup: { id: "backup-1", dir: "/workspace" },
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
			}),
		).rejects.toThrow("Project sandbox restore failed. Please try again.");

		expect(setCalls.at(-1)).toMatchObject({ status: "failed" });
	});
});
