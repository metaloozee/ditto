import { describe, expect, it } from "vitest";
import {
	appendAssistantTextDelta,
	applyAgentToolEvent,
	applyAgentToolEventToParts,
	finalizeAssistantParts,
	finalizeStreamTools,
	partsToText,
	partsToTools,
} from "./agent-message-parts";

describe("agent-message-parts", () => {
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

	it("retains lifecycle timing across start/update/end", () => {
		const started = applyAgentToolEvent(
			[],
			{
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: "bash",
				args: { command: "ls" },
			},
			1_000,
		);
		expect(started?.[0]).toMatchObject({
			status: "running",
			startedAt: 1_000,
		});
		expect(started?.[0]?.endedAt).toBeUndefined();

		const updated = applyAgentToolEvent(
			started ?? [],
			{
				type: "tool_execution_update",
				toolCallId: "t1",
				toolName: "bash",
				args: { command: "ls" },
				partialResult: "partial",
			},
			2_000,
		);
		expect(updated?.[0]).toMatchObject({
			status: "running",
			startedAt: 1_000,
			result: "partial",
		});
		expect(updated?.[0]?.endedAt).toBeUndefined();

		const ended = applyAgentToolEvent(
			updated ?? [],
			{
				type: "tool_execution_end",
				toolCallId: "t1",
				toolName: "bash",
				result: "done",
				isError: false,
			},
			5_000,
		);
		expect(ended?.[0]).toEqual({
			id: "t1",
			name: "bash",
			status: "done",
			args: { command: "ls" },
			result: "done",
			startedAt: 1_000,
			endedAt: 5_000,
		});
	});

	it("end-only records both startedAt and endedAt as the occurrence time", () => {
		const ended = applyAgentToolEvent(
			[],
			{
				type: "tool_execution_end",
				toolCallId: "t-end",
				toolName: "bash",
				result: "ok",
				isError: false,
			},
			5_000,
		);
		expect(ended?.[0]).toMatchObject({
			startedAt: 5_000,
			endedAt: 5_000,
			status: "done",
		});
	});

	it("finalizing a running tool preserves start and records settlement end", () => {
		const tools = finalizeStreamTools(
			[
				{
					id: "t1",
					name: "bash",
					status: "running",
					startedAt: 3_000,
				},
			],
			8_000,
		);
		expect(tools[0]).toEqual({
			id: "t1",
			name: "bash",
			status: "done",
			startedAt: 3_000,
			endedAt: 8_000,
		});

		const parts = finalizeAssistantParts(
			[
				{
					type: "tool",
					id: "p1",
					tool: {
						id: "t1",
						name: "bash",
						status: "running",
						startedAt: 3_000,
					},
				},
			],
			8_000,
		);
		expect(parts[0]).toMatchObject({
			tool: { status: "done", startedAt: 3_000, endedAt: 8_000 },
		});
	});

	it("keeps text and tools interleaved in parts timeline", () => {
		let parts = appendAssistantTextDelta([], "I'll edit the file.");
		parts =
			applyAgentToolEventToParts(
				parts,
				{
					type: "tool_execution_start",
					toolCallId: "t1",
					toolName: "edit",
					args: { path: "App.tsx" },
				},
				100,
			) ?? parts;
		parts =
			applyAgentToolEventToParts(
				parts,
				{
					type: "tool_execution_end",
					toolCallId: "t1",
					toolName: "edit",
					result: "ok",
					isError: false,
				},
				200,
			) ?? parts;
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
				startedAt: 100,
				endedAt: 200,
			},
		});
		expect(parts[2]).toMatchObject({ type: "text", text: "Done." });
		expect(partsToText(parts)).toBe("I'll edit the file.\n\nDone.");
		expect(partsToTools(parts)).toHaveLength(1);
	});

	it("finalizeAssistantParts marks running tools done", () => {
		const parts = finalizeAssistantParts([
			{
				type: "tool",
				id: "p1",
				tool: { id: "t1", name: "bash", status: "running" },
			},
		]);
		expect(parts[0]).toMatchObject({
			tool: { status: "done" },
		});
		expect(
			parts[0]?.type === "tool" ? parts[0].tool.endedAt : undefined,
		).toBeUndefined();
	});
});
