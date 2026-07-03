import { describe, expect, it } from "vitest";
import {
	compactFlueText,
	type FlueProjectedEvent,
	mapFlueEventToDittoEvents,
} from "./flue-event-projection";

function parsePayload(event: FlueProjectedEvent): Record<string, unknown> {
	return JSON.parse(event.payload) as Record<string, unknown>;
}

describe("mapFlueEventToDittoEvents", () => {
	it("projects text_delta as a live assistant frame only", () => {
		expect(
			mapFlueEventToDittoEvents({ type: "text_delta", text: "Hello" }),
		).toEqual({
			events: [],
			frames: [{ type: "assistant_delta", text: "Hello" }],
			assistantDelta: "Hello",
			terminalStatus: null,
		});
	});

	it("projects tool_start with a schema-versioned payload", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool_start",
			toolName: "read_file",
			toolCallId: "call-1",
			args: { path: "src/app.ts" },
		});

		expect(projection.events).toHaveLength(1);
		expect(projection.events[0]?.type).toBe("tool_started");
		expect(parsePayload(projection.events[0])).toMatchObject({
			schemaVersion: 1,
			toolName: "read_file",
			toolCallId: "call-1",
			args: '{"path":"src/app.ts"}',
		});
		expect(projection.frames).toEqual([
			{ type: "tool_progress", text: "Started read_file." },
		]);
	});

	it("projects a successful tool completion", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "read_file",
			toolCallId: "call-1",
			isError: false,
			result: "ok",
			durationMs: 42,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
		]);
		expect(parsePayload(projection.events[0])).toMatchObject({
			schemaVersion: 1,
			toolName: "read_file",
			toolCallId: "call-1",
			status: "completed",
			result: "ok",
			durationMs: 42,
		});
	});

	it("projects a failed tool completion with an error event", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "write_file",
			toolCallId: "call-2",
			isError: true,
			result: "permission denied",
			durationMs: 10,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
			"error",
		]);
		expect(parsePayload(projection.events[0])).toMatchObject({
			schemaVersion: 1,
			status: "failed",
		});
		expect(parsePayload(projection.events[1])).toMatchObject({
			schemaVersion: 1,
			message: "permission denied",
		});
	});

	it("projects logs as capped command output", () => {
		const longMessage = "a".repeat(2100);
		const projection = mapFlueEventToDittoEvents({
			type: "log",
			level: "info",
			message: longMessage,
			attributes: { step: "compile" },
		});
		const payload = parsePayload(projection.events[0]);

		expect(projection.events.map((event) => event.type)).toEqual([
			"command_output",
		]);
		expect(payload.schemaVersion).toBe(1);
		expect(payload.level).toBe("info");
		expect(payload.message).toBe(
			`${"a".repeat(2000 - "\n...[truncated]".length)}\n...[truncated]`,
		);
		expect(String(payload.message)).toHaveLength(2000);
		expect(payload.attributes).toBe('{"step":"compile"}');
	});

	it("keeps truncated text within the requested maximum length", () => {
		expect(compactFlueText("abcdef", 5)).toBe("\n...[");
		expect(compactFlueText("abcdef", 0)).toBe("");
		expect(compactFlueText("a".repeat(100), 20)).toBe(
			`aaaaa\n...[truncated]`,
		);
		expect(compactFlueText("a".repeat(100), 20)).toHaveLength(20);
	});

	it("projects completed submission_settled as terminal completed", () => {
		expect(
			mapFlueEventToDittoEvents({
				type: "submission_settled",
				submissionId: "submission-1",
				outcome: "completed",
			}),
		).toMatchObject({ terminalStatus: "completed", events: [], frames: [] });
	});

	it("projects failed submission_settled with an error event", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "submission_settled",
			submissionId: "submission-1",
			outcome: "failed",
			error: "model failed",
		});

		expect(projection.terminalStatus).toBe("failed");
		expect(projection.events.map((event) => event.type)).toEqual(["error"]);
		expect(parsePayload(projection.events[0])).toMatchObject({
			schemaVersion: 1,
			message: "model failed",
		});
	});

	it("ignores unknown events", () => {
		expect(mapFlueEventToDittoEvents({ type: "future_event" })).toEqual({
			events: [],
			frames: [],
			assistantDelta: null,
			terminalStatus: null,
		});
	});
});
