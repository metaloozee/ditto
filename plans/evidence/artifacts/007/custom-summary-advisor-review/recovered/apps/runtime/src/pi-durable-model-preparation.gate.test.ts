import { env, runInDurableObject } from "cloudflare:test";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import {
	createRegistry,
	defineExtension,
	GenerationTask,
	Harness,
	hook,
	type Harness as PublicHarness,
} from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { expect, it } from "vitest";
import {
	cooperativeFixture,
	pendingRemote,
} from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFixtureDependencies,
	PiDurableHost,
	type PiDurableHostFixture,
} from "./pi-durable-host.ts";
import { fixtureDatabase } from "./pi-durable-local.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

it("007 initial gate: prepared generation survives close/reopen and the next request changes within one instruction", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("007-generation-preparation");
	await runInDurableObject(stub, async (_instance, state) => {
		const entered = pendingRemote<void>();
		const release = pendingRemote<void>();
		const requests: unknown[] = [];
		let pause = true;
		let continuations = 0;
		const faux = fauxProvider({ tokensPerSecond: 0 });
		const models = createModels({
			authContext: {
				env: async () => undefined,
				fileExists: async () => false,
			},
		});
		const stream: typeof faux.provider.stream = (
			model,
			transcript,
			options,
		) => {
			const events = createAssistantMessageEventStream();
			const context = options?.signal
				? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
				: BACKGROUND_CONTEXT;
			void (async () => {
				try {
					if (pause) {
						entered.resolve();
						await awaitWithContext(release.promise, context);
					}
					context.abortSignal?.throwIfAborted();
					requests.push(
						JSON.parse(
							JSON.stringify({
								model: model.id,
								thinking:
									options && "reasoning" in options
										? options.reasoning
										: undefined,
								messages: transcript.messages,
							}),
						),
					);
					const message = {
						...fauxAssistantMessage("Synthetic answer", { timestamp: 1 }),
						model: model.id,
					};
					events.push({ type: "done", reason: "stop", message });
				} catch {
					const message = fauxAssistantMessage([], {
						stopReason: "aborted",
						timestamp: 1,
					});
					events.push({ type: "error", reason: "aborted", error: message });
				} finally {
					events.end();
				}
			})();
			return events;
		};
		models.setProvider({
			...faux.provider,
			getModels: () => [
				...faux.provider.getModels(),
				{
					...faux.provider.getModels()[0]!,
					id: "faux-2",
					name: "Synthetic second model",
				},
			],
			stream,
			streamSimple: stream,
		});
		const extension = defineExtension({
			name: "007-preparation",
			hooks: [
				hook(GenerationTask, {
					onYield: () =>
						continuations++ === 0
							? { continue: "Synthetic continuation" }
							: undefined,
				}),
			],
		});
		const registry = createRegistry();
		registry.install(extension);
		const options = {
			models,
			registry,
			settings: {
				extensions: [extension],
				compaction: { enabled: false },
				retry: { enabled: false },
			},
		};
		let harness = await Harness.open(
			await SqliteStorage.open(fixtureDatabase(state.storage)),
			options,
			BACKGROUND_CONTEXT,
		);
		let root = await harness.root(BACKGROUND_CONTEXT, {
			agent: {
				model: { provider: "faux", modelId: "faux-1" },
				thinkingLevel: "low",
			},
		});
		await root.submit(
			{
				type: "input",
				content: "Synthetic initial instruction",
				requestId: "007-initial",
			},
			BACKGROUND_CONTEXT,
		);
		await entered.promise;
		const before = (await harness.inspect(BACKGROUND_CONTEXT)).tasks.find(
			(task) => task.record.kind === "pi.generation",
		)!.record;
		expect(before.state.checkpoint).toMatchObject({
			phase: "request",
			model: { provider: "faux", modelId: "faux-1" },
			thinkingLevel: "low",
		});
		await root.configure(
			{ model: { provider: "faux", modelId: "faux-2" }, thinkingLevel: "high" },
			BACKGROUND_CONTEXT,
		);
		await harness.close(BACKGROUND_CONTEXT);
		expect(requests).toEqual([]);
		pause = false;
		harness = await Harness.open(
			await SqliteStorage.open(fixtureDatabase(state.storage)),
			options,
			BACKGROUND_CONTEXT,
		);
		root = await harness.root(BACKGROUND_CONTEXT);
		const reopened = (await harness.inspect(BACKGROUND_CONTEXT)).tasks.find(
			(task) => task.record.kind === "pi.generation",
		)!.record;
		expect(reopened.state.checkpoint).toEqual(before.state.checkpoint);
		await root.waitForIdle(BACKGROUND_CONTEXT);
		expect(requests).toMatchObject([
			{
				model: "faux-1",
				thinking: "low",
				messages: [{ role: "user", content: "Synthetic initial instruction" }],
			},
			{
				model: "faux-2",
				thinking: "high",
				messages: [
					{ role: "user", content: "Synthetic initial instruction" },
					{
						role: "assistant",
						content: [{ type: "text", text: "Synthetic answer" }],
					},
					{ role: "user", content: "Synthetic continuation" },
				],
			},
		]);
		await harness.close(BACKGROUND_CONTEXT);
	});
});

