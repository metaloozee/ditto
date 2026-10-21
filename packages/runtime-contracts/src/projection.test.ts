import { describe, expect, it } from "vitest";
import {
	PROJECTION_LIMITS,
	parseProjectionIntentsV1,
	parseProjectionIntentV1,
	parseProjectionResultsV1,
} from "./projection.js";

const intent = {
	version: 1,
	assistantMessageId: "assistant-1",
	commandId: "command-1",
	runId: "command-1",
	runEpoch: 1,
	status: "complete",
	reason: null,
	projectionVersion: 1,
	content: "Synthetic answer",
};

describe("projection contracts", () => {
	it("accepts exact terminal intents and rejects reasons, content and fields that do not fit", () => {
		expect(parseProjectionIntentV1(intent)).toEqual(intent);
		expect(
			parseProjectionIntentV1({
				...intent,
				status: "failed",
				reason: "run_stopped",
				content: undefined,
			}),
		).toMatchObject({ status: "failed", reason: "run_stopped" });
		for (const bad of [
			{ ...intent, status: "pending" },
			{ ...intent, reason: "run_failed" },
			{ ...intent, status: "failed", reason: null, content: undefined },
			{ ...intent, status: "failed", reason: "run_failed" },
			{ ...intent, content: "x".repeat(PROJECTION_LIMITS.contentBytes + 3) },
			{ ...intent, projectionVersion: 0 },
			{ ...intent, extra: true },
		])
			expect(() => parseProjectionIntentV1(bad)).toThrow();
		expect(() => parseProjectionIntentsV1([intent, intent])).toThrow();
		expect(() => parseProjectionIntentsV1([])).toThrow();
	});

	it("treats missing, short, reordered or mismatched acknowledgments as failures", () => {
		const intents = parseProjectionIntentsV1([
			intent,
			{ ...intent, assistantMessageId: "assistant-2" },
		]);
		const ok = intents.map((item) => ({
			assistantMessageId: item.assistantMessageId,
			projectionVersion: item.projectionVersion,
			outcome: "applied",
		}));
		expect(parseProjectionResultsV1(ok, intents)).toEqual(ok);
		for (const bad of [
			undefined,
			[],
			ok.slice(0, 1),
			[...ok].reverse(),
			[ok[0], { ...ok[1], projectionVersion: 2 }],
			[ok[0], { ...ok[1], outcome: "maybe" }],
		])
			expect(() => parseProjectionResultsV1(bad, intents)).toThrow();
	});
});
