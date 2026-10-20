import { describe, expect, it } from "vitest";
import {
	parseRemoteToolArguments,
	parseToolOperationV1,
	parseToolOutcomeV1,
	TOOL_EXECUTION_LIMITS,
} from "./tool-execution.js";

const operation = {
	version: 1,
	operationId: "pi.tool/7/call-1/attempt/1",
	workspaceSessionId: "session",
	executorGeneration: 1,
	epoch: 1,
	deadlineAt: 10_000,
	tool: "edit",
	arguments: { path: "src/a.ts", edits: [{ oldText: "a", newText: "" }] },
};

describe("remote tool execution contract", () => {
	it("parses each typed tool and preserves exact text", () => {
		expect(parseToolOperationV1(operation)).toEqual(operation);
		expect(
			parseRemoteToolArguments("write", { path: "a", content: "" }),
		).toEqual({ path: "a", content: "" });
		expect(
			parseRemoteToolArguments("grep", {
				pattern: "x",
				context: 0,
				ignoreCase: true,
			}),
		).toEqual({ pattern: "x", context: 0, ignoreCase: true });
		expect(parseRemoteToolArguments("ls", {})).toEqual({});
	});

	it("rejects unknown tools, fields and oversized mutations before dispatch", () => {
		expect(() =>
			parseToolOperationV1({ ...operation, tool: "cooperative_remote" }),
		).toThrow();
		expect(() =>
			parseRemoteToolArguments("read", { path: "a", image: true }),
		).toThrow(/unknown field/);
		expect(() =>
			parseRemoteToolArguments("write", {
				path: "a",
				content: "x".repeat(TOOL_EXECUTION_LIMITS.mutationBytes + 1),
			}),
		).toThrow(/byte limit/);
		expect(() =>
			parseRemoteToolArguments("edit", { path: "a", edits: [] }),
		).toThrow();
		expect(() =>
			parseRemoteToolArguments("bash", { command: "true", timeout: 0 }),
		).toThrow();
	});

	it("binds outcomes to their exact operation", () => {
		const completed = {
			version: 1,
			operationId: operation.operationId,
			status: "completed",
			isError: false,
			text: "ok",
			truncated: false,
		};
		expect(parseToolOutcomeV1(completed, operation.operationId)).toEqual(
			completed,
		);
		expect(() => parseToolOutcomeV1(completed, "other")).toThrow(
			/another operation/,
		);
		expect(
			parseToolOutcomeV1(
				{
					version: 1,
					operationId: "op",
					status: "unknown",
					message: "Shell dispatch interrupted",
				},
				"op",
			).status,
		).toBe("unknown");
		expect(() =>
			parseToolOutcomeV1(
				{ ...completed, operationId: "op", reason: "conflict" },
				"op",
			),
		).toThrow(/unknown field/);
	});
});
