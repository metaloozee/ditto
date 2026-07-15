import { describe, expect, it } from "vitest";
import {
	AGENT_GIT_JWT_TTL_SECONDS,
	mintAgentGitJwt,
	verifyAgentGitJwt,
} from "./agent-git-jwt";

const SECRET = "test-secret-for-agent-git-jwt";

function b64urlBytes(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function b64urlJson(value: unknown): string {
	return b64urlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

async function signParts(
	headerPart: string,
	payloadPart: string,
	secret: string,
): Promise<string> {
	const signingInput = `${headerPart}.${payloadPart}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;
}

describe("agent-git-jwt", () => {
	it("mints and verifies a valid token", async () => {
		const now = 1_700_000_000;
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			nowSeconds: now,
		});

		const verified = await verifyAgentGitJwt(token, SECRET, now);
		expect(verified).toEqual({
			ok: true,
			claims: {
				sub: "agent-git",
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				sandboxId: "sandbox-1",
				exp: now + AGENT_GIT_JWT_TTL_SECONDS,
			},
		});
	});

	it("rejects expired tokens", async () => {
		const now = 1_700_000_000;
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			nowSeconds: now,
		});

		const verified = await verifyAgentGitJwt(
			token,
			SECRET,
			now + AGENT_GIT_JWT_TTL_SECONDS + 1,
		);
		expect(verified).toEqual({ ok: false, reason: "expired" });
	});

	it("rejects wrong secret", async () => {
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
		});

		const verified = await verifyAgentGitJwt(token, "other-secret");
		expect(verified).toEqual({ ok: false, reason: "bad_signature" });
	});

	it("rejects not-a-jwt as malformed", async () => {
		const verified = await verifyAgentGitJwt("not-a-jwt", SECRET);
		expect(verified).toEqual({ ok: false, reason: "malformed" });
	});

	it("rejects empty segments as malformed", async () => {
		await expect(verifyAgentGitJwt("..", SECRET)).resolves.toEqual({
			ok: false,
			reason: "malformed",
		});
		await expect(verifyAgentGitJwt("a..b", SECRET)).resolves.toEqual({
			ok: false,
			reason: "malformed",
		});
		await expect(verifyAgentGitJwt(".payload.sig", SECRET)).resolves.toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("rejects invalid Base64 alphabet in signature without throwing", async () => {
		// Signature is decoded before verify; invalid alphabet must not throw.
		const cases = [
			"hdr.pay.!!!invalid!!!",
			"aaaa.bbbb.???",
			"hdr.pay.sig with spaces",
			"hdr.pay.load?illegal",
			"x.y.~",
			"aa.bb.@#",
		];
		for (const token of cases) {
			await expect(verifyAgentGitJwt(token, SECRET)).resolves.toEqual({
				ok: false,
				reason: "malformed",
			});
		}
	});

	it("rejects invalid Base64 alphabet in payload after valid signature", async () => {
		// Signature verifies first; only then is the payload decoded.
		const header = b64urlJson({ alg: "HS256", typ: "JWT" });
		const badPayload = "!!!invalid!!!";
		const token = await signParts(header, badPayload, SECRET);
		await expect(verifyAgentGitJwt(token, SECRET)).resolves.toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("rejects signed non-JSON payload as malformed", async () => {
		const header = b64urlJson({ alg: "HS256", typ: "JWT" });
		const payload = b64urlBytes(new TextEncoder().encode("not-json"));
		const token = await signParts(header, payload, SECRET);
		await expect(verifyAgentGitJwt(token, SECRET)).resolves.toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("rejects missing required claims as malformed", async () => {
		const header = b64urlJson({ alg: "HS256", typ: "JWT" });
		const payload = b64urlJson({
			sub: "agent-git",
			exp: Math.floor(Date.now() / 1000) + 600,
		});
		const token = await signParts(header, payload, SECRET);
		await expect(verifyAgentGitJwt(token, SECRET)).resolves.toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("rejects wrong sub as invalid_sub", async () => {
		const header = b64urlJson({ alg: "HS256", typ: "JWT" });
		const payload = b64urlJson({
			sub: "other",
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
			exp: Math.floor(Date.now() / 1000) + 600,
		});
		const token = await signParts(header, payload, SECRET);
		await expect(verifyAgentGitJwt(token, SECRET)).resolves.toEqual({
			ok: false,
			reason: "invalid_sub",
		});
	});

	it("rejects valid-base64 signatures that do not verify (bad_signature)", async () => {
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
		});
		const parts = token.split(".");
		// Replace signature with different valid base64url bytes (all zeros encoded)
		const tampered = `${parts[0]}.${parts[1]}.${btoa("\0".repeat(32)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
		const verified = await verifyAgentGitJwt(tampered, SECRET);
		expect(verified).toEqual({ ok: false, reason: "bad_signature" });
	});
});
