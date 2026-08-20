import { describe, expect, it } from "vitest";
import {
	assertCredentialConfig,
	credentialSecretValues,
	operatorFallbackCredential,
} from "#/lib/account-provider-credentials";

const KEY_A = "ai-credentials-encryption-key-test-aaaa";
const AUTH = "test-better-auth-secret-min-length";
const OPENCODE = "sk-test-key-12345678901234567890";

describe("operator fallback credentials", () => {
	it("rejects empty/equal secrets", () => {
		expect(() =>
			assertCredentialConfig({
				AI_CREDENTIALS_ENCRYPTION_KEY: "",
				BETTER_AUTH_SECRET: AUTH,
				OPENCODE_API_KEY: OPENCODE,
			}),
		).toThrow(/AI_CREDENTIALS_ENCRYPTION_KEY/);
		expect(() =>
			assertCredentialConfig({
				AI_CREDENTIALS_ENCRYPTION_KEY: AUTH,
				BETTER_AUTH_SECRET: AUTH,
				OPENCODE_API_KEY: OPENCODE,
			}),
		).toThrow(/differ/);
		expect(() =>
			assertCredentialConfig({
				AI_CREDENTIALS_ENCRYPTION_KEY: KEY_A,
				BETTER_AUTH_SECRET: AUTH,
				OPENCODE_API_KEY: "",
			}),
		).toThrow(/OPENCODE_API_KEY/);
	});

	it("projects the operator fallback credential", () => {
		expect(operatorFallbackCredential(OPENCODE)).toEqual({
			type: "api_key",
			key: OPENCODE,
		});
	});

	it("credentialSecretValues collects nonempty leaves except type", () => {
		const secrets = credentialSecretValues({
			type: "api_key",
			key: "sk-secret",
			env: { OPENCODE_API_KEY: "env-secret" },
		});
		expect(secrets).toEqual(
			expect.arrayContaining(["sk-secret", "env-secret"]),
		);
		expect(secrets).not.toContain("api_key");
	});
});
