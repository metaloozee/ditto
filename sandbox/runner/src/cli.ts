#!/usr/bin/env node

import fs from "node:fs";
import { encodeLine } from "./protocol.js";
import { runAgent } from "./run-agent.js";

type Job = {
	runId: string;
	conversationId: string;
	model: string;
	prompt: string;
	cwd?: string;
};

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

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function parseJob(raw: string): { job?: Job; error?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: "Job file must contain valid JSON" };
	}

	if (!parsed || typeof parsed !== "object") {
		return { error: "Job must be a JSON object" };
	}

	const job = parsed as Partial<Job>;
	if (!isNonEmptyString(job.runId)) {
		return { error: "runId is required" };
	}
	if (!isNonEmptyString(job.conversationId)) {
		return { error: "conversationId is required" };
	}
	if (!isNonEmptyString(job.model)) {
		return { error: "model is required" };
	}
	if (!isNonEmptyString(job.prompt)) {
		return { error: "prompt is required" };
	}
	if (job.cwd !== undefined && !isNonEmptyString(job.cwd)) {
		return { error: "cwd must be a non-empty string when provided" };
	}

	return {
		job: {
			runId: job.runId,
			conversationId: job.conversationId,
			model: job.model,
			prompt: job.prompt,
			cwd: job.cwd,
		},
	};
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
