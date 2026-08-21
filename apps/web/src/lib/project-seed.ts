import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { createDb } from "#/db";
import {
	privilegedOperations,
	projectSeeds,
	projects,
	sandboxIdentities,
} from "#/db/schema";
import { GIT_FETCH_CONTRACT_VERSION } from "#/lib/git-fetch-contract";
import { getGitHubApp } from "#/lib/github-app";
import { fetchGitHubBranchBrokered } from "#/lib/privileged-git";
import { type ArchiveSandbox, createArchive } from "#/lib/sandbox-archive";
import {
	createSandboxAuthority,
	type SandboxAuthority,
	type SandboxIdentityHandle,
} from "#/lib/sandbox-authority";
import {
	clearSandboxWorkspace,
	configureDittoGitIdentity,
	getProjectSandbox,
} from "#/lib/sandbox-bootstrap";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export const PROJECT_SEED_FORMAT_VERSION = 1;
export const PROJECT_SEED_DEPENDENCY_POLICY_VERSION = 1;
/** Matches installed image tag `cloudflare/sandbox:0.12.3` — no invented digest. */
export const PROJECT_SEED_SANDBOX_IMAGE_REVISION = "cloudflare/sandbox:0.12.3";
export const PROJECT_SEED_OPERATION_TYPE = "project_seed_fetch";
export const PROJECT_SEED_OPERATION_TTL_MS = 15 * 60 * 1000;

const RUNNER_PACKAGE_PATH = "/opt/ditto-runner/package.json";
const SEED_EXEC_TIMEOUT_MS = 120_000;

type Db = ReturnType<typeof createDb>;

export type ProjectSeedHandle = {
	id: string;
	projectId: string;
	sourceCommit: string | null;
	archiveId: string | null;
	formatVersion: number;
	compatibilityKey: string;
	buildState: "pending" | "ready" | "failed";
	failureReasonCode: string | null;
};

export type BuildProjectSeedInput = {
	env: Env;
	db: Db;
	userId: string;
	projectId: string;
	name: string;
	description?: string;
	githubRepo: string;
	installationId: number;
	encryptedEnvVars: string | null;
	authority?: SandboxAuthority;
};

export type BuildProjectSeedResult = {
	project: typeof projects.$inferSelect;
	seed: ProjectSeedHandle;
	identity: SandboxIdentityHandle;
};

export class ProjectSeedError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ProjectSeedError";
		this.code = code;
	}
}

function containerIdForSandbox(env: Env, sandboxId: string): string {
	const namespace = env.Sandbox as {
		idFromName: (name: string) => { toString(): string };
	};
	return namespace.idFromName(sandboxId).toString();
}

export function buildProjectSeedCompatibilityKey(parts: {
	formatVersion: number;
	repository: string;
	sourceCommit: string;
	dependencyPolicyVersion: number;
	packageManager: string;
	packageManagerVersion: string;
	nodeVersion: string;
	nodeArch: string;
	sandboxImageRevision: string;
	runnerRevision: string;
}): string {
	return [
		`seed-format=${parts.formatVersion}`,
		`repo=${parts.repository}`,
		`commit=${parts.sourceCommit}`,
		`deps=source-only`,
		`dep-policy=${parts.dependencyPolicyVersion}`,
		`pm=${parts.packageManager}@${parts.packageManagerVersion}`,
		`node=${parts.nodeVersion}/${parts.nodeArch}`,
		`image=${parts.sandboxImageRevision}`,
		`runner=${parts.runnerRevision}`,
	].join(";");
}

async function resolveDefaultBranch(options: {
	env: Env;
	installationId: number;
	githubRepo: string;
}): Promise<{ branchName: string; headRef: string }> {
	const [owner, repo] = options.githubRepo.split("/");
	if (!owner || !repo) {
		throw new ProjectSeedError(
			"invalid_repository",
			"Invalid GitHub repository slug.",
		);
	}
	const app = getGitHubApp(options.env);
	const octokit = await app.getInstallationOctokit(options.installationId);
	const { data } = await octokit.rest.repos.get({ owner, repo });
	const branchName = data.default_branch;
	if (!branchName || typeof branchName !== "string") {
		throw new ProjectSeedError(
			"default_branch_missing",
			"Repository default branch is missing.",
		);
	}
	return {
		branchName,
		headRef: `refs/heads/${branchName}`,
	};
}

