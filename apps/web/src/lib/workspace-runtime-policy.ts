/**
 * Shared workspace runtime policy. Dependency types and this module must not
 * require product Env, secret keys, or product adapters.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";

import { assertRuntimeOwner } from "#/lib/session-runtime-ownership";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import { acquireCapacitySlot } from "#/lib/workspace-runtime-capacity";
import { WorkspaceRuntimeError } from "#/lib/workspace-runtime-error";
import { loadOwnedActiveSession } from "#/lib/workspace-session";

type Db = ReturnType<typeof createDb>;
type ProjectRow = typeof projects.$inferSelect;
type SessionRow = typeof workspaceSessions.$inferSelect;

export const WORKSPACE_RUNTIME_LEASE_TTL_MS = 20 * 60 * 1000;

export type WorkspaceSandboxNamespace = {
	Sandbox: {
		idFromName: (name: string) => { toString(): string };
	};
};

export function containerIdForSandbox(
	env: WorkspaceSandboxNamespace,
	sandboxId: string,
): string {
	return env.Sandbox.idFromName(sandboxId).toString();
}

export type DecryptProjectValues = (
	encrypted: string | null,
) => Promise<readonly SandboxEnvVar[]>;

export type WorkspaceRuntimePurpose =
	| "agent_run"
	| "agent_control"
	| "local_git_read"
	| "mutating_git"
	| "git_metadata"
	| "preview"
	| "backup_restore";

export type WorkspaceRuntimeLockMode = "acquire" | "assumeHeld" | "none";

export type WorkspaceRuntimeObservationState =
	| "connected"
	| "needs_restore"
	| "restored_from_backup"
	| "recreated_from_github"
	| "provisioning"
	| "failed";

export type SandboxEnvVar = { key: string; value: string };

export type SandboxIdentityHandle = {
	id: string;
	kind: string;
	sandboxId: string;
	containerId: string;
	userId: string;
	projectId: string;
	workspaceSessionId: string | null;
	lifecycleGeneration: number;
	state: string;
	retiredAt: Date | null;
	controllerClass?: string | null;
	controllerNamespace?: string | null;
	incarnationId?: string | null;
};

export type WorkspaceRuntimeSandbox = {
	exec: (
		command: string,
		options?: {
			cwd?: string;
			timeout?: number;
			env?: Record<string, string>;
		},
	) => Promise<{
		success: boolean;
		stdout: string;
		stderr: string;
		exitCode: number;
	}>;
	exists: (path: string) => Promise<{ exists: boolean }>;
};

export type WorkspaceRuntimeLease = {
	sessionId: string;
	purpose: WorkspaceRuntimePurpose;
	workspacePath: string;
	branchName: string;
	baseCommitSha: string;
	sandbox: WorkspaceRuntimeSandbox;
	identity: SandboxIdentityHandle | null;
	projectEnv: readonly SandboxEnvVar[] | null;
	matchesSandboxClaim: (sandboxId: string) => boolean;
};

export type PreparedWorkspaceRuntime = {
	sandboxId: string;
	workspacePath: string;
	branchName: string;
	baseCommitSha: string;
	sandbox: WorkspaceRuntimeSandbox;
	identity: SandboxIdentityHandle | null;
};

export type OpenWorkspaceRuntimePolicyInput<TAuthority = unknown> = {
	db: Db;
	userId: string;
	projectId: string;
	sessionId: string;
	purpose: WorkspaceRuntimePurpose;
	lock?: WorkspaceRuntimeLockMode;
	ensureReady?: boolean;
	authority: TAuthority;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
};

export type WorkspaceRuntimePolicyDeps<T, TAuthority = unknown> = {
	prepareRuntime: (input: {
		db: Db;
		project: ProjectRow;
		session: SessionRow;
		authority: TAuthority;
		ensureReady: boolean;
		sleep: (ms: number) => Promise<void>;
	}) => Promise<PreparedWorkspaceRuntime>;
	decryptProjectValues: DecryptProjectValues;
	withLock?: (input: {
		sandbox: WorkspaceRuntimeSandbox;
		sessionId: string;
		run: () => Promise<T>;
	}) => Promise<T>;
};

export function defaultLockMode(
	purpose: WorkspaceRuntimePurpose,
	lock?: WorkspaceRuntimeLockMode,
): WorkspaceRuntimeLockMode {
	if (lock) {
		return lock;
	}
	if (
		purpose === "agent_run" ||
		purpose === "mutating_git" ||
		purpose === "backup_restore"
	) {
		return "acquire";
	}
	return "none";
}

export async function loadOwnedProject(
	db: Db,
	projectId: string,
	userId: string,
): Promise<ProjectRow | null> {
	const [project] = await db
		.select()
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
		.limit(1);
	return project ?? null;
}

export async function acquireLifecycleLease(options: {
	db: Db;
	session: SessionRow;
	now: Date;
}): Promise<{ leaseId: string; expiresAt: Date }> {
	const leaseId = nanoid();
	const expiresAt = new Date(
		options.now.getTime() + WORKSPACE_RUNTIME_LEASE_TTL_MS,
	);
	const [row] = await options.db
		.update(workspaceSessions)
		.set({
			runtimeLeaseId: leaseId,
			runtimeLeaseExpiresAt: expiresAt,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.session.id),
				eq(workspaceSessions.projectId, options.session.projectId),
				eq(workspaceSessions.userId, options.session.userId),
				eq(workspaceSessions.status, "active"),
				eq(workspaceSessions.runtimeOwner, "legacy"),
				eq(
					workspaceSessions.runtimeOwnerVersion,
					options.session.runtimeOwnerVersion,
				),
				or(
					isNull(workspaceSessions.runtimeLeaseId),
					lte(workspaceSessions.runtimeLeaseExpiresAt, options.now),
				),
				sql`exists (
					select 1 from ${projects}
					where ${projects.id} = ${options.session.projectId}
						and ${projects.userId} = ${options.session.userId}
						and ${projects.status} = ${"ready"}
				)`,
			),
		)
		.returning({ id: workspaceSessions.id });
	if (!row) {
		throw new SessionWorkspaceBusyError();
	}
	return { leaseId, expiresAt };
}

export async function releaseLifecycleLease(options: {
	db: Db;
	sessionId: string;
	leaseId: string;
}): Promise<void> {
	await options.db
		.update(workspaceSessions)
		.set({
			runtimeLeaseId: null,
			runtimeLeaseExpiresAt: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.sessionId),
				eq(workspaceSessions.runtimeLeaseId, options.leaseId),
			),
		);
}

export function buildLease(options: {
	sessionId: string;
	purpose: WorkspaceRuntimePurpose;
	prepared: PreparedWorkspaceRuntime;
	projectEnv: readonly SandboxEnvVar[] | null;
}): WorkspaceRuntimeLease {
	const sandboxId = options.prepared.sandboxId;
	return {
		sessionId: options.sessionId,
		purpose: options.purpose,
		workspacePath: options.prepared.workspacePath,
		branchName: options.prepared.branchName,
		baseCommitSha: options.prepared.baseCommitSha,
		sandbox: options.prepared.sandbox,
		identity: options.prepared.identity,
		projectEnv: options.projectEnv,
		matchesSandboxClaim: (claimed) => claimed === sandboxId,
	};
}

export async function withWorkspaceRuntimePolicyLease<T, TAuthority = unknown>(
	input: OpenWorkspaceRuntimePolicyInput<TAuthority>,
	deps: WorkspaceRuntimePolicyDeps<T, TAuthority>,
	run: (lease: WorkspaceRuntimeLease) => Promise<T>,
): Promise<T> {
	const session = await loadOwnedActiveSession({
		db: input.db,
		projectId: input.projectId,
		sessionId: input.sessionId,
		userId: input.userId,
	});
	if (!session) {
		throw new WorkspaceRuntimeError("not_found", "Session not found.");
	}
	assertRuntimeOwner({
		session,
		expectedOwner: "legacy",
		ownerVersion: session.runtimeOwnerVersion,
	});

	const project = await loadOwnedProject(
		input.db,
		input.projectId,
		input.userId,
	);
	if (!project) {
		throw new WorkspaceRuntimeError("not_found", "Project not found.");
	}
	if (project.status !== "ready") {
		throw new WorkspaceRuntimeError("not_ready", "Project is not ready.");
	}

	const nowMs = input.now?.() ?? Date.now();
	const now = new Date(nowMs);
	const { leaseId } = await acquireLifecycleLease({
		db: input.db,
		session,
		now,
	});
	const authority = input.authority;
	const sleep =
		input.sleep ??
		((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
	const ensureReady = input.ensureReady !== false;
	const lockMode = defaultLockMode(input.purpose, input.lock);
	try {
		const slot = await acquireCapacitySlot({
			db: input.db,
			sessionId: session.id,
			userId: input.userId,
			identityId: session.sandboxIdentityId,
			nowMs,
		});
		if (!slot) {
			throw new WorkspaceRuntimeError(
				"capacity_unavailable",
				"Workspace capacity is unavailable.",
			);
		}

		const prepared = await deps.prepareRuntime({
			db: input.db,
			project,
			session,
			authority,
			ensureReady,
			sleep,
		});

		let projectEnv: readonly SandboxEnvVar[] | null = null;
		if (input.purpose === "agent_run") {
			projectEnv = await deps.decryptProjectValues(project.envVars);
		}

		const lease = buildLease({
			sessionId: session.id,
			purpose: input.purpose,
			prepared,
			projectEnv,
		});

		const invoke = () => run(lease);
		if (lockMode === "acquire") {
			if (!deps.withLock) {
				throw new WorkspaceRuntimeError(
					"lock_required",
					"Mutating workspace runtime work requires a lock adapter.",
				);
			}
			return await deps.withLock({
				sandbox: prepared.sandbox,
				sessionId: session.id,
				run: invoke,
			});
		}
		return await invoke();
	} finally {
		await releaseLifecycleLease({
			db: input.db,
			sessionId: session.id,
			leaseId,
		});
	}
}
