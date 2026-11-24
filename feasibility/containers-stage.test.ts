// The Containers trial stack (#32) under `alchemy dev`, which runs the Worker and Durable Object
// in workerd and the container in local Docker. Proves the wiring the owner's deploy will use:
// the runtime passes the workspace identity to the filter, the owner's commands reach the
// instance only through the run-key gate, and the checks print redacted evidence entries.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const WORKER_URL = "http://localhost:1349";
const RUN_KEY = "containers-run-key-SIMULATED-0123456789abcdefghij";

let stage: ChildProcess;
let exited: Promise<number | null>;

beforeAll(async () => {
	stage = spawn(
		"pnpm",
		[
			"exec",
			"alchemy",
			"dev",
			"--stage",
			"containers-trial-test",
			"--no-input",
			"--env-file",
			"/dev/null",
		],
		{
			cwd: path.join(repoRoot, "feasibility", "containers"),
			detached: true,
			stdio: ["ignore", "inherit", "inherit"],
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				CI: "true",
				TRIAL_RUN_KEY: RUN_KEY,
				COOKIE_KEY: "containers-cookie-key-SIMULATED-0123456789",
				OWNER_SESSION_KEY: "containers-session-key-SIMULATED-0123456789",
				GITHUB_CLIENT_ID: "client-id-SIMULATED",
				GITHUB_CLIENT_SECRET: "client-secret-SIMULATED",
				OWNER_GITHUB_ID: "0",
			},
		},
	);
	exited = new Promise((resolve) => stage.once("exit", resolve));
	const deadline = Date.now() + 900_000;
	while (Date.now() < deadline) {
		const response = await fetch(WORKER_URL).catch(() => undefined);
		if (response) return;
		const code = await Promise.race([exited, new Promise((r) => setTimeout(r, 500, "running"))]);
		if (code !== "running") throw new Error(`alchemy dev exited with ${String(code)}`);
	}
	throw new Error(`The Containers trial Worker didn't answer at ${WORKER_URL}`);
}, 960_000);

afterAll(async () => {
	await owner(["stop", "ws-cloud-trial"]).catch(() => {});
	if (stage?.exitCode === null && stage.pid) process.kill(-stage.pid, "SIGTERM");
	await exited;
}, 60_000);

function owner(args: string[]) {
	return promisify(execFile)(
		"node",
		["feasibility/containers/owner.ts", ...args, "--worker-url", WORKER_URL],
		{
			cwd: repoRoot,
			env: { PATH: process.env.PATH, HOME: process.env.HOME, TRIAL_RUN_KEY: RUN_KEY },
			maxBuffer: 16 * 1024 * 1024,
		},
	);
}

it("refuses the instance to anyone without the run key", async () => {
	const response = await fetch(`${WORKER_URL}/w/ws-cloud-trial/start`, { method: "POST" });
	expect(response.status).toBe(401);
});

it("runs every check through the gate and prints one redacted entry each", async () => {
	const { stdout } = await owner(["checks", "--ws-hold-ms", "5000"]);

	const headings = stdout.match(/^#### .+$/gm) ?? [];
	expect(headings).toEqual([
		expect.stringMatching(
			/ · filter logs the workspace identity the runtime passed under alchemy dev · pass$/,
		),
		expect.stringMatching(/ · Chrome loads an approved destination under alchemy dev · pass$/),
		expect.stringMatching(
			/ · Chrome is refused an unapproved destination under alchemy dev · pass$/,
		),
		// Local Docker grants no NET_ADMIN, so the fence cannot apply here.
		expect.stringMatching(/ · Chrome has no route around the filter under alchemy dev · fail$/),
		expect.stringMatching(/ · WebSocket held open through the filter under alchemy dev · pass$/),
		expect.stringMatching(
			/ · HTTP\/2 negotiated end to end through the filter under alchemy dev · pass$/,
		),
		// alchemy dev grants SYS_ADMIN, which the SUID sandbox needs inside Docker.
		expect.stringMatching(/ · Chrome runs sandboxed under alchemy dev · pass$/),
		expect.stringMatching(/ · instance size, memory and startup time under alchemy dev · pass$/),
	]);
	expect(stdout).toContain(
		'{"workspace":"ws-cloud-trial", "host":"example.com", "decision":"allow"',
	);
	expect(stdout).toMatch(/\*\*Startup time:\*\* \d+ ms/);
	expect(stdout).toMatch(/\*\*Observed memory:\*\* [\d.]+ MiB/);
	expect(stdout).not.toContain(RUN_KEY);
}, 600_000);
