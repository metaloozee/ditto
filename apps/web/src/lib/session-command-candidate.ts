import {
	type CheckpointProjectionResultV1,
	parseCheckpointProjectionsV1,
} from "../../../../packages/runtime-contracts/src/checkpoint.js";
import type { ConfigurationSelectionV1 } from "../../../../packages/runtime-contracts/src/configuration.js";
import {
	type ModelSubjectV1,
	parseSyntheticAccountV1,
} from "../../../../packages/runtime-contracts/src/model.js";
import {
	type BrowserCommandV2,
	CANDIDATE_QUEUE_TTL_MS,
	type CommandV2,
	parseBrowserCommandV2,
	parseCommandHandoffAckV2,
	parseCommandV2,
	parseQueueDecisionV2,
	parseReceiptV2,
	type QueueDecisionV2,
	type ReceiptV2,
} from "../../../../packages/runtime-contracts/src/product-command.js";
import {
	PROJECTION_LIMITS,
	type ProjectionResultV1,
	parseProjectionIntentsV1,
	type RuntimeObservationV1,
} from "../../../../packages/runtime-contracts/src/projection.js";
import {
	applyProductProjectionBatch,
	type ProjectionPayload,
} from "../../../runtime/src/product-projector.js";
import {
	CANDIDATE_MODEL_POLICY,
	ModelProductAuthority,
} from "./model-product-authority";
import { redactSecrets } from "./secret-redaction";
import {
	SESSION_RUNTIME_CALL_TIMEOUT_MS,
	withSessionRuntimeCallTimeout,
} from "./session-runtime-client";
export class CandidateCommandError extends Error {
	constructor(
		readonly code: string,
		readonly status = 409,
	) {
		super(code);
		this.name = "CandidateCommandError";
	}
}

export interface CandidateAdmissionRuntime {
	readSelection(
		subject: ModelSubjectV1,
	): Promise<ConfigurationSelectionV1 | null>;
	targetStatus(
		subject: ModelSubjectV1,
		runId: string,
	): Promise<{
		ownerVersion: number;
		runId: string;
		state: "not_delivered" | "nonterminal" | "terminal";
	}>;
	observe?(
		subject: ModelSubjectV1,
		cursor?: number,
	): Promise<RuntimeObservationV1>;
}
export interface CandidateCredentialStatus {
	status(owner: string): Promise<{ status: string; generation: number }>;
}
type Row = {
	id: string;
	sessionId: string;
	projectId: string;
	userId: string;
	kind: string;
	commandSeq: number;
	payloadVersion: number;
	userMessageId: string | null;
	assistantMessageId: string | null;
	targetRunId: string | null;
	targetCommandId: string | null;
	payloadDigest: string;
	acceptedAt: number;
	deadlineAt: number;
	receiptId: string;
	canonicalPayloadHash: string;
};
function reject(code: string, status = 409): never {
	throw new CandidateCommandError(code, status);
}
function canonical(input: BrowserCommandV2) {
	return JSON.stringify(
		Object.fromEntries(
			Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
		),
	);
}
async function digest(input: string) {
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
		),
		(x) => x.toString(16).padStart(2, "0"),
	).join("");
}
function receipt(row: Row): ReceiptV2 {
	return parseReceiptV2({
		version: 2,
		commandId: row.id,
		receiptId: row.receiptId,
		workspaceSessionId: row.sessionId,
		commandSeq: row.commandSeq,
		ownerVersion: 1,
		queueDeadlineAt: row.deadlineAt,
		...(row.userMessageId
			? {
					userMessageId: row.userMessageId,
					assistantMessageId: row.assistantMessageId,
				}
			: {}),
	});
}
/** Complete PEM blocks are redacted already; an unterminated one is cut. */
function redactProjectionContent(text: string) {
	const redacted = redactSecrets(text);
	const open = redacted.search(/-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/);
	return open < 0 ? redacted : `${redacted.slice(0, open)}[REDACTED]`;
}
const ownedSessionSql = `SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace
FROM workspace_sessions s JOIN projects p ON p.id=s.projectId
JOIN sandbox_identities i ON i.id=s.sandboxIdentityId
JOIN candidate_workspace_claims q ON q.sessionId=s.id AND q.identityId=i.id AND q.userId=s.userId AND q.projectId=s.projectId
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId
AND s.status='active' AND p.status='ready' AND s.runtimeOwner='pi_durable_v1'
AND s.runtimeOwnerVersion=1 AND s.runtimeProtocolVersion=2 AND s.brainIdentityId IS NULL
AND i.kind='workspace_session' AND i.workspaceSessionId=s.id AND i.userId=s.userId AND i.projectId=s.projectId
AND i.controllerClass='Sandbox' AND i.controllerNamespace='fixture-pi-durable-execution-v1'
AND i.lifecycleGeneration=1 AND i.state='ready' AND i.retiredAt IS NULL
AND NOT EXISTS(SELECT 1 FROM runtime_retired_identity_fences f WHERE f.identityId=i.id)
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`;

