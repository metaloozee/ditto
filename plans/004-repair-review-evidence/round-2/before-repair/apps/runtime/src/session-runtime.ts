import type { CommandV1 } from "../../../packages/runtime-contracts/src/command.js";
import type {
	EffectV1,
	SnapshotV1,
} from "../../../packages/runtime-contracts/src/runtime.js";
import {
	type CoordinatorSql,
	consumedOrdinarySeq,
	continuationPosition,
	createDurableObjectSqlAdapter,
	currentEpoch,
	getCommand,
	getCommandBySeq,
	getEffect,
	getRun,
	hasUnresolvedWriter,
	initializeJournalSchema,
	insertCommand,
	insertEffect,
	insertEvent,
	insertProjection,
	insertRun,
	insertWakeup,
	isFatalLatched,
	isolationEvidencePresent,
	latchFatal,
	listCommands,
	listEffectsByRun,
	listEffectsForLogical,
	listEvents,
	listRuns,
	markFirstInterruption,
	metaValue,
	nextCoordinatorSeq,
	nextWorkDeadline,
	pendingProjectionCount,
	RECOVERY_DEADLINE_MS,
	type RunState,
	recordConstructorObservation,
	setCommandConsumption,
	setMeta,
	updateEffectState,
	updateRunState,
} from "./journal.js";
import type {
	ProjectionApplyResult,
	ProjectionPayload,
} from "./product-projector.js";
import { processReconcilePass, settleExpiredRunsNow } from "./reconcile.js";
import {
	decryptRuntimeText,
	encryptRuntimePayload,
	encryptRuntimeText,
	RUNTIME_CRYPTO_FORMAT_VERSION,
	type RuntimeAad,
	type RuntimeKeyring,
	serializeRuntimeCiphertext,
	serializeRuntimeManifest,
} from "./runtime-crypto.js";

export type SessionRuntimeHandoffAck = {
	version: 1;
	commandId: string;
	ownerVersion: number;
	acceptedPosition: number;
	receiptId: string;
};

export type ProcessIdentityRecord = {
	incarnationId: string;
	lifecycleGeneration: number;
	state: string;
};

export type CurrentAuthority = {
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	runtimeOwner: "legacy" | "migrating" | "trusted_v1" | "blocked";
	runtimeOwnerVersion: number;
	sessionStatus: string;
	projectStatus: string;
	lifecycleGeneration: number;
	processIdentities: ProcessIdentityRecord[];
	capacityExpiresAt: number | null;
};

export type ReconstructedAdmission = {
	command: CommandV1;
	receiptId: string;
	payloadHash: string;
};

export type ProductAdapters = {
	reconstructCommand(commandId: string): Promise<ReconstructedAdmission | null>;
	readCurrentAuthority(input: {
		workspaceSessionId: string;
		userId: string;
		projectId: string;
	}): Promise<CurrentAuthority | null>;
	applyProjections(
		payloads: ProjectionPayload[],
		now: number,
	): Promise<ProjectionApplyResult[]>;
};

export type RuntimeScheduler = {
	schedule: (
		when: Date,
		callback: string,
		payload?: unknown,
	) => Promise<unknown>;
};

export type AllowlistedLog = {
	event: string;
	commandId?: string;
	commandSeq?: number;
	ownerVersion?: number;
	sessionId?: string;
	runId?: string;
	epoch?: number;
	status?: string;
	reasonCode?: string;
	byteCount?: number;
	durationMs?: number;
	correlationId?: string;
	attempt?: number;
	intentCount?: number;
	projectionLag?: number;
	acceptedPosition?: number;
	kind?: string;
	wakeupId?: string;
	processed?: number;
	category?: string;
	effectAttempt?: number;
};

export class CoordinatorError extends Error {
	constructor(
		readonly code: string,
		readonly category: string,
		readonly correlationId: string,
	) {
		super(category);
		this.name = "CoordinatorError";
	}
}

export type SessionCoordinatorOptions = {
	sql: CoordinatorSql;
	keyring: RuntimeKeyring;
	adapters: ProductAdapters;
	scheduler: RuntimeScheduler;
	clock: { now: () => number };
	identity: { ownerId: string; workspaceSessionId: string; projectId: string };
	createId?: () => string;
	log?: (entry: AllowlistedLog) => void;
};

const TERMINAL_RUN: ReadonlySet<string> = new Set([
	"complete",
	"failed",
	"canceled",
]);

function createId(): string {
	return crypto.randomUUID();
}

function logAllowlisted(
	log: ((entry: AllowlistedLog) => void) | undefined,
	entry: AllowlistedLog,
): void {
	log?.(entry);
}

function commandAad(
	identity: { ownerId: string; workspaceSessionId: string },
	recordId: string,
): RuntimeAad {
	return {
		ownerId: identity.ownerId,
		workspaceSessionId: identity.workspaceSessionId,
		recordId,
		formatVersion: RUNTIME_CRYPTO_FORMAT_VERSION,
	};
}

function canonicalCommandContent(command: CommandV1): string | null {
	if (command.kind === "prompt") {
		return JSON.stringify({
			kind: command.kind,
			text: command.text,
			thinkingLevel: command.thinkingLevel ?? null,
		});
	}
	if (command.kind === "follow_up") {
		return JSON.stringify({ kind: command.kind, text: command.text });
	}
	return JSON.stringify({ kind: command.kind });
}

function snapshotState(
	id: string,
	status: string,
	reasonCode?: string | null,
): { id: string; status: string; reasonCode?: string } {
	const state: { id: string; status: string; reasonCode?: string } = {
		id,
		status,
	};
	if (reasonCode) state.reasonCode = reasonCode;
	return state;
}

export class SessionCoordinator {
	readonly sql: CoordinatorSql;
	private readonly keyring: RuntimeKeyring;
	private readonly adapters: ProductAdapters;
	private readonly scheduler: RuntimeScheduler;
	private readonly clock: { now: () => number };
	readonly identity: {
		ownerId: string;
		workspaceSessionId: string;
		projectId: string;
	};
	private readonly createIdFn: () => string;
	private readonly log: ((entry: AllowlistedLog) => void) | undefined;
	private initialized = false;
	private memoryFatal = false;
	private canonicalRestore: "unchecked" | "ok" | "failed" = "unchecked";
	private consumeOwnerVersion: number | null = null;
	containerWakeCount = 0;
	dispatchAttemptCount = 0;

