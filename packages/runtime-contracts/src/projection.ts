import {
	ContractParseError,
	encodedBytes,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

/** Declared bounds for terminal projections and runtime observations. */
export const PROJECTION_LIMITS = {
	contentBytes: 64_000,
	batch: 16,
	idCharacters: 128,
	events: 256,
	assistants: 512,
	runs: 256,
	observationBytes: 256_000,
} as const;

export const PROJECTION_REASONS = [
	"run_failed",
	"run_stopped",
	"command_canceled",
	"command_expired",
	"command_failed",
	"target_run_terminal",
] as const;
export type ProjectionReason = (typeof PROJECTION_REASONS)[number];

export const PROJECTION_OUTCOMES = [
	"applied",
	"already_applied",
	"stale_owner",
	"deleted",
	"immutable_completed",
	"blocked_membership",
	"retry",
] as const;
export type ProjectionOutcome = (typeof PROJECTION_OUTCOMES)[number];

/** A committed terminal assistant decision waiting for product application. */
export type ProjectionIntentV1 = {
	version: 1;
	assistantMessageId: string;
	commandId: string;
	runId: string;
	runEpoch: number;
	status: "complete" | "failed";
	reason: ProjectionReason | null;
	projectionVersion: number;
	content?: string;
};

export type ProjectionResultV1 = {
	assistantMessageId: string;
	projectionVersion: number;
	outcome: ProjectionOutcome;
};

const id = (record: Record<string, unknown>, key: string) =>
	stringField(record, key, {
		maxCharacters: PROJECTION_LIMITS.idCharacters,
	});

export function parseProjectionIntentV1(value: unknown): ProjectionIntentV1 {
	const row = strictRecord(
		value,
		[
			"version",
			"assistantMessageId",
			"commandId",
			"runId",
			"runEpoch",
			"status",
			"reason",
			"projectionVersion",
			"content",
		],
		"Projection intent",
	);
	const status = literalField(row, "status", ["complete", "failed"] as const);
	const reason =
		row.reason === null
			? null
			: literalField(row, "reason", PROJECTION_REASONS);
	if ((status === "complete") !== (reason === null))
		throw new ContractParseError(
			"invalid_field",
			"Only failed projections carry a reason.",
		);
	const content = row.content;
	if (content !== undefined) {
		if (
			typeof content !== "string" ||
			status !== "complete" ||
			encodedBytes(content) > PROJECTION_LIMITS.contentBytes + 2
		)
			throw new ContractParseError("invalid_field", "content is invalid.");
	}
	return {
		version: literalField(row, "version", [1]),
		assistantMessageId: id(row, "assistantMessageId"),
		commandId: id(row, "commandId"),
		runId: id(row, "runId"),
		runEpoch: integerField(row, "runEpoch", { minimum: 1 }),
		status,
		reason,
		projectionVersion: integerField(row, "projectionVersion", { minimum: 1 }),
		...(content === undefined ? {} : { content: content as string }),
	};
}

export function parseProjectionIntentsV1(value: unknown): ProjectionIntentV1[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > PROJECTION_LIMITS.batch
	)
		throw new ContractParseError("invalid_field", "Projection batch invalid.");
	const intents = value.map(parseProjectionIntentV1);
	if (
		new Set(intents.map((intent) => intent.assistantMessageId)).size !==
		intents.length
	)
		throw new ContractParseError("invalid_field", "Duplicate projection.");
	return intents;
}

/**
 * Results must answer every intent, in order, for the exact assistant and
 * version. Anything else is not an acknowledgment.
 */
export function parseProjectionResultsV1(
	value: unknown,
	intents: readonly ProjectionIntentV1[],
): ProjectionResultV1[] {
	if (!Array.isArray(value) || value.length !== intents.length)
		throw new ContractParseError(
			"invalid_field",
			"Projection acknowledgment does not match its batch.",
		);
	return value.map((item, index) => {
		const row = strictRecord(
			item,
			["assistantMessageId", "projectionVersion", "outcome"],
			"Projection result",
		);
		const intent = intents[index];
		const result = {
			assistantMessageId: id(row, "assistantMessageId"),
			projectionVersion: integerField(row, "projectionVersion", {
				minimum: 1,
			}),
			outcome: literalField(row, "outcome", PROJECTION_OUTCOMES),
		};
		if (
			!intent ||
			result.assistantMessageId !== intent.assistantMessageId ||
			result.projectionVersion !== intent.projectionVersion
		)
			throw new ContractParseError(
				"invalid_field",
				"Projection acknowledgment does not match its batch.",
			);
		return result;
	});
}

/** Product-safe runtime facts. Run lifecycle, settlement and lag stay separate. */
export type ObservationEventV1 = {
	position: number;
	kind: "assistant" | "run";
	target: string;
	run: string;
	state: string;
	reason: ProjectionReason | null;
	version: number;
};
export type ObservationSnapshotV1 = {
	runs: { id: string; state: string; epoch: number }[];
	assistants: {
		id: string;
		run: string;
		state: "complete" | "failed";
		reason: ProjectionReason | null;
		version: number;
		applied: boolean;
	}[];
	health: {
		projectionLag: number;
		safetyStopped: boolean;
		/** Present once paired checkpoints are enabled for the session. */
		recovery?: {
			status: "none" | "healthy" | "degraded" | "blocked";
			pairs: number;
			projectionLag: number;
		};
	};
};
export type RuntimeObservationV1 = {
	version: 1;
	cursor: number;
	snapshot?: ObservationSnapshotV1;
	events: ObservationEventV1[];
	more: boolean;
};
