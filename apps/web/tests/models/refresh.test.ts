import { readFile } from "node:fs/promises";

import type { BrowserContext, Page } from "playwright";
import { describe, expect, inject, it } from "vite-plus/test";

import { continueWithGitHub, gitHubUser, newVisitor, open } from "../auth/visitor.ts";
import {
	chatgptCredential,
	chatgptRefreshes,
	chatgptRequests,
	endRefreshTrouble,
	markerOf,
	planNextRefresh,
	rejectAccessToken,
	releaseRefresh,
	revokeRefreshToken,
	startRefreshTrouble,
} from "./chatgpt.ts";

/** A signed-in owner with their workspace open, its Chief of Staff and one specialist. */
async function owner() {
	const visitor = await newVisitor();
	await continueWithGitHub(visitor.page, gitHubUser());
	const opened = await visitor.context.request.post("/api/workspaces/open");
	expect(opened.status()).toBe(200);
	const { workspaceId, chiefOfStaff } = (await opened.json()) as {
		workspaceId: string;
		chiefOfStaff: { id: string };
	};
	const specialist = `bot-${crypto.randomUUID()}`;
	const added = await visitor.context.request.post(
		`/api/workspaces/${workspaceId}/__test/members`,
		{ data: { id: specialist, name: "Researcher" } },
	);
	expect(added.status()).toBe(204);
	return { ...visitor, workspaceId, bots: [chiefOfStaff.id, specialist] as const };
}

