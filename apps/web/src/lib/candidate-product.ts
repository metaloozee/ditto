import { WorkerEntrypoint } from "cloudflare:workers";
import {
	type CandidateRuntimeScope,
	parseCandidateRuntimeScope,
} from "../../../../packages/runtime-contracts/src/candidate-scope.js";
import type { ModelTransportDescriptorV1 } from "../../../../packages/runtime-contracts/src/model.js";
import type { QueueDecisionV2 } from "../../../../packages/runtime-contracts/src/product-command.js";
import type { RuntimeObservationV1 } from "../../../../packages/runtime-contracts/src/projection.js";
import { readCandidateBaselineSource } from "./candidate-baseline";
import {
	brokerCandidateGit,
	type CandidateBranchFetchDeps,
	candidateGitHubDeps,
	closeCandidateBranchFetch,
	openCandidateBranchFetch,
} from "./candidate-branch-fetch";
import { CandidateLifecycle } from "./candidate-lifecycle";
import {
	candidateProjectCiphertext,
	deliverCandidateProjectValues,
} from "./candidate-project-values";
import type { CodexCredential } from "./codex-credential-do";
import { readOwnedConfigurationAuthority } from "./configuration-product-authority";
import type { GitHubAppCredentials } from "./github-app";
import {
	CANDIDATE_MODEL_POLICY,
	type ModelClaimRpc,
} from "./model-product-authority";
import {
	performPrivateModelRequest,
	readPrivateModelPermit,
} from "./model-product-transport";
import {
	type CandidateAdmissionRuntime,
	CandidateProductCommands,
} from "./session-command-candidate";
import type { CandidateProductCommandService } from "./session-runtime-client";

export type CandidateProductBindings = {
	DB: D1Database;
	CodexCredential: DurableObjectNamespace<CodexCredential>;
	CandidateSessions: DurableObjectNamespace;
	BETTER_AUTH_SECRET: string;
} & GitHubAppCredentials;

/** The session methods the product calls; credential-tests checks the runtime class conforms. */
export interface CandidateSessionRpc
	extends Required<
		Pick<
			CandidateAdmissionRuntime,
			"readSelection" | "targetStatus" | "observe" | "workspaceAction"
		>
	> {
	observeHistory(
		scope: unknown,
		cursor?: number,
	): Promise<RuntimeObservationV1>;
	deliverCommand(commandId: string, ownerVersion: number): Promise<unknown>;
	exportContinuation(scope: unknown): Promise<unknown>;
	importContinuation(scope: unknown, seed: unknown): Promise<unknown>;
	purgeDeleted(scope: unknown): Promise<void>;
	terminateExecutor(scope: unknown): Promise<{ terminated: boolean }>;
}

// Typed structurally: web cannot import the runtime class; credential-tests checks conformance.
function session(
	env: Pick<CandidateProductBindings, "CandidateSessions">,
	id: string,
) {
	return env.CandidateSessions.getByName(id) as unknown as CandidateSessionRpc;
}

function commands(env: CandidateProductBindings) {
	return new CandidateProductCommands(
		env.DB,
		{
			readSelection: (subject) =>
				session(env, subject.workspaceSessionId).readSelection(subject),
			targetStatus: (subject, runId) =>
				session(env, subject.workspaceSessionId).targetStatus(subject, runId),
			observe: (subject, cursor) =>
				session(env, subject.workspaceSessionId).observe(subject, cursor),
			observeHistory: (scope, cursor) =>
				session(env, scope.workspaceSessionId).observeHistory(
					{ version: 2, ownerVersion: 1, ...scope },
					cursor,
				),
			workspaceAction: (subject, action) =>
				session(env, subject.workspaceSessionId).workspaceAction(
					subject,
					action,
				),
		},
		(owner) => env.CodexCredential.getByName(owner),
	);
}

