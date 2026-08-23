import { describe, expect, it } from "vitest";
import {
	makeSessionTitleFromMessage,
	sessionBranchName,
	sessionPreviewProcessId,
	sessionWorkspaceLockPath,
	WORKSPACE_PATH,
	WORKSPACE_SESSION_PREVIEW_PORT,
} from "#/lib/workspace-policy";

describe("workspace policy", () => {
	it("uses one fixed workspace and preview port", () => {
		expect(WORKSPACE_PATH).toBe("/workspace");
		expect(WORKSPACE_SESSION_PREVIEW_PORT).toBe(10000);
	});

	it("sanitizes session-derived branch, process, and lock names", () => {
		expect(sessionBranchName("bad/id")).toBe("ditto/session-bad-id");
		expect(sessionPreviewProcessId("a/../b")).toBe("ditto-preview-a-..-b");
		expect(sessionWorkspaceLockPath("bad/id")).toBe(
			"/tmp/ditto-session-locks/bad-id.lock",
		);
	});

	it("bounds generated titles", () => {
		expect(makeSessionTitleFromMessage("  one   two three ")).toBe(
			"one two three",
		);
		expect(
			makeSessionTitleFromMessage(
				"one two three four five six seven eight nine ten eleven",
			),
		).toBe("one two three four five six seven eight nine ten...");
	});
});
