import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./workspace-cli.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		fs.rmSync(dir, { recursive: true, force: true });
});

const identity = {
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
};
function git(cwd: string, ...args: string[]) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...identity },
	}).trim();
}
function repo() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ditto-wsgit-"));
	dirs.push(root);
	const workspace = path.join(root, "workspace");
	fs.mkdirSync(workspace);
	git(workspace, "init", "-q", "-b", "owned");
	fs.writeFileSync(path.join(workspace, "a.txt"), "a\n");
	git(workspace, "add", "a.txt");
	git(workspace, "commit", "-q", "-m", "base");
	return { root, workspace };
}
function commit(
	root: string,
	workspace: string,
	message: string,
	branch = "owned",
) {
	const file = path.join(root, "message.txt");
	fs.writeFileSync(file, message);
	return run(["commit", "--branch", branch, "--message-file", file], workspace);
}

describe("ditto-workspace", () => {
	it("reports a clean status and counts changes", () => {
		const { workspace } = repo();
		const head = git(workspace, "rev-parse", "HEAD");
		expect(run(["status", "--branch", "owned"], workspace)).toEqual({
			ok: true,
			branch: "owned",
			head,
			changed: 0,
		});
		fs.writeFileSync(path.join(workspace, "a.txt"), "b\n");
		fs.writeFileSync(path.join(workspace, "new.txt"), "n\n");
		expect(run(["status", "--branch", "owned"], workspace)).toMatchObject({
			ok: true,
			changed: 2,
		});
	});

	it("refuses a branch mismatch for both subcommands", () => {
		const { root, workspace } = repo();
		expect(run(["status", "--branch", "other"], workspace)).toEqual({
			ok: false,
			error: "branch_mismatch",
		});
		expect(commit(root, workspace, "m", "other")).toEqual({
			ok: false,
			error: "branch_mismatch",
		});
	});

	it("commits a normal file and reports nothing to commit", () => {
		const { root, workspace } = repo();
		const before = git(workspace, "rev-parse", "HEAD");
		expect(commit(root, workspace, "empty")).toEqual({
			ok: true,
			committed: false,
			head: before,
		});
		fs.writeFileSync(path.join(workspace, "a.txt"), "changed\n");
		const result = commit(root, workspace, "change a");
		expect(result).toMatchObject({ ok: true, committed: true });
		expect(git(workspace, "rev-parse", "HEAD")).not.toBe(before);
		expect(git(workspace, "log", "-1", "--format=%an <%ae>|%s")).toBe(
			"Ditto <ditto@users.noreply.github.com>|change a",
		);
	});

	it("leaves an untracked .env uncommitted while committing its sibling", () => {
		const { root, workspace } = repo();
		fs.writeFileSync(path.join(workspace, ".env"), "SECRET=1\n");
		fs.writeFileSync(path.join(workspace, "ok.txt"), "ok\n");
		expect(commit(root, workspace, "sibling")).toMatchObject({
			committed: true,
		});
		const tracked = git(workspace, "ls-files").split("\n");
		expect(tracked).toContain("ok.txt");
		expect(tracked).not.toContain(".env");
	});

	it("refuses a pre-staged secret path and keeps HEAD", () => {
		const { root, workspace } = repo();
		fs.writeFileSync(path.join(workspace, ".env.local"), "SECRET=1\n");
		git(workspace, "add", "-f", ".env.local");
		const before = git(workspace, "rev-parse", "HEAD");
		expect(commit(root, workspace, "no")).toEqual({
			ok: false,
			error: "secret_path",
		});
		expect(git(workspace, "rev-parse", "HEAD")).toBe(before);
	});

	it("does not run repository hooks", () => {
		const { root, workspace } = repo();
		const marker = path.join(root, "hook-ran");
		const hook = path.join(workspace, ".git", "hooks", "pre-commit");
		fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
		fs.writeFileSync(path.join(workspace, "a.txt"), "hook\n");
		expect(commit(root, workspace, "hooked")).toMatchObject({
			committed: true,
		});
		expect(fs.existsSync(marker)).toBe(false);
	});

	it("commits a shell-looking message verbatim", () => {
		const { root, workspace } = repo();
		const message = "'; touch /tmp/ditto-wsgit-injected #";
		fs.rmSync("/tmp/ditto-wsgit-injected", { force: true });
		fs.writeFileSync(path.join(workspace, "a.txt"), "m\n");
		expect(commit(root, workspace, message)).toMatchObject({ committed: true });
		expect(git(workspace, "log", "-1", "--format=%s")).toBe(message);
		expect(fs.existsSync("/tmp/ditto-wsgit-injected")).toBe(false);
	});

	it("rejects malformed arguments", () => {
		expect(run(["status"], "/nonexistent")).toEqual({
			ok: false,
			error: "invalid_args",
		});
		expect(run(["push"], "/nonexistent")).toEqual({
			ok: false,
			error: "invalid_args",
		});
	});
});
