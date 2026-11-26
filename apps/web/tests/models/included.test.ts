import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { open } from "../auth/visitor.ts";
import { failNextOpenCodeRequest, openCodeKey, openCodeRequests } from "./opencode.ts";
import { composer, messages, modelAccess, owner, post, send } from "./owner.ts";
import { failNextWorkersAiRequest, workersAiRequests } from "./workers-ai.ts";

const DEEPSEEK = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
const GLM = "@cf/zai-org/glm-5.3";

/**
 * Whether this account is offered the included model. Stage configuration decides it; the test
 * stage leaves it off and lets each test account turn it on, so other tests keep their stage.
 */
async function offerIncluded(context: BrowserContext, offered: boolean) {
	const response = await context.request.put("/api/models/__test/included", { data: { offered } });
	expect(response.status()).toBe(204);
}

const INCLUDED_PAIR = { connectionId: "included", model: "DeepSeek V4.1 Flash" };

/** Offers this account the included model and makes it the default pair. */
async function useIncluded(context: BrowserContext) {
	await offerIncluded(context, true);
	const chosen = await context.request.put("/api/models/default", { data: INCLUDED_PAIR });
	expect(chosen.status()).toBe(204);
}

/** The bot's turn records, as stored. */
async function turns(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(
		`/api/workspaces/${workspaceId}/bots/${botId}/__test/stored`,
	);
	const stored = (await response.json()) as Record<string, unknown>;
	return Object.entries(stored).flatMap(([name, value]) =>
		name.startsWith("turn:") ? [value] : [],
	);
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** The fake model asks for the tool it is offered, then answers with its result: two requests. */
const toolTurn = (model: string, accountId: string) =>
	[model, model].map((each) => ({
		model: each,
		metadata: { dittoAccount: accountId },
		authorization: false,
		tools: ["current_time"],
	}));

describe("the included model", () => {
	it("runs a turn that calls a tool for an owner with no connection, billed to their account", async () => {
		const { page, context, accountId } = await owner();
		await useIncluded(context);

		await open(page, "/");
		await send(page, "What time is it?");
		await messages(page).getByText(ISO_TIME).waitFor();
		await page.getByRole("button", { name: "Send" }).waitFor();

		await expect(workersAiRequests(accountId)).resolves.toEqual(toolTurn(DEEPSEEK, accountId));
	});

	it("attributes each account's requests to that account", async () => {
		const alice = await owner();
		const bob = await owner();
		await useIncluded(alice.context);
		await useIncluded(bob.context);

		const [fromAlice, fromBob] = await Promise.all([
			post(alice.context, alice.workspaceId, alice.botId, "Hello from Alice"),
			post(bob.context, bob.workspaceId, bob.botId, "Hello from Bob"),
		]);
		expect(fromAlice.body).toContain('"status":"completed"');
		expect(fromBob.body).toContain('"status":"completed"');

		await expect(workersAiRequests(alice.accountId)).resolves.toEqual(
			toolTurn(DEEPSEEK, alice.accountId),
		);
		await expect(workersAiRequests(bob.accountId)).resolves.toEqual(
			toolTurn(DEEPSEEK, bob.accountId),
		);
	});

	it("moves to the recorded second choice once Workers AI retires the pinned model", async () => {
		const { page, context, accountId, workspaceId, botId } = await owner();
		await useIncluded(context);
		await failNextWorkersAiRequest({
			model: DEEPSEEK,
			status: 410,
			body: { errors: [{ code: 5028, message: "This model was deprecated on 2026-11-20." }] },
		});

		const first = await post(context, workspaceId, botId, "What time is it?");
		expect(first.body).toMatch(ISO_TIME);
		expect(first.body).toContain('"status":"completed"');
		const second = await post(context, workspaceId, botId, "And now?");
		expect(second.body).toContain('"status":"completed"');

		const models = (await workersAiRequests(accountId)).map((request) => request.model);
		expect(models).toEqual([DEEPSEEK, GLM, GLM, GLM, GLM]);
		await open(page, "/settings");
		await modelAccess(page)
			.getByText("Included model: GLM-5.3, provided by this deployment")
			.waitFor();
	});
});

describe("Settings and the pair select", () => {
	it("show the included model on one line and as its own group", async () => {
		const { page, context } = await owner();
		await offerIncluded(context, true);
		const key = await openCodeKey();
		const connected = await context.request.post("/api/models/opencode", {
			data: { key, model: "gpt-5.4-mini" },
		});
		expect(connected.status()).toBe(204);

		await open(page, "/settings");
		const section = modelAccess(page);
		await section
			.getByText("Included model: DeepSeek V4.1 Flash, provided by this deployment")
			.waitFor();
		const trigger = section.getByRole("button", { name: "Default model" });
		await expect(trigger.textContent()).resolves.toBe("gpt-5.4-mini · OpenCode");

		await trigger.click();
		const picker = page.getByRole("dialog", { name: "Models" });
		await expect(
			picker.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => tab.ariaLabel)),
		).resolves.toEqual(["OpenCode", "Included"]);
		await picker.getByRole("tab", { name: "Included" }).click();
		await picker.getByRole("option", { name: "DeepSeek V4.1 Flash" }).click();
		await expect.poll(() => trigger.textContent()).toBe("DeepSeek V4.1 Flash · Included");

		// The choice holds, and the next turn runs on it rather than on the key.
		await open(page, "/settings");
		await expect(trigger.textContent()).resolves.toBe("DeepSeek V4.1 Flash · Included");
		await expect(openCodeRequests(key)).resolves.toHaveLength(1);
	});

	it("show it nowhere when the stage leaves it off", async () => {
		const { page } = await owner();

		await open(page, "/settings");
		await modelAccess(page).getByRole("button", { name: "Connect an OpenCode API key" }).waitFor();
		await expect(modelAccess(page).getByText("Included model").count()).resolves.toBe(0);
	});
});

