import { randomUUID } from "node:crypto";

import type { BrowserContext, Page } from "playwright";
import { describe, expect, inject, it } from "vite-plus/test";

import type { Turn } from "../../src/bot-rpc.ts";
import type { Pair } from "../../src/lib/model-access.ts";
import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import {
	liftOpenCodeLimit,
	openCodeAsked,
	openCodeKey,
	openCodeRequests,
	releaseOpenCodeTurn,
	replyToNextOpenCodeTurn,
} from "./opencode.ts";

/** What a Credentials probe asks, and the key check on connect too. */
const PROBE = "Reply with exactly one word: pong";

const OPENCODE: Pair = { connectionId: "opencode", model: "gpt-5.4-mini" };
const CHATGPT: Pair = { connectionId: "chatgpt", model: "gpt-5.5" };

/** A signed-in owner who has opened their personal workspace, with its Chief of Staff's ID. */
async function owner(user = gitHubUser()) {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, user);
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId, chiefOfStaff } = (await opened.json()) as {
		workspaceId: string;
		chiefOfStaff: { id: string };
	};
	return { ...visitor, workspaceId, botId: chiefOfStaff.id };
}

/** Connects a fresh OpenCode key on `OPENCODE`'s model, which becomes the default pair. */
async function connectKey(context: BrowserContext) {
	const key = await openCodeKey();
	const connected = await context.request.post("/api/models/opencode", {
		data: { key, model: OPENCODE.model },
	});
	expect(connected.status()).toBe(204);
	return key;
}

/**
 * Imports a ChatGPT plan sign-in whose access token simulated OpenAI accepts, as a second
 * connection beside OpenCode, and answers the token.
 */
async function connectChatGPT(context: BrowserContext) {
	const access = `at-MARKER-${randomUUID()}`;
	const refresh = `rt-MARKER-${randomUUID()}`;
	const issued = await fetch(`${inject("upstreamUrl")}/__chatgpt/tokens`, {
		method: "POST",
		body: JSON.stringify({ access, refresh }),
	});
	expect(issued.ok).toBe(true);
	const credential = {
		type: "oauth",
		access,
		refresh,
		expires: Date.now() + 3_600_000,
		clientId: "oaiapp_TEST_client",
		scopes: ["openid", "offline_access", "chatgpt.tokens.use.direct"],
	};
	const imported = await context.request.post("/api/models/chatgpt", { data: { credential } });
	expect(imported.status()).toBe(204);
	return access;
}

/** Every request simulated api.openai.com received with `token`. */
async function chatgptRequests(token: string) {
	const response = await fetch(`${inject("upstreamUrl")}/__chatgpt/requests`);
	const all = (await response.json()) as {
		token: string | null;
		model: unknown;
		roles: string[];
	}[];
	return all.filter((request) => request.token === token);
}

/** Adds a bot to the workspace's membership, standing in for specialist creation. */
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

async function chooseDefault(context: BrowserContext, pair: Pair) {
	const chosen = await context.request.put("/api/models/default", { data: pair });
	expect(chosen.status()).toBe(204);
}

/** Asks the bot to resume `turnId` on `pair`, as the card's Resume does, and answers the status. */
async function resume(
	context: BrowserContext,
	workspaceId: string,
	botId: string,
	turnId: string,
	pair: Pair,
) {
	const response = await context.request.post(
		`${botPath(workspaceId, botId)}/turns/${turnId}/resume`,
		{ data: { pair } },
	);
	return response.status();
}

async function botStored(context: BrowserContext, workspaceId: string, botId: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
	expect(response.status()).toBe(200);
	return (await response.json()) as Record<string, unknown>;
}

/** The bot's only turn, as it stored it. */
async function onlyTurn(context: BrowserContext, workspaceId: string, botId: string) {
	const stored = await botStored(context, workspaceId, botId);
	const turns = Object.entries(stored).flatMap(([name, value]) =>
		name.startsWith("turn:") ? [value as Turn] : [],
	);
	expect(turns).toHaveLength(1);
	return turns[0] as Turn;
}