it("007 initial gate: prepared compaction must resume through the integrated mandatory guard after reopen before first admission", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("007-compaction-preparation");
	await runInDurableObject(stub, async (_instance, state) => {
		let now = Date.now() + 60_000;
		let hold = false;
		const entered = pendingRemote<void>();
		const release = pendingRemote<void>();
		let fixture!: ReturnType<typeof cooperativeFixture>;
		const dispatched: {
			model: string;
			thinking: unknown;
			maxTokens: unknown;
		}[] = [];
		const dependencies: HostFixtureDependencies = {
			now: () => now,
			authority: async () => ({ current: true, generation: 1, executor: 1 }),
			budgets: { workMs: 10_000, drainMs: 1000 },
			wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
			prepareModel: async () => {
				if (hold) {
					entered.resolve();
					await release.promise;
				}
			},
			options: (guard) => {
				fixture = cooperativeFixture(
					"answer",
					(kind, id, context) => guard.admit(kind, id, context),
					(id, context, evidence) => guard.result(id, context, evidence),
					{
						...guard,
						model: (request, context, start) =>
							guard.model(request, context, () => {
								dispatched.push({
									model: request.model.id,
									thinking: request.options.reasoning,
									maxTokens: request.options.maxTokens,
								});
								return start();
							}),
					},
				);
				const provider = fixture.models.getProvider("faux")!;
				fixture.models.setProvider({
					...provider,
					getModels: () => [
						...provider.getModels(),
						{
							...provider.getModels()[0]!,
							id: "faux-2",
							name: "Synthetic second model",
						},
					],
				});
				return {
					now: () => now,
					models: fixture.models,
					registry: fixture.registry,
					settings: {
						extensions: [fixture.extension],
						toolExecution: "sequential",
						retry: { enabled: false },
						compaction: {
							enabled: false,
							backgroundTokens: 0,
							keepRecentTokens: 1,
							reserveTokens: 64,
						},
					},
				};
			},
		};
		let host = await PiDurableHost.open(state.storage, dependencies);
		await host.accept("007-command", "Synthetic context ".repeat(50));
		await host.schedule("007-command");
		const activeHarness: unknown = Reflect.get(host, "harness");
		if (
			!activeHarness ||
			typeof activeHarness !== "object" ||
			!("waitForIdle" in activeHarness) ||
			typeof activeHarness.waitForIdle !== "function"
		)
			throw new Error("Missing test-only public Harness");
		const harness = activeHarness as PublicHarness;
		await harness.waitForIdle(BACKGROUND_CONTEXT);
		const root = await harness.root(BACKGROUND_CONTEXT);
		await root.configure({ thinkingLevel: "low" }, BACKGROUND_CONTEXT);
		hold = true;
		const taskId = await host.compact("007-command");
		await entered.promise;
		const before = await host.task(taskId);
		expect(before?.state.checkpoint).toEqual({ phase: "select" });
		const association = state.storage.sql
			.exec<{
				task: number;
				command: string;
				prepared: string;
				digest: string;
			}>(
				"SELECT task, command, prepared, digest FROM host_tasks WHERE task = ?",
				Number(taskId),
			)
			.one();
		expect(association).toMatchObject({
			task: Number(taskId),
			command: "007-command",
			prepared: expect.any(String),
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(JSON.parse(association.prepared)).toMatchObject({
			policy: "ditto-summary-1",
			task: Number(taskId),
			conversation: 1,
			model: { provider: "faux", modelId: "faux-1" },
			thinkingLevel: "low",
			options: {
				maxRetries: 0,
				maxTokens: 1024,
				cacheRetention: "none",
				reasoning: "low",
			},
			transcript: { messages: [{ role: "system" }, { role: "user" }] },
		});
		expect(
			state.storage.sql.exec("SELECT id FROM host_effects").toArray(),
		).toHaveLength(1);
		expect(fixture.providerCalls).toBe(1);
		await root.configure(
			{ model: { provider: "faux", modelId: "faux-2" }, thinkingLevel: "high" },
			BACKGROUND_CONTEXT,
		);
		await host.yield();
		hold = false;
		host = await PiDurableHost.open(state.storage, dependencies);
		expect((await host.task(taskId))?.state.checkpoint).toEqual(
			before?.state.checkpoint,
		);
		now += 1000;
		await host.schedule("007-command");
		const reopenedHarness = Reflect.get(host, "harness") as PublicHarness;
		await reopenedHarness.waitForTask(taskId, BACKGROUND_CONTEXT);
		const after = await host.task(taskId);
		await host.accept("007-follow", "Synthetic newly prepared request", {
			run: "007-command",
			user: "007-follow-user",
			assistant: "007-follow-assistant",
			sequence: 2,
		});
		await host.schedule("007-follow");
		await host.waitIdle();
		console.log(
			"007 compaction gate evidence",
			JSON.stringify({
				task: Number(taskId),
				before: before?.state.checkpoint,
				after: after?.state,
				attempts: fixture.providerAttempts,
				dispatched: fixture.providerCalls,
				requests: dispatched,
			}),
		);
		await host.yield();
		release.resolve();
		expect(after?.state).toMatchObject({
			status: "terminal",
			outcome: { status: "completed" },
		});
		expect(fixture.providerCalls).toBe(2);
		expect(dispatched).toEqual([
			{ model: "faux-1", thinking: undefined, maxTokens: undefined },
			{ model: "faux-1", thinking: "low", maxTokens: 1024 },
			{ model: "faux-2", thinking: "high", maxTokens: undefined },
		]);
	});
});
