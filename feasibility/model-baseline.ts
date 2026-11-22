// Local model-connection baseline (#25). Runs live requests on the owner's own account:
//   pnpm feasibility:model --route chatgpt
//   OPENCODE_API_KEY=... pnpm feasibility:model --route opencode
// Progress and sign-in prompts go to stderr. The redacted evidence entry goes to stdout.
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { type CredentialStore, InMemoryCredentialStore } from "@earendil-works/pi-ai";

import { chatgptCredentials } from "./chatgpt-sign-in.ts";
import {
	defaultModel,
	formatEvidence,
	runModelTrial,
	type TrialRoute,
	type TrialRun,
} from "./model-trial.ts";

const { values } = parseArgs({
	options: {
		route: { type: "string" },
		model: { type: "string" },
		runs: { type: "string", default: "3" },
		"interval-minutes": { type: "string", default: "15" },
		origin: { type: "string", default: "home network" },
		"auth-file": {
			type: "string",
			default: path.join(homedir(), ".config", "ditto-feasibility", "openai-codex.json"),
		},
	},
});

const route = values.route;
if (route !== "chatgpt" && route !== "opencode") {
	console.error(
		"Usage: pnpm feasibility:model --route chatgpt|opencode [--model id] [--runs 3] [--interval-minutes 15]",
	);
	process.exit(2);
}
const runs = Number(values.runs);
const intervalMs = Number(values["interval-minutes"]) * 60_000;
const log = (message: string) => console.error(`[model-baseline] ${message}`);

async function opencodeCredentials(): Promise<CredentialStore> {
	const key = process.env.OPENCODE_API_KEY;
	if (!key) {
		console.error("Set OPENCODE_API_KEY to run the OpenCode route.");
		process.exit(2);
	}
	const store = new InMemoryCredentialStore();
	await store.modify("opencode", async () => ({ type: "api_key", key }));
	return store;
}

const trialRoute: TrialRoute = route;
const credentials =
	trialRoute === "chatgpt"
		? await chatgptCredentials(values["auth-file"], log)
		: await opencodeCredentials();
const model = values.model ?? defaultModel(trialRoute);
const results: TrialRun[] = [];
for (let i = 0; i < runs; i++) {
	if (i > 0) {
		log(`Waiting ${values["interval-minutes"]} minutes before run ${i + 1} of ${runs}.`);
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	log(`Run ${i + 1} of ${runs}: ${trialRoute}, model ${model}.`);
	const run = await runModelTrial({ route: trialRoute, credentials, model });
	log(`Run ${i + 1}: ${run.outcome}.`);
	results.push(run);
}

log("Paste this entry under Model route > Evidence in docs/feasibility/decision-record.md:");
process.stdout.write(`\n${formatEvidence(results, { origin: values.origin })}`);
