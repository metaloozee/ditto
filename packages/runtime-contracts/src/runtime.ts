import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";
import { RUNTIME_LIMITS } from "./limits.js";

type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

function json(record: Record<string, unknown>, key: string): JsonValue {
	const value = record[key];
	if (value === undefined) {
		throw new ContractParseError("invalid_field", `${key} is required.`);
	}
	return validateJson(value, key);
}

function validateJson(value: unknown, path: string, depth = 0): JsonValue {
	if (depth > 32) {
		throw new ContractParseError(
			"invalid_json",
			`${path} exceeds maximum nesting.`,
		);
	}
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		return value.map((item, index) =>
			validateJson(item, `${path}[${index}]`, depth + 1),
		);
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) {
			throw new ContractParseError(
				"invalid_json",
				`${path} contains a non-JSON value.`,
			);
		}
		const record: { [key: string]: JsonValue } = {};
		for (const key of Object.keys(value)) {
			const item = (value as Record<string, unknown>)[key];
			if (item === undefined) {
				throw new ContractParseError(
					"invalid_json",
					`${path}.${key} is undefined.`,
				);
			}
			Object.defineProperty(record, key, {
				value: validateJson(item, `${path}.${key}`, depth + 1),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return record;
	}
	throw new ContractParseError(
		"invalid_json",
		`${path} contains a non-JSON value.`,
	);
}

function boundedId(record: Record<string, unknown>, key: string): string {
	return stringField(record, key, { maxBytes: RUNTIME_LIMITS.idBytes });
}

function decodeBounded(value: unknown, maxBytes: number): unknown {
	return decodeContractInput(value, maxBytes);
}

export type BrainEnvelopeV1 = {
	version: 1;
	brainIdentityId: string;
	brainIncarnationId: string;
	runId: string;
	attempt: number;
	runEpoch: number;
	operationId: string;
	expectedCommittedPosition: number;
	payload: JsonValue;
};

export function parseBrainEnvelopeV1(value: unknown): BrainEnvelopeV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.deliveryEnvelopeBytes);
	const record = strictRecord(
		decoded,
		[
			"version",
			"brainIdentityId",
			"brainIncarnationId",
			"runId",
			"attempt",
			"runEpoch",
			"operationId",
			"expectedCommittedPosition",
			"payload",
		],
		"BrainEnvelopeV1",
	);
	return {
		version: literalField(record, "version", [1]),
		brainIdentityId: boundedId(record, "brainIdentityId"),
		brainIncarnationId: boundedId(record, "brainIncarnationId"),
		runId: boundedId(record, "runId"),
		attempt: integerField(record, "attempt", { minimum: 1 }),
		runEpoch: integerField(record, "runEpoch", { minimum: 1 }),
		operationId: boundedId(record, "operationId"),
		expectedCommittedPosition: integerField(
			record,
			"expectedCommittedPosition",
			{
				minimum: 0,
			},
		),
		payload: json(record, "payload"),
	};
}

export type EffectV1 = {
	version: 1;
	runId: string;
	assistantEntryId: string;
	toolCallId: string;
	attempt: number;
	executorIncarnationId: string;
	runEpoch: number;
	lifecycleGeneration: number;
	deadline: number;
	arguments: JsonValue;
	outcomePolicy: "retry_safe" | "reconcile" | "never_retry";
	state: "prepared" | "admitted" | "result_recorded" | "outcome_unknown";
};

export function parseEffectV1(value: unknown): EffectV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.brainControlRecordBytes);
	const record = strictRecord(
		decoded,
		[
			"version",
			"runId",
			"assistantEntryId",
			"toolCallId",
			"attempt",
			"executorIncarnationId",
			"runEpoch",
			"lifecycleGeneration",
			"deadline",
			"arguments",
			"outcomePolicy",
			"state",
		],
		"EffectV1",
	);
	return {
		version: literalField(record, "version", [1]),
		runId: boundedId(record, "runId"),
		assistantEntryId: boundedId(record, "assistantEntryId"),
		toolCallId: boundedId(record, "toolCallId"),
		attempt: integerField(record, "attempt", { minimum: 1 }),
		executorIncarnationId: boundedId(record, "executorIncarnationId"),
		runEpoch: integerField(record, "runEpoch", { minimum: 1 }),
		lifecycleGeneration: integerField(record, "lifecycleGeneration", {
			minimum: 1,
		}),
		deadline: integerField(record, "deadline", { minimum: 1 }),
		arguments: json(record, "arguments"),
		outcomePolicy: literalField(record, "outcomePolicy", [
			"retry_safe",
			"reconcile",
			"never_retry",
		]),
		state: literalField(record, "state", [
			"prepared",
			"admitted",
			"result_recorded",
			"outcome_unknown",
		]),
	};
}

