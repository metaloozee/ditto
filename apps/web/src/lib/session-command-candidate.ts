import {
	type ArchiveCompletionResultV1,
	type CheckpointProjectionResultV1,
	parseArchiveCompletionV1,
	parseCheckpointProjectionsV1,
	parseRestoreOutcomeV1,
	type RestoreCompletionResultV1,
} from "../../../../packages/runtime-contracts/src/checkpoint.js";
import {
	type CandidateModelsV1,
	type ConfigurationSelectionV1,
	parseCandidateModelsRequestV1,
	parseConfigurationSelectionV1,
} from "../../../../packages/runtime-contracts/src/configuration.js";
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
	parseBrowserWorkspaceActionV1,
	type WorkspaceActionResultV1,
	type WorkspaceActionV1,
} from "../../../../packages/runtime-contracts/src/workspace-action.js";
import {
	applyProductProjectionBatch,
	type ProjectionPayload,
} from "../../../runtime/src/product-projector.js";
import {
	CANDIDATE_CAPACITY_POLICY,
	CandidateCapacity,
	type CandidateCapacityPolicy,
} from "./candidate-capacity";
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
	/** Committed history of an archived session; never activates its host or executor. */
	observeHistory?(
		scope: { userId: string; projectId: string; workspaceSessionId: string },
		cursor?: number,
	): Promise<RuntimeObservationV1>;
	/** Set only by a composition whose runtime can finish a restore; a closed barrier needs one. */
	restoreAvailable?: boolean;
	/** Set only by a composition whose runtime can finish an archive; a closed archive needs one. */
	archiveAvailable?: boolean;
	workspaceAction?(
		subject: ModelSubjectV1,
		action: WorkspaceActionV1,
	): Promise<WorkspaceActionResultV1>;
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
	selection: string | null;
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

type CandidateDrainRow = {
	id: string;
	commandId: string;
	deliveryAttempts: number;
	deadlineAt: number;
	userId: string;
	kind: string;
	identityId: string;
	incarnationId: string;
};
/** Clock margin before work that waited for capacity is handed over for expiry only. */
const QUEUE_EXPIRY_MARGIN_MS = 5000;

/** One executor incarnation holds one execution slot until it is proven ended. */
export const executorOwnerKey = (identityId: string, incarnationId: string) =>
	`${identityId}:${incarnationId}`;

