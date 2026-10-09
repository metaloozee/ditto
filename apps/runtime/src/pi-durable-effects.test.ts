import {
	env,
	runDurableObjectAlarm,
	runInDurableObject,
} from "cloudflare:test";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
} from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { Harness, Storage } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { sealHostField } from "./host-private.ts";
import {
	cooperativeFixture,
	type FixturePhase,
	pendingRemote,
} from "./pi-durable-cooperative-fixture.ts";
import {
	type HostFault,
	type HostFixtureDependencies,
	type HostGuard,
	type LocalAuthority,
	PiDurableHost,
	type PiDurableHostFixture,
} from "./pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}
function publicHarness(host: PiDurableHost): Harness {
	const value: unknown = Reflect.get(host, "harness");
	if (
		!value ||
		typeof value !== "object" ||
		!("getTask" in value) ||
		typeof value.getTask !== "function" ||
		!("inspect" in value) ||
		typeof value.inspect !== "function"
	)
		throw new Error("Missing test-only public Harness");
	return value as Harness;
}
async function until(predicate: () => boolean | Promise<boolean>) {
	for (let n = 0; n < 200; n++) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Synthetic observation deadline");
}
function composition(
	storage: DurableObjectStorage,
	phase: FixturePhase,
	retained?: HostFixtureDependencies["retained"],
) {
	let now = Date.now() + 60_000,
		authority: LocalAuthority = { current: true, generation: 1, executor: 1 };
	let fault: HostFault | undefined,
		unavailable = false,
		prepare: ReturnType<typeof pendingRemote<void>> | undefined;
	let authorityHook: (() => Promise<unknown>) | undefined;
	let piStorage: HostFixtureDependencies["piStorage"];
	let automaticCompaction = false;
	let adapters = (guard: HostGuard): HostGuard => guard;
	let host: PiDurableHost;
	const fixtures: ReturnType<typeof cooperativeFixture>[] = [];
	const dependencies: HostFixtureDependencies = {
		now: () => now,
		authority: async () => {
			await authorityHook?.();
			return authority;
		},
		budgets: { workMs: 10_000, drainMs: 1000 },
		operationMs: { model: 60_000, tool: 90_000 },
		wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
		fault: (point) => {
			if (unavailable || point === fault)
				throw new Error(`Synthetic storage ${point}`);
		},
		prepareModel: async () => {
			if (prepare) await prepare.promise;
		},
		piStorage: (storage) => piStorage?.(storage) ?? storage,
		retained,
		options: (guard) => {
			const fixture = cooperativeFixture(
				phase,
				(kind, id, context) => guard.admit(kind, id, context),
				(id, context, evidence) => guard.result(id, context, evidence),
				adapters(guard),
				"stock-Pi-control",
			);
			fixtures.push(fixture);
			return {
				now: () => now,
				models: fixture.models,
				registry: fixture.registry,
				settings: {
					extensions: [fixture.extension],
					toolExecution: "sequential",
					retry: { enabled: true, maxRetries: 1, baseDelayMs: 300 },
					compaction: {
						get enabled() {
							return automaticCompaction;
						},
						backgroundTokens: 0,
						keepRecentTokens: 1,
						reserveTokens: 64,
					},
				},
			};
		},
	};
	return {
		fixtures,
		dependencies,
		set adapters(value: typeof adapters) {
			adapters = value;
		},
		get host() {
			return host;
		},
		get fixture() {
			return fixtures.at(-1)!;
		},
		get harness() {
			return publicHarness(host);
		},
		get now() {
			return now;
		},
		set now(value: number) {
			now = value;
		},
		set authority(value: LocalAuthority) {
			authority = value;
		},
		set fault(value: HostFault | undefined) {
			fault = value;
		},
		set unavailable(value: boolean) {
			unavailable = value;
		},
		set prepare(value: typeof prepare) {
			prepare = value;
		},
		set authorityHook(value: typeof authorityHook) {
			authorityHook = value;
		},
		set piStorage(value: typeof piStorage) {
			piStorage = value;
		},
		set automaticCompaction(value: boolean) {
			automaticCompaction = value;
		},
		async open() {
			host = await PiDurableHost.open(storage, dependencies);
			return host;
		},
		async start(
			id = "command",
			membership?: {
				run: string;
				user: string;
				assistant: string;
				sequence: number;
			},
		) {
			await host.accept(id, "Synthetic context ".repeat(50), membership);
			return host.schedule(id);
		},
		effects() {
			return storage.sql
				.exec("SELECT * FROM host_effects ORDER BY rowid")
				.toArray();
		},
		runs() {
			return storage.sql
				.exec("SELECT * FROM host_runs ORDER BY rowid")
				.toArray();
		},
		async dispose() {
			fault = undefined;
			unavailable = false;
			prepare?.resolve();
			for (const fixture of fixtures) fixture.remote.resolve();
			await host?.yield();
			await storage.deleteAlarm();
			await storage.sync();
		},
	};
}
async function run(
	name: string,
	phase: FixturePhase,
	test: (
		fixture: ReturnType<typeof composition>,
		state: DurableObjectState,
	) => Promise<void>,
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(`003-effects-${name}`),
		async (_instance, state) => {
			const fixture = composition(state.storage, phase);
			await fixture.open();
			try {
				await test(fixture, state);
			} finally {
				await fixture.dispose();
			}
		},
	);
}

it("identical durable result delivery is idempotent", async () =>
	run("duplicate", "answer", async (f) => {
		await f.start();
		await f.host.waitIdle();
		const id = String(f.effects()[0]?.id),
			evidence = String(f.effects()[0]?.evidence);
		await expect(
			f.host.result(id, BACKGROUND_CONTEXT, evidence),
		).resolves.toBeUndefined();
		await f.host.yield();
		await f.open();
		await expect(
			f.host.result(id, BACKGROUND_CONTEXT, evidence),
		).resolves.toBeUndefined();
		expect(f.effects()).toHaveLength(1);
		expect(f.fixture.providerCalls).toBe(0);
	}));
it("actual Pi unsafe recovery attempts the next tool and model but neither dispatches through two reopens", async () =>
	run("unsafe-recovery", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		const original = f.effects().find((row) => row.kind === "tool")!;
		const remote = f.fixture.remote;
		await f.host.yield();
		await f.open();
		await expect(f.host.schedule("command")).rejects.toThrow();
		f.harness.resume();
		await until(
			() => f.fixture.executionAttempts > 0 && f.fixture.providerAttempts > 0,
		);
		expect(f.fixture.providerCalls + f.fixture.executionCalls).toBe(0);
		expect(f.effects()).toContainEqual(original);
		expect(remote.settled).toBe(false);
		await f.host.yield();
		await f.open();
		await (await f.harness.root(BACKGROUND_CONTEXT)).submit(
			{
				type: "input",
				content: "Synthetic second defense",
				requestId: "second-unsafe-defense",
			},
			BACKGROUND_CONTEXT,
		);
		await until(() => f.fixture.providerAttempts > 0);
		expect(f.fixture.providerCalls + f.fixture.executionCalls).toBe(0);
		expect(f.effects()).toContainEqual(original);
		expect(remote.settled).toBe(false);
	}));
it("completed synthetic mutations and follow-up membership survive reopen without repetition", async () =>
	run("completed-tools", "tool", async (f, state) => {
		await f.start();
		await f.fixture.entered.promise;
		await f.host.accept("follow", "Synthetic follow-up", {
			run: "command",
			user: "follow-user",
			assistant: "follow-assistant",
			sequence: 2,
		});
		await expect(f.host.schedule("follow")).rejects.toThrow("boundary");
		f.fixture.remote.resolve();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		await f.host.reconcile();
		expect(f.fixture.executionCalls).toBe(2);
		expect(
			state.storage.sql
				.exec(
					"SELECT state FROM host_members WHERE assistant='command:assistant'",
				)
				.one().state,
		).toBe("complete");
		const effects = f.effects();
		expect(
			effects.filter((row) => row.kind === "tool").map((row) => row.state),
		).toEqual(["pi-committed", "pi-committed"]);
		const history = await f.host.history();
		await f.host.yield();
		await f.open();
		expect(await f.host.history()).toEqual(history);
		expect(f.effects()).toEqual(effects);
		f.fixture.phase = "answer";
		await f.host.schedule("follow");
		await f.host.waitIdle();
		expect(f.fixture.executionCalls).toBe(0);
		expect(f.fixture.providerCalls).toBe(1);
		expect(
			state.storage.sql
				.exec(
					"SELECT state FROM host_members WHERE assistant='follow-assistant'",
				)
				.one().state,
		).toBe("complete");
		expect(f.runs()[0]?.state).toBe("complete");
	}));
