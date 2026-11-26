import { randomUUID } from "node:crypto";

import { inject } from "vite-plus/test";

import type {
	OpenCodeFault,
	OpenCodeLimit,
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

/** Makes simulated OpenCode answer its next Responses request with `fault`. */
export async function failNextOpenCodeRequest(fault: OpenCodeFault): Promise<void> {
	const response = await control("fail-next", { method: "POST", body: JSON.stringify(fault) });
	if (!response.ok) throw new Error(`Queuing an OpenCode fault failed: ${response.status}`);
}

/** Makes simulated OpenCode stream `reply` to its next turn, a streamed Responses request. */
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

/** Every Responses request simulated OpenCode received that named `key`, or every one at all. */
export async function openCodeRequests(key?: string): Promise<OpenCodeRequest[]> {
	const all = (await (await control("requests")).json()) as OpenCodeRequest[];
	return key === undefined ? all : all.filter((request) => request.key === key);
}

/**
 * Limits `key`: from now on every Responses request naming it answers 429, with a
 * `retry-after` of `retryAfter` seconds if given, until `liftOpenCodeLimit`.
 */
export async function limitOpenCode(key: string, limit: OpenCodeLimit = {}): Promise<void> {
	const response = await control("limit", {
		method: "POST",
		body: JSON.stringify({ key, ...limit }),
	});
	if (!response.ok) throw new Error(`Limiting an OpenCode key failed: ${response.status}`);
}

export async function liftOpenCodeLimit(key: string): Promise<void> {
	const response = await control("limit", { method: "DELETE", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Lifting an OpenCode limit failed: ${response.status}`);
}

/** What each Responses request naming `key` asked, in order: the last thing the user said. */
export async function openCodeAsked(key: string): Promise<(string | null)[]> {
	const all = (await (await control("asked")).json()) as {
		key: string | null;
		text: string | null;
	}[];
	return all.filter((asked) => asked.key === key).map((asked) => asked.text);
}

/** Takes OpenCode down for `key`: every request naming it answers 503 until `endOpenCodeOutage`. */
export async function startOpenCodeOutage(key: string): Promise<void> {
	const response = await control("down", { method: "POST", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Starting an OpenCode outage failed: ${response.status}`);
}

export async function endOpenCodeOutage(key: string): Promise<void> {
	const response = await control("down", { method: "DELETE", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Ending an OpenCode outage failed: ${response.status}`);
}

/** Revokes `key`: from now on OpenCode answers every request naming it with 401. */
export async function revokeOpenCodeKey(key: string): Promise<void> {
	const response = await control("revoke", { method: "POST", body: JSON.stringify({ key }) });
	if (!response.ok) throw new Error(`Revoking an OpenCode key failed: ${response.status}`);
}
