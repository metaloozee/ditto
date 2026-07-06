import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RUN_DIFF_ARTIFACT_BYTES } from "./run-diff-artifact";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {
		ctx: DurableObjectState;
		env: Env;

		constructor(ctx: DurableObjectState, env: Env) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

vi.stubGlobal(
	"WebSocketRequestResponsePair",
	class WebSocketRequestResponsePair {
		constructor(
			public request: string,
			public response: string,
		) {}
	},
);

const createDbMock = vi.hoisted(() => vi.fn());
const getProjectSandboxMock = vi.hoisted(() => vi.fn());
const backupSandboxWorkspaceMock = vi.hoisted(() => vi.fn());
const serializeSandboxBackupMock = vi.hoisted(() => vi.fn());

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
	backupSandboxWorkspace: backupSandboxWorkspaceMock,
}));

vi.mock("#/lib/sandbox-backup", () => ({
	serializeSandboxBackup: serializeSandboxBackupMock,
	SANDBOX_BACKUP_EXCLUDES: [],
	SANDBOX_BACKUP_TTL_SECONDS: 31536000,
	parseSandboxBackup: vi.fn(),
	hasPresignedBackupConfig: vi.fn(),
	shouldUseLocalBucketBackups: vi.fn(),
	getSandboxBackupOptions: vi.fn(),
}));

const {
	applyFlueStreamCursor,
	buildFinalChangeSummaryEvent,
	buildTerminalEvents,
	createFlueAgentInstanceId,
	FlueRunBridge,
	persistFlueStreamOffset,
	shouldIgnoreFlueRunEvent,
	shouldResumeFlueStream,
} = await import("./flue-run-bridge");

describe("flue run bridge helpers", () => {
	it("creates the Flue agent instance id from project and sandbox ids", () => {
		expect(createFlueAgentInstanceId("project-1", "sandbox-1")).toBe(
			"project-1:sandbox-1",
		);
		expect(() => createFlueAgentInstanceId("", "sandbox-1")).toThrow(
			"Missing projectId.",
		);
		expect(() => createFlueAgentInstanceId("project-1", " ")).toThrow(
			"Missing sandboxId.",
		);
	});

	it("applies stream cursor data without changing run identity", () => {
		const state = {
			sessionId: "session-1",
			projectId: "project-1",
			activeRunId: "run-1",
			streamOffset: "1",
			streamCursor: "cursor-1",
			streamClosed: false,
		};

		expect(
			applyFlueStreamCursor(state, {
				nextOffset: "2",
				cursor: "cursor-2",
				closed: true,
			}),
		).toEqual({
			...state,
			streamOffset: "2",
			streamCursor: "cursor-2",
			streamClosed: true,
		});
	});

	it("gates mismatched and canceled run events", () => {
		const state = {
			activeRunId: "run-1",
			canceledRunIds: ["run-3"],
		};

		expect(shouldIgnoreFlueRunEvent(state, "run-1", [])).toBe(false);
		expect(shouldIgnoreFlueRunEvent(state, "run-2", [])).toBe(true);
		expect(shouldIgnoreFlueRunEvent(state, "run-3", [])).toBe(true);
		expect(shouldIgnoreFlueRunEvent(state, "run-1", ["run-1"])).toBe(true);
	});

	it("resumes only active, open, non-canceled Flue stream state", () => {
		const resumable = {
			activeRunId: "run-1",
			flueAgentName: "project-coder",
			flueAgentInstanceId: "project-1:sandbox-1",
			streamClosed: false,
		};

		expect(shouldResumeFlueStream(resumable)).toBe(true);
		expect(
			shouldResumeFlueStream({ ...resumable, activeRunId: undefined }),
		).toBe(false);
		expect(
			shouldResumeFlueStream({ ...resumable, flueAgentName: undefined }),
		).toBe(false);
		expect(
			shouldResumeFlueStream({ ...resumable, flueAgentInstanceId: undefined }),
		).toBe(false);
		expect(shouldResumeFlueStream({ ...resumable, streamClosed: true })).toBe(
			false,
		);
		expect(
			shouldResumeFlueStream({ ...resumable, canceledRunIds: ["run-1"] }),
		).toBe(false);
	});

	it("builds assistant terminal events before done events", () => {
		const events = buildTerminalEvents({
			runId: "run-1",
			projectId: "project-1",
			sessionId: "session-1",
			assistantText: "Done.",
			status: "completed",
		});

		expect(events.map((event) => event.type)).toEqual(["message", "done"]);
		expect(JSON.parse(events[0].payload)).toEqual({
			role: "assistant",
			text: "Done.",
			schemaVersion: 1,
		});
		expect(JSON.parse(events[1].payload)).toEqual({
			status: "completed",
			schemaVersion: 1,
		});
	});

	it("omits the assistant message when there is no assistant text", () => {
		const events = buildTerminalEvents({
			runId: "run-1",
			projectId: "project-1",
			sessionId: "session-1",
			assistantText: null,
			status: "failed",
		});

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("done");
		expect(JSON.parse(events[0].payload)).toMatchObject({
			status: "failed",
			schemaVersion: 1,
		});
	});

	it("builds a redacted bounded final change summary event", () => {
		const event = buildFinalChangeSummaryEvent({
			status: "completed",
			summary: `changed sk-${"x".repeat(24)} ${"a".repeat(4100)}`,
		});
		const payload = JSON.parse(event.payload);

		expect(event.type).toBe("tool_finished");
		expect(payload.toolName).toBe("final_change_summary");
		expect(payload.status).toBe("completed");
		expect(payload.result).toContain("[REDACTED]");
		expect(payload.result).not.toContain(`sk-${"x".repeat(24)}`);
		expect(payload.result).toContain("...[truncated]");
		expect(payload.result.length).toBeLessThanOrEqual(4000);
	});

	it("guards duplicate consumers for the same active run", async () => {
		const state = {
			activeRunId: "run-1",
			flueAgentName: "project-coder",
			flueAgentInstanceId: "project-1:sandbox-1",
			streamClosed: false,
		};
		const waitUntilPromises: Promise<unknown>[] = [];
		const ctx = {
			setWebSocketAutoResponse: vi.fn(),
			getWebSockets: vi.fn(() => []),
			waitUntil: vi.fn((promise: Promise<unknown>) => {
				waitUntilPromises.push(promise);
			}),
			storage: {
				get: vi.fn(async () => state),
				put: vi.fn(),
			},
		};
		let consumeCount = 0;
		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		) as unknown as {
			consumeFlueStream: (runId: string) => Promise<void>;
			resumeFlueStreamIfNeeded: (
				reason: "constructor" | "socket" | "start",
			) => Promise<void>;
		};
		bridge.consumeFlueStream = async () => {
			consumeCount += 1;
			await new Promise(() => {});
		};

		await bridge.resumeFlueStreamIfNeeded("start");
		await bridge.resumeFlueStreamIfNeeded("socket");

		expect(consumeCount).toBe(1);
		expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
		expect(waitUntilPromises).toHaveLength(2);
	});

	it("persists advanced Flue stream offsets to D1", async () => {
		const where = vi.fn();
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		createDbMock.mockReturnValue({ update });

		await persistFlueStreamOffset({} as Env, "run-1", "1", "2");

		expect(update).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledWith({
			flueStreamOffset: "2",
			updatedAt: expect.anything(),
		});
		expect(where).toHaveBeenCalledTimes(1);
	});

	it("skips D1 writes when the Flue stream offset is unchanged", async () => {
		const update = vi.fn();
		createDbMock.mockReturnValue({ update });

		await persistFlueStreamOffset({} as Env, "run-1", "2", "2");

		expect(update).not.toHaveBeenCalled();
	});
});

