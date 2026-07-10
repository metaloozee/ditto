import type { createDb } from "#/db";
import {
	type PersistProjectSandboxBackupProject,
	persistProjectSandboxBackup,
} from "#/lib/project-sandbox";

export async function bestEffortPersistSessionGitBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
}): Promise<void> {
	try {
		await persistProjectSandboxBackup(options);
	} catch (error) {
		console.error(
			"Failed to persist sandbox backup after session git operation.",
			error instanceof Error ? error.message : error,
		);
	}
}

export async function commitSessionChangesWithBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
	commit: () => Promise<{ commitSha: string | null; committed: boolean }>;
}): Promise<{ commitSha: string | null; committed: boolean }> {
	const result = await options.commit();
	if (result.committed) {
		await bestEffortPersistSessionGitBackup({
			db: options.db,
			env: options.env,
			project: options.project,
		});
	}
	return result;
}

export async function runSessionGitMutationWithBackup<T>(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
	run: () => Promise<T>;
}): Promise<T> {
	const result = await options.run();
	await bestEffortPersistSessionGitBackup({
		db: options.db,
		env: options.env,
		project: options.project,
	});
	return result;
}

export async function openSessionPullRequestWithBackup<T>(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
	pushIfNeeded: () => Promise<boolean>;
	open: () => Promise<T>;
}): Promise<T> {
	const didPush = await options.pushIfNeeded();
	if (didPush) {
		await bestEffortPersistSessionGitBackup({
			db: options.db,
			env: options.env,
			project: options.project,
		});
	}
	const result = await options.open();
	await bestEffortPersistSessionGitBackup({
		db: options.db,
		env: options.env,
		project: options.project,
	});
	return result;
}
