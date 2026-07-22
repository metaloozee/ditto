import { describe, expect, it } from "vitest";
import {
	isSessionPreviewPort,
	SESSION_PREVIEW_PORT_MAX,
	SESSION_PREVIEW_PORT_MIN,
	SESSION_WORKTREE_ROOT,
	sessionBranchName,
	sessionPreviewProcessId,
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

describe("session preview process ids and ports", () => {
	it("builds deterministic sanitized process ids", () => {
		expect(sessionPreviewProcessId("abc123")).toBe("ditto-preview-abc123");
		expect(sessionPreviewProcessId("bad/id")).toBe("ditto-preview-bad-id");
		expect(sessionPreviewProcessId("a/../b")).toBe("ditto-preview-a-..-b");
		expect(sessionPreviewProcessId("  spaced  ")).toBe("ditto-preview-spaced");
		expect(sessionPreviewProcessId("///")).toBe("ditto-preview-session");
	});

	it("is deterministic for the same id", () => {
		expect(sessionPreviewProcessId("sess-1")).toBe(
			sessionPreviewProcessId("sess-1"),
		);
	});

	it("differs across session ids", () => {
		expect(sessionPreviewProcessId("sess-a")).not.toBe(
			sessionPreviewProcessId("sess-b"),
		);
	});

	it("accepts only the fixed preview port pool", () => {
		expect(isSessionPreviewPort(SESSION_PREVIEW_PORT_MIN)).toBe(true);
		expect(isSessionPreviewPort(SESSION_PREVIEW_PORT_MAX)).toBe(true);
		expect(isSessionPreviewPort(SESSION_PREVIEW_PORT_MIN - 1)).toBe(false);
		expect(isSessionPreviewPort(SESSION_PREVIEW_PORT_MAX + 1)).toBe(false);
		expect(isSessionPreviewPort(3000)).toBe(false);
		expect(isSessionPreviewPort(10000.5)).toBe(false);
	});
});
