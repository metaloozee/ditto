/** Versioned job/result protocol for one-shot UI git-metadata drafting. */

export const GIT_METADATA_PROTOCOL_VERSION = 1 as const;
export const GIT_METADATA_MODEL = "opencode/deepseek-v4-flash-free" as const;

export const GIT_METADATA_RAW_JOB_MAX_BYTES = 128 * 1024;
export const GIT_METADATA_PATCH_MAX_BYTES = 96 * 1024;
export const GIT_METADATA_PATHS_MAX = 200;
export const GIT_METADATA_PATH_MAX_CHARS = 1024;
export const GIT_METADATA_STAT_MAX_BYTES = 8 * 1024;
export const GIT_METADATA_REQUEST_ID_MAX = 128;
export const GIT_METADATA_SHA_RE = /^[0-9a-f]{7,64}$/i;
export const GIT_METADATA_BRANCH_MAX = 256;
export const GIT_METADATA_STATUS_RE = /^(?:\?\?|[AMDTTU!]|[RC][0-9]{3})$/;
export const GIT_METADATA_RENAME_STATUS_RE = /^[RC][0-9]{3}$/;

export type GitMetadataChangedPath =
	| { status: string; path: string }
	| { status: string; path: string; previousPath: string };

export type GitMetadataSnapshotCommon = {
	branch: string;
	headSha: string;
	changedPaths: GitMetadataChangedPath[];
	diffStat: string;
	patch: string;
	patchTruncated: boolean;
	patchOriginalBytes: number;
};

export type GitMetadataCommitSnapshot = GitMetadataSnapshotCommon & {
	kind: "commit_snapshot";
};

export type GitMetadataPullRequestSnapshot = GitMetadataSnapshotCommon & {
	kind: "pull_request_snapshot";
	baseSha: string;
	/** Oldest first, max 20 subjects. */
	commitSubjects: string[];
};

export type GitMetadataCommitJob = {
	v: 1;
	requestId: string;
	kind: "commit";
	model: typeof GIT_METADATA_MODEL;
	snapshot: GitMetadataCommitSnapshot;
};

export type GitMetadataPullRequestJob = {
	v: 1;
	requestId: string;
	kind: "pull_request";
	model: typeof GIT_METADATA_MODEL;
	snapshot: GitMetadataPullRequestSnapshot;
};

export type GitMetadataJob = GitMetadataCommitJob | GitMetadataPullRequestJob;

export type GitMetadataCommitResult = {
	v: 1;
	kind: "result";
	requestId: string;
	output: { kind: "commit"; message: string };
};

export type GitMetadataPullRequestResult = {
	v: 1;
	kind: "result";
	requestId: string;
	output: { kind: "pull_request"; title: string; body: string };
};

export type GitMetadataErrorCode =
	| "invalid_job"
	| "unknown_model"
	| "agent_failed"
	| "missing_result";

export type GitMetadataErrorResult = {
	v: 1;
	kind: "error";
	requestId?: string;
	code: GitMetadataErrorCode;
	message: string;
};

export type GitMetadataOut =
	| GitMetadataCommitResult
	| GitMetadataPullRequestResult
	| GitMetadataErrorResult;

const JOB_KEYS = new Set(["v", "requestId", "kind", "model", "snapshot"]);
const COMMIT_SNAPSHOT_KEYS = new Set([
	"kind",
	"branch",
	"headSha",
	"changedPaths",
	"diffStat",
	"patch",
	"patchTruncated",
	"patchOriginalBytes",
]);
const PR_SNAPSHOT_KEYS = new Set([
	...COMMIT_SNAPSHOT_KEYS,
	"baseSha",
	"commitSubjects",
]);
const PATH_KEYS_SIMPLE = new Set(["status", "path"]);
const PATH_KEYS_RENAME = new Set(["status", "path", "previousPath"]);
const RESULT_KEYS = new Set(["v", "kind", "requestId", "output"]);
const COMMIT_OUTPUT_KEYS = new Set(["kind", "message"]);
const PR_OUTPUT_KEYS = new Set(["kind", "title", "body"]);
const ERROR_KEYS = new Set(["v", "kind", "requestId", "code", "message"]);
const ERROR_CODES = new Set<GitMetadataErrorCode>([
	"invalid_job",
	"unknown_model",
	"agent_failed",
	"missing_result",
]);

