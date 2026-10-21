import { DurableObject } from "cloudflare:workers";
import type {
	CheckpointProjectionV1,
	RestoreCompletionV1,
	RestoreRefusalV1,
} from "../../../packages/runtime-contracts/src/checkpoint.js";
import type {
	ConfigurationAuthorityV1,
	ConfigurationSelectionV1,
} from "../../../packages/runtime-contracts/src/configuration.js";
import {
	literalField,
	strictRecord,
	stringField,
} from "../../../packages/runtime-contracts/src/json.js";
import type { ModelSubjectV1 } from "../../../packages/runtime-contracts/src/model.js";
import type {
	CommandV2,
	QueueDecisionV2,
} from "../../../packages/runtime-contracts/src/product-command.js";
import { parseCommandV2 } from "../../../packages/runtime-contracts/src/product-command.js";
import type { ProjectValueRequestV1 } from "../../../packages/runtime-contracts/src/project-values.js";
import type {
	ProjectionIntentV1,
	RuntimeObservationV1,
} from "../../../packages/runtime-contracts/src/projection.js";
import type { WorkspaceActionResultV1 } from "../../../packages/runtime-contracts/src/workspace-action.js";
import type {
	CheckpointHostPort,
	CheckpointRestorer,
} from "./pi-durable-checkpoints.ts";
import {
	type HostFault,
	type LocalAuthority,
	PiDurableHost,
} from "./pi-durable-host.ts";
import {
	createPrivateModelAdapter,
	type PrivateModelTransport,
} from "./pi-durable-models.ts";
import { createRemoteTools, type RemoteExecutor } from "./pi-durable-tools.ts";
import type {
	WorkspaceController,
	WorkspaceHostPort,
} from "./pi-durable-workspace.ts";
import { parseRuntimeKeyring } from "./runtime-crypto.ts";

export type CandidateRuntimeScope = {
	version: 2;
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	ownerVersion: 1;
};
export function parseCandidateRuntimeScope(
	value: unknown,
): CandidateRuntimeScope {
	const row = strictRecord(
		value,
		["version", "userId", "projectId", "workspaceSessionId", "ownerVersion"],
		"Candidate runtime scope",
	);
	return {
		version: literalField(row, "version", [2]),
		userId: stringField(row, "userId"),
		projectId: stringField(row, "projectId"),
		workspaceSessionId: stringField(row, "workspaceSessionId"),
		ownerVersion: literalField(row, "ownerVersion", [1]),
	};
}
export interface CandidatePrivateProduct extends PrivateModelTransport {
	reconstructCommand(
		commandId: string,
		ownerVersion: number,
	): Promise<CommandV2 | null>;
	readRuntimeAuthority(scope: CandidateRuntimeScope): Promise<LocalAuthority>;
	readCandidateSubject(
		commandId: string,
		ownerVersion: number,
	): Promise<ModelSubjectV1 | null>;
	reconcileCandidateDecision(decision: QueueDecisionV2): Promise<boolean>;
	applyCandidateProjections(
		scope: CandidateRuntimeScope,
		intents: ProjectionIntentV1[],
	): Promise<unknown>;
	applyCandidateCheckpoints(
		scope: CandidateRuntimeScope,
		projections: CheckpointProjectionV1[],
	): Promise<unknown>;
	applyCandidateRestore(
		scope: CandidateRuntimeScope,
		completion: RestoreCompletionV1 | RestoreRefusalV1,
	): Promise<unknown>;
	readCandidateConfigurationAuthority(
		commandId: string,
		input: unknown,
		selection?: unknown,
	): Promise<ConfigurationAuthorityV1>;
	/** Decrypts project values for one admitted shell operation after fresh authority. */
	readCandidateProjectValues(
		scope: CandidateRuntimeScope,
		request: ProjectValueRequestV1,
	): Promise<unknown>;
}
export type CandidateSessionBindings = {
	CANDIDATE_DISPOSABLE: "008-synthetic";
	CANDIDATE_RUNTIME_KEYS: string;
	CandidateProduct: CandidatePrivateProduct;
	CandidateSessions: DurableObjectNamespace<PiDurableProductSession>;
};

