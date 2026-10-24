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
import { RUNTIME_LIMITS } from "./limits.js";

export const CANDIDATE_RUNTIME_OWNER = "pi_durable_v1";
export const CANDIDATE_COMMAND_VERSION = 2;
export const CANDIDATE_COMMAND_TEXT_BYTES = 8192;
export const CANDIDATE_QUEUE_TTL_MS = 900_000;
const KINDS = [
	"prompt",
	"follow_up",
	"stop",
	"cancel",
	"restore_checkpoint_acknowledging_loss",
	"archive_session",
] as const;
/** The user's explicit acknowledgment that restoring the pair discards later unbacked work. */
type RestoreV2 = {
	committedPairId: string;
	expectedMutationGeneration: number;
	/** The last accepted command sequence the user saw; it becomes the restore cutoff. */
	expectedRecoveryPosition: number;
	unbackedLossAcknowledged: true;
};

/** The model choice the user wants applied from this message onward. */
type SelectionV2 = { selection?: ConfigurationSelectionV1 };
type BrowserBaseV2 = {
	version: 2;
	idempotencyKey: string;
	projectId: string;
};
export type BrowserCommandV2 =
	| (BrowserBaseV2 &
			SelectionV2 & { kind: "prompt"; sessionId?: string; text: string })
	| (BrowserBaseV2 &
			SelectionV2 & {
				kind: "follow_up";
				sessionId: string;
				targetRunId: string;
				text: string;
			})
	| (BrowserBaseV2 & { kind: "stop"; sessionId: string; targetRunId: string })
	| (BrowserBaseV2 & {
			kind: "cancel";
			sessionId: string;
			targetCommandId: string;
	  })
	| (BrowserBaseV2 &
			RestoreV2 & {
				kind: "restore_checkpoint_acknowledging_loss";
				sessionId: string;
			})
	/** Archives the session; every command accepted before it is its cutoff. */
	| (BrowserBaseV2 & { kind: "archive_session"; sessionId: string });

type CommandBaseV2 = {
	version: 2;
	commandId: string;
	commandSeq: number;
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	runtimeOwnerVersion: number;
	receiptId: string;
	acceptedAt: number;
	deadlineAt: number;
	payloadDigest: string;
};
type MessagesV2 = {
	userMessageId: string;
	assistantMessageId: string;
	text: string;
};
export type CommandV2 =
	| (CommandBaseV2 & MessagesV2 & SelectionV2 & { kind: "prompt" })
	| (CommandBaseV2 &
			MessagesV2 &
			SelectionV2 & { kind: "follow_up"; targetRunId: string })
	| (CommandBaseV2 & { kind: "stop"; targetRunId: string })
	| (CommandBaseV2 & { kind: "cancel"; targetCommandId: string })
	| (CommandBaseV2 &
			RestoreV2 & { kind: "restore_checkpoint_acknowledging_loss" })
	| (CommandBaseV2 & { kind: "archive_session" });

export type ReceiptV2 = {
	version: 2;
	receiptId: string;
	commandId: string;
	workspaceSessionId: string;
	commandSeq: number;
	ownerVersion: 1;
	queueDeadlineAt: number;
	userMessageId?: string;
	assistantMessageId?: string;
};

export function parseReceiptV2(input: unknown): ReceiptV2 {
	const r = strictRecord(
		decodeContractInput(input, RUNTIME_LIMITS.deliveryEnvelopeBytes),
		[
			"version",
			"receiptId",
			"commandId",
			"workspaceSessionId",
			"commandSeq",
			"ownerVersion",
			"queueDeadlineAt",
			"userMessageId",
			"assistantMessageId",
		],
		"ReceiptV2",
	);
	literalField(r, "version", [2]);
	literalField(r, "ownerVersion", [1]);
	const userMessageId = stringField(r, "userMessageId", {
		optional: true,
		maxBytes: RUNTIME_LIMITS.idBytes,
	});
	const assistantMessageId = stringField(r, "assistantMessageId", {
		optional: true,
		maxBytes: RUNTIME_LIMITS.idBytes,
	});
	if ((userMessageId === undefined) !== (assistantMessageId === undefined))
		throw new ContractParseError(
			"invalid_field",
			"Receipt message pair is incomplete.",
		);
	return {
		version: 2,
		receiptId: id(r, "receiptId"),
		commandId: id(r, "commandId"),
		workspaceSessionId: id(r, "workspaceSessionId"),
		commandSeq: integerField(r, "commandSeq", { minimum: 1 }),
		ownerVersion: 1,
		queueDeadlineAt: integerField(r, "queueDeadlineAt", { minimum: 0 }),
		...(userMessageId === undefined
			? {}
			: { userMessageId, assistantMessageId }),
	};
}