export class CandidateProductCommands {
	private policy: ModelProductAuthority;
	readonly capacity: CandidateCapacity;
	constructor(
		private db: D1Database,
		private runtime: CandidateAdmissionRuntime,
		private credential: (owner: string) => CandidateCredentialStatus,
		private now: () => number = Date.now,
		private createId: () => string = () => crypto.randomUUID(),
		capacityPolicy: CandidateCapacityPolicy = CANDIDATE_CAPACITY_POLICY,
	) {
		this.policy = new ModelProductAuthority(db, now, CANDIDATE_MODEL_POLICY);
		this.capacity = new CandidateCapacity(db, capacityPolicy, now, createId);
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
	/** A duplicate key keeps its receipt for an owned session, archived ones included, until deletion. */
	private async ownedReceipt(
		userId: string,
		projectId: string,
		sessionId: string,
	) {
		const row = await this.db
			.prepare(
				`SELECT 1 FROM workspace_sessions s JOIN projects p ON p.id=s.projectId
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId AND p.status='ready'
AND s.status IN ('active','archived') AND s.runtimeOwner='pi_durable_v1' AND s.runtimeOwnerVersion=1
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`,
			)
			.bind(sessionId, userId, projectId)
			.first();
		if (!row) reject("runtime_owner_mismatch");
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
			await this.ownedReceipt(userId, input.projectId, existing.sessionId);
			if (
				existing.payloadVersion !== 2 ||
				existing.canonicalPayloadHash !== hash
			)
				reject("conflict");
			return receipt(existing);
		}
		if (input.kind === "restore_checkpoint_acknowledging_loss")
			return this.admitRestore(userId, input, hash);
		if (input.kind === "archive_session")
			return this.admitArchive(userId, input, hash);
		const ordinary = input.kind === "prompt" || input.kind === "follow_up";
		if (input.sessionId) await this.assertOpen(input.sessionId);
		if (input.sessionId && ordinary)
			await this.assertNoRestore(input.sessionId);
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
			const selection =
				input.selection ??
				(subject ? await this.runtime.readSelection(subject) : null);
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
				`INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetRunId,targetCommandId,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt,selection)
SELECT ?,?,'workspace_session',?,?,?, ?,nextSequence,?,?,2,?,?,?,?,?,? FROM session_command_sequences WHERE sessionId=? AND EXISTS(${gate})
AND (?=0 OR EXISTS(SELECT 1 FROM codex_connections k JOIN codex_fixture_capabilities e ON e.userId=k.user_id WHERE k.user_id=? AND k.status='connected' AND k.revoked=0 AND k.generation=? AND e.generation=k.generation AND e.revision=? AND e.snapshot=?))
AND (?=0 OR NOT EXISTS(SELECT 1 FROM candidate_restore_barriers b WHERE b.sessionId=? AND b.state='closed'))
AND NOT EXISTS(SELECT 1 FROM candidate_archives a WHERE a.sessionId=?)
AND NOT EXISTS(SELECT 1 FROM candidate_continuations n WHERE n.destinationSessionId=? AND n.state!='ready')`,
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
				pair && "selection" in input && input.selection
					? JSON.stringify(input.selection)
					: null,
				sessionId,
				sessionId,
				userId,
				input.projectId,
				pair ? 1 : 0,
				userId,
				readiness?.generation ?? 0,
				readiness?.revision ?? 0,
				readiness?.snapshot ?? "",
				ordinary ? 1 : 0,
				sessionId,
				sessionId,
				sessionId,
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
				await this.ownedReceipt(userId, input.projectId, raced.sessionId);
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
		if (!row) {
			if (input.sessionId) await this.assertOpen(input.sessionId);
			if (input.sessionId && ordinary)
				await this.assertNoRestore(input.sessionId);
			reject("runtime_owner_mismatch");
		}
		return receipt(row);
	}

	/**
	 * An archive closes every kind of admission from its intent, and a
	 * continuation admits nothing until its context is in place.
	 */
	private async assertOpen(sessionId: string) {
		const [archive, continuation] = await this.db.batch([
			this.db
				.prepare("SELECT 1 FROM candidate_archives WHERE sessionId=?")
				.bind(sessionId),
			this.db
				.prepare(
					"SELECT 1 FROM candidate_continuations WHERE destinationSessionId=? AND state!='ready'",
				)
				.bind(sessionId),
		]);
		if (archive.results.length) reject("session_archived");
		if (continuation.results.length) reject("continuation_pending");
	}

