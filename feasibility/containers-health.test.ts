// The shared computer's browser health (#37) at the Workspace Worker's fetch seam, with
// Cloudflare's container API and the instance faked at the platform boundary: logins across
// instance stops, keep-alive only while held, and DevTools locked during take-over.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { owner, platform } from "./containers-platform.fake.ts";

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

		expect(p.store.has("cookies")).toBe(true);
		const stored = JSON.stringify([...p.store.values()]);
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

	it("saves the cookies when the spending deadline destroys the instance", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		p.signIn(SID);
		const deadline = p.alarms[0] ?? 0;

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(deadline);
		await p.objects.get("ws-takeover")?.alarm();

		expect(p.destroyed).toBe(1);
		expect(p.events).toContain("Storage.getCookies");
		expect(p.events.indexOf("Storage.getCookies")).toBeLessThan(p.events.indexOf("destroy"));
	});
});

describe("keep-alive only while held", () => {
	const touches = (p: ReturnType<typeof platform>) =>
		p.forwarded.filter((f) => f.port === 8081 && f.url.endsWith("/ready")).length;

	it("leaves an instance alone when nothing holds it, so Cloudflare's idle stop can take it", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		const before = touches(p);

		await p.objects.get("ws-takeover")?.alarm();

		expect(touches(p)).toBe(before);
		expect(p.destroyed).toBe(0);
	});

	it.each(["takeover", "hold/task"])(
		"touches the instance every 30 s while %s holds it",
		async (hold) => {
			const p = platform();
			await owner(p.env, `${W}/start`);
			await owner(p.env, `${W}/${hold}`);
			const before = touches(p);
			const now = Date.now();

			await p.objects.get("ws-takeover")?.alarm();
			await p.objects.get("ws-takeover")?.alarm();

			expect(touches(p)).toBe(before + 2);
			expect(p.alarms.at(-1)).toBeGreaterThanOrEqual(now + 30_000);
			expect(p.alarms.at(-1)).toBeLessThan(now + 60_000);
		},
	);

	it("stops touching it and saves the cookies once the last hold is released", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/hold/task`);
		p.signIn(SID);

		const released = await owner(p.env, `${W}/hold/task`, "DELETE");
		expect(await released.json()).toMatchObject({ holds: [], saved: { cookies: 1 } });
		const before = touches(p);
		await p.objects.get("ws-takeover")?.alarm();

		expect(touches(p)).toBe(before);
	});

	it("keeps holds across Durable Object eviction", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		await owner(p.env, `${W}/hold/task`);
		p.evict();

		await owner(p.env, `${W}/status`, "GET");
		const before = touches(p);
		await p.objects.get("ws-takeover")?.alarm();

		expect(touches(p)).toBe(before + 1);
	});

	it("reports whether the instance runs without touching it, so the idle stop can be timed", async () => {
		const p = platform();
		await owner(p.env, `${W}/start`);
		const before = p.forwarded.length;
		p.stopInstance();

		const status = await (await owner(p.env, `${W}/status`, "GET")).json();

		expect(status).toMatchObject({ running: false, holds: [], lastActivityAt: expect.any(Number) });
		expect(p.forwarded.length).toBe(before);
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
