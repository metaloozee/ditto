import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	optionalLiteralField,
	strictRecord,
	stringField,
} from "./json.js";
import { RUNTIME_LIMITS } from "./limits.js";

export { ContractParseError, encodedBytes } from "./json.js";

const THINKING_LEVELS = ["off", "high", "max"] as const;
const COMMAND_KINDS = ["prompt", "follow_up", "stop", "cancel"] as const;

type CommandBaseV1 = {
	version: 1;
	commandId: string;
	commandSeq: number;
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	runtimeOwnerVersion: number;
	acceptedAt: number;
	deadlineAt: number;
};

export type CommandV1 =
	| (CommandBaseV1 & {
			kind: "prompt";
			userMessageId: string;
			assistantMessageId: string;
			text: string;
			thinkingLevel?: (typeof THINKING_LEVELS)[number];
	  })
	| (CommandBaseV1 & {
			kind: "follow_up";
			userMessageId: string;
			assistantMessageId: string;
			targetRunId: string;
			text: string;
	  })
	| (CommandBaseV1 & {
			kind: "stop";
			targetRunId: string;
	  })
	| (CommandBaseV1 & {
			kind: "cancel";
			targetCommandId: string;
	  });

export type BrowserCommandV1 =
	| {
			version: 1;
			idempotencyKey: string;
			kind: "prompt";
			projectId: string;
			sessionId?: string;
			text: string;
			thinkingLevel?: (typeof THINKING_LEVELS)[number];
	  }
	| {
			version: 1;
			idempotencyKey: string;
			kind: "follow_up";
			projectId: string;
			sessionId: string;
			targetRunId: string;
			text: string;
	  }
	| {
			version: 1;
			idempotencyKey: string;
			kind: "stop";
			projectId: string;
			sessionId: string;
			targetRunId: string;
	  }
	| {
			version: 1;
			idempotencyKey: string;
			kind: "cancel";
			projectId: string;
			sessionId: string;
			targetCommandId: string;
	  };

export type ReceiptV1 = {
	version: 1;
	receiptId: string;
	commandId: string;
	userId: string;
	projectId: string;
	workspaceSessionId?: string;
	commandSeq?: number;
	status: "admitted" | "queued" | "coordinator_accepted" | "terminal";
	queueDeadlineAt?: number;
	queuePosition?: number;
	stopState?: "recorded" | "applied";
	reasonCode?: string;
	projectionVersion: number;
};

const COMMAND_KEYS = [
	"version",
	"kind",
	"commandId",
	"commandSeq",
	"userId",
	"projectId",
	"workspaceSessionId",
	"runtimeOwnerVersion",
	"acceptedAt",
	"deadlineAt",
	"userMessageId",
	"assistantMessageId",
	"targetRunId",
	"targetCommandId",
	"text",
	"thinkingLevel",
] as const;

const BROWSER_KEYS = [
	"version",
	"idempotencyKey",
	"kind",
	"projectId",
	"sessionId",
	"targetRunId",
	"targetCommandId",
	"text",
	"thinkingLevel",
] as const;

const RECEIPT_KEYS = [
	"version",
	"receiptId",
	"commandId",
	"userId",
	"projectId",
	"workspaceSessionId",
	"commandSeq",
	"status",
	"queueDeadlineAt",
	"queuePosition",
	"stopState",
	"reasonCode",
	"projectionVersion",
] as const;

const AUTHORITY_FIELDS = [
	"userId",
	"commandSeq",
	"runtimeOwnerVersion",
	"commandId",
	"acceptedAt",
	"deadlineAt",
] as const;

function commandText(record: Record<string, unknown>): string {
	return stringField(record, "text", {
		maxBytes: RUNTIME_LIMITS.commandBodyBytes,
		maxCharacters: RUNTIME_LIMITS.commandTextCharacters,
	});
}

function boundedId(record: Record<string, unknown>, key: string): string {
	return stringField(record, key, { maxBytes: RUNTIME_LIMITS.idBytes });
}