function hasNul(value: string): boolean {
	return value.includes("\0");
}

function utf8ByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
	obj: Record<string, unknown>,
	allowed: Set<string>,
): boolean {
	const keys = Object.keys(obj);
	if (keys.length !== allowed.size) return false;
	for (const key of keys) {
		if (!allowed.has(key)) return false;
	}
	return true;
}

function isNonEmptyString(value: unknown, maxChars: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxChars &&
		!hasNul(value)
	);
}

function isBoundedString(value: unknown, maxBytes: number): value is string {
	return (
		typeof value === "string" &&
		!hasNul(value) &&
		utf8ByteLength(value) <= maxBytes
	);
}

function parseChangedPath(
	value: unknown,
): GitMetadataChangedPath | { error: string } {
	if (!isPlainObject(value)) {
		return { error: "changedPaths entries must be objects" };
	}
	const status = value.status;
	if (typeof status !== "string" || !GIT_METADATA_STATUS_RE.test(status)) {
		return { error: "invalid changed path status" };
	}
	const isRename = GIT_METADATA_RENAME_STATUS_RE.test(status);
	if (isRename) {
		if (!exactKeys(value, PATH_KEYS_RENAME)) {
			return { error: "rename/copy paths require path and previousPath only" };
		}
		if (
			!isNonEmptyString(value.path, GIT_METADATA_PATH_MAX_CHARS) ||
			!isNonEmptyString(value.previousPath, GIT_METADATA_PATH_MAX_CHARS)
		) {
			return { error: "invalid rename/copy path fields" };
		}
		return {
			status,
			path: value.path,
			previousPath: value.previousPath,
		};
	}
	if (!exactKeys(value, PATH_KEYS_SIMPLE)) {
		return {
			error: "previousPath is only allowed on rename/copy statuses",
		};
	}
	if (!isNonEmptyString(value.path, GIT_METADATA_PATH_MAX_CHARS)) {
		return { error: "invalid changed path" };
	}
	return { status, path: value.path };
}

function parseSnapshotCommon(
	snapshot: Record<string, unknown>,
): GitMetadataSnapshotCommon | { error: string } {
	if (!isNonEmptyString(snapshot.branch, GIT_METADATA_BRANCH_MAX)) {
		return { error: "invalid branch" };
	}
	if (
		typeof snapshot.headSha !== "string" ||
		!GIT_METADATA_SHA_RE.test(snapshot.headSha) ||
		hasNul(snapshot.headSha)
	) {
		return { error: "invalid headSha" };
	}
	if (!Array.isArray(snapshot.changedPaths)) {
		return { error: "changedPaths must be an array" };
	}
	if (snapshot.changedPaths.length > GIT_METADATA_PATHS_MAX) {
		return { error: "too many changedPaths" };
	}
	const changedPaths: GitMetadataChangedPath[] = [];
	for (const entry of snapshot.changedPaths) {
		const parsed = parseChangedPath(entry);
		if ("error" in parsed) return parsed;
		changedPaths.push(parsed);
	}
	if (!isBoundedString(snapshot.diffStat, GIT_METADATA_STAT_MAX_BYTES)) {
		return { error: "invalid diffStat" };
	}
	if (!isBoundedString(snapshot.patch, GIT_METADATA_PATCH_MAX_BYTES)) {
		return { error: "invalid patch" };
	}
	if (typeof snapshot.patchTruncated !== "boolean") {
		return { error: "invalid patchTruncated" };
	}
	if (
		typeof snapshot.patchOriginalBytes !== "number" ||
		!Number.isInteger(snapshot.patchOriginalBytes) ||
		snapshot.patchOriginalBytes < 0 ||
		!Number.isSafeInteger(snapshot.patchOriginalBytes)
	) {
		return { error: "invalid patchOriginalBytes" };
	}
	return {
		branch: snapshot.branch,
		headSha: snapshot.headSha,
		changedPaths,
		diffStat: snapshot.diffStat,
		patch: snapshot.patch,
		patchTruncated: snapshot.patchTruncated,
		patchOriginalBytes: snapshot.patchOriginalBytes,
	};
}

