import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";
import { RUNTIME_LIMITS } from "./limits.js";

export type ModelAttemptV1 = {
	version: 1;
	effectId: string;
	operationId: string;
	runId: string;
	commandId: string;
	assistantId: string;
	taskId: number;
	epoch: number;
	attempt: number;
	generation: number;
	deadlineAt: number;
	requestDigest: string;
	kind: "generation" | "custom_summary";
};

export function parseModelAttemptV1(input: unknown): ModelAttemptV1 {
	const row = strictRecord(
		decodeContractInput(input, 4096),
		[
			"version",
			"effectId",
			"operationId",
			"runId",
			"commandId",
			"assistantId",
			"taskId",
			"epoch",
			"attempt",
			"generation",
			"deadlineAt",
			"requestDigest",
			"kind",
		],
		"model attempt",
	);
	const id = (key: string) => stringField(row, key, { maxBytes: 512 });
	const positive = (key: string) => integerField(row, key, { minimum: 1 });
	const digest = stringField(row, "requestDigest", { maxBytes: 64 });
	if (!/^[a-f0-9]{64}$/.test(digest))
		throw new ContractParseError("invalid_digest", "Invalid request digest.");
	return {
		version: literalField(row, "version", [1]),
		effectId: id("effectId"),
		operationId: id("operationId"),
		runId: id("runId"),
		commandId: id("commandId"),
		assistantId: id("assistantId"),
		taskId: positive("taskId"),
		epoch: positive("epoch"),
		attempt: positive("attempt"),
		generation: positive("generation"),
		deadlineAt: positive("deadlineAt"),
		requestDigest: digest,
		kind: literalField(row, "kind", ["generation", "custom_summary"]),
	};
}

export const SYNTHETIC_MODEL_URL =
	"https://codex-model-fixture.invalid/v1/stream";
export const SYNTHETIC_MODEL_LIMITS = {
	requestBytes: 131072,
	transcriptBytes: 98304,
	frameBytes: 16384,
	responseBytes: 131072,
	outputBytes: 65536,
	frames: 128,
	deadlineMs: 30000,
} as const;
export type SyntheticModelId = "faux-1" | "faux-2";
export type SyntheticThinking = "off" | "low" | "high" | "max";
export type SyntheticModelBodyV1 = {
	version: 1;
	protocol: "ditto-synthetic-ndjson-1";
	purpose: "generation" | "custom_summary" | "git_metadata";
	model: SyntheticModelId;
	thinking: SyntheticThinking;
	transcript: string;
	options: { maxTokens: number };
};
export type SyntheticModelRequestV1 = {
	version: 1;
	method: "POST";
	url: typeof SYNTHETIC_MODEL_URL;
	headers: [string, string][];
	body: string;
};
export type SyntheticAccountV1 = {
	version: 1;
	status: "available" | "unavailable" | "revoked";
	generation: number;
	revision: number;
	models: { id: SyntheticModelId; thinking: SyntheticThinking[] }[];
};
export type SyntheticFrameV1 =
	| { version: 1; type: "delta"; text: string }
	| {
			version: 1;
			type: "done";
			stopReason: "stop" | "error";
			inputTokens: number;
			outputTokens: number;
	  };

export function parseSyntheticModelBodyV1(
	input: unknown,
): SyntheticModelBodyV1 {
	const r = strictRecord(
		decodeContractInput(input, SYNTHETIC_MODEL_LIMITS.requestBytes),
		[
			"version",
			"protocol",
			"purpose",
			"model",
			"thinking",
			"transcript",
			"options",
		],
		"synthetic model body",
	);
	const o = strictRecord(r.options, ["maxTokens"], "synthetic options");
	return {
		version: literalField(r, "version", [1]),
		protocol: literalField(r, "protocol", ["ditto-synthetic-ndjson-1"]),
		purpose: literalField(r, "purpose", [
			"generation",
			"custom_summary",
			"git_metadata",
		]),
		model: literalField(r, "model", ["faux-1", "faux-2"]),
		thinking: literalField(r, "thinking", ["off", "low", "high", "max"]),
		transcript: stringField(r, "transcript", {
			maxBytes: SYNTHETIC_MODEL_LIMITS.transcriptBytes,
		}),
		options: {
			maxTokens: integerField(o, "maxTokens", { minimum: 1, maximum: 8192 }),
		},
	};
}

