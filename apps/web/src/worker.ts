import handler from "@tanstack/react-start/server-entry";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { workspaceBot } from "./db/workspace-schema.ts";
import type { Workspace } from "./workspace.ts";

// The library reaches it through ctx.exports when a Workspace restarts beside a running instance.
export { ContainerProxy } from "@cloudflare/containers";
export { Bot, Credentials, Workspace } from "./workspace.ts";

/** The bindings this file reads; alchemy.run.ts declares them all. */
interface WorkerEnv {
	WORKSPACE: DurableObjectNamespace<Workspace>;
	DB: D1Database;
	TEST_HOOKS?: string;
}

/** Test stage only: damages a workspace's D1 bot list, as a failed or stray write would. */
async function testBotList(request: Request, env: WorkerEnv, workspaceId: string) {
	const db = drizzle(env.DB);
	if (request.method === "DELETE") {
		await db.delete(workspaceBot).where(eq(workspaceBot.workspaceId, workspaceId));
	} else if (request.method === "POST") {
		const bot = (await request.json()) as { id: string; name: string };
		await db.insert(workspaceBot).values({ workspaceId, botId: bot.id, name: bot.name });
	} else {
		return new Response(null, { status: 405 });
	}
	return new Response(null, { status: 204 });
}

/** Test stage only: nothing unauthenticated reaches an object anywhere else. */
async function testRoute(request: Request, env: WorkerEnv): Promise<Response | undefined> {
	const url = new URL(request.url);
	const probe = /^\/__test\/workspace(?:\/([a-z0-9-]+))?$/.exec(url.pathname);
	if (probe) return env.WORKSPACE.getByName(probe[1] ?? "probe").fetch(request);
	const membersOf = /^\/__test\/workspace\/([a-z0-9-]+)\/members$/.exec(url.pathname)?.[1];
	if (membersOf) return Response.json(await env.WORKSPACE.getByName(membersOf).members());
	const projected = /^\/__test\/workspace\/([a-z0-9-]+)\/bot-list$/.exec(url.pathname)?.[1];
	if (projected) return testBotList(request, env, projected);
	const toEvict = /^\/__test\/workspace\/([a-z0-9-]+)\/evict$/.exec(url.pathname)?.[1];
	if (toEvict && request.method === "POST") {
		// The abort rejects the call that caused it.
		await env.WORKSPACE.getByName(toEvict)
			.evict()
			.catch(() => undefined);
		return new Response(null, { status: 204 });
	}
	return undefined;
}

export default {
	async fetch(request: Request, env: WorkerEnv) {
		const testResponse = env.TEST_HOOKS === "on" ? await testRoute(request, env) : undefined;
		return testResponse ?? handler.fetch(request);
	},
};
