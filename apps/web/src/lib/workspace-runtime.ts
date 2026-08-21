import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	projectSeeds,
	projects,
	sandboxIdentities,
	workspaceSessions,
} from "#/db/schema";
import { mintAgentGitJwt } from "#/lib/agent-git-jwt";
import { GIT_FETCH_CONTRACT_VERSION } from "#/lib/git-fetch-contract";
import { getGitHubApp } from "#/lib/github-app";
import { fetchGitHubBranchBrokered } from "#/lib/privileged-git";
import { decryptEnvVars } from "#/lib/project-env-vars";
import { checkProjectSandbox } from "#/lib/project-sandbox";
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
	type SandboxEnvVar,
} from "#/lib/sandbox-bootstrap";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";
import { SessionWorkspaceBusyError } from "#/lib/session-workspace-lock-error";
import {
	ensureSessionWorkspaceReady,
	prepareSessionWorkspaceIfPresent,
} from "#/lib/session-worktree";
import {
	SESSION_WORKTREE_ROOT,
	sessionBranchName,
	WORKSPACE_PATH,
} from "#/lib/workspace-policy";
import { loadOwnedActiveSession } from "#/lib/workspace-session";

export const WORKSPACE_SESSION_FETCH_OPERATION_TYPE = "workspace_session_fetch";
export const WORKSPACE_SESSION_FETCH_OPERATION_TTL_MS = 15 * 60 * 1000;
export const WORKSPACE_RUNTIME_LEASE_TTL_MS = 20 * 60 * 1000;
export const WORKSPACE_RUNTIME_PATH = WORKSPACE_PATH;

const RUNNER_CLI_PATH = "/opt/ditto-runner/dist/cli.js";
const RUNNER_PACKAGE_PATH = "/opt/ditto-runner/package.json";
const GIT_COMMAND_TIMEOUT_MS = 120_000;
const RUNNER_HEALTH_TIMEOUT_MS = 10_000;
const TRANSIENT_RETRY_DELAYS_MS = [100, 200] as const;

type Db = ReturnType<typeof createDb>;
type ProjectRow = typeof projects.$inferSelect;
type SessionRow = typeof workspaceSessions.$inferSelect;

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

export type WorkspaceRuntimeSandbox = ReturnType<typeof getProjectSandbox>;

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

export type WorkspaceRuntimeLease = {
	sessionId: string;
	purpose: WorkspaceRuntimePurpose;
	workspacePath: string;
	branchName: string;
	baseCommitSha: string;
	sandbox: WorkspaceRuntimeSandbox;
	projectEnv: readonly SandboxEnvVar[] | null;
	issueGitCallbackToken: (options: {
		secret: string;
		projectId: string;
		userId: string;
	}) => Promise<string>;
	matchesSandboxClaim: (sandboxId: string) => boolean;
};

export class WorkspaceRuntimeError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "WorkspaceRuntimeError";
		this.code = code;
	}
}

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function containerIdForSandbox(env: Env, sandboxId: string): string {
	const namespace = env.Sandbox as {
		idFromName: (name: string) => { toString(): string };
	};
	return namespace.idFromName(sandboxId).toString();
}

function defaultLockMode(
	purpose: WorkspaceRuntimePurpose,
	lock?: WorkspaceRuntimeLockMode,
): WorkspaceRuntimeLockMode {
	if (lock) {
		return lock;
	}
	if (purpose === "agent_run" || purpose === "mutating_git") {
		return "acquire";
	}
	return "none";
}

function isLegacySharedSandboxSession(
	session: SessionRow,
	project: ProjectRow,
): boolean {
	const frozen = (session.baseCommitSha ?? "").trim().length > 0;
	const worktree =
		session.workspacePath.startsWith(SESSION_WORKTREE_ROOT) ||
		(session.workspacePath !== WORKSPACE_PATH && session.branchName != null);
	return (
		session.sandboxIdentityId == null &&
		frozen &&
		worktree &&
		Boolean(project.sandboxId)
	);
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
		code === "not_found" ||
		code === "not_ready" ||
		code === "invalid_repository" ||
		code === "default_branch_missing"
	);
}

async function loadOwnedProject(
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

async function acquireLifecycleLease(options: {
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
				or(
					isNull(workspaceSessions.runtimeLeaseId),
					lte(workspaceSessions.runtimeLeaseExpiresAt, options.now),
				),
			),
		)
		.returning({ id: workspaceSessions.id });
	if (!row) {
		throw new SessionWorkspaceBusyError();
	}
	return { leaseId, expiresAt };
}

