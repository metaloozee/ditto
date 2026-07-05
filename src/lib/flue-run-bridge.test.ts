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
