#!/usr/bin/env node

import fs from "node:fs";
import {
	encodeGitMetadataOut,
	type GitMetadataOut,
	gitMetadataError,
	parseGitMetadataJobBytes,
} from "./git-metadata-job.js";
import { runGitMetadata } from "./run-git-metadata.js";

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

function writeOut(out: GitMetadataOut): void {
	process.stdout.write(encodeGitMetadataOut(out));
}

/** Testable main; does not auto-run on import. */
export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	const { jobPath, error: argError } = parseArgs(argv);
	if (argError || !jobPath) {
		writeOut(gitMetadataError("invalid_job"));
		return 2;
	}

	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(jobPath);
	} catch {
		writeOut(gitMetadataError("invalid_job"));
		return 2;
	}

	const parsed = parseGitMetadataJobBytes(bytes);
	if ("error" in parsed) {
		writeOut(gitMetadataError(parsed.code));
		return 2;
	}

	try {
		const out = await runGitMetadata(parsed);
		writeOut(out);
		return out.kind === "result" ? 0 : 1;
	} catch {
		writeOut(gitMetadataError("agent_failed", parsed.requestId));
		return 1;
	}
}

const isDirectRun =
	typeof process.argv[1] === "string" &&
	(process.argv[1].endsWith("git-metadata-cli.ts") ||
		process.argv[1].endsWith("git-metadata-cli.js"));

if (isDirectRun) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch(() => {
			writeOut(gitMetadataError("agent_failed"));
			process.exitCode = 1;
		});
}
