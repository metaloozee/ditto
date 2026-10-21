import { describe, expect, it } from "vitest";
import {
	parseBrowserWorkspaceActionV1,
	parseWorkspaceActionV1,
	WORKSPACE_ACTION_LIMITS,
} from "./workspace-action.js";

describe("workspace action contracts", () => {
	it("accepts the four typed actions and only a commit carries a message", () => {
		for (const kind of ["git_status", "preview_start", "preview_stop"])
			expect(parseWorkspaceActionV1({ version: 1, kind })).toEqual({
				version: 1,
				kind,
			});
		expect(
			parseWorkspaceActionV1({
				version: 1,
				kind: "git_commit",
				message: "Edit",
			}),
		).toEqual({ version: 1, kind: "git_commit", message: "Edit" });
		for (const value of [
			{ version: 1, kind: "git_commit" },
			{ version: 1, kind: "git_commit", message: "  " },
			{
				version: 1,
				kind: "git_commit",
				message: "x".repeat(WORKSPACE_ACTION_LIMITS.commitMessageBytes + 1),
			},
			{ version: 1, kind: "git_status", message: "no" },
			{ version: 1, kind: "git_push" },
			{ version: 1, kind: "pull_request" },
			{ version: 2, kind: "git_status" },
			{ version: 1, kind: "preview_start", command: "npm run dev" },
			{ version: 1, kind: "preview_start", port: 3000 },
		])
			expect(() => parseWorkspaceActionV1(value)).toThrow();
	});

	it("binds a browser action to bounded session ids", () => {
		const browser = {
			version: 1,
			kind: "preview_stop",
			projectId: "project",
			sessionId: "session",
		};
		expect(parseBrowserWorkspaceActionV1(browser)).toEqual(browser);
		expect(() =>
			parseWorkspaceActionV1({ ...browser, projectId: undefined }),
		).toThrow();
		for (const missing of ["projectId", "sessionId"]) {
			const { [missing as "projectId"]: _, ...rest } = browser;
			expect(() => parseBrowserWorkspaceActionV1(rest)).toThrow();
		}
		expect(() =>
			parseBrowserWorkspaceActionV1({
				...browser,
				sessionId: "s".repeat(WORKSPACE_ACTION_LIMITS.idCharacters + 1),
			}),
		).toThrow();
	});
});
