import {
	env,
	listDurableObjectIds,
	runDurableObjectAlarm,
	runInDurableObject,
} from "cloudflare:test";
import {
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	createRegistry,
	defineExtension,
	defineTask,
	Harness,
	type Storage,
} from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
	cooperativeFixture,
	type FixturePhase,
	pendingRemote,
} from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFault,
	type HostFixtureDependencies,
	type LocalAuthority,
	PiDurableHost,
	PiDurableHostFixture,
} from "./pi-durable-host.ts";
import { fixtureDatabase } from "./pi-durable-local.ts";
import { EncryptedPiStorage } from "./pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

afterEach(async () => {
	for (const id of await listDurableObjectIds(env.PI_HOST_STORAGE)) {
		await runInDurableObject(
			env.PI_HOST_STORAGE.get(id),
			async (instance, state) => {
				try {
					await instance.host?.yield();
				} catch {
					/* Injected storage failures remain failures in their tests. */
				}
				await instance.alarmCompletion;
				await state.storage.deleteAlarm();
				await state.storage.sync();
			},
		);
	}
});

function isRecoveryProbe(
	value: unknown,
): value is Pick<Harness, "resume" | "root"> {
	return (
		typeof value === "object" &&
		value !== null &&
		"resume" in value &&
		typeof value.resume === "function" &&
		"root" in value &&
		typeof value.root === "function"
	);
}

function phaseOf(value: unknown): unknown {
	return typeof value === "object" && value !== null && "phase" in value
		? value.phase
		: undefined;
}

function taskFacts(record: unknown) {
	if (typeof record !== "string") throw new Error("Expected task JSON");
	const value: unknown = JSON.parse(record);
	if (typeof value !== "object" || value === null)
		throw new Error("Expected task record");
	const state = "state" in value ? value.state : undefined;
	const checkpoint =
		typeof state === "object" && state !== null && "checkpoint" in state
			? state.checkpoint
			: undefined;
	return {
		phase: phaseOf(checkpoint),
		abortRequested:
			"abortRequested" in value ? value.abortRequested : undefined,
		until:
			typeof checkpoint === "object" &&
			checkpoint !== null &&
			"until" in checkpoint
				? checkpoint.until
				: undefined,
	};
}

function hostComposition(phase: FixturePhase) {
	let now = Date.now() + 60_000;
	let fault: HostFault | undefined;
	let unavailable = false;
	let authority: LocalAuthority = { current: true, generation: 1, executor: 1 };
	let prepare: Promise<void> | undefined;
	const fixtures: ReturnType<typeof cooperativeFixture>[] = [];
	return {
		fixtures,
		set now(value: number) {
			now = value;
		},
		get now() {
			return now;
		},
		set fault(value: HostFault | undefined) {
			fault = value;
		},
		set unavailable(value: boolean) {
			unavailable = value;
		},
		set authority(value: LocalAuthority) {
			authority = value;
		},
		set prepare(value: Promise<void> | undefined) {
			prepare = value;
		},
		dependencies: {
			now: () => now,
			authority: async () => {
				if (prepare) await prepare;
				return authority;
			},
			fault: (point: HostFault) => {
				if (unavailable || point === fault)
					throw new Error(`Synthetic storage/transition failure: ${point}`);
			},
			options: (guard: import("./pi-durable-host.ts").HostGuard) => {
				const fixture = cooperativeFixture(
					phase,
					(kind, id, context) => guard.admit(kind, id, context),
					(id, context, evidence) => guard.result(id, context, evidence),
				);
				fixtures.push(fixture);
				return {
					models: fixture.models,
					registry: fixture.registry,
					settings: {
						extensions: [fixture.extension],
						toolExecution: "sequential" as const,
						retry: { enabled: true, maxRetries: 1, baseDelayMs: 10_000 },
						compaction: { enabled: false, backgroundTokens: 0 },
					},
				};
			},
		},
	};
}

const INVOCATION_BUDGET_MS = 50;

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("Pi Durable public bounded-host gate in workerd", () => {
	it("passive reads admit nothing but close cannot bound a noncooperative invocation", async () => {
		const stub = env.PI_FIXTURE_STORAGE.getByName("bounded-host-public-api");
		await runInDurableObject(stub, async (_instance, state) => {
			const entered = deferred();
			const release = deferred();
			let admissions = 0;
			let lateActions = 0;
			let signal: AbortSignal | undefined;
			const task = defineTask<null, { phase: "blocked" }, null>({
				name: "ditto-l1-noncooperative",
				version: 1,
				initial: () => ({ phase: "blocked" }),
				phases: {
					blocked: async (_task, runtime) => {
						admissions++;
						signal = runtime.signal;
						entered.resolve();
						await release.promise;
						lateActions++;
					},
				},
				abort: async () => {
					throw new Error("User cancellation was not requested");
				},
			});
			const registry = createRegistry();
			registry.install(
				defineExtension({ name: "ditto-l1-probe", tasks: [task] }),
			);
			const models = createModels({
				authContext: {
					env: async () => undefined,
					fileExists: async () => false,
				},
			});
			const harness = await Harness.open(
				await SqliteStorage.open(fixtureDatabase(state.storage)),
				{ models, registry },
				BACKGROUND_CONTEXT,
			);
			let close: Promise<void> | undefined;
			try {
				const root = await harness.root(BACKGROUND_CONTEXT);
				const id = await root.commit(
					(tx) =>
						tx.createTask(task, null, { ownership: { kind: "conversation" } }),
					BACKGROUND_CONTEXT,
				);
				expect((await harness.inspect(BACKGROUND_CONTEXT)).scheduling).toBe(
					"paused",
				);
				await root.entries({}, 20, undefined, BACKGROUND_CONTEXT);
				await root.context(BACKGROUND_CONTEXT);
				const watch = await root.watch(BACKGROUND_CONTEXT);
				await watch.stop();
				const graph = await harness.watchTaskGraph(BACKGROUND_CONTEXT);
				await graph.stop();
				expect(admissions).toBe(0);
				state.storage.sql.exec(
					"CREATE TABLE l1_budget (budget_ms INTEGER, deadline INTEGER)",
				);
				state.storage.sql.exec(
					"INSERT INTO l1_budget VALUES (?, ?)",
					INVOCATION_BUDGET_MS,
					Date.now() + INVOCATION_BUDGET_MS,
				);
				harness.resume();
				await entered.promise;
				const controller = new AbortController();
				let joined = false;
				close = harness.close(BACKGROUND_CONTEXT).then(() => {
					joined = true;
				});
				const timer = setTimeout(
					() => controller.abort(),
					INVOCATION_BUDGET_MS,
				);
				try {
					await expect(
						harness.close(
							withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
						),
					).rejects.toThrow();
				} finally {
					clearTimeout(timer);
				}
				expect(signal?.aborted).toBe(true);
				expect(joined).toBe(false);
				expect(admissions).toBe(1);
				expect(lateActions).toBe(0);
				const record = state.storage.sql
					.exec<{ record: string }>("SELECT record FROM tasks WHERE id = ?", id)
					.one();
				expect(JSON.parse(record.record).abortRequested).not.toBe(true);
				release.resolve();
				await close;
				expect(lateActions).toBe(1);
				expect(joined).toBe(true);
				const reopened = await Harness.open(
					await SqliteStorage.open(fixtureDatabase(state.storage)),
					{ models, registry },
					BACKGROUND_CONTEXT,
				);
				try {
					expect((await reopened.inspect(BACKGROUND_CONTEXT)).scheduling).toBe(
						"paused",
					);
					const recovered = await reopened.getTask(id, BACKGROUND_CONTEXT);
					expect(recovered?.state.status).toBe("pending");
					expect(recovered?.abortRequested).not.toBe(true);
					expect(admissions).toBe(1);
				} finally {
					await reopened.close(BACKGROUND_CONTEXT);
				}
			} finally {
				release.resolve();
				await (close ?? harness.close(BACKGROUND_CONTEXT));
			}
		});
	}, 10_000);
});

