import { type DirectoryBackup, getSandbox } from "@cloudflare/sandbox";
import {
	DITTO_GIT_AUTHOR_EMAIL,
	DITTO_GIT_AUTHOR_NAME,
} from "#/lib/ditto-git-identity";
import {
	getInstallationAccessToken,
	repositoryNameFromSlug,
} from "#/lib/github-app";
import { getSandboxBackupOptions } from "#/lib/sandbox-backup";
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

	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	const output = redactSecrets(stderr || stdout, options.secrets ?? []);
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

	const repoName = repositoryNameFromSlug(options.githubRepo);
	const token = await getInstallationAccessToken(
		options.env,
		options.installationId,
		repoName ? { repositories: [repoName] } : undefined,
	);
	const tokenizedRepoUrl = `https://x-access-token:${token}@github.com/${options.githubRepo}.git`;
	const execSecrets = [token] as const;

	try {
		await execOrThrow(
			sandbox,
			`git fetch --no-tags ${quoteShellArg(tokenizedRepoUrl)} +refs/heads/${branchName}:refs/remotes/origin/${branchName}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to fetch primary workspace from GitHub",
				secrets: execSecrets,
			},
		);

		const headSha = (
			await execOrThrow(sandbox, "git rev-parse HEAD", {
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to resolve primary HEAD",
				secrets: execSecrets,
			})
		).stdout.trim();
		const remoteRef = `refs/remotes/origin/${branchName}`;
		const remoteSha = (
			await execOrThrow(sandbox, `git rev-parse ${quoteShellArg(remoteRef)}`, {
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to resolve fetched remote HEAD",
				secrets: execSecrets,
			})
		).stdout.trim();

		if (headSha === remoteSha) {
			if (await primaryDepsRetrySignalExists(sandbox)) {
				await refreshPrimaryDependencies(sandbox);
			}
			return { branchName, headSha, updated: false };
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
				secrets: execSecrets,
			},
		);

		await refreshPrimaryDependencies(sandbox);

		const synchronizedHead = (
			await execOrThrow(sandbox, "git rev-parse HEAD", {
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to verify primary HEAD after fast-forward",
				secrets: execSecrets,
			})
		).stdout.trim();
		if (synchronizedHead !== remoteSha) {
			throw new Error(
				"Primary workspace fast-forward did not reach the fetched GitHub commit.",
			);
		}

		return { branchName, headSha: synchronizedHead, updated: true };
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
	const token = await getInstallationAccessToken(
		options.env,
		options.installationId,
		repoName ? { repositories: [repoName] } : undefined,
	);
	const tokenizedRepoUrl = `https://x-access-token:${token}@github.com/${options.githubRepo}.git`;
	const publicRepoUrl = `https://github.com/${options.githubRepo}.git`;
	const remoteRef = `refs/remotes/origin/${options.branchName}`;
	const refspec = `+refs/heads/${options.branchName}:refs/remotes/origin/${options.branchName}`;

	try {
		await execOrThrow(
			sandbox,
			`git fetch --no-tags ${quoteShellArg(tokenizedRepoUrl)} ${quoteShellArg(refspec)}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to fetch base branch from GitHub",
				secrets: [token],
			},
		);
		const headSha = (
			await execOrThrow(sandbox, `git rev-parse ${quoteShellArg(remoteRef)}`, {
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to resolve fetched base branch",
				secrets: [token],
			})
		).stdout.trim();
		return { branchName: options.branchName, headSha };
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

async function installWithNpmFallback(
	sandbox: ReturnType<typeof getSandbox>,
	preferredCommand: string,
	installCommand: string,
	errorPrefix: string,
	cwd: string,
): Promise<void> {
	if (!(await commandExists(sandbox, preferredCommand, cwd))) {
		if (await commandExists(sandbox, "corepack", cwd)) {
			await execOrThrow(sandbox, "corepack enable", {
				cwd,
				timeout: INSTALL_TIMEOUT_MS,
				errorPrefix: `Failed to enable Corepack for ${preferredCommand}`,
			});
		}
	}

	if (await commandExists(sandbox, preferredCommand, cwd)) {
		await execOrThrow(sandbox, installCommand, {
			cwd,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix,
		});
		return;
	}

	await execOrThrow(sandbox, "npm install", {
		cwd,
		timeout: INSTALL_TIMEOUT_MS,
		errorPrefix: `Failed to install dependencies with npm fallback for ${preferredCommand}`,
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
		await installWithNpmFallback(
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
		await installWithNpmFallback(
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
}): Promise<DirectoryBackup> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	return await sandbox.createBackup(
		getSandboxBackupOptions({ env: options.env, projectId: options.projectId }),
	);
}

export async function restoreSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
	backup: DirectoryBackup;
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await sandbox.restoreBackup(options.backup);
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
}): Promise<{ sandboxId: string; backup: DirectoryBackup }> {
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
		const backup = await backupSandboxWorkspace({
			env: options.env,
			sandboxId: options.sandboxId,
			projectId: options.projectId,
		});

		return { sandboxId: options.sandboxId, backup };
	} catch (error) {
		await sandbox.destroy();
		throw error;
	}
}
