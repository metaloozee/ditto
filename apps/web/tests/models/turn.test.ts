import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import { openCodeKey, openCodeRequests, replyToNextOpenCodeTurn } from "./opencode.ts";

/** A signed-in owner who has opened their personal workspace, with its Chief of Staff's ID. */
async function owner() {
	const visitor = await newVisitor();
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

const composer = (page: Page) => page.getByRole("textbox", { name: "Message Ditto" });
const messages = (page: Page) => page.getByLabel("Messages", { exact: true });

/** Types `text` into the composer and presses Send. */
async function send(page: Page, text: string) {
	await composer(page).fill(text);
	await page.getByRole("button", { name: "Send" }).click();
}

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
});