describe("Pi built-in cooperative host-yield gate", () => {
	it.each([
		"request",
		"stream",
		"tool",
	] as const)("actually closes during %s while remote work stays pending", async (phase) => {
		const stub = env.PI_FIXTURE_STORAGE.getByName(`cooperative-${phase}`);
		await runInDurableObject(stub, async (_instance, state) => {
			state.storage.sql.exec(
				"CREATE TABLE l1_effects (id TEXT PRIMARY KEY, kind TEXT, state TEXT)",
			);
			state.storage.sql.exec(
				"CREATE TABLE l1_fence (sealed INTEGER, yield_at INTEGER, end_at INTEGER, wake_at INTEGER)",
			);
			const start = Date.now();
			state.storage.sql.exec(
				"INSERT INTO l1_fence VALUES (0, ?, ?, ?)",
				start + 1000,
				start + 2000,
				start + 1000,
			);
			const fixture = cooperativeFixture(phase, (kind, id) => {
				if (
					state.storage.sql.exec("SELECT sealed FROM l1_fence").one().sealed !==
					0
				)
					throw new Error("Admission fenced");
				state.storage.sql.exec(
					"INSERT INTO l1_effects VALUES (?, ?, 'admitted')",
					id,
					kind,
				);
			});
			const options = {
				models: fixture.models,
				registry: fixture.registry,
				settings: {
					extensions: [fixture.extension],
					toolExecution: "sequential" as const,
					retry: { enabled: false },
					compaction: { enabled: false, backgroundTokens: 0 },
				},
			};
			const harness = await Harness.open(
				await SqliteStorage.open(fixtureDatabase(state.storage)),
				options,
				BACKGROUND_CONTEXT,
			);
			let closed = false;
			try {
				const root = await harness.root(BACKGROUND_CONTEXT, {
					agent: {
						model: { provider: "faux", modelId: "faux-1" },
						tools: [fixture.tool],
						extensions: [fixture.extension],
					},
				});
				await root.entries({}, 20, undefined, BACKGROUND_CONTEXT);
				await root.context(BACKGROUND_CONTEXT);
				const watch = await root.watch(BACKGROUND_CONTEXT);
				await watch.stop();
				expect(fixture.providerCalls).toBe(0);
				expect(fixture.executionCalls).toBe(0);
				const submission = await root.submit(
					{
						type: "input",
						content: "Exercise real Pi generation and sequential remote tool.",
						requestId: `cooperative-${phase}`,
					},
					BACKGROUND_CONTEXT,
				);
				await fixture.entered.promise;
				expect(fixture.remote.settled).toBe(false);
				state.storage.sql.exec("UPDATE l1_fence SET sealed = 1");
				await harness.close(BACKGROUND_CONTEXT);
				closed = true;
				await fixture.localEnded.promise;
				expect(Date.now()).toBeLessThan(start + 2000);
				expect(fixture.signal?.aborted).toBe(true);
				expect(fixture.remote.settled).toBe(false);
				expect(fixture.providerCalls).toBe(1);
				expect(fixture.executionCalls).toBe(phase === "tool" ? 1 : 0);
				const before = state.storage.sql
					.exec("SELECT record FROM tasks ORDER BY id")
					.toArray();
				for (const row of before)
					expect(taskFacts(row.record).abortRequested).not.toBe(true);
				const receipt = state.storage.sql
					.exec("SELECT status FROM submissions WHERE id = ?", submission.id)
					.one();
				expect(receipt.status).not.toBe("unanswered");
				if (phase === "stream")
					fixture.remote.reject(new Error("Synthetic late remote rejection"));
				else fixture.remote.resolve();
				await Promise.resolve();
				await Promise.resolve();
				expect(fixture.remote.observed).toEqual([
					phase === "stream" ? "rejected" : "resolved",
				]);
				expect(
					state.storage.sql
						.exec("SELECT record FROM tasks ORDER BY id")
						.toArray(),
				).toEqual(before);
				const reopened = await Harness.open(
					await SqliteStorage.open(fixtureDatabase(state.storage)),
					options,
					BACKGROUND_CONTEXT,
				);
				try {
					expect((await reopened.inspect(BACKGROUND_CONTEXT)).scheduling).toBe(
						"paused",
					);
					expect(fixture.providerCalls).toBe(1);
					expect(fixture.executionCalls).toBe(phase === "tool" ? 1 : 0);
				} finally {
					await reopened.close(BACKGROUND_CONTEXT);
				}
			} finally {
				fixture.remote.resolve();
				if (!closed) await harness.close(BACKGROUND_CONTEXT);
			}
		});
	}, 10_000);
});

