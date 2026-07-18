export const PROTOCOL_VERSION = 1 as const;

export type FollowUpCorrelation = {
	requestId: string;
	runId: string;
	sessionId: string;
	text: string;
	userMessageId: string;
	assistantMessageId: string;
};

export type RunnerControlEvent =
	| ({ type: "follow_up_started" } & FollowUpCorrelation)
	| ({ type: "follow_up_cancelled" } & FollowUpCorrelation)
	| {
			type: "stop_requested";
			runId: string;
			sessionId: string;
	  };

export type RunnerOut =
	| { v: 1; kind: "ready"; sessionId: string; model: string }
	| { v: 1; kind: "agent_event"; event: unknown }
	| { v: 1; kind: "assistant_delta"; delta: string }
	| { v: 1; kind: "control_event"; event: RunnerControlEvent }
	| { v: 1; kind: "error"; message: string }
	| {
			v: 1;
			kind: "done";
			sessionId: string;
			assistantText: string;
			ok: boolean;
	  };

/** Versioned public provider-auth events. Never carry credentials. */
export type ProviderAuthOut =
	| {
			v: 1;
			kind: "prompt";
			promptId: string;
			type: "text" | "secret" | "select" | "manual_code";
			message: string;
			placeholder?: string;
			options?: Array<{ id: string; label: string; description?: string }>;
	  }
	| {
			v: 1;
			kind: "auth_url";
			url: string;
			instructions?: string;
	  }
	| {
			v: 1;
			kind: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| { v: 1; kind: "info"; message: string }
	| { v: 1; kind: "progress"; message: string }
	/** Non-secret attempt metadata (e.g. Copilot Enterprise host binding). */
	| { v: 1; kind: "attempt_meta"; enterpriseHost: string }
	| { v: 1; kind: "credential_ready" }
	| { v: 1; kind: "done"; ok: boolean }
	| { v: 1; kind: "error"; code: string; message: string };

export type AuthControlRequest =
	| {
			attemptId: string;
			promptId: string;
			action: "answer";
			value: string;
	  }
	| {
			attemptId: string;
			action: "cancel";
	  };

export type AuthControlResponse =
	| { accepted: true; action: "answer" | "cancel" }
	| { accepted: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function encodeLine(msg: RunnerOut): string {
	return `${JSON.stringify(msg)}\n`;
}

export function encodeAuthLine(msg: ProviderAuthOut): string {
	return `${JSON.stringify(msg)}\n`;
}

export function parseAuthControlRequest(value: unknown): AuthControlRequest {
	if (!isRecord(value)) throw new Error("Control request must be an object");
	if (!isBoundedString(value.attemptId, 128)) {
		throw new Error("Invalid attemptId");
	}
	if (value.action === "cancel") {
		const keys = Object.keys(value).sort();
		if (keys.join(",") !== "action,attemptId") {
			throw new Error("Invalid cancel control fields");
		}
		return { attemptId: value.attemptId, action: "cancel" };
	}
	if (value.action === "answer") {
		const keys = Object.keys(value).sort();
		if (keys.join(",") !== "action,attemptId,promptId,value") {
			throw new Error("Invalid answer control fields");
		}
		if (!isBoundedString(value.promptId, 128)) {
			throw new Error("Invalid promptId");
		}
		if (typeof value.value !== "string" || value.value.length > 8_192) {
			throw new Error("Invalid answer value");
		}
		return {
			attemptId: value.attemptId,
			promptId: value.promptId,
			action: "answer",
			value: value.value,
		};
	}
	throw new Error("Unknown control action");
}

const AUTH_EVENT_BANNED = new Set([
	"credential",
	"refresh",
	"access",
	"apiKey",
	"api_key",
	"token",
	"key",
	"refreshToken",
	"accessToken",
	"encryptedCredential",
	"value",
]);

function assertExactKeys(
	value: Record<string, unknown>,
	required: string[],
	optional: string[] = [],
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key) || AUTH_EVENT_BANNED.has(key)) {
			throw new Error("Auth event has unexpected field");
		}
	}
	for (const key of required) {
		if (!(key in value)) throw new Error("Auth event missing field");
	}
}

