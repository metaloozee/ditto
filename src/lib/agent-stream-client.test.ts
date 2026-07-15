import { describe, expect, it, vi } from "vitest";
import {
	type AgentStreamHandlers,
	appendAssistantTextDelta,
	applyAgentToolEventToParts,
	extractEditPatch,
	extractEditReplacements,
	formatToolCallLabel,
	getEditToolDiffData,
	groupAssistantParts,
	isEditTool,
	parseSseChunk,
	parseStoredParts,
	sendAgentControl,
	serializeAssistantPartsForStorage,
	streamAgentRun,
} from "./agent-stream-client";

describe("agent-stream-client transport", () => {
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

	it("dispatches control and turn boundary frames", async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						[
							'event: control_ready\ndata: {"runId":"run-1"}\n\n',
							'event: turn_done\ndata: {"userMessageId":"user-1","assistantMessageId":"assistant-1","content":"first"}\n\n',
							'event: turn_start\ndata: {"requestId":"request-1","userMessageId":"user-2","assistantMessageId":"assistant-2","text":"next"}\n\n',
							'event: queue_cancelled\ndata: {"requestId":"request-2","userMessageId":"user-3","assistantMessageId":"assistant-3"}\n\n',
						].join(""),
					),
				);
				controller.close();
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body)),
		);
		const calls: Array<[string, unknown]> = [];

		await streamAgentRun(
			{
				projectId: "p1",
				message: "hi",
				model: "opencode-go/claude-sonnet-4",
			},
			{
				onControlReady: (data) => calls.push(["ready", data]),
				onTurnDone: (data) => calls.push(["done", data]),
				onTurnStart: (data) => calls.push(["start", data]),
				onQueueCancelled: (data) => calls.push(["cancelled", data]),
			},
		);

		expect(calls.map(([event]) => event)).toEqual([
			"ready",
			"done",
			"start",
			"cancelled",
		]);
		expect(calls[2]?.[1]).toMatchObject({
			requestId: "request-1",
			text: "next",
		});
		vi.unstubAllGlobals();
	});

	it("forwards agent event with finite occurredAt and stays backward compatible", async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						[
							'event: agent\ndata: {"event":{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash"},"occurredAt":1000}\n\n',
							'event: agent\ndata: {"event":{"type":"tool_execution_end","toolCallId":"t1","toolName":"bash","result":"ok","isError":false}}\n\n',
							'event: agent\ndata: {"event":{"type":"tool_execution_start","toolCallId":"t2","toolName":"bash"},"occurredAt":"nope"}\n\n',
						].join(""),
					),
				);
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);

		const calls: Array<{ event: unknown; occurredAt?: number }> = [];
		await streamAgentRun(
			{
				projectId: "p1",
				message: "hi",
				model: "opencode-go/claude-sonnet-4",
			},
			{
				onAgent: (event, occurredAt) => {
					calls.push({ event, occurredAt });
				},
			},
		);

		expect(calls).toHaveLength(3);
		expect(calls[0]?.occurredAt).toBe(1_000);
		expect(calls[0]?.event).toMatchObject({
			type: "tool_execution_start",
			toolCallId: "t1",
		});
		expect(calls[1]?.occurredAt).toBeUndefined();
		expect(calls[2]?.occurredAt).toBeUndefined();

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