export function parseGitMetadataJob(
	raw: unknown,
): GitMetadataJob | { error: string } {
	if (!isPlainObject(raw)) {
		return { error: "job must be an object" };
	}
	if (!exactKeys(raw, JOB_KEYS)) {
		return { error: "job has unknown or missing fields" };
	}
	if (raw.v !== 1) {
		return { error: "unsupported job version" };
	}
	if (!isNonEmptyString(raw.requestId, GIT_METADATA_REQUEST_ID_MAX)) {
		return { error: "invalid requestId" };
	}
	if (raw.model !== GIT_METADATA_MODEL) {
		return { error: "unknown_model" };
	}
	if (!isPlainObject(raw.snapshot)) {
		return { error: "snapshot must be an object" };
	}

	if (raw.kind === "commit") {
		if (!exactKeys(raw.snapshot, COMMIT_SNAPSHOT_KEYS)) {
			return { error: "commit snapshot has unknown or missing fields" };
		}
		if (raw.snapshot.kind !== "commit_snapshot") {
			return { error: "commit job requires commit_snapshot" };
		}
		const common = parseSnapshotCommon(raw.snapshot);
		if ("error" in common) return common;
		return {
			v: 1,
			requestId: raw.requestId,
			kind: "commit",
			model: GIT_METADATA_MODEL,
			snapshot: { kind: "commit_snapshot", ...common },
		};
	}

	if (raw.kind === "pull_request") {
		if (!exactKeys(raw.snapshot, PR_SNAPSHOT_KEYS)) {
			return { error: "pull_request snapshot has unknown or missing fields" };
		}
		if (raw.snapshot.kind !== "pull_request_snapshot") {
			return { error: "pull_request job requires pull_request_snapshot" };
		}
		const common = parseSnapshotCommon(raw.snapshot);
		if ("error" in common) return common;
		if (
			typeof raw.snapshot.baseSha !== "string" ||
			!GIT_METADATA_SHA_RE.test(raw.snapshot.baseSha) ||
			hasNul(raw.snapshot.baseSha)
		) {
			return { error: "invalid baseSha" };
		}
		if (!Array.isArray(raw.snapshot.commitSubjects)) {
			return { error: "commitSubjects must be an array" };
		}
		if (raw.snapshot.commitSubjects.length > 20) {
			return { error: "too many commitSubjects" };
		}
		const commitSubjects: string[] = [];
		for (const subject of raw.snapshot.commitSubjects) {
			if (!isNonEmptyString(subject, 500)) {
				return { error: "invalid commitSubjects entry" };
			}
			commitSubjects.push(subject);
		}
		return {
			v: 1,
			requestId: raw.requestId,
			kind: "pull_request",
			model: GIT_METADATA_MODEL,
			snapshot: {
				kind: "pull_request_snapshot",
				...common,
				baseSha: raw.snapshot.baseSha,
				commitSubjects,
			},
		};
	}

	return { error: "unknown job kind" };
}

/**
 * Parse raw job file bytes. Rejects oversized payloads before JSON.parse.
 */
export function parseGitMetadataJobBytes(
	bytes: Buffer | string,
): GitMetadataJob | { error: string; code: GitMetadataErrorCode } {
	const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
	if (buf.byteLength > GIT_METADATA_RAW_JOB_MAX_BYTES) {
		return { error: "job exceeds size limit", code: "invalid_job" };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(buf.toString("utf8"));
	} catch {
		return { error: "job is not valid JSON", code: "invalid_job" };
	}
	const job = parseGitMetadataJob(parsed);
	if ("error" in job) {
		const code = job.error === "unknown_model" ? "unknown_model" : "invalid_job";
		return { error: job.error, code };
	}
	return job;
}

