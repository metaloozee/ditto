import type { createDb } from "#/db";
import { recordMutationAndCheckpoint } from "#/lib/workspace-recovery";
import { withWorkspaceRuntimeLease } from "#/lib/workspace-runtime";

export type SessionGitBackupProject = {
	id: string;
	userId: string;
};

export type SessionGitBackupSession = {
	id: string;
};

export async function bestEffortPersistSessionGitBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: SessionGitBackupProject;
	session: SessionGitBackupSession;
}): Promise<void> {
	try {
		await recordMutationAndCheckpoint(
			{
				db: options.db,
				env: options.env,
				userId: options.project.userId,
				projectId: options.project.id,
				sessionId: options.session.id,
			},
			{
				withWorkspaceRuntimeLease: (input, run) =>
					withWorkspaceRuntimeLease({ ...input, env: options.env }, run),
			},
		);
	} catch (error) {
		console.error(
			"Failed to checkpoint workspace after Git mutation.",
			error instanceof Error ? error.message : error,
		);
	}
}

export async function commitSessionChangesWithBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: SessionGitBackupProject;
	session: SessionGitBackupSession;
	commit: () => Promise<{ commitSha: string | null; committed: boolean }>;
}): Promise<{ commitSha: string | null; committed: boolean }> {
	const result = await options.commit();
	if (result.committed) {
		await bestEffortPersistSessionGitBackup(options);
	}
	return result;
}

export async function runSessionGitMutationWithBackup<T>(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: SessionGitBackupProject;
	session: SessionGitBackupSession;
	run: () => Promise<T>;
}): Promise<T> {
	const result = await options.run();
	await bestEffortPersistSessionGitBackup(options);
	return result;
}
