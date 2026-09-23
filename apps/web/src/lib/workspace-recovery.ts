/**
 * Session-scoped recovery lineages for dedicated workspace sandboxes.
 *
 * Failed agent runs still checkpoint: tools may have mutated the filesystem
 * before the turn ended, so durability follows completed mutations, not
 * assistant success.
 */
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	type WORKSPACE_RECOVERY_STATES,
	workspaceSessionRecoveries,
	workspaceSessions,
} from "#/db/schema";
import {
	type ArchiveBackupStore,
	type ArchiveRef,
	type RestoreResult as ArchiveRestoreResult,
	type ArchiveSandbox,
	abandonArchive,
	type CreateArchiveInput,
	createArchive,
	type RestoreArchiveInput,
	restoreArchive,
} from "#/lib/sandbox-archive";
import {
	persistWorkspaceWork,
	WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS,
} from "#/lib/workspace-runtime-capacity";
import type { WorkspaceRuntimeLease } from "#/lib/workspace-runtime-policy";

type Db = ReturnType<typeof createDb>;

export const WORKSPACE_RECOVERY_CHECKPOINT_MAX_ATTEMPTS = 8;
export const WORKSPACE_RECOVERY_CHECKPOINT_LEASE_TTL_MS = 10 * 60 * 1000;

export type WorkspaceRecoveryStateName =
	(typeof WORKSPACE_RECOVERY_STATES)[number];

export type RecoveryState = {
	state: WorkspaceRecoveryStateName;
	reasonCode: string | null;
	mutationGeneration: number;
	durableGeneration: number;
	pending: boolean;
	/** False when a checkpoint is already running and this mutation coalesced. */
	shouldCheckpoint: boolean;
};

export type RestoreOutcome =
	| {
			ok: true;
			usedPrevious: boolean;
			reasonCode: string | null;
	  }
	| {
			ok: false;
			reasonCode: string;
	  };

export class WorkspaceRecoveryError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "WorkspaceRecoveryError";
		this.code = code;
	}
}

type RecoveryRow = typeof workspaceSessionRecoveries.$inferSelect;

export type WorkspaceRecoveryArchive = {
	create: (
		env: ArchiveBackupStore,
		db: Db,
		input: CreateArchiveInput,
	) => Promise<ArchiveRef>;
	restore: (
		env: ArchiveBackupStore,
		db: Db,
		input: RestoreArchiveInput,
	) => Promise<ArchiveRestoreResult>;
	abandon: (db: Db, archiveId: string, nowSeconds?: number) => Promise<void>;
};

type WithWorkspaceRuntimeLease = <T>(
	input: {
		db: Db;
		userId: string;
		projectId: string;
		sessionId: string;
		purpose: WorkspaceRuntimeLease["purpose"];
	},
	run: (lease: WorkspaceRuntimeLease) => Promise<T>,
) => Promise<T>;

export type WorkspaceRecoveryPreview = {
	interruptPreviewForCheckpoint: (input: {
		db: Db;
		projectId: string;
		sessionId: string;
		userId: string;
	}) => Promise<unknown>;
	maybeRestartPreviewAfterCheckpoint: (input: {
		db: Db;
		projectId: string;
		sessionId: string;
		userId: string;
	}) => Promise<unknown>;
};

export type WorkspaceRecoveryDeps = {
	createId?: () => string;
	now?: () => number;
	archive?: WorkspaceRecoveryArchive;
	withWorkspaceRuntimeLease?: WithWorkspaceRuntimeLease;
	preview?: WorkspaceRecoveryPreview;
};

const defaultArchive: WorkspaceRecoveryArchive = {
	create: createArchive,
	restore: restoreArchive,
	abandon: abandonArchive,
};

function mergeDeps(deps?: WorkspaceRecoveryDeps) {
	return {
		createId: deps?.createId ?? (() => nanoid()),
		now: deps?.now ?? (() => Date.now()),
		archive: deps?.archive ?? defaultArchive,
		withWorkspaceRuntimeLease: deps?.withWorkspaceRuntimeLease,
		preview: deps?.preview,
	};
}

