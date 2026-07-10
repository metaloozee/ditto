import { describe, expect, it, vi } from "vitest";
import {
	type AgentStreamHandlers,
	appendAssistantTextDelta,
	applyAgentToolEvent,
	applyAgentToolEventToParts,
	extractEditPatch,
	extractEditReplacements,
	formatToolCallLabel,
	getEditToolDiffData,
	groupAssistantParts,
	isEditTool,
	parseSseChunk,
	parseStoredParts,
	parseStoredTools,
	sanitizeAssistantPartsForStorage,
	serializeAssistantPartsForStorage,
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

		const json = serializeAssistantPartsForStorage(parts);
		expect(json).not.toBeNull();
		const stored = parseStoredParts(json);
		expect(stored).toHaveLength(3);
		expect(stored?.[1]).toMatchObject({
			type: "tool",
			tool: {
				id: "t1",
				name: "edit",
				status: "done",
				args: { path: "App.tsx" },
				result: "ok",
			},
		});
	});

	it("round-trips interleaved parts through storage serialization", () => {
		let parts = appendAssistantTextDelta([], "before");
		parts =
			applyAgentToolEventToParts(parts, {
				type: "tool_execution_end",
				toolCallId: "t2",
				toolName: "read_file",
				args: { path: "x.ts" },
				result: "content",
				isError: false,
			}) ?? parts;
		parts = appendAssistantTextDelta(parts, "after");

		const json = serializeAssistantPartsForStorage(parts);
		const restored = parseStoredParts(json);
		expect(restored?.filter((p) => p.type === "tool")).toHaveLength(1);
		expect(restored?.find((p) => p.type === "tool")).toMatchObject({
			tool: { name: "read_file", status: "done" },
		});
	});

	it("serializes large tool results without throwing", () => {
		const huge = "x".repeat(120_000);
		const parts =
			applyAgentToolEventToParts([], {
				type: "tool_execution_end",
				toolCallId: "t-big",
				toolName: "bash",
				result: huge,
				isError: false,
			}) ?? [];

		expect(() => serializeAssistantPartsForStorage(parts)).not.toThrow();
		const json = serializeAssistantPartsForStorage(parts);
		expect(json).not.toBeNull();
		const restored = parseStoredParts(json);
		const tool = restored?.find((p) => p.type === "tool");
		expect(tool?.type === "tool" && tool.tool.name).toBe("bash");
		expect(tool?.type === "tool" && typeof tool.tool.result).toBe("string");
		expect(
			tool?.type === "tool" && (tool.tool.result as string).length,
		).toBeLessThan(huge.length);
	});

	it("sanitizes BigInt tool args for JSON storage", () => {
		const parts: ReturnType<typeof appendAssistantTextDelta> = [
			{
				type: "tool",
				id: "tool-1",
				tool: {
					id: "t-bigint",
					name: "custom",
					status: "done",
					args: { offset: BigInt(42) },
				},
			},
		];
		const sanitized = sanitizeAssistantPartsForStorage(parts);
		expect(sanitized[0]?.type === "tool" && sanitized[0].tool.args).toEqual({
			offset: "42",
		});
		const json = serializeAssistantPartsForStorage(parts);
		const restored = parseStoredParts(json);
		expect(restored?.[0]).toMatchObject({
			type: "tool",
			tool: { name: "custom", status: "done", args: { offset: "42" } },
		});
	});

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

		// Multi-edit with usable patch: patch only (no synthetic join)
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

		// Multi-edit without patch: join is last-resort fallback
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

		// Simulate load after refresh: DB tools column → parseStoredParts
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