export function parseSyntheticModelRequestV1(
	input: unknown,
): SyntheticModelRequestV1 {
	const r = strictRecord(
		decodeContractInput(input, SYNTHETIC_MODEL_LIMITS.requestBytes),
		["version", "method", "url", "headers", "body"],
		"synthetic model request",
	);
	if (!Array.isArray(r.headers) || r.headers.length !== 2)
		throw new ContractParseError(
			"invalid_headers",
			"Exact synthetic headers required.",
		);
	const seen = new Set<string>();
	const headers: [string, string][] = r.headers.map((entry: unknown) => {
		if (
			!Array.isArray(entry) ||
			entry.length !== 2 ||
			typeof entry[0] !== "string" ||
			typeof entry[1] !== "string" ||
			seen.has(entry[0]) ||
			!(
				(entry[0] === "content-type" && entry[1] === "application/json") ||
				(entry[0] === "accept" && entry[1] === "application/x-ndjson")
			)
		)
			throw new ContractParseError(
				"invalid_headers",
				"Invalid synthetic headers.",
			);
		seen.add(entry[0]);
		return [entry[0], entry[1]];
	});
	const body = parseSyntheticModelBodyV1(
		stringField(r, "body", { maxBytes: SYNTHETIC_MODEL_LIMITS.requestBytes }),
	);
	return {
		version: literalField(r, "version", [1]),
		method: literalField(r, "method", ["POST"]),
		url: literalField(r, "url", [SYNTHETIC_MODEL_URL]),
		headers,
		body: JSON.stringify(body),
	};
}

export function parseSyntheticAccountV1(input: unknown): SyntheticAccountV1 {
	const r = strictRecord(
		decodeContractInput(input, 4096),
		["version", "status", "generation", "revision", "models"],
		"synthetic account",
	);
	const status = literalField(r, "status", [
		"available",
		"unavailable",
		"revoked",
	]);
	if (
		!Array.isArray(r.models) ||
		r.models.length > 2 ||
		(status !== "available" && r.models.length !== 0)
	)
		throw new ContractParseError("invalid_models", "Invalid account models.");
	const ids = new Set<string>();
	const models = r.models.map((input: unknown) => {
		const m = strictRecord(input, ["id", "thinking"], "synthetic capability");
		const id = literalField(m, "id", ["faux-1", "faux-2"]);
		if (
			ids.has(id) ||
			!Array.isArray(m.thinking) ||
			m.thinking.length < 1 ||
			m.thinking.length > 4
		)
			throw new ContractParseError(
				"invalid_models",
				"Invalid account capability.",
			);
		ids.add(id);
		const thinking = m.thinking.map((level: unknown) =>
			literalField<SyntheticThinking>({ level }, "level", [
				"off",
				"low",
				"high",
				"max",
			]),
		);
		if (new Set(thinking).size !== thinking.length)
			throw new ContractParseError(
				"invalid_models",
				"Duplicate thinking capability.",
			);
		return { id, thinking };
	});
	return {
		version: literalField(r, "version", [1]),
		status,
		generation: integerField(r, "generation", { minimum: 1 }),
		revision: integerField(r, "revision", { minimum: 1 }),
		models,
	};
}

export function parseSyntheticFrameV1(input: unknown): SyntheticFrameV1 {
	const decoded = decodeContractInput(input, SYNTHETIC_MODEL_LIMITS.frameBytes);
	const r = strictRecord(
		decoded,
		["version", "type", "text", "stopReason", "inputTokens", "outputTokens"],
		"synthetic frame",
	);
	literalField(r, "version", [1]);
	if (r.type === "delta") {
		strictRecord(r, ["version", "type", "text"], "synthetic delta");
		return {
			version: 1,
			type: "delta",
			text: stringField(r, "text", { maxBytes: 8192 }),
		};
	}
	strictRecord(
		r,
		["version", "type", "stopReason", "inputTokens", "outputTokens"],
		"synthetic completion",
	);
	return {
		version: 1,
		type: literalField(r, "type", ["done"]),
		stopReason: literalField(r, "stopReason", ["stop", "error"]),
		inputTokens: integerField(r, "inputTokens", {
			minimum: 0,
			maximum: 1000000,
		}),
		outputTokens: integerField(r, "outputTokens", {
			minimum: 0,
			maximum: 8192,
		}),
	};
}

