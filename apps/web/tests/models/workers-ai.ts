import { inject } from "vite-plus/test";

import type { WorkersAiFault, WorkersAiRequest } from "../auth/fake-workers-ai.ts";

const control = (path: string, init?: RequestInit) =>
	fetch(`${inject("upstreamUrl")}/__workers-ai/${path}`, init);

/** Makes fake Workers AI answer the next request naming `fault.model` (or any) with `fault`. */
export async function failNextWorkersAiRequest(fault: WorkersAiFault): Promise<void> {
	const response = await control("fail-next", { method: "POST", body: JSON.stringify(fault) });
	if (!response.ok) throw new Error(`Queuing a Workers AI fault failed: ${response.status}`);
}

/** Every request fake Workers AI received for `account`, or every one at all. */
export async function workersAiRequests(account?: string): Promise<WorkersAiRequest[]> {
	const all = (await (await control("requests")).json()) as WorkersAiRequest[];
	return account === undefined
		? all
		: all.filter((request) => {
				const metadata = request.metadata as { dittoAccount?: unknown } | null;
				return metadata?.dittoAccount === account;
			});
}