describe("flue run bridge checkpoint", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeDbMock() {
		const insertValues = vi.fn().mockResolvedValue(undefined);
		const batch = vi.fn().mockResolvedValue(undefined);
		const where = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		const insert = vi.fn(() => ({ values: insertValues }));
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: vi.fn(() => []) })),
			})),
		}));

		const db = { insert, batch, update, select };
		return { db, insertValues, batch, set, where };
	}

	function makeBridge(ctxOverrides: Record<string, unknown> = {}) {
		const state: Record<string, unknown> = {};
		const ctx = {
			setWebSocketAutoResponse: vi.fn(),
			getWebSockets: vi.fn(() => []),
			waitUntil: vi.fn(),
			storage: {
				get: vi.fn(async () => state),
				put: vi.fn(async (_key: string, value: unknown) => {
					Object.assign(state, value);
				}),
				setAlarm: vi.fn().mockResolvedValue(undefined),
				deleteAlarm: vi.fn().mockResolvedValue(undefined),
			},
			...ctxOverrides,
		};
		return { ctx, state };
	}

	it("successful mutating run writes R2 manifest, D1 snapshot row, and updates projects.sandboxBackup", async () => {
		const { db, insertValues, batch, set, where } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const execMock = vi.fn();
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: "abc123\n",
			stderr: "",
		});
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: " M src/index.ts\n",
			stderr: "",
		});
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: " src/index.ts | 5 +++--\n",
			stderr: "",
		});
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-abc",
			dir: "/workspace",
		});
		serializeSandboxBackupMock.mockReturnValue(
			JSON.stringify({ id: "backup-abc", dir: "/workspace" }),
		);

		const putMock = vi.fn().mockResolvedValue(undefined);
		const { ctx } = makeBridge();

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: putMock },
				FLUE_WORKER: { fetch: vi.fn() },
				ProjectCoordinator: {
					idFromName: vi.fn(() => ({
						get: vi.fn(() => ({
							fetch: vi.fn().mockResolvedValue(new Response()),
						})),
					})),
				},
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
					status: string,
				) => Promise<void>;
			}
		).checkpointMutatingRun(
			{
				isMutating: true,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
			"completed",
		);

		// snapshot_started event inserted
		expect(insertValues).toHaveBeenCalled();
		const firstCall = insertValues.mock.calls[0]?.[0];
		expect(firstCall.type).toBe("snapshot_started");

		// BACKUP_BUCKET.put called with manifest key
		expect(putMock).toHaveBeenCalledTimes(1);
		const putKey = putMock.mock.calls[0]?.[0];
		expect(putKey).toMatch(
			/^projects\/project-1\/snapshots\/[^/]+\/manifest\.json$/,
		);

		// snapshot_completed event and snapshots row inserted via batch
		expect(batch).toHaveBeenCalledTimes(1);
		const batchCalls = batch.mock.calls[0]?.[0];
		expect(batchCalls).toHaveLength(3); // snapshots insert, projects update, snapshot_completed event

		// projects updated with sandboxBackup
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				sandboxBackup: expect.any(String),
			}),
		);
		expect(where).toHaveBeenCalled();
	});

	it("periodic mutating checkpoint writes snapshot metadata with periodic event payloads", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const execMock = vi.fn();
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: "abc123\n",
			stderr: "",
		});
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: " M src/index.ts\n",
			stderr: "",
		});
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: " src/index.ts | 5 +++--\n",
			stderr: "",
		});
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-abc",
			dir: "/workspace",
		});
		serializeSandboxBackupMock.mockReturnValue(
			JSON.stringify({ id: "backup-abc", dir: "/workspace" }),
		);

		const putMock = vi.fn().mockResolvedValue(undefined);
		const { ctx } = makeBridge();

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: putMock },
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointPeriodicMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<void>;
			}
		).checkpointPeriodicMutatingRun(
			{
				activeRunId: "run-1",
				isMutating: true,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
		);

		expect(putMock).toHaveBeenCalledTimes(1);
		expect(batch).toHaveBeenCalledTimes(1);

		const snapshotStartedCall = insertValues.mock.calls.find(
			(call) => call[0]?.type === "snapshot_started",
		);
		expect(JSON.parse(snapshotStartedCall?.[0].payload)).toMatchObject({
			periodic: true,
			schemaVersion: 1,
		});

		const snapshotCompletedCall = insertValues.mock.calls.find(
			(call) => call[0]?.type === "snapshot_completed",
		);
		expect(JSON.parse(snapshotCompletedCall?.[0].payload)).toMatchObject({
			periodic: true,
			schemaVersion: 1,
			snapshotId: expect.any(String),
			digest: expect.any(String),
		});
	});

	it("alarm checkpoints an active mutating run and re-arms while it remains active", async () => {
		const { db } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const { ctx, state } = makeBridge();
		Object.assign(state, {
			activeRunId: "run-1",
			isMutating: true,
			sandboxId: "sandbox-1",
			projectId: "project-1",
			sessionId: "session-1",
		});

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		) as unknown as {
			alarm: () => Promise<void>;
			checkpointPeriodicMutatingRun: (
				state: Record<string, unknown>,
				runId: string,
			) => Promise<void>;
		};
		const checkpointPeriodicMutatingRun = vi.fn().mockResolvedValue(undefined);
		bridge.checkpointPeriodicMutatingRun = checkpointPeriodicMutatingRun;

		await bridge.alarm();

		expect(checkpointPeriodicMutatingRun).toHaveBeenCalledTimes(1);
		expect(checkpointPeriodicMutatingRun).toHaveBeenCalledWith(
			expect.objectContaining({
				activeRunId: "run-1",
				isMutating: true,
			}),
			"run-1",
		);
		expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
		expect(ctx.storage.setAlarm).toHaveBeenCalledWith(expect.any(Number));
	});

	it("successful mutating start arms the periodic checkpoint alarm", async () => {
		const { db } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				streamUrl: "https://flue.internal/runs/run-1/stream",
				offset: "0",
				runId: "run-1",
			}),
		);
		const { ctx } = makeBridge();
		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				FLUE_WORKER: { fetch: fetchMock },
			} as unknown as Env,
		) as unknown as {
			start: (input: {
				sessionId: string;
				userId: string;
				projectId: string;
				sandboxId: string;
				runId: string;
				message: string;
				modelSpecifier: string;
				isMutating: true;
				fencingToken: number;
			}) => Promise<void>;
			resumeFlueStreamIfNeeded: (
				reason: "constructor" | "socket" | "start",
			) => Promise<void>;
		};
		bridge.resumeFlueStreamIfNeeded = vi.fn().mockResolvedValue(undefined);

		await bridge.start({
			sessionId: "session-1",
			userId: "user-1",
			projectId: "project-1",
			sandboxId: "sandbox-1",
			runId: "run-1",
			message: "change code",
			modelSpecifier: "anthropic/claude-sonnet-4-5",
			isMutating: true,
			fencingToken: 12,
		});

		expect(ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
		expect(ctx.storage.setAlarm).toHaveBeenCalledWith(expect.any(Number));
	});

	it("terminal runs clear the periodic checkpoint alarm", async () => {
		const { db } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const { ctx, state } = makeBridge();
		Object.assign(state, {
			activeRunId: "run-1",
			isMutating: true,
			projectId: "project-1",
			sessionId: "session-1",
		});

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				FLUE_WORKER: { fetch: vi.fn() },
				ProjectCoordinator: {
					idFromName: vi.fn(() => "project-1"),
					get: vi.fn(() => ({
						fetch: vi.fn().mockResolvedValue(new Response()),
					})),
				},
			} as unknown as Env,
		) as unknown as {
			finishRun: (runId: string, status: "failed") => Promise<void>;
		};

		await bridge.finishRun("run-1", "failed");

		expect(ctx.storage.deleteAlarm).toHaveBeenCalledTimes(1);
	});

	it("R2 put failure inserts snapshot_failed and does not update snapshots or projects.sandboxBackup", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const execMock = vi.fn();
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: "abc123\n",
			stderr: "",
		});
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: " M src/index.ts\n",
			stderr: "",
		});
		execMock.mockResolvedValueOnce({
			success: true,
			stdout: " src/index.ts | 5 +++--\n",
			stderr: "",
		});
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		backupSandboxWorkspaceMock.mockResolvedValue({
			id: "backup-abc",
			dir: "/workspace",
		});

		const putMock = vi.fn().mockRejectedValue(new Error("R2 write failed"));
		const { ctx } = makeBridge();

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: putMock },
				FLUE_WORKER: { fetch: vi.fn() },
				ProjectCoordinator: {
					idFromName: vi.fn(() => ({
						get: vi.fn(() => ({
							fetch: vi.fn().mockResolvedValue(new Response()),
						})),
					})),
				},
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
					status: string,
				) => Promise<void>;
			}
		).checkpointMutatingRun(
			{
				isMutating: true,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
			"completed",
		);

		// batch should NOT be called (the R2 failure skips D1 writes for snapshots/projects)
		expect(batch).not.toHaveBeenCalled();

		// snapshot_failed event should be inserted
		const snapshotFailedCalls = insertValues.mock.calls.filter(
			(call) => call[0]?.type === "snapshot_failed",
		);
		expect(snapshotFailedCalls.length).toBe(1);
		expect(snapshotFailedCalls[0]?.[0].payload).toContain("R2 write failed");
	});

	it("periodic checkpoint failure records snapshot_failed and does not throw", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		backupSandboxWorkspaceMock.mockRejectedValue(new Error("Backup failed"));

		const { ctx } = makeBridge();
		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		);

		await expect(
			(
				bridge as unknown as {
					checkpointPeriodicMutatingRun: (
						state: Record<string, unknown>,
						runId: string,
					) => Promise<void>;
				}
			).checkpointPeriodicMutatingRun(
				{
					activeRunId: "run-1",
					isMutating: true,
					sandboxId: "sandbox-1",
					projectId: "project-1",
					sessionId: "session-1",
				},
				"run-1",
			),
		).resolves.toBeUndefined();

		expect(batch).not.toHaveBeenCalled();
		const snapshotFailedCall = insertValues.mock.calls.find(
			(call) => call[0]?.type === "snapshot_failed",
		);
		expect(JSON.parse(snapshotFailedCall?.[0].payload)).toMatchObject({
			periodic: true,
			reason: "Backup failed",
			schemaVersion: 1,
		});
	});

	it("periodic checkpoint skips inactive runs", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const { ctx } = makeBridge();
		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointPeriodicMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<void>;
			}
		).checkpointPeriodicMutatingRun(
			{
				activeRunId: "other-run",
				isMutating: true,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
		);

		expect(insertValues).not.toHaveBeenCalled();
		expect(batch).not.toHaveBeenCalled();
		expect(backupSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("read-only run (isMutating: false) produces no checkpoint", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const { ctx } = makeBridge();

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
					status: string,
				) => Promise<void>;
			}
		).checkpointMutatingRun(
			{
				isMutating: false,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
			"completed",
		);

		// No events, no backup, no D1 writes
		expect(insertValues).not.toHaveBeenCalled();
		expect(batch).not.toHaveBeenCalled();
		expect(backupSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("mutating run with terminal status failed produces no checkpoint", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		const { ctx } = makeBridge();

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
					status: string,
				) => Promise<void>;
			}
		).checkpointMutatingRun(
			{
				isMutating: true,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
			"failed",
		);

		expect(insertValues).not.toHaveBeenCalled();
		expect(batch).not.toHaveBeenCalled();
		expect(backupSandboxWorkspaceMock).not.toHaveBeenCalled();
	});

	it("checkpoint failure does not throw — error is caught and recorded", async () => {
		const { db, insertValues, batch } = makeDbMock();
		createDbMock.mockReturnValue(db);

		backupSandboxWorkspaceMock.mockRejectedValue(new Error("Backup failed"));

		const { ctx } = makeBridge();

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
			} as unknown as Env,
		);

		await (
			bridge as unknown as {
				checkpointMutatingRun: (
					state: Record<string, unknown>,
					runId: string,
					status: string,
				) => Promise<void>;
			}
		).checkpointMutatingRun(
			{
				isMutating: true,
				sandboxId: "sandbox-1",
				projectId: "project-1",
				sessionId: "session-1",
			},
			"run-1",
			"completed",
		);

		// Should NOT throw — the method catches internally
		expect(batch).not.toHaveBeenCalled();

		// snapshot_failed event should be inserted
		const snapshotFailedCalls = insertValues.mock.calls.filter(
			(call) => call[0]?.type === "snapshot_failed",
		);
		expect(snapshotFailedCalls.length).toBe(1);
		expect(snapshotFailedCalls[0]?.[0].payload).toContain("Backup failed");
	});
});

