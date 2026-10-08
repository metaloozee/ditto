import { describe, expect, it, vi } from "vitest";
import { handleCodexConnection } from "./codex-connection";
import { openCredentials, sealCredentials } from "./codex-credential-crypto";

const tokens = {
	access: "synthetic-access",
	refresh: "synthetic-refresh",
	identity: "synthetic-identity",
	expiresAt: 1234,
};
const keyring = { current: "fixture", keys: { fixture: "01".repeat(32) } };
function operations() {
	return {
		status: vi.fn(async () => ({
			status: "connected" as const,
			generation: 1,
		})),
		disconnect: vi.fn(async () => {}),
	};
}

describe("owned Codex product operations", () => {
	it("requires authentication before accessing credential operations", async () => {
		const ops = operations();
		for (const action of ["status", "connect", "disconnect"])
			expect(
				(
					await handleCodexConnection({
						authenticatedUserId: null,
						body: { action },
						operations: ops,
					})
				).status,
			).toBe(401);
		expect(ops.status).not.toHaveBeenCalled();
		expect(ops.disconnect).not.toHaveBeenCalled();
	});
	it("rejects foreign owner and executor/builder authority fields", async () => {
		const ops = operations();
		for (const body of [
			{ action: "status", userId: "foreign" },
			{ action: "disconnect", owner: "foreign" },
			{ action: "connect", role: "builder" },
			{ action: "status", role: "executor" },
			{ action: { toString: () => "status" } },
		])
			expect(
				(
					await handleCodexConnection({
						authenticatedUserId: "owner",
						body,
						operations: ops,
					})
				).status,
			).toBe(400);
		expect(ops.status).not.toHaveBeenCalled();
		expect(ops.disconnect).not.toHaveBeenCalled();
	});
	it("derives authority only from the authenticated product user", async () => {
		const ops = operations();
		await handleCodexConnection({
			authenticatedUserId: "owner",
			body: { action: "status" },
			operations: ops,
		});
		await handleCodexConnection({
			authenticatedUserId: "owner",
			body: { action: "disconnect" },
			operations: ops,
		});
		expect(ops.status).toHaveBeenCalledExactlyOnceWith("owner");
		expect(ops.disconnect).toHaveBeenCalledExactlyOnceWith("owner");
	});
	it("keeps all live connection and callback submissions unavailable without any writes", async () => {
		const ops = operations();
		expect(
			await handleCodexConnection({
				authenticatedUserId: "owner",
				body: { action: "connect" },
				operations: ops,
			}),
		).toEqual({ status: 503, body: { code: "codex_hosted_auth_unverified" } });
		for (const body of [
			{ action: "callback", state: "expired" },
			{ action: "callback", state: "reused" },
			{ action: "connect", code: "synthetic-code" },
		])
			expect(
				(
					await handleCodexConnection({
						authenticatedUserId: "owner",
						body,
						operations: ops,
					})
				).status,
			).toBe(400);
		expect(ops.status).not.toHaveBeenCalled();
		expect(ops.disconnect).not.toHaveBeenCalled();
	});
});
describe("product credential encryption", () => {
	it("uses unique nonces and encrypts every retained token", async () => {
		const one = await sealCredentials(tokens, "owner", 1, keyring);
		const two = await sealCredentials(tokens, "owner", 1, keyring);
		expect(JSON.parse(one).nonce).not.toBe(JSON.parse(two).nonce);
		for (const token of [tokens.access, tokens.refresh, tokens.identity])
			expect(one).not.toContain(token);
		expect(await openCredentials(one, "owner", 1, keyring)).toEqual(tokens);
	});
	it("fails closed for owner, generation, version, tampering and unavailable historical key", async () => {
		const sealed = await sealCredentials(tokens, "owner", 1, keyring);
		await expect(
			openCredentials(sealed, "foreign", 1, keyring),
		).rejects.toThrow("credential_integrity");
		await expect(openCredentials(sealed, "owner", 2, keyring)).rejects.toThrow(
			"credential_integrity",
		);
		await expect(
			openCredentials(sealed, "owner", 1, keyring, 3),
		).rejects.toThrow("credential_integrity");
		const envelope = JSON.parse(sealed);
		for (const change of [
			{ format: 1 },
			{ ciphertext: `ff${envelope.ciphertext.slice(2)}` },
			{ nonce: "00" },
		])
			await expect(
				openCredentials(
					JSON.stringify({ ...envelope, ...change }),
					"owner",
					1,
					keyring,
				),
			).rejects.toThrow("credential_integrity");
		await expect(
			openCredentials(sealed, "owner", 1, {
				current: "next",
				keys: { next: "02".repeat(32) },
			}),
		).rejects.toThrow("credential_integrity");
		expect(
			await openCredentials(sealed, "owner", 1, {
				current: "next",
				keys: { ...keyring.keys, next: "02".repeat(32) },
			}),
		).toEqual(tokens);
	});
	it("bounds token persistence and never echoes a rejected token", async () => {
		await expect(
			sealCredentials(
				{ ...tokens, access: "x".repeat(8193) },
				"owner",
				1,
				keyring,
			),
		).rejects.toThrow("credential_integrity");
	});
});
