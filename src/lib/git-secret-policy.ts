import { quoteGitHubExportShellArg } from "#/lib/github-export";
import { redactSecrets } from "#/lib/secret-redaction";

const GIT_COMMAND_TIMEOUT_MS = 120_000;

/** Reason categories for blocked git export (safe to return to clients). */
export type GitSecretPolicyReason =
	| "secret_path"
	| "secret_content"
	| "range_unresolved"
	| "binary_or_unreadable"
	| "git_failed"
	| "parse_failed";

export class GitSecretPolicyError extends Error {
	readonly reason: GitSecretPolicyReason;
	readonly blockedPath?: string;

	constructor(
		reason: GitSecretPolicyReason,
		message: string,
		blockedPath?: string,
	) {
		super(message);
		this.name = "GitSecretPolicyError";
		this.reason = reason;
		this.blockedPath = blockedPath;
	}
}

/** True for `.env` / `.env.*` basenames (incl. nested paths). */
export function isSecretLikeGitPath(filePath: string): boolean {
	const candidate = filePath.trim();
	const base = candidate.split("/").pop() ?? candidate;
	return base === ".env" || base.startsWith(".env.");
}

type SandboxExec = {
	exec: (
		command: string,
		options?: { cwd?: string; timeout?: number },
	) => Promise<{
		success: boolean;
		stdout: string;
		stderr: string;
		exitCode: number;
	}>;
};

export type AssertOutgoingGitRangeSafeOptions = {
	sandbox: SandboxExec;
	cwd: string;
	branchName: string;
	knownSecrets?: readonly string[];
};

export type OutgoingGitRangeSafeResult = {
	changedPathCount: number;
	baseRev: string;
	headRev: string;
};

async function execGit(
	sandbox: SandboxExec,
	cwd: string,
	command: string,
): Promise<{
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
}> {
	return await sandbox.exec(command, {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
}

/**
 * Resolve the local base of the commit range that push is about to export.
 * Mirrors ahead-counting in session-git (upstream → origin/branch → remotes).
 * Fails closed when the range cannot be determined.
 */
async function resolveOutgoingBase(
	sandbox: SandboxExec,
	cwd: string,
	branchName: string,
): Promise<string> {
	const upstream = await execGit(
		sandbox,
		cwd,
		"git rev-parse --verify @{upstream}",
	);
	if (upstream.success && upstream.stdout.trim()) {
		return upstream.stdout.trim();
	}

	const quotedOriginBranch = quoteGitHubExportShellArg(`origin/${branchName}`);
	const originBranch = await execGit(
		sandbox,
		cwd,
		`git rev-parse --verify ${quotedOriginBranch}`,
	);
	if (originBranch.success && originBranch.stdout.trim()) {
		return originBranch.stdout.trim();
	}

	const originHead = await execGit(
		sandbox,
		cwd,
		"git rev-parse --verify origin/HEAD",
	);
	if (originHead.success && originHead.stdout.trim()) {
		const mergeBase = await execGit(
			sandbox,
			cwd,
			"git merge-base HEAD origin/HEAD",
		);
		if (mergeBase.success && mergeBase.stdout.trim()) {
			return mergeBase.stdout.trim();
		}
	}

	const anyRemote = await execGit(
		sandbox,
		cwd,
		"git rev-list -n 1 --remotes=origin",
	);
	if (anyRemote.success && anyRemote.stdout.trim()) {
		const remoteTip = anyRemote.stdout.trim();
		const quotedTip = quoteGitHubExportShellArg(remoteTip);
		const mergeBase = await execGit(
			sandbox,
			cwd,
			`git merge-base HEAD ${quotedTip}`,
		);
		if (mergeBase.success && mergeBase.stdout.trim()) {
			return mergeBase.stdout.trim();
		}
	}

	// No origin history: treat the empty tree as base so the full local history
	// is inspected (brand-new repo / first push with no remote refs).
	const emptyTree = await execGit(
		sandbox,
		cwd,
		"git hash-object -t tree /dev/null",
	);
	if (emptyTree.success && emptyTree.stdout.trim()) {
		const head = await execGit(sandbox, cwd, "git rev-parse --verify HEAD");
		if (head.success && head.stdout.trim()) {
			return emptyTree.stdout.trim();
		}
	}

	throw new GitSecretPolicyError(
		"range_unresolved",
		"Export blocked: could not resolve outgoing commit range.",
	);
}

/** Parse `git diff --name-status -z` records into path lists (all real paths). */
export function parseNameStatusZ(stdout: string): {
	status: string;
	paths: string[];
}[] {
	const parts = stdout.split("\0");
	const entries: { status: string; paths: string[] }[] = [];
	let i = 0;
	while (i < parts.length) {
		const status = parts[i];
		if (status === undefined || status === "") {
			i += 1;
			continue;
		}
		// Status is like "A", "M", "D", "R100", "C100", "T", "U", ...
		const code = status[0];
		if (!code || !/^[A-Z]$/.test(code)) {
			throw new GitSecretPolicyError(
				"parse_failed",
				"Export blocked: failed to parse outgoing path list.",
			);
		}
		if (code === "R" || code === "C") {
			const a = parts[i + 1];
			const b = parts[i + 2];
			if (!a || !b) {
				throw new GitSecretPolicyError(
					"parse_failed",
					"Export blocked: failed to parse rename/copy in outgoing range.",
				);
			}
			entries.push({ status, paths: [a, b] });
			i += 3;
			continue;
		}
		const path = parts[i + 1];
		if (!path) {
			throw new GitSecretPolicyError(
				"parse_failed",
				"Export blocked: failed to parse outgoing path list.",
			);
		}
		entries.push({ status, paths: [path] });
		i += 2;
	}
	return entries;
}

/**
 * Extract added-line text from unified diff (-U0). Skips file headers (`+++`).
 * Returns null when binary/unreadable markers are present (fail closed).
 */
export function extractAddedLinesFromUnifiedDiff(diff: string): {
	addedText: string;
	binaryPath?: string;
} {
	const added: string[] = [];
	let binaryPath: string | undefined;
	let currentPath: string | undefined;

	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			// diff --git a/path b/path
			const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			currentPath = match?.[2] ?? match?.[1];
			continue;
		}
		if (
			line.startsWith("Binary files ") ||
			line.includes(" GIT binary patch")
		) {
			binaryPath = currentPath;
			break;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			added.push(line.slice(1));
		}
	}

	return { addedText: added.join("\n"), binaryPath };
}

