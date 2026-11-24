// Run one representative login workflow with take-over (#29).
//   pnpm feasibility:takeover <google|linkedin|protected>
// The bot opens the login page and hands the screen to the owner, who signs in through the
// loopback noVNC view. Only typing `hand back` returns control. The bot then inspects the screen,
// finishes the task and prints a redacted evidence entry to stdout. Prompts go to stderr.
// The signed-in profile stays in the desktop's Docker volume; `--down` discards it.
import { execFile } from "node:child_process";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

import { type Decision, takeOverWorkflow } from "./flow.ts";
import { workflows, type WorkflowId } from "./workflows.ts";

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: { down: { type: "boolean", default: false } },
});

const here = import.meta.dirname;
const env = {
	...process.env,
	WORKSPACE_ID: "ws-takeover",
	DESTINATIONS_DIR: path.join(here, "destinations"),
};
const compose = async (...args: string[]) =>
	(
		await promisify(execFile)(
			"docker",
			["compose", "-f", path.join(here, "compose.yaml"), ...args],
			{
				env,
				maxBuffer: 64 * 1024 * 1024,
			},
		)
	).stdout;
const log = (message: string) => console.error(`[takeover] ${message}`);

if (values.down) {
	await compose("down", "-v");
	log("Stopped the stack and discarded the CA and the signed-in profile.");
	process.exit(0);
}

const id = positionals[0] as WorkflowId | undefined;
if (!id || !(id in workflows)) {
	console.error(`Usage: pnpm feasibility:takeover <${Object.keys(workflows).join("|")}> | --down`);
	process.exit(2);
}
const workflow = workflows[id];

const decisions = async () =>
	(await compose("logs", "--no-log-prefix", "filter"))
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Decision);

log("Starting the filter, desktop and viewer…");
await compose("up", "-d", "--build", "--wait", "desktop", "viewer");

const entry = await takeOverWorkflow({
	workflow,
	devtools: "http://127.0.0.1:9222",
	viewUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale",
	decisions,
	log,
});
log(
	`Paste this entry under Login workflows (#29) > ${workflow.name} in docs/feasibility/decision-record.md:`,
);
process.stdout.write(entry);
