import {
	type ContinuationSeedV1,
	parseBrowserContinuationV1,
	parseContinuationImportV1,
	parseContinuationSeedV1,
} from "../../../../packages/runtime-contracts/src/lifecycle.js";
import { CandidateCapacity } from "./candidate-capacity";
import {
	CandidateCommandError,
	executorOwnerKey,
} from "./session-command-candidate";

export type CandidateSessionScope = {
	userId: string;
	projectId: string;
	workspaceSessionId: string;
};

/** Runtime and execution reached by archive, continuation and deletion. */
export interface CandidateLifecycleRuntime {
	/** The sealed final context of an archived session; read without activating it. */
	exportContinuation(scope: CandidateSessionScope): Promise<unknown>;
	/** Starts the destination's conversation from that context. */
	importContinuation(
		scope: CandidateSessionScope,
		seed: ContinuationSeedV1,
	): Promise<unknown>;
	/** Destroys a retired executor; `terminated` is evidence its processes are gone. */
	terminateExecutor(identity: {
		identityId: string;
		incarnationId: string;
		sandboxId: string;
		workspaceSessionId: string;
		userId: string;
		projectId: string;
	}): Promise<{ terminated: boolean }>;
	/** Removes a deleted session's runtime storage and recovery objects. */
	purgeSession(scope: CandidateSessionScope): Promise<void>;
}

const RETRY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60_000;

function reject(code: string, status = 409): never {
	throw new CandidateCommandError(code, status);
}

/**
 * Continuation of archived sessions and revocation-first project deletion
 * for candidate sessions. Every external step is a durable intent first and
 * converges under retries; fences outlive the content they protect.
 */
export class CandidateLifecycle {
	readonly capacity: CandidateCapacity;
	constructor(
		private db: D1Database,
		private runtime: CandidateLifecycleRuntime,
		private now: () => number = Date.now,
		private createId: () => string = () => crypto.randomUUID(),
		capacity?: CandidateCapacity,
	) {
		this.capacity = capacity ?? new CandidateCapacity(db, undefined, now);
	}

	/** An owned archived session whose project is live and not fenced. */
	private archivedSource(userId: string, projectId: string, sessionId: string) {
		return this.db
			.prepare(
				`SELECT s.id,s.title,a.finalPairId FROM workspace_sessions s JOIN projects p ON p.id=s.projectId
JOIN candidate_archives a ON a.sessionId=s.id AND a.state='complete'
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId AND p.status='ready'
AND s.status='archived' AND s.runtimeOwner='pi_durable_v1' AND s.runtimeOwnerVersion=1
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`,
			)
			.bind(sessionId, userId, projectId);
	}

	/** Read authority for an archived session's sealed context. */
	async archivedAuthority(scope: CandidateSessionScope) {
		return !!(await this.archivedSource(
			scope.userId,
			scope.projectId,
			scope.workspaceSessionId,
		).first());
	}

	/**
	 * History stays readable for an owned active or archived session until
	 * its project is deleted. Reading it never activates an executor.
	 */
	async historyAuthority(scope: CandidateSessionScope) {
		return !!(await this.db
			.prepare(
				`SELECT 1 FROM workspace_sessions s JOIN projects p ON p.id=s.projectId
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId AND p.status='ready'
AND s.status IN ('active','archived') AND s.runtimeOwner='pi_durable_v1' AND s.runtimeOwnerVersion=1
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`,
			)
			.bind(scope.workspaceSessionId, scope.userId, scope.projectId)
			.first());
	}

