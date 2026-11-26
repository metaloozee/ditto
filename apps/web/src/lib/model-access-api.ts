import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { ModelAccessView } from "#/credentials-rpc.ts";
import type { ModelAccess, Pair } from "#/lib/model-access.ts";

/** The signed-in account's model access, read on the server so Settings renders it at once. */
export const getModelAccess = createServerFn({ method: "GET" }).handler(
	async (): Promise<ModelAccessView> => {
		const { signedInCredentials } = await import("./model-access-gateway.server.ts");
		const view: ModelAccessView = await (await signedInCredentials(getRequestHeaders())).view();
		return view;
	},
);

/** Whether this deployment offers the signed-in owner the ChatGPT plan. */
export const getChatGPTOffered = createServerFn({ method: "GET" }).handler(
	async (): Promise<boolean> => {
		const { signedInCredentials } = await import("./model-access-gateway.server.ts");
		const credentials = await signedInCredentials(getRequestHeaders());
		const offered: boolean = await credentials.offersChatGPT();
		return offered;
	},
);

const UNREACHABLE = "Ditto couldn’t be reached. Check your connection and try again.";

/** Why a model-access request didn’t go through, or nothing once it did. */
export async function refusal(response: Response | null): Promise<string | undefined> {
	if (!response) return UNREACHABLE;
	if (response.ok) return undefined;
	const { error } = (await response.json().catch(() => ({}))) as { error?: unknown };
	return typeof error === "string" ? error : UNREACHABLE;
}

/** Connects an OpenCode key on `model`. Answers why it wasn't stored, or nothing once it is. */
export async function connectOpenCodeKey(key: string, model: string) {
	const response = await fetch("/api/models/opencode", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ key, model }),
	}).catch(() => null);
	return refusal(response);
}

/** Makes `pair` the account's default. Answers why it couldn't, or nothing once it is. */
export async function chooseDefaultPair(pair: Pair) {
	const response = await fetch("/api/models/default", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(pair),
	}).catch(() => null);
	return refusal(response);
}

/** Disconnects `connectionId` and forgets its access. Answers why it couldn't, or nothing. */
export async function disconnectModel(connectionId: string) {
	const response = await fetch(`/api/models/${encodeURIComponent(connectionId)}`, {
		method: "DELETE",
	}).catch(() => null);
	return refusal(response);
}

/** The view as the components read it, with a limit's reset time back as a Date. */
export function accessOf(view: ModelAccessView): ModelAccess {
	return {
		connections: view.connections.map(({ resetsAt, ...connection }) =>
			resetsAt ? { ...connection, resetsAt: new Date(resetsAt) } : connection,
		),
		included: view.included,
	};
}

/** Reads the account's model access again, for a page that follows it without reloading. */
export async function readModelAccess(): Promise<ModelAccessView | null> {
	const response = await fetch("/api/models", { cache: "no-store" }).catch(() => null);
	return response?.ok ? ((await response.json()) as ModelAccessView) : null;
}

/** Probes the connection once. Settles once Ditto has its new state; reread it to see it. */
export async function checkConnection(connectionId: string): Promise<void> {
	await fetch(`/api/models/${encodeURIComponent(connectionId)}/check`, { method: "POST" }).catch(
		() => null,
	);
}
