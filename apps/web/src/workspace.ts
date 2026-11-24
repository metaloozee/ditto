import { Container } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";

/** One per workspace, owning its shared computer. */
export class Workspace extends Container {
	override async fetch(request: Request): Promise<Response> {
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