	/**
	 * Continues an archived session in a new session with its own identity,
	 * executor, branch and recovery lineage. The intent and the new rows
	 * commit in one batch; the context copy then runs as a retryable step,
	 * and the destination admits nothing until it is ready. A repeated
	 * request with the same key resumes the same continuation.
	 */
	async continueArchived(
		userId: string,
		value: unknown,
	): Promise<{ sessionId: string; state: "ready" }> {
		const input = parseBrowserContinuationV1(value);
		const existing = () =>
			this.db
				.prepare(
					"SELECT * FROM candidate_continuations WHERE sourceSessionId=? AND userId=? AND projectId=?",
				)
				.bind(input.sourceSessionId, userId, input.projectId)
				.first<{
					id: string;
					idempotencyKey: string;
					destinationSessionId: string;
					sourcePairId: string;
					state: "pending" | "ready";
				}>();
		let row = await existing();
		if (!row) {
			const source = await this.archivedSource(
				userId,
				input.projectId,
				input.sourceSessionId,
			).first<{ id: string; title: string | null; finalPairId: string }>();
			if (!source) reject("archive_not_found", 404);
			const id = this.createId(),
				sessionId = this.createId(),
				identityId = this.createId(),
				incarnationId = this.createId(),
				now = this.now();
			const q = (sql: string, ...args: (string | number | null)[]) =>
				this.db.prepare(sql).bind(...args);
			const sourceGate = `EXISTS(SELECT 1 FROM workspace_sessions s JOIN projects p ON p.id=s.projectId JOIN candidate_archives a ON a.sessionId=s.id AND a.state='complete'
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId AND s.status='archived' AND p.status='ready'
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id)))`;
			try {
				await this.db.batch([
					q(
						`INSERT INTO candidate_continuations(id,userId,projectId,sourceSessionId,idempotencyKey,destinationSessionId,destinationIdentityId,sourcePairId,branchName,state,createdAt)
SELECT ?,?,?,?,?,?,?,?,?,'pending',? WHERE ${sourceGate}`,
						id,
						userId,
						input.projectId,
						input.sourceSessionId,
						input.idempotencyKey,
						sessionId,
						identityId,
						source.finalPairId,
						`ditto/${sessionId}`,
						now,
						input.sourceSessionId,
						userId,
						input.projectId,
					),
					// The single provisional candidate workspace: the archive freed it.
					q(
						"INSERT INTO candidate_workspace_claims(id,sessionId,identityId,userId,projectId,createdAt) SELECT 1,destinationSessionId,destinationIdentityId,userId,projectId,createdAt FROM candidate_continuations WHERE id=?",
						id,
					),
					q(
						`INSERT INTO workspace_sessions(id,projectId,userId,title,status,branchName,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion,runtimeProtocolVersion)
SELECT destinationSessionId,projectId,userId,?,'active',branchName,destinationIdentityId,'pi_durable_v1',1,2 FROM candidate_continuations WHERE id=?`,
						source.title ?? "Continued session",
						id,
					),
					q(
						`INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId)
SELECT destinationIdentityId,'workspace_session',destinationIdentityId,destinationIdentityId,userId,projectId,destinationSessionId,'ready','Sandbox','fixture-pi-durable-execution-v1',? FROM candidate_continuations WHERE id=?`,
						incarnationId,
						id,
					),
					q(
						"INSERT INTO runtime_checkpoint_pointers(sessionId,runtimeOwnerVersion,currentPairId,previousPairId,mutationGeneration,updatedAt) SELECT destinationSessionId,1,NULL,NULL,0,? FROM candidate_continuations WHERE id=?",
						now,
						id,
					),
					q(
						"INSERT INTO session_command_sequences(sessionId,nextSequence,updatedAt) SELECT destinationSessionId,1,? FROM candidate_continuations WHERE id=?",
						now,
						id,
					),
				]);
			} catch (error) {
				row = await existing();
				if (!row) {
					if (
						await this.db
							.prepare("SELECT 1 FROM candidate_workspace_claims WHERE id=1")
							.first()
					)
						reject("fixture_capacity_exhausted");
					throw error;
				}
			}
			row ??= await existing();
			if (!row) reject("archive_not_found", 404);
		}
		if (row.idempotencyKey !== input.idempotencyKey)
			reject("continuation_exists");
		if (row.state === "ready")
			return { sessionId: row.destinationSessionId, state: "ready" };
		if (
			!(await this.archivedAuthority({
				userId,
				projectId: input.projectId,
				workspaceSessionId: input.sourceSessionId,
			}))
		)
			reject("archive_not_found", 404);
		const seed = parseContinuationSeedV1(
			await this.runtime.exportContinuation({
				userId,
				projectId: input.projectId,
				workspaceSessionId: input.sourceSessionId,
			}),
		);
		if (
			seed.sourceSessionId !== input.sourceSessionId ||
			seed.sourcePairId !== row.sourcePairId
		)
			reject("continuation_unavailable", 503);
		const imported = parseContinuationImportV1(
			await this.runtime.importContinuation(
				{
					userId,
					projectId: input.projectId,
					workspaceSessionId: row.destinationSessionId,
				},
				seed,
			),
			seed,
		);
		// A deletion that fenced the project during import keeps it pending.
		const ready = await this.db
			.prepare(
				`UPDATE candidate_continuations SET state='ready',messagesDigest=?,readyAt=? WHERE id=? AND state='pending'
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=?) OR (f.targetKind='workspace_session' AND f.targetId IN (?,?)))`,
			)
			.bind(
				imported.messagesDigest,
				this.now(),
				row.id,
				input.projectId,
				input.sourceSessionId,
				row.destinationSessionId,
			)
			.run();
		if (!ready.meta.changes) reject("archive_not_found", 404);
		return { sessionId: row.destinationSessionId, state: "ready" };
	}

