import { redactSecrets } from "#/lib/secret-redaction";

type BuildExportBranchNameInput = {
	runId: string;
	now: Date;
};

type RunContextInput = {
	projectId: string;
	sessionId: string;
	runId: string;
};

function sanitizeBranchSegment(value: string): string {
	const sanitized = value.replaceAll(/[^A-Za-z0-9._/-]+/g, "-");
	return sanitized.replaceAll(/-+/g, "-").replaceAll(/^[-/]+|[-/]+$/g, "");
}

function formatTimestamp(now: Date): string {
	const year = now.getUTCFullYear().toString().padStart(4, "0");
	const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
	const day = now.getUTCDate().toString().padStart(2, "0");
	const hour = now.getUTCHours().toString().padStart(2, "0");
	const minute = now.getUTCMinutes().toString().padStart(2, "0");
	const second = now.getUTCSeconds().toString().padStart(2, "0");
	return `${year}${month}${day}${hour}${minute}${second}`;
}

export function buildExportBranchName({
	runId,
	now,
}: BuildExportBranchNameInput): string {
	const shortRunId = sanitizeBranchSegment(runId).slice(0, 12) || "unknown";
	return `ditto/run-${shortRunId}-${formatTimestamp(now)}`;
}

export function buildExportCommitMessage({
	sessionTitle,
	runId,
}: {
	sessionTitle?: string | null;
	runId: string;
}): string {
	const title = sessionTitle?.trim();
	if (!title) {
		return "feat: apply ditto run changes";
	}

	const summary = title.replaceAll(/\s+/g, " ").slice(0, 48).trim();
	return summary
		? `feat: apply ${summary}`
		: `feat: apply ditto run ${runId.slice(0, 8)} changes`;
}

export function buildPullRequestTitle({
	sessionTitle,
}: {
	sessionTitle?: string | null;
}): string {
	const title = sessionTitle?.trim();
	return title ? `Apply Ditto changes: ${title}` : "Apply Ditto run changes";
}

export function buildPullRequestBody({
	projectId,
	sessionId,
	runId,
	changedFileCount,
}: RunContextInput & {
	changedFileCount: number;
}): string {
	const fileWord = changedFileCount === 1 ? "file" : "files";
	return [
		"This PR applies changes from a Ditto sandbox run.",
		"",
		"It was explicitly created by the signed-in user after reviewing the run diff.",
		"",
		`- Project ID: ${projectId}`,
		`- Session ID: ${sessionId}`,
		`- Run ID: ${runId}`,
		`- Changed files in diff artifact: ${changedFileCount} ${fileWord}`,
	].join("\n");
}

export function countChangedFilesInDiffArtifact(patch: string): number {
	const files = new Set<string>();
	for (const line of patch.split("\n")) {
		if (!line.startsWith("diff --git ")) {
			continue;
		}
		const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
		if (match?.[2]) {
			files.add(match[2]);
		}
	}
	return files.size;
}

export function quoteGitHubExportShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function redactGitHubExportOutput(
	output: string,
	secrets: readonly string[] = [],
): string {
	return redactSecrets(output, secrets);
}
