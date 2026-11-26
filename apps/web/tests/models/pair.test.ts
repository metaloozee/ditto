import { randomUUID } from "node:crypto";

import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import {
	openCodeKey,
	openCodeRequests,
	releaseOpenCodeTurn,
	replyToNextOpenCodeTurn,
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

/** Connects a fresh OpenCode key on `model`, which becomes the default pair. */
async function connectKey(context: BrowserContext, model = "gpt-5.4-mini") {
	const key = await openCodeKey();
	const connected = await context.request.post("/api/models/opencode", { data: { key, model } });
	expect(connected.status()).toBe(204);
	return key;
}

/** Adds a second bot to the workspace's membership, standing in for specialist creation. */
async function addSpecialist(context: BrowserContext, workspaceId: string) {
	const id = `bot-${randomUUID()}`;
	const added = await context.request.post(`/api/workspaces/${workspaceId}/__test/members`, {
		data: { id, name: "Researcher" },
	});
	expect(added.status()).toBe(204);
	return id;
}

const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

/** Sends `message` straight to the bot and answers the whole response. */
async function post(context: BrowserContext, workspaceId: string, botId: string, message: string) {
	const response = await context.request.post(`${botPath(workspaceId, botId)}/turns`, {
		data: { message },
	});
	return { status: response.status(), body: await response.text() };
}

async function setOverride(
	context: BrowserContext,
	workspaceId: string,
	botId: string,
	override: unknown,
) {
	const response = await context.request.put(`${botPath(workspaceId, botId)}/model`, {
		data: { override },
	});
	return response.status();
}

async function override(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/model`);
	return { status: response.status(), body: (await response.json()) as unknown };
}

async function chooseDefault(context: BrowserContext, model: string) {
	const chosen = await context.request.put("/api/models/default", {
		data: { connectionId: "opencode", model },
	});
	expect(chosen.status()).toBe(204);
}

/** The model each turn named at the upstream, after the connect check. */
async function turnModels(key: string) {
	return (await openCodeRequests(key)).slice(1).map((request) => request.model);
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Ditto" });
const messages = (page: Page) => page.getByLabel("Messages", { exact: true });
const botSettings = (page: Page) => page.getByRole("dialog", { name: "Ditto’s settings" });

/** The answer to the next save of a bot's own pair from bot settings. */
const savedOverride = (page: Page) =>
	page.waitForResponse(
		(response) => response.url().endsWith("/model") && response.request().method() === "PUT",
	);

async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await page.getByRole("button", { name: "Send" }).click();
}

describe("a bot's pair", () => {
	it("is the default without an override and its own with one, observed at the upstream", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context, "gpt-5.4-mini");
		const specialist = await addSpecialist(context, workspaceId);
		const pinned = { connectionId: "opencode", model: "gpt-5.5" };
		expect(await setOverride(context, workspaceId, specialist, pinned)).toBe(204);

		expect((await post(context, workspaceId, botId, "Plan my day")).status).toBe(200);
		expect((await post(context, workspaceId, specialist, "Find sources")).status).toBe(200);
		await expect(turnModels(key)).resolves.toEqual(["gpt-5.4-mini", "gpt-5.5"]);

		// A new default reaches only the bot that inherits it.
		await chooseDefault(context, "gpt-5.4");
		expect((await post(context, workspaceId, botId, "And tomorrow?")).status).toBe(200);
		expect((await post(context, workspaceId, specialist, "More sources")).status).toBe(200);
		await expect(turnModels(key)).resolves.toEqual([
			"gpt-5.4-mini",
			"gpt-5.5",
			"gpt-5.4",
			"gpt-5.5",
		]);

		// Clearing the override hands the bot back to the default.
		expect(await setOverride(context, workspaceId, specialist, null)).toBe(204);
		await expect(override(context, workspaceId, specialist)).resolves.toEqual({
			status: 200,
			body: { override: null },
		});
		expect((await post(context, workspaceId, specialist, "Once more")).status).toBe(200);
		await expect(turnModels(key)).resolves.toHaveLength(5);
		expect((await turnModels(key)).at(-1)).toBe("gpt-5.4");
	});

	it("stays on its starting pair while it streams, and the next turn takes the new one", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context, "gpt-5.4-mini");
		await replyToNextOpenCodeTurn({ deltas: ["Working on it."], hold: true });

		const streaming = post(context, workspaceId, botId, "Draft the weekly update.");
		await expect.poll(() => turnModels(key)).toEqual(["gpt-5.4-mini"]);
		// Both the default and the bot's own pair change mid-turn.
		await chooseDefault(context, "gpt-5.4");
		expect(
			await setOverride(context, workspaceId, botId, {
				connectionId: "opencode",
				model: "gpt-5.5",
			}),
		).toBe(204);
		await releaseOpenCodeTurn(key);

		const { status, body } = await streaming;
		expect(status).toBe(200);
		expect(body).toContain('"pair":{"connectionId":"opencode","model":"gpt-5.4-mini"}');
		expect(body).toContain('"status":"completed"');
		const stored = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
		const turns = Object.entries((await stored.json()) as Record<string, unknown>).filter(
			([name]) => name.startsWith("turn:"),
		);
		expect(turns.map(([, turn]) => turn)).toEqual([
			expect.objectContaining({
				pair: { connectionId: "opencode", model: "gpt-5.4-mini" },
				reply: "Working on it.",
				status: "completed",
			}),
		]);

		expect((await post(context, workspaceId, botId, "Next one")).status).toBe(200);
		await expect(turnModels(key)).resolves.toEqual(["gpt-5.4-mini", "gpt-5.5"]);
	});

	it("is refused unless it is a complete pair the account offers", async () => {
		const { context, workspaceId, botId } = await owner();
		await connectKey(context);
		const refused = [
			{ connectionId: "opencode" },
			{ model: "gpt-5.5" },
			{ connectionId: "opencode", model: "" },
			{ connectionId: "", model: "gpt-5.5" },
			"opencode",
		];
		for (const pair of refused) {
			expect(await setOverride(context, workspaceId, botId, pair)).toBe(400);
		}
		const unknown = [
			{ connectionId: "opencode", model: "gpt-0" },
			{ connectionId: "chatgpt", model: "gpt-5.5" },
		];
		for (const pair of unknown) {
			expect(await setOverride(context, workspaceId, botId, pair)).toBe(404);
		}
		await expect(override(context, workspaceId, botId)).resolves.toEqual({
			status: 200,
			body: { override: null },
		});
	});

	it("cannot be read or changed from another account", async () => {
		const alice = await owner();
		const bob = await owner();
		await connectKey(alice.context);
		await connectKey(bob.context);
		const pinned = { connectionId: "opencode", model: "gpt-5.5" };
		expect(await setOverride(alice.context, alice.workspaceId, alice.botId, pinned)).toBe(204);
		const anonymous = await newVisitor();

		const reads = [
			override(bob.context, alice.workspaceId, alice.botId),
			override(bob.context, bob.workspaceId, alice.botId),
		];
		for (const { status } of await Promise.all(reads)) expect(status).toBe(404);
		const other = { connectionId: "opencode", model: "gpt-5.4" };
		await expect(setOverride(bob.context, alice.workspaceId, alice.botId, other)).resolves.toBe(
			404,
		);
		await expect(setOverride(bob.context, bob.workspaceId, alice.botId, null)).resolves.toBe(404);
		await expect(override(anonymous.context, alice.workspaceId, alice.botId)).resolves.toEqual(
			expect.objectContaining({ status: 401 }),
		);

		await expect(override(alice.context, alice.workspaceId, alice.botId)).resolves.toEqual({
			status: 200,
			body: { override: pinned },
		});
	});
});

describe("bot settings", () => {
	it("open as a dialog from the gear, and the chosen pair survives a reload and eviction", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context, "gpt-5.4-mini");

		await open(page, "/?panel=computer");
		await page.getByRole("button", { name: "Ditto’s settings" }).click();
		const sheet = botSettings(page);
		await sheet.waitFor();
		await expect(sheet.getAttribute("data-side")).resolves.toBe("end");
		await sheet.getByText("gpt-5.4-mini · OpenCode").waitFor();
		// Choosing for the bot starts it on the default pair, then the owner picks another.
		const pinnedToDefault = savedOverride(page);
		await sheet.getByText("Choose for this bot").click();
		expect((await pinnedToDefault).status()).toBe(204);
		await sheet.getByRole("button", { name: "Ditto’s model" }).click();
		const saved = savedOverride(page);
		await page.getByRole("option", { name: "gpt-5.5", exact: true }).click();
		expect((await saved).status()).toBe(204);
		await expect(sheet.getByRole("button", { name: "Ditto’s model" }).textContent()).resolves.toBe(
			"gpt-5.5 · OpenCode",
		);

		await context.request.post(`${botPath(workspaceId, botId)}/__test/evict`);
		await open(page, "/?panel=computer");
		await page.getByRole("button", { name: "Ditto’s settings" }).click();
		await expect(
			botSettings(page).getByRole("radio", { name: "Choose for this bot" }).isChecked(),
		).resolves.toBe(true);
		await expect(
			botSettings(page).getByRole("button", { name: "Ditto’s model" }).textContent(),
		).resolves.toBe("gpt-5.5 · OpenCode");
		await page.keyboard.press("Escape");
		await botSettings(page).waitFor({ state: "hidden" });

		await send(page, "Which model is this?");
		await messages(page).getByText("pong").waitFor();
		await expect(turnModels(key)).resolves.toEqual(["gpt-5.5"]);
	});

	it("open as a drawer on a phone and hand the bot back to the default", async () => {
		const { page, context, workspaceId, botId } = await owner(PHONE);
		const key = await connectKey(context, "gpt-5.4-mini");
		const pinned = { connectionId: "opencode", model: "gpt-5.5" };
		expect(await setOverride(context, workspaceId, botId, pinned)).toBe(204);

		await open(page, "/?panel=computer");
		await page.getByRole("button", { name: "Ditto’s settings" }).click();
		const drawer = botSettings(page);
		await drawer.waitFor();
		await expect(drawer.getAttribute("data-side")).resolves.toBeNull();
		const saved = savedOverride(page);
		await drawer.getByText("Use the default").click();
		expect((await saved).status()).toBe(204);
		await expect(override(context, workspaceId, botId)).resolves.toEqual({
			status: 200,
			body: { override: null },
		});

		expect((await post(context, workspaceId, botId, "Back on the default?")).status).toBe(200);
		await expect(turnModels(key)).resolves.toEqual(["gpt-5.4-mini"]);
	});
});
