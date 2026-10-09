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
import type { AgentChange, Harness, Storage } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
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
	let records!: Storage;
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
		piStorage: (storage) => {
			records = storage;
			return piStorage?.(storage) ?? storage;
		},
		options: (guard) => {
			const adapter: HostGuard = {
				...guard,
				summarize: async (api, selection, context) => {
					if (beforePreparation)
						await awaitWithContext(beforePreparation.promise, context);
					return guard.summarize(api, selection, context);
				},
				model: (request, context, start) =>
					guard.model(request, context, (dispatch) => {
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
								: start(dispatch);
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
		get records() {
			return records;
		},
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
		async configure(change: Pick<AgentChange, "model" | "thinkingLevel">) {
			await host.configure(change, BACKGROUND_CONTEXT);
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
				await f.host.configure({ thinkingLevel: "low" }, BACKGROUND_CONTEXT);
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
				await f.host.configure(
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
for (const encrypted of [false, true])
	for (const order of ["configuration", "preparation"] as const)
		it(`forced ${order}-winning transition holds asynchronous preparation, encrypted=${encrypted}`, async () =>
			gate(`forced-order-${order}`, encrypted, async (f, state) => {
				await f.start();
				await f.configure({ thinkingLevel: "low" });
				const hold = pendingRemote<void>(),
					entered = pendingRemote<void>();
				let signal: AbortSignal | undefined;
				f.mutate = (guard) => ({
					...guard,
					summarize: (api, selection, context) => {
						signal = context.abortSignal;
						return guard.summarize(api, selection, context);
					},
				});
				await f.host.yield();
				await f.open();
				await f.host.schedule("initial");
				const commits: string[] = [];
				const fault = f.dependencies.fault;
				f.dependencies.fault = (point) => {
					if (point === "preparation") commits.push("preparation");
					fault?.(point);
				};
				const changed = {
					model: { provider: "faux", modelId: "faux-2" },
					thinkingLevel: "high",
				} as const;
				const configurationHold = pendingRemote<void>(),
					configurationEntered = pendingRemote<void>();
				const sync = state.storage.sync.bind(state.storage);
				const syncSpy = vi
					.spyOn(state.storage, "sync")
					.mockImplementation(async () => {
						if (order === "configuration" && !configurationEntered.settled) {
							configurationEntered.resolve();
							await configurationHold.promise;
						}
						return sync();
					});
				const digest = crypto.subtle.digest.bind(crypto.subtle);
				const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
				const wait = async (data: BufferSource) => {
					if (
						new TextDecoder().decode(data).includes("Ditto summary policy 1") &&
						!entered.settled
					) {
						entered.resolve();
						await awaitWithContext(
							hold.promise,
							signal
								? withAbortSignal(signal, BACKGROUND_CONTEXT)
								: BACKGROUND_CONTEXT,
						);
					}
				};
				const spy = encrypted
					? vi
							.spyOn(crypto.subtle, "encrypt")
							.mockImplementation(async (algorithm, key, data) => {
								await wait(data);
								return encrypt(algorithm, key, data);
							})
					: vi
							.spyOn(crypto.subtle, "digest")
							.mockImplementation(async (algorithm, data) => {
								await wait(data);
								return digest(algorithm, data);
							});
				let change: Promise<void> | undefined;
				try {
					f.prepare = pendingRemote<void>();
					if (order === "configuration") {
						change = f.configure(changed).then(() => {
							commits.push("configuration");
						});
						await configurationEntered.promise;
					}
					const task = await f.host.compact("initial");
					if (order === "configuration") {
						await new Promise((resolve) => setTimeout(resolve, 20));
						expect(entered.settled).toBe(false);
						expect(commits).toEqual([]);
						configurationHold.resolve();
						await change;
					}
					await entered.promise;
					expect(
						state.storage.sql
							.exec(
								"SELECT prepared FROM host_tasks WHERE task=?",
								Number(task),
							)
							.one().prepared,
					).toBeNull();
					let resolved = false;
					if (order === "preparation") {
						change = f.configure(changed).then(() => {
							resolved = true;
							commits.push("configuration");
						});
						await new Promise((resolve) => setTimeout(resolve, 20));
						expect(resolved).toBe(false);
						expect(
							(
								await (
									await f.harness.root(BACKGROUND_CONTEXT)
								).agent(BACKGROUND_CONTEXT)
							).model?.modelId,
						).toBe("faux-1");
					}
					hold.resolve();
					await until(
						() =>
							state.storage.sql
								.exec(
									"SELECT prepared FROM host_tasks WHERE task=?",
									Number(task),
								)
								.one().prepared !== null,
					);
					await change;
					expect(commits).toEqual(
						order === "configuration"
							? ["configuration", "preparation"]
							: ["preparation", "configuration"],
					);
					const raw = state.storage.sql
						.exec<{ prepared: string }>(
							"SELECT prepared FROM host_tasks WHERE task=?",
							Number(task),
						)
						.one().prepared;
					const prepared = preparedSummary(
						JSON.parse(
							encrypted
								? await openHostField(
										f.dependencies.retained!,
										`task:${Number(task)}:prepared`,
										raw,
									)
								: raw,
						),
					);
					expect(prepared).toMatchObject({
						model: { modelId: order === "configuration" ? "faux-2" : "faux-1" },
						thinkingLevel: order === "configuration" ? "high" : "low",
					});
					await f.host.yield();
					f.prepare = undefined;
					spy.mockRestore();
					await f.open();
					await f.host.schedule("initial");
					await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
					expect(
						f.requests.filter(
							(request) => request.options.maxTokens !== undefined,
						),
					).toMatchObject([
						{
							model: { id: prepared.model.modelId },
							options: { reasoning: prepared.thinkingLevel, maxRetries: 0 },
						},
					]);
					const captured = f.requests.find(
						(request) => request.options.maxTokens !== undefined,
					)!;
					expect(captured.transcript).toEqual(prepared.transcript);
					expect(captured.options).toEqual(prepared.options);
					await f.follow();
					await f.harness.waitForIdle(BACKGROUND_CONTEXT);
					const next = await f.host.compact("initial");
					await f.harness.waitForTask(next, BACKGROUND_CONTEXT);
					expect(
						f.requests.filter(
							(request) => request.options.maxTokens !== undefined,
						),
					).toMatchObject([
						{ model: { id: prepared.model.modelId } },
						{ model: { id: "faux-2" }, options: { reasoning: "high" } },
					]);
				} finally {
					hold.resolve();
					configurationHold.resolve();
					spy.mockRestore();
					syncSpy.mockRestore();
					await change;
				}
			}));
for (const encrypted of [false, true])
	for (const control of [
		"cancel-configuration",
		"stop",
		"preparation-failure",
	] as const)
		it(`owning transition releases after ${control} during asynchronous preparation, encrypted=${encrypted}`, async () =>
			gate(`owner-control-${control}`, encrypted, async (f) => {
				await f.start();
				await f.configure({ thinkingLevel: "low" });
				const hold = pendingRemote<void>(),
					entered = pendingRemote<void>();
				let signal: AbortSignal | undefined;
				f.mutate = (guard) => ({
					...guard,
					summarize: (api, selection, context) => {
						signal = context.abortSignal;
						return guard.summarize(api, selection, context);
					},
				});
				await f.host.yield();
				await f.open();
				await f.host.schedule("initial");
				const digest = crypto.subtle.digest.bind(crypto.subtle),
					encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
				const wait = async (data: BufferSource) => {
					if (
						new TextDecoder().decode(data).includes("Ditto summary policy 1") &&
						!entered.settled
					) {
						entered.resolve();
						await awaitWithContext(
							hold.promise,
							signal
								? withAbortSignal(signal, BACKGROUND_CONTEXT)
								: BACKGROUND_CONTEXT,
						);
					}
				};
				const spy = encrypted
					? vi
							.spyOn(crypto.subtle, "encrypt")
							.mockImplementation(async (algorithm, key, data) => {
								await wait(data);
								return encrypt(algorithm, key, data);
							})
					: vi
							.spyOn(crypto.subtle, "digest")
							.mockImplementation(async (algorithm, data) => {
								await wait(data);
								return digest(algorithm, data);
							});
				try {
					const task = await f.host.compact("initial");
					await entered.promise;
					const controller = new AbortController();
					let settled = false;
					const change = f.host
						.configure(
							{ thinkingLevel: "high" },
							withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
						)
						.then(
							() => {
								settled = true;
								return "committed";
							},
							() => {
								settled = true;
								return "denied";
							},
						);
					await new Promise((resolve) => setTimeout(resolve, 20));
					expect(settled).toBe(false);
					if (control === "cancel-configuration") controller.abort();
					if (control === "stop") {
						controller.abort();
						await f.host.stop("owner-stop", "initial");
					}
					if (control === "preparation-failure") f.fault = "preparation-write";
					hold.resolve();
					expect(await change).toBe("denied");
					await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
					if (control === "cancel-configuration") {
						await f.configure({ thinkingLevel: "high" });
						expect(
							f.requests.filter(
								(request) => request.options.maxTokens !== undefined,
							),
						).toMatchObject([{ options: { reasoning: "low" } }]);
					} else {
						expect(f.requests).toHaveLength(1);
						await expect(f.host.schedule("initial")).rejects.toThrow();
					}
					f.fault = undefined;
					await f.host.yield();
					await f.open();
					if (control !== "cancel-configuration")
						await expect(f.host.schedule("initial")).rejects.toThrow();
				} finally {
					hold.resolve();
					spy.mockRestore();
				}
			}));
for (const encrypted of [false, true])
	it(`configuration persistence failure releases and fences the owner lane, encrypted=${encrypted}`, async () =>
		gate("configuration-failure", encrypted, async (f, state) => {
			await f.start();
			const spy = vi
				.spyOn(state.storage, "sync")
				.mockRejectedValueOnce(
					new Error("Synthetic configuration sync failure"),
				);
			try {
				await expect(f.configure({ thinkingLevel: "high" })).rejects.toThrow(
					"Synthetic configuration sync failure",
				);
				await expect(f.configure({ thinkingLevel: "low" })).rejects.toThrow();
				await expect(
					f.host.admit("model", "configuration-failed", BACKGROUND_CONTEXT),
				).rejects.toThrow();
			} finally {
				spy.mockRestore();
			}
			await f.host.yield();
			await f.open();
			await expect(f.host.schedule("initial")).rejects.toThrow();
			expect(f.requests).toHaveLength(1);
		}));
async function waitingAutomatic(
	f: Awaited<ReturnType<typeof fixture>>,
	placement = false,
) {
	if (placement) {
		const summary = (
			await f.records.scanTasks(
				{ kind: "pi.compaction" },
				100,
				undefined,
				BACKGROUND_CONTEXT,
			)
		).items[0];
		if (!summary || summary.owner === undefined)
			throw new Error("Missing owned automatic compaction");
		const parent = await f.records.task(summary.owner, BACKGROUND_CONTEXT);
		expect(parent?.kind).toBe("pi.generation");
		expect(parent?.state).toMatchObject({
			status: "waiting",
			on: [summary.id],
		});
		return { summary, parent: parent! };
	}
	const inspection = await f.harness.inspect(BACKGROUND_CONTEXT);
	const summary = inspection.tasks.find(
		(task) => task.record.kind === "pi.compaction",
	);
	if (!summary) throw new Error("Missing automatic compaction");
	const owner = summary.record.owner;
	if (owner === undefined)
		throw new Error("Automatic compaction must be generation-owned");
	const parent = inspection.tasks.find((task) => task.record.id === owner);
	expect(parent?.record.kind).toBe("pi.generation");
	expect(parent?.state).toMatchObject({
		kind: "waiting",
		on: [summary.record.id],
	});
	return { summary: summary.record, parent: parent!.record };
}
for (const encrypted of [false, true])
	for (const boundary of [
		"before-preparation",
		"prepared",
		"unknown",
		"result",
		"before-placement",
		"after-placement",
	] as const)
		it(`automatic waiting parent recovers at ${boundary}, encrypted=${encrypted}`, async () =>
			gate(`automatic-${boundary}`, encrypted, async (f, state) => {
				const entered = pendingRemote<void>(),
					release = pendingRemote<void>();
				let signal: AbortSignal | undefined;
				if (boundary.endsWith("placement")) {
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
										if (boundary === "before-placement") {
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
				}
				try {
					await f.start();
					f.automatic = true;
					if (boundary === "before-preparation") f.beforePreparation = release;
					if (boundary === "prepared") f.prepare = release;
					if (boundary === "result") f.returning = release;
					if (boundary === "unknown") f.fixtures.at(-1)!.summary = "pending";
					await f.follow();
					if (boundary.endsWith("placement")) await entered.promise;
					else if (boundary === "unknown")
						await f.fixtures.at(-1)!.entered.promise;
					else
						await until(async () => {
							const summary = (
								await f.harness.inspect(BACKGROUND_CONTEXT)
							).tasks.find((task) => task.record.kind === "pi.compaction");
							if (!summary) return false;
							if (boundary === "before-preparation")
								return summary.record.state.status === "running";
							if (boundary === "prepared")
								return (
									state.storage.sql
										.exec(
											"SELECT prepared FROM host_tasks WHERE task=?",
											Number(summary.record.id),
										)
										.toArray()[0]?.prepared != null
								);
							return (await f.effects()).some(
								(row) =>
									row.correlation.version === 2 &&
									row.state === "result-recorded",
							);
						});
					const { summary, parent } = await waitingAutomatic(
						f,
						boundary.endsWith("placement"),
					);
					const original = (await f.effects()).find(
						(row) => row.correlation.version === 2,
					);
					const preparedBefore = state.storage.sql
						.exec<{ prepared: string | null }>(
							"SELECT prepared FROM host_tasks WHERE task=?",
							Number(summary.id),
						)
						.toArray()[0]?.prepared;
					expect(
						f.requests.filter(
							(request) => request.options.maxTokens === undefined,
						),
					).toHaveLength(1);
					if (boundary === "before-preparation" || boundary === "prepared")
						expect(original).toBeUndefined();
					else
						expect(original).toMatchObject({
							attempt: 1,
							state: boundary === "unknown" ? "admitted" : "result-recorded",
						});
					const closing = f.host.yield();
					if (boundary === "after-placement") {
						let closed = false;
						void closing.then(() => {
							closed = true;
						});
						await until(() => signal?.aborted === true);
						expect(closed).toBe(false);
						release.resolve();
					}
					await closing;
					f.beforePreparation = undefined;
					f.prepare = undefined;
					f.returning = undefined;
					f.piStorage = undefined;
					f.mutate = undefined;
					await f.open();
					if (boundary === "unknown") {
						for (let n = 0; n < 2; n++) {
							await expect(f.host.schedule("follow")).rejects.toThrow();
							await expect(
								f.host.admit(
									"tool",
									`automatic-unknown-${n}`,
									BACKGROUND_CONTEXT,
								),
							).rejects.toThrow();
							f.harness.resume();
							await f.harness.waitForIdle(BACKGROUND_CONTEXT);
							expect(
								(await f.effects()).find((row) => row.id === original!.id),
							).toEqual(original);
							expect(f.requests).toHaveLength(2);
							expect(f.providerCalls).toBe(2);
							expect(
								state.storage.sql
									.exec("SELECT state FROM host_runs WHERE id='initial'")
									.one().state,
							).toBe("failed");
							expect(
								state.storage.sql
									.exec("SELECT * FROM host_members WHERE state='pending'")
									.toArray(),
							).toHaveLength(0);
							if (n === 0) {
								await f.host.yield();
								await f.open();
							}
						}
						return;
					}
					await f.host.schedule("follow");
					await f.harness.waitForTask(parent.id, BACKGROUND_CONTEXT);
					await f.harness.waitForIdle(BACKGROUND_CONTEXT);
					await f.host.reconcile();
					expect((await f.host.task(parent.id))?.state).toMatchObject({
						status: "terminal",
						outcome: { status: "completed" },
					});
					const summaries = (await f.effects()).filter(
						(row) => row.correlation.version === 2,
					);
					expect(summaries).toHaveLength(1);
					expect(summaries[0]).toMatchObject({
						attempt: 1,
						state: "pi-committed",
						correlation: { task: Number(summary.id) },
					});
					if (original)
						expect(summaries[0]).toMatchObject({
							id: original.id,
							evidence: original.evidence,
						});
					if (preparedBefore)
						expect(
							state.storage.sql
								.exec(
									"SELECT prepared FROM host_tasks WHERE task=?",
									Number(summary.id),
								)
								.one().prepared,
						).toBe(preparedBefore);
					expect(
						f.requests.filter(
							(request) => request.options.maxTokens !== undefined,
						),
					).toHaveLength(1);
					expect(
						f.requests.filter(
							(request) => request.options.maxTokens === undefined,
						),
					).toHaveLength(2);
					expect(f.providerCalls).toBe(3);
					const placements = (await f.host.history()).items.filter(
						(entry) => entry.kind === "pi.compaction",
					);
					expect(placements).toHaveLength(1);
					expect((await f.host.task(summary.id))?.state).toMatchObject({
						status: "terminal",
						outcome: {
							status: "completed",
							result: { entryId: placements[0]!.id },
						},
					});
					expect(
						state.storage.sql
							.exec(
								"SELECT state FROM host_members WHERE assistant='follow-assistant'",
							)
							.one().state,
					).toBe("complete");
					expect(
						state.storage.sql
							.exec("SELECT * FROM host_members WHERE state='pending'")
							.toArray(),
					).toHaveLength(0);
					expect(
						state.storage.sql
							.exec("SELECT id FROM host_commands ORDER BY sequence")
							.toArray(),
					).toEqual([{ id: "initial" }, { id: "follow" }]);
					await f.host.yield();
					await f.open();
					await f.host.reconcile();
					expect(f.requests).toHaveLength(3);
					expect(
						(await f.effects()).filter((row) => row.correlation.version === 2),
					).toEqual(summaries);
				} finally {
					release.resolve();
				}
			}));
for (const encrypted of [false, true])
	for (const fault of [
		"known-failure",
		"stop",
		"epoch",
		"authority",
		"preparation-write",
		"preparation-flush",
		"summary-result-write",
		"summary-result-flush",
	] as const)
		it(`automatic waiting parent is fenced after ${fault}, encrypted=${encrypted}`, async () =>
			gate(`automatic-fault-${fault}`, encrypted, async (f, state) => {
				await f.start();
				f.automatic = true;
				const hold = pendingRemote<void>();
				const afterPreparation = ["stop", "epoch", "authority"].includes(fault);
				if (afterPreparation) f.prepare = hold;
				else f.beforePreparation = hold;
				await f.follow();
				await until(async () => {
					const task = (await f.harness.inspect(BACKGROUND_CONTEXT)).tasks.find(
						(task) => task.record.kind === "pi.compaction",
					);
					return (
						task !== undefined &&
						(!afterPreparation ||
							state.storage.sql
								.exec(
									"SELECT prepared FROM host_tasks WHERE task=?",
									Number(task.record.id),
								)
								.toArray()[0]?.prepared != null)
					);
				});
				const { summary, parent } = await waitingAutomatic(f);
				if (fault === "known-failure")
					f.result = fauxAssistantMessage([], {
						stopReason: "error",
						errorMessage: "503 Synthetic automatic failure",
					});
				else if (fault === "stop")
					await f.host.stop("automatic-stop", "initial");
				else if (fault === "epoch")
					state.storage.sql.exec(
						"UPDATE host_runs SET epoch=epoch+1 WHERE id='initial'",
					);
				else if (fault === "authority") f.current = false;
				else f.fault = fault;
				hold.resolve();
				await f.harness.waitForTask(parent.id, BACKGROUND_CONTEXT);
				await f.host.reconcile();
				expect(
					f.requests.filter(
						(request) => request.options.maxTokens === undefined,
					),
				).toHaveLength(1);
				expect(
					f.requests.filter(
						(request) => request.options.maxTokens !== undefined,
					),
				).toHaveLength(
					fault.startsWith("summary-result") || fault === "known-failure"
						? 1
						: 0,
				);
				expect(
					(await f.host.history()).items.filter(
						(entry) => entry.kind === "pi.compaction",
					),
				).toHaveLength(0);
				if (fault === "known-failure") {
					expect(
						state.storage.sql
							.exec("SELECT state FROM host_runs WHERE id='initial'")
							.one().state,
					).toBe("failed");
					expect(
						(await f.effects()).filter((row) => row.correlation.version === 2),
					).toMatchObject([
						{ attempt: 1, correlation: { task: Number(summary.id) } },
					]);
				}
				await f.host.yield();
				f.fault = undefined;
				f.current = true;
				f.beforePreparation = undefined;
				f.prepare = undefined;
				await f.open();
				await expect(f.host.schedule("follow")).rejects.toThrow();
				await expect(
					f.host.admit("tool", `automatic-fault-${fault}`, BACKGROUND_CONTEXT),
				).rejects.toThrow();
				expect(
					f.requests.filter(
						(request) => request.options.maxTokens === undefined,
					),
				).toHaveLength(1);
				expect(
					state.storage.sql
						.exec("SELECT * FROM host_members WHERE state='pending'")
						.toArray(),
				).toHaveLength(0);
			}));
for (const encrypted of [false, true]) {
	it(`yield cancels all queued owner changes without late commits, encrypted=${encrypted}`, async () =>
		gate("owner-queued-yield", encrypted, async (f) => {
			await f.start();
			const before = await (await f.harness.root(BACKGROUND_CONTEXT)).agent(
				BACKGROUND_CONTEXT,
			);
			const authority = f.dependencies.authority;
			const remote = pendingRemote<Awaited<ReturnType<typeof authority>>>(),
				entered = pendingRemote<void>();
			f.dependencies.authority = () => {
				entered.resolve();
				return remote.promise;
			};
			const changes = [
				f.host.configure({ thinkingLevel: "high" }),
				f.host.configure({ model: { provider: "faux", modelId: "faux-2" } }),
				f.host.configure({ thinkingLevel: "low" }),
			].map((change) =>
				change.then(
					() => "committed",
					() => "rejected",
				),
			);
			try {
				await entered.promise;
				await f.host.yield();
				expect(await Promise.all(changes)).toEqual([
					"rejected",
					"rejected",
					"rejected",
				]);
				expect(remote.settled).toBe(false);
				f.dependencies.authority = authority;
				remote.resolve(await authority());
				await f.open();
				const reopened = await (await f.harness.root(BACKGROUND_CONTEXT)).agent(
					BACKGROUND_CONTEXT,
				);
				expect(reopened.model).toEqual(before.model);
				expect(reopened.thinkingLevel).toBe(before.thinkingLevel);
				expect(f.providerCalls).toBe(1);
				await f.host.configure({ thinkingLevel: "high" });
				expect(
					(
						await (
							await f.harness.root(BACKGROUND_CONTEXT)
						).agent(BACKGROUND_CONTEXT)
					).thinkingLevel,
				).toBe("high");
			} finally {
				f.dependencies.authority = authority;
				remote.resolve(await authority());
				await Promise.all(changes);
			}
		}));
	for (const boundary of ["before-storage", "after-storage"] as const)
		it(`yield joins admitted configuration ${boundary} settlement, encrypted=${encrypted}`, async () =>
			gate(
				`configuration-settlement-${boundary}`,
				encrypted,
				async (f, state) => {
					const entered = pendingRemote<void>(),
						release = pendingRemote<void>();
					let armed = false;
					f.piStorage = (storage) =>
						new Proxy(storage, {
							get(target, key) {
								if (key === "commit")
									return async (...args: Parameters<Storage["commit"]>) => {
										if (
											!armed ||
											!args[0].some((write) => write.type === "document.change")
										)
											return target.commit(...args);
										armed = false;
										expect(args[1].abortSignal).toBeUndefined();
										if (boundary === "before-storage") {
											entered.resolve();
											await release.promise;
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
					armed = true;
					const change = f.host.configure({ thinkingLevel: "high" }).then(
						() => "committed",
						() => "rejected",
					);
					let closing: Promise<void> | undefined;
					try {
						await entered.promise;
						let joined = false;
						closing = f.host.yield().then(() => {
							joined = true;
						});
						await new Promise((resolve) => setTimeout(resolve, 20));
						expect(joined).toBe(false);
						release.resolve();
						await closing;
						expect(await change).toBe("rejected");
						expect(
							state.storage.sql
								.exec(
									"SELECT state FROM host_invocations ORDER BY rowid DESC LIMIT 1",
								)
								.one().state,
						).toBe("closed");
						f.piStorage = undefined;
						await f.open();
						expect(
							(
								await (
									await f.harness.root(BACKGROUND_CONTEXT)
								).agent(BACKGROUND_CONTEXT)
							).thinkingLevel,
						).toBe("high");
						expect(
							state.storage.sql.exec("SELECT * FROM host_safety").toArray(),
						).toHaveLength(0);
						expect(f.providerCalls).toBe(1);
					} finally {
						release.resolve();
						await change;
						await closing;
					}
				},
			));
}
for (const encrypted of [false, true])
	for (const externallyCanceled of [false, true])
		it(`configuration authority wait joins close by admitted deadline, external cancellation=${externallyCanceled}, encrypted=${encrypted}`, async () => {
			type Outcome = {
				state: "pending" | "complete" | "failed";
				at?: number;
				error?: string;
			};
			let observation:
				| {
						invocation: {
							id: string;
							started: number;
							yield_at: number;
							end_at: number;
						};
						observedAt: number;
						elapsedMs: number;
						configuration: Outcome;
						close: Outcome;
						remoteSettled: boolean;
						joinedConfiguration: Outcome;
						joinedClose: Outcome;
				  }
				| undefined;
			let cleanupError: unknown;
			try {
				await gate(
					`configuration-close-probe-${externallyCanceled}`,
					encrypted,
					async (f, state) => {
						await f.start();
						const invocation = state.storage.sql
							.exec<{
								id: string;
								started: number;
								yield_at: number;
								end_at: number;
							}>(
								"SELECT id,started,yield_at,end_at FROM host_invocations ORDER BY rowid DESC LIMIT 1",
							)
							.one();
						const authority = f.dependencies.authority;
						const remote =
							pendingRemote<Awaited<ReturnType<typeof authority>>>();
						const entered = pendingRemote<void>();
						f.dependencies.authority = () => {
							entered.resolve();
							return remote.promise;
						};
						const controller = new AbortController();
						let configuration: Outcome = { state: "pending" },
							close: Outcome = { state: "pending" };
						const change = (
							externallyCanceled
								? f.host.configure(
										{ thinkingLevel: "high" },
										withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
									)
								: f.host.configure({ thinkingLevel: "high" })
						).then(
							() => {
								configuration = { state: "complete", at: f.dependencies.now() };
							},
							(error: unknown) => {
								configuration = {
									state: "failed",
									at: f.dependencies.now(),
									error:
										error instanceof Error
											? error.message
											: "non-Error rejection",
								};
							},
						);
						let closing: Promise<void> | undefined;
						try {
							await entered.promise;
							const wallStart = performance.now();
							f.dependencies.now = () =>
								invocation.yield_at + Math.floor(performance.now() - wallStart);
							if (externallyCanceled) controller.abort();
							closing = f.host.yield().then(
								() => {
									close = { state: "complete", at: f.dependencies.now() };
								},
								(error: unknown) => {
									close = {
										state: "failed",
										at: f.dependencies.now(),
										error:
											error instanceof Error
												? error.message
												: "non-Error rejection",
									};
								},
							);
							const remaining = invocation.end_at - f.dependencies.now();
							await new Promise((resolve) =>
								setTimeout(resolve, Math.max(0, remaining) + 50),
							);
							observation = {
								invocation,
								observedAt: f.dependencies.now(),
								elapsedMs: Math.floor(performance.now() - wallStart),
								configuration: { ...configuration },
								close: { ...close },
								remoteSettled: remote.settled,
								joinedConfiguration: { state: "pending" },
								joinedClose: { state: "pending" },
							};
						} finally {
							f.dependencies.authority = authority;
							remote.resolve(await authority());
							await change;
							await closing;
							if (observation) {
								observation.joinedConfiguration = { ...configuration };
								observation.joinedClose = { ...close };
								console.log(
									"007 configuration-close advisor probe",
									JSON.stringify({
										encrypted,
										externallyCanceled,
										...observation,
									}),
								);
							}
						}
					},
				);
			} catch (error) {
				cleanupError = error;
			}
			expect(observation).toBeDefined();
			if (!observation)
				throw new Error("Missing configuration-close deadline observation");
			expect(observation.observedAt).toBeGreaterThan(
				observation.invocation.end_at,
			);
			expect(observation.elapsedMs).toBeGreaterThanOrEqual(
				observation.invocation.end_at - observation.invocation.yield_at,
			);
			expect(observation.remoteSettled).toBe(false);
			expect(observation.close.state).toBe("complete");
			expect(observation.close.at).toBeLessThanOrEqual(
				observation.invocation.end_at,
			);
			expect(observation.configuration.state).toBe("failed");
			expect(cleanupError).toBeUndefined();
		});
it("policy parser rejects old/custom meanings and malformed usage", () => {
	expect(() => preparedSummary({ policy: "ditto-summary-0" })).toThrow();
	expect(() =>
		summaryText({ ...fauxAssistantMessage("summary"), usage: {} }),
	).toThrow();
});
