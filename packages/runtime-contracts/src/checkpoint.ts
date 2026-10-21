import {
	ContractParseError,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";
import type { ProjectionOutcome } from "./projection.js";
import { PROJECTION_LIMITS, PROJECTION_OUTCOMES } from "./projection.js";

/**
 * A committed pointer move after paired publication. The product applies it
 * update-only, and only when its stored mutation generation still equals
 * `expectedMutationGeneration`. Archive and context references stay in the
 * runtime.
 */
export type CheckpointProjectionV1 = {
	version: 1;
	currentPairId: string;
	previousPairId: string | null;
	mutationGeneration: number;
	expectedMutationGeneration: number;
	projectionVersion: number;
};

export type CheckpointProjectionResultV1 = {
	projectionVersion: number;
	outcome: ProjectionOutcome;
};

const id = (record: Record<string, unknown>, key: string) =>
	stringField(record, key, { maxCharacters: PROJECTION_LIMITS.idCharacters });

export function parseCheckpointProjectionV1(
	value: unknown,
): CheckpointProjectionV1 {
	const row = strictRecord(
		value,
		[
			"version",
			"currentPairId",
			"previousPairId",
			"mutationGeneration",
			"expectedMutationGeneration",
			"projectionVersion",
		],
		"Checkpoint projection",
	);
	const projection: CheckpointProjectionV1 = {
		version: literalField(row, "version", [1]),
		currentPairId: id(row, "currentPairId"),
		previousPairId:
			row.previousPairId === null ? null : id(row, "previousPairId"),
		mutationGeneration: integerField(row, "mutationGeneration", {
			minimum: 1,
		}),
		expectedMutationGeneration: integerField(
			row,
			"expectedMutationGeneration",
			{ minimum: 0 },
		),
		projectionVersion: integerField(row, "projectionVersion", { minimum: 1 }),
	};
	if (
		projection.expectedMutationGeneration + 1 !==
			projection.mutationGeneration ||
		projection.previousPairId === projection.currentPairId
	)
		throw new ContractParseError(
			"invalid_field",
			"Checkpoint projection does not advance one generation.",
		);
	return projection;
}

/** Pointer moves form a chain, so a batch must be consecutive and ordered. */
export function parseCheckpointProjectionsV1(
	value: unknown,
): CheckpointProjectionV1[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > PROJECTION_LIMITS.batch
	)
		throw new ContractParseError(
			"invalid_field",
			"Checkpoint projection batch invalid.",
		);
	const projections = value.map(parseCheckpointProjectionV1);
	for (let index = 1; index < projections.length; index++) {
		const prior = projections[index - 1];
		const next = projections[index];
		if (
			!prior ||
			!next ||
			next.expectedMutationGeneration !== prior.mutationGeneration ||
			next.previousPairId !== prior.currentPairId ||
			next.projectionVersion <= prior.projectionVersion
		)
			throw new ContractParseError(
				"invalid_field",
				"Checkpoint projection batch is not a chain.",
			);
	}
	return projections;
}

export function parseCheckpointProjectionResultsV1(
	value: unknown,
	projections: readonly CheckpointProjectionV1[],
): CheckpointProjectionResultV1[] {
	if (!Array.isArray(value) || value.length !== projections.length)
		throw new ContractParseError(
			"invalid_field",
			"Checkpoint acknowledgment does not match its batch.",
		);
	return value.map((item, index) => {
		const row = strictRecord(
			item,
			["projectionVersion", "outcome"],
			"Checkpoint projection result",
		);
		const result = {
			projectionVersion: integerField(row, "projectionVersion", {
				minimum: 1,
			}),
			outcome: literalField(row, "outcome", PROJECTION_OUTCOMES),
		};
		if (result.projectionVersion !== projections[index]?.projectionVersion)
			throw new ContractParseError(
				"invalid_field",
				"Checkpoint acknowledgment does not match its batch.",
			);
		return result;
	});
}
