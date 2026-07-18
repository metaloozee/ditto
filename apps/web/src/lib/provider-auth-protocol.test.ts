import { describe, expect, it } from "vitest";
import {
	classifyAuthUrl,
	isAllowedProviderAuth,
	PORTABLE_PROVIDER_AUTH,
	parseProviderAuthEvent,
} from "#/lib/provider-auth-protocol";

describe("provider-auth-protocol", () => {
	it("parses public events and rejects credential-shaped fields", () => {
		expect(
			parseProviderAuthEvent({
				v: 1,
				kind: "device_code",
				userCode: "ABCD",
				verificationUri: "https://auth.openai.com/device",
			}),
		).toMatchObject({ kind: "device_code" });
		expect(() =>
			parseProviderAuthEvent({
				v: 1,
				kind: "done",
				ok: true,
				credential: { key: "x" },
			}),
		).toThrow();
		expect(() =>
			parseProviderAuthEvent({ v: 1, kind: "info", message: "hi", extra: 1 }),
		).toThrow();
	});

	it("enforces portable matrix", () => {
		expect(isAllowedProviderAuth("openai-codex", "api_key")).toBe(false);
		expect(isAllowedProviderAuth("github-copilot", "api_key")).toBe(false);
		expect(isAllowedProviderAuth("anthropic", "oauth")).toBe(true);
		expect(PORTABLE_PROVIDER_AUTH.opencode).toEqual(["api_key"]);
	});

	it("classifies auth URLs with host policy", () => {
		expect(
			classifyAuthUrl("openai-codex", "https://auth.openai.com/device").kind,
		).toBe("open");
		expect(classifyAuthUrl("anthropic", "http://localhost:54545/cb").kind).toBe(
			"text",
		);
		expect(classifyAuthUrl("xai", "https://evil.example/login").kind).toBe(
			"text",
		);
		// Subdomain of allowed host is NOT open (exact match only).
		expect(
			classifyAuthUrl("openai-codex", "https://evil.auth.openai.com/device")
				.kind,
		).toBe("text");
		expect(
			classifyAuthUrl("github-copilot", "https://acme.ghe.com/login", {
				enterpriseHost: "acme.ghe.com",
			}).kind,
		).toBe("open");
		expect(
			classifyAuthUrl("github-copilot", "https://evil.acme.ghe.com/login", {
				enterpriseHost: "acme.ghe.com",
			}).kind,
		).toBe("text");
		expect(
			classifyAuthUrl("github-copilot", "https://other.ghe.com/login", {
				enterpriseHost: "acme.ghe.com",
			}).kind,
		).toBe("text");
		// Standard github.com still allowed alongside enterprise host.
		expect(
			classifyAuthUrl("github-copilot", "https://github.com/login/device", {
				enterpriseHost: "acme.ghe.com",
			}).kind,
		).toBe("open");
	});

	it("rejects credential extras on credential_ready", () => {
		expect(() =>
			parseProviderAuthEvent({
				v: 1,
				kind: "credential_ready",
				accessToken: "secret",
			}),
		).toThrow();
		expect(() =>
			parseProviderAuthEvent({
				v: 1,
				kind: "credential_ready",
				extra: 1,
			}),
		).toThrow();
	});
});
