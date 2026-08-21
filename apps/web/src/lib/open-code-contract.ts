export const OPENCODE_CONTRACT_VERSION = 1;
export const OPENCODE_CONTRACT_DENIAL_LIMIT = 3;
/** Public placeholder. No authority without identity + open D1 operation. */
export const OPENCODE_PLACEHOLDER_API_KEY =
	"ditto-public-opencode-placeholder" as const;

export const OPENCODE_REQUEST_HOST = "opencode.ai";
export const OPENCODE_REQUEST_PATH = "/zen/v1/chat/completions";
export const OPENCODE_REQUEST_METHOD = "POST";
export const OPENCODE_REQUEST_MODEL = "deepseek-v4-flash-free";
export const OPENCODE_UPSTREAM_URL =
	"https://opencode.ai/zen/v1/chat/completions";

export const MAX_OPENCODE_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

export const OPENCODE_OPERATION_TYPES = ["agent_run", "git_metadata"] as const;
export type OpenCodeOperationType = (typeof OPENCODE_OPERATION_TYPES)[number];

const ALLOWED_RESPONSE_STATUSES = new Set([
	200, 400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503,
]);

const ALLOWED_RESPONSE_HEADERS = [
	"content-type",
	"cache-control",
	"content-length",
	"x-request-id",
];

const FORBIDDEN_REQUEST_HEADERS = [
	"cookie",
	"proxy-authorization",
	"proxy-connection",
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"connection",
	"transfer-encoding",
	"te",
	"upgrade",
	"http2-settings",
];

const ALLOWED_REQUEST_HEADERS = new Set([
	"authorization",
	"content-type",
	"content-length",
	"content-encoding",
	"accept",
	"accept-encoding",
	"user-agent",
]);

const BODY_KEYS = new Set([
	"model",
	"messages",
	"stream",
	"stream_options",
	"max_tokens",
	"temperature",
	"tools",
	"tool_choice",
	"reasoning_effort",
]);

const MESSAGE_ROLES = new Set(["system", "user", "assistant", "tool"]);
const ASSISTANT_KEYS = new Set([
	"role",
	"content",
	"tool_calls",
	"reasoning_content",
	"reasoning",
	"reasoning_text",
	"reasoning_details",
]);
const USER_KEYS = new Set(["role", "content"]);
const SYSTEM_KEYS = new Set(["role", "content"]);
const TOOL_RESULT_KEYS = new Set(["role", "content", "tool_call_id", "name"]);
const TOOL_CALL_KEYS = new Set(["id", "type", "function"]);
const TOOL_CALL_FN_KEYS = new Set(["name", "arguments"]);
const TOOL_DEF_KEYS = new Set(["type", "function"]);
const TOOL_FN_KEYS = new Set(["name", "description", "parameters", "strict"]);
const STREAM_OPTIONS_KEYS = new Set(["include_usage"]);
const TEXT_PART_KEYS = new Set(["type", "text"]);
const TOOL_CHOICE_OBJECT_KEYS = new Set(["type", "function"]);
const TOOL_CHOICE_FN_KEYS = new Set(["name"]);

const OPENCODE_HOST_MARKERS = [
	"opencode.ai",
	"api.opencode.ai",
	"opencode.ditto.invalid",
];

export class OpenCodeContractError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "OpenCodeContractError";
		this.code = code;
	}
}

export type OpenCodeContractResult =
	| {
			ok: true;
			upstreamUrl: URL;
			method: string;
			headers: Headers;
			body: string;
	  }
	| { ok: false; code: string; message: string };

function isOpenCodeMarkerHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return OPENCODE_HOST_MARKERS.includes(host);
}

