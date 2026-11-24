import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { personalWorkspace } from "../db/workspace-schema.ts";
import { auth } from "./auth.server.ts";

/**
 * Opens the caller's personal workspace, provisioning it on first use. Identities come only
 * from the session. D1 maps the account to its workspace first; the Workspace object then
 * admits the owner and provisions the Chief of Staff. Both steps are idempotent, so an open
 * interrupted between them is completed by the next one.
 */
export async function openPersonalWorkspace(request: Request): Promise<Response> {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
	const accountId = session.user.id;

	const db = drizzle(env.DB);
	// Racing first opens insert different IDs; the account's primary key keeps one.
	await db
		.insert(personalWorkspace)
		.values({ userId: accountId, workspaceId: `ws-${crypto.randomUUID()}` })
		.onConflictDoNothing();
	const [mapping] = await db
		.select({ workspaceId: personalWorkspace.workspaceId })
		.from(personalWorkspace)
		.where(eq(personalWorkspace.userId, accountId));
	if (!mapping) throw new Error("The personal workspace mapping vanished");

	if (env.TEST_HOOKS === "on" && request.headers.get("x-test-interrupt") === "after-mapping") {
		return Response.json({ interrupted: mapping.workspaceId }, { status: 503 });
	}

	const opened = await env.WORKSPACE.getByName(mapping.workspaceId).open(
		mapping.workspaceId,
		accountId,
	);
	if ("refused" in opened) return Response.json({ error: opened.refused }, { status: 403 });
	return Response.json(opened);
}