function optionalBoundedId(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	return stringField(record, key, {
		optional: true,
		maxBytes: RUNTIME_LIMITS.idBytes,
	});
}

function commandBase(record: Record<string, unknown>): CommandBaseV1 {
	const acceptedAt = integerField(record, "acceptedAt", { minimum: 0 });
	const deadlineAt = integerField(record, "deadlineAt", { minimum: 0 });
	if (deadlineAt < acceptedAt) {
		throw new ContractParseError(
			"invalid_integer",
			"deadlineAt must be >= acceptedAt.",
		);
	}
	return {
		version: literalField(record, "version", [1]),
		commandId: boundedId(record, "commandId"),
		commandSeq: integerField(record, "commandSeq", { minimum: 1 }),
		userId: boundedId(record, "userId"),
		projectId: boundedId(record, "projectId"),
		workspaceSessionId: boundedId(record, "workspaceSessionId"),
		runtimeOwnerVersion: integerField(record, "runtimeOwnerVersion", {
			minimum: 1,
		}),
		acceptedAt,
		deadlineAt,
	};
}

export function parseCommandV1(value: unknown): CommandV1 {
	const decoded = decodeContractInput(value, RUNTIME_LIMITS.commandBodyBytes);
	const discovered = strictRecord(decoded, COMMAND_KEYS, "CommandV1");
	const kind = literalField(discovered, "kind", COMMAND_KINDS);
	if (kind === "prompt") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"kind",
				"commandId",
				"commandSeq",
				"userId",
				"projectId",
				"workspaceSessionId",
				"runtimeOwnerVersion",
				"acceptedAt",
				"deadlineAt",
				"userMessageId",
				"assistantMessageId",
				"text",
				"thinkingLevel",
			],
			"CommandV1.prompt",
		);
		return {
			...commandBase(record),
			kind,
			userMessageId: boundedId(record, "userMessageId"),
			assistantMessageId: boundedId(record, "assistantMessageId"),
			text: commandText(record),
			thinkingLevel: optionalLiteralField(
				record,
				"thinkingLevel",
				THINKING_LEVELS,
			),
		};
	}
	if (kind === "follow_up") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"kind",
				"commandId",
				"commandSeq",
				"userId",
				"projectId",
				"workspaceSessionId",
				"runtimeOwnerVersion",
				"acceptedAt",
				"deadlineAt",
				"userMessageId",
				"assistantMessageId",
				"targetRunId",
				"text",
			],
			"CommandV1.follow_up",
		);
		return {
			...commandBase(record),
			kind,
			userMessageId: boundedId(record, "userMessageId"),
			assistantMessageId: boundedId(record, "assistantMessageId"),
			targetRunId: boundedId(record, "targetRunId"),
			text: commandText(record),
		};
	}
	if (kind === "stop") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"kind",
				"commandId",
				"commandSeq",
				"userId",
				"projectId",
				"workspaceSessionId",
				"runtimeOwnerVersion",
				"acceptedAt",
				"deadlineAt",
				"targetRunId",
			],
			"CommandV1.stop",
		);
		return {
			...commandBase(record),
			kind,
			targetRunId: boundedId(record, "targetRunId"),
		};
	}
	const record = strictRecord(
		decoded,
		[
			"version",
			"kind",
			"commandId",
			"commandSeq",
			"userId",
			"projectId",
			"workspaceSessionId",
			"runtimeOwnerVersion",
			"acceptedAt",
			"deadlineAt",
			"targetCommandId",
		],
		"CommandV1.cancel",
	);
	return {
		...commandBase(record),
		kind,
		targetCommandId: boundedId(record, "targetCommandId"),
	};
}

