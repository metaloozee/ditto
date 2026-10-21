import { WorkerEntrypoint } from "cloudflare:workers";
import {
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "../../../packages/runtime-contracts/src/json.js";
import {
	type ModelSubjectV1,
	type ModelTransportDescriptorV1,
	parseModelSubjectV1,
} from "../../../packages/runtime-contracts/src/model.js";
import type {
	HostFault,
	LocalAuthority,
} from "../../runtime/src/pi-durable-host.ts";
import type { ModelClaimRpc } from "../../web/src/lib/model-product-authority";
import {
	type ModelProductBindings,
	performPrivateModelRequest,
	readPrivateModelPermit,
} from "../../web/src/lib/model-product-transport";

export { PiDurableHostFixture } from "../../runtime/src/pi-durable-host.ts";
export {
	CandidateFixtureCredential,
	CodexCredential,
	FixtureCredential,
} from "./entry";

import type { QueueDecisionV2 } from "../../../packages/runtime-contracts/src/product-command.js";
import {
	type CandidateRuntimeScope,
	type CandidateSessionBindings,
	PiDurableProductSession,
	parseCandidateRuntimeScope,
} from "../../runtime/src/pi-durable-product-session.ts";
import { readOwnedConfigurationAuthority } from "../../web/src/lib/configuration-product-authority";
import {
	CANDIDATE_MODEL_POLICY,
	ModelProductAuthority,
} from "../../web/src/lib/model-product-authority";
import {
	type CandidateAuthorityRow,
	CandidateProductCommands,
	prepareCandidateRuntimeAuthority,
	validateCandidateRuntimeAuthority,
} from "../../web/src/lib/session-command-candidate";
import { CANDIDATE_FIXTURE_RESET_SCHEMA } from "./candidate-fixture-schema";

/** Fixture-only product apply faults; module state is shared by the test isolate. */
let projectionFault: "throw" | "short" | "lose-ack" | undefined;
let projectionCalls = 0;

import {
	type CandidateFixtureCredential,
	candidateFixtureResetTableExists,
	candidateModelPolicy,
	fixtureResetSubject,
} from "./entry";

export class FixtureProduct extends WorkerEntrypoint<ModelProductBindings> {
	async readConfigurationAuthority(input: unknown, selection?: unknown) {
		const credential =
			await this.env.CodexCredential.getByName("owner").status("owner");
		if (
			selection !== undefined &&
			(credential.status !== "connected" || credential.generation !== 1)
		)
			return { version: 1 as const, status: "denied" as const };
		return readOwnedConfigurationAuthority(
			this.env.DB,
			{
				version: 1,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "session",
				identityId: "executor",
				incarnationId: "incarnation",
				controllerNamespace: "fixture-execution-v1",
				lifecycleGeneration: 1,
				runtimeOwnerVersion: 1,
				connectionGeneration: 1,
				capabilityRevision: 1,
			},
			input,
			selection,
			true,
		);
	}
	async readSecondConfigurationAuthority(input: unknown, selection?: unknown) {
		const credential =
			await this.env.CodexCredential.getByName("owner").status("owner");
		if (
			selection !== undefined &&
			(credential.status !== "connected" || credential.generation !== 1)
		)
			return { version: 1 as const, status: "denied" as const };
		return readOwnedConfigurationAuthority(
			this.env.DB,
			{
				version: 1,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "session-2",
				identityId: "executor-2",
				incarnationId: "incarnation-2",
				controllerNamespace: "fixture-execution-v1",
				lifecycleGeneration: 1,
				runtimeOwnerVersion: 1,
				connectionGeneration: 1,
				capabilityRevision: 1,
			},
			input,
			selection,
			true,
		);
	}
	requestModel(input: unknown, capability: ModelClaimRpc) {
		return performPrivateModelRequest(this.env, input, capability, true);
	}
	readModelPermit(input: unknown, descriptor: ModelTransportDescriptorV1) {
		return readPrivateModelPermit(this.env.DB, input, descriptor, true);
	}
	fetch() {
		return new Response("Not found", { status: 404 });
	}
}
type CandidateFixtureBindings = Omit<
	CandidateSessionBindings,
	"CandidateSessions"
> & {
	CandidateSessions: DurableObjectNamespace<CandidateFixtureSession>;
	DB: D1Database;
	CandidateCredential: DurableObjectNamespace<CandidateFixtureCredential>;
};

type FixturePredecessor = {
	id: string;
	generation: number;
	started: number;
	yield_at: number;
	end_at: number;
	state: string;
};
type FixtureReset = {
	resetId: string;
	label: string;
	commandId: string;
	scope: CandidateRuntimeScope;
	subject: ModelSubjectV1;
	predecessor: FixturePredecessor;
	origin: string;
	doId: string;
	cutoff: number;
};

function parseFixtureReset(value: unknown): FixtureReset {
	const row = strictRecord(
		decodeContractInput(value, 16000),
		[
			"resetId",
			"label",
			"commandId",
			"scope",
			"subject",
			"predecessor",
			"origin",
			"doId",
			"cutoff",
		],
		"Fixture reset",
	);
	const predecessor = strictRecord(
		row.predecessor,
		["id", "generation", "started", "yield_at", "end_at", "state"],
		"Fixture predecessor",
	);
	const parsed: FixtureReset = {
		resetId: stringField(row, "resetId", { maxBytes: 256 }),
		label: stringField(row, "label", { maxBytes: 256 }),
		commandId: stringField(row, "commandId"),
		scope: parseCandidateRuntimeScope(row.scope),
		subject: parseModelSubjectV1(row.subject),
		origin: stringField(row, "origin", { maxBytes: 256 }),
		doId: stringField(row, "doId", { maxBytes: 256 }),
		cutoff: integerField(row, "cutoff", { minimum: 1 }),
		predecessor: {
			id: stringField(predecessor, "id", { maxBytes: 256 }),
			generation: integerField(predecessor, "generation", { minimum: 1 }),
			started: integerField(predecessor, "started", { minimum: 0 }),
			yield_at: integerField(predecessor, "yield_at", { minimum: 1 }),
			end_at: integerField(predecessor, "end_at", { minimum: 1 }),
			state: literalField(predecessor, "state", [
				"active",
				"draining",
				"closed",
			]),
		},
	};
	if (
		parsed.subject.userId !== parsed.scope.userId ||
		parsed.subject.projectId !== parsed.scope.projectId ||
		parsed.subject.workspaceSessionId !== parsed.scope.workspaceSessionId ||
		parsed.subject.runtimeOwnerVersion !== parsed.scope.ownerVersion ||
		parsed.predecessor.yield_at <= parsed.predecessor.started ||
		parsed.predecessor.end_at <= parsed.predecessor.yield_at
	)
		throw new Error("fixture_reset_binding_denied");
	return parsed;
}

type FixtureResetRequest = Omit<
	FixtureReset,
	"predecessor" | "origin" | "doId"
>;
function sameFixturePredecessor(
	actual: FixturePredecessor,
	retained: FixturePredecessor,
) {
	return (
		actual.id === retained.id &&
		actual.generation === retained.generation &&
		actual.started === retained.started &&
		actual.yield_at === retained.yield_at &&
		actual.end_at === retained.end_at &&
		["active", "draining", "closed"].includes(actual.state) &&
		["active", "draining", "closed"].includes(retained.state)
	);
}

function parseFixtureResetRequest(value: unknown): FixtureResetRequest {
	const row = strictRecord(
		decodeContractInput(value, 16000),
		["resetId", "label", "commandId", "scope", "subject", "cutoff"],
		"Fixture reset reservation",
	);
	const parsed = {
		resetId: stringField(row, "resetId", { maxBytes: 256 }),
		label: stringField(row, "label", { maxBytes: 256 }),
		commandId: stringField(row, "commandId", { maxBytes: 256 }),
		scope: parseCandidateRuntimeScope(row.scope),
		subject: parseModelSubjectV1(row.subject),
		cutoff: integerField(row, "cutoff", { minimum: 1 }),
	};
	if (
		parsed.subject.userId !== parsed.scope.userId ||
		parsed.subject.projectId !== parsed.scope.projectId ||
		parsed.subject.workspaceSessionId !== parsed.scope.workspaceSessionId ||
		parsed.subject.runtimeOwnerVersion !== parsed.scope.ownerVersion
	)
		throw new Error("fixture_reset_binding_denied");
	return parsed;
}

export class CandidateFixtureSession extends PiDurableProductSession {
	constructor(ctx: DurableObjectState, env: CandidateSessionBindings) {
		super(ctx, env);
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS candidate_fixture_gate(id INTEGER PRIMARY KEY CHECK(id=1),resetId TEXT NOT NULL,generation INTEGER NOT NULL,boot TEXT NOT NULL,phase TEXT NOT NULL,cutoff INTEGER NOT NULL,accounted TEXT)",
		);
	}
	private faultPoint: HostFault | undefined;
	armControlFault(
		point: "candidate-control-intent" | "candidate-control-outcome",
	) {
		this.faultPoint = point;
	}
	protected hostFault(point: HostFault) {
		if (this.faultPoint === point) {
			this.faultPoint = undefined;
			throw new Error(`fixture_${point}`);
		}
	}
	protected ordinaryAllowed() {
		const gate = this.ctx.storage.sql
			.exec(
				"SELECT boot,phase,accounted FROM candidate_fixture_gate WHERE id=1",
			)
			.toArray()[0];
		if (!gate) {
			const predecessor = this.ctx.storage.sql
				.exec(
					"SELECT i.state,o.origin FROM host_invocations i LEFT JOIN host_candidate_invocation_origins o ON o.invocation=i.id ORDER BY i.rowid DESC LIMIT 1",
				)
				.toArray()[0];
			return (
				!predecessor ||
				predecessor.state === "closed" ||
				predecessor.origin === this.candidateBoot
			);
		}
		return (
			gate.boot === this.candidateBoot &&
			gate.phase === "active" &&
			typeof gate.accounted === "string" &&
			this.ctx.storage.sql
				.exec(
					"SELECT id FROM host_invocations WHERE id=? AND state='closed'",
					gate.accounted,
				)
				.toArray().length === 1
		);
	}
	async fixtureProof(invocationId?: string) {
		const scope = parseCandidateRuntimeScope(
			await this.ctx.storage.get("candidate-scope-v2"),
		);
		const latest = this.ctx.storage.sql
			.exec<FixturePredecessor & Record<string, SqlStorageValue>>(
				"SELECT * FROM host_invocations ORDER BY rowid DESC LIMIT 1",
			)
			.toArray()[0];
		const requested = invocationId
			? this.ctx.storage.sql
					.exec<FixturePredecessor & Record<string, SqlStorageValue>>(
						"SELECT * FROM host_invocations WHERE id=?",
						invocationId,
					)
					.toArray()[0]
			: latest;
		const predecessor =
			requested &&
			latest &&
			requested.id !== latest.id &&
			(requested.state !== "closed" || latest.state !== "closed")
				? latest
				: requested;
		if (!predecessor) throw new Error("fixture_missing_predecessor");
		const origin = this.ctx.storage.sql
			.exec<{ origin: string }>(
				"SELECT origin FROM host_candidate_invocation_origins WHERE invocation=?",
				predecessor.id,
			)
			.toArray()[0]?.origin;
		if (!origin) throw new Error("fixture_missing_origin");
		const gate =
			this.ctx.storage.sql
				.exec("SELECT * FROM candidate_fixture_gate WHERE id=1")
				.toArray()[0] ?? null;
		return {
			scope,
			predecessor,
			origin,
			boot: this.candidateBoot,
			doId: this.ctx.id.toString(),
			gate,
		};
	}
	async prepareFixtureReset(
		reset: Omit<FixtureReset, "predecessor" | "origin" | "doId">,
		generation: number,
	) {
		const product = this.env
			.CandidateProduct as Service<CandidateFixtureProduct>;
		const authority = await product.readRuntimeAuthority(reset.scope);
		if (!authority.current || authority.generation !== generation)
			return { denied: true as const };
		this.ctx.storage.transactionSync(() => {
			const prior = this.ctx.storage.sql
				.exec(
					"SELECT resetId,generation FROM candidate_fixture_gate WHERE id=1",
				)
				.toArray()[0];
			if (
				prior &&
				prior.resetId !== reset.resetId &&
				prior.generation !== generation
			)
				throw new Error("fixture_reset_conflict");
			this.ctx.storage.sql.exec(
				"INSERT OR REPLACE INTO candidate_fixture_gate VALUES(1,?,?,?,'blocked',?,NULL)",
				reset.resetId,
				generation,
				this.candidateBoot,
				reset.cutoff,
			);
		});
		const proof = await this.fixtureProof();
		if (
			proof.origin !== this.candidateBoot ||
			proof.predecessor.generation !== generation ||
			!["active", "draining", "closed"].includes(proof.predecessor.state) ||
			JSON.stringify(proof.scope) !== JSON.stringify(reset.scope)
		)
			return { denied: true as const };
		const intent = parseFixtureReset({
			...reset,
			predecessor: proof.predecessor,
			origin: proof.origin,
			doId: proof.doId,
		});
		const retained = await this.ctx.storage.get<unknown>(
			"candidate-fixture-reset",
		);
		const old =
			retained === undefined ? undefined : parseFixtureReset(retained);
		if (
			old?.resetId === intent.resetId &&
			JSON.stringify(old) !== JSON.stringify(intent)
		)
			throw new Error("fixture_reset_conflict");
		await this.ctx.storage.put("candidate-fixture-reset", intent);
		await this.ctx.storage.sync();
		return intent;
	}
	async abortFixtureReset(resetId: string) {
		const retained = await this.ctx.storage.get<unknown>(
			"candidate-fixture-reset",
		);
		const intent =
			retained === undefined ? undefined : parseFixtureReset(retained);
		if (!intent || intent.resetId !== resetId) return { denied: true as const };
		const proof = await this.fixtureProof();
		if (
			intent.origin !== this.candidateBoot ||
			proof.origin !== this.candidateBoot ||
			!sameFixturePredecessor(proof.predecessor, intent.predecessor) ||
			JSON.stringify(proof.scope) !== JSON.stringify(intent.scope) ||
			proof.doId !== intent.doId ||
			this.ordinaryAllowed()
		)
			return { denied: true as const };
		const authority = await this.env.CandidateProduct.readRuntimeAuthority(
			intent.scope,
		);
		if (
			!authority.current ||
			authority.generation !== intent.predecessor.generation
		)
			return { denied: true as const };
		await this.ctx.storage.put("candidate-fixture-reset-executed", {
			resetId,
			origin: intent.origin,
			predecessor: intent.predecessor.id,
			label: intent.label,
		});
		await this.ctx.storage.sync();
		const final = await this.fixtureProof();
		if (
			!sameFixturePredecessor(final.predecessor, intent.predecessor) ||
			final.origin !== this.candidateBoot ||
			this.ordinaryAllowed()
		)
			return { denied: true as const };
		this.ctx.abort(intent.label);
	}
	async recoverFixtureReset(intent: FixtureReset, generation: number) {
		const proof = await this.fixtureProof(intent.predecessor.id);
		if (
			proof.predecessor.id !== intent.predecessor.id ||
			proof.origin !== intent.origin ||
			proof.boot === intent.origin ||
			proof.doId !== intent.doId ||
			JSON.stringify(proof.scope) !== JSON.stringify(intent.scope) ||
			generation !== intent.predecessor.generation + 1
		)
			throw new Error("fixture_recovery_proof_denied");
		this.ctx.storage.sql.exec(
			"INSERT OR REPLACE INTO candidate_fixture_gate VALUES(1,?,?,?,'blocked',?,NULL)",
			intent.resetId,
			generation,
			this.candidateBoot,
			intent.cutoff,
		);
		await this.ctx.storage.sync();
		await this.activate(intent.scope);
		const product = this.env
			.CandidateProduct as Service<CandidateFixtureProduct>;
		let after = 0;
		for (;;) {
			const page = await product.fixtureControls(
				intent.scope,
				intent.cutoff,
				after,
			);
			for (const commandId of page.commandIds)
				await this.deliverCommand(commandId, 1);
			if (page.end) break;
			if (page.after <= after) throw new Error("fixture_recovery_scan_denied");
			after = page.after;
		}
		const final = await this.fixtureProof(intent.predecessor.id);
		if (
			final.predecessor.id !== intent.predecessor.id ||
			final.predecessor.state !== "closed" ||
			final.origin !== intent.origin ||
			final.boot !== this.candidateBoot
		)
			throw new Error("fixture_recovery_accounting_denied");
		this.ctx.storage.sql.exec(
			"UPDATE candidate_fixture_gate SET phase='ready',cutoff=?,accounted=? WHERE id=1 AND resetId=? AND generation=? AND boot=? AND phase='blocked'",
			intent.cutoff,
			intent.predecessor.id,
			intent.resetId,
			generation,
			this.candidateBoot,
		);
		await this.ctx.storage.sync();
		const unresolved =
			this.ctx.storage.sql
				.exec(
					"SELECT id FROM host_effects WHERE state='admitted' OR (state='result-recorded' AND (kind='tool' OR correlation IS NOT NULL)) LIMIT 1",
				)
				.toArray().length > 0;
		const review =
			this.ctx.storage.sql.exec("SELECT id FROM host_safety LIMIT 1").toArray()
				.length > 0;
		return {
			boot: this.candidateBoot,
			generation,
			resetId: intent.resetId,
			cutoff: intent.cutoff,
			eligible: !unresolved && !review,
		};
	}
	async acknowledgeFixtureRecovery(
		resetId: string,
		generation: number,
		boot: string,
	) {
		if (boot !== this.candidateBoot)
			throw new Error("fixture_recovery_boot_denied");
		const product = this.env
			.CandidateProduct as Service<CandidateFixtureProduct>;
		if (!(await product.fixtureRecoveryAcknowledged(resetId, generation, boot)))
			throw new Error("fixture_recovery_ack_denied");
		const unresolved = this.ctx.storage.sql
			.exec(
				"SELECT id FROM host_effects WHERE state='admitted' OR (state='result-recorded' AND (kind='tool' OR correlation IS NOT NULL)) LIMIT 1",
			)
			.toArray();
		if (
			unresolved.length ||
			this.ctx.storage.sql.exec("SELECT id FROM host_safety LIMIT 1").toArray()
				.length
		)
			return false;
		const changed = this.ctx.storage.sql
			.exec(
				"UPDATE candidate_fixture_gate SET phase='active' WHERE id=1 AND resetId=? AND generation=? AND boot=? AND phase IN ('ready','active') RETURNING id",
				resetId,
				generation,
				boot,
			)
			.toArray();
		if (changed.length !== 1) throw new Error("fixture_recovery_ack_denied");
		await this.ctx.storage.sync();
		await this.host?.repairWakeup();
		return this.ordinaryAllowed();
	}
	private retired = false;
	private alarmCompletion: Promise<void> | undefined;
	private joinHold:
		| {
				entered: Promise<void>;
				mark(): void;
				released: Promise<void>;
				release(): void;
		  }
		| undefined;
	holdFixtureJoin() {
		let mark!: () => void, release!: () => void;
		this.joinHold = {
			entered: new Promise<void>((resolve) => {
				mark = resolve;
			}),
			mark: () => mark(),
			released: new Promise<void>((resolve) => {
				release = resolve;
			}),
			release: () => release(),
		};
	}
	waitFixtureJoin() {
		return this.joinHold?.entered;
	}
	releaseFixtureJoin() {
		this.joinHold?.release();
	}
	async reconcileFixture() {
		await this.host?.reconcile();
	}
	async configureFixture(input: unknown, commandId: string) {
		return (await this.activate()).configureCandidate(commandId, input);
	}
	async alarm() {
		if (this.retired || !this.ordinaryAllowed()) return;
		this.alarmCompletion = (async () => {
			const host = await this.alarmHost();
			if (!host) return;
			await host.alarm();
			if (
				this.joinHold &&
				this.ctx.storage.sql
					.exec(
						"SELECT i.id FROM host_invocations i JOIN host_candidate_invocation_origins o ON o.invocation=i.id WHERE i.state='active' AND o.origin=? LIMIT 1",
						this.candidateBoot,
					)
					.toArray().length === 1
			) {
				this.joinHold.mark();
				await this.joinHold.released;
			}
			await host.joinInvocation();
		})();
		await this.alarmCompletion;
	}
	async retireFixture() {
		this.retired = true;
		await this.alarmCompletion;
		if (this.host) {
			await this.host.yield();
			await this.host.awaitClosure();
			this.host = undefined;
		}
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.sync();
	}
	async reopenFixture() {
		this.retired = true;
		try {
			await this.alarmCompletion;
			if (this.host) {
				await this.host.yield();
				await this.host.awaitClosure();
				this.host = undefined;
			}
			await this.activate();
		} finally {
			this.retired = false;
		}
		await (await this.activate()).repairWakeup();
	}
	/** Runs a due-or-not projection retry now instead of waiting for its backoff. */
	async forceProjectionDelivery() {
		await (await this.activate()).deliverProjections(true);
	}
	async fixtureWakeState() {
		return { alarm: await this.ctx.storage.getAlarm(), open: !!this.host };
	}
	async candidateSnapshot() {
		if (!this.host) await this.activate();
		return {
			conversations: this.ctx.storage.sql
				.exec("SELECT count(*) AS count FROM conversations")
				.one().count,
			submissions: this.ctx.storage.sql
				.exec("SELECT * FROM submissions")
				.toArray(),
			commands: this.ctx.storage.sql
				.exec(
					"SELECT id,run,state,sequence,submission FROM host_commands ORDER BY sequence",
				)
				.toArray(),
			runs: this.ctx.storage.sql.exec("SELECT * FROM host_runs").toArray(),
			members: this.ctx.storage.sql
				.exec(
					"SELECT m.* FROM host_members m JOIN host_commands c ON c.assistant=m.assistant ORDER BY c.sequence",
				)
				.toArray(),
			projections: this.ctx.storage.sql
				.exec("SELECT * FROM host_projections")
				.toArray(),
			effects: this.ctx.storage.sql
				.exec("SELECT id,state,epoch FROM host_effects")
				.toArray(),
			safety: this.ctx.storage.sql
				.exec("SELECT reason FROM host_safety")
				.toArray(),
			retained: this.ctx.storage.sql
				.exec(
					"SELECT p.payload,i.content FROM host_product_commands p LEFT JOIN host_inbox i ON i.id=p.id",
				)
				.toArray(),
			invocations: this.ctx.storage.sql
				.exec("SELECT * FROM host_invocations")
				.toArray(),
		};
	}
}

