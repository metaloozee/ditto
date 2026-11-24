// The Containers trial Worker (#32) at its fetch seam, with Cloudflare's container API faked at
// the platform boundary. It starts a billed Chrome instance and exposes a screen that holds the
// owner's logins, so every entry point but the take-over view sits behind the run key. The view
// needs the owner's sign-in instead (containers-owner-view.test.ts).
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { call, ORIGIN, platform, RUN_KEY } from "./containers-platform.fake.ts";

afterEach(() => {
	vi.useRealTimers();
});

const entryPoints: [string, RequestInit][] = [
	["/w/ws-cloud-trial/start", { method: "POST" }],
	["/w/ws-cloud-trial/stop", { method: "POST" }],
	["/w/ws-takeover/devtools/json/list", {}],
	["/w/ws-cloud-trial/control/decisions", {}],
	["/", {}],
];

describe("run-key gate", () => {
	for (const [path, init] of entryPoints) {
		it.each([
			["no key", undefined],
			["a wrong key", "wrong"],
			["the key with a suffix", `${RUN_KEY}x`],
		])(`refuses ${init.method ?? "GET"} ${path} with %s and starts nothing`, async (_, key) => {
			const p = platform();
			const response = await call(p.env, path, init, key);

			expect(response.status).toBe(401);
			expect(p.objects.size).toBe(0);
			expect(p.started).toEqual([]);
		});
	}

	it("refuses everything when no run key is configured, even an empty key", async () => {
		const p = platform();
		p.env.TRIAL_RUN_KEY = "";
		const response = await call(p.env, "/w/ws-cloud-trial/start", { method: "POST" }, "");

		expect(response.status).toBe(401);
		expect(p.started).toEqual([]);
	});

	it("refuses a workspace without a destination list in the image", async () => {
		const p = platform();
		const response = await call(p.env, "/w/ws-other/start", { method: "POST" }, RUN_KEY);

		expect(response.status).toBe(404);
		expect(p.objects.size).toBe(0);
	});
});

describe("workspace computer", () => {
	it("starts the container with the workspace identity, internet on, and a spending deadline", async () => {
		const p = platform();
		const response = await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);

		expect(response.status).toBe(200);
		expect(p.started).toEqual([
			expect.objectContaining({ env: { WORKSPACE_ID: "ws-takeover" }, enableInternet: true }),
		]);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ workspace: "ws-takeover", instanceType: "standard-1" });
		expect(body.startupMs).toEqual(expect.any(Number));
	});

	it("keeps the first start's deadline when the owner starts a running instance again", async () => {
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		const p = platform();
		await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);
		await call(p.env, "/w/ws-takeover/hold/task", { method: "POST" }, RUN_KEY);
		await p.elapse(30 * 60_000);
		await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);
		await p.elapse(31 * 60_000);

		expect(p.started).toHaveLength(1);
		expect(p.destroyed).toBe(1);
	});

	it.each(["", "sixty", "0", "-5"])(
		"refuses to start without a valid spending deadline (MAX_MINUTES %j)",
		async (minutes) => {
			const p = platform();
			p.env.MAX_MINUTES = minutes;
			const response = await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);

			expect(response.status).toBe(500);
			expect(p.started).toEqual([]);
		},
	);

	it("gives each workspace its own instance", async () => {
		const p = platform();
		await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);
		await call(p.env, "/w/ws-cloud-trial/start", { method: "POST" }, RUN_KEY);

		expect([...p.objects.keys()]).toEqual(["ws-takeover", "ws-cloud-trial"]);
	});

	it("never starts a container from a view, DevTools or control request", async () => {
		const p = platform();
		const response = await call(p.env, "/w/ws-takeover/devtools/json/list", {}, RUN_KEY);

		expect(response.status).toBe(409);
		expect(p.started).toEqual([]);
	});

	it.each([
		["devtools", "/w/ws-takeover/devtools/json/list", 9223, "/json/list"],
		["control", "/w/ws-takeover/control/decisions", 8081, "/decisions"],
	])("forwards %s to its port without the run key", async (_, path, port, rest) => {
		const p = platform();
		await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);
		p.forwarded.length = 0;

		const response = await call(p.env, path, { headers: { origin: ORIGIN } }, RUN_KEY);

		expect(await response.text()).toBe(`port ${port}`);
		const [sent] = p.forwarded;
		// DevTools accepts only an IP or localhost Host and returns WebSocket URLs on it, so the
		// owner's loopback proxy on 127.0.0.1:9222 stays in the path.
		expect(sent?.url).toBe(`http://127.0.0.1:${port === 9223 ? 9222 : port}${rest}`);
		expect(sent?.headers.get("x-trial-key")).toBeNull();
		expect(sent?.headers.get("origin")).toBeNull();
	});

	it("destroys the instance on stop and MAX_MINUTES after a start, even while held", async () => {
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		const p = platform();
		await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);
		await call(p.env, "/w/ws-takeover/stop", { method: "POST" }, RUN_KEY);
		expect(p.destroyed).toBe(1);

		await call(p.env, "/w/ws-takeover/start", { method: "POST" }, RUN_KEY);
		await call(p.env, "/w/ws-takeover/hold/task", { method: "POST" }, RUN_KEY);
		await p.elapse(59 * 60_000);
		expect(p.destroyed).toBe(1);
		await p.elapse(2 * 60_000);
		expect(p.destroyed).toBe(2);
	});
});
