import { env, runInDurableObject } from "cloudflare:test";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import type { Harness, Storage } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { openHostField } from "./host-private.ts";
import {
	cooperativeFixture,
	pendingRemote,
} from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFixtureDependencies,
	type HostGuard,
	type ModelRequest,
	PiDurableHost,
} from "./pi-durable-host.ts";
import { preparedSummary, summaryText } from "./pi-durable-summary.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

async function until(predicate: () => boolean | Promise<boolean>) {
	for (let n = 0; n < 200; n++) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Custom summary observation deadline");
}
async function gate(
	name: string,
	encrypted: boolean,
	use: (
		f: Awaited<ReturnType<typeof fixture>>,
		state: DurableObjectState,
	) => Promise<void>,
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(`007-custom-${name}-${encrypted}`),
		async (_instance, state) => {
			const f = await fixture(state.storage, encrypted);
			try {
				await f.open();
				await use(f, state);
			} finally {
				f.prepare?.resolve();
				f.beforePreparation?.resolve();
				f.returning?.resolve();
				for (const remote of f.fixtures) remote.remote.resolve();
				await f.host.yield();
				await state.storage.deleteAlarm();
			}
		},
	);
}
async function fixture(storage: DurableObjectStorage, encrypted: boolean) {
	const retained = encrypted
		? {
				ownerId: "007-synthetic-owner",
				workspaceSessionId: "007-synthetic-workspace",
				keyring: await importRuntimeKeyringFromBytes("v1", {
					v1: new Uint8Array(32).fill(17),
				}),
			}
		: undefined;
	let host!: PiDurableHost,
		current = true,
		automatic = false;
	let prepare: ReturnType<typeof pendingRemote<void>> | undefined,
		returning: ReturnType<typeof pendingRemote<void>> | undefined;
	let result: AssistantMessage | undefined,
		storageFault:
			| "preparation-write"
			| "preparation-flush"
			| "result"
			| "summary-result-write"
			| "summary-result-flush"
			| undefined;
	let mutate: ((guard: HostGuard) => HostGuard) | undefined;
	let beforePreparation: ReturnType<typeof pendingRemote<void>> | undefined;
	let summaryPolicy: "custom" | "absent-custom-hook" = "custom";
	let transportFailure = false;
	let piStorage: HostFixtureDependencies["piStorage"];
	const requests: ModelRequest[] = [],
		fixtures: ReturnType<typeof cooperativeFixture>[] = [];
	const dependencies: HostFixtureDependencies = {
		now: () => Date.now() + 60_000,
		retained,
		authority: async () => ({ current, generation: 1, executor: 1 }),
		budgets: { workMs: 10_000, drainMs: 1000 },
		wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
		fault: (point) => {
			if (
				point === storageFault &&
				(point !== "result" ||
					storage.sql
						.exec(
							"SELECT id FROM host_effects WHERE id LIKE 'ditto-summary-1/%'",
						)
						.toArray().length > 0)
			)
				throw new Error(`Synthetic custom storage ${point}`);
		},
		prepareModel: async () => {
			if (prepare) await prepare.promise;
		},
		piStorage: (storage) => piStorage?.(storage) ?? storage,
		options: (guard) => {
			const adapter: HostGuard = {
				...guard,
				summarize: async (api, selection, context) => {
					if (beforePreparation)
						await awaitWithContext(beforePreparation.promise, context);
					return guard.summarize(api, selection, context);
				},
				model: (request, context, start) =>
					guard.model(request, context, () => {
						requests.push({
							...request,
							options: Object.fromEntries(
								Object.entries(request.options).filter(
									([key]) => key !== "signal",
								),
							),
						});
						return request.options.maxTokens !== undefined && transportFailure
							? Promise.reject(new Error("Synthetic transport outcome unknown"))
							: request.options.maxTokens !== undefined && result
								? Promise.resolve(result)
								: start();
					}),
				result: async (id, context, evidence) => {
					await guard.result(id, context, evidence);
					if (id.startsWith("ditto-summary-1/") && returning)
						await awaitWithContext(returning.promise, context);
				},
			};
			const f = cooperativeFixture(
				"answer",
				guard.admit,
				adapter.result,
				mutate?.(adapter) ?? adapter,
				summaryPolicy,
			);
			const provider = f.models.getProvider("faux");
			if (!provider) throw new Error("Missing synthetic provider");
			const first = provider.getModels()[0];
			if (!first) throw new Error("Missing synthetic model");
			f.models.setProvider({
				...provider,
				getModels: () => [
					...provider.getModels(),
					{ ...first, id: "faux-2", name: "Synthetic second model" },
				],
			});
			fixtures.push(f);
			return {
				models: f.models,
				registry: f.registry,
				settings: {
					extensions: [f.extension],
					retry: { enabled: true, maxRetries: 3 },
					stream: { maxRetries: 4 },
					compaction: {
						get enabled() {
							return automatic;
						},
						reserveTokens: 64,
						keepRecentTokens: 1,
						backgroundTokens: 0,
					},
				},
			};
		},
	};
	return {
		fixtures,
		requests,
		dependencies,
		get host() {
			return host;
		},
		get harness() {
			return Reflect.get(host, "harness") as Harness;
		},
		get prepare() {
			return prepare;
		},
		set prepare(value: typeof prepare) {
			prepare = value;
		},
		get returning() {
			return returning;
		},
		set returning(value: typeof returning) {
			returning = value;
		},
		set result(value: typeof result) {
			result = value;
		},
		set transportFailure(value: boolean) {
			transportFailure = value;
		},
		set current(value: boolean) {
			current = value;
		},
		set automatic(value: boolean) {
			automatic = value;
		},
		set mutate(value: typeof mutate) {
			mutate = value;
		},
		get beforePreparation() {
			return beforePreparation;
		},
		set beforePreparation(value: typeof beforePreparation) {
			beforePreparation = value;
		},
		set summaryPolicy(value: typeof summaryPolicy) {
			summaryPolicy = value;
		},
		set piStorage(value: typeof piStorage) {
			piStorage = value;
		},
		set fault(value: typeof storageFault) {
			storageFault = value;
		},
		get providerCalls() {
			return fixtures.reduce((n, f) => n + f.providerCalls, 0);
		},
		async open() {
			host = await PiDurableHost.open(storage, dependencies);
		},
		async start() {
			await host.accept("initial", "Synthetic summary context ".repeat(40));
			await host.schedule("initial");
			await this.harness.waitForIdle(BACKGROUND_CONTEXT);
		},
		async follow() {
			await host.accept("follow", "Synthetic next instruction", {
				run: "initial",
				user: "follow-user",
				assistant: "follow-assistant",
				sequence: 2,
			});
			await host.schedule("follow");
		},
		async effects() {
			const rows = storage.sql
				.exec<{
					id: string;
					state: string;
					attempt: number;
					correlation: string;
					evidence: string | null;
				}>(
					"SELECT id,state,attempt,correlation,evidence FROM host_effects ORDER BY rowid",
				)
				.toArray();
			return Promise.all(
				rows.map(async (row) => ({
					...row,
					correlation: JSON.parse(
						retained
							? await openHostField(
									retained,
									`effect:${row.id}:correlation`,
									row.correlation,
								)
							: row.correlation,
					),
					evidence: row.evidence
						? JSON.parse(
								retained
									? await openHostField(
											retained,
											`effect:${row.id}:evidence`,
											row.evidence,
										)
									: row.evidence,
							)
						: null,
				})),
			);
		},
	};
}
for (const encrypted of [false, true]) {
	for (const automatic of [false, true])
		it(`custom summary places a real ${automatic ? "automatic" : "manual"} Pi receipt, encrypted=${encrypted}`, async () =>
			gate(`placement-${automatic}`, encrypted, async (f) => {
				await f.start();
				f.automatic = automatic;
				if (automatic) {
					await f.follow();
					await f.harness.waitForIdle(BACKGROUND_CONTEXT);
				} else {
					const task = await f.host.compact("initial");
					await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
				}
				await f.host.reconcile();
				const summaries = (await f.effects()).filter(
					(row) => row.correlation.version === 2,
				);
				expect(summaries).toHaveLength(1);
				expect(summaries[0]).toMatchObject({
					attempt: 1,
					state: "pi-committed",
					correlation: { replay: "never", piAttempt: 1 },
				});
				const request = f.requests.find(
					(request) => request.options.maxTokens !== undefined,
				)!;
				expect(request.options).toMatchObject({
					maxRetries: 0,
					cacheRetention: "none",
					maxTokens: 1024,
				});
				expect(request.transcript).toMatchObject({
					messages: [
						{
							role: "system",
							content: expect.stringContaining("Ditto summary policy 1"),
						},
						{
							role: "user",
							content: expect.stringContaining("Synthetic summary context"),
						},
					],
				});
				expect(
					(await f.host.history()).items.filter(
						(entry) => entry.kind === "pi.compaction",
					),
				).toHaveLength(1);
				const calls = f.providerCalls;
				await f.host.yield();
				await f.open();
				await f.host.reconcile();
				expect(f.providerCalls).toBe(calls);
			}));
	it(`recorded success survives close before hook return and is accounted once, encrypted=${encrypted}`, async () =>
		gate("success-reuse", encrypted, async (f, state) => {
			await f.start();
			f.returning = pendingRemote<void>();
			const task = await f.host.compact("initial");
			await until(async () =>
				(await f.effects()).some(
					(row) =>
						row.correlation.version === 2 && row.state === "result-recorded",
				),
			);
			const original = (await f.effects()).find(
				(row) => row.correlation.version === 2,
			)!;
			expect((await f.host.task(task))?.state.checkpoint).toEqual({
				phase: "select",
			});
			await f.host.yield();
			f.returning = undefined;
			await f.open();
			await expect(
				f.host.admit("tool", "replay-defense", BACKGROUND_CONTEXT),
			).rejects.toThrow();
			await f.host.schedule("initial");
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			await f.host.reconcile();
			expect(f.providerCalls).toBe(2);
			const summaries = (await f.effects()).filter(
				(row) => row.correlation.version === 2,
			);
			expect(summaries).toHaveLength(1);
			expect(summaries[0]).toMatchObject({
				id: original.id,
				evidence: original.evidence,
				state: "pi-committed",
			});
			await f.host.reconcile();
			await f.host.yield();
			await f.open();
			await f.host.reconcile();
			expect(f.providerCalls).toBe(2);
			expect(
				(await f.effects())
					.filter((row) => row.correlation.version === 2)
					.map((row) => row.evidence.usage),
			).toEqual([original.evidence.usage]);
			if (encrypted) {
				const raw = JSON.stringify(
					state.storage.sql.exec("SELECT * FROM host_effects").toArray(),
				);
				expect(raw).not.toContain("Synthetic durable summary");
				expect(raw).toContain("aes-256-gcm");
			}
		}));
	it(`unknown admitted custom summary blocks two reopens without a second attempt, encrypted=${encrypted}`, async () =>
		gate("unknown", encrypted, async (f) => {
			await f.start();
			f.fixtures.at(-1)!.summary = "pending";
			await f.host.compact("initial");
			await f.fixtures.at(-1)!.entered.promise;
			const original = (await f.effects()).find(
				(row) => row.correlation.version === 2,
			)!;
			for (let n = 0; n < 2; n++) {
				await f.host.yield();
				await f.open();
				await expect(f.host.schedule("initial")).rejects.toThrow();
				await expect(
					f.host.admit("tool", `blocked-${n}`, BACKGROUND_CONTEXT),
				).rejects.toThrow();
				f.harness.resume();
				await f.harness.waitForIdle(BACKGROUND_CONTEXT);
				expect(f.providerCalls).toBe(2);
				expect(
					(await f.effects()).find((row) => row.id === original.id),
				).toEqual(original);
			}
		}));
	for (const fault of [
		"preparation-write",
		"preparation-flush",
		"result",
		"summary-result-write",
		"summary-result-flush",
	] as const)
		it(`custom ${fault} persistence failure fences every later effect, encrypted=${encrypted}`, async () =>
			gate(`fault-${fault}`, encrypted, async (f) => {
				await f.start();
				f.fault = fault;
				const task = await f.host.compact("initial");
				await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
				expect(f.providerCalls).toBe(fault.startsWith("preparation") ? 1 : 2);
				const summaries = (await f.effects()).filter(
					(row) => row.correlation.version === 2,
				);
				if (!fault.startsWith("preparation"))
					expect(summaries).toMatchObject([
						{
							state:
								fault === "summary-result-flush"
									? "result-recorded"
									: "admitted",
							evidence:
								fault === "summary-result-flush"
									? expect.objectContaining({ usage: expect.any(Object) })
									: null,
						},
					]);
				await expect(
					f.host.admit("model", "later", BACKGROUND_CONTEXT),
				).rejects.toThrow();
				f.fault = undefined;
				await f.host.yield();
				await f.open();
				await expect(f.host.schedule("initial")).rejects.toThrow();
			}));
}
for (const encrypted of [false, true])
	for (const result of [
		fauxAssistantMessage([], {
			stopReason: "error",
			errorMessage: "503 Synthetic summary failure",
		}),
		fauxAssistantMessage([], { stopReason: "aborted" }),
		fauxAssistantMessage(""),
		fauxAssistantMessage(fauxToolCall("forbidden", {}), {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage("x".repeat(5000)),
	])
		it(`known custom failure ${result.stopReason}/${result.content.length} settles the run with one nonrefundable attempt, encrypted=${encrypted}`, async () =>
			gate(
				`failed-${result.stopReason}-${JSON.stringify(result.content).length}`,
				encrypted,
				async (f, state) => {
					await f.start();
					await f.host.accept("follow", "Synthetic pending follow-up", {
						run: "initial",
						user: "follow-user",
						assistant: "follow-assistant",
						sequence: 2,
					});
					f.result = result;
					const task = await f.host.compact("initial");
					await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
					await f.host.reconcile();
					expect(
						state.storage.sql
							.exec("SELECT state FROM host_runs WHERE id='initial'")
							.one().state,
					).toBe("failed");
					expect(
						state.storage.sql
							.exec(
								"SELECT state FROM host_members WHERE assistant='follow-assistant'",
							)
							.one().state,
					).toBe("failed");
					expect(
						(await f.effects()).filter((row) => row.correlation.version === 2),
					).toHaveLength(1);
					expect(
						f.requests.filter(
							(request) => request.options.maxTokens !== undefined,
						),
					).toHaveLength(1);
					await expect(f.host.schedule("follow")).rejects.toThrow();
					expect(
						(await f.host.history()).items.filter(
							(entry) => entry.kind === "pi.compaction",
						),
					).toHaveLength(0);
					await f.host.yield();
					await f.open();
					await expect(f.host.schedule("initial")).rejects.toThrow();
					expect(f.providerCalls).toBe(1);
				},
			));
for (const denial of [
	"range",
	"policy",
	"epoch",
	"authority",
	"stop",
	"digest",
	"task",
	"conversation",
] as const)
	it(`custom summary ${denial} after preparation dispatches nothing`, async () =>
		gate(`denial-${denial}`, false, async (f, state) => {
			await f.start();
			f.prepare = pendingRemote<void>();
			const task = await f.host.compact("initial");
			await until(
				() =>
					state.storage.sql
						.exec(
							"SELECT prepared FROM host_tasks WHERE task = ?",
							Number(task),
						)
						.one().prepared !== null,
			);
			if (denial === "range")
				state.storage.sql.exec(
					"UPDATE host_tasks SET selection = '{}' WHERE task = ?",
					Number(task),
				);
			if (denial === "policy") {
				const row = state.storage.sql
					.exec<{ prepared: string }>(
						"SELECT prepared FROM host_tasks WHERE task=?",
						Number(task),
					)
					.one();
				const prepared = JSON.parse(row.prepared);
				prepared.policy = "unsupported";
				state.storage.sql.exec(
					"UPDATE host_tasks SET prepared=? WHERE task=?",
					JSON.stringify(prepared),
					Number(task),
				);
			}
			if (denial === "digest")
				state.storage.sql.exec(
					"UPDATE host_tasks SET digest='corrupt' WHERE task=?",
					Number(task),
				);
			if (denial === "task" || denial === "conversation") {
				const row = state.storage.sql
					.exec<{ prepared: string }>(
						"SELECT prepared FROM host_tasks WHERE task=?",
						Number(task),
					)
					.one();
				const prepared = JSON.parse(row.prepared);
				prepared[denial] += 1;
				state.storage.sql.exec(
					"UPDATE host_tasks SET prepared=? WHERE task=?",
					JSON.stringify(prepared),
					Number(task),
				);
			}
			if (denial === "epoch")
				state.storage.sql.exec(
					"UPDATE host_runs SET epoch=epoch+1 WHERE id='initial'",
				);
			if (denial === "authority") f.current = false;
			if (denial === "stop") await f.host.stop("stop", "initial");
			f.prepare.resolve();
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(f.providerCalls).toBe(1);
			expect(
				(await f.effects()).filter((row) => row.correlation.version === 2),
			).toHaveLength(0);
		}));
for (const encrypted of [false, true]) {
	for (const prepared of [false, true])
		it(`configuration at ${prepared ? "after" : "before"} custom preparation survives reopen, encrypted=${encrypted}`, async () =>
			gate(`config-${prepared}`, encrypted, async (f, state) => {
				await f.start();
				const root = await f.harness.root(BACKGROUND_CONTEXT);
				await root.configure({ thinkingLevel: "low" }, BACKGROUND_CONTEXT);
				const hold = pendingRemote<void>();
				if (prepared) f.prepare = hold;
				else f.beforePreparation = hold;
				const task = await f.host.compact("initial");
				await until(async () =>
					prepared
						? state.storage.sql
								.exec(
									"SELECT prepared FROM host_tasks WHERE task=?",
									Number(task),
								)
								.one().prepared !== null
						: (await f.host.task(task))?.state.status === "running",
				);
				const before = state.storage.sql
					.exec("SELECT prepared FROM host_tasks WHERE task=?", Number(task))
					.one().prepared;
				expect(before === null).toBe(!prepared);
				await root.configure(
					{
						model: { provider: "faux", modelId: "faux-2" },
						thinkingLevel: "high",
					},
					BACKGROUND_CONTEXT,
				);
				await f.host.yield();
				expect(hold.settled).toBe(false);
				f.prepare = undefined;
				f.beforePreparation = undefined;
				await f.open();
				await f.host.schedule("initial");
				await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
				const summary = f.requests.filter(
					(request) => request.options.maxTokens !== undefined,
				);
				expect(summary).toHaveLength(1);
				expect(summary[0]).toMatchObject({
					model: { id: prepared ? "faux-1" : "faux-2" },
					options: {
						reasoning: prepared ? "low" : "high",
						maxTokens: 1024,
						maxRetries: 0,
					},
				});
				if (prepared)
					expect(
						state.storage.sql
							.exec(
								"SELECT prepared FROM host_tasks WHERE task=?",
								Number(task),
							)
							.one().prepared,
					).toBe(before);
				await f.follow();
				await f.harness.waitForIdle(BACKGROUND_CONTEXT);
				await f.host.reconcile();
				expect(f.requests.at(-1)).toMatchObject({
					model: { id: "faux-2" },
					options: { reasoning: "high" },
				});
				hold.resolve();
			}));
	for (const ordering of ["before", "after"] as const)
		it(`success at ${ordering} actual Pi placement storage commit resumes without redispatch, encrypted=${encrypted}`, async () =>
			gate(`pi-placement-${ordering}`, encrypted, async (f) => {
				const entered = pendingRemote<void>(),
					release = pendingRemote<void>();
				let signal: AbortSignal | undefined;
				f.mutate = (guard) => ({
					...guard,
					summarize: (api, selection, context) => {
						signal = context.abortSignal;
						return guard.summarize(api, selection, context);
					},
				});
				f.piStorage = (storage) =>
					new Proxy(storage, {
						get(target, key) {
							if (key === "commit")
								return async (...args: Parameters<Storage["commit"]>) => {
									const placement = args[0].some(
										(write) =>
											write.type === "task" &&
											write.value.kind === "pi.compaction" &&
											write.value.state.status === "terminal",
									);
									if (!placement) return target.commit(...args);
									if (ordering === "before") {
										entered.resolve();
										await awaitWithContext(
											release.promise,
											signal
												? withAbortSignal(signal, BACKGROUND_CONTEXT)
												: args[1],
										);
										return target.commit(...args);
									}
									const seq = await target.commit(...args);
									entered.resolve();
									await release.promise;
									return seq;
								};
							const value: unknown = Reflect.get(target, key);
							return typeof value === "function" ? value.bind(target) : value;
						},
					});
				await f.host.yield();
				await f.open();
				await f.start();
				const task = await f.host.compact("initial");
				await entered.promise;
				expect(
					(await f.effects()).filter((row) => row.correlation.version === 2),
				).toMatchObject([{ state: "result-recorded" }]);
				const closing = f.host.yield();
				if (ordering === "after") {
					await until(() => signal?.aborted === true);
					release.resolve();
				}
				await closing;
				f.piStorage = undefined;
				f.mutate = undefined;
				await f.open();
				await f.host.schedule("initial");
				await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
				await f.host.reconcile();
				expect(f.providerCalls).toBe(2);
				expect(
					(await f.host.history()).items.filter(
						(entry) => entry.kind === "pi.compaction",
					),
				).toHaveLength(1);
				expect(
					(await f.effects()).filter((row) => row.correlation.version === 2),
				).toMatchObject([{ state: "pi-committed", attempt: 1 }]);
				release.resolve();
			}));
	for (const hook of ["absent", "throwing"] as const)
		it(`${hook} custom hook cannot dispatch stock fallback, encrypted=${encrypted}`, async () =>
			gate(`hook-${hook}`, encrypted, async (f) => {
				if (hook === "absent") f.summaryPolicy = "absent-custom-hook";
				else
					f.mutate = (guard) => ({
						...guard,
						summarize: async () => {
							throw new Error("Synthetic custom hook failure");
						},
					});
				await f.host.yield();
				await f.open();
				await f.start();
				const task = await f.host.compact("initial");
				await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
				expect(f.providerCalls).toBe(1);
				expect(
					(await f.effects()).filter((row) => row.correlation.version === 2),
				).toHaveLength(0);
				expect(
					(await f.host.history()).items.filter(
						(entry) => entry.kind === "pi.compaction",
					),
				).toHaveLength(0);
			}));
	for (const field of ["provider", "model", "usage", "timestamp"] as const)
		it(`custom response ${field} schema violation never places a summary, encrypted=${encrypted}`, async () =>
			gate(`schema-${field}`, encrypted, async (f, state) => {
				await f.start();
				f.result = {
					...fauxAssistantMessage("Synthetic invalid result"),
					...(field === "provider"
						? { provider: "foreign" }
						: field === "model"
							? { model: "foreign" }
							: field === "timestamp"
								? { timestamp: Number.NaN }
								: {
										usage: {
											...fauxAssistantMessage("unused").usage,
											output: -1,
										},
									}),
				};
				const task = await f.host.compact("initial");
				await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
				expect(
					state.storage.sql.exec("SELECT reason FROM host_safety").one().reason,
				).toBe("result-schema");
				expect(
					(await f.effects()).filter((row) => row.correlation.version === 2),
				).toMatchObject([{ state: "admitted", attempt: 1, evidence: null }]);
				await f.host.yield();
				await f.open();
				await expect(f.host.schedule("initial")).rejects.toThrow();
				expect(
					(await f.host.history()).items.filter(
						(entry) => entry.kind === "pi.compaction",
					),
				).toHaveLength(0);
			}));
}
for (const field of ["prepared", "evidence"] as const)
	it(`encrypted custom ${field} tampering rejects reopen`, async () =>
		gate(`tamper-${field}`, true, async (f, state) => {
			await f.start();
			if (field === "prepared") f.prepare = pendingRemote<void>();
			else f.returning = pendingRemote<void>();
			const task = await f.host.compact("initial");
			await until(async () =>
				field === "prepared"
					? state.storage.sql
							.exec(
								"SELECT prepared FROM host_tasks WHERE task=?",
								Number(task),
							)
							.one().prepared !== null
					: (await f.effects()).some(
							(row) =>
								row.correlation.version === 2 &&
								row.state === "result-recorded",
						),
			);
			await f.host.yield();
			if (field === "prepared")
				state.storage.sql.exec(
					"UPDATE host_tasks SET prepared='{}' WHERE task=?",
					Number(task),
				);
			else
				state.storage.sql.exec(
					"UPDATE host_effects SET evidence='{}' WHERE id LIKE 'ditto-summary-1/%'",
				);
			await expect(f.open()).rejects.toThrow();
			expect(f.providerCalls).toBe(field === "prepared" ? 1 : 2);
		}));
for (const field of ["options", "transcript"] as const)
	it(`actual custom callback ${field} must equal persisted payload`, async () =>
		gate(`payload-${field}`, false, async (f) => {
			f.mutate = (guard) => ({
				...guard,
				model: (request, context, start) =>
					guard.model(
						request.options.maxTokens === undefined
							? request
							: {
									...request,
									...(field === "options"
										? { options: { ...request.options, maxRetries: 1 } }
										: {
												transcript: {
													messages: [
														{
															role: "system",
															content: "Synthetic unrelated source",
															timestamp: 0,
														},
													],
												},
											}),
								},
						context,
						start,
					),
			});
			await f.host.yield();
			await f.open();
			await f.start();
			const task = await f.host.compact("initial");
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(f.providerCalls).toBe(1);
			expect(
				(await f.effects()).filter((row) => row.correlation.version === 2),
			).toHaveLength(0);
		}));
it("host-2 custom summary meanings require explicit compatibility rejection", async () =>
	gate("host-2", false, async (f, state) => {
		await f.host.yield();
		state.storage.sql.exec(
			"UPDATE host_meta SET version='pi-1.0.1/ditto-host-2'",
		);
		await expect(f.open()).rejects.toThrow("Incompatible host state");
	}));
for (const encrypted of [false, true]) {
	it(`oversized public summary source is rejected without truncation, encrypted=${encrypted}`, async () =>
		gate("source-bound", encrypted, async (f) => {
			f.mutate = (guard) => ({
				...guard,
				summarize: (api, selection, context) =>
					guard.summarize(
						api,
						{
							...selection,
							messages: [
								{
									role: "user",
									content: "Synthetic data ".repeat(3000),
									timestamp: 0,
								},
							],
						},
						context,
					),
			});
			await f.host.yield();
			await f.open();
			await f.start();
			const task = await f.host.compact("initial");
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(f.providerCalls).toBe(1);
			expect(
				(await f.effects()).filter((row) => row.correlation.version === 2),
			).toHaveLength(0);
		}));
	it(`transport interruption retains uncertainty with one reservation, encrypted=${encrypted}`, async () =>
		gate("transport", encrypted, async (f) => {
			await f.start();
			f.transportFailure = true;
			const task = await f.host.compact("initial");
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(
				(await f.effects()).filter((row) => row.correlation.version === 2),
			).toMatchObject([{ attempt: 1, state: "admitted", evidence: null }]);
			expect(
				f.requests.filter((request) => request.options.maxTokens !== undefined),
			).toHaveLength(1);
			for (let n = 0; n < 2; n++) {
				await f.host.yield();
				await f.open();
				await expect(f.host.schedule("initial")).rejects.toThrow();
				await expect(
					f.host.admit("tool", `transport-defense-${n}`, BACKGROUND_CONTEXT),
				).rejects.toThrow();
			}
			expect(
				f.requests.filter((request) => request.options.maxTokens !== undefined),
			).toHaveLength(1);
		}));
	it(`custom preparation grants no extended invocation deadline, encrypted=${encrypted}`, async () =>
		gate("deadline", encrypted, async (f) => {
			let now = Date.now() + 60_000;
			f.dependencies.now = () => now;
			await f.start();
			f.prepare = pendingRemote<void>();
			const task = await f.host.compact("initial");
			await until(
				async () => (await f.host.task(task))?.state.status === "running",
			);
			now += 10_001;
			f.prepare.resolve();
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(f.providerCalls).toBe(1);
			expect(
				(await f.effects()).filter((row) => row.correlation.version === 2),
			).toHaveLength(0);
		}));
}
it("custom preparation retains the configuration committed at its preparation transition", async () =>
	gate("preparation-config-race", true, async (f, state) => {
		await f.start();
		const root = await f.harness.root(BACKGROUND_CONTEXT);
		await root.configure({ thinkingLevel: "low" }, BACKGROUND_CONTEXT);
		const models = f.fixtures.at(-1)?.models;
		if (!models) throw new Error("Missing fixture models");
		const provider = models.getProvider("faux");
		if (!provider) throw new Error("Missing fixture provider");
		let lookups = 0,
			committed = false,
			committedBeforePreparation = false;
		const fault = f.dependencies.fault;
		f.dependencies.fault = (point) => {
			if (point === "preparation") committedBeforePreparation = committed;
			fault?.(point);
		};
		let change: Promise<void> | undefined;
		models.setProvider({
			...provider,
			getModels: () => {
				lookups++;
				if (lookups === 2)
					change = root
						.configure(
							{
								model: { provider: "faux", modelId: "faux-2" },
								thinkingLevel: "high",
							},
							BACKGROUND_CONTEXT,
						)
						.then(() => {
							committed = true;
						});
				return provider.getModels();
			},
		});
		f.prepare = pendingRemote<void>();
		const task = await f.host.compact("initial");
		await until(
			() =>
				state.storage.sql
					.exec("SELECT prepared FROM host_tasks WHERE task=?", Number(task))
					.one().prepared !== null,
		);
		await change;
		expect(committed).toBe(true);
		const prepared = state.storage.sql
			.exec<{ prepared: string }>(
				"SELECT prepared FROM host_tasks WHERE task=?",
				Number(task),
			)
			.one().prepared;
		const binding = f.dependencies.retained;
		if (!binding) throw new Error("Missing encrypted fixture binding");
		const retained = JSON.parse(
			await openHostField(binding, `task:${Number(task)}:prepared`, prepared),
		);
		expect(retained).toMatchObject({
			model: { modelId: committedBeforePreparation ? "faux-2" : "faux-1" },
			thinkingLevel: committedBeforePreparation ? "high" : "low",
		});
	}));
it("policy parser rejects old/custom meanings and malformed usage", () => {
	expect(() => preparedSummary({ policy: "ditto-summary-0" })).toThrow();
	expect(() =>
		summaryText({ ...fauxAssistantMessage("summary"), usage: {} }),
	).toThrow();
});