type FixtureResetRow = {
	resetId: string;
	sessionId: string;
	previousGeneration: number;
	generation: number;
	phase: string;
	intent: string | null;
	observation: string | null;
	boot: string | null;
	cutoff: number | null;
	predecessor: string | null;
};

export class CandidateFixtureProduct extends WorkerEntrypoint<CandidateFixtureBindings> {
	private fixtureSession(sessionId: string) {
		return this.env.CandidateSessions.getByName(sessionId);
	}
	private fixtureOwnedSubject(subject: ModelSubjectV1) {
		return new ModelProductAuthority(
			this.env.DB,
			Date.now,
			CANDIDATE_MODEL_POLICY,
		).ownedConfiguration(subject, {
			version: 1,
			projectId: subject.projectId,
			workspaceSessionId: subject.workspaceSessionId,
			ownerVersion: subject.runtimeOwnerVersion,
		});
	}
	private fixtureObserved(row: FixtureResetRow, intent: FixtureReset) {
		if (
			!row.observation ||
			row.resetId !== intent.resetId ||
			row.sessionId !== intent.scope.workspaceSessionId ||
			row.predecessor !== intent.predecessor.id ||
			row.previousGeneration !== intent.predecessor.generation ||
			row.generation !== row.previousGeneration + 1
		)
			return false;
		const observation = strictRecord(
			decodeContractInput(row.observation, 4096),
			["resetId", "label", "predecessor", "origin", "doId"],
			"Fixture reset observation",
		);
		return (
			observation.resetId === intent.resetId &&
			observation.label === intent.label &&
			observation.predecessor === intent.predecessor.id &&
			observation.origin === intent.origin &&
			observation.doId === intent.doId
		);
	}
	private async latestReset(sessionId: string) {
		if (!(await candidateFixtureResetTableExists(this.env.DB))) return null;
		return this.env.DB.prepare(
			"SELECT * FROM candidate_fixture_resets WHERE sessionId=? ORDER BY generation DESC LIMIT 1",
		)
			.bind(sessionId)
			.first<FixtureResetRow>();
	}
	async reserveCandidateReset(commandId: string) {
		if (await candidateFixtureResetTableExists(this.env.DB)) {
			const reserved = await this.env.DB.prepare(
				"SELECT * FROM candidate_fixture_resets WHERE json_extract(intent,'$.commandId')=? AND phase='reserved' ORDER BY generation DESC LIMIT 1",
			)
				.bind(commandId)
				.first<FixtureResetRow>();
			if (reserved) return reserved;
		}
		const command = await this.reconstructCommand(commandId, 1);
		const subject = await this.readCandidateSubject(commandId, 1);
		if (!command || !subject) throw new Error("fixture_reset_owned_denied");
		const scope: CandidateRuntimeScope = {
			version: 2,
			userId: command.userId,
			projectId: command.projectId,
			workspaceSessionId: command.workspaceSessionId,
			ownerVersion: 1,
		};
		const authority = await this.readRuntimeAuthority(scope);
		if (!authority.current) throw new Error("fixture_reset_owned_denied");
		if (!(await candidateFixtureResetTableExists(this.env.DB)))
			await this.env.DB.exec(CANDIDATE_FIXTURE_RESET_SCHEMA);
		let row = await this.latestReset(scope.workspaceSessionId);
		if (row && row.phase !== "active") return row;
		const resetId = crypto.randomUUID();
		const label = `008-private-reset-${crypto.randomUUID()}`;
		const cutoff = (
			await this.env.DB.prepare(
				"SELECT max(commandSeq) AS cutoff FROM session_commands WHERE sessionId=? AND userId=? AND projectId=? AND payloadVersion=2",
			)
				.bind(scope.workspaceSessionId, scope.userId, scope.projectId)
				.first<{ cutoff: number }>()
		)?.cutoff;
		if (!cutoff) throw new Error("fixture_reset_cutoff_denied");
		await this.env.DB.prepare(
			"INSERT OR IGNORE INTO candidate_fixture_resets(resetId,sessionId,previousGeneration,generation,phase,intent) VALUES(?,?,?,?,'reserved',?)",
		)
			.bind(
				resetId,
				scope.workspaceSessionId,
				authority.generation,
				authority.generation + 1,
				JSON.stringify({ resetId, label, commandId, scope, subject, cutoff }),
			)
			.run();
		row = await this.latestReset(scope.workspaceSessionId);
		if (row?.resetId !== resetId) throw new Error("fixture_reset_conflict");
		return row;
	}
	async resetCandidate(commandId: string, discardObservation = false) {
		const row = await this.reserveCandidateReset(commandId);
		if (row.phase !== "reserved" || !row.intent)
			return { resetId: row.resetId, phase: row.phase };
		const request = parseFixtureResetRequest(row.intent);
		const { resetId, label, scope, subject } = request;
		if (
			request.commandId !== commandId ||
			!(await this.fixtureOwnedSubject(subject))
		)
			return { resetId, phase: "denied" };
		const begin = await this.env.DB.prepare(
			"UPDATE candidate_fixture_resets SET phase='intent' WHERE resetId=? AND phase='reserved' AND intent=?",
		)
			.bind(resetId, row.intent)
			.run();
		if (begin.meta.changes !== 1) return { resetId, phase: "denied" };
		await this.env.CandidateCredential.getByName(
			scope.userId,
		).closeCandidateDispatch(subject, row.previousGeneration, resetId);
		const intent = await this.fixtureSession(
			scope.workspaceSessionId,
		).prepareFixtureReset(request, row.previousGeneration);
		if ("denied" in intent) return { resetId, phase: "denied" };
		await this.env.DB.prepare(
			"UPDATE candidate_fixture_resets SET intent=?,predecessor=?,cutoff=? WHERE resetId=? AND phase='intent' AND intent=?",
		)
			.bind(
				JSON.stringify(intent),
				intent.predecessor.id,
				intent.cutoff,
				resetId,
				row.intent,
			)
			.run();
		let observed = false;
		try {
			await this.fixtureSession(scope.workspaceSessionId).abortFixtureReset(
				resetId,
			);
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"message" in error &&
				"durableObjectReset" in error &&
				error.message === label &&
				error.durableObjectReset === true
			)
				observed = true;
		}
		if (!observed || discardObservation) return { resetId, phase: "intent" };
		const observation = JSON.stringify({
			resetId,
			label,
			predecessor: intent.predecessor.id,
			origin: intent.origin,
			doId: intent.doId,
		});
		await this.env.DB.prepare(
			"UPDATE candidate_fixture_resets SET observation=?,phase='observed' WHERE resetId=? AND phase='intent' AND intent=? AND observation IS NULL",
		)
			.bind(observation, resetId, JSON.stringify(intent))
			.run();
		const proof = await this.fixtureSession(
			scope.workspaceSessionId,
		).fixtureProof();
		const fresh = await this.commands().runtimeAuthority(
			scope.userId,
			scope.projectId,
			scope.workspaceSessionId,
		);
		if (
			!fresh.current ||
			!(await this.fixtureOwnedSubject(intent.subject)) ||
			proof.boot === intent.origin ||
			proof.origin !== intent.origin ||
			proof.doId !== intent.doId ||
			JSON.stringify(proof.scope) !== JSON.stringify(scope) ||
			!sameFixturePredecessor(proof.predecessor, intent.predecessor)
		)
			throw new Error("fixture_reset_proof_denied");
		const issued = await this.env.DB.prepare(
			"UPDATE candidate_fixture_resets SET phase='issued',boot=? WHERE resetId=? AND phase='observed' AND intent=? AND observation=? AND previousGeneration=? AND generation=?",
		)
			.bind(
				proof.boot,
				resetId,
				JSON.stringify(intent),
				observation,
				intent.predecessor.generation,
				intent.predecessor.generation + 1,
			)
			.run();
		if (issued.meta.changes !== 1)
			throw new Error("fixture_reset_issue_denied");
		return { resetId, phase: "issued" };
	}
	async fixtureControls(
		scope: CandidateRuntimeScope,
		cutoff: number,
		after: number,
	) {
		if (
			!(
				await this.commands().runtimeAuthority(
					scope.userId,
					scope.projectId,
					scope.workspaceSessionId,
				)
			).current ||
			!Number.isSafeInteger(cutoff) ||
			!Number.isSafeInteger(after) ||
			after < 0 ||
			cutoff < after
		)
			throw new Error("fixture_controls_denied");
		const rows = (
			await this.env.DB.prepare(
				"SELECT id,commandSeq FROM session_commands WHERE sessionId=? AND userId=? AND projectId=? AND payloadVersion=2 AND kind IN ('stop','cancel') AND commandSeq>? AND commandSeq<=? ORDER BY commandSeq LIMIT 2",
			)
				.bind(
					scope.workspaceSessionId,
					scope.userId,
					scope.projectId,
					after,
					cutoff,
				)
				.all<{ id: string; commandSeq: number }>()
		).results;
		return {
			commandIds: rows.map((row) => row.id),
			after: rows.at(-1)?.commandSeq ?? after,
			end: rows.length < 2,
		};
	}
	async fixtureRecoveryAcknowledged(
		resetId: string,
		generation: number,
		boot: string,
	) {
		const row = await this.env.DB.prepare(
			"SELECT * FROM candidate_fixture_resets WHERE resetId=? AND generation=? AND boot=? AND phase='active'",
		)
			.bind(resetId, generation, boot)
			.first<FixtureResetRow>();
		if (!row?.intent) return false;
		const intent = parseFixtureReset(row.intent);
		if (
			!this.fixtureObserved(row, intent) ||
			(await this.latestReset(row.sessionId))?.resetId !== resetId
		)
			return false;
		return (
			(
				await this.commands().runtimeAuthority(
					intent.scope.userId,
					intent.scope.projectId,
					intent.scope.workspaceSessionId,
				)
			).current && (await this.fixtureOwnedSubject(intent.subject))
		);
	}
	async recoverCandidate(resetId: string) {
		const row = await this.env.DB.prepare(
			"SELECT * FROM candidate_fixture_resets WHERE resetId=?",
		)
			.bind(resetId)
			.first<FixtureResetRow>();
		if (
			!row?.intent ||
			!row.observation ||
			!["issued", "recovery_ready", "active"].includes(row.phase)
		)
			return { resetId, phase: "denied" };
		const intent = parseFixtureReset(row.intent);
		if (
			!this.fixtureObserved(row, intent) ||
			(await this.latestReset(row.sessionId))?.resetId !== resetId
		)
			return { resetId, phase: "denied" };
		let proof: Awaited<ReturnType<CandidateFixtureSession["fixtureProof"]>>;
		try {
			proof = await this.fixtureSession(row.sessionId).fixtureProof(
				intent.predecessor.id,
			);
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"message" in error &&
				error.message === "fixture_new_successor_proof_required"
			)
				return { resetId, phase: "denied" };
			throw error;
		}
		const owned = await this.commands().runtimeAuthority(
			intent.scope.userId,
			intent.scope.projectId,
			row.sessionId,
		);
		if (
			!owned.current ||
			!(await this.fixtureOwnedSubject(intent.subject)) ||
			proof.predecessor.id !== intent.predecessor.id ||
			proof.origin !== intent.origin ||
			proof.boot === intent.origin
		)
			return { resetId, phase: "denied" };
		const cutoff = (
			await this.env.DB.prepare(
				"SELECT max(commandSeq) AS cutoff FROM session_commands WHERE sessionId=? AND payloadVersion=2",
			)
				.bind(row.sessionId)
				.first<{ cutoff: number }>()
		)?.cutoff;
		if (!cutoff || cutoff < intent.cutoff)
			throw new Error("fixture_recovery_cutoff_denied");
		const recovery = await this.fixtureSession(
			row.sessionId,
		).recoverFixtureReset({ ...intent, cutoff }, row.generation);
		if (recovery.boot !== proof.boot)
			throw new Error("fixture_recovery_boot_denied");
		await this.env.DB.prepare(
			"UPDATE candidate_fixture_resets SET phase='recovery_ready',boot=?,cutoff=? WHERE resetId=? AND generation=? AND phase IN ('issued','recovery_ready','active')",
		)
			.bind(recovery.boot, recovery.cutoff, resetId, row.generation)
			.run();
		if (
			!(
				await this.commands().runtimeAuthority(
					intent.scope.userId,
					intent.scope.projectId,
					row.sessionId,
				)
			).current
		)
			throw new Error("fixture_recovery_owned_denied");
		if (!recovery.eligible)
			return { resetId, generation: row.generation, phase: "fenced" };
		await this.env.DB.prepare(
			"UPDATE candidate_fixture_resets SET phase='active' WHERE resetId=? AND generation=? AND boot=? AND phase='recovery_ready'",
		)
			.bind(resetId, row.generation, recovery.boot)
			.run();
		await this.env.CandidateCredential.getByName(
			intent.scope.userId,
		).reactivateCandidateDispatch(
			intent.subject,
			row.previousGeneration,
			row.generation,
			resetId,
			recovery.boot,
		);
		const active = await this.fixtureSession(
			row.sessionId,
		).acknowledgeFixtureRecovery(resetId, row.generation, recovery.boot);
		if (!active) throw new Error("fixture_recovery_ack_denied");
		return { resetId, generation: row.generation, phase: "active" };
	}
	async fixtureDispatchActivation(
		resetId: string,
		generation: number,
		boot: string,
	) {
		if (!(await this.fixtureRecoveryAcknowledged(resetId, generation, boot)))
			return false;
		const row = await this.env.DB.prepare(
			"SELECT sessionId,intent,cutoff FROM candidate_fixture_resets WHERE resetId=?",
		)
			.bind(resetId)
			.first<{ sessionId: string; intent: string; cutoff: number }>();
		if (!row) return false;
		const intent = parseFixtureReset(row.intent);
		const proof = await this.fixtureSession(row.sessionId).fixtureProof(
			intent.predecessor.id,
		);
		return (
			proof.boot === boot &&
			proof.origin === intent.origin &&
			proof.predecessor.id === intent.predecessor.id &&
			proof.predecessor.state === "closed" &&
			proof.gate?.resetId === resetId &&
			proof.gate.generation === generation &&
			proof.gate.boot === boot &&
			["ready", "active"].includes(String(proof.gate.phase)) &&
			proof.gate.cutoff === row.cutoff &&
			proof.gate.accounted === intent.predecessor.id
		);
	}
	private commands() {
		return new CandidateProductCommands(
			this.env.DB,
			{
				readSelection: (subject) =>
					this.env.CandidateSessions.getByName(
						subject.workspaceSessionId,
					).readSelection(subject),
				targetStatus: (subject, runId) =>
					this.env.CandidateSessions.getByName(
						subject.workspaceSessionId,
					).targetStatus(subject, runId),
				observe: (subject, cursor) =>
					this.env.CandidateSessions.getByName(
						subject.workspaceSessionId,
					).observe(subject, cursor),
			},
			(owner) => this.env.CandidateCredential.getByName(owner),
		);
	}
	setProjectionFault(fault: typeof projectionFault) {
		projectionFault = fault;
		const calls = projectionCalls;
		projectionCalls = 0;
		return calls;
	}
	async applyCandidateProjections(
		scope: CandidateRuntimeScope,
		intents: unknown,
	) {
		projectionCalls++;
		const fault = projectionFault;
		if (fault === "throw") throw new Error("Synthetic product apply failure");
		const parsed = parseCandidateRuntimeScope(scope);
		const results = await this.commands().applyProjections(parsed, intents);
		if (fault === "lose-ack")
			throw new Error("Synthetic lost projection acknowledgment");
		return fault === "short" ? results.slice(0, -1) : results;
	}
	async applyCandidateCheckpoints(
		scope: CandidateRuntimeScope,
		projections: unknown,
	) {
		return this.commands().applyCheckpointProjections(
			parseCandidateRuntimeScope(scope),
			projections,
		);
	}
	async applyCandidateRestore(
		scope: CandidateRuntimeScope,
		completion: unknown,
	) {
		return this.commands().applyRestoreCompletion(
			parseCandidateRuntimeScope(scope),
			completion,
		);
	}
	observeOwned(
		userId: string,
		projectId: string,
		sessionId: string,
		cursor?: number,
	) {
		return this.commands().observe(userId, projectId, sessionId, cursor);
	}
	admitOwned(userId: string, input: unknown) {
		return this.commands().admit(userId, input);
	}
	drain() {
		return this.commands().drain((sessionId, commandId, ownerVersion) =>
			this.env.CandidateSessions.getByName(sessionId).deliverCommand(
				commandId,
				ownerVersion,
			),
		);
	}
	reconstructCommand(commandId: string, ownerVersion: number) {
		return this.commands().reconstruct(commandId, ownerVersion);
	}
	async readRuntimeAuthority(
		value: CandidateRuntimeScope,
	): Promise<LocalAuthority> {
		const scope = parseCandidateRuntimeScope(value);
		if (!(await candidateFixtureResetTableExists(this.env.DB)))
			return this.commands().runtimeAuthority(
				scope.userId,
				scope.projectId,
				scope.workspaceSessionId,
			);
		const [resets, owned] = await this.env.DB.batch<
			FixtureResetRow | CandidateAuthorityRow
		>([
			this.env.DB.prepare(
				"SELECT * FROM candidate_fixture_resets WHERE sessionId=? ORDER BY generation DESC LIMIT 1",
			).bind(scope.workspaceSessionId),
			prepareCandidateRuntimeAuthority(
				this.env.DB,
				scope.userId,
				scope.projectId,
				scope.workspaceSessionId,
			),
		]);
		const reset = (resets.results[0] as FixtureResetRow | undefined) ?? null;
		const subject = reset?.intent
			? fixtureResetSubject(reset.intent)
			: undefined;
		const authority = validateCandidateRuntimeAuthority(
			(owned.results[0] as CandidateAuthorityRow | undefined) ?? null,
			subject,
		);
		if (!authority.current || !reset) return authority;
		if (
			!subject ||
			subject.userId !== scope.userId ||
			subject.projectId !== scope.projectId ||
			subject.workspaceSessionId !== scope.workspaceSessionId ||
			subject.runtimeOwnerVersion !== scope.ownerVersion
		)
			return { ...authority, current: false };
		if (
			!reset.intent ||
			!reset.observation ||
			!["issued", "recovery_ready", "active"].includes(reset.phase)
		)
			return { ...authority, generation: reset.previousGeneration };
		const intent = parseFixtureReset(reset.intent);
		if (
			JSON.stringify(intent.scope) !== JSON.stringify(scope) ||
			intent.predecessor.generation !== reset.previousGeneration ||
			reset.generation !== reset.previousGeneration + 1 ||
			!this.fixtureObserved(reset, intent)
		)
			return { ...authority, current: false };
		return {
			...authority,
			generation: reset.generation,
			priorTerminated: intent.predecessor.id,
		};
	}
	async readCandidateSubject(commandId: string, ownerVersion: number) {
		try {
			return await this.commands().subjectForCommand(commandId, ownerVersion);
		} catch {
			return null;
		}
	}
	async reconcileCandidateDecision(decision: QueueDecisionV2) {
		const accepted = await this.commands().reconcileDecision(
			decision.commandId,
			decision.ownerVersion,
			decision,
		);
		if (accepted) {
			const subject = await this.readCandidateSubject(
				decision.commandId,
				decision.ownerVersion,
			);
			if (
				subject &&
				(await this.env.CandidateCredential.getByName(
					subject.userId,
				).consumeLostDecisionAck(decision.commandId))
			)
				return false;
		}
		return accepted;
	}
	async readCandidateConfigurationAuthority(
		commandId: string,
		input: unknown,
		selection?: unknown,
	) {
		const subject = await this.readCandidateSubject(commandId, 1);
		if (!subject) return { version: 1 as const, status: "denied" as const };
		if (selection !== undefined)
			await this.env.CandidateCredential.getByName(
				subject.userId,
			).candidateConfigurationPermission();
		const status = await this.env.CandidateCredential.getByName(
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
			true,
			CANDIDATE_MODEL_POLICY,
		);
	}
	requestModel(input: unknown, capability: ModelClaimRpc) {
		return performPrivateModelRequest(
			{ DB: this.env.DB, CodexCredential: this.env.CandidateCredential },
			input,
			capability,
			true,
		);
	}
	readModelPermit(input: unknown, descriptor: ModelTransportDescriptorV1) {
		return readPrivateModelPermit(
			this.env.DB,
			input,
			descriptor,
			true,
			candidateModelPolicy(this.env.DB),
		);
	}
	fetch() {
		return new Response("Not found", { status: 404 });
	}
}

export default FixtureProduct;