describe("agent control client", () => {
	it("returns follow-up and Stop acknowledgements", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					accepted: true,
					action: "follow_up",
					requestId: "request-1",
					runId: "run-1",
					sessionId: "session-1",
					userMessageId: "user-2",
					assistantMessageId: "assistant-2",
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					accepted: true,
					action: "stop",
					requestId: "request-2",
					runId: "run-1",
					sessionId: "session-1",
					removedFollowUps: ["queued"],
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			sendAgentControl({
				action: "follow_up",
				projectId: "project-1",
				sessionId: "session-1",
				runId: "run-1",
				model: "opencode-go/claude-sonnet-4",
				message: "next",
			}),
		).resolves.toMatchObject({ action: "follow_up", requestId: "request-1" });
		await expect(
			sendAgentControl({
				action: "stop",
				projectId: "project-1",
				sessionId: "session-1",
				runId: "run-1",
			}),
		).resolves.toMatchObject({ action: "stop", requestId: "request-2" });
		expect(fetchMock).toHaveBeenLastCalledWith(
			"/api/agent/control",
			expect.not.objectContaining({ signal: expect.anything() }),
		);
		vi.unstubAllGlobals();
	});

	it("surfaces safe 409 messages and rejects malformed JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					Response.json(
						{ error: "The active agent run is no longer available." },
						{ status: 409 },
					),
				),
		);
		const input = {
			action: "stop" as const,
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
		};
		await expect(sendAgentControl(input)).rejects.toThrow(
			"The active agent run is no longer available.",
		);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("not-json", { status: 200 })),
		);
		await expect(sendAgentControl(input)).rejects.toThrow(
			"Agent control returned an invalid response.",
		);
		vi.unstubAllGlobals();
	});

	it("Stop does not abort the original stream signal", async () => {
		const streamBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.close();
			},
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(streamBody))
			.mockResolvedValueOnce(
				Response.json({
					accepted: true,
					action: "stop",
					requestId: "request-1",
					runId: "run-1",
					sessionId: "session-1",
					removedFollowUps: [],
				}),
			);
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();

		await streamAgentRun(
			{
				projectId: "project-1",
				message: "hi",
				model: "opencode-go/claude-sonnet-4",
			},
			{},
			{ signal: controller.signal },
		);
		await sendAgentControl({
			action: "stop",
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
		});

		expect(controller.signal.aborted).toBe(false);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			signal: controller.signal,
		});
		expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty("signal");
		vi.unstubAllGlobals();
	});
});

