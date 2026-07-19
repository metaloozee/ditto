import { nanoid } from "nanoid";
import { z } from "zod";
import { operatorFallbackCredential } from "#/lib/account-provider-credentials";
import { isSecretLikeGitPath } from "#/lib/git-secret-policy";
import { quoteGitHubExportShellArg } from "#/lib/github-export";
import { getProjectSandbox } from "#/lib/sandbox-bootstrap";
import { redactSecrets, redactStructured } from "#/lib/secret-redaction";
import {
	assertNoStagedSecretPaths,
	collectSafeStageablePaths,
	parsePorcelainZ,
} from "#/lib/session-git";

const GIT_COMMAND_TIMEOUT_MS = 120_000;
const METADATA_TIMEOUT_MS = 120_000;
const METADATA_CLI = "/opt/ditto-runner/dist/git-metadata-cli.js";
const JOB_DIR = "/tmp/ditto-git-metadata-jobs";
const RAW_JOB_MAX_BYTES = 128 * 1024;
const PATCH_MAX_BYTES = 96 * 1024;
/** Slightly above final 96 KiB so known-secret redaction can run before the final cap. */
const PATCH_RAW_READ_BYTES = 100 * 1024;
const STAT_MAX_BYTES = 8 * 1024;
const PATHS_MAX = 200;
const PATH_MAX_CHARS = 1024;
const MODEL = "opencode/deepseek-v4-flash-free" as const;

const GIT_DIFF_FLAGS = "--no-ext-diff --no-textconv --no-color --binary";

export type SessionGitMetadataErrorCode =
	| "invalid_job"
	| "unknown_model"
	| "agent_failed"
	| "missing_result"
	| "snapshot_failed"
	| "output_rejected"
	| "no_changes";

export class SessionGitMetadataError extends Error {
	readonly code: SessionGitMetadataErrorCode;
	constructor(code: SessionGitMetadataErrorCode, message: string) {
		super(message);
		this.name = "SessionGitMetadataError";
		this.code = code;
	}
}

const nulFree = (value: string) => !value.includes("\0");
const utf8Max = (maxBytes: number) => (value: string) =>
	Buffer.byteLength(value, "utf8") <= maxBytes;

const changedPathSchema = z.union([
	z
		.object({
			status: z.string().regex(/^(?:\?\?|[AMDTTU!])$/),
			path: z.string().min(1).max(PATH_MAX_CHARS).refine(nulFree),
		})
		.strict(),
	z
		.object({
			status: z.string().regex(/^[RC][0-9]{3}$/),
			path: z.string().min(1).max(PATH_MAX_CHARS).refine(nulFree),
			previousPath: z.string().min(1).max(PATH_MAX_CHARS).refine(nulFree),
		})
		.strict(),
]);

const snapshotCommonSchema = {
	branch: z.string().min(1).max(256).refine(nulFree),
	headSha: z.string().regex(/^[0-9a-f]{7,64}$/i).refine(nulFree),
	changedPaths: z.array(changedPathSchema).max(PATHS_MAX),
	diffStat: z
		.string()
		.refine(nulFree)
		.refine(utf8Max(STAT_MAX_BYTES)),
	patch: z
		.string()
		.refine(nulFree)
		.refine(utf8Max(PATCH_MAX_BYTES)),
	patchTruncated: z.boolean(),
	patchOriginalBytes: z.number().int().nonnegative(),
};

const commitJobSchema = z
	.object({
		v: z.literal(1),
		requestId: z.string().min(1).max(128).refine(nulFree),
		kind: z.literal("commit"),
		model: z.literal(MODEL),
		snapshot: z
			.object({
				kind: z.literal("commit_snapshot"),
				...snapshotCommonSchema,
			})
			.strict(),
	})
	.strict();

