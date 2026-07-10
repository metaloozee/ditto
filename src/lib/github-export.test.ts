import { describe, expect, it } from "vitest";
import {
	buildExportBranchName,
	buildExportCommitMessage,
	buildPullRequestBody,
	buildPullRequestTitle,
	buildSessionPullRequestBody,
	countChangedFilesInDiffArtifact,
	quoteGitHubExportShellArg,
	redactGitHubExportOutput,
} from "./github-export";

describe("github export helpers", () => {
	it("builds a timestamped safe branch name from the run id", () => {
		const branchName = buildExportBranchName({
			runId: "run_123/abc unsafe ! value",
			now: new Date("2026-07-05T13:14:15.000Z"),
		});

		expect(branchName).toBe("ditto/run-run_123/abc--20260705131415");
		expect(branchName).toMatch(/^[A-Za-z0-9._/-]+$/);
	});

	it("falls back when the run id has no safe branch characters", () => {
		expect(
			buildExportBranchName({
				runId: "!!!",
				now: new Date("2026-07-05T13:14:15.000Z"),
			}),
		).toBe("ditto/run-unknown-20260705131415");
	});

	it("builds a conventional commit message", () => {
		expect(
			buildExportCommitMessage({
				sessionTitle: "Add billing page",
				runId: "run-123",
			}),
		).toBe("feat: apply Add billing page");

		expect(
			buildExportCommitMessage({
				sessionTitle: null,
				runId: "run-123456789",
			}),
		).toBe("feat: apply ditto run changes");
	});

	it("builds a deterministic PR title", () => {
		expect(buildPullRequestTitle({ sessionTitle: "Fix settings" })).toBe(
			"Apply Ditto changes: Fix settings",
		);
		expect(buildPullRequestTitle({ sessionTitle: "" })).toBe(
			"Apply Ditto run changes",
		);
	});

	it("builds a PR body with run context and explicit-user reminder", () => {
		const body = buildPullRequestBody({
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
			changedFileCount: 2,
		});

		expect(body).toContain("explicitly created by the signed-in user");
		expect(body).toContain("- Project ID: project-1");
		expect(body).toContain("- Session ID: session-1");
		expect(body).toContain("- Run ID: run-1");
		expect(body).toContain("- Changed files in diff artifact: 2 files");
	});

	it("builds a session PR body without a run id", () => {
		const body = buildSessionPullRequestBody({
			projectId: "project-1",
			sessionId: "session-1",
			changedFileCount: 1,
		});

		expect(body).toContain("Ditto workspace session");
		expect(body).not.toContain("Run ID");
		expect(body).toContain("- Changed files at open time: 1 file");
	});

	it("redacts secret-shaped GitHub export output", () => {
		const token = `ghs_${"a".repeat(40)}`;
		const output = `pushed to https://x-access-token:${token}@github.com/owner/repo.git`;

		expect(redactGitHubExportOutput(output)).not.toContain(token);
		expect(redactGitHubExportOutput(output)).toContain("[REDACTED]");
	});

	it("redacts concrete installation tokens in GitHub export output", () => {
		const token = "installation-token-value";

		expect(redactGitHubExportOutput(`token=${token}`, [token])).toBe(
			"token=[REDACTED]",
		);
	});

	it("counts changed files from diff artifact headers", () => {
		const patch = [
			"diff --git a/src/a.ts b/src/a.ts",
			"diff --git a/src/b.ts b/src/b.ts",
			"diff --git a/src/a.ts b/src/a.ts",
		].join("\n");

		expect(countChangedFilesInDiffArtifact(patch)).toBe(2);
	});

	it("quotes shell arguments for sandbox git commands", () => {
		expect(quoteGitHubExportShellArg("feat: don't guess")).toBe(
			"'feat: don'\\''t guess'",
		);
	});
});
