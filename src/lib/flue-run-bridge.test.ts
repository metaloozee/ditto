import { beforeEach, describe, expect, it, vi } from "vitest";

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
