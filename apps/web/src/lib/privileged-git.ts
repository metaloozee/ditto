import {
	quoteGitHubExportShellArg,
	redactGitHubExportOutput,
} from "#/lib/github-export";

/** Absolute binaries from the Cloudflare sandbox image (verified in image smoke). */
export const PRIVILEGED_GIT_BIN = "/usr/bin/git";
export const PRIVILEGED_NODE_BIN = "/usr/bin/node";

const TRUSTED_BIN_PREFIXES = ["/usr/bin/", "/usr/local/bin/"] as const;

const PRIVILEGED_GIT_TIMEOUT_MS = 120_000;
const TEMP_REF = "refs/ditto-isolated";
const LAUNCHER_NAME = "ditto-privileged-git-launcher.cjs";

export type PrivilegedGitSandbox = {
	exec: (
		command: string,
		options?: {
			cwd?: string;
			timeout?: number;
			env?: Record<string, string | undefined>;
		},
	) => Promise<{
		success: boolean;
		stdout: string;
		stderr: string;
		exitCode: number;
	}>;
};

export type ValidatedGitBranchRefs = {
	branchName: string;
	headRef: string;
	remoteTrackingRef: string;
	/** `+<headRef>:<tempRef>` for isolated fetch into the temp bare repo. */
	isolatedFetchRefspec: string;
	/** `<sha>:<headRef>` for isolated push. */
	pushRefspecFrom(sha: string): string;
	/** `<sha>:<remoteTrackingRef>` for local transfer into the destination. */
	destinationFetchRefspecFrom(sha: string): string;
};

export type MintInstallationToken = () => Promise<string>;

type SecretBag = { current: readonly string[] };

const LAUNCHER_SOURCE = `"use strict";
const { spawnSync } = require("node:child_process");
const gitBin = process.env.DITTO_PRIVILEGED_GIT_BIN;
const argsRaw = process.env.DITTO_PRIVILEGED_GIT_ARGS;
const envRaw = process.env.DITTO_PRIVILEGED_GIT_CHILD_ENV;
if (!gitBin || !argsRaw || !envRaw) {
  process.stderr.write("privileged-git launcher: missing inputs\\n");
  process.exit(2);
}
let args;
let env;
try {
  args = JSON.parse(argsRaw);
  env = JSON.parse(envRaw);
} catch {
  process.stderr.write("privileged-git launcher: invalid JSON inputs\\n");
  process.exit(2);
}
if (!Array.isArray(args) || typeof env !== "object" || env === null) {
  process.stderr.write("privileged-git launcher: invalid input shapes\\n");
  process.exit(2);
}
const cwd = process.env.DITTO_PRIVILEGED_GIT_CWD;
if (!cwd || !cwd.startsWith("/tmp/ditto-privileged-git-")) {
  process.stderr.write("privileged-git launcher: invalid cwd\n");
  process.exit(2);
}
const result = spawnSync(gitBin, args, {
  env,
  cwd,
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
});
if (result.error) {
  process.stderr.write(String(result.error.message || result.error));
  process.exit(1);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status === null ? 1 : result.status);
`;

function assertTrustedBinPath(path: string, label: string): void {
	if (!TRUSTED_BIN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
		throw new Error(`${label} path is outside trusted image directories.`);
	}
	if (path.includes("\0") || path.includes("..")) {
		throw new Error(`${label} path is invalid.`);
	}
}

function publicGitHubRepoUrl(githubRepo: string): string {
	return `https://github.com/${githubRepo}.git`;
}

function assertGithubRepoSlug(githubRepo: string): void {
	if (
		!githubRepo ||
		githubRepo.includes("\0") ||
		githubRepo.includes("\n") ||
		githubRepo.includes(" ") ||
		githubRepo.includes("..") ||
		githubRepo.startsWith("-")
	) {
		throw new Error("Invalid GitHub repository slug.");
	}
	const parts = githubRepo.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new Error("Invalid GitHub repository slug.");
	}
}

function encodeBasicAuthHeader(token: string): {
	rawUserPass: string;
	encoded: string;
	header: string;
} {
	const rawUserPass = `x-access-token:${token}`;
	const encoded = btoa(rawUserPass);
	return {
		rawUserPass,
		encoded,
		header: `Authorization: Basic ${encoded}`,
	};
}

