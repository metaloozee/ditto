import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { BrowserContext, Page } from "playwright";
import { describe, expect, inject, it } from "vite-plus/test";

import { gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import { failNextOpenCodeRequest, openCodeKey, openCodeRequests } from "./opencode.ts";
import { owner } from "./owner.ts";

const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });

/** Fills the connect form in Settings with `key` on `model` and presses Connect. */
async function connectInSettings(page: Page, key: string, model: string) {
	await open(page, "/settings");
	const section = modelAccess(page);
	await section.getByRole("button", { name: "Connect an OpenCode API key" }).click();
	await section.getByLabel("API key").fill(key);
	await section.getByRole("combobox", { name: "Model" }).click();
	await page.getByRole("option", { name: model, exact: true }).click();
	await section.getByRole("button", { name: "Connect", exact: true }).click();
}

const connect = (context: BrowserContext, key: string, model: string) =>
	context.request.post("/api/models/opencode", { data: { key, model } });

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

/** What Settings shows of model access: the OpenCode row's state and the default pair. */
async function shown(page: Page) {
	const section = modelAccess(page);
	await section.getByText("Default model").waitFor();
	return {
		connected: await section.getByText("Connected", { exact: true }).isVisible(),
		defaultPair: await section.getByRole("button", { name: "Default model" }).textContent(),
	};
}

const NOTHING = { connections: [], defaultPair: null };

describe("connecting an OpenCode API key", () => {
	it("shows Connected and the chosen pair as the default after a reload and on a second device", async () => {
		const user = gitHubUser();
		const first = await owner({ user });
		const key = await openCodeKey();

		await connectInSettings(first.page, key, "gpt-5.4");
		await modelAccess(first.page).getByText("Connected", { exact: true }).waitFor();
		await expect(openCodeRequests(key)).resolves.toEqual([{ key, model: "gpt-5.4" }]);

		const expected = { connected: true, defaultPair: "gpt-5.4 · OpenCode" };
		await open(first.page, "/settings");
		await expect(shown(first.page)).resolves.toEqual(expected);

		const second = await owner({ user });
		await open(second.page, "/settings");
		await expect(shown(second.page)).resolves.toEqual(expected);
	});

	it("keeps the first pair as the default, and moves it only when the owner chooses another", async () => {
		const { context } = await owner();
		expect((await connect(context, await openCodeKey(), "gpt-5.4-mini")).status()).toBe(204);
		// Connecting again replaces the key, not the default.
		expect((await connect(context, await openCodeKey(), "gpt-5.5")).status()).toBe(204);
		await expect(view(context)).resolves.toMatchObject({
			defaultPair: { connectionId: "opencode", model: "gpt-5.4-mini" },
		});

		const choose = (pair: unknown) => context.request.put("/api/models/default", { data: pair });
		expect((await choose({ connectionId: "opencode", model: "gpt-5.5" })).status()).toBe(204);
		expect((await choose({ connectionId: "opencode", model: "not-offered" })).status()).toBe(404);
		expect((await choose({ connectionId: "chatgpt", model: "gpt-5.5" })).status()).toBe(404);
		await expect(view(context)).resolves.toMatchObject({
			defaultPair: { connectionId: "opencode", model: "gpt-5.5" },
		});
	});

	it("stores no key OpenCode rejects, and says so beside the field", async () => {
		const { page, context } = await owner();
		const rejected = `sk-oc-MARKER-${randomUUID()}`;

		await connectInSettings(page, rejected, "gpt-5.4-mini");
		const field = modelAccess(page).getByLabel("API key");
		await expect.poll(() => field.getAttribute("aria-invalid"), { timeout: 10_000 }).toBe("true");
		const note = page.locator(`#${await field.getAttribute("aria-describedby")}`);
		await expect(note.textContent()).resolves.toBe(
			"OpenCode didn’t accept this key. Check it and paste it again.",
		);

		await expect(openCodeRequests(rejected)).resolves.toHaveLength(1);
		await expect(view(context)).resolves.toEqual(NOTHING);
		await expect(stored(context)).resolves.toBe("{}");
	});

	it("stores nothing while OpenCode is down, and doesn't call the key rejected", async () => {
		const { context } = await owner();
		await failNextOpenCodeRequest({ status: 503 });
		const response = await connect(context, await openCodeKey(), "gpt-5.4-mini");
		expect(response.status()).toBe(502);
		await expect(response.json()).resolves.toEqual({
			error: "OpenCode isn’t responding. Try again in a moment.",
		});
		await expect(view(context)).resolves.toEqual(NOTHING);
	});
});

