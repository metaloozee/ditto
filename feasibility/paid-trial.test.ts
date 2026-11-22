import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ACCOUNT_ID, API_KEY, accessToken, EMAIL, refreshToken } from "./simulated-provider.ts";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
// The paid stack's test stage binds the simulated provider; the owner's paid stage never does.
const WORKER_URL = "http://localhost:1345";
const RUN_KEY = "paid-run-key-SIMULATED-0123456789abcdefghij";

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
			"paid-pi-trial-test",
			"--no-input",
			"--env-file",
			"/dev/null",
		],
		{
			cwd: path.join(repoRoot, "feasibility", "paid"),
			detached: true,
			stdio: ["ignore", "inherit", "inherit"],
			env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "true", TRIAL_RUN_KEY: RUN_KEY },
		},
	);
	exited = new Promise((resolve) => stage.once("exit", resolve));
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const response = await fetch(`${WORKER_URL}/model-trial`).catch(() => undefined);
		if (response) return;
		const code = await Promise.race([exited, new Promise((r) => setTimeout(r, 500, "running"))]);
		if (code !== "running") throw new Error(`alchemy dev exited with ${String(code)}`);
	}
	throw new Error(`The paid model-trial Worker didn't answer at ${WORKER_URL}`);
}, 150_000);

afterAll(async () => {
	if (stage?.exitCode === null && stage.pid) process.kill(-stage.pid, "SIGTERM");
	await exited;
});

async function ownerRun(args: string[], env: Record<string, string> = {}) {
	const { stdout } = await promisify(execFile)(
		"node",
		[
			"feasibility/model-baseline.ts",
			"--runtime",
			"deployed",
			"--worker-url",
			WORKER_URL,
			"--runs",
			"1",
			...args,
		],
		{
			cwd: repoRoot,
			env: { PATH: process.env.PATH, HOME: process.env.HOME, TRIAL_RUN_KEY: RUN_KEY, ...env },
		},
	);
	return stdout;
}

const secrets = [
	...[1, 2, 3].flatMap((g) => [accessToken(g), refreshToken(g)]),
	ACCOUNT_ID,
	EMAIL,
	API_KEY,
	RUN_KEY,
	"SIMULATED",
];

describe("model trial on the paid stage", () => {
	it("keeps its own state, apart from every other stage", () => {
		expect(
			existsSync(
				`${repoRoot}feasibility/paid/.alchemy/state/ditto-paid-pi-trial/paid-pi-trial-test`,
			),
		).toBe(true);
	});

	it("refuses the trial without the owner's run key", async () => {
		const response = await fetch(`${WORKER_URL}/model-trial`, { method: "POST", body: "{}" });
		expect(response.status).toBe(401);
	});

	it("runs the ChatGPT turn, refresh and turn, records the Worker's CPU time and keeps the rotated sign-in", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "ditto-paid-trial-"));
		const authFile = path.join(dir, "paid-codex.json");
		await writeFile(
			authFile,
			JSON.stringify({
				"openai-codex": {
					type: "oauth",
					access: accessToken(1),
					refresh: refreshToken(1),
					expires: Date.now() + 3_600_000,
				},
			}),
		);

		const entry = await ownerRun(["--route", "chatgpt", "--auth-file", authFile]);

		expect(entry).toMatch(/#### \d{4}-\d{2}-\d{2} · .*ChatGPT.* from deployed Worker .* · pass\n/);
		expect(entry).toMatch(
			/- \*\*Network origin:\*\* deployed Worker \(Cloudflare network, Workers Paid, data centre [^)]+\)/,
		);
		expect(entry).toMatch(/refresh passed \(auth\.openai\.com\/oauth\/token 200\)/);
		expect(entry).toMatch(
			/- \*\*CPU time:\*\* whole trial request \d+(\.\d)?ms CPU, \d+(\.\d)?ms wall, from the Worker's tail event\./,
		);
		for (const secret of secrets) expect(entry).not.toContain(secret);
		const saved = JSON.parse(await readFile(authFile, "utf8"));
		expect(saved["openai-codex"].refresh).toBe(refreshToken(2));
	}, 90_000);

	it("runs the OpenCode turns", async () => {
		const entry = await ownerRun(["--route", "opencode"], { OPENCODE_API_KEY: API_KEY });

		expect(entry).toMatch(/· .*OpenCode.* from deployed Worker .* · pass\n/);
		expect(entry).toMatch(/- \*\*CPU time:\*\* whole trial request/);
		for (const secret of secrets) expect(entry).not.toContain(secret);
	}, 90_000);
});
