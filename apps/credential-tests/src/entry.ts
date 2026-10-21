import {
	decodeContractInput,
	strictRecord,
} from "../../../packages/runtime-contracts/src/json.js";
import {
	type ModelSubjectV1,
	type ModelTransportDescriptorV1,
	parseModelSubjectV1,
} from "../../../packages/runtime-contracts/src/model.js";
import {
	CANDIDATE_CAPACITY_POLICY,
	CandidateCapacity,
	type CandidateCapacityPolicy,
} from "../../web/src/lib/candidate-capacity";
import type { CodexTokens } from "../../web/src/lib/codex-credential-crypto";
import {
	type CandidateModelPreparation,
	CodexCredential,
	type CodexCredentialEnv,
} from "../../web/src/lib/codex-credential-do";

import {
	CANDIDATE_MODEL_POLICY,
	type ModelClaimRpc,
	ModelProductAuthority,
} from "../../web/src/lib/model-product-authority";

export { CodexCredential };

export class FixtureCredential extends CodexCredential {
	paused = false;
	crashAfterRotation = false;
	abortAfterRotation = false;
	abortFixture() {
		this.ctx.abort("fixture_interruption");
	}
	armAbort() {
		this.abortAfterRotation = true;
	}
	dispatched = 0;
	private resume: (() => void) | undefined;
	private observed: (() => void) | undefined;
	private rotation: Promise<void> | undefined;
	holdRotation() {
		this.paused = true;
		this.rotation = new Promise<void>((resolve) => {
			this.observed = resolve;
		});
	}
	waitForRotation() {
		return this.rotation;
	}
	private modelWait:
		| {
				phase: string;
				entered: Promise<void>;
				mark(): void;
				released: Promise<void>;
				release(): void;
		  }
		| undefined;
	holdModel(phase: "authority" | "credentials" | "claim") {
		let mark!: () => void, release!: () => void;
		this.modelWait = {
			phase,
			entered: new Promise<void>((r) => {
				mark = r;
			}),
			mark: () => mark(),
			released: new Promise<void>((r) => {
				release = r;
			}),
			release: () => release(),
		};
	}
	waitModel() {
		return this.modelWait?.entered;
	}
	releaseModel() {
		this.modelWait?.release();
	}
	protected requestAvailable() {
		return true;
	}
	protected async modelPhase(phase: "authority" | "credentials" | "claim") {
		const wait = this.modelWait;
		if (wait?.phase !== phase) return;
		wait.mark();
		await wait.released;
		this.modelWait = undefined;
	}
	protected fixtureAvailable() {
		return true;
	}
	install(owner: string, generation: number, tokens: CodexTokens) {
		return this.installFixture(owner, generation, tokens);
	}
	protected renewalAvailable() {
		return true;
	}
	protected async renewUpstream(tokens: CodexTokens): Promise<CodexTokens> {
		this.dispatched++;
		const response = await fetch("https://credential-fixture.invalid/rotate", {
			method: "POST",
			redirect: "manual",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refresh: tokens.refresh }),
		});
		if (!response.ok) throw new Error("fixture_failure");
		return await response.json<CodexTokens>();
	}
	protected async afterRotation() {
		if (this.abortAfterRotation) this.ctx.abort("fixture_interruption");
		if (this.crashAfterRotation)
			throw new Error("fixture_crash_after_rotation");
		if (this.paused)
			await new Promise<void>((resolve) => {
				this.resume = resolve;
				this.observed?.();
			});
	}
	release() {
		this.resume?.();
	}
}
export function candidateDispatchScope(subject: ModelSubjectV1): string {
	return JSON.stringify([
		"pi_durable_v1",
		1,
		2,
		"CandidateSessions",
		subject.workspaceSessionId,
		subject.userId,
		subject.projectId,
		subject.runtimeOwnerVersion,
		subject.identityId,
		subject.controllerNamespace,
		subject.incarnationId,
		subject.lifecycleGeneration,
	]);
}

export function fixtureResetSubject(value: string) {
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
	return parseModelSubjectV1(row.subject);
}

const fixtureDatabases = new WeakSet<D1Database>();
export async function candidateFixtureResetTableExists(db: D1Database) {
	if (fixtureDatabases.has(db)) return true;
	const exists = await db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_fixture_resets'",
		)
		.first();
	if (exists) fixtureDatabases.add(db);
	return !!exists;
}

