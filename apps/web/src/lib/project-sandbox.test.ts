import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeSandboxBackup } from "./sandbox-backup";

const isSandboxWorkspaceHydratedMock = vi.hoisted(() => vi.fn());
const restoreSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const backupSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const bootstrapSandboxMock = vi.hoisted(() => vi.fn());
const isSandboxRunnerHealthyMock = vi.hoisted(() => vi.fn());
const getProjectSandboxStateMock = vi.hoisted(() => vi.fn());
const deleteArchiveMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/sandbox-archive", () => ({
	deleteArchive: deleteArchiveMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	isSandboxWorkspaceHydrated: isSandboxWorkspaceHydratedMock,
	restoreSandboxWorkspace: restoreSandboxWorkspaceMock,
	backupSandboxWorkspace: backupSandboxWorkspaceMock,
	bootstrapSandbox: bootstrapSandboxMock,
	isSandboxRunnerHealthy: isSandboxRunnerHealthyMock,
	getProjectSandboxState: getProjectSandboxStateMock,
}));

const {
	checkProjectSandbox,
	provisionProjectSandbox,
	persistProjectSandboxBackup,
} = await import("./project-sandbox");
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
	previewLockToken: null,
	previewLockExpiresAt: null,
	deletingAt: null,
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
						if (state.project.status !== "provisioning") {
							return [];
						}
						state.project = {
							...state.project,
							status: "failed",
							updatedAt: new Date(),
						};
						return [state.project];
					}

					// storeReadyProjectBackup — only while still provisioning
					if (set.sandboxBackup !== undefined) {
						if (state.project.status !== "provisioning") {
							return [];
						}
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
		setStatus(status: ProjectRow["status"]) {
			state.project = { ...state.project, status };
		},
	};
}

