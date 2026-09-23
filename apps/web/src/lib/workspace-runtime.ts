import { and, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	projectSeeds,
	type projects,
	sandboxIdentities,
	workspaceSessionRecoveries,
	workspaceSessions,
} from "#/db/schema";
import { GIT_FETCH_CONTRACT_VERSION } from "#/lib/git-fetch-contract";
import { getGitHubApp } from "#/lib/github-app";
import { fetchGitHubBranchBrokered } from "#/lib/privileged-git";
import { decryptEnvVars } from "#/lib/project-env-vars";
import { type ArchiveSandbox, restoreArchive } from "#/lib/sandbox-archive";
import {
	createSandboxAuthority,
	type SandboxAuthority,
	SandboxAuthorityError,
	type SandboxIdentityHandle,
} from "#/lib/sandbox-authority";
import {
	configureDittoGitIdentity,
	getProjectSandbox,
	getProjectSandboxState,
	type SandboxEnvVar,
} from "#/lib/sandbox-bootstrap";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import { sessionBranchName, WORKSPACE_PATH } from "#/lib/workspace-policy";
import {
	hasRecoveryArchives,
	restore as restoreWorkspaceRecovery,
} from "#/lib/workspace-recovery";
import {
	cancelProjectWork,
	cancelWorkspaceWorkRow,
	completeWork,
	drainWorkspaceRuntimeQueue,
	failWork,
	hasUnexpiredCapacitySlot,
	loadQueuedWorkForSession,
	loadWorkspaceWork,
	parseWorkspaceWorkPayload,
	persistWorkspaceWork,
	releaseCapacitySlot,
	settleAssistantFailed,
	submitPersistedWork,
	WORKSPACE_AGENT_COMMAND_RESERVE_MS,
	WORKSPACE_CAPACITY_GLOBAL_LIMIT,
	WORKSPACE_CAPACITY_PER_USER_LIMIT,
	WORKSPACE_CRON_INVOCATION_LIMIT_MS,
	WORKSPACE_DRAIN_CRON,
	WORKSPACE_IDLE_TIMEOUT_MS,
	WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS,
	WORKSPACE_QUEUE_TTL_MS,
	type WorkspaceRuntimeWaitUntil,
	type WorkspaceWorkIntent,
	type WorkspaceWorkReceipt,
	type WorkspaceWorkRow,
} from "#/lib/workspace-runtime-capacity";
import { WorkspaceRuntimeError } from "#/lib/workspace-runtime-error";
import {
	containerIdForSandbox,
	loadOwnedProject,
	type PreparedWorkspaceRuntime,
	WORKSPACE_RUNTIME_LEASE_TTL_MS,
	type WorkspaceRuntimeLockMode,
	type WorkspaceRuntimeObservationState,
	type WorkspaceRuntimePurpose,
	type WorkspaceSandboxNamespace,
	withWorkspaceRuntimePolicyLease,
} from "#/lib/workspace-runtime-policy";
import { loadOwnedActiveSession } from "#/lib/workspace-session";

export const WORKSPACE_SESSION_FETCH_OPERATION_TYPE = "workspace_session_fetch";
export const WORKSPACE_SESSION_FETCH_OPERATION_TTL_MS = 15 * 60 * 1000;
export { WORKSPACE_RUNTIME_LEASE_TTL_MS };
export const WORKSPACE_RUNTIME_PATH = WORKSPACE_PATH;
export type {
	WorkspaceRuntimeLockMode,
	WorkspaceRuntimeObservationState,
	WorkspaceRuntimePurpose,
	WorkspaceSandboxNamespace as WorkspaceSandboxEnv,
};
export type WorkspaceRuntimeSandbox = ReturnType<typeof getProjectSandbox>;
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
export {
	WORKSPACE_AGENT_COMMAND_RESERVE_MS,
	WORKSPACE_CAPACITY_GLOBAL_LIMIT,
	WORKSPACE_CAPACITY_PER_USER_LIMIT,
	WORKSPACE_CRON_INVOCATION_LIMIT_MS,
	WORKSPACE_DRAIN_CRON,
	WORKSPACE_IDLE_TIMEOUT_MS,
	WORKSPACE_PREVIEW_CHECKPOINT_DEFERRAL_MS,
	WORKSPACE_QUEUE_TTL_MS,
};
export { WorkspaceRuntimeError } from "#/lib/workspace-runtime-error";
export type {
	WorkspaceRuntimeWaitUntil,
	WorkspaceWorkIntent,
	WorkspaceWorkReceipt,
};

const INACTIVE_SANDBOX_STATUSES = new Set([
	"stopping",
	"stopped",
	"stopped_with_code",
]);

