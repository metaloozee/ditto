// The take-over stack (#29) without signing in: the screen is reachable only on loopback, and
// each login page loads through the egress filter with the ws-takeover destination list.
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { Tab } from "./takeover/cdp.ts";
import { workflows } from "./takeover/workflows.ts";

const run = promisify(execFile);
const workspace = "ws-takeover";
const viewPort = 16080;
const devtoolsPort = 19222;
const env = {
	...process.env,
	WORKSPACE_ID: workspace,
	DESTINATIONS_DIR: path.join(import.meta.dirname, "takeover/destinations"),
	VIEW_PORT: String(viewPort),
	DEVTOOLS_PORT: String(devtoolsPort),
};
// A separate project, so the test never touches the owner's signed-in profile.
const compose = (...args: string[]) =>
	run(
		"docker",
		[
			"compose",
			"-p",
			"ditto-feasibility-takeover-test",
			"-f",
			path.join(import.meta.dirname, "takeover/compose.yaml"),
			...args,
		],
		{ env, maxBuffer: 64 * 1024 * 1024 },
	);

type Decision = { workspace: string; host: string; decision: "allow" | "deny" };

async function filterLog(): Promise<Decision[]> {
	const { stdout } = await compose("logs", "--no-log-prefix", "filter");
	return stdout
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);
}

let tab: Tab;

beforeAll(async () => {
	await compose("up", "-d", "--build", "--wait", "desktop", "viewer");
	tab = await Tab.open(`http://127.0.0.1:${devtoolsPort}`);
}, 900_000);

afterAll(async () => {
	tab?.close();
	await compose("down", "-v");
}, 120_000);

describe("remote view", () => {
	it("publishes the view and DevTools on loopback only", async () => {
		for (const port of [6080, 9222]) {
			const { stdout } = await compose("port", "viewer", String(port));
			expect(stdout.trim().split("\n")).toEqual([expect.stringMatching(/^127\.0\.0\.1:\d+$/)]);
		}

		const lan = Object.values(networkInterfaces())
			.flat()
			.find((address) => address?.family === "IPv4" && !address.internal)?.address;
		expect(lan).toBeDefined();
		// Reachable on loopback, so the refusal below is the binding, not a stopped view.
		expect((await fetch(`http://127.0.0.1:${viewPort}/vnc.html`)).status).toBe(200);
		await expect(
			fetch(`http://${lan}:${viewPort}/vnc.html`, { signal: AbortSignal.timeout(3000) }),
		).rejects.toThrow();
	});
});

describe("desktop egress", () => {
	it("has no route or DNS around the filter", async () => {
		await expect(
			compose("exec", "-T", "desktop", "getent", "hosts", "example.com"),
		).rejects.toThrow();
		await expect(
			compose(
				"exec",
				"-T",
				"desktop",
				"socat",
				"-u",
				"OPEN:/dev/null",
				"TCP:1.1.1.1:443,connect-timeout=3",
			),
		).rejects.toThrow();
	});

	it("refuses an unapproved destination", async () => {
		await expect(tab.goto("https://example.org/")).rejects.toThrow(/ERR_TUNNEL_CONNECTION_FAILED/);
		expect(await filterLog()).toContainEqual(
			expect.objectContaining({ workspace, host: "example.org", decision: "deny" }),
		);
	}, 60_000);

	for (const workflow of Object.values(workflows)) {
		it(`loads the ${workflow.name} login page through the filter`, async () => {
			await tab.goto(workflow.login);
			const host = new URL(workflow.login).host;

			expect(await tab.evaluate<string>("location.host")).toBe(host);
			expect(
				await tab.waitFor(
					`!!document.querySelector('input[type="email"], input[type="password"], input[name="session_key"]')`,
				),
			).toBe(true);
			expect(await filterLog()).toContainEqual(
				expect.objectContaining({ workspace, host, decision: "allow" }),
			);
		}, 90_000);
	}

	it("renders the protected site's Turnstile challenge", async () => {
		await tab.goto(workflows.protected.login);
		// Turnstile adds a hidden cf-chl-widget-*_response input once its challenge iframe has loaded.
		expect(await tab.waitFor(`!!document.querySelector('input[id^="cf-chl-widget-"]')`)).toBe(true);
		expect(await filterLog()).toContainEqual(
			expect.objectContaining({ workspace, host: "challenges.cloudflare.com", decision: "allow" }),
		);
	}, 90_000);
});