it("conflicting result persists review block across reopen and new command", async () =>
	run("conflict", "answer", async (f, state) => {
		await f.start();
		await f.host.waitIdle();
		const id = String(f.effects()[0]?.id);
		await expect(
			f.host.result(id, BACKGROUND_CONTEXT, '{"synthetic":"different"}'),
		).rejects.toThrow("Conflicting");
		await f.host.yield();
		await f.open();
		await f.host.accept("new", "Synthetic new command");
		await expect(f.host.schedule("new")).rejects.toThrow();
		expect(
			state.storage.sql.exec("SELECT reason FROM host_safety").one().reason,
		).toBe("conflicting-result");
		expect(f.fixture.providerCalls).toBe(0);
		expect(f.fixture.executionCalls).toBe(0);
	}));
it("healthy later writes cannot clear a storage barrier but current trusted reconciliation can account for an undispatched admission", async () =>
	run("storage-reconcile", "answer", async (f) => {
		f.fault = "admission";
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		expect(f.fixture.providerCalls).toBe(0);
		expect(f.effects()).toHaveLength(0);
		f.fault = undefined;
		await f.host.accept("healthy-write", "Synthetic later accepted command");
		await expect(f.host.schedule("healthy-write")).rejects.toThrow();
		await f.host.reconcileStorage();
		await f.host.schedule("healthy-write");
		await f.host.waitIdle();
		expect(f.fixture.providerCalls).toBe(1);
	}));
it("actual generation and unsafe tool persist structured exact membership before dispatch", async () =>
	run("correlation", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		expect(f.fixture.providerCalls).toBe(1);
		expect(f.fixture.executionCalls).toBe(1);
		const rows = f.effects();
		expect(rows).toHaveLength(2);
		const model = JSON.parse(String(rows[0]?.correlation));
		const tool = JSON.parse(String(rows[1]?.correlation));
		expect(model).toMatchObject({
			command: "command",
			run: "command",
			user: "command:user",
			assistant: "command:assistant",
			piAttempt: 1,
			replay: "pi-retry",
			generation: 1,
		});
		expect(tool).toMatchObject({
			command: "command",
			run: "command",
			submission: model.submission,
			call: "shell-original",
			arguments: '{"arguments":{},"operation":{"kind":"shell"}}',
			replay: "never",
			piAttempt: 1,
		});
		expect(tool.task).not.toBe(model.task);
		expect(rows[1]).toMatchObject({
			attempt: 1,
			executor: 1,
			epoch: 1,
			operation_deadline: f.now + 90_000,
		});
		expect(rows[0]?.operation_deadline).toBe(f.now + 60_000);
	}));
for (const persistent of [false, true])
	it(`lost shell result commit denies actual tool/model callbacks across two SQLite reopens, unavailable=${persistent}`, async () =>
		run(`lost-${persistent}`, "tool", async (f, state) => {
			await f.start();
			await f.fixture.entered.promise;
			f.fault = "result";
			f.unavailable = persistent;
			f.fixture.remote.resolve();
			await until(() => f.fixture.executionAttempts >= 2);
			expect(f.fixture.executionCalls).toBe(1);
			expect(f.fixture.providerCalls).toBe(1);
			await expect(
				f.host.admit("model", "later", BACKGROUND_CONTEXT),
			).rejects.toThrow();
			if (persistent)
				await expect(f.host.schedule("command")).rejects.toThrow();
			f.fault = undefined;
			f.unavailable = false;
			const original = f.effects().find((row) => row.kind === "tool")!;
			for (let n = 0; n < 2; n++) {
				await f.host.yield();
				await f.open();
				await f.host.accept(`new-${n}`, "Synthetic new ID");
				await expect(f.host.schedule(`new-${n}`)).rejects.toThrow();
				await (await f.harness.root(BACKGROUND_CONTEXT)).submit(
					{
						type: "input",
						content: "Synthetic defense",
						requestId: `defense-${n}`,
					},
					BACKGROUND_CONTEXT,
				);
				await until(
					() =>
						f.fixture.providerAttempts > 0 || f.fixture.executionAttempts > 0,
				);
				expect(f.fixture.providerCalls).toBe(0);
				expect(f.fixture.executionCalls).toBe(0);
				expect(f.effects()).toContainEqual(original);
				expect(f.runs().find((row) => row.id === "command")?.state).toBe(
					"failed",
				);
			}
			expect(
				state.storage.sql
					.exec("SELECT state FROM host_members WHERE run = 'command'")
					.one().state,
			).toBe("failed");
			expect(
				state.storage.sql
					.exec("SELECT state FROM host_projections WHERE run = 'command'")
					.one().state,
			).toBe("failed");
		}));
it("unavailable failure marker is unnecessary for reopen denial from durable admitted shell", async () =>
	run("no-marker", "tool", async (f, state) => {
		await f.start();
		await f.fixture.entered.promise;
		f.unavailable = true;
		f.fixture.remote.resolve();
		await until(() => f.fixture.executionAttempts >= 2);
		expect(
			state.storage.sql.exec("SELECT * FROM host_safety").toArray(),
		).toHaveLength(0);
		f.unavailable = false;
		await f.host.yield();
		await f.open();
		await expect(f.host.schedule("command")).rejects.toThrow();
		await (await f.harness.root(BACKGROUND_CONTEXT)).submit(
			{
				type: "input",
				content: "Synthetic unavailable defense",
				requestId: "unavailable-defense",
			},
			BACKGROUND_CONTEXT,
		);
		await until(() => f.fixture.providerAttempts > 0);
		expect(f.fixture.executionCalls + f.fixture.providerCalls).toBe(0);
	}));