const RUNNER_CLI_PATH = "/opt/ditto-runner/dist/cli.js";
const RUNNER_PACKAGE_PATH = "/opt/ditto-runner/package.json";
const GIT_COMMAND_TIMEOUT_MS = 120_000;
const RUNNER_HEALTH_TIMEOUT_MS = 10_000;
const TRANSIENT_RETRY_DELAYS_MS = [100, 200] as const;

type Db = ReturnType<typeof createDb>;
type ProjectRow = typeof projects.$inferSelect;
type SessionRow = typeof workspaceSessions.$inferSelect;

export type OpenWorkspaceRuntimeInput = {
	env: Env;
	db: Db;
	userId: string;
	projectId: string;
	sessionId: string;
	purpose: WorkspaceRuntimePurpose;
	lock?: WorkspaceRuntimeLockMode;
	/** When false, do not provision or repair a missing runtime. */
	ensureReady?: boolean;
	authority?: SandboxAuthority;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
};

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isNonRetryable(error: unknown): boolean {
	if (error instanceof SessionWorkspaceBusyError) {
		return true;
	}
	const code =
		error instanceof WorkspaceRuntimeError
			? error.code
			: error instanceof SandboxAuthorityError
				? error.code
				: error instanceof Error && "code" in error
					? String((error as { code: unknown }).code)
					: null;
	if (!code) {
		const message = error instanceof Error ? error.message : String(error);
		return /digest|checksum|contract/i.test(message);
	}
	return (
		code.startsWith("identity_") ||
		code.includes("digest") ||
		code.includes("contract") ||
		code === "generation_mismatch" ||
		code === "container_mismatch" ||
		code === "seed_unavailable" ||
		code === "archive_incompatible" ||
		code === "recovery_restore_failed" ||
		code === "not_found" ||
		code === "not_ready" ||
		code === "invalid_repository" ||
		code === "default_branch_missing"
	);
}

