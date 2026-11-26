import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { stateView } from "../../src/lib/model-access.ts";
import { open } from "../auth/visitor.ts";
import {
	limitOpenCode,
	clearOpenCodeFault,
	openCodeAsked,
	openCodeRequests,
	replyToNextOpenCodeTurn,
} from "./opencode.ts";
import {
	botPath,
	botStored,
	connectKey,
	messages,
	owner,
	PHONE,
	post,
	PROBE,
	send,
} from "./owner.ts";

/** The account's OpenCode connection, as `GET /api/models` answers it. */
async function connection(context: BrowserContext) {
	const view = (await (await context.request.get("/api/models")).json()) as {
		connections: { state: string; resetsAt?: string }[];
	};
	return view.connections[0];
}

/** The turns the bot stored, without its queue or its unfinished pointer. */
const turnsIn = (stored: Record<string, unknown>) =>
	Object.entries(stored).flatMap(([name, value]) => (name.startsWith("turn:") ? [value] : []));

/** What a turn's requests asked, leaving out probes and the key check. */
const turnsAsked = async (key: string) =>
	(await openCodeAsked(key)).filter((asked) => asked !== PROBE);

describe("a limit mid-turn", () => {
	it("keeps the reply so far, queues what the owner sends and resumes in order on recovery", async () => {
		const { page, context } = await owner();
		const key = await connectKey(context);
		await replyToNextOpenCodeTurn({
			deltas: ["I got through ", "the first two sections."],
			limited: true,
		});

		await open(page, "/");
		await send(page, "Draft the weekly update.");
		await messages(page).getByText("I got through the first two sections.").waitFor();
		const card = messages(page).getByText("Limit reached", { exact: true });
		await card.waitFor();
		await messages(page).getByText("Your bots carry on when it lifts.").waitFor();
		await expect(
			messages(page)
				.getByText(/Resets at/)
				.count(),
		).resolves.toBe(0);
		await expect(
			messages(page).getByRole("link", { name: "Model settings" }).count(),
		).resolves.toBe(1);
		const throttledAt = (await openCodeRequests(key)).length;

		// Sending still works while limited, and each message waits its turn.
		await send(page, "Also add the hiring numbers.");
		await send(page, "And the budget.");
		await expect.poll(() => messages(page).getByText("Queued", { exact: true }).count()).toBe(2);

		const settings = await context.newPage();
		await open(settings, "/settings");
		await settings
			.getByRole("region", { name: "Model access" })
			.getByText("Limit reached", { exact: true })
			.waitFor();
		await settings.close();

		// Probes back off while limited: one after a second, the next two seconds later, …
		await new Promise((resolve) => setTimeout(resolve, 4500));
		const probes = (await openCodeRequests(key)).length - throttledAt;
		expect(probes).toBeGreaterThanOrEqual(1);
		expect(probes).toBeLessThanOrEqual(3);
		// Nothing the owner sent reached OpenCode yet.
		await expect(turnsAsked(key)).resolves.toEqual(["Draft the weekly update."]);

		await replyToNextOpenCodeTurn({ deltas: [" Then the third."] });
		await replyToNextOpenCodeTurn({ deltas: ["Hiring is up by three."] });
		await replyToNextOpenCodeTurn({ deltas: ["The budget holds."] });
		await clearOpenCodeFault(key);

		await messages(page)
			.getByText("I got through the first two sections. Then the third.")
			.waitFor({ timeout: 20_000 });
		await messages(page).getByText("Carried on with deepseek-v4.1-flash · OpenCode").waitFor();
		await messages(page).getByText("Hiring is up by three.").waitFor({ timeout: 10_000 });
		await messages(page).getByText("The budget holds.").waitFor({ timeout: 10_000 });
		await expect(messages(page).getByText("Queued", { exact: true }).count()).resolves.toBe(0);

		// The turn resumed on its own pair, then the queue ran once each, in order.
		await expect(turnsAsked(key)).resolves.toEqual([
			"Draft the weekly update.",
			"Draft the weekly update.",
			"Also add the hiring numbers.",
			"And the budget.",
		]);
		for (const request of await openCodeRequests(key))
			expect(request.model).toBe("deepseek-v4.1-flash");
		await expect(connection(context)).resolves.toMatchObject({ state: "Connected" });
	}, 90_000);
});

