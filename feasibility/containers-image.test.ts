// The Cloudflare Containers image (#32) under local Docker: one image holds the #27 filter and the
// #29 headed desktop, because a Container instance runs one image. The runtime passes only
// WORKSPACE_ID; the image must hand it to the filter and the filter must log it.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { Tab } from "./takeover/cdp.ts";

const run = promisify(execFile);
const image = "ditto-feasibility-containers:test";
const workspace = "ws-cloud-trial";
const docker = (...args: string[]) =>
	run("docker", args, { maxBuffer: 64 * 1024 * 1024 }).then(({ stdout }) => stdout.trim());

/** Starts the image with ports on loopback only and returns its control and DevTools URLs. */
async function start(name: string, ...flags: string[]) {
	await docker("rm", "-f", name).catch(() => {});
	await docker(
		"run",
		"-d",
		"--name",
		name,
		"-e",
		`WORKSPACE_ID=${workspace}`,
		"-p",
		"127.0.0.1::8081",
		"-p",
		"127.0.0.1::9223",
		...flags,
		image,
	);
	const port = async (inner: number) =>
		(await docker("port", name, String(inner))).split("\n")[0]?.split(":").at(-1);
	const control = `http://127.0.0.1:${await port(8081)}`;
	const deadline = Date.now() + 60_000;
	while (
		!(await fetch(`${control}/ready`)
			.then((r) => r.ok)
			.catch(() => false))
	) {
		if (Date.now() > deadline) throw new Error(`${name} never became ready`);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return { control, devtools: `http://127.0.0.1:${await port(9223)}` };
}

type Decision = { workspace: string; host: string; decision: "allow" | "deny"; method?: string };
const decisions = async (control: string) =>
	(await (await fetch(`${control}/decisions`)).text())
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);

beforeAll(async () => {
	await run(
		"docker",
		[
			"build",
			"-t",
			image,
			"-f",
			path.join(import.meta.dirname, "containers/Dockerfile"),
			import.meta.dirname,
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
}, 900_000);

describe("as Cloudflare starts it: no extra capabilities", () => {
	let tab: Tab;
	let control: string;

	beforeAll(async () => {
		const started = await start("ditto-containers-test");
		control = started.control;
		tab = await Tab.open(started.devtools);
	}, 120_000);

	afterAll(async () => {
		tab?.close();
		await docker("rm", "-f", "ditto-containers-test");
	});

	it("loads an approved destination and logs the allow with the workspace it was given", async () => {
		await tab.goto("https://example.com/");
		expect(await tab.evaluate<string>("document.title")).toBe("Example Domain");
		expect(await decisions(control)).toContainEqual(
			expect.objectContaining({ workspace, host: "example.com", decision: "allow" }),
		);
	}, 60_000);

	it("refuses an unapproved destination and logs the deny with the workspace", async () => {
		await expect(tab.goto("https://example.org/")).rejects.toThrow(/ERR_TUNNEL_CONNECTION_FAILED/);
		expect(await decisions(control)).toContainEqual(
			expect.objectContaining({ workspace, host: "example.org", decision: "deny" }),
		);
	}, 60_000);

	it("reports that the browser user has a route around the filter", async () => {
		// Without NET_ADMIN the image cannot fence the browser user, so it says so rather than
		// pretending. On Cloudflare this result decides whether filtered traffic is suitable.
		const isolation = await (await fetch(`${control}/isolation`)).json();
		expect(isolation).toMatchObject({ workspace, isolation: "none" });
		expect(await (await fetch(`${control}/bypass`)).json()).toMatchObject({ direct: "connected" });
	}, 30_000);

	it("reports the memory the instance is using", async () => {
		const memory = (await (await fetch(`${control}/memory`)).json()) as Record<string, number>;
		expect(memory.currentMib).toBeGreaterThan(50);
	});
});

describe("with NET_ADMIN: only the filter's user can leave", () => {
	let control: string;
	let devtools: string;

	beforeAll(async () => {
		({ control, devtools } = await start("ditto-containers-test-fenced", "--cap-add", "NET_ADMIN"));
	}, 120_000);

	afterAll(async () => {
		await docker("rm", "-f", "ditto-containers-test-fenced");
	});

	it("fences the browser user so DNS and direct connections fail", async () => {
		expect(await (await fetch(`${control}/isolation`)).json()).toMatchObject({
			workspace,
			isolation: "filter-user-only",
		});
		expect(await (await fetch(`${control}/bypass`)).json()).toMatchObject({
			dns: "failed",
			direct: "failed",
		});
	}, 30_000);

	it("still loads approved destinations through the filter", async () => {
		const tab = await Tab.open(devtools);
		try {
			await tab.goto("https://example.com/");
			expect(await tab.evaluate<string>("document.title")).toBe("Example Domain");
		} finally {
			tab.close();
		}
	}, 60_000);
});