async function setIdentityState(
	db: Db,
	identityId: string,
	state: SandboxIdentityHandle["state"],
): Promise<void> {
	await db
		.update(sandboxIdentities)
		.set({
			state,
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(sandboxIdentities.id, identityId));
}

async function persistFailure(
	db: Db,
	sessionId: string,
	identityId: string | null,
	code: string,
): Promise<void> {
	await db
		.update(workspaceSessions)
		.set({
			runtimeFailureReasonCode: code,
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(workspaceSessions.id, sessionId));
	if (identityId) {
		await setIdentityState(db, identityId, "failed");
	}
}

async function resolveDefaultBranch(options: {
	env: Env;
	installationId: number;
	githubRepo: string;
}): Promise<{ branchName: string; headRef: string }> {
	const [owner, repo] = options.githubRepo.split("/");
	if (!owner || !repo) {
		throw new WorkspaceRuntimeError(
			"invalid_repository",
			"Invalid GitHub repository slug.",
		);
	}
	const app = getGitHubApp(options.env);
	const octokit = await app.getInstallationOctokit(options.installationId);
	const { data } = await octokit.rest.repos.get({ owner, repo });
	const branchName = data.default_branch;
	if (!branchName || typeof branchName !== "string") {
		throw new WorkspaceRuntimeError(
			"default_branch_missing",
			"Repository default branch is missing.",
		);
	}
	return {
		branchName,
		headRef: `refs/heads/${branchName}`,
	};
}

async function assertGitAndRunner(
	sandbox: WorkspaceRuntimeSandbox,
): Promise<void> {
	const gitDir = await sandbox.exists(`${WORKSPACE_PATH}/.git`);
	if (!gitDir.exists) {
		throw new WorkspaceRuntimeError(
			"git_state_missing",
			"Session workspace is missing Git state.",
		);
	}
	const runner = await sandbox.exec(
		`test -f ${quoteShellArg(RUNNER_CLI_PATH)} && node -e ${quoteShellArg(
			`JSON.parse(require("node:fs").readFileSync(${JSON.stringify(RUNNER_PACKAGE_PATH)}, "utf8"))`,
		)}`,
		{ cwd: "/", timeout: RUNNER_HEALTH_TIMEOUT_MS },
	);
	if (!runner.success) {
		throw new WorkspaceRuntimeError(
			"runner_missing",
			"Session sandbox is missing the baked runner.",
		);
	}
}

async function createSessionBranch(
	sandbox: WorkspaceRuntimeSandbox,
	branchName: string,
): Promise<void> {
	const quotedBranch = quoteShellArg(branchName);
	await sandbox.exec(
		`git show-ref --verify --quiet refs/heads/${quotedBranch} || git branch ${quotedBranch} HEAD`,
		{ cwd: WORKSPACE_PATH, timeout: GIT_COMMAND_TIMEOUT_MS },
	);
	const checkout = await sandbox.exec(`git checkout --force ${quotedBranch}`, {
		cwd: WORKSPACE_PATH,
		timeout: GIT_COMMAND_TIMEOUT_MS,
	});
	if (!checkout.success) {
		throw new WorkspaceRuntimeError(
			"branch_checkout_failed",
			"Failed to check out the session branch.",
		);
	}
}

async function loadReadySeed(
	db: Db,
	projectId: string,
): Promise<{
	archiveId: string;
}> {
	const [seed] = await db
		.select()
		.from(projectSeeds)
		.where(eq(projectSeeds.projectId, projectId))
		.limit(1);
	if (!seed || seed.buildState !== "ready" || !seed.archiveId) {
		throw new WorkspaceRuntimeError(
			"seed_unavailable",
			"Project seed is not ready.",
		);
	}
	return { archiveId: seed.archiveId };
}

async function bindSessionRuntimeFields(options: {
	db: Db;
	session: SessionRow;
	identityId: string;
	branchName: string;
	baseCommitSha: string;
}): Promise<{ baseCommitSha: string; branchName: string }> {
	const frozen =
		(options.session.baseCommitSha ?? "").trim().length > 0
			? (options.session.baseCommitSha as string)
			: options.baseCommitSha;
	const [row] = await options.db
		.update(workspaceSessions)
		.set({
			sandboxIdentityId: options.identityId,
			branchName: options.branchName,
			baseCommitSha: frozen,
			runtimeFailureReasonCode: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.session.id),
				eq(workspaceSessions.status, "active"),
				eq(workspaceSessions.runtimeOwner, "legacy"),
				eq(
					workspaceSessions.runtimeOwnerVersion,
					options.session.runtimeOwnerVersion,
				),
				// Freeze only when unset; concurrent provision must not move it.
				or(
					isNull(workspaceSessions.baseCommitSha),
					eq(workspaceSessions.baseCommitSha, frozen),
					eq(workspaceSessions.baseCommitSha, ""),
				),
			),
		)
		.returning({
			baseCommitSha: workspaceSessions.baseCommitSha,
			branchName: workspaceSessions.branchName,
		});
	if (row?.baseCommitSha) {
		return {
			baseCommitSha: row.baseCommitSha,
			branchName: row.branchName ?? options.branchName,
		};
	}
	const [existing] = await options.db
		.select({
			baseCommitSha: workspaceSessions.baseCommitSha,
			branchName: workspaceSessions.branchName,
		})
		.from(workspaceSessions)
		.where(eq(workspaceSessions.id, options.session.id))
		.limit(1);
	return {
		baseCommitSha: existing?.baseCommitSha || frozen,
		branchName: existing?.branchName ?? options.branchName,
	};
}

type PreparedRuntime = PreparedWorkspaceRuntime;

async function provisionDedicatedSession(options: {
	env: Env;
	db: Db;
	project: ProjectRow;
	session: SessionRow;
	authority: SandboxAuthority;
	existingIdentity: SandboxIdentityHandle | null;
}): Promise<PreparedRuntime> {
	if (
		!options.project.githubRepo ||
		options.project.githubInstallationId == null
	) {
		throw new WorkspaceRuntimeError(
			"not_ready",
			"Project is not linked to a GitHub repository.",
		);
	}

	const recoverFromArchives = await hasRecoveryArchives(
		options.db,
		options.session.id,
	);
	const seedArchiveId = recoverFromArchives
		? null
		: (await loadReadySeed(options.db, options.project.id)).archiveId;
	const { branchName: defaultBranch, headRef } = await resolveDefaultBranch({
		env: options.env,
		installationId: options.project.githubInstallationId,
		githubRepo: options.project.githubRepo,
	});

	let identity = options.existingIdentity;
	if (
		!identity ||
		identity.retiredAt != null ||
		identity.state === "destroyed"
	) {
		const sandboxId = crypto.randomUUID().toLowerCase();
		const containerId = containerIdForSandbox(options.env, sandboxId);
		identity = await options.authority.registerIdentity({
			kind: "workspace_session",
			sandboxId,
			containerId,
			userId: options.session.userId,
			projectId: options.project.id,
			workspaceSessionId: options.session.id,
			state: "unprovisioned",
		});
		await options.db
			.update(workspaceSessions)
			.set({
				sandboxIdentityId: identity.id,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(workspaceSessions.id, options.session.id));
	}

	await setIdentityState(options.db, identity.id, "queued");
	await setIdentityState(options.db, identity.id, "provisioning");

	const sandbox = getProjectSandbox(options.env, identity.sandboxId);
	try {
		await setIdentityState(options.db, identity.id, "restoring");
		await options.authority.rotateGeneration(identity.id);
		const rotated = await options.authority.getIdentity(identity.id);
		if (!rotated) {
			throw new WorkspaceRuntimeError(
				"identity_not_found",
				"Sandbox identity not found after generation rotate.",
			);
		}
		identity = rotated;

		await sandbox.setOutboundHandler("dittoCatchAll", {
			identityId: identity.id,
			lifecycleGeneration: identity.lifecycleGeneration,
		});

		if (recoverFromArchives) {
			const sandboxId = identity.sandboxId;
			const recoveryLease: WorkspaceRuntimeLease = {
				sessionId: options.session.id,
				purpose: "backup_restore",
				workspacePath: WORKSPACE_PATH,
				branchName:
					options.session.branchName ?? sessionBranchName(options.session.id),
				baseCommitSha: options.session.baseCommitSha ?? "",
				sandbox,
				identity,
				projectEnv: null,
				matchesSandboxClaim: (claimed) => claimed === sandboxId,
			};
			const restored = await restoreWorkspaceRecovery({
				db: options.db,
				env: options.env,
				lease: recoveryLease,
			});
			if (!restored.ok) {
				throw new WorkspaceRuntimeError(
					"recovery_restore_failed",
					"Workspace recovery restore failed for both archives.",
				);
			}
			await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);
			await assertGitAndRunner(sandbox);
			const sessionBranch =
				options.session.branchName ?? sessionBranchName(options.session.id);
			const bound = await bindSessionRuntimeFields({
				db: options.db,
				session: options.session,
				identityId: identity.id,
				branchName: sessionBranch,
				baseCommitSha: options.session.baseCommitSha ?? "",
			});
			await setIdentityState(options.db, identity.id, "ready");
			return {
				sandbox,
				sandboxId: identity.sandboxId,
				identity,
				workspacePath: WORKSPACE_PATH,
				branchName: bound.branchName,
				baseCommitSha: bound.baseCommitSha,
			};
		}

		await restoreArchive(options.env, options.db, {
			sandbox: sandbox as ArchiveSandbox,
			sandboxId: identity.sandboxId,
			archiveId: seedArchiveId as string,
		});

		const fetched = await options.authority.withOperation(
			{
				identityId: identity.id,
				family: "git_transport",
				type: WORKSPACE_SESSION_FETCH_OPERATION_TYPE,
				contractVersion: GIT_FETCH_CONTRACT_VERSION,
				repository: options.project.githubRepo,
				allowedRefs: [headRef],
				expiresAt: new Date(
					Date.now() + WORKSPACE_SESSION_FETCH_OPERATION_TTL_MS,
				),
			},
			async () =>
				fetchGitHubBranchBrokered({
					sandbox,
					githubRepo: options.project.githubRepo as string,
					branchName: defaultBranch,
					destinationCwd: WORKSPACE_PATH,
				}),
		);

		await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);
		const sessionBranch = sessionBranchName(options.session.id);
		await createSessionBranch(sandbox, sessionBranch);
		await assertGitAndRunner(sandbox);

		const bound = await bindSessionRuntimeFields({
			db: options.db,
			session: options.session,
			identityId: identity.id,
			branchName: sessionBranch,
			baseCommitSha: fetched.headSha,
		});
		await setIdentityState(options.db, identity.id, "ready");

		return {
			sandbox,
			sandboxId: identity.sandboxId,
			identity,
			workspacePath: WORKSPACE_PATH,
			branchName: bound.branchName,
			baseCommitSha: bound.baseCommitSha,
		};
	} catch (error) {
		const code =
			error instanceof WorkspaceRuntimeError
				? error.code
				: error instanceof SandboxAuthorityError
					? error.code
					: error instanceof Error && "code" in error
						? String((error as { code: unknown }).code)
						: "provision_failed";
		await persistFailure(options.db, options.session.id, identity.id, code);
		throw error;
	}
}