export type QueueDecisionV2 = {
	version: 2;
	commandId: string;
	ownerVersion: 1;
	runId: string;
	runEpoch: number;
	decision: "started" | "expired";
	decidedAt: number;
	queueDeadlineAt: number;
	payloadDigest: string;
};

export function parseQueueDecisionV2(input: unknown): QueueDecisionV2 {
	const r = strictRecord(
		decodeContractInput(input, RUNTIME_LIMITS.deliveryEnvelopeBytes),
		[
			"version",
			"commandId",
			"ownerVersion",
			"runId",
			"runEpoch",
			"decision",
			"decidedAt",
			"queueDeadlineAt",
			"payloadDigest",
		],
		"QueueDecisionV2",
	);
	literalField(r, "version", [2]);
	literalField(r, "ownerVersion", [1]);
	const decision = literalField(r, "decision", ["started", "expired"]);
	const decidedAt = integerField(r, "decidedAt", { minimum: 0 });
	const queueDeadlineAt = integerField(r, "queueDeadlineAt", { minimum: 0 });
	const payloadDigest = stringField(r, "payloadDigest", { maxBytes: 64 });
	if (
		!/^[a-f0-9]{64}$/.test(payloadDigest) ||
		(decision === "started"
			? decidedAt >= queueDeadlineAt
			: decidedAt < queueDeadlineAt)
	)
		throw new ContractParseError(
			"invalid_field",
			"Invalid queue decision evidence.",
		);
	return {
		version: 2,
		commandId: id(r, "commandId"),
		ownerVersion: 1,
		runId: id(r, "runId"),
		runEpoch: integerField(r, "runEpoch", { minimum: 1 }),
		decision,
		decidedAt,
		queueDeadlineAt,
		payloadDigest,
	};
}

export type CommandHandoffAckV2 = {
	version: 2;
	commandId: string;
	ownerVersion: number;
	acceptedPosition: number;
	receiptId: string;
};

const BROWSER_BASE = [
	"version",
	"kind",
	"idempotencyKey",
	"projectId",
	"sessionId",
];
const COMMAND_BASE = [
	"version",
	"kind",
	"commandId",
	"commandSeq",
	"userId",
	"projectId",
	"workspaceSessionId",
	"runtimeOwnerVersion",
	"receiptId",
	"acceptedAt",
	"deadlineAt",
	"payloadDigest",
];
const RESTORE_FIELDS = [
	"committedPairId",
	"expectedMutationGeneration",
	"expectedRecoveryPosition",
	"unbackedLossAcknowledged",
];
function fields(kind: (typeof KINDS)[number], browser: boolean): string[] {
	const base = browser ? BROWSER_BASE : COMMAND_BASE;
	switch (kind) {
		case "prompt":
			return [
				...base,
				...(browser
					? ["text", "selection"]
					: ["userMessageId", "assistantMessageId", "text", "selection"]),
			];
		case "follow_up":
			return [
				...base,
				"targetRunId",
				...(browser
					? ["text", "selection"]
					: ["userMessageId", "assistantMessageId", "text", "selection"]),
			];
		case "stop":
			return [...base, "targetRunId"];
		case "cancel":
			return [...base, "targetCommandId"];
		case "restore_checkpoint_acknowledging_loss":
			return [...base, ...RESTORE_FIELDS];
		case "archive_session":
			return base;
	}
}
function record(input: unknown, browser: boolean) {
	const value = decodeContractInput(input, RUNTIME_LIMITS.commandBodyBytes);
	const initial = strictRecord(
		value,
		[
			...(browser ? BROWSER_BASE : COMMAND_BASE),
			"text",
			"selection",
			"targetRunId",
			"targetCommandId",
			...RESTORE_FIELDS,
			...(browser ? [] : ["userMessageId", "assistantMessageId"]),
		],
		browser ? "BrowserCommandV2" : "CommandV2",
	);
	literalField(initial, "version", [2]);
	const kind = literalField(initial, "kind", KINDS);
	return {
		record: strictRecord(initial, fields(kind, browser), "CommandV2"),
		kind,
	};
}
function id(record: Record<string, unknown>, key: string) {
	return stringField(record, key, { maxBytes: RUNTIME_LIMITS.idBytes });
}
function restore(record: Record<string, unknown>): RestoreV2 {
	return {
		committedPairId: id(record, "committedPairId"),
		expectedMutationGeneration: integerField(
			record,
			"expectedMutationGeneration",
			{ minimum: 1 },
		),
		expectedRecoveryPosition: integerField(record, "expectedRecoveryPosition", {
			minimum: 0,
		}),
		unbackedLossAcknowledged: acknowledged(record),
	};
}
function acknowledged(record: Record<string, unknown>): true {
	if (record.unbackedLossAcknowledged !== true)
		throw new ContractParseError(
			"invalid_field",
			"unbackedLossAcknowledged must be true.",
		);
	return true;
}
function selection(record: Record<string, unknown>): SelectionV2 {
	return record.selection === undefined
		? {}
		: { selection: parseConfigurationSelectionV1(record.selection) };
}
function text(record: Record<string, unknown>) {
	const value = stringField(record, "text", {
		maxBytes: CANDIDATE_COMMAND_TEXT_BYTES,
	});
	if (value.trim().length === 0)
		throw new ContractParseError("invalid_field", "text must not be blank.");
	return value;
}