async function releaseLifecycleLease(options: {
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
			workspacePath: WORKSPACE_PATH,
			runtimeFailureReasonCode: null,
			updatedAt: sql`(unixepoch())`,
		})
		.where(
			and(
				eq(workspaceSessions.id, options.session.id),
				eq(workspaceSessions.status, "active"),
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

type PreparedRuntime = {
	sandbox: WorkspaceRuntimeSandbox;
	sandboxId: string;
	identity: SandboxIdentityHandle | null;
	workspacePath: string;
	branchName: string;
	baseCommitSha: string;
};

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

	const { archiveId } = await loadReadySeed(options.db, options.project.id);
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

		await restoreArchive(options.env, options.db, {
			sandbox: sandbox as ArchiveSandbox,
			sandboxId: identity.sandboxId,
			archiveId,
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

async function serveLegacySession(options: {
	env: Env;
	db: Db;
	project: ProjectRow;
	session: SessionRow;
	ensureReady: boolean;
}): Promise<PreparedRuntime> {
	const sandboxId = options.project.sandboxId;
	if (!sandboxId) {
		throw new WorkspaceRuntimeError(
			"not_ready",
			"Legacy session is missing a project sandbox.",
		);
	}
	if (
		!options.project.githubRepo ||
		options.project.githubInstallationId == null
	) {
		throw new WorkspaceRuntimeError(
			"not_ready",
			"Project is not linked to a GitHub repository.",
		);
	}

	if (!options.ensureReady) {
		const prepared = await prepareSessionWorkspaceIfPresent({
			env: options.env,
			sandboxId,
			sessionId: options.session.id,
			existing: {
				branchName: options.session.branchName,
				baseCommitSha: options.session.baseCommitSha,
				workspacePath: options.session.workspacePath,
			},
		});
		if (!prepared.ok) {
			throw new WorkspaceRuntimeError(
				"not_ready",
				"Session worktree is not ready.",
			);
		}
		return {
			sandbox: getProjectSandbox(options.env, sandboxId),
			sandboxId,
			identity: null,
			workspacePath: prepared.workspacePath,
			branchName: prepared.branchName,
			baseCommitSha: prepared.baseCommitSha,
		};
	}

	const ready = await ensureSessionWorkspaceReady({
		env: options.env,
		sandboxId,
		sessionId: options.session.id,
		githubRepo: options.project.githubRepo,
		installationId: options.project.githubInstallationId,
		projectId: options.project.id,
		userId: options.session.userId,
		db: options.db,
		existing: {
			branchName: options.session.branchName,
			baseCommitSha: options.session.baseCommitSha,
			workspacePath: options.session.workspacePath,
		},
		lock: "assumeHeld",
	});
	return {
		sandbox: getProjectSandbox(options.env, sandboxId),
		sandboxId,
		identity: null,
		workspacePath: ready.workspacePath,
		branchName: ready.branchName,
		baseCommitSha: ready.baseCommitSha,
	};
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
	if (isLegacySharedSandboxSession(options.session, options.project)) {
		return serveLegacySession(options);
	}

	const existing = await loadExistingIdentity(
		options.authority,
		options.session,
	);
	if (existing && existing.state === "ready" && existing.retiredAt == null) {
		return serveDedicatedReady({
			env: options.env,
			session: options.session,
			identity: existing,
		});
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

function buildLease(options: {
	sessionId: string;
	purpose: WorkspaceRuntimePurpose;
	prepared: PreparedRuntime;
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
		projectEnv: options.projectEnv,
		issueGitCallbackToken: async (tokenOptions) => {
			if (options.purpose !== "agent_run") {
				throw new WorkspaceRuntimeError(
					"purpose_denied",
					"Git callback tokens are only issued for agent runs.",
				);
			}
			return mintAgentGitJwt({
				secret: tokenOptions.secret,
				projectId: tokenOptions.projectId,
				sessionId: options.sessionId,
				userId: tokenOptions.userId,
				sandboxId,
			});
		},
		matchesSandboxClaim: (claimed) => claimed === sandboxId,
	};
}

function mapIdentityState(
	state: SandboxIdentityHandle["state"],
): WorkspaceRuntimeObservationState {
	if (state === "ready") {
		return "connected";
	}
	if (state === "queued" || state === "provisioning" || state === "restoring") {
		return "provisioning";
	}
	if (state === "unprovisioned") {
		return "connected";
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
				return { project, state: mapIdentityState(identity.state) };
			}
		}
		if (session && isLegacySharedSandboxSession(session, project)) {
			const checked = await checkProjectSandbox({
				db: options.db,
				env: options.env,
				project,
			});
			return { project: checked.project, state: checked.state };
		}
		if (session && project.status === "ready") {
			return { project, state: "connected" };
		}
	}

	if (project.sandboxId) {
		const checked = await checkProjectSandbox({
			db: options.db,
			env: options.env,
			project,
		});
		return { project: checked.project, state: checked.state };
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
	const session = await loadOwnedActiveSession({
		db: input.db,
		projectId: input.projectId,
		sessionId: input.sessionId,
		userId: input.userId,
	});
	if (!session) {
		throw new WorkspaceRuntimeError("not_found", "Session not found.");
	}

	const project = await loadOwnedProject(
		input.db,
		input.projectId,
		input.userId,
	);
	if (!project) {
		throw new WorkspaceRuntimeError("not_found", "Project not found.");
	}
	if (project.status !== "ready") {
		throw new WorkspaceRuntimeError(
			"not_ready",
			"Project sandbox is not ready.",
		);
	}

	const now = new Date(input.now?.() ?? Date.now());
	const { leaseId } = await acquireLifecycleLease({
		db: input.db,
		session,
		now,
	});
	const authority = input.authority ?? createSandboxAuthority(input.db);
	const sleep =
		input.sleep ??
		((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
	const ensureReady = input.ensureReady !== false;
	const lockMode = defaultLockMode(input.purpose, input.lock);

	try {
		const prepared = await prepareRuntimeWithRetry({
			env: input.env,
			db: input.db,
			project,
			session,
			authority,
			ensureReady,
			sleep,
		});

		let projectEnv: readonly SandboxEnvVar[] | null = null;
		if (input.purpose === "agent_run") {
			projectEnv = await decryptEnvVars(
				project.envVars,
				input.env.BETTER_AUTH_SECRET,
			);
		}

		const lease = buildLease({
			sessionId: session.id,
			purpose: input.purpose,
			prepared,
			projectEnv,
		});

		const invoke = () => run(lease);
		if (lockMode === "acquire") {
			return await withSessionWorkspaceLock({
				env: input.env,
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