/** Secrets that must never appear in errors, command strings, or logs. */
export function buildCredentialRedactionSecrets(
	token: string,
): readonly string[] {
	const { rawUserPass, encoded, header } = encodeBasicAuthHeader(token);
	return [token, rawUserPass, encoded, header];
}

/**
 * Exact Git child environment for the token-bearing network command.
 * Does not merge any inherited process environment.
 */
export function buildPrivilegedGitChildEnv(options: {
	token: string;
	homeDir: string;
	/** Inherited env snapshot used only to prove sentinels are dropped in tests. */
	inheritedEnv?: Record<string, string | undefined>;
}): Record<string, string> {
	// inheritedEnv is intentionally unread — callers must not spread it in.
	void options.inheritedEnv;

	const homeDir = options.homeDir;
	const { header } = encodeBasicAuthHeader(options.token);
	const hooksPath = `${homeDir}/hooks-disabled`;
	const emptyConfig = `${homeDir}/.gitconfig-empty`;

	return {
		PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		HOME: homeDir,
		XDG_CONFIG_HOME: `${homeDir}/.config`,
		LANG: "C",
		LC_ALL: "C",
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: emptyConfig,
		GIT_TRACE: "0",
		GIT_TRACE_SETUP: "0",
		GIT_CURL_VERBOSE: "0",
		GIT_CONFIG_COUNT: "7",
		GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
		GIT_CONFIG_VALUE_0: header,
		GIT_CONFIG_KEY_1: "protocol.allow",
		GIT_CONFIG_VALUE_1: "never",
		GIT_CONFIG_KEY_2: "protocol.https.allow",
		GIT_CONFIG_VALUE_2: "always",
		GIT_CONFIG_KEY_3: "core.hooksPath",
		GIT_CONFIG_VALUE_3: hooksPath,
		GIT_CONFIG_KEY_4: "credential.helper",
		GIT_CONFIG_VALUE_4: "",
		GIT_CONFIG_KEY_5: "http.followRedirects",
		GIT_CONFIG_VALUE_5: "false",
		GIT_CONFIG_KEY_6: "core.askPass",
		GIT_CONFIG_VALUE_6: "",
	};
}

function formatPrivilegedGitError(
	errorPrefix: string,
	output: string,
	secrets: readonly string[],
	exitCode?: number,
): string {
	const redacted = redactGitHubExportOutput(output, secrets);
	if (redacted) {
		return `${errorPrefix}: ${redacted}`;
	}
	return exitCode === undefined
		? errorPrefix
		: `${errorPrefix} (exit code ${exitCode})`;
}

function rejectInvalidBranchShape(branchName: string): void {
	if (!branchName) {
		throw new Error("Invalid branch ref: empty name.");
	}
	if (
		branchName.includes("\0") ||
		branchName.includes("\n") ||
		branchName.includes("\r")
	) {
		throw new Error("Invalid branch ref: control characters.");
	}
	if (branchName !== branchName.trim()) {
		throw new Error("Invalid branch ref: surrounding whitespace.");
	}
	if (branchName.startsWith("-")) {
		throw new Error("Invalid branch ref: option-like name.");
	}
	if (branchName.startsWith("refs/")) {
		throw new Error("Invalid branch ref: expected short branch name.");
	}
}

function buildValidatedRefs(branchName: string): ValidatedGitBranchRefs {
	const headRef = `refs/heads/${branchName}`;
	const remoteTrackingRef = `refs/remotes/origin/${branchName}`;
	return {
		branchName,
		headRef,
		remoteTrackingRef,
		isolatedFetchRefspec: `+${headRef}:${TEMP_REF}`,
		pushRefspecFrom(sha: string) {
			return `${sha}:${headRef}`;
		},
		destinationFetchRefspecFrom(sha: string) {
			return `${sha}:${remoteTrackingRef}`;
		},
	};
}

/**
 * Validate a short branch name, then return code-owned full refs/refspecs.
 * Every returned value must still be shell-quoted at use.
 */
export async function validateGitBranchRefs(
	sandbox: PrivilegedGitSandbox,
	branchName: string,
): Promise<ValidatedGitBranchRefs> {
	rejectInvalidBranchShape(branchName);
	const refs = buildValidatedRefs(branchName);
	const quotedHeadRef = quoteGitHubExportShellArg(refs.headRef);
	const result = await sandbox.exec(`git check-ref-format ${quotedHeadRef}`, {
		timeout: PRIVILEGED_GIT_TIMEOUT_MS,
	});
	if (!result.success) {
		throw new Error(`Invalid branch ref: ${branchName}`);
	}
	return refs;
}

