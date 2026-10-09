import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

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
