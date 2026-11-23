// A simulated ChatGPT and OpenCode provider: Web APIs only, so it serves both the
// Node tests and the simulated-provider Worker in the feasibility-test stage.
export const ACCOUNT_ID = "9f1c2a7e-4b3d-4c55-8e21-0a6b7c8d9e10";
export const EMAIL = "owner@example.org";
export const API_KEY = "sk-opencode-SIMULATED-0123456789abcdefghijklmnop";

export function jwt(claims: Record<string, unknown>) {
	const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
	return `${encode({ alg: "none" })}.${encode(claims)}.c2lnbmF0dXJl`;
}

export function accessToken(generation: number) {
	return jwt({
		iss: "https://auth.openai.com",
		aud: "https://api.openai.com/v1",
		sub: `auth0|user-${generation}`,
		email: EMAIL,
		"https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT_ID },
		"https://api.openai.com/profile": { email: EMAIL },
		gen: generation,
	});
}

export const refreshToken = (generation: number) => `rt_SIMULATED_${generation}_${"x".repeat(48)}`;

const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

/** An RS256 key that signs ID tokens, and the JWKS document that publishes it. */
export async function signingKey(kid = "sim-key-1") {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const jwks = { keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] };
	async function sign(claims: Record<string, unknown>) {
		const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
		const input = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(claims)}`;
		const signature = await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			pair.privateKey,
			new TextEncoder().encode(input),
		);
		return `${input}.${base64url(new Uint8Array(signature))}`;
	}
	return { kid, jwks, sign };
}

function sse(text: string) {
	const events = [
		{ type: "response.created", response: { id: "resp_sim" } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg_sim", role: "assistant", content: [] },
		},
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				id: "msg_sim",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp_sim",
				status: "completed",
				usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
			},
		},
	];
	const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export type Fault = { status: number; body: string };

/** The client ID OpenAI issues to the simulated Sign in with ChatGPT registration. */
export const SIWC_CLIENT_ID = "oaiapp_SIMULATED_client";
export const SIWC_SCOPE =
	"openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const SIWC_RESOURCE = "https://api.openai.com/v1";
/** Fields OpenAI's plan-usage docs say this flow rejects, kept apart from the trial's own list. */
const SIWC_UNSUPPORTED = ["temperature", "max_output_tokens", "previous_response_id", "prompt"];

const subscriptionError = (status: number, code: string, param?: string) =>
	Response.json({ error: { code, message: `simulated ${code}`, param } }, { status });

/** Admission rules from the plan-usage docs: store false, stream true, no rejected fields or roles. */
function siwcRequestFault(body: Record<string, unknown>): Response | undefined {
	const field = SIWC_UNSUPPORTED.find((name) => name in body);
	if (field) return subscriptionError(400, "subscription_sharing_unsupported_capability", field);
	const input = Array.isArray(body.input) ? (body.input as { role?: string }[]) : [];
	if (input.some((item) => item.role === "system")) {
		return subscriptionError(400, "subscription_sharing_unsupported_capability", "input");
	}
	if (body.store !== false || body.stream !== true) {
		return subscriptionError(400, "subscription_sharing_unsupported_capability", "store");
	}
	return undefined;
}

/**
 * Simulates auth.openai.com, the ChatGPT Codex Responses endpoint, the Sign in with ChatGPT
 * plan-usage endpoint on api.openai.com and OpenCode Zen's OpenAI Responses endpoint. Refresh rotates both tokens, and the old
 * access token stops working, so a turn after refresh proves the new one is used.
 */
export function simulatedProvider(
	faults: {
		refresh?: Fault;
		responses?: (Fault | undefined)[];
		/** Serves sign-in: discovery, the signing key and the authorization-code exchange. */
		signIn?: {
			sign(claims: Record<string, unknown>): Promise<string>;
			jwks: unknown;
			/** The nonce the ID token carries: normally the one the authorize request sent. */
			nonce(): string;
		};
	} = {},
) {
	let generation = 1;
	// Sign in with ChatGPT tokens rotate apart from the Codex sign-in's, so one simulated
	// provider serves both routes in a shared test stage.
	let siwcGeneration = 1;
	let responseCalls = 0;
	const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (url.href === "https://auth.openai.com/oauth/token") {
			if (faults.refresh)
				return new Response(faults.refresh.body, { status: faults.refresh.status });
			const form = new URLSearchParams(await request.text());
			if (form.get("refresh_token") !== refreshToken(generation)) {
				return new Response('{"error":"invalid_grant"}', { status: 400 });
			}
			generation += 1;
			return Response.json({
				access_token: accessToken(generation),
				refresh_token: refreshToken(generation),
				id_token: jwt({ email: EMAIL }),
				expires_in: 864_000,
			});
		}
		const signIn = faults.signIn;
		if (signIn && url.href === "https://auth.openai.com/.well-known/openid-configuration") {
			return Response.json({
				issuer: "https://auth.openai.com",
				jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
			});
		}
		if (signIn && url.href === "https://auth.openai.com/.well-known/jwks.json") {
			return Response.json(signIn.jwks);
		}
		if (url.href === "https://auth.openai.com/api/accounts/oauth/token" && signIn) {
			const form = new URLSearchParams(await request.clone().text());
			if (form.get("grant_type") === "authorization_code") {
				if (
					form.get("client_id") !== SIWC_CLIENT_ID ||
					form.get("redirect_uri") !== "http://127.0.0.1:1455/auth/callback" ||
					form.get("resource") !== SIWC_RESOURCE ||
					!form.get("code") ||
					!form.get("code_verifier")
				) {
					return Response.json({ error: "invalid_grant" }, { status: 400 });
				}
				const now = Math.floor(Date.now() / 1000);
				return Response.json({
					access_token: accessToken(siwcGeneration),
					refresh_token: refreshToken(siwcGeneration),
					id_token: await signIn.sign({
						iss: "https://auth.openai.com",
						aud: SIWC_CLIENT_ID,
						sub: "user-SIMULATED",
						email: EMAIL,
						iat: now,
						exp: now + 3600,
						nonce: signIn.nonce(),
					}),
					token_type: "Bearer",
					expires_in: 3600,
					scope: SIWC_SCOPE,
				});
			}
		}
		if (url.href === "https://auth.openai.com/api/accounts/oauth/token") {
			if (faults.refresh)
				return new Response(faults.refresh.body, { status: faults.refresh.status });
			const form = new URLSearchParams(await request.text());
			if (form.get("client_id") !== SIWC_CLIENT_ID) {
				return Response.json({ error: "invalid_client" }, { status: 401 });
			}
			if (
				form.get("grant_type") !== "refresh_token" ||
				form.get("resource") !== SIWC_RESOURCE ||
				form.get("refresh_token") !== refreshToken(siwcGeneration)
			) {
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			}
			siwcGeneration += 1;
			return Response.json({
				access_token: accessToken(siwcGeneration),
				refresh_token: refreshToken(siwcGeneration),
				id_token: jwt({ email: EMAIL }),
				token_type: "Bearer",
				expires_in: 3600,
				scope: SIWC_SCOPE,
			});
		}
		if (url.href === "https://api.openai.com/v1/responses") {
			const fault = faults.responses?.[responseCalls++];
			if (fault) return new Response(fault.body, { status: fault.status });
			const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
			if (token !== accessToken(siwcGeneration)) {
				return subscriptionError(401, "subscription_sharing_invalid_user");
			}
			const rejected = siwcRequestFault(await request.json());
			return rejected ?? sse("pong");
		}
		const isCodex = url.href === "https://chatgpt.com/backend-api/codex/responses";
		const isOpenCode = url.href === "https://opencode.ai/inference/openai/v1/responses";
		if (isCodex || isOpenCode) {
			const fault = faults.responses?.[responseCalls++];
			if (fault) return new Response(fault.body, { status: fault.status });
			const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
			const expected = isCodex ? accessToken(generation) : API_KEY;
			if (token !== expected) return new Response('{"error":"unauthorized"}', { status: 401 });
			if (isCodex && request.headers.get("chatgpt-account-id") !== ACCOUNT_ID) {
				return new Response('{"error":"missing account"}', { status: 401 });
			}
			return sse("pong");
		}
		return new Response("unexpected host", { status: 599 });
	};
	return {
		fetch,
		generation: (route: "codex" | "siwc" = "codex") =>
			route === "siwc" ? siwcGeneration : generation,
	};
}