async function execOrThrow(
	sandbox: PrivilegedGitSandbox,
	command: string,
	options: {
		cwd?: string;
		errorPrefix: string;
		secrets?: readonly string[];
		env?: Record<string, string | undefined>;
	},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const result = await sandbox.exec(command, {
		cwd: options.cwd,
		timeout: PRIVILEGED_GIT_TIMEOUT_MS,
		env: options.env,
	});
	if (result.success) {
		return result;
	}
	const output = [result.stderr.trim(), result.stdout.trim()]
		.filter(Boolean)
		.join("\n");
	throw new Error(
		formatPrivilegedGitError(
			options.errorPrefix,
			output,
			options.secrets ?? [],
			result.exitCode,
		),
	);
}

async function readStdoutOrThrow(
	sandbox: PrivilegedGitSandbox,
	command: string,
	options: {
		cwd?: string;
		errorPrefix: string;
		secrets?: readonly string[];
	},
): Promise<string> {
	const result = await execOrThrow(sandbox, command, options);
	return result.stdout.trim();
}

function newTempDir(): string {
	return `/tmp/ditto-privileged-git-${crypto.randomUUID()}`;
}

async function removeTempDir(
	sandbox: PrivilegedGitSandbox,
	tempDir: string,
	secrets: readonly string[],
): Promise<void> {
	const quoted = quoteGitHubExportShellArg(tempDir);
	await execOrThrow(sandbox, `rm -rf -- ${quoted}`, {
		errorPrefix: "Failed to remove privileged git temp directory",
		secrets,
	});
}

async function writeLauncher(
	sandbox: PrivilegedGitSandbox,
	tempDir: string,
): Promise<string> {
	const launcherPath = `${tempDir}/${LAUNCHER_NAME}`;
	const encoded = btoa(LAUNCHER_SOURCE);
	const quotedTemp = quoteGitHubExportShellArg(tempDir);
	const quotedLauncher = quoteGitHubExportShellArg(launcherPath);
	const quotedEncoded = quoteGitHubExportShellArg(encoded);
	const quotedHooks = quoteGitHubExportShellArg(
		`${tempDir}/home/hooks-disabled`,
	);
	const quotedConfigDir = quoteGitHubExportShellArg(`${tempDir}/home/.config`);
	const quotedEmptyConfig = quoteGitHubExportShellArg(
		`${tempDir}/home/.gitconfig-empty`,
	);
	await execOrThrow(
		sandbox,
		[
			`mkdir -m 0700 -p ${quotedTemp} ${quotedHooks} ${quotedConfigDir}`,
			`touch ${quotedEmptyConfig}`,
			`printf '%s' ${quotedEncoded} | base64 -d > ${quotedLauncher}`,
			`chmod 0700 ${quotedLauncher}`,
		].join(" && "),
		{ errorPrefix: "Failed to prepare privileged git launcher" },
	);
	return launcherPath;
}

async function initTempBareRepo(
	sandbox: PrivilegedGitSandbox,
	tempDir: string,
): Promise<void> {
	const quotedTemp = quoteGitHubExportShellArg(tempDir);
	const quotedHooks = quoteGitHubExportShellArg(
		`${tempDir}/home/hooks-disabled`,
	);
	await execOrThrow(
		sandbox,
		[
			`mkdir -m 0700 -p ${quotedTemp}`,
			`git init --bare --template= ${quotedTemp}`,
			`git --git-dir=${quotedTemp} config core.hooksPath ${quotedHooks}`,
			`git --git-dir=${quotedTemp} config credential.helper ''`,
			`git --git-dir=${quotedTemp} config core.askPass ''`,
		].join(" && "),
		{ errorPrefix: "Failed to initialize privileged git temp repository" },
	);

	const listed = await readStdoutOrThrow(
		sandbox,
		`git --git-dir=${quotedTemp} config --local --list`,
		{ errorPrefix: "Failed to inspect privileged git temp repository config" },
	);
	// Exact keys only — never prefix-allow core.* (blocks core.sshCommand, etc.).
	const allowedLocalConfig = new Set([
		"core.repositoryformatversion",
		"core.filemode",
		"core.bare",
		"core.logallrefupdates",
		"core.hookspath",
		"core.askpass",
		"credential.helper",
		"extensions.worktreeconfig",
	]);
	for (const line of listed.split("\n")) {
		const key = line.split("=")[0]?.trim().toLowerCase() ?? "";
		if (!key) {
			continue;
		}
		if (!allowedLocalConfig.has(key)) {
			throw new Error(
				"Privileged git temp repository has unexpected local configuration.",
			);
		}
	}
}

