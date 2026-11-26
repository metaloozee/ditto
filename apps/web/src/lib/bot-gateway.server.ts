import { env } from "cloudflare:workers";

import type { BotRpc } from "../bot-rpc.ts";
import type { Member } from "../workspace-rpc.ts";
import type { Admitted } from "./workspace-gateway.server.ts";

const BOT = /^\/bots\/([a-z0-9-]+)(\/.*)$/;

/** The most an owner's message may hold, so one request can't fill the turn record. */
const MESSAGE_LIMIT = 32_000;

const REFUSED = {
	"no-model": { status: 409, error: "Connect a model in Settings first" },
	busy: { status: 409, error: "A turn is already running" },
} as const;

// A bot outside this workspace and an unknown one answer alike.
const notFound = () => Response.json({ error: "No such bot" }, { status: 404 });

/**
 * Answers `/bots/<botId>/…` under an admitted workspace: a turn (`POST /turns`, an SSE stream),
 * its record (`GET /turns/<turnId>`) and Stop (`POST /stop`). Reaches the bot only once the
 * workspace's membership names it, and gives it the account from the session. Leaves other
 * paths alone.
 */
export async function botRoute(
	request: Request,
	admitted: Admitted,
	rest: string,
): Promise<Response | undefined> {
	const matched = BOT.exec(rest);
	if (!matched) return undefined;
	const [, botId = "", path] = matched;
	const members: Member[] = await admitted.workspace.members();
	if (!members.some((member) => member.id === botId)) return notFound();
	const bot = env.BOT.getByName(botId);
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
		return new Response(started.stream, {
			headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
		});
	}
	const turnId = /^\/turns\/([a-z0-9-]+)$/.exec(path)?.[1];
	if (turnId && method === "GET") {
		const turn: Awaited<ReturnType<BotRpc["turn"]>> = await bot.turn(turnId);
		return turn ? Response.json(turn) : Response.json({ error: "No such turn" }, { status: 404 });
	}
	if (path === "/stop" && method === "POST") {
		const stopped: boolean = await bot.stop();
		return new Response(null, { status: stopped ? 204 : 409 });
	}
	if (env.TEST_HOOKS === "on" && path === "/__test/stored" && method === "GET") {
		return Response.json(await bot.stored());
	}
	return Response.json({ error: "No such route" }, { status: 404 });
}
