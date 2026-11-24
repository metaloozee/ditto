import handler from "@tanstack/react-start/server-entry";

import type { AuthEnv } from "./lib/auth.ts";

// The library reaches it through ctx.exports when a Workspace restarts beside a running instance.
export { ContainerProxy } from "@cloudflare/containers";
export { Bot, Credentials, Workspace } from "./workspace.ts";

export default {
	fetch(request: Request, env: AuthEnv) {
		// Test stage only: nothing unauthenticated reaches an object anywhere else.
		if (env.WORKSPACE_PROBE === "on" && new URL(request.url).pathname === "/__test/workspace") {
			return env.WORKSPACE.getByName("probe").fetch(request);
		}
		return handler.fetch(request);
	},
};
