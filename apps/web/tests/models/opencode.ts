import { randomUUID } from "node:crypto";

import { inject } from "vite-plus/test";

import type { OpenCodeFault, OpenCodeRequest } from "../auth/fake-upstream.ts";

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

/** Every Responses request simulated OpenCode received that named `key`. */
export async function openCodeRequests(key: string): Promise<OpenCodeRequest[]> {
	const all = (await (await control("requests")).json()) as OpenCodeRequest[];
	return all.filter((request) => request.key === key);
}
