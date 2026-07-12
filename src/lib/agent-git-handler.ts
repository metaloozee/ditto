import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { createDb } from "#/db";
import { projects, workspaceSessions } from "#/db/schema";
import type { AgentGitJwtClaims } from "#/lib/agent-git-jwt";
import { GitSecretPolicyError } from "#/lib/git-secret-policy";
import { decryptEnvVars } from "#/lib/project-env-vars";
import { ensureProjectSandbox } from "#/lib/project-sandbox";
import {
	getSessionGitStatus,
	openSessionPullRequest,
	pushSessionBranch,
} from "#/lib/session-git";
import { ensureSessionWorktree } from "#/lib/session-worktree";

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
	projectId: string;
	githubRepo: string;
	installationId: number;
	sandboxId: string;
	session: {
		id: string;
		branchName: string;
		workspacePath: string;
		title?: string | null;
	};
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

	if (project.status !== "ready" || !project.sandboxId) {
		throw new AgentGitHttpError(409, "Project sandbox is not ready.");
	}

	if (project.sandboxId !== options.claims.sandboxId) {
		throw new AgentGitHttpError(403, "Sandbox does not match this agent run.");
	}

	const [session] = await options.db
		.select()
		.from(workspaceSessions)
		.where(
			and(
				eq(workspaceSessions.id, options.claims.sessionId),
				eq(workspaceSessions.projectId, options.claims.projectId),
				eq(workspaceSessions.userId, options.claims.userId),
				eq(workspaceSessions.status, "active"),
			),
		)
		.limit(1);

	if (!session) {
		throw new AgentGitHttpError(404, "Session not found.");
	}

	await ensureProjectSandbox({
		db: options.db,
		env: options.env,
		project,
	});

	const ensured = await ensureSessionWorktree({
		env: options.env,
		sandboxId: project.sandboxId,
		sessionId: session.id,
		githubRepo: project.githubRepo,
		installationId: project.githubInstallationId,
		existing: {
			branchName: session.branchName,
			baseCommitSha: session.baseCommitSha,
			workspacePath: session.workspacePath,
		},
	});

	if (
		session.branchName !== ensured.branchName ||
		session.workspacePath !== ensured.workspacePath ||
		session.baseCommitSha !== ensured.baseCommitSha
	) {
		await options.db
			.update(workspaceSessions)
			.set({
				branchName: ensured.branchName,
				baseCommitSha: ensured.baseCommitSha,
				workspacePath: ensured.workspacePath,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(workspaceSessions.id, session.id));
	}

	const envVars = await decryptEnvVars(
		project.envVars,
		options.env.BETTER_AUTH_SECRET,
	);
	const knownSecrets = envVars.map((envVar) => envVar.value);

	return {
		projectId: project.id,
		githubRepo: project.githubRepo,
		installationId: project.githubInstallationId,
		sandboxId: project.sandboxId,
		session: {
			id: session.id,
			branchName: ensured.branchName,
			workspacePath: ensured.workspacePath,
			title: session.title,
		},
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
	// knownSecrets stay server-side for push preflight; never on status responses.
	const gitCtx = {
		env: options.env,
		sandboxId: options.resolved.sandboxId,
		installationId: options.resolved.installationId,
		githubRepo: options.resolved.githubRepo,
		session: options.resolved.session,
		knownSecrets: options.resolved.knownSecrets,
	};

	const statusCtx = {
		env: options.env,
		sandboxId: options.resolved.sandboxId,
		installationId: options.resolved.installationId,
		githubRepo: options.resolved.githubRepo,
		session: options.resolved.session,
	};

	if (options.body.action === "status") {
		return await getSessionGitStatus(statusCtx);
	}

	const status = await getSessionGitStatus(statusCtx);

	if (status.dirty) {
		const message =
			options.body.action === "openPullRequest"
				? "Commit local changes before opening a pull request."
				: "Commit local changes before pushing.";
		throw new AgentGitHttpError(409, message);
	}

	if (options.body.action === "push") {
		if (status.ahead <= 0) {
			throw new AgentGitHttpError(409, "Nothing to push for this branch.");
		}
		try {
			return await pushSessionBranch(gitCtx);
		} catch (error) {
			mapPushError(error);
		}
	}

	if (status.ahead > 0) {
		try {
			await pushSessionBranch(gitCtx);
		} catch (error) {
			mapPushError(error);
		}
	}

	try {
		return await openSessionPullRequest({
			...statusCtx,
			title: options.body.title,
			body: options.body.body,
			baseBranch: options.body.baseBranch,
		});
	} catch (error) {
		if (error instanceof GitSecretPolicyError) {
			throw new AgentGitHttpError(409, error.message);
		}
		throw new AgentGitHttpError(
			502,
			error instanceof Error ? error.message : "Failed to open pull request.",
		);
	}
}
