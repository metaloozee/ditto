import { describe, expect, it } from "vite-plus/test";

import { validateIdToken } from "./id-token.ts";
import { signingKey } from "./simulated-provider.ts";

const CLIENT_ID = "oaiapp_SIMULATED";
const NONCE = "nonce-SIMULATED";
const NOW = new Date("2026-11-24T10:00:00Z");
const nowSeconds = NOW.getTime() / 1000;

const claims = {
	iss: "https://auth.openai.com",
	aud: CLIENT_ID,
	sub: "user-SIMULATED",
	exp: nowSeconds + 3600,
	iat: nowSeconds,
	nonce: NONCE,
};

describe("ID token check", () => {
	it("accepts a token OpenAI signed for this client and sign-in attempt", async () => {
		const key = await signingKey();
		const result = await validateIdToken(await key.sign(claims), {
			clientId: CLIENT_ID,
			nonce: NONCE,
			jwks: key.jwks,
			now: NOW,
		});
		expect(result).toEqual({ ok: true, failures: [] });
	});

	it("names every check a token fails", async () => {
		const key = await signingKey();
		const token = await key.sign({
			...claims,
			iss: "https://evil.example",
			aud: "someone-else",
			exp: nowSeconds - 60,
			nonce: "replayed",
		});
		const result = await validateIdToken(token, {
			clientId: CLIENT_ID,
			nonce: NONCE,
			jwks: key.jwks,
			now: NOW,
		});
		expect(result.ok).toBe(false);
		expect(result.failures).toEqual(["iss", "aud", "exp", "nonce"]);
	});

	it("refuses a token signed by a key OpenAI does not publish", async () => {
		const openai = await signingKey();
		const forger = await signingKey(openai.kid);
		const result = await validateIdToken(await forger.sign(claims), {
			clientId: CLIENT_ID,
			nonce: NONCE,
			jwks: openai.jwks,
			now: NOW,
		});
		expect(result).toEqual({ ok: false, failures: ["signature"] });
	});

	it("accepts aud as a list that contains the client", async () => {
		const key = await signingKey();
		const result = await validateIdToken(await key.sign({ ...claims, aud: ["other", CLIENT_ID] }), {
			clientId: CLIENT_ID,
			nonce: NONCE,
			jwks: key.jwks,
			now: NOW,
		});
		expect(result.ok).toBe(true);
	});
});
