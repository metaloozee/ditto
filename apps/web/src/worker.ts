import handler from "@tanstack/react-start/server-entry";

import type { Workspace } from "./workspace.ts";

// The library reaches it through ctx.exports when a Workspace restarts beside a running instance.
export { ContainerProxy } from "@cloudflare/containers";
export { Bot, Credentials, Workspace } from "./workspace.ts";

/** The bindings this file reads; alchemy.run.ts declares them all. */
interface WorkerEnv {
	WORKSPACE: DurableObjectNamespace<Workspace>;
	TEST_HOOKS?: string;
}

/** Test stage only: nothing unauthenticated reaches an object anywhere else. */
async function testRoute(request: Request, env: WorkerEnv): Promise<Response | undefined> {
	const url = new URL(request.url);
	const probe = /^\/__test\/workspace(?:\/([a-z0-9-]+))?$/.exec(url.pathname);
	if (probe) return env.WORKSPACE.getByName(probe[1] ?? "probe").fetch(request);
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