describe("flue run bridge diff artifacts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeDiffBridge(envOverrides: Record<string, unknown> = {}) {
		const state: Record<string, unknown> = {};
		const ctx = {
			setWebSocketAutoResponse: vi.fn(),
			getWebSockets: vi.fn(() => []),
			waitUntil: vi.fn(),
			storage: {
				get: vi.fn(async () => state),
				put: vi.fn(async (_key: string, value: unknown) => {
					Object.assign(state, value);
				}),
				setAlarm: vi.fn().mockResolvedValue(undefined),
				deleteAlarm: vi.fn().mockResolvedValue(undefined),
			},
		};
		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
				...envOverrides,
			} as unknown as Env,
		);
		return { ctx, state, bridge };
	}

	function gitExecMock(opts: { status?: string; diff?: string } = {}) {
		return vi.fn(async (command: string) => {
			if (command.startsWith("git status")) {
				return { success: true, stdout: opts.status ?? "", stderr: "" };
			}
			if (command.startsWith("git diff --no-ext-diff")) {
				return { success: true, stdout: opts.diff ?? "", stderr: "" };
			}
			return { success: true, stdout: "", stderr: "" };
		});
	}

	type DiffBridge = {
		buildRunDiffArtifactEvents: (
			state: Record<string, unknown>,
			runId: string,
			status: "completed" | "failed",
		) => Promise<{
			artifactInsert: {
				runId: string;
				projectId: string;
				kind: string;
				r2Key: string;
				contentType: string;
				byteLength: number;
			} | null;
			diffReadyEvent: { type: string; payload: string } | null;
		}>;
	};

	const mutatingState = {
		isMutating: true,
		sandboxId: "sandbox-1",
		projectId: "project-1",
		sessionId: "session-1",
	};

	it("successful completed mutating run writes R2 diff artifact and returns artifactInsert + diff_ready", async () => {
		const execMock = gitExecMock({
			status: " M src/index.ts\n",
			diff: "diff --git a/src/index.ts b/src/index.ts\n--- a\n+++ b\n",
		});
		const putMock = vi.fn().mockResolvedValue(undefined);
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		const result = await (
			bridge as unknown as DiffBridge
		).buildRunDiffArtifactEvents(mutatingState, "run-1", "completed");

		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock.mock.calls[0]?.[0]).toMatch(
			/^projects\/project-1\/runs\/run-1\/artifacts\/diff\/[^/]+$/,
		);
		expect(result.artifactInsert).toMatchObject({
			runId: "run-1",
			projectId: "project-1",
			kind: "diff",
			contentType: "text/x-diff; charset=utf-8",
		});
		expect(result.artifactInsert?.r2Key).toBe(putMock.mock.calls[0]?.[0]);
		expect(result.diffReadyEvent?.type).toBe("diff_ready");
		const payload = JSON.parse(result.diffReadyEvent?.payload ?? "{}");
		expect(payload.hasArtifact).toBe(true);
		expect(payload.changedFiles).toEqual(["src/index.ts"]);
		expect(payload.truncated).toBe(false);
		expect(payload.byteLength).toBe(result.artifactInsert?.byteLength);
		expect(payload.r2Key).toBeUndefined();
		expect(JSON.stringify(payload)).not.toContain(putMock.mock.calls[0]?.[0]);
	});

	it("no workspace diff inserts diff_ready without an artifact", async () => {
		const execMock = gitExecMock({ status: " M src/index.ts\n", diff: "" });
		const putMock = vi.fn().mockResolvedValue(undefined);
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		const result = await (
			bridge as unknown as DiffBridge
		).buildRunDiffArtifactEvents(mutatingState, "run-1", "completed");

		expect(putMock).not.toHaveBeenCalled();
		expect(result.artifactInsert).toBeNull();
		expect(result.diffReadyEvent?.type).toBe("diff_ready");
		const payload = JSON.parse(result.diffReadyEvent?.payload ?? "{}");
		expect(payload.hasArtifact).toBe(false);
		expect(payload.changedFiles).toEqual(["src/index.ts"]);
		expect(payload.truncated).toBe(false);
	});

	it("redacts secret-looking patch content before R2 write", async () => {
		const secret = `sk-${"x".repeat(24)}`;
		const execMock = gitExecMock({
			status: " M src/index.ts\n",
			diff: `diff --git a/src/index.ts b/src/index.ts\n+TOKEN=${secret}\n`,
		});
		const putMock = vi.fn().mockResolvedValue(undefined);
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		await (bridge as unknown as DiffBridge).buildRunDiffArtifactEvents(
			mutatingState,
			"run-1",
			"completed",
		);

		expect(putMock).toHaveBeenCalledTimes(1);
		const written = putMock.mock.calls[0]?.[1];
		expect(written).toContain("[REDACTED]");
		expect(written).not.toContain(secret);
	});

	it("R2 write failure returns a redacted diff_ready with hasArtifact false and no artifactInsert", async () => {
		const execMock = gitExecMock({
			status: " M src/index.ts\n",
			diff: "diff --git a/src/index.ts b/src/index.ts\n",
		});
		const putMock = vi.fn().mockRejectedValue(new Error("R2 write failed"));
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		const result = await (
			bridge as unknown as DiffBridge
		).buildRunDiffArtifactEvents(mutatingState, "run-1", "completed");

		expect(result.artifactInsert).toBeNull();
		expect(result.diffReadyEvent?.type).toBe("diff_ready");
		const payload = JSON.parse(result.diffReadyEvent?.payload ?? "{}");
		expect(payload.hasArtifact).toBe(false);
		expect(payload.error).toBe("R2 write failed");
	});

	it("oversized diff produces a truncated diff_ready without an artifact", async () => {
		const oversized = `diff --git\n${"+x".repeat(MAX_RUN_DIFF_ARTIFACT_BYTES)}`;
		const execMock = gitExecMock({
			status: " M big.ts\n",
			diff: oversized,
		});
		const putMock = vi.fn().mockResolvedValue(undefined);
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: execMock });

		const result = await (
			bridge as unknown as DiffBridge
		).buildRunDiffArtifactEvents(mutatingState, "run-1", "completed");

		expect(putMock).not.toHaveBeenCalled();
		expect(result.artifactInsert).toBeNull();
		const payload = JSON.parse(result.diffReadyEvent?.payload ?? "{}");
		expect(payload.truncated).toBe(true);
		expect(payload.hasArtifact).toBe(false);
		expect(payload.byteLength).toBeGreaterThan(MAX_RUN_DIFF_ARTIFACT_BYTES);
		expect(payload.changedFiles).toEqual(["big.ts"]);
	});

	it("read-only run produces no diff artifact or diff_ready event", async () => {
		const putMock = vi.fn().mockResolvedValue(undefined);
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: gitExecMock() });

		const result = await (
			bridge as unknown as DiffBridge
		).buildRunDiffArtifactEvents(
			{ ...mutatingState, isMutating: false },
			"run-1",
			"completed",
		);

		expect(result.artifactInsert).toBeNull();
		expect(result.diffReadyEvent).toBeNull();
		expect(putMock).not.toHaveBeenCalled();
	});

	it("failed mutating run produces no diff artifact or diff_ready event", async () => {
		const putMock = vi.fn().mockResolvedValue(undefined);
		const { bridge } = makeDiffBridge({ BACKUP_BUCKET: { put: putMock } });
		getProjectSandboxMock.mockReturnValue({ exec: gitExecMock() });

		const result = await (
			bridge as unknown as DiffBridge
		).buildRunDiffArtifactEvents(mutatingState, "run-1", "failed");

		expect(result.artifactInsert).toBeNull();
		expect(result.diffReadyEvent).toBeNull();
		expect(putMock).not.toHaveBeenCalled();
	});

	function makeTerminalDbMock() {
		const insertValues = vi.fn().mockResolvedValue(undefined);
		const batch = vi.fn().mockResolvedValue(undefined);
		const where = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		const insert = vi.fn(() => ({ values: insertValues }));
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: vi.fn(() => []) })),
			})),
		}));
		const db = { insert, batch, update, select };
		return { db, insertValues, batch };
	}

	it("successful completed mutating run inserts run_artifacts and diff_ready before done", async () => {
		const { db, insertValues, batch } = makeTerminalDbMock();
		createDbMock.mockReturnValue(db);

		const execMock = vi.fn(async (command: string) => {
			if (command.startsWith("git status")) {
				return { success: true, stdout: " M src/index.ts\n", stderr: "" };
			}
			if (command.startsWith("git diff --no-ext-diff")) {
				return {
					success: true,
					stdout: "diff --git a/src/index.ts b/src/index.ts\n",
					stderr: "",
				};
			}
			if (command.startsWith("git rev-parse")) {
				return { success: true, stdout: "abc123\n", stderr: "" };
			}
			return { success: true, stdout: "", stderr: "" };
		});
		getProjectSandboxMock.mockReturnValue({ exec: execMock });
		backupSandboxWorkspaceMock.mockRejectedValue(new Error("Backup failed"));
		serializeSandboxBackupMock.mockReturnValue("{}");

		const putMock = vi.fn().mockResolvedValue(undefined);
		const coordinatorFetch = vi.fn().mockResolvedValue(new Response());
		const { ctx, state } = makeDiffBridge({
			BACKUP_BUCKET: { put: putMock },
		});
		Object.assign(state, {
			activeRunId: "run-1",
			...mutatingState,
		});

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: putMock },
				FLUE_WORKER: { fetch: vi.fn() },
				ProjectCoordinator: {
					idFromName: vi.fn(() => "project-1"),
					get: vi.fn(() => ({ fetch: coordinatorFetch })),
				},
			} as unknown as Env,
		) as unknown as {
			finishRun: (runId: string, status: "completed") => Promise<void>;
		};

		await bridge.finishRun("run-1", "completed");

		// terminal batch executed
		expect(batch).toHaveBeenCalledTimes(1);
		// diff artifact persisted to R2 before D1
		expect(putMock).toHaveBeenCalledTimes(1);
		expect(putMock.mock.calls[0]?.[0]).toMatch(
			/^projects\/project-1\/runs\/run-1\/artifacts\/diff\//,
		);

		// terminal event rows include diff_ready before done
		const terminalCall = insertValues.mock.calls.find((call) =>
			Array.isArray(call[0]),
		);
		expect(terminalCall).toBeTruthy();
		const types = (terminalCall?.[0] as Array<{ type: string }>).map(
			(e) => e.type,
		);
		expect(types).toContain("diff_ready");
		expect(types).toContain("done");
		expect(types.indexOf("diff_ready")).toBeLessThan(types.indexOf("done"));

		// run_artifacts row inserted with kind diff
		const artifactCall = insertValues.mock.calls.find(
			(call) => call[0]?.kind === "diff",
		);
		expect(artifactCall).toBeTruthy();
		expect(artifactCall?.[0]).toMatchObject({
			runId: "run-1",
			projectId: "project-1",
			kind: "diff",
		});

		// raw patch text never stored in agent_run_events payloads
		for (const call of insertValues.mock.calls) {
			const rows = Array.isArray(call[0]) ? call[0] : [call[0]];
			for (const row of rows) {
				if (row?.type && row.type !== "done") {
					expect(row.payload).not.toContain(
						"diff --git a/src/index.ts b/src/index.ts",
					);
				}
			}
		}
	});

	it("diff artifact R2 failure does not prevent terminal done", async () => {
		const { db, batch } = makeTerminalDbMock();
		createDbMock.mockReturnValue(db);

		const execMock = vi.fn(async (command: string) => {
			if (command.startsWith("git status")) {
				return { success: true, stdout: " M src/index.ts\n", stderr: "" };
			}
			if (command.startsWith("git diff --no-ext-diff")) {
				return {
					success: true,
					stdout: "diff --git a/src/index.ts b/src/index.ts\n",
					stderr: "",
				};
			}
			if (command.startsWith("git rev-parse")) {
				return { success: true, stdout: "abc123\n", stderr: "" };
			}
			return { success: true, stdout: "", stderr: "" };
		});
		getProjectSandboxMock.mockReturnValue({ exec: execMock });
		backupSandboxWorkspaceMock.mockRejectedValue(new Error("Backup failed"));

		const putMock = vi
			.fn()
			.mockRejectedValue(new Error("R2 diff write failed"));
		const coordinatorFetch = vi.fn().mockResolvedValue(new Response());
		const { ctx, state } = makeDiffBridge({});
		Object.assign(state, { activeRunId: "run-1", ...mutatingState });

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: putMock },
				FLUE_WORKER: { fetch: vi.fn() },
				ProjectCoordinator: {
					idFromName: vi.fn(() => "project-1"),
					get: vi.fn(() => ({ fetch: coordinatorFetch })),
				},
			} as unknown as Env,
		) as unknown as {
			finishRun: (runId: string, status: "completed") => Promise<void>;
		};

		await bridge.finishRun("run-1", "completed");

		// R2 write was attempted and failed
		expect(putMock).toHaveBeenCalledTimes(1);
		// terminal batch still executed despite R2 failure
		expect(batch).toHaveBeenCalledTimes(1);
		// coordinator notified of completed status
		expect(coordinatorFetch).toHaveBeenCalledTimes(1);
		const request = coordinatorFetch.mock.calls[0]?.[0] as Request;
		const body = JSON.parse(
			await (request.clone().body as ReadableStream)
				.getReader()
				.read()
				.then((r) => new TextDecoder().decode(r.value)),
		);
		expect(body).toMatchObject({
			projectId: "project-1",
			runId: "run-1",
			status: "completed",
		});
	});
});