	/**
	 * Deletion's first durable transition fences the project and every
	 * session in it, closes admission, cancels undelivered work, settles
	 * pending assistants and records the cleanup intent, all in one batch.
	 * Runtime authority, project values and model admission all read these
	 * fences, so nothing privileged starts after this commit. Cleanup then
	 * runs as a retryable job; a failure leaves the project deleting and
	 * fenced, never ready. The user's Codex connection is untouched.
	 */
	async deleteProject(
		userId: string,
		projectId: string,
	): Promise<{ status: "deleted" | "deleting" }> {
		const now = this.now();
		// Legacy sessions keep their own cleanup path; a mixed project is refused.
		const legacy = await this.db
			.prepare(
				"SELECT 1 FROM workspace_sessions s JOIN projects p ON p.id=s.projectId WHERE p.id=? AND p.userId=? AND s.runtimeOwner!='pi_durable_v1' LIMIT 1",
			)
			.bind(projectId, userId)
			.first();
		if (legacy) reject("runtime_owner_mismatch", 412);
		const owned = "SELECT 1 FROM projects WHERE id=? AND userId=?";
		const q = (sql: string, ...args: (string | number | null)[]) =>
			this.db.prepare(sql).bind(...args);
		const [, , , , , , job] = await this.db.batch([
			q(
				`INSERT OR IGNORE INTO runtime_deleted_target_fences(targetKind,targetId,lastOwnerVersion,deletedAt) SELECT 'project',id,1,? FROM projects WHERE id=? AND userId=?`,
				now,
				projectId,
				userId,
			),
			q(
				"INSERT OR IGNORE INTO runtime_deleted_target_fences(targetKind,targetId,lastOwnerVersion,deletedAt) SELECT 'workspace_session',s.id,s.runtimeOwnerVersion,? FROM workspace_sessions s JOIN projects p ON p.id=s.projectId WHERE p.id=? AND p.userId=? AND s.userId=p.userId",
				now,
				projectId,
				userId,
			),
			q(
				"UPDATE projects SET status='deleting',updated_at=unixepoch() WHERE id=? AND userId=?",
				projectId,
				userId,
			),
			q(
				`UPDATE workspace_runtime_work SET status='cancelled',deliveryState='failed' WHERE projectId=? AND userId=? AND runtimeOwner='pi_durable_v1' AND deliveryState IN ('pending','leased') AND EXISTS(${owned})`,
				projectId,
				userId,
				projectId,
				userId,
			),
			q(
				`UPDATE messages SET status='failed' WHERE projectId=? AND userId=? AND role='assistant' AND status='pending' AND EXISTS(${owned})`,
				projectId,
				userId,
				projectId,
				userId,
			),
			q(
				`INSERT OR IGNORE INTO runtime_cleanup_jobs(id,targetKind,targetId,state,retryAt,attempts,createdAt) SELECT 'project:'||id,'project',id,'pending',NULL,0,? FROM projects WHERE id=? AND userId=?`,
				now,
				projectId,
				userId,
			),
			q(
				`SELECT j.id FROM runtime_cleanup_jobs j JOIN projects p ON p.id=j.targetId WHERE j.id=? AND p.userId=? AND p.status='deleting'`,
				`project:${projectId}`,
				userId,
			),
		]);
		if (!job.results.length) reject("not_found", 404);
		try {
			await this.runJob(`project:${projectId}`);
		} catch {
			return { status: "deleting" };
		}
		return { status: "deleted" };
	}