/** What each turn request on `key` asked, leaving out probes and the key check. */
const turnsAsked = async (key: string) =>
	(await openCodeAsked(key)).filter((asked) => asked !== PROBE);

/**
 * Interrupts one turn on each of `bots` at OpenCode's limit, each after it said
 * "Part <n> so far.". All three are mid-reply when the limit hits.
 */
async function interruptAll(
	context: BrowserContext,
	workspaceId: string,
	key: string,
	bots: string[],
) {
	const streams: Promise<string>[] = [];
	for (const [index, botId] of bots.entries()) {
		await replyToNextOpenCodeTurn({
			deltas: [`Part ${index + 1} so far.`],
			hold: true,
			limited: true,
		});
		streams.push(
			context.request
				.post(`${botPath(workspaceId, botId)}/turns`, { data: { message: `Task ${index + 1}` } })
				.then((response) => response.text()),
		);
		// One at a time, so each bot gets its own scripted reply.
		await expect
			.poll(async () => (await onlyTurn(context, workspaceId, botId).catch(() => null))?.reply, {
				timeout: 10_000,
			})
			.toBe(`Part ${index + 1} so far.`);
	}
	await releaseOpenCodeTurn(key);
	for (const body of await Promise.all(streams)) expect(body).toContain('"status":"interrupted"');
}