async function loadExistingIdentity(
	authority: SandboxAuthority,
	session: SessionRow,
): Promise<SandboxIdentityHandle | null> {
	if (!session.sandboxIdentityId) {
		return null;
	}
	return authority.getIdentity(session.sandboxIdentityId);
}

async function serveDedicatedReady(options: {
	env: Env;
	session: SessionRow;
	identity: SandboxIdentityHandle;
}): Promise<PreparedRuntime> {
	const sandbox = getProjectSandbox(options.env, options.identity.sandboxId);
	await sandbox.setOutboundHandler("dittoCatchAll", {
		identityId: options.identity.id,
		lifecycleGeneration: options.identity.lifecycleGeneration,
	});
	return {
		sandbox,
		sandboxId: options.identity.sandboxId,
		identity: options.identity,
		workspacePath: WORKSPACE_PATH,
		branchName:
			options.session.branchName ?? sessionBranchName(options.session.id),
		baseCommitSha: options.session.baseCommitSha ?? "",
	};
}

async function prepareRuntimeOnce(options: {
	env: Env;
	db: Db;
	project: ProjectRow;
	session: SessionRow;
	authority: SandboxAuthority;
	ensureReady: boolean;
}): Promise<PreparedRuntime> {
	const existing = await loadExistingIdentity(
		options.authority,
		options.session,
	);
	if (existing && existing.state === "ready" && existing.retiredAt == null) {
		let liveStatus: string | null = null;
		try {
			const live = await getProjectSandboxState(
				options.env,
				existing.sandboxId,
			);
			liveStatus = live.status;
		} catch {
			liveStatus = "stopped";
		}
		if (!liveStatus || !INACTIVE_SANDBOX_STATUSES.has(liveStatus)) {
			return serveDedicatedReady({
				env: options.env,
				session: options.session,
				identity: existing,
			});
		}
	}
	if (!options.ensureReady) {
		throw new WorkspaceRuntimeError(
			"not_ready",
			"Workspace session runtime is not ready.",
		);
	}
	return provisionDedicatedSession({
		env: options.env,
		db: options.db,
		project: options.project,
		session: options.session,
		authority: options.authority,
		existingIdentity: existing,
	});
}

