// Checks a Sign in with ChatGPT ID token as OpenAI's sign-in docs require: signed by a key
// OpenAI publishes, issued by auth.openai.com, for this client, unexpired, and for this attempt.
// Web APIs only, so it runs under Node and in workerd.

export const ISSUER = "https://auth.openai.com";

export type IdTokenCheck = "signature" | "iss" | "aud" | "exp" | "nonce";

type Jwk = JsonWebKey & { kid?: string };

const decode = (part: string) =>
	Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const json = (part: string): Record<string, unknown> => {
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
		return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

async function signedByPublishedKey(token: string, jwks: unknown): Promise<boolean> {
	const [header = "", payload = "", signature = ""] = token.split(".");
	const { alg, kid } = json(header);
	if (alg !== "RS256") return false;
	const keys: unknown = jwks && typeof jwks === "object" ? Reflect.get(jwks, "keys") : undefined;
	const jwk = Array.isArray(keys)
		? (keys as Jwk[]).find((k) => k.kid === kid && k.kty === "RSA")
		: undefined;
	if (!jwk) return false;
	try {
		const key = await crypto.subtle.importKey(
			"jwk",
			{ kty: jwk.kty, n: jwk.n, e: jwk.e },
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["verify"],
		);
		return await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			decode(signature),
			new TextEncoder().encode(`${header}.${payload}`),
		);
	} catch {
		return false;
	}
}

/** Lists every check the token fails, in a fixed order, so the evidence names them all. */
export async function validateIdToken(
	token: string,
	expected: { clientId: string; nonce: string; jwks: unknown; now?: Date },
): Promise<{ ok: boolean; failures: IdTokenCheck[] }> {
	const failures: IdTokenCheck[] = [];
	if (!(await signedByPublishedKey(token, expected.jwks))) {
		return { ok: false, failures: ["signature"] };
	}
	const claims = json(token.split(".")[1] ?? "");
	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	const now = (expected.now ?? new Date()).getTime() / 1000;
	if (claims.iss !== ISSUER) failures.push("iss");
	if (!audiences.includes(expected.clientId)) failures.push("aud");
	if (typeof claims.exp !== "number" || claims.exp <= now) failures.push("exp");
	if (claims.nonce !== expected.nonce) failures.push("nonce");
	return { ok: failures.length === 0, failures };
}
