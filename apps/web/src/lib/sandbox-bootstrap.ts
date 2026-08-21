import { getSandbox } from "@cloudflare/sandbox";
import { createDb } from "#/db";
import {
	DITTO_GIT_AUTHOR_EMAIL,
	DITTO_GIT_AUTHOR_NAME,
} from "#/lib/ditto-git-identity";
import {
	getInstallationAccessToken,
	repositoryNameFromSlug,
} from "#/lib/github-app";
import { fetchGitHubBranchIsolated } from "#/lib/privileged-git";
import {
	type ArchiveRef,
	type ArchiveSandbox,
	createArchive,
	restoreArchive,
} from "#/lib/sandbox-archive";
import { redactSecrets } from "#/lib/secret-redaction";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const CLONE_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 300_000;
const RUNNER_CLI_PATH = "/opt/ditto-runner/dist/cli.js";
const RUNNER_PACKAGE_PATH = "/opt/ditto-runner/package.json";

export type SandboxEnvVar = { key: string; value: string };

export function getProjectSandbox(env: Env, sandboxId: string) {
	return getSandbox(
		env.Sandbox as Parameters<typeof getSandbox>[0],
		sandboxId,
		{
			enableDefaultSession: false,
			transport: "rpc",
		},
	);
}

/** Read-only lifecycle observation; does not start or probe the filesystem. */
export async function getProjectSandboxState(env: Env, sandboxId: string) {
	const sandbox = getProjectSandbox(env, sandboxId);
	return await sandbox.getState();
}

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function destroySandbox(options: {
	env: Env;
	sandboxId: string;
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);

	await sandbox.destroy();
}

export async function configureDittoGitIdentity(
	sandbox: ReturnType<typeof getSandbox>,
	cwd: string,
): Promise<void> {
	const quotedName = quoteShellArg(DITTO_GIT_AUTHOR_NAME);
	const quotedEmail = quoteShellArg(DITTO_GIT_AUTHOR_EMAIL);
	await execOrThrow(
		sandbox,
		`git config user.name ${quotedName} && git config user.email ${quotedEmail}`,
		{
			cwd,
			timeout: CLONE_TIMEOUT_MS,
			errorPrefix: "Failed to configure Ditto git identity",
		},
	);
}

export async function scrubGithubRemote(
	sandbox: ReturnType<typeof getSandbox>,
	cwd: string,
	publicRepoUrl: string,
): Promise<void> {
	const originCheck = await sandbox.exec("git remote get-url origin", {
		cwd,
		timeout: CLONE_TIMEOUT_MS,
	});
	if (!originCheck.success) {
		return;
	}

	await execOrThrow(
		sandbox,
		`git remote set-url origin ${quoteShellArg(publicRepoUrl)}`,
		{
			cwd,
			timeout: CLONE_TIMEOUT_MS,
			errorPrefix: "Failed to scrub Git remote URL",
		},
	);
}