export class PiDurableProductSession extends DurableObject<CandidateSessionBindings> {
	protected host: PiDurableHost | undefined;
	protected readonly candidateBoot = crypto.randomUUID();
	protected ordinaryAllowed() {
		return true;
	}
	protected hostFault(_point: HostFault) {}
	/** Deployment composition supplies the session's sandbox; none means tools fail before admission. */
	protected remoteExecutor(): RemoteExecutor | undefined {
		return undefined;
	}
	/** Deployment composition supplies paired restore with the session's execution and store. */
	protected checkpointRestorer(
		_port: CheckpointHostPort,
	): CheckpointRestorer | undefined {
		return undefined;
	}
	/** Deployment composition supplies UI Git and preview; none answers every action unavailable. */
	protected workspaceController(
		_port: WorkspaceHostPort,
	): WorkspaceController | undefined {
		return undefined;
	}
	private opening: Promise<PiDurableHost> | undefined;
	private async scope(value?: unknown) {
		if (this.env.CANDIDATE_DISPOSABLE !== "008-synthetic")
			throw new Error("Candidate composition unavailable");
		const supplied =
			value === undefined ? undefined : parseCandidateRuntimeScope(value);
		const retained =
			await this.ctx.storage.get<CandidateRuntimeScope>("candidate-scope-v2");
		const scope =
			supplied ?? (retained ? parseCandidateRuntimeScope(retained) : undefined);
		if (
			!scope ||
			!this.ctx.id.equals(
				this.env.CandidateSessions.idFromName(scope.workspaceSessionId),
			)
		)
			throw new Error("Candidate namespace mismatch");
		if (
			retained &&
			JSON.stringify(parseCandidateRuntimeScope(retained)) !==
				JSON.stringify(scope)
		)
			throw new Error("Candidate owner mismatch");
		if (!(await this.env.CandidateProduct.readRuntimeAuthority(scope)).current)
			throw new Error("Candidate authority denied");
		if (!retained) {
			await this.ctx.storage.put("candidate-scope-v2", scope);
			await this.ctx.storage.sync();
		}
		return scope;
	}
	protected async activate(value?: unknown) {
		const scope = await this.scope(value);
		if (!this.opening) this.opening = this.open(scope);
		const opening = this.opening;
		try {
			this.host = await opening;
			return this.host;
		} finally {
			if (this.opening === opening) this.opening = undefined;
		}
	}
	private async open(scope: CandidateRuntimeScope) {
		if (this.host && !(await this.host.awaitClosure())) return this.host;
		const keys = strictRecord(
			JSON.parse(this.env.CANDIDATE_RUNTIME_KEYS),
			["currentVersion", "keys"],
			"Candidate runtime keys",
		);
		const keyring = await parseRuntimeKeyring({
			currentVersion: keys.currentVersion,
			keys: keys.keys,
		});
		const product = this.env.CandidateProduct;
		// A session that can reach an executor waits for its baseline pair
		// before any ordinary work; without one, tools fail before admission.
		const executes = this.remoteExecutor() !== undefined;
		return PiDurableHost.open(this.ctx.storage, {
			...(executes
				? {
						checkpoints: {
							applyProjections: (projections: CheckpointProjectionV1[]) =>
								product.applyCandidateCheckpoints(scope, projections),
							completeRestore: (
								completion: RestoreCompletionV1 | RestoreRefusalV1,
							) => product.applyCandidateRestore(scope, completion),
							restorer: (port: CheckpointHostPort) =>
								this.checkpointRestorer(port),
							workspace: (port: WorkspaceHostPort) =>
								this.workspaceController(port),
						},
					}
				: {}),
			now: Date.now,
			fault: (point) => this.hostFault(point),
			retained: {
				ownerId: scope.userId,
				workspaceSessionId: scope.workspaceSessionId,
				keyring,
			},
			authority: () => product.readRuntimeAuthority(scope),
			wakeup: {
				getAlarm: () => this.ctx.storage.getAlarm(),
				setAlarm: (deadline) => this.ctx.storage.setAlarm(deadline),
			},
			candidate: {
				...scope,
				origin: this.candidateBoot,
				ordinaryAllowed: () => this.ordinaryAllowed(),
				reconcileDecision: (decision) =>
					product.reconcileCandidateDecision(decision),
				applyProjections: (intents) =>
					product.applyCandidateProjections(scope, intents),
				configuration: async (commandId) => {
					const subject = await product.readCandidateSubject(
						commandId,
						scope.ownerVersion,
					);
					if (!subject) throw new Error("Candidate configuration unavailable");
					return {
						subject,
						defaultSelection: { model: "faux-1", thinking: "off" },
						authorize: (input, selection) =>
							product.readCandidateConfigurationAuthority(
								commandId,
								input,
								selection,
							),
					};
				},
			},
			options: (guard) => {
				const adapter = createPrivateModelAdapter(
					guard,
					product,
					async (attempt) => {
						const subject = await product.readCandidateSubject(
							attempt.commandId,
							scope.ownerVersion,
						);
						if (!subject)
							throw new Error("Candidate model authority unavailable");
						return subject;
					},
				);
				const remote = createRemoteTools(guard, {
					workspaceSessionId: scope.workspaceSessionId,
					executor: () => this.remoteExecutor(),
					projectValues: (request) =>
						product.readCandidateProjectValues(scope, request),
				});
				adapter.registry.install(remote.extension);
				return {
					now: Date.now,
					models: adapter.models,
					registry: adapter.registry,
					settings: {
						extensions: [adapter.extension, remote.extension],
						toolExecution: "sequential",
						retry: { enabled: false },
						compaction: { enabled: false, backgroundTokens: 0 },
					},
				};
			},
		});
	}
	async deliverCommand(commandId: string, ownerVersion: number) {
		if (ownerVersion !== 1) throw new Error("Candidate owner version denied");
		const reconstructed = await this.env.CandidateProduct.reconstructCommand(
			commandId,
			ownerVersion,
		);
		if (!reconstructed) throw new Error("Candidate command unavailable");
		const command = parseCommandV2(reconstructed);
		const host = await this.activate({
			version: 2,
			userId: command.userId,
			projectId: command.projectId,
			workspaceSessionId: command.workspaceSessionId,
			ownerVersion,
		});
		const targetId =
			command.kind === "stop"
				? command.targetRunId
				: command.kind === "cancel"
					? command.targetCommandId
					: undefined;
		const target = targetId
			? await this.env.CandidateProduct.reconstructCommand(
					targetId,
					ownerVersion,
				)
			: undefined;
		return host.acceptCandidate(command, target);
	}
	async readSelection(
		subject: ModelSubjectV1,
	): Promise<ConfigurationSelectionV1 | null> {
		const host = await this.activate({
			version: 2,
			userId: subject.userId,
			projectId: subject.projectId,
			workspaceSessionId: subject.workspaceSessionId,
			ownerVersion: subject.runtimeOwnerVersion,
		});
		return host.readCandidateSelection();
	}
	async workspaceAction(
		subject: ModelSubjectV1,
		action: unknown,
	): Promise<WorkspaceActionResultV1> {
		const host = await this.activate({
			version: 2,
			userId: subject.userId,
			projectId: subject.projectId,
			workspaceSessionId: subject.workspaceSessionId,
			ownerVersion: subject.runtimeOwnerVersion,
		});
		return host.workspaceAction(action);
	}
	async targetStatus(subject: ModelSubjectV1, runId: string) {
		const host = await this.activate({
			version: 2,
			userId: subject.userId,
			projectId: subject.projectId,
			workspaceSessionId: subject.workspaceSessionId,
			ownerVersion: subject.runtimeOwnerVersion,
		});
		return host.candidateTargetStatus(runId);
	}
	/** Observation checks owner authority, then reads committed tables without opening Pi. */
	async observe(
		subject: ModelSubjectV1,
		cursor?: number,
	): Promise<RuntimeObservationV1> {
		if (this.env.CANDIDATE_DISPOSABLE !== "008-synthetic")
			throw new Error("Candidate composition unavailable");
		const scope = parseCandidateRuntimeScope({
			version: 2,
			userId: subject.userId,
			projectId: subject.projectId,
			workspaceSessionId: subject.workspaceSessionId,
			ownerVersion: subject.runtimeOwnerVersion,
		});
		if (
			!this.ctx.id.equals(
				this.env.CandidateSessions.idFromName(scope.workspaceSessionId),
			)
		)
			throw new Error("Candidate namespace mismatch");
		const retained =
			await this.ctx.storage.get<CandidateRuntimeScope>("candidate-scope-v2");
		if (
			retained &&
			JSON.stringify(parseCandidateRuntimeScope(retained)) !==
				JSON.stringify(scope)
		)
			throw new Error("Candidate owner mismatch");
		if (!(await this.env.CandidateProduct.readRuntimeAuthority(scope)).current)
			throw new Error("Candidate authority denied");
		return PiDurableHost.observe(this.ctx.storage, cursor);
	}
	protected async alarmHost() {
		const retained =
			await this.ctx.storage.get<CandidateRuntimeScope>("candidate-scope-v2");
		if (
			retained &&
			!(
				await this.env.CandidateProduct.readRuntimeAuthority(
					parseCandidateRuntimeScope(retained),
				)
			).current
		) {
			await this.host?.alarm();
			return undefined;
		}
		return this.activate();
	}
	async alarm() {
		const host = await this.alarmHost();
		if (!host) return;
		await host.alarm();
		await host.joinInvocation();
	}
	fetch() {
		return new Response("Not found", { status: 404 });
	}
}
