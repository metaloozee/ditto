import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import { chatgptCredential, chatgptRequests } from "./chatgpt.ts";
import {
	endOpenCodeOutage,
	openCodeKey,
	openCodeRequests,
	revokeOpenCodeKey,
	startOpenCodeOutage,
} from "./opencode.ts";

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

/** The bot's turn records, as stored. */
async function turns(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
	expect(response.status()).toBe(200);
	const stored = (await response.json()) as Record<string, unknown>;
	return Object.entries(stored).flatMap(([name, value]) =>
		name.startsWith("turn:") ? [value] : [],
	);
}

async function connectionState(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	const { connections } = (await response.json()) as { connections: { state: string }[] };
	return connections[0]?.state;
}

const requestCount = (key: string) => openCodeRequests(key).then((all) => all.length);

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Ditto" });
const messages = (page: Page) => page.getByLabel("Messages", { exact: true });
const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });
const card = (page: Page) => messages(page).getByRole("group", { name: "gpt-5.4-mini · OpenCode" });

async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await page.getByRole("button", { name: "Send" }).click();
}

const PAIR = { connectionId: "opencode", model: "gpt-5.4-mini" };
const ON_PAIR = { key: expect.any(String), model: "gpt-5.4-mini" };

describe("a provider outage", () => {
	it("shows Unavailable, keeps checking with backoff, and resumes the turn on its original pair", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await startOpenCodeOutage(key);

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		await card(page).getByText("Unavailable", { exact: true }).waitFor();
		await card(page).getByText("OpenCode isn’t responding. Ditto keeps checking.").waitFor();
		await card(page).getByRole("button", { name: "Check again" }).waitFor();
		expect(await turns(context, workspaceId, botId)).toEqual([
			expect.objectContaining({ pair: PAIR, status: "interrupted", interruption: "Unavailable" }),
		]);

		const settings = await context.newPage();
		await open(settings, "/settings");
		await modelAccess(settings).getByText("Unavailable", { exact: true }).waitFor();
		await settings.close();

		// Probes back off: over six seconds of outage, at most one a second, doubling.
		await new Promise((resolve) => setTimeout(resolve, 6000));
		const duringOutage = await requestCount(key);
		expect(duringOutage).toBeGreaterThanOrEqual(3);
		expect(duringOutage).toBeLessThanOrEqual(6);

		await endOpenCodeOutage(key);
		await messages(page).getByText("pong").waitFor({ timeout: 20_000 });
		await messages(page).getByText("Carried on with gpt-5.4-mini · OpenCode").waitFor();
		expect(await turns(context, workspaceId, botId)).toEqual([
			expect.objectContaining({ pair: PAIR, status: "completed", reply: "pong" }),
		]);
		await expect(connectionState(context)).resolves.toBe("Connected");
		// Every request, probes and the resumed turn included, stayed on the turn's own pair.
		const all = await openCodeRequests(key);
		expect(all).toEqual(all.map(() => ON_PAIR));
	}, 60_000);

	it("probes once on Check again and updates the state", async () => {
		const { page, context, workspaceId, botId } = await owner(PHONE);
		const key = await connectKey(context);
		await startOpenCodeOutage(key);

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		await card(page).getByText("Unavailable", { exact: true }).waitFor();

		const before = await requestCount(key);
		const checked = await context.request.post("/api/models/opencode/check");
		expect(await checked.json()).toEqual({ state: "Unavailable" });
		expect(await requestCount(key)).toBe(before + 1);

		await endOpenCodeOutage(key);
		await open(page, "/settings");
		const section = modelAccess(page);
		await section.getByText("Unavailable", { exact: true }).waitFor();
		await section.getByRole("button", { name: "Check again OpenCode" }).click();
		await section.getByText("Connected", { exact: true }).waitFor();
		await expect
			.poll(() => turns(context, workspaceId, botId), { timeout: 15_000 })
			.toEqual([expect.objectContaining({ pair: PAIR, status: "completed", reply: "pong" })]);
	}, 60_000);
});

describe("a revoked key", () => {
	it("shows Reconnect needed, stops using the key, and continues the turn after a reconnect", async () => {
		const { page, context, workspaceId, botId } = await owner(PHONE);
		const revoked = await connectKey(context);
		await revokeOpenCodeKey(revoked);

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		await card(page).getByText("Reconnect needed", { exact: true }).waitFor();
		await card(page).getByText("OpenCode no longer accepts this key.").waitFor();

		// A message sent meanwhile waits; nothing probes or sends the refused key.
		const queued = await context.request.post(`${botPath(workspaceId, botId)}/turns`, {
			data: { message: "Also add the hiring numbers." },
		});
		expect(queued.status()).toBe(202);
		await new Promise((resolve) => setTimeout(resolve, 4000));
		const checked = await context.request.post("/api/models/opencode/check");
		expect(await checked.json()).toEqual({ state: "ReconnectNeeded" });
		// The connect check and the turn it refused.
		await expect(requestCount(revoked)).resolves.toBe(2);

		await card(page).getByRole("link", { name: "Reconnect" }).click();
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
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						pair: PAIR,
						message: "Draft the weekly update.",
						status: "completed",
					}),
					expect.objectContaining({ message: "Also add the hiring numbers.", status: "completed" }),
				]),
			);
		await expect(requestCount(revoked)).resolves.toBe(2);
		// The connect check, the resumed turn and the queued one, all with the new key.
		await expect(openCodeRequests(fresh)).resolves.toEqual(
			Array.from({ length: 3 }, () => ({ key: fresh, model: "gpt-5.4-mini" })),
		);
	}, 60_000);
});

describe("a second connection", () => {
	it("gets no request while the selected one is in trouble, until the owner selects it", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		const credential = await chatgptCredential();
		const imported = await context.request.post("/api/models/chatgpt", { data: { credential } });
		expect(imported.status()).toBe(204);
		await startOpenCodeOutage(key);

		const post = (message: string) =>
			context.request.post(`${botPath(workspaceId, botId)}/turns`, { data: { message } });
		const interrupted = await post("Draft the weekly update.");
		expect(interrupted.status()).toBe(200);
		expect(await interrupted.text()).toContain('"status":"interrupted"');
		expect((await post("Also add the hiring numbers.")).status()).toBe(202);
		// Probes keep going to OpenCode; the healthy plan is never tried in its place.
		await new Promise((resolve) => setTimeout(resolve, 3000));
		expect(await requestCount(key)).toBeGreaterThan(2);
		await expect(chatgptRequests(credential.access)).resolves.toEqual([]);

		const chosen = await context.request.put("/api/models/default", {
			data: { connectionId: "chatgpt", model: "gpt-5.6-luna" },
		});
		expect(chosen.status()).toBe(204);
		await endOpenCodeOutage(key);

		// The interrupted turn finishes on its own pair; only the queued one takes the new choice.
		await expect
			.poll(() => turns(context, workspaceId, botId), { timeout: 20_000 })
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ pair: PAIR, status: "completed" }),
					expect.objectContaining({
						pair: { connectionId: "chatgpt", model: "gpt-5.6-luna" },
						message: "Also add the hiring numbers.",
						status: "completed",
					}),
				]),
			);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
	}, 60_000);
});
