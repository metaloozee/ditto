import { describe, expect, it } from "vitest";
import {
	parseCheckpointProjectionResultsV1,
	parseCheckpointProjectionsV1,
	parseCheckpointProjectionV1,
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
});