	/**
	 * Archive intent, the admission barrier and the cutoff commit in one
	 * batch. Every command accepted before the archive is its cutoff; nothing
	 * is admitted after it.
	 */
	private async admitArchive(
		userId: string,
		input: Extract<BrowserCommandV2, { kind: "archive_session" }>,
		hash: string,
	): Promise<ReceiptV2> {
		const identity = await this.owned(userId, input.projectId, input.sessionId);
		if (!this.runtime.archiveAvailable) reject("archive_unavailable");
		await this.assertOpen(input.sessionId);
		await this.assertNoRestore(input.sessionId);
		const commandId = this.createId(),
			receiptId = this.createId(),
			acceptedAt = this.now(),
			deadlineAt = acceptedAt + CANDIDATE_QUEUE_TTL_MS;
		const q = (sql: string, ...args: (string | number | null)[]) =>
			this.db.prepare(sql).bind(...args);
		const gate = ownedSessionSql.replace(
			"SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace",
			"SELECT 1",
		);
		try {
			await this.db.batch([
				q(
					`INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetRunId,targetCommandId,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt)
SELECT ?,?,'workspace_session',?,?,?,'archive_session',nextSequence,NULL,NULL,2,NULL,NULL,?,?,? FROM session_command_sequences
WHERE sessionId=? AND EXISTS(${gate})
AND NOT EXISTS(SELECT 1 FROM candidate_restore_barriers b WHERE b.sessionId=? AND b.state='closed')
AND NOT EXISTS(SELECT 1 FROM candidate_archives a WHERE a.sessionId=?)
AND NOT EXISTS(SELECT 1 FROM candidate_continuations n WHERE n.destinationSessionId=? AND n.state!='ready')`,
					commandId,
					userId,
					input.sessionId,
					input.projectId,
					input.sessionId,
					hash,
					acceptedAt,
					deadlineAt,
					input.sessionId,
					input.sessionId,
					userId,
					input.projectId,
					input.sessionId,
					input.sessionId,
					input.sessionId,
				),
				q(
					"INSERT INTO candidate_archives(archiveCommandId,sessionId,ownerVersion,cutoffSeq,state,openedAt) SELECT id,sessionId,1,commandSeq-1,'closed',acceptedAt FROM session_commands WHERE id=?",
					commandId,
				),
				q(
					"UPDATE session_command_sequences SET nextSequence=nextSequence+1,updatedAt=? WHERE sessionId=? AND EXISTS(SELECT 1 FROM session_commands WHERE id=?)",
					acceptedAt,
					input.sessionId,
					commandId,
				),
				q(
					"INSERT INTO session_command_keys(id,userId,targetKind,targetId,idempotencyKey,commandKind,canonicalPayloadHash,commandId,receiptId,createdAt) SELECT ?,userId,'workspace_session',?,?,kind,?,id,?,acceptedAt FROM session_commands WHERE id=?",
					this.createId(),
					input.sessionId,
					input.idempotencyKey,
					hash,
					receiptId,
					commandId,
				),
				q(
					`INSERT INTO workspace_runtime_work(id,fifoSeq,identityId,sessionId,projectId,userId,intent,payload,status,queueExpiresAt,userMessageId,assistantMessageId,protocolVersion,runtimeOwner,runtimeOwnerVersion,commandId,deliveryState)
SELECT ?,coalesce((SELECT max(fifoSeq) FROM workspace_runtime_work),0)+1,?,sessionId,projectId,userId,'agent_run',?,'queued',?,NULL,NULL,2,'pi_durable_v1',1,id,'pending' FROM session_commands WHERE id=?`,
					this.createId(),
					identity.identityId,
					JSON.stringify({ commandKind: input.kind }),
					Math.floor(deadlineAt / 1000),
					commandId,
				),
			]);
		} catch (error) {
			const raced = await this.key(userId, input);
			if (raced) {
				if (raced.payloadVersion !== 2 || raced.canonicalPayloadHash !== hash)
					reject("conflict");
				return receipt(raced);
			}
			await this.assertOpen(input.sessionId);
			throw error;
		}
		const row = await this.key(userId, input);
		if (row) return receipt(row);
		await this.assertOpen(input.sessionId);
		await this.assertNoRestore(input.sessionId);
		reject("runtime_owner_mismatch");
	}

	/** Ordinary admission stays closed from restore intent until its exact completion. */
	private async assertNoRestore(sessionId: string) {
		if (
			await this.db
				.prepare(
					"SELECT 1 FROM candidate_restore_barriers WHERE sessionId=? AND state='closed'",
				)
				.bind(sessionId)
				.first()
		)
			reject("restore_in_progress");
	}

