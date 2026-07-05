import { artifactKey } from "#/lib/r2-layout";

export const RUN_DIFF_ARTIFACT_CONTENT_TYPE = "text/x-diff; charset=utf-8";
export const MAX_RUN_DIFF_ARTIFACT_BYTES = 2 * 1024 * 1024;

export type RunDiffArtifactPlan = {
	artifactId: string;
	r2Key: string;
	contentType: string;
	byteLength: number;
};

export type DiffReadyPayload = {
	artifactId: string | null;
	changedFiles: string[];
	byteLength: number;
	contentType: string;
	truncated: boolean;
	hasArtifact: boolean;
	error?: string;
};

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function unescapeGitPath(value: string): string {
	return value
		.replace(/\\\\/g, "\\")
		.replace(/\\"/g, '"')
		.replace(/\\t/g, "\t")
		.replace(/\\n/g, "\n");
}

function parseGitPathToken(token: string): string {
	const trimmed = token.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return unescapeGitPath(trimmed.slice(1, -1));
	}
	return trimmed;
}

/**
 * Build a pure plan for a run diff artifact: the R2 key, content type,
 * and UTF-8 byte length of the redacted patch. Performs no I/O.
 */
export function buildRunDiffArtifactPlan(input: {
	projectId: string;
	runId: string;
	artifactId: string;
	patch: string;
}): RunDiffArtifactPlan {
	return {
		artifactId: input.artifactId,
		r2Key: artifactKey(input.projectId, input.runId, "diff", input.artifactId),
		contentType: RUN_DIFF_ARTIFACT_CONTENT_TYPE,
		byteLength: utf8ByteLength(input.patch),
	};
}

/**
 * Parse relative file paths from `git status --short` (porcelain v1).
 * Rename lines (`R  old -> new`) yield the new path. Quoted paths are
 * unescaped. Empty input yields an empty array.
 */
export function parseChangedFilesFromGitStatus(statusShort: string): string[] {
	const files: string[] = [];
	for (const rawLine of statusShort.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (line === "") {
			continue;
		}
		// Porcelain v1: two status characters, a space, then the path.
		if (line.length < 3) {
			continue;
		}
		const pathPart = line.slice(3);
		const arrow = pathPart.indexOf(" -> ");
		if (arrow !== -1) {
			files.push(parseGitPathToken(pathPart.slice(arrow + 4)));
		} else {
			files.push(parseGitPathToken(pathPart));
		}
	}
	return files;
}

/**
 * Build a JSON-safe `diff_ready` event payload. Raw patch text is never
 * included — only metadata: artifact id, changed files, size, content type,
 * truncation flag, and whether an artifact was persisted.
 */
export function buildDiffReadyPayload(input: {
	artifactId?: string | null;
	changedFiles: string[];
	byteLength?: number;
	contentType?: string;
	truncated?: boolean;
	hasArtifact: boolean;
	error?: string;
}): DiffReadyPayload {
	const payload: DiffReadyPayload = {
		artifactId: input.artifactId ?? null,
		changedFiles: input.changedFiles,
		byteLength: input.byteLength ?? 0,
		contentType: input.contentType ?? RUN_DIFF_ARTIFACT_CONTENT_TYPE,
		truncated: input.truncated === true,
		hasArtifact: input.hasArtifact,
	};
	if (input.error) {
		payload.error = input.error;
	}
	return payload;
}
