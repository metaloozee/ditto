import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { personalWorkspace } from "../db/workspace-schema.ts";
import type { OpenedWorkspace } from "../workspace-rpc.ts";

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
export async function openPersonalWorkspace(accountId: string): Promise<OpenedWorkspace> {
	const workspaceId = await personalWorkspaceId(accountId);
	return env.WORKSPACE.getByName(workspaceId).open(workspaceId, accountId);
}