export type ModelSubjectV1 = {
	version: 1;
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	identityId: string;
	incarnationId: string;
	controllerNamespace: string;
	lifecycleGeneration: number;
	runtimeOwnerVersion: number;
	connectionGeneration: number;
	capabilityRevision: number;
};
export function parseModelSubjectV1(input: unknown): ModelSubjectV1 {
	const r = strictRecord(
		decodeContractInput(input, 4096),
		[
			"version",
			"userId",
			"projectId",
			"workspaceSessionId",
			"identityId",
			"incarnationId",
			"controllerNamespace",
			"lifecycleGeneration",
			"runtimeOwnerVersion",
			"connectionGeneration",
			"capabilityRevision",
		],
		"model subject",
	);
	const id = (key: string) => stringField(r, key, { maxBytes: 256 });
	const n = (key: string) => integerField(r, key, { minimum: 1 });
	return {
		version: literalField(r, "version", [1]),
		userId: id("userId"),
		projectId: id("projectId"),
		workspaceSessionId: id("workspaceSessionId"),
		identityId: id("identityId"),
		incarnationId: id("incarnationId"),
		controllerNamespace: id("controllerNamespace"),
		lifecycleGeneration: n("lifecycleGeneration"),
		runtimeOwnerVersion: n("runtimeOwnerVersion"),
		connectionGeneration: n("connectionGeneration"),
		capabilityRevision: n("capabilityRevision"),
	};
}
export type ModelTransportDescriptorV1 = {
	version: 1;
	subject: ModelSubjectV1;
	attempt: ModelAttemptV1;
	requestDigest: string;
};
export function parseModelTransportDescriptorV1(
	input: unknown,
): ModelTransportDescriptorV1 {
	const r = strictRecord(
		decodeContractInput(input, 12288),
		["version", "subject", "attempt", "requestDigest"],
		"model transport descriptor",
	);
	const requestDigest = stringField(r, "requestDigest", { maxBytes: 64 });
	if (!/^[a-f0-9]{64}$/.test(requestDigest))
		throw new ContractParseError("invalid_digest", "Invalid transport digest.");
	return {
		version: literalField(r, "version", [1]),
		subject: parseModelSubjectV1(r.subject),
		attempt: parseModelAttemptV1(r.attempt),
		requestDigest,
	};
}
export type SyntheticModelOutcomeV1 =
	| { version: 1; status: "complete"; frames: SyntheticFrameV1[] }
	| {
			version: 1;
			status: "unavailable" | "denied" | "failed_known" | "outcome_unknown";
	  };

export async function syntheticModelRequestDigest(
	input: unknown,
): Promise<string> {
	const request = parseSyntheticModelRequestV1(input);
	request.headers = [
		["content-type", "application/json"],
		["accept", "application/x-ndjson"],
	];
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(request)),
	);
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export const MODEL_FIXTURE_URL_V2 =
	"https://codex-model-fixture.invalid/v2/stream";
export const MODEL_LIMITS_V2 = {
	requestBytes: 1_048_576,
	transcriptMessages: 4096,
	toolDefinitions: 128,
	responseBytes: 1_048_576,
	frameBytes: 262_144,
	frames: 2048,
	outputBytes: 524_288,
	toolCalls: 64,
} as const;

export type ModelThinkingV2 =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";
export type ModelJsonObjectV2 = { [key: string]: unknown };
export type ModelTextBlockV2 = {
	type: "text";
	text: string;
	textSignature?: string;
};
export type ModelToolDefinitionV2 = {
	name: string;
	description: string;
	parameters: ModelJsonObjectV2;
};
export type TranscriptMessageV2 =
	| {
			role: "system";
			content: string | ModelTextBlockV2[];
			sections?: Record<string, string | null>;
			toolsAdded?: ModelToolDefinitionV2[];
			toolsRemoved?: { name: string }[];
	  }
	| { role: "user"; content: string | ModelTextBlockV2[] }
	| {
			role: "assistant";
			content: (
				| ModelTextBlockV2
				| {
						type: "thinking";
						thinking: string;
						thinkingSignature?: string;
						redacted?: boolean;
				  }
				| {
						type: "toolCall";
						id: string;
						name: string;
						arguments: ModelJsonObjectV2;
						thoughtSignature?: string;
				  }
			)[];
	  }
	| {
			role: "toolResult";
			toolCallId: string;
			toolName: string;
			content: ModelTextBlockV2[];
			isError: boolean;
	  };