async function withTempBareRepo<T>(
	sandbox: PrivilegedGitSandbox,
	secrets: SecretBag,
	run: (tempDir: string, launcherPath: string) => Promise<T>,
): Promise<T> {
	const tempDir = newTempDir();
	let primaryError: unknown;
	let value: T | undefined;
	try {
		await writeLauncher(sandbox, tempDir);
		await initTempBareRepo(sandbox, tempDir);
		const launcherPath = `${tempDir}/${LAUNCHER_NAME}`;
		value = await run(tempDir, launcherPath);
	} catch (error) {
		primaryError = error;
	}

	let cleanupError: unknown;
	try {
		await removeTempDir(sandbox, tempDir, secrets.current);
	} catch (error) {
		cleanupError = error;
	}

	if (primaryError) {
		if (cleanupError) {
			const cleanupMessage =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			console.error(
				"privileged-git temp cleanup failed after primary error:",
				redactGitHubExportOutput(cleanupMessage, secrets.current),
			);
		}
		throw primaryError;
	}

	if (cleanupError) {
		const cleanupMessage =
			cleanupError instanceof Error
				? cleanupError.message
				: String(cleanupError);
		throw new Error(
			formatPrivilegedGitError(
				"Failed to clean up privileged git temp directory",
				cleanupMessage,
				secrets.current,
			),
		);
	}

	return value as T;
}

async function runIsolatedNetworkGit(
	sandbox: PrivilegedGitSandbox,
	options: {
		tempDir: string;
		launcherPath: string;
		token: string;
		gitArgs: string[];
		errorPrefix: string;
	},
): Promise<void> {
	assertTrustedBinPath(PRIVILEGED_GIT_BIN, "git");
	assertTrustedBinPath(PRIVILEGED_NODE_BIN, "node");

	const homeDir = `${options.tempDir}/home`;
	const secrets = buildCredentialRedactionSecrets(options.token);
	const childEnv = buildPrivilegedGitChildEnv({
		token: options.token,
		homeDir,
	});

	// Command string must never include the token or auth material.
	const command = [
		quoteGitHubExportShellArg(PRIVILEGED_NODE_BIN),
		quoteGitHubExportShellArg(options.launcherPath),
	].join(" ");

	const result = await sandbox.exec(command, {
		cwd: options.tempDir,
		timeout: PRIVILEGED_GIT_TIMEOUT_MS,
		env: {
			DITTO_PRIVILEGED_GIT_BIN: PRIVILEGED_GIT_BIN,
			DITTO_PRIVILEGED_GIT_ARGS: JSON.stringify(options.gitArgs),
			DITTO_PRIVILEGED_GIT_CHILD_ENV: JSON.stringify(childEnv),
			DITTO_PRIVILEGED_GIT_CWD: options.tempDir,
		},
	});

	if (!result.success) {
		const output = [result.stderr.trim(), result.stdout.trim()]
			.filter(Boolean)
			.join("\n");
		throw new Error(
			formatPrivilegedGitError(
				options.errorPrefix,
				output,
				secrets,
				result.exitCode,
			),
		);
	}
}

/**
 * Fetch one branch over HTTPS into a fresh temp bare repo, then copy the exact
 * SHA into the destination repository's remote-tracking ref without credentials.
 */