function resolveWithLease(
	deps: ReturnType<typeof mergeDeps>,
): WithWorkspaceRuntimeLease {
	if (deps.withWorkspaceRuntimeLease) {
		return deps.withWorkspaceRuntimeLease;
	}
	throw new WorkspaceRecoveryError(
		"lease_required",
		"Workspace recovery requires an injected runtime lease.",
	);
}

function toRecoveryState(
	row: RecoveryRow,
	shouldCheckpoint: boolean,
): RecoveryState {
	return {
		state: row.state,
		reasonCode: row.reasonCode,
		mutationGeneration: row.mutationGeneration,
		durableGeneration: row.durableGeneration,
		pending: row.pendingGeneration != null,
		shouldCheckpoint,
	};
}

function redactedErrorMessage(error: unknown): string {
	if (error instanceof WorkspaceRecoveryError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message.replace(
			/(workspace_recovery|project_seed)\/[^\s"']+/gi,
			"[redacted-archive-ref]",
		);
	}
	return "Workspace recovery failed.";
}

function retryAtSeconds(nowMs: number, attempts: number): number {
	const delay = Math.min(60 * 60, 15 * 2 ** Math.min(attempts, 8));
	return Math.floor(nowMs / 1000) + delay;
}

function checkpointLeaseHeld(row: RecoveryRow, nowMs: number): boolean {
	if (!row.checkpointLeaseId || !row.checkpointLeaseExpiresAt) {
		return false;
	}
	return row.checkpointLeaseExpiresAt.getTime() > nowMs;
}

function requireBackupRestoreLease(
	lease: WorkspaceRuntimeLease,
): ArchiveSandbox {
	if (lease.purpose !== "backup_restore") {
		throw new WorkspaceRecoveryError(
			"lease_required",
			"Workspace recovery requires an exclusive backup_restore runtime lease.",
		);
	}
	if (!lease.sandbox) {
		throw new WorkspaceRecoveryError(
			"lease_required",
			"Workspace recovery requires a runtime sandbox adapter.",
		);
	}
	return lease.sandbox as ArchiveSandbox;
}

async function ensureRecoveryRow(
	db: Db,
	sessionId: string,
): Promise<RecoveryRow> {
	const [existing] = await db
		.select()
		.from(workspaceSessionRecoveries)
		.where(eq(workspaceSessionRecoveries.sessionId, sessionId))
		.limit(1);
	if (existing) {
		return existing;
	}
	try {
		const [inserted] = await db
			.insert(workspaceSessionRecoveries)
			.values({ sessionId })
			.returning();
		if (inserted) {
			return inserted;
		}
	} catch {
		// Primary-key race: another inserter won; fall through to select.
	}
	const [raced] = await db
		.select()
		.from(workspaceSessionRecoveries)
		.where(eq(workspaceSessionRecoveries.sessionId, sessionId))
		.limit(1);
	if (!raced) {
		throw new WorkspaceRecoveryError(
			"not_found",
			"Failed to initialize workspace recovery state.",
		);
	}
	return raced;
}

async function loadRecoveryRow(
	db: Db,
	sessionId: string,
): Promise<RecoveryRow | null> {
	const [row] = await db
		.select()
		.from(workspaceSessionRecoveries)
		.where(eq(workspaceSessionRecoveries.sessionId, sessionId))
		.limit(1);
	return row ?? null;
}

export async function getWorkspaceRecoveryState(
	db: Db,
	sessionId: string,
): Promise<RecoveryState | null> {
	const row = await loadRecoveryRow(db, sessionId);
	if (!row) {
		return null;
	}
	return toRecoveryState(row, false);
}

export async function recordMutation(
	options: {
		db: Db;
		sessionId: string;
	},
	injected?: WorkspaceRecoveryDeps,
): Promise<RecoveryState> {
	const deps = mergeDeps(injected);
	const nowMs = deps.now();
	const nowSeconds = Math.floor(nowMs / 1000);
	await ensureRecoveryRow(options.db, options.sessionId);

	// Single UPDATE so concurrent callers cannot set pendingGeneration backwards:
	// SQLite evaluates RHS against old column values, so both +1 expressions
	// yield the same new generation.
	const [updated] = await options.db
		.update(workspaceSessionRecoveries)
		.set({
			mutationGeneration: sql`${workspaceSessionRecoveries.mutationGeneration} + 1`,
			pendingGeneration: sql`${workspaceSessionRecoveries.mutationGeneration} + 1`,
			pendingSince: sql`COALESCE(${workspaceSessionRecoveries.pendingSince}, ${nowSeconds})`,
			state: "pending",
			reasonCode: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(workspaceSessionRecoveries.sessionId, options.sessionId))
		.returning();

	if (!updated) {
		throw new WorkspaceRecoveryError(
			"not_found",
			"Workspace recovery state not found.",
		);
	}

	const coalesced = checkpointLeaseHeld(updated, nowMs);
	return toRecoveryState(updated, !coalesced);
}

async function acquireCheckpointLease(
	db: Db,
	sessionId: string,
	leaseId: string,
	nowMs: number,
): Promise<RecoveryRow | null> {
	const expiresAt = new Date(
		nowMs + WORKSPACE_RECOVERY_CHECKPOINT_LEASE_TTL_MS,
	);
	const nowDate = new Date(nowMs);
	const [row] = await db
		.update(workspaceSessionRecoveries)
		.set({
			checkpointLeaseId: leaseId,
			checkpointLeaseExpiresAt: expiresAt,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessionRecoveries.sessionId, sessionId),
				or(
					isNull(workspaceSessionRecoveries.checkpointLeaseId),
					lte(workspaceSessionRecoveries.checkpointLeaseExpiresAt, nowDate),
				),
			),
		)
		.returning();
	return row ?? null;
}

async function releaseCheckpointLease(
	db: Db,
	sessionId: string,
	leaseId: string,
): Promise<void> {
	await db
		.update(workspaceSessionRecoveries)
		.set({
			checkpointLeaseId: null,
			checkpointLeaseExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessionRecoveries.sessionId, sessionId),
				eq(workspaceSessionRecoveries.checkpointLeaseId, leaseId),
			),
		);
}

