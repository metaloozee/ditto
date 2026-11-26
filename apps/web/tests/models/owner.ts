import type { BrowserContext, BrowserContextOptions } from "playwright";
import { expect } from "vite-plus/test";

import type { GitHubIdentity } from "../auth/fake-upstream.ts";
import { continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";

/**
 * A test-stage session lapses after a few idle seconds, so the auth tests can watch it expire.
 * These tests aren't about that, so an owner's session is refreshed every two seconds.
 */
function keepSignedIn(context: BrowserContext) {
	const refresh = setInterval(() => {
		context.request.get("/api/auth/get-session").catch(() => {});
	}, 2000);
	refresh.unref();
	context.on("close", () => clearInterval(refresh));
}

/**
 * A signed-in owner, as `user` on a browser with `options`, who has opened their personal
 * workspace: their account ID, the workspace and its Chief of Staff's ID.
 */
export async function owner({
	user = gitHubUser(),
	...options
}: BrowserContextOptions & { user?: GitHubIdentity } = {}) {
	const visitor = await newVisitor(options);
	await continueWithGitHub(visitor.page, user);
	keepSignedIn(visitor.context);
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId, chiefOfStaff } = (await opened.json()) as {
		workspaceId: string;
		chiefOfStaff: { id: string };
	};
	const session = await visitor.context.request.get("/api/auth/get-session");
	const { user: account } = (await session.json()) as { user: { id: string } };
	return { ...visitor, user, accountId: account.id, workspaceId, botId: chiefOfStaff.id };
}

/** Adds a bot to the workspace's membership, standing in for specialist creation. */
export async function addSpecialist(context: BrowserContext, workspaceId: string) {
	const id = `bot-${crypto.randomUUID()}`;
	const added = await context.request.post(`/api/workspaces/${workspaceId}/__test/members`, {
		data: { id, name: "Researcher" },
	});
	expect(added.status()).toBe(204);
	return id;
}