async function prepareRuntimeWithRetry(options: {
	env: Env;
	db: Db;
	project: ProjectRow;
	session: SessionRow;
	authority: SandboxAuthority;
	ensureReady: boolean;
	sleep: (ms: number) => Promise<void>;
}): Promise<PreparedRuntime> {
	let lastError: unknown;
	for (
		let attempt = 0;
		attempt < TRANSIENT_RETRY_DELAYS_MS.length + 1;
		attempt++
	) {
		try {
			return await prepareRuntimeOnce(options);
		} catch (error) {
			lastError = error;
			if (
				isNonRetryable(error) ||
				attempt === TRANSIENT_RETRY_DELAYS_MS.length
			) {
				throw error;
			}
			await options.sleep(TRANSIENT_RETRY_DELAYS_MS[attempt] ?? 200);
		}
	}
	throw lastError;
}

function mapIdentityState(
	state: SandboxIdentityHandle["state"],
): WorkspaceRuntimeObservationState {
	if (state === "ready") {
		return "connected";
	}
	if (
		state === "unprovisioned" ||
		state === "queued" ||
		state === "provisioning" ||
		state === "restoring"
	) {
		return "provisioning";
	}
	return "failed";
}

/**
 * Observe session (or project) runtime without provisioning. Session-scoped
 * when `sessionId` is present; otherwise seed-ready projects report connected.
 */
export async function observeWorkspaceRuntime(options: {
	env: Env;
	db: Db;
	userId: string;
	projectId: string;
	sessionId?: string;
	authority?: SandboxAuthority;
}): Promise<{
	project: ProjectRow;
	state: WorkspaceRuntimeObservationState;
}> {
	const project = await loadOwnedProject(
		options.db,
		options.projectId,
		options.userId,
	);
	if (!project) {
		throw new WorkspaceRuntimeError("not_found", "Project not found.");
	}
	if (project.status === "provisioning") {
		return { project, state: "provisioning" };
	}
	if (project.status === "failed") {
		return { project, state: "failed" };
	}

	if (options.sessionId) {
		const session = await loadOwnedActiveSession({
			db: options.db,
			projectId: options.projectId,
			sessionId: options.sessionId,
			userId: options.userId,
		});
		if (session?.sandboxIdentityId) {
			const authority = options.authority ?? createSandboxAuthority(options.db);
			const identity = await authority.getIdentity(session.sandboxIdentityId);
			if (identity && identity.retiredAt == null) {
				if (identity.state === "ready") {
					try {
						const live = await getProjectSandboxState(
							options.env,
							identity.sandboxId,
						);
						if (INACTIVE_SANDBOX_STATUSES.has(live.status)) {
							if (session.runtimeOwner === "legacy") {
								await releaseCapacitySlot({
									db: options.db,
									sessionId: session.id,
									nowMs: Date.now(),
								});
							}
							return { project, state: "needs_restore" };
						}
					} catch {
						if (session.runtimeOwner === "legacy") {
							await releaseCapacitySlot({
								db: options.db,
								sessionId: session.id,
								nowMs: Date.now(),
							});
						}
						return { project, state: "needs_restore" };
					}
				}
				return { project, state: mapIdentityState(identity.state) };
			}
		}
		if (session && project.status === "ready") {
			return { project, state: "connected" };
		}
	}

	if (project.status === "ready") {
		return { project, state: "connected" };
	}
	return { project, state: "failed" };
}

export async function withWorkspaceRuntimeLease<T>(
	input: OpenWorkspaceRuntimeInput,
	run: (lease: WorkspaceRuntimeLease) => Promise<T>,
): Promise<T> {
	return withWorkspaceRuntimePolicyLease(
		{
			db: input.db,
			userId: input.userId,
			projectId: input.projectId,
			sessionId: input.sessionId,
			purpose: input.purpose,
			lock: input.lock,
			ensureReady: input.ensureReady,
			authority: input.authority ?? createSandboxAuthority(input.db),
			sleep: input.sleep,
			now: input.now,
		},
		{
			prepareRuntime: ({
				db,
				project,
				session,
				authority,
				ensureReady,
				sleep,
			}) =>
				prepareRuntimeWithRetry({
					env: input.env,
					db,
					project,
					session,
					authority,
					ensureReady,
					sleep,
				}),
			decryptProjectValues: (encrypted) =>
				decryptEnvVars(encrypted, input.env.BETTER_AUTH_SECRET),
			withLock: ({ sandbox, sessionId, run: invoke }) =>
				withSessionWorkspaceLock({
					env: input.env,
					sandbox,
					sessionId,
					run: invoke,
				}),
		},
		(lease) => run(lease as WorkspaceRuntimeLease),
	);
}