export function parseBrowserCommandV1(value: unknown): BrowserCommandV1 {
	const decoded = decodeContractInput(value, RUNTIME_LIMITS.commandBodyBytes);
	const discovered = strictRecord(decoded, BROWSER_KEYS, "BrowserCommandV1");
	for (const field of AUTHORITY_FIELDS) {
		if (field in discovered) {
			throw new ContractParseError(
				"unknown_field",
				`BrowserCommandV1 cannot supply authority field ${field}.`,
			);
		}
	}
	const version = literalField(discovered, "version", [1]);
	const idempotencyKey = boundedId(discovered, "idempotencyKey");
	const projectId = boundedId(discovered, "projectId");
	const kind = literalField(discovered, "kind", COMMAND_KINDS);
	if (kind === "prompt") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"idempotencyKey",
				"kind",
				"projectId",
				"sessionId",
				"text",
				"thinkingLevel",
			],
			"BrowserCommandV1.prompt",
		);
		return {
			version,
			idempotencyKey,
			kind,
			projectId,
			sessionId: optionalBoundedId(record, "sessionId"),
			text: commandText(record),
			thinkingLevel: optionalLiteralField(
				record,
				"thinkingLevel",
				THINKING_LEVELS,
			),
		};
	}
	if (kind === "follow_up") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"idempotencyKey",
				"kind",
				"projectId",
				"sessionId",
				"targetRunId",
				"text",
			],
			"BrowserCommandV1.follow_up",
		);
		return {
			version,
			idempotencyKey,
			kind,
			projectId,
			sessionId: boundedId(record, "sessionId"),
			targetRunId: boundedId(record, "targetRunId"),
			text: commandText(record),
		};
	}
	if (kind === "stop") {
		const record = strictRecord(
			decoded,
			[
				"version",
				"idempotencyKey",
				"kind",
				"projectId",
				"sessionId",
				"targetRunId",
			],
			"BrowserCommandV1.stop",
		);
		return {
			version,
			idempotencyKey,
			kind,
			projectId,
			sessionId: boundedId(record, "sessionId"),
			targetRunId: boundedId(record, "targetRunId"),
		};
	}
	const record = strictRecord(
		decoded,
		[
			"version",
			"idempotencyKey",
			"kind",
			"projectId",
			"sessionId",
			"targetCommandId",
		],
		"BrowserCommandV1.cancel",
	);
	return {
		version,
		idempotencyKey,
		kind,
		projectId,
		sessionId: boundedId(record, "sessionId"),
		targetCommandId: boundedId(record, "targetCommandId"),
	};
}

export function parseReceiptV1(value: unknown): ReceiptV1 {
	const decoded = decodeContractInput(
		value,
		RUNTIME_LIMITS.deliveryEnvelopeBytes,
	);
	const record = strictRecord(decoded, RECEIPT_KEYS, "ReceiptV1");
	const result: ReceiptV1 = {
		version: literalField(record, "version", [1]),
		receiptId: boundedId(record, "receiptId"),
		commandId: boundedId(record, "commandId"),
		userId: boundedId(record, "userId"),
		projectId: boundedId(record, "projectId"),
		status: literalField(record, "status", [
			"admitted",
			"queued",
			"coordinator_accepted",
			"terminal",
		]),
		projectionVersion: integerField(record, "projectionVersion", {
			minimum: 0,
		}),
	};
	const workspaceSessionId = optionalBoundedId(record, "workspaceSessionId");
	if (workspaceSessionId) result.workspaceSessionId = workspaceSessionId;
	const commandSeq = integerField(record, "commandSeq", {
		optional: true,
		minimum: 1,
	});
	if (commandSeq !== undefined) result.commandSeq = commandSeq;
	const queueDeadlineAt = integerField(record, "queueDeadlineAt", {
		optional: true,
		minimum: 0,
	});
	if (queueDeadlineAt !== undefined) result.queueDeadlineAt = queueDeadlineAt;
	const queuePosition = integerField(record, "queuePosition", {
		optional: true,
		minimum: 1,
	});
	if (queuePosition !== undefined) result.queuePosition = queuePosition;
	const stopState = optionalLiteralField(record, "stopState", [
		"recorded",
		"applied",
	]);
	if (stopState) result.stopState = stopState;
	const reasonCode = stringField(record, "reasonCode", {
		optional: true,
		maxBytes: RUNTIME_LIMITS.idBytes,
	});
	if (reasonCode) result.reasonCode = reasonCode;
	return result;
}