export type CandidateAuthorityRow = {
	identityId: string;
	incarnationId: string;
	lifecycleGeneration: number;
	controllerNamespace: string;
	liveExecutors: number;
};
type CandidateExpectedExecutor = Pick<
	ModelSubjectV1,
	"identityId" | "incarnationId" | "controllerNamespace" | "lifecycleGeneration"
>;

export function prepareCandidateRuntimeAuthority(
	db: D1Database,
	userId: string,
	projectId: string,
	sessionId: string,
) {
	const query = ownedSessionSql.replace(
		"SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace",
		"SELECT i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace,(SELECT count(*) FROM sandbox_identities WHERE kind='workspace_session' AND controllerClass='Sandbox' AND controllerNamespace='fixture-pi-durable-execution-v1' AND state='ready' AND retiredAt IS NULL) AS liveExecutors",
	);
	return db
		.prepare(`${query} AND s.runtimeFailureReasonCode IS NULL`)
		.bind(sessionId, userId, projectId);
}

export function validateCandidateRuntimeAuthority(
	row: CandidateAuthorityRow | null,
	expected?: CandidateExpectedExecutor,
) {
	return {
		current:
			!!row &&
			row.liveExecutors === 1 &&
			(!expected ||
				(row.identityId === expected.identityId &&
					row.incarnationId === expected.incarnationId &&
					row.controllerNamespace === expected.controllerNamespace &&
					row.lifecycleGeneration === expected.lifecycleGeneration)),
		generation: 1,
		executor: row?.lifecycleGeneration ?? 1,
		liveExecutors: row?.liveExecutors ?? 0,
	};
}

type CandidateOwnedRow = {
	identityId: string;
	incarnationId: string;
	lifecycleGeneration: number;
	controllerNamespace: string;
};

