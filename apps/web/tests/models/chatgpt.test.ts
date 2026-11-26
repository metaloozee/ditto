import { readFile } from "node:fs/promises";

import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import type { BrowserContext, Page } from "playwright";
import { describe, expect, inject, it } from "vite-plus/test";

import { CHATGPT_MODELS } from "../../src/lib/model-access.ts";
import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import { chatgptCredential, chatgptRequests, markerOf } from "./chatgpt.ts";

const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });

async function owner() {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, gitHubUser());
	return visitor;
}

/** Opens the owner's workspace and answers it with its Chief of Staff's ID. */
async function openWorkspace(context: BrowserContext) {
	const opened = await context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId, chiefOfStaff } = (await opened.json()) as {
		workspaceId: string;
		chiefOfStaff: { id: string };
	};
	return { workspaceId, botId: chiefOfStaff.id };
}

/** Imports `credential` as the local import command does: once, as the signed-in owner. */
const importCredential = (context: BrowserContext, credential: unknown) =>
	context.request.post("/api/models/chatgpt", { data: { credential } });

async function view(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	expect(response.status()).toBe(200);
	return response.json() as Promise<unknown>;
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

describe("importing a ChatGPT plan credential", () => {
	it("shows the plan as Connected in Settings, with its models in the pair select", async () => {
		const { page, context } = await owner();
		expect((await importCredential(context, await chatgptCredential())).status()).toBe(204);

		await open(page, "/settings");
		const section = modelAccess(page);
		await section.getByText("Connected", { exact: true }).waitFor();
		await section.getByRole("button", { name: "Disconnect ChatGPT plan" }).waitFor();
		const defaultPair = section.getByRole("button", { name: "Default model" });
		await expect(defaultPair.textContent()).resolves.toBe("gpt-5.6-luna · ChatGPT plan");

		await defaultPair.click();
		const models = page.getByRole("listbox", { name: "ChatGPT plan models" }).getByRole("option");
		await expect(models.allTextContents()).resolves.toEqual([
			"gpt-5.6-luna",
			"gpt-5.5",
			"gpt-5.4",
			"gpt-5.4-mini",
		]);
	});

	it("replaces the first import with a second, whose token the next turn uses", async () => {
		const { context } = await owner();
		const { workspaceId, botId } = await openWorkspace(context);
		const first = await chatgptCredential();
		const second = await chatgptCredential();
		expect((await importCredential(context, first)).status()).toBe(204);
		expect((await importCredential(context, second)).status()).toBe(204);

		expect((await post(context, workspaceId, botId, "Hello")).status).toBe(200);
		await expect(chatgptRequests(first.access)).resolves.toEqual([]);
		await expect(chatgptRequests(second.access)).resolves.toHaveLength(1);
		await expect(view(context)).resolves.toMatchObject({
			connections: [{ id: "chatgpt", state: "Connected" }],
		});
	});

	it("lands in the importing account only, and refuses one without a session", async () => {
		const alice = await owner();
		const bob = await owner();
		const anonymous = await newVisitor();
		const aliceCredential = await chatgptCredential();
		expect((await importCredential(alice.context, aliceCredential)).status()).toBe(204);

		// The account comes from Bob's session, so his import can only reach his own object.
		const bobCredential = await chatgptCredential();
		expect((await importCredential(bob.context, bobCredential)).status()).toBe(204);
		const signedOut = await importCredential(anonymous.context, await chatgptCredential());
		expect(signedOut.status()).toBe(401);

		const { workspaceId, botId } = await openWorkspace(alice.context);
		expect((await post(alice.context, workspaceId, botId, "Mine?")).status).toBe(200);
		await expect(chatgptRequests(aliceCredential.access)).resolves.toHaveLength(1);
		await expect(chatgptRequests(bobCredential.access)).resolves.toEqual([]);
	});

	it("refuses a credential without the plan-usage grant, and stores nothing", async () => {
		const { context } = await owner();
		const credential = await chatgptCredential();
		const refused = await importCredential(context, {
			...credential,
			scopes: credential.scopes.filter((scope) => scope !== "chatgpt.tokens.use.direct"),
		});
		expect(refused.status()).toBe(400);
		expect((await importCredential(context, { ...credential, clientId: "" })).status()).toBe(400);
		await expect(view(context)).resolves.toEqual({ connections: [], defaultPair: null });
	});

	it("links no sign-in method", async () => {
		const { context } = await owner();
		const methods = async () => {
			const response = await context.request.get("/api/auth/list-accounts");
			expect(response.status()).toBe(200);
			const accounts = (await response.json()) as { providerId: string }[];
			return accounts.map((account) => account.providerId).sort();
		};
		const before = await methods();
		expect((await importCredential(context, await chatgptCredential())).status()).toBe(204);
		await expect(methods()).resolves.toEqual(before);
		expect(before).toEqual(["github"]);
	});
});

describe("a turn on the ChatGPT plan", () => {
	it("sends the bot's instructions in a form the plan-usage flow accepts, only to its Responses endpoint", async () => {
		const { context } = await owner();
		const { workspaceId, botId } = await openWorkspace(context);
		const credential = await chatgptCredential();
		expect((await importCredential(context, credential)).status()).toBe(204);
		const before = (await chatgptRequests()).length;

		const turn = await post(context, workspaceId, botId, "Draft the weekly update.");
		expect(turn.status).toBe(200);
		expect(turn.body).toContain('"text":"pong"');
		expect(turn.body).toContain('"status":"completed"');

		const sent = await chatgptRequests(credential.access);
		expect(sent).toHaveLength(1);
		const [request] = sent;
		expect(request).toMatchObject({
			path: "/api.openai.com/v1/responses",
			model: "gpt-5.6-luna",
			// Pi sends the instructions of a reasoning model as a developer item.
			roles: ["developer", "user"],
		});
		expect(request?.fields).toEqual(expect.arrayContaining(["store", "stream"]));
		for (const rejected of ["temperature", "max_output_tokens", "previous_response_id", "prompt"]) {
			expect(request?.fields).not.toContain(rejected);
		}
		// Nothing else reached OpenAI on this turn's behalf.
		expect((await chatgptRequests()).length).toBe(before + 1);
	});

	it("keeps the refresh token out of every answer, log line and the Bot's storage", async () => {
		const { page, context } = await owner();
		const { workspaceId, botId } = await openWorkspace(context);
		const credential = await chatgptCredential();
		const answers: Promise<string>[] = [];
		page.on("response", (response) => answers.push(response.text().catch(() => "")));

		const imported = await importCredential(context, credential);
		expect(imported.status()).toBe(204);
		answers.push(imported.text());
		answers.push(post(context, workspaceId, botId, "Summarize my week.").then(({ body }) => body));
		await open(page, "/settings");
		await modelAccess(page).getByText("Connected", { exact: true }).waitFor();
		answers.push((await context.request.get("/api/models")).text());

		const refresh = markerOf(credential.refresh);
		const access = markerOf(credential.access);
		const bodies = await Promise.all(answers);
		expect(bodies.some((body) => body.includes('"type":"delta"'))).toBe(true);
		for (const body of bodies) {
			expect(body).not.toContain(refresh);
			expect(body).not.toContain(access);
		}

		const botAtRest = await (
			await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`)
		).text();
		expect(botAtRest).toContain('"connectionId":"chatgpt"');
		expect(botAtRest).not.toContain(refresh);
		expect(botAtRest).not.toContain(access);
		const atRest = await (await context.request.get("/api/models/__test/stored")).text();
		expect(JSON.parse(atRest)).toMatchObject({
			"connection:chatgpt": { provider: "chatgpt", signIn: { iv: expect.any(String) } },
		});
		expect(atRest).not.toContain(refresh);
		expect(await readFile(inject("stageLog"), "utf8")).not.toContain(refresh);
	});

	it("offers only models whose instructions Pi sends as a developer item", () => {
		for (const id of CHATGPT_MODELS) {
			const model = Object.values(OPENAI_MODELS).find((each) => each.id === id);
			expect(model?.reasoning, id).toBe(true);
			expect(model?.compat?.supportsDeveloperRole, id).not.toBe(false);
		}
	});
});
