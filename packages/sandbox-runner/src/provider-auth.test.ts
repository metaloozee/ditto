import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProviderAuthOut } from "./provider-auth-protocol.js";
import {
	normalizeResultPath,
	runProviderAuth,
	toRuntimeCredential,
} from "./provider-auth.js";
import { PORTABLE_PROVIDER_AUTH, RESULT_DIR } from "./provider-matrix.js";
import {
	sendAuthControlRequest,
} from "./provider-auth-control.js";

function tmpResult(name: string): string {
	fs.mkdirSync(RESULT_DIR, { recursive: true, mode: 0o700 });
	return path.join(RESULT_DIR, name);
}

describe("provider-auth matrix", () => {
	it("encodes the exact portable provider/auth matrix", () => {
		expect(PORTABLE_PROVIDER_AUTH["openai-codex"]).toEqual(["oauth"]);
		expect(PORTABLE_PROVIDER_AUTH["github-copilot"]).toEqual(["oauth"]);
		expect(PORTABLE_PROVIDER_AUTH.anthropic).toEqual(["api_key", "oauth"]);
		expect(PORTABLE_PROVIDER_AUTH.opencode).toEqual(["api_key"]);
	});

	it("rejects unlisted providers and disallowed auth types", async () => {
		const events: ProviderAuthOut[] = [];
		const missing = await runProviderAuth({
			job: {
				mode: "login",
				attemptId: "a1",
				providerId: "not-a-provider",
				authType: "api_key",
				resultPath: tmpResult("r1.json"),
			},
			onEvent: (e) => events.push(e),
			handshakeTimeoutMs: 10,
		});
		expect(missing.ok).toBe(false);
		expect(events.some((e) => e.kind === "error" && e.code === "unsupported_provider")).toBe(true);

		const events2: ProviderAuthOut[] = [];
		const badAuth = await runProviderAuth({
			job: {
				mode: "login",
				attemptId: "a2",
				providerId: "openai-codex",
				authType: "api_key",
				resultPath: tmpResult("r2.json"),
			},
			onEvent: (e) => events2.push(e),
			handshakeTimeoutMs: 10,
		});
		expect(badAuth.ok).toBe(false);
		expect(
			events2.some((e) => e.kind === "error" && e.code === "unsupported_auth"),
		).toBe(true);
	});
});

