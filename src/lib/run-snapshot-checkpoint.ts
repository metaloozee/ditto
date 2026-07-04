import {
	buildSnapshotManifest,
	resolveSnapshotPointer,
	type SnapshotManifest,
	snapshotManifestKey,
} from "#/lib/r2-layout";
import { redactSecrets } from "#/lib/secret-redaction";

export type SnapshotCheckpointPlan = {
	snapshotId: string;
	manifestKey: string;
	manifest: SnapshotManifest;
	/** The key to use as the snapshots row `r2Key` — the manifest key. */
	r2Key: string;
	/** Digest for the snapshots row. */
	digest: string;
};

export type SnapshotCheckpointInput = {
	projectId: string;
	runId: string;
	baseCommitSha: string | null;
	digest: string;
	createdAt: string;
	snapshotId: string;
	archiveRef: string | null;
};

export type WorkspaceDigestInput = {
	baseCommitSha: string | null;
	gitStatusShort: string;
	gitDiffStat: string;
};

/**
 * Compute a deterministic SHA-256 digest of the workspace state for
 * snapshot fingerprinting. Inputs are redacted before hashing.
 */
export async function computeWorkspaceDigest(
	input: WorkspaceDigestInput,
): Promise<string> {
	const normalized = [
		input.baseCommitSha ?? "",
		redactSecrets(input.gitStatusShort).trim(),
		redactSecrets(input.gitDiffStat).trim(),
	].join("\n");

	const encoder = new TextEncoder();
	const hashBuffer = await crypto.subtle.digest(
		"SHA-256",
		encoder.encode(normalized),
	);

	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Build a pure snapshot checkpoint plan — no I/O, fully testable.
 * Returns the manifest key, manifest, and the values needed to
 * populate a D1 `snapshots` row.
 */
export function buildSnapshotCheckpointPlan(
	input: SnapshotCheckpointInput,
): SnapshotCheckpointPlan {
	const manifestKey = snapshotManifestKey(input.projectId, input.snapshotId);

	const manifest = buildSnapshotManifest({
		snapshotId: input.snapshotId,
		projectId: input.projectId,
		runId: input.runId,
		r2Key: manifestKey,
		archiveRef: input.archiveRef,
		baseCommitSha: input.baseCommitSha,
		digest: input.digest,
		createdAt: input.createdAt,
	});

	return {
		snapshotId: input.snapshotId,
		manifestKey,
		manifest,
		r2Key: manifestKey,
		digest: input.digest,
	};
}

/**
 * Gating helper: only returns a D1 pointer after a successful R2 write.
 * Thin wrapper around r2-layout's `resolveSnapshotPointer`.
 */
export function checkpointPointerAfterR2Write(
	r2WriteResult: { ok: boolean },
	plan: SnapshotCheckpointPlan,
): ReturnType<typeof resolveSnapshotPointer> {
	return resolveSnapshotPointer(r2WriteResult, plan.manifest);
}
