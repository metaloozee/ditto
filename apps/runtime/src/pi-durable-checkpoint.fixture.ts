import { env, runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import {
	ARCHIVE_COMPATIBILITY_KEY,
	ARCHIVE_FORMAT_VERSION,
	type ArchiveArtifactV1,
} from "../../../packages/runtime-contracts/src/artifacts.js";
import {
	type ArchiveCompletionV1,
	type CheckpointProjectionV1,
	parseCheckpointProjectionsV1,
	type RestoreCompletionV1,
	type RestoreRefusalV1,
} from "../../../packages/runtime-contracts/src/checkpoint.js";
import {
	type CommandV2,
	parseCommandV2,
} from "../../../packages/runtime-contracts/src/product-command.js";
import type {
	ProjectionIntentV1,
	ProjectionOutcome,
} from "../../../packages/runtime-contracts/src/projection.js";
import type { ArtifactPermit, ArtifactStore } from "./pi-durable-artifacts.ts";
import {
	type CheckpointFault,
	createCheckpointPublisher,
} from "./pi-durable-checkpoints.ts";
import { cooperativeFixture } from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFault,
	type HostFixtureDependencies,
	PiDurableHost,
	type PiDurableHostFixture,
} from "./pi-durable-host.ts";
import {
	encoder,
	fakeBranch,
	fakeExecution,
	fakeStore,
	HEAD,
	sha256,
	streamOf,
} from "./pi-durable-recovery.fixture.ts";
import type { RetentionFault } from "./pi-durable-retention.ts";
import {
	createWorkspaceController,
	type WorkspaceController,
	type WorkspaceExecution,
	type WorkspaceFault,
} from "./pi-durable-workspace.ts";
import {
	importRuntimeKeyringFromBytes,
	type RuntimeKeyring,
} from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
		RECOVERY_ARTIFACTS: R2Bucket;
	}
}

/** Shared host, product and recovery fixture for paired publication and restore tests. */

export const subject = {
	version: 1 as const,
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "workspace",
	identityId: "executor",
	incarnationId: "incarnation",
	controllerNamespace: "fixture-pi-durable-execution-v1",
	lifecycleGeneration: 1,
	runtimeOwnerVersion: 1,
	connectionGeneration: 1,
	capabilityRevision: 1,
};
export function command(sequence: number, now: number): CommandV2 {
	return parseCommandV2({
		version: 2,
		kind: "prompt",
		commandId: `command-${sequence}`,
		commandSeq: sequence,
		userId: "owner",
		projectId: "project",
		workspaceSessionId: "workspace",
		runtimeOwnerVersion: 1,
		receiptId: `receipt-${sequence}`,
		acceptedAt: now,
		deadlineAt: now + 900000,
		payloadDigest: String(sequence).repeat(64),
		userMessageId: `user-${sequence}`,
		assistantMessageId: `assistant-${sequence}`,
		text: `Private instruction ${sequence}`,
	});
}

/** In-memory product pointer with the same update-only and cursor rules as D1. */
export function fakeProduct() {
	const state = {
		pointer: {
			current: null as string | null,
			previous: null as string | null,
			generation: 0,
		},
		cursor: 0,
		batches: [] as CheckpointProjectionV1[][],
		fault: undefined as
			| "throw"
			| "lose-ack"
			| "retry"
			| "retry-first"
			| undefined,
	};
	const apply = async (projections: CheckpointProjectionV1[]) => {
		parseCheckpointProjectionsV1(projections);
		state.batches.push(projections);
		if (state.fault === "throw") throw new Error("Product unavailable");
		const results = projections.map((projection, index) => {
			let outcome: ProjectionOutcome;
			if (
				state.fault === "retry" ||
				(state.fault === "retry-first" && index === 0)
			)
				outcome = "retry";
			else if (state.cursor >= projection.projectionVersion)
				outcome = "already_applied";
			else if (
				state.pointer.generation !== projection.expectedMutationGeneration
			)
				outcome = "blocked_membership";
			else {
				state.pointer = {
					current: projection.currentPairId,
					previous: projection.previousPairId,
					generation: projection.mutationGeneration,
				};
				state.cursor = projection.projectionVersion;
				outcome = "applied";
			}
			return { projectionVersion: projection.projectionVersion, outcome };
		});
		if (state.fault === "lose-ack") throw new Error("Lost acknowledgment");
		return results;
	};
	return { apply, state };
}