describe("a limit with a reset time", () => {
	it("shows when it resets, on the card at phone width and in Settings", async () => {
		const { page, context } = await owner(PHONE);
		const key = await connectKey(context);
		await limitOpenCode(key, { retryAfter: 1800 });

		await open(page, "/");
		await send(page, "Plan tomorrow.");
		const card = messages(page).getByText("Limit reached", { exact: true });
		await card.waitFor();

		const limited = await connection(context);
		expect(limited?.state).toBe("Throttled");
		expect(limited?.resetsAt).toBeDefined();
		const resetsAt = new Date(limited?.resetsAt ?? "");
		// Within a few seconds of the 30 minutes OpenCode said.
		expect(Math.abs(resetsAt.getTime() - Date.now() - 1800_000)).toBeLessThan(15_000);
		const detail = stateView({ provider: "opencode", state: "Throttled", resetsAt }).detail ?? "";
		expect(detail).toMatch(/^Resets at /);

		const line = messages(page).getByText(detail);
		await line.waitFor();
		// The card fits the phone's width.
		const box = await messages(page).getByText("deepseek-v4.1-flash · OpenCode").boundingBox();
		expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
		await open(page, "/settings");
		await page.getByRole("region", { name: "Model access" }).getByText(detail).waitFor();

		// The turn never got through, so it kept no reply, and OpenCode saw it once.
		await expect(turnsAsked(key)).resolves.toEqual(["Plan tomorrow."]);
	});
});

describe("an interrupted turn and its queue", () => {
	it("survive the Bot object's eviction, then resume when the limit lifts", async () => {
		const { page, context, workspaceId, botId } = await owner();
		const key = await connectKey(context);
		await replyToNextOpenCodeTurn({ deltas: ["Half done."], limited: true });

		const interrupted = await post(context, workspaceId, botId, "Write the brief.");
		expect(interrupted.status).toBe(200);
		expect(interrupted.body).toContain('"status":"interrupted"');
		const queued = await post(context, workspaceId, botId, "Then the summary.");
		expect(queued.status).toBe(202);

		const evicted = await context.request.post(`${botPath(workspaceId, botId)}/__test/evict`);
		expect(evicted.status()).toBe(204);
		const stored = await botStored(context, workspaceId, botId);
		const [turn] = turnsIn(stored) as { id: string }[];
		expect(turn).toMatchObject({
			pair: { connectionId: "opencode", model: "deepseek-v4.1-flash" },
			message: "Write the brief.",
			reply: "Half done.",
			status: "interrupted",
			interruption: "Throttled",
		});
		expect(stored.unfinished).toBe(turn?.id);
		expect(stored.queue).toEqual([expect.objectContaining({ message: "Then the summary." })]);

		// A fresh visit shows the waiting work.
		await open(page, "/");
		await messages(page).getByText("Half done.").waitFor();
		await messages(page).getByText("Limit reached", { exact: true }).waitFor();
		await messages(page).getByText("Queued", { exact: true }).waitFor();

		await replyToNextOpenCodeTurn({ deltas: [" All done."] });
		await replyToNextOpenCodeTurn({ deltas: ["Summary ready."] });
		await clearOpenCodeFault(key);
		await expect
			.poll(
				async () => {
					const after = await botStored(context, workspaceId, botId);
					return turnsIn(after)
						.map((each) => (each as { reply: string }).reply)
						.sort();
				},
				{ timeout: 20_000 },
			)
			.toEqual(["Half done. All done.", "Summary ready."]);
		const after = await botStored(context, workspaceId, botId);
		expect(after.unfinished).toBeUndefined();
		expect(after.queue).toEqual([]);
		await expect(turnsAsked(key)).resolves.toEqual([
			"Write the brief.",
			"Write the brief.",
			"Then the summary.",
		]);
		await messages(page).getByText("Summary ready.").waitFor();
	}, 60_000);
});

describe("another account's connection", () => {
	it("stays Connected and keeps answering while this one is limited", async () => {
		const alice = await owner();
		const bob = await owner();
		const aliceKey = await connectKey(alice.context);
		const bobKey = await connectKey(bob.context);
		await limitOpenCode(aliceKey);

		const limited = await post(alice.context, alice.workspaceId, alice.botId, "Hello?");
		expect(limited.body).toContain('"status":"interrupted"');
		await expect(connection(alice.context)).resolves.toMatchObject({ state: "Throttled" });
		// While limited, Alice's bot queues instead of calling.
		const waiting = await post(alice.context, alice.workspaceId, alice.botId, "Still there?");
		expect(waiting.status).toBe(202);
		await expect(turnsAsked(aliceKey)).resolves.toEqual(["Hello?"]);

		const answered = await post(bob.context, bob.workspaceId, bob.botId, "Hello from Bob");
		expect(answered.body).toContain('"status":"completed"');
		await expect(connection(bob.context)).resolves.toMatchObject({ state: "Connected" });
		await expect(turnsAsked(bobKey)).resolves.toEqual(["Hello from Bob"]);
	});
});
