import type { createDb } from "#/db";
import {
	type PersistProjectSandboxBackupProject,
	persistProjectSandboxBackup,
} from "#/lib/project-sandbox";
import { recordMutationAndCheckpoint } from "#/lib/workspace-recovery";
import { isLegacySharedSandboxSession } from "#/lib/workspace-runtime";

export type SessionGitBackupSession = {
	id: string;
	sandboxIdentityId?: string | null;
	baseCommitSha?: string | null;
	workspacePath?: string;
	branchName?: string | null;
};

export async function bestEffortPersistSessionGitBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
	session: SessionGitBackupSession;
}): Promise<void> {
	try {
		const legacy = isLegacySharedSandboxSession(
			{
				sandboxIdentityId: options.session.sandboxIdentityId ?? null,
				baseCommitSha: options.session.baseCommitSha ?? null,
				workspacePath: options.session.workspacePath ?? "/workspace",
				branchName: options.session.branchName ?? null,
			},
			{ sandboxId: options.project.sandboxId },
		);
		if (legacy) {
			await persistProjectSandboxBackup({
				db: options.db,
				env: options.env,
				project: options.project,
			});
			return;
		}
		await recordMutationAndCheckpoint({
			db: options.db,
			env: options.env,
			userId: options.project.userId,
			projectId: options.project.id,
			sessionId: options.session.id,
		});
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
	session: SessionGitBackupSession;
	commit: () => Promise<{ commitSha: string | null; committed: boolean }>;
}): Promise<{ commitSha: string | null; committed: boolean }> {
	const result = await options.commit();
	if (result.committed) {
		await bestEffortPersistSessionGitBackup({
			db: options.db,
			env: options.env,
			project: options.project,
			session: options.session,
		});
	}
	return result;
}

export async function runSessionGitMutationWithBackup<T>(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
	session: SessionGitBackupSession;
	run: () => Promise<T>;
}): Promise<T> {
	const result = await options.run();
	await bestEffortPersistSessionGitBackup({
		db: options.db,
		env: options.env,
		project: options.project,
		session: options.session,
	});
	return result;
}
