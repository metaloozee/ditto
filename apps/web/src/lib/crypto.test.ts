import { describe, expect, it } from "vitest";
import { decryptText, encryptText, providerCredentialAad } from "#/lib/crypto";

describe("crypto", () => {
	it("round-trips without AAD (project-env compatibility)", async () => {
		const secret = "project-env-secret-value-long-enough";
		const payload = await encryptText("hello-env", secret);
		await expect(decryptText(payload, secret)).resolves.toBe("hello-env");
	});

	it("round-trips with correct AAD", async () => {
		const secret = "ai-credentials-secret-distinct";
		const aad = providerCredentialAad("user:with:colons", "prov:ider");
		const payload = await encryptText("cred", secret, { additionalData: aad });
		await expect(
			decryptText(payload, secret, { additionalData: aad }),
		).resolves.toBe("cred");
	});

	it("fails closed on wrong user or provider AAD", async () => {
		const secret = "ai-credentials-secret-distinct";
		const aad = providerCredentialAad("userA", "anthropic");
		const payload = await encryptText("secret-value", secret, {
			additionalData: aad,
		});
		await expect(
			decryptText(payload, secret, {
				additionalData: providerCredentialAad("userB", "anthropic"),
			}),
		).rejects.toThrow(/Failed to decrypt/);
		await expect(
			decryptText(payload, secret, {
				additionalData: providerCredentialAad("userA", "openai"),
			}),
		).rejects.toThrow(/Failed to decrypt/);
		await expect(decryptText(payload, secret)).rejects.toThrow(
			/Failed to decrypt/,
		);
	});

	it("rejects malformed payloads without leaking plaintext", async () => {
		await expect(decryptText("not-valid", "secret")).rejects.toThrow(
			/Malformed/,
		);
		try {
			await decryptText("v1.zz.yy.xx", "secret");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).not.toMatch(/secret|plaintext|cred/i);
		}
	});
});
