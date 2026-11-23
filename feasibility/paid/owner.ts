// Owner commands for the deployed Pi trial on Workers Paid (#31). Live: they deploy to the owner's
// Cloudflare account, which must be on Workers Paid, and spend the owner's model plan.
//   pnpm feasibility:paid deploy                  deploy the paid trial stage
//   pnpm feasibility:paid run --route chatgpt     sign in (first time), run the trial, print the entry
//   OPENCODE_API_KEY=<key> pnpm feasibility:paid run --route opencode
//   pnpm feasibility:paid transfer-siwc           sign in with ChatGPT here, hand it to the Bot (#34)
//   pnpm feasibility:paid run --route siwc        run the trial in the Bot Durable Object (#34)
//   pnpm feasibility:paid workers-ai --model @cf/...  Workers AI turns in the Bot through AI Gateway (#35)
//   pnpm feasibility:paid destroy                 tear the stage down and print a teardown entry
// `run` takes the baseline's options (--runs, --interval-minutes, --model). Progress goes to stderr.
// Evidence entries go to stdout.
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { siwcCredentials } from "../chatgpt-sign-in.ts";
import { formatSignIn } from "../model-trial.ts";
import {
	alchemy,
	configDir,
	deployedUrl,
	runKey,
	savedRunKey,
	type Stack,
} from "../owner-stage.ts";
import { redact } from "../redact.ts";

const STACK: Stack = {
	dir: import.meta.dirname,
	name: "ditto-paid-pi-trial",
	stage: "paid-pi-trial",
};
// Its own sign-in, apart from the baseline's and the free-tier probe's, so no stage retires another's
// refresh token. The Worker stores no credential: each run sends this one and saves the rotated one.
const authFile = path.join(configDir, "paid-codex.json");
const runKeyFile = path.join(configDir, "paid-run-key");
// The sign-in made for the Bot. It lives here only until the transfer, then the Bot owns it.
const siwcTransferFile = path.join(configDir, "paid-siwc.json");
// This machine's host ID, shared with the local #34 run: one ID per host, per OpenAI's docs.
const ownerHostIdFile = path.join(configDir, "siwc-host-id");
const baseline = path.join(import.meta.dirname, "..", "model-baseline.ts");
const workersAiRun = path.join(import.meta.dirname, "..", "workers-ai-run.ts");

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

/** Workers AI needs no credential: the Bot's binding bills this Cloudflare account. */
async function workersAi(args: string[]) {
	const url = await deployedUrl(STACK);
	if (!url) throw new Error("The paid stage isn't deployed. Run: pnpm feasibility:paid deploy");
	const key = await savedRunKey(runKeyFile, "pnpm feasibility:paid deploy");
	log(`Running Workers AI in the Bot at ${new URL(url).host}. It bills your Cloudflare account.`);
	const child = spawn(process.execPath, [workersAiRun, "--worker-url", url, ...args], {
		stdio: "inherit",
		env: { ...process.env, TRIAL_RUN_KEY: key },
	});
	const code = await new Promise<number>((resolve) => child.once("exit", (c) => resolve(c ?? 1)));
	if (code !== 0) process.exit(code);
}

async function transferSiwc() {
	const url = await deployedUrl(STACK);
	if (!url) throw new Error("The paid stage isn't deployed. Run: pnpm feasibility:paid deploy");
	const key = await savedRunKey(runKeyFile, "pnpm feasibility:paid deploy");
	// A separate sign-in from the local run's, so the Bot's refreshes never retire that one.
	const { store, signIn } = await siwcCredentials({
		authFile: siwcTransferFile,
		hostIdFile: ownerHostIdFile,
		log,
	});
	const credential = await store.read("openai");
	const response = await fetch(`${url}/siwc/import`, {
		method: "POST",
		headers: { "x-trial-key": key },
		body: JSON.stringify({ credential }),
	});
	if (!response.ok) throw new Error(`The Bot refused the sign-in: ${response.status}`);
	const { hostId } = (await response.json()) as { hostId: string };
	// The Bot owns later refreshes now. A copy left here would hold a refresh token it retires.
	await rm(siwcTransferFile, { force: true });
	const ownerHost = (await readFile(ownerHostIdFile, "utf8")).trim();
	log(`Transferred. The Bot refreshes it from now on, and keeps host ID ${hostId}.`);
	// Reached only on success: a refused sign-in or transfer throws before this entry.
	log("Paste this entry under Model route > Sign in with ChatGPT (#34) > Transfer:");
	const now = new Date().toISOString();
	const clientId = signIn?.clientId ?? "";
	const entry = [
		"",
		`#### ${now.slice(0, 10)} · Sign in with ChatGPT transferred to the Bot Durable Object · pass`,
		"",
		"- **Route:** sign in with ChatGPT on the owner's machine, send the credential once over HTTPS behind the run key to `POST /siwc/import` on the Bot Durable Object, then delete the local copy",
		`- **Date:** ${now.slice(0, 10)}, ${now.slice(11, 16)} UTC`,
		"- **Network origin:** home network for the sign-in; the Bot holds the credential from then on",
		"- **Expected:** the ID token passes every check and the Bot accepts the credential",
		...(signIn ? [formatSignIn(signIn)] : []),
		// The grant carries the owner's machine's host ID: OpenAI sees a host ID only at authorize
		// time. The Bot's is for its next authorization, which cannot run inside a Durable Object.
		`- **Observed:** the Bot accepted the credential. OpenAI granted it under the owner's machine's host ID; the Bot keeps a \`urn:uuid\` host ID of its own, ${hostId.endsWith(ownerHost) ? "the same as" : "different from"} that one, for its next authorization. The local copy was deleted.`,
		"- **Retries:** none",
		"- **Fallback:** none needed",
		"",
	].join("\n");
	process.stdout.write(redact(entry, [{ value: clientId, placeholder: "<clientId>" }]));
}

async function destroy() {
	// The stack declaration still runs on destroy, so it needs a value. It never reaches Cloudflare.
	const code = await alchemy(STACK, "destroy", { TRIAL_RUN_KEY: "unused" });
	const now = new Date().toISOString();
	if (code === 0) {
		await rm(authFile, { force: true });
		await rm(siwcTransferFile, { force: true });
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
			`- **Removed:** Workers \`ditto-${STACK.stage}-model-trial\` and \`ditto-${STACK.stage}-cpu-tail\`, the \`Bot\` Durable Object namespace with the sign-in it held, the AI Gateway with its logs, their KV namespace and run-key secret${code === 0 ? ", and the local paid-stage sign-ins and run key" : ""}`,
			"",
		].join("\n"),
	);
	if (code !== 0) process.exit(code);
}

const [name, ...rest] = process.argv.slice(2);
if (name === "deploy") await deploy();
else if (name === "run") await run(rest);
else if (name === "transfer-siwc") await transferSiwc();
else if (name === "workers-ai") await workersAi(rest);
else if (name === "destroy") await destroy();
else {
	console.error(
		"Usage: pnpm feasibility:paid deploy | transfer-siwc | run --route chatgpt|siwc|opencode [--runs 3] | workers-ai [--model @cf/...] [--account id] [--runs 3] | destroy",
	);
	process.exit(2);
}
