import { DurableObject } from "cloudflare:workers";
import type { ArchiveArtifactV1 } from "../../../packages/runtime-contracts/src/artifacts.js";
import {
	type CandidateRuntimeScope,
	parseCandidateRuntimeScope,
} from "../../../packages/runtime-contracts/src/candidate-scope.js";
import type {
	ArchiveCompletionV1,
	CheckpointProjectionV1,
	RestoreCompletionV1,
	RestoreRefusalV1,
} from "../../../packages/runtime-contracts/src/checkpoint.js";
import type {
	ConfigurationAuthorityV1,
	ConfigurationSelectionV1,
} from "../../../packages/runtime-contracts/src/configuration.js";
import { strictRecord } from "../../../packages/runtime-contracts/src/json.js";
import type { ContinuationSeedV1 } from "../../../packages/runtime-contracts/src/lifecycle.js";
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
import type { ArtifactStore } from "./pi-durable-artifacts.ts";
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
import { parseRuntimeKeyring, type RuntimeKeyring } from "./runtime-crypto.ts";

export {
	type CandidateRuntimeScope,
	parseCandidateRuntimeScope,
} from "../../../packages/runtime-contracts/src/candidate-scope.js";
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
	applyCandidateArchive(
		scope: CandidateRuntimeScope,
		completion: ArchiveCompletionV1,
	): Promise<unknown>;
	/** Owned active or archived session whose project is not deleted. */
	readHistoryAuthority(scope: CandidateRuntimeScope): Promise<boolean>;
	/** Owned completed archive whose project is not deleted. */
	readArchivedAuthority(scope: CandidateRuntimeScope): Promise<boolean>;
	/** The session's project is fenced for deletion. */
	readDeletionAuthority(scope: CandidateRuntimeScope): Promise<boolean>;
	readCandidateConfigurationAuthority(
		commandId: string,
		input: unknown,
		selection?: unknown,
	): Promise<ConfigurationAuthorityV1>;
	/** The session's owned branch and verified seed; a denial is data, not a throw. */
	readCandidateBaselineSource(
		scope: CandidateRuntimeScope,
	): Promise<{ branch: string; seed: ArchiveArtifactV1 } | { denied: string }>;
	/** Opens the bounded window for one brokered branch fetch; denial is data, not a throw. */
	openCandidateBranchFetch(
		scope: CandidateRuntimeScope,
		request: { operation: string; branch: string },
	): Promise<
		{ window: string; ref: string; repository: string } | { denied: string }
	>;
	/** Sandbox Git traffic for the open window; the token never leaves the product. */
	brokerCandidateGit(
		scope: CandidateRuntimeScope,
		request: Request,
		containerId: string,
	): Promise<Response>;
	closeCandidateBranchFetch(
		scope: CandidateRuntimeScope,
		window: string,
	): Promise<void>;
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
	/** Deployment composition binds the session's execution to its validated scope before the hooks run. */
	protected prepareExecution(
		_scope: CandidateRuntimeScope,
		_keyring: RuntimeKeyring,
	): void {}
	/** Deployment composition reads the session's baseline source before the host opens. */
	protected async loadExecutionSource(
		_scope: CandidateRuntimeScope,
	): Promise<void> {}
	/** Deployment composition revokes the session's preview URL; none has nothing to revoke. */
	protected async revokePreview(_scope: CandidateRuntimeScope): Promise<void> {}
	/** Deployment composition starts the one-time baseline once the host is open. */
	protected startBaseline(_host: PiDurableHost): void {}
	/** Deployment composition supplies the recovery store; none disables retention. */
	protected recoveryStore(): ArtifactStore | undefined {
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
	private async keyring() {
		const keys = strictRecord(
			JSON.parse(this.env.CANDIDATE_RUNTIME_KEYS),
			["currentVersion", "keys"],
			"Candidate runtime keys",
		);
		return parseRuntimeKeyring({
			currentVersion: keys.currentVersion,
			keys: keys.keys,
		});
	}
	/** Scope of a read or cleanup that never activates the host. */
	private async passiveScope(value: unknown) {
		if (this.env.CANDIDATE_DISPOSABLE !== "008-synthetic")
			throw new Error("Candidate composition unavailable");
		const scope = parseCandidateRuntimeScope(value);
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
		return scope;
	}
	private async open(scope: CandidateRuntimeScope) {
		if (this.host && !(await this.host.awaitClosure())) {
			this.startBaseline(this.host);
			return this.host;
		}
		const keyring = await this.keyring();
		await this.loadExecutionSource(scope);
		this.prepareExecution(scope, keyring);
		const product = this.env.CandidateProduct;
		// A session that can reach an executor waits for its baseline pair
		// before any ordinary work; without one, tools fail before admission.
		const executes = this.remoteExecutor() !== undefined;
		const host = await PiDurableHost.open(this.ctx.storage, {
			...(executes
				? {
						checkpoints: {
							applyProjections: (projections: CheckpointProjectionV1[]) =>
								product.applyCandidateCheckpoints(scope, projections),
							completeRestore: (
								completion: RestoreCompletionV1 | RestoreRefusalV1,
							) => product.applyCandidateRestore(scope, completion),
							completeArchive: (completion: ArchiveCompletionV1) =>
								product.applyCandidateArchive(scope, completion),
							restorer: (port: CheckpointHostPort) =>
								this.checkpointRestorer(port),
							workspace: (port: WorkspaceHostPort) =>
								this.workspaceController(port),
							store: this.recoveryStore(),
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
		this.startBaseline(host);
		return host;
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
		const scope = await this.passiveScope({
			version: 2,
			userId: subject.userId,
			projectId: subject.projectId,
			workspaceSessionId: subject.workspaceSessionId,
			ownerVersion: subject.runtimeOwnerVersion,
		});
		// Archived history stays readable; deletion ends it.
		if (!(await this.env.CandidateProduct.readHistoryAuthority(scope)))
			throw new Error("Candidate authority denied");
		return PiDurableHost.observe(this.ctx.storage, cursor);
	}
	/** Archived history: the same committed tables, with read-only authority. */
	async observeHistory(
		value: unknown,
		cursor?: number,
	): Promise<RuntimeObservationV1> {
		const scope = await this.passiveScope(value);
		if (!(await this.env.CandidateProduct.readHistoryAuthority(scope)))
			throw new Error("Candidate authority denied");
		return PiDurableHost.observe(this.ctx.storage, cursor);
	}
	/** The sealed final context of a completed archive, read without opening Pi. */
	async exportContinuation(value: unknown): Promise<ContinuationSeedV1> {
		const scope = await this.passiveScope(value);
		if (!(await this.env.CandidateProduct.readArchivedAuthority(scope)))
			throw new Error("Candidate authority denied");
		PiDurableHost.acknowledgeArchive(this.ctx.storage);
		const seed = await PiDurableHost.continuationSeed(this.ctx.storage, {
			ownerId: scope.userId,
			workspaceSessionId: scope.workspaceSessionId,
			keyring: await this.keyring(),
		});
		if (!seed) throw new Error("Continuation unavailable");
		return seed;
	}
	async importContinuation(value: unknown, seed: unknown) {
		const host = await this.activate(value);
		return host.importContinuation(seed);
	}
	/**
	 * Removes this session's runtime storage once its project is fenced for
	 * deletion. Recovery objects referenced here go with a composed store.
	 */
	async purgeDeleted(value: unknown) {
		const scope = await this.passiveScope(value);
		if (!(await this.env.CandidateProduct.readDeletionAuthority(scope)))
			throw new Error("Candidate deletion not fenced");
		await this.host?.yield().catch(() => undefined);
		await this.host?.awaitClosure().catch(() => undefined);
		this.host = undefined;
		await this.revokePreview(scope);
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}

	/** Product preview proxy: answers only from a live host and never opens one. */
	async previewAdmit(digest: unknown): Promise<boolean> {
		if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))
			return false;
		return this.host?.previewAdmits(digest) ?? false;
	}
	protected async alarmHost() {
		const retained =
			await this.ctx.storage.get<CandidateRuntimeScope>("candidate-scope-v2");
		if (retained && (await this.deniedAlarm(retained))) return undefined;
		try {
			return await this.activate();
		} catch (error) {
			// Revocation can commit between the check above and activation's own read.
			if (retained && (await this.deniedAlarm(retained))) return undefined;
			throw error;
		}
	}
	private async deniedAlarm(retained: CandidateRuntimeScope) {
		const scope = parseCandidateRuntimeScope(retained);
		if ((await this.env.CandidateProduct.readRuntimeAuthority(scope)).current)
			return false;
		if (await this.env.CandidateProduct.readArchivedAuthority(scope))
			PiDurableHost.acknowledgeArchive(this.ctx.storage);
		await this.host?.alarm();
		return true;
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