async function markCheckpointFailure(
	db: Db,
	sessionId: string,
	reasonCode: string,
	nowMs: number,
): Promise<RecoveryRow> {
	const current = await ensureRecoveryRow(db, sessionId);
	const attempts = current.retryAttempts + 1;
	const [row] = await db
		.update(workspaceSessionRecoveries)
		.set({
			state: "degraded",
			reasonCode,
			retryAttempts: attempts,
			retryAt:
				attempts >= WORKSPACE_RECOVERY_CHECKPOINT_MAX_ATTEMPTS
					? null
					: retryAtSeconds(nowMs, attempts),
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(workspaceSessionRecoveries.sessionId, sessionId))
		.returning();
	return row ?? current;
}

async function promoteArchive(options: {
	db: Db;
	sessionId: string;
	archiveId: string;
	candidateGeneration: number;
	nowMs: number;
	abandon: typeof abandonArchive;
}): Promise<RecoveryRow | null> {
	const current = await ensureRecoveryRow(options.db, options.sessionId);
	if (current.durableGeneration >= options.candidateGeneration) {
		try {
			await options.abandon(
				options.db,
				options.archiveId,
				Math.floor(options.nowMs / 1000),
			);
		} catch {
			// Cleanup retry remains on the archive row if marked; ignore here.
		}
		return null;
	}

	const previousArchiveId = current.currentArchiveId;
	const dropArchiveId = current.previousArchiveId;
	const clearPending =
		current.pendingGeneration == null ||
		current.pendingGeneration <= options.candidateGeneration;

	const [promoted] = await options.db
		.update(workspaceSessionRecoveries)
		.set({
			previousArchiveId: previousArchiveId,
			currentArchiveId: options.archiveId,
			durableGeneration: options.candidateGeneration,
			...(clearPending
				? {
						pendingGeneration: null,
						pendingSince: null,
						state: "healthy" as const,
						reasonCode: null,
						retryAttempts: 0,
						retryAt: null,
					}
				: {
						state: "pending" as const,
					}),
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessionRecoveries.sessionId, options.sessionId),
				sql`${workspaceSessionRecoveries.durableGeneration} < ${options.candidateGeneration}`,
			),
		)
		.returning();

	if (!promoted) {
		try {
			await options.abandon(
				options.db,
				options.archiveId,
				Math.floor(options.nowMs / 1000),
			);
		} catch {
			// Best-effort; cleanup worker retries abandoned/deleting rows.
		}
		return null;
	}

	if (dropArchiveId) {
		try {
			await options.abandon(
				options.db,
				dropArchiveId,
				Math.floor(options.nowMs / 1000),
			);
		} catch {
			// Best-effort abandon of archives older than previous.
		}
	}

	return promoted;
}

