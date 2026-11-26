import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { clickSignOut, continueWithGitHub, newVisitor, open } from "../auth/visitor.ts";
import { limitOpenCode, openCodeKey, openCodeRequests } from "./opencode.ts";
import { owner } from "./owner.ts";

const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });

/** Connects a fresh OpenCode key on `model`, which becomes the default pair. */
async function connectKey(context: BrowserContext, model = "gpt-5.4-mini") {
	const key = await openCodeKey();
	const connected = await context.request.post("/api/models/opencode", { data: { key, model } });
	expect(connected.status()).toBe(204);
	return key;
}

async function view(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	expect(response.status()).toBe(200);
	return response.json() as Promise<unknown>;
}

async function stored(context: BrowserContext) {
	const response = await context.request.get("/api/models/__test/stored");
	expect(response.status()).toBe(200);
	return response.text();
}

/** Presses Disconnect on the OpenCode row in Settings and confirms it. */
async function disconnectInSettings(page: Page) {
	await open(page, "/settings");
	await modelAccess(page).getByRole("button", { name: "Disconnect OpenCode" }).click();
	const confirm = page.getByRole("dialog", { name: "Disconnect OpenCode?" });
	await confirm.getByRole("button", { name: "Disconnect", exact: true }).click();
	await confirm.waitFor({ state: "hidden" });
}

const disconnect = (context: BrowserContext) => context.request.delete("/api/models/opencode");

/** Sends `message` straight to the bot and answers the whole response. */
async function turn(context: BrowserContext, workspaceId: string, botId: string, message: string) {
	const response = await context.request.post(
		`/api/workspaces/${workspaceId}/bots/${botId}/turns`,
		{ data: { message } },
	);
	return { status: response.status(), body: await response.text() };
}

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
		expect((await turn(context, workspaceId, botId, "Before")).status).toBe(200);
		const before = await openCodeRequests(key);
		expect(before).toHaveLength(2);

		expect((await disconnect(context)).status()).toBe(204);
		const refused = await turn(context, workspaceId, botId, "After");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });
		await expect(openCodeRequests(key)).resolves.toEqual(before);
	});

	it("refuses a turn behind one the connection interrupted, which stays interrupted", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await limitOpenCode(key);
		const interrupted = await turn(context, workspaceId, botId, "Draft the brief.");
		expect(interrupted.body).toContain('"status":"interrupted"');
		expect((await turn(context, workspaceId, botId, "Then the summary.")).status).toBe(202);

		expect((await disconnect(context)).status()).toBe(204);
		const before = await openCodeRequests(key);
		const refused = await turn(context, workspaceId, botId, "After");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });

		const path = `/api/workspaces/${workspaceId}/bots/${botId}/__test/stored`;
		const botStored = async () =>
			(await (await context.request.get(path)).json()) as Record<string, unknown>;
		await expect.poll(async () => (await botStored()).unfinished).toBeUndefined();
		expect(Object.values(await botStored())).toContainEqual(
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
			data: { override: { connectionId: "opencode", model: "gpt-5.5" } },
		});
		expect(pinned.status()).toBe(204);
		const before = await openCodeRequests();

		expect((await disconnect(context)).status()).toBe(204);
		const refused = await turn(context, workspaceId, botId, "Still on my model?");
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

		const key = await connectKey(context, "gpt-5.5");
		await expect(view(context)).resolves.toMatchObject({
			connections: [{ id: "opencode", state: "Connected" }],
			defaultPair: { connectionId: "opencode", model: "gpt-5.5" },
		});
		const { status, body } = await turn(context, workspaceId, botId, "Back again?");
		expect(status).toBe(200);
		expect(body).toContain('"status":"completed"');
		await expect(openCodeRequests(key)).resolves.toEqual([
			{ key, model: "gpt-5.5" },
			{ key, model: "gpt-5.5" },
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
		const { status } = await turn(alice.context, alice.workspaceId, alice.botId, "Still here?");
		expect(status).toBe(200);
		await expect(openCodeRequests(key)).resolves.toHaveLength(2);
	});
});