export async function fetchGitHubBranchIsolated(options: {
	sandbox: PrivilegedGitSandbox;
	githubRepo: string;
	branchName: string;
	destinationCwd: string;
	mintToken: MintInstallationToken;
}): Promise<{
	branchName: string;
	headSha: string;
	refs: ValidatedGitBranchRefs;
}> {
	assertGithubRepoSlug(options.githubRepo);
	const refs = await validateGitBranchRefs(options.sandbox, options.branchName);
	const publicUrl = publicGitHubRepoUrl(options.githubRepo);
	const secrets: SecretBag = { current: [] };

	const headSha = await withTempBareRepo(
		options.sandbox,
		secrets,
		async (tempDir, launcherPath) => {
			const token = await options.mintToken();
			secrets.current = buildCredentialRedactionSecrets(token);

			await runIsolatedNetworkGit(options.sandbox, {
				tempDir,
				launcherPath,
				token,
				gitArgs: ["fetch", "--no-tags", publicUrl, refs.isolatedFetchRefspec],
				errorPrefix: "Failed to fetch branch from GitHub",
			});

			const isolatedSha = await readStdoutOrThrow(
				options.sandbox,
				`git --git-dir=${quoteGitHubExportShellArg(tempDir)} rev-parse ${quoteGitHubExportShellArg(TEMP_REF)}`,
				{
					errorPrefix: "Failed to resolve fetched commit",
					secrets: secrets.current,
				},
			);
			if (!/^[0-9a-f]{40}$/i.test(isolatedSha)) {
				throw new Error("Fetched commit SHA is malformed.");
			}

			// Local transfer: no credential environment.
			const destRefspec = refs.destinationFetchRefspecFrom(isolatedSha);
			await execOrThrow(
				options.sandbox,
				[
					"git",
					"fetch",
					"--no-tags",
					quoteGitHubExportShellArg(tempDir),
					quoteGitHubExportShellArg(destRefspec),
				].join(" "),
				{
					cwd: options.destinationCwd,
					errorPrefix: "Failed to import fetched commit into workspace",
					secrets: secrets.current,
				},
			);

			const destSha = await readStdoutOrThrow(
				options.sandbox,
				`git rev-parse ${quoteGitHubExportShellArg(refs.remoteTrackingRef)}`,
				{
					cwd: options.destinationCwd,
					errorPrefix: "Failed to verify imported remote-tracking ref",
					secrets: secrets.current,
				},
			);
			if (destSha !== isolatedSha) {
				throw new Error(
					"Destination remote-tracking ref does not match the isolated fetch SHA.",
				);
			}

			return isolatedSha;
		},
	);

	return {
		branchName: refs.branchName,
		headSha,
		refs,
	};
}

/**
 * Push the exact preflight HEAD SHA to GitHub from a fresh temp bare repo.
 * Token mint runs only after local staging and SHA verification.
 */
export async function pushGitHubCommitIsolated(options: {
	sandbox: PrivilegedGitSandbox;
	githubRepo: string;
	branchName: string;
	sourceCwd: string;
	headRev: string;
	mintToken: MintInstallationToken;
}): Promise<void> {
	assertGithubRepoSlug(options.githubRepo);
	if (!/^[0-9a-f]{40}$/i.test(options.headRev)) {
		throw new Error("Invalid preflight head revision.");
	}

	const refs = await validateGitBranchRefs(options.sandbox, options.branchName);
	const publicUrl = publicGitHubRepoUrl(options.githubRepo);
	const secrets: SecretBag = { current: [] };

	await withTempBareRepo(
		options.sandbox,
		secrets,
		async (tempDir, launcherPath) => {
			const sourceHead = await readStdoutOrThrow(
				options.sandbox,
				"git rev-parse HEAD",
				{
					cwd: options.sourceCwd,
					errorPrefix: "Failed to resolve source HEAD before push",
				},
			);
			if (sourceHead !== options.headRev) {
				throw new Error(
					"Source HEAD changed after secret preflight; refusing to push.",
				);
			}

			// Import exact SHA into temp bare without credentials.
			const importRefspec = `${options.headRev}:${TEMP_REF}`;
			await execOrThrow(
				options.sandbox,
				[
					"git",
					"fetch",
					"--no-tags",
					quoteGitHubExportShellArg(options.sourceCwd),
					quoteGitHubExportShellArg(importRefspec),
				].join(" "),
				{
					cwd: tempDir,
					errorPrefix: "Failed to stage push commit into isolated repository",
				},
			);

			const stagedSha = await readStdoutOrThrow(
				options.sandbox,
				`git rev-parse ${quoteGitHubExportShellArg(TEMP_REF)}`,
				{
					cwd: tempDir,
					errorPrefix: "Failed to verify staged push commit",
				},
			);
			if (stagedSha !== options.headRev) {
				throw new Error(
					"Isolated push ref does not match the preflight head revision.",
				);
			}

			const token = await options.mintToken();
			secrets.current = buildCredentialRedactionSecrets(token);

			await runIsolatedNetworkGit(options.sandbox, {
				tempDir,
				launcherPath,
				token,
				gitArgs: [
					"push",
					"--no-verify",
					publicUrl,
					refs.pushRefspecFrom(options.headRev),
				],
				errorPrefix: "Failed to push branch",
			});
		},
	);
}
