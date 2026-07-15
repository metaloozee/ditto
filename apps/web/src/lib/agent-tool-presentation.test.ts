import { describe, expect, it } from "vitest";
import type { StreamToolCall } from "./agent-message-parts";
import {
	findActiveToolGroupIndex,
	formatElapsedDuration,
	getToolGroupElapsedMs,
	groupAssistantParts,
} from "./agent-tool-presentation";

function tool(
	partial: Pick<StreamToolCall, "id"> & Partial<StreamToolCall>,
): StreamToolCall {
	return {
		name: "bash",
		status: "done",
		...partial,
	};
}

describe("getToolGroupElapsedMs", () => {
	it("uses earliest start to latest end for serial tools", () => {
		const elapsed = getToolGroupElapsedMs([
			tool({ id: "a", startedAt: 0, endedAt: 1_000 }),
			tool({ id: "b", startedAt: 2_000, endedAt: 4_000 }),
		]);
		expect(elapsed).toBe(4_000);
	});

	it("does not sum overlapping tool executions", () => {
		const elapsed = getToolGroupElapsedMs([
			tool({ id: "a", startedAt: 0, endedAt: 5_000 }),
			tool({ id: "b", startedAt: 1_000, endedAt: 3_000 }),
		]);
		expect(elapsed).toBe(5_000);
	});

	it("returns null when any tool is missing timing", () => {
		expect(
			getToolGroupElapsedMs([
				tool({ id: "a", startedAt: 0, endedAt: 1_000 }),
				tool({ id: "b" }),
			]),
		).toBeNull();
		expect(getToolGroupElapsedMs([tool({ id: "a", startedAt: 0 })])).toBeNull();
		expect(getToolGroupElapsedMs([])).toBeNull();
	});

	it("clamps reversed clocks to zero", () => {
		expect(
			getToolGroupElapsedMs([
				tool({ id: "a", startedAt: 5_000, endedAt: 1_000 }),
			]),
		).toBe(0);
	});
});

describe("formatElapsedDuration", () => {
	it("formats the behavior-contract examples", () => {
		expect(formatElapsedDuration(4_000)).toBe("4s");
		expect(formatElapsedDuration(1_023_000)).toBe("17m 3s");
		expect(formatElapsedDuration(3_723_000)).toBe("1h 2m 3s");
		expect(formatElapsedDuration(60_000)).toBe("1m");
		expect(formatElapsedDuration(0)).toBe("0s");
		expect(formatElapsedDuration(1)).toBe("1s");
		expect(formatElapsedDuration(499)).toBe("1s");
		expect(formatElapsedDuration(500)).toBe("1s");
	});

	it("omits zero-valued interior units", () => {
		expect(formatElapsedDuration(3_600_000)).toBe("1h");
		expect(formatElapsedDuration(3_601_000)).toBe("1h 1s");
		expect(formatElapsedDuration(3_660_000)).toBe("1h 1m");
	});

	it("treats non-finite and negative as 0s", () => {
		expect(formatElapsedDuration(Number.NaN)).toBe("0s");
		expect(formatElapsedDuration(-100)).toBe("0s");
	});
});

describe("findActiveToolGroupIndex", () => {
	it("selects only the newest tools group while streaming", () => {
		const groups = groupAssistantParts([
			{
				type: "tool",
				id: "p1",
				tool: tool({ id: "t1", name: "bash", status: "done" }),
			},
			{
				type: "text",
				id: "txt",
				text: "between",
			},
			{
				type: "tool",
				id: "p2",
				tool: tool({ id: "t2", name: "bash", status: "done" }),
			},
		]);
		expect(findActiveToolGroupIndex(groups, true)).toBe(2);
		expect(findActiveToolGroupIndex(groups, false)).toBe(-1);
		expect(groups[2]?.type).toBe("tools");
	});
});
