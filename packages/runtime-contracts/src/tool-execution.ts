import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

export const TOOL_EXECUTION_VERSION = 1;
export const REMOTE_TOOL_NAMES = [
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
] as const;
export type RemoteToolName = (typeof REMOTE_TOOL_NAMES)[number];

/** Declared bounds. Exact arguments are bound into a 128 KB effect correlation. */
export const TOOL_EXECUTION_LIMITS = {
	pathBytes: 4096,
	patternBytes: 4096,
	commandBytes: 16_384,
	mutationBytes: 96_000,
	edits: 64,
	outputBytes: 51_200,
	outputLines: 2000,
	operationBytes: 112_000,
	outcomeBytes: 64_000,
	messageBytes: 2048,
} as const;

export type RemoteToolArguments = {
	read: { path: string; offset?: number; limit?: number };
	write: { path: string; content: string };
	edit: { path: string; edits: { oldText: string; newText: string }[] };
	bash: { command: string; timeout?: number };
	grep: {
		pattern: string;
		path?: string;
		glob?: string;
		ignoreCase?: boolean;
		literal?: boolean;
		context?: number;
		limit?: number;
	};
	find: { pattern: string; path?: string; limit?: number };
	ls: { path?: string; limit?: number };
};

/** Effect classes the runtime owner admits; mutations never replay automatically. */
export const TOOL_EFFECT_CLASS: Record<
	RemoteToolName,
	"observation" | "mutation" | "shell"
> = {
	read: "observation",
	grep: "observation",
	find: "observation",
	ls: "observation",
	write: "mutation",
	edit: "mutation",
	bash: "shell",
};

export type ToolOperationV1 = {
	[K in RemoteToolName]: {
		version: 1;
		operationId: string;
		workspaceSessionId: string;
		executorGeneration: number;
		epoch: number;
		deadlineAt: number;
		tool: K;
		arguments: RemoteToolArguments[K];
	};
}[RemoteToolName];

export type ToolRejectionReason =
	| "invalid"
	| "generation"
	| "expired"
	| "conflict";
export type ToolOutcomeV1 =
	| {
			version: 1;
			operationId: string;
			status: "completed";
			isError: boolean;
			text: string;
			truncated: boolean;
	  }
	| {
			version: 1;
			operationId: string;
			status: "rejected";
			reason: ToolRejectionReason;
			message: string;
	  }
	| {
			version: 1;
			operationId: string;
			status: "pending" | "unknown";
			message: string;
	  };

const encoder = new TextEncoder();
function boundedText(
	record: Record<string, unknown>,
	key: string,
	maxBytes: number,
	optional = false,
): string | undefined {
	const value = record[key];
	if (value === undefined && optional) return undefined;
	if (typeof value !== "string")
		throw new ContractParseError("invalid_field", `${key} must be a string.`);
	if (encoder.encode(value).byteLength > maxBytes)
		throw new ContractParseError(
			"field_too_large",
			`${key} exceeds its byte limit.`,
		);
	return value;
}
function optionalBoolean(record: Record<string, unknown>, key: string) {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean")
		throw new ContractParseError("invalid_field", `${key} must be a boolean.`);
	return value;
}
function optionalCount(
	record: Record<string, unknown>,
	key: string,
	maximum: number,
	minimum = 1,
) {
	return integerField(record, key, { optional: true, minimum, maximum });
}
function path(record: Record<string, unknown>, optional = false) {
	return stringField(record, "path", {
		optional: optional as true,
		maxBytes: TOOL_EXECUTION_LIMITS.pathBytes,
	});
}
function strip<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

