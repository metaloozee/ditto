import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { personalWorkspace, workspaceBot } from "../db/workspace-schema.ts";
import type { Member } from "../workspace-rpc.ts";
import { auth } from "./auth.server.ts";
import { botRoute } from "./bot-gateway.server.ts";
import { noSuchFile, serveFile } from "./workspace-files.server.ts";
import { requestedFileKey } from "./workspace-files.ts";

/**
 * The ID of the account's personal workspace, recorded in D1 on first use. Racing first
 * calls insert different IDs; the account's primary key keeps one, so every call agrees.
 */
export async function personalWorkspaceId(accountId: string): Promise<string> {
	const db = drizzle(env.DB);
	await db
		.insert(personalWorkspace)
		.values({ userId: accountId, workspaceId: `ws-${crypto.randomUUID()}` })
		.onConflictDoNothing();
	const [mapping] = await db
		.select({ workspaceId: personalWorkspace.workspaceId })
		.from(personalWorkspace)
		.where(eq(personalWorkspace.userId, accountId));
	if (!mapping) throw new Error("The personal workspace mapping vanished");
	return mapping.workspaceId;
}

/** A request the gateway let through, with every identity resolved on the server. */
export interface Admitted {
	accountId: string;
	workspaceId: string;
	workspace: ReturnType<typeof env.WORKSPACE.getByName>;
}

// Another account's workspace and an unknown one answer alike, so IDs can't be probed.
const notFound = () => Response.json({ error: "No such workspace" }, { status: 404 });

/**
 * The only way to a Workspace object. Resolves the Ditto account from the session, refuses
 * an upgrade from another origin, checks in D1 that the account owns `workspaceId` (`null`
 * for its personal workspace, provisioned on first use) and derives the object from that
 * row. Answers a refusal before any object is reached.
 */
export async function admit(
	headers: Headers,
	workspaceId: string | null,
): Promise<Admitted | Response> {
	const admitted = await admitRefreshing(headers, workspaceId);
	return admitted instanceof Response ? admitted : admitted.admitted;
}

/** `admit`, also returning the session refresh's cookies for a caller outside TanStack Start. */
async function admitRefreshing(
	headers: Headers,
	workspaceId: string | null,
): Promise<{ admitted: Admitted; refreshed: Headers } | Response> {
	const upgrading = headers.get("upgrade")?.toLowerCase() === "websocket";
	if (upgrading && headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin) {
		return Response.json({ error: "Cross-origin upgrade refused" }, { status: 403 });
	}
	const { response: session, headers: refreshed } = await auth.api.getSession({
		headers,
		returnHeaders: true,
	});
	if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
	const accountId = session.user.id;

	let owned: string | undefined;
	if (workspaceId === null) {
		owned = await personalWorkspaceId(accountId);
	} else {
		const [row] = await drizzle(env.DB)
			.select({ workspaceId: personalWorkspace.workspaceId })
			.from(personalWorkspace)
			.where(
				and(
					eq(personalWorkspace.userId, accountId),
					eq(personalWorkspace.workspaceId, workspaceId),
				),
			);
		owned = row?.workspaceId;
	}
	if (owned === undefined) return notFound();
	return {
		admitted: { accountId, workspaceId: owned, workspace: env.WORKSPACE.getByName(owned) },
		refreshed,
	};
}

/** Test stage only: owner-only hooks that evict the object, read and damage its state, or seed its files. */
async function testHook(request: Request, admitted: Admitted, hook: string): Promise<Response> {
	const { method } = request;
	if (hook === "evict" && method === "POST") {
		// The abort rejects the call that caused it.
		await admitted.workspace.evict().catch(() => undefined);
		return new Response(null, { status: 204 });
	}
	if (hook === "members" && method === "GET") {
		return Response.json(await admitted.workspace.members());
	}
	if (hook === "bot-list" && (method === "POST" || method === "DELETE")) {
		// Writes the D1 bot list behind the object's back, as a failed or stray write would.
		const db = drizzle(env.DB);
		const { workspaceId } = admitted;
		if (method === "DELETE") {
			await db.delete(workspaceBot).where(eq(workspaceBot.workspaceId, workspaceId));
		} else {
			const bot = (await request.json()) as Member;
			await db.insert(workspaceBot).values({ workspaceId, botId: bot.id, name: bot.name });
		}
		return new Response(null, { status: 204 });
	}
	if (hook.startsWith("files/") && method === "PUT") {
		// Seeds the owner's own file, as #20 and #21 will publish one.
		const key = requestedFileKey(admitted.workspaceId, hook.slice("files/".length));
		if (key === null) return Response.json({ error: "Unsafe file key" }, { status: 400 });
		await env.FILES.put(key, await request.arrayBuffer(), {
			httpMetadata: { contentType: request.headers.get("content-type") ?? undefined },
		});
		return new Response(null, { status: 204 });
	}
	return Response.json({ error: "No such test hook" }, { status: 404 });
}

