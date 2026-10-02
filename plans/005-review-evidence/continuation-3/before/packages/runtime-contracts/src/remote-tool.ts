import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

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
export const REMOTE_JOB_BYTES = 2 * 1024 * 1024;
export const REMOTE_RESULT_BYTES = 2 * 1024 * 1024;
export const REMOTE_FILE_BYTES = 1024 * 1024;
export type ExpectedContent = { absent: true } | { sha256: string };
export type RemoteArguments =
	| { name: "read"; path: string; offset?: number; limit?: number }
	| { name: "write"; path: string; content: string; expected: ExpectedContent }
	| {
			name: "edit";
			path: string;
			edits: { oldText: string; newText: string }[];
			expected: { sha256: string };
	  }
	| { name: "bash"; command: string; timeout?: number }
	| {
			name: "grep";
			pattern: string;
			path?: string;
			glob?: string;
			ignoreCase?: boolean;
			literal?: boolean;
			context?: number;
			limit?: number;
	  }
	| { name: "find"; pattern: string; path?: string; limit?: number }
	| { name: "ls"; path?: string; limit?: number };
export type RemoteToolV1 = {
	version: 1;
	runId: string;
	assistantEntryId: string;
	toolCallId: string;
	attempt: number;
	executorIncarnationId: string;
	runEpoch: number;
	lifecycleGeneration: number;
	deadline: number;
	outcomePolicy: "retry_safe" | "reconcile" | "never_retry";
	tool: RemoteArguments;
};

function text(
	record: Record<string, unknown>,
	key: string,
	maxBytes = REMOTE_FILE_BYTES,
): string {
	return stringField(record, key, { maxBytes });
}
function emptyText(record: Record<string, unknown>, key: string): string {
	if (record[key] === "") return "";
	return text(record, key);
}
function optionalNumber(
	record: Record<string, unknown>,
	key: string,
	max: number,
	minimum = 1,
): number | undefined {
	if (record[key] === undefined) return undefined;
	const value = integerField(record, key, { minimum });
	if (value > max)
		throw new ContractParseError("invalid_field", `${key} exceeds its limit.`);
	return value;
}
function optionalText(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	return stringField(record, key, { optional: true, maxBytes: 4096 });
}
function optionalBoolean(
	record: Record<string, unknown>,
	key: string,
): boolean | undefined {
	if (record[key] === undefined) return undefined;
	if (typeof record[key] !== "boolean")
		throw new ContractParseError("invalid_field", `${key} must be Boolean.`);
	return record[key];
}
function expected(value: unknown, allowAbsent: boolean): ExpectedContent {
	const record = strictRecord(value, ["absent", "sha256"], "ExpectedContent");
	if (allowAbsent && record.absent === true && record.sha256 === undefined)
		return { absent: true };
	if (
		record.absent !== undefined ||
		typeof record.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(record.sha256)
	) {
		throw new ContractParseError(
			"invalid_field",
			"Expected-content precondition is required.",
		);
	}
	return { sha256: record.sha256 };
}
export function parseRemoteArguments(value: unknown): RemoteArguments {
	const discovered = strictRecord(
		value,
		[
			"name",
			"path",
			"offset",
			"limit",
			"content",
			"expected",
			"edits",
			"command",
			"timeout",
			"pattern",
			"glob",
			"ignoreCase",
			"literal",
			"context",
		],
		"RemoteArguments",
	);
	const name = literalField(discovered, "name", REMOTE_TOOL_NAMES);
	if (name === "read") {
		const r = strictRecord(value, ["name", "path", "offset", "limit"], name);
		return {
			name,
			path: text(r, "path", 4096),
			offset: optionalNumber(r, "offset", 1_000_000),
			limit: optionalNumber(r, "limit", 10_000),
		};
	}
	if (name === "write") {
		const r = strictRecord(
			value,
			["name", "path", "content", "expected"],
			name,
		);
		return {
			name,
			path: text(r, "path", 4096),
			content: emptyText(r, "content"),
			expected: expected(r.expected, true),
		};
	}
	if (name === "edit") {
		const r = strictRecord(value, ["name", "path", "edits", "expected"], name);
		if (!Array.isArray(r.edits) || r.edits.length < 1 || r.edits.length > 100)
			throw new ContractParseError("invalid_field", "edits must be bounded.");
		const condition = expected(r.expected, false);
		if (!("sha256" in condition))
			throw new ContractParseError("invalid_field", "edit requires a digest.");
		return {
			name,
			path: text(r, "path", 4096),
			expected: condition,
			edits: r.edits.map((item) => {
				const edit = strictRecord(item, ["oldText", "newText"], "edit");
				return {
					oldText: text(edit, "oldText"),
					newText: emptyText(edit, "newText"),
				};
			}),
		};
	}
	if (name === "bash") {
		const r = strictRecord(value, ["name", "command", "timeout"], name);
		return {
			name,
			command: text(r, "command", 128 * 1024),
			timeout: optionalNumber(r, "timeout", 120),
		};
	}
	if (name === "grep") {
		const r = strictRecord(
			value,
			[
				"name",
				"pattern",
				"path",
				"glob",
				"ignoreCase",
				"literal",
				"context",
				"limit",
			],
			name,
		);
		return {
			name,
			pattern: text(r, "pattern", 4096),
			path: optionalText(r, "path"),
			glob: optionalText(r, "glob"),
			ignoreCase: optionalBoolean(r, "ignoreCase"),
			literal: optionalBoolean(r, "literal"),
			context: optionalNumber(r, "context", 20, 0),
			limit: optionalNumber(r, "limit", 1000),
		};
	}
	if (name === "find") {
		const r = strictRecord(value, ["name", "pattern", "path", "limit"], name);
		return {
			name,
			pattern: text(r, "pattern", 4096),
			path: optionalText(r, "path"),
			limit: optionalNumber(r, "limit", 1000),
		};
	}
	const r = strictRecord(value, ["name", "path", "limit"], name);
	return {
		name,
		path: optionalText(r, "path"),
		limit: optionalNumber(r, "limit", 1000),
	};
}

export function parseRemoteToolV1(value: unknown): RemoteToolV1 {
	const r = strictRecord(
		decodeContractInput(value, REMOTE_JOB_BYTES),
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
			"outcomePolicy",
			"tool",
		],
		"RemoteToolV1",
	);
	const tool = parseRemoteArguments(r.tool);
	const outcomePolicy = literalField(r, "outcomePolicy", [
		"retry_safe",
		"reconcile",
		"never_retry",
	]);
	if (tool.name === "bash" && outcomePolicy !== "never_retry")
		throw new ContractParseError(
			"invalid_field",
			"Shell effects cannot be replayed.",
		);
	if (
		(tool.name === "write" || tool.name === "edit") &&
		outcomePolicy === "retry_safe"
	)
		throw new ContractParseError(
			"invalid_field",
			"Mutations require reconciliation.",
		);
	return {
		version: literalField(r, "version", [1]),
		runId: text(r, "runId", 256),
		assistantEntryId: text(r, "assistantEntryId", 256),
		toolCallId: text(r, "toolCallId", 256),
		attempt: integerField(r, "attempt", { minimum: 1 }),
		executorIncarnationId: text(r, "executorIncarnationId", 256),
		runEpoch: integerField(r, "runEpoch", { minimum: 1 }),
		lifecycleGeneration: integerField(r, "lifecycleGeneration", { minimum: 1 }),
		deadline: integerField(r, "deadline", { minimum: 1 }),
		outcomePolicy,
		tool,
	};
}