/** In-memory restore barrier with the same exact-acknowledgment rule as D1. */
export function fakeRestoreProduct() {
	const state = {
		completions: [] as RestoreCompletionV1[],
		refusals: [] as RestoreRefusalV1[],
		applied: new Map<string, string>(),
		fault: undefined as "throw" | "lose-ack" | "retry" | undefined,
	};
	const apply = async (completion: RestoreCompletionV1 | RestoreRefusalV1) => {
		if ("refused" in completion) state.refusals.push(completion);
		else state.completions.push(completion);
		if (state.fault === "throw") throw new Error("Product unavailable");
		if (state.fault === "retry")
			return {
				restoreCommandId: completion.restoreCommandId,
				outcome: "retry",
			};
		const text = JSON.stringify(completion);
		const prior = state.applied.get(completion.restoreCommandId);
		const outcome =
			prior === undefined
				? "applied"
				: prior === text
					? "already_applied"
					: "blocked_membership";
		if (!prior) state.applied.set(completion.restoreCommandId, text);
		if (state.fault === "lose-ack") throw new Error("Lost acknowledgment");
		return { restoreCommandId: completion.restoreCommandId, outcome };
	};
	return { apply, state };
}

/** In-memory archive completion with the same exact-acknowledgment rule as D1. */
export function fakeArchiveProduct() {
	const state = {
		completions: [] as ArchiveCompletionV1[],
		applied: new Map<string, string>(),
		fault: undefined as "throw" | "retry" | "lost" | undefined,
	};
	const apply = async (completion: ArchiveCompletionV1) => {
		state.completions.push(completion);
		if (state.fault === "throw") throw new Error("Product unavailable");
		if (state.fault === "retry")
			return {
				archiveCommandId: completion.archiveCommandId,
				outcome: "retry",
			};
		const text = JSON.stringify(completion);
		const prior = state.applied.get(completion.archiveCommandId);
		const outcome =
			prior === undefined
				? "applied"
				: prior === text
					? "already_applied"
					: "blocked_membership";
		if (!prior) state.applied.set(completion.archiveCommandId, text);
		if (state.fault === "lost") throw new Error("Acknowledgment lost");
		return { archiveCommandId: completion.archiveCommandId, outcome };
	};
	return { apply, state };
}

/** A seed archive built the way the builder would, stored under its own key. */
export async function seed(store: ArtifactStore): Promise<ArchiveArtifactV1> {
	const bytes = encoder.encode(
		JSON.stringify({ files: { "README.md": "seed" }, head: HEAD }),
	);
	const objectKey = "seed/project/seed.tar.gz";
	await store.put(objectKey, streamOf(bytes), bytes.byteLength);
	return {
		version: 1,
		kind: "workspace_archive",
		formatVersion: ARCHIVE_FORMAT_VERSION,
		compatibilityKey: ARCHIVE_COMPATIBILITY_KEY,
		objectKey,
		byteCount: bytes.byteLength,
		extractedBytes: 4,
		digest: await sha256(bytes),
		sourceCommit: HEAD,
	};
}