	constructor(options: SessionCoordinatorOptions) {
		this.sql = options.sql;
		this.keyring = options.keyring;
		this.adapters = options.adapters;
		this.scheduler = options.scheduler;
		this.clock = options.clock;
		this.identity = options.identity;
		this.createIdFn = options.createId ?? createId;
		this.log = options.log;
	}

	initialize(): void {
		if (this.initialized) return;
		initializeJournalSchema(this.sql, this.identity, this.clock.now());
		setMeta(this.sql, "project_id", this.identity.projectId);
		recordConstructorObservation(this.sql, {
			observationId: this.createIdFn(),
			source: "constructor",
			identity: this.identity.workspaceSessionId,
			className: "SessionRuntime",
			incarnation: "unstarted",
			lifecycleGeneration: 1,
			observedAt: this.clock.now(),
		});
		this.initialized = true;
		logAllowlisted(this.log, {
			event: "coordinator_initialized",
			sessionId: this.identity.workspaceSessionId,
			category: "ok",
		});
	}

	private isFatal(): boolean {
		return this.memoryFatal || isFatalLatched(this.sql);
	}

	private latchFatalMemoryAndStore(): void {
		this.memoryFatal = true;
		try {
			this.sql.transaction(() => latchFatal(this.sql));
		} catch {
			// Keep the in-memory latch when the journal cannot persist it.
		}
	}

	private deny(code: string, category: string): never {
		throw new CoordinatorError(code, category, this.createIdFn());
	}

	private assertFreshAuthority(
		authority: CurrentAuthority | null,
		expected?: {
			userId: string;
			projectId: string;
			workspaceSessionId: string;
		},
	): CurrentAuthority {
		if (
			!authority ||
			authority.runtimeOwner !== "trusted_v1" ||
			(expected &&
				(authority.userId !== expected.userId ||
					authority.projectId !== expected.projectId ||
					authority.workspaceSessionId !== expected.workspaceSessionId)) ||
			authority.userId !== this.identity.ownerId ||
			authority.projectId !== this.identity.projectId ||
			authority.workspaceSessionId !== this.identity.workspaceSessionId ||
			authority.projectStatus === "deleting" ||
			authority.sessionStatus === "deleted"
		) {
			this.deny("authority_denied", "forbidden");
		}
		return authority;
	}

	private effectAdmissionAllowed(
		authority: CurrentAuthority,
		effect: EffectV1,
		now: number,
	): boolean {
		if (authority.sessionStatus !== "active") return false;
		if (authority.projectStatus === "deleting") return false;
		const identity = authority.processIdentities.find(
			(row) =>
				row.incarnationId === effect.executorIncarnationId &&
				row.lifecycleGeneration === effect.lifecycleGeneration,
		);
		if (!identity) return false;
		if (authority.capacityExpiresAt == null) return false;
		const expiresAt = authority.capacityExpiresAt;
		const nowSeconds = Math.floor(now / 1000);
		if (expiresAt < nowSeconds && expiresAt < now) return false;
		return true;
	}

	async ensureCanonicalRestore(): Promise<void> {
		this.initialize();
		if (this.canonicalRestore === "ok") return;
		if (this.canonicalRestore === "failed" || this.isFatal()) {
			this.canonicalRestore = "failed";
			this.deny("canonical_restore_failed", "unavailable");
		}
		try {
			const commands = this.sql.transaction(() => listCommands(this.sql));
			for (const command of commands) {
				if (!command.ciphertext) continue;
				await decryptRuntimeText(
					command.ciphertext,
					this.keyring,
					commandAad(this.identity, `command:${command.command_id}`),
				);
			}
			const effects = this.sql.transaction(() =>
				this.sql.query<{
					args_ciphertext: string | null;
					run_id: string;
					assistant_entry_id: string;
					tool_call_id: string;
					attempt: number;
				}>(
					"SELECT args_ciphertext, run_id, assistant_entry_id, tool_call_id, attempt FROM effects",
				),
			);
			for (const effect of effects) {
				if (!effect.args_ciphertext) continue;
				await decryptRuntimeText(
					effect.args_ciphertext,
					this.keyring,
					commandAad(
						this.identity,
						`effect-args:${effect.run_id}:${effect.assistant_entry_id}:${effect.tool_call_id}:${effect.attempt}`,
					),
				);
			}
			const continuations = this.sql.transaction(() =>
				this.sql.query<{
					position: number;
					ciphertext: string | null;
					ciphertext_ref: string | null;
				}>(
					"SELECT position, ciphertext, ciphertext_ref FROM continuations ORDER BY position ASC",
				),
			);
			for (const continuation of continuations) {
				const aad = commandAad(
					this.identity,
					`continuation:${continuation.position}`,
				);
				if (continuation.ciphertext) {
					await decryptRuntimeText(continuation.ciphertext, this.keyring, aad);
				}
			}
			this.canonicalRestore = "ok";
		} catch {
			this.canonicalRestore = "failed";
			this.latchFatalMemoryAndStore();
			this.deny("canonical_restore_failed", "unavailable");
		}
	}

	async readCanonicalContinuation(position: number): Promise<unknown> {
		await this.ensureCanonicalRestore();
		const row = this.sql.transaction(
			() =>
				this.sql.query<{
					position: number;
					ciphertext: string | null;
					ciphertext_ref: string | null;
				}>(
					"SELECT position, ciphertext, ciphertext_ref FROM continuations WHERE position = ?",
					position,
				)[0],
		);
		if (!row?.ciphertext) this.deny("continuation_missing", "not_found");
		const plaintext = await decryptRuntimeText(
			row.ciphertext,
			this.keyring,
			commandAad(this.identity, `continuation:${position}`),
		);
		return JSON.parse(plaintext) as unknown;
	}