export type ContinuationV1 = {
	version: 1;
	piVersion: string;
	adapterVersion: string;
	journalVersion: number;
	entries: JsonValue[];
	selectedLeafId: string;
	compactionBoundaries: JsonValue[];
	settings: JsonValue;
	extensionState: JsonValue;
	acceptedCommandPosition: number;
	consumedCommandPosition: number;
	providerRecords: JsonValue[];
	unresolvedEffects: EffectV1[];
	checkpointPairId: string;
	mutationGeneration: number;
};

export function parseContinuationV1(value: unknown): ContinuationV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.brainControlRecordBytes);
	const record = strictRecord(
		decoded,
		[
			"version",
			"piVersion",
			"adapterVersion",
			"journalVersion",
			"entries",
			"selectedLeafId",
			"compactionBoundaries",
			"settings",
			"extensionState",
			"acceptedCommandPosition",
			"consumedCommandPosition",
			"providerRecords",
			"unresolvedEffects",
			"checkpointPairId",
			"mutationGeneration",
		],
		"ContinuationV1",
	);
	for (const key of [
		"entries",
		"compactionBoundaries",
		"providerRecords",
		"unresolvedEffects",
	] as const) {
		if (!Array.isArray(record[key])) {
			throw new ContractParseError("invalid_field", `${key} must be an array.`);
		}
	}
	const acceptedCommandPosition = integerField(
		record,
		"acceptedCommandPosition",
		{
			minimum: 0,
		},
	);
	const consumedCommandPosition = integerField(
		record,
		"consumedCommandPosition",
		{
			minimum: 0,
		},
	);
	if (consumedCommandPosition > acceptedCommandPosition) {
		throw new ContractParseError(
			"invalid_position",
			"consumedCommandPosition exceeds acceptedCommandPosition.",
		);
	}
	return {
		version: literalField(record, "version", [1]),
		piVersion: boundedId(record, "piVersion"),
		adapterVersion: boundedId(record, "adapterVersion"),
		journalVersion: integerField(record, "journalVersion", { minimum: 1 }),
		entries: (record.entries as unknown[]).map((item, index) =>
			validateJson(item, `entries[${index}]`),
		),
		selectedLeafId: boundedId(record, "selectedLeafId"),
		compactionBoundaries: (record.compactionBoundaries as unknown[]).map(
			(item, index) => validateJson(item, `compactionBoundaries[${index}]`),
		),
		settings: json(record, "settings"),
		extensionState: json(record, "extensionState"),
		acceptedCommandPosition,
		consumedCommandPosition,
		providerRecords: (record.providerRecords as unknown[]).map((item, index) =>
			validateJson(item, `providerRecords[${index}]`),
		),
		unresolvedEffects: (record.unresolvedEffects as unknown[]).map(
			parseEffectV1,
		),
		checkpointPairId: boundedId(record, "checkpointPairId"),
		mutationGeneration: integerField(record, "mutationGeneration", {
			minimum: 0,
		}),
	};
}

export type EffectSummaryV1 = {
	runId: string;
	assistantEntryId: string;
	toolCallId: string;
	state: EffectV1["state"];
};

export type CheckpointPairV1 = {
	version: 1;
	pairId: string;
	archiveRef: string;
	continuationRef: string;
	archiveDigest: string;
	continuationDigest: string;
	archiveBytes: number;
	continuationBytes: number;
	compatibilityKey: string;
	brainIdentityId: string;
	brainIncarnationId: string;
	executorIdentityId: string;
	executorIncarnationId: string;
	mutationGeneration: number;
	executionPosition: number;
	outstandingEffects: EffectSummaryV1[];
};

