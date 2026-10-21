#!/usr/bin/env node

import fs from "node:fs";
import {
	executeToolOperation,
	initializeExecutor,
	MAX_OPERATION_BYTES,
	takeExecValues,
} from "./tool-exec.js";

// Executors never fetch helper binaries at run time; grep/find use the image's rg/fd.
process.env.PI_OFFLINE = "1";
// Taken first so no tool, helper or later child inherits the values.
let values: Record<string, string> | undefined;
let malformedValues = false;
try {
	values = takeExecValues(process.env);
} catch {
	malformedValues = true;
}

const root = process.env.DITTO_EXEC_ROOT ?? "/workspace";
const stateDir = process.env.DITTO_EXEC_STATE ?? "/var/lib/ditto-exec";

function readRequest(file: string) {
	const stat = fs.statSync(file);
	if (stat.size > MAX_OPERATION_BYTES) throw new Error("Operation too large");
	return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	if (command === "init" && rest.length === 2) {
		const generation = Number(rest[1]);
		const state = await initializeExecutor(stateDir, {
			workspaceSessionId: rest[0] ?? "",
			generation,
		});
		process.stdout.write(`${JSON.stringify(state)}\n`);
		return 0;
	}
	if (command === "run" && rest.length === 1 && rest[0]) {
		let input: unknown;
		try {
			input = readRequest(rest[0]);
		} catch {
			input = undefined;
		}
		const outcome = await executeToolOperation(input, {
			root,
			stateDir,
			...(values ? { values } : {}),
			...(malformedValues ? { malformedValues } : {}),
		});
		process.stdout.write(`${JSON.stringify(outcome)}\n`);
		return 0;
	}
	process.stderr.write(
		"Usage: ditto-exec init <session> <generation> | run <file>\n",
	);
	return 2;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : "Executor failed"}\n`,
		);
		process.exitCode = 1;
	},
);