describe("agent-stream-client re-exports (compatibility)", () => {
	it("formatToolCallLabel includes primary args and truncates long labels", () => {
		expect(
			formatToolCallLabel({
				id: "1",
				name: "bash",
				status: "done",
				args: { command: "ls -la" },
			}),
		).toBe("ls -la");
		expect(
			formatToolCallLabel({
				id: "2",
				name: "bash",
				status: "done",
				args: { cmd: "echo hi" },
			}),
		).toBe("echo hi");
		expect(
			formatToolCallLabel({
				id: "3",
				name: "grep",
				status: "done",
				args: { pattern: "foo" },
			}),
		).toBe("grep foo");
		expect(
			formatToolCallLabel({
				id: "4",
				name: "read_file",
				status: "done",
				args: { path: "src/lib/agent-stream-client.ts" },
			}),
		).toBe("read_file src/lib/agent-stream-client.ts");

		const longPattern = "a".repeat(200);
		const label = formatToolCallLabel({
			id: "5",
			name: "grep",
			status: "done",
			args: { pattern: longPattern },
		});
		expect(label.startsWith("grep ")).toBe(true);
		expect(label.endsWith("…")).toBe(true);
		expect(label.length).toBeLessThanOrEqual(100);
	});

	it("groupAssistantParts merges consecutive tools and splits on text", () => {
		const groups = groupAssistantParts([
			{
				type: "tool",
				id: "p1",
				tool: {
					id: "t1",
					name: "bash",
					status: "done",
					args: { command: "ls -la" },
				},
			},
			{
				type: "tool",
				id: "p2",
				tool: { id: "t2", name: "bash", status: "done" },
			},
			{
				type: "text",
				id: "p3",
				text: "Okay, I now see what's wrong",
			},
			{
				type: "tool",
				id: "p4",
				tool: { id: "t3", name: "grep", status: "done" },
			},
		]);

		expect(groups).toHaveLength(3);
		expect(groups[0]).toMatchObject({
			type: "tools",
			tools: [{ id: "t1" }, { id: "t2" }],
		});
		expect(groups[1]).toMatchObject({
			type: "text",
			text: "Okay, I now see what's wrong",
		});
		expect(groups[2]).toMatchObject({
			type: "tools",
			tools: [{ id: "t3", name: "grep" }],
		});
	});

	it("groupAssistantParts keeps edit tools outside Working/Worked groups", () => {
		const groups = groupAssistantParts([
			{
				type: "tool",
				id: "p1",
				tool: {
					id: "t1",
					name: "bash",
					status: "done",
					args: { command: "ls" },
				},
			},
			{
				type: "tool",
				id: "p2",
				tool: {
					id: "t2",
					name: "edit",
					status: "done",
					args: {
						path: "src/a.ts",
						edits: [{ oldText: "a", newText: "b" }],
					},
				},
			},
			{
				type: "tool",
				id: "p3",
				tool: {
					id: "t3",
					name: "bash",
					status: "done",
					args: { command: "echo ok" },
				},
			},
		]);

		expect(groups).toHaveLength(3);
		expect(groups[0]).toMatchObject({
			type: "tools",
			tools: [{ id: "t1", name: "bash" }],
		});
		expect(groups[1]).toMatchObject({
			type: "edit",
			tool: { id: "t2", name: "edit" },
		});
		expect(groups[2]).toMatchObject({
			type: "tools",
			tools: [{ id: "t3", name: "bash" }],
		});
		expect(isEditTool({ id: "x", name: "edit", status: "done" })).toBe(true);
		expect(isEditTool({ id: "x", name: "bash", status: "done" })).toBe(false);
	});

	it("getEditToolDiffData reads edits and result patch", () => {
		const replacements = extractEditReplacements({
			path: "App.tsx",
			edits: [{ oldText: "foo", newText: "bar" }],
		});
		expect(replacements).toEqual([{ oldText: "foo", newText: "bar" }]);

		const legacy = extractEditReplacements({
			path: "App.tsx",
			oldText: "a",
			newText: "b",
		});
		expect(legacy).toEqual([{ oldText: "a", newText: "b" }]);

		const patch = [
			"--- App.tsx",
			"+++ App.tsx",
			"@@ -1 +1 @@",
			"-foo",
			"+bar",
		].join("\n");
		expect(
			extractEditPatch({
				content: [{ type: "text", text: "ok" }],
				details: { patch },
			}),
		).toBe(patch);

		const data = getEditToolDiffData({
			id: "e1",
			name: "edit",
			status: "done",
			args: {
				path: "App.tsx",
				edits: [{ oldText: "foo", newText: "bar" }],
			},
			result: {
				details: { patch },
			},
		});
		expect(data).toEqual({
			path: "App.tsx",
			oldContents: "foo",
			newContents: "bar",
			patch,
		});

		const multiWithPatch = getEditToolDiffData({
			id: "e2",
			name: "edit",
			status: "done",
			args: {
				path: "App.tsx",
				edits: [
					{ oldText: "foo", newText: "bar" },
					{ oldText: "baz", newText: "qux" },
				],
			},
			result: { details: { patch } },
		});
		expect(multiWithPatch).toEqual({
			path: "App.tsx",
			oldContents: "",
			newContents: "",
			patch,
		});

		const multiNoPatch = getEditToolDiffData({
			id: "e3",
			name: "edit",
			status: "done",
			args: {
				path: "App.tsx",
				edits: [
					{ oldText: "foo", newText: "bar" },
					{ oldText: "baz", newText: "qux" },
				],
			},
		});
		expect(multiNoPatch).toEqual({
			path: "App.tsx",
			oldContents: "foo\n\nbaz",
			newContents: "bar\n\nqux",
			patch: null,
		});
	});

	it("persists consecutive tool groups across reload (storage round-trip)", () => {
		let parts = appendAssistantTextDelta([], "");
		parts =
			applyAgentToolEventToParts(parts, {
				type: "tool_execution_end",
				toolCallId: "t1",
				toolName: "bash",
				args: { command: "ls -la" },
				result: "ok",
				isError: false,
			}) ?? parts;
		parts =
			applyAgentToolEventToParts(parts, {
				type: "tool_execution_end",
				toolCallId: "t2",
				toolName: "bash",
				args: { command: "echo hi" },
				result: "hi",
				isError: false,
			}) ?? parts;
		parts = appendAssistantTextDelta(parts, "Okay, I now see what's wrong");
		parts =
			applyAgentToolEventToParts(parts, {
				type: "tool_execution_end",
				toolCallId: "t3",
				toolName: "grep",
				result: "match",
				isError: false,
			}) ?? parts;

		const json = serializeAssistantPartsForStorage(parts);
		expect(json).not.toBeNull();

		const restored = parseStoredParts(json);
		expect(restored).toBeDefined();
		const groups = groupAssistantParts(restored ?? []);
		expect(groups).toHaveLength(3);
		expect(groups[0]?.type).toBe("tools");
		if (groups[0]?.type === "tools") {
			expect(groups[0].tools.map(formatToolCallLabel)).toEqual([
				"ls -la",
				"echo hi",
			]);
		}
		expect(groups[1]).toMatchObject({
			type: "text",
			text: "Okay, I now see what's wrong",
		});
		if (groups[2]?.type === "tools") {
			expect(groups[2].tools.map(formatToolCallLabel)).toEqual(["grep"]);
		}
	});
});