/** Imports a ChatGPT plan sign-in whose access token has already expired. */
async function importExpired(context: BrowserContext) {
	const credential = await chatgptCredential({ expired: true });
	const imported = await context.request.post("/api/models/chatgpt", { data: { credential } });
	expect(imported.status()).toBe(204);
	return credential;
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

/** Sends `message` while the plan can't be used, which queues it, and answers its ID. */
async function queue(context: BrowserContext, workspaceId: string, botId: string) {
	const sent = await post(context, workspaceId, botId, "Draft the update.");
	expect(sent.status).toBe(202);
	return (JSON.parse(sent.body) as { queued: string }).queued;
}

async function storedTurn(context: BrowserContext, workspaceId: string, botId: string, id: string) {
	const response = await context.request.get(`${botPath(workspaceId, botId)}/__test/stored`);
	return ((await response.json()) as Record<string, unknown>)[`turn:${id}`];
}

async function chatgptState(context: BrowserContext) {
	const response = await context.request.get("/api/models");
	const { connections } = (await response.json()) as { connections: { state: string }[] };
	return connections[0]?.state;
}

const rotationCount = (refresh: string) => chatgptRefreshes(refresh).then((all) => all.length);

const modelAccess = (page: Page) => page.getByRole("region", { name: "Model access" });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("an expired ChatGPT plan token", () => {
	it("is rotated once for two bots asking together, shows Refreshing meanwhile, and both turns succeed", async () => {
		const { page, context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		await planNextRefresh({ hold: true });

		const turns = bots.map((botId) => post(context, workspaceId, botId, "Draft the update."));
		await expect.poll(() => rotationCount(credential.refresh)).toBe(1);
		await expect.poll(() => chatgptState(context)).toBe("Refreshing");
		await open(page, "/settings");
		await modelAccess(page).getByText("Refreshing", { exact: true }).waitFor();
		await expect(
			modelAccess(page).getByRole("button", { name: "Disconnect ChatGPT plan" }).count(),
		).resolves.toBe(0);
		// Both bots are waiting now; the second joins the rotation in flight.
		await pause(1000);
		await releaseRefresh();

		for (const turn of await Promise.all(turns)) {
			expect(turn.status).toBe(200);
			expect(turn.body).toContain('"status":"completed"');
		}
		const [rotation] = await chatgptRefreshes(credential.refresh);
		expect(rotation).toMatchObject({
			presented: credential.refresh,
			clientId: credential.clientId,
			resource: "https://api.openai.com/v1",
		});
		await expect(chatgptRequests(credential.access)).resolves.toEqual([]);
		await expect(chatgptRequests(rotation?.issued?.access ?? "none")).resolves.toHaveLength(2);
		await expect(chatgptState(context)).resolves.toBe("Connected");
		// The replacement was kept: a later turn needs no rotation.
		expect((await post(context, workspaceId, bots[0], "And again.")).status).toBe(200);
		await expect(rotationCount(credential.refresh)).resolves.toBe(1);
	});

	it("saves the replacement before answering either bot, so an eviction between the two loses nothing", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		const evicting = await context.request.post("/api/models/__test/evict-after-rotation");
		expect(evicting.status()).toBe(204);
		await planNextRefresh({ hold: true });

		const turns = bots.map((botId) => post(context, workspaceId, botId, "Draft the update."));
		await expect.poll(() => rotationCount(credential.refresh)).toBe(1);
		await pause(1000);
		await releaseRefresh();

		// The object was dropped before it answered; the bots asked again and got the saved token.
		for (const turn of await Promise.all(turns)) {
			expect(turn.status).toBe(200);
			expect(turn.body).toContain('"status":"completed"');
		}
		const rotations = await chatgptRefreshes(credential.refresh);
		expect(rotations).toHaveLength(1);
		await expect(chatgptRequests(rotations[0]?.issued?.access ?? "none")).resolves.toHaveLength(2);
		await expect(chatgptState(context)).resolves.toBe("Connected");
	});

	it("recovers from a lost rotation answer without the owner when OpenAI still takes the old refresh token", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		await planNextRefresh({ lose: true, oldStillAccepted: true });

		const queued = await queue(context, workspaceId, bots[0]);
		await expect
			.poll(() => storedTurn(context, workspaceId, bots[0], queued), { timeout: 20_000 })
			.toMatchObject({ status: "completed", reply: "pong" });
		const rotations = await chatgptRefreshes(credential.refresh);
		expect(rotations.map((each) => each.presented)).toEqual([
			credential.refresh,
			credential.refresh,
		]);
		await expect(chatgptRequests(rotations[1]?.issued?.access ?? "none")).resolves.not.toEqual([]);
		await expect(chatgptState(context)).resolves.toBe("Connected");
	}, 60_000);

	it("shows Reconnect needed after a lost rotation answer when OpenAI no longer takes the old refresh token", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		await planNextRefresh({ lose: true });

		const queued = await queue(context, workspaceId, bots[0]);
		await expect.poll(() => chatgptState(context), { timeout: 20_000 }).toBe("ReconnectNeeded");
		const rotations = await rotationCount(credential.refresh);
		await pause(3000);
		await expect(rotationCount(credential.refresh)).resolves.toBe(rotations);
		await expect(storedTurn(context, workspaceId, bots[0], queued)).resolves.toBeUndefined();
	}, 60_000);

	it("shows Reconnect needed for a revoked refresh token, and never tries it again", async () => {
		const { page, context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		await revokeRefreshToken(credential.refresh);

		await queue(context, workspaceId, bots[0]);
		await expect(chatgptState(context)).resolves.toBe("ReconnectNeeded");
		await open(page, "/settings");
		const section = modelAccess(page);
		await section.getByText("Reconnect needed", { exact: true }).waitFor();
		await section.getByText("OpenAI no longer accepts this sign-in.").waitFor();
		await section.getByRole("button", { name: "Reconnect ChatGPT plan" }).waitFor();

		// Neither another turn, another bot, Check again nor time sends it again.
		await queue(context, workspaceId, bots[0]);
		await queue(context, workspaceId, bots[1]);
		const checked = await context.request.post("/api/models/chatgpt/check");
		expect(await checked.json()).toEqual({ state: "ReconnectNeeded" });
		await pause(3000);
		await expect(rotationCount(credential.refresh)).resolves.toBe(1);
		await expect(chatgptRequests()).resolves.not.toContainEqual(
			expect.objectContaining({ token: credential.access }),
		);
	}, 60_000);

	it.each([
		{ status: 429, state: "Throttled", label: "Limit reached" },
		{ status: 503, state: "Unavailable", label: "Unavailable" },
	])(
		"shows $label when a rotation meets $status, and retries it with backoff until it answers",
		async ({ status, state, label }) => {
			const { page, context, workspaceId, bots } = await owner();
			const credential = await importExpired(context);
			await startRefreshTrouble({ status });

			const queued = await queue(context, workspaceId, bots[0]);
			await expect(chatgptState(context)).resolves.toBe(state);
			await open(page, "/settings");
			await modelAccess(page).getByText(label, { exact: true }).waitFor();

			// Retries back off: over six seconds, at most one a second, doubling. Asking each second
			// also keeps the short test session alive.
			for (let second = 0; second < 6; second++) {
				await pause(1000);
				await expect(chatgptState(context)).resolves.toBe(state);
			}
			const during = await rotationCount(credential.refresh);
			expect(during).toBeGreaterThanOrEqual(3);
			expect(during).toBeLessThanOrEqual(6);

			await endRefreshTrouble();
			await expect
				.poll(() => storedTurn(context, workspaceId, bots[0], queued), { timeout: 20_000 })
				.toMatchObject({ status: "completed", reply: "pong" });
			await expect(chatgptState(context)).resolves.toBe("Connected");
		},
		60_000,
	);

	it("never hands the Bot a refresh token, the original or its replacement", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);

		const turn = await post(context, workspaceId, bots[0], "Summarize my week.");
		expect(turn.status).toBe(200);
		const [rotation] = await chatgptRefreshes(credential.refresh);
		const replacement = rotation?.issued?.refresh ?? "";
		expect(replacement).toContain("MARKER");
		const markers = [markerOf(credential.refresh), markerOf(replacement)];

		const botAtRest = await (
			await context.request.get(`${botPath(workspaceId, bots[0])}/__test/stored`)
		).text();
		expect(botAtRest).toContain('"status":"completed"');
		const atRest = await (await context.request.get("/api/models/__test/stored")).text();
		const view = await (await context.request.get("/api/models")).text();
		const log = await readFile(inject("stageLog"), "utf8");
		for (const marker of markers) {
			for (const seen of [turn.body, botAtRest, atRest, view, log]) {
				expect(seen).not.toContain(marker);
			}
		}
	});
});

