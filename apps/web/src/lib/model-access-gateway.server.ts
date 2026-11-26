import { env } from "cloudflare:workers";

import type { ConnectRefusal, CredentialsRpc } from "../credentials-rpc.ts";
import { auth } from "./auth.server.ts";
import { withCookies } from "./workspace-gateway.server.ts";

const MODELS = /^\/api\/models(\/.*)?$/;

/** What the connect form says beside the key field when the key wasn't stored. */
const REFUSED: Record<ConnectRefusal, { status: number; error: string }> = {
	rejected: { status: 422, error: "OpenCode didn’t accept this key. Check it and paste it again." },
	unavailable: { status: 502, error: "OpenCode isn’t responding. Try again in a moment." },
	"unknown-model": { status: 400, error: "Choose one of the offered models." },
};

const badRequest = () => Response.json({ error: "Malformed request" }, { status: 400 });

async function body(request: Request): Promise<Record<string, unknown> | null> {
	const parsed: unknown = await request.json().catch(() => null);
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

async function route(request: Request, accountId: string, rest: string): Promise<Response> {
	const { method } = request;
	const credentials = env.CREDENTIALS.getByName(accountId);
	if (rest === "/" && method === "GET") return Response.json(await credentials.view());
	if (rest === "/opencode" && method === "POST") {
		const sent = await body(request);
		const key = typeof sent?.key === "string" ? sent.key.trim() : "";
		if (!key || typeof sent?.model !== "string") return badRequest();
		const result: Awaited<ReturnType<CredentialsRpc["connectOpenCode"]>> =
			await credentials.connectOpenCode(accountId, key, sent.model);
		if ("refused" in result) {
			const { status, error } = REFUSED[result.refused];
			return Response.json({ error }, { status });
		}
		return new Response(null, { status: 204 });
	}
	if (rest === "/default" && method === "PUT") {
		const sent = await body(request);
		if (typeof sent?.connectionId !== "string" || typeof sent.model !== "string") {
			return badRequest();
		}
		const chosen = await credentials.chooseDefault({
			connectionId: sent.connectionId,
			model: sent.model,
		});
		return chosen
			? new Response(null, { status: 204 })
			: Response.json({ error: "No such connection or model" }, { status: 404 });
	}
	if (env.TEST_HOOKS === "on" && rest === "/__test/stored" && method === "GET") {
		return Response.json(await credentials.stored());
	}
	if (env.TEST_HOOKS === "on" && rest === "/__test/included" && method === "PUT") {
		const sent = await body(request);
		if (typeof sent?.offered !== "boolean") return badRequest();
		await credentials.offerIncluded(sent.offered);
		return new Response(null, { status: 204 });
	}
	return Response.json({ error: "No such route" }, { status: 404 });
}

/**
 * Answers every request under `/api/models`, the signed-in account's model access. Resolves
 * the account from the session before anything else and reaches only that account's
 * Credentials object, so no request can name another account. Leaves other paths alone.
 */
export async function modelAccessGateway(request: Request): Promise<Response | undefined> {
	const matched = MODELS.exec(new URL(request.url).pathname);
	if (!matched) return undefined;
	const { response: session, headers: refreshed } = await auth.api.getSession({
		headers: request.headers,
		returnHeaders: true,
	});
	if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
	return withCookies(await route(request, session.user.id, matched[1] ?? "/"), refreshed);
}