describe("without the included model or a usable connection", () => {
	it("makes no model call", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const before = (await workersAiRequests()).length;

		await open(page, "/");
		await expect(composer(page).isDisabled()).resolves.toBe(true);
		const refused = await post(context, workspaceId, botId, "Anyone there?");
		expect(refused.status).toBe(409);
		expect((await workersAiRequests()).length).toBe(before);
	});
});

describe("an included model the owner hasn't chosen", () => {
	it("is no default, so a bot is refused rather than moved to it, after a disconnect too", async () => {
		const { page, context, accountId, workspaceId, botId } = await owner();
		await offerIncluded(context, true);
		const view = async () => (await context.request.get("/api/models")).json() as Promise<unknown>;
		await expect(view()).resolves.toMatchObject({
			defaultPair: null,
			included: "DeepSeek V4.1 Flash",
		});
		await open(page, "/");
		await expect(composer(page).isDisabled()).resolves.toBe(true);
		expect((await post(context, workspaceId, botId, "Anyone there?")).status).toBe(409);

		const key = await openCodeKey();
		const connected = await context.request.post("/api/models/opencode", {
			data: { key, model: "gpt-5.4-mini" },
		});
		expect(connected.status()).toBe(204);
		expect((await context.request.delete("/api/models/opencode")).status()).toBe(204);
		await expect(view()).resolves.toMatchObject({ defaultPair: null });
		expect((await post(context, workspaceId, botId, "Still there?")).status).toBe(409);
		await expect(workersAiRequests(accountId)).resolves.toEqual([]);
	});
});

describe("a failure on one source", () => {
	it("never moves a turn to the other", async () => {
		const { context, accountId, workspaceId, botId } = await owner();
		await offerIncluded(context, true);
		const key = await openCodeKey();
		await context.request.post("/api/models/opencode", { data: { key, model: "gpt-5.4-mini" } });

		// The key is the default: a refusal fails the turn, and the included model isn't asked.
		await failNextOpenCodeRequest({ status: 400 });
		const onKey = await post(context, workspaceId, botId, "Draft the weekly update.");
		expect(onKey.body).toContain('"status":"failed"');
		await expect(workersAiRequests(accountId)).resolves.toEqual([]);

		// The included model is the default: a refusal fails the turn, and the key isn't used.
		const chosen = await context.request.put("/api/models/default", {
			data: { connectionId: "included", model: "DeepSeek V4.1 Flash" },
		});
		expect(chosen.status()).toBe(204);
		await failNextWorkersAiRequest({ model: DEEPSEEK, status: 400 });
		const onIncluded = await post(context, workspaceId, botId, "Draft the weekly update.");
		expect(onIncluded.body).toContain('"status":"failed"');
		// Withdrawn, it refuses the turn rather than falling to the key.
		await offerIncluded(context, false);
		const withdrawn = await post(context, workspaceId, botId, "Draft the weekly update.");
		expect(withdrawn.status).toBe(409);

		await expect(openCodeRequests(key)).resolves.toHaveLength(2);
		await expect(workersAiRequests(accountId)).resolves.toHaveLength(1);
	});

	it("keeps a bot that overrides to the included model off the default key", async () => {
		const { context, accountId, workspaceId, botId } = await owner();
		await offerIncluded(context, true);
		const key = await openCodeKey();
		await context.request.post("/api/models/opencode", { data: { key, model: "gpt-5.4-mini" } });
		const chosen = await context.request.put(`/api/workspaces/${workspaceId}/bots/${botId}/model`, {
			data: { override: { connectionId: "included", model: "DeepSeek V4.1 Flash" } },
		});
		expect(chosen.status()).toBe(204);

		const turn = await post(context, workspaceId, botId, "What time is it?");
		expect(turn.body).toContain('"status":"completed"');
		await expect(workersAiRequests(accountId)).resolves.toEqual(toolTurn(DEEPSEEK, accountId));

		await offerIncluded(context, false);
		const withdrawn = await post(context, workspaceId, botId, "And now?");
		expect(withdrawn.status).toBe(409);
		// Only the key check on connect: no turn ever reached the key.
		await expect(openCodeRequests(key)).resolves.toHaveLength(1);
	});
});

describe("a limit or an outage on the included model", () => {
	it.each([
		{ status: 429, interruption: "Throttled" },
		{ status: 503, interruption: "Unavailable" },
	])(
		"interrupts the turn at $status, then resumes it on the included model once it answers",
		async ({ status, interruption }) => {
			const { context, accountId, workspaceId, botId } = await owner();
			await useIncluded(context);
			await failNextWorkersAiRequest({ model: DEEPSEEK, status });

			const sent = await post(context, workspaceId, botId, "What time is it?");
			expect(sent.body).toContain('"status":"interrupted"');
			await expect
				.poll(() => turns(context, workspaceId, botId), { timeout: 15_000 })
				.toEqual([
					expect.objectContaining({ pair: INCLUDED_PAIR, status: "completed", interruption }),
				]);
			const models = (await workersAiRequests(accountId)).map((request) => request.model);
			expect(models.length).toBeGreaterThan(2);
			expect(models).toEqual(models.map(() => DEEPSEEK));
		},
	);
});