function lifecycle(env: CandidateProductBindings) {
	const scope = (value: {
		userId: string;
		projectId: string;
		workspaceSessionId: string;
	}) => ({ version: 2 as const, ownerVersion: 1 as const, ...value });
	return new CandidateLifecycle(env.DB, {
		exportContinuation: (value) =>
			session(env, value.workspaceSessionId).exportContinuation(scope(value)),
		importContinuation: (value, seed) =>
			session(env, value.workspaceSessionId).importContinuation(
				scope(value),
				seed,
			),
		terminateExecutor: (identity) =>
			session(env, identity.workspaceSessionId).terminateExecutor(
				scope({
					userId: identity.userId,
					projectId: identity.projectId,
					workspaceSessionId: identity.workspaceSessionId,
				}),
			),
		purgeSession: (value) =>
			session(env, value.workspaceSessionId).purgeDeleted(scope(value)),
	});
}

/** Browser-facing commands run in process: Workers RPC would drop CandidateCommandError. */
export function createCandidateProductCommandService(
	env: Omit<CandidateProductBindings, "CandidateSessions"> & {
		CandidateSessions?: DurableObjectNamespace;
	},
): CandidateProductCommandService | undefined {
	if (!env.CandidateSessions) return undefined;
	const bound = { ...env, CandidateSessions: env.CandidateSessions };
	return {
		admitOwned: (userId, body) => commands(bound).admit(userId, body),
		observeOwned: (userId, projectId, sessionId, cursor) =>
			commands(bound).observe(userId, projectId, sessionId, cursor),
		workspaceActionOwned: (userId, input) =>
			commands(bound).workspaceAction(userId, input),
		modelsOwned: (userId, input) => commands(bound).models(userId, input),
		deleteProjectOwned: (userId, projectId) =>
			lifecycle(bound).deleteProject(userId, projectId),
		drain: () =>
			commands(bound).drain((sessionId, commandId, ownerVersion) =>
				session(bound, sessionId).deliverCommand(commandId, ownerVersion),
			),
	};
}

/**
 * The runtime's private product surface. No method takes a caller-supplied
 * user: every scope is parsed here and checked against D1 ownership.
 */
