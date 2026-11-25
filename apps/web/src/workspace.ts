import { Container } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";

import type { ChiefOfStaff, OpenedWorkspace, WorkspaceRpc } from "./workspace-rpc.ts";

/** One per workspace, owning who may open it, its Chief of Staff and its shared computer. */
export class Workspace extends Container implements WorkspaceRpc {
	/**
	 * Admits the workspace's owner, claiming it on first open, and provisions the permanent
	 * Chief of Staff once. Never starts the shared computer.
	 */
	async open(workspaceId: string, accountId: string): Promise<OpenedWorkspace> {
		const owner = await this.ctx.storage.get<string>("owner");
		if (owner !== undefined && owner !== accountId) return { refused: "not the owner" };
		if (owner === undefined) await this.ctx.storage.put("owner", accountId);

		let chiefOfStaff = await this.ctx.storage.get<ChiefOfStaff>("chiefOfStaff");
		if (!chiefOfStaff) {
			chiefOfStaff = { id: `bot-${crypto.randomUUID()}`, name: "Ditto" };
			await this.ctx.storage.put("chiefOfStaff", chiefOfStaff);
		}
		return {
			workspaceId,
			chiefOfStaff,
			computer: this.ctx.container?.running ? "running" : "stopped",
		};
	}

	/** Test stage only: drops the object from memory, as an eviction would. */
	evict(): void {
		this.ctx.abort("evicted by the test stage");
	}

	/** Requests answered since the object woke, so tests can see that refusals never arrive. */
	#requests = 0;

	override async fetch(request: Request): Promise<Response> {
		this.#requests++;
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const { 0: client, 1: server } = new WebSocketPair();
			server.accept();
			server.addEventListener("message", (event) => server.send(event.data));
			return new Response(null, { status: 101, webSocket: client });
		}
		return Response.json({
			object: "Workspace",
			container: this.ctx.container !== undefined,
			running: this.ctx.container?.running ?? false,
			requests: this.#requests,
		});
	}
}

export class Bot extends DurableObject {
	override fetch(): Response {
		return Response.json({ object: "Bot" });
	}
}

/** One per account, holding its model connections. */
export class Credentials extends DurableObject {
	override fetch(): Response {
		return Response.json({ object: "Credentials" });
	}
}