describe("Guarded local host with real DO SQLite", () => {
	it.each([
		"request",
		"stream",
		"tool",
	] as const)("fences %s, accounts actual close, retains effects across two passive reopens", async (phase) => {
		const stub = env.PI_HOST_STORAGE.getByName(`guarded-${phase}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition(phase);
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.history();
			await host.observe();
			expect((await host.inspect()).scheduling).toBe("paused");
			expect(composition.fixtures[0]?.providerCalls).toBe(0);
			await host.accept("input-original", "Synthetic remote command");
			expect(
				state.storage.sql.exec("SELECT state FROM host_inbox").one().state,
			).toBe("accepted");
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_wakeups")
					.one().count,
			).toBe(1);
			expect(composition.fixtures[0]?.providerCalls).toBe(0);
			const invocation = await host.schedule("input-original");
			const original = composition.fixtures[0];
			if (!original) throw new Error("Missing fixture");
			await original.entered.promise;
			expect(invocation.yield_at).toBe(invocation.started + 1000);
			expect(invocation.end_at).toBe(invocation.started + 2000);
			expect(await host.schedule("input-original", invocation.id)).toEqual(
				invocation,
			);
			composition.now = invocation.yield_at;
			const close = host.yield();
			expect((await host.schedule("input-original", invocation.id)).id).toBe(
				invocation.id,
			);
			await close;
			expect(
				state.storage.sql.exec("SELECT state FROM host_invocations").one()
					.state,
			).toBe("closed");
			expect(
				state.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced,
			).toBe(1);
			expect(original.remote.settled).toBe(false);
			expect(original.signal?.aborted).toBe(true);
			const effects = state.storage.sql
				.exec("SELECT * FROM host_effects ORDER BY id")
				.toArray();
			expect(
				effects.filter((effect) => effect.state === "admitted"),
			).toHaveLength(1);
			if (phase === "tool") {
				expect(original.executionCalls).toBe(1);
				expect(effects.find((effect) => effect.kind === "tool")?.executor).toBe(
					1,
				);
			}
			for (const row of state.storage.sql
				.exec("SELECT record FROM tasks")
				.toArray())
				expect(taskFacts(row.record).abortRequested).not.toBe(true);
			const tasks = state.storage.sql
				.exec("SELECT record FROM tasks ORDER BY id")
				.toArray();
			if (phase === "stream")
				original.remote.reject(new Error("Late synthetic remote rejection"));
			else original.remote.resolve();
			await Promise.resolve();
			await Promise.resolve();
			expect(
				state.storage.sql
					.exec("SELECT record FROM tasks ORDER BY id")
					.toArray(),
			).toEqual(tasks);
			expect(
				state.storage.sql
					.exec("SELECT * FROM host_effects ORDER BY id")
					.toArray(),
			).toEqual(effects);
			for (let reopen = 0; reopen < 2; reopen++) {
				host = await PiDurableHost.open(
					state.storage,
					composition.dependencies,
				);
				instance.host = host;
				await host.history();
				await host.observe();
				expect((await host.inspect()).scheduling).toBe("paused");
				await expect(host.schedule("input-original")).rejects.toThrow(
					"Unresolved effect",
				);
				await expect(
					host.admit("tool", "unsafe-replay", BACKGROUND_CONTEXT),
				).rejects.toThrow("Unresolved effect");
				const fixture = composition.fixtures[reopen + 1];
				if (!fixture) throw new Error("Missing reopen fixture");
				const model = fixture.models.getModel("faux", "faux-1");
				if (!model) throw new Error("Missing fixture model");
				const denied = await fixture.models.completeSimple(model, {
					messages: [],
				});
				expect(denied.stopReason).toBe("error");
				expect(fixture.providerCalls).toBe(0);
				expect(fixture.executionCalls).toBe(0);
				expect(
					state.storage.sql
						.exec("SELECT * FROM host_effects ORDER BY id")
						.toArray(),
				).toEqual(effects);
				await host.yield();
			}
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			expect(original.remote.observed).toEqual([
				phase === "stream" ? "rejected" : "resolved",
			]);
		});
	}, 10_000);

	it.each([
		false,
		true,
	])("denies effects after result persistence fails, continuing unavailability=%s", async (continuing) => {
		const stub = env.PI_HOST_STORAGE.getByName(`result-failure-${continuing}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("persist-result", "Synthetic result barrier");
			await host.schedule("persist-result");
			const fixture = composition.fixtures[0];
			if (!fixture) throw new Error("Missing fixture");
			await fixture.entered.promise;
			composition.fault = "result";
			composition.unavailable = continuing;
			fixture.remote.resolve();
			await fixture.localEnded.promise;
			await expect
				.poll(() => fixture.providerAttempts)
				.toBeGreaterThanOrEqual(2);
			expect(fixture.executionAttempts).toBeGreaterThanOrEqual(2);
			await expect(
				host.admit("model", "after-failure", BACKGROUND_CONTEXT),
			).rejects.toThrow();
			await expect(
				host.admit("tool", "after-failure", BACKGROUND_CONTEXT),
			).rejects.toThrow();
			expect(fixture.providerCalls).toBe(1);
			expect(fixture.executionCalls).toBe(1);
			if (continuing) await expect(host.yield()).rejects.toThrow();
			else await host.yield();
			expect(
				state.storage.sql
					.exec("SELECT state FROM host_effects WHERE kind = 'tool'")
					.one().state,
			).toBe("admitted");
			if (continuing)
				await expect(
					PiDurableHost.open(state.storage, composition.dependencies),
				).rejects.toThrow("Synthetic");
			composition.unavailable = false;
			composition.fault = undefined;
			if (continuing) {
				const id = state.storage.sql
					.exec<{ id: string }>("SELECT id FROM host_invocations")
					.one().id;
				await expect(
					PiDurableHost.open(state.storage, composition.dependencies),
				).rejects.toThrow("Prior host termination");
				composition.authority = {
					current: true,
					generation: 2,
					executor: 1,
					priorTerminated: id,
				};
			}
			for (let reopen = 0; reopen < 2; reopen++) {
				host = await PiDurableHost.open(
					state.storage,
					composition.dependencies,
				);
				instance.host = host;
				await expect(host.schedule("persist-result")).rejects.toThrow(
					"Unresolved effect",
				);
				await expect(
					host.admit("tool", "after-restart", BACKGROUND_CONTEXT),
				).rejects.toThrow("Unresolved effect");
				await host.yield();
			}
		});
	}, 10_000);

	it.each([
		["request", 1],
		["request", 2],
		["tool", 1],
		["tool", 2],
	] as const)("actually closes with %s authority read %i still pending", async (phase, blockedRead) => {
		const stub = env.PI_HOST_STORAGE.getByName(
			`pending-authority-${phase}-${blockedRead}`,
		);
		await runInDurableObject(stub, async (instance, state) => {
			const preparation = pendingRemote<void>();
			const entered = pendingRemote<void>();
			let inAdmission = false;
			let reads = 0;
			let signal: AbortSignal | undefined;
			let alarm: number | null = null;
			let fixture: ReturnType<typeof cooperativeFixture> | undefined;
			const dependencies: HostFixtureDependencies = {
				now: Date.now,
				wakeup: {
					getAlarm: async () => alarm,
					setAlarm: async (deadline) => {
						alarm = deadline;
					},
				},
				authority: async () => {
					if (inAdmission && ++reads === blockedRead) {
						entered.resolve();
						await preparation.promise;
					}
					return { current: true, generation: 1, executor: 1 };
				},
				options: (guard) => {
					fixture = cooperativeFixture(
						phase,
						async (kind, id, context) => {
							inAdmission = kind === (phase === "tool" ? "tool" : "model");
							if (inAdmission) signal = context.abortSignal;
							try {
								return await guard.admit(kind, id, context);
							} finally {
								inAdmission = false;
							}
						},
						(id, context, evidence) => guard.result(id, context, evidence),
					);
					return {
						models: fixture.models,
						registry: fixture.registry,
						settings: {
							extensions: [fixture.extension],
							toolExecution: "sequential",
							retry: { enabled: false },
							compaction: { enabled: false, backgroundTokens: 0 },
						},
					};
				},
			};
			const host = await PiDurableHost.open(state.storage, dependencies);
			instance.host = host;
			let close: Promise<void> | undefined;
			let observed: Promise<void> | undefined;
			let closed = false;
			try {
				await host.accept("pending-prep", "Real Pi authority preparation");
				const invocation = await host.schedule("pending-prep");
				await entered.promise;
				if (!fixture) throw new Error("Missing fixture");
				await expect(
					PiDurableHost.open(state.storage, dependencies),
				).rejects.toThrow("Prior host termination required");
				close = host.yield();
				observed = close.then(
					() => {
						closed = true;
					},
					() => {},
				);
				await expect
					.poll(() => closed, { timeout: 1000, interval: 5 })
					.toBe(true);
				await close;
				console.log(
					"[002-authority-close]",
					JSON.stringify({
						phase,
						blockedRead,
						...invocation,
						closedAt: Date.now(),
						preparationPending: !preparation.settled,
					}),
				);
				expect(Date.now()).toBeLessThan(invocation.end_at);
				expect(preparation.settled).toBe(false);
				expect(signal?.aborted).toBe(true);
				expect(fixture.providerCalls).toBe(phase === "tool" ? 1 : 0);
				expect(fixture.executionCalls).toBe(0);
				const effects = state.storage.sql
					.exec("SELECT * FROM host_effects ORDER BY id")
					.toArray();
				expect(effects).toHaveLength(
					(phase === "tool" ? 1 : 0) + (blockedRead === 2 ? 1 : 0),
				);
				const tasks = state.storage.sql
					.exec("SELECT record FROM tasks ORDER BY id")
					.toArray();
				for (const row of tasks)
					expect(taskFacts(row.record).abortRequested).not.toBe(true);
				if (blockedRead === 1) preparation.resolve();
				else preparation.reject(new Error("Late authority rejection"));
				await Promise.resolve();
				await Promise.resolve();
				expect(preparation.observed).toEqual([
					blockedRead === 1 ? "resolved" : "rejected",
				]);
				expect(
					state.storage.sql
						.exec("SELECT * FROM host_effects ORDER BY id")
						.toArray(),
				).toEqual(effects);
				expect(
					state.storage.sql
						.exec("SELECT record FROM tasks ORDER BY id")
						.toArray(),
				).toEqual(tasks);
				expect(fixture.providerCalls).toBe(phase === "tool" ? 1 : 0);
				expect(fixture.executionCalls).toBe(0);
				const replacement = await PiDurableHost.open(
					state.storage,
					dependencies,
				);
				instance.host = replacement;
				expect((await replacement.inspect()).scheduling).toBe("paused");
				expect(
					state.storage.sql
						.exec("SELECT COUNT(*) AS count FROM host_invocations")
						.one().count,
				).toBe(1);
				await replacement.yield();
			} finally {
				preparation.resolve();
				fixture?.remote.resolve();
				if (observed) await observed;
				else await host.yield();
			}
		});
	});

	it.each([
		"safety-result-missing",
		"pi-result-missing",
	] as const)("blocks recovery across two reopens after %s", async (order) => {
		const stub = env.PI_HOST_STORAGE.getByName(`handoff-${order}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			let rejectPiResult = false;
			let rejectedCommits = 0;
			const dependencies = {
				...composition.dependencies,
				piStorage: (storage: Storage): Storage =>
					new Proxy(storage, {
						get(target, key) {
							if (key === "commit")
								return (
									writes: Parameters<Storage["commit"]>[0],
									context: Parameters<Storage["commit"]>[1],
								) => {
									if (
										rejectPiResult &&
										writes.some(
											(write) =>
												write.type === "task" &&
												write.value.kind === "pi.tool" &&
												write.value.state.status === "terminal" &&
												write.value.state.outcome.status === "completed",
										)
									) {
										rejectedCommits++;
										throw new Error(
											"Synthetic public Storage tool-result commit lost",
										);
									}
									return target.commit(writes, context);
								};
							const value: unknown = Reflect.get(target, key, target);
							return typeof value === "function" ? value.bind(target) : value;
						},
					}),
			};
			let host = await PiDurableHost.open(state.storage, dependencies);
			instance.host = host;
			await host.accept("handoff", "Synthetic public Pi result handoff");
			const invocation = await host.schedule("handoff");
			const fixture = composition.fixtures[0];
			if (!fixture) throw new Error("Missing fixture");
			await fixture.entered.promise;
			if (order === "safety-result-missing") composition.fault = "result";
			else rejectPiResult = true;
			fixture.remote.resolve();
			await fixture.localEnded.promise;
			if (order === "pi-result-missing")
				await expect.poll(() => rejectedCommits).toBeGreaterThan(0);
			else
				await expect
					.poll(() => fixture.providerAttempts)
					.toBeGreaterThanOrEqual(2);
			await host.yield();
			const effects = state.storage.sql
				.exec("SELECT * FROM host_effects ORDER BY id")
				.toArray();
			const original = effects.find((effect) => effect.kind === "tool");
			expect(original).toMatchObject({
				invocation: invocation.id,
				attempt: 1,
				executor: 1,
				state:
					order === "safety-result-missing" ? "admitted" : "result-recorded",
			});
			expect(fixture.providerCalls).toBe(1);
			expect(fixture.executionCalls).toBe(1);
			if (order === "pi-result-missing") {
				const rows = state.storage.sql
					.exec<{ record: string }>("SELECT record FROM tasks")
					.toArray();
				expect(
					rows.some((row) => taskFacts(row.record).phase === "execute"),
				).toBe(true);
			}
			composition.fault = undefined;
			rejectPiResult = false;
			for (let reopen = 0; reopen < 2; reopen++) {
				host = await PiDurableHost.open(state.storage, dependencies);
				instance.host = host;
				await expect(host.schedule("handoff")).rejects.toThrow(
					"Unresolved effect",
				);
				await expect(
					host.admit("tool", "replay", BACKGROUND_CONTEXT),
				).rejects.toThrow("Unresolved effect");
				// Isolated defense probe only: public Pi recovery behind the mandatory guards,
				// without granting host scheduling authority or adding a second Harness.
				const probe: unknown = Reflect.get(host, "harness");
				if (!isRecoveryProbe(probe))
					throw new Error("Missing isolated recovery Harness");
				const recovered = composition.fixtures[reopen + 1];
				if (!recovered) throw new Error("Missing recovery fixture");
				probe.resume();
				if (reopen === 1 || order === "safety-result-missing") {
					const root = await probe.root(BACKGROUND_CONTEXT);
					await root.submit(
						{
							type: "input",
							content: "Guarded subsequent model request",
							requestId: `recovery-defense-${reopen}`,
						},
						BACKGROUND_CONTEXT,
					);
				}
				await expect.poll(() => recovered.providerAttempts).toBeGreaterThan(0);
				expect(recovered.providerCalls).toBe(0);
				expect(recovered.executionCalls).toBe(0);
				await host.yield();
				expect(
					state.storage.sql
						.exec("SELECT * FROM host_effects ORDER BY id")
						.toArray(),
				).toEqual(effects);
				expect(
					state.storage.sql
						.exec("SELECT COUNT(*) AS count FROM host_invocations")
						.one().count,
				).toBe(1);
			}
		});
	}, 10_000);

	it.each([
		"safety-result-missing",
		"pi-result-missing",
	] as const)("encrypted adapter blocks recovery across two reopens after %s", async (order) => {
		const stub = env.PI_HOST_STORAGE.getByName(`encrypted-handoff-${order}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			const retained = {
				ownerId: "owner-004",
				workspaceSessionId: "session-004",
				keyring: await importRuntimeKeyringFromBytes("v1", {
					v1: new Uint8Array(32).fill(7),
				}),
			};
			let rejectPiResult = false;
			let rejectedCommits = 0;
			const dependencies = {
				...composition.dependencies,
				retained,
				piStorage: (storage: Storage): Storage =>
					new Proxy(storage, {
						get(target, key) {
							if (key === "commit")
								return (
									writes: Parameters<Storage["commit"]>[0],
									context: Parameters<Storage["commit"]>[1],
								) => {
									if (
										rejectPiResult &&
										writes.some(
											(write) =>
												write.type === "task" &&
												write.value.kind === "pi.tool" &&
												write.value.state.status === "terminal" &&
												write.value.state.outcome.status === "completed",
										)
									) {
										rejectedCommits++;
										throw new Error(
											"Synthetic public Storage tool-result commit lost",
										);
									}
									return target.commit(writes, context);
								};
							const value: unknown = Reflect.get(target, key, target);
							return typeof value === "function" ? value.bind(target) : value;
						},
					}),
			};
			let host = await PiDurableHost.open(state.storage, dependencies);
			instance.host = host;
			await host.accept("handoff", "Synthetic public Pi result handoff");
			const invocation = await host.schedule("handoff");
			const fixture = composition.fixtures[0];
			if (!fixture) throw new Error("Missing fixture");
			await fixture.entered.promise;
			if (order === "safety-result-missing") composition.fault = "result";
			else rejectPiResult = true;
			fixture.remote.resolve();
			await fixture.localEnded.promise;
			if (order === "pi-result-missing")
				await expect.poll(() => rejectedCommits).toBeGreaterThan(0);
			else
				await expect
					.poll(() => fixture.providerAttempts)
					.toBeGreaterThanOrEqual(2);
			await host.yield();
			const effects = state.storage.sql
				.exec(
					"SELECT id, kind, invocation, attempt, executor, state FROM host_effects ORDER BY id",
				)
				.toArray();
			const original = effects.find((effect) => effect.kind === "tool");
			expect(original).toMatchObject({
				id: expect.any(String),
				invocation: invocation.id,
				attempt: 1,
				executor: 1,
				state:
					order === "safety-result-missing" ? "admitted" : "result-recorded",
			});
			expect(fixture.providerCalls).toBe(1);
			expect(fixture.executionCalls).toBe(1);
			const raw = [
				...state.storage.sql
					.exec<{ record: string }>("SELECT record FROM entries")
					.toArray(),
				...state.storage.sql
					.exec<{ record: string }>("SELECT record FROM tasks")
					.toArray(),
				...state.storage.sql
					.exec<{ record: string }>("SELECT content AS record FROM host_inbox")
					.toArray(),
				...state.storage.sql
					.exec<{ record: string }>(
						"SELECT evidence AS record FROM host_effects WHERE evidence IS NOT NULL",
					)
					.toArray(),
			]
				.map((row) => row.record)
				.join("\n");
			expect(raw).not.toContain("Synthetic public Pi result handoff");
			expect(raw).not.toContain("Synthetic remote result");
			if (order === "pi-result-missing") {
				const stored = await EncryptedPiStorage.open(state.storage, retained);
				const tasks = await stored.scanTasks(
					{},
					20,
					undefined,
					BACKGROUND_CONTEXT,
				);
				expect(
					tasks.items.some(
						(task) => phaseOf(task.state.checkpoint) === "execute",
					),
				).toBe(true);
				await stored.close(BACKGROUND_CONTEXT);
			}
			composition.fault = undefined;
			rejectPiResult = false;
			for (let reopen = 0; reopen < 2; reopen++) {
				host = await PiDurableHost.open(state.storage, dependencies);
				instance.host = host;
				await expect(host.schedule("handoff")).rejects.toThrow(
					"Unresolved effect",
				);
				await expect(
					host.admit("tool", "replay", BACKGROUND_CONTEXT),
				).rejects.toThrow("Unresolved effect");
				const probe: unknown = Reflect.get(host, "harness");
				if (!isRecoveryProbe(probe))
					throw new Error("Missing isolated recovery Harness");
				const recovered = composition.fixtures[reopen + 1];
				if (!recovered) throw new Error("Missing recovery fixture");
				probe.resume();
				if (reopen === 1 || order === "safety-result-missing") {
					const root = await probe.root(BACKGROUND_CONTEXT);
					await root.submit(
						{
							type: "input",
							content: "Guarded subsequent model request",
							requestId: `recovery-defense-${reopen}`,
						},
						BACKGROUND_CONTEXT,
					);
				}
				await expect.poll(() => recovered.providerAttempts).toBeGreaterThan(0);
				expect(recovered.providerCalls).toBe(0);
				expect(recovered.executionCalls).toBe(0);
				await host.yield();
				expect(
					state.storage.sql
						.exec(
							"SELECT id, kind, invocation, attempt, executor, state FROM host_effects ORDER BY id",
						)
						.toArray(),
				).toEqual(effects);
			}
		});
	}, 15_000);

	it.each([
		["request", "revoked"],
		["request", "generation"],
		["request", "capacity"],
		["tool", "revoked"],
		["tool", "generation"],
		["tool", "executor"],
		["tool", "capacity"],
	] as const)("rechecks %s admission after fresh authority changes to %s", async (phase, change) => {
		const stub = env.PI_HOST_STORAGE.getByName(
			`fresh-authority-${phase}-${change}`,
		);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition(phase);
			const denied = pendingRemote<void>();
			let inAdmission = false;
			let reads = 0;
			let authority: LocalAuthority = {
				current: true,
				generation: 1,
				executor: 1,
			};
			const host = await PiDurableHost.open(state.storage, {
				...composition.dependencies,
				authority: async () => {
					if (inAdmission && ++reads === 2)
						authority = {
							current: change !== "revoked",
							generation: change === "generation" ? 2 : 1,
							executor: change === "executor" ? 2 : 1,
							liveExecutors: change === "capacity" ? 2 : 1,
						};
					return authority;
				},
				options: (guard) =>
					composition.dependencies.options({
						...guard,
						admit: async (kind, id, context) => {
							inAdmission = kind === (phase === "tool" ? "tool" : "model");
							try {
								return await guard.admit(kind, id, context);
							} catch (error) {
								denied.resolve();
								throw error;
							} finally {
								inAdmission = false;
							}
						},
					}),
			});
			instance.host = host;
			await host.accept("fresh-authority", "Synthetic post-wait revocation");
			const invocation = await host.schedule("fresh-authority");
			await denied.promise;
			await host.yield();
			expect(composition.fixtures[0]?.providerCalls).toBe(
				phase === "tool" ? 1 : 0,
			);
			expect(composition.fixtures[0]?.executionCalls).toBe(0);
			const retained = state.storage.sql
				.exec("SELECT * FROM host_effects WHERE state = 'admitted'")
				.toArray();
			expect(retained).toHaveLength(1);
			expect(retained[0]).toMatchObject({
				invocation: invocation.id,
				attempt: 1,
				executor: phase === "tool" ? 1 : 0,
				deadline: invocation.end_at,
			});
		});
	});

	it("consumes a safety result only after Pi's public terminal tool receipt", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("committed-handoff");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			const host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("complete-handoff", "Synthetic completed result");
			await host.schedule("complete-handoff");
			const fixture = composition.fixtures[0];
			if (!fixture) throw new Error("Missing fixture");
			await fixture.entered.promise;
			composition.fault = "admission";
			fixture.remote.resolve();
			await expect.poll(() => fixture.providerAttempts).toBeGreaterThan(1);
			await host.yield();
			const effect = state.storage.sql
				.exec<{ id: string; invocation: string; state: string }>(
					"SELECT id, invocation, state FROM host_effects WHERE kind = 'tool'",
				)
				.one();
			expect(effect.state).toBe("pi-committed");
			const task = Number(
				effect.id.slice(effect.invocation.length + 1).split(":")[0],
			);
			expect(
				state.storage.sql
					.exec(
						"SELECT json_extract(record, '$.state.outcome.status') AS outcome FROM tasks WHERE id = ?",
						task,
					)
					.one().outcome,
			).toBe("completed");
			expect(fixture.executionCalls).toBe(1);
			expect(fixture.providerCalls).toBe(1);
		});
	});

	it("retains a live unknown shell while real Pi recovery and subsequent requests deny effects across two reopens", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("live-unsafe-recovery");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("live-original", "Synthetic live unsafe shell");
			const invocation = await host.schedule("live-original");
			const original = composition.fixtures[0];
			if (!original) throw new Error("Missing fixture");
			await original.entered.promise;
			await host.yield();
			const effects = state.storage.sql
				.exec("SELECT * FROM host_effects ORDER BY id")
				.toArray();
			const shell = effects.find((effect) => effect.kind === "tool");
			expect(shell).toMatchObject({
				invocation: invocation.id,
				attempt: 1,
				executor: 1,
				state: "admitted",
				deadline: invocation.end_at,
			});
			for (let reopen = 0; reopen < 2; reopen++) {
				host = await PiDurableHost.open(
					state.storage,
					composition.dependencies,
				);
				instance.host = host;
				await expect(host.schedule("live-original")).rejects.toThrow(
					"Unresolved effect",
				);
				await expect(
					host.admit("model", "new-model", BACKGROUND_CONTEXT),
				).rejects.toThrow("Unresolved effect");
				await expect(
					host.admit("tool", "new-executor", BACKGROUND_CONTEXT),
				).rejects.toThrow("Unresolved effect");
				const probe: unknown = Reflect.get(host, "harness");
				if (!isRecoveryProbe(probe))
					throw new Error("Missing isolated recovery Harness");
				const recovered = composition.fixtures[reopen + 1];
				if (!recovered) throw new Error("Missing recovery fixture");
				probe.resume();
				if (reopen === 1) {
					const root = await probe.root(BACKGROUND_CONTEXT);
					await root.submit(
						{
							type: "input",
							content: "Guarded later request",
							requestId: "live-defense-second",
						},
						BACKGROUND_CONTEXT,
					);
				}
				await expect.poll(() => recovered.providerAttempts).toBeGreaterThan(0);
				if (reopen === 0) {
					expect(recovered.executionAttempts).toBeGreaterThan(0);
					expect(
						state.storage.sql
							.exec(
								"SELECT COUNT(*) AS count FROM entries WHERE json_extract(record, '$.model[0].toolCallId') = 'shell-original' AND record LIKE '%interrupted%'",
							)
							.one().count,
					).toBe(1);
				}
				expect(original.remote.settled).toBe(false);
				expect(recovered.providerCalls).toBe(0);
				expect(recovered.executionCalls).toBe(0);
				await host.yield();
				expect(
					state.storage.sql
						.exec("SELECT * FROM host_effects ORDER BY id")
						.toArray(),
				).toEqual(effects);
			}
			const tasks = state.storage.sql
				.exec("SELECT record FROM tasks ORDER BY id")
				.toArray();
			original.remote.reject(new Error("Late original shell failure"));
			await Promise.resolve();
			await Promise.resolve();
			expect(original.remote.observed).toEqual(["rejected"]);
			expect(
				state.storage.sql
					.exec("SELECT record FROM tasks ORDER BY id")
					.toArray(),
			).toEqual(tasks);
			expect(
				state.storage.sql
					.exec("SELECT * FROM host_effects ORDER BY id")
					.toArray(),
			).toEqual(effects);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
		});
	}, 10_000);

	it("rechecks after asynchronous authority preparation and never dispatches after close", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("preparation-fence");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			const host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("prepared", "Synthetic prepared request");
			await host.schedule("prepared");
			const preparation = pendingRemote<void>();
			composition.prepare = preparation.promise;
			const late = host.admit(
				"tool",
				"prepared-but-not-dispatched",
				BACKGROUND_CONTEXT,
			);
			const observed = expect(late).rejects.toThrow("Host admission denied");
			const close = host.yield();
			preparation.resolve();
			await observed;
			await close;
			expect(composition.fixtures[0]?.executionCalls).toBe(0);
			expect(
				state.storage.sql
					.exec("SELECT id FROM host_effects WHERE kind = 'tool'")
					.toArray(),
			).toEqual([]);
		});
	});

	it.each([
		"before-submit",
		"after-submit",
		"after-close",
		"account",
	] as const)("retains intent and requires closure evidence after crash at %s", async (point) => {
		const stub = env.PI_HOST_STORAGE.getByName(`crash-${point}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("crash-input", "Synthetic crash boundary");
			if (point === "before-submit" || point === "after-submit") {
				composition.fault = point;
				await expect(host.schedule("crash-input")).rejects.toThrow("Synthetic");
				composition.fault = undefined;
				await host.yield();
			} else {
				await host.schedule("crash-input");
				await composition.fixtures[0]?.entered.promise;
				composition.fault = point;
				await expect(host.yield()).rejects.toThrow("Synthetic");
				composition.fault = undefined;
				await expect(
					PiDurableHost.open(state.storage, composition.dependencies),
				).rejects.toThrow("Prior host termination");
				const id = state.storage.sql
					.exec<{ id: string }>("SELECT id FROM host_invocations")
					.one().id;
				composition.authority = {
					current: true,
					generation: 2,
					executor: 1,
					priorTerminated: id,
				};
			}
			host = await PiDurableHost.open(state.storage, composition.dependencies);
			instance.host = host;
			const count = state.storage.sql
				.exec("SELECT COUNT(*) AS count FROM submissions")
				.one().count;
			expect(count).toBe(point === "before-submit" ? 0 : 1);
			expect(
				state.storage.sql.exec("SELECT state FROM host_inbox").one().state,
			).toBe(
				point === "before-submit" || point === "after-submit"
					? "submitting"
					: "submitted",
			);
			await host.yield();
		});
	});

	it("closes the real built-in retry sleep and allocates one new budget only after accounted close", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("retry-budget");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("retry");
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("retry-original", "Synthetic retry");
			const first = await host.schedule("retry-original");
			await composition.fixtures[0]?.entered.promise;
			await expect
				.poll(async () =>
					(await host.inspect()).tasks.some(
						(task) =>
							(task.record.state.status === "running" ||
								task.record.state.status === "pending") &&
							phaseOf(task.record.state.checkpoint) === "retry",
					),
				)
				.toBe(true);
			const sleep = state.storage.sql
				.exec<{ record: string }>("SELECT record FROM tasks")
				.one().record;
			const until = taskFacts(sleep).until;
			expect(typeof until).toBe("number");
			composition.now = first.yield_at;
			await host.yield();
			expect(composition.fixtures[0]?.providerCalls).toBe(1);
			expect(
				taskFacts(
					state.storage.sql
						.exec<{ record: string }>("SELECT record FROM tasks")
						.one().record,
				).abortRequested,
			).not.toBe(true);
			const recovery = state.storage.sql
				.exec("SELECT recovery_at FROM host_meta")
				.one().recovery_at;
			composition.now = first.end_at + 10;
			composition.authority = { current: true, generation: 2, executor: 1 };
			host = await PiDurableHost.open(state.storage, composition.dependencies);
			instance.host = host;
			expect((await host.inspect()).scheduling).toBe("paused");
			expect(await host.schedule("retry-original", first.id)).toMatchObject({
				id: first.id,
				state: "closed",
				end_at: first.end_at,
			});
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			const second = await host.schedule("retry-original");
			expect(second.id).not.toBe(first.id);
			expect(second.started).toBe(composition.now);
			expect(second.yield_at).toBe(second.started + 1000);
			expect(await host.schedule("retry-original", second.id)).toEqual(second);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(2);
			await host.yield();
			expect(
				taskFacts(
					state.storage.sql
						.exec<{ record: string }>("SELECT record FROM tasks")
						.one().record,
				).until,
			).toBe(until);
			expect(
				state.storage.sql.exec("SELECT recovery_at FROM host_meta").one()
					.recovery_at,
			).toBe(recovery);
		});
	}, 10_000);

	it("automatic yield awaits actual close before the absolute 2000 ms end deadline", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("absolute-deadline");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			let alarm: number | null = null;
			const dependencies = {
				...composition.dependencies,
				wakeup: {
					getAlarm: async () => alarm,
					setAlarm: async (deadline: number) => {
						alarm = deadline;
					},
				},
			};
			const host = await PiDurableHost.open(state.storage, dependencies);
			instance.host = host;
			await host.accept("timed", "Synthetic timed tool");
			dependencies.now = Date.now;
			const invocation = await host.schedule("timed");
			await composition.fixtures[0]?.entered.promise;
			await expect
				.poll(
					() =>
						state.storage.sql.exec("SELECT state FROM host_invocations").one()
							.state,
					{ timeout: 2000, interval: 10 },
				)
				.toBe("closed");
			await host.yield();
			expect(Date.now()).toBeLessThan(invocation.end_at);
			expect(host.backgroundFailure).toBeUndefined();
			expect(composition.fixtures[0]?.remote.settled).toBe(false);
			expect(composition.fixtures[0]?.executionCalls).toBe(1);
		});
	}, 10_000);

	it("repairs a dropped platform alarm from retained acceptance and handles duplicate delivery", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("alarm-repair");
		const composition = hostComposition("request");
		await runInDurableObject(stub, async (instance, state) => {
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			composition.fault = "alarm";
			await expect(
				host.accept("alarm-input", "Synthetic wakeup"),
			).rejects.toThrow("Synthetic");
			expect(
				state.storage.sql.exec("SELECT COUNT(*) AS count FROM host_inbox").one()
					.count,
			).toBe(1);
			expect(await state.storage.getAlarm()).toBeNull();
			composition.fault = undefined;
			await host.yield();
			host = await PiDurableHost.open(state.storage, composition.dependencies);
			instance.host = host;
			expect(await state.storage.getAlarm()).toBe(composition.now);
			await host.accept("alarm-input", "Synthetic wakeup");
			expect(
				state.storage.sql.exec("SELECT COUNT(*) AS count FROM host_inbox").one()
					.count,
			).toBe(1);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			const host = instance.host;
			if (!host) throw new Error("Missing host");
			await composition.fixtures[1]?.entered.promise;
			const invocation = state.storage.sql
				.exec<{ id: string }>("SELECT id FROM host_invocations")
				.one().id;
			await host.schedule("alarm-input", invocation);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			await state.storage.setAlarm(composition.now);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			const host = instance.host;
			if (!host) throw new Error("Missing host");
			expect(composition.fixtures[1]?.providerCalls).toBe(1);
			await host.yield();
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
		});
	});

	it("combines wall-clock yield and native alarms with joined event resources", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("combined-native-joined");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			const host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("combined", "Synthetic combined timer and alarm");
			composition.dependencies.now = Date.now;
			const invocation = await host.schedule("combined");
			const fixture = composition.fixtures[0];
			if (!fixture) throw new Error("Missing fixture");
			await fixture.entered.promise;
			await expect
				.poll(
					() =>
						state.storage.sql.exec("SELECT state FROM host_invocations").one()
							.state,
					{ timeout: 2000, interval: 10 },
				)
				.toBe("closed");
			await host.yield();
			console.log(
				"[002-native-close]",
				JSON.stringify({
					...invocation,
					closedAt: Date.now(),
					remotePending: !fixture.remote.settled,
				}),
			);
			expect(Date.now()).toBeLessThan(invocation.end_at);
			expect(host.backgroundFailure).toBeUndefined();
			expect(fixture.signal?.aborted).toBe(true);
			expect(fixture.remote.settled).toBe(false);
			expect(fixture.executionCalls).toBe(1);
			await state.storage.sync();
		});
		// Release the runInDurableObject event before joining platform alarm delivery.
		await runDurableObjectAlarm(stub);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			expect(instance.alarmCalls).toBeGreaterThan(0);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	}, 10_000);

	it("alarm-reactivates real Pi retry on the same surviving DO without retire", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("same-instance-retry");
		const composition = hostComposition("retry");
		const now = () => Date.now() + 60_000;
		let original: PiDurableHost | undefined;
		let originalTask = 0;
		let until = 0;
		let firstId = "";
		let firstEnd = 0;
		await runInDurableObject(stub, async (instance, state) => {
			original = await PiDurableHost.open(state.storage, {
				...composition.dependencies,
				now,
				options: (guard) => {
					const options = composition.dependencies.options(guard);
					return {
						...options,
						now,
						settings: {
							...options.settings,
							retry: { enabled: true, maxRetries: 1, baseDelayMs: 1600 },
						},
					};
				},
			});
			instance.host = original;
			await original.accept("same-instance", "Synthetic durable retry wakeup");
			const first = await original.schedule("same-instance");
			firstId = first.id;
			firstEnd = first.end_at;
			await composition.fixtures[0]?.entered.promise;
			await expect
				.poll(async () =>
					(await original?.inspect())?.tasks.some(
						(task) => phaseOf(task.record.state.checkpoint) === "retry",
					),
				)
				.toBe(true);
			const retry = state.storage.sql
				.exec<{ id: number; record: string }>("SELECT id, record FROM tasks")
				.one();
			originalTask = retry.id;
			const deadline = taskFacts(retry.record).until;
			if (typeof deadline !== "number")
				throw new Error("Missing Pi retry deadline");
			until = deadline;
			await expect
				.poll(
					() =>
						state.storage.sql.exec("SELECT state FROM host_invocations").one()
							.state,
					{ timeout: 2000, interval: 10 },
				)
				.toBe("closed");
			await original.yield();
			expect(now()).toBeLessThan(first.end_at);
			expect(now()).toBeLessThan(until);
			expect(
				state.storage.sql
					.exec(
						"SELECT COUNT(*) AS count FROM host_effects WHERE state = 'admitted'",
					)
					.one().count,
			).toBe(0);
			expect(composition.fixtures[0]?.providerCalls).toBe(1);
			await state.storage.sync();
		});
		// Native delivery and resource joining happen after releasing the first DO event.
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			expect(instance.host === original).toBe(false);
			expect((await instance.host?.inspect())?.scheduling).toBe("paused");
			expect(instance.fixtures).toHaveLength(1);
			expect(instance.fixtures[0]?.providerCalls).toBe(0);
			expect(
				taskFacts(
					state.storage.sql
						.exec<{ record: string }>(
							"SELECT record FROM tasks WHERE id = ?",
							originalTask,
						)
						.one().record,
				).until,
			).toBe(until);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			expect(await state.storage.getAlarm()).toBe(until);
		});
		await new Promise<void>((resolve) =>
			setTimeout(resolve, Math.max(0, until - now()) + 20),
		);
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			await instance.fixtures[0]?.entered.promise;
			const invocations = state.storage.sql
				.exec<{ id: string; state: string; started: number; end_at: number }>(
					"SELECT id, state, started, end_at FROM host_invocations ORDER BY rowid",
				)
				.toArray();
			expect(invocations).toHaveLength(2);
			expect(invocations[0]).toMatchObject({
				id: firstId,
				state: "closed",
				end_at: firstEnd,
			});
			expect(invocations[1]?.id).not.toBe(firstId);
			expect(invocations[1]?.started).toBeGreaterThanOrEqual(until);
			expect(
				state.storage.sql
					.exec(
						"SELECT json_extract(record, '$.state.checkpoint.attempt') AS attempt FROM tasks WHERE id = ?",
						originalTask,
					)
					.one().attempt,
			).toBe(2);
			expect(composition.fixtures[0]?.providerCalls).toBe(1);
			expect(instance.fixtures[0]?.providerCalls).toBe(1);
			expect(instance.fixtures[0]?.executionCalls).toBe(0);
			expect(
				state.storage.sql
					.exec(
						"SELECT * FROM host_effects WHERE invocation = ?",
						invocations[1]?.id ?? "",
					)
					.toArray(),
			).toMatchObject([
				{ kind: "model", state: "admitted", deadline: invocations[1]?.end_at },
			]);
			for (const row of state.storage.sql
				.exec("SELECT record FROM tasks")
				.toArray())
				expect(taskFacts(row.record).abortRequested).not.toBe(true);
			await state.storage.setAlarm(now());
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			expect(instance.fixtures).toHaveLength(1);
			expect(instance.fixtures[0]?.providerCalls).toBe(1);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(2);
			await instance.host?.yield();
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	}, 10_000);

	it.each([
		"request",
		"tool",
	] as const)("alarm-reconciles unknown %s on the same surviving DO without retire", async (phase) => {
		const stub = env.PI_HOST_STORAGE.getByName(
			`same-instance-unknown-${phase}`,
		);
		const composition = hostComposition(phase);
		let original: PiDurableHost | undefined;
		let effects: Record<string, SqlStorageValue>[] = [];
		await runInDurableObject(stub, async (instance, state) => {
			original = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = original;
			await original.accept(
				"same-unknown",
				"Synthetic retained unknown effect",
			);
			await original.schedule("same-unknown");
			await composition.fixtures[0]?.entered.promise;
			await original.yield();
			effects = state.storage.sql
				.exec("SELECT * FROM host_effects ORDER BY id")
				.toArray();
			expect(
				effects.filter((effect) => effect.state === "admitted"),
			).toHaveLength(1);
			await state.storage.sync();
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			expect(instance.host === original).toBe(false);
			expect((await instance.host?.inspect())?.scheduling).toBe("paused");
			expect(instance.fixtures).toHaveLength(1);
			expect(instance.fixtures[0]?.providerCalls).toBe(0);
			expect(instance.fixtures[0]?.executionCalls).toBe(0);
			expect(composition.fixtures[0]?.remote.settled).toBe(false);
			expect(
				state.storage.sql
					.exec("SELECT * FROM host_effects ORDER BY id")
					.toArray(),
			).toEqual(effects);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			await instance.host?.yield();
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			expect(instance.fixtures).toHaveLength(2);
			expect((await instance.host?.inspect())?.scheduling).toBe("paused");
			expect(instance.fixtures[1]?.providerCalls).toBe(0);
			expect(instance.fixtures[1]?.executionCalls).toBe(0);
			expect(composition.fixtures[0]?.providerCalls).toBe(1);
			expect(composition.fixtures[0]?.executionCalls).toBe(
				phase === "tool" ? 1 : 0,
			);
			expect(
				state.storage.sql
					.exec("SELECT * FROM host_effects ORDER BY id")
					.toArray(),
			).toEqual(effects);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			await instance.host?.yield();
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	});

	it("joins concurrent alarm activation behind original actual close and accounting", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("same-instance-draining");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			const cleanupEntered = pendingRemote<void>();
			const cleanupRelease = pendingRemote<void>();
			const host = await PiDurableHost.open(state.storage, {
				...composition.dependencies,
				piStorage: (storage) =>
					new Proxy(storage, {
						get(target, key) {
							if (key === "close")
								return async (context: Parameters<Storage["close"]>[0]) => {
									await target.close(context);
									cleanupEntered.resolve();
									await cleanupRelease.promise;
								};
							const value: unknown = Reflect.get(target, key, target);
							return typeof value === "function" ? value.bind(target) : value;
						},
					}),
			});
			instance.host = host;
			await host.accept("draining", "Synthetic close join");
			await host.schedule("draining");
			await composition.fixtures[0]?.entered.promise;
			const close = host.yield();
			const closeObserved = close.then(
				() => undefined,
				() => undefined,
			);
			await cleanupEntered.promise;
			let activated = false;
			const opening = Promise.all([instance.activate(), instance.activate()]);
			const observed = opening.then(
				() => {
					activated = true;
				},
				() => {
					activated = true;
				},
			);
			try {
				await new Promise<void>((resolve) => setTimeout(resolve, 20));
				expect(activated).toBe(false);
				expect(instance.host === host).toBe(true);
				expect(instance.fixtures).toHaveLength(0);
				expect(
					state.storage.sql.exec("SELECT state FROM host_invocations").one()
						.state,
				).toBe("draining");
				cleanupRelease.resolve();
				await close;
				const [first, second] = await opening;
				expect(first === second).toBe(true);
				expect(first === host).toBe(false);
				expect(instance.fixtures).toHaveLength(1);
				expect((await first.inspect()).scheduling).toBe("paused");
				expect(
					state.storage.sql.exec("SELECT state FROM host_invocations").one()
						.state,
				).toBe("closed");
				expect(
					state.storage.sql
						.exec("SELECT COUNT(*) AS count FROM host_invocations")
						.one().count,
				).toBe(1);
			} finally {
				cleanupRelease.resolve();
				await closeObserved;
				await observed;
			}
		});
	});

	it.each([
		"account",
		"after-close",
		"overrun",
	] as const)("denies alarm activation after original %s closure failure", async (fault) => {
		const stub = env.PI_HOST_STORAGE.getByName(`same-instance-failed-${fault}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("retry");
			const host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("failed-activation", "Synthetic closure failure");
			const invocation = await host.schedule("failed-activation");
			await composition.fixtures[0]?.entered.promise;
			if (fault === "overrun") composition.now = invocation.end_at + 1;
			else composition.fault = fault;
			const message =
				fault === "overrun"
					? "Actual close exceeded end deadline"
					: "Synthetic";
			await expect(host.yield()).rejects.toThrow(message);
			composition.fault = undefined;
			const before = state.storage.sql
				.exec("SELECT * FROM host_invocations")
				.toArray();
			for (let retry = 0; retry < 2; retry++)
				await expect(instance.activate()).rejects.toThrow(message);
			expect(instance.host === host).toBe(true);
			expect(instance.fixtures).toHaveLength(0);
			expect(
				state.storage.sql.exec("SELECT * FROM host_invocations").toArray(),
			).toEqual(before);
		});
	});

	it("activates passively and repairs retained intent without reattaching a host", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("composition-reopen");
		await runInDurableObject(stub, async (instance, state) => {
			const host = await instance.activate();
			expect((await host.inspect()).scheduling).toBe("paused");
			expect(instance.fixtures[0]?.providerCalls).toBe(0);
			await host.accept("composed", "Durable composition wakeup");
			await instance.retire();
			await state.storage.deleteAlarm();
			expect(instance.host).toBeUndefined();
		});
		// Alarm activation uses DO-owned keyless dependencies, not a browser attachment.
		await runInDurableObject(stub, async (instance, state) => {
			await instance.activate();
			expect(await state.storage.getAlarm()).not.toBeNull();
			expect(instance.fixtures[1]?.providerCalls).toBe(0);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (instance, state) => {
			await instance.fixtures[1]?.entered.promise;
			expect(instance.fixtures[1]?.providerCalls).toBe(1);
			await instance.retire();
			const effects = state.storage.sql
				.exec("SELECT * FROM host_effects")
				.toArray();
			const reconstructed = new PiDurableHostFixture(state, {
				PI_HOST_FIXTURE_CLOCK_OFFSET_MS: 60_000,
			});
			await reconstructed.alarm();
			expect((await reconstructed.host?.inspect())?.scheduling).toBe("paused");
			expect(reconstructed.fixtures[0]?.providerCalls).toBe(0);
			await reconstructed.retire();
			for (let reopen = 0; reopen < 2; reopen++) {
				expect(instance.host).toBeUndefined();
				await instance.alarm();
				expect((await instance.host?.inspect())?.scheduling).toBe("paused");
				expect(instance.fixtures[reopen + 2]?.providerCalls).toBe(0);
				await expect(instance.host?.schedule("composed")).rejects.toThrow(
					"Unresolved effect",
				);
				await instance.retire();
			}
			expect(
				state.storage.sql.exec("SELECT * FROM host_effects").toArray(),
			).toEqual(effects);
		});
	});

	it.each([
		"version",
		"revoked",
		"generation",
		"executor",
		"capacity",
	] as const)("denies adversarial %s before dispatch", async (fault) => {
		const stub = env.PI_HOST_STORAGE.getByName(`authority-matrix-${fault}`);
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("tool");
			const dependencies = {
				...composition.dependencies,
				options: (guard: import("./pi-durable-host.ts").HostGuard) =>
					composition.dependencies.options({
						...guard,
						admit: (kind, id, context) => {
							if (kind === "tool")
								composition.authority = {
									current: true,
									generation: fault === "generation" ? 2 : 1,
									executor: fault === "executor" ? 2 : 1,
									liveExecutors: fault === "capacity" ? 2 : 1,
								};
							return guard.admit(kind, id, context);
						},
					}),
			};
			const host = await PiDurableHost.open(state.storage, dependencies);
			instance.host = host;
			if (fault === "version") {
				await host.yield();
				state.storage.sql.exec("UPDATE host_meta SET version = 'unsupported'");
				await state.storage.sync();
				await expect(
					PiDurableHost.open(state.storage, composition.dependencies),
				).rejects.toThrow("Incompatible host state");
				return;
			}
			await host.accept("authority", "Synthetic denied authority");
			if (fault === "revoked") {
				composition.authority = { current: false, generation: 1, executor: 1 };
				await expect(host.schedule("authority")).rejects.toThrow(
					"Host admission denied",
				);
			} else {
				await host.schedule("authority");
				await expect
					.poll(() => composition.fixtures[0]?.executionAttempts)
					.toBeGreaterThan(0);
				await expect(
					host.admit("tool", "denied-tool", BACKGROUND_CONTEXT),
				).rejects.toThrow(
					fault === "generation"
						? "Invocation authority"
						: "Executor generation/capacity",
				);
				expect(composition.fixtures[0]?.executionCalls).toBe(0);
				await host.yield();
			}
			expect(
				composition.fixtures.reduce(
					(sum, fixture) => sum + fixture.executionCalls,
					0,
				),
			).toBe(0);
		});
	});

	it("allocates the first budget under the last checked authority generation", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("fresh-budget-owner");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			let scheduling = false;
			let reads = 0;
			let generation = 1;
			const host = await PiDurableHost.open(state.storage, {
				...composition.dependencies,
				authority: async () => {
					if (scheduling && ++reads === 2) generation = 2;
					return { current: true, generation, executor: 1 };
				},
			});
			instance.host = host;
			await host.accept("fresh-budget", "Synthetic fresh owner");
			scheduling = true;
			const invocation = await host.schedule("fresh-budget");
			await composition.fixtures[0]?.entered.promise;
			expect(invocation.generation).toBe(2);
			expect(
				state.storage.sql.exec("SELECT generation FROM host_invocations").one()
					.generation,
			).toBe(2);
			expect(composition.fixtures[0]?.providerCalls).toBe(1);
			await host.yield();
		});
	});

	it("rechecks live denial synchronously before a scheduling-enabling submission", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("sealed-submit-boundary");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			let close: Promise<void> | undefined;
			const host = await PiDurableHost.open(state.storage, {
				...composition.dependencies,
				fault: (point) => {
					if (point === "before-submit") close = host.yield();
				},
			});
			instance.host = host;
			await host.accept("sealed-submit", "Synthetic final scheduling fence");
			await expect(host.schedule("sealed-submit")).rejects.toThrow(
				"Host admission denied",
			);
			await close;
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM submissions")
					.one().count,
			).toBe(0);
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			expect(composition.fixtures[0]?.providerCalls).toBe(0);
			expect(composition.fixtures[0]?.executionCalls).toBe(0);
		});
	});

	it("blocks incompatible Pi task versions without allocating another invocation", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("pi-version-reopen");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("retry");
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("pi-version", "Synthetic version fault");
			const first = await host.schedule("pi-version");
			await composition.fixtures[0]?.entered.promise;
			await expect
				.poll(async () =>
					(await host.inspect()).tasks.some(
						(task) => phaseOf(task.record.state.checkpoint) === "retry",
					),
				)
				.toBe(true);
			await host.yield();
			state.storage.sql.exec(
				"UPDATE tasks SET record = json_set(record, '$.version', 99)",
			);
			await state.storage.sync();
			host = await PiDurableHost.open(state.storage, composition.dependencies);
			instance.host = host;
			expect(
				(await host.inspect()).tasks.some(
					(task) => task.state.kind === "blocked",
				),
			).toBe(true);
			await expect(host.schedule("pi-version")).rejects.toThrow(
				"Incompatible Pi task state",
			);
			expect(await host.schedule("pi-version", first.id)).toMatchObject({
				id: first.id,
				end_at: first.end_at,
				state: "closed",
			});
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			expect(composition.fixtures[1]?.providerCalls).toBe(0);
			await host.yield();
		});
	});

	it("requires matching trusted termination and durable closure accounting before takeover", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("termination-accounting");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			const host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("terminated", "Synthetic closure accounting");
			const first = await host.schedule("terminated");
			await composition.fixtures[0]?.entered.promise;
			composition.fault = "account";
			await expect(host.yield()).rejects.toThrow("Synthetic");
			await expect(host.schedule("terminated")).rejects.toThrow(
				"Host admission denied",
			);
			expect(await host.schedule("terminated", first.id)).toMatchObject({
				id: first.id,
				state: "draining",
				end_at: first.end_at,
			});
			composition.fault = undefined;
			for (const authority of [
				{ current: true, generation: 2, executor: 1 },
				{
					current: true,
					generation: 2,
					executor: 1,
					priorTerminated: "wrong-owner",
				},
				{
					current: true,
					generation: 1,
					executor: 1,
					priorTerminated: first.id,
				},
				{
					current: false,
					generation: 2,
					executor: 1,
					priorTerminated: first.id,
				},
			]) {
				composition.authority = authority;
				await expect(
					PiDurableHost.open(state.storage, composition.dependencies),
				).rejects.toThrow("Prior host termination required");
			}
			composition.authority = {
				current: true,
				generation: 2,
				executor: 1,
				priorTerminated: first.id,
			};
			composition.fault = "account";
			await expect(
				PiDurableHost.open(state.storage, composition.dependencies),
			).rejects.toThrow("Synthetic");
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
			composition.fault = undefined;
			const reopened = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = reopened;
			expect((await reopened.inspect()).scheduling).toBe("paused");
			await expect(reopened.schedule("terminated")).rejects.toThrow(
				"Unresolved effect",
			);
			expect(await reopened.schedule("terminated", first.id)).toMatchObject({
				id: first.id,
				state: "closed",
				started: first.started,
				yield_at: first.yield_at,
				end_at: first.end_at,
			});
			await reopened.yield();
		});
	});

	it("never abandons actual close when a public Storage cleanup fault overruns its deadline", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("wall-clock-overrun");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("retry");
			const cleanupEntered = pendingRemote<void>();
			const cleanupRelease = pendingRemote<void>();
			let alarm: number | null = null;
			const dependencies: HostFixtureDependencies = {
				...composition.dependencies,
				now: Date.now,
				budgets: { workMs: 250, drainMs: 100 },
				wakeup: {
					getAlarm: async () => alarm,
					setAlarm: async (value) => {
						alarm = value;
					},
				},
				piStorage: (storage) =>
					new Proxy(storage, {
						get(target, key) {
							if (key === "close")
								return async (context: Parameters<Storage["close"]>[0]) => {
									await target.close(context);
									cleanupEntered.resolve();
									await cleanupRelease.promise;
								};
							const value: unknown = Reflect.get(target, key, target);
							return typeof value === "function" ? value.bind(target) : value;
						},
					}),
			};
			const host = await PiDurableHost.open(state.storage, dependencies);
			instance.host = host;
			let close: Promise<void> | undefined;
			let observed: Promise<void> | undefined;
			let settled = false;
			try {
				await host.accept("late-close", "Synthetic overrun cleanup fault");
				const invocation = await host.schedule("late-close");
				await composition.fixtures[0]?.entered.promise;
				close = host.yield();
				observed = close.then(
					() => {
						settled = true;
					},
					() => {
						settled = true;
					},
				);
				await cleanupEntered.promise;
				await new Promise<void>((resolve) =>
					setTimeout(resolve, Math.max(0, invocation.end_at - Date.now()) + 50),
				);
				expect(Date.now()).toBeGreaterThan(invocation.end_at);
				expect(settled).toBe(false);
				await expect(
					PiDurableHost.open(state.storage, dependencies),
				).rejects.toThrow("Prior host termination required");
				expect(await host.schedule("late-close", invocation.id)).toMatchObject({
					id: invocation.id,
					end_at: invocation.end_at,
					state: "draining",
				});
				cleanupRelease.resolve();
				await expect(close).rejects.toThrow(
					"Actual close exceeded end deadline",
				);
				expect(
					state.storage.sql.exec("SELECT state FROM host_invocations").one()
						.state,
				).toBe("failed");
				await expect(
					PiDurableHost.open(state.storage, dependencies),
				).rejects.toThrow("Failed invocation requires review");
				await expect(host.schedule("late-close")).rejects.toThrow(
					"Host admission denied",
				);
				expect(
					state.storage.sql
						.exec("SELECT COUNT(*) AS count FROM host_invocations")
						.one().count,
				).toBe(1);
				for (const row of state.storage.sql
					.exec("SELECT record FROM tasks")
					.toArray())
					expect(taskFacts(row.record).abortRequested).not.toBe(true);
			} finally {
				cleanupRelease.resolve();
				if (observed) await observed;
				else await host.yield();
			}
		});
	});

	it("keeps a genuine end overrun failed and denies takeover despite termination evidence", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("genuine-overrun");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("retry");
			const host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.accept("overrun", "Synthetic overrun");
			const invocation = await host.schedule("overrun");
			await composition.fixtures[0]?.entered.promise;
			composition.now = invocation.end_at + 1;
			await expect(host.yield()).rejects.toThrow(
				"Actual close exceeded end deadline",
			);
			expect(
				state.storage.sql.exec("SELECT state FROM host_invocations").one()
					.state,
			).toBe("failed");
			await expect(host.schedule("overrun")).rejects.toThrow(
				"Host admission denied",
			);
			composition.authority = {
				current: true,
				generation: 2,
				executor: 1,
				priorTerminated: invocation.id,
			};
			await expect(
				PiDurableHost.open(state.storage, composition.dependencies),
			).rejects.toThrow("Failed invocation requires review");
			expect(await host.schedule("overrun", invocation.id)).toMatchObject({
				id: invocation.id,
				state: "failed",
				end_at: invocation.end_at,
			});
			expect(
				state.storage.sql
					.exec("SELECT COUNT(*) AS count FROM host_invocations")
					.one().count,
			).toBe(1);
		});
	});

	it("selects the earliest reserved wakeup, preserves an earlier alarm, and fences a failed handler", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("alarm-failure");
		await runInDurableObject(stub, async (instance, state) => {
			const composition = hostComposition("request");
			let host = await PiDurableHost.open(
				state.storage,
				composition.dependencies,
			);
			instance.host = host;
			await host.reserveWakeup("checkpoint", composition.now + 4000);
			await host.reserveWakeup("projection", composition.now + 3000);
			await host.reserveWakeup("effect", composition.now + 2000);
			await host.reserveWakeup("retry", composition.now + 1000);
			expect(await state.storage.getAlarm()).toBe(composition.now + 1000);
			await state.storage.setAlarm(composition.now + 500);
			await host.repairWakeup();
			expect(await state.storage.getAlarm()).toBe(composition.now + 500);
			composition.unavailable = true;
			await expect(host.alarm()).rejects.toThrow("Synthetic");
			await expect(
				host.admit("model", "after-handler-failure", BACKGROUND_CONTEXT),
			).rejects.toThrow();
			await expect(host.yield()).rejects.toThrow();
			composition.unavailable = false;
			await state.storage.deleteAlarm();
			host = await PiDurableHost.open(state.storage, composition.dependencies);
			instance.host = host;
			expect(await state.storage.getAlarm()).toBe(composition.now + 1000);
			expect((await host.inspect()).scheduling).toBe("paused");
			await host.yield();
		});
	});
});
