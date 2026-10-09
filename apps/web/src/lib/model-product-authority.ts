import type {
	ConfigurationReadV1,
	ConfigurationSelectionV1,
} from "../../../../packages/runtime-contracts/src/configuration.js";
import {
	type ModelSubjectV1,
	type ModelTransportDescriptorV1,
	parseModelSubjectV1,
	parseSyntheticAccountV1,
	type SyntheticModelBodyV1,
} from "../../../../packages/runtime-contracts/src/model.js";

export interface ModelClaimRpc {
	describe(): Promise<ModelTransportDescriptorV1>;
	claim(
		attempt: unknown,
		binding: unknown,
	): Promise<{ status: "admitted" | "denied" }>;
	halt(attempt: unknown): Promise<{ status: "halted" | "denied" }>;
}

export class ModelProductAuthority {
	constructor(
		private db: D1Database,
		private now: () => number = Date.now,
	) {}

	async ownedConfiguration(
		authenticated: ModelSubjectV1,
		query: ConfigurationReadV1,
		selection?: ConfigurationSelectionV1,
	): Promise<boolean> {
		const s = parseModelSubjectV1(authenticated);
		if (
			query.projectId !== s.projectId ||
			query.workspaceSessionId !== s.workspaceSessionId ||
			query.ownerVersion !== s.runtimeOwnerVersion
		)
			return false;
		const row = await this.db
			.prepare(`SELECT e.snapshot FROM workspace_sessions s
JOIN projects p ON p.id=s.projectId JOIN user u ON u.id=s.userId
JOIN sandbox_identities i ON i.id=s.sandboxIdentityId
LEFT JOIN codex_connections k ON k.user_id=u.id
LEFT JOIN codex_fixture_capabilities e ON e.userId=u.id
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=u.id
AND s.status='active' AND p.status='ready' AND s.runtimeOwner='trusted_v1' AND s.runtimeOwnerVersion=?
AND s.runtimeFailureReasonCode IS NULL
AND i.id=? AND i.kind='workspace_session' AND i.userId=u.id AND i.projectId=p.id AND i.workspaceSessionId=s.id
AND i.controllerClass='Sandbox' AND i.controllerNamespace=? AND i.incarnationId=?
AND i.lifecycleGeneration=? AND i.state='ready' AND i.retiredAt IS NULL
AND (?=0 OR (k.generation=? AND k.revoked=0 AND k.status='connected' AND e.generation=k.generation AND e.revision=?))
AND NOT EXISTS(SELECT 1 FROM runtime_retired_identity_fences f WHERE f.identityId=i.id)
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`)
			.bind(
				s.workspaceSessionId,
				s.userId,
				s.projectId,
				s.runtimeOwnerVersion,
				s.identityId,
				s.controllerNamespace,
				s.incarnationId,
				s.lifecycleGeneration,
				selection ? 1 : 0,
				s.connectionGeneration,
				s.capabilityRevision,
			)
			.first<{ snapshot: string }>();
		if (!row) return false;
		if (!selection) return true;
		try {
			const account = parseSyntheticAccountV1(row.snapshot);
			return (
				account.status === "available" &&
				account.generation === s.connectionGeneration &&
				account.revision === s.capabilityRevision &&
				(!selection ||
					account.models.some(
						(m) =>
							m.id === selection.model &&
							m.thinking.includes(selection.thinking),
					))
			);
		} catch {
			return false;
		}
	}

