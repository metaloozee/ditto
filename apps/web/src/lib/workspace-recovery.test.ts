import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createDb } from "#/db";

vi.mock("#/lib/workspace-runtime", () => ({
	withWorkspaceRuntimeLease: vi.fn(),
}));

vi.mock("#/lib/sandbox-archive", () => ({
	createArchive: vi.fn(),
	restoreArchive: vi.fn(),
	abandonArchive: vi.fn(),
}));

const {
	checkpoint,
	getWorkspaceRecoveryState,
	hasRecoveryArchives,
	recordMutation,
	recordMutationAndCheckpoint,
	requireDurable,
	restore,
	WorkspaceRecoveryError,
} = await import("#/lib/workspace-recovery");
type WorkspaceRuntimeLease =
	import("#/lib/workspace-runtime").WorkspaceRuntimeLease;

type Db = ReturnType<typeof createDb>;

function createRecoveryDb() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE workspace_sessions (
			id text PRIMARY KEY NOT NULL,
			projectId text NOT NULL,
			userId text NOT NULL,
			status text NOT NULL DEFAULT 'active'
		);
		CREATE TABLE archives (
			id text PRIMARY KEY NOT NULL,
			ownerKind text NOT NULL,
			ownerId text NOT NULL,
			objectKey text NOT NULL,
			formatVersion integer NOT NULL,
			compatibilityKey text NOT NULL,
			byteCount integer NOT NULL DEFAULT 0,
			digest text NOT NULL,
			generation integer NOT NULL DEFAULT 0,
			status text NOT NULL,
			cleanupRetryAt integer,
			cleanupAttempts integer NOT NULL DEFAULT 0,
			created_at integer,
			updated_at integer
		);
		CREATE TABLE workspace_session_recoveries (
			sessionId text PRIMARY KEY NOT NULL,
			mutationGeneration integer NOT NULL DEFAULT 0,
			durableGeneration integer NOT NULL DEFAULT 0,
			pendingGeneration integer,
			pendingSince integer,
			currentArchiveId text,
			previousArchiveId text,
			state text NOT NULL DEFAULT 'healthy',
			reasonCode text,
			retryAttempts integer NOT NULL DEFAULT 0,
			retryAt integer,
			checkpointLeaseId text,
			checkpointLeaseExpiresAt integer,
			created_at integer,
			updated_at integer,
			FOREIGN KEY (sessionId) REFERENCES workspace_sessions(id) ON DELETE CASCADE
		);
	`);

	sqlite
		.prepare(
			`INSERT INTO workspace_sessions (id, projectId, userId, status) VALUES (?, ?, ?, ?)`,
		)
		.run("sess-1", "proj-1", "user-1", "active");

	const db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === "run") {
			stmt.run(...(params as never[]));
			return { rows: [] };
		}
		if (method === "get") {
			const row = stmt.get(...(params as never[])) as
				| Record<string, unknown>
				| undefined;
			return {
				rows: row ? (Object.values(row) as unknown[]) : (undefined as never),
			};
		}
		const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
		return { rows: rows.map((r) => Object.values(r)) };
	}) as unknown as Db;

	return { db, sqlite };
}

function makeLease(
	overrides: Partial<WorkspaceRuntimeLease> = {},
): WorkspaceRuntimeLease {
	return {
		sessionId: "sess-1",
		purpose: "backup_restore",
		workspacePath: "/workspace",
		branchName: "ditto/session-sess-1",
		baseCommitSha: "abc123",
		sandbox: {
			exec: vi.fn(),
			readFile: vi.fn(),
			writeFile: vi.fn(),
			exists: vi.fn(),
		} as never,
		identity: {
			id: "ident-1",
			kind: "workspace_session",
			sandboxId: "sb-1",
			containerId: "c-1",
			userId: "user-1",
			projectId: "proj-1",
			workspaceSessionId: "sess-1",
			lifecycleGeneration: 1,
			state: "ready",
			retiredAt: null,
		},
		projectEnv: null,
		matchesSandboxClaim: (id) => id === "sb-1",
		...overrides,
	};
}

function makeArchiveMocks() {
	let archiveSeq = 0;
	const created: Array<{
		id: string;
		generation: number;
		ownerKind: string;
		ownerId: string;
	}> = [];
	const abandoned: string[] = [];
	const restored: string[] = [];
	const restoreImpl = vi.fn(
		async (_env: Env, _db: Db, input: { archiveId: string }) => {
			restored.push(input.archiveId);
			return {
				archive: {
					id: input.archiveId,
					formatVersion: 1,
					compatibilityKey: "ditto-workspace-archive-v1",
					byteCount: 10,
					digest: "digest",
					generation: 1,
				},
				extractedBytes: 10,
			};
		},
	);

	return {
		created,
		abandoned,
		restored,
		restoreImpl,
		archive: {
			create: vi.fn(
				async (
					_env: Env,
					_db: Db,
					input: {
						ownerKind: string;
						ownerId: string;
						generation: number;
					},
				) => {
					archiveSeq += 1;
					const id = `arch-${archiveSeq}`;
					created.push({
						id,
						generation: input.generation,
						ownerKind: input.ownerKind,
						ownerId: input.ownerId,
					});
					return {
						id,
						formatVersion: 1,
						compatibilityKey: "ditto-workspace-archive-v1",
						byteCount: 10,
						digest: `digest-${archiveSeq}`,
						generation: input.generation,
					};
				},
			),
			restore: restoreImpl,
			abandon: vi.fn(async (_db: Db, archiveId: string) => {
				abandoned.push(archiveId);
			}),
		},
	};
}

const env = {} as Env;

describe("WorkspaceRecovery", () => {
	let db: Db;
	let sqlite: DatabaseSync;

	beforeEach(() => {
		const created = createRecoveryDb();
		db = created.db;
		sqlite = created.sqlite;
	});

	it("promotes a reserved generation after successful checkpoint", async () => {
		const mocks = makeArchiveMocks();
		const recorded = await recordMutation({ db, sessionId: "sess-1" });
		expect(recorded).toMatchObject({
			mutationGeneration: 1,
			pending: true,
			shouldCheckpoint: true,
			state: "pending",
		});

		const state = await checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive },
		);
		expect(state).toMatchObject({
			state: "healthy",
			mutationGeneration: 1,
			durableGeneration: 1,
			pending: false,
		});
		expect(mocks.created[0]).toMatchObject({
			ownerKind: "workspace_recovery",
			ownerId: "sess-1",
			generation: 1,
		});
		expect(mocks.abandoned).toEqual([]);
	});

	it("concurrent recordMutation without a checkpoint lease does not lose the highest generation", async () => {
		const mocks = makeArchiveMocks();
		const [a, b] = await Promise.all([
			recordMutation({ db, sessionId: "sess-1" }),
			recordMutation({ db, sessionId: "sess-1" }),
		]);
		expect(new Set([a.mutationGeneration, b.mutationGeneration])).toEqual(
			new Set([1, 2]),
		);
		const row = sqlite
			.prepare(
				`SELECT mutationGeneration, pendingGeneration FROM workspace_session_recoveries WHERE sessionId = ?`,
			)
			.get("sess-1") as {
			mutationGeneration: number;
			pendingGeneration: number;
		};
		expect(row.mutationGeneration).toBe(2);
		expect(row.pendingGeneration).toBe(2);

		const state = await checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive },
		);
		expect(state.durableGeneration).toBe(2);
		expect(state.pending).toBe(false);
		expect(state.state).toBe("healthy");
	});

	it("marks recovery degraded when checkpoint fails without losing the mutation", async () => {
		const mocks = makeArchiveMocks();
		mocks.archive.create.mockRejectedValueOnce(new Error("R2 put failed"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await recordMutation({ db, sessionId: "sess-1" });
		const state = await checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive },
		);

		expect(state.state).toBe("degraded");
		expect(state.reasonCode).toBe("checkpoint_failed");
		expect(state.pending).toBe(true);
		expect(state.durableGeneration).toBe(0);
		expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(
			/workspace_recovery\//,
		);
		consoleError.mockRestore();
	});

	it("still checkpoints after a failed agent-style mutation reservation", async () => {
		// Documented rule: failed agent runs still checkpoint filesystem mutations.
		const mocks = makeArchiveMocks();
		await recordMutation({ db, sessionId: "sess-1" });
		const state = await checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive },
		);
		expect(state.durableGeneration).toBe(1);
		expect(state.state).toBe("healthy");
	});

	it("reserves exactly one generation per successful mutating Git-style call", async () => {
		const mocks = makeArchiveMocks();
		const first = await recordMutationAndCheckpoint(
			{
				db,
				env,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
			},
			{
				archive: mocks.archive,
				withWorkspaceRuntimeLease: async (_input, run) => run(makeLease()),
			},
		);
		const second = await recordMutationAndCheckpoint(
			{
				db,
				env,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
			},
			{
				archive: mocks.archive,
				withWorkspaceRuntimeLease: async (_input, run) => run(makeLease()),
			},
		);
		expect(first.mutationGeneration).toBe(1);
		expect(second.mutationGeneration).toBe(2);
		expect(second.durableGeneration).toBe(2);
		expect(mocks.created).toHaveLength(2);
	});

	it("rejects out-of-order promotion from concurrent checkpoints", async () => {
		const mocks = makeArchiveMocks();
		await recordMutation({ db, sessionId: "sess-1" });

		mocks.archive.create.mockImplementationOnce(async (_env, _db, input) => {
			// A newer checkpoint lands before this candidate promotes.
			sqlite
				.prepare(
					`UPDATE workspace_session_recoveries
					 SET durableGeneration = 2, currentArchiveId = 'arch-newer',
					     previousArchiveId = 'arch-mid', state = 'healthy',
					     pendingGeneration = NULL, pendingSince = NULL
					 WHERE sessionId = ?`,
				)
				.run("sess-1");
			return {
				id: "arch-stale",
				formatVersion: 1,
				compatibilityKey: "ditto-workspace-archive-v1",
				byteCount: 10,
				digest: "stale",
				generation: input.generation,
			};
		});

		const state = await checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive },
		);
		expect(state.durableGeneration).toBe(2);
		const row = sqlite
			.prepare(
				`SELECT currentArchiveId, durableGeneration FROM workspace_session_recoveries WHERE sessionId = ?`,
			)
			.get("sess-1") as {
			currentArchiveId: string;
			durableGeneration: number;
		};
		expect(row.currentArchiveId).toBe("arch-newer");
		expect(mocks.abandoned).toContain("arch-stale");
	});

	it("coalesces later mutations into a running checkpoint without losing the highest generation", async () => {
		const mocks = makeArchiveMocks();
		const deferred: { resolve: () => void } = { resolve: () => {} };
		const createGate = new Promise<void>((resolve) => {
			deferred.resolve = resolve;
		});
		mocks.archive.create.mockImplementationOnce(async (_env, _db, input) => {
			await createGate;
			return {
				id: "arch-1",
				formatVersion: 1,
				compatibilityKey: "ditto-workspace-archive-v1",
				byteCount: 10,
				digest: "d1",
				generation: input.generation,
			};
		});

		await recordMutation({ db, sessionId: "sess-1" });
		const firstCheckpoint = checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive, createId: () => "lease-1" },
		);

		// Wait until checkpoint lease is held.
		await vi.waitFor(() => {
			const row = sqlite
				.prepare(
					`SELECT checkpointLeaseId FROM workspace_session_recoveries WHERE sessionId = ?`,
				)
				.get("sess-1") as { checkpointLeaseId: string | null };
			expect(row.checkpointLeaseId).toBe("lease-1");
		});

		const coalesced = await recordMutation({ db, sessionId: "sess-1" });
		expect(coalesced.shouldCheckpoint).toBe(false);
		expect(coalesced.mutationGeneration).toBe(2);
		expect(coalesced.pending).toBe(true);

		deferred.resolve();
		const done = await firstCheckpoint;
		expect(done.mutationGeneration).toBe(2);
		expect(done.durableGeneration).toBe(2);
		expect(done.state).toBe("healthy");
		expect(mocks.archive.create).toHaveBeenCalledTimes(2);
	});

	it("falls back to the previous archive when current restore fails", async () => {
		const mocks = makeArchiveMocks();
		await recordMutationAndCheckpoint(
			{
				db,
				env,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
			},
			{
				archive: mocks.archive,
				withWorkspaceRuntimeLease: async (_input, run) => run(makeLease()),
			},
		);
		await recordMutationAndCheckpoint(
			{
				db,
				env,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
			},
			{
				archive: mocks.archive,
				withWorkspaceRuntimeLease: async (_input, run) => run(makeLease()),
			},
		);

		const row = sqlite
			.prepare(
				`SELECT currentArchiveId, previousArchiveId FROM workspace_session_recoveries WHERE sessionId = ?`,
			)
			.get("sess-1") as {
			currentArchiveId: string;
			previousArchiveId: string;
		};

		const attempted: string[] = [];
		mocks.restoreImpl.mockImplementation(async (_env, _db, input) => {
			attempted.push(input.archiveId);
			if (input.archiveId === row.currentArchiveId) {
				throw new Error("current corrupt");
			}
			return {
				archive: {
					id: input.archiveId,
					formatVersion: 1,
					compatibilityKey: "ditto-workspace-archive-v1",
					byteCount: 10,
					digest: "digest",
					generation: 1,
				},
				extractedBytes: 10,
			};
		});

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const result = await restore(
			{ db, env, lease: makeLease() },
			{ archive: mocks.archive },
		);
		consoleError.mockRestore();

		expect(result).toEqual({
			ok: true,
			usedPrevious: true,
			reasonCode: "restored_previous",
		});
		expect(attempted).toEqual([row.currentArchiveId, row.previousArchiveId]);
		const state = await getWorkspaceRecoveryState(db, "sess-1");
		expect(state?.reasonCode).toBe("restored_previous");
	});

	it("marks recovery failed when both restores fail without restoring a seed", async () => {
		const mocks = makeArchiveMocks();
		await recordMutationAndCheckpoint(
			{
				db,
				env,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
			},
			{
				archive: mocks.archive,
				withWorkspaceRuntimeLease: async (_input, run) => run(makeLease()),
			},
		);
		await recordMutationAndCheckpoint(
			{
				db,
				env,
				userId: "user-1",
				projectId: "proj-1",
				sessionId: "sess-1",
			},
			{
				archive: mocks.archive,
				withWorkspaceRuntimeLease: async (_input, run) => run(makeLease()),
			},
		);

		mocks.restoreImpl.mockRejectedValue(new Error("all broken"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const result = await restore(
			{ db, env, lease: makeLease() },
			{ archive: mocks.archive },
		);
		consoleError.mockRestore();

		expect(result).toEqual({ ok: false, reasonCode: "restore_failed" });
		const row = sqlite
			.prepare(
				`SELECT state, currentArchiveId, previousArchiveId FROM workspace_session_recoveries WHERE sessionId = ?`,
			)
			.get("sess-1") as {
			state: string;
			currentArchiveId: string;
			previousArchiveId: string;
		};
		expect(row.state).toBe("failed");
		expect(row.currentArchiveId).toBeTruthy();
		expect(row.previousArchiveId).toBeTruthy();
		expect(await hasRecoveryArchives(db, "sess-1")).toBe(true);
	});

	it("abandons archives older than previous only after a new promotion", async () => {
		const mocks = makeArchiveMocks();
		const run = () =>
			recordMutationAndCheckpoint(
				{
					db,
					env,
					userId: "user-1",
					projectId: "proj-1",
					sessionId: "sess-1",
				},
				{
					archive: mocks.archive,
					withWorkspaceRuntimeLease: async (_input, runLease) =>
						runLease(makeLease()),
				},
			);

		await run();
		expect(mocks.abandoned).toEqual([]);
		await run();
		expect(mocks.abandoned).toEqual([]);
		const secondCurrent = mocks.created[1]?.id;
		await run();
		expect(mocks.abandoned).toEqual([mocks.created[0]?.id]);
		expect(secondCurrent).toBeTruthy();
	});

	it("requireDurable blocks while a mutation is pending or degraded", async () => {
		await recordMutation({ db, sessionId: "sess-1" });
		await expect(requireDurable(db, "sess-1")).rejects.toMatchObject({
			code: "not_durable",
		});

		sqlite
			.prepare(
				`UPDATE workspace_session_recoveries
				 SET state = 'degraded', reasonCode = 'checkpoint_failed'
				 WHERE sessionId = ?`,
			)
			.run("sess-1");
		await expect(requireDurable(db, "sess-1")).rejects.toBeInstanceOf(
			WorkspaceRecoveryError,
		);
	});

	it("requireDurable allows healthy and failed restore states", async () => {
		await expect(requireDurable(db, "sess-1")).resolves.toBeUndefined();

		sqlite
			.prepare(
				`INSERT INTO workspace_session_recoveries (sessionId, state, currentArchiveId)
				 VALUES ('sess-1', 'failed', 'arch-1')
				 ON CONFLICT(sessionId) DO UPDATE SET state = 'failed', currentArchiveId = 'arch-1'`,
			)
			.run();
		await expect(requireDurable(db, "sess-1")).resolves.toBeUndefined();
	});

	it("rejects checkpoint and restore without a backup_restore lease", async () => {
		await expect(
			checkpoint({
				db,
				env,
				lease: makeLease({ purpose: "agent_run" }),
				userId: "user-1",
			}),
		).rejects.toMatchObject({ code: "lease_required" });

		await expect(
			restore({
				db,
				env,
				lease: makeLease({ purpose: "preview" }),
			}),
		).rejects.toMatchObject({ code: "lease_required" });
	});

	it("does not include R2 object keys in user-facing errors or logs", async () => {
		const mocks = makeArchiveMocks();
		mocks.archive.create.mockRejectedValueOnce(
			new Error(
				"failed writing workspace_recovery/sess-1/1/secret-object-key.tar.gz",
			),
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		await recordMutation({ db, sessionId: "sess-1" });
		const state = await checkpoint(
			{ db, env, lease: makeLease(), userId: "user-1" },
			{ archive: mocks.archive },
		);
		expect(state.reasonCode).toBe("checkpoint_failed");
		expect(JSON.stringify(state)).not.toMatch(/secret-object-key/);
		expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(
			/secret-object-key/,
		);
		consoleError.mockRestore();
	});
});