describe("flue run bridge lease renewal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeRenewalBridge(
		stateOverrides: Record<string, unknown> = {},
		envOverrides: Record<string, unknown> = {},
	) {
		const state: Record<string, unknown> = {
			activeRunId: "run-1",
			isMutating: true,
			projectId: "project-1",
			sessionId: "session-1",
			fencingToken: 7,
			...stateOverrides,
		};
		const ctx = {
			setWebSocketAutoResponse: vi.fn(),
			getWebSockets: vi.fn(() => []),
			waitUntil: vi.fn(),
			storage: {
				get: vi.fn(async () => state),
				put: vi.fn(async (_key: string, value: unknown) => {
					Object.assign(state, value);
				}),
				setAlarm: vi.fn().mockResolvedValue(undefined),
				deleteAlarm: vi.fn().mockResolvedValue(undefined),
			},
		};
		const coordinatorFetch = vi.fn();
		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				BACKUP_BUCKET: { put: vi.fn() },
				FLUE_WORKER: { fetch: vi.fn() },
				ProjectCoordinator: {
					idFromName: vi.fn(() => "project-1"),
					get: vi.fn(() => ({ fetch: coordinatorFetch })),
				},
				...envOverrides,
			} as unknown as Env,
		);
		return { ctx, state, bridge, coordinatorFetch };
	}

	it("renews an active mutating lease via coordinator /renew", async () => {
		const { state, bridge, coordinatorFetch } = makeRenewalBridge();
		coordinatorFetch.mockResolvedValueOnce(
			Response.json(
				{
					lease: { expiresAt: "2099-01-01T00:00:00.000Z" },
					state: { mutationLease: { expiresAt: "2099-01-01T00:00:00.000Z" } },
				},
				{ status: 202 },
			),
		);

		const terminated = await (
			bridge as unknown as {
				renewMutatingLeaseIfNeeded: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<boolean>;
			}
		).renewMutatingLeaseIfNeeded(state, "run-1");

		expect(terminated).toBe(false);
		expect(coordinatorFetch).toHaveBeenCalledTimes(1);
		const request = coordinatorFetch.mock.calls[0]?.[0] as Request;
		expect(request.url).toContain("/renew");
		const body = JSON.parse(
			await (request.clone().body as ReadableStream)
				.getReader()
				.read()
				.then((r) => new TextDecoder().decode(r.value)),
		);
		expect(body).toMatchObject({
			projectId: "project-1",
			runId: "run-1",
			fencingToken: 7,
		});
		expect(state.lastLeaseRenewedAt).toBeTruthy();
		expect(typeof state.lastLeaseRenewedAt).toBe("string");
	});

	it("skips renewal for read-only runs", async () => {
		const { state, bridge, coordinatorFetch } = makeRenewalBridge({
			isMutating: false,
		});

		const terminated = await (
			bridge as unknown as {
				renewMutatingLeaseIfNeeded: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<boolean>;
			}
		).renewMutatingLeaseIfNeeded(state, "run-1");

		expect(terminated).toBe(false);
		expect(coordinatorFetch).not.toHaveBeenCalled();
	});

	it("throttles renewal to the threshold window", async () => {
		const recentRenewal = new Date(Date.now() - 5_000).toISOString();
		const { state, bridge, coordinatorFetch } = makeRenewalBridge({
			lastLeaseRenewedAt: recentRenewal,
		});

		const terminated = await (
			bridge as unknown as {
				renewMutatingLeaseIfNeeded: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<boolean>;
			}
		).renewMutatingLeaseIfNeeded(state, "run-1");

		expect(terminated).toBe(false);
		expect(coordinatorFetch).not.toHaveBeenCalled();
	});

	it("renews when the last renewal is older than the threshold", async () => {
		const oldRenewal = new Date(Date.now() - 120_000).toISOString();
		const { state, bridge, coordinatorFetch } = makeRenewalBridge({
			lastLeaseRenewedAt: oldRenewal,
		});
		coordinatorFetch.mockResolvedValueOnce(Response.json({}, { status: 202 }));

		const terminated = await (
			bridge as unknown as {
				renewMutatingLeaseIfNeeded: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<boolean>;
			}
		).renewMutatingLeaseIfNeeded(state, "run-1");

		expect(terminated).toBe(false);
		expect(coordinatorFetch).toHaveBeenCalledTimes(1);
	});

	it("fails the run when renewal returns 409", async () => {
		const insertValues = vi.fn().mockResolvedValue(undefined);
		const insert = vi.fn(() => ({ values: insertValues }));
		const db = { insert };
		createDbMock.mockReturnValue(db);

		const { state, bridge, coordinatorFetch } = makeRenewalBridge();
		coordinatorFetch.mockResolvedValueOnce(
			Response.json({ error: "Mutating lease has expired." }, { status: 409 }),
		);

		const finishRunMock = vi.fn().mockResolvedValue(undefined);
		(
			bridge as unknown as {
				finishRun: typeof finishRunMock;
			}
		).finishRun = finishRunMock;

		const terminated = await (
			bridge as unknown as {
				renewMutatingLeaseIfNeeded: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<boolean>;
			}
		).renewMutatingLeaseIfNeeded(state, "run-1");

		expect(terminated).toBe(true);
		expect(insertValues).toHaveBeenCalledTimes(1);
		const inserted = insertValues.mock.calls[0]?.[0];
		expect(inserted.type).toBe("error");
		expect(inserted.payload).toContain("Mutating lease has expired.");
		expect(inserted.runId).toBe("run-1");
		expect(finishRunMock).toHaveBeenCalledWith("run-1", "failed");
	});

	it("redacts the renewal error message before inserting the error event", async () => {
		const insertValues = vi.fn().mockResolvedValue(undefined);
		const insert = vi.fn(() => ({ values: insertValues }));
		const db = { insert };
		createDbMock.mockReturnValue(db);

		const { state, bridge, coordinatorFetch } = makeRenewalBridge();
		coordinatorFetch.mockResolvedValueOnce(
			Response.json(
				{ error: `Lease lost: sk-${"x".repeat(24)}` },
				{ status: 409 },
			),
		);

		const finishRunMock = vi.fn().mockResolvedValue(undefined);
		(
			bridge as unknown as {
				finishRun: typeof finishRunMock;
			}
		).finishRun = finishRunMock;

		await (
			bridge as unknown as {
				renewMutatingLeaseIfNeeded: (
					state: Record<string, unknown>,
					runId: string,
				) => Promise<boolean>;
			}
		).renewMutatingLeaseIfNeeded(state, "run-1");

		const inserted = insertValues.mock.calls[0]?.[0];
		expect(inserted.payload).toContain("[REDACTED]");
		expect(inserted.payload).not.toContain(`sk-${"x".repeat(24)}`);
	});
});

