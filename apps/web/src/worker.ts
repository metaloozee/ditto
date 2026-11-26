import handler from "@tanstack/react-start/server-entry";

import { modelAccessGateway } from "./lib/model-access-gateway.server.ts";
import { workspaceGateway } from "./lib/workspace-gateway.server.ts";

// The library reaches it through ctx.exports when a Workspace restarts beside a running instance.
export { ContainerProxy } from "@cloudflare/containers";
export { Credentials } from "./credentials.ts";
export { Bot, Workspace } from "./workspace.ts";

export default {
	async fetch(request: Request) {
		// Outside TanStack Start, so WebSocket upgrades reach the object intact.
		return (
			(await workspaceGateway(request)) ??
			(await modelAccessGateway(request)) ??
			handler.fetch(request)
		);
	},
};
