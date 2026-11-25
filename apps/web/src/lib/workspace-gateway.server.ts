import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { personalWorkspace, workspaceBot } from "../db/workspace-schema.ts";
import { auth } from "./auth.server.ts";
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
			const bot = (await request.json()) as { id: string; name: string };
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

const ADDRESSED = /^\/api\/workspaces\/([a-z0-9-]+)(\/.*)?$/;

/**
 * Answers requests and WebSocket upgrades under `/api/workspaces/<id>`, forwarding each
 * admitted one to the workspace's object at the path after the ID. Leaves other paths alone.
 */
export async function workspaceGateway(request: Request): Promise<Response | undefined> {
	const url = new URL(request.url);
	const addressed = ADDRESSED.exec(url.pathname);
	if (!addressed) return undefined;
	const result = await admitRefreshing(request.headers, addressed[1] ?? "");
	if (result instanceof Response) return result;
	const { admitted, refreshed } = result;

	const rest = addressed[2] ?? "/";
	// The object answers its own computer hooks, behind the same TEST_HOOKS switch.
	if (
		env.TEST_HOOKS === "on" &&
		rest.startsWith("/__test/") &&
		!rest.startsWith("/__test/computer/")
	) {
		return testHook(request, admitted, rest.slice("/__test/".length));
	}
	const forwarded = new Request(new URL(rest + url.search, url.origin), request);
	// Replaces anything the client sent, so only the server-resolved ID reaches the object.
	forwarded.headers.set("x-ditto-workspace-id", admitted.workspaceId);
	const answer = await admitted.workspace.fetch(forwarded);
	const cookies = refreshed.getSetCookie();
	if (answer.status === 101 || cookies.length === 0) return answer;
	const kept = new Response(answer.body, answer);
	for (const cookie of cookies) kept.headers.append("set-cookie", cookie);
	return kept;
}
