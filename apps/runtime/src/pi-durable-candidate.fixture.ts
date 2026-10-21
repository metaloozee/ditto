/** Candidate host fixture shared by the projection and observation tests. */
import { env, runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import {
	type CommandV2,
	parseCommandV2,
	type QueueDecisionV2,
} from "../../../packages/runtime-contracts/src/product-command.js";
import type {
	ProjectionIntentV1,
	ProjectionOutcome,
} from "../../../packages/runtime-contracts/src/projection.js";
import { cooperativeFixture } from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFault,
	type HostFixtureDependencies,
	PiDurableHost,
	type PiDurableHostFixture,
} from "./pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

export const ANSWER = "Synthetic answer ".repeat(50);
const subject = {
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
	const kind = sequence === 1 ? "prompt" : "follow_up";
	return parseCommandV2({
		version: 2,
		kind,
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
		...(kind === "follow_up" ? { targetRunId: "command-1" } : {}),
	});
}
export function stop(sequence: number, now: number): CommandV2 {
	return {
		version: 2,
		kind: "stop",
		commandId: "stop",
		commandSeq: sequence,
		userId: "owner",
		projectId: "project",
		workspaceSessionId: "workspace",
		runtimeOwnerVersion: 1,
		receiptId: "stop-receipt",
		acceptedAt: now,
		deadlineAt: now + 900000,
		payloadDigest: "d".repeat(64),
		targetRunId: "command-1",
	};
}

export type Product = {
	mode: "ok" | "throw" | "short" | "lose-ack" | "wrong-version" | "retry";
	batches: ProjectionIntentV1[][];
	applied: Map<string, number>;
};

/** In-memory product with update-only, version-ordered application. */
export function product(): Product & {
	apply(intents: ProjectionIntentV1[]): Promise<unknown>;
} {
	const state: Product = { mode: "ok", batches: [], applied: new Map() };
	return Object.assign(state, {
		async apply(intents: ProjectionIntentV1[]) {
			state.batches.push(intents);
			if (state.mode === "throw") throw new Error("Synthetic apply failure");
			const results = intents.map((intent) => {
				const prior = state.applied.get(intent.assistantMessageId) ?? 0;
				let outcome: ProjectionOutcome = "already_applied";
				if (state.mode === "retry") outcome = "retry";
				else if (prior < intent.projectionVersion) {
					state.applied.set(
						intent.assistantMessageId,
						intent.projectionVersion,
					);
					outcome = "applied";
				}
				return {
					assistantMessageId: intent.assistantMessageId,
					projectionVersion:
						intent.projectionVersion + (state.mode === "wrong-version" ? 1 : 0),
					outcome,
				};
			});
			if (state.mode === "lose-ack") throw new Error("Lost acknowledgment");
			return state.mode === "short" ? results.slice(1) : results;
		},
	});
}

export async function fixture(
	name: string,
	run: (
		storage: DurableObjectStorage,
		open: () => Promise<PiDurableHost>,
		control: {
			now: number;
			fault?: HostFault;
			product: ReturnType<typeof product>;
			calls: () => number;
			loseDecision: boolean;
			decisions: QueueDecisionV2[];
		},
	) => Promise<void>,
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
				fault: undefined as HostFault | undefined,
				product: product(),
				loseDecision: false,
				decisions: [] as QueueDecisionV2[],
				calls: () =>
					fixtures.reduce((sum, fixture) => sum + fixture.providerCalls, 0),
			};
			const dependencies: HostFixtureDependencies = {
				now: () => control.now,
				retained: {
					ownerId: "owner",
					workspaceSessionId: "workspace",
					keyring,
				},
				authority: async () => ({
					current: true,
					generation: 1,
					executor: 1,
					liveExecutors: 1,
				}),
				fault: (point) => {
					if (point === control.fault) throw new Error(`Injected ${point}`);
				},
				candidate: {
					userId: "owner",
					projectId: "project",
					workspaceSessionId: "workspace",
					ownerVersion: 1,
					reconcileDecision: async (decision) => {
						control.decisions.push(decision);
						if (control.loseDecision)
							throw new Error("Lost decision acknowledgment");
						return true;
					},
					applyProjections: (intents) => control.product.apply(intents),
					configuration: async () => ({
						subject,
						defaultSelection: { model: "faux-1", thinking: "off" },
						authorize: async () => ({
							version: 1,
							status: "current",
							subject,
						}),
					}),
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
				await run(state.storage, open, control);
			} finally {
				control.fault = undefined;
				await host?.yield();
				await host?.awaitClosure();
				await state.storage.deleteAlarm();
			}
		},
	);
}

export const rows = (storage: DurableObjectStorage, sql: string) =>
	storage.sql.exec(sql).toArray();
export const wakeup = (storage: DurableObjectStorage) =>
	storage.sql
		.exec<{ deadline: number }>(
			"SELECT deadline FROM host_wakeups WHERE id='projection'",
		)
		.toArray()[0]?.deadline;

export async function completeFirst(
	storage: DurableObjectStorage,
	host: PiDurableHost,
	control: { calls: () => number },
) {
	await host.alarm();
	await expect.poll(() => control.calls()).toBe(1);
	await expect
		.poll(async () => {
			await host.reconcile();
			return storage.sql
				.exec("SELECT state FROM host_members WHERE assistant='assistant-1'")
				.one().state;
		})
		.toBe("complete");
}