	async acceptCommand(input: {
		commandId: string;
		ownerVersion: number;
	}): Promise<SessionRuntimeHandoffAck> {
		this.initialize();
		await this.ensureCanonicalRestore();
		const reconstructed = await this.adapters.reconstructCommand(
			input.commandId,
		);
		if (!reconstructed) this.deny("command_missing", "not_found");
		const command = reconstructed.command;
		if (command.commandId !== input.commandId) {
			this.deny("command_mismatch", "invalid");
		}
		if (command.workspaceSessionId !== this.identity.workspaceSessionId) {
			this.deny("session_mismatch", "not_found");
		}
		if (command.projectId !== this.identity.projectId) {
			this.deny("project_mismatch", "not_found");
		}
		if (command.userId !== this.identity.ownerId) {
			this.deny("owner_mismatch", "forbidden");
		}
		const persistedOwnerVersion = command.runtimeOwnerVersion;
		if (input.ownerVersion !== persistedOwnerVersion) {
			this.deny("owner_version_mismatch", "conflict");
		}
		let authority = this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: command.workspaceSessionId,
				userId: command.userId,
				projectId: command.projectId,
			}),
			{
				userId: command.userId,
				projectId: command.projectId,
				workspaceSessionId: command.workspaceSessionId,
			},
		);
		if (authority.runtimeOwnerVersion !== persistedOwnerVersion) {
			this.deny("stale_owner_version", "conflict");
		}

		const existing = this.sql.transaction(() =>
			getCommand(this.sql, command.commandId),
		);
		if (existing) {
			await this.repairSchedule();
			return {
				version: 1,
				commandId: existing.command_id,
				ownerVersion: Number(existing.owner_version),
				acceptedPosition: Number(existing.command_seq),
				receiptId: existing.receipt_id,
			};
		}

		const content = canonicalCommandContent(command);
		const encrypted = content
			? await encryptRuntimeText(
					content,
					this.keyring,
					commandAad(this.identity, `command:${command.commandId}`),
				)
			: null;

		authority = this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: command.workspaceSessionId,
				userId: command.userId,
				projectId: command.projectId,
			}),
			{
				userId: command.userId,
				projectId: command.projectId,
				workspaceSessionId: command.workspaceSessionId,
			},
		);
		if (authority.runtimeOwnerVersion !== persistedOwnerVersion) {
			this.deny("stale_owner_version", "conflict");
		}

		let canceledPredecessor: ReconstructedAdmission | null = null;
		if (command.kind === "cancel") {
			canceledPredecessor = await this.adapters.reconstructCommand(
				command.targetCommandId,
			);
		}

		const ack = this.sql.transaction(() => {
			if (this.isFatal()) this.deny("fatal_latch", "unavailable");
			const raced = getCommand(this.sql, command.commandId);
			if (raced) {
				return {
					version: 1 as const,
					commandId: raced.command_id,
					ownerVersion: Number(raced.owner_version),
					acceptedPosition: Number(raced.command_seq),
					receiptId: raced.receipt_id,
				};
			}
			const canceled =
				metaValue(this.sql, `cancel_barrier:${command.commandId}`) === "1";
			insertCommand(this.sql, {
				command_id: command.commandId,
				command_seq: command.commandSeq,
				kind: command.kind,
				owner_version: persistedOwnerVersion,
				receipt_id: reconstructed.receiptId,
				payload_hash: reconstructed.payloadHash,
				user_message_id:
					"userMessageId" in command ? (command.userMessageId ?? null) : null,
				assistant_message_id:
					"assistantMessageId" in command
						? (command.assistantMessageId ?? null)
						: null,
				target_run_id:
					"targetRunId" in command ? (command.targetRunId ?? null) : null,
				target_command_id:
					"targetCommandId" in command
						? (command.targetCommandId ?? null)
						: null,
				accepted_at: command.acceptedAt,
				deadline_at: command.deadlineAt,
				consumption_state: canceled ? "canceled" : "accepted",
				stop_barrier: 0,
				ciphertext: encrypted,
				ciphertext_ref: null,
			});
			this.enqueueWakeup("accept", this.clock.now());
			if (command.kind === "stop") {
				this.applyStop(command, persistedOwnerVersion);
			} else if (command.kind === "cancel") {
				this.applyCancel(command, canceledPredecessor);
			} else {
				this.consumeReadyCommands(
					this.clock.now(),
					Number.POSITIVE_INFINITY,
					persistedOwnerVersion,
				);
			}
			return {
				version: 1 as const,
				commandId: command.commandId,
				ownerVersion: persistedOwnerVersion,
				acceptedPosition: command.commandSeq,
				receiptId: reconstructed.receiptId,
			};
		});
		await this.repairSchedule();
		logAllowlisted(this.log, {
			event: "command_accepted",
			commandId: ack.commandId,
			commandSeq: ack.acceptedPosition,
			ownerVersion: ack.ownerVersion,
			sessionId: this.identity.workspaceSessionId,
			kind: command.kind,
			acceptedPosition: ack.acceptedPosition,
			byteCount: encrypted ? encrypted.length : 0,
			category: "ok",
		});
		return ack;
	}

	async control(input: {
		commandId: string;
		ownerVersion: number;
	}): Promise<SessionRuntimeHandoffAck> {
		return this.acceptCommand(input);
	}

	readSnapshot(): SnapshotV1 {
		this.initialize();
		return this.sql.transaction(() => this.snapshotLocked());
	}

	async admitEffect(effect: EffectV1): Promise<{ state: EffectV1["state"] }> {
		this.initialize();
		await this.ensureCanonicalRestore();
		if (this.isFatal()) this.deny("fatal_latch", "unavailable");
		this.dispatchAttemptCount += 1;
		let authority = this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: this.identity.workspaceSessionId,
				userId: this.identity.ownerId,
				projectId: this.identity.projectId,
			}),
		);
		if (!this.effectAdmissionAllowed(authority, effect, this.clock.now())) {
			this.deny("execution_gate", "forbidden");
		}
		const argsJson = JSON.stringify(effect.arguments);
		const argsCipher = await encryptRuntimeText(
			argsJson,
			this.keyring,
			commandAad(
				this.identity,
				`effect-args:${effect.runId}:${effect.assistantEntryId}:${effect.toolCallId}:${effect.attempt}`,
			),
		);
		authority = this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: this.identity.workspaceSessionId,
				userId: this.identity.ownerId,
				projectId: this.identity.projectId,
			}),
		);
		if (!this.effectAdmissionAllowed(authority, effect, this.clock.now())) {
			this.deny("execution_gate", "forbidden");
		}
		const existing = this.sql.transaction(() =>
			getEffect(this.sql, {
				runId: effect.runId,
				assistantEntryId: effect.assistantEntryId,
				toolCallId: effect.toolCallId,
				attempt: effect.attempt,
			}),
		);
		if (existing?.args_ciphertext) {
			const storedArgs = await decryptRuntimeText(
				existing.args_ciphertext,
				this.keyring,
				commandAad(
					this.identity,
					`effect-args:${effect.runId}:${effect.assistantEntryId}:${effect.toolCallId}:${effect.attempt}`,
				),
			);
			if (
				storedArgs !== argsJson ||
				existing.expected_incarnation !== effect.executorIncarnationId ||
				Number(existing.lifecycle_generation) !== effect.lifecycleGeneration
			) {
				this.deny("effect_identity_conflict", "conflict");
			}
		}
		return this.sql.transaction(() => {
			if (this.isFatal()) this.deny("fatal_latch", "unavailable");
			const run = getRun(this.sql, effect.runId);
			if (!run) this.deny("run_missing", "not_found");
			if (Number(run.owner_version) !== authority.runtimeOwnerVersion) {
				this.deny("stale_owner_version", "conflict");
			}
			if (Number(run.epoch) !== effect.runEpoch) {
				this.deny("epoch_mismatch", "conflict");
			}
			if (TERMINAL_RUN.has(run.state) || run.state === "stopping") {
				this.deny("run_barrier", "conflict");
			}
			if (effect.deadline <= this.clock.now()) {
				this.deny("deadline", "conflict");
			}
			const unknown = this.sql.query<{ n: number }>(
				`SELECT count(*) AS n FROM effects
				 WHERE run_id = ? AND state = 'outcome_unknown'`,
				effect.runId,
			)[0];
			if (Number(unknown?.n ?? 0) > 0) {
				this.deny("outcome_unknown", "conflict");
			}
			const current = getEffect(this.sql, {
				runId: effect.runId,
				assistantEntryId: effect.assistantEntryId,
				toolCallId: effect.toolCallId,
				attempt: effect.attempt,
			});
			if (current) {
				if (current.state === "admitted" || current.state === "prepared") {
					if (current.state === "prepared") {
						updateEffectState(
							this.sql,
							{
								runId: effect.runId,
								assistantEntryId: effect.assistantEntryId,
								toolCallId: effect.toolCallId,
								attempt: effect.attempt,
							},
							{ state: "admitted" },
						);
					}
					return { state: "admitted" as const };
				}
				this.deny("effect_conflict", "conflict");
			}
			const logical = listEffectsForLogical(this.sql, {
				runId: effect.runId,
				assistantEntryId: effect.assistantEntryId,
				toolCallId: effect.toolCallId,
			});
			if (
				logical.some(
					(row) =>
						row.state === "prepared" ||
						row.state === "admitted" ||
						row.state === "result_recorded" ||
						row.state === "outcome_unknown",
				)
			) {
				this.deny("effect_write_once", "conflict");
			}
			insertEffect(this.sql, {
				run_id: effect.runId,
				assistant_entry_id: effect.assistantEntryId,
				tool_call_id: effect.toolCallId,
				attempt: effect.attempt,
				state: "prepared",
				args_ciphertext: argsCipher,
				result_ciphertext: null,
				result_ref: null,
				result_digest: null,
				expected_incarnation: effect.executorIncarnationId,
				epoch: effect.runEpoch,
				deadline: effect.deadline,
				outcome_policy: effect.outcomePolicy,
				lifecycle_generation: effect.lifecycleGeneration,
			});
			updateEffectState(
				this.sql,
				{
					runId: effect.runId,
					assistantEntryId: effect.assistantEntryId,
					toolCallId: effect.toolCallId,
					attempt: effect.attempt,
				},
				{ state: "admitted" },
			);
			logAllowlisted(this.log, {
				event: "effect_admitted",
				runId: effect.runId,
				epoch: effect.runEpoch,
				effectAttempt: effect.attempt,
				status: "admitted",
				byteCount: argsCipher.length,
				category: "ok",
			});
			return { state: "admitted" as const };
		});
	}

	async recordEffectResult(input: {
		runId: string;
		assistantEntryId: string;
		toolCallId: string;
		attempt: number;
		result: unknown;
	}): Promise<{ state: EffectV1["state"] }> {
		this.initialize();
		const canonical = JSON.stringify(input.result);
		const digestBuffer = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(canonical),
		);
		const digest = [...new Uint8Array(digestBuffer)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		let resultCipher: string;
		try {
			resultCipher = await encryptRuntimeText(
				canonical,
				this.keyring,
				commandAad(
					this.identity,
					`effect-result:${input.runId}:${input.assistantEntryId}:${input.toolCallId}:${input.attempt}`,
				),
			);
		} catch {
			this.latchFatalMemoryAndStore();
			this.deny("fatal_latch", "unavailable");
		}
		try {
			return this.sql.transaction(() => {
				if (this.isFatal()) this.deny("fatal_latch", "unavailable");
				const existing = getEffect(this.sql, input);
				if (!existing || existing.state !== "admitted") {
					if (
						existing?.state === "result_recorded" &&
						existing.result_digest === digest
					) {
						return { state: "result_recorded" as const };
					}
					if (existing?.state === "result_recorded") {
						throw new CoordinatorError(
							"effect_conflict",
							"conflict",
							this.createIdFn(),
						);
					}
					throw new CoordinatorError(
						"effect_missing",
						"not_found",
						this.createIdFn(),
					);
				}
				updateEffectState(this.sql, input, {
					state: "result_recorded",
					resultCiphertext: resultCipher,
					resultDigest: digest,
				});
				return { state: "result_recorded" as const };
			});
		} catch (error) {
			if (error instanceof CoordinatorError) throw error;
			this.latchFatalMemoryAndStore();
			this.deny("fatal_latch", "unavailable");
		}
	}

	markOutcomeUnknown(input: {
		runId: string;
		assistantEntryId: string;
		toolCallId: string;
		attempt: number;
	}): void {
		this.sql.transaction(() => {
			const existing = getEffect(this.sql, input);
			if (!existing || existing.state !== "admitted") return;
			updateEffectState(this.sql, input, { state: "outcome_unknown" });
			updateRunState(this.sql, input.runId, {
				state: "failed",
				updatedAt: this.clock.now(),
				blockedReviewReason: "outcome_unknown",
			});
			this.queueTerminalProjections(input.runId, "failed", "outcome_unknown");
		});
	}

	async commitContinuation(input: {
		expectedPosition: number;
		snapshot: unknown;
	}): Promise<{ position: number }> {
		this.initialize();
		await this.ensureCanonicalRestore();
		if (this.isFatal()) this.deny("fatal_latch", "unavailable");
		const authority = this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: this.identity.workspaceSessionId,
				userId: this.identity.ownerId,
				projectId: this.identity.projectId,
			}),
		);
		const bytes = new TextEncoder().encode(JSON.stringify(input.snapshot));
		const stored = await encryptRuntimePayload(
			bytes,
			this.keyring,
			commandAad(this.identity, `continuation:${input.expectedPosition + 1}`),
		);
		this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: this.identity.workspaceSessionId,
				userId: this.identity.ownerId,
				projectId: this.identity.projectId,
			}),
		);
		try {
			return this.sql.transaction(() => {
				if (this.isFatal()) this.deny("fatal_latch", "unavailable");
				const runs = listRuns(this.sql);
				const active = runs.filter(
					(run) => !TERMINAL_RUN.has(run.state) && run.state !== "stopping",
				);
				if (active.length === 0)
					this.deny("continuation_superseded", "conflict");
				const run = active[active.length - 1];
				if (
					!run ||
					Number(run.owner_version) !== authority.runtimeOwnerVersion
				) {
					this.deny("stale_owner_version", "conflict");
				}
				const current = continuationPosition(this.sql);
				if (current !== input.expectedPosition) {
					throw new CoordinatorError(
						"position_conflict",
						"conflict",
						this.createIdFn(),
					);
				}
				const next = current + 1;
				let ciphertext: string | null = null;
				let ciphertextRef: string | null = null;
				if (stored.kind === "inline") {
					ciphertext = serializeRuntimeCiphertext(stored.envelope);
				} else {
					ciphertextRef = stored.manifest.recordId;
					this.sql.query(
						`INSERT INTO large_record_manifests (
						record_id, chunk_count, total_length, digest, format_version, committed
					) VALUES (?, ?, ?, ?, ?, 0)`,
						stored.manifest.recordId,
						stored.manifest.chunkCount,
						stored.manifest.totalLength,
						stored.manifest.digest,
						stored.manifest.formatVersion,
					);
					stored.manifest.chunks.forEach((chunk, ordinal) => {
						this.sql.query(
							`INSERT INTO large_record_chunks (record_id, ordinal, ciphertext, byte_length)
						 VALUES (?, ?, ?, ?)`,
							stored.manifest.recordId,
							ordinal,
							serializeRuntimeCiphertext(chunk),
							0,
						);
					});
					this.sql.query(
						"UPDATE large_record_manifests SET committed = 1 WHERE record_id = ?",
						stored.manifest.recordId,
					);
					void serializeRuntimeManifest;
				}
				this.sql.query(
					`INSERT INTO continuations (
					id, position, ciphertext, ciphertext_ref, format_version, committed_at
				) VALUES (?, ?, ?, ?, ?, ?)`,
					this.createIdFn(),
					next,
					ciphertext,
					ciphertextRef,
					RUNTIME_CRYPTO_FORMAT_VERSION,
					this.clock.now(),
				);
				setMeta(this.sql, "continuation_position", String(next));
				insertEvent(this.sql, {
					kind: "state_changed",
					payloadRedacted: JSON.stringify({
						kind: "state_changed",
						targetKind: "session",
						targetId: this.identity.workspaceSessionId,
						status: "continuation_committed",
					}),
					createdAt: this.clock.now(),
				});
				return { position: next };
			});
		} catch (error) {
			if (error instanceof CoordinatorError) throw error;
			this.latchFatalMemoryAndStore();
			this.deny("fatal_latch", "unavailable");
		}
	}

	async reconcile(): Promise<{
		processed: number;
		projectionLag: number;
		nextDeadlineAt: number | null;
	}> {
		this.initialize();
		await this.ensureCanonicalRestore();
		const authority = this.assertFreshAuthority(
			await this.adapters.readCurrentAuthority({
				workspaceSessionId: this.identity.workspaceSessionId,
				userId: this.identity.ownerId,
				projectId: this.identity.projectId,
			}),
		);
		this.consumeOwnerVersion = authority.runtimeOwnerVersion;
		try {
			const result = await processReconcilePass({
				sql: this.sql,
				adapters: this.adapters,
				hooks: {
					consumeReadyCommands: (now, max) =>
						this.consumeReadyCommands(
							now,
							max,
							this.consumeOwnerVersion ?? undefined,
						),
					settleExpiredRuns: (now, max) =>
						settleExpiredRunsNow(
							this.sql,
							now,
							(runId) =>
								this.queueTerminalProjections(
									runId,
									"failed",
									"recovery_deadline_expired",
								),
							max,
						),
				},
				clock: this.clock,
			});
			await this.repairSchedule(result.nextDeadlineAt);
			logAllowlisted(this.log, {
				event: "reconcile",
				sessionId: this.identity.workspaceSessionId,
				processed: result.processed,
				projectionLag: result.projectionLag,
				intentCount: result.processed,
				category: "ok",
			});
			return result;
		} catch {
			logAllowlisted(this.log, {
				event: "reconcile_failed",
				sessionId: this.identity.workspaceSessionId,
				category: "reconcile_failed",
			});
			await this.repairSchedule(this.clock.now());
			return {
				processed: 0,
				projectionLag: pendingProjectionCount(this.sql),
				nextDeadlineAt: this.clock.now(),
			};
		}
	}

	async repairSchedule(nextDeadlineAt?: number | null): Promise<void> {
		const deadline =
			nextDeadlineAt === undefined
				? this.sql.transaction(() =>
						nextWorkDeadline(this.sql, this.clock.now()),
					)
				: nextDeadlineAt;
		if (deadline == null) return;
		await this.scheduler.schedule(new Date(deadline), "reconcileWakeup", {
			reason: "repair",
		});
	}

	forceFatalLatch(): void {
		this.latchFatalMemoryAndStore();
	}

	recordInterruption(runId: string): {
		firstInterruptionAt: number;
		recoveryDeadlineAt: number;
	} {
		return this.sql.transaction(() => {
			const marked = markFirstInterruption(this.sql, runId, this.clock.now());
			this.enqueueWakeup("recovery_deadline", marked.recoveryDeadlineAt);
			return marked;
		});
	}

	private enqueueWakeup(reason: string, deadlineAt: number): void {
		insertWakeup(this.sql, {
			id: this.createIdFn(),
			reason,
			deadline_at: deadlineAt,
			attempt: 0,
			state: "pending",
			payload: JSON.stringify({ reason }),
		});
	}

	private consumeReadyCommands(
		now: number,
		max = Number.POSITIVE_INFINITY,
		ownerVersion?: number,
	): number {
		if (this.isFatal()) return 0;
		let expected = consumedOrdinarySeq(this.sql) + 1;
		let processed = 0;
		while (processed < max) {
			const command = getCommandBySeq(this.sql, expected);
			if (!command) {
				const later = this.sql.query<{ n: number }>(
					"SELECT count(*) AS n FROM commands WHERE command_seq > ?",
					expected,
				)[0];
				if (Number(later?.n ?? 0) > 0) {
					this.enqueueWakeup("gap", now + 1000);
				}
				return processed;
			}
			if (
				ownerVersion != null &&
				Number(command.owner_version) !== ownerVersion &&
				command.kind !== "stop" &&
				command.kind !== "cancel"
			) {
				return processed;
			}
			if (command.kind === "stop") {
				expected += 1;
				setMeta(this.sql, "consumed_ordinary_seq", String(expected - 1));
				processed += 1;
				continue;
			}
			if (command.consumption_state === "canceled") {
				setMeta(this.sql, "consumed_ordinary_seq", String(expected));
				expected += 1;
				processed += 1;
				continue;
			}
			if (command.consumption_state === "consumed") {
				setMeta(this.sql, "consumed_ordinary_seq", String(expected));
				expected += 1;
				processed += 1;
				continue;
			}
			if (command.kind === "cancel") {
				setCommandConsumption(this.sql, command.command_id, "consumed");
				setMeta(this.sql, "consumed_ordinary_seq", String(expected));
				expected += 1;
				processed += 1;
				continue;
			}
			if (command.kind === "prompt") {
				const started = this.startRunFromPrompt(command, now);
				if (!started) return processed;
				const after = getCommand(this.sql, command.command_id);
				if (after?.consumption_state !== "canceled") {
					setCommandConsumption(this.sql, command.command_id, "consumed");
				}
				setMeta(this.sql, "consumed_ordinary_seq", String(expected));
				expected += 1;
				processed += 1;
				continue;
			}
			if (command.kind === "follow_up") {
				const target = command.target_run_id
					? getRun(this.sql, command.target_run_id)
					: undefined;
				if (
					!target ||
					TERMINAL_RUN.has(target.state) ||
					target.state === "stopping"
				) {
					setCommandConsumption(this.sql, command.command_id, "denied");
					this.queueDeniedFollowUp(command);
					setMeta(this.sql, "consumed_ordinary_seq", String(expected));
					expected += 1;
					processed += 1;
					continue;
				}
				setCommandConsumption(this.sql, command.command_id, "consumed");
				this.queueMembershipProjection(command, Number(target.epoch));
				setMeta(this.sql, "consumed_ordinary_seq", String(expected));
				expected += 1;
				processed += 1;
				continue;
			}
			return processed;
		}
		return processed;
	}

	private startRunFromPrompt(
		command: ReturnType<typeof getCommand> & object,
		now: number,
	): boolean {
		const row = command as NonNullable<ReturnType<typeof getCommand>>;
		if (metaValue(this.sql, `run_barrier:${row.command_id}`)) {
			setCommandConsumption(this.sql, row.command_id, "canceled");
			this.queueCanceledCommandProjections(row);
			return true;
		}
		if (Number(row.deadline_at) <= now) {
			insertRun(this.sql, {
				run_id: row.command_id,
				origin_command_id: row.command_id,
				state: "failed",
				epoch: 1,
				owner_version: Number(row.owner_version),
				first_interruption_at: null,
				recovery_deadline_at: null,
				brain_incarnation: null,
				executor_incarnation: null,
				blocked_review_reason: "queue_expired",
				assistant_message_id: row.assistant_message_id,
				user_message_id: row.user_message_id,
				created_at: now,
				updated_at: now,
			});
			this.queueMembershipProjection(row, 1);
			this.queueTerminalProjections(row.command_id, "failed", "queue_expired");
			return true;
		}
		if (hasUnresolvedWriter(this.sql) && !isolationEvidencePresent(this.sql)) {
			this.enqueueWakeup("unresolved_writer", now + 1000);
			return false;
		}
		const epoch = 1;
		insertRun(this.sql, {
			run_id: row.command_id,
			origin_command_id: row.command_id,
			state: "queued",
			epoch,
			owner_version: Number(row.owner_version),
			first_interruption_at: null,
			recovery_deadline_at: null,
			brain_incarnation: null,
			executor_incarnation: null,
			blocked_review_reason: null,
			assistant_message_id: row.assistant_message_id,
			user_message_id: row.user_message_id,
			created_at: now,
			updated_at: now,
		});
		this.queueMembershipProjection(row, epoch);
		insertEvent(this.sql, {
			kind: "state_changed",
			payloadRedacted: JSON.stringify({
				kind: "state_changed",
				targetKind: "run",
				targetId: row.command_id,
				status: "queued",
			}),
			createdAt: now,
		});
		return true;
	}

	private applyStop(command: CommandV1, ownerVersion: number): void {
		if (command.kind !== "stop") return;
		const now = this.clock.now();
		const targetRunId = command.targetRunId;
		setMeta(this.sql, `run_barrier:${targetRunId}`, "1");
		const target = getRun(this.sql, targetRunId);
		const unresolved =
			target &&
			listEffectsByRun(this.sql, targetRunId).some(
				(row) =>
					row.state === "prepared" ||
					row.state === "admitted" ||
					row.state === "outcome_unknown",
			);
		if (target && !TERMINAL_RUN.has(target.state)) {
			const nextEpoch = Number(target.epoch) + 1;
			updateRunState(this.sql, targetRunId, {
				state: unresolved ? "stopping" : "canceled",
				updatedAt: now,
				epoch: nextEpoch,
				blockedReviewReason: unresolved
					? "stop_unresolved_writer"
					: "stop_applied",
			});
			if (!unresolved) {
				this.queueTerminalProjections(targetRunId, "canceled", "stop_applied");
			} else {
				this.enqueueWakeup("stop_reconcile", now + 1000);
			}
		}
		for (const row of listCommands(this.sql)) {
			if (row.command_id === command.commandId) continue;
			const targetsRun =
				row.target_run_id === targetRunId ||
				(row.kind === "prompt" && row.command_id === targetRunId);
			if (!targetsRun) continue;
			if (row.consumption_state === "consumed") continue;
			setCommandConsumption(this.sql, row.command_id, "canceled");
			this.queueCanceledCommandProjections(row);
		}
		setCommandConsumption(this.sql, command.commandId, "consumed");
		this.sql.query(
			"UPDATE commands SET stop_barrier = 1 WHERE command_id = ?",
			command.commandId,
		);
		this.queueProjection({
			targetKind: "command",
			targetId: command.commandId,
			workspaceSessionId: this.identity.workspaceSessionId,
			userId: this.identity.ownerId,
			projectId: command.projectId,
			ownerVersion,
			status: "terminal",
			reasonCode: "stop_applied",
			expectedSourceStatus: "0",
			commandId: command.commandId,
		});
		insertEvent(this.sql, {
			kind: "state_changed",
			payloadRedacted: JSON.stringify({
				kind: "state_changed",
				targetKind: "command",
				targetId: command.commandId,
				status: "applied",
				reasonCode: "stop_applied",
			}),
			createdAt: now,
		});
		this.consumeReadyCommands(now, Number.POSITIVE_INFINITY, ownerVersion);
		void RECOVERY_DEADLINE_MS;
		void currentEpoch;
	}

	private applyCancel(
		command: CommandV1,
		predecessor: ReconstructedAdmission | null,
	): void {
		if (command.kind !== "cancel") return;
		setMeta(this.sql, `cancel_barrier:${command.targetCommandId}`, "1");
		let target = getCommand(this.sql, command.targetCommandId);
		if (
			!target &&
			predecessor &&
			predecessor.command.commandId === command.targetCommandId
		) {
			insertCommand(this.sql, {
				command_id: predecessor.command.commandId,
				command_seq: predecessor.command.commandSeq,
				kind: predecessor.command.kind,
				owner_version: predecessor.command.runtimeOwnerVersion,
				receipt_id: predecessor.receiptId,
				payload_hash: predecessor.payloadHash,
				user_message_id:
					"userMessageId" in predecessor.command
						? (predecessor.command.userMessageId ?? null)
						: null,
				assistant_message_id:
					"assistantMessageId" in predecessor.command
						? (predecessor.command.assistantMessageId ?? null)
						: null,
				target_run_id:
					"targetRunId" in predecessor.command
						? (predecessor.command.targetRunId ?? null)
						: null,
				target_command_id:
					"targetCommandId" in predecessor.command
						? (predecessor.command.targetCommandId ?? null)
						: null,
				accepted_at: predecessor.command.acceptedAt,
				deadline_at: predecessor.command.deadlineAt,
				consumption_state: "canceled",
				stop_barrier: 0,
				ciphertext: null,
				ciphertext_ref: null,
			});
			target = getCommand(this.sql, command.targetCommandId);
		}
		if (target && target.consumption_state === "accepted") {
			setCommandConsumption(this.sql, target.command_id, "canceled");
		}
		if (target) this.queueCanceledCommandProjections(target);
		setCommandConsumption(this.sql, command.commandId, "consumed");
		this.consumeReadyCommands(
			this.clock.now(),
			Number.POSITIVE_INFINITY,
			command.runtimeOwnerVersion,
		);
	}

	private queueMembershipProjection(
		command: NonNullable<ReturnType<typeof getCommand>>,
		epoch: number,
	): void {
		const runId = command.target_run_id ?? command.command_id;
		this.queueProjection({
			targetKind: "membership",
			targetId: command.command_id,
			workspaceSessionId: this.identity.workspaceSessionId,
			userId: this.identity.ownerId,
			projectId: this.identity.projectId,
			ownerVersion: Number(command.owner_version),
			commandId: command.command_id,
			runId,
			runEpoch: epoch,
			userMessageId: command.user_message_id ?? undefined,
			assistantMessageId: command.assistant_message_id ?? undefined,
		});
	}

	private queueCanceledCommandProjections(
		command: NonNullable<ReturnType<typeof getCommand>>,
	): void {
		if (!command.assistant_message_id) return;
		const runId = command.target_run_id ?? command.command_id;
		this.queueMembershipProjection(command, 1);
		this.queueProjection({
			targetKind: "message",
			targetId: command.assistant_message_id,
			workspaceSessionId: this.identity.workspaceSessionId,
			userId: this.identity.ownerId,
			projectId: this.identity.projectId,
			ownerVersion: Number(command.owner_version),
			status: "failed",
			reasonCode: "canceled",
			commandId: command.command_id,
			runId,
		});
	}

	private queueDeniedFollowUp(
		command: NonNullable<ReturnType<typeof getCommand>>,
	): void {
		this.queueCanceledCommandProjections(command);
	}

	private queueTerminalProjections(
		runId: string,
		state: RunState,
		reasonCode: string,
	): void {
		const run = getRun(this.sql, runId);
		if (!run) return;
		const ownerVersion = Number(run.owner_version);
		const status = state === "complete" ? "complete" : "failed";
		const assistants = new Set<string>();
		if (run.assistant_message_id) assistants.add(run.assistant_message_id);
		for (const command of listCommands(this.sql)) {
			if (!command.assistant_message_id) continue;
			if (command.command_id === runId || command.target_run_id === runId) {
				assistants.add(command.assistant_message_id);
				this.queueMembershipProjection(command, Number(run.epoch));
				this.queueProjection({
					targetKind: "message",
					targetId: command.assistant_message_id,
					workspaceSessionId: this.identity.workspaceSessionId,
					userId: this.identity.ownerId,
					projectId: this.identity.projectId,
					ownerVersion,
					status,
					reasonCode,
					commandId: command.command_id,
					runId,
				});
			}
		}
		for (const assistantId of assistants) {
			if (
				[...listCommands(this.sql)].some(
					(command) => command.assistant_message_id === assistantId,
				)
			) {
				continue;
			}
			this.queueProjection({
				targetKind: "message",
				targetId: assistantId,
				workspaceSessionId: this.identity.workspaceSessionId,
				userId: this.identity.ownerId,
				projectId: this.identity.projectId,
				ownerVersion,
				status,
				reasonCode,
				commandId: run.origin_command_id,
				runId,
			});
		}
		this.queueProjection({
			targetKind: "command",
			targetId: run.origin_command_id,
			workspaceSessionId: this.identity.workspaceSessionId,
			userId: this.identity.ownerId,
			projectId: this.identity.projectId,
			ownerVersion,
			status: "terminal",
			reasonCode,
			expectedSourceStatus: "0",
			commandId: run.origin_command_id,
			runId,
		});
	}

	private queueProjection(
		payload: Omit<ProjectionPayload, "coordinatorSeq">,
	): void {
		const coordinatorSeq = nextCoordinatorSeq(this.sql);
		const full: ProjectionPayload = { ...payload, coordinatorSeq };
		if (!full.projectId) {
			full.projectId = payload.projectId;
		}
		insertProjection(this.sql, {
			workspace_session_id: full.workspaceSessionId,
			target_kind: full.targetKind,
			target_id: full.targetId,
			owner_version: full.ownerVersion,
			coordinator_seq: coordinatorSeq,
			payload_redacted: JSON.stringify(full),
			state: "pending",
		});
	}

	private snapshotLocked(): SnapshotV1 {
		const commands = listCommands(this.sql);
		const runs = listRuns(this.sql);
		const events = listEvents(this.sql);
		const lag = pendingProjectionCount(this.sql);
		const activeRun = [...runs]
			.reverse()
			.find((run) => !TERMINAL_RUN.has(run.state));
		const messageStates: SnapshotV1["messageStates"] = [];
		for (const command of commands) {
			if (command.assistant_message_id) {
				const run = getRun(this.sql, command.command_id);
				const terminal = run && TERMINAL_RUN.has(run.state);
				messageStates.push(
					snapshotState(
						command.assistant_message_id,
						terminal
							? run.state === "complete"
								? "complete"
								: "failed"
							: "pending",
						terminal && run.state !== "complete"
							? run.blocked_review_reason
							: null,
					),
				);
			}
			if (command.user_message_id) {
				messageStates.push(snapshotState(command.user_message_id, "complete"));
			}
		}
		const queueState: SnapshotV1["queueState"] = activeRun
			? { status: "running" }
			: commands.some((row) => row.consumption_state === "accepted")
				? { status: "queued" }
				: { status: "idle" };
		const reasonCodes: string[] = [];
		if (lag > 0) reasonCodes.push("projection_lag");
		if (isFatalLatched(this.sql)) reasonCodes.push("fatal_latch");
		return {
			version: 1,
			sessionId: this.identity.workspaceSessionId,
			eventCursor:
				events.length === 0
					? 0
					: Number(events[events.length - 1]?.sequence ?? 0),
			commandStates: commands.map((row) =>
				snapshotState(
					row.command_id,
					row.kind === "stop" && row.consumption_state === "consumed"
						? "applied"
						: row.consumption_state,
					row.kind === "stop" && Number(row.stop_barrier) === 1
						? "stop_applied"
						: null,
				),
			),
			runStates: runs.map((row) =>
				snapshotState(row.run_id, row.state, row.blocked_review_reason),
			),
			messageStates,
			interruptedHistory: runs.some((row) => row.first_interruption_at != null),
			checkpointPosition: continuationPosition(this.sql),
			queueState,
			recoveryState: {
				status: isFatalLatched(this.sql)
					? "failed"
					: lag > 0
						? "pending"
						: "healthy",
			},
			previewState: { status: "stopped" },
			projectionLag: lag,
			reasonCodes,
		};
	}
}

export function createCoordinatorSqlFromDurableObject(ctx: {
	storage: {
		sql: {
			exec: (
				query: string,
				...bindings: import("./journal.js").SqlValue[]
			) => { toArray: () => unknown[] };
		};
		transactionSync: <T>(fn: () => T) => T;
	};
}): CoordinatorSql {
	return createDurableObjectSqlAdapter(ctx.storage.sql, ctx.storage);
}

export type { CoordinatorSql };
