// Run one representative login workflow with take-over (#29).
//   pnpm feasibility:takeover <google|linkedin|protected>
// The bot opens the login page and hands the screen to the owner, who signs in through the
// loopback noVNC view. Only typing `hand back` returns control. The bot then inspects the screen,
// finishes the task and prints a redacted evidence entry to stdout. Prompts go to stderr.
// The signed-in profile stays in the desktop's Docker volume; `--down` discards it.
import { execFile } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, promisify } from "node:util";

import { Tab } from "./cdp.ts";
import { evidenceEntry } from "./entry.ts";
import { assertClean, redactUrl } from "./redact.ts";
import { TakeOver } from "./session.ts";
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
		.map((line) => JSON.parse(line) as { host: string; decision: string });

log("Starting the filter, desktop and viewer…");
await compose("up", "-d", "--build", "--wait", "desktop", "viewer");
const before = (await decisions()).length;
const at = new Date();

// The iterator buffers lines typed (or piped) before a question is asked.
const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const prompt = async (question: string): Promise<string> => {
	process.stderr.write(question);
	const { value, done } = await lines.next();
	if (done) throw new Error("Input closed before an answer");
	return value.trim();
};
const ask = async (question: string): Promise<string> => {
	for (;;) {
		const answer = await prompt(question);
		try {
			assertClean(answer);
			return answer;
		} catch (error) {
			log(`${(error as Error).message}. Describe it without the identifier.`);
		}
	}
};

const tab = await Tab.open("http://127.0.0.1:9222");
const session = new TakeOver();
// Pages render after load; give the signed-in check time to settle.
const signedIn = () => tab.waitFor(workflow.task.done, 15_000);

// A profile from an earlier run may already be signed in; then no take-over is needed.
await session.act(() => tab.goto(workflow.task.url));
let tookOver = false;
let afterHandBack: string | undefined;

if (!(await session.inspect(signedIn))) {
	await session.act(() => tab.goto(workflow.login));
	await session.takeOver();
	tookOver = true;

	log(`Take-over ready. The bot is not observing or operating the screen.`);
	log(
		`Open http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale and sign in to ${workflow.name}.`,
	);
	log("Complete only the login and any challenge. Note what the site asked and how it responded.");
	while ((await prompt('Type "hand back" to return control: ')).toLowerCase() !== "hand back") {
		log("The owner keeps control until they type hand back.");
	}
	session.handBack();

	// Inspect before acting: the screen may not be where the bot left it.
	afterHandBack = await session.inspect(() => tab.evaluate<string>("location.href"));
	log(`After hand-back the tab is at ${redactUrl(afterHandBack)}.`);
}

log(`Bot resumes: ${workflow.task.describe}.`);
await session.act(() => tab.goto(workflow.task.url));
const botFinished = await session.inspect(signedIn);
const finishedAt = await session.inspect(() => tab.evaluate<string>("location.href"));
tab.close();
log(`Bot finished the task: ${botFinished ? "yes" : "no"}.`);

const challenges = tookOver
	? await ask("Challenges seen (CAPTCHA, device check, blocked network, none): ")
	: "";
const siteResponse = tookOver ? await ask("How did the site respond to them: ") : "";
const steppedThrough =
	tookOver &&
	/^y/i.test(await ask("Did you operate the site beyond the login or challenge? (y/n): "));
process.stdin.destroy();

const denied = [
	...new Set(
		(await decisions())
			.slice(before)
			.filter((decision) => decision.decision === "deny")
			.map((decision) => decision.host),
	),
].sort();

log(
	`Paste this entry under Login workflows (#29) > ${workflow.name} in docs/feasibility/decision-record.md:`,
);
process.stdout.write(
	evidenceEntry({
		workflow: workflow.name,
		task: workflow.task.describe,
		at,
		tookOver,
		steppedThrough,
		botFinished,
		afterHandBack,
		finishedAt,
		challenges,
		siteResponse,
		denied,
	}),
);