	/**
	 * Restore intent, the ordinary-admission barrier and the cutoff commit in
	 * one batch. The cutoff is the last accepted command the user saw; a later
	 * acceptance or pointer move makes the acknowledgment stale.
	 */
	private async admitRestore(
		userId: string,
		input: Extract<
			BrowserCommandV2,
			{ kind: "restore_checkpoint_acknowledging_loss" }
		>,
		hash: string,
	): Promise<ReceiptV2> {
		const identity = await this.owned(userId, input.projectId, input.sessionId);
		if (!this.runtime.restoreAvailable) reject("restore_unavailable");
		await this.assertOpen(input.sessionId);
		await this.assertNoRestore(input.sessionId);
		const commandId = this.createId(),
			receiptId = this.createId(),
			acceptedAt = this.now(),
			deadlineAt = acceptedAt + CANDIDATE_QUEUE_TTL_MS;
		const q = (sql: string, ...args: (string | number | null)[]) =>
			this.db.prepare(sql).bind(...args);
		const gate = ownedSessionSql.replace(
			"SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace",
			"SELECT 1",
		);
		try {
			await this.db.batch([
				q(
					`INSERT INTO session_commands(id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetRunId,targetCommandId,payloadVersion,userMessageId,assistantMessageId,payloadDigest,acceptedAt,deadlineAt)
SELECT ?,?,'workspace_session',?,?,?,'restore_checkpoint_acknowledging_loss',nextSequence,NULL,NULL,2,NULL,NULL,?,?,? FROM session_command_sequences
WHERE sessionId=? AND nextSequence-1=? AND EXISTS(${gate})
AND EXISTS(SELECT 1 FROM runtime_checkpoint_pointers p WHERE p.sessionId=? AND p.runtimeOwnerVersion=1 AND p.currentPairId=? AND p.mutationGeneration=?)
AND NOT EXISTS(SELECT 1 FROM candidate_restore_barriers b WHERE b.sessionId=? AND b.state='closed')
AND NOT EXISTS(SELECT 1 FROM candidate_archives a WHERE a.sessionId=?)`,
					commandId,
					userId,
					input.sessionId,
					input.projectId,
					input.sessionId,
					hash,
					acceptedAt,
					deadlineAt,
					input.sessionId,
					input.expectedRecoveryPosition,
					input.sessionId,
					userId,
					input.projectId,
					input.sessionId,
					input.committedPairId,
					input.expectedMutationGeneration,
					input.sessionId,
					input.sessionId,
				),
				q(
					"INSERT INTO candidate_restore_barriers(restoreCommandId,sessionId,ownerVersion,pairId,expectedMutationGeneration,cutoffSeq,state,openedAt) SELECT id,sessionId,1,?,?,commandSeq-1,'closed',acceptedAt FROM session_commands WHERE id=?",
					input.committedPairId,
					input.expectedMutationGeneration,
					commandId,
				),
				q(
					"UPDATE session_command_sequences SET nextSequence=nextSequence+1,updatedAt=? WHERE sessionId=? AND EXISTS(SELECT 1 FROM session_commands WHERE id=?)",
					acceptedAt,
					input.sessionId,
					commandId,
				),
				q(
					"INSERT INTO session_command_keys(id,userId,targetKind,targetId,idempotencyKey,commandKind,canonicalPayloadHash,commandId,receiptId,createdAt) SELECT ?,userId,'workspace_session',?,?,kind,?,id,?,acceptedAt FROM session_commands WHERE id=?",
					this.createId(),
					input.sessionId,
					input.idempotencyKey,
					hash,
					receiptId,
					commandId,
				),
				q(
					`INSERT INTO workspace_runtime_work(id,fifoSeq,identityId,sessionId,projectId,userId,intent,payload,status,queueExpiresAt,userMessageId,assistantMessageId,protocolVersion,runtimeOwner,runtimeOwnerVersion,commandId,deliveryState)
SELECT ?,coalesce((SELECT max(fifoSeq) FROM workspace_runtime_work),0)+1,?,sessionId,projectId,userId,'agent_run',?,'queued',?,NULL,NULL,2,'pi_durable_v1',1,id,'pending' FROM session_commands WHERE id=?`,
					this.createId(),
					identity.identityId,
					JSON.stringify({ commandKind: input.kind }),
					Math.floor(deadlineAt / 1000),
					commandId,
				),
			]);
		} catch (error) {
			const raced = await this.key(userId, input);
			if (raced) {
				if (raced.payloadVersion !== 2 || raced.canonicalPayloadHash !== hash)
					reject("conflict");
				return receipt(raced);
			}
			await this.assertNoRestore(input.sessionId);
			throw error;
		}
		const row = await this.key(userId, input);
		if (row) return receipt(row);
		await this.assertNoRestore(input.sessionId);
		reject("restore_stale");
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
		// Ordinary work waits in FIFO order for its session's executor slot.
		// A full pool blocks every later newcomer; a full user blocks only that
		// user's. Stop and cancel never wait for capacity. Rows left waiting
		// stay at the head, so later pages skip past them.
		const full = { global: false, users: new Set<string>() };
		let waiting = 0;
		for (let page = 0; this.now() - started < 20000; page++) {
			const rows = await this.db
				.prepare(`SELECT w.id,w.commandId,w.deliveryAttempts,c.deadlineAt,w.userId,c.kind,i.id AS identityId,i.incarnationId
FROM workspace_runtime_work w JOIN session_commands c ON c.id=w.commandId JOIN sandbox_identities i ON i.id=w.identityId
WHERE w.runtimeOwner='pi_durable_v1' AND w.runtimeOwnerVersion=1 AND w.protocolVersion=2 AND w.deliveryState IN ('pending','leased') AND (w.deliveryLeaseExpiresAt IS NULL OR w.deliveryLeaseExpiresAt<=?)
ORDER BY CASE WHEN c.kind IN ('stop','cancel') THEN 0 ELSE 1 END,w.fifoSeq LIMIT 25 OFFSET ?`)
				.bind(started, waiting)
				.all<CandidateDrainRow>();
			if (rows.results.length === 0) break;
			for (const row of rows.results) {
				if (this.now() - started >= 20000) break;
				if (!(await this.executorAdmitted(row, full))) {
					waiting++;
					continue;
				}
				await this.deliverRow(row, started, deliver);
			}
		}
	}

