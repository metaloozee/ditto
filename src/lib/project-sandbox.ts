import type { DirectoryBackup } from "@cloudflare/sandbox";
import { and, eq, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import { projects } from "#/db/schema";
import {
	parseSandboxBackup,
	serializeSandboxBackup,
} from "#/lib/sandbox-backup";
import {
	backupSandboxWorkspace,
	bootstrapSandbox,
	isSandboxWorkspaceHydrated,
	restoreSandboxWorkspace,
} from "#/lib/sandbox-bootstrap";

export type EnsureProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: "connected" | "restored_from_backup" | "recreated_from_github";
};

export type PersistProjectSandboxBackupProject = Pick<
	typeof projects.$inferSelect,
	"id" | "userId" | "sandboxId" | "status"
>;

/**
 * Snapshot /workspace (incl. worktrees) and store the backup handle on the
 * project row. Same durability path as post-agent-run and post-restore.
 */
export async function persistProjectSandboxBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
}): Promise<typeof projects.$inferSelect> {
	if (options.project.status !== "ready" || !options.project.sandboxId) {
		throw new Error("Project sandbox is not ready.");
	}
	const backup = await backupSandboxWorkspace({
		env: options.env,
		sandboxId: options.project.sandboxId,
		projectId: options.project.id,
	});
	return storeReadyProjectBackup({
		db: options.db,
		project: options.project as typeof projects.$inferSelect,
		backup,
	});
}

/** Persist a backup handle produced elsewhere (e.g. end of agent run). */
export async function finalizeAgentRun(options: {
	db: ReturnType<typeof createDb>;
	project: typeof projects.$inferSelect;
	backup: DirectoryBackup;
}): Promise<typeof projects.$inferSelect> {
	return storeReadyProjectBackup({
		db: options.db,
		project: options.project,
		backup: options.backup,
	});
}

async function markProjectRestoreFailed(options: {
	db: ReturnType<typeof createDb>;
	project: typeof projects.$inferSelect;
}) {
	await options.db
		.update(projects)
		.set({ status: "failed", updatedAt: sql`(unixepoch())` })
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
			),
		);
}

async function storeReadyProjectBackup(options: {
	db: ReturnType<typeof createDb>;
	project: typeof projects.$inferSelect;
	backup: Parameters<typeof serializeSandboxBackup>[0];
}) {
	const [updatedProject] = await options.db
		.update(projects)
		.set({
			status: "ready",
			sandboxBackup: serializeSandboxBackup(options.backup),
			sandboxBackupCreatedAt: sql`(unixepoch())`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
			),
		)
		.returning();

	if (!updatedProject) {
		throw new Error("Failed to update project sandbox state.");
	}

	return updatedProject;
}

async function recreateSandboxFromGitHub(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
	sandboxId: string;
}): Promise<EnsureProjectSandboxResult> {
	if (!options.project.githubRepo || !options.project.githubInstallationId) {
		throw new Error(
			"Project sandbox cannot be restored without a GitHub repository.",
		);
	}

	const { backup } = await bootstrapSandbox({
		env: options.env,
		projectId: options.project.id,
		sandboxId: options.sandboxId,
		githubRepo: options.project.githubRepo,
		installationId: options.project.githubInstallationId,
	});

	if (
		!(await isSandboxWorkspaceHydrated({
			env: options.env,
			sandboxId: options.sandboxId,
		}))
	) {
		throw new Error("Project sandbox restore failed. Please try again.");
	}

	const project = await storeReadyProjectBackup({
		db: options.db,
		project: options.project,
		backup,
	});

	return { project, state: "recreated_from_github" };
}

export async function ensureProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<EnsureProjectSandboxResult> {
	if (options.project.status !== "ready" || !options.project.sandboxId) {
		throw new Error("Project sandbox is not ready yet.");
	}

	if (!options.project.githubRepo || !options.project.githubInstallationId) {
		throw new Error(
			"Project sandbox cannot be restored without a GitHub repository.",
		);
	}

	const sandboxId = options.project.sandboxId;
	const hydrated = await isSandboxWorkspaceHydrated({
		env: options.env,
		sandboxId,
	});

	if (hydrated) {
		return { project: options.project, state: "connected" };
	}

	const [lockedProject] = await options.db
		.update(projects)
		.set({ status: "provisioning", updatedAt: sql`(unixepoch())` })
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
				eq(projects.status, "ready"),
			),
		)
		.returning();

	if (!lockedProject) {
		throw new Error("Project sandbox is already being restored.");
	}

	try {
		const storedBackup = parseSandboxBackup(lockedProject.sandboxBackup);

		if (storedBackup) {
			try {
				await restoreSandboxWorkspace({
					env: options.env,
					sandboxId,
					backup: storedBackup,
				});
			} catch {
				return await recreateSandboxFromGitHub({
					db: options.db,
					env: options.env,
					project: lockedProject,
					sandboxId,
				});
			}

			const backup = await backupSandboxWorkspace({
				env: options.env,
				sandboxId,
				projectId: lockedProject.id,
			});

			if (
				!(await isSandboxWorkspaceHydrated({
					env: options.env,
					sandboxId,
				}))
			) {
				throw new Error("Restored sandbox workspace is not hydrated.");
			}

			const project = await storeReadyProjectBackup({
				db: options.db,
				project: lockedProject,
				backup,
			});

			return { project, state: "restored_from_backup" };
		}

		return await recreateSandboxFromGitHub({
			db: options.db,
			env: options.env,
			project: lockedProject,
			sandboxId,
		});
	} catch {
		await markProjectRestoreFailed({
			db: options.db,
			project: lockedProject,
		});
		throw new Error("Project sandbox restore failed. Please try again.");
	}
}
