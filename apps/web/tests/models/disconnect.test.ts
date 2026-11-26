import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { clickSignOut, continueWithGitHub, newVisitor, open } from "../auth/visitor.ts";
import { limitOpenCode, openCodeRequests } from "./opencode.ts";
import { botStored, connectKey, modelAccess, owner, post, stored, view } from "./owner.ts";

/** Presses Disconnect on the OpenCode row in Settings and confirms it. */
async function disconnectInSettings(page: Page) {
	await open(page, "/settings");
	await modelAccess(page).getByRole("button", { name: "Disconnect OpenCode" }).click();
	const confirm = page.getByRole("dialog", { name: "Disconnect OpenCode?" });
	await confirm.getByRole("button", { name: "Disconnect", exact: true }).click();
	await confirm.waitFor({ state: "hidden" });
}

const disconnect = (context: BrowserContext) => context.request.delete("/api/models/opencode");

/** The providers the account signs in with. */
async function methods(context: BrowserContext) {
	const response = await context.request.get("/api/auth/list-accounts");
	expect(response.status()).toBe(200);
	const accounts = (await response.json()) as { providerId: string }[];
	return accounts.map((account) => account.providerId).sort();
}

const markerOf = (key: string) => key.slice("sk-oc-MARKER-".length);
const NOTHING = { connections: [], defaultPair: null };

describe("disconnecting OpenCode in Settings", () => {
	it("asks first, then shows no connection and forgets the stored key", async () => {
		const { page, context } = await owner();
		const key = await connectKey(context);

		await disconnectInSettings(page);
		await modelAccess(page).getByRole("button", { name: "Connect an OpenCode API key" }).waitFor();
		await expect(
			modelAccess(page).getByRole("button", { name: "Disconnect OpenCode" }).count(),
		).resolves.toBe(0);

		await expect(view(context)).resolves.toEqual(NOTHING);
		const atRest = await stored(context);
		expect(atRest).not.toContain("connection:opencode");
		expect(atRest).not.toContain(markerOf(key));

		await open(page, "/settings");
		await modelAccess(page).getByRole("button", { name: "Connect an OpenCode API key" }).waitFor();
	});

	it("keeps the connection when the owner cancels", async () => {
		const { page, context } = await owner();
		await connectKey(context);

		await open(page, "/settings");
		await modelAccess(page).getByRole("button", { name: "Disconnect OpenCode" }).click();
		const confirm = page.getByRole("dialog", { name: "Disconnect OpenCode?" });
		await confirm.getByRole("button", { name: "Cancel" }).click();
		await confirm.waitFor({ state: "hidden" });

		await expect(view(context)).resolves.toMatchObject({
			connections: [{ id: "opencode", state: "Connected" }],
		});
	});
});

describe("after a disconnect", () => {
	it("refuses a turn without calling the upstream", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		expect((await post(context, workspaceId, botId, "Before")).status).toBe(200);
		const before = await openCodeRequests(key);
		expect(before).toHaveLength(2);

		expect((await disconnect(context)).status()).toBe(204);
		const refused = await post(context, workspaceId, botId, "After");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });
		await expect(openCodeRequests(key)).resolves.toEqual(before);
	});

	it("refuses a turn behind one the connection interrupted, which stays interrupted", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await limitOpenCode(key);
		const interrupted = await post(context, workspaceId, botId, "Draft the brief.");
		expect(interrupted.body).toContain('"status":"interrupted"');
		expect((await post(context, workspaceId, botId, "Then the summary.")).status).toBe(202);

		expect((await disconnect(context)).status()).toBe(204);
		const before = await openCodeRequests(key);
		const refused = await post(context, workspaceId, botId, "After");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });

		const atBot = () => botStored(context, workspaceId, botId);
		await expect.poll(async () => (await atBot()).unfinished).toBeUndefined();
		expect(Object.values(await atBot())).toContainEqual(
			expect.objectContaining({ message: "Draft the brief.", status: "interrupted" }),
		);
		// Nothing probes the forgotten key either.
		await new Promise((resolve) => setTimeout(resolve, 2500));
		await expect(openCodeRequests(key)).resolves.toEqual(before);
	});

	it("refuses a bot's override on that connection rather than moving it", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		const pinned = await context.request.put(`/api/workspaces/${workspaceId}/bots/${botId}/model`, {
			data: { override: { connectionId: "opencode", model: "glm-5.3-flash" } },
		});
		expect(pinned.status()).toBe(204);
		const before = await openCodeRequests();

		expect((await disconnect(context)).status()).toBe(204);
		const refused = await post(context, workspaceId, botId, "Still on my model?");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });
		await expect(openCodeRequests()).resolves.toEqual(before);
		await expect(openCodeRequests(key)).resolves.toHaveLength(1);
	});

	it("keeps the owner signed in, with the same sign-in methods, through sign-out and back", async () => {
		const { page, context, user } = await owner();
		const before = await methods(context);
		await connectKey(context);

		await disconnectInSettings(page);
		await open(page, "/settings");
		// Still signed in: Settings opens rather than sending the owner to sign in.
		expect(new URL(page.url()).pathname).toBe("/settings");
		await expect(methods(context)).resolves.toEqual(before);

		await clickSignOut(page);
		await page.waitForURL((url) => url.pathname === "/sign-in");
		await continueWithGitHub(page, user);
		await expect(methods(context)).resolves.toEqual(before);
		expect(before).toEqual(["github"]);
	});

	it("lets the owner connect the same provider again, and turns use the new key", async () => {
		const { context, workspaceId, botId } = await owner();
		const old = await connectKey(context);
		expect((await disconnect(context)).status()).toBe(204);

		const key = await connectKey(context, "glm-5.3-flash");
		await expect(view(context)).resolves.toMatchObject({
			connections: [{ id: "opencode", state: "Connected" }],
			defaultPair: { connectionId: "opencode", model: "glm-5.3-flash" },
		});
		const { status, body } = await post(context, workspaceId, botId, "Back again?");
		expect(status).toBe(200);
		expect(body).toContain('"status":"completed"');
		await expect(openCodeRequests(key)).resolves.toEqual([
			{ key, model: "glm-5.3-flash" },
			{ key, model: "glm-5.3-flash" },
		]);
		await expect(openCodeRequests(old)).resolves.toHaveLength(1);
	});
});

describe("another account", () => {
	it("cannot disconnect this owner's connection", async () => {
		const alice = await owner();
		const bob = await owner();
		const key = await connectKey(alice.context);
		const anonymous = await newVisitor();

		expect((await disconnect(bob.context)).status()).toBe(404);
		expect((await disconnect(anonymous.context)).status()).toBe(401);

		await expect(view(alice.context)).resolves.toMatchObject({
			connections: [{ id: "opencode", state: "Connected" }],
		});
		const { status } = await post(alice.context, alice.workspaceId, alice.botId, "Still here?");
		expect(status).toBe(200);
		await expect(openCodeRequests(key)).resolves.toHaveLength(2);
	});
});
