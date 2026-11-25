import { Container } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";
import { and, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { workspaceBot } from "./db/workspace-schema.ts";
import type { AuthEnv } from "./lib/auth.ts";
import type {
	ChiefOfStaff,
	Member,
	OpenFaults,
	OpenedWorkspace,
	WorkspaceRpc,
} from "./workspace-rpc.ts";

/**
 * One per workspace, owning who may open it, its bot membership (the permanent Chief of Staff
 * so far) and its shared computer.
 */
export class Workspace extends Container<AuthEnv> implements WorkspaceRpc {
	/**
	 * Admits the workspace's owner, claiming it on first open, and provisions the permanent
	 * Chief of Staff once. Then brings the D1 bot list in line with membership; a failed update
	 * leaves the open intact for the next open or a reconcile to repair. Never starts the
	 * shared computer.
	 */
	async open(
		workspaceId: string,
		accountId: string,
		faults: OpenFaults = {},
	): Promise<OpenedWorkspace> {
		const owner = await this.ctx.storage.get<string>("owner");
		if (owner !== undefined && owner !== accountId) return { refused: "not the owner" };
		if (owner === undefined) await this.ctx.storage.put("owner", accountId);
		await this.ctx.storage.put("workspaceId", workspaceId);

		let chiefOfStaff = await this.ctx.storage.get<ChiefOfStaff>("chiefOfStaff");
		if (!chiefOfStaff) {
			chiefOfStaff = { id: `bot-${crypto.randomUUID()}`, name: "Ditto" };
			await this.ctx.storage.put("chiefOfStaff", chiefOfStaff);
		}

		try {
			if (faults.failProjection && this.env.TEST_HOOKS === "on") {
				throw new Error("The test stage failed the bot-list update");
			}
			await this.reconcileBotList();
		} catch (error) {
			console.error("The bot-list projection update failed", error);
		}

		return {
			workspaceId,
			chiefOfStaff,
			computer: this.ctx.container?.running ? "running" : "stopped",
		};
	}

	/** The workspace's bots: the authority the D1 bot list is rebuilt from. */
	async members(): Promise<Member[]> {
		const chiefOfStaff = await this.ctx.storage.get<ChiefOfStaff>("chiefOfStaff");
		return chiefOfStaff ? [chiefOfStaff] : [];
	}

	/**
	 * Rebuilds the workspace's D1 bot list from membership in one batch: removes rows with no
	 * matching member and upserts each member by its stable key, so a replay changes nothing.
	 */
	async reconcileBotList(): Promise<void> {
		const workspaceId = await this.ctx.storage.get<string>("workspaceId");
		if (workspaceId === undefined) return;
		const members = await this.members();
		const db = drizzle(this.env.DB);
		await db.batch([
			db.delete(workspaceBot).where(
				and(
					eq(workspaceBot.workspaceId, workspaceId),
					notInArray(
						workspaceBot.botId,
						members.map((member) => member.id),
					),
				),
			),
			...members.map((member) =>
				db
					.insert(workspaceBot)
					.values({ workspaceId, botId: member.id, name: member.name })
					.onConflictDoUpdate({
						target: [workspaceBot.workspaceId, workspaceBot.botId],
						set: { name: member.name },
					}),
			),
		]);
	}

	/** Test stage only: drops the object from memory, as an eviction would. */
	evict(): void {
		this.ctx.abort("evicted by the test stage");
	}

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