async function readBuilderRevisions(
	sandbox: ReturnType<typeof getProjectSandbox>,
): Promise<{ nodeVersion: string; nodeArch: string; runnerRevision: string }> {
	const nodeResult = await sandbox.exec(
		`node -p "process.version+' '+process.arch"`,
		{ cwd: "/", timeout: SEED_EXEC_TIMEOUT_MS },
	);
	if (!nodeResult.success) {
		throw new ProjectSeedError(
			"node_probe_failed",
			"Failed to read Node version from builder.",
		);
	}
	const [nodeVersion, nodeArch] = nodeResult.stdout.trim().split(/\s+/);
	if (!nodeVersion || !nodeArch) {
		throw new ProjectSeedError(
			"node_probe_failed",
			"Builder Node probe returned an unexpected shape.",
		);
	}

	const runnerResult = await sandbox.exec(
		`node -p "require(${JSON.stringify(RUNNER_PACKAGE_PATH)}).version"`,
		{ cwd: "/", timeout: SEED_EXEC_TIMEOUT_MS },
	);
	if (!runnerResult.success) {
		throw new ProjectSeedError(
			"runner_probe_failed",
			"Failed to read Ditto runner revision from builder.",
		);
	}
	const runnerRevision = runnerResult.stdout.trim();
	if (!runnerRevision) {
		throw new ProjectSeedError(
			"runner_probe_failed",
			"Ditto runner revision is empty.",
		);
	}

	return { nodeVersion, nodeArch, runnerRevision };
}

function toSeedHandle(
	row: typeof projectSeeds.$inferSelect,
): ProjectSeedHandle {
	return {
		id: row.id,
		projectId: row.projectId,
		sourceCommit: row.sourceCommit,
		archiveId: row.archiveId,
		formatVersion: row.formatVersion,
		compatibilityKey: row.compatibilityKey,
		buildState: row.buildState,
		failureReasonCode: row.failureReasonCode,
	};
}

/**
 * Create a project + immutable seed via a temporary brokered builder.
 * Destroys and permanently retires the builder on every outcome.
 */