describe("provider-auth login flows", () => {
	it("relays secret prompt without emitting the secret; writes 0600 result", async () => {
		const resultPath = tmpResult(`secret-${Date.now()}.json`);
		const events: ProviderAuthOut[] = [];
		const secret = "sk-test-secret-value-never-emit";

		const run = runProviderAuth({
			job: {
				mode: "login",
				attemptId: "attempt-secret",
				providerId: "openai",
				authType: "api_key",
				resultPath,
			},
			onEvent: (e) => events.push(e),
			createRuntime: async () =>
				({
					getModels: () => [
						{
							provider: "openai",
							id: "gpt-test",
							name: "GPT Test",
							cost: { input: 1, output: 2 },
						},
					],
				}) as never,
			loginImpl: async (_rt, _p, _t, interaction) => {
				const key = await interaction.prompt({
					type: "secret",
					message: "API key",
				});
				return { type: "api_key", key };
			},
			handshakeTimeoutMs: 2_000,
		});

		await vi.waitFor(() =>
			expect(events.some((e) => e.kind === "prompt")).toBe(true),
		);
		const prompt = events.find((e) => e.kind === "prompt");
		if (!prompt || prompt.kind !== "prompt") throw new Error("missing prompt");

		await sendAuthControlRequest({
			attemptId: "attempt-secret",
			promptId: prompt.promptId,
			action: "answer",
			value: secret,
		});

		// Consume result after credential_ready
		await vi.waitFor(() =>
			expect(events.some((e) => e.kind === "credential_ready")).toBe(true),
		);
		const stat = fs.statSync(resultPath);
		expect(stat.mode & 0o777).toBe(0o600);
		const body = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			credential: { key: string };
		};
		expect(body.credential.key).toBe(secret);
		fs.unlinkSync(resultPath);

		const result = await run;
		expect(result.ok).toBe(true);
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain(secret);
		expect(events.some((e) => e.kind === "done" && e.ok)).toBe(true);
	});

	it("auto-selects Codex device_code and relays device events", async () => {
		const resultPath = tmpResult(`codex-${Date.now()}.json`);
		const events: ProviderAuthOut[] = [];
		const run = runProviderAuth({
			job: {
				mode: "login",
				attemptId: "attempt-codex",
				providerId: "openai-codex",
				authType: "oauth",
				resultPath,
			},
			onEvent: (e) => events.push(e),
			createRuntime: async () =>
				({
					getModels: () => [
						{ provider: "openai-codex", id: "gpt-5", name: "GPT-5" },
					],
				}) as never,
			loginImpl: async (_rt, _p, _t, interaction) => {
				const method = await interaction.prompt({
					type: "select",
					message: "Login method",
					options: [
						{ id: "device_code", label: "Device code" },
						{ id: "browser", label: "Browser" },
					],
				});
				expect(method).toBe("device_code");
				interaction.notify({
					type: "device_code",
					userCode: "ABCD-EFGH",
					verificationUri: "https://auth.openai.com/device",
					intervalSeconds: 5,
					expiresInSeconds: 900,
				});
				return {
					type: "oauth",
					refresh: "refresh-secret",
					access: "access-secret",
					expires: Date.now() + 3_600_000,
					accountId: "acct-1",
				};
			},
			handshakeTimeoutMs: 2_000,
		});

		await vi.waitFor(() =>
			expect(events.some((e) => e.kind === "device_code")).toBe(true),
		);
		await vi.waitFor(() =>
			expect(events.some((e) => e.kind === "credential_ready")).toBe(true),
		);
		fs.unlinkSync(resultPath);
		await run;
		const device = events.find((e) => e.kind === "device_code");
		expect(device).toMatchObject({
			userCode: "ABCD-EFGH",
			verificationUri: "https://auth.openai.com/device",
		});
		expect(JSON.stringify(events)).not.toContain("refresh-secret");
	});

	it("round-trips Copilot enterprise and Anthropic manual_code prompts", async () => {
		for (const fixture of [
			{
				providerId: "github-copilot" as const,
				attemptId: "attempt-copilot",
				prompt: {
					type: "text" as const,
					message: "Enterprise domain",
					placeholder: "company",
				},
				answer: "my-enterprise.ghe.com",
				credential: {
					type: "oauth" as const,
					refresh: "r",
					access: "a",
					expires: Date.now() + 3_600_000,
					enterpriseUrl: "https://my-enterprise.ghe.com",
					availableModelIds: ["gpt-4.1"],
				},
			},
			{
				providerId: "anthropic" as const,
				attemptId: "attempt-anthropic",
				prompt: {
					type: "manual_code" as const,
					message: "Paste redirect URL",
				},
				answer: "http://localhost:54545/callback?code=abc",
				credential: {
					type: "oauth" as const,
					refresh: "r",
					access: "a",
					expires: Date.now() + 3_600_000,
				},
			},
		]) {
			const resultPath = tmpResult(`${fixture.attemptId}.json`);
			const events: ProviderAuthOut[] = [];
			const run = runProviderAuth({
				job: {
					mode: "login",
					attemptId: fixture.attemptId,
					providerId: fixture.providerId,
					authType: "oauth",
					resultPath,
				},
				onEvent: (e) => events.push(e),
				createRuntime: async () =>
					({
						getModels: () => [
							{
								provider: fixture.providerId,
								id: "m1",
								name: "M1",
							},
						],
					}) as never,
				loginImpl: async (_rt, _p, _t, interaction) => {
					const value = await interaction.prompt(fixture.prompt);
					expect(value).toBe(fixture.answer);
					return fixture.credential;
				},
				handshakeTimeoutMs: 2_000,
			});
			await vi.waitFor(() =>
				expect(events.some((e) => e.kind === "prompt")).toBe(true),
			);
			const prompt = events.find((e) => e.kind === "prompt");
			if (!prompt || prompt.kind !== "prompt") throw new Error("no prompt");
			await sendAuthControlRequest({
				attemptId: fixture.attemptId,
				promptId: prompt.promptId,
				action: "answer",
				value: fixture.answer,
			});
			await vi.waitFor(() =>
				expect(events.some((e) => e.kind === "credential_ready")).toBe(true),
			);
			fs.unlinkSync(resultPath);
			await run;
		}
	});

	it("cancel aborts login", async () => {
		const resultPath = tmpResult(`cancel-${Date.now()}.json`);
		const events: ProviderAuthOut[] = [];
		const run = runProviderAuth({
			job: {
				mode: "login",
				attemptId: "attempt-cancel",
				providerId: "openai",
				authType: "api_key",
				resultPath,
			},
			onEvent: (e) => events.push(e),
			createRuntime: async () => ({ getModels: () => [] }) as never,
			loginImpl: async (_rt, _p, _t, interaction) => {
				await interaction.prompt({ type: "secret", message: "key" });
				return { type: "api_key", key: "never" };
			},
			handshakeTimeoutMs: 500,
		});
		await vi.waitFor(() =>
			expect(events.some((e) => e.kind === "prompt")).toBe(true),
		);
		const cancel = await sendAuthControlRequest({
			attemptId: "attempt-cancel",
			action: "cancel",
		});
		expect(cancel.accepted).toBe(true);
		const result = await run;
		expect(result.ok).toBe(false);
		expect(
			events.some((e) => e.kind === "error" && e.code === "cancelled"),
		).toBe(true);
	});

	it("maps PI exceptions without leaking secrets", async () => {
		const resultPath = tmpResult(`leak-${Date.now()}.json`);
		const events: ProviderAuthOut[] = [];
		const leak = "sk-leaked-from-pi-exception-body-xyz";
		const result = await runProviderAuth({
			job: {
				mode: "login",
				attemptId: "attempt-leak",
				providerId: "openai",
				authType: "api_key",
				resultPath,
			},
			onEvent: (e) => events.push(e),
			createRuntime: async () => ({ getModels: () => [] }) as never,
			loginImpl: async () => {
				throw new Error(`upstream failed: ${leak}`);
			},
			handshakeTimeoutMs: 100,
		});
		expect(result.ok).toBe(false);
		expect(JSON.stringify(events)).not.toContain(leak);
		expect(
			events.some((e) => e.kind === "error" && e.code === "auth_failed"),
		).toBe(true);
	});
});

