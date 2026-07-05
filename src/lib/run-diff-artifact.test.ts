import { describe, expect, it } from "vitest";
import {
	buildDiffReadyPayload,
	buildRunDiffArtifactPlan,
	MAX_RUN_DIFF_ARTIFACT_BYTES,
	parseChangedFilesFromGitStatus,
	RUN_DIFF_ARTIFACT_CONTENT_TYPE,
} from "./run-diff-artifact";

const projectId = "project-1";
const runId = "run-1";

describe("run diff artifact plan", () => {
	it("uses the project/run diff artifact key prefix", () => {
		const plan = buildRunDiffArtifactPlan({
			projectId,
			runId,
			artifactId: "diff-1",
			patch: "diff --git a/src/index.ts b/src/index.ts\n",
		});

		expect(plan.artifactId).toBe("diff-1");
		expect(plan.r2Key).toBe(
			"projects/project-1/runs/run-1/artifacts/diff/diff-1",
		);
		expect(plan.contentType).toBe(RUN_DIFF_ARTIFACT_CONTENT_TYPE);
	});

	it("reports UTF-8 byte length, not character length", () => {
		const plan = buildRunDiffArtifactPlan({
			projectId,
			runId,
			artifactId: "diff-1",
			patch: "é", // 2 bytes in UTF-8
		});

		expect(plan.byteLength).toBe(2);
	});

	it("is pure and performs no I/O", () => {
		expect(() =>
			buildRunDiffArtifactPlan({
				projectId,
				runId,
				artifactId: "diff-2",
				patch: "",
			}),
		).not.toThrow();
	});
});

describe("parseChangedFilesFromGitStatus", () => {
	it("parses modified, added, and deleted entries", () => {
		const status = [" M src/index.ts", "A  src/new.ts", "D  src/old.ts"].join(
			"\n",
		);

		expect(parseChangedFilesFromGitStatus(status)).toEqual([
			"src/index.ts",
			"src/new.ts",
			"src/old.ts",
		]);
	});

	it("returns the new path for rename entries", () => {
		const status = [
			"R  src/old.ts -> src/new.ts",
			"C  src/a.ts -> src/b.ts",
		].join("\n");

		expect(parseChangedFilesFromGitStatus(status)).toEqual([
			"src/new.ts",
			"src/b.ts",
		]);
	});

	it("handles staged and unstaged combined status codes", () => {
		const status = ["MM src/index.ts", "?? src/untracked.ts"].join("\n");

		expect(parseChangedFilesFromGitStatus(status)).toEqual([
			"src/index.ts",
			"src/untracked.ts",
		]);
	});

	it("unquotes paths with special characters", () => {
		const status = ' M "src/my file.ts"';
		expect(parseChangedFilesFromGitStatus(status)).toEqual(["src/my file.ts"]);
	});

	it("unquotes the new path for quoted renames", () => {
		const status = 'R  "src/old file.ts" -> "src/new file.ts"';
		expect(parseChangedFilesFromGitStatus(status)).toEqual(["src/new file.ts"]);
	});

	it("ignores blank lines and malformed input", () => {
		const status = ["", " M src/index.ts", "", "x"].join("\n");
		const files = parseChangedFilesFromGitStatus(status);
		expect(files).toContain("src/index.ts");
		expect(files).not.toContain("");
	});

	it("returns an empty array for empty input", () => {
		expect(parseChangedFilesFromGitStatus("")).toEqual([]);
	});

	it("respects the max artifact byte constant", () => {
		expect(MAX_RUN_DIFF_ARTIFACT_BYTES).toBe(2 * 1024 * 1024);
	});
});

describe("buildDiffReadyPayload", () => {
	it("includes metadata and omits raw patch text", () => {
		const plan = buildRunDiffArtifactPlan({
			projectId,
			runId,
			artifactId: "diff-1",
			patch: "SECRET diff content",
		});
		const payload = buildDiffReadyPayload({
			artifactId: plan.artifactId,
			changedFiles: ["src/index.ts"],
			byteLength: plan.byteLength,
			contentType: plan.contentType,
			hasArtifact: true,
		});

		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain("SECRET diff content");
		expect(payload).toMatchObject({
			artifactId: "diff-1",
			changedFiles: ["src/index.ts"],
			byteLength: plan.byteLength,
			contentType: RUN_DIFF_ARTIFACT_CONTENT_TYPE,
			truncated: false,
			hasArtifact: true,
		});
		expect(payload.error).toBeUndefined();
	});

	it("supports a no-artifact payload with changed files", () => {
		const payload = buildDiffReadyPayload({
			changedFiles: ["src/index.ts"],
			hasArtifact: false,
		});

		expect(payload).toMatchObject({
			artifactId: null,
			changedFiles: ["src/index.ts"],
			byteLength: 0,
			truncated: false,
			hasArtifact: false,
		});
	});

	it("supports a truncated, no-artifact payload with byte length", () => {
		const payload = buildDiffReadyPayload({
			changedFiles: ["src/big.ts"],
			byteLength: 3_000_000,
			truncated: true,
			hasArtifact: false,
		});

		expect(payload.truncated).toBe(true);
		expect(payload.hasArtifact).toBe(false);
		expect(payload.byteLength).toBe(3_000_000);
		expect(payload.artifactId).toBeNull();
	});

	it("includes a redacted error when provided", () => {
		const payload = buildDiffReadyPayload({
			changedFiles: [],
			hasArtifact: false,
			error: "R2 write failed",
		});

		expect(payload.error).toBe("R2 write failed");
		expect(payload.hasArtifact).toBe(false);
	});
});