export async function buildProjectSeed(
	input: BuildProjectSeedInput,
): Promise<BuildProjectSeedResult> {
	const authority = input.authority ?? createSandboxAuthority(input.db);
	const { branchName, headRef } = await resolveDefaultBranch({
		env: input.env,
		installationId: input.installationId,
		githubRepo: input.githubRepo,
	});

	const sandboxId = crypto.randomUUID().toLowerCase();
	const containerId = containerIdForSandbox(input.env, sandboxId);
	const identityId = nanoid();
	const seedId = nanoid();
	const operationId = nanoid();
	const correlationId = crypto.randomUUID();
	const openedAt = new Date();
	const expiresAt = new Date(Date.now() + PROJECT_SEED_OPERATION_TTL_MS);
	const pendingCompatibilityKey = [
		`seed-format=${PROJECT_SEED_FORMAT_VERSION}`,
		`repo=${input.githubRepo}`,
		`commit=pending`,
		`deps=source-only`,
		`dep-policy=${PROJECT_SEED_DEPENDENCY_POLICY_VERSION}`,
	].join(";");

	// One D1 batch before any sandbox / network work.
	const [projectRows] = await input.db.batch([
		input.db
			.insert(projects)
			.values({
				id: input.projectId,
				name: input.name,
				description: input.description,
				userId: input.userId,
				githubRepo: input.githubRepo,
				githubInstallationId: input.installationId,
				sandboxId: null,
				status: "provisioning",
				envVars: input.encryptedEnvVars,
			})
			.returning(),
		input.db.insert(projectSeeds).values({
			id: seedId,
			projectId: input.projectId,
			sourceCommit: null,
			archiveId: null,
			formatVersion: PROJECT_SEED_FORMAT_VERSION,
			compatibilityKey: pendingCompatibilityKey,
			buildState: "pending",
		}),
		input.db.insert(sandboxIdentities).values({
			id: identityId,
			kind: "project_seed",
			sandboxId,
			containerId,
			userId: input.userId,
			projectId: input.projectId,
			workspaceSessionId: null,
			lifecycleGeneration: 1,
			state: "provisioning",
		}),
		input.db.insert(privilegedOperations).values({
			id: operationId,
			identityId,
			lifecycleGeneration: 1,
			family: "git_transport",
			type: PROJECT_SEED_OPERATION_TYPE,
			contractVersion: GIT_FETCH_CONTRACT_VERSION,
			repository: input.githubRepo,
			allowedRefs: JSON.stringify([headRef]),
			maxRequests: null,
			consumedRequests: 0,
			openedAt,
			expiresAt,
			correlationId,
			openSlot: "open",
		}),
	]);

	const project = projectRows?.[0];
	if (!project) {
		throw new ProjectSeedError(
			"project_insert_failed",
			"Failed to create project row.",
		);
	}

	const identity: SandboxIdentityHandle = {
		id: identityId,
		kind: "project_seed",
		sandboxId,
		containerId,
		userId: input.userId,
		projectId: input.projectId,
		workspaceSessionId: null,
		lifecycleGeneration: 1,
		state: "provisioning",
		retiredAt: null,
	};

	let sandbox: ReturnType<typeof getProjectSandbox> | null = null;
	let failureReasonCode: string | null = null;

	try {
		sandbox = getProjectSandbox(input.env, sandboxId);
		await sandbox.setOutboundHandler("dittoCatchAll", {
			identityId,
			lifecycleGeneration: 1,
		});

		await clearSandboxWorkspace({
			env: input.env,
			sandboxId,
		});

		const fetched = await fetchGitHubBranchBrokered({
			sandbox,
			githubRepo: input.githubRepo,
			branchName,
			destinationCwd: WORKSPACE_PATH,
		});

		await configureDittoGitIdentity(sandbox, WORKSPACE_PATH);

		const revisions = await readBuilderRevisions(sandbox);
		const compatibilityKey = buildProjectSeedCompatibilityKey({
			formatVersion: PROJECT_SEED_FORMAT_VERSION,
			repository: input.githubRepo,
			sourceCommit: fetched.headSha,
			dependencyPolicyVersion: PROJECT_SEED_DEPENDENCY_POLICY_VERSION,
			packageManager: "none",
			packageManagerVersion: "none",
			nodeVersion: revisions.nodeVersion,
			nodeArch: revisions.nodeArch,
			sandboxImageRevision: PROJECT_SEED_SANDBOX_IMAGE_REVISION,
			runnerRevision: revisions.runnerRevision,
		});

		const archive = await createArchive(input.env, input.db, {
			sandbox: sandbox as ArchiveSandbox,
			sandboxId,
			ownerKind: "project_seed",
			ownerId: input.projectId,
			userId: input.userId,
			generation: 0,
			quiesce: false,
		});

		const [readySeed] = await input.db
			.update(projectSeeds)
			.set({
				sourceCommit: fetched.headSha,
				archiveId: archive.id,
				compatibilityKey,
				buildState: "ready",
				failureReasonCode: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(projectSeeds.id, seedId))
			.returning();

		if (
			!readySeed ||
			readySeed.buildState !== "ready" ||
			!readySeed.archiveId ||
			!readySeed.sourceCommit
		) {
			throw new ProjectSeedError(
				"seed_promote_failed",
				"Failed to promote project seed metadata.",
			);
		}

		const [readyProject] = await input.db
			.update(projects)
			.set({
				status: "ready",
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(projects.id, input.projectId))
			.returning();

		if (!readyProject) {
			throw new ProjectSeedError(
				"project_promote_failed",
				"Failed to mark project ready.",
			);
		}

		return {
			project: readyProject,
			seed: toSeedHandle(readySeed),
			identity,
		};
	} catch (error) {
		failureReasonCode =
			error instanceof ProjectSeedError
				? error.code
				: error instanceof Error && "code" in error
					? String((error as { code: unknown }).code)
					: "seed_build_failed";

		await input.db
			.update(projectSeeds)
			.set({
				buildState: "failed",
				failureReasonCode,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(projectSeeds.id, seedId));

		await input.db
			.update(projects)
			.set({
				status: "failed",
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(projects.id, input.projectId));

		throw error;
	} finally {
		try {
			await authority.closeOperation(operationId, "seed_builder_settled");
		} catch {
			// Operation may already be closed.
		}
		if (sandbox) {
			try {
				await sandbox.destroy();
			} catch (destroyError) {
				console.error(
					"project-seed builder destroy failed:",
					destroyError instanceof Error
						? destroyError.message
						: String(destroyError),
				);
			}
		}
		try {
			await authority.retireIdentity(identityId);
		} catch (retireError) {
			console.error(
				"project-seed identity retire failed:",
				retireError instanceof Error
					? retireError.message
					: String(retireError),
			);
		}
		void failureReasonCode;
	}
}