export async function ensureWorkspaceRuntimeReady(
	input: Omit<OpenWorkspaceRuntimeInput, "purpose"> & {
		purpose?: WorkspaceRuntimePurpose;
	},
): Promise<{
	workspacePath: string;
	branchName: string;
	baseCommitSha: string;
}> {
	return await withWorkspaceRuntimeLease(
		{
			...input,
			purpose: input.purpose ?? "preview",
			lock: input.lock ?? "none",
		},
		async (lease) => ({
			workspacePath: lease.workspacePath,
			branchName: lease.branchName,
			baseCommitSha: lease.baseCommitSha,
		}),
	);
}

export type SubmitWorkspaceWorkInput = {
	env: Env;
	db: Db;
	intent: WorkspaceWorkIntent;
	workId?: string;
	waitUntil?: WorkspaceRuntimeWaitUntil;
	now?: () => number;
	createId?: () => string;
	/** When false, persist and queue only — do not start execution. */
	start?: boolean;
};

export async function submitWorkspaceWork(
	input: SubmitWorkspaceWorkInput,
): Promise<WorkspaceWorkReceipt> {
	const nowMs = input.now?.() ?? Date.now();
	const work = await persistWorkspaceWork({
		db: input.db,
		intent: input.intent,
		workId: input.workId,
		nowMs,
		createId: input.createId,
	});
	const receipt =
		input.start === false
			? await loadWorkspaceWork({
					db: input.db,
					workId: work.id,
					userId: input.intent.userId,
					nowMs,
				})
			: await submitPersistedWork({
					db: input.db,
					work,
					nowMs,
					createId: input.createId,
				});
	await trackWorkspaceRuntimeDrain({
		env: input.env,
		db: input.db,
		waitUntil: input.waitUntil,
		now: input.now,
		createId: input.createId,
	});
	return (
		receipt ?? {
			workId: work.id,
			status: work.status,
			queuePosition: work.status === "queued" ? 1 : null,
			queueExpiresAt: work.queueExpiresAt,
			sessionId: work.sessionId,
			intent: work.intent,
			reasonCode: work.reasonCode,
			userMessageId: work.userMessageId,
			assistantMessageId: work.assistantMessageId,
		}
	);
}

export async function cancelWorkspaceWork(options: {
	env: Env;
	db: Db;
	workId: string;
	userId: string;
	waitUntil?: WorkspaceRuntimeWaitUntil;
	now?: () => number;
}): Promise<WorkspaceWorkReceipt | null> {
	const nowMs = options.now?.() ?? Date.now();
	const cancelled = await cancelWorkspaceWorkRow({
		db: options.db,
		workId: options.workId,
		userId: options.userId,
		nowMs,
	});
	await trackWorkspaceRuntimeDrain({
		env: options.env,
		db: options.db,
		waitUntil: options.waitUntil,
		now: options.now,
	});
	if (!cancelled) {
		return null;
	}
	return {
		workId: cancelled.id,
		status: cancelled.status,
		queuePosition: null,
		queueExpiresAt: cancelled.queueExpiresAt,
		sessionId: cancelled.sessionId,
		intent: cancelled.intent,
		reasonCode: cancelled.reasonCode,
		userMessageId: cancelled.userMessageId,
		assistantMessageId: cancelled.assistantMessageId,
	};
}

export async function getWorkspaceWork(options: {
	db: Db;
	workId: string;
	userId: string;
	now?: () => number;
}): Promise<WorkspaceWorkReceipt | null> {
	return loadWorkspaceWork({
		db: options.db,
		workId: options.workId,
		userId: options.userId,
		nowMs: options.now?.() ?? Date.now(),
	});
}

export async function getSessionRuntimeWork(options: {
	db: Db;
	sessionId: string;
	userId: string;
	now?: () => number;
}): Promise<WorkspaceWorkReceipt | null> {
	return loadQueuedWorkForSession({
		db: options.db,
		sessionId: options.sessionId,
		userId: options.userId,
		nowMs: options.now?.() ?? Date.now(),
	});
}

