import { redactSecrets } from "#/lib/secret-redaction";

export const DITTO_ACTION_CONTRACT_VERSION = 1;
export const DITTO_ACTION_OPERATION_TYPE = "agent_git";
export const DITTO_ACTION_HOST = "ditto.internal";
export const DITTO_ACTION_PATH = "/v1/git-action";
export const DITTO_ACTION_METHOD = "POST";
export const DITTO_GIT_ACTION_ORIGIN = "http://ditto.internal/v1/git-action";

export const MAX_DITTO_ACTION_REQUEST_BODY_BYTES = 64 * 1024;
export const MAX_DITTO_ACTION_RESPONSE_BYTES = 64 * 1024;

export const DITTO_ACTION_ALLOWED_ACTIONS = [
	"status",
	"push",
	"openPullRequest",
] as const;
export type DittoGitAction = (typeof DITTO_ACTION_ALLOWED_ACTIONS)[number];

export type DittoGitActionBody =
	| { action: "status" }
	| { action: "push" }
	| {
			action: "openPullRequest";
			title?: string;
			body?: string;
			baseBranch?: string;
	  };

const DITTO_SYNTHETIC_APEX_HOSTS = new Set([
	"ditto.internal",
	"ditto.invalid",
	"ditto.local",
]);

const DITTO_SYNTHETIC_HOST_SUFFIXES = [
	".ditto.internal",
	".ditto.invalid",
	".ditto.local",
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
	"authorization",
];

const ALLOWED_REQUEST_HEADERS = new Set([
	"content-type",
	"content-length",
	"accept",
	"accept-encoding",
	"user-agent",
]);

const STATUS_PUSH_KEYS = new Set(["action"]);
const OPEN_PR_KEYS = new Set(["action", "title", "body", "baseBranch"]);

export class DittoActionContractError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "DittoActionContractError";
		this.code = code;
	}
}

export type DittoActionContractResult =
	| { ok: true; body: DittoGitActionBody }
	| { ok: false; code: string; message: string };

export function isDittoSyntheticHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (DITTO_SYNTHETIC_APEX_HOSTS.has(host)) {
		return true;
	}
	return DITTO_SYNTHETIC_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isExactDittoGitAction(url: URL, method: string): boolean {
	const host = url.hostname.toLowerCase();
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	return (
		url.protocol === "http:" &&
		host === DITTO_ACTION_HOST &&
		port === "80" &&
		url.pathname === DITTO_ACTION_PATH &&
		method.toUpperCase() === DITTO_ACTION_METHOD &&
		[...url.searchParams.keys()].length === 0 &&
		!url.hash &&
		!url.username &&
		!url.password
	);
}

export function classifyDittoActionRequest(request: Request): {
	kind: "ditto_action" | "ditto_action_near_miss" | "other";
	host: string;
} {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return { kind: "other", host: "" };
	}
	const host = url.hostname.toLowerCase();
	if (!isDittoSyntheticHost(host)) {
		return { kind: "other", host };
	}
	if (isExactDittoGitAction(url, request.method)) {
		return { kind: "ditto_action", host };
	}
	return { kind: "ditto_action_near_miss", host };
}

function assertPlainObject(
	value: unknown,
	code: string,
	message: string,
): Record<string, unknown> {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new DittoActionContractError(code, message);
	}
	return value as Record<string, unknown>;
}

function assertExactKeys(
	record: Record<string, unknown>,
	allowed: Set<string>,
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			throw new DittoActionContractError(
				"unknown_field",
				`Unknown field ${key} is not allowed.`,
			);
		}
	}
}

function assertOptionalTrimmedString(
	value: unknown,
	field: string,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new DittoActionContractError(
			"invalid_body",
			`${field} must be a string.`,
		);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new DittoActionContractError(
			"invalid_body",
			`${field} must be a nonempty string.`,
		);
	}
	return trimmed;
}