export function candidateModelPolicy(db: D1Database) {
	return {
		...CANDIDATE_MODEL_POLICY,
		attemptAuthority: async (descriptor: ModelTransportDescriptorV1) => {
			if (!(await candidateFixtureResetTableExists(db)))
				return descriptor.attempt.generation === 1;
			const reset = await db
				.prepare(
					"SELECT generation,previousGeneration,phase,intent FROM candidate_fixture_resets WHERE sessionId=? ORDER BY generation DESC LIMIT 1",
				)
				.bind(descriptor.subject.workspaceSessionId)
				.first<{
					generation: number;
					previousGeneration: number;
					phase: string;
					intent: string | null;
				}>();
			if (!reset) return descriptor.attempt.generation === 1;
			if (
				!reset.intent ||
				!["active", "reserved"].includes(reset.phase) ||
				(reset.phase === "reserved"
					? reset.previousGeneration
					: reset.generation) !== descriptor.attempt.generation
			)
				return false;
			return (
				candidateDispatchScope(fixtureResetSubject(reset.intent)) ===
				candidateDispatchScope(descriptor.subject)
			);
		},
	};
}

type DispatchFence = Record<string, SqlStorageValue> & {
	scope: string;
	generation: number;
	phase: string;
	resetId: string | null;
};