it("safety result before failed Pi commit is not original successful tool receipt", async () =>
	run("pi-result-fault", "tool", async (f, state) => {
		// Public Storage fault seam preserves native SQLite and Pi atomic batches.
		f.piStorage = (storage: Storage) =>
			new Proxy(storage, {
				get(target, key) {
					if (key === "commit")
						return async (...args: Parameters<Storage["commit"]>) => {
							if (
								args[0].some(
									(write) =>
										write.type === "task" &&
										write.value.kind === "pi.tool" &&
										write.value.state.status === "terminal",
								)
							)
								throw new Error("Synthetic Pi result commit");
							return target.commit(...args);
						};
					const value: unknown = Reflect.get(target, key);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		await f.host.yield();
		await f.open();
		await f.start();
		await f.fixture.entered.promise;
		f.fixture.remote.resolve();
		await until(() =>
			f
				.effects()
				.some((row) => row.kind === "tool" && row.state === "result-recorded"),
		);
		await f.host.yield();
		f.piStorage = undefined;
		await f.open();
		await expect(f.host.schedule("command")).rejects.toThrow();
		f.harness.resume();
		await until(
			() => f.fixture.providerAttempts > 0 || f.fixture.executionAttempts > 0,
		);
		expect(f.fixture.providerCalls + f.fixture.executionCalls).toBe(0);
		expect(
			state.storage.sql
				.exec("SELECT state FROM host_effects WHERE kind='tool'")
				.one().state,
		).toBe("result-recorded");
	}));
for (const policy of [
	"shell-replay",
	"implicit-read",
	"unsupported-write",
] as const)
	it(`${policy} is denied on actual registered tool before executor I/O`, async () =>
		run(`policy-${policy}`, "tool", async (f) => {
			f.fixture.toolPolicy =
				policy === "shell-replay"
					? { operation: { kind: "shell" }, replay: "new-observation" }
					: policy === "implicit-read"
						? {
								operation: { kind: "read", newObservation: false },
								replay: "new-observation",
							}
						: {
								operation: { kind: "write", expectedContent: "old" },
								replay: "expected-content",
							};
			await f.start();
			await until(() => f.fixture.executionAttempts > 0);
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
			expect(f.fixture.executionCalls).toBe(0);
			expect(f.fixture.providerCalls).toBe(1);
			expect(f.effects().filter((row) => row.kind === "tool")).toHaveLength(0);
		}));
it("read repeats are explicit new observations on distinct original calls, never replay of an unresolved call", async () =>
	run("new-observation", "tool", async (f) => {
		f.fixture.toolPolicy = {
			operation: { kind: "read", newObservation: true },
			replay: "new-observation",
		};
		await f.start();
		await f.fixture.entered.promise;
		f.fixture.remote.resolve();
		await f.host.waitIdle();
		expect(f.fixture.executionCalls).toBe(2);
		const effects = f.effects().filter((row) => row.kind === "tool");
		expect(effects).toHaveLength(2);
		expect(
			effects.map((row) => JSON.parse(String(row.correlation)).replay),
		).toEqual(["new-observation", "new-observation"]);
		expect(effects[0]?.id).not.toBe(effects[1]?.id);
	}));
it("priority exact-run Stop bypasses missing predecessor and exhausted ordinary executor capacity", async () =>
	run("priority", "answer", async (f, state) => {
		await f.host.accept("gap", "Synthetic queued", {
			run: "gap",
			user: "u-gap",
			assistant: "a-gap",
			sequence: 3,
		});
		f.authority = {
			current: true,
			generation: 1,
			executor: 1,
			liveExecutors: 2,
		};
		await expect(f.host.schedule("gap")).rejects.toThrow("predecessor");
		await f.host.stop("stop-gap", "gap");
		expect(f.runs()[0]).toMatchObject({ state: "canceled", epoch: 3 });
		expect(
			state.storage.sql.exec("SELECT state FROM host_controls").one().state,
		).toBe("applied");
		expect(f.fixture.providerCalls + f.fixture.executionCalls).toBe(0);
	}));
it("Stop during async model preparation commits revocation before cancellation and stale release dispatches nothing", async () =>
	run("stop-preparation", "answer", async (f, state) => {
		const preparation = pendingRemote<void>();
		f.prepare = preparation;
		await f.start();
		await until(
			() =>
				state.storage.sql.exec("SELECT * FROM host_tasks").toArray().length ===
				1,
		);
		await f.host.stop("stop", "command");
		expect(preparation.settled).toBe(false);
		expect(f.runs()[0]?.state).toBe("canceled");
		preparation.resolve();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(f.fixture.providerCalls).toBe(0);
		expect(f.effects()).toHaveLength(0);
	}));
it("uncooperative shell Stop is stopping, cancellation receipt is not termination", async () =>
	run("stop-shell", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		const original = f.effects().find((row) => row.kind === "tool")!;
		await f.host.stop("stop", "command");
		expect(f.runs()[0]?.state).toBe("stopping");
		expect(f.fixture.remote.settled).toBe(false);
		await f.host.yield();
		await f.open();
		expect(f.runs()[0]?.state).toBe("failed");
		await f.host.accept("replacement", "Synthetic replacement");
		await expect(f.host.schedule("replacement")).rejects.toThrow();
		expect(f.effects()).toContainEqual(original);
		expect(f.fixture.executionCalls + f.fixture.providerCalls).toBe(0);
	}));
it("delayed old-run Stop never cancels later run or revives terminal completion", async () =>
	run("delayed-stop", "answer", async (f) => {
		await f.start("old");
		await f.host.waitIdle();
		expect(f.runs()[0]?.state).toBe("complete");
		await f.start("later");
		await f.host.stop("late-control", "old");
		await f.host.waitIdle();
		expect(f.runs().map((row) => row.state)).toEqual(["complete", "complete"]);
		expect(f.fixture.providerCalls).toBe(2);
		await expect(f.host.schedule("old")).rejects.toThrow("Terminal");
	}));
it("first interruption recovery deadline is fixed across two real reopens and expiry settles pending membership atomically", async () =>
	run("expiry", "retry", async (f, state) => {
		await f.start();
		await f.fixture.entered.promise;
		await f.host.yield();
		const first = f.runs()[0]!;
		expect(first.recovery_at).toBe(Number(first.interrupted_at) + 900_000);
		f.now += 100;
		await f.open();
		await f.host.yield();
		await f.open();
		expect(f.runs()[0]?.recovery_at).toBe(first.recovery_at);
		// Already-complete member must remain complete when another pending member fails.
		state.storage.transactionSync(() => {
			state.storage.sql.exec(
				"INSERT INTO host_members VALUES ('already-complete','command','complete')",
			);
		});
		f.now = Number(first.recovery_at);
		await f.host.expire();
		expect(f.runs()[0]?.state).toBe("failed");
		expect(
			state.storage.sql
				.exec(
					"SELECT state FROM host_members WHERE assistant='command:assistant'",
				)
				.one().state,
		).toBe("failed");
		expect(
			state.storage.sql
				.exec(
					"SELECT state FROM host_members WHERE assistant='already-complete'",
				)
				.one().state,
		).toBe("complete");
		expect(
			state.storage.sql
				.exec(
					"SELECT state FROM host_projections WHERE assistant='command:assistant'",
				)
				.one().state,
		).toBe("failed");
		await expect(f.host.schedule("command")).rejects.toThrow();
	}));
it("lost submit acknowledgment resolves public dedupe without duplicate spending", async () =>
	run("submit-ack", "answer", async (f, state) => {
		f.fault = "after-submit";
		await expect(f.start()).rejects.toThrow("Synthetic");
		f.fault = undefined;
		await f.host.yield();
		await f.open();
		const original = (await f.host.history()).items
			.filter((entry) => entry.kind === "pi.user")
			.map((entry) => entry.id);
		await f.host.schedule("command");
		await f.host.waitIdle();
		expect(
			(await f.host.history()).items
				.filter((entry) => entry.kind === "pi.user")
				.map((entry) => entry.id),
		).toEqual(original);
		expect(
			state.storage.sql.exec("SELECT submission FROM host_commands").one()
				.submission,
		).toBeTypeOf("number");
		expect(
			state.storage.sql.exec("SELECT * FROM host_commands").toArray(),
		).toHaveLength(1);
		expect(
			f.fixtures.reduce((total, fixture) => total + fixture.providerCalls, 0),
		).toBeLessThanOrEqual(1);
		expect(f.runs()[0]?.state).toMatch(/complete|failed/);
	}));
it("alarm settles committed submissions and pending projection intent without allocating another invocation or repeating I/O", async () =>
	run("alarm-settlement", "answer", async (f, state) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		expect(
			state.storage.sql
				.exec("SELECT id FROM host_wakeups WHERE id='settlement'")
				.toArray(),
		).toHaveLength(1);
		await f.host.alarm();
		expect(f.runs()[0]?.state).toBe("complete");
		expect(
			state.storage.sql.exec("SELECT state FROM host_projections").one().state,
		).toBe("complete");
		expect(f.fixture.providerCalls).toBe(1);
		expect(
			state.storage.sql.exec("SELECT id FROM host_invocations").toArray(),
		).toHaveLength(1);
	}));
it("completed model IDs and context survive close/reopen without repeating completed command", async () =>
	run("completed", "answer", async (f) => {
		await f.start();
		await f.host.waitIdle();
		const effects = f.effects();
		const history = await f.host.history();
		await f.host.yield();
		await f.open();
		await expect(f.host.schedule("command")).rejects.toThrow("Terminal");
		expect(f.effects()).toEqual(effects);
		expect(await f.host.history()).toEqual(history);
		expect(f.fixture.providerCalls).toBe(0);
	}));
it("public committed retry evidence authorizes a separate summary attempt without reopening or guessing current task", async () =>
	run("summary-live-retry", "answer", async (f) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		f.fixture.summary = "error-once";
		const task = await f.host.compact("command");
		await until(async () => {
			const taskRecord = await f.host.task(task);
			return (
				!!taskRecord?.state.checkpoint &&
				typeof taskRecord.state.checkpoint === "object" &&
				"phase" in taskRecord.state.checkpoint &&
				taskRecord.state.checkpoint.phase === "retry"
			);
		});
		f.now += 1000;
		await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		await f.host.reconcile();
		const effects = f
			.effects()
			.filter(
				(row) => JSON.parse(String(row.correlation)).task === Number(task),
			);
		expect(effects.map((row) => row.attempt)).toEqual([1, 2]);
		expect(effects[0]?.retry_evidence).toBeTypeOf("string");
		expect(f.fixture.providerCalls).toBe(3);
	}));