async function checkpointOnce(options: {
	db: Db;
	env: ArchiveBackupStore;
	lease: WorkspaceRuntimeLease;
	userId: string;
	candidateGeneration: number;
	deps: ReturnType<typeof mergeDeps>;
}): Promise<RecoveryRow> {
	const sandbox = requireBackupRestoreLease(options.lease);
	const sandboxId = options.lease.identity?.sandboxId;
	if (!sandboxId) {
		throw new WorkspaceRecoveryError(
			"lease_required",
			"Workspace recovery checkpoint requires a dedicated session sandbox.",
		);
	}

	let archiveId: string | null = null;
	try {
		const archive = await options.deps.archive.create(options.env, options.db, {
			sandbox,
			sandboxId,
			ownerKind: "workspace_recovery",
			ownerId: options.lease.sessionId,
			userId: options.userId,
			generation: options.candidateGeneration,
		});
		archiveId = archive.id;
		const promoted = await promoteArchive({
			db: options.db,
			sessionId: options.lease.sessionId,
			archiveId: archive.id,
			candidateGeneration: options.candidateGeneration,
			nowMs: options.deps.now(),
			abandon: options.deps.archive.abandon,
		});
		if (promoted) {
			return promoted;
		}
		const current = await ensureRecoveryRow(
			options.db,
			options.lease.sessionId,
		);
		return current;
	} catch (error) {
		if (archiveId) {
			try {
				await options.deps.archive.abandon(
					options.db,
					archiveId,
					Math.floor(options.deps.now() / 1000),
				);
			} catch {
				// Ignore abandon failure on the create/promote error path.
			}
		}
		throw error;
	}
}

export async function checkpoint(
	options: {
		db: Db;
		env: ArchiveBackupStore;
		lease: WorkspaceRuntimeLease;
		userId: string;
	},
	injected?: WorkspaceRecoveryDeps,
): Promise<RecoveryState> {
	const deps = mergeDeps(injected);
	requireBackupRestoreLease(options.lease);
	const sessionId = options.lease.sessionId;
	const nowMs = deps.now();
	const leaseId = deps.createId();

	const acquired = await acquireCheckpointLease(
		options.db,
		sessionId,
		leaseId,
		nowMs,
	);
	if (!acquired) {
		const current = await ensureRecoveryRow(options.db, sessionId);
		return toRecoveryState(current, false);
	}

	try {
		let row = acquired;
		// Hold the checkpoint lease across coalesced pending generations.
		for (let i = 0; i < WORKSPACE_RECOVERY_CHECKPOINT_MAX_ATTEMPTS; i++) {
			const candidate = row.pendingGeneration;
			if (candidate == null || candidate <= row.durableGeneration) {
				if (row.state === "pending" && row.pendingGeneration == null) {
					const [healthy] = await options.db
						.update(workspaceSessionRecoveries)
						.set({
							state: "healthy",
							reasonCode: null,
							retryAttempts: 0,
							retryAt: null,
							updatedAt: sql`(unixepoch())`,
						})
						.where(eq(workspaceSessionRecoveries.sessionId, sessionId))
						.returning();
					return toRecoveryState(healthy ?? row, false);
				}
				return toRecoveryState(row, false);
			}

			try {
				row = await checkpointOnce({
					db: options.db,
					env: options.env,
					lease: options.lease,
					userId: options.userId,
					candidateGeneration: candidate,
					deps,
				});
			} catch (error) {
				const failed = await markCheckpointFailure(
					options.db,
					sessionId,
					"checkpoint_failed",
					deps.now(),
				);
				console.error(
					"Workspace recovery checkpoint failed.",
					redactedErrorMessage(error),
				);
				return toRecoveryState(failed, false);
			}

			if (
				row.pendingGeneration == null ||
				row.pendingGeneration <= row.durableGeneration
			) {
				return toRecoveryState(row, false);
			}
		}
		return toRecoveryState(row, false);
	} finally {
		await releaseCheckpointLease(options.db, sessionId, leaseId);
	}
}

