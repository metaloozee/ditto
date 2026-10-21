import { env, runInDurableObject } from "cloudflare:test";
import {
	type CommandV2,
	parseCommandV2,
	type QueueDecisionV2,
} from "../../../packages/runtime-contracts/src/product-command.js";
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
export function command(
	sequence: number,
	now: number,
	kind: "prompt" | "follow_up" = sequence === 1 ? "prompt" : "follow_up",
): CommandV2 {
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
export async function fixture(
	name: string,
	run: (
		storage: DurableObjectStorage,
		open: () => Promise<PiDurableHost>,
		state: {
			now: number;
			fault?: HostFault;
			beforeTransition?: (point: HostFault) => void;
			reconcile?: () => Promise<void>;
			configuration?: () => Promise<void>;
			afterSubmission?: () => Promise<void>;
			loseDecision: boolean;
			decisions: Map<string, QueueDecisionV2>;
			calls: () => number;
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
				beforeTransition: undefined as ((point: HostFault) => void) | undefined,
				reconcile: undefined as (() => Promise<void>) | undefined,
				configuration: undefined as (() => Promise<void>) | undefined,
				afterSubmission: undefined as (() => Promise<void>) | undefined,
				loseDecision: false,
				decisions: new Map<string, QueueDecisionV2>(),
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
					control.beforeTransition?.(point);
					if (point === control.fault) throw new Error(`Injected ${point}`);
				},
				afterSubmission: async () => {
					await control.afterSubmission?.();
				},
				candidate: {
					userId: "owner",
					projectId: "project",
					workspaceSessionId: "workspace",
					ownerVersion: 1,
					reconcileDecision: async (decision) => {
						await control.reconcile?.();
						const prior = control.decisions.get(decision.commandId);
						if (prior && JSON.stringify(prior) !== JSON.stringify(decision))
							return false;
						control.decisions.set(decision.commandId, decision);
						if (control.loseDecision)
							throw new Error("Lost decision acknowledgment");
						return true;
					},
					configuration: async () => {
						await control.configuration?.();
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
				await run(state.storage, open, control);
			} finally {
				control.fault = undefined;
				control.beforeTransition = undefined;
				control.loseDecision = false;
				await host?.yield();
				await host?.awaitClosure();
				await state.storage.deleteAlarm();
			}
		},
	);
}
export const submissions = (storage: DurableObjectStorage) =>
	Number(storage.sql.exec("SELECT count(*) AS n FROM submissions").one().n);
