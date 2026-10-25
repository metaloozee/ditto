import { execFileSync } from "node:child_process";
import fs from "node:fs";

export const WORKSPACE_PATH = "/workspace";
const COMMIT_AUTHOR_NAME = "Ditto";
const COMMIT_AUTHOR_EMAIL = "ditto@users.noreply.github.com";
const GIT_TIMEOUT_MS = 60_000;

const CLOSED_ENV = {
	PATH: "/usr/local/bin:/usr/bin:/bin",
	HOME: "/nonexistent",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
};

export type WorkspaceGitErrorCode =
	| "branch_mismatch"
	| "secret_path"
	| "git_failed"
	| "invalid_args";

export type WorkspaceGitResult =
	| { ok: true; branch: string; head: string; changed: number }
	| { ok: true; committed: boolean; head: string }
	| { ok: false; error: WorkspaceGitErrorCode };

class WorkspaceGitError extends Error {
	constructor(readonly code: WorkspaceGitErrorCode) {
		super(code);
	}
}

/** `.env` and `.env.*` basenames, nested paths included. */
export function isSecretLikeGitPath(filePath: string): boolean {
	const candidate = filePath.trim();
	const base = candidate.split("/").pop() ?? candidate;
	return base === ".env" || base.startsWith(".env.");
}

export type PorcelainEntry = {
	indexStatus: string;
	paths: string[];
};

/** Parses `git status --porcelain=v1 -z`; fails closed on malformed records. */
export function parsePorcelainZ(porcelain: string): PorcelainEntry[] {
	const parts = porcelain.split("\0");
	const entries: PorcelainEntry[] = [];
	let i = 0;
	while (i < parts.length) {
		const record = parts[i];
		if (record === undefined || record === "") {
			i += 1;
			continue;
		}
		if (record.length < 4 || record[2] !== " ")
			throw new WorkspaceGitError("git_failed");
		const indexStatus = record[0] ?? "";
		const workTreeStatus = record[1] ?? "";
		const first = record.slice(3);
		const renameOrCopy = [indexStatus, workTreeStatus].some(
			(status) => status === "R" || status === "C",
		);
		if (renameOrCopy) {
			const second = parts[i + 1];
			if (!second) throw new WorkspaceGitError("git_failed");
			entries.push({ indexStatus, paths: [first, second] });
			i += 2;
			continue;
		}
		entries.push({ indexStatus, paths: [first] });
		i += 1;
	}
	return entries;
}

function git(workspace: string, args: string[]): string {
	try {
		return execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"core.fsmonitor=false",
				"-C",
				workspace,
				...args,
			],
			{
				env: CLOSED_ENV,
				encoding: "utf8",
				timeout: GIT_TIMEOUT_MS,
				stdio: ["ignore", "pipe", "ignore"],
				maxBuffer: 64 * 1024 * 1024,
			},
		);
	} catch {
		throw new WorkspaceGitError("git_failed");
	}
}

function ownedBranch(workspace: string, branch: string) {
	try {
		execFileSync("git", ["check-ref-format", "--branch", branch], {
			env: CLOSED_ENV,
			stdio: "ignore",
			timeout: GIT_TIMEOUT_MS,
		});
	} catch {
		throw new WorkspaceGitError("invalid_args");
	}
	let current: string;
	try {
		current = git(workspace, ["symbolic-ref", "--short", "HEAD"]).trim();
	} catch {
		throw new WorkspaceGitError("branch_mismatch");
	}
	if (current !== branch) throw new WorkspaceGitError("branch_mismatch");
}

function wrap<T>(
	run: () => T,
): T | { ok: false; error: WorkspaceGitErrorCode } {
	try {
		return run();
	} catch (error) {
		return {
			ok: false,
			error: error instanceof WorkspaceGitError ? error.code : "git_failed",
		};
	}
}

export function runStatus(
	workspace: string,
	branch: string,
): WorkspaceGitResult {
	return wrap(() => {
		ownedBranch(workspace, branch);
		const head = git(workspace, ["rev-parse", "HEAD"]).trim();
		const changed = parsePorcelainZ(
			git(workspace, ["status", "--porcelain=v1", "-z", "-uall"]),
		).length;
		return { ok: true as const, branch, head, changed };
	});
}

export function runCommit(
	workspace: string,
	branch: string,
	message: string,
): WorkspaceGitResult {
	return wrap(() => {
		if (!message.trim()) throw new WorkspaceGitError("invalid_args");
		ownedBranch(workspace, branch);
		const head = () => git(workspace, ["rev-parse", "HEAD"]).trim();
		const entries = parsePorcelainZ(
			git(workspace, ["status", "--porcelain=v1", "-z", "-uall"]),
		);
		if (entries.length === 0)
			return { ok: true as const, committed: false, head: head() };
		for (const entry of entries) {
			const staged = entry.indexStatus !== " " && entry.indexStatus !== "?";
			if (staged && entry.paths.some(isSecretLikeGitPath))
				throw new WorkspaceGitError("secret_path");
		}
		const stageable = [
			...new Set(
				entries
					.filter((entry) => !entry.paths.some(isSecretLikeGitPath))
					.flatMap((entry) => entry.paths),
			),
		];
		if (stageable.length === 0)
			return { ok: true as const, committed: false, head: head() };
		git(workspace, ["add", "--", ...stageable]);
		const staged = git(workspace, ["diff", "--cached", "--name-only", "-z"])
			.split("\0")
			.map((p) => p.trim())
			.filter(Boolean);
		if (staged.some(isSecretLikeGitPath))
			throw new WorkspaceGitError("secret_path");
		if (staged.length === 0)
			return { ok: true as const, committed: false, head: head() };
		git(workspace, [
			"-c",
			`user.name=${COMMIT_AUTHOR_NAME}`,
			"-c",
			`user.email=${COMMIT_AUTHOR_EMAIL}`,
			"commit",
			"-m",
			message,
		]);
		return { ok: true as const, committed: true, head: head() };
	});
}

export function readMessageFile(messagePath: string): string | undefined {
	try {
		return fs.readFileSync(messagePath, "utf8");
	} catch {
		return undefined;
	}
}