export class CandidateProductCommands {
	private policy: ModelProductAuthority;
	constructor(
		private db: D1Database,
		private runtime: CandidateAdmissionRuntime,
		private credential: (owner: string) => CandidateCredentialStatus,
		private now: () => number = Date.now,
		private createId: () => string = () => crypto.randomUUID(),
	) {
		this.policy = new ModelProductAuthority(db, now, CANDIDATE_MODEL_POLICY);
	}
	private key(userId: string, input: BrowserCommandV2) {
		return this.db
			.prepare(`SELECT c.*,k.receiptId,k.canonicalPayloadHash FROM session_command_keys k JOIN session_commands c ON c.id=k.commandId
WHERE k.userId=? AND k.targetKind=? AND k.targetId=? AND k.idempotencyKey=?`)
			.bind(
				userId,
				input.sessionId ? "workspace_session" : "project",
				input.sessionId ?? input.projectId,
				input.idempotencyKey,
			)
			.first<Row>();
	}
	private prepareOwned(userId: string, projectId: string, sessionId: string) {
		return this.db.prepare(ownedSessionSql).bind(sessionId, userId, projectId);
	}
	private async owned(userId: string, projectId: string, sessionId: string) {
		const row = await this.prepareOwned(
			userId,
			projectId,
			sessionId,
		).first<CandidateOwnedRow>();
		if (!row) reject("runtime_owner_mismatch");
		return row;
	}
	private async subject(
		userId: string,
		projectId: string,
		sessionId: string,
	): Promise<ModelSubjectV1> {
		const [owned, capabilities] = await this.db.batch<unknown>([
			this.prepareOwned(userId, projectId, sessionId),
			this.db
				.prepare(
					"SELECT snapshot FROM codex_fixture_capabilities WHERE userId=?",
				)
				.bind(userId),
		]);
		const row = owned.results[0] as CandidateOwnedRow | undefined;
		if (!row) reject("runtime_owner_mismatch");
		const cap = capabilities.results[0] as { snapshot: string } | undefined;
		if (!cap) reject("model_unconfigured");
		const account = parseSyntheticAccountV1(cap.snapshot);
		return {
			version: 1,
			userId,
			projectId,
			workspaceSessionId: sessionId,
			identityId: row.identityId,
			incarnationId: row.incarnationId,
			controllerNamespace: row.controllerNamespace,
			lifecycleGeneration: row.lifecycleGeneration,
			runtimeOwnerVersion: 1,
			connectionGeneration: account.generation,
			capabilityRevision: account.revision,
		};
	}
	async admit(userId: string, value: unknown): Promise<ReceiptV2> {
		const input = parseBrowserCommandV2(value),
			hash = await digest(canonical(input));
		const existing = await this.key(userId, input);
		if (existing) {
			await this.owned(userId, input.projectId, existing.sessionId);
			if (
				existing.payloadVersion !== 2 ||
				existing.canonicalPayloadHash !== hash
			)
				reject("conflict");
			return receipt(existing);
		}
		const first = input.kind === "prompt" && !input.sessionId;
		let readiness: {
			generation: number;
			revision: number;
			snapshot: string;
		} | null = null;
		let subject: ModelSubjectV1 | undefined;
		const identity = input.sessionId
			? await this.owned(userId, input.projectId, input.sessionId)
			: undefined;
		if (
			input.sessionId &&
			(input.kind === "prompt" || input.kind === "follow_up")
		)
			subject = await this.subject(userId, input.projectId, input.sessionId);
		if (input.kind === "prompt" || input.kind === "follow_up") {
			const status = await this.credential(userId).status(userId);
			if (status.status !== "connected") reject("model_unconfigured");
			const selection = subject
				? await this.runtime.readSelection(subject)
				: null;
			readiness = await this.policy.preSessionReadiness(
				userId,
				input.projectId,
				selection ?? { model: "faux-1", thinking: "off" },
			);
			if (!readiness || readiness.generation !== status.generation)
				reject("model_unconfigured");
			if (subject) {
				if (
					!(await this.policy.ownedConfiguration(
						subject,
						{
							version: 1,
							projectId: input.projectId,
							workspaceSessionId: input.sessionId!,
							ownerVersion: 1,
						},
						selection ?? { model: "faux-1", thinking: "off" },
					))
				)
					reject("model_unconfigured");
			}
		}
		if (input.kind === "follow_up" || input.kind === "stop") {
			const target = await this.db
				.prepare(
					"SELECT id FROM session_commands WHERE id=? AND sessionId=? AND userId=? AND projectId=? AND kind='prompt' AND payloadVersion=2",
				)
				.bind(input.targetRunId, input.sessionId, userId, input.projectId)
				.first();
			if (!target) reject("invalid_target");
			if (input.kind === "follow_up") {
				const state = await this.runtime.targetStatus(
					subject!,
					input.targetRunId,
				);
				if (state.ownerVersion !== 1 || state.runId !== input.targetRunId)
					reject("runtime_owner_mismatch");
				if (state.state === "terminal") reject("target_run_terminal");
			}
		}
		if (
			input.kind === "cancel" &&
			!(await this.db
				.prepare(
					"SELECT id FROM session_commands WHERE id=? AND sessionId=? AND userId=? AND projectId=? AND kind IN ('prompt','follow_up') AND payloadVersion=2",
				)
				.bind(input.targetCommandId, input.sessionId, userId, input.projectId)
				.first())
		)
			reject("invalid_target");
		const sessionId = input.sessionId ?? this.createId(),
			commandId = this.createId(),
			receiptId = this.createId();
		const identityId = first ? this.createId() : identity!.identityId,
			incarnationId = first ? this.createId() : identity!.incarnationId;
		const acceptedAt = this.now(),
			deadlineAt = acceptedAt + CANDIDATE_QUEUE_TTL_MS;
		const pair = input.kind === "prompt" || input.kind === "follow_up";
		const userMessageId = pair ? this.createId() : null,
			assistantMessageId = pair ? this.createId() : null;
		const statements: D1PreparedStatement[] = [];
		const q = (sql: string, ...args: (string | number | null)[]) =>
			this.db.prepare(sql).bind(...args);
		if (first) {
			statements.push(
				q(
					`INSERT INTO candidate_workspace_claims(id,sessionId,identityId,userId,projectId,createdAt)
SELECT 1,?,?,?,?,? FROM projects p JOIN codex_connections k ON k.user_id=p.userId JOIN codex_fixture_capabilities e ON e.userId=p.userId
WHERE p.id=? AND p.userId=? AND p.status='ready' AND k.status='connected' AND k.revoked=0
AND k.generation=? AND e.generation=k.generation AND e.revision=? AND e.snapshot=?
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE f.targetKind='project' AND f.targetId=p.id)`,
					sessionId,
					identityId,
					userId,
					input.projectId,
					acceptedAt,
					input.projectId,
					userId,
					readiness!.generation,
					readiness!.revision,
					readiness!.snapshot,
				),
			);
			statements.push(
				q(
					`INSERT INTO workspace_sessions(id,projectId,userId,title,status,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion,runtimeProtocolVersion)
SELECT sessionId,projectId,userId,'Synthetic session','active',identityId,'pi_durable_v1',1,2 FROM candidate_workspace_claims WHERE sessionId=? AND identityId=?`,
					sessionId,
					identityId,
				),
			);
			statements.push(
				q(
					`INSERT INTO sandbox_identities(id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,state,controllerClass,controllerNamespace,incarnationId)
SELECT identityId,'workspace_session',identityId,identityId,userId,projectId,sessionId,'ready','Sandbox','fixture-pi-durable-execution-v1',? FROM candidate_workspace_claims WHERE sessionId=? AND identityId=?`,
					incarnationId,
					sessionId,
					identityId,
				),
			);
		}
		statements.push(
			q(
				"INSERT OR IGNORE INTO runtime_checkpoint_pointers(sessionId,runtimeOwnerVersion,currentPairId,previousPairId,mutationGeneration,updatedAt) SELECT id,runtimeOwnerVersion,NULL,NULL,0,? FROM workspace_sessions WHERE id=? AND runtimeOwner='pi_durable_v1'",
				acceptedAt,
				sessionId,
			),
		);
		statements.push(
			q(
				"INSERT OR IGNORE INTO session_command_sequences(sessionId,nextSequence,updatedAt) SELECT id,1,? FROM workspace_sessions WHERE id=? AND runtimeOwner='pi_durable_v1'",
				acceptedAt,
				sessionId,
			),
		);
		const gate = ownedSessionSql.replace(
			"SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace",
			"SELECT 1",
		);
		statements.push(
			q(
				`INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetRunId,targetCommandId,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt)
SELECT ?,?,'workspace_session',?,?,?, ?,nextSequence,?,?,2,?,?,?,?,? FROM session_command_sequences WHERE sessionId=? AND EXISTS(${gate})
AND (?=0 OR EXISTS(SELECT 1 FROM codex_connections k JOIN codex_fixture_capabilities e ON e.userId=k.user_id WHERE k.user_id=? AND k.status='connected' AND k.revoked=0 AND k.generation=? AND e.generation=k.generation AND e.revision=? AND e.snapshot=?))`,
				commandId,
				userId,
				sessionId,
				input.projectId,
				sessionId,
				input.kind,
				input.kind === "follow_up" || input.kind === "stop"
					? input.targetRunId
					: null,
				input.kind === "cancel" ? input.targetCommandId : null,
				userMessageId,
				assistantMessageId,
				hash,
				acceptedAt,
				deadlineAt,
				sessionId,
				sessionId,
				userId,
				input.projectId,
				pair ? 1 : 0,
				userId,
				readiness?.generation ?? 0,
				readiness?.revision ?? 0,
				readiness?.snapshot ?? "",
			),
		);
		if (pair) {
			statements.push(
				q(
					"INSERT INTO messages(id,sessionId,projectId,userId,role,content,status) SELECT userMessageId,sessionId,projectId,userId,'user',?,'complete' FROM session_commands WHERE id=?",
					input.kind === "prompt" || input.kind === "follow_up"
						? input.text
						: "",
					commandId,
				),
			);
			statements.push(
				q(
					"INSERT INTO messages(id,sessionId,projectId,userId,role,content,status) SELECT assistantMessageId,sessionId,projectId,userId,'assistant','','pending' FROM session_commands WHERE id=?",
					commandId,
				),
			);
		}
		statements.push(
			q(
				"UPDATE session_command_sequences SET nextSequence=nextSequence+1,updatedAt=? WHERE sessionId=? AND EXISTS(SELECT 1 FROM session_commands WHERE id=?)",
				acceptedAt,
				sessionId,
				commandId,
			),
		);
		statements.push(
			q(
				"INSERT INTO session_command_keys(id,userId,targetKind,targetId,idempotencyKey,commandKind,canonicalPayloadHash,commandId,receiptId,createdAt) SELECT ?,userId,?,?,?,?,?,id,?,acceptedAt FROM session_commands WHERE id=?",
				this.createId(),
				input.sessionId ? "workspace_session" : "project",
				input.sessionId ?? input.projectId,
				input.idempotencyKey,
				input.kind,
				hash,
				receiptId,
				commandId,
			),
		);
		statements.push(
			q(
				`INSERT INTO workspace_runtime_work(id,fifoSeq,identityId,sessionId,projectId,userId,intent,payload,status,queueExpiresAt,userMessageId,assistantMessageId,protocolVersion,runtimeOwner,runtimeOwnerVersion,commandId,deliveryState)
SELECT ?,coalesce((SELECT max(fifoSeq) FROM workspace_runtime_work),0)+1,?,sessionId,projectId,userId,'agent_run',?,'queued',?,userMessageId,assistantMessageId,2,'pi_durable_v1',1,id,'pending' FROM session_commands WHERE id=?`,
				this.createId(),
				identityId,
				JSON.stringify({ commandKind: input.kind }),
				Math.floor(deadlineAt / 1000),
				commandId,
			),
		);
		try {
			await this.db.batch(statements);
		} catch (error) {
			const raced = await this.key(userId, input);
			if (raced) {
				await this.owned(userId, input.projectId, raced.sessionId);
				if (raced.payloadVersion !== 2 || raced.canonicalPayloadHash !== hash)
					reject("conflict");
				return receipt(raced);
			}
			if (
				first &&
				(await this.db
					.prepare("SELECT id FROM candidate_workspace_claims WHERE id=1")
					.first())
			)
				reject("fixture_capacity_exhausted");
			throw error;
		}
		const row = await this.key(userId, input);
		if (!row) reject("runtime_owner_mismatch");
		return receipt(row);
	}

