import type { Pending, TurnEvent, TurnStatus } from "#/bot-rpc.ts";

import type { Pair } from "./model-access.ts";

const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

/**
 * Sends `message` to the bot and calls `onDelta` with each piece of the reply as it streams
 * in. Settles with how the turn ended: "refused" when it never started, "queued" when it
 * waits behind an interrupted turn. `onStart` gets the turn's ID, which a queued message's
 * turn takes too.
 */
export async function sendTurn(
	workspaceId: string,
	botId: string,
	message: string,
	onDelta: (text: string) => void,
	onStart?: (turnId: string) => void,
): Promise<Exclude<TurnStatus, "running"> | "refused" | "queued"> {
	const response = await fetch(`${botPath(workspaceId, botId)}/turns`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message }),
	}).catch(() => null);
	if (response?.status === 202) {
		const { queued } = (await response.json()) as { queued: string };
		onStart?.(queued);
		return "queued";
	}
	if (!response?.ok || !response.body) return "refused";

	const lines = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffered = "";
	try {
		for (;;) {
			const { done, value } = await lines.read();
			if (done) return "failed";
			buffered += value;
			const events = buffered.split("\n\n");
			buffered = events.pop() ?? "";
			for (const raw of events) {
				if (!raw.startsWith("data: ")) continue;
				const event = JSON.parse(raw.slice("data: ".length)) as TurnEvent;
				if (event.type === "start") onStart?.(event.turnId);
				if (event.type === "delta") onDelta(event.text);
				if (event.type === "end") return event.status;
			}
		}
	} catch {
		return "failed";
	}
}

/** Asks the bot to stop its running turn; the turn's stream then ends as "stopped". */
export async function stopTurn(workspaceId: string, botId: string): Promise<void> {
	await fetch(`${botPath(workspaceId, botId)}/stop`, { method: "POST" }).catch(() => null);
}

/** Moves the interrupted turn onto `pair` and resumes it there. Resolves to why not, or undefined. */
export async function resumeTurn(
	workspaceId: string,
	botId: string,
	turnId: string,
	pair: Pair,
): Promise<string | undefined> {
	const response = await fetch(`${botPath(workspaceId, botId)}/turns/${turnId}/resume`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ pair }),
	}).catch(() => null);
	if (response?.ok) return undefined;
	const refused = (await response?.json().catch(() => null)) as { error?: string } | null;
	return refused?.error ?? "Ditto couldn’t be reached";
}

/** The turns named by `ids`, with the bot's unfinished turn and queue. Null when unreachable. */
export async function pendingTurns(
	workspaceId: string,
	botId: string,
	ids: string[],
): Promise<Pending | null> {
	const query = ids.length ? `?ids=${ids.join(",")}` : "";
	const response = await fetch(`${botPath(workspaceId, botId)}/turns${query}`, {
		cache: "no-store",
	}).catch(() => null);
	return response?.ok ? ((await response.json()) as Pending) : null;
}
