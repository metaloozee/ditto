import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { createDb } from "#/db";
import { projects } from "#/db/schema";
import type { AgentGitJwtClaims } from "#/lib/agent-git-jwt";
import { GitSecretPolicyError } from "#/lib/git-secret-policy";
import { decryptEnvVars } from "#/lib/project-env-vars";
import {
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
} from "#/lib/session-git";
import {
	runPushThenOpenPullRequest,
	SessionGitExportPreconditionError,
} from "#/lib/session-git-export";
import {
	type WorkspaceRuntimeLease,
	withWorkspaceRuntimeLease,
} from "#/lib/workspace-runtime";
import { loadOwnedActiveSession } from "#/lib/workspace-session";

export const agentGitBodySchema = z.object({
	action: z.enum(["push", "openPullRequest", "status"]),
	title: z.string().trim().min(1).optional(),
	body: z.string().trim().min(1).optional(),
	baseBranch: z.string().trim().min(1).optional(),
});

export type AgentGitBody = z.infer<typeof agentGitBodySchema>;

export class AgentGitHttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "AgentGitHttpError";
	}
}

export type ResolvedAgentGitContext = {
	db: ReturnType<typeof createDb>;
	userId: string;
	projectId: string;
	githubRepo: string;
	installationId: number;
	claimedSandboxId: string;
	sessionId: string;
	sessionTitle: string | null;
	/**
	 * Decrypted project env values for push preflight only.
	 * Server memory — never include in client/agent responses.
	 */
	knownSecrets: readonly string[];
};

export async function resolveAgentGitContext(options: {
	db: ReturnType<typeof createDb>;
	env: Env;
	claims: AgentGitJwtClaims;
}): Promise<ResolvedAgentGitContext> {
	const [project] = await options.db
		.select()
		.from(projects)
		.where(
			and(
				eq(projects.id, options.claims.projectId),
				eq(projects.userId, options.claims.userId),
			),
		)
		.limit(1);

	if (!project) {
		throw new AgentGitHttpError(404, "Project not found.");
	}

	if (!project.githubRepo || !project.githubInstallationId) {
		throw new AgentGitHttpError(
			409,
			"Project is not linked to a GitHub repository.",
		);
	}

	if (project.status !== "ready") {
		throw new AgentGitHttpError(409, "Project sandbox is not ready.");
	}

	const session = await loadOwnedActiveSession({
		db: options.db,
		projectId: options.claims.projectId,
		sessionId: options.claims.sessionId,
		userId: options.claims.userId,
	});

	if (!session) {
		throw new AgentGitHttpError(404, "Session not found.");
	}

	const envVars = await decryptEnvVars(
		project.envVars,
		options.env.BETTER_AUTH_SECRET,
	);
	const knownSecrets = envVars.map((envVar) => envVar.value);

	return {
		db: options.db,
		userId: options.claims.userId,
		projectId: project.id,
		githubRepo: project.githubRepo,
		installationId: project.githubInstallationId,
		claimedSandboxId: options.claims.sandboxId,
		sessionId: session.id,
		sessionTitle: session.title,
		knownSecrets,
	};
}

function mapPushError(error: unknown): never {
	if (error instanceof GitSecretPolicyError) {
		throw new AgentGitHttpError(409, error.message);
	}
	if (error instanceof AgentGitHttpError) {
		throw error;
	}
	throw error;
}

export async function dispatchAgentGitAction(options: {
	env: Env;
	resolved: ResolvedAgentGitContext;
	body: AgentGitBody;
}): Promise<unknown> {
	return await withWorkspaceRuntimeLease(
		{
			env: options.env,
			db: options.resolved.db,
			userId: options.resolved.userId,
			projectId: options.resolved.projectId,
			sessionId: options.resolved.sessionId,
			purpose: "mutating_git",
			lock: "assumeHeld",
		},
		async (lease: WorkspaceRuntimeLease) => {
			if (!lease.matchesSandboxClaim(options.resolved.claimedSandboxId)) {
				throw new AgentGitHttpError(
					403,
					"Sandbox does not match this agent run.",
				);
			}
			const session = {
				id: options.resolved.sessionId,
				branchName: lease.branchName,
				baseCommitSha: lease.baseCommitSha,
				workspacePath: lease.workspacePath,
				title: options.resolved.sessionTitle,
			};
			const gitCtx = {
				env: options.env,
				sandbox: lease.sandbox,
				installationId: options.resolved.installationId,
				githubRepo: options.resolved.githubRepo,
				session,
				knownSecrets: options.resolved.knownSecrets,
				bypassWorkspaceLock: true,
			};
			const statusCtx = {
				env: options.env,
				sandbox: lease.sandbox,
				installationId: options.resolved.installationId,
				githubRepo: options.resolved.githubRepo,
				session,
			};

			if (options.body.action === "status") {
				return await getSessionGitStatus(statusCtx);
			}

			if (options.body.action === "openPullRequest") {
				try {
					return await runPushThenOpenPullRequest({
						ctx: gitCtx,
						deps: {
							getSessionGitStatus,
							pushSessionBranch,
							openSessionPullRequest,
						},
						title: options.body.title,
						body: options.body.body,
						baseBranch: options.body.baseBranch,
						existingPullRequestPolicy: "open",
					});
				} catch (error) {
					if (error instanceof SessionGitExportPreconditionError) {
						throw new AgentGitHttpError(409, error.message);
					}
					if (error instanceof GitSecretPolicyError) {
						throw new AgentGitHttpError(409, error.message);
					}
					throw new AgentGitHttpError(
						502,
						error instanceof Error
							? error.message
							: "Failed to open pull request.",
					);
				}
			}

			const status = await getSessionGitStatus(statusCtx);
			if (status.dirty) {
				throw new AgentGitHttpError(
					409,
					"Commit local changes before pushing.",
				);
			}
			if (status.workflow.kind !== "push") {
				throw new AgentGitHttpError(
					409,
					status.workflow.kind === "sync"
						? `Sync the latest ${status.workflow.baseBranch} before pushing.`
						: "Nothing to push for this branch.",
				);
			}
			try {
				return await pushSessionBranch(gitCtx);
			} catch (error) {
				mapPushError(error);
			}
		},
	);
}