describe("runtime credential projection", () => {
	it("strips refresh and unknown oauth fields; keeps Codex/Copilot metadata", () => {
		const codex = toRuntimeCredential(
			{
				type: "oauth",
				refresh: "real-refresh",
				access: "access",
				expires: Date.now() + 9_999_999,
				accountId: "acct",
				unknownFuture: "nope",
			},
			"openai-codex",
		);
		expect(codex).toEqual({
			type: "oauth",
			refresh: "ditto:no-refresh",
			access: "access",
			expires: expect.any(Number),
			accountId: "acct",
		});
		expect(codex).not.toHaveProperty("unknownFuture");

		const copilot = toRuntimeCredential(
			{
				type: "oauth",
				refresh: "real-refresh",
				access: "access",
				expires: Date.now() + 9_999_999,
				enterpriseUrl: "https://e.example",
				availableModelIds: ["m1"],
				extra: "x",
			},
			"github-copilot",
		);
		expect(copilot).toMatchObject({
			enterpriseUrl: "https://e.example",
			availableModelIds: ["m1"],
			refresh: "ditto:no-refresh",
		});
		expect(copilot).not.toHaveProperty("extra");
	});

	it("normalizes result paths under the fixed directory", () => {
		const p = normalizeResultPath(path.join(RESULT_DIR, "x.json"));
		expect(p.startsWith(RESULT_DIR)).toBe(true);
		expect(() => normalizeResultPath(path.join(os.tmpdir(), "evil.json"))).toThrow();
	});
});