export function parseBrowserCommandV2(input: unknown): BrowserCommandV2 {
	const { record: r, kind } = record(input, true);
	const base: BrowserBaseV2 = {
		version: 2,
		idempotencyKey: id(r, "idempotencyKey"),
		projectId: id(r, "projectId"),
	};
	if (kind === "prompt") {
		const sessionId = stringField(r, "sessionId", {
			optional: true,
			maxBytes: RUNTIME_LIMITS.idBytes,
		});
		return {
			...base,
			kind,
			...(sessionId === undefined ? {} : { sessionId }),
			text: text(r),
			...selection(r),
		};
	}
	const sessionId = id(r, "sessionId");
	if (kind === "follow_up")
		return {
			...base,
			kind,
			sessionId,
			targetRunId: id(r, "targetRunId"),
			text: text(r),
			...selection(r),
		};
	if (kind === "stop")
		return { ...base, kind, sessionId, targetRunId: id(r, "targetRunId") };
	if (kind === "restore_checkpoint_acknowledging_loss")
		return { ...base, kind, sessionId, ...restore(r) };
	if (kind === "archive_session") return { ...base, kind, sessionId };
	return {
		...base,
		kind,
		sessionId,
		targetCommandId: id(r, "targetCommandId"),
	};
}

export function parseCommandV2(input: unknown): CommandV2 {
	const { record: r, kind } = record(input, false);
	const acceptedAt = integerField(r, "acceptedAt", {
		minimum: 0,
		maximum: Number.MAX_SAFE_INTEGER - CANDIDATE_QUEUE_TTL_MS,
	});
	const deadlineAt = integerField(r, "deadlineAt", { minimum: 0 });
	if (deadlineAt !== acceptedAt + CANDIDATE_QUEUE_TTL_MS)
		throw new ContractParseError(
			"invalid_field",
			"deadlineAt must preserve the fixed queue deadline.",
		);
	const payloadDigest = stringField(r, "payloadDigest", { maxBytes: 64 });
	if (!/^[a-f0-9]{64}$/.test(payloadDigest))
		throw new ContractParseError(
			"invalid_field",
			"payloadDigest must be a SHA-256 hex digest.",
		);
	const base: CommandBaseV2 = {
		version: 2,
		commandId: id(r, "commandId"),
		commandSeq: integerField(r, "commandSeq", { minimum: 1 }),
		userId: id(r, "userId"),
		projectId: id(r, "projectId"),
		workspaceSessionId: id(r, "workspaceSessionId"),
		runtimeOwnerVersion: integerField(r, "runtimeOwnerVersion", { minimum: 1 }),
		receiptId: id(r, "receiptId"),
		acceptedAt,
		deadlineAt,
		payloadDigest,
	};
	if (kind === "stop")
		return { ...base, kind, targetRunId: id(r, "targetRunId") };
	if (kind === "cancel")
		return { ...base, kind, targetCommandId: id(r, "targetCommandId") };
	if (kind === "restore_checkpoint_acknowledging_loss") {
		const fields = restore(r);
		// The restore is the first command after its cutoff.
		if (base.commandSeq !== fields.expectedRecoveryPosition + 1)
			throw new ContractParseError(
				"invalid_field",
				"A restore must directly follow its cutoff.",
			);
		return { ...base, kind, ...fields };
	}
	if (kind === "archive_session") return { ...base, kind };
	const messages = {
		userMessageId: id(r, "userMessageId"),
		assistantMessageId: id(r, "assistantMessageId"),
		text: text(r),
	};
	if (kind === "follow_up")
		return {
			...base,
			kind,
			...messages,
			targetRunId: id(r, "targetRunId"),
			...selection(r),
		};
	return { ...base, kind, ...messages, ...selection(r) };
}

export function parseCommandHandoffAckV2(input: unknown): CommandHandoffAckV2 {
	const r = strictRecord(
		decodeContractInput(input, RUNTIME_LIMITS.deliveryEnvelopeBytes),
		["version", "commandId", "ownerVersion", "acceptedPosition", "receiptId"],
		"CommandHandoffAckV2",
	);
	literalField(r, "version", [2]);
	return {
		version: 2,
		commandId: id(r, "commandId"),
		ownerVersion: integerField(r, "ownerVersion", { minimum: 1 }),
		acceptedPosition: integerField(r, "acceptedPosition", { minimum: 1 }),
		receiptId: id(r, "receiptId"),
	};
}
