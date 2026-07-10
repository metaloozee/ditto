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

	it("builds conventional commit messages from session titles", () => {
		expect(
			buildExportCommitMessage({
				sessionTitle: "Add billing page",
				runId: "run-123",
			}),
		).toBe("feat: add billing page");

		expect(
			buildExportCommitMessage({
				sessionTitle: null,
				runId: "run-123456789",
			}),
		).toBe("chore: apply ditto session changes");

		expect(
			buildExportCommitMessage({
				sessionTitle: "Fix login redirect",
				runId: "run-1",
			}),
		).toBe("fix: login redirect");

		expect(
			buildExportCommitMessage({
				sessionTitle: "fix: already conventional",
				runId: "run-1",
			}),
		).toBe("fix: already conventional");

		expect(
			buildExportCommitMessage({
				sessionTitle: "feat(api): add endpoint",
				runId: "run-1",
			}),
		).toBe("feat(api): add endpoint");

		expect(
			buildExportCommitMessage({
				sessionTitle: "Refactor auth flow",
				runId: "run-1",
			}),
		).toBe("refactor: auth flow");

		expect(
			buildExportCommitMessage({
				sessionTitle: "Update README",
				runId: "run-1",
			}),
		).toBe("docs: update readme");

		expect(
			buildExportCommitMessage({
				sessionTitle: "Random idea title",
				runId: "run-1",
			}),
		).toBe("chore: random idea title");
	});

	it("builds a human PR title from commits or session title", () => {
		expect(
			buildPullRequestTitle({
				sessionTitle: "Is there a...",
				commitSubjects: ["feat: add skills readme"],
			}),
		).toBe("Add skills readme");

		expect(
			buildPullRequestTitle({
				commitSubjects: ["fix: login redirect"],
			}),
		).toBe("Fix login redirect");

		expect(
			buildPullRequestTitle({
				commitSubjects: ["fix(scope): handle edge case"],
			}),
		).toBe("Fix handle edge case");

		expect(buildPullRequestTitle({ sessionTitle: "Fix settings" })).toBe(
			"Fix settings",
		);

		expect(buildPullRequestTitle({ sessionTitle: "Is there a..." })).toBe(
			"Is there a",
		);

		expect(buildPullRequestTitle({ sessionTitle: "" })).toBe(
			"Workspace session changes",
		);

		const title = buildPullRequestTitle({ sessionTitle: "Fix settings" });
		expect(title).not.toMatch(/Apply Ditto/i);
		expect(title).not.toMatch(/Ditto/i);

		// Newest-first (git log): chore tip must not win over feat
		expect(
			buildPullRequestTitle({
				commitSubjects: ["chore: fix typo", "feat: add skills readme"],
			}),
		).toBe("Add skills readme");

		expect(
			buildPullRequestTitle({
				commitSubjects: [
					"docs: tweak readme",
					"fix: login redirect",
					"feat: add billing",
				],
			}),
		).toBe("Add billing");
	});

	it("builds a PR body with a human lead and session/run ids at the end", () => {
		const body = buildPullRequestBody({
			sessionId: "session-1",
			runId: "run-1",
			changedFileCount: 2,
			commitSubjects: ["feat: add billing page", "fix: typo in footer"],
		});

		expect(body.startsWith("This pull request adds billing page.")).toBe(true);
		expect(body).not.toMatch(/led by/i);
		expect(body).not.toMatch(/This pull request add /i);
		expect(body).not.toMatch(/This pull request fix /i);
		expect(body.startsWith("Session ID:")).toBe(false);
		expect(body).not.toContain("Project ID");
		expect(body).not.toContain("Ditto");
		expect(body).toContain("Included commits:");
		expect(body).toContain("- fix: typo in footer");
		expect(body).toContain("- feat: add billing page");
		const commitsSection =
			body.split("Included commits:")[1]?.split("---")[0] ?? "";
		expect(commitsSection.indexOf("fix: typo")).toBeLessThan(
			commitsSection.indexOf("feat: add billing"),
		);
		expect(body).toContain("Session ID: session-1");
		expect(body).toContain("Run ID: run-1");
		expect(body).toContain("2 changed files");
		expect(body).not.toMatch(/from the latest status/i);
	});

	it("builds a session PR body with description first and session id in the footer", () => {
		const body = buildSessionPullRequestBody({
			sessionId: "session-1",
			sessionTitle: "Is there a...",
			commitSubjects: ["feat: add skills readme"],
			changedFileCount: 0,
		});

		expect(body.startsWith("Add skills readme.")).toBe(true);
		expect(body.startsWith("Session ID:")).toBe(false);
		expect(body).not.toContain("Project ID");
		expect(body).not.toContain("Ditto");
		expect(body).toContain("Session ID: session-1");
		expect(body).not.toContain("0 changed");
		expect(body).not.toContain("Run ID");
	});

	it("lists changed file paths in the session PR body", () => {
		const body = buildSessionPullRequestBody({
			sessionId: "session-1",
			commitSubjects: ["feat: add skills readme"],
			changedFiles: ["README.md", "src/skills.ts", "docs/a.md"],
		});

		expect(body.startsWith("Add skills readme.")).toBe(true);
		expect(body).toContain("Files changed:");
		expect(body).toContain("- README.md");
		expect(body).toContain("- src/skills.ts");
		expect(body).toContain("- docs/a.md");
		expect(body).not.toContain("from the latest status");
		expect(body).not.toMatch(/It includes \d+ changed files/);
		const filesSection = body.split("Files changed:")[1]?.split("---")[0] ?? "";
		expect(filesSection.indexOf("README.md")).toBeLessThan(
			filesSection.indexOf("src/skills.ts"),
		);
	});

	it("caps long changed-file lists with a +N more line", () => {
		const changedFiles = Array.from(
			{ length: 22 },
			(_, i) => `src/file-${String(i).padStart(2, "0")}.ts`,
		);
		const body = buildSessionPullRequestBody({
			sessionId: "session-1",
			commitSubjects: ["chore: touch many files"],
			changedFiles,
		});

		expect(body).toContain("Files changed:");
		expect(body).toContain("- src/file-00.ts");
		expect(body).toContain("- src/file-19.ts");
		expect(body).not.toContain("- src/file-20.ts");
		expect(body).toContain("- +2 more");
	});

	it("lists multiple commit subjects in the session PR body", () => {
		const body = buildSessionPullRequestBody({
			sessionId: "session-2",
			commitSubjects: [
				"Merge branch 'main'",
				"fix: lint errors",
				"feat: add skills readme",
			],
		});

		expect(body).toContain("Included commits:");
		expect(body).toContain("- feat: add skills readme");
		expect(body).toContain("- fix: lint errors");
		expect(body).not.toContain("Merge branch");
		const commitsSection =
			body.split("Included commits:")[1]?.split("---")[0] ?? "";
		expect(commitsSection.indexOf("feat: add skills")).toBeLessThan(
			commitsSection.indexOf("fix: lint"),
		);
	});

	it("crafts session PR body from newest-first commits without led-by copy", () => {
		const body = buildSessionPullRequestBody({
			sessionId: "session-1",
			commitSubjects: ["chore: fix typo", "feat: add skills readme"],
		});

		expect(body.startsWith("This pull request adds skills readme.")).toBe(true);
		expect(body).toMatch(/skills readme/i);
		expect(body).not.toMatch(/led by/i);
		expect(body).not.toMatch(/This pull request add /i);
		expect(body).not.toMatch(/This pull request fix /i);
		const commitsSection =
			body.split("Included commits:")[1]?.split("---")[0] ?? "";
		expect(commitsSection.indexOf("feat: add skills")).toBeLessThan(
			commitsSection.indexOf("chore: fix typo"),
		);
	});

	it("uses grammatical fix/add leads for multi-commit PR summaries", () => {
		const fixBody = buildSessionPullRequestBody({
			sessionId: "session-1",
			commitSubjects: ["chore: tidy", "fix: login redirect"],
		});
		expect(fixBody.startsWith("This pull request fixes login redirect.")).toBe(
			true,
		);
		expect(fixBody).not.toMatch(/This pull request fix /i);

		const addBody = buildSessionPullRequestBody({
			sessionId: "session-1",
			commitSubjects: ["docs: note", "feat: add billing"],
		});
		expect(addBody).toMatch(/This pull request adds billing\./);
		expect(addBody).not.toMatch(/This pull request add /i);
	});

	it("uses a safe fallback summary when the primary title is not Add or Fix", () => {
		const body = buildSessionPullRequestBody({
			sessionId: "session-1",
			commitSubjects: ["chore: tidy", "refactor: auth flow"],
		});

		expect(body.startsWith("This pull request covers: Auth flow.")).toBe(true);
		expect(body).not.toMatch(/led by/i);
		expect(body).not.toMatch(/This pull request add /i);
		expect(body).not.toMatch(/This pull request fix /i);
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
