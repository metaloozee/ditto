import { describe, expect, it } from "vitest";
import {
	artifactKey,
	buildSnapshotManifest,
	resolveSnapshotPointer,
	SNAPSHOT_SECRET_EXCLUDES,
	snapshotArchiveKey,
	snapshotManifestKey,
	validateSnapshotManifest,
} from "./r2-layout";

const projectId = "project-1";
const snapshotId = "snap-1";
const runId = "run-1";

describe("r2 key layout", () => {
	it("builds a snapshot manifest key under the project prefix", () => {
		expect(snapshotManifestKey(projectId, snapshotId)).toBe(
			"projects/project-1/snapshots/snap-1/manifest.json",
		);
	});

	it("builds a snapshot archive key under the project prefix", () => {
		expect(snapshotArchiveKey(projectId, snapshotId)).toBe(
			"projects/project-1/snapshots/snap-1/workspace.bin",
		);
	});

	it("builds an artifact key scoped by run and kind", () => {
		expect(artifactKey(projectId, runId, "diff", "diff-1")).toBe(
			"projects/project-1/runs/run-1/artifacts/diff/diff-1",
		);
	});

	it("rejects empty or slash-bearing IDs", () => {
		expect(() => snapshotManifestKey("", snapshotId)).toThrow("projectId");
		expect(() => snapshotManifestKey(projectId, "snap/1")).toThrow(
			"snapshotId",
		);
		expect(() => artifactKey(projectId, " ", "log", "log-1")).toThrow("runId");
		expect(() => artifactKey(projectId, runId, "log", "log/1")).toThrow(
			"artifactId",
		);
	});
});

describe("snapshot manifest", () => {
	it("builds a schema version 1 manifest with secret exclusions", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(manifest).toEqual({
			schemaVersion: 1,
			snapshotId,
			projectId,
			runId,
			r2Key: "projects/project-1/snapshots/snap-1/workspace.bin",
			archiveRef: null,
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
			excludedPaths: [...SNAPSHOT_SECRET_EXCLUDES],
		});
		expect(manifest.excludedPaths).toContain(".env");
		expect(manifest.excludedPaths).toContain(".env.*");
	});

	it("validates a well-formed manifest", () => {
		expect(
			validateSnapshotManifest(
				buildSnapshotManifest({
					snapshotId,
					projectId,
					runId,
					r2Key: snapshotArchiveKey(projectId, snapshotId),
					baseCommitSha: null,
					digest: "sha256:digest-1",
					createdAt: "2026-07-03T00:00:00.000Z",
				}),
			),
		).toBe(true);
	});

	it("rejects wrong schema version", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(validateSnapshotManifest({ ...manifest, schemaVersion: 2 })).toBe(
			false,
		);
	});

	it("rejects missing required fields", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(validateSnapshotManifest({ ...manifest, digest: "" })).toBe(false);
		expect(validateSnapshotManifest({ ...manifest, createdAt: " " })).toBe(
			false,
		);
		expect(validateSnapshotManifest({ ...manifest, runId: "" })).toBe(false);
	});

	it("rejects r2Key outside the snapshot prefix", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(
			validateSnapshotManifest({
				...manifest,
				r2Key: "projects/project-1/runs/run-1/artifacts/diff/diff-1",
			}),
		).toBe(false);
	});

	it("rejects missing .env exclusions", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(
			validateSnapshotManifest({
				...manifest,
				excludedPaths: manifest.excludedPaths.filter((path) => path !== ".env"),
			}),
		).toBe(false);
		expect(
			validateSnapshotManifest({
				...manifest,
				excludedPaths: manifest.excludedPaths.filter(
					(path) => path !== ".env.*",
				),
			}),
		).toBe(false);
	});

	it("accepts manual snapshot with runId: null", () => {
		expect(
			validateSnapshotManifest(
				buildSnapshotManifest({
					snapshotId,
					projectId,
					runId: null,
					r2Key: snapshotArchiveKey(projectId, snapshotId),
					baseCommitSha: "abc123",
					digest: "sha256:digest-1",
					createdAt: "2026-07-03T00:00:00.000Z",
				}),
			),
		).toBe(true);
	});

	it("accepts a valid archiveRef string", () => {
		expect(
			validateSnapshotManifest(
				buildSnapshotManifest({
					snapshotId,
					projectId,
					runId,
					r2Key: snapshotArchiveKey(projectId, snapshotId),
					archiveRef: "abc",
					baseCommitSha: null,
					digest: "sha256:digest-1",
					createdAt: "2026-07-03T00:00:00.000Z",
				}),
			),
		).toBe(true);
	});

	it("accepts archiveRef: null", () => {
		expect(
			validateSnapshotManifest(
				buildSnapshotManifest({
					snapshotId,
					projectId,
					runId,
					r2Key: snapshotArchiveKey(projectId, snapshotId),
					archiveRef: null,
					baseCommitSha: null,
					digest: "sha256:digest-1",
					createdAt: "2026-07-03T00:00:00.000Z",
				}),
			),
		).toBe(true);
	});

	it("rejects archiveRef: empty string", () => {
		expect(
			validateSnapshotManifest(
				buildSnapshotManifest({
					snapshotId,
					projectId,
					runId,
					r2Key: snapshotArchiveKey(projectId, snapshotId),
					archiveRef: "",
					baseCommitSha: null,
					digest: "sha256:digest-1",
					createdAt: "2026-07-03T00:00:00.000Z",
				}),
			),
		).toBe(false);
	});

	it("rejects archiveRef: array or object", () => {
		const base = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			archiveRef: "abc",
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(
			validateSnapshotManifest({
				...base,
				archiveRef: ["not", "a", "string"],
			}),
		).toBe(false);
		expect(
			validateSnapshotManifest({
				...base,
				archiveRef: { id: "nested" },
			}),
		).toBe(false);
	});

	it("builds a manifest with archiveRef when provided", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			archiveRef: "backup-id-123",
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(manifest.archiveRef).toBe("backup-id-123");
	});

	it("defaults archiveRef to null when not provided", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: "abc123",
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(manifest.archiveRef).toBeNull();
	});
});

describe("snapshot d1 pointer policy", () => {
	it("returns a D1 pointer only after successful R2 write", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(resolveSnapshotPointer({ ok: false }, manifest)).toEqual({
			updateD1: false,
		});
		expect(resolveSnapshotPointer({ ok: true }, manifest)).toEqual({
			updateD1: true,
			pointer: {
				r2Key: "projects/project-1/snapshots/snap-1/workspace.bin",
				digest: "sha256:digest-1",
			},
		});
	});

	it("refuses a pointer for invalid manifest", () => {
		const manifest = buildSnapshotManifest({
			snapshotId,
			projectId,
			runId,
			r2Key: snapshotArchiveKey(projectId, snapshotId),
			baseCommitSha: null,
			digest: "sha256:digest-1",
			createdAt: "2026-07-03T00:00:00.000Z",
		});

		expect(
			resolveSnapshotPointer({ ok: true }, { ...manifest, r2Key: "outside" }),
		).toEqual({ updateD1: false });
	});
});
