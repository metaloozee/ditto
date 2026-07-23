import { redactSecrets } from "#/lib/secret-redaction";

type BuildExportBranchNameInput = {
	runId: string;
	now: Date;
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

const CONVENTIONAL_COMMIT_RE =
	/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?:\s*(.+)$/i;

const PR_TITLE_MAX_LEN = 100;
const PR_CHANGED_FILES_LIST_MAX = 20;

const MERGE_COMMIT_SUBJECT_RE = /^merge /i;

/** Lower number = higher priority when picking the primary commit for PR title/summary. */
const CONVENTIONAL_COMMIT_TYPE_PRIORITY: Record<string, number> = {
	feat: 0,
	fix: 1,
	perf: 2,
	refactor: 3,
	docs: 4,
	test: 5,
	build: 6,
	ci: 7,
	style: 8,
	chore: 9,
	revert: 10,
};

const NON_CONVENTIONAL_COMMIT_TYPE_PRIORITY = 11;

function normalizeWhitespace(value: string): string {
	return value.replaceAll(/\s+/g, " ").trim();
}

function stripTrailingPeriod(value: string): string {
	return value.replace(/\.+$/, "").trim();
}

function capitalizeFirstLetter(value: string): string {
	if (!value) {
		return value;
	}
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function truncatePullRequestTitle(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length <= PR_TITLE_MAX_LEN) {
		return trimmed;
	}
	return `${trimmed.slice(0, PR_TITLE_MAX_LEN - 3).trimEnd()}...`;
}

function cleanSessionTitleForPullRequest(
	sessionTitle: string | null | undefined,
): string {
	if (!sessionTitle?.trim()) {
		return "";
	}
	return normalizeWhitespace(sessionTitle.replace(/\.{3,}$/, "").trim());
}

export function humanizeCommitSubjectForPullRequestTitle(
	subject: string,
): string {
	const collapsed = normalizeWhitespace(subject);
	const conventional = CONVENTIONAL_COMMIT_RE.exec(collapsed);
	if (!conventional) {
		return truncatePullRequestTitle(stripTrailingPeriod(collapsed));
	}

	const [, rawType, , rawDescription] = conventional;
	const type = rawType.toLowerCase();
	const description = stripTrailingPeriod(normalizeWhitespace(rawDescription));
	if (!description) {
		return truncatePullRequestTitle(collapsed);
	}

	if (type === "fix") {
		const rest =
			description.charAt(0) === description.charAt(0).toUpperCase()
				? `${description.charAt(0).toLowerCase()}${description.slice(1)}`
				: description;
		return truncatePullRequestTitle(`Fix ${rest}`);
	}

	return truncatePullRequestTitle(capitalizeFirstLetter(description));
}

function filterMeaningfulCommitSubjects(
	commitSubjects: readonly string[] | undefined,
): string[] {
	if (!commitSubjects?.length) {
		return [];
	}
	const meaningful: string[] = [];
	for (const subject of commitSubjects) {
		const trimmed = subject.trim();
		if (trimmed && !MERGE_COMMIT_SUBJECT_RE.test(trimmed)) {
			meaningful.push(trimmed);
		}
	}
	return meaningful;
}

/** Git log returns newest-first; reverse to oldest-first for listing and tie-breaking. */
export function orderCommitSubjectsOldestFirst(
	commitSubjects: readonly string[],
): string[] {
	return [...commitSubjects].reverse();
}

function conventionalCommitTypePriority(subject: string): number {
	const collapsed = normalizeWhitespace(subject);
	const conventional = CONVENTIONAL_COMMIT_RE.exec(collapsed);
	if (!conventional) {
		return NON_CONVENTIONAL_COMMIT_TYPE_PRIORITY;
	}
	const type = conventional[1].toLowerCase();
	return (
		CONVENTIONAL_COMMIT_TYPE_PRIORITY[type] ??
		NON_CONVENTIONAL_COMMIT_TYPE_PRIORITY
	);
}

/** Among equal type priority, the oldest commit in `orderedOldestFirst` wins. */
export function selectPrimaryCommitSubject(
	orderedOldestFirst: readonly string[],
): string | undefined {
	if (!orderedOldestFirst.length) {
		return undefined;
	}
	let primary = orderedOldestFirst[0];
	let bestPriority = conventionalCommitTypePriority(primary);
	for (const subject of orderedOldestFirst.slice(1)) {
		const priority = conventionalCommitTypePriority(subject);
		if (priority < bestPriority) {
			primary = subject;
			bestPriority = priority;
		}
	}
	return primary;
}

function meaningfulCommitSubjectsOldestFirst(
	commitSubjects: readonly string[] | undefined,
): string[] {
	return orderCommitSubjectsOldestFirst(
		filterMeaningfulCommitSubjects(commitSubjects),
	);
}

function multiCommitSummarySentence(humanizedPrimary: string): string {
	const trimmed = humanizedPrimary.trim();
	if (/^Fix\s+/i.test(trimmed)) {
		const rest = trimmed.replace(/^Fix\s+/i, "");
		return `This pull request fixes ${rest}.`;
	}
	if (/^Add\s+/i.test(trimmed)) {
		const rest = trimmed.replace(/^Add\s+/i, "");
		return `This pull request adds ${rest}.`;
	}
	return `This pull request covers: ${trimmed}.`;
}

function resolveChangedFileCount(options: {
	changedFileCount?: number;
	changedFiles?: readonly string[];
}): number {
	if (options.changedFiles !== undefined) {
		return options.changedFiles.length;
	}
	return options.changedFileCount ?? 0;
}

function buildPullRequestSummaryParagraph(options: {
	sessionTitle?: string | null;
	commitSubjects: readonly string[];
	changedFileCount?: number;
	changedFiles?: readonly string[];
	fallbackSingleCommitLead?: string;
}): string {
	const sentences: string[] = [];
	const chronological = meaningfulCommitSubjectsOldestFirst(
		options.commitSubjects,
	);

	if (chronological.length > 0) {
		const primarySubject =
			selectPrimaryCommitSubject(chronological) ?? chronological[0];
		const primary = humanizeCommitSubjectForPullRequestTitle(primarySubject);
		if (chronological.length === 1) {
			sentences.push(`${primary}.`);
		} else {
			sentences.push(multiCommitSummarySentence(primary));
		}
	} else {
		const cleanedTitle = cleanSessionTitleForPullRequest(options.sessionTitle);
		if (cleanedTitle) {
			sentences.push(
				`This pull request applies the work from the session "${cleanedTitle}".`,
			);
		} else if (options.fallbackSingleCommitLead) {
			sentences.push(options.fallbackSingleCommitLead);
		} else {
			sentences.push(
				"This pull request applies changes from the workspace session.",
			);
		}
	}

	// When paths are listed separately, skip the count sentence to avoid redundancy.
	if (!options.changedFiles?.length) {
		const changedFileCount = resolveChangedFileCount(options);
		if (changedFileCount > 0) {
			const fileWord = changedFileCount === 1 ? "file" : "files";
			sentences.push(`It includes ${changedFileCount} changed ${fileWord}.`);
		}
	}

	return sentences.join(" ");
}

function buildChangedFilesSection(
	changedFiles: readonly string[] | undefined,
): string[] {
	if (!changedFiles?.length) {
		return [];
	}
	const lines: string[] = ["", "Files changed:"];
	const listed = changedFiles.slice(0, PR_CHANGED_FILES_LIST_MAX);
	for (const path of listed) {
		lines.push(`- ${path}`);
	}
	const remaining = changedFiles.length - listed.length;
	if (remaining > 0) {
		lines.push(`- +${remaining} more`);
	}
	return lines;
}

// commitSubjects may be newest-first (git log default); we normalize to oldest-first
// and select the primary subject by conventional type priority.
export function buildPullRequestTitle({
	sessionTitle,
	commitSubjects,
}: {
	sessionTitle?: string | null;
	commitSubjects?: readonly string[];
}): string {
	const chronological = meaningfulCommitSubjectsOldestFirst(commitSubjects);
	if (chronological.length > 0) {
		const primary =
			selectPrimaryCommitSubject(chronological) ?? chronological[0];
		return humanizeCommitSubjectForPullRequestTitle(primary);
	}

	const cleaned = cleanSessionTitleForPullRequest(sessionTitle);
	if (cleaned) {
		return truncatePullRequestTitle(capitalizeFirstLetter(cleaned));
	}

	return "Workspace session changes";
}

export function buildPullRequestBody({
	sessionId,
	runId,
	changedFileCount,
	changedFiles,
	commitSubjects,
}: {
	sessionId: string;
	runId: string;
	changedFileCount?: number;
	changedFiles?: readonly string[];
	commitSubjects?: readonly string[];
}): string {
	const lines: string[] = [
		buildPullRequestSummaryParagraph({
			commitSubjects: commitSubjects ?? [],
			changedFileCount,
			changedFiles,
			fallbackSingleCommitLead:
				"This pull request applies changes from a sandbox run after you reviewed the diff.",
		}),
	];

	lines.push(...buildChangedFilesSection(changedFiles));

	const chronological = meaningfulCommitSubjectsOldestFirst(commitSubjects);
	if (chronological.length > 1) {
		lines.push("");
		lines.push("Included commits:");
		for (const subject of chronological.slice(0, 10)) {
			lines.push(`- ${subject}`);
		}
	}

	lines.push("");
	lines.push("---");
	lines.push(`Session ID: ${sessionId}`);
	lines.push(`Run ID: ${runId}`);

	return lines.join("\n");
}

// commitSubjects may be newest-first (git log default); we normalize to oldest-first
// and select the primary subject by conventional type priority.
export function buildSessionPullRequestBody({
	sessionId,
	sessionTitle,
	commitSubjects,
	changedFileCount,
	changedFiles,
}: {
	sessionId: string;
	sessionTitle?: string | null;
	commitSubjects?: readonly string[];
	changedFileCount?: number;
	changedFiles?: readonly string[];
}): string {
	const lines: string[] = [
		buildPullRequestSummaryParagraph({
			sessionTitle,
			commitSubjects: commitSubjects ?? [],
			changedFileCount,
			changedFiles,
		}),
	];

	lines.push(...buildChangedFilesSection(changedFiles));

	const chronological = meaningfulCommitSubjectsOldestFirst(commitSubjects);
	if (chronological.length > 1) {
		lines.push("");
		lines.push("Included commits:");
		for (const subject of chronological.slice(0, 10)) {
			lines.push(`- ${subject}`);
		}
	}

	lines.push("");
	lines.push("---");
	lines.push(`Session ID: ${sessionId}`);

	return lines.join("\n");
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
