import { describe, expect, it } from "vitest";
import {
	redactSecrets,
	redactStructured,
	StreamingSecretRedactor,
} from "./secret-redaction";

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

describe("redactStructured", () => {
	const secret = "live-secret-value-123";

	it("redacts exact known secret in a plain string", () => {
		expect(redactStructured(`prefix ${secret} suffix`, [secret])).toBe(
			"prefix [REDACTED] suffix",
		);
	});

	it("redacts nested object/array tool-like payload while preserving structure", () => {
		const payload = {
			tool: "bash",
			args: { command: `echo ${secret}` },
			result: {
				stdout: `connected ${secret}`,
				items: [1, secret, { nested: secret }],
			},
			ok: true,
			count: 2,
			empty: null,
		};
		const redacted = redactStructured(payload, [secret]);
		expect(redacted).toEqual({
			tool: "bash",
			args: { command: "echo [REDACTED]" },
			result: {
				stdout: "connected [REDACTED]",
				items: [1, "[REDACTED]", { nested: "[REDACTED]" }],
			},
			ok: true,
			count: 2,
			empty: null,
		});
	});

	it("redacts pattern-shaped tokens inside nested values", () => {
		const token = `ghp_${"a".repeat(40)}`;
		expect(redactStructured({ result: { token } }, [])).toEqual({
			result: { token: "[REDACTED]" },
		});
	});

	it("does not hang on cycles and fails closed", () => {
		const cyclic: Record<string, unknown> = { a: secret };
		cyclic.self = cyclic;
		const redacted = redactStructured(cyclic, [secret]) as Record<
			string,
			unknown
		>;
		expect(redacted.a).toBe("[REDACTED]");
		expect(redacted.self).toBe("[REDACTED]");
	});

	it("handles array cycles without hanging", () => {
		const arr: unknown[] = [secret];
		arr.push(arr);
		const redacted = redactStructured(arr, [secret]) as unknown[];
		expect(redacted[0]).toBe("[REDACTED]");
		expect(redacted[1]).toBe("[REDACTED]");
	});
});

