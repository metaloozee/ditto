#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
	parseControlRequest,
	sendControlRequest,
	type ControlRequest,
} from "./control-channel.js";

export function parseControlCliArgs(
	argv: string[],
): { jobPath?: string; error?: string } {
	if (argv.length !== 2 || argv[0] !== "--job" || !argv[1]) {
		return { error: "Usage: control-cli --job <path>" };
	}
	return { jobPath: argv[1] };
}

export function parseControlJob(raw: string): ControlRequest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Control job must contain valid JSON");
	}
	return parseControlRequest(parsed);
}

export async function runControlCli(argv: string[]): Promise<number> {
	const { jobPath, error } = parseControlCliArgs(argv);
	if (error || !jobPath) throw new Error(error ?? "Control job path is required");
	const request = parseControlJob(fs.readFileSync(jobPath, "utf8"));
	const response = await sendControlRequest(request);
	process.stdout.write(`${JSON.stringify(response)}\n`);
	return response.accepted ? 0 : 1;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	runControlCli(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : "Control failed";
			process.stderr.write(`${message.slice(0, 500)}\n`);
			process.exitCode = 2;
		});
}