	private async deliverRow(
		row: CandidateDrainRow,
		started: number,
		deliver: (
			sessionId: string,
			commandId: string,
			ownerVersion: number,
		) => Promise<unknown>,
	) {
		{
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
			if (leased.meta.changes !== 1) return;
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

	/**
	 * True when the row may be delivered now. Controls bypass capacity. Work
	 * whose queue time ran out is delivered without a slot so that the runtime,
	 * which alone knows whether it started, records the expiry.
	 */
	private async executorAdmitted(
		row: CandidateDrainRow,
		full: { global: boolean; users: Set<string> },
	): Promise<boolean> {
		if (row.kind === "stop" || row.kind === "cancel") return true;
		const owner = executorOwnerKey(row.identityId, row.incarnationId);
		if (await this.capacity.live("executor", owner)) return true;
		// Only once the runtime's own deadline has surely passed, so the
		// runtime can record nothing but the expiry.
		if (this.now() >= row.deadlineAt + QUEUE_EXPIRY_MARGIN_MS) return true;
		if (full.global || full.users.has(row.userId)) return false;
		const claim = await this.capacity.acquire("executor", owner, row.userId);
		if (claim.status === "claimed") return true;
		if (claim.status === "full") {
			if (claim.scope === "global") full.global = true;
			else full.users.add(row.userId);
		}
		return false;
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

	/**
	 * Exact restore completion reopens ordinary admission. Every ordinary
	 * command through the cutoff must already have a settled assistant, so a
	 * completion that outruns its dispositions is retried, never applied.
	 */
	async applyRestoreCompletion(
		scope: { userId: string; projectId: string; workspaceSessionId: string },
		value: unknown,
	): Promise<RestoreCompletionResultV1> {
		const completion = parseRestoreOutcomeV1(value);
		const result = (outcome: RestoreCompletionResultV1["outcome"]) => ({
			restoreCommandId: completion.restoreCommandId,
			outcome,
		});
		const barrier = await this.db
			.prepare(
				`SELECT b.* FROM candidate_restore_barriers b JOIN workspace_sessions s ON s.id=b.sessionId
WHERE b.restoreCommandId=? AND b.sessionId=? AND s.userId=? AND s.projectId=? AND s.runtimeOwner='pi_durable_v1'`,
			)
			.bind(
				completion.restoreCommandId,
				scope.workspaceSessionId,
				scope.userId,
				scope.projectId,
			)
			.first<{
				pairId: string;
				cutoffSeq: number;
				state: string;
				restoredPairId: string | null;
				fallback: number | null;
				conversationGeneration: number | null;
			}>();
		if (
			!barrier ||
			barrier.pairId !== completion.pairId ||
			barrier.cutoffSeq !== completion.cutoffSeq
		)
			return result("blocked_membership");
		if ("refused" in completion) {
			// Refused before the runtime fence: nothing was discarded, so no fate is awaited.
			if (barrier.state !== "closed")
				return result(
					barrier.state === "refused"
						? "already_applied"
						: "blocked_membership",
				);
			const refused = await this.db
				.prepare(
					"UPDATE candidate_restore_barriers SET state='refused',completedAt=? WHERE restoreCommandId=? AND state='closed'",
				)
				.bind(this.now(), completion.restoreCommandId)
				.run();
			return result(refused.meta.changes === 1 ? "applied" : "retry");
		}
		if (barrier.state === "refused") return result("blocked_membership");
		if (barrier.state === "complete")
			return result(
				barrier.restoredPairId === completion.restoredPairId &&
					barrier.fallback === (completion.fallback ? 1 : 0) &&
					barrier.conversationGeneration === completion.conversationGeneration
					? "already_applied"
					: "blocked_membership",
			);
		const applied = await this.db
			.prepare(
				`UPDATE candidate_restore_barriers SET state='complete',restoredPairId=?,fallback=?,conversationGeneration=?,completedAt=?
WHERE restoreCommandId=? AND state='closed' AND NOT EXISTS(SELECT 1 FROM session_commands c JOIN messages m ON m.id=c.assistantMessageId
WHERE c.sessionId=candidate_restore_barriers.sessionId AND c.commandSeq<=candidate_restore_barriers.cutoffSeq AND c.kind IN ('prompt','follow_up') AND m.status NOT IN ('complete','failed'))`,
			)
			.bind(
				completion.restoredPairId,
				completion.fallback ? 1 : 0,
				completion.conversationGeneration,
				this.now(),
				completion.restoreCommandId,
			)
			.run();
		return result(applied.meta.changes === 1 ? "applied" : "retry");
	}

	/**
	 * Exact archive completion retires the session: it becomes archived
	 * history, its executor identity is retired and fenced, its workspace
	 * claim is freed and its executor teardown becomes a durable cleanup
	 * job, all in one batch. The final pair must be the product pointer and
	 * every assistant through the cutoff must be settled.
	 */
	async applyArchiveCompletion(
		scope: { userId: string; projectId: string; workspaceSessionId: string },
		value: unknown,
	): Promise<ArchiveCompletionResultV1> {
		const completion = parseArchiveCompletionV1(value);
		const result = (outcome: ArchiveCompletionResultV1["outcome"]) => ({
			archiveCommandId: completion.archiveCommandId,
			outcome,
		});
		const row = await this.db
			.prepare(
				`SELECT a.*,s.sandboxIdentityId AS identityId FROM candidate_archives a JOIN workspace_sessions s ON s.id=a.sessionId
WHERE a.archiveCommandId=? AND a.sessionId=? AND s.userId=? AND s.projectId=? AND s.runtimeOwner='pi_durable_v1'`,
			)
			.bind(
				completion.archiveCommandId,
				scope.workspaceSessionId,
				scope.userId,
				scope.projectId,
			)
			.first<{
				cutoffSeq: number;
				state: string;
				finalPairId: string | null;
				mutationGeneration: number | null;
				conversationGeneration: number | null;
				identityId: string | null;
			}>();
		if (!row || row.cutoffSeq !== completion.cutoffSeq || !row.identityId)
			return result("blocked_membership");
		if (row.state === "complete")
			return result(
				row.finalPairId === completion.finalPairId &&
					row.mutationGeneration === completion.mutationGeneration &&
					row.conversationGeneration === completion.conversationGeneration
					? "already_applied"
					: "blocked_membership",
			);
		const pointer = await this.db
			.prepare(
				"SELECT currentPairId,mutationGeneration FROM runtime_checkpoint_pointers WHERE sessionId=? AND runtimeOwnerVersion=1",
			)
			.bind(scope.workspaceSessionId)
			.first<{ currentPairId: string | null; mutationGeneration: number }>();
		if (
			pointer?.currentPairId !== completion.finalPairId ||
			pointer.mutationGeneration !== completion.mutationGeneration
		)
			return result("blocked_membership");
		const now = this.now();
		const complete =
			"EXISTS(SELECT 1 FROM candidate_archives WHERE archiveCommandId=? AND state='complete')";
		const q = (sql: string, ...args: (string | number | null)[]) =>
			this.db.prepare(sql).bind(...args);
		await this.db.batch([
			q(
				`UPDATE candidate_archives SET state='complete',finalPairId=?,mutationGeneration=?,conversationGeneration=?,completedAt=?
WHERE archiveCommandId=? AND state='closed'
AND EXISTS(SELECT 1 FROM runtime_checkpoint_pointers p WHERE p.sessionId=candidate_archives.sessionId AND p.currentPairId=? AND p.mutationGeneration=?)
AND NOT EXISTS(SELECT 1 FROM session_commands c JOIN messages m ON m.id=c.assistantMessageId
WHERE c.sessionId=candidate_archives.sessionId AND c.commandSeq<=candidate_archives.cutoffSeq AND c.kind IN ('prompt','follow_up') AND m.status NOT IN ('complete','failed'))`,
				completion.finalPairId,
				completion.mutationGeneration,
				completion.conversationGeneration,
				now,
				completion.archiveCommandId,
				completion.finalPairId,
				completion.mutationGeneration,
			),
			q(
				`UPDATE workspace_sessions SET status='archived',updated_at=unixepoch() WHERE id=? AND status='active' AND ${complete}`,
				scope.workspaceSessionId,
				completion.archiveCommandId,
			),
			q(
				`UPDATE sandbox_identities SET state='destroying',retiredAt=unixepoch(),updated_at=unixepoch() WHERE id=? AND retiredAt IS NULL AND ${complete}`,
				row.identityId,
				completion.archiveCommandId,
			),
			q(
				`INSERT OR IGNORE INTO runtime_retired_identity_fences(identityId,lifecycleGeneration,retiredAt) SELECT id,lifecycleGeneration,? FROM sandbox_identities WHERE id=? AND ${complete}`,
				now,
				row.identityId,
				completion.archiveCommandId,
			),
			q(
				`DELETE FROM candidate_workspace_claims WHERE sessionId=? AND ${complete}`,
				scope.workspaceSessionId,
				completion.archiveCommandId,
			),
			q(
				`INSERT OR IGNORE INTO runtime_cleanup_jobs(id,targetKind,targetId,state,retryAt,attempts,createdAt) SELECT 'executor:'||?,'workspace_session',?,'pending',NULL,0,? WHERE ${complete}`,
				scope.workspaceSessionId,
				scope.workspaceSessionId,
				now,
				completion.archiveCommandId,
			),
		]);
		const after = await this.db
			.prepare("SELECT state FROM candidate_archives WHERE archiveCommandId=?")
			.bind(completion.archiveCommandId)
			.first<{ state: string }>();
		return result(after?.state === "complete" ? "applied" : "retry");
	}

	/**
	 * Owned UI Git or preview action. The runtime owner admits it under its
	 * one mutation scope; the product never touches the workspace directly.
	 */
	async workspaceAction(
		userId: string,
		value: unknown,
	): Promise<WorkspaceActionResultV1> {
		const { projectId, sessionId, ...action } =
			parseBrowserWorkspaceActionV1(value);
		const subject = await this.subject(userId, projectId, sessionId);
		await this.assertOpen(sessionId);
		await this.assertNoRestore(sessionId);
		if (!this.runtime.workspaceAction) reject("runtime_unavailable", 503);
		// Preview-only work runs on the session's executor, so it joins the
		// same execution accounting as agent work.
		if (action.kind === "preview_start") {
			const claim = await this.capacity.acquire(
				"executor",
				executorOwnerKey(subject.identityId, subject.incarnationId),
				userId,
			);
			if (claim.status !== "claimed")
				return { status: "denied", reason: "capacity" };
		}
		return this.runtime.workspaceAction(subject, action);
	}

	/**
	 * Account models and the session's remembered selection. The selection read
	 * only reads committed state and never schedules work.
	 */
	async models(userId: string, value: unknown): Promise<CandidateModelsV1> {
		const { projectId, sessionId } = parseCandidateModelsRequestV1(value);
		if (sessionId) await this.owned(userId, projectId, sessionId);
		else {
			const project = await this.db
				.prepare("SELECT 1 FROM projects WHERE id=? AND userId=?")
				.bind(projectId, userId)
				.first();
			if (!project) reject("runtime_owner_mismatch");
		}
		const none = (status: CandidateModelsV1["status"]): CandidateModelsV1 => ({
			version: 1,
			status,
			models: [],
			selection: null,
		});
		const credential = await this.credential(userId).status(userId);
		if (credential.status !== "connected") return none("disconnected");
		const capability = await this.db
			.prepare("SELECT snapshot FROM codex_fixture_capabilities WHERE userId=?")
			.bind(userId)
			.first<{ snapshot: string }>();
		if (!capability) return none("unavailable");
		const account = parseSyntheticAccountV1(capability.snapshot);
		if (account.status !== "available") return none(account.status);
		return {
			version: 1,
			status: "available",
			models: account.models,
			selection: sessionId
				? await this.runtime.readSelection(
						await this.subject(userId, projectId, sessionId),
					)
				: null,
		};
	}

	/** Owned observation; the runtime reads committed facts without scheduling. */
	async observe(
		userId: string,
		projectId: string,
		sessionId: string,
		cursor?: number,
	): Promise<RuntimeObservationV1> {
		const archived = await this.db
			.prepare(
				`SELECT 1 FROM workspace_sessions s JOIN projects p ON p.id=s.projectId JOIN candidate_archives a ON a.sessionId=s.id AND a.state='complete'
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId AND p.status='ready' AND s.status='archived' AND s.runtimeOwner='pi_durable_v1'
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`,
			)
			.bind(sessionId, userId, projectId)
			.first();
		let observation: RuntimeObservationV1;
		if (archived) {
			if (!this.runtime.observeHistory) reject("runtime_unavailable", 503);
			observation = await this.runtime.observeHistory(
				{ userId, projectId, workspaceSessionId: sessionId },
				cursor,
			);
		} else {
			const subject = await this.subject(userId, projectId, sessionId);
			if (!this.runtime.observe) reject("runtime_unavailable", 503);
			observation = await this.runtime.observe(subject, cursor);
		}
		if (observation.snapshot) {
			const restored = await this.db
				.prepare(
					`SELECT p.createdAt AS checkpointAt,p.outstandingEffectCount AS outstanding
FROM candidate_restore_barriers b JOIN runtime_checkpoint_pairs p ON p.id=b.restoredPairId
WHERE b.sessionId=? AND b.state='complete' ORDER BY b.completedAt DESC,b.openedAt DESC LIMIT 1`,
				)
				.bind(sessionId)
				.first<{ checkpointAt: number; outstanding: number }>();
			if (restored)
				observation = {
					...observation,
					snapshot: {
						...observation.snapshot,
						health: {
							...observation.snapshot.health,
							restore: {
								checkpointAt: restored.checkpointAt,
								effectsUncertain: restored.outstanding > 0,
							},
						},
					},
				};
		}
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
			const selection = row.selection
				? {
						selection: parseConfigurationSelectionV1(JSON.parse(row.selection)),
					}
				: {};
			let restore: Record<string, unknown> = {};
			if (row.kind === "restore_checkpoint_acknowledging_loss") {
				const barrier = await this.db
					.prepare(
						"SELECT pairId,expectedMutationGeneration,cutoffSeq FROM candidate_restore_barriers WHERE restoreCommandId=? AND sessionId=? AND ownerVersion=1",
					)
					.bind(row.id, row.sessionId)
					.first<{
						pairId: string;
						expectedMutationGeneration: number;
						cutoffSeq: number;
					}>();
				if (!barrier) return null;
				restore = {
					committedPairId: barrier.pairId,
					expectedMutationGeneration: barrier.expectedMutationGeneration,
					expectedRecoveryPosition: barrier.cutoffSeq,
					unbackedLossAcknowledged: true,
				};
			}
			const browser = parseBrowserCommandV2({
				version: 2,
				projectId: row.projectId,
				kind: row.kind,
				idempotencyKey: key.idempotencyKey,
				...(key.targetKind === "workspace_session"
					? { sessionId: row.sessionId }
					: {}),
				...(text === undefined ? {} : { text }),
				...selection,
				...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
				...(row.targetCommandId
					? { targetCommandId: row.targetCommandId }
					: {}),
				...restore,
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
							...selection,
						}),
				...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
				...(row.targetCommandId
					? { targetCommandId: row.targetCommandId }
					: {}),
				...restore,
			});
		} catch {
			return null;
		}
	}
}