	/** Runs due cleanup jobs; each failure is retried later with backoff. */
	async cleanup(limit = 25) {
		const jobs = await this.db
			.prepare(
				"SELECT id FROM runtime_cleanup_jobs WHERE state IN ('pending','failed') AND (retryAt IS NULL OR retryAt<=?) ORDER BY createdAt LIMIT ?",
			)
			.bind(this.now(), limit)
			.all<{ id: string }>();
		let failed = 0;
		for (const { id } of jobs.results)
			try {
				await this.runJob(id);
			} catch {
				failed++;
			}
		return { ran: jobs.results.length, failed };
	}

	private async runJob(id: string) {
		const job = await this.db
			.prepare("SELECT * FROM runtime_cleanup_jobs WHERE id=?")
			.bind(id)
			.first<{
				id: string;
				targetKind: "project" | "workspace_session";
				targetId: string;
				state: string;
				attempts: number;
			}>();
		if (!job || job.state === "complete") return;
		try {
			if (job.targetKind === "workspace_session" && id.startsWith("executor:"))
				await this.teardownExecutor(job.targetId);
			else if (job.targetKind === "project")
				await this.cleanupProject(job.targetId);
			else throw new Error("Unknown cleanup job");
		} catch (error) {
			const delay = Math.min(RETRY_MS * 2 ** job.attempts, MAX_RETRY_MS);
			await this.db
				.prepare(
					"UPDATE runtime_cleanup_jobs SET state='failed',attempts=attempts+1,retryAt=? WHERE id=? AND state!='complete'",
				)
				.bind(this.now() + delay, id)
				.run();
			throw error;
		}
		await this.db
			.prepare(
				"UPDATE runtime_cleanup_jobs SET state='complete',retryAt=NULL WHERE id=?",
			)
			.bind(id)
			.run();
	}

	/**
	 * Destroys a retired session executor and releases its execution slot
	 * only with termination evidence. Without it the slot stays held and the
	 * job retries; an isolated but live executor keeps counting.
	 */
	private async teardownExecutor(sessionId: string) {
		const identities = await this.db
			.prepare(
				"SELECT id,incarnationId,sandboxId,userId,projectId,state FROM sandbox_identities WHERE workspaceSessionId=? AND kind='workspace_session' AND controllerNamespace='fixture-pi-durable-execution-v1'",
			)
			.bind(sessionId)
			.all<{
				id: string;
				incarnationId: string | null;
				sandboxId: string;
				userId: string;
				projectId: string;
				state: string;
			}>();
		for (const identity of identities.results) {
			if (identity.state === "destroyed") continue;
			// Retire before destroying, so a late caller cannot revive it.
			await this.db.batch([
				this.db
					.prepare(
						"UPDATE sandbox_identities SET state='destroying',retiredAt=coalesce(retiredAt,unixepoch()),updated_at=unixepoch() WHERE id=? AND state!='destroyed'",
					)
					.bind(identity.id),
				this.db
					.prepare(
						"INSERT OR IGNORE INTO runtime_retired_identity_fences(identityId,lifecycleGeneration,retiredAt) SELECT id,lifecycleGeneration,? FROM sandbox_identities WHERE id=?",
					)
					.bind(this.now(), identity.id),
			]);
			const result = await this.runtime.terminateExecutor({
				identityId: identity.id,
				incarnationId: identity.incarnationId ?? "",
				sandboxId: identity.sandboxId,
				workspaceSessionId: sessionId,
				userId: identity.userId,
				projectId: identity.projectId,
			});
			if (!result.terminated)
				throw new Error("Executor termination is not proven");
			if (identity.incarnationId)
				await this.capacity.release(
					"executor",
					executorOwnerKey(identity.id, identity.incarnationId),
					{ terminated: true, source: "executor_destroyed" },
				);
			await this.db
				.prepare(
					"UPDATE sandbox_identities SET state='destroyed',updated_at=unixepoch() WHERE id=?",
				)
				.bind(identity.id)
				.run();
		}
	}

