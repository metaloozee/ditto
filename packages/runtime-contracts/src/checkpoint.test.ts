import { describe, expect, it } from "vitest";
import {
	parseCheckpointProjectionResultsV1,
	parseCheckpointProjectionsV1,
	parseCheckpointProjectionV1,
	parseRestoreCompletionResultV1,
	parseRestoreCompletionV1,
	parseRestoreOutcomeV1,
} from "./checkpoint.js";

const first = {
	version: 1,
	currentPairId: "pair-1",
	previousPairId: null,
	mutationGeneration: 1,
	expectedMutationGeneration: 0,
	projectionVersion: 1,
};
const second = {
	...first,
	currentPairId: "pair-2",
	previousPairId: "pair-1",
	mutationGeneration: 2,
	expectedMutationGeneration: 1,
	projectionVersion: 2,
};

describe("checkpoint projection contracts", () => {
	it("accepts one-generation pointer moves and rejects anything else", () => {
		expect(parseCheckpointProjectionV1(first)).toEqual(first);
		for (const bad of [
			{ ...first, mutationGeneration: 2 },
			{ ...first, mutationGeneration: 0, expectedMutationGeneration: -1 },
			{ ...second, previousPairId: "pair-2" },
			{ ...first, projectionVersion: 0 },
			{ ...first, archiveKey: "workspace/x" },
		])
			expect(() => parseCheckpointProjectionV1(bad)).toThrow();
	});

	it("requires a batch to be an ordered chain and its acknowledgment to answer it exactly", () => {
		expect(parseCheckpointProjectionsV1([first, second])).toHaveLength(2);
		expect(() => parseCheckpointProjectionsV1([second, first])).toThrow();
		expect(() =>
			parseCheckpointProjectionsV1([
				first,
				{ ...second, previousPairId: "other" },
			]),
		).toThrow();
		expect(() => parseCheckpointProjectionsV1([])).toThrow();
		const batch = parseCheckpointProjectionsV1([first, second]);
		expect(
			parseCheckpointProjectionResultsV1(
				[
					{ projectionVersion: 1, outcome: "applied" },
					{ projectionVersion: 2, outcome: "retry" },
				],
				batch,
			),
		).toEqual([
			{ projectionVersion: 1, outcome: "applied" },
			{ projectionVersion: 2, outcome: "retry" },
		]);
		expect(() =>
			parseCheckpointProjectionResultsV1(
				[{ projectionVersion: 1, outcome: "applied" }],
				batch,
			),
		).toThrow();
		expect(() =>
			parseCheckpointProjectionResultsV1(
				[
					{ projectionVersion: 2, outcome: "applied" },
					{ projectionVersion: 1, outcome: "applied" },
				],
				batch,
			),
		).toThrow();
	});

	it("binds a restore completion to its pairs and its acknowledgment to that restore", () => {
		const completion = {
			version: 1,
			restoreCommandId: "restore-5",
			pairId: "pair-2",
			restoredPairId: "pair-2",
			fallback: false,
			cutoffSeq: 4,
			conversationGeneration: 2,
		};
		expect(parseRestoreCompletionV1(completion)).toEqual(completion);
		expect(
			parseRestoreCompletionV1({
				...completion,
				restoredPairId: "pair-1",
				fallback: true,
			}),
		).toMatchObject({ fallback: true });
		for (const bad of [
			{ fallback: true },
			{ restoredPairId: "pair-1" },
			{ conversationGeneration: 1 },
			{ cutoffSeq: -1 },
			{ version: 2 },
			{ archiveKey: "workspace/x" },
		])
			expect(() =>
				parseRestoreCompletionV1({ ...completion, ...bad }),
			).toThrow();
		expect(
			parseRestoreCompletionResultV1(
				{ restoreCommandId: "restore-5", outcome: "applied" },
				completion,
			),
		).toEqual({ restoreCommandId: "restore-5", outcome: "applied" });
		for (const bad of [
			{ restoreCommandId: "restore-6", outcome: "applied" },
			{ restoreCommandId: "restore-5", outcome: "done" },
			{ restoreCommandId: "restore-5" },
		])
			expect(() => parseRestoreCompletionResultV1(bad, completion)).toThrow();
	});

	it("tells a refusal from a completion only by its tag and parses each strictly", () => {
		const refusal = {
			version: 1,
			restoreCommandId: "restore-5",
			pairId: "pair-2",
			cutoffSeq: 4,
			refused: "stale",
		};
		expect(parseRestoreOutcomeV1(refusal)).toEqual(refusal);
		for (const bad of [
			{ refused: "other" },
			{ restoredPairId: "pair-2" },
			{ cutoffSeq: -1 },
			{ version: 2 },
		])
			expect(() => parseRestoreOutcomeV1({ ...refusal, ...bad })).toThrow();
		expect(
			parseRestoreOutcomeV1({
				version: 1,
				restoreCommandId: "restore-5",
				pairId: "pair-2",
				restoredPairId: "pair-2",
				fallback: false,
				cutoffSeq: 4,
				conversationGeneration: 2,
			}),
		).not.toHaveProperty("refused");
	});
});
