import {
	ARCHIVE_COMPATIBILITY_KEY,
	ARCHIVE_FORMAT_VERSION,
	type ArchiveArtifactV1,
	parseArchiveArtifactV1,
} from "../../../../packages/runtime-contracts/src/artifacts.js";
import {
	type CandidateFetchScope,
	currentAuthority,
} from "./candidate-branch-fetch";

export type CandidateBaselineDenial =
	| "not_owned"
	| "continuation_unsupported"
	| "branch_missing"
	| "seed_unavailable"
	| "seed_unmeasured"
	| "seed_incompatible"
	| "source_failed";

export type CandidateBaselineSource =
	| { branch: string; seed: ArchiveArtifactV1 }
	| { denied: CandidateBaselineDenial };

type SeedRow = {
	sourceCommit: string;
	objectKey: string;
	formatVersion: number;
	compatibilityKey: string;
	byteCount: number;
	extractedBytes: number | null;
	digest: string;
};

/**
 * The owned branch and verified project seed a candidate session restores
 * before its first checkpoint pair. Never throws; a failure is a denial.
 */
export async function readCandidateBaselineSource(
	db: D1Database,
	scope: CandidateFetchScope,
): Promise<CandidateBaselineSource> {
	try {
		if (!(await currentAuthority(db, scope))) return { denied: "not_owned" };
		const continuation = await db
			.prepare(
				"SELECT 1 FROM candidate_continuations WHERE destinationSessionId=?",
			)
			.bind(scope.workspaceSessionId)
			.first();
		if (continuation) return { denied: "continuation_unsupported" };
		const session = await db
			.prepare(
				"SELECT branchName FROM workspace_sessions WHERE id=? AND projectId=? AND userId=?",
			)
			.bind(scope.workspaceSessionId, scope.projectId, scope.userId)
			.first<{ branchName: string | null }>();
		if (!session) return { denied: "not_owned" };
		if (!session.branchName) return { denied: "branch_missing" };
		const row = await db
			.prepare(
				`SELECT s.sourceCommit AS sourceCommit,a.objectKey AS objectKey,a.formatVersion AS formatVersion,
a.compatibilityKey AS compatibilityKey,a.byteCount AS byteCount,a.extractedBytes AS extractedBytes,a.digest AS digest
FROM project_seeds s JOIN archives a ON a.id=s.archiveId
WHERE s.projectId=? AND s.buildState='ready' AND s.archiveId IS NOT NULL AND s.sourceCommit IS NOT NULL
AND a.status='ready' AND a.ownerKind='project_seed' AND a.ownerId=?`,
			)
			.bind(scope.projectId, scope.projectId)
			.first<SeedRow>();
		if (!row) return { denied: "seed_unavailable" };
		if (row.extractedBytes === null) return { denied: "seed_unmeasured" };
		if (
			row.formatVersion !== ARCHIVE_FORMAT_VERSION ||
			row.compatibilityKey !== ARCHIVE_COMPATIBILITY_KEY
		)
			return { denied: "seed_incompatible" };
		let seed: ArchiveArtifactV1;
		try {
			seed = parseArchiveArtifactV1({
				version: 1,
				kind: "workspace_archive",
				formatVersion: row.formatVersion,
				compatibilityKey: row.compatibilityKey,
				objectKey: row.objectKey,
				byteCount: row.byteCount,
				extractedBytes: row.extractedBytes,
				digest: row.digest,
				sourceCommit: row.sourceCommit,
			});
		} catch {
			return { denied: "seed_incompatible" };
		}
		return { branch: session.branchName, seed };
	} catch {
		return { denied: "source_failed" };
	}
}
