import { randomUUID } from "node:crypto";

import { inject } from "vite-plus/test";

import type {
	OpenCodeApi,
	OpenCodeFault,
	OpenCodeReply,
	OpenCodeRequest,
} from "../auth/fake-upstream.ts";

const control = (path: string, init?: RequestInit) =>
	fetch(`${inject("upstreamUrl")}/__opencode/${path}`, init);

/**
 * A fresh OpenCode API key that simulated OpenCode accepts. Its synthetic marker lets a test
 * check that the key never shows up where it shouldn't.
 */
export async function openCodeKey(): Promise<string> {
	const key = `sk-oc-MARKER-${randomUUID()}`;
	const response = await control("keys", { method: "POST", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Issuing an OpenCode key failed: ${response.status}`);
	return key;
}

/** Makes simulated OpenCode answer its next request with `fault`. */
export async function failNextOpenCodeRequest(fault: OpenCodeFault): Promise<void> {
	const response = await control("fail-next", { method: "POST", body: JSON.stringify(fault) });
	if (!response.ok) throw new Error(`Queuing an OpenCode fault failed: ${response.status}`);
}

/** Makes simulated OpenCode stream `reply` to its next turn, a streamed request. */
export async function replyToNextOpenCodeTurn(reply: OpenCodeReply): Promise<void> {
	const response = await control("reply-next", { method: "POST", body: JSON.stringify(reply) });
	if (!response.ok) throw new Error(`Queuing an OpenCode reply failed: ${response.status}`);
}

/**
 * Finishes every held turn that named `key`, as if OpenCode completed its reply, or hit its
 * limit when the reply was limited.
 */
export async function releaseOpenCodeTurn(key: string): Promise<void> {
	const response = await control("release", { method: "POST", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Releasing an OpenCode turn failed: ${response.status}`);
}

/** Whether a streamed turn that named `key` was hung up on before it completed. */
export async function openCodeTurnHungUp(key: string): Promise<boolean> {
	const keys = (await (await control("hung-up")).json()) as string[];
	return keys.includes(key);
}

const requests = async () => (await (await control("requests")).json()) as OpenCodeRequest[];

/** Every request simulated OpenCode received that named `key`, or every one at all. */
export async function openCodeRequests(key?: string) {
	return (await requests())
		.filter((request) => key === undefined || request.key === key)
		.map(({ key, model }) => ({ key, model }));
}

/** Which endpoint each request naming `key` went to, in order. */
export async function openCodeApis(key: string): Promise<OpenCodeApi[]> {
	return (await requests()).filter((request) => request.key === key).map(({ api }) => api);
}

/** What each request naming `key` asked, in order: the last thing the user said. */
export async function openCodeAsked(key: string): Promise<(string | null)[]> {
	return (await requests()).filter((request) => request.key === key).map(({ asked }) => asked);
}

/** Makes every request naming `key` answer `fault`, until `clearOpenCodeFault`. */
async function faultOpenCode(key: string, fault: OpenCodeFault): Promise<void> {
	const response = await control("fault", {
		method: "POST",
		body: JSON.stringify({ key, ...fault }),
	});
	if (!response.ok) throw new Error(`Faulting an OpenCode key failed: ${response.status}`);
}

export async function clearOpenCodeFault(key: string): Promise<void> {
	const response = await control("fault", { method: "DELETE", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Clearing an OpenCode fault failed: ${response.status}`);
}

/** Limits `key`: 429, with a `retry-after` of `retryAfter` seconds if given. */
export const limitOpenCode = (key: string, { retryAfter }: { retryAfter?: number } = {}) =>
	faultOpenCode(key, { status: 429, retryAfter });

/** Takes OpenCode down for `key`: 503. */
export const startOpenCodeOutage = (key: string) => faultOpenCode(key, { status: 503 });

/** Revokes `key`: 401. */
export const revokeOpenCodeKey = (key: string) => faultOpenCode(key, { status: 401 });
