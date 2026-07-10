/** Reuses BETTER_AUTH_SECRET to avoid a separate deploy secret for agent git callbacks. */

export const AGENT_GIT_JWT_SUB = "agent-git";
/** Align with `AGENT_COMMAND_TIMEOUT_MS` (600_000) in agent-run — 10 minutes. */
export const AGENT_GIT_JWT_TTL_SECONDS = 600;

export type AgentGitJwtClaims = {
	sub: typeof AGENT_GIT_JWT_SUB;
	projectId: string;
	sessionId: string;
	userId: string;
	sandboxId: string;
	exp: number;
};

const textEncoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const padLen = (4 - (padded.length % 4)) % 4;
	const decoded = atob(padded + "=".repeat(padLen));
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i++) {
		bytes[i] = decoded.charCodeAt(i);
	}
	return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		textEncoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

async function signJwt(
	claims: AgentGitJwtClaims,
	secret: string,
): Promise<string> {
	const header = base64UrlEncode(
		textEncoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
	);
	const payload = base64UrlEncode(textEncoder.encode(JSON.stringify(claims)));
	const signingInput = `${header}.${payload}`;
	const key = await importHmacKey(secret);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		textEncoder.encode(signingInput),
	);
	return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function mintAgentGitJwt(options: {
	secret: string;
	projectId: string;
	sessionId: string;
	userId: string;
	sandboxId: string;
	nowSeconds?: number;
}): Promise<string> {
	const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
	const claims: AgentGitJwtClaims = {
		sub: AGENT_GIT_JWT_SUB,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
		sandboxId: options.sandboxId,
		exp: now + AGENT_GIT_JWT_TTL_SECONDS,
	};
	return signJwt(claims, options.secret);
}

export type VerifyAgentGitJwtResult =
	| { ok: true; claims: AgentGitJwtClaims }
	| {
			ok: false;
			reason: "malformed" | "bad_signature" | "expired" | "invalid_sub";
	  };

export async function verifyAgentGitJwt(
	token: string,
	secret: string,
	nowSeconds?: number,
): Promise<VerifyAgentGitJwtResult> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return { ok: false, reason: "malformed" };
	}

	const [headerPart, payloadPart, signaturePart] = parts;
	if (!headerPart || !payloadPart || !signaturePart) {
		return { ok: false, reason: "malformed" };
	}

	const signingInput = `${headerPart}.${payloadPart}`;
	const key = await importHmacKey(secret);
	const signatureBytes = base64UrlDecode(signaturePart);
	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signatureBytes,
		textEncoder.encode(signingInput),
	);
	if (!valid) {
		return { ok: false, reason: "bad_signature" };
	}

	let payload: unknown;
	try {
		const json = new TextDecoder().decode(base64UrlDecode(payloadPart));
		payload = JSON.parse(json);
	} catch {
		return { ok: false, reason: "malformed" };
	}

	if (!payload || typeof payload !== "object") {
		return { ok: false, reason: "malformed" };
	}

	const record = payload as Record<string, unknown>;
	if (record.sub !== AGENT_GIT_JWT_SUB) {
		return { ok: false, reason: "invalid_sub" };
	}

	const exp = record.exp;
	if (typeof exp !== "number" || !Number.isFinite(exp)) {
		return { ok: false, reason: "malformed" };
	}

	const now = nowSeconds ?? Math.floor(Date.now() / 1000);
	if (exp <= now) {
		return { ok: false, reason: "expired" };
	}

	for (const field of [
		"projectId",
		"sessionId",
		"userId",
		"sandboxId",
	] as const) {
		if (typeof record[field] !== "string" || record[field].length === 0) {
			return { ok: false, reason: "malformed" };
		}
	}

	return {
		ok: true,
		claims: {
			sub: AGENT_GIT_JWT_SUB,
			projectId: record.projectId as string,
			sessionId: record.sessionId as string,
			userId: record.userId as string,
			sandboxId: record.sandboxId as string,
			exp,
		},
	};
}

export function agentGitCallbackUrl(env: Env): string {
	const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
	return `${base}/api/agent/git`;
}
