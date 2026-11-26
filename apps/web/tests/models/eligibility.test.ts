import type { BrowserContext, Page } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import { chatgptCredential, chatgptRequests } from "./chatgpt.ts";
import { openCodeKey, openCodeRequests } from "./opencode.ts";

const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });

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

interface Deployment {
	mode: "self-deployed" | "hosted";
	license?: string;
	approval?: string;
}

/** Runs this account as if the stage were configured as `deployment`. */
async function deployAs(context: BrowserContext, deployment: Deployment) {
	const response = await context.request.put("/api/models/__test/deployment", {
		data: deployment,
	});
	expect(response.status()).toBe(204);
}

const importCredential = (context: BrowserContext, credential: unknown) =>
	context.request.post("/api/models/chatgpt", { data: { credential } });

async function connections(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	expect(response.status()).toBe(200);
	return ((await response.json()) as { connections: unknown[] }).connections;
}

/** Sends `message` straight to the bot and answers the whole response. */
async function turn(context: BrowserContext, workspaceId: string, botId: string, message: string) {
	const response = await context.request.post(
		`/api/workspaces/${workspaceId}/bots/${botId}/turns`,
		{ data: { message } },
	);
	return { status: response.status(), body: await response.text() };
}

/** Waits for Settings' ChatGPT plan row to say the plan isn't offered, with nothing to press. */
async function expectNotOffered(page: Page) {
	await open(page, "/settings");
	const section = modelAccess(page);
	await section.getByText("Not offered on this deployment.").waitFor();
	await expect(section.getByRole("button", { name: /ChatGPT plan/ }).count()).resolves.toBe(0);
}

async function expectOffered(page: Page) {
	await open(page, "/settings");
	await modelAccess(page).getByRole("button", { name: "Connect ChatGPT plan" }).waitFor();
}

const LICENSE = "AGPL-3.0-only";

describe("a self-deployed Ditto", () => {
	it("doesn't offer the ChatGPT plan until its license is recorded, and refuses the import", async () => {
		const { page, context } = await owner();
		await deployAs(context, { mode: "self-deployed" });

		await expectNotOffered(page);
		const refused = await importCredential(context, await chatgptCredential());
		expect(refused.status()).toBe(403);
		await expect(connections(context)).resolves.toEqual([]);
	});

	it("offers the plan once the license is recorded", async () => {
		const { page, context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "self-deployed", license: LICENSE });

		await expectOffered(page);
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		expect((await turn(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
	});
});

describe("a hosted Ditto", () => {
	it("doesn't offer the plan on the license alone, even after a successful Responses call", async () => {
		const { page, context, workspaceId, botId } = await owner();
		// The plan works on this stage: a turn reaches the Responses API and succeeds.
		await deployAs(context, { mode: "self-deployed", license: LICENSE });
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		expect((await turn(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
		expect((await context.request.delete("/api/models/chatgpt")).status()).toBe(204);

		await deployAs(context, { mode: "hosted", license: LICENSE });
		await expectNotOffered(page);
		const refused = await importCredential(context, await chatgptCredential());
		expect(refused.status()).toBe(403);
		await expect(connections(context)).resolves.toEqual([]);
	});

	it("offers the plan once the license and OpenAI's approval are both recorded", async () => {
		const { page, context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "hosted", license: LICENSE, approval: "2026-11-26" });

		await expectOffered(page);
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		expect((await turn(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
	});
});

describe("a gate that closes", () => {
	it("refuses turns on an imported plan without sending a request", async () => {
		const { context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "self-deployed", license: LICENSE });
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);

		await deployAs(context, { mode: "hosted", license: LICENSE });
		const refused = await turn(context, workspaceId, botId, "Hello");
		expect(refused.status).toBe(409);
		expect(JSON.parse(refused.body)).toEqual({ error: "Connect a model in Settings first" });
		await expect(chatgptRequests(credential.access)).resolves.toEqual([]);
	});
});

describe("other model access", () => {
	it("keeps an OpenCode key working with every gate closed", async () => {
		const { context, workspaceId, botId } = await owner();
		await deployAs(context, { mode: "hosted" });

		const key = await openCodeKey();
		const connected = await context.request.post("/api/models/opencode", {
			data: { key, model: "gpt-5.4-mini" },
		});
		expect(connected.status()).toBe(204);
		expect((await turn(context, workspaceId, botId, "Hello")).status).toBe(200);
		// The connect check, then the turn.
		await expect(openCodeRequests(key)).resolves.toHaveLength(2);
	});
});
