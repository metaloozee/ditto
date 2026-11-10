import type { CodexTokens } from "./codex-credential-crypto";

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
export const CODEX_TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
export const CODEX_DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
export const CODEX_DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
export const CODEX_DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
export const CODEX_DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
export const CODEX_DEVICE_TIMEOUT_MS = 15 * 60 * 1000;
export const CODEX_SLOW_DOWN_MS = 5000;

export interface CodexRequest {
	url: string;
	init: {
		method: "POST";
		redirect: "manual";
		headers: Record<string, string>;
		body: string;
	};
}

export type StartResult =
	| {
			kind: "started";
			deviceAuthId: string;
			userCode: string;
			intervalMs: number;
	  }
	| { kind: "failed"; reason: "not_enabled" | "start_failed" };
export type PollResult =
	| { kind: "pending" }
	| { kind: "slow_down" }
	| { kind: "authorized"; code: string; verifier: string }
	| { kind: "failed"; reason: "poll_failed" | "invalid_response" };

function json(url: string, body: Record<string, string>): CodexRequest {
	return {
		url,
		init: {
			method: "POST",
			redirect: "manual",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		},
	};
}
function form(body: Record<string, string>): CodexRequest {
	return {
		url: CODEX_TOKEN_URL,
		init: {
			method: "POST",
			redirect: "manual",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(body).toString(),
		},
	};
}

export function buildUserCodeRequest(): CodexRequest {
	return json(CODEX_DEVICE_USER_CODE_URL, { client_id: CODEX_CLIENT_ID });
}
export function buildPollRequest(
	deviceAuthId: string,
	userCode: string,
): CodexRequest {
	return json(CODEX_DEVICE_TOKEN_URL, {
		device_auth_id: deviceAuthId,
		user_code: userCode,
	});
}
export function buildExchangeRequest(
	code: string,
	verifier: string,
): CodexRequest {
	return form({
		grant_type: "authorization_code",
		client_id: CODEX_CLIENT_ID,
		code,
		code_verifier: verifier,
		redirect_uri: CODEX_DEVICE_REDIRECT_URI,
	});
}
export function buildRefreshRequest(refreshToken: string): CodexRequest {
	return form({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: CODEX_CLIENT_ID,
	});
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function text(value: unknown, max: number): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= max
		? value
		: null;
}

export function parseUserCodeResponse(
	status: number,
	body: unknown,
): StartResult {
	if (status === 404) return { kind: "failed", reason: "not_enabled" };
	const data = record(body);
	if (status < 200 || status > 299 || !data)
		return { kind: "failed", reason: "start_failed" };
	const interval =
		typeof data.interval === "string"
			? Number(data.interval.trim())
			: data.interval;
	const deviceAuthId = text(data.device_auth_id, 1024);
	const userCode = text(data.user_code, 64);
	if (
		!deviceAuthId ||
		!userCode ||
		typeof interval !== "number" ||
		!Number.isFinite(interval) ||
		interval < 0
	)
		return { kind: "failed", reason: "start_failed" };
	return {
		kind: "started",
		deviceAuthId,
		userCode,
		intervalMs: Math.round(interval * 1000),
	};
}

export function parsePollResponse(status: number, body: unknown): PollResult {
	const data = record(body);
	if (status >= 200 && status <= 299) {
		const code = text(data?.authorization_code, 4096);
		const verifier = text(data?.code_verifier, 4096);
		return code && verifier
			? { kind: "authorized", code, verifier }
			: { kind: "failed", reason: "invalid_response" };
	}
	if (status === 403 || status === 404) return { kind: "pending" };
	const error = data?.error;
	const nested = record(error);
	const code = nested ? nested.code : error;
	if (code === "deviceauth_authorization_pending") return { kind: "pending" };
	if (code === "slow_down") return { kind: "slow_down" };
	return { kind: "failed", reason: "poll_failed" };
}

export function parseTokenResponse(
	body: unknown,
	now: number,
): CodexTokens | null {
	const data = record(body);
	if (!data) return null;
	const access = text(data.access_token, 8192);
	const refresh = text(data.refresh_token, 8192);
	const expiresIn = data.expires_in;
	if (
		!access ||
		!refresh ||
		typeof expiresIn !== "number" ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	)
		return null;
	const identity = text(data.id_token, 8192);
	return {
		access,
		refresh,
		expiresAt: now + Math.round(expiresIn * 1000),
		...(identity ? { identity } : {}),
	};
}