	/**
	 * Removes a fenced project's candidate content: executors with evidence,
	 * runtime storage, then product rows. Deletion and retirement fences,
	 * released capacity evidence and the job itself remain.
	 */
	private async cleanupProject(projectId: string) {
		const project = await this.db
			.prepare(
				"SELECT p.userId FROM projects p WHERE p.id=? AND p.status='deleting' AND EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE f.targetKind='project' AND f.targetId=p.id)",
			)
			.bind(projectId)
			.first<{ userId: string }>();
		if (!project) {
			// A completed cleanup already removed the row; the fence remains.
			if (
				await this.db
					.prepare(
						"SELECT 1 FROM runtime_deleted_target_fences WHERE targetKind='project' AND targetId=?",
					)
					.bind(projectId)
					.first()
			)
				return;
			throw new Error("Project is not fenced for deletion");
		}
		const sessions = await this.db
			.prepare(
				"SELECT id FROM workspace_sessions WHERE projectId=? AND runtimeOwner='pi_durable_v1'",
			)
			.bind(projectId)
			.all<{ id: string }>();
		for (const session of sessions.results) {
			await this.teardownExecutor(session.id);
			await this.runtime.purgeSession({
				userId: project.userId,
				projectId,
				workspaceSessionId: session.id,
			});
		}
		const ids = JSON.stringify(sessions.results.map((session) => session.id));
		const q = (sql: string, ...args: (string | number | null)[]) =>
			this.db.prepare(sql).bind(...args);
		const inSessions = "IN (SELECT value FROM json_each(?))";
		await this.db.batch([
			q(
				`DELETE FROM session_command_keys WHERE commandId IN (SELECT id FROM session_commands WHERE sessionId ${inSessions})`,
				ids,
			),
			q(
				`DELETE FROM runtime_command_memberships WHERE sessionId ${inSessions}`,
				ids,
			),
			q(
				`DELETE FROM candidate_command_decisions WHERE sessionId ${inSessions}`,
				ids,
			),
			q(
				`DELETE FROM workspace_runtime_work WHERE sessionId ${inSessions}`,
				ids,
			),
			q(`DELETE FROM session_commands WHERE sessionId ${inSessions}`, ids),
			q(
				`DELETE FROM session_command_sequences WHERE sessionId ${inSessions}`,
				ids,
			),
			q(
				`DELETE FROM runtime_checkpoint_pointers WHERE sessionId ${inSessions}`,
				ids,
			),
			q(
				`DELETE FROM candidate_restore_barriers WHERE sessionId ${inSessions}`,
				ids,
			),
			q(`DELETE FROM candidate_archives WHERE sessionId ${inSessions}`, ids),
			q("DELETE FROM candidate_continuations WHERE projectId=?", projectId),
			q("DELETE FROM candidate_workspace_claims WHERE projectId=?", projectId),
			q(`DELETE FROM messages WHERE sessionId ${inSessions}`, ids),
			q(
				"DELETE FROM sandbox_identities WHERE projectId=? AND kind='workspace_session' AND state='destroyed'",
				projectId,
			),
			q("DELETE FROM projects WHERE id=? AND status='deleting'", projectId),
		]);
	}
}
