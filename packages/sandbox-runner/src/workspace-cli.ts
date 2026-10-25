#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readMessageFile,
	runCommit,
	runFetch,
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
	if (action === "fetch") {
		const values = flags(rest, ["--repository", "--ref", "--branch"]);
		if (!values) return { ok: false, error: "invalid_args" };
		return runFetch(workspace, {
			repository: values.get("--repository") ?? "",
			ref: values.get("--ref") ?? "",
			branch: values.get("--branch") ?? "",
		});
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

export function isDirectRun(
	argv1: string | undefined,
	moduleUrl: string,
): boolean {
	if (typeof argv1 !== "string") return false;
	const base = path.basename(argv1);
	if (base === "workspace-cli.ts" || base === "workspace-cli.js") return true;
	try {
		return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
	} catch {
		return false;
	}
}

if (isDirectRun(process.argv[1], import.meta.url)) {
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
