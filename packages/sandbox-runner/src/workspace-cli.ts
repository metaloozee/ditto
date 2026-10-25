#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readMessageFile,
	runCommit,
	runStatus,
	WORKSPACE_PATH,
	type WorkspaceGitResult,
} from "./workspace-git.js";

function flags(argv: string[], names: string[]) {
	const values = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 2) {
		const name = argv[i];
		const value = argv[i + 1];
		if (!name || !names.includes(name) || value === undefined) return undefined;
		if (values.has(name)) return undefined;
		values.set(name, value);
	}
	return names.every((name) => values.has(name)) ? values : undefined;
}

export function run(
	argv: string[],
	workspace: string = WORKSPACE_PATH,
): WorkspaceGitResult {
	const [action, ...rest] = argv;
	if (action === "status") {
		const values = flags(rest, ["--branch"]);
		if (!values) return { ok: false, error: "invalid_args" };
		return runStatus(workspace, values.get("--branch") ?? "");
	}
	if (action === "commit") {
		const values = flags(rest, ["--branch", "--message-file"]);
		if (!values) return { ok: false, error: "invalid_args" };
		const message = readMessageFile(values.get("--message-file") ?? "");
		if (message === undefined) return { ok: false, error: "invalid_args" };
		return runCommit(workspace, values.get("--branch") ?? "", message);
	}
	return { ok: false, error: "invalid_args" };
}

export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	const result = run(argv);
	process.stdout.write(`${JSON.stringify(result)}\n`);
	return result.ok ? 0 : 1;
}

const isDirectRun =
	typeof process.argv[1] === "string" &&
	(path.basename(process.argv[1]) === "workspace-cli.ts" ||
		path.basename(process.argv[1]) === "workspace-cli.js" ||
		fileURLToPath(import.meta.url) === process.argv[1]);

if (isDirectRun) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch(() => {
			process.stdout.write(
				`${JSON.stringify({ ok: false, error: "git_failed" })}\n`,
			);
			process.exitCode = 1;
		});
}
