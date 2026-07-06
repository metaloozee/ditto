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
			needsInput: null,
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
		const secret = `sk-test-${"a".repeat(24)}`;
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "read_file",
			toolCallId: "call-1",
			isError: false,
			result: `ok ${secret}`,
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
			result: "ok [REDACTED]",
			durationMs: 42,
		});
		expect(projection.events[0]?.payload).not.toContain(secret);
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

	it("redacts log frames and payloads before broadcast or persistence", () => {
		const secret = `ghp_${"f".repeat(40)}`;
		const projection = mapFlueEventToDittoEvents({
			type: "log",
			level: "error",
			message: `failed with ${secret}`,
		});
		const payload = parsePayload(projection.events[0]);

		expect(payload.message).toBe("failed with [REDACTED]");
		expect(projection.frames).toEqual([
			{ type: "error", message: "failed with [REDACTED]" },
		]);
		expect(projection.events[0]?.payload).not.toContain(secret);
	});

	it("keeps truncated text within the requested maximum length", () => {
		expect(compactFlueText("abcdef", 5)).toBe("\n...[");
		expect(compactFlueText("abcdef", 0)).toBe("");
		expect(compactFlueText("a".repeat(100), 20)).toBe(`aaaaa\n...[truncated]`);
		expect(compactFlueText("a".repeat(100), 20)).toHaveLength(20);
	});

	it("redacts before truncating compacted text", () => {
		const secret = `sk-test-${"g".repeat(24)}`;
		const compacted = compactFlueText(`${secret} ${"x".repeat(100)}`, 20);

		expect(compacted).toBe("[REDA\n...[truncated]");
		expect(compacted).not.toContain(secret);
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
			needsInput: null,
		});
	});

	it("projects a needs_input tool result as a needs_input event + frame", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "request_clarification",
			toolCallId: "call-9",
			isError: false,
			result:
				'{"dittoEvent":"needs_input","question":"Which branch?","requestId":"r1"}',
			durationMs: 3,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
			"needs_input",
		]);
		expect(parsePayload(projection.events[1])).toMatchObject({
			schemaVersion: 1,
			question: "Which branch?",
			requestId: "r1",
		});
		expect(projection.frames).toEqual([
			{ type: "needs_input", question: "Which branch?", requestId: "r1" },
		]);
		expect(projection.needsInput).toEqual({
			question: "Which branch?",
			requestId: "r1",
		});
		expect(projection.terminalStatus).toBeNull();
	});

	it("ignores a needs_input signal with missing fields", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "request_clarification",
			toolCallId: "call-9",
			isError: false,
			result: '{"dittoEvent":"needs_input"}',
			durationMs: 3,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
		]);
		expect(projection.frames).toEqual([]);
		expect(projection.needsInput).toBeNull();
	});

	it("ignores a needs_input signal when the result is not valid JSON", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "request_clarification",
			toolCallId: "call-9",
			isError: false,
			result: "not json",
			durationMs: 3,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
		]);
		expect(projection.frames).toEqual([]);
		expect(projection.needsInput).toBeNull();
	});

	it("ignores a structured tool result with the wrong dittoEvent", () => {
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "request_clarification",
			toolCallId: "call-9",
			isError: false,
			result: '{"dittoEvent":"something_else","question":"x","requestId":"r1"}',
			durationMs: 3,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
		]);
		expect(projection.frames).toEqual([]);
		expect(projection.needsInput).toBeNull();
	});

	it("redacts secrets in the needs_input question before emitting the frame", () => {
		const secret = `sk-test-${"a".repeat(24)}`;
		const projection = mapFlueEventToDittoEvents({
			type: "tool",
			toolName: "request_clarification",
			toolCallId: "call-9",
			isError: false,
			result: `{"dittoEvent":"needs_input","question":"use key ${secret}","requestId":"r1"}`,
			durationMs: 3,
		});

		expect(projection.events.map((event) => event.type)).toEqual([
			"tool_finished",
			"needs_input",
		]);
		expect(projection.needsInput?.question).toBe("use key [REDACTED]");
		expect(projection.needsInput?.question).not.toContain(secret);
		expect(projection.frames[0]).toMatchObject({
			type: "needs_input",
			requestId: "r1",
		});
		expect(JSON.stringify(projection.frames[0])).not.toContain(secret);
	});
});
