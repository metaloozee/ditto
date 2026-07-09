import { describe, expect, it, vi } from "vitest";
import {
	type AgentStreamHandlers,
	parseSseChunk,
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
});