export function parseCheckpointPairV1(value: unknown): CheckpointPairV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.brainControlRecordBytes);
	const record = strictRecord(
		decoded,
		[
			"version",
			"pairId",
			"archiveRef",
			"continuationRef",
			"archiveDigest",
			"continuationDigest",
			"archiveBytes",
			"continuationBytes",
			"compatibilityKey",
			"brainIdentityId",
			"brainIncarnationId",
			"executorIdentityId",
			"executorIncarnationId",
			"mutationGeneration",
			"executionPosition",
			"outstandingEffects",
		],
		"CheckpointPairV1",
	);
	if (!Array.isArray(record.outstandingEffects)) {
		throw new ContractParseError(
			"invalid_field",
			"outstandingEffects must be an array.",
		);
	}
	const outstandingEffects = record.outstandingEffects.map((item) => {
		const summary = strictRecord(
			item,
			["runId", "assistantEntryId", "toolCallId", "state"],
			"EffectSummaryV1",
		);
		return {
			runId: boundedId(summary, "runId"),
			assistantEntryId: boundedId(summary, "assistantEntryId"),
			toolCallId: boundedId(summary, "toolCallId"),
			state: literalField(summary, "state", [
				"prepared",
				"admitted",
				"result_recorded",
				"outcome_unknown",
			]),
		};
	});
	return {
		version: literalField(record, "version", [1]),
		pairId: boundedId(record, "pairId"),
		archiveRef: boundedId(record, "archiveRef"),
		continuationRef: boundedId(record, "continuationRef"),
		archiveDigest: boundedId(record, "archiveDigest"),
		continuationDigest: boundedId(record, "continuationDigest"),
		archiveBytes: integerField(record, "archiveBytes", { minimum: 0 }),
		continuationBytes: integerField(record, "continuationBytes", {
			minimum: 0,
		}),
		compatibilityKey: boundedId(record, "compatibilityKey"),
		brainIdentityId: boundedId(record, "brainIdentityId"),
		brainIncarnationId: boundedId(record, "brainIncarnationId"),
		executorIdentityId: boundedId(record, "executorIdentityId"),
		executorIncarnationId: boundedId(record, "executorIncarnationId"),
		mutationGeneration: integerField(record, "mutationGeneration", {
			minimum: 0,
		}),
		executionPosition: integerField(record, "executionPosition", {
			minimum: 0,
		}),
		outstandingEffects,
	};
}

type ProjectionState = { id: string; status: string; reasonCode?: string };

export type SnapshotV1 = {
	version: 1;
	sessionId: string;
	eventCursor: number;
	commandStates: ProjectionState[];
	runStates: ProjectionState[];
	messageStates: ProjectionState[];
	interruptedHistory: boolean;
	checkpointPosition: number;
	queueState: { status: "idle" | "queued" | "running"; position?: number };
	recoveryState: { status: "healthy" | "pending" | "degraded" | "failed" };
	previewState: { status: "stopped" | "starting" | "running" | "failed" };
	projectionLag: number;
	reasonCodes: string[];
};

export function parseSnapshotV1(value: unknown): SnapshotV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.brainControlRecordBytes);
	const record = strictRecord(
		decoded,
		[
			"version",
			"sessionId",
			"eventCursor",
			"commandStates",
			"runStates",
			"messageStates",
			"interruptedHistory",
			"checkpointPosition",
			"queueState",
			"recoveryState",
			"previewState",
			"projectionLag",
			"reasonCodes",
		],
		"SnapshotV1",
	);
	for (const key of [
		"commandStates",
		"runStates",
		"messageStates",
		"reasonCodes",
	] as const) {
		if (!Array.isArray(record[key])) {
			throw new ContractParseError("invalid_field", `${key} must be an array.`);
		}
	}
	if (
		typeof record.interruptedHistory !== "boolean" ||
		!(record.reasonCodes as unknown[]).every((item) => typeof item === "string")
	) {
		throw new ContractParseError(
			"invalid_field",
			"Snapshot fields are invalid.",
		);
	}
	const stateList = (key: "commandStates" | "runStates" | "messageStates") =>
		(record[key] as unknown[]).map((item) => {
			const projection = strictRecord(
				item,
				["id", "status", "reasonCode"],
				key,
			);
			const result: ProjectionState = {
				id: boundedId(projection, "id"),
				status: boundedId(projection, "status"),
			};
			const reasonCode = stringField(projection, "reasonCode", {
				optional: true,
				maxBytes: RUNTIME_LIMITS.idBytes,
			});
			if (reasonCode) result.reasonCode = reasonCode;
			return result;
		});
	const queue = strictRecord(
		record.queueState,
		["status", "position"],
		"queueState",
	);
	const queueState: SnapshotV1["queueState"] = {
		status: literalField(queue, "status", ["idle", "queued", "running"]),
	};
	if (queue.position !== undefined) {
		queueState.position = integerField(queue, "position", { minimum: 1 });
	}
	const recovery = strictRecord(
		record.recoveryState,
		["status"],
		"recoveryState",
	);
	const preview = strictRecord(record.previewState, ["status"], "previewState");
	return {
		version: literalField(record, "version", [1]),
		sessionId: boundedId(record, "sessionId"),
		eventCursor: integerField(record, "eventCursor", { minimum: 0 }),
		commandStates: stateList("commandStates"),
		runStates: stateList("runStates"),
		messageStates: stateList("messageStates"),
		interruptedHistory: record.interruptedHistory,
		checkpointPosition: integerField(record, "checkpointPosition", {
			minimum: 0,
		}),
		queueState,
		recoveryState: {
			status: literalField(recovery, "status", [
				"healthy",
				"pending",
				"degraded",
				"failed",
			]),
		},
		previewState: {
			status: literalField(preview, "status", [
				"stopped",
				"starting",
				"running",
				"failed",
			]),
		},
		projectionLag: integerField(record, "projectionLag", { minimum: 0 }),
		reasonCodes: record.reasonCodes as string[],
	};
}

