import { type DirectoryBackup } from "@cloudflare/sandbox";
import { and, desc, eq, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import { projects, snapshots } from "#/db/schema";
import {
	type SnapshotManifest,
	validateSnapshotManifest,
} from "#/lib/r2-layout";
import {
	parseSandboxBackup,
	serializeSandboxBackup,
	shouldUseLocalBucketBackups,
} from "#/lib/sandbox-backup";
import {
	backupSandboxWorkspace,
	bootstrapSandbox,
	isSandboxWorkspaceHydrated,
	restoreSandboxWorkspace,
	restoreSandboxWorkspaceFromSnapshot,
	type SandboxEnvVar,
} from "#/lib/sandbox-bootstrap";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export type EnsureProjectSandboxResult = {
	project: typeof projects.$inferSelect;
	state: "connected" | "restored_from_backup" | "recreated_from_github";
};

type SnapshotManifestBucket = {
	get(key: string): Promise<{ json(): Promise<unknown> } | null>;
};

type SnapshotRow = typeof snapshots.$inferSelect;

export type ResolvedSnapshot =
	| {
			snapshotId: string;
			manifest: SnapshotManifest;
			snapshotRow: SnapshotRow;
	  }
	| { invalid: true; row: SnapshotRow };

export async function resolveLatestSnapshot(
	db: ReturnType<typeof createDb>,
	projectId: string,
	bucket: SnapshotManifestBucket,
): Promise<ResolvedSnapshot | null> {
	const rows = await db
		.select()
		.from(snapshots)
		.where(
			and(
				eq(snapshots.projectId, projectId),
				eq(snapshots.status, "completed"),
			),
		)
		.orderBy(desc(snapshots.createdAt))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	const obj = await bucket.get(row.r2Key);
	if (!obj) {
		return { invalid: true, row };
	}

	const body = await obj.json();
	if (!validateSnapshotManifest(body)) {
		return { invalid: true, row };
	}

	return { snapshotId: row.id, manifest: body, snapshotRow: row };
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
	envVars: SandboxEnvVar[];
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
		envVars: options.envVars,
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

function reconstructDirectoryBackupFromArchiveRef(
	archiveRef: string,
	env: Env,
): DirectoryBackup {
	return {
		id: archiveRef,
		dir: WORKSPACE_PATH,
		...(shouldUseLocalBucketBackups(env) ? { localBucket: true } : {}),
	};
}

async function markSnapshotRowFailed(
	db: ReturnType<typeof createDb>,
	snapshotId: string,
): Promise<void> {
	try {
		await db
			.update(snapshots)
			.set({ status: "failed" })
			.where(eq(snapshots.id, snapshotId));
	} catch {
		// Best-effort — do not block restore on snapshot status update failure.
	}
}

export async function ensureProjectSandbox(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	project: typeof projects.$inferSelect;
	envVars: SandboxEnvVar[];
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
		const resolved = await resolveLatestSnapshot(
			options.db,
			lockedProject.id,
			options.env.BACKUP_BUCKET,
		);

		if (resolved && "snapshotId" in resolved && resolved.manifest.archiveRef) {
			try {
				const directoryBackup =
					reconstructDirectoryBackupFromArchiveRef(
						resolved.manifest.archiveRef,
						options.env,
					);

				await restoreSandboxWorkspaceFromSnapshot({
					env: options.env,
					sandboxId,
					directoryBackup,
					envVars: options.envVars,
					expectedDigest: resolved.manifest.digest,
					baseCommitSha: resolved.manifest.baseCommitSha,
				});

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
			} catch {
				// Snapshot restore failed - fall through to legacy / GitHub.
			}
		} else if (resolved && "invalid" in resolved) {
			await markSnapshotRowFailed(options.db, resolved.row.id);
		}

		const storedBackup = parseSandboxBackup(lockedProject.sandboxBackup);

		if (storedBackup) {
			try {
				await restoreSandboxWorkspace({
					env: options.env,
					sandboxId,
					backup: storedBackup,
					envVars: options.envVars,
				});
			} catch {
				return await recreateSandboxFromGitHub({
					db: options.db,
					env: options.env,
					project: lockedProject,
					sandboxId,
					envVars: options.envVars,
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
			envVars: options.envVars,
		});
	} catch {
		await markProjectRestoreFailed({
			db: options.db,
			project: lockedProject,
		});
		throw new Error("Project sandbox restore failed. Please try again.");
	}
}
