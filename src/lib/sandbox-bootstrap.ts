import { getSandbox } from "@cloudflare/sandbox";
import { getInstallationAccessToken } from "#/lib/github-app";

const WORKSPACE_PATH = "/workspace";
const CLONE_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 300_000;

type SandboxEnvVar = { key: string; value: string };

function quoteShellArg(value: string) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function formatEnvFile(envVars: SandboxEnvVar[]) {
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

async function runCommand(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
	options: { cwd?: string; timeout: number; errorPrefix: string },
) {
	const result = await sandbox.exec(command, {
		cwd: options.cwd,
		timeout: options.timeout,
	});

	if (result.success) {
		return result;
	}

	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	const output = stderr || stdout;
	throw new Error(
		output
			? `${options.errorPrefix}: ${output}`
			: `${options.errorPrefix} (exit code ${result.exitCode})`,
	);
}

async function installDependencies(sandbox: ReturnType<typeof getSandbox>) {
	const hasPackageJson = await sandbox.exists(`${WORKSPACE_PATH}/package.json`);
	if (!hasPackageJson.exists) {
		return;
	}

	const hasPnpmLock = await sandbox.exists(`${WORKSPACE_PATH}/pnpm-lock.yaml`);
	if (hasPnpmLock.exists) {
		await runCommand(sandbox, "corepack enable", {
			cwd: WORKSPACE_PATH,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix: "Failed to enable Corepack for pnpm",
		});
		await runCommand(sandbox, "pnpm install --no-frozen-lockfile", {
			cwd: WORKSPACE_PATH,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix: "Failed to install dependencies with pnpm",
		});
		return;
	}

	const hasYarnLock = await sandbox.exists(`${WORKSPACE_PATH}/yarn.lock`);
	if (hasYarnLock.exists) {
		await runCommand(sandbox, "corepack enable", {
			cwd: WORKSPACE_PATH,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix: "Failed to enable Corepack for yarn",
		});
		await runCommand(sandbox, "yarn install", {
			cwd: WORKSPACE_PATH,
			timeout: INSTALL_TIMEOUT_MS,
			errorPrefix: "Failed to install dependencies with yarn",
		});
		return;
	}

	await runCommand(sandbox, "npm install", {
		cwd: WORKSPACE_PATH,
		timeout: INSTALL_TIMEOUT_MS,
		errorPrefix: "Failed to install dependencies with npm",
	});
}

export async function bootstrapSandbox(options: {
	env: Env;
	sandboxId: string;
	githubRepo: string;
	installationId: number;
	envVars: SandboxEnvVar[];
}): Promise<{ sandboxId: string }> {
	const sandbox = getSandbox(
		options.env.Sandbox as Parameters<typeof getSandbox>[0],
		options.sandboxId,
		{
			enableDefaultSession: false,
		},
	);

	try {
		const token = await getInstallationAccessToken(
			options.env,
			options.installationId,
		);
		const repoUrl = `https://x-access-token:${token}@github.com/${options.githubRepo}.git`;
		const publicRepoUrl = `https://github.com/${options.githubRepo}.git`;

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

		return { sandboxId: options.sandboxId };
	} catch (error) {
		await sandbox.destroy();
		throw error;
	}
}