export class CandidateFixtureCredential extends FixtureCredential {
	private capacityPolicy: CandidateCapacityPolicy = CANDIDATE_CAPACITY_POLICY;
	setModelCapacity(policy: CandidateCapacityPolicy) {
		this.capacityPolicy = policy;
	}
	protected modelCapacity() {
		return new CandidateCapacity(this.env.DB, this.capacityPolicy);
	}
	private finalWait:
		| {
				entered: Promise<boolean>;
				mark(reached: boolean): void;
				released: Promise<void>;
				release(): void;
		  }
		| undefined;
	private lostDecision: string | undefined;
	loseDecisionAck(commandId: string) {
		this.lostDecision = commandId;
	}
	consumeLostDecisionAck(commandId: string) {
		if (this.lostDecision !== commandId) return false;
		this.lostDecision = undefined;
		return true;
	}
	private configurationWait:
		| {
				entered: Promise<void>;
				mark(): void;
				released: Promise<void>;
				release(): void;
		  }
		| undefined;
	holdCandidateConfiguration() {
		let mark!: () => void, release!: () => void;
		this.configurationWait = {
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
	waitCandidateConfiguration() {
		return this.configurationWait?.entered;
	}
	releaseCandidateConfiguration() {
		this.configurationWait?.release();
	}
	async candidateConfigurationPermission() {
		const held = this.configurationWait;
		if (held) {
			held.mark();
			await held.released;
		}
	}
	private finalDescriptor: ModelTransportDescriptorV1 | undefined;
	private finalRequest: unknown;
	private requestOutcome:
		| ReturnType<CodexCredential["requestModel"]>
		| undefined;
	private claimAckWait:
		| {
				entered: Promise<boolean>;
				mark(admitted: boolean): void;
				released: Promise<void>;
				release(): void;
		  }
		| undefined;
	armClaimAck() {
		let mark!: (admitted: boolean) => void, release!: () => void;
		this.claimAckWait = {
			entered: new Promise<boolean>((resolve) => {
				mark = resolve;
			}),
			mark: (admitted) => mark(admitted),
			released: new Promise<void>((resolve) => {
				release = resolve;
			}),
			release: () => release(),
		};
	}
	waitClaimAck() {
		return this.claimAckWait?.entered;
	}
	releaseClaimAck() {
		this.claimAckWait?.release();
		this.claimAckWait = undefined;
	}
	private forceDenials = false;
	armCandidateDenials() {
		this.forceDenials = true;
	}
	async requestModel(input: unknown, capability: ModelClaimRpc) {
		this.finalRequest = structuredClone(input);
		const forced = this.forceDenials;
		this.forceDenials = false;
		const held = this.claimAckWait;
		const finalHeld = this.finalWait;
		const actual: ModelClaimRpc = held
			? {
					describe: () => capability.describe(),
					halt: (attempt) => capability.halt(attempt),
					claim: async (attempt, binding) => {
						const result = await capability.claim(attempt, binding);
						if (result.status === "admitted") {
							held.mark(true);
							await held.released;
						}
						return result;
					},
				}
			: capability;
		this.requestOutcome = (async () => {
			if (!forced) return super.requestModel(input, actual);
			if (!input || typeof input !== "object" || Array.isArray(input))
				throw new Error("fixture_request_missing");
			const invalid = { ...input, method: "GET" };
			await super.requestModel(invalid, capability);
			await super.requestModel(invalid, capability);
			return super.requestModel(invalid, capability);
		})().finally(() => {
			held?.mark(false);
			finalHeld?.mark(false);
		});
		return this.requestOutcome;
	}
	waitCandidateOutcome() {
		return this.requestOutcome;
	}
	candidateFinalRequest() {
		return structuredClone(this.finalRequest);
	}
	armCandidateFinal() {
		let mark!: (reached: boolean) => void, release!: () => void;
		this.finalDescriptor = undefined;
		this.finalWait = {
			entered: new Promise<boolean>((r) => {
				mark = r;
			}),
			mark: (reached) => mark(reached),
			released: new Promise<void>((r) => {
				release = r;
			}),
			release: () => release(),
		};
	}
	waitCandidateFinal() {
		return this.finalWait?.entered;
	}
	releaseCandidateFinal() {
		this.finalWait?.release();
	}
	candidateFinalDescriptor() {
		return this.finalDescriptor;
	}
	constructor(
		ctx: DurableObjectState,
		env: CodexCredentialEnv & { CandidateCredential: DurableObjectNamespace },
	) {
		super(ctx, { ...env, CodexCredential: env.CandidateCredential });
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS candidate_dispatch_fences(scope TEXT PRIMARY KEY,generation INTEGER NOT NULL,phase TEXT NOT NULL,resetId TEXT)",
		);
	}
	private dispatchFence(scope: string) {
		return this.ctx.storage.sql
			.exec<DispatchFence>(
				"SELECT scope,generation,phase,resetId FROM candidate_dispatch_fences WHERE scope=?",
				scope,
			)
			.toArray()[0];
	}
	protected async prepareModelDispatch(descriptor: ModelTransportDescriptorV1) {
		Object.freeze(descriptor.subject);
		Object.freeze(descriptor.attempt);
		Object.freeze(descriptor);
		const preparation = Object.freeze({
			scope: candidateDispatchScope(descriptor.subject),
			generation: descriptor.attempt.generation,
			binding: JSON.stringify(descriptor),
		});
		if (!(await this.modelProductAuthority().current(descriptor)))
			throw new Error("candidate_dispatch_denied");
		if (preparation.generation === 1)
			this.ctx.storage.sql.exec(
				"INSERT OR IGNORE INTO candidate_dispatch_fences VALUES(?,?,'active',NULL)",
				preparation.scope,
				preparation.generation,
			);
		await this.ctx.storage.sync();
		const fence = this.dispatchFence(preparation.scope);
		if (
			!fence ||
			fence.generation !== preparation.generation ||
			fence.phase !== "active"
		)
			throw new Error("candidate_dispatch_closed");
		return preparation;
	}
	protected finalModelDispatch(
		preparation: CandidateModelPreparation | null,
		descriptor: ModelTransportDescriptorV1,
	): boolean {
		if (
			!preparation ||
			preparation.binding !== JSON.stringify(descriptor) ||
			preparation.scope !== candidateDispatchScope(descriptor.subject) ||
			preparation.generation !== descriptor.attempt.generation
		)
			return false;
		const fence = this.dispatchFence(preparation.scope);
		return (
			!!fence &&
			fence.phase === "active" &&
			fence.resetId === null &&
			fence.generation === preparation.generation
		);
	}
	async closeCandidateDispatch(
		value: unknown,
		generation: number,
		resetId: string,
	) {
		const subject = parseModelSubjectV1(value);
		if (
			!this.env.CodexCredential.idFromName(subject.userId).equals(
				this.ctx.id,
			) ||
			!Number.isSafeInteger(generation) ||
			generation < 1 ||
			typeof resetId !== "string" ||
			resetId.length < 1 ||
			resetId.length > 256 ||
			!(await this.modelProductAuthority().ownedConfiguration(subject, {
				version: 1,
				projectId: subject.projectId,
				workspaceSessionId: subject.workspaceSessionId,
				ownerVersion: subject.runtimeOwnerVersion,
			}))
		)
			throw new Error("candidate_dispatch_denied");
		const scope = candidateDispatchScope(subject);
		this.ctx.storage.transactionSync(() => {
			const fence = this.dispatchFence(scope);
			if (
				!fence ||
				fence.generation !== generation ||
				(fence.phase !== "active" &&
					(fence.phase !== "closed" || fence.resetId !== resetId))
			)
				throw new Error("candidate_dispatch_conflict");
			this.ctx.storage.sql.exec(
				"UPDATE candidate_dispatch_fences SET phase='closed',resetId=? WHERE scope=? AND generation=?",
				resetId,
				scope,
				generation,
			);
		});
		await this.ctx.storage.sync();
		const fence = this.dispatchFence(scope);
		if (
			!fence ||
			fence.generation !== generation ||
			fence.phase !== "closed" ||
			fence.resetId !== resetId
		)
			throw new Error("candidate_dispatch_conflict");
		return { scope, generation, resetId, phase: "closed" as const };
	}
	async reactivateCandidateDispatch(
		value: unknown,
		previousGeneration: number,
		generation: number,
		resetId: string,
		boot: string,
	) {
		const subject = parseModelSubjectV1(value);
		const row = await this.env.DB.prepare(
			"SELECT intent FROM candidate_fixture_resets WHERE resetId=? AND sessionId=? AND previousGeneration=? AND generation=? AND boot=? AND phase='active'",
		)
			.bind(
				resetId,
				subject.workspaceSessionId,
				previousGeneration,
				generation,
				boot,
			)
			.first<{ intent: string }>();
		if (
			!row ||
			generation !== previousGeneration + 1 ||
			!this.env.CodexCredential.idFromName(subject.userId).equals(
				this.ctx.id,
			) ||
			!(await this.modelProductAuthority().ownedConfiguration(subject, {
				version: 1,
				projectId: subject.projectId,
				workspaceSessionId: subject.workspaceSessionId,
				ownerVersion: subject.runtimeOwnerVersion,
			}))
		)
			throw new Error("candidate_reactivation_denied");
		if (
			candidateDispatchScope(fixtureResetSubject(row.intent)) !==
			candidateDispatchScope(subject)
		)
			throw new Error("candidate_reactivation_denied");
		const product = (
			this.env as CodexCredentialEnv & {
				CandidateProduct: {
					fixtureDispatchActivation(
						resetId: string,
						generation: number,
						boot: string,
					): Promise<boolean>;
				};
			}
		).CandidateProduct;
		if (!(await product.fixtureDispatchActivation(resetId, generation, boot)))
			throw new Error("candidate_reactivation_denied");
		const scope = candidateDispatchScope(subject);
		this.ctx.storage.transactionSync(() => {
			const fence = this.dispatchFence(scope);
			if (
				fence?.generation === generation &&
				fence.phase === "active" &&
				fence.resetId === null
			)
				return;
			if (
				!fence ||
				fence.generation !== previousGeneration ||
				fence.phase !== "closed" ||
				fence.resetId !== resetId
			)
				throw new Error("candidate_reactivation_conflict");
			this.ctx.storage.sql.exec(
				"UPDATE candidate_dispatch_fences SET generation=?,phase='active',resetId=NULL WHERE scope=? AND generation=? AND phase='closed' AND resetId=?",
				generation,
				scope,
				previousGeneration,
				resetId,
			);
		});
		await this.ctx.storage.sync();
		const fence = this.dispatchFence(scope);
		if (
			fence?.generation !== generation ||
			fence.phase !== "active" ||
			fence.resetId !== null
		)
			throw new Error("candidate_reactivation_conflict");
		return { scope, generation, phase: "active" };
	}
	protected modelProductAuthority() {
		const fixture = this;
		const finalHeld = this.finalWait;
		let calls = 0;
		return new (class extends ModelProductAuthority {
			async permit(...args: Parameters<ModelProductAuthority["permit"]>) {
				const positive = await super.permit(...args);
				if (++calls === 4 && positive && finalHeld) {
					fixture.finalDescriptor = args[0];
					finalHeld.mark(true);
					await finalHeld.released;
				}
				return positive;
			}
		})(this.env.DB, Date.now, candidateModelPolicy(this.env.DB));
	}
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
