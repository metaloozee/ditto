// Owner commands for the free-tier probe (#30). Live: they deploy to the owner's Cloudflare account
// and spend the owner's ChatGPT plan.
//   pnpm feasibility:free-tier deploy    sign in (first time), then deploy the probe stage
//   pnpm feasibility:free-tier run       trigger one run and print a redacted evidence entry
//   pnpm feasibility:free-tier destroy   tear the probe stage down and print a teardown entry
// Progress goes to stderr. The evidence entry goes to stdout.
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { chatgptCredentials } from "../chatgpt-sign-in.ts";
import { defaultModel } from "../model-trial.ts";
import { alchemy, configDir, deployedUrl, runKey } from "../owner-stage.ts";
import { formatProbeEvidence, type ProbeRun } from "./worker.ts";

const STACK = { dir: import.meta.dirname, name: "ditto-free-tier-probe", stage: "free-tier-probe" };
// Its own sign-in, apart from the baseline's: refreshing one would retire the other's refresh token.
const authFile = path.join(configDir, "free-tier-codex.json");
const runKeyFile = path.join(configDir, "free-tier-run-key");

const log = (message: string) => console.error(`[free-tier-probe] ${message}`);

async function deploy() {
	const credential = await (await chatgptCredentials(authFile, log)).read("openai-codex");
	if (credential?.type !== "oauth") throw new Error(`No ChatGPT sign-in in ${authFile}`);
	const code = await alchemy(STACK, "deploy", {
		PROBE_MODEL: process.env.PROBE_MODEL ?? defaultModel("chatgpt"),
		PROBE_RUN_KEY: await runKey(runKeyFile),
		CHATGPT_ACCESS_TOKEN: credential.access,
		CHATGPT_REFRESH_TOKEN: credential.refresh,
	});
	if (code !== 0) process.exit(code);
	log("Deployed. Trigger a run with: pnpm feasibility:free-tier run");
}

async function run() {
	const url = await deployedUrl(STACK);
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
	const code = await alchemy(STACK, "destroy", {
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
			`- **Command:** \`pnpm feasibility:free-tier destroy\`, \`alchemy destroy --stage ${STACK.stage}\` exited ${code}`,
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
