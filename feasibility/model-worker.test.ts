import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ACCOUNT_ID, API_KEY, accessToken, EMAIL, refreshToken } from "./simulated-provider.ts";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
// The feasibility-test stage binds the simulated provider; the owner's stage never does.
const WORKER_URL = "http://localhost:1343";

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
			"feasibility-test",
			"--no-input",
			"--env-file",
			"/dev/null",
		],
		{
			cwd: path.join(repoRoot, "feasibility"),
			detached: true,
			stdio: ["ignore", "inherit", "inherit"],
			env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "true" },
		},
	);
	exited = new Promise((resolve) => stage.once("exit", resolve));
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const response = await fetch(`${WORKER_URL}/model-trial`).catch(() => undefined);
		if (response?.ok) return;
		const code = await Promise.race([exited, new Promise((r) => setTimeout(r, 500, "running"))]);
		if (code !== "running") throw new Error(`alchemy dev exited with ${String(code)}`);
	}
	throw new Error(`The model-trial Worker didn't answer at ${WORKER_URL}`);
}, 150_000);

afterAll(async () => {
	if (stage?.exitCode === null && stage.pid) process.kill(-stage.pid, "SIGTERM");
	await exited;
});

async function ownerCommand(args: string[], env: Record<string, string> = {}) {
	const { stdout } = await promisify(execFile)(
		"node",
		[
			"feasibility/model-baseline.ts",
			"--runtime",
			"workerd",
			"--worker-url",
			WORKER_URL,
			"--runs",
			"1",
			...args,
		],
		{ cwd: repoRoot, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } },
	);
	return stdout;
}

const secrets = [
	...[1, 2, 3].flatMap((g) => [accessToken(g), refreshToken(g)]),
	ACCOUNT_ID,
	EMAIL,
	API_KEY,
	"SIMULATED",
];

describe("model trial inside workerd", () => {
	it("refuses a trial for an unknown route before Pi runs", async () => {
		const response = await fetch(`${WORKER_URL}/model-trial`, {
			method: "POST",
			body: JSON.stringify({ route: "gemini", credential: { type: "api_key", key: API_KEY } }),
		});
		expect(response.status).toBe(400);
	});

	it("runs the ChatGPT turn, refresh and turn in workerd and keeps the rotated sign-in", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "ditto-workerd-trial-"));
		const authFile = path.join(dir, "openai-codex.json");
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

		const entry = await ownerCommand(["--route", "chatgpt", "--auth-file", authFile]);

		expect(entry).toMatch(
			/#### \d{4}-\d{2}-\d{2} · .*ChatGPT.* from local Worker \(alchemy dev\) · pass\n/,
		);
		expect(entry).toContain("- **Network origin:** local Worker (alchemy dev)");
		expect(entry).toMatch(/refresh passed \(auth\.openai\.com\/oauth\/token 200\)/);
		expect(entry).toMatch(
			/- \*\*CPU time:\*\* turn \d+(\.\d)?ms, refresh \d+(\.\d)?ms, turn after refresh \d+(\.\d)?ms\./,
		);
		expect(entry).toMatch(/Workers free plan \(10ms per request\)/);
		for (const secret of secrets) expect(entry).not.toContain(secret);
		// The refresh rotated the refresh token, so the old one is dead: the file must hold the new one.
		const saved = JSON.parse(await readFile(authFile, "utf8"));
		expect(saved["openai-codex"].refresh).toBe(refreshToken(2));
	}, 60_000);

	it("runs the OpenCode turns in workerd", async () => {
		const entry = await ownerCommand(["--route", "opencode"], { OPENCODE_API_KEY: API_KEY });

		expect(entry).toMatch(/· .*OpenCode.* from local Worker \(alchemy dev\) · pass\n/);
		expect(entry).toMatch(
			/- \*\*CPU time:\*\* turn \d+(\.\d)?ms, refresh not run, turn after refresh \d+(\.\d)?ms\./,
		);
		for (const secret of secrets) expect(entry).not.toContain(secret);
	}, 60_000);
});
