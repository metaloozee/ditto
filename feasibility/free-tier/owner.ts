// Owner commands for the free-tier probe (#30). Live: they deploy to the owner's Cloudflare account
// and spend the owner's ChatGPT plan.
//   pnpm feasibility:free-tier deploy    sign in (first time), then deploy the probe stage
//   pnpm feasibility:free-tier run       3 runs 15 minutes apart (--runs, --interval-minutes),
//                                        printed as one redacted evidence entry
//   pnpm feasibility:free-tier destroy   tear the probe stage down and print a teardown entry
// Progress goes to stderr. The evidence entry goes to stdout.
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { chatgptCredentials } from "../chatgpt-sign-in.ts";
import { defaultModel } from "../model-trial.ts";
import {
	alchemy,
	configDir,
	deployedUrl,
	runKey,
	savedRunKey,
	type Stack,
} from "../owner-stage.ts";
import { formatProbeEvidence, type ProbeRun } from "./worker.ts";

const STACK: Stack = {
	dir: import.meta.dirname,
	name: "ditto-free-tier-probe",
	stage: "free-tier-probe",
};
// Its own sign-in, apart from the baseline's: refreshing one would retire the other's refresh token.
const authFile = path.join(configDir, "free-tier-codex.json");
const runKeyFile = path.join(configDir, "free-tier-run-key");

const log = (message: string) => console.error(`[free-tier-probe] ${message}`);

async function deploy() {
	const credential = await (await chatgptCredentials(authFile, log)).read("openai-codex");
	if (credential?.type !== "oauth") throw new Error(`No ChatGPT sign-in in ${authFile}`);
	const code = await alchemy(STACK, "deploy", {
		PROBE_MODEL: process.env.PROBE_MODEL ?? defaultModel("chatgpt"),
		TRIAL_RUN_KEY: await runKey(runKeyFile),
		CHATGPT_ACCESS_TOKEN: credential.access,
		CHATGPT_REFRESH_TOKEN: credential.refresh,
	});
	if (code !== 0) process.exit(code);
	log("Deployed. Trigger a run with: pnpm feasibility:free-tier run");
}

async function run(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			runs: { type: "string", default: "3" },
			"interval-minutes": { type: "string", default: "15" },
		},
	});
	const runs = Number(values.runs);
	const minutes = Number(values["interval-minutes"]);
	if (!Number.isInteger(runs) || runs < 1 || !Number.isFinite(minutes) || minutes < 0) {
		throw new Error("--runs must be a whole number from 1, --interval-minutes 0 or more");
	}
	const url = await deployedUrl(STACK);
	if (!url)
		throw new Error("The probe stage isn't deployed. Run: pnpm feasibility:free-tier deploy");
	const key = await savedRunKey(runKeyFile, "pnpm feasibility:free-tier deploy");

	const results: ProbeRun[] = [];
	for (let i = 0; i < runs; i++) {
		if (i > 0) {
			log(`Waiting ${minutes} minutes before run ${i + 1} of ${runs}.`);
			await new Promise((resolve) => setTimeout(resolve, minutes * 60_000));
		}
		log(`Run ${i + 1} of ${runs}: triggering ${new URL(url).host}/run.`);
		const response = await fetch(new URL("/run", url), {
			method: "POST",
			headers: { "x-trial-key": key },
		});
		if (!response.ok)
			throw new Error(`The probe answered ${response.status}: ${await response.text()}`);
		const result = (await response.json()) as ProbeRun;
		log(`Run ${i + 1}: ${result.outcome}.`);
		results.push(result);
	}
	log(
		"Paste this entry into its slot under Model route > Free-tier Worker probe in docs/feasibility/decision-record.md:",
	);
	process.stdout.write(`\n${formatProbeEvidence(results)}`);
}

async function destroy() {
	// The stack declaration still runs on destroy, so it needs values. None reach Cloudflare.
	const code = await alchemy(STACK, "destroy", {
		PROBE_MODEL: "unused",
		TRIAL_RUN_KEY: "unused",
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

const [name, ...rest] = process.argv.slice(2);
if (name === "deploy") await deploy();
else if (name === "run") await run(rest);
else if (name === "destroy") await destroy();
else {
	console.error(
		"Usage: pnpm feasibility:free-tier deploy | run [--runs 3] [--interval-minutes 15] | destroy",
	);
	process.exit(2);
}
