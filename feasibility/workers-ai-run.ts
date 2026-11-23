// Drives the Workers AI trial (#35) in the paid stage's Bot Durable Object and prints a dated,
// redacted entry. `pnpm feasibility:paid workers-ai` runs it with the stage's URL and run key:
//   TRIAL_RUN_KEY=<key> node feasibility/workers-ai-run.ts --worker-url <url> [--model @cf/...]
//     [--account <Ditto account>] [--runs 3] [--interval-minutes 15]
// Progress goes to stderr. The evidence entry goes to stdout.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import type { CpuReading } from "./paid/cpu-tail.ts";
import {
	DEFAULT_WORKERS_AI_MODEL,
	formatWorkersAiEvidence,
	type WorkersAiRun,
} from "./workers-ai-trial.ts";

const { values } = parseArgs({
	options: {
		"worker-url": { type: "string" },
		model: { type: "string", default: DEFAULT_WORKERS_AI_MODEL },
		account: { type: "string", default: "trial-account-1" },
		runs: { type: "string", default: "3" },
		"interval-minutes": { type: "string", default: "15" },
	},
});

const url = values["worker-url"];
const runKey = process.env.TRIAL_RUN_KEY ?? "";
if (!url || !runKey) {
	console.error("Set TRIAL_RUN_KEY and --worker-url, or run: pnpm feasibility:paid workers-ai");
	process.exit(2);
}
const gate = { "x-trial-key": runKey };
const log = (message: string) => console.error(`[workers-ai] ${message}`);

/** Cloudflare hands the tail Worker the Bot's CPU time shortly after its invocation ends. */
async function botCpu(runId: string): Promise<WorkersAiRun["request"]> {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const response = await fetch(`${url}/model-trial/cpu?run=${runId}&part=Bot`, {
			headers: gate,
		});
		if (response.ok) {
			const reading = (await response.json()) as CpuReading;
			return { cpuMs: reading.cpuTimeMs, wallMs: reading.wallTimeMs };
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	log("The tail Worker reported no CPU time within 60s, so CPU time is not recorded.");
	return undefined;
}

let colo = "unknown";
const runs: WorkersAiRun[] = [];
const count = Number(values.runs);
for (let i = 0; i < count; i++) {
	if (i > 0) {
		log(`Waiting ${values["interval-minutes"]} minutes before run ${i + 1} of ${count}.`);
		await new Promise((resolve) =>
			setTimeout(resolve, Number(values["interval-minutes"]) * 60_000),
		);
	}
	log(`Run ${i + 1} of ${count}: ${values.model} for account ${values.account}.`);
	const runId = randomUUID();
	const response = await fetch(`${url}/workers-ai/trial`, {
		method: "POST",
		headers: { ...gate, "x-trial-run": runId },
		body: JSON.stringify({ model: values.model, account: values.account }),
	});
	if (!response.ok)
		throw new Error(`The Bot answered ${response.status}: ${await response.text()}`);
	colo = response.headers.get("x-trial-colo") ?? colo;
	const run = (await response.json()) as Omit<WorkersAiRun, "startedAt"> & { startedAt: string };
	runs.push({ ...run, startedAt: new Date(run.startedAt), request: await botCpu(runId) });
	log(`Run ${i + 1}: ${run.outcome}.`);
}

log(
	"Paste this entry under Model route > Workers AI (#35) in docs/feasibility/decision-record.md:",
);
process.stdout.write(
	`\n${formatWorkersAiEvidence(runs, {
		origin: `Bot Durable Object in the deployed Worker (Cloudflare network, Workers Paid, Worker in data centre ${colo})`,
	})}`,
);
