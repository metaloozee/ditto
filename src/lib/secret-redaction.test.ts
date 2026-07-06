import { describe, expect, it } from "vitest";
import { redactSecrets } from "./secret-redaction";

describe("redactSecrets", () => {
	it("redacts concrete secret strings wherever they appear", () => {
		expect(
			redactSecrets("token=live-secret-value-123-suffix", [
				"live-secret-value-123",
			]),
		).toBe("token=[REDACTED]-suffix");
	});

	it("does not redact concrete secrets shorter than 8 characters", () => {
		expect(redactSecrets("short abc123 value", ["abc123"])).toBe(
			"short abc123 value",
		);
	});

	it("redacts GitHub tokens by pattern", () => {
		const token = `ghp_${"a".repeat(40)}`;
		expect(redactSecrets(`token=${token}`, [])).toBe("token=[REDACTED]");
	});

	it("redacts PEM private-key blocks as a unit", () => {
		const key = [
			"-----BEGIN RSA PRIVATE KEY-----",
			"fake-key-material",
			"-----END RSA PRIVATE KEY-----",
		].join("\n");
		expect(redactSecrets(`before\n${key}\nafter`, [])).toBe(
			"before\n[REDACTED]\nafter",
		);
	});

	it("redacts AWS access key ids by pattern", () => {
		expect(redactSecrets("aws AKIAABCDEFGHIJKLMNOP ok", [])).toBe(
			"aws [REDACTED] ok",
		);
	});

	it("redacts provider API keys by pattern", () => {
		const key = `sk-test-${"b".repeat(24)}`;
		expect(redactSecrets(`provider ${key}`, [])).toBe("provider [REDACTED]");
	});

	it("returns non-secret text unchanged", () => {
		const text = "read /workspace/src/index.ts and wrote normal log output";
		expect(redactSecrets(text, [])).toBe(text);
	});

	it("redacts multiple secrets in one string", () => {
		const githubToken = `ghs_${"c".repeat(40)}`;
		expect(
			redactSecrets(`one secret-value-123 two ${githubToken}`, [
				"secret-value-123",
			]),
		).toBe("one [REDACTED] two [REDACTED]");
	});

	it("applies regex patterns when concrete secrets is empty", () => {
		const key = `sk-ant-${"d".repeat(24)}`;
		expect(redactSecrets(`anthropic ${key}`, [])).toBe("anthropic [REDACTED]");
	});

	it("redacts provider keys from added git diff lines", () => {
		const key = `sk-test-${"e".repeat(24)}`;
		const diff = [
			"diff --git a/.env b/.env",
			"index 0000000..1111111 100644",
			"--- a/.env",
			"+++ b/.env",
			"@@ -0,0 +1 @@",
			`+OPENAI_API_KEY=${key}`,
		].join("\n");

		expect(redactSecrets(diff, [])).toContain("+OPENAI_API_KEY=[REDACTED]");
		expect(redactSecrets(diff, [])).not.toContain(key);
	});
});
