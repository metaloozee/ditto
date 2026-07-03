export const MANIFEST_SCHEMA_VERSION = 1;

export const SNAPSHOT_SECRET_EXCLUDES = [
	".env",
	".env.*",
	".env.local",
	".env.production",
	".npmrc",
	".pypirc",
	".aws",
	".ssh",
	"id_rsa",
	"id_ed25519",
] as const;

export type SnapshotArtifactKind = "diff" | "log" | "attachment" | "generated";

export type SnapshotManifest = {
	schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
	snapshotId: string;
	projectId: string;
	runId: string | null;
	r2Key: string;
	baseCommitSha: string | null;
	digest: string;
	createdAt: string;
	excludedPaths: string[];
};

type SnapshotManifestInput = {
	snapshotId: string;
	projectId: string;
	runId: string | null;
	r2Key: string;
	baseCommitSha: string | null;
	digest: string;
	createdAt: string;
};

type R2WriteResult = {
	ok: boolean;
};

export type SnapshotPointerResult =
	| {
			updateD1: true;
			pointer: { r2Key: string; digest: string };
	  }
	| { updateD1: false };

function assertSafeSegment(value: string, name: string) {
	if (!value.trim() || value.includes("/")) {
		throw new Error(`${name} must be a non-empty path segment.`);
	}
}

export function snapshotManifestKey(projectId: string, snapshotId: string) {
	assertSafeSegment(projectId, "projectId");
	assertSafeSegment(snapshotId, "snapshotId");

	return `projects/${projectId}/snapshots/${snapshotId}/manifest.json`;
}

export function snapshotArchiveKey(projectId: string, snapshotId: string) {
	assertSafeSegment(projectId, "projectId");
	assertSafeSegment(snapshotId, "snapshotId");

	return `projects/${projectId}/snapshots/${snapshotId}/workspace.bin`;
}

export function artifactKey(
	projectId: string,
	runId: string,
	kind: SnapshotArtifactKind,
	artifactId: string,
) {
	assertSafeSegment(projectId, "projectId");
	assertSafeSegment(runId, "runId");
	assertSafeSegment(kind, "kind");
	assertSafeSegment(artifactId, "artifactId");

	return `projects/${projectId}/runs/${runId}/artifacts/${kind}/${artifactId}`;
}

export function buildSnapshotManifest(
	input: SnapshotManifestInput,
): SnapshotManifest {
	return {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		snapshotId: input.snapshotId,
		projectId: input.projectId,
		runId: input.runId,
		r2Key: input.r2Key,
		baseCommitSha: input.baseCommitSha,
		digest: input.digest,
		createdAt: input.createdAt,
		excludedPaths: [...SNAPSHOT_SECRET_EXCLUDES],
	};
}

function isNonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function validateSnapshotManifest(
	value: unknown,
): value is SnapshotManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const manifest = value as Partial<SnapshotManifest>;

	if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
		return false;
	}

	if (
		!isNonEmpty(manifest.snapshotId) ||
		!isNonEmpty(manifest.projectId) ||
		!isNonEmpty(manifest.r2Key) ||
		!isNonEmpty(manifest.digest) ||
		!isNonEmpty(manifest.createdAt)
	) {
		return false;
	}

	if (manifest.runId !== null && !isNonEmpty(manifest.runId)) {
		return false;
	}

	const snapshotPrefix = `projects/${manifest.projectId}/snapshots/${manifest.snapshotId}/`;
	if (!manifest.r2Key.startsWith(snapshotPrefix)) {
		return false;
	}

	if (
		!Array.isArray(manifest.excludedPaths) ||
		!manifest.excludedPaths.every((path) => typeof path === "string") ||
		!manifest.excludedPaths.includes(".env") ||
		!manifest.excludedPaths.includes(".env.*")
	) {
		return false;
	}

	return true;
}

export function resolveSnapshotPointer(
	r2WriteResult: R2WriteResult,
	manifest: SnapshotManifest,
): SnapshotPointerResult {
	if (!r2WriteResult.ok || !validateSnapshotManifest(manifest)) {
		return { updateD1: false };
	}

	return {
		updateD1: true,
		pointer: {
			r2Key: manifest.r2Key,
			digest: manifest.digest,
		},
	};
}