function boundedMsg(value: unknown, max = 500): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max) {
		throw new Error("Invalid message");
	}
	return value;
}

/** Strict public auth-event parser. Rejects unknown variants and credential fields. */
export function assertPublicAuthEvent(value: unknown): ProviderAuthOut {
	if (!isRecord(value) || value.v !== 1 || typeof value.kind !== "string") {
		throw new Error("Invalid auth event");
	}
	for (const key of Object.keys(value)) {
		if (AUTH_EVENT_BANNED.has(key)) {
			throw new Error("Auth event contains banned field");
		}
	}
	switch (value.kind) {
		case "prompt": {
			assertExactKeys(
				value,
				["v", "kind", "promptId", "type", "message"],
				["placeholder", "options"],
			);
			if (!isBoundedString(value.promptId, 128)) {
				throw new Error("Invalid promptId");
			}
			if (
				value.type !== "text" &&
				value.type !== "secret" &&
				value.type !== "select" &&
				value.type !== "manual_code"
			) {
				throw new Error("Invalid prompt type");
			}
			const message = boundedMsg(value.message);
			const out: ProviderAuthOut = {
				v: 1,
				kind: "prompt",
				promptId: value.promptId,
				type: value.type,
				message,
			};
			if (value.placeholder !== undefined) {
				if (
					typeof value.placeholder !== "string" ||
					value.placeholder.length > 200
				) {
					throw new Error("Invalid placeholder");
				}
				out.placeholder = value.placeholder;
			}
			if (value.options !== undefined) {
				if (!Array.isArray(value.options) || value.options.length > 32) {
					throw new Error("Invalid options");
				}
				out.options = value.options.map((opt) => {
					if (!isRecord(opt)) throw new Error("Invalid option");
					if (
						!isBoundedString(opt.id, 128) ||
						!isBoundedString(opt.label, 200)
					) {
						throw new Error("Invalid option fields");
					}
					const item: { id: string; label: string; description?: string } = {
						id: opt.id,
						label: opt.label,
					};
					if (opt.description !== undefined) {
						if (
							typeof opt.description !== "string" ||
							opt.description.length > 200
						) {
							throw new Error("Invalid option description");
						}
						item.description = opt.description;
					}
					return item;
				});
			}
			return out;
		}
		case "auth_url": {
			assertExactKeys(value, ["v", "kind", "url"], ["instructions"]);
			if (!isBoundedString(value.url, 2048)) throw new Error("Invalid url");
			const out: ProviderAuthOut = { v: 1, kind: "auth_url", url: value.url };
			if (value.instructions !== undefined) {
				out.instructions = boundedMsg(value.instructions);
			}
			return out;
		}
		case "device_code": {
			assertExactKeys(
				value,
				["v", "kind", "userCode", "verificationUri"],
				["intervalSeconds", "expiresInSeconds"],
			);
			if (!isBoundedString(value.userCode, 64)) {
				throw new Error("Invalid userCode");
			}
			if (!isBoundedString(value.verificationUri, 2048)) {
				throw new Error("Invalid verificationUri");
			}
			const out: ProviderAuthOut = {
				v: 1,
				kind: "device_code",
				userCode: value.userCode,
				verificationUri: value.verificationUri,
			};
			if (value.intervalSeconds !== undefined) {
				if (
					typeof value.intervalSeconds !== "number" ||
					!(value.intervalSeconds > 0)
				) {
					throw new Error("Invalid intervalSeconds");
				}
				out.intervalSeconds = value.intervalSeconds;
			}
			if (value.expiresInSeconds !== undefined) {
				if (
					typeof value.expiresInSeconds !== "number" ||
					!(value.expiresInSeconds > 0)
				) {
					throw new Error("Invalid expiresInSeconds");
				}
				out.expiresInSeconds = value.expiresInSeconds;
			}
			return out;
		}
		case "info": {
			assertExactKeys(value, ["v", "kind", "message"]);
			return { v: 1, kind: "info", message: boundedMsg(value.message) };
		}
		case "progress": {
			assertExactKeys(value, ["v", "kind", "message"]);
			return { v: 1, kind: "progress", message: boundedMsg(value.message) };
		}
		case "attempt_meta": {
			assertExactKeys(value, ["v", "kind", "enterpriseHost"]);
			if (
				typeof value.enterpriseHost !== "string" ||
				value.enterpriseHost.length === 0 ||
				value.enterpriseHost.length > 253 ||
				!/^[A-Za-z0-9.-]+$/.test(value.enterpriseHost)
			) {
				throw new Error("Invalid enterpriseHost");
			}
			return {
				v: 1,
				kind: "attempt_meta",
				enterpriseHost: value.enterpriseHost.toLowerCase(),
			};
		}
		case "credential_ready": {
			assertExactKeys(value, ["v", "kind"]);
			return { v: 1, kind: "credential_ready" };
		}
		case "done": {
			assertExactKeys(value, ["v", "kind", "ok"]);
			if (typeof value.ok !== "boolean") throw new Error("Invalid done.ok");
			return { v: 1, kind: "done", ok: value.ok };
		}
		case "error": {
			assertExactKeys(value, ["v", "kind", "code", "message"]);
			if (!isBoundedString(value.code, 64)) throw new Error("Invalid code");
			return {
				v: 1,
				kind: "error",
				code: value.code,
				message: boundedMsg(value.message),
			};
		}
		default:
			throw new Error("Unknown auth event kind");
	}
}

