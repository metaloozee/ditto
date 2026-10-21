import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

/**
 * Project values reach only an admitted repository command. The runtime asks
 * the product for one exact operation; builders, preview, Git and archive
 * helpers are denied by role and never receive a value.
 */
export const PROJECT_VALUE_ROLES = [
	"repository_command",
	"builder",
	"preview",
	"git",
	"archive",
] as const;
export type ProjectValueRole = (typeof PROJECT_VALUE_ROLES)[number];

export const PROJECT_VALUE_LIMITS = {
	count: 100,
	keyBytes: 256,
	valueBytes: 32 * 1024,
	totalBytes: 64 * 1024,
	/** A grant never outlives this much of its operation's remaining time. */
	maxRemainingMs: 15 * 60 * 1000,
} as const;

/** Values shorter than this are delivered but not redacted, like other concrete secrets. */
export const PROJECT_VALUE_REDACTION_MIN_CHARACTERS = 8;
export const PROJECT_VALUE_REDACTION = "[REDACTED]";

export type ProjectValueRequestV1 = {
	version: 1;
	role: ProjectValueRole;
	workspaceSessionId: string;
	operationId: string;
	executorGeneration: number;
	epoch: number;
	deadlineAt: number;
};

export const PROJECT_VALUE_DENIALS = [
	"invalid",
	"role",
	"scope",
	"authority",
	"expired",
	"unavailable",
] as const;
export type ProjectValueDenial = (typeof PROJECT_VALUE_DENIALS)[number];

export type ProjectValueGrantV1 =
	| {
			version: 1;
			operationId: string;
			status: "granted";
			values: { key: string; value: string }[];
	  }
	| {
			version: 1;
			operationId: string;
			status: "denied";
			reason: ProjectValueDenial;
	  };

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const encoder = new TextEncoder();

export function parseProjectValueRequestV1(
	input: unknown,
): ProjectValueRequestV1 {
	const row = strictRecord(
		decodeContractInput(input, 4096),
		[
			"version",
			"role",
			"workspaceSessionId",
			"operationId",
			"executorGeneration",
			"epoch",
			"deadlineAt",
		],
		"Project value request",
	);
	return {
		version: literalField(row, "version", [1]),
		role: literalField(row, "role", PROJECT_VALUE_ROLES),
		workspaceSessionId: stringField(row, "workspaceSessionId", {
			maxBytes: 256,
		}),
		operationId: stringField(row, "operationId", { maxBytes: 512 }),
		executorGeneration: integerField(row, "executorGeneration", {
			minimum: 1,
		}),
		epoch: integerField(row, "epoch", { minimum: 1 }),
		deadlineAt: integerField(row, "deadlineAt", { minimum: 1 }),
	};
}

/** Validates one key/value list against the delivery limits. */
export function parseProjectValues(
	input: unknown,
): { key: string; value: string }[] {
	if (!Array.isArray(input) || input.length > PROJECT_VALUE_LIMITS.count)
		throw new ContractParseError("invalid_field", "values are invalid.");
	const seen = new Set<string>();
	let total = 0;
	return input.map((entry) => {
		const row = strictRecord(entry, ["key", "value"], "Project value");
		const key = stringField(row, "key", {
			maxBytes: PROJECT_VALUE_LIMITS.keyBytes,
		});
		const value = row.value;
		if (typeof value !== "string")
			throw new ContractParseError("invalid_field", "value is invalid.");
		const bytes = encoder.encode(value).byteLength;
		total += bytes + encoder.encode(key).byteLength;
		if (
			!KEY.test(key) ||
			seen.has(key) ||
			value.includes("\0") ||
			bytes > PROJECT_VALUE_LIMITS.valueBytes ||
			total > PROJECT_VALUE_LIMITS.totalBytes
		)
			throw new ContractParseError("invalid_field", "values are invalid.");
		seen.add(key);
		return { key, value };
	});
}

export function parseProjectValueGrantV1(
	input: unknown,
	operationId: string,
): ProjectValueGrantV1 {
	const value = decodeContractInput(
		input,
		PROJECT_VALUE_LIMITS.totalBytes * 2 + 16 * 1024,
	);
	const status = literalField(
		strictRecord(
			value,
			["version", "operationId", "status", "values", "reason"],
			"Project value grant",
		),
		"status",
		["granted", "denied"],
	);
	const row = strictRecord(
		value,
		status === "granted"
			? ["version", "operationId", "status", "values"]
			: ["version", "operationId", "status", "reason"],
		"Project value grant",
	);
	literalField(row, "version", [1]);
	if (row.operationId !== operationId)
		throw new ContractParseError(
			"operation_mismatch",
			"Project value grant belongs to another operation.",
		);
	return status === "granted"
		? {
				version: 1,
				operationId,
				status,
				values: parseProjectValues(row.values),
			}
		: {
				version: 1,
				operationId,
				status,
				reason: literalField(row, "reason", PROJECT_VALUE_DENIALS),
			};
}

/** Replaces every concrete value long enough to redact without erasing ordinary output. */
export function redactProjectValues(
	text: string,
	values: readonly string[],
): string {
	let out = text;
	for (const value of values)
		if (value.length >= PROJECT_VALUE_REDACTION_MIN_CHARACTERS)
			out = out.split(value).join(PROJECT_VALUE_REDACTION);
	return out;
}
