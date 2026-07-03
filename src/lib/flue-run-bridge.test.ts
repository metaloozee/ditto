import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {},
}));

const {
	applyFlueStreamCursor,
	buildTerminalEvents,
	createFlueAgentInstanceId,
	shouldIgnoreFlueRunEvent,
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
});