export function classifyOpenCodeRequest(request: Request): {
	kind: "model" | "model_near_miss" | "other";
	host: string;
} {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return { kind: "other", host: "" };
	}
	const host = url.hostname.toLowerCase();
	if (!isOpenCodeMarkerHost(host)) {
		return { kind: "other", host };
	}
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	if (
		url.protocol === "https:" &&
		host === OPENCODE_REQUEST_HOST &&
		port === "443" &&
		url.pathname === OPENCODE_REQUEST_PATH
	) {
		return { kind: "model", host };
	}
	return { kind: "model_near_miss", host };
}

function assertPlainObject(
	value: unknown,
	code: string,
	message: string,
): Record<string, unknown> {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new OpenCodeContractError(code, message);
	}
	return value as Record<string, unknown>;
}

function assertExactKeys(
	record: Record<string, unknown>,
	allowed: Set<string>,
	code = "unknown_field",
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			throw new OpenCodeContractError(
				code,
				`Unknown field ${key} is not allowed.`,
			);
		}
	}
}

function assertString(value: unknown, code: string, message: string): string {
	if (typeof value !== "string") {
		throw new OpenCodeContractError(code, message);
	}
	return value;
}

function parseJsonRejectingDuplicates(text: string): unknown {
	let index = 0;
	const end = text.length;

	const fail = (code: string, message: string): never => {
		throw new OpenCodeContractError(code, message);
	};

	const peek = (): string => text[index] ?? "";
	const skipWs = () => {
		while (index < end) {
			const ch = text.charCodeAt(index);
			if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
				index += 1;
				continue;
			}
			break;
		}
	};

	const parseString = (): string => {
		if (peek() !== '"') {
			fail("malformed_json", "Expected string.");
		}
		index += 1;
		let out = "";
		while (index < end) {
			const ch = text[index];
			if (ch == null) {
				break;
			}
			if (ch === '"') {
				index += 1;
				return out;
			}
			if (ch === "\\") {
				index += 1;
				const esc = text[index];
				if (esc == null) {
					fail("malformed_json", "Unterminated string escape.");
				}
				index += 1;
				switch (esc) {
					case '"':
					case "\\":
					case "/":
						out += esc;
						break;
					case "b":
						out += "\b";
						break;
					case "f":
						out += "\f";
						break;
					case "n":
						out += "\n";
						break;
					case "r":
						out += "\r";
						break;
					case "t":
						out += "\t";
						break;
					case "u": {
						const hex = text.slice(index, index + 4);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
							fail("malformed_json", "Invalid unicode escape.");
						}
						out += String.fromCharCode(Number.parseInt(hex, 16));
						index += 4;
						break;
					}
					default:
						fail("malformed_json", "Invalid string escape.");
				}
				continue;
			}
			if (ch.charCodeAt(0) < 32) {
				fail("malformed_json", "Unescaped control character in string.");
			}
			out += ch;
			index += 1;
		}
		return fail("malformed_json", "Unterminated string.");
	};

	const parseNumber = (): number => {
		const start = index;
		if (peek() === "-") {
			index += 1;
		}
		if (peek() === "0") {
			index += 1;
		} else if (/[1-9]/.test(peek())) {
			while (/[0-9]/.test(peek())) {
				index += 1;
			}
		} else {
			fail("malformed_json", "Invalid number.");
		}
		if (peek() === ".") {
			index += 1;
			if (!/[0-9]/.test(peek())) {
				fail("malformed_json", "Invalid number.");
			}
			while (/[0-9]/.test(peek())) {
				index += 1;
			}
		}
		if (peek() === "e" || peek() === "E") {
			index += 1;
			if (peek() === "+" || peek() === "-") {
				index += 1;
			}
			if (!/[0-9]/.test(peek())) {
				fail("malformed_json", "Invalid number.");
			}
			while (/[0-9]/.test(peek())) {
				index += 1;
			}
		}
		const raw = text.slice(start, index);
		const value = Number(raw);
		if (!Number.isFinite(value)) {
			fail("malformed_json", "Invalid number.");
		}
		return value;
	};

	const parseLiteral = (literal: string, value: unknown): unknown => {
		if (text.slice(index, index + literal.length) !== literal) {
			fail("malformed_json", "Invalid literal.");
		}
		index += literal.length;
		return value;
	};

	const parseValue = (): unknown => {
		skipWs();
		const ch = peek();
		if (ch === "{") {
			return parseObject();
		}
		if (ch === "[") {
			return parseArray();
		}
		if (ch === '"') {
			return parseString();
		}
		if (ch === "-" || /[0-9]/.test(ch)) {
			return parseNumber();
		}
		if (ch === "t") {
			return parseLiteral("true", true);
		}
		if (ch === "f") {
			return parseLiteral("false", false);
		}
		if (ch === "n") {
			return parseLiteral("null", null);
		}
		return fail("malformed_json", "Unexpected JSON token.");
	};

	const parseObject = (): Record<string, unknown> => {
		index += 1;
		skipWs();
		const record: Record<string, unknown> = {};
		const seen = new Set<string>();
		if (peek() === "}") {
			index += 1;
			return record;
		}
		while (index < end) {
			skipWs();
			const key = parseString();
			if (key === "__proto__" || key === "prototype" || key === "constructor") {
				fail("unknown_field", `Field ${key} is not allowed.`);
			}
			if (seen.has(key)) {
				fail("duplicate_field", `Duplicate JSON key ${key}.`);
			}
			seen.add(key);
			skipWs();
			if (peek() !== ":") {
				fail("malformed_json", "Expected colon after object key.");
			}
			index += 1;
			record[key] = parseValue();
			skipWs();
			if (peek() === ",") {
				index += 1;
				continue;
			}
			if (peek() === "}") {
				index += 1;
				return record;
			}
			fail("malformed_json", "Expected comma or end of object.");
		}
		return fail("malformed_json", "Unterminated object.");
	};

	const parseArray = (): unknown[] => {
		index += 1;
		skipWs();
		const items: unknown[] = [];
		if (peek() === "]") {
			index += 1;
			return items;
		}
		while (index < end) {
			items.push(parseValue());
			skipWs();
			if (peek() === ",") {
				index += 1;
				continue;
			}
			if (peek() === "]") {
				index += 1;
				return items;
			}
			fail("malformed_json", "Expected comma or end of array.");
		}
		return fail("malformed_json", "Unterminated array.");
	};

	const value = parseValue();
	skipWs();
	if (index !== end) {
		fail("malformed_json", "Trailing data after JSON value.");
	}
	return value;
}

