// A signed-in owner on the test stage, and what the model tests do as one.

import type { BrowserContext, BrowserContextOptions, Page } from "playwright";
import { expect } from "vite-plus/test";

import type { Pair } from "../../src/lib/model-access.ts";
import type { GitHubIdentity } from "../auth/fake-upstream.ts";
import { continueWithGitHub, gitHubUser, newVisitor } from "../auth/visitor.ts";
import { openCodeKey } from "./opencode.ts";

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

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** What every Credentials probe asks, and the key check on connect too. */
export const PROBE = "Reply with exactly one word: pong";

export const botPath = (workspaceId: string, botId: string) =>
	`/api/workspaces/${workspaceId}/bots/${botId}`;

/** Connects a fresh OpenCode key on `model`, which becomes the default pair if none is. */
export async function connectKey(context: BrowserContext, model = "gpt-5.4-mini") {
	const key = await openCodeKey();
	const connected = await context.request.post("/api/models/opencode", { data: { key, model } });
	expect(connected.status()).toBe(204);
	return key;
}

export async function chooseDefault(context: BrowserContext, pair: Pair) {
	const chosen = await context.request.put("/api/models/default", { data: pair });
	expect(chosen.status()).toBe(204);
}

/** The account's model access, as `GET /api/models` answers it. */
export async function view(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	expect(response.status()).toBe(200);
	return response.json() as Promise<unknown>;
}

/** Everything the account's Credentials object stores, as the raw JSON text. */
export async function stored(context: BrowserContext) {
	const response = await context.request.get("/api/models/__test/stored");
	expect(response.status()).toBe(200);
	return response.text();
}

/** Sends `message` straight to the bot, as a script would, and answers the whole response. */
export async function post(
	context: BrowserContext,
	workspaceId: string,
	botId: string,
	message: string,
) {
	const response = await context.request.post(`${botPath(workspaceId, botId)}/turns`, {
		data: { message },
	});
	return { status: response.status(), body: await response.text() };
}

/** Everything the bot's object stores, exactly as stored. */
export async function botStored(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
	expect(response.status()).toBe(200);
	return (await response.json()) as Record<string, unknown>;
}

export const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });
export const composer = (page: Page) => page.getByRole("textbox", { name: "Message Ditto" });
export const messages = (page: Page) => page.getByLabel("Messages", { exact: true });

/** Types `text` into the composer and presses Send. */
export async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await page.getByRole("button", { name: "Send" }).click();
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