export async function execOrThrow(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
	options: {
		cwd?: string;
		timeout: number;
		errorPrefix: string;
		secrets?: readonly string[];
	},
): Promise<Awaited<ReturnType<typeof sandbox.exec>>> {
	const result = await sandbox.exec(command, {
		cwd: options.cwd,
		timeout: options.timeout,
	});

	if (result.success) {
		return result;
	}

	const output = redactSecrets(
		[result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
		options.secrets ?? [],
	);
	throw new Error(
		output
			? `${options.errorPrefix}: ${output}`
			: `${options.errorPrefix} (exit code ${result.exitCode})`,
	);
}

const PRIMARY_DEPS_INSTALL_RETRY_SIGNAL = `${WORKSPACE_PATH}/.ditto/primary-deps-install-retry`;

export type SyncPrimaryWorkspaceResult = {
	branchName: string;
	headSha: string;
	updated: boolean;
};

async function primaryDepsRetrySignalExists(
	sandbox: ReturnType<typeof getSandbox>,
): Promise<boolean> {
	const signal = await sandbox.exists(PRIMARY_DEPS_INSTALL_RETRY_SIGNAL);
	return signal.exists;
}

async function writePrimaryDepsRetrySignal(
	sandbox: ReturnType<typeof getSandbox>,
): Promise<void> {
	await execOrThrow(
		sandbox,
		[
			"set -euo pipefail",
			`mkdir -p ${quoteShellArg(`${WORKSPACE_PATH}/.ditto`)}`,
			`touch ${quoteShellArg(PRIMARY_DEPS_INSTALL_RETRY_SIGNAL)}`,
		].join("; "),
		{
			cwd: WORKSPACE_PATH,
			timeout: CLONE_TIMEOUT_MS,
			errorPrefix: "Failed to record primary dependency retry signal",
		},
	);
}

async function clearPrimaryDepsRetrySignal(
	sandbox: ReturnType<typeof getSandbox>,
): Promise<void> {
	await sandbox.exec(
		`rm -f ${quoteShellArg(PRIMARY_DEPS_INSTALL_RETRY_SIGNAL)}`,
		{
			cwd: WORKSPACE_PATH,
			timeout: CLONE_TIMEOUT_MS,
		},
	);
}

async function refreshPrimaryDependencies(
	sandbox: ReturnType<typeof getSandbox>,
): Promise<void> {
	try {
		await installDependencies(sandbox);
		await clearPrimaryDepsRetrySignal(sandbox);
	} catch (error) {
		await writePrimaryDepsRetrySignal(sandbox);
		throw error;
	}
}

export async function syncPrimaryWorkspaceFromGitHub(options: {
	env: Env;
	sandboxId: string;
	githubRepo: string;
	installationId: number;
}): Promise<SyncPrimaryWorkspaceResult> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const publicRepoUrl = `https://github.com/${options.githubRepo}.git`;

	const trackedStatus = await sandbox.exec(
		"git status --porcelain --untracked-files=no",
		{
			cwd: WORKSPACE_PATH,
			timeout: CLONE_TIMEOUT_MS,
		},
	);
	if (!trackedStatus.success) {
		throw new Error(
			"Failed to inspect primary workspace status before syncing from GitHub.",
		);
	}
	if (trackedStatus.stdout.trim()) {
		throw new Error(
			"Primary workspace has uncommitted changes to tracked files. Commit or discard them before starting a new session.",
		);
	}

	const branchResult = await sandbox.exec(
		"git symbolic-ref --quiet --short HEAD",
		{
			cwd: WORKSPACE_PATH,
			timeout: CLONE_TIMEOUT_MS,
		},
	);
	if (!branchResult.success) {
		throw new Error(
			"Primary workspace is on a detached HEAD. Check out a branch before starting a new session.",
		);
	}
	const branchName = branchResult.stdout.trim();
	if (!branchName) {
		throw new Error(
			"Primary workspace branch name is empty. Check out a branch before starting a new session.",
		);
	}

	const repoName = repositoryNameFromSlug(options.githubRepo);

	try {
		const fetched = await fetchGitHubBranchIsolated({
			sandbox,
			githubRepo: options.githubRepo,
			branchName,
			destinationCwd: WORKSPACE_PATH,
			mintToken: () =>
				getInstallationAccessToken(
					options.env,
					options.installationId,
					repoName ? { repositories: [repoName] } : undefined,
				),
		});
		const remoteRef = fetched.refs.remoteTrackingRef;
		const remoteSha = fetched.headSha;

		const headSha = (
			await execOrThrow(sandbox, "git rev-parse HEAD", {
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to resolve primary HEAD",
			})
		).stdout.trim();

		if (headSha === remoteSha) {
			if (await primaryDepsRetrySignalExists(sandbox)) {
				await refreshPrimaryDependencies(sandbox);
			}
			return { branchName: fetched.branchName, headSha, updated: false };
		}

		const remoteIsAncestor = await sandbox.exec(
			`git merge-base --is-ancestor ${quoteShellArg(remoteRef)} HEAD`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
			},
		);
		if (remoteIsAncestor.success) {
			throw new Error(
				"Primary workspace has unpublished local commits. Push them to GitHub or reset the sandbox base before starting a new session.",
			);
		}

		const headIsAncestor = await sandbox.exec(
			`git merge-base --is-ancestor HEAD ${quoteShellArg(remoteRef)}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
			},
		);
		if (!headIsAncestor.success) {
			throw new Error(
				"Primary workspace has diverged from GitHub. Resolve the divergence on the primary branch before starting a new session.",
			);
		}

		await execOrThrow(
			sandbox,
			`git merge --ff-only ${quoteShellArg(remoteRef)}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to fast-forward primary workspace",
			},
		);

		await refreshPrimaryDependencies(sandbox);

		const synchronizedHead = (
			await execOrThrow(sandbox, "git rev-parse HEAD", {
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to verify primary HEAD after fast-forward",
			})
		).stdout.trim();
		if (synchronizedHead !== remoteSha) {
			throw new Error(
				"Primary workspace fast-forward did not reach the fetched GitHub commit.",
			);
		}

		return {
			branchName: fetched.branchName,
			headSha: synchronizedHead,
			updated: true,
		};
	} finally {
		await scrubGithubRemote(sandbox, WORKSPACE_PATH, publicRepoUrl);
	}
}