const pullRequestJobSchema = z
	.object({
		v: z.literal(1),
		requestId: z.string().min(1).max(128).refine(nulFree),
		kind: z.literal("pull_request"),
		model: z.literal(MODEL),
		snapshot: z
			.object({
				kind: z.literal("pull_request_snapshot"),
				...snapshotCommonSchema,
				baseSha: z.string().regex(/^[0-9a-f]{7,64}$/i).refine(nulFree),
				commitSubjects: z
					.array(z.string().min(1).max(500).refine(nulFree))
					.max(20),
			})
			.strict(),
	})
	.strict();

const commitResultSchema = z
	.object({
		v: z.literal(1),
		kind: z.literal("result"),
		requestId: z.string().min(1).max(128).refine(nulFree),
		result: z
			.object({
				kind: z.literal("commit"),
				message: z.string().min(1).max(72).refine(nulFree),
			})
			.strict(),
	})
	.strict();

const pullRequestResultSchema = z
	.object({
		v: z.literal(1),
		kind: z.literal("result"),
		requestId: z.string().min(1).max(128).refine(nulFree),
		result: z
			.object({
				kind: z.literal("pull_request"),
				title: z.string().min(1).max(100).refine(nulFree),
				body: z.string().min(1).max(4000).refine(nulFree),
			})
			.strict(),
	})
	.strict();

const errorResultSchema = z
	.object({
		v: z.literal(1),
		kind: z.literal("error"),
		requestId: z.string().min(1).max(128).refine(nulFree).optional(),
		code: z.enum([
			"invalid_job",
			"unknown_model",
			"agent_failed",
			"missing_result",
		]),
	})
	.strict();

const metadataOutSchema = z.union([
	commitResultSchema,
	pullRequestResultSchema,
	errorResultSchema,
]);

export type CommitMetadataResult = z.infer<typeof commitResultSchema>;
export type PullRequestMetadataResult = z.infer<typeof pullRequestResultSchema>;

type SnapshotCommon = {
	branch: string;
	headSha: string;
	changedPaths: Array<
		| { status: string; path: string }
		| { status: string; path: string; previousPath: string }
	>;
	diffStat: string;
	patch: string;
	patchTruncated: boolean;
	patchOriginalBytes: number;
};

type MetadataContext = {
	env: Env;
	sandboxId: string;
	session: {
		id: string;
		branchName: string;
		baseCommitSha?: string | null;
		workspacePath: string;
	};
	knownSecrets?: readonly string[];
};

const PROTOCOL_ERROR_MESSAGES: Record<
	Exclude<
		SessionGitMetadataErrorCode,
		"snapshot_failed" | "output_rejected" | "no_changes"
	>,
	string