export type TranscriptV2 = { messages: TranscriptMessageV2[] };
export type ModelRequestV2 = {
	version: 2;
	purpose: "generation" | "custom_summary" | "git_metadata";
	provider: string;
	model: string;
	thinking: ModelThinkingV2;
	maxTokens: number;
	transcript: TranscriptV2;
};
export type ModelFrameV2 =
	| { version: 2; type: "text"; text: string; signature?: string }
	| {
			version: 2;
			type: "thinking";
			thinking: string;
			signature?: string;
			redacted?: boolean;
	  }
	| {
			version: 2;
			type: "toolCall";
			id: string;
			name: string;
			arguments: ModelJsonObjectV2;
	  }
	| {
			version: 2;
			type: "done";
			stopReason: "stop" | "length" | "toolUse" | "error";
			usage: {
				input: number;
				output: number;
				cacheRead: number;
				reasoning?: number;
			};
	  };
export type ModelOutcomeV2 =
	| { version: 2; status: "complete"; frames: ModelFrameV2[] }
	| {
			version: 2;
			status: "unavailable" | "denied" | "failed_known" | "outcome_unknown";
	  };

const V2_THINKING: readonly ModelThinkingV2[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
const V2_ASSISTANT_DROPPED = [
	"api",
	"provider",
	"model",
	"responseModel",
	"responseId",
	"providerThinkingLevel",
	"thinkingLevel",
	"diagnostics",
	"usage",
	"stopReason",
	"deferred",
	"errorMessage",
	"rawStopReason",
	"endTurn",
	"timestamp",
];
const V2_TOOL_RESULT_DROPPED = ["details", "usage", "nestedCalls", "timestamp"];
const V2_SIGNATURE_BYTES = 65_536;
const v2Encoder = new TextEncoder();

function v2Fail(code: string): never {
	throw new ContractParseError(code, `Invalid model contract (${code}).`);
}

function v2Record(
	value: unknown,
	allowed: readonly string[],
	code: string,
	dropped: readonly string[] = [],
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return v2Fail(code);
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record))
		if (!allowed.includes(key) && !dropped.includes(key)) v2Fail(code);
	return record;
}

function v2String(
	value: unknown,
	code: string,
	options: { maxBytes: number; nonEmpty?: boolean; pattern?: RegExp },
): string {
	if (
		typeof value !== "string" ||
		(options.nonEmpty && value.length === 0) ||
		v2Encoder.encode(value).byteLength > options.maxBytes ||
		(options.pattern && !options.pattern.test(value))
	)
		return v2Fail(code);
	return value;
}

function v2OptionalString(
	record: Record<string, unknown>,
	key: string,
	code: string,
	maxBytes: number,
): string | undefined {
	return record[key] === undefined
		? undefined
		: v2String(record[key], code, { maxBytes });
}