describe("the stored key", () => {
	it("is encrypted at rest and appears in no answer to a browser and no log line", async () => {
		const { page, context } = await owner();
		const key = await openCodeKey();
		const answers: Promise<string>[] = [];
		page.on("response", (response) => answers.push(response.text().catch(() => "")));

		await connectInSettings(page, key, "gpt-5.4-mini");
		await modelAccess(page).getByText("Connected", { exact: true }).waitFor();
		await open(page, "/settings");
		answers.push((await context.request.get("/api/models")).text());

		const marker = key.slice("sk-oc-MARKER-".length);
		const bodies = await Promise.all(answers);
		expect(bodies.length).toBeGreaterThan(3);
		for (const body of bodies) expect(body).not.toContain(marker);

		const atRest = await stored(context);
		expect(JSON.parse(atRest)).toMatchObject({
			"connection:opencode": { provider: "opencode", key: { iv: expect.any(String) } },
		});
		expect(atRest).not.toContain(marker);

		expect(await readFile(inject("stageLog"), "utf8")).not.toContain(marker);
	});

	it("belongs to one account: another sees no connection and can't choose it", async () => {
		const alice = await owner();
		const bob = await owner();
		const key = await openCodeKey();
		expect((await connect(alice.context, key, "gpt-5.4-mini")).status()).toBe(204);

		await expect(view(bob.context)).resolves.toEqual(NOTHING);
		await expect(stored(bob.context)).resolves.toBe("{}");
		const borrowed = await bob.context.request.put("/api/models/default", {
			data: { connectionId: "opencode", model: "gpt-5.4-mini" },
		});
		expect(borrowed.status()).toBe(404);
		await open(bob.page, "/settings");
		await modelAccess(bob.page)
			.getByRole("button", { name: "Connect an OpenCode API key" })
			.waitFor();

		await expect(openCodeRequests(key)).resolves.toHaveLength(1);
		await expect(view(alice.context)).resolves.toMatchObject({
			connections: [{ id: "opencode", state: "Connected" }],
		});
	});

	it("leaves the account's sign-in methods as they were", async () => {
		const { context } = await owner();
		const methods = async () => {
			const response = await context.request.get("/api/auth/list-accounts");
			expect(response.status()).toBe(200);
			const accounts = (await response.json()) as { providerId: string }[];
			return accounts.map((account) => account.providerId).sort();
		};
		const before = await methods();
		expect((await connect(context, await openCodeKey(), "gpt-5.4-mini")).status()).toBe(204);
		await expect(methods()).resolves.toEqual(before);
		expect(before).toEqual(["github"]);
	});
});

describe("model access without a session", () => {
	it("refuses every request and never reaches OpenCode", async () => {
		const { context } = await newVisitor();
		const key = await openCodeKey();
		const requests = [
			context.request.get("/api/models"),
			connect(context, key, "gpt-5.4-mini"),
			context.request.put("/api/models/default", {
				data: { connectionId: "opencode", model: "gpt-5.4-mini" },
			}),
			context.request.get("/api/models/__test/stored"),
			context.request.get("/api/models/anything-else"),
		];
		for (const response of await Promise.all(requests)) expect(response.status()).toBe(401);
		await expect(openCodeRequests(key)).resolves.toEqual([]);
	});
});
