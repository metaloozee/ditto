import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { personalWorkspace, workspaceBot } from "../db/workspace-schema.ts";
import type { Member, OpenFaults, OpenedWorkspace } from "../workspace-rpc.ts";

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

/**
 * Opens the account's personal workspace, provisioning it on first use. The caller passes
 * an account ID it resolved from the session, never one from the request. D1 maps the
 * account to its workspace first; the Workspace object then admits the owner and
 * provisions the Chief of Staff. Both steps are idempotent, so an open interrupted between
 * them is completed by the next one.
 */
export async function openPersonalWorkspace(
	accountId: string,
	faults?: OpenFaults,
): Promise<OpenedWorkspace> {
	const workspaceId = await personalWorkspaceId(accountId);
	return env.WORKSPACE.getByName(workspaceId).open(workspaceId, accountId, faults);
}

/** Whether D1 maps the account to this workspace. The account comes from the session. */
export async function ownsWorkspace(accountId: string, workspaceId: string): Promise<boolean> {
	const [mapping] = await drizzle(env.DB)
		.select({ workspaceId: personalWorkspace.workspaceId })
		.from(personalWorkspace)
		.where(
			and(eq(personalWorkspace.userId, accountId), eq(personalWorkspace.workspaceId, workspaceId)),
		);
	return mapping !== undefined;
}

/** The workspace's bot list from the D1 projection, without waking the Workspace object. */
export async function botList(workspaceId: string): Promise<Member[]> {
	return drizzle(env.DB)
		.select({ id: workspaceBot.botId, name: workspaceBot.name })
		.from(workspaceBot)
		.where(eq(workspaceBot.workspaceId, workspaceId))
		.orderBy(workspaceBot.botId);
}
