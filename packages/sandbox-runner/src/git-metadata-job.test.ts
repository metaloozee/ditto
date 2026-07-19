import { describe, expect, it } from "vitest";
import {
	encodeGitMetadataOut,
	GIT_METADATA_MODEL,
	GIT_METADATA_PATCH_MAX_BYTES,
	GIT_METADATA_RAW_JOB_MAX_BYTES,
	gitMetadataError,
	parseGitMetadataJob,
	parseGitMetadataJobBytes,
	parseGitMetadataOut,
} from "./git-metadata-job.js";

const baseCommon = {
	branch: "ditto/session-1",
	headSha: "abc1234",
	changedPaths: [{ status: "M", path: "src/app.ts" }],
	diffStat: " 1 file changed, 1 insertion(+)",
	patch: "diff --git a/src/app.ts b/src/app.ts\n",
	patchTruncated: false,
	patchOriginalBytes: 40,
};

function commitJob(overrides: Record<string, unknown> = {}) {
	return {
		v: 1,
		requestId: "req-1",
		kind: "commit",
		model: GIT_METADATA_MODEL,
		snapshot: {
			kind: "commit_snapshot",
			...baseCommon,
		},
		...overrides,
	};
}

function prJob(overrides: Record<string, unknown> = {}) {
	return {
		v: 1,
		requestId: "req-2",
		kind: "pull_request",
		model: GIT_METADATA_MODEL,
		snapshot: {
			kind: "pull_request_snapshot",
			...baseCommon,
			baseSha: "def5678",
			commitSubjects: ["feat: add app", "fix: typo"],
		},
		...overrides,
	};
}

describe("parseGitMetadataJob", () => {
	it("accepts a minimal commit job", () => {
		const parsed = parseGitMetadataJob(commitJob());
		expect("error" in parsed).toBe(false);
		if ("error" in parsed) return;
		expect(parsed.kind).toBe("commit");
		expect(parsed.snapshot.kind).toBe("commit_snapshot");
	});

	it("accepts a pull_request job with rename path and subjects", () => {
		const parsed = parseGitMetadataJob(
			prJob({
				snapshot: {
					kind: "pull_request_snapshot",
					...baseCommon,
					changedPaths: [
						{ status: "R100", path: "b.ts", previousPath: "a.ts" },
						{ status: "A", path: "new.ts" },
					],
					baseSha: "abcdef0",
					commitSubjects: ["feat: rename"],
				},
			}),
		);
		expect("error" in parsed).toBe(false);
		if ("error" in parsed) return;
		expect(parsed.kind).toBe("pull_request");
		if (parsed.kind !== "pull_request") return;
		expect(parsed.snapshot.commitSubjects).toEqual(["feat: rename"]);
		expect(parsed.snapshot.changedPaths[0]).toEqual({
			status: "R100",
			path: "b.ts",
			previousPath: "a.ts",
		});
	});

	it("rejects previousPath on non-rename statuses", () => {
		const parsed = parseGitMetadataJob(
			commitJob({
				snapshot: {
					kind: "commit_snapshot",
					...baseCommon,
					changedPaths: [{ status: "M", path: "a.ts", previousPath: "b.ts" }],
				},
			}),
		);
		expect(parsed).toMatchObject({
			error: expect.stringContaining("previousPath"),
		});
	});

	it("rejects unknown keys and discriminants", () => {
		expect(parseGitMetadataJob({ ...commitJob(), extra: 1 })).toMatchObject({
			error: expect.any(String),
		});
		expect(
			parseGitMetadataJob({ ...commitJob(), kind: "merge" }),
		).toMatchObject({ error: "unknown job kind" });
		expect(
			parseGitMetadataJob({
				...commitJob(),
				snapshot: { ...commitJob().snapshot, extra: true },
			}),
		).toMatchObject({ error: expect.any(String) });
	});

	it("rejects NULs, oversize paths, and bad SHAs", () => {
		expect(
			parseGitMetadataJob(
				commitJob({
					snapshot: {
						kind: "commit_snapshot",
						...baseCommon,
						branch: "a\0b",
					},
				}),
			),
		).toMatchObject({ error: "invalid branch" });
		expect(
			parseGitMetadataJob(
				commitJob({
					snapshot: {
						kind: "commit_snapshot",
						...baseCommon,
						headSha: "not-a-sha",
					},
				}),
			),
		).toMatchObject({ error: "invalid headSha" });
		expect(
			parseGitMetadataJob(
				commitJob({
					snapshot: {
						kind: "commit_snapshot",
						...baseCommon,
						changedPaths: [{ status: "M", path: "x".repeat(2000) }],
					},
				}),
			),
		).toMatchObject({ error: "invalid changed path" });
	});

	it("maps unknown model and oversize raw bytes", () => {
		const unknown = parseGitMetadataJobBytes(
			JSON.stringify({ ...commitJob(), model: "other/model" }),
		);
		expect(unknown).toMatchObject({ code: "unknown_model" });

		const huge = Buffer.alloc(GIT_METADATA_RAW_JOB_MAX_BYTES + 1, 0x61);
		expect(parseGitMetadataJobBytes(huge)).toMatchObject({
			code: "invalid_job",
			error: "job exceeds size limit",
		});
	});

	it("rejects patch over the UTF-8 byte cap", () => {
		const patch = "x".repeat(GIT_METADATA_PATCH_MAX_BYTES + 1);
		expect(
			parseGitMetadataJob(
				commitJob({
					snapshot: {
						kind: "commit_snapshot",
						...baseCommon,
						patch,
						patchOriginalBytes: patch.length,
					},
				}),
			),
		).toMatchObject({ error: "invalid patch" });
	});
});

