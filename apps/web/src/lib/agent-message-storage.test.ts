import { describe, expect, it } from "vitest";
import {
	appendAssistantTextDelta,
	applyAgentToolEventToParts,
} from "./agent-message-parts";
import {
	parseStoredParts,
	parseStoredTools,
	prepareAssistantMessageStorage,
	sanitizeAssistantPartsForStorage,
	serializeAssistantPartsForStorage,
	serializeAssistantPartsMinimalForStorage,
} from "./agent-message-storage";
import { redactStructured } from "./secret-redaction";

describe("agent-message-storage", () => {
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

	it("primary and minimal storage serialization never contain fixture secrets from redacted tool events", () => {
		const fixtureSecret = "live-secret-value-123";
		const rawEvent = {
			type: "tool_execution_end",
			toolCallId: "t-secret",
			toolName: "bash",
			args: { command: `echo ${fixtureSecret}` },
			result: {
				stdout: `export TOKEN=${fixtureSecret}`,
				nested: [fixtureSecret, { url: `postgres://secret-db-url-xyz` }],
			},
			isError: false,
		};
		const sanitizedEvent = redactStructured(rawEvent, [
			fixtureSecret,
			"postgres://secret-db-url-xyz",
		]);

		const parts =
			applyAgentToolEventToParts([], sanitizedEvent) ??
			appendAssistantTextDelta([], "");

		const { toolsColumn, storageParts } = prepareAssistantMessageStorage(parts);
		const minimal = serializeAssistantPartsMinimalForStorage(parts);
		const full = serializeAssistantPartsForStorage(parts);

		for (const serialized of [toolsColumn, minimal, full]) {
			expect(serialized).not.toBeNull();
			expect(serialized).not.toContain(fixtureSecret);
			expect(serialized).not.toContain("postgres://secret-db-url-xyz");
		}
		expect(toolsColumn).toContain("[REDACTED]");
		expect(full).toContain("[REDACTED]");
		expect(storageParts.some((p) => p.type === "tool")).toBe(true);
		const toolPart = storageParts.find((p) => p.type === "tool");
		expect(toolPart?.type === "tool" && toolPart.tool.name).toBe("bash");
		expect(toolPart?.type === "tool" && toolPart.tool.id).toBe("t-secret");
	});

	it("parses legacy flat tool list with optional content fallback", () => {
		const parts = parseStoredParts(
			JSON.stringify([
				{ id: "t1", name: "bash", status: "done", result: "ok" },
			]),
			"hello",
		);
		expect(parts?.[0]).toMatchObject({ type: "text", text: "hello" });
		expect(parts?.[1]).toMatchObject({
			type: "tool",
			tool: { id: "t1", name: "bash" },
		});
		expect(
			parts?.[1]?.type === "tool" ? parts[1].tool.startedAt : undefined,
		).toBeUndefined();
	});

	it("round-trips startedAt/endedAt through full and minimal storage", () => {
		const parts =
			applyAgentToolEventToParts(
				[],
				{
					type: "tool_execution_start",
					toolCallId: "t-timed",
					toolName: "bash",
					args: { command: "ls" },
				},
				1_000,
			) ?? [];
		const ended =
			applyAgentToolEventToParts(
				parts,
				{
					type: "tool_execution_end",
					toolCallId: "t-timed",
					toolName: "bash",
					result: "ok",
					isError: false,
				},
				5_000,
			) ?? parts;

		const full = serializeAssistantPartsForStorage(ended);
		const fullRestored = parseStoredParts(full);
		expect(fullRestored?.[0]).toMatchObject({
			type: "tool",
			tool: {
				id: "t-timed",
				startedAt: 1_000,
				endedAt: 5_000,
			},
		});

		const minimal = serializeAssistantPartsMinimalForStorage(ended);
		const minimalRestored = parseStoredParts(minimal);
		expect(minimalRestored?.[0]).toMatchObject({
			type: "tool",
			tool: {
				id: "t-timed",
				name: "bash",
				status: "done",
				startedAt: 1_000,
				endedAt: 5_000,
			},
		});
		// Minimal drops args/results but keeps timing.
		expect(
			minimalRestored?.[0]?.type === "tool"
				? minimalRestored[0].tool.args
				: undefined,
		).toBeUndefined();
	});

	it("omits non-finite or malformed stored timing", () => {
		const parts = parseStoredParts(
			JSON.stringify([
				{
					type: "tool",
					id: "p1",
					tool: {
						id: "t1",
						name: "bash",
						status: "done",
						startedAt: Number.NaN,
						endedAt: "not-a-number",
					},
				},
				{
					type: "tool",
					id: "p2",
					tool: {
						id: "t2",
						name: "bash",
						status: "done",
						startedAt: Number.POSITIVE_INFINITY,
						endedAt: 9_000,
					},
				},
			]),
		);
		expect(parts?.[0]).toMatchObject({
			tool: { id: "t1", name: "bash", status: "done" },
		});
		expect(
			parts?.[0]?.type === "tool" ? parts[0].tool.startedAt : undefined,
		).toBeUndefined();
		expect(
			parts?.[0]?.type === "tool" ? parts[0].tool.endedAt : undefined,
		).toBeUndefined();
		expect(parts?.[1]).toMatchObject({
			tool: { id: "t2", endedAt: 9_000 },
		});
		expect(
			parts?.[1]?.type === "tool" ? parts[1].tool.startedAt : undefined,
		).toBeUndefined();
	});
});
