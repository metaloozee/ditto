import { env } from "cloudflare:workers";

import type { BotRpc } from "../bot-rpc.ts";
import type { Member } from "../workspace-rpc.ts";
import type { Pair } from "./model-access.ts";
import type { Admitted } from "./workspace-gateway.server.ts";

const BOT = /^\/bots\/([a-z0-9-]+)(\/.*)$/;
const RESUME = /^\/turns\/([a-z0-9-]+)\/resume$/;

/** The most an owner's message may hold, so one request can't fill the turn record. */
const MESSAGE_LIMIT = 32_000;

const REFUSED = {
	"no-model": { status: 409, error: "Connect a model in Settings first" },
	busy: { status: 409, error: "A turn is already running" },
} as const;

// A bot outside this workspace and an unknown one answer alike.
const notFound = () => Response.json({ error: "No such bot" }, { status: 404 });

/** `sent` as a pair when it names both a connection and a model, never one without the other. */
function completePair(sent: unknown): Pair | undefined {
	if (typeof sent !== "object" || sent === null) return undefined;
	const { connectionId, model } = sent as Record<string, unknown>;
	if (typeof connectionId !== "string" || typeof model !== "string") return undefined;
	return connectionId && model ? { connectionId, model } : undefined;
}

/** The bot `botId` when the admitted workspace's membership names it, or null. */
export async function memberBot(admitted: Admitted, botId: string) {
	const members: Member[] = await admitted.workspace.members();
	return members.some((member) => member.id === botId) ? env.BOT.getByName(botId) : null;
}

/**
 * Answers `/bots/<botId>/…` under an admitted workspace: a turn (`POST /turns`, an SSE stream)
 * or a queued message (202), what still waits (`GET /turns`), Resume on a new pair
 * (`POST /turns/<turnId>/resume`), Stop (`POST /stop`) and the
 * bot's own pair (`GET` and `PUT /model`). Reaches the bot only once the workspace's membership names it, and
 * gives it the account from the session. Leaves other paths alone.
 */
export async function botRoute(
	request: Request,
	admitted: Admitted,
	rest: string,
): Promise<Response | undefined> {
	const matched = BOT.exec(rest);
	if (!matched) return undefined;
	const [, botId = "", path] = matched;
	const bot = await memberBot(admitted, botId);
	if (!bot) return notFound();
	const { method } = request;

	if (path === "/turns" && method === "POST") {
		const sent: unknown = await request.json().catch(() => null);
		const message =
			typeof sent === "object" && sent !== null && "message" in sent ? sent.message : null;
		if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_LIMIT) {
			return Response.json({ error: "Malformed request" }, { status: 400 });
		}
		const started: Awaited<ReturnType<BotRpc["send"]>> = await bot.send(
			admitted.accountId,
			message.trim(),
		);
		if ("refused" in started) {
			const { status, error } = REFUSED[started.refused];
			return Response.json({ error }, { status });
		}
		// Waiting behind an interrupted turn: the message runs once its connection recovers.
		if ("queued" in started) return Response.json({ queued: started.queued }, { status: 202 });
		return new Response(started.stream, {
			headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
		});
	}
	if (path === "/turns" && method === "GET") {
		// `?ids=a,b`: the turns this page shows, besides the unfinished turn and the queue.
		const ids = new URL(request.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
		const pending: Awaited<ReturnType<BotRpc["pending"]>> = await bot.pending(ids);
		return Response.json(pending, { headers: { "cache-control": "no-store" } });
	}
	const resuming = RESUME.exec(path ?? "");
	if (resuming && method === "POST") {
		const sent: unknown = await request.json().catch(() => null);
		const pair = completePair(
			typeof sent === "object" && sent !== null && "pair" in sent ? sent.pair : undefined,
		);
		if (!pair) {
			return Response.json({ error: "Choose a connection and one of its models" }, { status: 400 });
		}
		const answer: Awaited<ReturnType<BotRpc["resumeOn"]>> = await bot.resumeOn(
			admitted.accountId,
			resuming[1] ?? "",
			pair,
		);
		if (answer === "unknown") return Response.json({ error: "No such turn" }, { status: 404 });
		if (answer === "refused") {
			return Response.json({ error: "That model can’t take this turn now" }, { status: 409 });
		}
		return new Response(null, { status: 204 });
	}
	if (path === "/stop" && method === "POST") {
		const stopped: boolean = await bot.stop();
		return new Response(null, { status: stopped ? 204 : 409 });
	}
	if (path === "/model" && method === "GET") {
		const override: Pair | null = await bot.override();
		return Response.json({ override });
	}
	if (path === "/model" && method === "PUT") {
		const sent: unknown = await request.json().catch(() => null);
		const override =
			typeof sent === "object" && sent !== null && "override" in sent ? sent.override : undefined;
		const pair = override === null ? null : completePair(override);
		if (pair === undefined) {
			return Response.json({ error: "Choose a connection and one of its models" }, { status: 400 });
		}
		const chosen: boolean = await bot.chooseOverride(admitted.accountId, pair);
		return chosen
			? new Response(null, { status: 204 })
			: Response.json({ error: "No such connection or model" }, { status: 404 });
	}
	if (env.TEST_HOOKS === "on" && path === "/__test/stored" && method === "GET") {
		return Response.json(await bot.stored());
	}
	if (env.TEST_HOOKS === "on" && path === "/__test/evict" && method === "POST") {
		// The abort rejects the call that caused it.
		await bot.evict().catch(() => undefined);
		return new Response(null, { status: 204 });
	}
	return Response.json({ error: "No such route" }, { status: 404 });
}