export function parseGitMetadataOut(
	raw: unknown,
	expectedRequestId?: string,
): GitMetadataOut | { error: string } {
	if (!isPlainObject(raw)) {
		return { error: "output must be an object" };
	}
	if (raw.v !== 1) {
		return { error: "unsupported output version" };
	}
	if (raw.kind === "error") {
		// requestId is optional on early failures before a job id is known.
		const keys = Object.keys(raw);
		for (const key of keys) {
			if (!ERROR_KEYS.has(key)) return { error: "error has unknown fields" };
		}
		for (const required of ["v", "kind", "code", "message"] as const) {
			if (!(required in raw)) {
				return { error: "error missing required fields" };
			}
		}
		if (
			typeof raw.code !== "string" ||
			!ERROR_CODES.has(raw.code as GitMetadataErrorCode)
		) {
			return { error: "invalid error code" };
		}
		if (
			typeof raw.message !== "string" ||
			hasNul(raw.message) ||
			raw.message.length > 500
		) {
			return { error: "invalid error message" };
		}
		if (raw.requestId !== undefined) {
			if (!isNonEmptyString(raw.requestId, GIT_METADATA_REQUEST_ID_MAX)) {
				return { error: "invalid requestId" };
			}
			if (expectedRequestId && raw.requestId !== expectedRequestId) {
				return { error: "requestId mismatch" };
			}
		}
		const out: GitMetadataErrorResult = {
			v: 1,
			kind: "error",
			code: raw.code as GitMetadataErrorCode,
			message: raw.message,
		};
		if (typeof raw.requestId === "string") {
			out.requestId = raw.requestId;
		}
		return out;
	}

	if (raw.kind !== "result") {
		return { error: "unknown output kind" };
	}
	if (!exactKeys(raw, RESULT_KEYS)) {
		return { error: "result has unknown or missing fields" };
	}
	if (!isNonEmptyString(raw.requestId, GIT_METADATA_REQUEST_ID_MAX)) {
		return { error: "invalid requestId" };
	}
	if (expectedRequestId && raw.requestId !== expectedRequestId) {
		return { error: "requestId mismatch" };
	}
	if (!isPlainObject(raw.output)) {
		return { error: "output payload must be an object" };
	}

	if (raw.output.kind === "commit") {
		if (!exactKeys(raw.output, COMMIT_OUTPUT_KEYS)) {
			return { error: "commit output has unknown or missing fields" };
		}
		if (typeof raw.output.message !== "string" || hasNul(raw.output.message)) {
			return { error: "invalid commit message" };
		}
		return {
			v: 1,
			kind: "result",
			requestId: raw.requestId,
			output: { kind: "commit", message: raw.output.message },
		};
	}

	if (raw.output.kind === "pull_request") {
		if (!exactKeys(raw.output, PR_OUTPUT_KEYS)) {
			return { error: "pull_request output has unknown or missing fields" };
		}
		if (typeof raw.output.title !== "string" || hasNul(raw.output.title)) {
			return { error: "invalid pull_request title" };
		}
		if (typeof raw.output.body !== "string" || hasNul(raw.output.body)) {
			return { error: "invalid pull_request body" };
		}
		return {
			v: 1,
			kind: "result",
			requestId: raw.requestId,
			output: {
				kind: "pull_request",
				title: raw.output.title,
				body: raw.output.body,
			},
		};
	}

	return { error: "unknown result output kind" };
}

export function encodeGitMetadataOut(out: GitMetadataOut): string {
	return `${JSON.stringify(out)}\n`;
}

export function gitMetadataError(
	code: GitMetadataErrorCode,
	message: string,
	requestId?: string,
): GitMetadataErrorResult {
	// Never include raw model/diff text in errors.
	const safe = message.slice(0, 200).replaceAll("\0", "");
	return requestId
		? { v: 1, kind: "error", requestId, code, message: safe }
		: { v: 1, kind: "error", code, message: safe };
}
