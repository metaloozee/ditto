// Local model-connection baseline (#25). Runs live requests on the owner's own account:
//   pnpm feasibility:model --route chatgpt
//   OPENCODE_API_KEY=... pnpm feasibility:model --route opencode
// With `--runtime workerd` the trial runs inside the local `pnpm feasibility` Worker (#26)
// and the entry records workerd's CPU time per step.
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
import type { TrialEvent, TrialRequest } from "./model-worker.ts";
import { cpuMs, findWorkerd } from "./workerd-cpu.ts";

const { values } = parseArgs({
	options: {
		route: { type: "string" },
		model: { type: "string" },
		runs: { type: "string", default: "3" },
		"interval-minutes": { type: "string", default: "15" },
		origin: { type: "string" },
		runtime: { type: "string", default: "node" },
		"worker-url": { type: "string", default: "http://localhost:1341" },
		"auth-file": {
			type: "string",
			default: path.join(homedir(), ".config", "ditto-feasibility", "openai-codex.json"),
		},
	},
});

const route = values.route;
if (route !== "chatgpt" && route !== "opencode") {
	console.error(
		"Usage: pnpm feasibility:model --route chatgpt|opencode [--runtime node|workerd] [--model id] [--runs 3] [--interval-minutes 15]",
	);
	process.exit(2);
}
const runtime = values.runtime;
if (runtime !== "node" && runtime !== "workerd") {
	console.error("--runtime is node (the #25 baseline) or workerd (#26).");
	process.exit(2);
}
const origin =
	values.origin ?? (runtime === "workerd" ? "local Worker (alchemy dev)" : "home network");
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
const PROVIDER_ID = { chatgpt: "openai-codex", opencode: "opencode" } as const;

/** Runs one trial in the local Worker, sampling workerd's CPU as each step's line arrives. */
async function runInWorkerd(workerd: number[]): Promise<TrialRun> {
	const providerId = PROVIDER_ID[trialRoute];
	const credential = await credentials.read(providerId);
	if (!credential) throw new Error(`No ${providerId} credential to send to the Worker`);
	const body: TrialRequest = { route: trialRoute, model, credential };
	let last = await cpuMs(workerd);
	const response = await fetch(`${values["worker-url"]}/model-trial`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	if (!response.ok || !response.body) throw new Error(`Worker answered ${response.status}`);
	const stepCpu: number[] = [];
	let done: Extract<TrialEvent, { type: "done" }> | undefined;
	let buffered = "";
	for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
		buffered += chunk;
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines.filter(Boolean)) {
			const event = JSON.parse(line) as TrialEvent;
			if (event.type === "step") {
				const now = await cpuMs(workerd);
				stepCpu.push(now - last);
				last = now;
			} else {
				done = event;
			}
		}
	}
	if (!done) throw new Error("The Worker closed the stream before the trial finished");
	// A refresh rotates the refresh token and kills the old one, so keep what the Worker holds.
	const after = done.credential;
	if (after) await credentials.modify(providerId, async () => after);
	const run = done.run as TrialRun & { startedAt: string };
	return {
		...run,
		startedAt: new Date(run.startedAt),
		steps: run.steps.map((step, i) => ({
			...step,
			cpuMs: workerd.length ? stepCpu[i] : undefined,
		})),
	};
}

let workerd: number[] = [];
let runtimeText: string | undefined;
if (runtime === "workerd") {
	const info = await fetch(`${values["worker-url"]}/model-trial`)
		.then((r) => r.json())
		.catch(() => undefined);
	if (!info) {
		console.error(
			`No model-trial Worker at ${values["worker-url"]}. Run \`pnpm feasibility\` first.`,
		);
		process.exit(2);
	}
	log(`Worker runtime: ${JSON.stringify(info)}`);
	runtimeText = `workerd (${(info as { runtime: string }).runtime})`;
	workerd = await findWorkerd(Number(new URL(values["worker-url"]).port));
	if (!workerd.length) log("Could not find the workerd process, so CPU time is not measured.");
}

const results: TrialRun[] = [];
for (let i = 0; i < runs; i++) {
	if (i > 0) {
		log(`Waiting ${values["interval-minutes"]} minutes before run ${i + 1} of ${runs}.`);
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	log(`Run ${i + 1} of ${runs}: ${trialRoute}, model ${model}.`);
	const run =
		runtime === "workerd"
			? await runInWorkerd(workerd)
			: await runModelTrial({ route: trialRoute, credentials, model });
	log(`Run ${i + 1}: ${run.outcome}.`);
	results.push(run);
}

log("Paste this entry under Model route > Evidence in docs/feasibility/decision-record.md:");
process.stdout.write(`\n${formatEvidence(results, { origin, runtime: runtimeText })}`);
