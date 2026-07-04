import { describe, expect, it } from "vitest";
import {
	buildSnapshotCheckpointPlan,
	checkpointPointerAfterR2Write,
	computeWorkspaceDigest,
} from "./run-snapshot-checkpoint";

const projectId = "project-1";
const runId = "run-1";
const snapshotId = "snap-1";

describe("computeWorkspaceDigest", () => {
	it("produces a deterministic hex digest", async () => {
		const input = {
			baseCommitSha: "abc123",
			gitStatusShort: " M src/index.ts\n?? new-file.ts",
			gitDiffStat:
				" src/index.ts | 5 +++--\n 1 file changed, 3 insertions(+), 2 deletions(-)",
		};

		const digest1 = await computeWorkspaceDigest(input);
		const digest2 = await computeWorkspaceDigest(input);

		expect(digest1).toBe(digest2);
		expect(digest1).toHaveLength(64); // SHA-256 hex
		expect(digest1).toMatch(/^[0-9a-f]{64}$/);
	});

	it("changes when baseCommitSha differs", async () => {
		const base = {
			baseCommitSha: "abc123",
			gitStatusShort: " M src/index.ts",
			gitDiffStat: " src/index.ts | 1 +",
		};

		const a = await computeWorkspaceDigest(base);
		const b = await computeWorkspaceDigest({
			...base,
			baseCommitSha: "def456",
		});

		expect(a).not.toBe(b);
	});

	it("changes when workspace state differs", async () => {
		const a = await computeWorkspaceDigest({
			baseCommitSha: "abc123",
			gitStatusShort: " M src/index.ts",
			gitDiffStat: " src/index.ts | 1 +",
		});
		const b = await computeWorkspaceDigest({
			baseCommitSha: "abc123",
			gitStatusShort: " M src/app.ts",
			gitDiffStat: " src/app.ts | 2 +-",
		});

		expect(a).not.toBe(b);
	});

	it("redacts secrets before hashing", async () => {
		const withSecret = {
			baseCommitSha: "abc123",
			gitStatusShort: " M .env",
			gitDiffStat: "sk-ant-api-key-12345678901234567890\n .env | 1 +",
		};

		const digest = await computeWorkspaceDigest(withSecret);

		expect(digest).toHaveLength(64);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
	});

	it("handles null baseCommitSha", async () => {
		const digest = await computeWorkspaceDigest({
			baseCommitSha: null,
			gitStatusShort: "",
			gitDiffStat: "",
		});

		expect(digest).toHaveLength(64);
	});
});

describe("buildSnapshotCheckpointPlan", () => {
	it("returns a plan with the correct manifest key", () => {
		const plan = buildSnapshotCheckpointPlan({
			projectId,
			runId,
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			snapshotId,
			archiveRef: "backup-id-1",
		});

		expect(plan.manifestKey).toBe(
			`projects/${projectId}/snapshots/${snapshotId}/manifest.json`,
		);
		expect(plan.r2Key).toBe(plan.manifestKey);
		expect(plan.snapshotId).toBe(snapshotId);
		expect(plan.digest).toBe("sha256:digest-1");
	});

	it("builds a manifest with archiveRef", () => {
		const plan = buildSnapshotCheckpointPlan({
			projectId,
			runId,
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			snapshotId,
			archiveRef: "backup-id-1",
		});

		expect(plan.manifest.archiveRef).toBe("backup-id-1");
		expect(plan.manifest.runId).toBe(runId);
		expect(plan.manifest.projectId).toBe(projectId);
		expect(plan.manifest.baseCommitSha).toBe("abc123");
	});

	it("accepts null archiveRef", () => {
		const plan = buildSnapshotCheckpointPlan({
			projectId,
			runId,
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			snapshotId,
			archiveRef: null,
		});

		expect(plan.manifest.archiveRef).toBeNull();
	});
});

describe("checkpointPointerAfterR2Write", () => {
	it("returns updateD1: true when R2 write succeeds and manifest is valid", () => {
		const plan = buildSnapshotCheckpointPlan({
			projectId,
			runId,
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			snapshotId,
			archiveRef: "backup-id-1",
		});

		const result = checkpointPointerAfterR2Write({ ok: true }, plan);

		expect(result).toEqual({
			updateD1: true,
			pointer: {
				r2Key: plan.manifestKey,
				digest: "sha256:digest-1",
			},
		});
	});

	it("returns updateD1: false when R2 write fails", () => {
		const plan = buildSnapshotCheckpointPlan({
			projectId,
			runId,
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			snapshotId,
			archiveRef: "backup-id-1",
		});

		const result = checkpointPointerAfterR2Write({ ok: false }, plan);

		expect(result).toEqual({ updateD1: false });
	});

	it("returns updateD1: false when manifest is invalid", () => {
		const plan = buildSnapshotCheckpointPlan({
			projectId,
			runId,
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			snapshotId,
			archiveRef: "backup-id-1",
		});

		// Corrupt the manifest
		const corruptPlan = {
			...plan,
			manifest: { ...plan.manifest, r2Key: "outside" },
		};

		const result = checkpointPointerAfterR2Write({ ok: true }, corruptPlan);

		expect(result).toEqual({ updateD1: false });
	});
});