describe("a rotation the owner overtook", () => {
	it("is dropped when the plan was disconnected meanwhile, and the waiting turn is refused", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		await planNextRefresh({ hold: true });

		const sent = post(context, workspaceId, bots[0], "Draft the update.");
		await expect.poll(() => rotationCount(credential.refresh)).toBe(1);
		expect((await context.request.delete("/api/models/chatgpt")).status()).toBe(204);
		await releaseRefresh();

		const refused = await sent;
		expect(refused.status).toBe(409);
		const atRest = await (await context.request.get("/api/models/__test/stored")).text();
		expect(atRest).not.toContain("connection:chatgpt");
		await expect(chatgptState(context)).resolves.toBeUndefined();
		const [rotation] = await chatgptRefreshes(credential.refresh);
		await expect(chatgptRequests(rotation?.issued?.access ?? "none")).resolves.toEqual([]);
	});

	it("gives way to a newer import, whose token the waiting turn uses", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await importExpired(context);
		await planNextRefresh({ hold: true });

		const sent = post(context, workspaceId, bots[0], "Draft the update.");
		await expect.poll(() => rotationCount(credential.refresh)).toBe(1);
		const newer = await chatgptCredential();
		const imported = await context.request.post("/api/models/chatgpt", {
			data: { credential: newer },
		});
		expect(imported.status()).toBe(204);
		await releaseRefresh();

		const turn = await sent;
		expect(turn.body).toContain('"status":"completed"');
		const [rotation] = await chatgptRefreshes(credential.refresh);
		await expect(chatgptRequests(rotation?.issued?.access ?? "none")).resolves.toEqual([]);
		await expect(chatgptRequests(newer.access)).resolves.toHaveLength(1);
		// The newer import is what stays.
		expect((await post(context, workspaceId, bots[0], "And again.")).status).toBe(200);
		await expect(chatgptRequests(newer.access)).resolves.toHaveLength(2);
	});
});

describe("an access token OpenAI refuses before it expires", () => {
	it("is rotated once, and the turn carries on with the replacement", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await chatgptCredential();
		const imported = await context.request.post("/api/models/chatgpt", { data: { credential } });
		expect(imported.status()).toBe(204);
		await rejectAccessToken(credential.access);

		const turn = await post(context, workspaceId, bots[0], "Draft the update.");
		expect(turn.body).toContain('"status":"completed"');
		const rotations = await chatgptRefreshes(credential.refresh);
		expect(rotations).toHaveLength(1);
		await expect(chatgptRequests(credential.access)).resolves.toHaveLength(1);
		await expect(chatgptRequests(rotations[0]?.issued?.access ?? "none")).resolves.toHaveLength(1);
		await expect(chatgptState(context)).resolves.toBe("Connected");
	});

	it("needs a reconnect once the rotation is refused too", async () => {
		const { context, workspaceId, bots } = await owner();
		const credential = await chatgptCredential();
		const imported = await context.request.post("/api/models/chatgpt", { data: { credential } });
		expect(imported.status()).toBe(204);
		await rejectAccessToken(credential.access);
		await revokeRefreshToken(credential.refresh);

		const turn = await post(context, workspaceId, bots[0], "Draft the update.");
		expect(turn.body).toContain('"status":"interrupted"');
		await expect(chatgptState(context)).resolves.toBe("ReconnectNeeded");
		await expect(rotationCount(credential.refresh)).resolves.toBe(1);
	});
});