> = {
	invalid_job: "Metadata agent rejected the job.",
	unknown_model: "Metadata agent model is unavailable.",
	agent_failed: "Metadata agent failed.",
	missing_result: "Metadata agent did not return typed output.",
};

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function execOrThrow(
	sandbox: ReturnType<typeof getProjectSandbox>,
	command: string,
	options: { cwd: string; errorPrefix: string },
): Promise<Awaited<ReturnType<typeof sandbox.exec>>> {
	const result = await sandbox.exec(command, {
		cwd: options.cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
	if (!result.success) {
		// Never surface Git stderr/stdout to clients — static controlled text only.
		throw new SessionGitMetadataError("snapshot_failed", options.errorPrefix);
	}
	return result;
}

function parseNameStatusZ(stdout: string): SnapshotCommon["changedPaths"] {
	const parts = stdout.split("\0").filter((part) => part.length > 0);
	const paths: SnapshotCommon["changedPaths"] = [];
	let i = 0;
	while (i < parts.length) {
		const status = parts[i] ?? "";
		const path = parts[i + 1];
		if (!path) {
			throw new SessionGitMetadataError(
				"snapshot_failed",
				"Failed to parse changed paths.",
			);
		}
		if (/^[RC][0-9]{3}$/.test(status)) {
			const destination = parts[i + 2];
			if (!destination) {
				throw new SessionGitMetadataError(
					"snapshot_failed",
					"Failed to parse rename/copy changed paths.",
				);
			}
			// git name-status -z: status, source (old), destination (new)
			paths.push({
				status,
				path: destination,
				previousPath: path,
			});
			i += 3;
			continue;
		}
		paths.push({ status, path });
		i += 2;
	}
	return paths;
}

function filterSecretLikePaths(
	paths: SnapshotCommon["changedPaths"],
): SnapshotCommon["changedPaths"] {
	return paths
		.filter((entry) => {
			if ("previousPath" in entry) {
				return (
					!isSecretLikeGitPath(entry.path) &&
					!isSecretLikeGitPath(entry.previousPath)
				);
			}
			return !isSecretLikeGitPath(entry.path);
		})
		.slice(0, PATHS_MAX);
}

/** Pathspecs for git diff, including rename sources so content is not missed. */
function pathspecsForDiff(paths: SnapshotCommon["changedPaths"]): string[] {
	const out: string[] = [];
	for (const entry of paths) {
		if ("previousPath" in entry) {
			out.push(entry.previousPath, entry.path);
		} else {
			out.push(entry.path);
		}
	}
	return out;
}

function capUtf8(
	text: string,
	maxBytes: number,
): {
	text: string;
	truncated: boolean;
} {
	const buf = Buffer.from(text, "utf8");
	if (buf.byteLength <= maxBytes) {
		return { text, truncated: false };
	}
	// Walk back to a code-point boundary.
	let end = maxBytes;
	while (end > 0 && (buf[end] & 0xc0) === 0x80) {
		end -= 1;
	}
	return { text: buf.subarray(0, end).toString("utf8"), truncated: true };
}

/**
 * Redact every snapshot field (including commit subjects when present), then
 * apply final caps. patchTruncated reflects omitted patch source bytes or
 * post-redaction patch cap only — never stat-only truncation.
 */
function applyRedactionAndCaps<T extends SnapshotCommon>(
	snapshot: T,
	knownSecrets: readonly string[],
): T {
	const redacted = redactStructured(snapshot, knownSecrets) as T;
	const statCap = capUtf8(redacted.diffStat, STAT_MAX_BYTES);
	const patchCap = capUtf8(redacted.patch, PATCH_MAX_BYTES);
	return {
		...redacted,
		diffStat: statCap.text,
		patch: patchCap.text,
		patchTruncated: redacted.patchTruncated || patchCap.truncated,
	};
}

function assertJobWithinRawLimit(job: unknown): void {
	const bytes = Buffer.byteLength(JSON.stringify(job), "utf8");
	if (bytes > RAW_JOB_MAX_BYTES) {
		throw new SessionGitMetadataError(
			"snapshot_failed",
			"Git snapshot exceeds the metadata size limit.",
		);
	}
}

async function collectBoundedPatch(options: {
	sandbox: ReturnType<typeof getProjectSandbox>;
	cwd: string;
	diffCommand: string;
	patchPath: string;
}): Promise<{
	patch: string;
	patchOriginalBytes: number;
	patchTruncated: boolean;
}> {
	await execOrThrow(
		options.sandbox,
		`${options.diffCommand} > ${quoteShellArg(options.patchPath)}`,
		{ cwd: options.cwd, errorPrefix: "Failed to collect git patch." },
	);
	const sizeResult = await execOrThrow(
		options.sandbox,
		`wc -c < ${quoteShellArg(options.patchPath)}`,
		{ cwd: options.cwd, errorPrefix: "Failed to measure git patch." },
	);
	const patchOriginalBytes = Number.parseInt(sizeResult.stdout.trim(), 10);
	if (!Number.isFinite(patchOriginalBytes) || patchOriginalBytes < 0) {
		throw new SessionGitMetadataError(
			"snapshot_failed",
			"Failed to measure git patch size.",
		);
	}
	// Read slightly above the final 96 KiB cap so redaction can run first.
	const headResult = await execOrThrow(
		options.sandbox,
		`head -c ${PATCH_RAW_READ_BYTES} ${quoteShellArg(options.patchPath)}`,
		{ cwd: options.cwd, errorPrefix: "Failed to read git patch." },
	);
	return {
		patch: headResult.stdout,
		patchOriginalBytes,
		patchTruncated: patchOriginalBytes > PATCH_RAW_READ_BYTES,
	};
}

async function readBranchHead(
	sandbox: ReturnType<typeof getProjectSandbox>,
	cwd: string,
	branchName: string,
): Promise<{ branch: string; headSha: string }> {
	const head = await execOrThrow(sandbox, "git rev-parse HEAD", {
		cwd,
		errorPrefix: "Failed to resolve HEAD.",
	});
	return { branch: branchName, headSha: head.stdout.trim() };
}

/**
 * Build a commit snapshot from a temporary index. Never mutates the real index.
 * Returns null when there are no safe changes (caller should no-op without model).
 */
export async function collectCommitMetadataSnapshot(
	ctx: MetadataContext,
): Promise<
	| { kind: "commit"; requestId: string; job: z.infer<typeof commitJobSchema> }
	| { kind: "no_changes" }
> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;
	const requestId = nanoid();
	const tmpIndex = `/tmp/ditto-git-metadata-index-${requestId}`;
	const patchPath = `/tmp/ditto-git-metadata-patch-${requestId}`;
	const knownSecrets = ctx.knownSecrets ?? [];

	try {
		const statusResult = await execOrThrow(
			sandbox,
			"git status --porcelain=v1 -z -uall",
			{ cwd, errorPrefix: "Failed to read git status." },
		);
		const entries = parsePorcelainZ(statusResult.stdout);
		if (entries.length === 0) {
			return { kind: "no_changes" };
		}
		assertNoStagedSecretPaths(entries);
		const stageableFiles = collectSafeStageablePaths(entries);
		if (stageableFiles.length === 0) {
			return { kind: "no_changes" };
		}

		const { branch, headSha } = await readBranchHead(
			sandbox,
			cwd,
			ctx.session.branchName,
		);

		const indexEnv = `GIT_INDEX_FILE=${quoteShellArg(tmpIndex)}`;
		await execOrThrow(
			sandbox,
			`rm -f -- ${quoteShellArg(tmpIndex)} && ${indexEnv} git read-tree HEAD`,
			{ cwd, errorPrefix: "Failed to prepare temporary git index." },
		);
		const addArgs = stageableFiles.map(quoteGitHubExportShellArg).join(" ");
		await execOrThrow(sandbox, `${indexEnv} git add -- ${addArgs}`, {
			cwd,
			errorPrefix: "Failed to stage paths into temporary index.",
		});

		const nameStatus = await execOrThrow(
			sandbox,
			`${indexEnv} git diff --cached --name-status -z`,
			{ cwd, errorPrefix: "Failed to read temporary staged paths." },
		);
		const changedPaths = filterSecretLikePaths(
			parseNameStatusZ(nameStatus.stdout),
		);
		if (changedPaths.length === 0) {
			return { kind: "no_changes" };
		}

		// Stat/patch only the safe staged set already in the temp index.
		const statResult = await execOrThrow(
			sandbox,
			`${indexEnv} git diff --cached --stat ${GIT_DIFF_FLAGS}`,
			{ cwd, errorPrefix: "Failed to read temporary staged stat." },
		);
		const patch = await collectBoundedPatch({
			sandbox,
			cwd,
			diffCommand: `${indexEnv} git diff --cached ${GIT_DIFF_FLAGS}`,
			patchPath,
		});

		const snapshot = applyRedactionAndCaps(
			{
				branch,
				headSha,
				changedPaths,
				diffStat: statResult.stdout,
				patch: patch.patch,
				patchTruncated: patch.patchTruncated,
				patchOriginalBytes: patch.patchOriginalBytes,
			},
			knownSecrets,
		);

		const job = commitJobSchema.parse({
			v: 1,
			requestId,
			kind: "commit",
			model: MODEL,
			snapshot: { kind: "commit_snapshot", ...snapshot },
		});
		assertJobWithinRawLimit(job);
		return { kind: "commit", requestId, job };
	} catch (error) {
		if (error instanceof SessionGitMetadataError) {
			throw error;
		}
		if (error instanceof z.ZodError) {
			throw new SessionGitMetadataError(
				"snapshot_failed",
				"Commit snapshot failed validation after redaction.",
			);
		}
		// Controlled policy text from assertNoStagedSecretPaths — preserve, no stderr.
		if (
			error instanceof Error &&
			error.message.includes("secret-like path is already staged")
		) {
			throw new SessionGitMetadataError(
				"snapshot_failed",
				error.message.slice(0, 200),
			);
		}
		throw new SessionGitMetadataError(
			"snapshot_failed",
			"Failed to collect commit snapshot.",
		);
	} finally {
		await sandbox.exec(
			`rm -f -- ${quoteShellArg(tmpIndex)} ${quoteShellArg(patchPath)}`,
			{ cwd: "/tmp", timeout: 10_000 },
		);
	}
}

/**
 * Build a PR snapshot for exact stored base..HEAD / base...HEAD.
 * Fails closed when the worktree is dirty or base is missing/unresolvable.
 * Stat/patch are built only from non-secret-like changed paths.
 */
export async function collectPullRequestMetadataSnapshot(
	ctx: MetadataContext,
): Promise<{
	kind: "pull_request";
	requestId: string;
	job: z.infer<typeof pullRequestJobSchema>;
}> {
	const sandbox = getProjectSandbox(ctx.env, ctx.sandboxId);
	const cwd = ctx.session.workspacePath;
	const requestId = nanoid();
	const patchPath = `/tmp/ditto-git-metadata-patch-${requestId}`;
	const knownSecrets = ctx.knownSecrets ?? [];
	const baseSha = ctx.session.baseCommitSha?.trim();
	if (!baseSha || !/^[0-9a-f]{7,64}$/i.test(baseSha)) {
		throw new SessionGitMetadataError(
			"snapshot_failed",
			"Session base commit is missing; cannot draft pull request metadata.",
		);
	}

	try {
		const dirty = await execOrThrow(
			sandbox,
			"git status --porcelain=v1 -z -uall",
			{ cwd, errorPrefix: "Failed to read git status." },
		);
		if (dirty.stdout) {
			throw new SessionGitMetadataError(
				"snapshot_failed",
				"Commit local changes before drafting pull request metadata.",
			);
		}

		const quotedBase = quoteGitHubExportShellArg(baseSha);
		// Fail closed: require the stored base to resolve; no origin fallback.
		await execOrThrow(
			sandbox,
			`git rev-parse --verify ${quotedBase}^{commit}`,
			{
				cwd,
				errorPrefix: "Session base commit is not available in the worktree.",
			},
		);

		const { branch, headSha } = await readBranchHead(
			sandbox,
			cwd,
			ctx.session.branchName,
		);

		// Oldest first: reverse the newest-first log.
		const subjectsResult = await execOrThrow(
			sandbox,
			`git log --format=%s -n 20 ${quotedBase}..HEAD`,
			{ cwd, errorPrefix: "Failed to read commit subjects." },
		);
		const newestFirst = subjectsResult.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !/^merge /i.test(line));
		const commitSubjects = newestFirst.reverse().slice(0, 20);

		const nameStatus = await execOrThrow(
			sandbox,
			`git diff --name-status -z ${quotedBase}...HEAD`,
			{ cwd, errorPrefix: "Failed to read pull request changed paths." },
		);
		const changedPaths = filterSecretLikePaths(
			parseNameStatusZ(nameStatus.stdout),
		);
		if (changedPaths.length === 0) {
			throw new SessionGitMetadataError(
				"snapshot_failed",
				"No safe changes available for pull request metadata.",
			);
		}

		// Build stat/patch from explicit safe pathspecs only (rename sources included).
		const pathArgs = pathspecsForDiff(changedPaths)
			.map(quoteGitHubExportShellArg)
			.join(" ");
		const statResult = await execOrThrow(
			sandbox,
			`git diff --stat ${GIT_DIFF_FLAGS} ${quotedBase}...HEAD -- ${pathArgs}`,
			{ cwd, errorPrefix: "Failed to read pull request diff stat." },
		);
		const patch = await collectBoundedPatch({
			sandbox,
			cwd,
			diffCommand: `git diff ${GIT_DIFF_FLAGS} ${quotedBase}...HEAD -- ${pathArgs}`,
			patchPath,
		});

		// Redact ALL fields, including commitSubjects, before the job is written.
		const snapshot = applyRedactionAndCaps(
			{
				branch,
				headSha,
				changedPaths,
				diffStat: statResult.stdout,
				patch: patch.patch,
				patchTruncated: patch.patchTruncated,
				patchOriginalBytes: patch.patchOriginalBytes,
				baseSha,
				commitSubjects,
			},
			knownSecrets,
		);

		const job = pullRequestJobSchema.parse({
			v: 1,
			requestId,
			kind: "pull_request",
			model: MODEL,
			snapshot: {
				kind: "pull_request_snapshot",
				...snapshot,
			},
		});
		assertJobWithinRawLimit(job);
		return { kind: "pull_request", requestId, job };
	} catch (error) {
		if (error instanceof SessionGitMetadataError) {
			throw error;
		}
		if (error instanceof z.ZodError) {
			throw new SessionGitMetadataError(
				"snapshot_failed",
				"Pull request snapshot failed validation after redaction.",
			);
		}
		throw new SessionGitMetadataError(
			"snapshot_failed",
			"Failed to collect pull request snapshot.",
		);
	} finally {
		await sandbox.exec(`rm -f -- ${quoteShellArg(patchPath)}`, {
			cwd: "/tmp",
			timeout: 10_000,
		});
	}
}

