import { getProjectSandbox } from "#/lib/sandbox-bootstrap";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import {
	SESSION_WORKSPACE_LOCK_ROOT,
	sessionWorkspaceLockPath,
} from "#/lib/workspace-policy";

const LOCK_COMMAND_TIMEOUT_MS = 10_000;
const STALE_LOCK_MINUTES = 15;

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function withSessionWorkspaceLock<T>(options: {
	env: Env;
	sandboxId: string;
	sessionId: string;
	run: () => Promise<T>;
}): Promise<T> {
	const sandbox = getProjectSandbox(options.env, options.sandboxId);
	const lockPath = sessionWorkspaceLockPath(options.sessionId);
	const acquired = await sandbox.exec(
		[
			`mkdir -p ${quoteShellArg(SESSION_WORKSPACE_LOCK_ROOT)}`,
			`mkdir ${quoteShellArg(lockPath)} || (find ${quoteShellArg(lockPath)} -maxdepth 0 -mmin +${STALE_LOCK_MINUTES} -exec rm -rf -- {} + && mkdir ${quoteShellArg(lockPath)})`,
		].join(" && "),
		{ cwd: "/tmp", timeout: LOCK_COMMAND_TIMEOUT_MS },
	);
	if (!acquired.success) {
		throw new SessionWorkspaceBusyError();
	}

	try {
		return await options.run();
	} finally {
		await sandbox.exec(`rm -rf -- ${quoteShellArg(lockPath)}`, {
			cwd: "/tmp",
			timeout: LOCK_COMMAND_TIMEOUT_MS,
		});
	}
}