it("known completed summary error retries after reopen with retained logical request and separately recorded spending", async () =>
	run("summary-retry", "answer", async (f) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		f.fixture.summary = "error-once";
		const task = await f.host.compact("command");
		await until(async () => {
			const record = await f.host.task(task);
			return (
				!!record?.state.checkpoint &&
				typeof record.state.checkpoint === "object" &&
				"phase" in record.state.checkpoint &&
				record.state.checkpoint.phase === "retry"
			);
		});
		await f.host.yield();
		await f.open();
		f.now += 1000;
		await f.host.schedule("command");
		await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		await f.host.reconcile();
		const effects = f
			.effects()
			.filter(
				(row) => JSON.parse(String(row.correlation)).task === Number(task),
			);
		expect(effects).toHaveLength(2);
		expect(effects.map((row) => row.attempt)).toEqual([1, 2]);
		const first = JSON.parse(String(effects[0]?.correlation)),
			second = JSON.parse(String(effects[1]?.correlation));
		expect(second).toMatchObject({
			operation: first.operation,
			prepared: first.prepared,
			digest: first.digest,
			task: first.task,
			piAttempt: 2,
		});
		expect(second.generation).toBe(first.generation);
		expect(effects[0]?.invocation).not.toBe(effects[1]?.invocation);
		expect(f.fixture.providerCalls).toBe(1);
		expect(effects.map((row) => row.state)).toEqual([
			"pi-committed",
			"pi-committed",
		]);
	}));
it("validated first summary preparation survives close without admitting an effect", async () =>
	run("summary-first-prepared", "answer", async (f, state) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		const gate = pendingRemote<void>();
		f.prepare = gate;
		const task = await f.host.compact("command");
		await until(
			() =>
				state.storage.sql
					.exec("SELECT prepared FROM host_tasks WHERE task = ?", Number(task))
					.one().prepared !== null,
		);
		expect(f.effects()).toHaveLength(1);
		await f.host.yield();
		expect(gate.settled).toBe(false);
		f.prepare = undefined;
		await f.open();
		await f.host.schedule("command");
		const after = await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		expect(after.state.outcome?.status).toBe("completed");
		expect(f.fixture.providerAttempts).toBe(1);
		expect(f.fixture.providerCalls).toBe(1);
		expect(f.effects()).toHaveLength(2);
		gate.resolve();
	}));
for (const association of ["missing", "corrupt"] as const)
	it(`${association} first summary association after close denies the sole retained producer`, async () =>
		run(`summary-association-${association}`, "answer", async (f, state) => {
			await f.start();
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
			const gate = pendingRemote<void>();
			f.prepare = gate;
			const task = await f.host.compact("command");
			await until(
				() =>
					state.storage.sql
						.exec(
							"SELECT prepared FROM host_tasks WHERE task = ?",
							Number(task),
						)
						.one().prepared !== null,
			);
			await f.host.yield();
			state.storage.sql.exec(
				"UPDATE host_tasks SET prepared = ?, digest = ? WHERE task = ?",
				association === "missing" ? null : "{}",
				association === "missing" ? null : "corrupt-digest",
				Number(task),
			);
			f.prepare = undefined;
			await f.open();
			await f.host.schedule("command");
			const after = await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(after.state.outcome).toMatchObject({
				status: "failed",
				error: {
					message: "Summarization failed: Missing first summary association",
				},
			});
			expect(f.fixture.providerAttempts).toBe(1);
			expect(f.fixture.providerCalls).toBe(0);
			expect(f.effects()).toHaveLength(1);
			gate.resolve();
		}));
for (const ordering of ["before", "after"] as const)
	it(`selection handoff interrupted ${ordering} Pi summarize commit remains exact or fails closed`, async () =>
		run(`summary-selection-${ordering}`, "answer", async (f, state) => {
			const entered = pendingRemote<void>();
			const release = pendingRemote<void>();
			let invocationSignal: AbortSignal | undefined;
			f.adapters = (guard) => ({
				...guard,
				bindCompaction: async (api, selection, context) => {
					await guard.bindCompaction(api, selection, context);
					invocationSignal = context.abortSignal;
					if (ordering === "before") {
						entered.resolve();
						await awaitWithContext(release.promise, context);
					}
				},
			});
			if (ordering === "after")
				f.piStorage = (storage) =>
					new Proxy(storage, {
						get(target, key) {
							if (key === "commit")
								return async (...args: Parameters<Storage["commit"]>) => {
									const summary = args[0].some(
										(write) =>
											write.type === "task" &&
											write.value.kind === "pi.compaction" &&
											write.value.state.checkpoint &&
											typeof write.value.state.checkpoint === "object" &&
											"phase" in write.value.state.checkpoint &&
											write.value.state.checkpoint.phase === "summarize",
									);
									if (!summary) return target.commit(...args);
									const seq = await target.commit(...args);
									entered.resolve();
									await awaitWithContext(release.promise, args[1]);
									return seq;
								};
							const value: unknown = Reflect.get(target, key);
							return typeof value === "function" ? value.bind(target) : value;
						},
					});
			await f.host.yield();
			await f.open();
			await f.start();
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
			const task = await f.host.compact("command");
			await entered.promise;
			expect(
				state.storage.sql
					.exec(
						"SELECT prepared, digest FROM host_tasks WHERE task = ?",
						Number(task),
					)
					.one(),
			).toEqual({ prepared: null, digest: null });
			expect(f.fixture.providerAttempts).toBe(1);
			expect(f.effects()).toHaveLength(1);
			const closing = f.host.yield();
			if (ordering === "after") {
				await until(() => invocationSignal?.aborted === true);
				release.resolve();
			}
			await closing;
			f.piStorage = undefined;
			f.adapters = (guard) => guard;
			await f.open();
			await f.host.schedule("command");
			const after = await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			if (ordering === "before") {
				expect(after.state.outcome?.status).toBe("completed");
				expect(f.fixture.providerCalls).toBe(1);
			} else {
				expect(after.state.outcome).toMatchObject({
					status: "failed",
					error: {
						message: "Summarization failed: Missing first summary association",
					},
				});
				expect(f.fixture.providerCalls).toBe(0);
				expect(f.effects()).toHaveLength(1);
			}
			release.resolve();
		}));

it("stale epoch after validated summary preparation cannot admit an effect", async () =>
	run("summary-prepared-epoch", "answer", async (f, state) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		const gate = pendingRemote<void>();
		const entered = pendingRemote<void>();
		f.dependencies.prepareModel = async () => {
			entered.resolve();
			await gate.promise;
		};
		const task = await f.host.compact("command");
		await entered.promise;
		state.storage.sql.exec(
			"UPDATE host_runs SET epoch = epoch + 1 WHERE id = 'command'",
		);
		gate.resolve();
		const after = await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		expect(after.state.outcome?.status).toBe("failed");
		expect(f.fixture.providerCalls).toBe(1);
		expect(f.effects()).toHaveLength(1);
	}));

it("owned blocking compaction excludes its actual waiting generation parent and preserves command membership", async () =>
	run("owned-summary", "answer", async (f) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		await f.host.accept("follow", "Synthetic next context", {
			run: "command",
			user: "follow-user",
			assistant: "follow-assistant",
			sequence: 2,
		});
		f.automaticCompaction = true;
		await f.host.schedule("follow");
		await f.host.waitIdle();
		const effects = f.effects();
		expect(f.fixture.providerCalls).toBe(3);
		const summary = effects.find((row) =>
			JSON.parse(String(row.correlation)).operation.startsWith(
				"pi.compaction/",
			),
		)!;
		expect(JSON.parse(String(summary.correlation))).toMatchObject({
			command: "follow",
			assistant: "follow-assistant",
			run: "command",
		});
		expect(summary.state).toBe("pi-committed");
	}));
it("mixed actual generation and compaction producers deny both under one lane", async () =>
	run("mixed", "answer", async (f) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		const gate = pendingRemote<void>();
		f.prepare = gate;
		const summary = await f.host.compact("command");
		await until(() => f.fixture.providerAttempts === 2);
		await (await f.harness.root(BACKGROUND_CONTEXT)).submit(
			{
				type: "input",
				content: "Synthetic foreign producer",
				requestId: "foreign",
			},
			BACKGROUND_CONTEXT,
		);
		await until(() => f.fixture.providerAttempts === 3);
		gate.resolve();
		await f.harness.waitForTask(summary, BACKGROUND_CONTEXT);
		expect(f.fixture.providerCalls).toBe(1);
		expect(f.effects()).toHaveLength(1);
	}));
