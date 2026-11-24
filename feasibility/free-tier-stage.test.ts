// The free-tier probe stack (#30) under `alchemy dev`, beside `pnpm feasibility` (1340-1341): it
// must run on its own port and refuse a run without the key. No provider is reached.
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const PROBE_URL = "http://localhost:1350";

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
			"free-tier-probe-test",
			"--no-input",
			"--env-file",
			"/dev/null",
		],
		{
			cwd: path.join(repoRoot, "feasibility", "free-tier"),
			detached: true,
			stdio: ["ignore", "inherit", "inherit"],
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				CI: "true",
				PROBE_MODEL: "gpt-5.6-luna",
				TRIAL_RUN_KEY: "free-tier-run-key-SIMULATED-0123456789abcdef",
				CHATGPT_ACCESS_TOKEN: "unused",
				CHATGPT_REFRESH_TOKEN: "unused",
			},
		},
	);
	exited = new Promise((resolve) => stage.once("exit", resolve));
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const response = await fetch(PROBE_URL).catch(() => undefined);
		if (response) return;
		const code = await Promise.race([exited, new Promise((r) => setTimeout(r, 500, "running"))]);
		if (code !== "running") throw new Error(`alchemy dev exited with ${String(code)}`);
	}
	throw new Error(`The free-tier probe didn't answer at ${PROBE_URL}`);
}, 150_000);

afterAll(async () => {
	if (stage?.exitCode === null && stage.pid) process.kill(-stage.pid, "SIGTERM");
	await exited;
});

it("serves the probe on its own port and refuses a run without the key", async () => {
	const response = await fetch(`${PROBE_URL}/run`, {
		method: "POST",
		headers: { "x-trial-key": "wrong" },
	});
	expect(response.status).toBe(401);
});
