import { getSandbox } from "@cloudflare/sandbox";
import {
	DITTO_GIT_AUTHOR_EMAIL,
	DITTO_GIT_AUTHOR_NAME,
} from "#/lib/ditto-git-identity";
import { redactSecrets } from "#/lib/secret-redaction";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

const COMMAND_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 300_000;

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
	return getProjectSandbox(env, sandboxId).getState();
}

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function destroySandbox(options: {
	env: Env;
	sandboxId: string;
}): Promise<void> {
	await getProjectSandbox(options.env, options.sandboxId).destroy();
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

export async function configureDittoGitIdentity(
	sandbox: ReturnType<typeof getSandbox>,
	cwd: string,
): Promise<void> {
	await execOrThrow(
		sandbox,
		`git config user.name ${quoteShellArg(DITTO_GIT_AUTHOR_NAME)} && git config user.email ${quoteShellArg(DITTO_GIT_AUTHOR_EMAIL)}`,
		{
			cwd,
			timeout: COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to configure Ditto git identity",
		},
	);
}

async function commandExists(
	sandbox: ReturnType<typeof getSandbox>,
	command: string,
	cwd: string,
): Promise<boolean> {
	const result = await sandbox.exec(`command -v ${quoteShellArg(command)}`, {
		cwd,
		timeout: COMMAND_TIMEOUT_MS,
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
	if (!(await sandbox.exists(`${cwd}/package.json`)).exists) {
		return;
	}
	if ((await sandbox.exists(`${cwd}/pnpm-lock.yaml`)).exists) {
		await installWithRequiredPackageManager(
			sandbox,
			"pnpm",
			"pnpm install --no-frozen-lockfile",
			"Failed to install dependencies with pnpm",
			cwd,
		);
		return;
	}
	if ((await sandbox.exists(`${cwd}/yarn.lock`)).exists) {
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

export async function clearSandboxWorkspace(options: {
	env: Env;
	sandboxId: string;
}): Promise<void> {
	if (WORKSPACE_PATH !== "/workspace") {
		throw new Error("Refusing to clear unexpected workspace path.");
	}
	await execOrThrow(
		getProjectSandbox(options.env, options.sandboxId),
		"find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
		{
			cwd: "/",
			timeout: COMMAND_TIMEOUT_MS,
			errorPrefix: "Failed to clear sandbox workspace",
		},
	);
}