describe("flue run bridge needs_input pause", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeConsumeBridge(options: {
		state?: Record<string, unknown>;
		events?: unknown[];
	}) {
		const state: Record<string, unknown> = {
			activeRunId: "run-1",
			flueAgentName: "project-coder",
			flueAgentInstanceId: "project-1:sandbox-1",
			flueStreamPath: "/agents/project-coder/project-1:sandbox-1",
			streamOffset: "0",
			streamCursor: null,
			// streamClosed starts true so the constructor's resumeFlueStreamIfNeeded
			// does not start a background consumer that races the direct call below.
			streamClosed: true,
			isMutating: false,
			projectId: "project-1",
			sessionId: "session-1",
			...options.state,
		};
		const events = options.events ?? [];
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify(events), {
					status: 200,
					headers: {
						"Stream-Next-Offset": "10",
						"Stream-Closed": "true",
					},
				}),
		);
		const ctx = {
			setWebSocketAutoResponse: vi.fn(),
			getWebSockets: vi.fn(() => []),
			waitUntil: vi.fn(),
			storage: {
				get: vi.fn(async () => state),
				put: vi.fn(async (_key: string, value: unknown) => {
					Object.assign(state, value);
				}),
				setAlarm: vi.fn().mockResolvedValue(undefined),
				deleteAlarm: vi.fn().mockResolvedValue(undefined),
			},
		};
		const insertValues = vi.fn().mockResolvedValue(undefined);
		const insert = vi.fn(() => ({ values: insertValues }));
		const where = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: vi.fn(() => []) })),
			})),
		}));
		const db = { insert, update, select };
		createDbMock.mockReturnValue(db);

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{ FLUE_WORKER: { fetch: fetchMock } } as unknown as Env,
		);
		return { ctx, state, bridge, fetchMock, insertValues, set, where };
	}

	const needsInputToolEvent = {
		type: "tool",
		toolName: "request_clarification",
		toolCallId: "call-1",
		isError: false,
		result:
			'{"dittoEvent":"needs_input","question":"Which branch?","requestId":"r1"}',
		durationMs: 4,
	};
	const submissionSettledCompleted = {
		type: "submission_settled",
		submissionId: "s1",
		outcome: "completed",
	};
	const submissionSettledFailed = {
		type: "submission_settled",
		submissionId: "s1",
		outcome: "failed",
		error: "model failed",
	};

	it("pauses the run when a needs_input tool result is followed by submission_settled completed", async () => {
		const { bridge, state } = makeConsumeBridge({
			events: [needsInputToolEvent, submissionSettledCompleted],
		});
		const finishRunMock = vi.fn().mockResolvedValue(undefined);
		const pauseRunForInputMock = vi.fn().mockResolvedValue(undefined);
		(
			bridge as unknown as {
				finishRun: typeof finishRunMock;
				pauseRunForInput: typeof pauseRunForInputMock;
				consumeFlueStream: (runId: string) => Promise<void>;
			}
		).finishRun = finishRunMock;
		(
			bridge as unknown as {
				pauseRunForInput: typeof pauseRunForInputMock;
			}
		).pauseRunForInput = pauseRunForInputMock;

		await (
			bridge as unknown as {
				consumeFlueStream: (runId: string) => Promise<void>;
			}
		).consumeFlueStream("run-1");

		expect(pauseRunForInputMock).toHaveBeenCalledTimes(1);
		expect(pauseRunForInputMock).toHaveBeenCalledWith("run-1");
		expect(finishRunMock).not.toHaveBeenCalled();
		expect(state.pendingInputRequestId).toBe("r1");
		expect(state.pendingInputQuestion).toBe("Which branch?");
	});

	it("finishes the run as failed when a needs_input result is followed by submission_settled failed", async () => {
		const { bridge } = makeConsumeBridge({
			events: [needsInputToolEvent, submissionSettledFailed],
		});
		const finishRunMock = vi.fn().mockResolvedValue(undefined);
		const pauseRunForInputMock = vi.fn().mockResolvedValue(undefined);
		(
			bridge as unknown as {
				finishRun: typeof finishRunMock;
				pauseRunForInput: typeof pauseRunForInputMock;
				consumeFlueStream: (runId: string) => Promise<void>;
			}
		).finishRun = finishRunMock;
		(
			bridge as unknown as {
				pauseRunForInput: typeof pauseRunForInputMock;
			}
		).pauseRunForInput = pauseRunForInputMock;

		await (
			bridge as unknown as {
				consumeFlueStream: (runId: string) => Promise<void>;
			}
		).consumeFlueStream("run-1");

		expect(finishRunMock).toHaveBeenCalledTimes(1);
		expect(finishRunMock).toHaveBeenCalledWith("run-1", "failed");
		expect(pauseRunForInputMock).not.toHaveBeenCalled();
	});

	it("finishes the run as completed when submission_settled completed has no prior needs_input", async () => {
		const { bridge } = makeConsumeBridge({
			events: [submissionSettledCompleted],
		});
		const finishRunMock = vi.fn().mockResolvedValue(undefined);
		const pauseRunForInputMock = vi.fn().mockResolvedValue(undefined);
		(
			bridge as unknown as {
				finishRun: typeof finishRunMock;
				pauseRunForInput: typeof pauseRunForInputMock;
				consumeFlueStream: (runId: string) => Promise<void>;
			}
		).finishRun = finishRunMock;
		(
			bridge as unknown as {
				pauseRunForInput: typeof pauseRunForInputMock;
			}
		).pauseRunForInput = pauseRunForInputMock;

		await (
			bridge as unknown as {
				consumeFlueStream: (runId: string) => Promise<void>;
			}
		).consumeFlueStream("run-1");

		expect(finishRunMock).toHaveBeenCalledTimes(1);
		expect(finishRunMock).toHaveBeenCalledWith("run-1", "completed");
		expect(pauseRunForInputMock).not.toHaveBeenCalled();
	});

	it("pauseRunForInput writes needs_input status and broadcasts the frame", async () => {
		const { bridge, set } = makeConsumeBridge({
			events: [],
		});
		bridge as unknown as {
			pauseRunForInput: (runId: string) => Promise<void>;
		};
		// Manually seed pending input state, then call pauseRunForInput directly.
		const pauseBridge = bridge as unknown as {
			pauseRunForInput: (runId: string) => Promise<void>;
			getState: () => Promise<Record<string, unknown>>;
			setState: (state: Record<string, unknown>) => Promise<void>;
		};
		await pauseBridge.setState({
			...(await pauseBridge.getState()),
			pendingInputRequestId: "r1",
			pendingInputQuestion: "Which branch?",
		});

		await pauseBridge.pauseRunForInput("run-1");

		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "needs_input",
				question: "Which branch?",
				recommendedAnswer: null,
			}),
		);
	});
});

