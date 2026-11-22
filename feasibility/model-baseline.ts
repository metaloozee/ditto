// Local model-connection baseline (#25). Runs live requests on the owner's own account:
//   pnpm feasibility:model --route chatgpt
//   OPENCODE_API_KEY=... pnpm feasibility:model --route opencode
// Progress and sign-in prompts go to stderr. The redacted evidence entry goes to stdout.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import {
	type AuthInteraction,
	type Credential,
	type CredentialStore,
	createModels,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

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

/** Keeps the ChatGPT sign-in outside the repo, so day 2 refreshes a day-old refresh token. */
class FileCredentialStore extends InMemoryCredentialStore {
	private file: string;
	constructor(file: string) {
		super();
		this.file = file;
	}
	async load() {
		const saved = await readFile(this.file, "utf8").catch(() => undefined);
		if (!saved) return;
		for (const [id, credential] of Object.entries(
			JSON.parse(saved) as Record<string, Credential>,
		)) {
			await super.modify(id, async () => credential);
		}
	}
	override async modify(...args: Parameters<CredentialStore["modify"]>) {
		const result = await super.modify(...args);
		await this.save();
		return result;
	}
	private async save() {
		const all: Record<string, Credential> = {};
		for (const { providerId } of await this.list()) {
			const credential = await this.read(providerId);
			if (credential) all[providerId] = credential;
		}
		await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
		await writeFile(this.file, JSON.stringify(all), { mode: 0o600 });
		await chmod(this.file, 0o600);
	}
}

async function chatgptCredentials(): Promise<CredentialStore> {
	const store = new FileCredentialStore(values["auth-file"]);
	await store.load();
	if (await store.read("openai-codex")) return store;

	log(`No ChatGPT sign-in at ${values["auth-file"]}. Starting device-code sign-in.`);
	const terminal = createInterface({ input: process.stdin, output: process.stderr });
	const interaction: AuthInteraction = {
		async prompt(prompt) {
			if (prompt.type === "select") return "device_code";
			return terminal.question(`${prompt.message} `);
		},
		notify(event) {
			if (event.type === "device_code") {
				log(`Open ${event.verificationUri} and enter code ${event.userCode}`);
			} else if (event.type === "auth_url") {
				log(`Open ${event.url}`);
			} else {
				log(event.message);
			}
		},
	};
	const models = createModels({ credentials: store });
	models.setProvider(openaiCodexProvider());
	try {
		await models.login("openai-codex", "oauth", interaction);
	} finally {
		terminal.close();
	}
	log("Signed in.");
	return store;
}

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
	trialRoute === "chatgpt" ? await chatgptCredentials() : await opencodeCredentials();
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
