import { describe, expect, it, vi } from "vitest";

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

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: getProjectSandboxMock,
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