describe("flue run bridge reply", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeReplyBridge(options: {
		state?: Record<string, unknown>;
		flueFetch?: ReturnType<typeof vi.fn>;
		coordinatorFetch?: ReturnType<typeof vi.fn>;
	}) {
		const state: Record<string, unknown> = {
			activeRunId: "run-1",
			flueAgentName: "project-coder",
			flueAgentInstanceId: "project-1:sandbox-1",
			flueStreamPath: "/agents/project-coder/project-1:sandbox-1",
			streamOffset: "0",
			streamCursor: null,
			streamClosed: true,
			isMutating: false,
			projectId: "project-1",
			sessionId: "session-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			modelSpecifier: "anthropic/claude-sonnet-4-6",
			pendingInputRequestId: "r1",
			pendingInputQuestion: "Which branch?",
			...options.state,
		};
		const fetchMock =
			options.flueFetch ??
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							streamUrl:
								"https://flue.internal/agents/project-coder/project-1:sandbox-1",
							offset: "20",
							submissionId: "s2",
						}),
						{ status: 200 },
					),
			);
		const coordinatorFetch =
			options.coordinatorFetch ??
			vi.fn(async () => new Response("{}", { status: 200 }));
		const ctx = {
			setWebSocketAutoResponse: vi.fn(),
			getWebSockets: vi.fn(() => []),
			waitUntil: vi.fn(),
			storage: {
				get: vi.fn(async () => state),
				put: vi.fn(async (_key: string, value: unknown) => {
					Object.assign(state, value);
				}),
				setAlarm: vi.fn().mockResolvedValue(undefined),
				deleteAlarm: vi.fn().mockResolvedValue(undefined),
			},
		};
		const insertValues = vi.fn().mockResolvedValue(undefined);
		const where = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		const insert = vi.fn(() => ({ values: insertValues }));
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: vi.fn(() => []) })),
			})),
		}));
		const db = { insert, update, select };
		createDbMock.mockReturnValue(db);

		const bridge = new FlueRunBridge(
			ctx as unknown as DurableObjectState,
			{
				FLUE_WORKER: { fetch: fetchMock },
				ProjectCoordinator: {
					idFromName: vi.fn(() => "project-1"),
					get: vi.fn(() => ({ fetch: coordinatorFetch })),
				},
			} as unknown as Env,
		);
		return {
			ctx,
			state,
			bridge,
			fetchMock,
			coordinatorFetch,
			insertValues,
			set,
			where,
		};
	}

	it("re-dispatches a read-only run with the user answer and resumes consumption", async () => {
		const { bridge, fetchMock, insertValues, set } = makeReplyBridge({});

		const replyBridge = bridge as unknown as {
			reply: (input: { runId: string; answer: string }) => Promise<void>;
			resumeFlueStreamIfNeeded: (
				reason: "constructor" | "socket" | "start" | "reply",
			) => Promise<void>;
		};
		const resumeSpy = vi.fn().mockResolvedValue(undefined);
		replyBridge.resumeFlueStreamIfNeeded = resumeSpy;

		await replyBridge.reply({ runId: "run-1", answer: "use main" });

		// dispatch POSTs to the agent path with the answer as the message
		const dispatchRequest = fetchMock.mock.calls[0]?.[0] as Request;
		expect(dispatchRequest.method).toBe("POST");
		expect(decodeURIComponent(dispatchRequest.url)).toContain(
			"/agents/project-coder/project-1:sandbox-1",
		);
		const body = await dispatchRequest.clone().json();
		expect(body).toEqual({ message: "use main" });

		// user answer event inserted
		const inserted = insertValues.mock.calls[0]?.[0];
		expect(inserted.type).toBe("message");
		expect(inserted.payload).toContain("use main");
		expect(inserted.payload).toContain('"kind":"answer"');

		// run status set to running
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({ status: "running", question: null }),
		);

		// consumption resumed
		expect(resumeSpy).toHaveBeenCalledWith("reply");
	});

	it("returns 400 when there is no pending input", async () => {
		const { bridge } = makeReplyBridge({
			state: { pendingInputRequestId: undefined },
		});

		const response = await (
			bridge as unknown as { fetch: (request: Request) => Promise<Response> }
		).fetch(
			new Request("https://flue-run-bridge/reply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ runId: "run-1", answer: "x" }),
			}),
		);

		expect(response.status).toBe(400);
	});

	it("returns 400 when the run id does not match the active run", async () => {
		const { bridge, fetchMock } = makeReplyBridge({});

		const response = await (
			bridge as unknown as { fetch: (request: Request) => Promise<Response> }
		).fetch(
			new Request("https://flue-run-bridge/reply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ runId: "other-run", answer: "x" }),
			}),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 400 on a mutating reply when the lease is expired and does not re-dispatch", async () => {
		const coordinatorFetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						mutationLease: null,
						activeReadOnlyRuns: [],
						nextFencingToken: 1,
						snapshot: { latestSnapshotId: null, restoring: false },
					}),
					{ status: 200 },
				),
		);
		const { bridge, fetchMock } = makeReplyBridge({
			state: {
				isMutating: true,
				fencingToken: 7,
			},
			coordinatorFetch,
		});

		const response = await (
			bridge as unknown as { fetch: (request: Request) => Promise<Response> }
		).fetch(
			new Request("https://flue-run-bridge/reply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ runId: "run-1", answer: "x" }),
			}),
		);

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