describe("three bots interrupted at a limit", () => {
	it("moves only the resumed turn to the new pair, with its progress, and the rest recover on theirs", async () => {
		const { context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		const token = await connectChatGPT(context);
		const bots = [
			botId,
			await addSpecialist(context, workspaceId),
			await addSpecialist(context, workspaceId),
		];
		await interruptAll(context, workspaceId, key, bots);
		const [moved, ...waiting] = bots as [string, string, string];

		// A new default moves nothing by itself.
		await chooseDefault(context, CHATGPT);
		await new Promise((resolve) => setTimeout(resolve, 2000));
		await expect(chatgptRequests(token)).resolves.toEqual([]);
		for (const each of bots) {
			await expect(onlyTurn(context, workspaceId, each)).resolves.toMatchObject({
				pair: OPENCODE,
				status: "interrupted",
			});
		}

		// The owner resumes one turn, twice in a row: it starts once.
		const { id: turnId } = await onlyTurn(context, workspaceId, moved);
		const answers = await Promise.all([
			resume(context, workspaceId, moved, turnId, CHATGPT),
			resume(context, workspaceId, moved, turnId, CHATGPT),
		]);
		expect(answers).toEqual([204, 204]);
		await expect
			.poll(async () => (await onlyTurn(context, workspaceId, moved)).status, { timeout: 15_000 })
			.toBe("completed");
		await expect(onlyTurn(context, workspaceId, moved)).resolves.toMatchObject({
			id: turnId,
			pair: CHATGPT,
			message: "Task 1",
			reply: "Part 1 so far.pong",
		});
		expect(await resume(context, workspaceId, moved, turnId, CHATGPT)).toBe(204);
		const sent = await chatgptRequests(token);
		expect(sent).toHaveLength(1);
		// It carried on from its earlier progress, sent back as the assistant's reply so far.
		expect(sent[0]).toMatchObject({ model: CHATGPT.model });
		expect(sent[0]?.roles).toContain("assistant");

		// The other two stayed where they were, on their own pair.
		for (const each of waiting) {
			await expect(onlyTurn(context, workspaceId, each)).resolves.toMatchObject({
				pair: OPENCODE,
				status: "interrupted",
			});
		}
		await replyToNextOpenCodeTurn({ deltas: [" Done."] });
		await replyToNextOpenCodeTurn({ deltas: [" Done."] });
		await liftOpenCodeLimit(key);
		for (const [index, each] of waiting.entries()) {
			await expect
				.poll(async () => (await onlyTurn(context, workspaceId, each)).status, { timeout: 20_000 })
				.toBe("completed");
			await expect(onlyTurn(context, workspaceId, each)).resolves.toMatchObject({
				pair: OPENCODE,
				reply: `Part ${index + 2} so far. Done.`,
			});
		}
		// OpenCode saw each task once before the limit, and only the two others after it.
		const asked = await turnsAsked(key);
		expect(asked.slice(0, 3)).toEqual(["Task 1", "Task 2", "Task 3"]);
		expect(asked).toHaveLength(5);
		expect(asked.slice(3)).toEqual(expect.arrayContaining(["Task 2", "Task 3"]));
		for (const request of await openCodeRequests(key)) expect(request.model).toBe(OPENCODE.model);
		await expect(chatgptRequests(token)).resolves.toHaveLength(1);
	}, 90_000);
});

describe("another account", () => {
	it("cannot resume this owner's turn", async () => {
		const aliceUser = gitHubUser();
		const alice = await owner(aliceUser);
		const key = await connectKey(alice.context);
		const token = await connectChatGPT(alice.context);
		await interruptAll(alice.context, alice.workspaceId, key, [alice.botId]);
		const { id: turnId } = await onlyTurn(alice.context, alice.workspaceId, alice.botId);

		const bob = await owner();
		await connectChatGPT(bob.context);
		// Through Alice's workspace, and through Bob's own bot.
		await expect(
			resume(bob.context, alice.workspaceId, alice.botId, turnId, CHATGPT),
		).resolves.toBe(404);
		await expect(resume(bob.context, bob.workspaceId, bob.botId, turnId, CHATGPT)).resolves.toBe(
			404,
		);
		const stranger = await newVisitor();
		await expect(
			resume(stranger.context, alice.workspaceId, alice.botId, turnId, CHATGPT),
		).resolves.toBe(401);

		// Signed in again: the stage's sessions lapse after a few idle seconds.
		const again = await owner(aliceUser);
		await expect(onlyTurn(again.context, alice.workspaceId, alice.botId)).resolves.toMatchObject({
			pair: OPENCODE,
			status: "interrupted",
		});
		await expect(chatgptRequests(token)).resolves.toEqual([]);
	});
});

const messages = (page: Page) => page.getByLabel("Messages", { exact: true });

describe("the interruption card", () => {
	it("offers Resume only when the bot's pair differs from the turn's, then settles on the new pair", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await connectChatGPT(context);
		await interruptAll(context, workspaceId, key, [botId]);
		await chooseDefault(context, CHATGPT);
		// The bot's own pair is still the turn's, so there is nowhere new to resume on.
		const overridden = await context.request.put(`${botPath(workspaceId, botId)}/model`, {
			data: { override: OPENCODE },
		});
		expect(overridden.status()).toBe(204);

		await open(page, "/");
		await messages(page).getByText("Part 1 so far.").waitFor();
		await messages(page).getByText("Limit reached", { exact: true }).waitFor();
		const resumeButton = messages(page).getByRole("button", { name: /^Resume on / });
		await expect(resumeButton.count()).resolves.toBe(0);
		await messages(page).getByRole("link", { name: "Model settings" }).waitFor();

		// Inheriting the new default again, the bot would use another pair.
		const inherited = await context.request.put(`${botPath(workspaceId, botId)}/model`, {
			data: { override: null },
		});
		expect(inherited.status()).toBe(204);
		await page.reload();
		await resumeButton.waitFor();
		await expect(resumeButton.textContent()).resolves.toBe("Resume on gpt-5.5 · ChatGPT plan");
		await resumeButton.click();

		await messages(page).getByText("Carried on with gpt-5.5 · ChatGPT plan").waitFor();
		await messages(page).getByText("Part 1 so far.pong").waitFor({ timeout: 15_000 });
		await expect(messages(page).getByRole("button", { name: "Undo" }).count()).resolves.toBe(0);
		await expect(resumeButton.count()).resolves.toBe(0);
		await expect(onlyTurn(context, workspaceId, botId)).resolves.toMatchObject({
			pair: CHATGPT,
			status: "completed",
		});
	}, 60_000);
});
