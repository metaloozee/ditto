import type { TurnEvent, TurnStatus } from "#/bot-rpc.ts";

const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

/**
 * Sends `message` to the bot and calls `onDelta` with each piece of the reply as it streams
 * in. Settles with how the turn ended: "refused" when it never started.
 */
export async function sendTurn(
	workspaceId: string,
	botId: string,
	message: string,
	onDelta: (text: string) => void,
): Promise<Exclude<TurnStatus, "running"> | "refused"> {
	const response = await fetch(`${botPath(workspaceId, botId)}/turns`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message }),
	}).catch(() => null);
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
