#!/usr/bin/env node
import fs from "node:fs";
import { type ProviderAuthJob, runProviderAuth } from "./provider-auth.js";
import { encodeAuthLine } from "./provider-auth-protocol.js";

function writeError(code: string, message: string): void {
	process.stdout.write(encodeAuthLine({ v: 1, kind: "error", code, message }));
}

function parseArgs(argv: string[]): { jobPath?: string; error?: string } {
	const jobIndex = argv.indexOf("--job");
	if (jobIndex === -1) return { error: "--job is required" };
	const jobPath = argv[jobIndex + 1];
	if (!jobPath) return { error: "--job requires a path" };
	return { jobPath };
}

function parseJob(raw: string): { job?: ProviderAuthJob; error?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: "Job file must contain valid JSON" };
	}
	if (!parsed || typeof parsed !== "object") {
		return { error: "Job must be a JSON object" };
	}
	const job = parsed as Partial<ProviderAuthJob> & {
		mode?: string;
		authType?: string;
	};
	if (job.mode !== "login" && job.mode !== "resolve") {
		return { error: "mode must be login or resolve" };
	}
	if (typeof job.attemptId !== "string" || !job.attemptId) {
		return { error: "attemptId is required" };
	}
	if (typeof job.providerId !== "string" || !job.providerId) {
		return { error: "providerId is required" };
	}
	if (typeof job.resultPath !== "string" || !job.resultPath) {
		return { error: "resultPath is required" };
	}
	if (job.mode === "login") {
		if (job.authType !== "api_key" && job.authType !== "oauth") {
			return { error: "authType must be api_key or oauth" };
		}
		return {
			job: {
				mode: "login",
				attemptId: job.attemptId,
				providerId: job.providerId,
				authType: job.authType,
				resultPath: job.resultPath,
			},
		};
	}
	return {
		job: {
			mode: "resolve",
			attemptId: job.attemptId,
			providerId: job.providerId,
			resultPath: job.resultPath,
		},
	};
}

async function main(): Promise<number> {
	const { jobPath, error: argError } = parseArgs(process.argv.slice(2));
	if (argError || !jobPath) {
		writeError("invalid_job", argError ?? "--job is required");
		return 2;
	}
	let raw: string;
	try {
		raw = fs.readFileSync(jobPath, "utf8");
	} catch {
		writeError("invalid_job", `Unable to read job file: ${jobPath}`);
		return 2;
	}
	const { job, error: jobError } = parseJob(raw);
	if (jobError || !job) {
		writeError("invalid_job", jobError ?? "Invalid job file");
		return 2;
	}

	const result = await runProviderAuth({
		job,
		onEvent: (msg) => {
			process.stdout.write(encodeAuthLine(msg));
		},
	});
	return result.ok ? 0 : 1;
}

main()
	.then((code) => process.exit(code))
	.catch(() => {
		writeError("auth_failed", "Provider connection failed. Try again.");
		process.exit(1);
	});
