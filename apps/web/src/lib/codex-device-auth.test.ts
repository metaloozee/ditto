import { describe, expect, it } from "vitest";
import {
	buildExchangeRequest,
	buildPollRequest,
	buildRefreshRequest,
	buildUserCodeRequest,
	CODEX_CLIENT_ID,
	parsePollResponse,
	parseTokenResponse,
	parseUserCodeResponse,
} from "./codex-device-auth";

describe("device-auth requests", () => {
	it("builds the user-code, poll, exchange and refresh requests", () => {
		const start = buildUserCodeRequest();
		expect(start.url).toBe(
			"https://auth.openai.com/api/accounts/deviceauth/usercode",
		);
		expect(JSON.parse(start.init.body)).toEqual({ client_id: CODEX_CLIENT_ID });
		const poll = buildPollRequest("fake-device-id", "ABCD-1234");
		expect(poll.url).toBe(
			"https://auth.openai.com/api/accounts/deviceauth/token",
		);
		expect(JSON.parse(poll.init.body)).toEqual({
			device_auth_id: "fake-device-id",
			user_code: "ABCD-1234",
		});
		const exchange = buildExchangeRequest("fake-code", "fake-verifier");
		expect(exchange.url).toBe("https://auth.openai.com/oauth/token");
		expect(Object.fromEntries(new URLSearchParams(exchange.init.body))).toEqual(
			{
				grant_type: "authorization_code",
				client_id: CODEX_CLIENT_ID,
				code: "fake-code",
				code_verifier: "fake-verifier",
				redirect_uri: "https://auth.openai.com/deviceauth/callback",
			},
		);
		const refresh = buildRefreshRequest("fake-refresh");
		expect(Object.fromEntries(new URLSearchParams(refresh.init.body))).toEqual({
			grant_type: "refresh_token",
			refresh_token: "fake-refresh",
			client_id: CODEX_CLIENT_ID,
		});
		for (const request of [start, poll, exchange, refresh])
			expect(request.init.redirect).toBe("manual");
	});
});

describe("parseUserCodeResponse", () => {
	it("accepts numeric and string intervals", () => {
		for (const interval of [5, "5", " 5 "])
			expect(
				parseUserCodeResponse(200, {
					device_auth_id: "fake-device-id",
					user_code: "ABCD-1234",
					interval,
				}),
			).toEqual({
				kind: "started",
				deviceAuthId: "fake-device-id",
				userCode: "ABCD-1234",
				intervalMs: 5000,
			});
	});
	it("reports a disabled server and malformed responses without echoing text", () => {
		expect(parseUserCodeResponse(404, {})).toEqual({
			kind: "failed",
			reason: "not_enabled",
		});
		for (const body of [
			null,
			[],
			{ device_auth_id: "x", user_code: "y", interval: "soon" },
			{ device_auth_id: "x", user_code: "y", interval: -1 },
			{ user_code: "y", interval: 1 },
		])
			expect(parseUserCodeResponse(200, body)).toEqual({
				kind: "failed",
				reason: "start_failed",
			});
		expect(parseUserCodeResponse(500, { device_auth_id: "x" })).toEqual({
			kind: "failed",
			reason: "start_failed",
		});
	});
});

describe("parsePollResponse", () => {
	it("treats 403, 404 and the pending code as pending", () => {
		expect(parsePollResponse(403, undefined)).toEqual({ kind: "pending" });
		expect(parsePollResponse(404, undefined)).toEqual({ kind: "pending" });
		expect(
			parsePollResponse(400, { error: "deviceauth_authorization_pending" }),
		).toEqual({ kind: "pending" });
		expect(
			parsePollResponse(400, {
				error: { code: "deviceauth_authorization_pending" },
			}),
		).toEqual({ kind: "pending" });
	});
	it("recognises slow_down in both error shapes", () => {
		expect(parsePollResponse(400, { error: "slow_down" })).toEqual({
			kind: "slow_down",
		});
		expect(parsePollResponse(429, { error: { code: "slow_down" } })).toEqual({
			kind: "slow_down",
		});
	});
	it("returns the authorization code and verifier", () => {
		expect(
			parsePollResponse(200, {
				authorization_code: "fake-code",
				code_verifier: "fake-verifier",
			}),
		).toEqual({
			kind: "authorized",
			code: "fake-code",
			verifier: "fake-verifier",
		});
	});
	it("fails with a fixed reason", () => {
		expect(parsePollResponse(200, { authorization_code: "x" })).toEqual({
			kind: "failed",
			reason: "invalid_response",
		});
		const failed = parsePollResponse(500, { error: "secret-detail" });
		expect(failed).toEqual({ kind: "failed", reason: "poll_failed" });
		expect(JSON.stringify(failed)).not.toContain("secret-detail");
	});
});

describe("parseTokenResponse", () => {
	it("maps tokens and computes expiry", () => {
		expect(
			parseTokenResponse(
				{
					access_token: "fake-access-token-XYZ",
					refresh_token: "fake-refresh-token-XYZ",
					id_token: "fake-id-token-XYZ",
					expires_in: 3600,
				},
				1000,
			),
		).toEqual({
			access: "fake-access-token-XYZ",
			refresh: "fake-refresh-token-XYZ",
			identity: "fake-id-token-XYZ",
			expiresAt: 3_601_000,
		});
	});
	it("rejects incomplete responses", () => {
		for (const body of [
			null,
			{},
			{ access_token: "a", refresh_token: "r" },
			{ access_token: "a", expires_in: 60 },
			{ access_token: "a", refresh_token: "r", expires_in: "60" },
			{ access_token: "a", refresh_token: "r", expires_in: 0 },
		])
			expect(parseTokenResponse(body, 0)).toBeNull();
	});
});