async function executeWorkspaceWork(options: {
	db: Db;
	env: Env;
	work: WorkspaceWorkRow;
	now: () => number;
}): Promise<void> {
	const payload = parseWorkspaceWorkPayload(options.work.payload);
	switch (options.work.intent) {
		case "agent_run": {
			const agent = await import("#/lib/agent-run-service");
			const context = await agent.loadAgentRunContextFromWork({
				db: options.db,
				env: options.env,
				work: options.work,
				payload,
			});
			if (!context) {
				throw new WorkspaceRuntimeError(
					"work_context_missing",
					"Queued agent work is missing message context.",
				);
			}
			await agent.executeAgentRun({
				context,
				emit: () => undefined,
			});
			return;
		}
		case "preview_start": {
			const preview = await import("#/lib/session-preview");
			if (!options.work.sessionId) {
				throw new WorkspaceRuntimeError(
					"session_required",
					"Preview start requires a workspace session.",
				);
			}
			const requestUrl =
				typeof payload?.requestUrl === "string" ? payload.requestUrl : "";
			await preview.startSessionPreview({
				db: options.db,
				env: options.env,
				projectId: options.work.projectId,
				sessionId: options.work.sessionId,
				userId: options.work.userId,
				requestUrl,
			});
			return;
		}
		case "recovery_retry": {
			const recovery = await import("#/lib/workspace-recovery");
			if (!options.work.sessionId) {
				throw new WorkspaceRuntimeError(
					"session_required",
					"Recovery retry requires a workspace session.",
				);
			}
			const preview = await import("#/lib/session-preview");
			await recovery.forcePreviewCheckpoint(
				{
					db: options.db,
					env: options.env,
					userId: options.work.userId,
					projectId: options.work.projectId,
					sessionId: options.work.sessionId,
				},
				{
					withWorkspaceRuntimeLease: (input, run) =>
						withWorkspaceRuntimeLease({ ...input, env: options.env }, run),
					preview: {
						interruptPreviewForCheckpoint: (input) =>
							preview.interruptPreviewForCheckpoint({
								...input,
								env: options.env,
							}),
						maybeRestartPreviewAfterCheckpoint: (input) =>
							preview.maybeRestartPreviewAfterCheckpoint({
								...input,
								env: options.env,
							}),
					},
				},
			);
			return;
		}
		case "git_mutation": {
			if (!options.work.sessionId) {
				throw new WorkspaceRuntimeError(
					"session_required",
					"Git mutation requires a workspace session.",
				);
			}
			await ensureWorkspaceRuntimeReady({
				env: options.env,
				db: options.db,
				userId: options.work.userId,
				projectId: options.work.projectId,
				sessionId: options.work.sessionId,
				purpose: "mutating_git",
			});
			return;
		}
		case "archive": {
			const preview = await import("#/lib/session-preview");
			if (!options.work.sessionId) {
				throw new WorkspaceRuntimeError(
					"session_required",
					"Archive requires a workspace session.",
				);
			}
			await preview.archiveSessionWithPreviewCleanup({
				db: options.db,
				env: options.env,
				projectId: options.work.projectId,
				sessionId: options.work.sessionId,
				userId: options.work.userId,
			});
			return;
		}
		case "destruction": {
			const preview = await import("#/lib/session-preview");
			const bootstrap = await import("#/lib/sandbox-bootstrap");
			await preview.deleteProjectRuntime({
				db: options.db,
				env: options.env,
				projectId: options.work.projectId,
				userId: options.work.userId,
				destroySandbox: bootstrap.destroySandbox,
			});
			return;
		}
		default: {
			throw new WorkspaceRuntimeError(
				"unsupported_intent",
				"Unsupported runtime work intent.",
			);
		}
	}
}

export async function trackWorkspaceRuntimeDrain(options: {
	env: Env;
	db: Db;
	waitUntil?: WorkspaceRuntimeWaitUntil;
	now?: () => number;
	createId?: () => string;
}): Promise<void> {
	if (!options.waitUntil) {
		return;
	}
	options.waitUntil(drainWorkspaceRuntime(options));
}

export async function drainWorkspaceRuntime(options: {
	env: Env;
	db: Db;
	waitUntil?: WorkspaceRuntimeWaitUntil;
	now?: () => number;
	createId?: () => string;
	invocationStartedAt?: number;
	invocationLimitMs?: number;
}): Promise<void> {
	const now = options.now ?? Date.now;
	await reclaimSleepingCapacity({
		db: options.db,
		env: options.env,
		nowMs: now(),
	});
	const recovery = await import("#/lib/workspace-recovery");
	await recovery.enqueueDuePreviewCheckpoints({
		db: options.db,
		env: options.env,
		nowMs: now(),
	});
	const archive = await import("#/lib/sandbox-archive");
	const cleanup = archive.retryArchiveCleanup({
		env: options.env,
		db: options.db,
		nowSeconds: Math.floor(now() / 1000),
	});
	options.waitUntil?.(cleanup);
	await drainWorkspaceRuntimeQueue({
		db: options.db,
		waitUntil: options.waitUntil,
		now: options.now,
		createId: options.createId,
		invocationStartedAt: options.invocationStartedAt,
		invocationLimitMs: options.invocationLimitMs,
		execute: async ({ db, work, now }) =>
			executeWorkspaceWork({
				db,
				env: options.env,
				work,
				now,
			}),
	});
	if (!options.waitUntil) {
		await cleanup;
	}
}