function parseJsonRejectingDuplicates(text: string): unknown {
	let index = 0;
	const end = text.length;

	const fail = (code: string, message: string): never => {
		throw new DittoActionContractError(code, message);
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
		throw new DittoActionContractError(
			"invalid_content_type",
			"Content-Type is required.",
		);
	}
	const normalized = value.split(";")[0]?.trim().toLowerCase();
	if (normalized !== "application/json") {
		throw new DittoActionContractError(
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
		throw new DittoActionContractError(
			"invalid_content_type",
			"Content-Type parameters are not allowed.",
		);
	}
}

function assertRequestHeaders(request: Request): void {
	for (const [name] of request.headers) {
		const lower = name.toLowerCase();
		if (FORBIDDEN_REQUEST_HEADERS.includes(lower)) {
			throw new DittoActionContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (lower.startsWith("proxy-") || lower.startsWith("x-forwarded-")) {
			throw new DittoActionContractError(
				"forbidden_header",
				`Request header ${lower} is not allowed.`,
			);
		}
		if (!ALLOWED_REQUEST_HEADERS.has(lower)) {
			throw new DittoActionContractError(
				"forbidden_header",
				`Request header ${lower} is not on the allowlist.`,
			);
		}
	}
	assertContentType(request.headers.get("content-type"));
}

function parseActionBody(value: unknown): DittoGitActionBody {
	const record = assertPlainObject(
		value,
		"invalid_body",
		"Request body must be a JSON object.",
	);
	const action = record.action;
	if (action === "status" || action === "push") {
		assertExactKeys(record, STATUS_PUSH_KEYS);
		return { action };
	}
	if (action === "openPullRequest") {
		assertExactKeys(record, OPEN_PR_KEYS);
		const body: DittoGitActionBody = { action: "openPullRequest" };
		const title = assertOptionalTrimmedString(record.title, "title");
		const prBody = assertOptionalTrimmedString(record.body, "body");
		const baseBranch = assertOptionalTrimmedString(
			record.baseBranch,
			"baseBranch",
		);
		if (title !== undefined) {
			body.title = title;
		}
		if (prBody !== undefined) {
			body.body = prBody;
		}
		if (baseBranch !== undefined) {
			body.baseBranch = baseBranch;
		}
		return body;
	}
	throw new DittoActionContractError(
		"invalid_action",
		"Git action is not allowed.",
	);
}

/**
 * Validate a sandbox Ditto Git-action request. Does not consult D1.
 */
export async function validateDittoActionRequest(
	request: Request,
	bound: { contractVersion: number },
): Promise<DittoActionContractResult> {
	try {
		if (bound.contractVersion !== DITTO_ACTION_CONTRACT_VERSION) {
			throw new DittoActionContractError(
				"contract_version",
				"Unsupported Ditto action contract version.",
			);
		}

		const url = new URL(request.url);
		if (!isExactDittoGitAction(url, request.method)) {
			throw new DittoActionContractError(
				"invalid_request",
				"Request is not the pinned Ditto Git action.",
			);
		}

		assertRequestHeaders(request);

		const declared = request.headers.get("content-length");
		if (declared != null) {
			const length = Number(declared);
			if (
				!Number.isInteger(length) ||
				length < 0 ||
				length > MAX_DITTO_ACTION_REQUEST_BODY_BYTES
			) {
				throw new DittoActionContractError(
					"body_too_large",
					"Ditto action request body exceeds the contract limit.",
				);
			}
		}

		if (!request.body) {
			throw new DittoActionContractError(
				"invalid_body",
				"Ditto action request body is required.",
			);
		}
		const raw = new Uint8Array(await request.arrayBuffer());
		if (raw.byteLength > MAX_DITTO_ACTION_REQUEST_BODY_BYTES) {
			throw new DittoActionContractError(
				"body_too_large",
				"Ditto action request body exceeds the contract limit.",
			);
		}
		if (raw.byteLength === 0) {
			throw new DittoActionContractError(
				"invalid_body",
				"Ditto action request body is required.",
			);
		}
		if (declared != null && Number(declared) !== raw.byteLength) {
			throw new DittoActionContractError(
				"invalid_body",
				"Content-Length does not match the request body.",
			);
		}

		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
		} catch {
			throw new DittoActionContractError(
				"malformed_json",
				"Request body is not valid UTF-8.",
			);
		}

		const parsed = parseJsonRejectingDuplicates(text);
		const body = parseActionBody(parsed);
		return { ok: true, body };
	} catch (error) {
		if (error instanceof DittoActionContractError) {
			return { ok: false, code: error.code, message: error.message };
		}
		return {
			ok: false,
			code: "contract_error",
			message:
				error instanceof Error
					? error.message
					: "Ditto action contract failed.",
		};
	}
}

export function wrapDittoActionResult(
	result: unknown,
	knownSecrets: readonly string[] = [],
): Response {
	let serialized: string;
	try {
		serialized = JSON.stringify({ ok: true, result });
	} catch {
		throw new DittoActionContractError(
			"oversized_response",
			"Git action result could not be serialized.",
		);
	}
	const redacted = redactSecrets(serialized, knownSecrets);
	if (redacted.length > MAX_DITTO_ACTION_RESPONSE_BYTES) {
		throw new DittoActionContractError(
			"oversized_response",
			"Git action result exceeds the contract limit.",
		);
	}
	return new Response(redacted, {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

export function wrapDittoActionError(
	status: number,
	knownSecrets: readonly string[] = [],
): Response {
	const body = redactSecrets(
		JSON.stringify({ ok: false, error: "Git action failed." }),
		knownSecrets,
	);
	const safeStatus = status >= 400 && status <= 599 ? status : 502;
	return new Response(body, {
		status: safeStatus,
		headers: { "content-type": "application/json" },
	});
}
