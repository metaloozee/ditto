// Owner commands for the free-tier probe (#30). Live: they deploy to the owner's Cloudflare account
// and spend the owner's ChatGPT plan.
//   pnpm feasibility:free-tier deploy    sign in (first time), then deploy the probe stage
//   pnpm feasibility:free-tier run       trigger one run and print a redacted evidence entry
//   pnpm feasibility:free-tier destroy   tear the probe stage down and print a teardown entry
// Progress goes to stderr. The evidence entry goes to stdout.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { chatgptCredentials } from "../chatgpt-sign-in.ts";
import { defaultModel } from "../model-trial.ts";
import { formatProbeEvidence, type ProbeRun } from "./worker.ts";

const STAGE = "free-tier-probe";
const here = import.meta.dirname;
const alchemyBin = path.join(here, "..", "..", "node_modules", ".bin", "alchemy");
const outputFile = path.join(
	here,
	".alchemy",
	"state",
	"ditto-free-tier-probe",
	STAGE,
	"__stack_output__.json",
);
const configDir = path.join(homedir(), ".config", "ditto-feasibility");
// Its own sign-in, apart from the baseline's: refreshing one would retire the other's refresh token.
const authFile = path.join(configDir, "free-tier-codex.json");
const runKeyFile = path.join(configDir, "free-tier-run-key");

const log = (message: string) => console.error(`[free-tier-probe] ${message}`);

/** Runs alchemy from this folder, so its state stays in feasibility/free-tier/.alchemy. */
function alchemy(command: "deploy" | "destroy", env: Record<string, string>): Promise<number> {
	const child = spawn(
		alchemyBin,
		[command, "--stage", STAGE, "--yes", "--no-input", "--env-file", "/dev/null"],
		// Secrets reach alchemy only through this child's environment, never a file in the repo.
		{ cwd: here, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } },
	);
	return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

async function runKey(): Promise<string> {
	const saved = await readFile(runKeyFile, "utf8").catch(() => undefined);
	if (saved) return saved.trim();
	const key = randomBytes(32).toString("hex");
	await mkdir(configDir, { recursive: true, mode: 0o700 });
	await writeFile(runKeyFile, key, { mode: 0o600 });
	return key;
}

async function deploy() {
	const credential = await (await chatgptCredentials(authFile, log)).read("openai-codex");
	if (credential?.type !== "oauth") throw new Error(`No ChatGPT sign-in in ${authFile}`);
	const code = await alchemy("deploy", {
		PROBE_MODEL: process.env.PROBE_MODEL ?? defaultModel("chatgpt"),
		PROBE_RUN_KEY: await runKey(),
		CHATGPT_ACCESS_TOKEN: credential.access,
		CHATGPT_REFRESH_TOKEN: credential.refresh,
	});
	if (code !== 0) process.exit(code);
	log("Deployed. Trigger a run with: pnpm feasibility:free-tier run");
}

async function run() {
	const saved = await readFile(outputFile, "utf8").catch(() => undefined);
	const url = saved ? (JSON.parse(saved) as { url?: string }).url : undefined;
	if (!url)
		throw new Error("The probe stage isn't deployed. Run: pnpm feasibility:free-tier deploy");
	log(`Triggering ${new URL(url).host}/run.`);
	const response = await fetch(new URL("/run", url), {
		method: "POST",
		headers: { "x-probe-key": (await readFile(runKeyFile, "utf8")).trim() },
	});
	if (!response.ok)
		throw new Error(`The probe answered ${response.status}: ${await response.text()}`);
	const result = (await response.json()) as ProbeRun;
	log(
		`Run: ${result.outcome}. Paste this entry into its slot under Model route > Free-tier Worker probe in docs/feasibility/decision-record.md:`,
	);
	process.stdout.write(`\n${formatProbeEvidence(result)}`);
}

async function destroy() {
	// The stack declaration still runs on destroy, so it needs values. None reach Cloudflare.
	const code = await alchemy("destroy", {
		PROBE_MODEL: "unused",
		PROBE_RUN_KEY: "unused",
		CHATGPT_ACCESS_TOKEN: "unused",
		CHATGPT_REFRESH_TOKEN: "unused",
	});
	const now = new Date().toISOString();
	if (code === 0) {
		// The probe's tokens died with its KV namespace. Remove the local copies it was seeded from.
		await rm(authFile, { force: true });
		await rm(runKeyFile, { force: true });
	}
	log("Paste this entry under Model route > Free-tier Worker probe > Teardown:");
	process.stdout.write(
		[
			"",
			`#### ${now.slice(0, 10)} · free-tier probe stage torn down · ${code === 0 ? "pass" : "fail"}`,
			"",
			`- **Date:** ${now.slice(0, 10)}, ${now.slice(11, 16)} UTC`,
			`- **Command:** \`pnpm feasibility:free-tier destroy\`, \`alchemy destroy --stage ${STAGE}\` exited ${code}`,
			`- **Removed:** Worker \`ditto-free-tier-probe\`, its KV namespace and secrets${code === 0 ? ", and the local probe sign-in and run key" : ""}`,
			"",
		].join("\n"),
	);
	if (code !== 0) process.exit(code);
}

const commands = { deploy, run, destroy } as const;
const name = process.argv[2];
if (name !== "deploy" && name !== "run" && name !== "destroy") {
	console.error("Usage: pnpm feasibility:free-tier deploy|run|destroy");
	process.exit(2);
}
await commands[name]();