async function reclaimSleepingCapacity(options: {
	db: Db;
	env: Env;
	nowMs: number;
}): Promise<void> {
	const identities = await options.db
		.select()
		.from(sandboxIdentities)
		.where(
			and(
				eq(sandboxIdentities.kind, "workspace_session"),
				eq(sandboxIdentities.state, "ready"),
				isNull(sandboxIdentities.retiredAt),
			),
		);
	for (const identity of identities) {
		if (!identity.workspaceSessionId) {
			continue;
		}
		let liveStatus: string | null = null;
		try {
			const live = await getProjectSandboxState(
				options.env,
				identity.sandboxId,
			);
			liveStatus = live.status;
		} catch {
			liveStatus = "stopped";
		}
		if (liveStatus && INACTIVE_SANDBOX_STATUSES.has(liveStatus)) {
			const [session] = await options.db
				.select({
					id: workspaceSessions.id,
					previewStartedAt: workspaceSessions.previewStartedAt,
					runtimeOwner: workspaceSessions.runtimeOwner,
				})
				.from(workspaceSessions)
				.where(eq(workspaceSessions.id, identity.workspaceSessionId))
				.limit(1);
			if (session?.runtimeOwner !== "legacy") {
				continue;
			}
			const [recovery] = await options.db
				.select({
					pendingGeneration: workspaceSessionRecoveries.pendingGeneration,
					state: workspaceSessionRecoveries.state,
				})
				.from(workspaceSessionRecoveries)
				.where(
					eq(workspaceSessionRecoveries.sessionId, identity.workspaceSessionId),
				)
				.limit(1);
			const pendingPreview =
				session?.previewStartedAt != null &&
				recovery != null &&
				(recovery.pendingGeneration != null || recovery.state === "pending");
			if (pendingPreview) {
				continue;
			}
			await releaseCapacitySlot({
				db: options.db,
				sessionId: identity.workspaceSessionId,
				nowMs: options.nowMs,
			});
		}
	}
}

export async function continueWorkspaceFromArchive(options: {
	db: Db;
	userId: string;
	projectId: string;
	archivedSessionId: string;
	createId?: () => string;
}): Promise<{ sessionId: string }> {
	const [archived] = await options.db
		.select()
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.archivedSessionId),
				eq(workspaceSessions.projectId, options.projectId),
				eq(workspaceSessions.userId, options.userId),
				eq(workspaceSessions.status, "archived"),
			),
		)
		.limit(1);
	if (!archived) {
		throw new WorkspaceRuntimeError(
			"not_found",
			"Archived workspace session not found.",
		);
	}
	const [recovery] = await options.db
		.select()
		.from(workspaceSessionRecoveries)
		.where(eq(workspaceSessionRecoveries.sessionId, archived.id))
		.limit(1);
	if (!recovery?.currentArchiveId) {
		throw new WorkspaceRuntimeError(
			"not_found",
			"Archived workspace session has no recovery archive.",
		);
	}
	const createId = options.createId ?? nanoid;
	const sessionId = createId();
	const [created] = await options.db
		.insert(workspaceSessions)
		.values({
			id: sessionId,
			projectId: options.projectId,
			userId: options.userId,
			title: archived.title,
			status: "active",
			branchName: null,
			baseCommitSha: archived.baseCommitSha,
		})
		.returning({ id: workspaceSessions.id });
	if (!created) {
		throw new WorkspaceRuntimeError(
			"work_insert_failed",
			"Failed to create workspace session from archive.",
		);
	}
	await options.db.insert(workspaceSessionRecoveries).values({
		sessionId,
		mutationGeneration: recovery.durableGeneration,
		durableGeneration: recovery.durableGeneration,
		currentArchiveId: recovery.currentArchiveId,
		previousArchiveId: recovery.previousArchiveId,
		state: "healthy",
	});
	return { sessionId };
}

export async function releaseWorkspaceCapacityOnSleep(options: {
	db: Db;
	sessionId: string;
	now?: () => number;
}): Promise<boolean> {
	const held = await hasUnexpiredCapacitySlot({
		db: options.db,
		sessionId: options.sessionId,
		nowMs: options.now?.() ?? Date.now(),
	});
	if (!held) {
		return false;
	}
	return releaseCapacitySlot({
		db: options.db,
		sessionId: options.sessionId,
		nowMs: options.now?.() ?? Date.now(),
	});
}

export { cancelProjectWork, completeWork, failWork, settleAssistantFailed };