it("unknown admitted summary blocks actual recovered requests through two SQLite reopens", async () =>
	run("summary-unknown", "answer", async (f) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		f.fixture.summary = "pending";
		const task = await f.host.compact("command");
		await f.fixture.entered.promise;
		const original = f
			.effects()
			.find(
				(row) => JSON.parse(String(row.correlation)).task === Number(task),
			)!;
		for (let n = 0; n < 2; n++) {
			await f.host.yield();
			await f.open();
			await expect(f.host.schedule("command")).rejects.toThrow();
			if (n === 0) f.harness.resume();
			else
				await (await f.harness.root(BACKGROUND_CONTEXT)).submit(
					{
						type: "input",
						content: "Synthetic summary defense",
						requestId: "summary-defense",
					},
					BACKGROUND_CONTEXT,
				);
			await until(() => f.fixture.providerAttempts > 0);
			expect(f.fixture.providerCalls).toBe(0);
			expect(f.fixture.executionCalls).toBe(0);
			expect(f.effects()).toContainEqual(original);
		}
	}));
for (const mutation of ["authority", "mapping", "competition"] as const)
	it(`${mutation} during summary preparation denies actual dispatch`, async () =>
		run(`summary-${mutation}`, "answer", async (f, state) => {
			await f.start();
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
			const prepare = pendingRemote<void>();
			f.prepare = prepare;
			const task = await f.host.compact("command");
			await until(() => f.fixture.providerAttempts === 2);
			if (mutation === "authority")
				f.authority = { current: false, generation: 1, executor: 1 };
			else if (mutation === "mapping")
				state.storage.transactionSync(() =>
					state.storage.sql.exec(
						"UPDATE host_tasks SET selection = '{}' WHERE task = ?",
						Number(task),
					),
				);
			else {
				await (await f.harness.root(BACKGROUND_CONTEXT)).compact(
					undefined,
					BACKGROUND_CONTEXT,
				);
				await until(() => f.fixture.providerAttempts === 3);
			}
			prepare.resolve();
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			expect(f.fixture.providerCalls).toBe(1);
			expect(f.effects()).toHaveLength(1);
		}));
it("finite operation expiry fails run but retains original executor and deadline", async () =>
	run("operation-expiry", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		const original = f.effects().find((row) => row.kind === "tool")!;
		await f.host.yield();
		f.now = Number(original.operation_deadline);
		await f.host.expire();
		expect(f.runs()[0]?.state).toBe("failed");
		expect(f.effects()).toContainEqual(original);
		expect(f.fixture.remote.settled).toBe(false);
		await expect(f.host.schedule("command")).rejects.toThrow();
	}));
it("normal compaction establishes hook-bound tuple and preserves completed summary across reopen", async () =>
	run("compaction", "answer", async (f) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		const task = await f.host.compact("command");
		await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		await f.host.reconcile();
		expect(f.fixture.providerCalls).toBe(2);
		const effect = f
			.effects()
			.find(
				(row) => JSON.parse(String(row.correlation)).task === Number(task),
			)!;
		expect(effect.state).toBe("pi-committed");
		const correlation = JSON.parse(String(effect.correlation));
		expect(correlation).toMatchObject({ piAttempt: 1, replay: "pi-retry" });
		expect(JSON.parse(correlation.prepared)).toMatchObject({
			firstKept: expect.any(Number),
			tail: expect.any(Number),
			maxTokens: expect.any(Number),
		});
		await f.host.yield();
		await f.open();
		expect(f.effects()).toContainEqual(effect);
		expect(f.fixture.providerCalls).toBe(0);
	}));

async function knownSummaryRetry(f: ReturnType<typeof composition>) {
	await f.start();
	await f.harness.waitForIdle(BACKGROUND_CONTEXT);
	f.fixture.summary = "error-once";
	const task = await f.host.compact("command");
	await until(async () => {
		const value = await f.host.task(task);
		const cp = value?.state.checkpoint;
		return (
			!!cp && typeof cp === "object" && "phase" in cp && cp.phase === "retry"
		);
	});
	return task;
}
it("correction: native settled no-work alarms consume serviced reconciliation without past rearm", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("003-effects-corrected-alarm");
	let f: ReturnType<typeof composition> | undefined,
		deadline = 0;
	const calls: { value: number | null; wall: number; kind: "get" | "set" }[] =
		[];
	try {
		await runInDurableObject(stub, async (instance, state) => {
			f = composition(state.storage, "answer");
			f.now = Date.now() + 1000;
			f.dependencies.budgets = { workMs: 2000, drainMs: 200 };
			f.dependencies.wakeup = {
				getAlarm: async () => {
					const value = await state.storage.getAlarm();
					calls.push({ kind: "get", value, wall: Date.now() });
					return value;
				},
				setAlarm: async (value) => {
					calls.push({ kind: "set", value, wall: Date.now() });
					await state.storage.setAlarm(value);
				},
			};
			await f.open();
			await f.start();
			await f.host.waitIdle();
			await f.host.yield();
			await f.open();
			instance.host = f.host;
			expect(f.runs()[0]?.state).toBe("complete");
			expect((await f.host.inspect()).tasks).toHaveLength(0);
			expect(f.effects().every((row) => row.state === "pi-committed")).toBe(
				true,
			);
			const intents = state.storage.sql
				.exec("SELECT * FROM host_wakeups")
				.toArray();
			deadline = Number(
				intents.find((row) => row.id === "reconcile")?.deadline ??
					(await state.storage.getAlarm()) ??
					f.now,
			);
			f.now = deadline + 1;
			await state.storage.setAlarm(deadline);
			await state.storage.sync();
			calls.length = 0;
		});
		await new Promise((resolve) =>
			setTimeout(resolve, Math.max(0, deadline - Date.now()) + 20),
		);
		for (let i = 0; i < 2; i++) {
			await runDurableObjectAlarm(stub);
			await runInDurableObject(stub, async (instance, state) => {
				await instance.alarmCompletion;
				await state.storage.sync();
			});
		}
		await runInDurableObject(stub, async (_instance, state) => {
			expect(
				calls.some((call) => call.kind === "get" && call.value === null),
			).toBe(true);
			expect(
				calls.filter(
					(call) => call.kind === "set" && Number(call.value) <= call.wall,
				),
			).toEqual([]);
			expect(
				state.storage.sql
					.exec(
						"SELECT id FROM host_wakeups WHERE id IN ('reconcile','pi-retry','settlement')",
					)
					.toArray(),
			).toEqual([]);
			expect(await state.storage.getAlarm()).toBeNull();
		});
	} finally {
		await runInDurableObject(stub, async (instance, state) => {
			await instance.alarmCompletion;
			await f?.dispose();
			await state.storage.deleteAlarm();
			await state.storage.sync();
		});
	}
}, 10000);
for (const retryable of [false, true])
	it(`correction: known final compaction error settles original run, retryable=${retryable}`, async () =>
		run(`final-error-${retryable}`, "answer", async (f, state) => {
			let summaryCalls = 0;
			const error = retryable
				? "503 Synthetic exhausted summary error"
				: "400 Synthetic terminal summary error";
			f.adapters = (guard) => ({
				...guard,
				model: (request, context, start) =>
					guard.model(
						request,
						context,
						request.options.maxTokens === undefined
							? start
							: async () => {
									summaryCalls++;
									return fauxAssistantMessage([], {
										stopReason: "error",
										errorMessage: error,
									});
								},
					),
			});
			await f.host.yield();
			await f.open();
			await f.start();
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
			await f.host.accept("follow", "Synthetic pending follow-up", {
				run: "command",
				user: "follow:user",
				assistant: "follow:assistant",
				sequence: 2,
			});
			await f.host.reconcile();
			const task = await f.host.compact("command");
			if (retryable) {
				await until(() => summaryCalls === 1);
				await until(async () => {
					const value = await f.host.task(task);
					const cp = value?.state.checkpoint;
					return (
						!!cp &&
						typeof cp === "object" &&
						"phase" in cp &&
						cp.phase === "retry"
					);
				});
				f.now += 1000;
			}
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			await f.host.reconcile();
			const value = await f.host.task(task);
			expect(value?.state.status).toBe("terminal");
			if (value?.state.status === "terminal")
				expect(value.state.outcome).toMatchObject({
					status: "failed",
					error: {
						message: `Summarization failed: ${error}`,
						detail: { reason: "model_error" },
					},
				});
			expect(summaryCalls).toBe(retryable ? 2 : 1);
			expect(f.effects().filter((row) => row.state !== "pi-committed")).toEqual(
				[],
			);
			expect(f.runs()[0]?.state).toBe("failed");
			expect(
				state.storage.sql
					.exec("SELECT assistant,state FROM host_members ORDER BY assistant")
					.toArray(),
			).toEqual([
				{ assistant: "command:assistant", state: "complete" },
				{ assistant: "follow:assistant", state: "failed" },
			]);
			expect(
				state.storage.sql
					.exec(
						"SELECT assistant,state FROM host_projections ORDER BY assistant",
					)
					.toArray(),
			).toEqual([
				{ assistant: "command:assistant", state: "complete" },
				{ assistant: "follow:assistant", state: "failed" },
			]);
			expect(
				(await f.host.history()).items.filter(
					(entry) => entry.kind === "pi.compaction",
				),
			).toEqual([]);
		}));
