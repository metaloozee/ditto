import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import { failNextOpenCodeRequest, openCodeKey, openCodeRequests } from "./opencode.ts";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** A signed-in owner who has opened their personal workspace, with its Chief of Staff's ID. */
async function owner(options: Parameters<typeof newVisitor>[0] = {}) {
	const visitor = await newVisitor(options);
	await continueWithGitHub(visitor.page, gitHubUser());
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId, chiefOfStaff } = (await opened.json()) as {
		workspaceId: string;
		chiefOfStaff: { id: string };
	};
	return { ...visitor, workspaceId, botId: chiefOfStaff.id };
}

async function connectKey(context: BrowserContext, model = "gpt-5.4-mini") {
	const key = await openCodeKey();
	const connected = await context.request.post("/api/models/opencode", { data: { key, model } });
	expect(connected.status()).toBe(204);
	return key;
}

const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

async function turns(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
	expect(response.status()).toBe(200);
	return Object.values((await response.json()) as Record<string, unknown>);
}

async function connectionState(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	const { connections } = (await response.json()) as { connections: { state: string }[] };
	return connections[0]?.state;
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Ditto" });
const messages = (page: Page) => page.getByLabel("Messages", { exact: true });
const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });

async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await page.getByRole("button", { name: "Send" }).click();
}

const PAIR = { connectionId: "opencode", model: "gpt-5.4-mini" };

describe("a provider outage", () => {
	it("shows Unavailable, keeps checking, and resumes the turn on its original pair", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await failNextOpenCodeRequest({ status: 503 });

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		const card = messages(page).getByRole("group", { name: "gpt-5.4-mini · OpenCode" });
		await card.getByText("Unavailable", { exact: true }).waitFor();
		await card.getByText("OpenCode isn’t responding. Ditto keeps checking.").waitFor();
		await card.getByRole("button", { name: "Check again" }).waitFor();
		expect(await turns(context, workspaceId, botId)).toEqual([
			expect.objectContaining({ pair: PAIR, status: "interrupted", interruption: "Unavailable" }),
		]);

		const settings = await context.newPage();
		await open(settings, "/settings");
		await modelAccess(settings).getByText("Unavailable", { exact: true }).waitFor();
		await settings.close();

		// The upstream answers again; Ditto's own probe finds it and the turn carries on.
		await messages(page).getByText("pong").waitFor({ timeout: 25_000 });
		await messages(page).getByText("Carried on with gpt-5.4-mini · OpenCode").waitFor();
		expect(await turns(context, workspaceId, botId)).toEqual([
			expect.objectContaining({ pair: PAIR, status: "completed", reply: "pong" }),
		]);
		await expect(connectionState(context)).resolves.toBe("Connected");
		// Connect check, the failed turn, one probe, the resumed turn: all on the original pair.
		await expect(openCodeRequests(key)).resolves.toEqual(
			Array.from({ length: 4 }, () => ({ key, model: "gpt-5.4-mini" })),
		);
	}, 60_000);

	it("probes once on Check again and updates the state", async () => {
		const { page, context } = await owner(PHONE);
		const key = await connectKey(context);
		await failNextOpenCodeRequest({ status: 503 });
		await failNextOpenCodeRequest({ status: 502 });

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		const card = messages(page).getByRole("group", { name: "gpt-5.4-mini · OpenCode" });
		await card.getByText("Unavailable", { exact: true }).waitFor();
		await expect(openCodeRequests(key)).resolves.toHaveLength(2);

		await open(page, "/settings");
		const section = modelAccess(page);
		await section.getByRole("button", { name: "Check again OpenCode" }).click();
		await expect.poll(() => openCodeRequests(key).then((all) => all.length)).toBe(3);
		await section.getByText("Unavailable", { exact: true }).waitFor();

		await section.getByRole("button", { name: "Check again OpenCode" }).click();
		await section.getByText("Connected", { exact: true }).waitFor();
		// The successful probe, then the turn it resumed.
		await expect.poll(() => openCodeRequests(key).then((all) => all.length)).toBe(5);
	}, 60_000);
});

describe("a revoked key", () => {
	it("shows Reconnect needed, stops using the key, and continues the turn after a reconnect", async () => {
		const { page, context, workspaceId, botId } = await owner(PHONE);
		const revoked = await connectKey(context);
		await failNextOpenCodeRequest({ status: 401, body: { error: { message: "Key revoked" } } });

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		const card = messages(page).getByRole("group", { name: "gpt-5.4-mini · OpenCode" });
		await card.getByText("Reconnect needed", { exact: true }).waitFor();
		await card.getByText("OpenCode no longer accepts this key.").waitFor();
		await card.getByRole("link", { name: "Reconnect" }).waitFor();

		const refused = await context.request.post(`${botPath(workspaceId, botId)}/turns`, {
			data: { message: "Anyone there?" },
		});
		expect(refused.status()).toBe(409);

		await card.getByRole("link", { name: "Reconnect" }).click();
		await page.waitForURL("**/settings");
		const section = modelAccess(page);
		await section.getByText("Reconnect needed", { exact: true }).waitFor();
		const fresh = await openCodeKey();
		await section.getByRole("button", { name: "Reconnect OpenCode" }).click();
		await section.getByLabel("API key").fill(fresh);
		await section.getByRole("button", { name: "Connect", exact: true }).click();
		await section.getByText("Connected", { exact: true }).waitFor();

		await expect
			.poll(() => turns(context, workspaceId, botId), { timeout: 15_000 })
			.toEqual([expect.objectContaining({ pair: PAIR, status: "completed", reply: "pong" })]);
		// Only the connect check and the turn it refused ever carried the revoked key.
		await expect(openCodeRequests(revoked)).resolves.toHaveLength(2);
		await expect(openCodeRequests(fresh)).resolves.toEqual([
			{ key: fresh, model: "gpt-5.4-mini" },
			{ key: fresh, model: "gpt-5.4-mini" },
		]);
	}, 60_000);
});
