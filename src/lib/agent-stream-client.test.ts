import { describe, expect, it, vi } from "vitest";
import {
	type AgentStreamHandlers,
	appendAssistantTextDelta,
	applyAgentToolEvent,
	applyAgentToolEventToParts,
	parseSseChunk,
	parseStoredParts,
	parseStoredTools,
	streamAgentRun,
} from "./agent-stream-client";

describe("agent-stream-client", () => {
	it("parseSseChunk reassembles partial SSE chunks", () => {
		const first = parseSseChunk(
			'event: meta\ndata: {"sessionId":"s1"}\n\nevent: delta\ndata: {"del',
		);
		expect(first.frames).toEqual([
			{ event: "meta", data: '{"sessionId":"s1"}' },
		]);
		expect(first.rest).toBe('event: delta\ndata: {"del');

		const second = parseSseChunk(`${first.rest}ta":"hi"}\n\n`);
		expect(second.frames).toEqual([{ event: "delta", data: '{"delta":"hi"}' }]);
		expect(second.rest).toBe("");
	});

	it("streamAgentRun dispatches delta and done", async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						'event: delta\ndata: {"delta":"Hello"}\n\nevent: done\ndata: {"ok":true,"assistantMessageId":"a1","content":"Hello"}\n\n',
					),
				);
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);

		const deltas: string[] = [];
		let donePayload: unknown;
		const handlers: AgentStreamHandlers = {
			onDelta: (delta) => deltas.push(delta),
			onDone: (data) => {
				donePayload = data;
			},
		};

		await streamAgentRun(
			{
				projectId: "p1",
				message: "hi",
				model: "opencode-go/claude-sonnet-4",
			},
			handlers,
		);

		expect(deltas).toEqual(["Hello"]);
		expect(donePayload).toEqual({
			ok: true,
			assistantMessageId: "a1",
			content: "Hello",
		});

		vi.unstubAllGlobals();
	});

	it("ignores malformed data lines without throwing", async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						'event: delta\ndata: not-json\n\nevent: delta\ndata: {"delta":"ok"}\n\n',
					),
				);
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);

		const deltas: string[] = [];
		await streamAgentRun(
			{
				projectId: "p1",
				message: "hi",
				model: "opencode-go/claude-sonnet-4",
			},
			{
				onDelta: (delta) => deltas.push(delta),
			},
		);

		expect(deltas).toEqual(["ok"]);
		vi.unstubAllGlobals();
	});

	it("applyAgentToolEvent tracks start/update/end lifecycle", () => {
		const started = applyAgentToolEvent([], {
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(started).toEqual([
			{
				id: "t1",
				name: "bash",
				status: "running",
				args: { command: "ls" },
			},
		]);

		const updated = applyAgentToolEvent(started ?? [], {
			type: "tool_execution_update",
			toolCallId: "t1",
			toolName: "bash",
			args: { command: "ls" },
			partialResult: "file.ts\n",
		});
		expect(updated?.[0]?.result).toBe("file.ts\n");
		expect(updated?.[0]?.status).toBe("running");

		const ended = applyAgentToolEvent(updated ?? [], {
			type: "tool_execution_end",
			toolCallId: "t1",
			toolName: "bash",
			result: "file.ts\n",
			isError: false,
		});
		expect(ended).toEqual([
			{
				id: "t1",
				name: "bash",
				status: "done",
				args: { command: "ls" },
				result: "file.ts\n",
			},
		]);
	});

	it("parseStoredTools reads JSON tool history", () => {
		const tools = parseStoredTools(
			JSON.stringify([
				{
					id: "t1",
					name: "bash",
					status: "done",
					args: { command: "ls" },
					result: "ok",
				},
			]),
		);
		expect(tools).toEqual([
			{
				id: "t1",
				name: "bash",
				status: "done",
				args: { command: "ls" },
				result: "ok",
			},
		]);
		expect(parseStoredTools(null)).toBeUndefined();
		expect(parseStoredTools("not-json")).toBeUndefined();
	});

	it("keeps text and tools interleaved in parts timeline", () => {
		let parts = appendAssistantTextDelta([], "I'll edit the file.");
		parts =
			applyAgentToolEventToParts(parts, {
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: "edit",
				args: { path: "App.tsx" },
			}) ?? parts;
		parts =
			applyAgentToolEventToParts(parts, {
				type: "tool_execution_end",
				toolCallId: "t1",
				toolName: "edit",
				result: "ok",
				isError: false,
			}) ?? parts;
		parts = appendAssistantTextDelta(parts, "Done.");

		expect(parts).toHaveLength(3);
		expect(parts[0]).toMatchObject({
			type: "text",
			text: "I'll edit the file.",
		});
		expect(parts[1]).toMatchObject({
			type: "tool",
			tool: {
				id: "t1",
				name: "edit",
				status: "done",
				args: { path: "App.tsx" },
				result: "ok",
			},
		});
		expect(parts[2]).toMatchObject({ type: "text", text: "Done." });

		const stored = parseStoredParts(JSON.stringify(parts));
		expect(stored).toEqual(parts);
	});
});