function assertContentType(value: string | null): void {
	if (value == null) {
		throw new OpenCodeContractError(
			"invalid_content_type",
			"Content-Type is required.",
		);
	}
	const normalized = value.split(";")[0]?.trim().toLowerCase();
	if (normalized !== "application/json") {
		throw new OpenCodeContractError(
			"invalid_content_type",
			"Content-Type must be application/json.",
		);
	}
	const params = value
		.split(";")
		.slice(1)
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	for (const param of params) {
		if (param === "charset=utf-8" || param === 'charset="utf-8"') {
			continue;
		}
		throw new OpenCodeContractError(
			"invalid_content_type",
			"Content-Type parameters are not allowed.",
		);
	}
}

function assertRequestHeaders(request: Request): void {
	let sawAuthorization = false;
	for (const [name, value] of request.headers) {
		const lower = name.toLowerCase();
		if (FORBIDDEN_REQUEST_HEADERS.includes(lower)) {
			throw new OpenCodeContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (lower.startsWith("proxy-") || lower.startsWith("x-forwarded-")) {
			throw new OpenCodeContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (lower.startsWith("x-stainless-")) {
			continue;
		}
		if (!ALLOWED_REQUEST_HEADERS.has(lower)) {
			throw new OpenCodeContractError(
				"forbidden_header",
				`Request header ${lower} is not on the allowlist.`,
			);
		}
		if (lower === "authorization") {
			sawAuthorization = true;
			const expected = `Bearer ${OPENCODE_PLACEHOLDER_API_KEY}`;
			if (value !== expected) {
				throw new OpenCodeContractError(
					"invalid_placeholder",
					"Authorization placeholder is invalid.",
				);
			}
		}
		if (lower === "content-encoding") {
			const encoding = value.trim().toLowerCase();
			if (encoding !== "" && encoding !== "identity") {
				throw new OpenCodeContractError(
					"invalid_content_encoding",
					"Content-Encoding is not allowed.",
				);
			}
		}
		if (lower === "accept-encoding") {
			const encodings = value
				.toLowerCase()
				.split(",")
				.map((part) => part.trim().split(";")[0]?.trim())
				.filter(Boolean);
			if (
				encodings.some(
					(encoding) => encoding !== "identity" && encoding !== "*",
				)
			) {
				throw new OpenCodeContractError(
					"invalid_content_encoding",
					"Compressed Accept-Encoding is not allowed.",
				);
			}
		}
	}
	if (!sawAuthorization) {
		throw new OpenCodeContractError(
			"invalid_placeholder",
			"Authorization placeholder is required.",
		);
	}
	assertContentType(request.headers.get("content-type"));
}

function assertTextPart(value: unknown): { type: "text"; text: string } {
	const part = assertPlainObject(
		value,
		"invalid_body",
		"Message content part must be an object.",
	);
	assertExactKeys(part, TEXT_PART_KEYS);
	if (part.type !== "text") {
		throw new OpenCodeContractError(
			"unknown_field",
			"Only text content parts are allowed.",
		);
	}
	return {
		type: "text",
		text: assertString(part.text, "invalid_body", "Text part text is invalid."),
	};
}

function assertToolCall(value: unknown): Record<string, unknown> {
	const call = assertPlainObject(
		value,
		"invalid_body",
		"tool_calls entries must be objects.",
	);
	assertExactKeys(call, TOOL_CALL_KEYS);
	if (call.type !== "function") {
		throw new OpenCodeContractError(
			"invalid_body",
			"tool_calls type must be function.",
		);
	}
	const fn = assertPlainObject(
		call.function,
		"invalid_body",
		"tool_calls function must be an object.",
	);
	assertExactKeys(fn, TOOL_CALL_FN_KEYS);
	assertString(call.id, "invalid_body", "tool_calls id is invalid.");
	assertString(fn.name, "invalid_body", "tool_calls name is invalid.");
	assertString(
		fn.arguments,
		"invalid_body",
		"tool_calls arguments are invalid.",
	);
	return {
		id: call.id,
		type: "function",
		function: { name: fn.name, arguments: fn.arguments },
	};
}

function assertMessage(value: unknown): Record<string, unknown> {
	const message = assertPlainObject(
		value,
		"invalid_body",
		"Each message must be an object.",
	);
	const role = message.role;
	if (typeof role !== "string" || !MESSAGE_ROLES.has(role)) {
		throw new OpenCodeContractError("invalid_body", "Message role is invalid.");
	}
	if (role === "system") {
		assertExactKeys(message, SYSTEM_KEYS);
		return {
			role: "system",
			content: assertString(
				message.content,
				"invalid_body",
				"System content must be a string.",
			),
		};
	}
	if (role === "user") {
		assertExactKeys(message, USER_KEYS);
		if (typeof message.content === "string") {
			return { role: "user", content: message.content };
		}
		if (!Array.isArray(message.content) || message.content.length === 0) {
			throw new OpenCodeContractError(
				"invalid_body",
				"User content must be a string or text parts.",
			);
		}
		return {
			role: "user",
			content: message.content.map((part) => assertTextPart(part)),
		};
	}
	if (role === "tool") {
		assertExactKeys(message, TOOL_RESULT_KEYS);
		const out: Record<string, unknown> = {
			role: "tool",
			content: assertString(
				message.content,
				"invalid_body",
				"Tool result content must be a string.",
			),
			tool_call_id: assertString(
				message.tool_call_id,
				"invalid_body",
				"tool_call_id is invalid.",
			),
		};
		if (message.name !== undefined) {
			out.name = assertString(
				message.name,
				"invalid_body",
				"Tool result name is invalid.",
			);
		}
		return out;
	}

	assertExactKeys(message, ASSISTANT_KEYS);
	const out: Record<string, unknown> = { role: "assistant" };
	if (message.content !== undefined && message.content !== null) {
		out.content = assertString(
			message.content,
			"invalid_body",
			"Assistant content must be a string or null.",
		);
	} else {
		out.content = null;
	}
	if (message.tool_calls !== undefined) {
		if (!Array.isArray(message.tool_calls)) {
			throw new OpenCodeContractError(
				"invalid_body",
				"tool_calls must be an array.",
			);
		}
		if (message.tool_calls.length > 64) {
			throw new OpenCodeContractError(
				"invalid_body",
				"tool_calls exceeds the contract limit.",
			);
		}
		out.tool_calls = message.tool_calls.map((call) => assertToolCall(call));
	}
	for (const key of [
		"reasoning_content",
		"reasoning",
		"reasoning_text",
	] as const) {
		if (message[key] !== undefined) {
			out[key] = assertString(
				message[key],
				"invalid_body",
				`${key} must be a string.`,
			);
		}
	}
	if (message.reasoning_details !== undefined) {
		if (!Array.isArray(message.reasoning_details)) {
			throw new OpenCodeContractError(
				"invalid_body",
				"reasoning_details must be an array.",
			);
		}
		out.reasoning_details = message.reasoning_details;
	}
	return out;
}

function assertToolDefinition(value: unknown): Record<string, unknown> {
	const tool = assertPlainObject(
		value,
		"invalid_body",
		"Each tool must be an object.",
	);
	assertExactKeys(tool, TOOL_DEF_KEYS);
	if (tool.type !== "function") {
		throw new OpenCodeContractError(
			"invalid_body",
			"Tool type must be function.",
		);
	}
	const fn = assertPlainObject(
		tool.function,
		"invalid_body",
		"Tool function must be an object.",
	);
	assertExactKeys(fn, TOOL_FN_KEYS);
	const parameters = assertPlainObject(
		fn.parameters,
		"invalid_body",
		"Tool parameters must be an object.",
	);
	const out: Record<string, unknown> = {
		type: "function",
		function: {
			name: assertString(fn.name, "invalid_body", "Tool name is invalid."),
			parameters,
		},
	};
	const fnOut = out.function as Record<string, unknown>;
	if (fn.description !== undefined) {
		fnOut.description = assertString(
			fn.description,
			"invalid_body",
			"Tool description is invalid.",
		);
	}
	if (fn.strict !== undefined) {
		if (fn.strict !== false) {
			throw new OpenCodeContractError(
				"invalid_body",
				"Tool strict must be false.",
			);
		}
		fnOut.strict = false;
	}
	return out;
}

function assertToolChoice(value: unknown): unknown {
	if (value === "auto" || value === "none" || value === "required") {
		return value;
	}
	const choice = assertPlainObject(
		value,
		"invalid_body",
		"tool_choice is invalid.",
	);
	assertExactKeys(choice, TOOL_CHOICE_OBJECT_KEYS);
	if (choice.type !== "function") {
		throw new OpenCodeContractError(
			"invalid_body",
			"tool_choice type must be function.",
		);
	}
	const fn = assertPlainObject(
		choice.function,
		"invalid_body",
		"tool_choice function must be an object.",
	);
	assertExactKeys(fn, TOOL_CHOICE_FN_KEYS);
	return {
		type: "function",
		function: {
			name: assertString(
				fn.name,
				"invalid_body",
				"tool_choice name is invalid.",
			),
		},
	};
}

function validatePinnedBody(value: unknown): Record<string, unknown> {
	const body = assertPlainObject(
		value,
		"invalid_body",
		"Request body must be a JSON object.",
	);
	assertExactKeys(body, BODY_KEYS);
	if (body.model !== OPENCODE_REQUEST_MODEL) {
		throw new OpenCodeContractError(
			"invalid_model",
			"Request model is not the pinned OpenCode model.",
		);
	}
	if (body.stream !== true) {
		throw new OpenCodeContractError(
			"invalid_stream",
			"Request must use stream: true.",
		);
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		throw new OpenCodeContractError(
			"invalid_body",
			"messages must be a nonempty array.",
		);
	}
	if (body.messages.length > 512) {
		throw new OpenCodeContractError(
			"invalid_body",
			"messages exceeds the contract limit.",
		);
	}

	const validated: Record<string, unknown> = {
		model: OPENCODE_REQUEST_MODEL,
		messages: body.messages.map((message) => assertMessage(message)),
		stream: true,
	};

	if (body.stream_options !== undefined) {
		const options = assertPlainObject(
			body.stream_options,
			"invalid_stream",
			"stream_options must be an object.",
		);
		assertExactKeys(options, STREAM_OPTIONS_KEYS, "unknown_field");
		if (options.include_usage !== true) {
			throw new OpenCodeContractError(
				"invalid_stream",
				"stream_options.include_usage must be true.",
			);
		}
		validated.stream_options = { include_usage: true };
	}

	if (body.max_tokens !== undefined) {
		if (
			typeof body.max_tokens !== "number" ||
			!Number.isInteger(body.max_tokens) ||
			body.max_tokens < 1 ||
			body.max_tokens > 128_000
		) {
			throw new OpenCodeContractError("invalid_body", "max_tokens is invalid.");
		}
		validated.max_tokens = body.max_tokens;
	}

	if (body.temperature !== undefined) {
		if (
			typeof body.temperature !== "number" ||
			!Number.isFinite(body.temperature) ||
			body.temperature < 0 ||
			body.temperature > 2
		) {
			throw new OpenCodeContractError(
				"invalid_body",
				"temperature is invalid.",
			);
		}
		validated.temperature = body.temperature;
	}

	if (body.tools !== undefined) {
		if (!Array.isArray(body.tools) || body.tools.length > 128) {
			throw new OpenCodeContractError("invalid_body", "tools is invalid.");
		}
		validated.tools = body.tools.map((tool) => assertToolDefinition(tool));
	}

	if (body.tool_choice !== undefined) {
		validated.tool_choice = assertToolChoice(body.tool_choice);
	}

	if (body.reasoning_effort !== undefined) {
		if (body.reasoning_effort !== "high" && body.reasoning_effort !== "max") {
			throw new OpenCodeContractError(
				"invalid_body",
				"reasoning_effort is invalid.",
			);
		}
		validated.reasoning_effort = body.reasoning_effort;
	}

	return validated;
}

export async function validateOpenCodeRequest(
	request: Request,
	bound: { contractVersion: number },
): Promise<OpenCodeContractResult> {
	try {
		if (bound.contractVersion !== OPENCODE_CONTRACT_VERSION) {
			throw new OpenCodeContractError(
				"contract_version",
				"Unsupported OpenCode contract version.",
			);
		}

		const url = new URL(request.url);
		if (url.protocol !== "https:") {
			throw new OpenCodeContractError(
				"invalid_scheme",
				"OpenCode requests require HTTPS.",
			);
		}
		if (url.username || url.password) {
			throw new OpenCodeContractError(
				"embedded_credentials",
				"URL credentials are not allowed.",
			);
		}
		const host = url.hostname.toLowerCase();
		const port = url.port || "443";
		if (host !== OPENCODE_REQUEST_HOST || port !== "443") {
			throw new OpenCodeContractError(
				"invalid_host",
				"OpenCode requests are limited to opencode.ai:443.",
			);
		}
		if (url.pathname !== OPENCODE_REQUEST_PATH) {
			throw new OpenCodeContractError(
				"invalid_path",
				"OpenCode path is not the pinned chat completions endpoint.",
			);
		}
		if ([...url.searchParams.keys()].length > 0 || url.hash) {
			throw new OpenCodeContractError(
				"invalid_query",
				"OpenCode requests must not include a query or fragment.",
			);
		}
		if (request.method.toUpperCase() !== OPENCODE_REQUEST_METHOD) {
			throw new OpenCodeContractError(
				"invalid_method",
				"OpenCode requests must use POST.",
			);
		}

		assertRequestHeaders(request);

		const declared = request.headers.get("content-length");
		if (declared != null) {
			const length = Number(declared);
			if (
				!Number.isInteger(length) ||
				length < 0 ||
				length > MAX_OPENCODE_REQUEST_BODY_BYTES
			) {
				throw new OpenCodeContractError(
					"body_too_large",
					"OpenCode request body exceeds the contract limit.",
				);
			}
		}

		if (!request.body) {
			throw new OpenCodeContractError(
				"invalid_body",
				"OpenCode request body is required.",
			);
		}
		const raw = new Uint8Array(await request.arrayBuffer());
		if (raw.byteLength > MAX_OPENCODE_REQUEST_BODY_BYTES) {
			throw new OpenCodeContractError(
				"body_too_large",
				"OpenCode request body exceeds the contract limit.",
			);
		}
		if (raw.byteLength === 0) {
			throw new OpenCodeContractError(
				"invalid_body",
				"OpenCode request body is required.",
			);
		}
		if (declared != null && Number(declared) !== raw.byteLength) {
			throw new OpenCodeContractError(
				"invalid_body",
				"Content-Length does not match the request body.",
			);
		}

		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
		} catch {
			throw new OpenCodeContractError(
				"malformed_json",
				"Request body is not valid UTF-8.",
			);
		}

		const parsed = parseJsonRejectingDuplicates(text);
		const validated = validatePinnedBody(parsed);

		return {
			ok: true,
			upstreamUrl: new URL(OPENCODE_UPSTREAM_URL),
			method: OPENCODE_REQUEST_METHOD,
			headers: new Headers({
				accept: "application/json",
				"content-type": "application/json",
			}),
			body: JSON.stringify(validated),
		};
	} catch (error) {
		if (error instanceof OpenCodeContractError) {
			return { ok: false, code: error.code, message: error.message };
		}
		return {
			ok: false,
			code: "contract_error",
			message:
				error instanceof Error ? error.message : "OpenCode contract failed.",
		};
	}
}

export function buildAuthenticatedOpenCodeUpstreamRequest(options: {
	validated: Extract<OpenCodeContractResult, { ok: true }>;
	apiKey: string;
	signal?: AbortSignal | null;
}): Request {
	const headers = new Headers(options.validated.headers);
	headers.set("Authorization", `Bearer ${options.apiKey}`);
	headers.delete("cookie");
	const init: RequestInit = {
		method: options.validated.method,
		headers,
		body: options.validated.body,
		redirect: "manual",
	};
	if (options.signal) {
		init.signal = options.signal;
	}
	return new Request(options.validated.upstreamUrl, init);
}

export function wrapOpenCodeUpstreamResponse(response: Response): Response {
	if (response.status >= 300 && response.status < 400) {
		throw new OpenCodeContractError(
			"redirect_denied",
			"Upstream redirects are not followed.",
		);
	}
	if (!ALLOWED_RESPONSE_STATUSES.has(response.status)) {
		throw new OpenCodeContractError(
			"upstream_denied",
			"Upstream status is not allowed.",
		);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: sanitizeResponseHeaders(response.headers),
	});
}

function sanitizeResponseHeaders(source: Headers): Headers {
	const headers = new Headers();
	for (const name of ALLOWED_RESPONSE_HEADERS) {
		const value = source.get(name);
		if (value != null) {
			headers.set(name, value);
		}
	}
	return headers;
}