describe("StreamingSecretRedactor", () => {
	const secret = "live-secret-value-123";

	it("redacts exact known secret when it arrives in one chunk", () => {
		const r = new StreamingSecretRedactor([secret]);
		const out = r.push(`token=${secret} ok`) + r.flush();
		expect(out).toBe("token=[REDACTED] ok");
		expect(out).not.toContain(secret);
	});

	it("never leaks a secret split across two push chunks", () => {
		const r = new StreamingSecretRedactor([secret]);
		const mid = Math.floor(secret.length / 2);
		const a = r.push(`before ${secret.slice(0, mid)}`);
		const b = r.push(`${secret.slice(mid)} after`);
		const c = r.flush();
		const combined = a + b + c;
		expect(combined).not.toContain(secret);
		expect(combined).toContain("[REDACTED]");
		expect(combined).toContain("before");
		expect(combined).toContain("after");
	});

	it("never leaks a secret split across three push chunks", () => {
		const r = new StreamingSecretRedactor([secret]);
		const third = Math.ceil(secret.length / 3);
		const a = r.push(secret.slice(0, third));
		const b = r.push(secret.slice(third, third * 2));
		const c = r.push(secret.slice(third * 2));
		const d = r.flush();
		const combined = a + b + c + d;
		expect(combined).not.toContain(secret);
		expect(combined).toBe("[REDACTED]");
	});

	it("holds back using the maximum of multiple secrets sharing prefixes", () => {
		const short = "shared-prefix-aa";
		const longer = "shared-prefix-aabbccdd";
		const r = new StreamingSecretRedactor([short, longer]);
		// Emit only a proper prefix of the longer secret so neither is complete.
		const partial = longer.slice(0, longer.length - 1);
		const emitted = r.push(`x${partial}`);
		expect(emitted).not.toContain(short);
		expect(emitted).not.toContain(longer);
		expect(emitted + partial).not.toEqual(expect.stringContaining(longer));
		// Completing the longer secret redacts it (and would have redacted short).
		const rest = r.push(`${longer.slice(-1)}!`);
		const done = r.flush();
		const combined = emitted + rest + done;
		expect(combined).not.toContain(longer);
		expect(combined).not.toContain(short);
		expect(combined).toContain("[REDACTED]");
	});

	it("redacts multiline private-key-shaped fixture split across chunks", () => {
		const pem = [
			"-----BEGIN RSA PRIVATE KEY-----",
			"fake-key-material-line-1",
			"fake-key-material-line-2",
			"-----END RSA PRIVATE KEY-----",
		].join("\n");
		const r = new StreamingSecretRedactor([]);
		const mid = pem.indexOf("\n") + 1;
		const a = r.push(`before\n${pem.slice(0, mid)}`);
		const b = r.push(pem.slice(mid, mid + 20));
		const c = r.push(`${pem.slice(mid + 20)}\nafter`);
		const d = r.flush();
		const combined = a + b + c + d;
		expect(combined).not.toContain("PRIVATE KEY");
		expect(combined).not.toContain("fake-key-material");
		expect(combined).toContain("[REDACTED]");
		expect(combined).toContain("before");
		expect(combined).toContain("after");
	});

	it("fail-closes incomplete PEM on flush", () => {
		const r = new StreamingSecretRedactor([]);
		const a = r.push("note\n-----BEGIN RSA PRIVATE KEY-----\nfake-only");
		const b = r.flush();
		const combined = a + b;
		expect(combined).not.toContain("PRIVATE KEY");
		expect(combined).not.toContain("fake-only");
		expect(combined).toContain("[REDACTED]");
		expect(combined).toContain("note");
	});

	it("does not leak a long exact secret split beyond the pattern window", () => {
		const secret = `long-secret-${"x".repeat(256)}`;
		const r = new StreamingSecretRedactor([secret]);
		const splitAt = 180;
		const first = r.push(`safe ${secret.slice(0, splitAt)}`);
		const second = r.push(`${secret.slice(splitAt)} done`);
		const output = first + second + r.flush();
		expect(output).toBe("safe [REDACTED] done");
		expect(output).not.toContain(secret);
	});

	it("streams safe text even when a configured secret is very long", () => {
		const r = new StreamingSecretRedactor(["x".repeat(4_096)]);
		const text = "ordinary assistant output ".repeat(8);
		const streamed = r.push(text);
		expect(streamed.length).toBeGreaterThan(0);
		expect(streamed + r.flush()).toBe(text);
	});

	it("passes safe text through correctly after flush", () => {
		const r = new StreamingSecretRedactor([secret]);
		const text = "read /workspace/src/index.ts and wrote normal log output";
		const a = r.push(text.slice(0, 10));
		const b = r.push(text.slice(10));
		const c = r.flush();
		expect(a + b + c).toBe(text);
	});

	it("does not hold back or redact exact secrets shorter than 8", () => {
		const r = new StreamingSecretRedactor(["abc123"]);
		const out = r.push("short abc123 value") + r.flush();
		expect(out).toBe("short abc123 value");
	});
});

describe("StreamingSecretRedactor credential leaves", () => {
	it("redacts api key / access / refresh split across chunks", () => {
		const apiKey = "sk-live-api-key-value-12345678";
		const access = "access-token-leaf-abcdefgh";
		const refresh = "refresh-token-leaf-ijklmnop";
		const unknown = "unknown-secret-leaf-qrstuvwx";
		const redactor = new StreamingSecretRedactor([
			apiKey,
			access,
			refresh,
			unknown,
		]);

		const out1 = redactor.push(`key=${apiKey.slice(0, 10)}`);
		const out2 = redactor.push(
			`${apiKey.slice(10)} access=${access.slice(0, 8)}`,
		);
		const out3 = redactor.push(
			`${access.slice(8)} refresh=${refresh} other=${unknown}`,
		);
		const flushed = redactor.flush();
		const all = `${out1}${out2}${out3}${flushed}`;
		expect(all).not.toContain(apiKey);
		expect(all).not.toContain(access);
		expect(all).not.toContain(refresh);
		expect(all).not.toContain(unknown);
		expect(all).toContain("[REDACTED]");
	});
});
