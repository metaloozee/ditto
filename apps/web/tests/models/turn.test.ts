import { readFile } from "node:fs/promises";

import type { BrowserContext, Page } from "playwright";
import { describe, expect, inject, it } from "vite-plus/test";

import { newVisitor, open } from "../auth/visitor.ts";
import {
	openCodeKey,
	openCodeRequests,
	openCodeTurnHungUp,
	replyToNextOpenCodeTurn,
} from "./opencode.ts";
import { owner } from "./owner.ts";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** Connects a fresh OpenCode key on `model`, which becomes the default pair. */
async function connectKey(context: BrowserContext, model = "gpt-5.4-mini") {
	const key = await openCodeKey();
	const connected = await context.request.post("/api/models/opencode", { data: { key, model } });
	expect(connected.status()).toBe(204);
	return key;
}

const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

/** Sends `message` straight to the bot, as a script would, and answers the whole response. */
async function post(context: BrowserContext, workspaceId: string, botId: string, message: string) {
	const response = await context.request.post(`${botPath(workspaceId, botId)}/turns`, {
		data: { message },
	});
	return { status: response.status(), body: await response.text() };
}

async function botStored(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
	expect(response.status()).toBe(200);
	return response.text();
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Ditto" });
const messages = (page: Page) => page.getByLabel("Messages", { exact: true });

/** Types `text` into the composer and presses Send. */
async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await page.getByRole("button", { name: "Send" }).click();
}

const markerOf = (key: string) => key.slice("sk-oc-MARKER-".length);

describe("a turn on the default pair", () => {
	it("streams the reply in, from one upstream request carrying the account's key", async () => {
		const { page, context } = await owner();
		const key = await connectKey(context, "gpt-5.4");
		await replyToNextOpenCodeTurn({ deltas: ["Here is ", "the weekly ", "update."] });

		await open(page, "/");
		await send(page, "Draft the weekly update.");

		await messages(page).getByText("Draft the weekly update.").waitFor();
		await messages(page).getByText("Here is the weekly update.").waitFor();
		await page.getByRole("button", { name: "Send" }).waitFor();
		// The first request is the key check on connect; the turn adds exactly one.
		await expect(openCodeRequests(key)).resolves.toEqual([
			{ key, model: "gpt-5.4" },
			{ key, model: "gpt-5.4" },
		]);
	});

	it("keeps no key in the Bot's storage or its answers", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		const answers: Promise<string>[] = [];
		page.on("response", (response) => answers.push(response.text().catch(() => "")));

		await open(page, "/");
		await send(page, "Summarize my week.");
		await messages(page).getByText("pong").waitFor();
		await page.getByRole("button", { name: "Send" }).waitFor();
		answers.push(post(context, workspaceId, botId, "And next week?").then(({ body }) => body));

		const bodies = await Promise.all(answers);
		expect(bodies.some((body) => body.includes('"type":"delta"'))).toBe(true);
		for (const body of bodies) expect(body).not.toContain(markerOf(key));

		const atRest = await botStored(context, workspaceId, botId);
		const turns = Object.values(JSON.parse(atRest) as Record<string, unknown>);
		expect(turns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					pair: { connectionId: "opencode", model: "gpt-5.4-mini" },
					message: "Summarize my week.",
					reply: "pong",
					status: "completed",
				}),
			]),
		);
		expect(atRest).not.toContain(markerOf(key));
		expect(await readFile(inject("stageLog"), "utf8")).not.toContain(markerOf(key));
	});

	it("uses each account's own key", async () => {
		const alice = await owner();
		const bob = await owner();
		const aliceKey = await connectKey(alice.context, "gpt-5.4");
		const bobKey = await connectKey(bob.context, "gpt-5.5");

		const [fromAlice, fromBob] = await Promise.all([
			post(alice.context, alice.workspaceId, alice.botId, "Hello from Alice"),
			post(bob.context, bob.workspaceId, bob.botId, "Hello from Bob"),
		]);
		expect(fromAlice.status).toBe(200);
		expect(fromBob.status).toBe(200);

		await expect(openCodeRequests(aliceKey)).resolves.toEqual([
			{ key: aliceKey, model: "gpt-5.4" },
			{ key: aliceKey, model: "gpt-5.4" },
		]);
		await expect(openCodeRequests(bobKey)).resolves.toEqual([
			{ key: bobKey, model: "gpt-5.5" },
			{ key: bobKey, model: "gpt-5.5" },
		]);
	});
});

describe("without a usable connection", () => {
	it("disables the composer, refuses a direct request and never reaches the upstream", async () => {
		const { page, context, workspaceId, botId } = await owner(PHONE);
		const before = (await openCodeRequests()).length;

		await open(page, "/");
		await expect(composer(page).getAttribute("placeholder")).resolves.toBe(
			"Connect a model in Settings to message Ditto",
		);
		await expect(composer(page).isDisabled()).resolves.toBe(true);
		await expect(page.getByRole("button", { name: "Send" }).isDisabled()).resolves.toBe(true);

		const refused = await post(context, workspaceId, botId, "Anyone there?");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });
		await expect(botStored(context, workspaceId, botId)).resolves.toBe("{}");
		expect((await openCodeRequests()).length).toBe(before);

		// Once a key is connected, the same phone gets a working composer.
		await connectKey(context);
		await open(page, "/");
		await expect(composer(page).getAttribute("placeholder")).resolves.toBe("Message Ditto");
		await send(page, "Now?");
		await messages(page).getByText("pong").waitFor();
	});
});

describe("stopping a turn", () => {
	it("ends the stream and aborts the upstream request", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await replyToNextOpenCodeTurn({ deltas: ["Reading the notes now."], hold: true });

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		await messages(page).getByText("Reading the notes now.").waitFor();
		await page.getByRole("button", { name: "Stop" }).click();

		await messages(page).getByText("Stopped", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Send" }).waitFor();
		await expect.poll(() => openCodeTurnHungUp(key), { timeout: 10_000 }).toBe(true);
		const turns = Object.values(JSON.parse(await botStored(context, workspaceId, botId)) as object);
		expect(turns).toEqual([
			expect.objectContaining({ reply: "Reading the notes now.", status: "stopped" }),
		]);
	});
});

describe("another account", () => {
	it("cannot send to or stop this owner's bot", async () => {
		const alice = await owner();
		const bob = await owner();
		const aliceKey = await connectKey(alice.context);
		await connectKey(bob.context);
		const anonymous = await newVisitor();

		const attempts = [
			post(bob.context, alice.workspaceId, alice.botId, "Let me in"),
			// Bob's own workspace, naming Alice's bot.
			post(bob.context, bob.workspaceId, alice.botId, "Let me in"),
			bob.context.request
				.post(`${botPath(alice.workspaceId, alice.botId)}/stop`)
				.then((response) => ({ status: response.status() })),
		];
		for (const { status } of await Promise.all(attempts)) expect(status).toBe(404);
		const signedOut = await post(anonymous.context, alice.workspaceId, alice.botId, "Let me in");
		expect(signedOut.status).toBe(401);

		await expect(openCodeRequests(aliceKey)).resolves.toHaveLength(1);
		await expect(botStored(alice.context, alice.workspaceId, alice.botId)).resolves.toBe("{}");
	});
});