	private async facts(
		d: ModelTransportDescriptorV1,
		body?: SyntheticModelBodyV1,
	) {
		const s = d.subject,
			a = d.attempt;
		if (this.now() >= a.deadlineAt) return null;
		const row = await this.db
			.prepare(
				"SELECT snapshot FROM codex_fixture_capabilities WHERE userId=? AND generation=? AND revision=?",
			)
			.bind(s.userId, s.connectionGeneration, s.capabilityRevision)
			.first<{ snapshot: string }>();
		if (!row) return null;
		try {
			const account = parseSyntheticAccountV1(row.snapshot);
			if (
				account.status !== "available" ||
				account.generation !== s.connectionGeneration ||
				account.revision !== s.capabilityRevision ||
				(body &&
					!account.models.some(
						(m) => m.id === body.model && m.thinking.includes(body.thinking),
					))
			)
				return null;
		} catch {
			return null;
		}
		const sql = `EXISTS(SELECT 1 FROM session_commands c
JOIN workspace_sessions s ON s.id=c.sessionId
JOIN projects p ON p.id=s.projectId JOIN user u ON u.id=s.userId
JOIN sandbox_identities i ON i.id=s.sandboxIdentityId
JOIN codex_connections k ON k.user_id=u.id
JOIN codex_fixture_capabilities e ON e.userId=u.id
JOIN runtime_command_memberships m ON m.commandId=c.id
WHERE c.id=? AND c.userId=u.id AND c.projectId=p.id AND c.targetId=s.id AND c.targetKind='workspace_session'
AND c.kind IN ('prompt','follow_up') AND c.assistantMessageId=? AND c.deadlineAt>?
AND m.sessionId=s.id AND m.runId=? AND m.assistantMessageId=c.assistantMessageId
AND s.id=? AND s.userId=? AND s.projectId=? AND p.userId=u.id
AND s.status='active' AND p.status='ready' AND s.runtimeOwner='trusted_v1' AND s.runtimeOwnerVersion=?
AND s.runtimeFailureReasonCode IS NULL
AND i.id=? AND i.kind='workspace_session' AND i.userId=u.id AND i.projectId=p.id AND i.workspaceSessionId=s.id
AND i.controllerClass='Sandbox' AND i.controllerNamespace=? AND i.incarnationId=?
AND i.lifecycleGeneration=? AND i.state='ready' AND i.retiredAt IS NULL
AND k.generation=? AND k.revoked=0 AND k.status='connected'
AND e.generation=k.generation AND e.revision=? AND e.snapshot=?
AND ?>?
AND NOT EXISTS(SELECT 1 FROM runtime_retired_identity_fences f WHERE f.identityId=i.id)
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id)))`;
		const params = [
			a.commandId,
			a.assistantId,
			this.now(),
			a.runId,
			s.workspaceSessionId,
			s.userId,
			s.projectId,
			s.runtimeOwnerVersion,
			s.identityId,
			s.controllerNamespace,
			s.incarnationId,
			s.lifecycleGeneration,
			s.connectionGeneration,
			s.capabilityRevision,
			row.snapshot,
			a.deadlineAt,
			this.now(),
		];
		const clock = this.now;
		return {
			sql,
			get params() {
				const now = clock();
				return params.map((value, index) =>
					index === 2 || index === params.length - 1 ? now : value,
				);
			},
			get now() {
				return clock();
			},
		};
	}

	async current(
		d: ModelTransportDescriptorV1,
		body?: SyntheticModelBodyV1,
	): Promise<boolean> {
		const f = await this.facts(d, body);
		if (!f) return false;
		const row = await this.db
			.prepare(
				`SELECT deadlineAt FROM session_commands WHERE id=? AND ${f.sql}`,
			)
			.bind(d.attempt.commandId, ...f.params)
			.first<{ deadlineAt: number }>();
		return !!row && this.now() < Math.min(row.deadlineAt, d.attempt.deadlineAt);
	}