function v2Json(value: unknown, code: string, depth = 0): unknown {
	if (depth > RUNTIME_LIMITS.jsonMaxNesting) return v2Fail(code);
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : v2Fail(code);
	if (Array.isArray(value))
		return value.map((item) => v2Json(item, code, depth + 1));
	if (
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		const copy: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			Object.defineProperty(copy, key, {
				value: v2Json(item, code, depth + 1),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return copy;
	}
	return v2Fail(code);
}

function v2JsonObject(value: unknown, code: string): ModelJsonObjectV2 {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return v2Fail(code);
	return v2Json(value, code) as ModelJsonObjectV2;
}

function v2Decode(input: unknown, maxBytes: number, code: string): unknown {
	try {
		return decodeContractInput(input, maxBytes);
	} catch (error) {
		if (
			error instanceof ContractParseError &&
			error.code === "contract_too_large"
		)
			return v2Fail("oversized");
		return v2Fail(code);
	}
}

function v2TextBlock(block: unknown): ModelTextBlockV2 {
	const r = v2Record(
		block,
		["type", "text", "textSignature"],
		"invalid_content",
	);
	if (r.type !== "text") return v2Fail("invalid_content");
	const signature = v2OptionalString(
		r,
		"textSignature",
		"invalid_content",
		V2_SIGNATURE_BYTES,
	);
	return {
		type: "text",
		text: v2String(r.text, "invalid_content", {
			maxBytes: MODEL_LIMITS_V2.requestBytes,
		}),
		...(signature === undefined ? {} : { textSignature: signature }),
	};
}

function v2TextBlocks(value: unknown): ModelTextBlockV2[] {
	if (!Array.isArray(value)) return v2Fail("invalid_content");
	return value.map((block) => v2TextBlock(block));
}

function v2Content(value: unknown): string | ModelTextBlockV2[] {
	return typeof value === "string"
		? v2String(value, "invalid_content", {
				maxBytes: MODEL_LIMITS_V2.requestBytes,
			})
		: v2TextBlocks(value);
}

function v2Message(
	input: unknown,
	tools: { count: number },
): TranscriptMessageV2 {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return v2Fail("invalid_request");
	const role = (input as { role?: unknown }).role;
	if (role === "system") {
		const r = v2Record(
			input,
			["role", "content", "sections", "toolsAdded", "toolsRemoved"],
			"invalid_request",
			["timestamp"],
		);
		const message: Extract<TranscriptMessageV2, { role: "system" }> = {
			role: "system",
			content: v2Content(r.content),
		};
		if (r.sections !== undefined) {
			const sections = v2Record(
				r.sections,
				Object.keys(r.sections as object),
				"invalid_request",
			);
			const copy: Record<string, string | null> = {};
			for (const [key, value] of Object.entries(sections))
				Object.defineProperty(copy, key, {
					value:
						value === null
							? null
							: v2String(value, "invalid_content", {
									maxBytes: MODEL_LIMITS_V2.requestBytes,
								}),
					enumerable: true,
					writable: true,
					configurable: true,
				});
			message.sections = copy;
		}
		if (r.toolsAdded !== undefined) {
			if (!Array.isArray(r.toolsAdded)) return v2Fail("invalid_request");
			message.toolsAdded = r.toolsAdded.map((tool: unknown) => {
				tools.count += 1;
				if (tools.count > MODEL_LIMITS_V2.toolDefinitions)
					return v2Fail("oversized");
				const t = v2Record(
					tool,
					["name", "description", "parameters"],
					"invalid_request",
				);
				return {
					name: v2String(t.name, "invalid_request", {
						maxBytes: 128,
						nonEmpty: true,
					}),
					description: v2String(t.description, "invalid_request", {
						maxBytes: 65_536,
					}),
					parameters: v2JsonObject(t.parameters, "invalid_request"),
				};
			});
		}
		if (r.toolsRemoved !== undefined) {
			if (!Array.isArray(r.toolsRemoved)) return v2Fail("invalid_request");
			message.toolsRemoved = r.toolsRemoved.map((tool: unknown) => ({
				name: v2String(
					v2Record(tool, ["name"], "invalid_request").name,
					"invalid_request",
					{ maxBytes: 128, nonEmpty: true },
				),
			}));
		}
		return message;
	}
	if (role === "user") {
		const r = v2Record(input, ["role", "content"], "invalid_request", [
			"timestamp",
		]);
		return { role: "user", content: v2Content(r.content) };
	}
	if (role === "assistant") {
		const r = v2Record(
			input,
			["role", "content"],
			"invalid_request",
			V2_ASSISTANT_DROPPED,
		);
		if (!Array.isArray(r.content)) return v2Fail("invalid_content");
		const content = r.content.map((block: unknown) => {
			const type =
				typeof block === "object" && block !== null
					? (block as { type?: unknown }).type
					: undefined;
			if (type === "text") return v2TextBlock(block);
			if (type === "thinking") {
				const b = v2Record(
					block,
					["type", "thinking", "thinkingSignature", "redacted"],
					"invalid_content",
				);
				if (b.redacted !== undefined && typeof b.redacted !== "boolean")
					return v2Fail("invalid_content");
				const signature = v2OptionalString(
					b,
					"thinkingSignature",
					"invalid_content",
					V2_SIGNATURE_BYTES,
				);
				return {
					type: "thinking" as const,
					thinking: v2String(b.thinking, "invalid_content", {
						maxBytes: MODEL_LIMITS_V2.requestBytes,
					}),
					...(signature === undefined ? {} : { thinkingSignature: signature }),
					...(b.redacted === undefined ? {} : { redacted: b.redacted }),
				};
			}
			if (type === "toolCall") {
				const b = v2Record(
					block,
					["type", "id", "name", "arguments", "thoughtSignature"],
					"invalid_content",
				);
				const signature = v2OptionalString(
					b,
					"thoughtSignature",
					"invalid_content",
					V2_SIGNATURE_BYTES,
				);
				return {
					type: "toolCall" as const,
					id: v2String(b.id, "invalid_content", {
						maxBytes: 512,
						nonEmpty: true,
					}),
					name: v2String(b.name, "invalid_content", {
						maxBytes: 128,
						nonEmpty: true,
					}),
					arguments: v2JsonObject(b.arguments, "invalid_content"),
					...(signature === undefined ? {} : { thoughtSignature: signature }),
				};
			}
			return v2Fail("invalid_content");
		});
		return { role: "assistant", content };
	}
	if (role === "toolResult") {
		const r = v2Record(
			input,
			["role", "toolCallId", "toolName", "content", "isError"],
			"invalid_request",
			V2_TOOL_RESULT_DROPPED,
		);
		if (typeof r.isError !== "boolean") return v2Fail("invalid_request");
		return {
			role: "toolResult",
			toolCallId: v2String(r.toolCallId, "invalid_request", {
				maxBytes: 512,
				nonEmpty: true,
			}),
			toolName: v2String(r.toolName, "invalid_request", {
				maxBytes: 128,
				nonEmpty: true,
			}),
			content: v2TextBlocks(r.content),
			isError: r.isError,
		};
	}
	return v2Fail("invalid_request");
}

export function parseModelRequestV2(input: unknown): ModelRequestV2 {
	const r = v2Record(
		v2Decode(input, MODEL_LIMITS_V2.requestBytes, "invalid_request"),
		[
			"version",
			"purpose",
			"provider",
			"model",
			"thinking",
			"maxTokens",
			"transcript",
		],
		"invalid_request",
	);
	const purpose = r.purpose;
	if (
		r.version !== 2 ||
		(purpose !== "generation" &&
			purpose !== "custom_summary" &&
			purpose !== "git_metadata") ||
		!V2_THINKING.includes(r.thinking as ModelThinkingV2) ||
		!Number.isSafeInteger(r.maxTokens) ||
		(r.maxTokens as number) < 1 ||
		(r.maxTokens as number) > 131_072
	)
		return v2Fail("invalid_request");
	const transcript = v2Record(r.transcript, ["messages"], "invalid_request");
	if (
		!Array.isArray(transcript.messages) ||
		transcript.messages.length < 1 ||
		transcript.messages.length > MODEL_LIMITS_V2.transcriptMessages
	)
		return v2Fail("invalid_request");
	const tools = { count: 0 };
	const request: ModelRequestV2 = {
		version: 2,
		purpose,
		provider: v2String(r.provider, "invalid_request", {
			maxBytes: 64,
			nonEmpty: true,
			pattern: /^[a-z0-9-]+$/,
		}),
		model: v2String(r.model, "invalid_request", {
			maxBytes: 128,
			nonEmpty: true,
			pattern: /^[A-Za-z0-9._:/-]+$/,
		}),
		thinking: r.thinking as ModelThinkingV2,
		maxTokens: r.maxTokens as number,
		transcript: {
			messages: transcript.messages.map((message: unknown) =>
				v2Message(message, tools),
			),
		},
	};
	if (
		v2Encoder.encode(JSON.stringify(request)).byteLength >
		MODEL_LIMITS_V2.requestBytes
	)
		return v2Fail("oversized");
	return request;
}

export function parseModelFrameV2(input: unknown): ModelFrameV2 {
	const r = v2Record(
		v2Decode(input, MODEL_LIMITS_V2.frameBytes, "invalid_frame"),
		[
			"version",
			"type",
			"text",
			"thinking",
			"signature",
			"redacted",
			"id",
			"name",
			"arguments",
			"stopReason",
			"usage",
		],
		"invalid_frame",
	);
	if (r.version !== 2) return v2Fail("invalid_frame");
	const only = (keys: readonly string[]) =>
		v2Record(r, ["version", "type", ...keys], "invalid_frame");
	if (r.type === "text") {
		only(["text", "signature"]);
		const signature = v2OptionalString(
			r,
			"signature",
			"invalid_frame",
			V2_SIGNATURE_BYTES,
		);
		return {
			version: 2,
			type: "text",
			text: v2String(r.text, "invalid_frame", {
				maxBytes: MODEL_LIMITS_V2.frameBytes,
			}),
			...(signature === undefined ? {} : { signature }),
		};
	}
	if (r.type === "thinking") {
		only(["thinking", "signature", "redacted"]);
		if (r.redacted !== undefined && typeof r.redacted !== "boolean")
			return v2Fail("invalid_frame");
		const signature = v2OptionalString(
			r,
			"signature",
			"invalid_frame",
			V2_SIGNATURE_BYTES,
		);
		return {
			version: 2,
			type: "thinking",
			thinking: v2String(r.thinking, "invalid_frame", {
				maxBytes: MODEL_LIMITS_V2.frameBytes,
			}),
			...(signature === undefined ? {} : { signature }),
			...(r.redacted === undefined ? {} : { redacted: r.redacted }),
		};
	}
	if (r.type === "toolCall") {
		only(["id", "name", "arguments"]);
		return {
			version: 2,
			type: "toolCall",
			id: v2String(r.id, "invalid_frame", { maxBytes: 512, nonEmpty: true }),
			name: v2String(r.name, "invalid_frame", {
				maxBytes: 128,
				nonEmpty: true,
			}),
			arguments: v2JsonObject(r.arguments, "invalid_frame"),
		};
	}
	if (r.type === "done") {
		only(["stopReason", "usage"]);
		if (
			r.stopReason !== "stop" &&
			r.stopReason !== "length" &&
			r.stopReason !== "toolUse" &&
			r.stopReason !== "error"
		)
			return v2Fail("invalid_frame");
		const u = v2Record(
			r.usage,
			["input", "output", "cacheRead", "reasoning"],
			"invalid_frame",
		);
		const count = (key: string): number => {
			const value = u[key];
			if (
				typeof value !== "number" ||
				!Number.isSafeInteger(value) ||
				value < 0 ||
				value > 1_000_000_000
			)
				return v2Fail("invalid_frame");
			return value;
		};
		const reasoning =
			u.reasoning === undefined ? undefined : count("reasoning");
		return {
			version: 2,
			type: "done",
			stopReason: r.stopReason,
			usage: {
				input: count("input"),
				output: count("output"),
				cacheRead: count("cacheRead"),
				...(reasoning === undefined ? {} : { reasoning }),
			},
		};
	}
	return v2Fail("invalid_frame");
}

/** Whole-reply rules: bounded count, content-order frames, one final `done`. */
export function validateModelFramesV2(input: unknown): ModelFrameV2[] {
	if (
		!Array.isArray(input) ||
		input.length < 1 ||
		input.length > MODEL_LIMITS_V2.frames
	)
		return v2Fail("invalid_frame");
	const frames = input.map((frame: unknown) => parseModelFrameV2(frame));
	let toolCalls = 0;
	let output = 0;
	frames.forEach((frame, index) => {
		if ((frame.type === "done") !== (index === frames.length - 1))
			v2Fail("invalid_frame");
		if (frame.type === "toolCall") toolCalls += 1;
		if (frame.type !== "done")
			output += v2Encoder.encode(
				frame.type === "text"
					? frame.text
					: frame.type === "thinking"
						? frame.thinking
						: JSON.stringify(frame.arguments),
			).byteLength;
	});
	if (toolCalls > MODEL_LIMITS_V2.toolCalls) return v2Fail("oversized");
	if (output > MODEL_LIMITS_V2.outputBytes) return v2Fail("oversized");
	return frames;
}

export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

export async function modelRequestDigestV2(input: unknown): Promise<string> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		v2Encoder.encode(canonicalJson(parseModelRequestV2(input))),
	);
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
