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
	getProjectSandboxState,
	isSandboxRunnerHealthy,
	isSandboxWorkspaceHydrated,
	restoreSandboxWorkspace,
} from "#/lib/sandbox-bootstrap";

export type CheckProjectSandboxState =
	| "connected"
	| "needs_restore"
	| "provisioning"
	| "failed";

export type CheckProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: CheckProjectSandboxState;
};

export type ProvisionProjectSandboxState =
	| "connected"
	| "restored_from_backup"
	| "recreated_from_github"
	| "provisioning"
	| "failed";

export type ProvisionProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: ProvisionProjectSandboxState;
};

type RestoreSuccessResult = {
	project: typeof projects.$inferSelect;
	state: "restored_from_backup" | "recreated_from_github";
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

const INACTIVE_SANDBOX_STATUSES = new Set([
	"stopping",
	"stopped",
	"stopped_with_code",
]);

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
	const [updated] = await options.db
		.update(projects)
		.set({ status: "failed", updatedAt: sql`(unixepoch())` })
		.where(
			and(
				eq(projects.id, options.project.id),
				eq(projects.userId, options.project.userId),
				eq(projects.status, "provisioning"),
			),
		)
		.returning({ id: projects.id });

	// No row → another actor already moved status; swallow as no-op.
	void updated;
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
				eq(projects.status, "provisioning"),
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
}): Promise<RestoreSuccessResult> {
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
		})) ||
		!(await isSandboxRunnerHealthy({
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

async function restoreLockedProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
	sandboxId: string;
}): Promise<RestoreSuccessResult> {
	const lockedProject = options.project;
	const sandboxId = options.sandboxId;

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
				})) ||
				!(await isSandboxRunnerHealthy({
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

/** Observation only: never writes D1, never fences, never restores. */
export async function checkProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<CheckProjectSandboxResult> {
	if (options.project.status === "provisioning") {
		return { project: options.project, state: "provisioning" };
	}

	if (
		options.project.status === "failed" ||
		options.project.status !== "ready" ||
		!options.project.sandboxId
	) {
		return { project: options.project, state: "failed" };
	}

	if (!options.project.githubRepo || !options.project.githubInstallationId) {
		throw new Error(
			"Project sandbox cannot be restored without a GitHub repository.",
		);
	}

	const sandboxId = options.project.sandboxId;
	const runtime = await getProjectSandboxState(options.env, sandboxId);
	const status = runtime.status;

	if (INACTIVE_SANDBOX_STATUSES.has(status)) {
		return { project: options.project, state: "needs_restore" };
	}

	if (status === "healthy" || status === "running") {
		const [hydrated, runnerHealthy] = await Promise.all([
			isSandboxWorkspaceHydrated({
				env: options.env,
				sandboxId,
			}),
			isSandboxRunnerHealthy({
				env: options.env,
				sandboxId,
			}),
		]);
		if (!runnerHealthy) {
			throw new Error(
				"Project sandbox runner image is invalid. Rebuild or redeploy the sandbox image.",
			);
		}
		if (hydrated) {
			return { project: options.project, state: "connected" };
		}
		return { project: options.project, state: "needs_restore" };
	}

	throw new Error(`Unknown sandbox runtime status: ${String(status)}`);
}

/** Idempotent restore path. Contention returns provisioning; never throws it. */
export async function provisionProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
}): Promise<ProvisionProjectSandboxResult> {
	const checked = await checkProjectSandbox(options);

	if (checked.state === "connected") {
		return { project: checked.project, state: "connected" };
	}
	if (checked.state === "provisioning") {
		return { project: checked.project, state: "provisioning" };
	}
	if (checked.state === "failed") {
		return { project: checked.project, state: "failed" };
	}

	// needs_restore
	const sandboxId = options.project.sandboxId;
	if (!sandboxId) {
		return { project: options.project, state: "failed" };
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
		return { project: options.project, state: "provisioning" };
	}

	return await restoreLockedProjectSandbox({
		db: options.db,
		env: options.env,
		project: lockedProject,
		sandboxId,
	});
}