export function extractUserTextFromMessageStart(event: unknown): string | null {
	if (!event || typeof event !== "object") return null;
	const e = event as Record<string, unknown>;
	if (e.type !== "message_start") return null;
	const message = e.message;
	if (!message || typeof message !== "object") return null;
	const m = message as Record<string, unknown>;
	if (m.role !== "user") return null;
	if (typeof m.content === "string") return m.content;
	if (!Array.isArray(m.content)) return null;
	const text: string[] = [];
	for (const block of m.content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (b.type === "text" && typeof b.text === "string") text.push(b.text);
	}
	return text.join("");
}

export function extractTextDelta(event: unknown): string | null {
	if (!event || typeof event !== "object") return null;
	const e = event as Record<string, unknown>;
	if (e.type !== "message_update") return null;
	const ame = e.assistantMessageEvent;
	if (!ame || typeof ame !== "object") return null;
	const a = ame as Record<string, unknown>;
	if (a.type !== "text_delta" || typeof a.delta !== "string") return null;
	return a.delta;
}

export function runnerOutputFromAgentEvent(event: unknown): RunnerOut | null {
	const delta = extractTextDelta(event);
	if (delta !== null) {
		return { v: 1, kind: "assistant_delta", delta };
	}

	if (!event || typeof event !== "object") return null;
	const type = (event as Record<string, unknown>).type;
	if (
		type !== "tool_execution_start" &&
		type !== "tool_execution_update" &&
		type !== "tool_execution_end"
	) {
		return null;
	}

	return { v: 1, kind: "agent_event", event };
}

export function extractAssistantTextFromMessages(messages: unknown): string {
	if (!Array.isArray(messages)) return "";

	let lastAssistant: unknown = null;
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const m = message as Record<string, unknown>;
		if (m.role === "assistant") {
			lastAssistant = message;
		}
	}

	if (!lastAssistant || typeof lastAssistant !== "object") return "";

	const content = (lastAssistant as Record<string, unknown>).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (b.type === "text" && typeof b.text === "string") {
			parts.push(b.text);
		}
	}

	return parts.join("");
}

export function pickAssistantText(
	accumulatedDeltas: string,
	sessionMessages: unknown,
): string {
	const fromDeltas = accumulatedDeltas.trim();
	if (fromDeltas.length > 0) return accumulatedDeltas;
	return extractAssistantTextFromMessages(sessionMessages);
}