	async subjectForCommand(commandId: string, ownerVersion: number) {
		const command = await this.reconstruct(commandId, ownerVersion);
		if (!command) return null;
		return this.subject(
			command.userId,
			command.projectId,
			command.workspaceSessionId,
		);
	}

	async drain(
		deliver: (
			sessionId: string,
			commandId: string,
			ownerVersion: number,
		) => Promise<unknown>,
	) {
		const started = this.now();
		const rows = await this.db
			.prepare(`SELECT w.id,w.commandId,w.deliveryAttempts FROM workspace_runtime_work w JOIN session_commands c ON c.id=w.commandId
WHERE w.runtimeOwner='pi_durable_v1' AND w.runtimeOwnerVersion=1 AND w.protocolVersion=2 AND w.deliveryState IN ('pending','leased') AND (w.deliveryLeaseExpiresAt IS NULL OR w.deliveryLeaseExpiresAt<=?)
ORDER BY CASE WHEN c.kind IN ('stop','cancel') THEN 0 ELSE 1 END,c.commandSeq LIMIT 25`)
			.bind(started)
			.all<{ id: string; commandId: string; deliveryAttempts: number }>();
		for (const row of rows.results) {
			if (this.now() - started >= 20000) break;
			const token = this.createId();
			const leased = await this.db
				.prepare(
					`UPDATE workspace_runtime_work SET deliveryState='leased',deliveryLeaseToken=?,deliveryLeaseExpiresAt=? WHERE id=? AND runtimeOwner='pi_durable_v1' AND runtimeOwnerVersion=1 AND protocolVersion=2 AND deliveryState IN ('pending','leased') AND (deliveryLeaseExpiresAt IS NULL OR deliveryLeaseExpiresAt<=?)`,
				)
				.bind(
					token,
					this.now() + SESSION_RUNTIME_CALL_TIMEOUT_MS,
					row.id,
					this.now(),
				)
				.run();
			if (leased.meta.changes !== 1) continue;
			try {
				const command = await this.reconstruct(row.commandId, 1);
				if (!command) throw new Error("Candidate command unavailable");
				const ack = parseCommandHandoffAckV2(
					await withSessionRuntimeCallTimeout(
						() => deliver(command.workspaceSessionId, command.commandId, 1),
						Math.min(
							SESSION_RUNTIME_CALL_TIMEOUT_MS,
							20000 - (this.now() - started),
						),
						{ now: this.now },
					),
				);
				if (
					ack.commandId !== command.commandId ||
					ack.ownerVersion !== 1 ||
					ack.acceptedPosition !== command.commandSeq ||
					ack.receiptId !== command.receiptId
				)
					throw new Error("Candidate handoff mismatch");
				await this.db
					.prepare(
						"UPDATE workspace_runtime_work SET deliveryState='delivered',deliveryLeaseToken=NULL,deliveryLeaseExpiresAt=NULL WHERE id=? AND deliveryLeaseToken=? AND runtimeOwner='pi_durable_v1'",
					)
					.bind(row.id, token)
					.run();
			} catch {
				const attempts = row.deliveryAttempts + 1;
				await this.db
					.prepare(
						"UPDATE workspace_runtime_work SET deliveryState='pending',deliveryLeaseToken=NULL,deliveryLeaseExpiresAt=?,deliveryAttempts=? WHERE id=? AND deliveryLeaseToken=? AND runtimeOwner='pi_durable_v1'",
					)
					.bind(
						this.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts - 1, 6)),
						attempts,
						row.id,
						token,
					)
					.run();
			}
		}
	}

	async runtimeAuthority(
		userId: string,
		projectId: string,
		sessionId: string,
		expected?: Pick<
			ModelSubjectV1,
			| "identityId"
			| "incarnationId"
			| "controllerNamespace"
			| "lifecycleGeneration"
		>,
	) {
		try {
			const row = await prepareCandidateRuntimeAuthority(
				this.db,
				userId,
				projectId,
				sessionId,
			).first<CandidateAuthorityRow>();
			return validateCandidateRuntimeAuthority(row, expected);
		} catch {
			return { current: false, generation: 1, executor: 1, liveExecutors: 0 };
		}
	}

	async reconcileDecision(
		commandId: string,
		ownerVersion: number,
		value: unknown,
	): Promise<boolean> {
		let input: QueueDecisionV2;
		try {
			input = parseQueueDecisionV2(value);
		} catch {
			return false;
		}
		if (input.commandId !== commandId || input.ownerVersion !== ownerVersion)
			return false;
		const command = await this.reconstruct(commandId, ownerVersion);
		if (!command || (command.kind !== "prompt" && command.kind !== "follow_up"))
			return false;
		const runId =
			command.kind === "prompt" ? command.commandId : command.targetRunId;
		if (
			input.runId !== runId ||
			!Number.isSafeInteger(input.runEpoch) ||
			input.runEpoch < 1 ||
			!Number.isSafeInteger(input.decidedAt) ||
			input.decidedAt > this.now() ||
			input.decidedAt < command.acceptedAt ||
			input.queueDeadlineAt !== command.deadlineAt ||
			input.payloadDigest !== command.payloadDigest ||
			(input.decision !== "started" && input.decision !== "expired") ||
			(input.decision === "started"
				? input.decidedAt >= command.deadlineAt
				: input.decidedAt < command.deadlineAt)
		)
			return false;
		const identity = await this.owned(
			command.userId,
			command.projectId,
			command.workspaceSessionId,
		);
		await this.db.batch([
			this.db
				.prepare(`INSERT OR IGNORE INTO candidate_command_decisions(commandId,sessionId,ownerVersion,identityId,runId,runEpoch,payloadDigest,queueDeadlineAt,decision,decidedAt)
SELECT ?,?,1,?,?,?,?,?,?,? WHERE EXISTS(${ownedSessionSql.replace("SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace", "SELECT 1")})`)
				.bind(
					commandId,
					command.workspaceSessionId,
					identity.identityId,
					runId,
					input.runEpoch,
					command.payloadDigest,
					command.deadlineAt,
					input.decision,
					input.decidedAt,
					command.workspaceSessionId,
					command.userId,
					command.projectId,
				),
			this.db
				.prepare(`INSERT OR IGNORE INTO runtime_command_memberships(commandId,sessionId,runId,userMessageId,assistantMessageId,runEpoch)
SELECT c.id,c.sessionId,?,c.userMessageId,c.assistantMessageId,? FROM session_commands c JOIN candidate_command_decisions q ON q.commandId=c.id
WHERE c.id=? AND q.runId=? AND q.runEpoch=? AND q.payloadDigest=c.payloadDigest AND q.decision=? AND q.decidedAt=?`)
				.bind(
					runId,
					input.runEpoch,
					commandId,
					runId,
					input.runEpoch,
					input.decision,
					input.decidedAt,
				),
		]);
		const row = await this.db
			.prepare(`SELECT q.*,m.userMessageId,m.assistantMessageId FROM candidate_command_decisions q JOIN runtime_command_memberships m ON m.commandId=q.commandId
WHERE q.commandId=? AND m.sessionId=q.sessionId AND m.runId=q.runId AND m.runEpoch=q.runEpoch`)
			.bind(commandId)
			.first<Record<string, unknown>>();
		return (
			!!row &&
			row.sessionId === command.workspaceSessionId &&
			row.identityId === identity.identityId &&
			row.ownerVersion === ownerVersion &&
			row.runId === runId &&
			row.runEpoch === input.runEpoch &&
			row.payloadDigest === command.payloadDigest &&
			row.queueDeadlineAt === command.deadlineAt &&
			row.decision === input.decision &&
			row.decidedAt === input.decidedAt &&
			row.userMessageId === command.userMessageId &&
			row.assistantMessageId === command.assistantMessageId
		);
	}

	/**
	 * Update-only application of committed runtime terminal decisions. Content
	 * is redacted here, before it reaches product storage.
	 */
	async applyProjections(
		scope: { userId: string; projectId: string; workspaceSessionId: string },
		value: unknown,
	): Promise<ProjectionResultV1[]> {
		const intents = parseProjectionIntentsV1(value);
		const commands = await this.db
			.prepare(
				`SELECT c.id,c.userMessageId,c.assistantMessageId,EXISTS(SELECT 1 FROM runtime_command_memberships m WHERE m.commandId=c.id) AS member
FROM session_commands c WHERE c.sessionId=? AND c.userId=? AND c.projectId=? AND c.id IN (SELECT value FROM json_each(?))`,
			)
			.bind(
				scope.workspaceSessionId,
				scope.userId,
				scope.projectId,
				JSON.stringify(intents.map((intent) => intent.commandId)),
			)
			.all<{
				id: string;
				userMessageId: string | null;
				assistantMessageId: string | null;
				member: number;
			}>();
		const byId = new Map(commands.results.map((row) => [row.id, row]));
		const base = {
			workspaceSessionId: scope.workspaceSessionId,
			userId: scope.userId,
			projectId: scope.projectId,
			ownerVersion: 1,
		};
		const payloads: ProjectionPayload[] = [];
		const targets: (number | ProjectionResultV1["outcome"])[] = [];
		for (const intent of intents) {
			const command = byId.get(intent.commandId);
			if (
				!command ||
				command.assistantMessageId !== intent.assistantMessageId
			) {
				targets.push("blocked_membership");
				continue;
			}
			// An expiry decision supplies its own membership; wait for it.
			if (!command.member && intent.reason === "command_expired") {
				targets.push("retry");
				continue;
			}
			if (!command.member)
				payloads.push({
					...base,
					targetKind: "membership",
					targetId: intent.commandId,
					coordinatorSeq: intent.projectionVersion,
					commandId: intent.commandId,
					runId: intent.runId,
					runEpoch: intent.runEpoch,
					userMessageId: command.userMessageId ?? undefined,
					assistantMessageId: intent.assistantMessageId,
				});
			targets.push(payloads.length);
			payloads.push({
				...base,
				targetKind: "message",
				targetId: intent.assistantMessageId,
				coordinatorSeq: intent.projectionVersion,
				status: intent.status,
				...(intent.reason ? { reasonCode: intent.reason } : {}),
				commandId: intent.commandId,
				runId: intent.runId,
				...(intent.content === undefined
					? {}
					: { contentRedacted: redactProjectionContent(intent.content) }),
			});
		}
		const applied = await applyProductProjectionBatch(
			this.db,
			payloads,
			this.now(),
			"pi_durable_v1",
		);
		return intents.map((intent, index) => {
			const target = targets[index];
			return {
				assistantMessageId: intent.assistantMessageId,
				projectionVersion: intent.projectionVersion,
				outcome:
					typeof target === "number"
						? (applied[target]?.classification ?? "retry")
						: target,
			};
		});
	}

	/**
	 * Update-only application of committed checkpoint pointer moves. Each move
	 * applies only over the exact generation it replaces; the cursor makes a
	 * repeated move an acknowledgment, not a second write.
	 */
	async applyCheckpointProjections(
		scope: { userId: string; projectId: string; workspaceSessionId: string },
		value: unknown,
	): Promise<CheckpointProjectionResultV1[]> {
		const projections = parseCheckpointProjectionsV1(value);
		// Sessions created before pointer rows existed get their generation-0 row.
		await this.db
			.prepare(
				"INSERT OR IGNORE INTO runtime_checkpoint_pointers(sessionId,runtimeOwnerVersion,currentPairId,previousPairId,mutationGeneration,updatedAt) SELECT id,runtimeOwnerVersion,NULL,NULL,0,? FROM workspace_sessions WHERE id=? AND userId=? AND projectId=? AND runtimeOwner='pi_durable_v1'",
			)
			.bind(this.now(), scope.workspaceSessionId, scope.userId, scope.projectId)
			.run();
		const applied = await applyProductProjectionBatch(
			this.db,
			projections.map((projection) => ({
				targetKind: "session",
				targetId: scope.workspaceSessionId,
				workspaceSessionId: scope.workspaceSessionId,
				userId: scope.userId,
				projectId: scope.projectId,
				ownerVersion: 1,
				coordinatorSeq: projection.projectionVersion,
				currentPairId: projection.currentPairId,
				previousPairId: projection.previousPairId,
				mutationGeneration: projection.mutationGeneration,
				expectedMutationGeneration: projection.expectedMutationGeneration,
			})),
			this.now(),
			"pi_durable_v1",
		);
		return projections.map((projection, index) => ({
			projectionVersion: projection.projectionVersion,
			outcome: applied[index]?.classification ?? "retry",
		}));
	}

	/** Owned observation; the runtime reads committed facts without scheduling. */
	async observe(
		userId: string,
		projectId: string,
		sessionId: string,
		cursor?: number,
	): Promise<RuntimeObservationV1> {
		const subject = await this.subject(userId, projectId, sessionId);
		if (!this.runtime.observe) reject("runtime_unavailable", 503);
		const observation = await this.runtime.observe(subject, cursor);
		if (
			new TextEncoder().encode(JSON.stringify(observation)).byteLength >
			PROJECTION_LIMITS.observationBytes
		)
			reject("observation_too_large", 502);
		return observation;
	}

	async reconstruct(
		commandId: string,
		ownerVersion: number,
	): Promise<CommandV2 | null> {
		if (ownerVersion !== 1) return null;
		const row = await this.db
			.prepare(`SELECT c.*,k.receiptId,k.canonicalPayloadHash FROM session_commands c JOIN session_command_keys k ON k.commandId=c.id
JOIN workspace_runtime_work w ON w.commandId=c.id WHERE c.id=? AND c.payloadVersion=2
AND w.sessionId=c.sessionId AND w.userId=c.userId AND w.projectId=c.projectId AND w.protocolVersion=2 AND w.runtimeOwner='pi_durable_v1' AND w.runtimeOwnerVersion=1
AND w.userMessageId IS c.userMessageId AND w.assistantMessageId IS c.assistantMessageId`)
			.bind(commandId)
			.first<Row>();
		if (!row) return null;
		try {
			const ordinary = row.kind === "prompt" || row.kind === "follow_up";
			const statements = [
				this.prepareOwned(row.userId, row.projectId, row.sessionId),
			];
			if (ordinary) {
				statements.push(
					this.db
						.prepare(`SELECT u.content FROM messages u JOIN messages a ON a.id=? WHERE u.id=? AND u.sessionId=? AND a.sessionId=u.sessionId
AND u.userId=? AND a.userId=u.userId AND u.projectId=? AND a.projectId=u.projectId AND u.role='user' AND a.role='assistant'`)
						.bind(
							row.assistantMessageId,
							row.userMessageId,
							row.sessionId,
							row.userId,
							row.projectId,
						),
				);
			}
			statements.push(
				this.db
					.prepare(
						"SELECT idempotencyKey,targetKind,targetId FROM session_command_keys WHERE commandId=? AND receiptId=? AND userId=?",
					)
					.bind(row.id, row.receiptId, row.userId),
			);
			const results = await this.db.batch<unknown>(statements);
			if (!results[0].results[0]) reject("runtime_owner_mismatch");
			let text: string | undefined;
			if (ordinary) {
				const message = results[1].results[0] as
					| { content: string }
					| undefined;
				if (!message) return null;
				text = message.content;
			}
			const key = results[ordinary ? 2 : 1].results[0] as
				| {
						idempotencyKey: string;
						targetKind: string;
						targetId: string;
				  }
				| undefined;
			if (!key) return null;
			const browser = parseBrowserCommandV2({
				version: 2,
				projectId: row.projectId,
				kind: row.kind,
				idempotencyKey: key.idempotencyKey,
				...(key.targetKind === "workspace_session"
					? { sessionId: row.sessionId }
					: {}),
				...(text === undefined ? {} : { text }),
				...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
				...(row.targetCommandId
					? { targetCommandId: row.targetCommandId }
					: {}),
			});
			if (
				(await digest(canonical(browser))) !== row.payloadDigest ||
				row.payloadDigest !== row.canonicalPayloadHash
			)
				return null;
			return parseCommandV2({
				version: 2,
				kind: row.kind,
				commandId: row.id,
				commandSeq: row.commandSeq,
				userId: row.userId,
				projectId: row.projectId,
				workspaceSessionId: row.sessionId,
				runtimeOwnerVersion: ownerVersion,
				receiptId: row.receiptId,
				acceptedAt: row.acceptedAt,
				deadlineAt: row.deadlineAt,
				payloadDigest: row.payloadDigest,
				...(text === undefined
					? {}
					: {
							text,
							userMessageId: row.userMessageId,
							assistantMessageId: row.assistantMessageId,
						}),
				...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
				...(row.targetCommandId
					? { targetCommandId: row.targetCommandId }
					: {}),
			});
		} catch {
			return null;
		}
	}
}
