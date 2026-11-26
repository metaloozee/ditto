import type { Turn, TurnEvent } from "#/bot-rpc.ts";

const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

/** How a turn's stream ended, or "refused" when it never started. */
export type TurnEnd = Omit<Extract<TurnEvent, { type: "end" }>, "type"> | { status: "refused" };

/**
 * Sends `message` to the bot and calls `onDelta` with each piece of the reply as it streams
 * in, and `onStart` once the bot names the turn. Settles with how the turn's stream ended.
 */
export async function sendTurn(
	workspaceId: string,
	botId: string,
	message: string,
	onDelta: (text: string) => void,
	onStart?: (start: Extract<TurnEvent, { type: "start" }>) => void,
): Promise<TurnEnd> {
	const response = await fetch(`${botPath(workspaceId, botId)}/turns`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message }),
	}).catch(() => null);
	if (!response?.ok || !response.body) return { status: "refused" };

	const lines = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffered = "";
	try {
		for (;;) {
			const { done, value } = await lines.read();
			if (done) return { status: "failed" };
			buffered += value;
			const events = buffered.split("\n\n");
			buffered = events.pop() ?? "";
			for (const raw of events) {
				if (!raw.startsWith("data: ")) continue;
				const event = JSON.parse(raw.slice("data: ".length)) as TurnEvent;
				if (event.type === "start") onStart?.(event);
				if (event.type === "delta") onDelta(event.text);
				if (event.type === "end") {
					const { type: _, ...end } = event;
					return end;
				}
			}
		}
	} catch {
		return { status: "failed" };
	}
}

/** Asks the bot to stop its running turn; the turn's stream then ends as "stopped". */
export async function stopTurn(workspaceId: string, botId: string): Promise<void> {
	await fetch(`${botPath(workspaceId, botId)}/stop`, { method: "POST" }).catch(() => null);
}

/** The turn as the bot records it now, or null when it can't be read. */
export async function readTurn(
	workspaceId: string,
	botId: string,
	turnId: string,
): Promise<Turn | null> {
	const response = await fetch(`${botPath(workspaceId, botId)}/turns/${turnId}`).catch(() => null);
	return response?.ok ? ((await response.json()) as Turn) : null;
}
