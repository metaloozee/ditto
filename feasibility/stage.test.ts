import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const PROBE_URL = "http://localhost:1340/probe";

async function waitForProbe(exited: Promise<number | null>) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const response = await fetch(PROBE_URL).catch(() => undefined);
		if (response?.ok) return response;
		const code = await Promise.race([exited, new Promise((r) => setTimeout(r, 500, "running"))]);
		if (code !== "running") throw new Error(`pnpm feasibility exited with ${String(code)}`);
	}
	throw new Error(`The feasibility stage didn't answer at ${PROBE_URL}`);
}

it("starts the feasibility stage with one command, isolated and without credentials", async () => {
	// An empty environment beyond PATH and HOME proves no .env credential is needed.
	const child = spawn("pnpm", ["feasibility"], {
		cwd: repoRoot,
		detached: true,
		stdio: ["ignore", "inherit", "inherit"],
		env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "true" },
	});
	const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));

	try {
		const response = await waitForProbe(exited);
		expect(await response.json()).toEqual({ ok: true, stage: "feasibility" });
		// Its state lives under feasibility/.alchemy, never the repo's .alchemy.
		expect(existsSync(`${repoRoot}feasibility/.alchemy/state/ditto-feasibility/feasibility`)).toBe(
			true,
		);
		expect(existsSync(`${repoRoot}.alchemy/state/ditto-feasibility`)).toBe(false);
	} finally {
		if (child.exitCode === null && child.pid) process.kill(-child.pid, "SIGTERM");
		await exited;
	}
}, 150_000);