export async function fetchPrimaryBranchFromGitHub(options: {
	env: Env;
	sandboxId: string;
	githubRepo: string;
	installationId: number;
	branchName: string;
}): Promise<{ branchName: string; headSha: string }> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const repoName = repositoryNameFromSlug(options.githubRepo);
	const publicRepoUrl = `https://github.com/${options.githubRepo}.git`;

	try {
		const fetched = await fetchGitHubBranchIsolated({
			sandbox,
			githubRepo: options.githubRepo,
			branchName: options.branchName,
			destinationCwd: WORKSPACE_PATH,
			mintToken: () =>
				getInstallationAccessToken(
					options.env,
					options.installationId,
					repoName ? { repositories: [repoName] } : undefined,
				),
		});
		return { branchName: fetched.branchName, headSha: fetched.headSha };
	} finally {
		await scrubGithubRemote(sandbox, WORKSPACE_PATH, publicRepoUrl);
	}
}

async function commandExists(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
	cwd: string,
): Promise<boolean> {
	const result = await sandbox.exec(`command -v ${quoteShellArg(command)}`, {
		cwd,
		timeout: CLONE_TIMEOUT_MS,
	});
	return result.success;
}

async function installWithRequiredPackageManager(
	sandbox: ReturnType<typeof getSandbox>,
	packageManager: string,
	installCommand: string,
	errorPrefix: string,
	cwd: string,
): Promise<void> {
	if (!(await commandExists(sandbox, packageManager, cwd))) {
		if (await commandExists(sandbox, "corepack", cwd)) {
			await execOrThrow(sandbox, "corepack enable", {
				cwd,
				timeout: INSTALL_TIMEOUT_MS,
				errorPrefix: `Failed to enable Corepack for ${packageManager}`,
			});
		}
	}

	if (!(await commandExists(sandbox, packageManager, cwd))) {
		throw new Error(
			`${packageManager} is required to install this project's dependencies, but it is unavailable in the sandbox.`,
		);
	}

	await execOrThrow(sandbox, installCommand, {
		cwd,
		timeout: INSTALL_TIMEOUT_MS,
		errorPrefix,
	});
}