/** Queue-based fake used by check/provision tests. */
function makeFakeDb(options: {
	lockedProject: ProjectRow | null;
	updatedProject?: ProjectRow;
	/** When true, failed-write returns empty (stale fence). */
	rejectFailedWrite?: boolean;
	/** When true, ready-store returns empty (stale fence). */
	rejectReadyStore?: boolean;
}) {
	const returningQueue: unknown[][] = [];
	returningQueue.push(options.lockedProject ? [options.lockedProject] : []);
	if (options.updatedProject) {
		returningQueue.push([options.updatedProject]);
	}

	const setCalls: unknown[] = [];
	const returningMock = vi.fn(async () => {
		const next = returningQueue.shift();
		if (next !== undefined) return next;
		// Default behavior for unexpected extra writes
		return [];
	});
	const whereMock = vi.fn(() => ({ returning: returningMock }));
	const setMock = vi.fn((values: Record<string, unknown>) => {
		setCalls.push(values);
		if (values.status === "failed" && options.rejectFailedWrite) {
			return {
				where: vi.fn(() => ({
					returning: vi.fn(async () => []),
				})),
			};
		}
		if (
			values.sandboxBackup !== undefined &&
			values.status === "ready" &&
			options.rejectReadyStore
		) {
			return {
				where: vi.fn(() => ({
					returning: vi.fn(async () => []),
				})),
			};
		}
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

function callOrder(...spies: Array<ReturnType<typeof vi.fn>>) {
	return spies
		.map((spy, index) => ({
			index,
			order: spy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		}))
		.sort((a, b) => a.order - b.order)
		.map((entry) => entry.index);
}

describe("persistProjectSandboxBackup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a backup and stores the handle with stored generation", async () => {
		const { db, getState } = makeVersionedDb();

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "bak-1",
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
			userId: "user-1",
			generation: 1,
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

		const gen1Backup = deferred<{ id: string }>();
		const gen2Backup = deferred<{ id: string }>();
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
		gen2Backup.resolve({ id: "bak-gen2" });
		const r2 = await p2;
		expect(r2.stored).toBe(true);
		expect(r2.candidateGeneration).toBe(2);
		expect(getState().sandboxBackup).toContain("bak-gen2");
		expect(getState().sandboxBackupStoredGeneration).toBe(2);

		// Resolve gen1 later — must not replace.
		gen1Backup.resolve({ id: "bak-gen1" });
		const r1 = await p1;
		expect(r1.stored).toBe(false);
		expect(r1.candidateGeneration).toBe(1);
		expect(getState().sandboxBackup).toContain("bak-gen2");
		expect(getState().sandboxBackupStoredGeneration).toBe(2);
		expect(deleteArchiveMock).toHaveBeenCalledWith(
			persistOpts.env,
			persistOpts.db,
			"bak-gen1",
		);
		expect(deleteArchiveMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"bak-gen2",
		);
	});

	it("allows an older candidate to store when a newer candidate fails", async () => {
		const { db, getState } = makeVersionedDb();

		const gen1Backup = deferred<{ id: string }>();
		const gen2Backup = deferred<{ id: string }>();
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
		gen1Backup.resolve({ id: "bak-gen1" });
		const r1 = await p1;
		expect(r1.stored).toBe(true);
		expect(r1.candidateGeneration).toBe(1);
		expect(getState().sandboxBackup).toContain("bak-gen1");
		expect(getState().sandboxBackupStoredGeneration).toBe(1);
	});
});

describe("checkProjectSandbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isSandboxRunnerHealthyMock.mockResolvedValue(true);
		getProjectSandboxStateMock.mockResolvedValue({ status: "healthy" });
	});

	it("returns connected when healthy, hydrated, and runner is healthy", async () => {
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "connected", project: baseProject });

		expect(
			callOrder(getProjectSandboxStateMock, isSandboxWorkspaceHydratedMock)[0],
		).toBe(0);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("returns connected when running, hydrated, and runner is healthy", async () => {
		getProjectSandboxStateMock.mockResolvedValue({ status: "running" });
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "connected", project: baseProject });

		expect(updateMock).not.toHaveBeenCalled();
	});

	it.each([
		"stopping",
		"stopped",
		"stopped_with_code",
	] as const)("returns needs_restore for %s without D1 writes", async (status) => {
		getProjectSandboxStateMock.mockResolvedValue({ status });
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "needs_restore", project: baseProject });

		expect(updateMock).not.toHaveBeenCalled();
		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
		expect(bootstrapSandboxMock).not.toHaveBeenCalled();
		expect(isSandboxWorkspaceHydratedMock).not.toHaveBeenCalled();
	});

	it("returns needs_restore when active, runner healthy, and unhydrated", async () => {
		isSandboxWorkspaceHydratedMock.mockResolvedValue(false);
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "needs_restore" });

		expect(updateMock).not.toHaveBeenCalled();
		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("observes runtime before hydration/runner probes on active containers", async () => {
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		const { db } = makeFakeDb({ lockedProject: baseProject });

		await checkProjectSandbox({
			db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
			env: makeEnv(),
			project: baseProject,
		});

		expect(
			callOrder(getProjectSandboxStateMock, isSandboxWorkspaceHydratedMock)[0],
		).toBe(0);
		expect(
			callOrder(getProjectSandboxStateMock, isSandboxRunnerHealthyMock)[0],
		).toBe(0);
	});

	it("rejects an invalid runner without writing D1 even when unhydrated", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		isSandboxWorkspaceHydratedMock.mockResolvedValue(false);
		isSandboxRunnerHealthyMock.mockResolvedValue(false);

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).rejects.toThrow("Project sandbox runner image is invalid");

		expect(updateMock).not.toHaveBeenCalled();
		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("returns provisioning for D1 provisioning without getState", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		const provisioning = {
			...baseProject,
			status: "provisioning" as const,
		};

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: provisioning,
			}),
		).resolves.toMatchObject({ state: "provisioning" });

		expect(getProjectSandboxStateMock).not.toHaveBeenCalled();
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("returns failed for D1 failed without getState", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		const failed = { ...baseProject, status: "failed" as const };

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: failed,
			}),
		).resolves.toMatchObject({ state: "failed" });

		expect(getProjectSandboxStateMock).not.toHaveBeenCalled();
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("returns failed when sandboxId is missing without getState", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		const missing = { ...baseProject, sandboxId: null };

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: missing,
			}),
		).resolves.toMatchObject({ state: "failed" });

		expect(getProjectSandboxStateMock).not.toHaveBeenCalled();
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("propagates getState errors without writing D1", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		getProjectSandboxStateMock.mockRejectedValue(new Error("rpc down"));

		await expect(
			checkProjectSandbox({
				db: db as unknown as Parameters<typeof checkProjectSandbox>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).rejects.toThrow("rpc down");

		expect(updateMock).not.toHaveBeenCalled();
		expect(isSandboxWorkspaceHydratedMock).not.toHaveBeenCalled();
	});
});

