import handler from "@tanstack/react-start/server-entry";

import { workspaceGateway } from "./lib/workspace-gateway.server.ts";

// The library reaches it through ctx.exports when a Workspace restarts beside a running instance.
export { ContainerProxy } from "@cloudflare/containers";
export { Bot, Credentials, Workspace } from "./workspace.ts";

export default {
	async fetch(request: Request) {
		// Outside TanStack Start, so WebSocket upgrades reach the object intact.
		return (await workspaceGateway(request)) ?? handler.fetch(request);
	},
};
