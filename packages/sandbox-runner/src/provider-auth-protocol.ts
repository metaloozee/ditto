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

/** Reject events that look like they carry credential fields. */
export function assertPublicAuthEvent(value: unknown): ProviderAuthOut {
	if (!isRecord(value) || value.v !== 1 || typeof value.kind !== "string") {
		throw new Error("Invalid auth event");
	}
	const banned = [
		"credential",
		"refresh",
		"access",
		"apiKey",
		"api_key",
		"token",
		"key",
		"refreshToken",
		"accessToken",
	];
	for (const key of Object.keys(value)) {
		if (banned.includes(key)) {
			throw new Error("Auth event contains banned field");
		}
	}
	return value as ProviderAuthOut;
}
