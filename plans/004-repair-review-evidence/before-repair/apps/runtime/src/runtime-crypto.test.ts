import { describe, expect, it } from "vitest";
import {
	canonicalRuntimeAad,
	decryptRuntimePayload,
	decryptRuntimeRecord,
	decryptRuntimeText,
	encryptRuntimePayload,
	encryptRuntimeRecord,
	encryptRuntimeText,
	importRuntimeKeyringFromBytes,
	parseRuntimeCiphertextV1,
	parseRuntimeKeyring,
	RUNTIME_CRYPTO_FORMAT_VERSION,
	type RuntimeAad,
	serializeRuntimeCiphertext,
} from "./runtime-crypto.ts";

function keyBytes(fill: number): Uint8Array {
	return new Uint8Array(32).fill(fill);
}

function aad(overrides: Partial<RuntimeAad> = {}): RuntimeAad {
	return {
		ownerId: "owner-1",
		workspaceSessionId: "sess-1",
		recordId: "rec-1",
		formatVersion: RUNTIME_CRYPTO_FORMAT_VERSION,
		...overrides,
	};
}

describe("T31 runtime crypto keyring and ciphertext", () => {
	it("T31 round-trips with canonical AAD and a unique nonce per write", async () => {
		const keyring = await importRuntimeKeyringFromBytes("v1", {
			v1: keyBytes(1),
		});
		const first = await encryptRuntimeText("canonical-body", keyring, aad());
		const second = await encryptRuntimeText("canonical-body", keyring, aad());
		expect(first).not.toBe(second);
		expect(first).not.toContain("canonical-body");
		expect(await decryptRuntimeText(first, keyring, aad())).toBe(
			"canonical-body",
		);
		const parsed = parseRuntimeCiphertextV1(first);
		expect(parsed.algorithm).toBe("aes-256-gcm");
		expect(parsed.keyVersion).toBe("v1");
	});

	it("T31 fails closed on tamper, owner/session/record swaps, and invalid nonce/tag", async () => {
		const keyring = await importRuntimeKeyringFromBytes("v1", {
			v1: keyBytes(2),
		});
		const envelope = await encryptRuntimeRecord(
			new TextEncoder().encode("secret-record"),
			keyring,
			aad(),
		);
		const raw = atob(envelope.ciphertext);
		const flipped =
			String.fromCharCode(raw.charCodeAt(0) ^ 0xff) + raw.slice(1);
		const tampered = {
			...envelope,
			ciphertext: btoa(flipped),
		};
		await expect(
			decryptRuntimeRecord(tampered, keyring, aad()),
		).rejects.toMatchObject({ code: "decrypt_failed" });
		await expect(
			decryptRuntimeRecord(envelope, keyring, aad({ ownerId: "owner-2" })),
		).rejects.toMatchObject({ code: "decrypt_failed" });
		await expect(
			decryptRuntimeRecord(
				envelope,
				keyring,
				aad({ workspaceSessionId: "sess-2" }),
			),
		).rejects.toMatchObject({ code: "decrypt_failed" });
		await expect(
			decryptRuntimeRecord(envelope, keyring, aad({ recordId: "rec-2" })),
		).rejects.toMatchObject({ code: "decrypt_failed" });
		await expect(
			decryptRuntimeRecord(
				{ ...envelope, nonce: btoa("short") },
				keyring,
				aad(),
			),
		).rejects.toMatchObject({ code: "invalid_ciphertext" });
		expect(() =>
			parseRuntimeCiphertextV1({ ...envelope, nonce: "$$$$" }),
		).toThrow(/invalid_/);
		expect(canonicalRuntimeAad(aad())).toBe(
			JSON.stringify([
				"ditto-runtime",
				"owner-1",
				"sess-1",
				"rec-1",
				RUNTIME_CRYPTO_FORMAT_VERSION,
			]),
		);
	});

	it("T31 fails closed on missing keys and decrypts rotated records with retained versions", async () => {
		const v1 = await importRuntimeKeyringFromBytes("v1", { v1: keyBytes(3) });
		const stored = await encryptRuntimeText("retained", v1, aad());
		const rotated = await importRuntimeKeyringFromBytes("v2", {
			v1: keyBytes(3),
			v2: keyBytes(4),
		});
		expect(await decryptRuntimeText(stored, rotated, aad())).toBe("retained");
		const v2Only = await importRuntimeKeyringFromBytes("v2", {
			v2: keyBytes(4),
		});
		await expect(
			decryptRuntimeText(stored, v2Only, aad()),
		).rejects.toMatchObject({ code: "missing_key" });
		await expect(
			parseRuntimeKeyring({
				currentVersion: "v9",
				keys: { v1: "00".repeat(32) },
			}),
		).rejects.toMatchObject({ code: "invalid_keyring" });
		await expect(
			parseRuntimeKeyring({
				currentVersion: "v1",
				keys: { v1: "not-hex" },
			}),
		).rejects.toMatchObject({ code: "invalid_keyring" });
	});

	it("T31 writes no plaintext and commits chunk manifests only after all bytes encrypt", async () => {
		const keyring = await importRuntimeKeyringFromBytes("v1", {
			v1: keyBytes(5),
		});
		const payload = new TextEncoder().encode("x".repeat(40_000));
		const stored = await encryptRuntimePayload(payload, keyring, aad(), {
			inlineMaxBytes: 1024,
			chunkBytes: 1500,
		});
		expect(stored.kind).toBe("chunked");
		if (stored.kind !== "chunked") throw new Error("expected chunked");
		expect(stored.manifest.chunkCount).toBeGreaterThan(1);
		expect(JSON.stringify(stored.manifest)).not.toContain("xxx");
		const roundTrip = await decryptRuntimePayload(stored, keyring, aad());
		expect(roundTrip.byteLength).toBe(payload.byteLength);
		const serialized = serializeRuntimeCiphertext(
			(await encryptRuntimePayload(payload.subarray(0, 8), keyring, aad()))
				.kind === "inline"
				? (await encryptRuntimePayload(payload.subarray(0, 8), keyring, aad()))
						.kind === "inline"
					? (
							(await encryptRuntimePayload(
								payload.subarray(0, 8),
								keyring,
								aad(),
							)) as { envelope: ReturnType<typeof parseRuntimeCiphertextV1> }
						).envelope
					: await encryptRuntimeRecord(payload.subarray(0, 8), keyring, aad())
				: await encryptRuntimeRecord(payload.subarray(0, 8), keyring, aad()),
		);
		expect(serialized).not.toMatch(/plaintext|secret-record|canonical-body/);
	});
});