export type EventV1 =
	| {
			version: 1;
			sessionId: string;
			sequence: number;
			kind: "state_changed";
			targetKind: "command" | "run" | "message" | "session";
			targetId: string;
			status: string;
			reasonCode?: string;
	  }
	| {
			version: 1;
			sessionId: string;
			sequence: number;
			kind: "transient_delta";
			runId: string;
			attempt: number;
			committedPosition: number;
			delta: string;
	  };

export function parseEventV1(value: unknown): EventV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.streamFrameBytes);
	const discovered = strictRecord(
		decoded,
		[
			"version",
			"sessionId",
			"sequence",
			"kind",
			"runId",
			"attempt",
			"committedPosition",
			"delta",
			"targetKind",
			"targetId",
			"status",
			"reasonCode",
		],
		"EventV1",
	);
	const kind = literalField(discovered, "kind", [
		"state_changed",
		"transient_delta",
	]);
	const common = {
		version: literalField(discovered, "version", [1]) as 1,
		sessionId: boundedId(discovered, "sessionId"),
		sequence: integerField(discovered, "sequence", { minimum: 1 }),
	};
	if (kind === "state_changed") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"sessionId",
				"sequence",
				"kind",
				"targetKind",
				"targetId",
				"status",
				"reasonCode",
			],
			"EventV1.state_changed",
		);
		const result: Extract<EventV1, { kind: "state_changed" }> = {
			...common,
			kind,
			targetKind: literalField(record, "targetKind", [
				"command",
				"run",
				"message",
				"session",
			]),
			targetId: boundedId(record, "targetId"),
			status: boundedId(record, "status"),
		};
		const reasonCode = stringField(record, "reasonCode", {
			optional: true,
			maxBytes: RUNTIME_LIMITS.idBytes,
		});
		if (reasonCode) result.reasonCode = reasonCode;
		return result;
	}
	const record = strictRecord(
		decoded,
		[
			"version",
			"sessionId",
			"sequence",
			"kind",
			"runId",
			"attempt",
			"committedPosition",
			"delta",
		],
		"EventV1.transient_delta",
	);
	return {
		...common,
		kind,
		runId: boundedId(record, "runId"),
		attempt: integerField(record, "attempt", { minimum: 1 }),
		committedPosition: integerField(record, "committedPosition", {
			minimum: 0,
		}),
		delta: stringField(record, "delta", {
			maxBytes: RUNTIME_LIMITS.streamFrameBytes,
		}),
	};
}

export type EncryptedRecordEnvelopeV1 = {
	version: 1;
	algorithm: "aes-256-gcm";
	keyVersion: string;
	nonce: string;
	ciphertextBytes: number;
	chunkCount: number;
	digest: string;
	associatedData: {
		ownerKind: "workspace_session" | "brain" | "checkpoint";
		ownerId: string;
		recordId: string;
		formatVersion: number;
	};
};

export function parseEncryptedRecordEnvelopeV1(
	value: unknown,
): EncryptedRecordEnvelopeV1 {
	const decoded = decodeBounded(value, RUNTIME_LIMITS.deliveryEnvelopeBytes);
	const record = strictRecord(
		decoded,
		[
			"version",
			"algorithm",
			"keyVersion",
			"nonce",
			"ciphertextBytes",
			"chunkCount",
			"digest",
			"associatedData",
		],
		"EncryptedRecordEnvelopeV1",
	);
	const associated = strictRecord(
		record.associatedData,
		["ownerKind", "ownerId", "recordId", "formatVersion"],
		"EncryptedRecordEnvelopeV1.associatedData",
	);
	return {
		version: literalField(record, "version", [1]),
		algorithm: literalField(record, "algorithm", ["aes-256-gcm"]),
		keyVersion: boundedId(record, "keyVersion"),
		nonce: boundedId(record, "nonce"),
		ciphertextBytes: integerField(record, "ciphertextBytes", { minimum: 1 }),
		chunkCount: integerField(record, "chunkCount", { minimum: 1 }),
		digest: boundedId(record, "digest"),
		associatedData: {
			ownerKind: literalField(associated, "ownerKind", [
				"workspace_session",
				"brain",
				"checkpoint",
			]),
			ownerId: boundedId(associated, "ownerId"),
			recordId: boundedId(associated, "recordId"),
			formatVersion: integerField(associated, "formatVersion", { minimum: 1 }),
		},
	};
}