it("correction: actual tool/manual-summary race reserves at most one operation and dispatch", async () =>
	run("shared-reservation", "tool", async (f, state) => {
		const tool = pendingRemote<void>(),
			prepare = pendingRemote<void>();
		let toolEntered = false;
		const authority = f.dependencies.authority;
		const gates: ReturnType<typeof pendingRemote<void>>[] = [];
		let racing = false;
		f.adapters = (guard) => ({
			...guard,
			tool: async (request, context, start) => {
				toolEntered = true;
				await tool.promise;
				return guard.tool(request, context, start);
			},
		});
		await f.host.yield();
		await f.open();
		await f.start();
		await until(() => toolEntered);
		await f.host.reconcile();
		f.fixture.summary = "pending";
		f.prepare = prepare;
		let prepared = false;
		f.dependencies.prepareModel = async () => {
			prepared = true;
			await prepare.promise;
		};
		await f.host.compact("command");
		await until(() => prepared);
		f.dependencies.authority = async () => {
			if (racing && new Error().stack?.includes("admitExact")) {
				const gate = pendingRemote<void>();
				gates.push(gate);
				await gate.promise;
			}
			return authority();
		};
		try {
			racing = true;
			tool.resolve();
			prepare.resolve();
			await until(() => gates.length === 2);
			racing = false;
			for (const gate of gates) gate.resolve();
			await until(() => f.effects().length > 1);
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(
				f.effects().filter((row) => row.state === "admitted").length,
			).toBeLessThanOrEqual(1);
			expect(
				f.fixture.executionCalls + f.fixture.providerCalls - 1,
			).toBeLessThanOrEqual(1);
			expect(f.effects()[0]?.state).toBe("pi-committed");
			expect(
				state.storage.sql
					.exec("SELECT id FROM host_safety WHERE reason='storage-failure'")
					.toArray(),
			).toEqual([]);
		} finally {
			racing = false;
			tool.resolve();
			prepare.resolve();
			for (const gate of gates) gate.resolve();
		}
	}));
it("correction: fixed recovery expiry is enforced after held preparation", async () =>
	run("prepare-expiry", "answer", async (f, state) => {
		const task = await knownSummaryRetry(f);
		await f.host.yield();
		await f.open();
		const deadline = Number(f.runs()[0]?.recovery_at);
		f.now = deadline - 100;
		const prepare = pendingRemote<void>();
		let entered = false;
		f.dependencies.prepareModel = async () => {
			entered = true;
			await prepare.promise;
		};
		await f.host.schedule("command");
		await until(() => entered);
		f.now = deadline + 100;
		prepare.resolve();
		await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		expect(f.fixture.providerCalls).toBe(0);
		expect(f.runs()[0]).toMatchObject({
			state: "failed",
			recovery_at: deadline,
		});
		expect(
			state.storage.sql.exec("SELECT state FROM host_members").one().state,
		).toBe("failed");
		expect(
			state.storage.sql.exec("SELECT state FROM host_projections").one().state,
		).toBe("failed");
	}));
it("correction: response-only recovery expiry rejects result before Pi consumes it", async () =>
	run("response-expiry", "answer", async (f, state) => {
		const task = await knownSummaryRetry(f);
		await f.host.yield();
		await f.open();
		const deadline = Number(f.runs()[0]?.recovery_at);
		f.now = deadline - 100;
		f.fixture.summary = "pending";
		await f.host.schedule("command");
		await f.fixture.entered.promise;
		expect(f.fixture.providerCalls).toBe(1);
		f.now = deadline + 100;
		f.fixture.remote.resolve();
		await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		const value = await f.host.task(task);
		expect(value?.state.status).toBe("terminal");
		if (value?.state.status === "terminal")
			expect(value.state.outcome.status).not.toBe("completed");
		expect(f.runs()[0]).toMatchObject({
			state: "failed",
			recovery_at: deadline,
		});
		expect(
			state.storage.sql.exec("SELECT state FROM host_members").one().state,
		).toBe("failed");
		expect(
			state.storage.sql.exec("SELECT state FROM host_projections").one().state,
		).toBe("failed");
		expect(f.effects().filter((row) => row.state === "admitted")).toHaveLength(
			1,
		);
	}));
it("correction: trusted abrupt takeover fixes recovery from the prior durable bound", async () =>
	run("abrupt-expiry", "answer", async (f, state) => {
		const task = await knownSummaryRetry(f);
		await f.host.reconcileStorage();
		expect(f.effects().every((row) => row.state === "pi-committed")).toBe(true);
		await f.harness.close(BACKGROUND_CONTEXT);
		await state.storage.sync();
		const prior = state.storage.sql
			.exec("SELECT * FROM host_invocations ORDER BY rowid DESC LIMIT 1")
			.one();
		f.authority = {
			current: true,
			generation: 2,
			executor: 1,
			priorTerminated: String(prior.id),
		};
		await f.open();
		const bound = Number(prior.started);
		expect(f.runs()[0]).toMatchObject({
			state: "recovering",
			interrupted_at: bound,
			recovery_at: bound + 15 * 60000,
		});
		f.now = bound + 15 * 60000 + 100;
		await expect(f.host.schedule("command")).rejects.toThrow();
		expect(f.fixture.providerCalls).toBe(0);
		expect(f.runs()[0]?.state).toBe("failed");
		expect(
			state.storage.sql.exec("SELECT state FROM host_members").one().state,
		).toBe("failed");
		expect(
			state.storage.sql.exec("SELECT state FROM host_projections").one().state,
		).toBe("failed");
		expect((await f.host.task(task))?.state.status).not.toBe("running");
	}));

async function encryptedBinding() {
	return {
		ownerId: "owner-encrypted-l1",
		workspaceSessionId: "session-encrypted-l1",
		keyring: await importRuntimeKeyringFromBytes("v1", {
			v1: new Uint8Array(32).fill(4),
		}),
	};
}

async function runEncrypted(
	name: string,
	phase: FixturePhase,
	test: (
		fixture: ReturnType<typeof composition>,
		state: DurableObjectState,
	) => Promise<void>,
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(`004-encrypted-l1-${name}`),
		async (_instance, state) => {
			const fixture = composition(
				state.storage,
				phase,
				await encryptedBinding(),
			);
			await fixture.open();
			try {
				await test(fixture, state);
			} finally {
				await fixture.dispose();
			}
		},
	);
}

async function plainCorrelation(
	storage: DurableObjectStorage,
	id: string,
): Promise<Record<string, unknown>> {
	const row = storage.sql
		.exec<{ correlation: string }>(
			"SELECT correlation FROM host_effects WHERE id = ?",
			id,
		)
		.one();
	return JSON.parse(
		await (await import("./host-private.ts")).openHostField(
			await encryptedBinding(),
			`effect:${id}:correlation`,
			row.correlation,
		),
	) as Record<string, unknown>;
}

for (const fault of ["preparation-write", "preparation-flush"] as const)
	it(`encrypted preparation ${fault} failure fences without admitting a summary`, async () =>
		runEncrypted(`summary-${fault}`, "answer", async (f, state) => {
			await f.start();
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
			f.fault = fault;
			const task = await f.host.compact("command");
			await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
			const row = state.storage.sql
				.exec(
					"SELECT prepared, digest FROM host_tasks WHERE task = ?",
					Number(task),
				)
				.one();
			if (fault === "preparation-write")
				expect(row).toEqual({ prepared: null, digest: null });
			else {
				expect(String(row.prepared)).toContain("aes-256-gcm");
				expect(row.digest).toBeTypeOf("string");
			}
			expect(f.fixture.providerCalls).toBe(1);
			expect(f.effects()).toHaveLength(1);
			expect(
				state.storage.sql.exec("SELECT reason FROM host_safety").one().reason,
			).toBe("storage-failure");
			f.fault = undefined;
			await f.host.yield();
			await f.open();
			await expect(f.host.schedule("command")).rejects.toThrow();
			expect(f.fixture.providerCalls).toBe(0);
			expect(f.effects()).toHaveLength(1);
		}));