/** Opens the personal workspace, with the test stage's interrupt and fault hooks. */
async function openRoute(request: Request): Promise<Response> {
	const { headers } = request;
	const result = await admitRefreshing(headers, null);
	if (result instanceof Response) return result;
	const { admitted, refreshed } = result;
	if (env.TEST_HOOKS === "on" && headers.get("x-test-interrupt") === "after-mapping") {
		// Stops after the D1 mapping, before the object is reached.
		const interrupted = Response.json({ interrupted: admitted.workspaceId }, { status: 503 });
		return withCookies(interrupted, refreshed);
	}
	const failProjection = env.TEST_HOOKS === "on" && headers.get("x-test-fault") === "projection";
	const opened = await admitted.workspace.open(admitted.workspaceId, admitted.accountId, {
		failProjection,
	});
	const answer =
		"refused" in opened
			? Response.json({ error: opened.refused }, { status: 403 })
			: Response.json(opened);
	return withCookies(answer, refreshed);
}

/** Carries the session refresh's cookies on an answer, except a WebSocket upgrade. */
export function withCookies(answer: Response, refreshed: Headers): Response {
	const cookies = refreshed.getSetCookie();
	if (answer.status === 101 || cookies.length === 0) return answer;
	const kept = new Response(answer.body, answer);
	for (const cookie of cookies) kept.headers.append("set-cookie", cookie);
	return kept;
}

/** Calls a Durable Object's `GET /` and checks it answers as the class it should be. */
async function answersAs(stub: { fetch(request: Request): Promise<Response> }, className: string) {
	const response = await stub.fetch(new Request("http://object/"));
	const answer = (await response.json()) as { object?: unknown };
	return answer.object === className;
}

/**
 * Whether each named binding resolves in this deployment, touched as the owner's own requests
 * would touch it. Never starts the computer, and reports the cookie key only as present.
 */
async function bindings(admitted: Admitted) {
	const probes = {
		DB: async () => (await env.DB.prepare("select 1 as one").first("one")) === 1,
		WORKSPACE: () => answersAs(admitted.workspace, "Workspace"),
		BOT: () => answersAs(env.BOT.getByName(admitted.workspaceId), "Bot"),
		CREDENTIALS: () => answersAs(env.CREDENTIALS.getByName(admitted.accountId), "Credentials"),
		FILES: async () => {
			// A missing key answers null; only a missing or broken bucket throws.
			await env.FILES.head(`${admitted.workspaceId}/`);
			return true;
		},
		COOKIE_ENCRYPTION_KEY: async () =>
			typeof env.COOKIE_ENCRYPTION_KEY === "string" && env.COOKIE_ENCRYPTION_KEY.length > 0,
	};
	const results = await Promise.all(
		Object.entries(probes).map(async ([name, probe]) => {
			const resolved = await probe().catch(() => false);
			return [name, resolved ? "resolved" : "missing"] as const;
		}),
	);
	return Object.fromEntries(results);
}

/** Answers an admitted request in the Worker, or forwards it to the workspace's object. */
async function route(request: Request, admitted: Admitted, rest: string): Promise<Response> {
	const { method } = request;
	// The object answers its own computer hooks, behind the same TEST_HOOKS switch.
	if (
		env.TEST_HOOKS === "on" &&
		rest.startsWith("/__test/") &&
		!rest.startsWith("/__test/computer/")
	) {
		return testHook(request, admitted, rest.slice("/__test/".length));
	}
	// Read from the D1 projection, so listing bots never wakes the object.
	if (rest === "/bots" && method === "GET") {
		const bots = await drizzle(env.DB)
			.select({ id: workspaceBot.botId, name: workspaceBot.name })
			.from(workspaceBot)
			.where(eq(workspaceBot.workspaceId, admitted.workspaceId))
			.orderBy(workspaceBot.botId);
		return Response.json({ bots });
	}
	if (rest === "/reconcile" && method === "POST") {
		await admitted.workspace.reconcileBotList();
		return new Response(null, { status: 204 });
	}
	if (rest.startsWith(FILES) && method === "GET") {
		return serveFile(admitted.workspaceId, rest.slice(FILES.length));
	}
	if (rest === "/bindings" && method === "GET") return Response.json(await bindings(admitted));
	const toBot = await botRoute(request, admitted, rest);
	if (toBot) return toBot;
	const url = new URL(request.url);
	const forwarded = new Request(new URL(rest + url.search, url.origin), request);
	// Replaces anything the client sent, so only the server-resolved ID reaches the object.
	forwarded.headers.set("x-ditto-workspace-id", admitted.workspaceId);
	return admitted.workspace.fetch(forwarded);
}

const OPEN = "/api/workspaces/open";
const ADDRESSED = /^\/api\/workspaces\/([a-z0-9-]+)(\/.*)?$/;
const FILES = "/files/";

/**
 * Answers `POST /api/workspaces/open` and every request or WebSocket upgrade under
 * `/api/workspaces/<id>`, admitting each before it reaches anything of the workspace's.
 * Leaves other paths alone.
 */
export async function workspaceGateway(request: Request): Promise<Response | undefined> {
	const { pathname } = new URL(request.url);
	if (pathname === OPEN && request.method === "POST") return openRoute(request);
	const addressed = ADDRESSED.exec(pathname);
	if (!addressed) return undefined;
	const rest = addressed[2] ?? "/";
	const result = await admitRefreshing(request.headers, addressed[1] ?? "");
	if (result instanceof Response) {
		// Another account's file and a missing one answer alike, so keys can't be probed.
		return result.status === 404 && rest.startsWith(FILES) ? noSuchFile() : result;
	}
	return withCookies(await route(request, result.admitted, rest), result.refreshed);
}