/** Git and preview over the fake execution's files; one fault hook per method. */
export function fakeWorkspace(execution: ReturnType<typeof fakeExecution>) {
	const snapshot = () => JSON.stringify(execution.state.files);
	const state = {
		present: true,
		committed: snapshot(),
		commits: [] as string[],
		preview: "stopped" as "stopped" | "running",
		url: undefined as string | undefined,
		/** False models a stop that cannot prove the process is gone. */
		terminates: true,
		calls: [] as string[],
		faults: {} as Partial<
			Record<
				Exclude<keyof WorkspaceExecution, "previewUrl">,
				(permit: ArtifactPermit) => unknown
			>
		>,
	};
	const random16 = () => {
		const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
		return [...crypto.getRandomValues(new Uint8Array(16))]
			.map((byte) => alphabet[byte % alphabet.length])
			.join("");
	};
	const enter = async (
		method: Exclude<keyof WorkspaceExecution, "previewUrl">,
		permit: ArtifactPermit,
	) => {
		state.calls.push(method);
		await state.faults[method]?.(permit);
	};
	const changed = () => {
		const before = JSON.parse(state.committed) as Record<string, string>;
		const after = execution.state.files;
		return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
			(path) => before[path] !== after[path],
		).length;
	};
	const workspace: WorkspaceExecution = {
		async present(permit) {
			await enter("present", permit);
			return state.present;
		},
		async gitStatus(permit, request) {
			await enter("gitStatus", permit);
			return {
				branch: request.branch,
				head: execution.state.head,
				changed: changed(),
			};
		},
		async gitCommit(permit, request) {
			await enter("gitCommit", permit);
			if (snapshot() === state.committed)
				return { head: execution.state.head, committed: false };
			execution.state.head = (await sha256(encoder.encode(snapshot()))).slice(
				0,
				40,
			);
			state.committed = snapshot();
			state.commits.push(request.message);
			return { head: execution.state.head, committed: true };
		},
		async previewStart(permit) {
			await enter("previewStart", permit);
			state.preview = "running";
			state.url = `http://10000-c-workspace-${random16()}.localhost/`;
			return { url: state.url };
		},
		async previewUrl() {
			return state.preview === "running" ? state.url : undefined;
		},
		async previewStop(permit) {
			await enter("previewStop", permit);
			if (state.terminates) {
				state.preview = "stopped";
				state.url = undefined;
			}
			return { terminated: state.terminates };
		},
	};
	return { workspace, state };
}

export type Authority = {
	current: boolean;
	generation: number;
	executor: number;
	liveExecutors: number;
};

