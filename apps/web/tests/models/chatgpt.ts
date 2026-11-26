import { randomUUID } from "node:crypto";

import { inject } from "vite-plus/test";

import type { ChatGPTRequest } from "../auth/fake-upstream.ts";

const control = (path: string, init?: RequestInit) =>
	fetch(`${inject("upstreamUrl")}/__chatgpt/${path}`, init);

/** The scopes Sign in with ChatGPT grants, plan usage among them. */
export const SIWC_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"resource.invoke",
	"chatgpt.tokens.use.direct",
];

/**
 * A fresh Sign in with ChatGPT credential, shaped as Pi saves one after a local sign-in, whose
 * access token simulated OpenAI accepts. Each token carries its own synthetic marker.
 */
export async function chatgptCredential() {
	const access = `at-MARKER-${randomUUID()}`;
	const refresh = `rt-MARKER-${randomUUID()}`;
	const response = await control("tokens", {
		method: "POST",
		body: JSON.stringify({ access, refresh }),
	});
	if (!response.ok) throw new Error(`Issuing ChatGPT tokens failed: ${response.status}`);
	return {
		type: "oauth",
		access,
		refresh,
		expires: Date.now() + 3_600_000,
		clientId: "oaiapp_TEST_client",
		scopes: SIWC_SCOPES,
	};
}

/** The marker part of a token, which must appear nowhere it shouldn't. */
export const markerOf = (token: string) => token.slice("xx-MARKER-".length);

/** Every request simulated api.openai.com received that carried `token`, or every one at all. */
export async function chatgptRequests(token?: string): Promise<ChatGPTRequest[]> {
	const all = (await (await control("requests")).json()) as ChatGPTRequest[];
	return token === undefined ? all : all.filter((request) => request.token === token);
}