describe("parseGitMetadataOut", () => {
	it("accepts matching commit and pull_request results", () => {
		expect(
			parseGitMetadataOut(
				{
					v: 1,
					kind: "result",
					requestId: "req-1",
					output: { kind: "commit", message: "feat: add app" },
				},
				"req-1",
			),
		).toMatchObject({
			kind: "result",
			output: { kind: "commit", message: "feat: add app" },
		});
		expect(
			parseGitMetadataOut(
				{
					v: 1,
					kind: "result",
					requestId: "req-2",
					output: {
						kind: "pull_request",
						title: "Add app",
						body: "What changed.\n\n## Testing\nNot run (not shown in diff)",
					},
				},
				"req-2",
			),
		).toMatchObject({ kind: "result", output: { kind: "pull_request" } });
	});

	it("rejects request mismatch, extra fields, and unknown codes", () => {
		expect(
			parseGitMetadataOut(
				{
					v: 1,
					kind: "result",
					requestId: "other",
					output: { kind: "commit", message: "feat: x" },
				},
				"req-1",
			),
		).toMatchObject({ error: "requestId mismatch" });
		expect(
			parseGitMetadataOut({
				v: 1,
				kind: "result",
				requestId: "req-1",
				output: { kind: "commit", message: "feat: x", extra: 1 },
			}),
		).toMatchObject({ error: expect.any(String) });
		expect(
			parseGitMetadataOut({
				v: 1,
				kind: "error",
				code: "boom",
				message: "nope",
			}),
		).toMatchObject({ error: "invalid error code" });
	});

	it("encodes exactly one NDJSON line and safe errors without raw text dumps", () => {
		const line = encodeGitMetadataOut(
			gitMetadataError("agent_failed", "failed", "req-1"),
		);
		expect(line.endsWith("\n")).toBe(true);
		expect(line.trim().includes("\n")).toBe(false);
		const parsed = JSON.parse(line);
		expect(parsed).toEqual({
			v: 1,
			kind: "error",
			requestId: "req-1",
			code: "agent_failed",
			message: "failed",
		});
	});
});
