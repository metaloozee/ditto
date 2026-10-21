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

/**
 * Durable runtime evidence that a restore finished: files, the active
 * conversation generation and every disposition through the cutoff exist.
 * Only this exact acknowledgment reopens ordinary product admission.
 */
export type RestoreCompletionV1 = {
	version: 1;
	restoreCommandId: string;
	/** The pair the command named; `restoredPairId` differs only on fallback. */
	pairId: string;
	restoredPairId: string;
	fallback: boolean;
	cutoffSeq: number;
	conversationGeneration: number;
};

/**
 * The runtime refused a restore before its fence: the named pair or
 * generation no longer matches the runtime pointer. Nothing was discarded,
 * so this releases the barrier without a restore.
 */
export type RestoreRefusalV1 = {
	version: 1;
	restoreCommandId: string;
	pairId: string;
	cutoffSeq: number;
	refused: "stale";
};

export type RestoreCompletionResultV1 = {
	restoreCommandId: string;
	outcome: ProjectionOutcome;
};

export function parseRestoreCompletionV1(value: unknown): RestoreCompletionV1 {
	const row = strictRecord(
		value,
		[
			"version",
			"restoreCommandId",
			"pairId",
			"restoredPairId",
			"fallback",
			"cutoffSeq",
			"conversationGeneration",
		],
		"Restore completion",
	);
	if (typeof row.fallback !== "boolean")
		throw new ContractParseError("invalid_field", "fallback is invalid.");
	const completion: RestoreCompletionV1 = {
		version: literalField(row, "version", [1]),
		restoreCommandId: id(row, "restoreCommandId"),
		pairId: id(row, "pairId"),
		restoredPairId: id(row, "restoredPairId"),
		fallback: row.fallback,
		cutoffSeq: integerField(row, "cutoffSeq", { minimum: 0 }),
		conversationGeneration: integerField(row, "conversationGeneration", {
			minimum: 2,
		}),
	};
	if (completion.fallback !== (completion.pairId !== completion.restoredPairId))
		throw new ContractParseError(
			"invalid_field",
			"Restore fallback does not match its pairs.",
		);
	return completion;
}

/** A restore outcome: a completion, or a refusal tagged by `refused`. */
export function parseRestoreOutcomeV1(
	value: unknown,
): RestoreCompletionV1 | RestoreRefusalV1 {
	if (typeof value !== "object" || value === null || !("refused" in value))
		return parseRestoreCompletionV1(value);
	const row = strictRecord(
		value,
		["version", "restoreCommandId", "pairId", "cutoffSeq", "refused"],
		"Restore refusal",
	);
	return {
		version: literalField(row, "version", [1]),
		restoreCommandId: id(row, "restoreCommandId"),
		pairId: id(row, "pairId"),
		cutoffSeq: integerField(row, "cutoffSeq", { minimum: 0 }),
		refused: literalField(row, "refused", ["stale"]),
	};
}

export function parseRestoreCompletionResultV1(
	value: unknown,
	completion: { restoreCommandId: string },
): RestoreCompletionResultV1 {
	const row = strictRecord(
		value,
		["restoreCommandId", "outcome"],
		"Restore completion result",
	);
	const result = {
		restoreCommandId: id(row, "restoreCommandId"),
		outcome: literalField(row, "outcome", PROJECTION_OUTCOMES),
	};
	if (result.restoreCommandId !== completion.restoreCommandId)
		throw new ContractParseError(
			"invalid_field",
			"Restore acknowledgment does not match its completion.",
		);
	return result;
}