/**
 * Inspect the exact local commit range about to be pushed. Rejects secret-like
 * paths and recognized secret content in **added** lines only. Never returns
 * matched secret values — only safe metadata / reason codes via thrown errors.
 */
export async function assertOutgoingGitRangeSafe(
	options: AssertOutgoingGitRangeSafeOptions,
): Promise<OutgoingGitRangeSafeResult> {
	const knownSecrets = options.knownSecrets ?? [];
	const { sandbox, cwd, branchName } = options;

	const headResult = await execGit(sandbox, cwd, "git rev-parse --verify HEAD");
	if (!headResult.success || !headResult.stdout.trim()) {
		throw new GitSecretPolicyError(
			"range_unresolved",
			"Export blocked: could not resolve HEAD for outgoing range.",
		);
	}
	const headRev = headResult.stdout.trim();

	let baseRev: string;
	try {
		baseRev = await resolveOutgoingBase(sandbox, cwd, branchName);
	} catch (error) {
		if (error instanceof GitSecretPolicyError) {
			throw error;
		}
		throw new GitSecretPolicyError(
			"git_failed",
			"Export blocked: failed to inspect outgoing commits.",
		);
	}

	// Nothing to export when base == head (should be rare; push callers check ahead).
	if (baseRev === headRev) {
		return { changedPathCount: 0, baseRev, headRev };
	}

	const quotedBase = quoteGitHubExportShellArg(baseRev);
	const quotedHead = quoteGitHubExportShellArg(headRev);
	const revRange = `${quotedBase}..${quotedHead}`;

	const nameStatus = await execGit(
		sandbox,
		cwd,
		`git diff --name-status -z ${revRange}`,
	);
	if (!nameStatus.success) {
		throw new GitSecretPolicyError(
			"git_failed",
			"Export blocked: failed to list outgoing changed paths.",
		);
	}

	let pathEntries: { status: string; paths: string[] }[];
	try {
		pathEntries = nameStatus.stdout ? parseNameStatusZ(nameStatus.stdout) : [];
	} catch (error) {
		if (error instanceof GitSecretPolicyError) {
			throw error;
		}
		throw new GitSecretPolicyError(
			"parse_failed",
			"Export blocked: failed to parse outgoing path list.",
		);
	}

	const allPaths = new Set<string>();
	for (const entry of pathEntries) {
		for (const path of entry.paths) {
			allPaths.add(path);
			if (isSecretLikeGitPath(path)) {
				throw new GitSecretPolicyError(
					"secret_path",
					`Export blocked: secret-like path in outgoing commits (${path}).`,
					path,
				);
			}
		}
	}

	const diffResult = await execGit(
		sandbox,
		cwd,
		`git diff -U0 --no-color --find-renames ${revRange}`,
	);
	if (!diffResult.success) {
		throw new GitSecretPolicyError(
			"git_failed",
			"Export blocked: failed to inspect outgoing commit content.",
		);
	}

	const { addedText, binaryPath } = extractAddedLinesFromUnifiedDiff(
		diffResult.stdout,
	);
	if (binaryPath !== undefined) {
		throw new GitSecretPolicyError(
			"binary_or_unreadable",
			`Export blocked: binary or unreadable change in outgoing commits (${binaryPath}).`,
			binaryPath,
		);
	}
	// Binary marker without a parseable path still fails closed.
	if (
		diffResult.stdout.includes("Binary files ") ||
		diffResult.stdout.includes(" GIT binary patch")
	) {
		throw new GitSecretPolicyError(
			"binary_or_unreadable",
			"Export blocked: binary or unreadable change in outgoing commits.",
		);
	}

	if (addedText.length > 0) {
		const redacted = redactSecrets(addedText, knownSecrets);
		if (redacted !== addedText) {
			throw new GitSecretPolicyError(
				"secret_content",
				"Export blocked: recognized secret content in outgoing commits.",
			);
		}
	}

	return {
		changedPathCount: allPaths.size,
		baseRev,
		headRev,
	};
}
