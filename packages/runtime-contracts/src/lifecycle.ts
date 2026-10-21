import { type ArchiveArtifactV1, parseArchiveArtifactV1 } from "./artifacts.js";
import {
	type ConfigurationSelectionV1,
	parseConfigurationSelectionV1,
} from "./configuration.js";
import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

/** Upper bound on a continuation's copied model context, in encoded bytes. */
export const CONTINUATION_SEED_BYTES = 1024 * 1024;

/**
 * What an archived session hands to its continuation: the model context of
 * its final pair, its model selection and the immutable archive that seeds
 * the new workspace. It carries no task, inbox, run or executor authority.
 */
export type ContinuationSeedV1 = {
	version: 1;
	sourceSessionId: string;
	sourcePairId: string;
	selection: ConfigurationSelectionV1 | null;
	/** Pi model messages of the final pair's active context, in order. */
	messages: unknown[];
	/** SHA-256 of the canonical JSON of `messages`. */
	messagesDigest: string;
	archive: ArchiveArtifactV1;
};

export function parseContinuationSeedV1(input: unknown): ContinuationSeedV1 {
	const row = strictRecord(
		decodeContractInput(input, CONTINUATION_SEED_BYTES + 16 * 1024),
		[
			"version",
			"sourceSessionId",
			"sourcePairId",
			"selection",
			"messages",
			"messagesDigest",
			"archive",
		],
		"Continuation seed",
	);
	if (!Array.isArray(row.messages))
		throw new ContractParseError("invalid_field", "messages is invalid.");
	const messagesDigest = stringField(row, "messagesDigest", { maxBytes: 64 });
	if (!/^[a-f0-9]{64}$/.test(messagesDigest))
		throw new ContractParseError("invalid_field", "messagesDigest is invalid.");
	return {
		version: literalField(row, "version", [1]),
		sourceSessionId: stringField(row, "sourceSessionId", { maxBytes: 256 }),
		sourcePairId: stringField(row, "sourcePairId", { maxBytes: 256 }),
		selection:
			row.selection === null
				? null
				: parseConfigurationSelectionV1(row.selection),
		messages: row.messages,
		messagesDigest,
		archive: parseArchiveArtifactV1(row.archive),
	};
}

/** The destination's acknowledgment: the imported context matched the seed. */
export type ContinuationImportV1 = {
	version: 1;
	sourceSessionId: string;
	sourcePairId: string;
	messagesDigest: string;
	messageCount: number;
};

export function parseContinuationImportV1(
	input: unknown,
	seed: Pick<
		ContinuationSeedV1,
		"sourceSessionId" | "sourcePairId" | "messagesDigest"
	>,
): ContinuationImportV1 {
	const row = strictRecord(
		input,
		[
			"version",
			"sourceSessionId",
			"sourcePairId",
			"messagesDigest",
			"messageCount",
		],
		"Continuation import",
	);
	const result: ContinuationImportV1 = {
		version: literalField(row, "version", [1]),
		sourceSessionId: stringField(row, "sourceSessionId", { maxBytes: 256 }),
		sourcePairId: stringField(row, "sourcePairId", { maxBytes: 256 }),
		messagesDigest: stringField(row, "messagesDigest", { maxBytes: 64 }),
		messageCount: integerField(row, "messageCount", { minimum: 0 }),
	};
	if (
		result.sourceSessionId !== seed.sourceSessionId ||
		result.sourcePairId !== seed.sourcePairId ||
		result.messagesDigest !== seed.messagesDigest
	)
		throw new ContractParseError(
			"invalid_field",
			"Continuation import does not match its seed.",
		);
	return result;
}

/** A user's request to continue an archived session in a new one. */
export type BrowserContinuationV1 = {
	version: 1;
	idempotencyKey: string;
	projectId: string;
	sourceSessionId: string;
};

export function parseBrowserContinuationV1(
	input: unknown,
): BrowserContinuationV1 {
	const row = strictRecord(
		decodeContractInput(input, 4096),
		["version", "idempotencyKey", "projectId", "sourceSessionId"],
		"BrowserContinuationV1",
	);
	return {
		version: literalField(row, "version", [1]),
		idempotencyKey: stringField(row, "idempotencyKey", { maxBytes: 256 }),
		projectId: stringField(row, "projectId", { maxBytes: 256 }),
		sourceSessionId: stringField(row, "sourceSessionId", { maxBytes: 256 }),
	};
}
