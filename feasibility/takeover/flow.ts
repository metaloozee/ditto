// One representative login workflow with take-over, wherever the desktop runs: local Docker (#29)
// or Cloudflare Containers (#32). The bot opens the login page and hands the screen to the owner.
// Only typing `hand back` returns control. The bot then inspects the screen, opens the task's signed-in
// page and returns a redacted evidence entry. Prompts go to stderr.
import { createInterface } from "node:readline/promises";

import { Tab } from "./cdp.ts";
import { ALREADY_SIGNED_IN, evidenceEntry, type Observation } from "./entry.ts";
import { assertClean, redactUrl } from "./redact.ts";
import { TakeOver } from "./session.ts";
import type { Workflow } from "./workflows.ts";

export type Decision = { host: string; decision: string };

export async function takeOverWorkflow(options: {
	workflow: Workflow;
	/** DevTools for the bot, on the owner's loopback. */
	devtools: string;
	/** The noVNC page the owner opens. */
	viewUrl: string;
	/** Every filter decision so far, oldest first. */
	decisions: () => Promise<Decision[]>;
	host?: Observation["host"];
	/**
	 * Ends every bot's DevTools access before take-over is ready and restores it at hand-back
	 * (ADR-0007). The bot's own tab closes first and is opened again after hand-back.
	 */
	lock?: { takeOver(): Promise<void>; handBack(): Promise<void> };
	log: (message: string) => void;
}): Promise<string> {
	const { workflow, log } = options;
	const before = (await options.decisions()).length;
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

	let tab = await Tab.open(options.devtools);
	const session = new TakeOver();
	// Pages render after load; give the signed-in check time to settle.
	const signedIn = () => tab.waitFor(workflow.task.done, 15_000);

	// A profile from an earlier run of this workflow would pass without testing the login.
	await session.act(() => tab.goto(workflow.task.url));
	if (await session.inspect(signedIn)) {
		tab.close();
		process.stdin.destroy();
		throw new Error(`${workflow.name}: ${ALREADY_SIGNED_IN}`);
	}

	await session.act(() => tab.goto(workflow.login));
	await session.takeOver();
	if (options.lock) {
		tab.close();
		await options.lock.takeOver();
	}

	log(`Take-over ready. The bot is not observing or operating the screen.`);
	log(`Open ${options.viewUrl} and sign in to ${workflow.name}.`);
	log("Complete only the login and any challenge. Note what the site asked and how it responded.");
	while ((await prompt('Type "hand back" to return control: ')).toLowerCase() !== "hand back") {
		log("The owner keeps control until they type hand back.");
	}
	if (options.lock) {
		await options.lock.handBack();
		tab = await Tab.open(options.devtools);
	}
	session.handBack();

	// Inspect before acting: the screen may not be where the bot left it.
	const afterHandBack = await session.inspect(() => tab.evaluate<string>("location.href"));
	log(`After hand-back the tab is at ${redactUrl(afterHandBack)}.`);

	log(`Bot resumes: ${workflow.task.describe}.`);
	await session.act(() => tab.goto(workflow.task.url));
	const botSignedIn = await session.inspect(signedIn);
	const finishedAt = await session.inspect(() => tab.evaluate<string>("location.href"));
	tab.close();
	log(`Bot reached the signed-in page: ${botSignedIn ? "yes" : "no"}.`);

	const challenges = await ask("Challenges seen (CAPTCHA, device check, blocked network, none): ");
	const siteResponse = await ask("How did the site respond to them: ");
	const steppedThrough = /^y/i.test(
		await ask("Did you operate the site beyond the login or challenge? (y/n): "),
	);
	process.stdin.destroy();

	const denied = [
		...new Set(
			(await options.decisions())
				.slice(before)
				.filter((decision) => decision.decision === "deny")
				.map((decision) => decision.host),
		),
	].sort();

	return evidenceEntry({
		workflow: workflow.name,
		task: workflow.task.describe,
		at,
		tookOver: true,
		steppedThrough,
		botSignedIn,
		afterHandBack,
		finishedAt,
		challenges,
		siteResponse,
		denied,
		host: options.host,
	});
}
