import { randomUUID } from "node:crypto";

import { inject } from "vite-plus/test";

import type {
	ChatGPTRefresh,
	ChatGPTRefreshPlan,
	ChatGPTRefreshFault,
	ChatGPTRequest,
} from "../auth/fake-upstream.ts";

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
export async function chatgptCredential({ expired = false } = {}) {
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
		expires: expired ? Date.now() - 1000 : Date.now() + 3_600_000,
		clientId: "oaiapp_TEST_client",
		scopes: SIWC_SCOPES,
	};
}

/** The marker part of a token, which must appear nowhere it shouldn't. */
export const markerOf = (token: string) => token.slice("xx-MARKER-".length);

/**
 * Every refresh simulated OpenAI received for the sign-in that began with `refresh`, following
 * its rotations, in order.
 */
export async function chatgptRefreshes(refresh: string): Promise<ChatGPTRefresh[]> {
	const all = (await (await control("refreshes")).json()) as ChatGPTRefresh[];
	const chain = new Set([refresh]);
	return all.filter((each) => {
		if (!each.presented || !chain.has(each.presented)) return false;
		if (each.issued) chain.add(each.issued.refresh);
		return true;
	});
}

/** Plans what simulated OpenAI does with its next good refresh: hold it, or lose its answer. */
export async function planNextRefresh(plan: ChatGPTRefreshPlan): Promise<void> {
	const response = await control("refresh-next", { method: "POST", body: JSON.stringify(plan) });
	if (!response.ok) throw new Error(`Planning a refresh failed: ${response.status}`);
}

/** Answers the held refreshes. */
export async function releaseRefresh(): Promise<void> {
	const response = await control("refresh-release", { method: "POST" });
	if (!response.ok) throw new Error(`Nothing held to release: ${response.status}`);
}

/** Makes every refresh answer `fault.status` until `endRefreshFault`. */
export async function startRefreshFault(fault: ChatGPTRefreshFault): Promise<void> {
	await control("refresh-fault", { method: "POST", body: JSON.stringify(fault) });
}

export async function endRefreshFault(): Promise<void> {
	await control("refresh-fault", { method: "DELETE" });
}

/** Makes simulated OpenAI refuse `refresh` from now on, as a revoked sign-in. */
export async function revokeRefreshToken(refresh: string): Promise<void> {
	await control("revoke", { method: "POST", body: JSON.stringify({ refresh }) });
}

/** Makes simulated OpenAI refuse `access` before it expires, while its refresh token works. */
export async function rejectAccessToken(access: string): Promise<void> {
	await control("reject-access", { method: "POST", body: JSON.stringify({ access }) });
}

/** Every request simulated api.openai.com received that carried `token`, or every one at all. */
export async function chatgptRequests(token?: string): Promise<ChatGPTRequest[]> {
	const all = (await (await control("requests")).json()) as ChatGPTRequest[];
	return token === undefined ? all : all.filter((request) => request.token === token);
}