export async function fixture(
	name: string,
	run: (context: {
		storage: DurableObjectStorage;
		open(): Promise<PiDurableHost>;
		host(): PiDurableHost;
		publisher(
			options?: Partial<{
				store: ArtifactStore;
				fault: (point: CheckpointFault) => void | Promise<void>;
				writers: () => Promise<{ settled: boolean }>;
				branch: ReturnType<typeof fakeBranch>["branch"];
			}>,
		): ReturnType<typeof createCheckpointPublisher>;
		execution: ReturnType<typeof fakeExecution>;
		store: ReturnType<typeof fakeStore>;
		product: ReturnType<typeof fakeProduct>;
		restore: ReturnType<typeof fakeRestoreProduct>;
		archive: ReturnType<typeof fakeArchiveProduct>;
		/** The store is read when the host composes its restorer; the fault at each point. */
		restoreOptions: {
			/** The composition supplies no restorer. */
			unavailable?: boolean;
			store?: ArtifactStore;
			fault?: (point: CheckpointFault) => void | Promise<void>;
		};
		/** Composition of UI Git, preview and backup scheduling; read at each host open. */
		workspaceOptions: {
			enabled?: boolean;
			deferralMs?: number;
			fault?: (point: WorkspaceFault) => void | Promise<void>;
		};
		workspace: ReturnType<typeof fakeWorkspace>;
		/** Retention's composed store and fault; read at each host open. */
		retentionOptions: {
			unavailable?: boolean;
			fault?: (point: RetentionFault) => void | Promise<void>;
		};
		/** The controller of the latest host open. */
		controller(): WorkspaceController;
		/** Product application of terminal assistants, keyed by assistant. */
		assistants: Map<string, ProjectionIntentV1>;
		/** The model fixture of the latest host open. */
		model(): ReturnType<typeof cooperativeFixture>;
		/** Host fault seam, consulted at every host fault point. */
		hostFault: { at?: (point: HostFault) => void };
		authority: Authority;
		keyring: RuntimeKeyring;
		control: { now: number; calls(): number };
		configurationGate: { wait?: () => Promise<void> };
	}) => Promise<void>,
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(name),
		async (_instance, state) => {
			const keyring = await importRuntimeKeyringFromBytes("v1", {
				v1: new Uint8Array(32).fill(1),
			});
			const fixtures: ReturnType<typeof cooperativeFixture>[] = [];
			const control = {
				now: Date.now() + 60000,
				calls: () =>
					fixtures.reduce((sum, fixture) => sum + fixture.providerCalls, 0),
			};
			const authority: Authority = {
				current: true,
				generation: 1,
				executor: 1,
				liveExecutors: 1,
			};
			const product = fakeProduct();
			const restore = fakeRestoreProduct();
			const archive = fakeArchiveProduct();
			const restoreOptions: {
				unavailable?: boolean;
				store?: ArtifactStore;
				fault?: (point: CheckpointFault) => void | Promise<void>;
			} = {};
			const assistants = new Map<string, ProjectionIntentV1>();
			const workspaceOptions: {
				enabled?: boolean;
				deferralMs?: number;
				fault?: (point: WorkspaceFault) => void | Promise<void>;
			} = {};
			const retentionOptions: {
				unavailable?: boolean;
				fault?: (point: RetentionFault) => void | Promise<void>;
			} = {};
			let controller: WorkspaceController | undefined;
			const hostFault: { at?: (point: HostFault) => void } = {};
			const execution = fakeExecution({ "stale.txt": "old" }, "c".repeat(40));
			const store = fakeStore();
			const workspace = fakeWorkspace(execution);
			const writers = async () =>
				controller ? controller.writers() : { settled: true };
			const decisions = new Map<string, string>();
			const configurationGate: { wait?: () => Promise<void> } = {};
			const dependencies: HostFixtureDependencies = {
				now: () => control.now,
				budgets: { workMs: 10_000, drainMs: 1000 },
				fault: (point) => hostFault.at?.(point),
				retained: {
					ownerId: "owner",
					workspaceSessionId: "workspace",
					keyring,
				},
				authority: async () => ({ ...authority }),
				checkpoints: {
					applyProjections: product.apply,
					completeRestore: restore.apply,
					completeArchive: archive.apply,
					restorer: (port) =>
						restoreOptions.unavailable
							? undefined
							: createCheckpointPublisher({
									storage: state.storage,
									host: port,
									binding: {
										ownerId: "owner",
										workspaceSessionId: "workspace",
										keyring,
									},
									execution: execution.execution,
									store: restoreOptions.store ?? store.store,
									writers,
									now: () => control.now,
									fault: (point) => restoreOptions.fault?.(point),
								}),
					workspace: (port) => {
						if (!workspaceOptions.enabled) return undefined;
						const publisher = createCheckpointPublisher({
							storage: state.storage,
							host: port,
							binding: {
								ownerId: "owner",
								workspaceSessionId: "workspace",
								keyring,
							},
							execution: execution.execution,
							store: store.store,
							writers,
							now: () => control.now,
						});
						controller = createWorkspaceController({
							storage: state.storage,
							host: port,
							execution: workspace.workspace,
							publisher: () => publisher,
							branch: "b",
							now: () => control.now,
							deferralMs: workspaceOptions.deferralMs,
							fault: (point) => workspaceOptions.fault?.(point),
						});
						return controller;
					},
					get store() {
						return retentionOptions.unavailable ? undefined : store.store;
					},
					retentionFault: (point) => retentionOptions.fault?.(point),
				},
				candidate: {
					userId: "owner",
					projectId: "project",
					workspaceSessionId: "workspace",
					ownerVersion: 1,
					applyProjections: async (intents) =>
						intents.map((intent) => {
							const prior = assistants.get(intent.assistantMessageId);
							const outcome =
								prior && prior.projectionVersion >= intent.projectionVersion
									? "already_applied"
									: "applied";
							if (outcome === "applied")
								assistants.set(intent.assistantMessageId, intent);
							return {
								assistantMessageId: intent.assistantMessageId,
								projectionVersion: intent.projectionVersion,
								outcome,
							};
						}),
					reconcileDecision: async (decision) => {
						const prior = decisions.get(decision.commandId);
						const text = JSON.stringify(decision);
						if (prior && prior !== text) return false;
						decisions.set(decision.commandId, text);
						return true;
					},
					configuration: async () => {
						await configurationGate.wait?.();
						return {
							subject,
							defaultSelection: { model: "faux-1", thinking: "off" },
							authorize: async () => ({
								version: 1,
								status: "current",
								subject,
							}),
						};
					},
				},
				options: (guard) => {
					const fixture = cooperativeFixture(
						"answer",
						(kind, id, context) => guard.admit(kind, id, context),
						(id, context, evidence) => guard.result(id, context, evidence),
						guard,
					);
					fixtures.push(fixture);
					return {
						now: () => control.now,
						models: fixture.models,
						registry: fixture.registry,
						settings: {
							extensions: [fixture.extension],
							retry: { enabled: false },
							compaction: { enabled: false, backgroundTokens: 0 },
						},
					};
				},
			};
			let host: PiDurableHost | undefined;
			const open = async () => {
				host = await PiDurableHost.open(state.storage, dependencies);
				return host;
			};
			try {
				await run({
					storage: state.storage,
					open,
					host: () => {
						if (!host) throw new Error("Host not open");
						return host;
					},
					publisher: (options = {}) =>
						createCheckpointPublisher({
							storage: state.storage,
							host: (host as PiDurableHost).checkpointPort(),
							binding: {
								ownerId: "owner",
								workspaceSessionId: "workspace",
								keyring,
							},
							execution: execution.execution,
							store: options.store ?? store.store,
							branch: options.branch ?? fakeBranch().branch,
							writers: options.writers,
							now: () => control.now,
							fault: options.fault,
						}),
					execution,
					store,
					product,
					restore,
					archive,
					restoreOptions,
					workspaceOptions,
					workspace,
					retentionOptions,
					controller: () => {
						if (!controller) throw new Error("Workspace not composed");
						return controller;
					},
					assistants,
					hostFault,
					model: () => {
						const latest = fixtures.at(-1);
						if (!latest) throw new Error("Host not open");
						return latest;
					},
					authority,
					keyring,
					control,
					configurationGate,
				});
			} finally {
				// A test that moved time past the invocation end owns that close failure.
				await host?.yield().catch(() => undefined);
				await host?.awaitClosure().catch(() => undefined);
				await state.storage.deleteAlarm();
			}
		},
	);
}

export const submissions = (storage: DurableObjectStorage) =>
	Number(storage.sql.exec("SELECT count(*) AS n FROM submissions").one().n);
export const position = (storage: DurableObjectStorage) =>
	Number(
		storage.sql
			.exec("SELECT next_seq FROM durable_metadata WHERE singleton = 1")
			.one().next_seq,
	);
export const pointer = (storage: DurableObjectStorage) =>
	storage.sql
		.exec<{
			current: string | null;
			previous: string | null;
			mutation_generation: number;
		}>("SELECT current, previous, mutation_generation FROM checkpoint_pointer")
		.one();
export const manifests = (storage: DurableObjectStorage) =>
	Number(
		storage.sql.exec("SELECT count(*) AS n FROM checkpoint_manifests").one().n,
	);

export async function complete(
	storage: DurableObjectStorage,
	host: PiDurableHost,
	sequence: number,
) {
	await expect
		.poll(async () => {
			await host.reconcile();
			return storage.sql
				.exec("SELECT state FROM host_runs WHERE id=?", `command-${sequence}`)
				.toArray()[0]?.state;
		})
		.toBe("complete");
	expect(host.checkpointPort().quiescent()).toBe(true);
}