export async function installDependencies(
	sandbox: ReturnType<typeof getSandbox>,
	cwd: string = WORKSPACE_PATH,
): Promise<void> {
	const hasPackageJson = await sandbox.exists(`${cwd}/package.json`);
	if (!hasPackageJson.exists) {
		return;
	}

	const hasPnpmLock = await sandbox.exists(`${cwd}/pnpm-lock.yaml`);
	if (hasPnpmLock.exists) {
		await installWithRequiredPackageManager(
			sandbox,
			"pnpm",
			"pnpm install --no-frozen-lockfile",
			"Failed to install dependencies with pnpm",
			cwd,
		);
		return;
	}

	const hasYarnLock = await sandbox.exists(`${cwd}/yarn.lock`);
	if (hasYarnLock.exists) {
		await installWithRequiredPackageManager(
			sandbox,
			"yarn",
			"yarn install",
			"Failed to install dependencies with yarn",
			cwd,
		);
		return;
	}

	await execOrThrow(sandbox, "npm install", {
		cwd,
		timeout: INSTALL_TIMEOUT_MS,
		errorPrefix: "Failed to install dependencies with npm",
	});
}

export async function isSandboxWorkspaceHydrated(options: {
	env: Env;
	sandboxId: string;
}): Promise<boolean> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const gitDir = await sandbox.exists(`${WORKSPACE_PATH}/.git`);
	return gitDir.exists;
}

export async function isSandboxRunnerHealthy(options: {
	env: Env;
	sandboxId: string;
}): Promise<boolean> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const result = await sandbox.exec(
		`test -f ${quoteShellArg(RUNNER_CLI_PATH)} && node -e ${quoteShellArg(
			`JSON.parse(require("node:fs").readFileSync(${JSON.stringify(RUNNER_PACKAGE_PATH)}, "utf8"))`,
		)}`,
		{ cwd: "/", timeout: CLONE_TIMEOUT_MS },
	);
	return result.success;
}

export async function backupSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
	projectId: string;
	userId: string;
	generation?: number;
	quiesce?: boolean;
}): Promise<ArchiveRef> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	return await createArchive(options.env, createDb(options.env), {
		sandbox: sandbox as ArchiveSandbox,
		sandboxId: options.sandboxId,
		ownerKind: "legacy_project",
		ownerId: options.projectId,
		userId: options.userId,
		generation: options.generation ?? 0,
		quiesce: options.quiesce,
	});
}

export async function restoreSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
	archiveId: string;
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await restoreArchive(options.env, createDb(options.env), {
		sandbox: sandbox as ArchiveSandbox,
		sandboxId: options.sandboxId,
		archiveId: options.archiveId,
	});
	await installDependencies(sandbox);
}

export async function clearSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
}): Promise<void> {
	if (WORKSPACE_PATH !== "/workspace") {
		throw new Error("Refusing to clear unexpected workspace path.");
	}

	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await execOrThrow(
		sandbox,
		"find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
		{
			cwd: "/",
			timeout: CLONE_TIMEOUT_MS,
			errorPrefix: "Failed to clear sandbox workspace",
		},
	);
}

export async function bootstrapSandbox(options: {
	env: Env;
	projectId: string;
	sandboxId: string;
	githubRepo: string;
	installationId: number;
	userId: string;
}): Promise<{ sandboxId: string; backup: string }> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);

	try {
		const repoName = repositoryNameFromSlug(options.githubRepo);
		const token = await getInstallationAccessToken(
			options.env,
			options.installationId,
			repoName ? { repositories: [repoName] } : undefined,
		);
		const repoUrl = `https://x-access-token:${token}@github.com/${options.githubRepo}.git`;
		const publicRepoUrl = `https://github.com/${options.githubRepo}.git`;

		await clearSandboxWorkspace({
			env: options.env,
			sandboxId: options.sandboxId,
		});

		await sandbox.gitCheckout(repoUrl, {
			targetDir: WORKSPACE_PATH,
			cloneTimeoutMs: CLONE_TIMEOUT_MS,
		});

		await scrubGithubRemote(sandbox, WORKSPACE_PATH, publicRepoUrl);
		await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);

		await installDependencies(sandbox);
		const archive = await backupSandboxWorkspace({
			env: options.env,
			sandboxId: options.sandboxId,
			projectId: options.projectId,
			userId: options.userId,
			generation: 0,
			quiesce: false,
		});

		return { sandboxId: options.sandboxId, backup: archive.id };
	} catch (error) {
		await sandbox.destroy();
		throw error;
	}
}