function assertOutputSecretFree(
	value: unknown,
	secrets: readonly string[],
): void {
	const before = JSON.stringify(value);
	const after = JSON.stringify(redactStructured(value, secrets));
	if (before !== after) {
		throw new SessionGitMetadataError(
			"output_rejected",
			"Generated metadata contained a secret-like value.",
		);
	}
	// Pattern-only pass on the serialized form as well.
	if (redactSecrets(before, []) !== before) {
		throw new SessionGitMetadataError(
			"output_rejected",
			"Generated metadata contained a secret-like value.",
		);
	}
}

/**
 * Run the one-shot metadata CLI against a prepared job. Cleans job + shell.
 */
export async function generateGitMetadata<
	TJob extends
		| z.infer<typeof commitJobSchema>
		| z.infer<typeof pullRequestJobSchema>,
>(options: {
	env: Env;
	sandboxId: string;
	cwd: string;
	job: TJob;
	knownSecrets?: readonly string[];
}): Promise<
	TJob["kind"] extends "commit"
		? CommitMetadataResult
		: PullRequestMetadataResult
> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const requestId = options.job.requestId;
	const jobPath = `${JOB_DIR}/${requestId}.json`;
	const knownSecrets = options.knownSecrets ?? [];
	const credential = operatorFallbackCredential(options.env.OPENCODE_API_KEY);
	const credentialJson = JSON.stringify(credential);
	const secretValues = [
		credentialJson,
		credential.key,
		options.env.OPENCODE_API_KEY,
		...knownSecrets,
	].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);

	// Enforce complete-job ceiling before any write reaches the runner.
	assertJobWithinRawLimit(options.job);
	const jobJson = JSON.stringify(options.job);

	const shell = await sandbox.createSession({
		id: `git-metadata-${requestId}`.slice(0, 60),
		cwd: options.cwd,
		env: {
			DITTO_PI_CREDENTIAL: credentialJson,
		},
		commandTimeoutMs: METADATA_TIMEOUT_MS,
	});

	try {
		await shell.mkdir(JOB_DIR, { recursive: true });
		await shell.writeFile(jobPath, jobJson);
		const result = await shell.exec(
			`node ${METADATA_CLI} --job ${quoteShellArg(jobPath)}`,
			{ timeout: METADATA_TIMEOUT_MS },
		);

		const stdout = result.stdout.trim();
		const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
		if (lines.length !== 1) {
			throw new SessionGitMetadataError(
				"agent_failed",
				"Metadata agent returned an invalid response.",
			);
		}

		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(lines[0] ?? "");
		} catch {
			throw new SessionGitMetadataError(
				"agent_failed",
				"Metadata agent returned non-JSON output.",
			);
		}

		const parsed = metadataOutSchema.safeParse(parsedJson);
		if (!parsed.success) {
			throw new SessionGitMetadataError(
				"output_rejected",
				"Metadata agent output failed validation.",
			);
		}

		if (parsed.data.kind === "error") {
			const code = parsed.data.code;
			throw new SessionGitMetadataError(code, PROTOCOL_ERROR_MESSAGES[code]);
		}

		if (parsed.data.requestId !== requestId) {
			throw new SessionGitMetadataError(
				"output_rejected",
				"Metadata agent request id mismatch.",
			);
		}

		if (options.job.kind === "commit") {
			if (parsed.data.result.kind !== "commit") {
				throw new SessionGitMetadataError(
					"output_rejected",
					"Metadata agent returned the wrong output kind.",
				);
			}
		} else if (parsed.data.result.kind !== "pull_request") {
			throw new SessionGitMetadataError(
				"output_rejected",
				"Metadata agent returned the wrong output kind.",
			);
		}

		assertOutputSecretFree(parsed.data.result, secretValues);
		return parsed.data as TJob["kind"] extends "commit"
			? CommitMetadataResult
			: PullRequestMetadataResult;
	} catch (error) {
		if (error instanceof SessionGitMetadataError) {
			throw error;
		}
		throw new SessionGitMetadataError(
			"agent_failed",
			"Metadata agent failed.",
		);
	} finally {
		try {
			await shell.deleteFile(jobPath);
		} catch {
			// best-effort
		}
		try {
			await sandbox.exec(`rm -f -- ${quoteShellArg(jobPath)}`, {
				cwd: "/tmp",
				timeout: 10_000,
			});
		} catch {
			// best-effort
		}
		try {
			await sandbox.deleteSession(shell.id);
		} catch {
			// best-effort
		}
	}
}

export async function generateCommitMetadata(
	ctx: MetadataContext,
): Promise<
	| { kind: "no_changes" }
	| { kind: "commit"; message: string; requestId: string }
> {
	const snapshot = await collectCommitMetadataSnapshot(ctx);
	if (snapshot.kind === "no_changes") {
		return { kind: "no_changes" };
	}
	const result = await generateGitMetadata({
		env: ctx.env,
		sandboxId: ctx.sandboxId,
		cwd: ctx.session.workspacePath,
		job: snapshot.job,
		knownSecrets: ctx.knownSecrets,
	});
	return {
		kind: "commit",
		message: result.result.message,
		requestId: result.requestId,
	};
}

export async function generatePullRequestMetadata(
	ctx: MetadataContext,
): Promise<{ title: string; body: string; requestId: string }> {
	const snapshot = await collectPullRequestMetadataSnapshot(ctx);
	const result = await generateGitMetadata({
		env: ctx.env,
		sandboxId: ctx.sandboxId,
		cwd: ctx.session.workspacePath,
		job: snapshot.job,
		knownSecrets: ctx.knownSecrets,
	});
	return {
		title: result.result.title,
		body: result.result.body,
		requestId: result.requestId,
	};
}
