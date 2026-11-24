// The Cloudflare Containers image (#32) under local Docker: one image holds the #27 filter and the
// #29 headed desktop, because a Container instance runs one image. The runtime passes only
// WORKSPACE_ID; the image must hand it to the filter and the filter must log it. #37 adds Chrome's
// sandbox, the DevTools gate that take-over locks, memory sampling and extra screens.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { Tab } from "./takeover/cdp.ts";

const run = promisify(execFile);
// One tag and container name per checkout, so worktrees running this suite at once never share.
const checkout = createHash("sha256")
	.update(import.meta.dirname)
	.digest("hex")
	.slice(0, 8);
const image = `ditto-feasibility-containers:test-${checkout}`;
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
		"-p",
		"127.0.0.1::8082",
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
	return {
		control,
		devtools: `http://127.0.0.1:${await port(9223)}`,
		gate: `http://127.0.0.1:${await port(8082)}`,
	};
}

type Sample = {
	at: number;
	memory: { currentMib: number };
	chromePssMib: number;
	desktop: Record<string, boolean>;
	oomKills: number;
};
const json = async (url: string, init?: RequestInit) => (await fetch(url, init)).json();

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
		const started = await start(`ditto-containers-test-${checkout}`);
		control = started.control;
		tab = await Tab.open(started.devtools);
	}, 120_000);

	afterAll(async () => {
		tab?.close();
		await docker("rm", "-f", `ditto-containers-test-${checkout}`);
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

	it("runs Chrome without its sandbox only when the instance allows none, and says why", async () => {
		// Docker's default seccomp profile and capabilities refuse both the user-namespace and the
		// SUID sandbox, so Chrome would not start sandboxed.
		expect(await json(`${control}/sandbox`)).toMatchObject({
			mode: "none",
			reason: expect.stringMatching(/sandbox|namespace/i),
		});
		expect(await tab.evaluate<number>("1 + 1")).toBe(2);
	});

	it("samples memory and the desktop's processes every few seconds", async () => {
		await new Promise((resolve) => setTimeout(resolve, 7_000));
		const samples = (await json(`${control}/samples`)) as Sample[];

		expect(samples.length).toBeGreaterThanOrEqual(2);
		const last = samples.at(-1);
		expect(last?.memory.currentMib).toBeGreaterThan(50);
		expect(last?.chromePssMib).toBeGreaterThan(50);
		expect(last?.desktop).toEqual({ Xvfb: true, x11vnc: true, websockify: true, chromium: true });
		expect(last?.oomKills).toBe(0);
	}, 30_000);

	it("opens another screen with its own Chrome on its own display", async () => {
		const opened = await fetch(
			`${control}/screens?url=${encodeURIComponent("https://example.com/")}`,
			{
				method: "POST",
			},
		);
		expect(await opened.json()).toMatchObject({ screens: 1 });
		await new Promise((resolve) => setTimeout(resolve, 5_000));

		expect(await json(`${control}/screens`)).toEqual([
			expect.objectContaining({ display: 1, alive: true }),
		]);
	}, 30_000);

	it("says when any local process can reach Chrome's DevTools port", async () => {
		// Without NET_ADMIN nothing can keep a bot's process off 127.0.0.1:9222.
		expect(await json(`${control}/devtools-reach`)).toMatchObject({ chrome: "reachable" });
	});
});

describe("with NET_ADMIN and SYS_ADMIN: only the filter's user can leave", () => {
	let control: string;
	let devtools: string;
	let gate: string;

	beforeAll(async () => {
		// Cloudflare granted NET_ADMIN in #32. SYS_ADMIN is what alchemy dev grants; whether
		// Cloudflare grants it too is what the sandbox check on the paid stage answers.
		({ control, devtools, gate } = await start(
			`ditto-containers-test-fenced-${checkout}`,
			"--cap-add",
			"NET_ADMIN",
			"--cap-add",
			"SYS_ADMIN",
		));
	}, 120_000);

	afterAll(async () => {
		await docker("rm", "-f", `ditto-containers-test-fenced-${checkout}`);
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

	it("runs Chrome inside its sandbox", async () => {
		expect(await json(`${control}/sandbox`)).toMatchObject({ mode: "sandboxed" });
		const tab = await Tab.open(devtools);
		try {
			await tab.goto("chrome://sandbox");
			expect(
				await tab.waitFor(`document.body.innerText.includes("You are adequately sandboxed")`),
			).toBe(true);
		} finally {
			tab.close();
		}
	}, 60_000);

	it("keeps every local process off Chrome's own DevTools port and the gate's lock", async () => {
		// control.py runs as the browser user, standing in for a bot's process on the computer.
		expect(await json(`${control}/devtools-reach`)).toEqual({
			chrome: "refused",
			gate: "reachable",
			lock: "refused",
		});
	});

	it("ends every DevTools session at the lock and refuses new ones until unlock", async () => {
		const tab = await Tab.open(devtools);

		expect(await json(`${gate}/lock`, { method: "POST" })).toMatchObject({
			locked: true,
			closed: expect.any(Number),
		});
		await expect(tab.evaluate("1")).rejects.toThrow(/DevTools closed/);
		await expect(Tab.open(devtools, 2_000)).rejects.toThrow();
		expect(await json(`${control}/devtools-reach`)).toMatchObject({
			chrome: "refused",
			gate: "refused",
		});

		expect(await json(`${gate}/unlock`, { method: "POST" })).toMatchObject({ locked: false });
		const again = await Tab.open(devtools);
		expect(await again.evaluate<number>("1 + 1")).toBe(2);
		again.close();
	}, 60_000);
});
