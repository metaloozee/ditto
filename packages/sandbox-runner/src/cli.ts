#!/usr/bin/env node

import fs from "node:fs";
import { parseJob } from "./agent-job.js";
import { encodeLine } from "./protocol.js";
import { runAgent } from "./run-agent.js";

const DEFAULT_CWD = "/workspace";
const DEFAULT_AGENT_DIR = "/workspace/.ditto/pi-agent";
const DEFAULT_SESSIONS_DIR = "/workspace/.ditto/sessions";

function writeError(message: string): void {
	process.stdout.write(
		encodeLine({
			v: 1,
			kind: "error",
			message,
		}),
	);
}

function parseArgs(argv: string[]): { jobPath?: string; error?: string } {
	const jobIndex = argv.indexOf("--job");
	if (jobIndex === -1) {
		return { error: "--job is required" };
	}

	const jobPath = argv[jobIndex + 1];
	if (!jobPath) {
		return { error: "--job requires a path" };
	}

	return { jobPath };
}

async function main(): Promise<number> {
	const { jobPath, error: argError } = parseArgs(process.argv.slice(2));
	if (argError || !jobPath) {
		writeError(argError ?? "--job is required");
		return 2;
	}

	let rawJob: string;
	try {
		rawJob = fs.readFileSync(jobPath, "utf8");
	} catch {
		writeError(`Unable to read job file: ${jobPath}`);
		return 2;
	}

	const { job, error: jobError } = parseJob(rawJob);
	if (jobError || !job) {
		writeError(jobError ?? "Invalid job file");
		return 2;
	}

	const result = await runAgent({
		runId: job.runId,
		cwd: job.cwd ?? DEFAULT_CWD,
		conversationId: job.conversationId,
		modelSpecifier: job.model,
		thinkingLevel: job.thinkingLevel,
		prompt: job.prompt,
		agentDir: DEFAULT_AGENT_DIR,
		sessionsDir: DEFAULT_SESSIONS_DIR,
		onEvent: (msg) => {
			process.stdout.write(encodeLine(msg));
		},
	});

	return result.ok ? 0 : 1;
}

main()
	.then((code) => {
		process.exit(code);
	})
	.catch((err: unknown) => {
		const message =
			err instanceof Error ? err.message : "Unexpected CLI failure";
		writeError(message);
		process.exit(1);
	});
