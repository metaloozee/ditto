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

export type PersistProjectSandboxBackupResult = {
	project: typeof projects.$inferSelect;
	stored: boolean;
	candidateGeneration: number;
};

/**
 * Snapshot /workspace (incl. worktrees) and store the backup handle on the
 * project row only when this candidate is still the newest generation.
 * Same durability path as post-agent-run and post-git mutation backups.
 */
export async function persistProjectSandboxBackup(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: PersistProjectSandboxBackupProject;
}): Promise<PersistProjectSandboxBackupResult> {
	if (options.project.status !== "ready" || !options.project.sandboxId) {
		throw new Error("Project sandbox is not ready.");
	}

	const [reserved] = await options.db
		.update(projects)
		.set({
			sandboxBackupRequestedGeneration: sql`${projects.sandboxBackupRequestedGeneration} + 1`,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
			),
		)
		.returning({
			generation: projects.sandboxBackupRequestedGeneration,
			status: projects.status,
			sandboxId: projects.sandboxId,
		});

	if (!reserved || reserved.generation == null) {
		throw new Error("Failed to reserve project sandbox backup generation.");
	}

	const candidateGeneration = reserved.generation;
	if (reserved.status !== "ready" || !reserved.sandboxId) {
		throw new Error("Project sandbox is not ready.");
	}

	const backup = await backupSandboxWorkspace({
		env: options.env,
		sandboxId: reserved.sandboxId,
		projectId: options.project.id,
	});

	const [storedProject] = await options.db
		.update(projects)
		.set({
			status: "ready",
			sandboxBackup: serializeSandboxBackup(backup),
			sandboxBackupCreatedAt: sql`(unixepoch())`,
			sandboxBackupStoredGeneration: candidateGeneration,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
				sql`${projects.sandboxBackupStoredGeneration} < ${candidateGeneration}`,
			),
		)
		.returning();

	if (storedProject) {
		return {
			project: storedProject,
			stored: true,
			candidateGeneration,
		};
	}

	// Candidate was superseded by a newer completed snapshot — not a failure.
	const [currentProject] = await options.db
		.select()
		.from(projects)
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
			),
		)
		.limit(1);

	if (!currentProject) {
		throw new Error("Failed to load project sandbox state.");
	}

	return {
		project: currentProject,
		stored: false,
		candidateGeneration,
	};
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

/** Unconditional store for provisioning / restore-refresh paths only. */
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
