import {
	ContractParseError,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

/** Source-only workspace archives. Both Workers enforce the same ceilings. */
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_COMPATIBILITY_KEY = "ditto-workspace-archive-v1";
export const ARCHIVE_MAX_COMPRESSED_BYTES = 1024 * 1024 * 1024;
export const ARCHIVE_MAX_EXTRACTED_BYTES = 3 * 1024 * 1024 * 1024;
export const ARCHIVE_MAX_DISK_PERCENT = 70;

export type ArchiveLimits = {
	maxCompressedBytes: number;
	maxExtractedBytes: number;
	maxDiskPercent: number;
};

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
	maxCompressedBytes: ARCHIVE_MAX_COMPRESSED_BYTES,
	maxExtractedBytes: ARCHIVE_MAX_EXTRACTED_BYTES,
	maxDiskPercent: ARCHIVE_MAX_DISK_PERCENT,
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;

/**
 * Verified archive evidence. The object key stays with the runtime; it is
 * never part of an execution operation.
 */
export type ArchiveArtifactV1 = {
	version: 1;
	kind: "workspace_archive";
	formatVersion: number;
	compatibilityKey: string;
	objectKey: string;
	byteCount: number;
	extractedBytes: number;
	digest: string;
	sourceCommit: string;
};

export function parseArchiveArtifactV1(input: unknown): ArchiveArtifactV1 {
	const row = strictRecord(
		input,
		[
			"version",
			"kind",
			"formatVersion",
			"compatibilityKey",
			"objectKey",
			"byteCount",
			"extractedBytes",
			"digest",
			"sourceCommit",
		],
		"Archive artifact",
	);
	literalField(row, "version", [1]);
	literalField(row, "kind", ["workspace_archive"]);
	const digest = stringField(row, "digest", { maxBytes: 64 });
	if (!SHA256_HEX.test(digest))
		throw new ContractParseError("invalid_field", "digest is invalid.");
	const sourceCommit = stringField(row, "sourceCommit", { maxBytes: 40 });
	if (!GIT_OID.test(sourceCommit))
		throw new ContractParseError("invalid_field", "sourceCommit is invalid.");
	return {
		version: 1,
		kind: "workspace_archive",
		formatVersion: integerField(row, "formatVersion", { minimum: 1 }),
		compatibilityKey: stringField(row, "compatibilityKey", { maxBytes: 128 }),
		objectKey: stringField(row, "objectKey", { maxBytes: 512 }),
		byteCount: integerField(row, "byteCount", { minimum: 0 }),
		extractedBytes: integerField(row, "extractedBytes", { minimum: 0 }),
		digest,
		sourceCommit,
	};
}

export function isGitObjectId(value: string): boolean {
	return GIT_OID.test(value);
}

export function isSha256Hex(value: string): boolean {
	return SHA256_HEX.test(value);
}

/** Stable reasons for a recovery step that did not produce verified evidence. */
export const ARTIFACT_FAILURE_REASONS = [
	"scope_denied",
	"authority_revoked",
	"authority_denied",
	"incompatible",
	"limit_exceeded",
	"artifact_missing",
	"integrity_failed",
	"verification_failed",
	"execution_failed",
	"store_failed",
	"outcome_unknown",
] as const;
export type ArtifactFailureReason = (typeof ARTIFACT_FAILURE_REASONS)[number];
