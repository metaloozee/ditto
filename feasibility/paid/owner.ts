// Owner commands for the deployed Pi trial on Workers Paid (#31). Live: they deploy to the owner's
// Cloudflare account, which must be on Workers Paid, and spend the owner's model plan.
//   pnpm feasibility:paid deploy                  deploy the paid trial stage
//   pnpm feasibility:paid run --route chatgpt     sign in (first time), run the trial, print the entry
//   OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode
//   pnpm feasibility:paid destroy                 tear the stage down and print a teardown entry
// `run` takes the baseline's options (--runs, --interval-minutes, --model). Progress goes to stderr.
// Evidence entries go to stdout.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
	alchemy,
	configDir,
	deployedUrl,
	runKey,
	savedRunKey,
	type Stack,
} from "../owner-stage.ts";

const STACK: Stack = {
	dir: import.meta.dirname,
	name: "ditto-paid-pi-trial",
	stage: "paid-pi-trial",
};
// Its own sign-in, apart from the baseline's and the free-tier probe's, so no stage retires another's
// refresh token. The Worker stores no credential: each run sends this one and saves the rotated one.
const authFile = path.join(configDir, "paid-codex.json");
const runKeyFile = path.join(configDir, "paid-run-key");
const baseline = path.join(import.meta.dirname, "..", "model-baseline.ts");

const log = (message: string) => console.error(`[paid-pi-trial] ${message}`);

async function deploy() {
	log("Deploying to your Cloudflare account. The Pi runtime needs Workers Paid for its CPU time.");
	const code = await alchemy(STACK, "deploy", { TRIAL_RUN_KEY: await runKey(runKeyFile) });
	if (code !== 0) process.exit(code);
	log("Deployed. Run the trial with: pnpm feasibility:paid run --route chatgpt");
}

async function run(args: string[]) {
	const url = await deployedUrl(STACK);
	if (!url) throw new Error("The paid stage isn't deployed. Run: pnpm feasibility:paid deploy");
	const key = await savedRunKey(runKeyFile, "pnpm feasibility:paid deploy");
	log(`Running the trial in ${new URL(url).host}.`);
	const child = spawn(
		process.execPath,
		[baseline, "--runtime", "deployed", "--worker-url", url, "--auth-file", authFile, ...args],
		// The run key reaches the driver through its environment, never its arguments.
		{ stdio: "inherit", env: { ...process.env, TRIAL_RUN_KEY: key } },
	);
	const code = await new Promise<number>((resolve) => child.once("exit", (c) => resolve(c ?? 1)));
	if (code !== 0) process.exit(code);
	log(
		"Paste the entry into its slot under Model route > Deployed Pi trial (#31) in docs/feasibility/decision-record.md.",
	);
}

async function destroy() {
	// The stack declaration still runs on destroy, so it needs a value. It never reaches Cloudflare.
	const code = await alchemy(STACK, "destroy", { TRIAL_RUN_KEY: "unused" });
	const now = new Date().toISOString();
	if (code === 0) {
		await rm(authFile, { force: true });
		await rm(runKeyFile, { force: true });
	}
	log("Paste this entry under Model route > Deployed Pi trial (#31) > Teardown:");
	process.stdout.write(
		[
			"",
			`#### ${now.slice(0, 10)} · paid Pi trial stage torn down · ${code === 0 ? "pass" : "fail"}`,
			"",
			`- **Date:** ${now.slice(0, 10)}, ${now.slice(11, 16)} UTC`,
			`- **Command:** \`pnpm feasibility:paid destroy\`, \`alchemy destroy --stage ${STACK.stage}\` exited ${code}`,
			`- **Removed:** Workers \`ditto-${STACK.stage}-model-trial\` and \`ditto-${STACK.stage}-cpu-tail\`, their KV namespace and run-key secret${code === 0 ? ", and the local paid-stage sign-in and run key" : ""}`,
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
		"Usage: pnpm feasibility:paid deploy | run --route chatgpt|opencode [--runs 3] | destroy",
	);
	process.exit(2);
}