it("encrypted validated summary preparation reopens with exact ciphertext provenance and no prior admission", async () =>
	runEncrypted("summary-prepared-reopen", "answer", async (f, state) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		const gate = pendingRemote<void>();
		const entered = pendingRemote<void>();
		f.dependencies.prepareModel = async () => {
			entered.resolve();
			await gate.promise;
		};
		const task = await f.host.compact("command");
		await entered.promise;
		const row = state.storage.sql
			.exec<{ prepared: string; digest: string }>(
				"SELECT prepared, digest FROM host_tasks WHERE task = ?",
				Number(task),
			)
			.one();
		expect(row.prepared).toContain("aes-256-gcm");
		expect(row.prepared).not.toContain("faux-1");
		const plain = await (await import("./host-private.ts")).openHostField(
			await encryptedBinding(),
			`task:${Number(task)}:prepared`,
			row.prepared,
		);
		expect(JSON.parse(plain)).toMatchObject({
			model: { provider: "faux", modelId: "faux-1" },
			firstKept: expect.any(Number),
		});
		expect(f.effects()).toHaveLength(1);
		await f.host.yield();
		f.dependencies.prepareModel = undefined;
		await f.open();
		await f.host.schedule("command");
		const after = await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		expect(after.state.outcome?.status).toBe("completed");
		expect(f.fixture.providerCalls).toBe(1);
		expect(f.effects()).toHaveLength(2);
		gate.resolve();
	}));

it("host-1 preparation meanings are not silently reinterpreted", async () =>
	run("old-preparation-version", "answer", async (f, state) => {
		await f.host.yield();
		state.storage.sql.exec(
			"UPDATE host_meta SET version = 'pi-1.0.1/ditto-host-1'",
		);
		await expect(f.open()).rejects.toThrow("Incompatible host state");
	}));

it("encrypted L1: guarded model and tool settle without a false integrity failure", async () =>
	runEncrypted("model-tool", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		expect(f.fixture.providerCalls).toBe(1);
		expect(f.fixture.executionCalls).toBe(1);
		await expect(f.host.expire()).resolves.toBeUndefined();
		f.fixture.remote.resolve();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		await f.host.reconcile();
		expect(f.effects().length).toBeGreaterThanOrEqual(2);
		expect(f.effects().every((row) => row.state === "pi-committed")).toBe(true);
		const raw = f
			.effects()
			.map((row) => String(row.correlation) + String(row.evidence))
			.join("\n");
		expect(raw).not.toContain("Synthetic remote result");
		expect(raw).toContain("aes-256-gcm");
	}));

it("encrypted L1: compaction, retry, and follow-up keep distinct IDs and context order", async () =>
	runEncrypted("follow-compaction", "tool", async (f, state) => {
		await f.start();
		await f.fixture.entered.promise;
		await f.host.accept("follow", "Synthetic encrypted follow-up", {
			run: "command",
			user: "follow-user",
			assistant: "follow-assistant",
			sequence: 2,
		});
		f.fixture.remote.resolve();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		await f.host.reconcile();
		const before = (await f.host.history()).items.map((entry) => entry.id);
		expect(before).toEqual([...before].sort((left, right) => right - left));
		f.fixture.phase = "answer";
		f.fixture.summary = "error-once";
		const task = await f.host.compact("command");
		await until(async () => {
			const record = await f.host.task(task);
			const checkpoint = record?.state.checkpoint;
			return (
				!!checkpoint &&
				typeof checkpoint === "object" &&
				"phase" in checkpoint &&
				checkpoint.phase === "retry"
			);
		});
		f.now += 1000;
		await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
		await f.host.reconcile();
		const correlations = [];
		for (const row of f.effects())
			if (row.correlation)
				correlations.push(
					await plainCorrelation(state.storage, String(row.id)),
				);
		const summaryAttempts = correlations.filter(
			(row) => row.task === Number(task),
		);
		expect(summaryAttempts.map((row) => row.piAttempt)).toEqual([1, 2]);
		expect(summaryAttempts[1]?.operation).toBe(summaryAttempts[0]?.operation);
		expect(summaryAttempts[1]?.prepared).toBe(summaryAttempts[0]?.prepared);
		await f.host.schedule("follow");
		await f.host.waitIdle();
		const after = (await f.host.history()).items.map((entry) => entry.id);
		expect(new Set(after).size).toBe(after.length);
		expect(after).toEqual([...after].sort((left, right) => right - left));
		expect(after.length).toBeGreaterThan(before.length);
		expect(
			state.storage.sql
				.exec(
					"SELECT state FROM host_members WHERE assistant = 'follow-assistant'",
				)
				.one().state,
		).toBe("complete");
		expect(summaryAttempts).toHaveLength(2);
	}));

it("encrypted L1: Stop during held preparation, active tool, and stale target does not dispatch", async () =>
	runEncrypted("stop", "tool", async (f) => {
		const preparation = pendingRemote<void>();
		f.prepare = preparation;
		await f.start();
		await until(() => f.fixture.providerAttempts === 1);
		await f.host.stop("stop-prep", "command");
		preparation.resolve();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(f.fixture.providerCalls).toBe(0);
		expect(f.effects()).toHaveLength(0);
		expect(f.runs()[0]?.state).toBe("canceled");
	}));

it("encrypted L1: stale Stop does not cancel a later completed run", async () =>
	runEncrypted("stale-stop", "answer", async (f) => {
		await f.start("old");
		await f.host.waitIdle();
		await f.start("later");
		await f.host.stop("late-control", "old");
		await f.host.waitIdle();
		expect(f.runs().map((row) => row.state)).toEqual(["complete", "complete"]);
		expect(f.fixture.providerCalls).toBe(2);
	}));

it("encrypted L1: active uncooperative tool Stop stays stopping and reopens blocked", async () =>
	runEncrypted("stop-tool", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		await f.host.stop("stop-tool", "command");
		expect(f.runs()[0]?.state).toBe("stopping");
		expect(f.fixture.remote.settled).toBe(false);
		await f.host.yield();
		await f.open();
		await expect(f.host.schedule("command")).rejects.toThrow();
		expect(f.fixture.executionCalls).toBe(0);
	}));

it("encrypted L1: operation and recovery deadlines fail closed after awaits", async () =>
	runEncrypted("deadlines", "tool", async (f, state) => {
		await f.start();
		await f.fixture.entered.promise;
		const tool = f.effects().find((row) => row.kind === "tool");
		if (!tool) throw new Error("missing tool effect");
		const deadline = Number(tool.operation_deadline);
		await f.host.yield();
		f.now = deadline;
		await f.host.expire();
		expect(f.runs()[0]?.state).toBe("failed");
		expect(
			state.storage.sql
				.exec("SELECT reason FROM host_safety")
				.toArray()
				.map((row) => row.reason),
		).toContain("operation-deadline");
		const recovery = Number(f.runs()[0]?.recovery_at);
		await f.open();
		expect(f.runs()[0]?.recovery_at).toBe(recovery);
		f.now = recovery;
		await f.host.expire();
		await expect(f.host.schedule("command")).rejects.toThrow();
	}));

it("encrypted L1: close cancels a held authority wait and reopen stays fenced", async () =>
	runEncrypted("close-reopen", "request", async (f, state) => {
		const preparation = pendingRemote<void>();
		f.prepare = preparation;
		const started = f.start();
		await until(() => f.fixture.providerAttempts === 1);
		const close = f.host.yield();
		preparation.resolve();
		await started.catch(() => undefined);
		await close;
		expect(f.fixture.providerCalls).toBe(0);
		expect(
			state.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced,
		).toBe(1);
		const closed = state.storage.sql
			.exec<{ id: string; state: string }>(
				"SELECT id, state FROM host_invocations",
			)
			.one();
		expect(closed.state).toBe("closed");
		await f.open();
		expect(f.fixture.providerCalls).toBe(0);
		expect(
			state.storage.sql.exec("SELECT state FROM host_invocations").one().state,
		).toBe("closed");
	}));