export class CandidatePrivateProduct extends WorkerEntrypoint<CandidateProductBindings> {
	private branchFetchDeps(
		scope: CandidateRuntimeScope,
	): CandidateBranchFetchDeps {
		return {
			db: this.env.DB,
			now: Date.now,
			...candidateGitHubDeps(this.env, this.env.DB, scope),
			fetch: (request) => fetch(request),
		};
	}
	readCandidateBaselineSource(scope: CandidateRuntimeScope) {
		return readCandidateBaselineSource(
			this.env.DB,
			parseCandidateRuntimeScope(scope),
		);
	}
	openCandidateBranchFetch(
		scope: CandidateRuntimeScope,
		request: { operation: string; branch: string },
	) {
		const parsed = parseCandidateRuntimeScope(scope);
		return openCandidateBranchFetch(
			this.branchFetchDeps(parsed),
			parsed,
			request,
		);
	}
	brokerCandidateGit(
		scope: CandidateRuntimeScope,
		request: Request,
		containerId: string,
	) {
		const parsed = parseCandidateRuntimeScope(scope);
		return brokerCandidateGit(
			this.branchFetchDeps(parsed),
			parsed,
			request,
			containerId,
		);
	}
	closeCandidateBranchFetch(scope: CandidateRuntimeScope, window: string) {
		const parsed = parseCandidateRuntimeScope(scope);
		return closeCandidateBranchFetch(
			this.branchFetchDeps(parsed),
			parsed,
			window,
		);
	}
	applyCandidateProjections(scope: CandidateRuntimeScope, intents: unknown) {
		return commands(this.env).applyProjections(
			parseCandidateRuntimeScope(scope),
			intents,
		);
	}
	applyCandidateCheckpoints(
		scope: CandidateRuntimeScope,
		projections: unknown,
	) {
		return commands(this.env).applyCheckpointProjections(
			parseCandidateRuntimeScope(scope),
			projections,
		);
	}
	applyCandidateRestore(scope: CandidateRuntimeScope, completion: unknown) {
		return commands(this.env).applyRestoreCompletion(
			parseCandidateRuntimeScope(scope),
			completion,
		);
	}
	applyCandidateArchive(scope: CandidateRuntimeScope, completion: unknown) {
		return commands(this.env).applyArchiveCompletion(
			parseCandidateRuntimeScope(scope),
			completion,
		);
	}
	readHistoryAuthority(scope: CandidateRuntimeScope) {
		return lifecycle(this.env).historyAuthority(
			parseCandidateRuntimeScope(scope),
		);
	}
	readArchivedAuthority(scope: CandidateRuntimeScope) {
		return lifecycle(this.env).archivedAuthority(
			parseCandidateRuntimeScope(scope),
		);
	}
	async readDeletionAuthority(value: CandidateRuntimeScope) {
		const scope = parseCandidateRuntimeScope(value);
		return !!(await this.env.DB.prepare(
			"SELECT 1 FROM workspace_sessions s JOIN projects p ON p.id=s.projectId JOIN runtime_deleted_target_fences f ON f.targetKind='project' AND f.targetId=p.id WHERE s.id=? AND s.userId=? AND p.id=? AND p.userId=s.userId AND p.status='deleting'",
		)
			.bind(scope.workspaceSessionId, scope.userId, scope.projectId)
			.first());
	}
	readRuntimeAuthority(value: CandidateRuntimeScope) {
		const scope = parseCandidateRuntimeScope(value);
		return commands(this.env).runtimeAuthority(
			scope.userId,
			scope.projectId,
			scope.workspaceSessionId,
		);
	}
	readCandidateProjectValues(value: CandidateRuntimeScope, request: unknown) {
		const scope = parseCandidateRuntimeScope(value);
		return deliverCandidateProjectValues({
			workspaceSessionId: scope.workspaceSessionId,
			request,
			authority: () => this.readRuntimeAuthority(scope),
			ciphertext: candidateProjectCiphertext(this.env.DB, scope),
			secret: this.env.BETTER_AUTH_SECRET,
		});
	}
	async readCandidateSubject(commandId: string, ownerVersion: number) {
		try {
			return await commands(this.env).subjectForCommand(
				commandId,
				ownerVersion,
			);
		} catch {
			return null;
		}
	}
	reconstructCommand(commandId: string, ownerVersion: number) {
		return commands(this.env).reconstruct(commandId, ownerVersion);
	}
	reconcileCandidateDecision(decision: QueueDecisionV2) {
		return commands(this.env).reconcileDecision(
			decision.commandId,
			decision.ownerVersion,
			decision,
		);
	}
	async readCandidateConfigurationAuthority(
		commandId: string,
		input: unknown,
		selection?: unknown,
	) {
		const subject = await this.readCandidateSubject(commandId, 1);
		if (!subject) return { version: 1 as const, status: "denied" as const };
		const status = await this.env.CodexCredential.getByName(
			subject.userId,
		).status(subject.userId);
		if (
			selection !== undefined &&
			(status.status !== "connected" ||
				status.generation !== subject.connectionGeneration)
		)
			return { version: 1 as const, status: "denied" as const };
		return readOwnedConfigurationAuthority(
			this.env.DB,
			subject,
			input,
			selection,
			false,
			CANDIDATE_MODEL_POLICY,
		);
	}
	requestModel(input: unknown, capability: ModelClaimRpc) {
		return performPrivateModelRequest(
			{ DB: this.env.DB, CodexCredential: this.env.CodexCredential },
			input,
			capability,
			false,
		);
	}
	readModelPermit(input: unknown, descriptor: ModelTransportDescriptorV1) {
		return readPrivateModelPermit(
			this.env.DB,
			input,
			descriptor,
			false,
			CANDIDATE_MODEL_POLICY,
		);
	}
	fetch() {
		return new Response("Not found", { status: 404 });
	}
}