export async function restore(
	options: {
		db: Db;
		env: ArchiveBackupStore;
		lease: WorkspaceRuntimeLease;
	},
	injected?: WorkspaceRecoveryDeps,
): Promise<RestoreOutcome> {
	const deps = mergeDeps(injected);
	const sandbox = requireBackupRestoreLease(options.lease);
	const sessionId = options.lease.sessionId;
	const sandboxId = options.lease.identity?.sandboxId;
	if (!sandboxId) {
		throw new WorkspaceRecoveryError(
			"lease_required",
			"Workspace recovery restore requires a dedicated session sandbox.",
		);
	}

	const row = await ensureRecoveryRow(options.db, sessionId);
	const currentId = row.currentArchiveId;
	const previousId = row.previousArchiveId;

	if (!currentId && !previousId) {
		throw new WorkspaceRecoveryError(
			"no_archives",
			"Workspace recovery has no archives to restore.",
		);
	}

	const tryRestore = async (archiveId: string) => {
		await deps.archive.restore(options.env, options.db, {
			sandbox,
			sandboxId,
			archiveId,
		});
	};

	if (currentId) {
		try {
			await tryRestore(currentId);
			if (row.state === "failed") {
				await options.db
					.update(workspaceSessionRecoveries)
					.set({
						state: "healthy",
						reasonCode: null,
						updatedAt: sql`(unixepoch())`,
					})
					.where(eq(workspaceSessionRecoveries.sessionId, sessionId));
			}
			return { ok: true, usedPrevious: false, reasonCode: null };
		} catch (error) {
			console.error(
				"Workspace recovery current archive restore failed.",
				redactedErrorMessage(error),
			);
		}
	}

	if (previousId && previousId !== currentId) {
		try {
			await tryRestore(previousId);
			await options.db
				.update(workspaceSessionRecoveries)
				.set({
					state: "healthy",
					reasonCode: "restored_previous",
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(workspaceSessionRecoveries.sessionId, sessionId));
			return {
				ok: true,
				usedPrevious: true,
				reasonCode: "restored_previous",
			};
		} catch (error) {
			console.error(
				"Workspace recovery previous archive restore failed.",
				redactedErrorMessage(error),
			);
		}
	}

	await options.db
		.update(workspaceSessionRecoveries)
		.set({
			state: "failed",
			reasonCode: "restore_failed",
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(workspaceSessionRecoveries.sessionId, sessionId));

	return { ok: false, reasonCode: "restore_failed" };
}

export async function requireDurable(db: Db, sessionId: string): Promise<void> {
	const row = await loadRecoveryRow(db, sessionId);
	if (!row) {
		return;
	}
	const blocked =
		row.pendingGeneration != null ||
		row.state === "pending" ||
		row.state === "degraded";
	if (blocked) {
		throw new WorkspaceRecoveryError(
			"not_durable",
			"Workspace recovery has uncheckpointed mutations.",
		);
	}
}

export async function hasRecoveryArchives(
	db: Db,
	sessionId: string,
): Promise<boolean> {
	const row = await loadRecoveryRow(db, sessionId);
	return Boolean(row?.currentArchiveId || row?.previousArchiveId);
}

/**
 * Reserve a mutation generation and checkpoint under a backup_restore lease.
 * Best-effort: returns degraded state on checkpoint failure without throwing.
 */
async function sessionPreviewIsLive(
	db: Db,
	sessionId: string,
): Promise<boolean> {
	const [session] = await db
		.select({ previewStartedAt: workspaceSessions.previewStartedAt })
		.from(workspaceSessions)
		.where(eq(workspaceSessions.id, sessionId))
		.limit(1);
	return session?.previewStartedAt != null;
}

/**
 * Reserve a mutation generation and checkpoint under a backup_restore lease.
 * Live previews defer the checkpoint until the first-pending timer fires.
 * Best-effort: returns degraded state on checkpoint failure without throwing.
 */
export async function recordMutationAndCheckpoint(
	options: {
		db: Db;
		env: ArchiveBackupStore;
		userId: string;
		projectId: string;
		sessionId: string;
	},
	injected?: WorkspaceRecoveryDeps,
): Promise<RecoveryState> {
	const deps = mergeDeps(injected);
	const recorded = await recordMutation(
		{ db: options.db, sessionId: options.sessionId },
		deps,
	);
	const previewLive = await sessionPreviewIsLive(options.db, options.sessionId);
	if (previewLive) {
		return recorded;
	}
	if (!recorded.shouldCheckpoint) {
		return recorded;
	}
	try {
		const withLease = resolveWithLease(deps);
		return await withLease(
			{
				db: options.db,
				userId: options.userId,
				projectId: options.projectId,
				sessionId: options.sessionId,
				purpose: "backup_restore",
			},
			async (lease) =>
				checkpoint(
					{
						db: options.db,
						env: options.env,
						lease,
						userId: options.userId,
					},
					deps,
				),
		);
	} catch (error) {
		const failed = await markCheckpointFailure(
			options.db,
			options.sessionId,
			"checkpoint_failed",
			deps.now(),
		);
		console.error(
			"Workspace recovery checkpoint failed.",
			redactedErrorMessage(error),
		);
		return toRecoveryState(failed, false);
	}
}

export async function enqueueDuePreviewCheckpoints(options: {
	db: Db;
	env: ArchiveBackupStore;
	nowMs: number;
}): Promise<number> {
	const dueBefore = new Date(
		options.nowMs - WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS,
	);
	const due = await options.db
		.select({
			sessionId: workspaceSessionRecoveries.sessionId,
		})
		.from(workspaceSessionRecoveries)
		.innerJoin(
			workspaceSessions,
			eq(workspaceSessions.id, workspaceSessionRecoveries.sessionId),
		)
		.where(
			and(
				eq(workspaceSessions.status, "active"),
				isNotNull(workspaceSessions.previewStartedAt),
				isNotNull(workspaceSessionRecoveries.pendingGeneration),
				lte(workspaceSessionRecoveries.pendingSince, dueBefore),
			),
		);
	for (const row of due) {
		const [session] = await options.db
			.select()
			.from(workspaceSessions)
			.where(eq(workspaceSessions.id, row.sessionId))
			.limit(1);
		if (!session) {
			continue;
		}
		await persistWorkspaceWork({
			db: options.db,
			intent: {
				kind: "recovery_retry",
				projectId: session.projectId,
				userId: session.userId,
				sessionId: session.id,
			},
			nowMs: options.nowMs,
		});
	}
	return due.length;
}

export async function forcePreviewCheckpoint(
	options: {
		db: Db;
		env: ArchiveBackupStore;
		userId: string;
		projectId: string;
		sessionId: string;
	},
	injected?: WorkspaceRecoveryDeps,
): Promise<RecoveryState> {
	const deps = mergeDeps(injected);
	if (!deps.preview) {
		throw new WorkspaceRecoveryError(
			"preview_required",
			"Forced preview checkpoints require injected preview operations.",
		);
	}
	const preview = deps.preview;
	await preview.interruptPreviewForCheckpoint({
		db: options.db,
		projectId: options.projectId,
		sessionId: options.sessionId,
		userId: options.userId,
	});
	try {
		const withLease = resolveWithLease(deps);
		const result = await withLease(
			{
				db: options.db,
				userId: options.userId,
				projectId: options.projectId,
				sessionId: options.sessionId,
				purpose: "backup_restore",
			},
			async (lease) =>
				checkpoint(
					{
						db: options.db,
						env: options.env,
						lease,
						userId: options.userId,
					},
					deps,
				),
		);
		if (result.state === "degraded" || result.state === "failed") {
			return result;
		}
		await preview.maybeRestartPreviewAfterCheckpoint({
			db: options.db,
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
		});
		return result;
	} catch (error) {
		const failed = await markCheckpointFailure(
			options.db,
			options.sessionId,
			"checkpoint_failed",
			deps.now(),
		);
		console.error(
			"Workspace recovery forced checkpoint failed.",
			redactedErrorMessage(error),
		);
		return toRecoveryState(failed, false);
	}
}

export type WorkspaceRecovery = {
	recordMutation: typeof recordMutation;
	checkpoint: typeof checkpoint;
	restore: typeof restore;
	requireDurable: typeof requireDurable;
};

export const workspaceRecovery: WorkspaceRecovery = {
	recordMutation,
	checkpoint,
	restore,
	requireDurable,
};