	async windowId(d: ModelTransportDescriptorV1): Promise<string> {
		const hash = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				JSON.stringify([
					d.subject.identityId,
					d.attempt.runId,
					d.attempt.epoch,
					d.attempt.effectId,
				]),
			),
		);
		return `model/${Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, "0")).join("")}`;
	}

	async open(d: ModelTransportDescriptorV1): Promise<string | null> {
		const id = await this.windowId(d),
			f = await this.facts(d);
		if (!f) return null;
		const s = d.subject,
			a = d.attempt;
		await this.db
			.prepare(
				"UPDATE privileged_operations SET openSlot=id,closedAt=?,closeReason='expired' WHERE identityId=? AND family='model' AND openSlot='open' AND expiresAt<=?",
			)
			.bind(f.now, s.identityId, f.now)
			.run();
		await this.db
			.prepare(`INSERT OR IGNORE INTO privileged_operations
(id,identityId,lifecycleGeneration,family,type,contractVersion,runtimeOwnerVersion,runId,runEpoch,incarnationId,admissionReference,maxRequests,openedAt,expiresAt,correlationId,openSlot,contractState)
SELECT ?,?,?,'model','ditto_synthetic_model_v1',1,?,?,?,?,?,1,?,?,?,'open','{}' WHERE ${f.sql}
AND NOT EXISTS(SELECT 1 FROM model_request_admissions r JOIN privileged_operations w ON w.id=r.windowId WHERE w.identityId=? AND r.state IN ('reserved','admitted','outcome_unknown'))`)
			.bind(
				id,
				s.identityId,
				s.lifecycleGeneration,
				s.runtimeOwnerVersion,
				a.runId,
				a.epoch,
				s.incarnationId,
				a.commandId,
				f.now,
				Math.min(a.deadlineAt, f.now + 30000),
				crypto.randomUUID(),
				...f.params,
				s.identityId,
			)
			.run();
		const row = await this.db
			.prepare(
				`SELECT expiresAt,(SELECT deadlineAt FROM session_commands WHERE id=?) AS deadlineAt FROM privileged_operations WHERE id=? AND openSlot='open' AND closedAt IS NULL AND expiresAt>? AND ${f.sql}`,
			)
			.bind(a.commandId, id, this.now(), ...f.params)
			.first<{ expiresAt: number; deadlineAt: number }>();
		return row &&
			this.now() < Math.min(row.expiresAt, row.deadlineAt, a.deadlineAt)
			? id
			: null;
	}

	async reserve(
		d: ModelTransportDescriptorV1,
		body: SyntheticModelBodyV1,
	): Promise<string | null> {
		if (
			(d.attempt.kind === "custom_summary") !==
			(body.purpose === "custom_summary")
		)
			return null;
		if (
			body.purpose === "git_metadata" &&
			(await this.db
				.prepare(
					"SELECT 1 FROM model_request_admissions r JOIN privileged_operations w ON w.id=r.windowId WHERE w.identityId=? AND w.runId=? AND w.runEpoch=? AND r.purpose='git_metadata'",
				)
				.bind(d.subject.identityId, d.attempt.runId, d.attempt.epoch)
				.first())
		)
			return null;
		const id = await this.open(d),
			f = await this.facts(d, body);
		if (!id || !f) return null;
		const insert = this.db
			.prepare(`INSERT OR IGNORE INTO model_request_admissions(effectId,windowId,requestDigest,purpose,state,createdAt,updatedAt)
SELECT ?,?,?,?,'reserved',?,? FROM privileged_operations w
WHERE w.id=? AND w.openSlot='open' AND w.closedAt IS NULL AND w.expiresAt>? AND w.contractDenials<3
AND w.consumedRequests<w.maxRequests AND ${f.sql}
AND NOT EXISTS(SELECT 1 FROM model_request_admissions r WHERE r.windowId=w.id AND r.state IN ('reserved','admitted','outcome_unknown'))
AND (?!='git_metadata' OR NOT EXISTS(SELECT 1 FROM model_request_admissions r JOIN privileged_operations prior ON prior.id=r.windowId WHERE prior.identityId=w.identityId AND prior.runId=w.runId AND prior.runEpoch=w.runEpoch AND r.purpose='git_metadata'))`)
			.bind(
				d.attempt.effectId,
				id,
				d.requestDigest,
				body.purpose,
				f.now,
				f.now,
				id,
				f.now,
				...f.params,
				body.purpose,
			);
		const increment = this.db
			.prepare(
				"UPDATE privileged_operations SET consumedRequests=consumedRequests+1 WHERE id=? AND changes()=1",
			)
			.bind(id);
		const results = await this.db.batch([insert, increment]);
		return results[0].meta.changes === 1 &&
			results[1].meta.changes === 1 &&
			(await this.permit(d, body))
			? id
			: null;
	}

	async permit(
		d: ModelTransportDescriptorV1,
		body: SyntheticModelBodyV1,
	): Promise<boolean> {
		const id = await this.windowId(d),
			f = await this.facts(d, body);
		if (!f) return false;
		const row = await this.db
			.prepare(`SELECT w.expiresAt,(SELECT deadlineAt FROM session_commands WHERE id=?) AS deadlineAt FROM privileged_operations w JOIN model_request_admissions r ON r.windowId=w.id
WHERE w.id=? AND r.effectId=? AND r.requestDigest=? AND r.state='reserved'
AND w.openSlot='open' AND w.closedAt IS NULL AND w.expiresAt>? AND w.contractDenials<3 AND ${f.sql}`)
			.bind(
				d.attempt.commandId,
				id,
				d.attempt.effectId,
				d.requestDigest,
				f.now,
				...f.params,
			)
			.first<{ expiresAt: number; deadlineAt: number }>();
		// A query may finish after the deadlines it tested at statement submission.
		return (
			!!row &&
			this.now() < Math.min(row.expiresAt, row.deadlineAt, d.attempt.deadlineAt)
		);
	}

	async denial(d: ModelTransportDescriptorV1): Promise<boolean> {
		const id = await this.open(d);
		if (!id) return false;
		const now = this.now();
		const results = await this.db.batch([
			this.db
				.prepare(`UPDATE privileged_operations SET contractDenials=contractDenials+1,
closedAt=CASE WHEN contractDenials+1>=3 THEN ? ELSE closedAt END,
closeReason=CASE WHEN contractDenials+1>=3 THEN 'contract_denials' ELSE closeReason END,
openSlot=CASE WHEN contractDenials+1>=3 THEN id ELSE openSlot END
WHERE id=? AND openSlot='open' AND closedAt IS NULL AND expiresAt>? RETURNING contractDenials`)
				.bind(now, id, now),
			this.db
				.prepare(`UPDATE workspace_sessions SET runtimeFailureReasonCode='model_contract_review'
WHERE id=? AND runtimeOwner='trusted_v1' AND runtimeOwnerVersion=?
AND EXISTS(SELECT 1 FROM privileged_operations WHERE id=? AND contractDenials=3 AND closeReason='contract_denials')`)
				.bind(d.subject.workspaceSessionId, d.subject.runtimeOwnerVersion, id),
		]);
		return results[0].results.some(
			(row) =>
				!!row &&
				typeof row === "object" &&
				"contractDenials" in row &&
				row.contractDenials === 3,
		);
	}

	async record(
		d: ModelTransportDescriptorV1,
		state: "admitted" | "complete" | "failed_known" | "outcome_unknown",
	): Promise<void> {
		const id = await this.windowId(d);
		const update = this.db
			.prepare(
				"UPDATE model_request_admissions SET state=?,updatedAt=? WHERE effectId=? AND windowId=? AND requestDigest=? AND state IN ('reserved','admitted')",
			)
			.bind(state, this.now(), d.attempt.effectId, id, d.requestDigest);
		if (state === "complete" || state === "failed_known") {
			await this.db.batch([
				update,
				this.db
					.prepare(
						"UPDATE privileged_operations SET openSlot=id,closedAt=?,closeReason=? WHERE id=? AND changes()=1 AND closedAt IS NULL",
					)
					.bind(this.now(), state, id),
			]);
		} else await update.run();
	}
}
