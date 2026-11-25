import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { workspaceBot } from "../db/workspace-schema.ts";
import type { Member, OpenFaults, OpenedWorkspace } from "../workspace-rpc.ts";
import { admit } from "./workspace-gateway.server.ts";

/**
 * Opens the signed-in account's personal workspace, provisioning it on first use, or
 * answers the gateway's refusal. D1 maps the account to its workspace first; the Workspace
 * object then admits the owner and provisions the Chief of Staff. Both steps are
 * idempotent, so an open interrupted between them is completed by the next one.
 */
export async function openPersonalWorkspace(
	headers: Headers,
	faults?: OpenFaults,
): Promise<OpenedWorkspace | Response> {
	const admitted = await admit(headers, null);
	if (admitted instanceof Response) return admitted;
	return admitted.workspace.open(admitted.workspaceId, admitted.accountId, faults);
}

/** The workspace's bot list from the D1 projection, without waking the Workspace object. */
export async function botList(workspaceId: string): Promise<Member[]> {
	return drizzle(env.DB)
		.select({ id: workspaceBot.botId, name: workspaceBot.name })
		.from(workspaceBot)
		.where(eq(workspaceBot.workspaceId, workspaceId))
		.orderBy(workspaceBot.botId);
}
