import { redirect } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import type { ConnectRefusal, CredentialsRpc } from "../credentials-rpc.ts";
import { auth } from "./auth.server.ts";
import { withCookies } from "./workspace-gateway.server.ts";

const MODELS = /^\/api\/models(\/.*)?$/;
/** A connection's own path, `/<connectionId>`, such as `/opencode`. */
const CONNECTION = /^\/(opencode|chatgpt)$/;

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
	if (rest === "/chatgpt" && method === "POST") {
		const sent = await body(request);
		const imported: Awaited<ReturnType<CredentialsRpc["importChatGPT"]>> =
			await credentials.importChatGPT(accountId, sent?.credential);
		if (imported === "not-offered") {
			return Response.json(
				{ error: "This deployment doesn’t offer the ChatGPT plan" },
				{ status: 403 },
			);
		}
		return imported === "imported"
			? new Response(null, { status: 204 })
			: Response.json(
					{
						error:
							"Expected a Sign in with ChatGPT credential with its client ID and plan-usage scope",
					},
					{ status: 400 },
				);
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
	const disconnecting = CONNECTION.exec(rest);
	if (disconnecting && method === "DELETE") {
		const disconnected = await credentials.disconnect(disconnecting[1] ?? "");
		return disconnected
			? new Response(null, { status: 204 })
			: Response.json({ error: "No such connection" }, { status: 404 });
	}
	const checked = /^\/([a-z]+)\/check$/.exec(rest)?.[1];
	if (checked && method === "POST") {
		const state: Awaited<ReturnType<CredentialsRpc["check"]>> = await credentials.check(
			accountId,
			checked,
		);
		return state
			? Response.json({ state })
			: Response.json({ error: "No such connection" }, { status: 404 });
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
	if (env.TEST_HOOKS === "on" && rest === "/__test/evict-after-rotation" && method === "POST") {
		await credentials.evictAfterRotation();
		return new Response(null, { status: 204 });
	}
	if (env.TEST_HOOKS === "on" && rest === "/__test/deployment" && method === "PUT") {
		const sent = await body(request);
		const optional = (value: unknown) => value === undefined || typeof value === "string";
		if (
			(sent?.mode !== "self-deployed" && sent?.mode !== "hosted") ||
			!optional(sent.license) ||
			!optional(sent.approval)
		) {
			return badRequest();
		}
		await credentials.deployAs({
			mode: sent.mode,
			license: sent.license as string | undefined,
			approval: sent.approval as string | undefined,
		});
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

/** The signed-in account's Credentials object, for a server function; a visitor is sent to sign in. */
export async function signedInCredentials(headers: Headers) {
	const session = await auth.api.getSession({ headers });
	if (!session) throw redirect({ to: "/sign-in" });
	return env.CREDENTIALS.getByName(session.user.id);
}
