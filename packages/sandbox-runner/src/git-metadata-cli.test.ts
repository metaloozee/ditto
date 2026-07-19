import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GIT_METADATA_MODEL } from "./git-metadata-job.js";

const mocks = vi.hoisted(() => ({
	runGitMetadata: vi.fn(),
}));

vi.mock("./run-git-metadata.js", () => ({
	runGitMetadata: mocks.runGitMetadata,
}));

import { main } from "./git-metadata-cli.js";

const tempFiles: string[] = [];

afterEach(() => {
	for (const file of tempFiles.splice(0)) {
		try {
			fs.unlinkSync(file);
		} catch {
			// ignore
		}
	}
	vi.restoreAllMocks();
	mocks.runGitMetadata.mockReset();
});

function writeJob(job: unknown): string {
	const file = path.join(
		os.tmpdir(),
		`ditto-git-metadata-cli-${Date.now()}-${Math.random()}.json`,
	);
	fs.writeFileSync(file, JSON.stringify(job));
	tempFiles.push(file);
	return file;
}

describe("git-metadata-cli main", () => {
	it("writes exactly one protocol stdout line on success", async () => {
		const jobPath = writeJob({
			v: 1,
			requestId: "req-1",
			kind: "commit",
			model: GIT_METADATA_MODEL,
			snapshot: {
				kind: "commit_snapshot",
				branch: "main",
				headSha: "abc1234",
				changedPaths: [{ status: "M", path: "a.ts" }],
				diffStat: "ok",
				patch: "diff",
				patchTruncated: false,
				patchOriginalBytes: 4,
			},
		});
		mocks.runGitMetadata.mockResolvedValue({
			v: 1,
			kind: "result",
			requestId: "req-1",
			output: { kind: "commit", message: "feat: a" },
		});
		const writes: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(((chunk: string) => {
				writes.push(String(chunk));
				return true;
			}) as typeof process.stdout.write);

		const code = await main(["--job", jobPath]);
		spy.mockRestore();
		expect(code).toBe(0);
		expect(writes).toHaveLength(1);
		expect(writes[0].endsWith("\n")).toBe(true);
		expect(JSON.parse(writes[0])).toMatchObject({
			kind: "result",
			output: { message: "feat: a" },
		});
	});

	it("rejects oversized jobs before JSON.parse and exits nonzero", async () => {
		const file = path.join(os.tmpdir(), `ditto-git-metadata-huge-${Date.now()}.json`);
		fs.writeFileSync(file, "x".repeat(128 * 1024 + 1));
		tempFiles.push(file);
		const writes: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(((chunk: string) => {
				writes.push(String(chunk));
				return true;
			}) as typeof process.stdout.write);
		const code = await main(["--job", file]);
		spy.mockRestore();
		expect(code).toBe(2);
		expect(JSON.parse(writes[0])).toMatchObject({
			kind: "error",
			code: "invalid_job",
		});
		expect(mocks.runGitMetadata).not.toHaveBeenCalled();
	});

	it("maps agent errors to nonzero exit without raw stderr", async () => {
		const jobPath = writeJob({
			v: 1,
			requestId: "req-1",
			kind: "commit",
			model: GIT_METADATA_MODEL,
			snapshot: {
				kind: "commit_snapshot",
				branch: "main",
				headSha: "abc1234",
				changedPaths: [{ status: "M", path: "a.ts" }],
				diffStat: "ok",
				patch: "diff",
				patchTruncated: false,
				patchOriginalBytes: 4,
			},
		});
		mocks.runGitMetadata.mockResolvedValue({
			v: 1,
			kind: "error",
			requestId: "req-1",
			code: "missing_result",
			message: "no output",
		});
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stdout.write);
		const code = await main(["--job", jobPath]);
		expect(code).toBe(1);
		expect(JSON.parse(writes[0]).code).toBe("missing_result");
	});
});