describe("provisionProjectSandbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isSandboxRunnerHealthyMock.mockResolvedValue(true);
		getProjectSandboxStateMock.mockResolvedValue({ status: "healthy" });
	});

	it("returns connected when already healthy without D1 writes", async () => {
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "connected", project: baseProject });

		expect(updateMock).not.toHaveBeenCalled();
	});

	it("returns provisioning on compare-and-set loss without marking failed", async () => {
		const { db, setCalls } = makeFakeDb({ lockedProject: null });
		getProjectSandboxStateMock.mockResolvedValue({ status: "stopped" });

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "provisioning" });

		expect(setCalls).toEqual([
			expect.objectContaining({ status: "provisioning" }),
		]);
		expect(
			setCalls.some(
				(call) => (call as { status?: string }).status === "failed",
			),
		).toBe(false);
	});

	it.each([
		"stopping",
		"stopped",
		"stopped_with_code",
	] as const)("skips pre-lock probes for %s and restores from backup", async (status) => {
		getProjectSandboxStateMock.mockResolvedValue({ status });
		const storedBackup = serializeSandboxBackup("backup-1");
		const lockedProject = {
			...baseProject,
			sandboxBackup: storedBackup,
			status: "provisioning" as const,
		};
		const updatedProject = {
			...baseProject,
			sandboxBackup: serializeSandboxBackup("backup-2"),
			status: "ready" as const,
		};
		const { db, setCalls } = makeFakeDb({ lockedProject, updatedProject });

		// Only post-restore probes should run.
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		isSandboxRunnerHealthyMock.mockResolvedValue(true);
		restoreSandboxWorkspaceMock.mockResolvedValue(undefined);
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-2",
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({
			state: "restored_from_backup",
			project: updatedProject,
		});

		// Pre-lock probes must not run: only post-restore probes.
		expect(isSandboxWorkspaceHydratedMock).toHaveBeenCalledTimes(1);
		expect(isSandboxRunnerHealthyMock).toHaveBeenCalledTimes(1);
		expect(
			callOrder(restoreSandboxWorkspaceMock, isSandboxWorkspaceHydratedMock)[0],
		).toBe(0);
		expect(setCalls[0]).toMatchObject({ status: "provisioning" });
		expect(restoreSandboxWorkspaceMock).toHaveBeenCalled();
	});

	it("enters CAS restore when active, runner healthy, and unhydrated", async () => {
		const storedBackup = serializeSandboxBackup("backup-1");
		const lockedProject = {
			...baseProject,
			sandboxBackup: storedBackup,
			status: "provisioning" as const,
		};
		const updatedProject = {
			...baseProject,
			sandboxBackup: serializeSandboxBackup("backup-2"),
			status: "ready" as const,
		};
		const { db, setCalls } = makeFakeDb({ lockedProject, updatedProject });

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);
		restoreSandboxWorkspaceMock.mockResolvedValue(undefined);
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-2",
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({
			state: "restored_from_backup",
			project: updatedProject,
		});

		expect(setCalls[0]).toMatchObject({ status: "provisioning" });
	});

	it("restores from backup, re-backs up, and returns restored_from_backup", async () => {
		const storedBackup = serializeSandboxBackup("backup-1");
		const lockedProject = {
			...baseProject,
			sandboxBackup: storedBackup,
			status: "provisioning" as const,
		};
		const updatedProject = {
			...baseProject,
			sandboxBackup: serializeSandboxBackup("backup-2"),
			status: "ready" as const,
		};
		const { db, setCalls } = makeFakeDb({ lockedProject, updatedProject });

		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(false);
		isSandboxWorkspaceHydratedMock.mockResolvedValueOnce(true);
		restoreSandboxWorkspaceMock.mockResolvedValue(undefined);
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-2",
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
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
			archiveId: "backup-1",
		});
		expect(backupSandboxWorkspaceMock).toHaveBeenCalledWith({
			env: makeEnv(),
			sandboxId,
			projectId,
			userId: "user-1",
		});
		expect(setCalls[0]).toMatchObject({ status: "provisioning" });
		expect(setCalls[1]).toMatchObject({
			status: "ready",
			sandboxBackup: serializeSandboxBackup("backup-2"),
		});
	});

	it("falls back to GitHub when restore from backup fails", async () => {
		const lockedProject = {
			...baseProject,
			sandboxBackup: serializeSandboxBackup("backup-1"),
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
			backup: "github-backup",
		});
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "github-backup",
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
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
			backup: "github-backup",
		});
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "github-backup",
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).resolves.toMatchObject({ state: "recreated_from_github" });

		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
		expect(bootstrapSandboxMock).toHaveBeenCalled();
	});

	it("marks the project failed when all restore paths throw while still provisioning", async () => {
		const lockedProject = {
			...baseProject,
			sandboxBackup: null,
			status: "provisioning" as const,
		};
		const { db, setCalls } = makeFakeDb({ lockedProject });

		getProjectSandboxStateMock.mockResolvedValue({ status: "stopped" });
		bootstrapSandboxMock.mockRejectedValue(new Error("github failed"));

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).rejects.toThrow("Project sandbox restore failed. Please try again.");

		expect(setCalls.at(-1)).toMatchObject({ status: "failed" });
	});

	it("does not claim success when a stale ready completion loses the provisioning fence", async () => {
		const { db, getState, setStatus } = makeVersionedDb({
			...baseProject,
			sandboxBackup: serializeSandboxBackup("backup-1"),
		});

		getProjectSandboxStateMock.mockResolvedValue({ status: "stopped" });
		isSandboxWorkspaceHydratedMock.mockResolvedValue(true);
		isSandboxRunnerHealthyMock.mockResolvedValue(true);
		restoreSandboxWorkspaceMock.mockImplementation(async () => {
			// Another actor finished while restore was in flight.
			setStatus("ready");
		});
		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-2",
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).rejects.toThrow("Project sandbox restore failed. Please try again.");

		expect(getState().status).toBe("ready");
		expect(getState().sandboxBackup).toContain("backup-1");
	});

	it("does not overwrite a non-provisioning row when marking failed", async () => {
		const { db, getState, setStatus } = makeVersionedDb({
			...baseProject,
			sandboxBackup: null,
		});

		getProjectSandboxStateMock.mockResolvedValue({ status: "stopped" });
		bootstrapSandboxMock.mockImplementation(async () => {
			setStatus("ready");
			throw new Error("github failed");
		});

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: baseProject,
			}),
		).rejects.toThrow("Project sandbox restore failed. Please try again.");

		expect(getState().status).toBe("ready");
	});

	it("returns provisioning when D1 is already provisioning", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		const provisioning = {
			...baseProject,
			status: "provisioning" as const,
		};

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: provisioning,
			}),
		).resolves.toMatchObject({ state: "provisioning" });

		expect(updateMock).not.toHaveBeenCalled();
	});

	it("returns failed when D1 is failed without restoring", async () => {
		const { db, updateMock } = makeFakeDb({ lockedProject: baseProject });
		const failed = { ...baseProject, status: "failed" as const };

		await expect(
			provisionProjectSandbox({
				db: db as unknown as Parameters<
					typeof provisionProjectSandbox
				>[0]["db"],
				env: makeEnv(),
				project: failed,
			}),
		).resolves.toMatchObject({ state: "failed" });

		expect(updateMock).not.toHaveBeenCalled();
		expect(restoreSandboxWorkspaceMock).not.toHaveBeenCalled();
	});
});
