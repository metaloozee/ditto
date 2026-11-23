// The shared computer's browser health (#37) at the Workspace Worker's fetch seam, with
// Cloudflare's container API and the instance faked at the platform boundary: logins across
// instance stops, the instance up only while used or held, and DevTools locked during take-over.
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	call,
	owner,
	type Platform,
	platform,
	RUN_KEY,
	socketOf,
} from "./containers-platform.fake.ts";

const W = "/w/ws-takeover";
const SID = { name: "SID", value: "google-session-SIMULATED", domain: ".google.com", expires: 2e9 };
const LI_AT = {
	name: "li_at",
	value: "linkedin-session-SIMULATED",
	domain: ".linkedin.com",
	expires: -1,
	session: true,
};

afterEach(() => {
	vi.useRealTimers();
});

describe("logins across instance stops", () => {
	it("saves the cookies after hand-back and restores them into the next instance before it is ready", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/takeover`);
		p.signIn(SID, LI_AT);

		const handBack = await owner(p.env, `${W}/handback`);
		expect(await handBack.json()).toMatchObject({
			saved: { cookies: 2, domains: [".google.com", ".linkedin.com"] },
		});

		await owner(p.env, `${W}/discard`);
		const started = await owner(p.env, `${W}/start`);

		expect(started.status).toBe(200);
		expect(await started.json()).toMatchObject({ restoredCookies: 2 });
		expect(p.jar.map((c) => c.name)).toEqual(["SID", "li_at"]);
		// Chrome reports a session cookie with expires -1; setting that back would expire it.
		expect(p.jar[1]).not.toHaveProperty("expires");
		// Restored before the start answers, so no page the bot opens loads without them.
		expect(p.events.slice(p.events.lastIndexOf("start"))).toContain("Storage.setCookies");
	});

	it("stores the cookies unreadable at rest", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.signIn(SID);
		await owner(p.env, `${W}/cookies/save`);

		const store = p.storage("ws-takeover");
		expect(store.has("cookies")).toBe(true);
		const stored = JSON.stringify([...store.values()]);
		expect(stored).not.toContain(SID.value);
		expect(stored).not.toContain(".google.com");
	});

	it("fails before the instance starts when the cookie key cannot decrypt the stored cookies", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.signIn(SID);
		await owner(p.env, `${W}/stop`);
		p.env.COOKIE_KEY = "another-cookie-key-SIMULATED-0123456789";

		const response = await owner(p.env, `${W}/start`);

		expect(response.status).toBe(500);
		expect(await response.text()).toMatch(/do not decrypt/);
		expect(p.started).toHaveLength(1);
	});

	it("leaves the next instance signed out once the stored cookies are deleted", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.signIn(SID);
		await owner(p.env, `${W}/stop`);

		await owner(p.env, `${W}/cookies`, "DELETE");
		const started = await owner(p.env, `${W}/start`);

		expect(await started.json()).toMatchObject({ restoredCookies: 0 });
		expect(p.jar).toEqual([]);
	});

	it("saves before stopping, and discarding keeps the earlier save as the source", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.signIn(SID);
		await owner(p.env, `${W}/stop`);
		expect(p.destroyed).toBe(1);

		await owner(p.env, `${W}/start`);
		p.jar.length = 0;
		await owner(p.env, `${W}/discard`);
		await owner(p.env, `${W}/start`);

		expect(p.jar.map((c) => c.name)).toEqual(["SID"]);
	});
});

describe("the instance stays up only while it is used", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	});

	/** The bot's DevTools socket through the Worker, as the owner's loopback doorway opens it. */
	async function devtools(p: Platform) {
		const response = await call(
			p.env,
			`${W}/devtools/devtools/browser/fake-browser`,
			{ headers: { upgrade: "websocket" } },
			RUN_KEY,
		);
		const socket = socketOf(response);
		let id = 0;
		return {
			get open() {
				return socket.open;
			},
			close: () => socket.close(1000),
			command(method: string) {
				const sent = ++id;
				return new Promise<unknown>((resolve) => {
					socket.addEventListener("message", ({ data }) => {
						const message = JSON.parse(String(data)) as { id: number };
						if (message.id === sent) resolve(message);
					});
					socket.send(JSON.stringify({ id: sent, method }));
				});
			},
		};
	}

	it("keeps the instance through a bot's DevTools session longer than Cloudflare's idle window", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		const session = await devtools(p);

		for (let minute = 0; minute < 10; minute++) {
			const answered = session.command("Target.getTargets");
			await p.elapse(60_000);
			expect(await answered).toMatchObject({ result: {} });
		}

		expect(p.running).toBe(true);
		expect(session.open).toBe(true);
	});

	it("stops an unheld instance five minutes after its last use, saving its cookies first", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.signIn(SID);
		const session = await devtools(p);
		await session.command("Target.getTargets");
		session.close();

		await p.elapse(4 * 60_000);
		expect(p.running).toBe(true);
		await p.elapse(2 * 60_000);

		expect(p.running).toBe(false);
		expect(p.events.lastIndexOf("Storage.getCookies")).toBeLessThan(p.events.indexOf("destroy"));
		const started = await owner(p.env, `${W}/start`);
		expect(await started.json()).toMatchObject({ restoredCookies: 1 });
	});

	it.each(["takeover", "hold/task"])(
		"keeps an instance %s holds while nobody uses it, and stops it five minutes after release",
		async (hold) => {
			const p = platform();
			await owner(p.env, `${W}/start`);
			await owner(p.env, `${W}/${hold}`);

			await p.elapse(20 * 60_000);
			expect(p.running).toBe(true);

			const release =
				hold === "takeover"
					? owner(p.env, `${W}/handback`)
					: owner(p.env, `${W}/hold/task`, "DELETE");
			expect(await (await release).json()).toMatchObject({ holds: [], saved: { cookies: 0 } });
			await p.elapse(4 * 60_000);
			expect(p.running).toBe(true);
			await p.elapse(2 * 60_000);
			expect(p.running).toBe(false);
		},
	);

	it("keeps holds across Durable Object eviction", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/hold/task`);
		p.evict();

		await owner(p.env, `${W}/status`, "GET");
		await p.elapse(20 * 60_000);

		expect(p.running).toBe(true);
	});

	it("neither touches nor keeps the instance when the owner polls its status", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		const started = (await (await owner(p.env, `${W}/status`, "GET")).json()) as {
			lastActivityAt: number;
		};
		const before = p.forwarded.length;

		for (let poll = 0; poll < 8 && p.running; poll++) {
			await owner(p.env, `${W}/status`, "GET");
			expect(p.forwarded.length).toBe(before);
			await p.elapse(30_000);
		}
		await p.elapse(2 * 60_000);

		expect(p.running).toBe(false);
		const status = await (await owner(p.env, `${W}/status`, "GET")).json();
		expect(status).toMatchObject({
			running: false,
			holds: [],
			lastActivityAt: started.lastActivityAt,
		});
	});

	it("destroys a held instance at the spending deadline, saving its cookies first", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/hold/task`);
		p.signIn(SID);

		await p.elapse(59 * 60_000);
		expect(p.destroyed).toBe(0);
		await p.elapse(2 * 60_000);

		expect(p.destroyed).toBe(1);
		expect(p.events.lastIndexOf("Storage.getCookies")).toBeLessThan(p.events.indexOf("destroy"));
		const started = await owner(p.env, `${W}/start`);
		expect(await started.json()).toMatchObject({ restoredCookies: 1 });
	});
});

describe("DevTools during take-over (ADR-0007)", () => {
	it("locks DevTools before it answers that take-over is ready", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);

		const response = await owner(p.env, `${W}/takeover`);

		expect(await response.json()).toMatchObject({ ready: true });
		expect(p.gateLocked).toBe(true);
	});

	it("refuses the bot's DevTools route from take-over ready until hand-back", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/takeover`);
		const before = p.forwarded.length;

		const during = await owner(p.env, `${W}/devtools/json/list`, "GET");
		expect(during.status).toBe(423);
		expect(p.forwarded.length).toBe(before);

		await owner(p.env, `${W}/handback`);
		const after = await owner(p.env, `${W}/devtools/json/list`, "GET");
		expect(after.status).toBe(200);
		expect(p.gateLocked).toBe(false);
	});

	it("never reports take-over ready when DevTools did not lock", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.failGate();

		const response = await owner(p.env, `${W}/takeover`);

		expect(response.status).toBe(502);
		const status = await (await owner(p.env, `${W}/status`, "GET")).json();
		expect(status).toMatchObject({ holds: [] });
	});

	it("unlocks DevTools before saving the cookies on hand-back", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/takeover`);

		await owner(p.env, `${W}/handback`);

		expect(p.events.indexOf("gate unlock")).toBeLessThan(
			p.events.lastIndexOf("Storage.getCookies"),
		);
	});
});
