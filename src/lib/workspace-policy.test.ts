import { describe, expect, it } from "vitest";
import {
	SESSION_WORKTREE_ROOT,
	sessionBranchName,
	sessionWorkspaceLockPath,
	sessionWorktreePath,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";

describe("session worktree paths", () => {
	it("defines worktree root under workspace", () => {
		expect(SESSION_WORKTREE_ROOT).toBe(`${WORKSPACE_PATH}/.ditto/worktrees`);
	});

	it("builds worktree path and sanitizes unsafe segments", () => {
		const id = "abc123";
		expect(sessionWorktreePath(id)).toBe("/workspace/.ditto/worktrees/abc123");
		expect(sessionWorktreePath("bad/id")).toBe(
			"/workspace/.ditto/worktrees/bad-id",
		);
		expect(sessionWorktreePath("a/../b")).toBe(
			"/workspace/.ditto/worktrees/a-..-b",
		);
	});

	it("builds branch name with ditto/session prefix and 12-char segment", () => {
		expect(sessionBranchName("abcdefghijklmnop")).toBe(
			"ditto/session-abcdefghijkl",
		);
		expect(sessionBranchName("bad/id!here")).toBe("ditto/session-bad-id-here");
		const branch = sessionBranchName("bad/id!here");
		expect(branch.startsWith("ditto/session-")).toBe(true);
		expect(branch.replace("ditto/session-", "").length).toBeLessThanOrEqual(12);
	});

	it("builds a sanitized ephemeral workspace lock path", () => {
		expect(sessionWorkspaceLockPath("bad/id")).toBe(
			"/tmp/ditto-session-locks/bad-id.lock",
		);
	});
});
