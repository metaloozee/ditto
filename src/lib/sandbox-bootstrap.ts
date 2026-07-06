import { type DirectoryBackup, getSandbox } from "@cloudflare/sandbox";
import { getInstallationAccessToken } from "#/lib/github-app";
import { getSandboxBackupOptions } from "#/lib/sandbox-backup";
import { redactSecrets } from "#/lib/secret-redaction";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const CLONE_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 300_000;

export type SandboxEnvVar = { key: string; value: string };

export function getProjectSandbox(env: Env, sandboxId: string) {
	return getSandbox(
		env.Sandbox as Parameters<typeof getSandbox>[0],
		sandboxId,
		{
			enableDefaultSession: false,
		},
	);
}

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function formatEnvFile(envVars: SandboxEnvVar[]): string {
	return envVars
		.map(({ key, value }) => {
			const escapedValue = value
				.replaceAll("\\", "\\\\")
				.replaceAll('"', '\\"')
				.replaceAll("\n", "\\n");

			return `${key}="${escapedValue}"`;
		})
		.join("\n");
}

export async function syncSandboxEnvFile(options: {
	env: Env;
	sandboxId: string;
	envVars: SandboxEnvVar[];
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);

	await sandbox.writeFile(
		`${WORKSPACE_PATH}/.env`,
		options.envVars.length > 0 ? `${formatEnvFile(options.envVars)}\n` : "",
	);
}

export async function destroySandbox(options: {
	env: Env;
	sandboxId: string;
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);

	await sandbox.destroy();
}

async function runCommand(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
	options: { cwd?: string; timeout: number; errorPrefix: string },
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
	const output = redactSecrets(stderr || stdout);
	throw new Error(
		output
			? `${options.errorPrefix}: ${output}`
			: `${options.errorPrefix} (exit code ${result.exitCode})`,
	);
}

async function commandExists(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
): Promise<boolean> {
	const result = await sandbox.exec(`command -v ${quoteShellArg(command)}`, {
		cwd: WORKSPACE_PATH,
		timeout: CLONE_TIMEOUT_MS,
	});
	return result.success;
}

async function installWithNpmFallback(
	sandbox: ReturnType<typeof getSandbox>,
	preferredCommand: string,
	installCommand: string,
	errorPrefix: string,
): Promise<void> {
	if (!(await commandExists(sandbox, preferredCommand))) {
		if (await commandExists(sandbox, "corepack")) {
			await runCommand(sandbox, "corepack enable", {
				cwd: WORKSPACE_PATH,
				timeout: INSTALL_TIMEOUT_MS,
				errorPrefix: `Failed to enable Corepack for ${preferredCommand}`,
			});
		}
	}

	if (await commandExists(sandbox, preferredCommand)) {
		await runCommand(sandbox, installCommand, {
			cwd: WORKSPACE_PATH,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix,
		});
		return;
	}

	await runCommand(sandbox, "npm install", {
		cwd: WORKSPACE_PATH,
		timeout: INSTALL_TIMEOUT_MS,
		errorPrefix: `Failed to install dependencies with npm fallback for ${preferredCommand}`,
	});
}

export async function installDependencies(
	sandbox: ReturnType<typeof getSandbox>,
): Promise<void> {
	const hasPackageJson = await sandbox.exists(`${WORKSPACE_PATH}/package.json`);
	if (!hasPackageJson.exists) {
		return;
	}

	const hasPnpmLock = await sandbox.exists(`${WORKSPACE_PATH}/pnpm-lock.yaml`);
	if (hasPnpmLock.exists) {
		await installWithNpmFallback(
			sandbox,
			"pnpm",
			"pnpm install --no-frozen-lockfile",
			"Failed to install dependencies with pnpm",
		);
		return;
	}

	const hasYarnLock = await sandbox.exists(`${WORKSPACE_PATH}/yarn.lock`);
	if (hasYarnLock.exists) {
		await installWithNpmFallback(
			sandbox,
			"yarn",
			"yarn install",
			"Failed to install dependencies with yarn",
		);
		return;
	}

	await runCommand(sandbox, "npm install", {
		cwd: WORKSPACE_PATH,
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
	envVars: SandboxEnvVar[];
}): Promise<void> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	await sandbox.restoreBackup(options.backup);
	await syncSandboxEnvFile({
		env: options.env,
		sandboxId: options.sandboxId,
		envVars: options.envVars,
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
	await runCommand(
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
	envVars: SandboxEnvVar[];
}): Promise<{ sandboxId: string; backup: DirectoryBackup }> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);

	try {
		const token = await getInstallationAccessToken(
			options.env,
			options.installationId,
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

		await runCommand(
			sandbox,
			`git remote set-url origin ${quoteShellArg(publicRepoUrl)}`,
			{
				cwd: WORKSPACE_PATH,
				timeout: CLONE_TIMEOUT_MS,
				errorPrefix: "Failed to scrub Git remote URL",
			},
		);

		if (options.envVars.length > 0) {
			await sandbox.writeFile(
				`${WORKSPACE_PATH}/.env`,
				`${formatEnvFile(options.envVars)}\n`,
			);
		}

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