export function parseRemoteToolArguments<K extends RemoteToolName>(
	tool: K,
	value: unknown,
): RemoteToolArguments[K] {
	const contract = `${tool} arguments`;
	let parsed: RemoteToolArguments[RemoteToolName];
	if (tool === "read") {
		const row = strictRecord(value, ["path", "offset", "limit"], contract);
		parsed = strip({
			path: path(row)!,
			offset: optionalCount(row, "offset", 10_000_000),
			limit: optionalCount(row, "limit", 10_000_000),
		});
	} else if (tool === "write") {
		const row = strictRecord(value, ["path", "content"], contract);
		parsed = {
			path: path(row)!,
			content: boundedText(
				row,
				"content",
				TOOL_EXECUTION_LIMITS.mutationBytes,
			)!,
		};
	} else if (tool === "edit") {
		const row = strictRecord(value, ["path", "edits"], contract);
		if (
			!Array.isArray(row.edits) ||
			row.edits.length === 0 ||
			row.edits.length > TOOL_EXECUTION_LIMITS.edits
		)
			throw new ContractParseError(
				"invalid_field",
				"edits must contain 1 to 64 replacements.",
			);
		let bytes = 0;
		const edits = row.edits.map((entry) => {
			const edit = strictRecord(entry, ["oldText", "newText"], "edit");
			const oldText = stringField(edit, "oldText");
			const newText = boundedText(
				edit,
				"newText",
				TOOL_EXECUTION_LIMITS.mutationBytes,
			)!;
			bytes +=
				encoder.encode(oldText).byteLength + encoder.encode(newText).byteLength;
			return { oldText, newText };
		});
		if (bytes > TOOL_EXECUTION_LIMITS.mutationBytes)
			throw new ContractParseError(
				"field_too_large",
				"edits exceed their byte limit.",
			);
		parsed = { path: path(row)!, edits };
	} else if (tool === "bash") {
		const row = strictRecord(value, ["command", "timeout"], contract);
		parsed = strip({
			command: stringField(row, "command", {
				maxBytes: TOOL_EXECUTION_LIMITS.commandBytes,
			}),
			timeout: optionalCount(row, "timeout", 900),
		});
	} else if (tool === "grep") {
		const row = strictRecord(
			value,
			["pattern", "path", "glob", "ignoreCase", "literal", "context", "limit"],
			contract,
		);
		parsed = strip({
			pattern: stringField(row, "pattern", {
				maxBytes: TOOL_EXECUTION_LIMITS.patternBytes,
			}),
			path: path(row, true),
			glob: stringField(row, "glob", {
				optional: true,
				maxBytes: TOOL_EXECUTION_LIMITS.patternBytes,
			}),
			ignoreCase: optionalBoolean(row, "ignoreCase"),
			literal: optionalBoolean(row, "literal"),
			context: optionalCount(row, "context", 100, 0),
			limit: optionalCount(row, "limit", 1000),
		});
	} else if (tool === "find") {
		const row = strictRecord(value, ["pattern", "path", "limit"], contract);
		parsed = strip({
			pattern: stringField(row, "pattern", {
				maxBytes: TOOL_EXECUTION_LIMITS.patternBytes,
			}),
			path: path(row, true),
			limit: optionalCount(row, "limit", 10_000),
		});
	} else if (tool === "ls") {
		const row = strictRecord(value, ["path", "limit"], contract);
		parsed = strip({
			path: path(row, true),
			limit: optionalCount(row, "limit", 10_000),
		});
	} else throw new ContractParseError("invalid_field", "Unknown tool.");
	return parsed as RemoteToolArguments[K];
}

export function parseToolOperationV1(input: unknown): ToolOperationV1 {
	const row = strictRecord(
		decodeContractInput(input, TOOL_EXECUTION_LIMITS.operationBytes),
		[
			"version",
			"operationId",
			"workspaceSessionId",
			"executorGeneration",
			"epoch",
			"deadlineAt",
			"tool",
			"arguments",
		],
		"Tool operation",
	);
	const tool = literalField(row, "tool", REMOTE_TOOL_NAMES);
	return {
		version: literalField(row, "version", [1]),
		operationId: stringField(row, "operationId", { maxBytes: 512 }),
		workspaceSessionId: stringField(row, "workspaceSessionId", {
			maxBytes: 256,
		}),
		executorGeneration: integerField(row, "executorGeneration", {
			minimum: 1,
		}),
		epoch: integerField(row, "epoch", { minimum: 1 }),
		deadlineAt: integerField(row, "deadlineAt", { minimum: 1 }),
		tool,
		arguments: parseRemoteToolArguments(tool, row.arguments),
	} as ToolOperationV1;
}

export function parseToolOutcomeV1(
	input: unknown,
	operationId: string,
): ToolOutcomeV1 {
	const value = decodeContractInput(input, TOOL_EXECUTION_LIMITS.outcomeBytes);
	const status = literalField(
		strictRecord(
			value,
			[
				"version",
				"operationId",
				"status",
				"isError",
				"text",
				"truncated",
				"reason",
				"message",
			],
			"Tool outcome",
		),
		"status",
		["completed", "rejected", "pending", "unknown"],
	);
	const keys =
		status === "completed"
			? ["version", "operationId", "status", "isError", "text", "truncated"]
			: status === "rejected"
				? ["version", "operationId", "status", "reason", "message"]
				: ["version", "operationId", "status", "message"];
	const row = strictRecord(value, keys, "Tool outcome");
	literalField(row, "version", [1]);
	if (row.operationId !== operationId)
		throw new ContractParseError(
			"operation_mismatch",
			"Tool outcome belongs to another operation.",
		);
	if (status === "completed") {
		if (typeof row.isError !== "boolean" || typeof row.truncated !== "boolean")
			throw new ContractParseError("invalid_field", "Invalid completion.");
		return {
			version: 1,
			operationId,
			status,
			isError: row.isError,
			text: boundedText(row, "text", TOOL_EXECUTION_LIMITS.outputBytes + 1024)!,
			truncated: row.truncated,
		};
	}
	const message = boundedText(
		row,
		"message",
		TOOL_EXECUTION_LIMITS.messageBytes,
	)!;
	if (status === "rejected")
		return {
			version: 1,
			operationId,
			status,
			reason: literalField(row, "reason", [
				"invalid",
				"generation",
				"expired",
				"conflict",
			]),
			message,
		};
	return { version: 1, operationId, status, message };
}