it("encrypted L1: result loss and Pi commit loss both block two reopens", async () => {
	await runEncrypted("lost-result", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		f.fault = "result";
		f.fixture.remote.resolve();
		await until(() => f.fixture.executionAttempts >= 2);
		expect(f.fixture.executionCalls).toBe(1);
		f.fault = undefined;
		for (let n = 0; n < 2; n++) {
			await f.host.yield();
			await f.open();
			await expect(f.host.schedule("command")).rejects.toThrow();
			expect(f.fixture.providerCalls).toBe(0);
		}
		expect(f.effects().some((row) => row.state === "admitted")).toBe(true);
	});
	await runEncrypted("lost-pi-commit", "tool", async (f, state) => {
		f.piStorage = (storage) =>
			new Proxy(storage, {
				get(target, key) {
					if (key === "commit")
						return async (...args: Parameters<Storage["commit"]>) => {
							if (
								args[0].some(
									(write) =>
										write.type === "task" &&
										write.value.kind === "pi.tool" &&
										write.value.state.status === "terminal",
								)
							)
								throw new Error("Synthetic Pi result commit");
							return target.commit(...args);
						};
					const value: unknown = Reflect.get(target, key);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		await f.host.yield();
		await f.open();
		await f.start();
		await f.fixture.entered.promise;
		f.fixture.remote.resolve();
		await until(() =>
			f
				.effects()
				.some((row) => row.kind === "tool" && row.state === "result-recorded"),
		);
		await f.host.yield();
		f.piStorage = undefined;
		for (let n = 0; n < 2; n++) {
			await f.open();
			await expect(f.host.schedule("command")).rejects.toThrow();
			await f.host.yield();
		}
		expect(
			state.storage.sql
				.exec("SELECT state FROM host_effects WHERE kind = 'tool'")
				.one().state,
		).toBe("result-recorded");
	});
});

it("encrypted L1: persistence barrier and unknown shell block two reopens", async () =>
	runEncrypted("barrier", "tool", async (f) => {
		await f.start();
		await f.fixture.entered.promise;
		f.fault = "result";
		f.unavailable = true;
		f.fixture.remote.resolve();
		await until(() => f.fixture.executionAttempts >= 2);
		f.fault = undefined;
		f.unavailable = false;
		for (let n = 0; n < 2; n++) {
			await f.host.yield().catch(() => undefined);
			await f.open();
			await f.host.accept(`new-${n}`, "Synthetic encrypted defense");
			await expect(f.host.schedule(`new-${n}`)).rejects.toThrow();
			expect(f.fixture.providerCalls).toBe(0);
			expect(f.fixtures[0]?.executionCalls).toBe(1);
		}
	}));

it("encrypted L1: changed host envelopes fail before provider I/O", async () =>
	runEncrypted("envelope-swap", "request", async (f, state) => {
		const retained = await encryptedBinding();
		let swapped = false;
		f.authorityHook = async () => {
			const effect = state.storage.sql
				.exec<{ id: string }>(
					"SELECT id FROM host_effects WHERE correlation IS NOT NULL LIMIT 1",
				)
				.toArray()[0];
			if (effect && !swapped) {
				const recordId = `effect:${effect.id}:correlation`;
				const replacement = await sealHostField(
					retained,
					recordId,
					'{"swapped":true}',
				);
				state.storage.sql.exec(
					"UPDATE host_effects SET correlation = ? WHERE id = ?",
					replacement.ciphertext,
					effect.id,
				);
				const selection = state.storage.sql
					.exec<{ task: number }>("SELECT task FROM host_tasks LIMIT 1")
					.toArray()[0];
				if (selection) {
					const selectionId = `task:${selection.task}:selection`;
					const swappedSelection = await sealHostField(
						retained,
						selectionId,
						'{"swapped":true}',
					);
					state.storage.sql.exec(
						"UPDATE host_tasks SET selection = ? WHERE task = ?",
						swappedSelection.ciphertext,
						selection.task,
					);
				}
				swapped = true;
			}
			return { current: true, generation: 1, executor: 1 };
		};
		const started = f.start();
		await until(() => swapped || f.fixture.providerCalls > 0);
		await started;
		expect(swapped).toBe(true);
		expect(f.fixture.providerCalls).toBe(0);
		await expect(f.host.expire()).rejects.toThrow(/integrity/);
	}));

it("encrypted L1: corrupt result and retry envelopes fail closed", async () =>
	runEncrypted("corrupt-evidence", "answer", async (f, state) => {
		await f.start();
		await f.host.waitIdle();
		const effect = f.effects()[0];
		if (!effect) throw new Error("missing effect");
		state.storage.sql.exec(
			"UPDATE host_effects SET evidence = 'corrupt' WHERE id = ?",
			effect.id,
		);
		await expect(f.host.reconcile()).rejects.toThrow(/integrity/);
		state.storage.sql.exec(
			"UPDATE host_effects SET retry_evidence = 'corrupt' WHERE id = ?",
			effect.id,
		);
		await f.host.yield().catch(() => undefined);
		await expect(f.open()).rejects.toThrow(/integrity/);
	}));

it("encrypted L1: retry seal failure fences before close and survives both orders", async () => {
	await runEncrypted("retry-fence-first", "answer", async (f, state) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		const held = pendingRemote<void>();
		held.promise.catch(() => undefined);
		f.dependencies.beforeRetrySeal = async () => {
			await held.promise;
			return "synthetic retry seal failure";
		};
		f.fixture.summary = "error-once";
		const compacting = f.host.compact("command");
		compacting.catch(() => undefined);
		await until(
			() =>
				state.storage.sql
					.exec(
						"SELECT effect_id FROM host_retry_intent WHERE state = 'pending'",
					)
					.toArray().length === 1,
		);
		const closing = f.host.yield();
		await until(
			() =>
				state.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced ===
				1,
		);
		expect(
			state.storage.sql.exec("SELECT state FROM host_retry_intent").one().state,
		).toBe("pending");
		held.resolve();
		await closing;
		expect(
			state.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced,
		).toBe(1);
		expect(
			state.storage.sql
				.exec(
					"SELECT retry_evidence FROM host_effects WHERE retry_evidence IS NOT NULL",
				)
				.toArray(),
		).toEqual([]);
		await expect(f.host.schedule("command")).rejects.toThrow();
		await compacting.catch(() => undefined);
		state.storage.sql.exec("UPDATE host_invocations SET state = 'closed'");
		await expect(f.open()).rejects.toThrow(/Missing retry evidence/);
	});
	await runEncrypted("retry-fail-first", "answer", async (f, state) => {
		await f.start();
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		f.dependencies.beforeRetrySeal = async () => "synthetic retry seal failure";
		f.fixture.summary = "error-once";
		await f.host.compact("command").catch(() => undefined);
		await until(
			() =>
				state.storage.sql
					.exec("SELECT effect_id FROM host_retry_intent")
					.toArray().length === 1,
		);
		await f.host.yield();
		expect(
			state.storage.sql.exec("SELECT fenced FROM host_meta").one().fenced,
		).toBe(1);
		expect(
			state.storage.sql.exec("SELECT state FROM host_retry_intent").one().state,
		).toBe("pending");
		await expect(f.host.schedule("command")).rejects.toThrow();
		state.storage.sql.exec("UPDATE host_invocations SET state = 'closed'");
		await expect(f.open()).rejects.toThrow(/Missing retry evidence/);
	});
});

it("encrypted L1: native alarm reopens with the retained binding and does not repeat the invocation", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("004-encrypted-l1-alarm");
	const retained = await encryptedBinding();
	await runInDurableObject(stub, async (instance, state) => {
		instance.retained = retained;
		const host = await instance.activate();
		await host.accept("alarm-input", "Synthetic encrypted wakeup");
		expect(await state.storage.getAlarm()).not.toBeNull();
		await host.yield();
	});
	expect(await runDurableObjectAlarm(stub)).toBe(true);
	await runInDurableObject(stub, async (instance, state) => {
		const host = instance.host;
		if (!host) throw new Error("Missing encrypted alarm host");
		await instance.fixtures.at(-1)?.entered.promise;
		expect(instance.fixtures.at(-1)?.providerCalls).toBe(1);
		expect(
			state.storage.sql
				.exec("SELECT COUNT(*) AS count FROM host_invocations")
				.one().count,
		).toBe(1);
		await host.yield();
	});
});
