import { env, runInDurableObject } from "cloudflare:test";
import {
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { sealHostField } from "../../apps/runtime/src/host-private.ts";
import {
	cooperativeFixture,
	type FixturePhase,
} from "../../apps/runtime/src/pi-durable-cooperative-fixture.ts";
import {
	type HostGuard,
	PiDurableHost,
} from "../../apps/runtime/src/pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

async function binding() {
	return {
		ownerId: "owner-review",
		workspaceSessionId: "session-review",
		keyring: await importRuntimeKeyringFromBytes("v1", {
			v1: new Uint8Array(32).fill(9),
		}),
	};
}

function retainedHost(
	storage: DurableObjectStorage,
	phase: FixturePhase,
	authority: () => Promise<{
		current: boolean;
		generation: number;
		executor: number;
	}>,
) {
	let wired: ReturnType<typeof cooperativeFixture> | undefined;
	return {
		calls() {
			if (!wired) throw new Error("fixture not opened");
			return {
				providerCalls: wired.providerCalls,
				providerAttempts: wired.providerAttempts,
				executionCalls: wired.executionCalls,
				entered: wired.entered.promise,
				release: () => wired?.remote.resolve(),
				signal: wired.signal,
			};
		},
		async open() {
			const retained = await binding();
			const host = await PiDurableHost.open(storage, {
				now: () => Date.now() + 60_000,
				authority,
				budgets: { workMs: 60_000, drainMs: 5_000 },
				retained,
				options: (guard: HostGuard) => {
					wired = cooperativeFixture(
						phase,
						(kind, id, context) => guard.admit(kind, id, context),
						(id, context, evidence) => guard.result(id, context, evidence),
						guard,
					);
					return {
						models: wired.models,
						registry: wired.registry,
						settings: {
							extensions: [wired.extension],
							toolExecution: "sequential" as const,
							retry: { enabled: true, maxRetries: 1, baseDelayMs: 10_000 },
							compaction: { enabled: false, backgroundTokens: 0 },
						},
					};
				},
			});
			return { host, retained };
		},
	};
}

it("rejects an inbox ciphertext swap before provider I/O when the seal digest is unchanged", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-review-inbox-swap");
	await runInDurableObject(stub, async (_instance, state) => {
		const session = retainedHost(state.storage, "request", async () => ({
			current: true,
			generation: 1,
			executor: 1,
		}));
		const { host, retained } = await session.open();
		await host.accept("cmd", "original-inbox");
		const swapped = await sealHostField(
			retained,
			"inbox:cmd:content",
			"swapped-inbox",
		);
		state.storage.sql.exec(
			"UPDATE host_inbox SET content = ? WHERE id = ?",
			swapped.ciphertext,
			"cmd",
		);
		await expect(host.schedule("cmd")).rejects.toThrow(/integrity/);
		expect(session.calls().providerCalls).toBe(0);
		expect(session.calls().providerAttempts).toBe(0);
		await host.yield().catch(() => undefined);
	});
});

it("performs provider I/O after correlation and selection ciphertext swaps with unchanged seal digests", async () => {
	const stub = env.PI_HOST_STORAGE.getByName(
		"correction-review-correlation-swap",
	);
	await runInDurableObject(stub, async (_instance, state) => {
		const retainedPromise = binding();
		let swappedCorrelation = false;
		let swappedSelection = false;
		const session = retainedHost(state.storage, "request", async () => {
			const retained = await retainedPromise;
			const effect = state.storage.sql
				.exec<{ id: string; correlation: string }>(
					"SELECT id, correlation FROM host_effects WHERE correlation IS NOT NULL LIMIT 1",
				)
				.toArray()[0];
			if (effect && !swappedCorrelation) {
				const recordId = `effect:${effect.id}:correlation`;
				const replacement = await sealHostField(
					retained,
					recordId,
					"{\"swapped\":true}",
				);
				state.storage.sql.exec(
					"UPDATE host_effects SET correlation = ? WHERE id = ?",
					replacement.ciphertext,
					effect.id,
				);
				swappedCorrelation = true;
			}
			const selection = state.storage.sql
				.exec<{ task: number; selection: string }>(
					"SELECT task, selection FROM host_tasks LIMIT 1",
				)
				.toArray()[0];
			if (selection && !swappedSelection) {
				const recordId = `task:${selection.task}:selection`;
				const replacement = await sealHostField(
					retained,
					recordId,
					"{\"swapped\":true}",
				);
				state.storage.sql.exec(
					"UPDATE host_tasks SET selection = ? WHERE task = ?",
					replacement.ciphertext,
					selection.task,
				);
				swappedSelection = true;
			}
			return { current: true, generation: 1, executor: 1 };
		});
		const { host } = await session.open();
		await host.accept("cmd", "dispatch-after-swap");
		const scheduled = host.schedule("cmd").then(
			() => "scheduled",
			(error: unknown) =>
				error instanceof Error ? error.message : "schedule-failed",
		);
		await session.calls().entered;
		const cache = Reflect.get(host, "privatePlain") as Map<string, string>;
		const effect = state.storage.sql
			.exec<{ id: string }>(
				"SELECT id FROM host_effects WHERE correlation IS NOT NULL LIMIT 1",
			)
			.one();
		const task = state.storage.sql
			.exec<{ task: number }>("SELECT task FROM host_tasks LIMIT 1")
			.one();
		expect(swappedCorrelation).toBe(true);
		expect(swappedSelection).toBe(true);
		expect(cache.get(`effect:${effect.id}:correlation`)).not.toContain(
			"swapped",
		);
		expect(cache.get(`task:${task.task}:selection`)).not.toContain("swapped");
		expect(session.calls().providerAttempts).toBeGreaterThan(0);
		expect(session.calls().providerCalls).toBeGreaterThan(0);
		session.calls().release();
		await host.yield().catch(() => undefined);
		await scheduled;
	});
});

it("blocks the next encrypted deadline check after the first correlated admission", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-review-seal-cache");
	await runInDurableObject(stub, async (_instance, state) => {
		const session = retainedHost(state.storage, "request", async () => ({
			current: true,
			generation: 1,
			executor: 1,
		}));
		const { host } = await session.open();
		await host.accept("cmd", "deadline-after-admit");
		const scheduled = host.schedule("cmd").then(
			() => "scheduled",
			(error: unknown) =>
				error instanceof Error ? error.message : "schedule-failed",
		);
		await session.calls().entered;
		const plain = Reflect.get(host, "privatePlain") as Map<string, string>;
		const seals = new Set(
			state.storage.sql
				.exec<{ record_id: string }>("SELECT record_id FROM host_seal")
				.toArray()
				.map((row) => row.record_id),
		);
		const unsealed = [...plain.keys()].filter((key) => !seals.has(key));
		let expire = "ok";
		try {
			await host.expire();
		} catch (error) {
			expire = error instanceof Error ? error.message : "expire-failed";
		}
		const effect = state.storage.sql
			.exec<{ id: string }>(
				"SELECT id FROM host_effects WHERE correlation IS NOT NULL LIMIT 1",
			)
			.one();
		expect(unsealed).toEqual([effect.id]);
		expect(expire).toMatch(/integrity/);
		expect(session.calls().providerCalls).toBeGreaterThan(0);
		session.calls().release();
		await host.yield().catch(() => undefined);
		await scheduled;
	});
});

it("does not execute a tool after correlated model admission because the seal cache is unverifiable", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-review-tool-seal");
	await runInDurableObject(stub, async (_instance, state) => {
		const session = retainedHost(state.storage, "tool", async () => ({
			current: true,
			generation: 1,
			executor: 1,
		}));
		const { host } = await session.open();
		await host.accept("cmd", "tool-after-model");
		const scheduled = host.schedule("cmd").then(
			() => "scheduled",
			(error: unknown) =>
				error instanceof Error ? error.message : "schedule-failed",
		);
		for (let n = 0; n < 100 && session.calls().executionAttempts === 0; n++)
			await new Promise((resolve) => setTimeout(resolve, 20));
		expect(session.calls().providerCalls).toBeGreaterThan(0);
		expect(session.calls().executionAttempts).toBeGreaterThan(0);
		expect(session.calls().executionCalls).toBe(0);
		expect(
			state.storage.sql
				.exec("SELECT id FROM host_effects WHERE kind = 'tool'")
				.toArray(),
		).toEqual([]);
		session.calls().release();
		await host.yield().catch(() => undefined);
		await scheduled;
	});
});

it("cancels a stopping run after an effect-route swap without an uncertainty block", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-review-route-reconcile");
	await runInDurableObject(stub, async (_instance, state) => {
		const session = retainedHost(state.storage, "request", async () => ({
			current: true,
			generation: 1,
			executor: 1,
		}));
		const { host } = await session.open();
		await host.accept("cmd", "route-reconcile");
		const scheduled = host.schedule("cmd").then(
			() => "scheduled",
			(error: unknown) =>
				error instanceof Error ? error.message : "schedule-failed",
		);
		await session.calls().entered;
		state.storage.sql.exec("UPDATE host_effect_route SET run = 'other-run'");
		state.storage.sql.exec(
			"UPDATE host_runs SET state = 'stopping' WHERE id = 'cmd'",
		);
		await host.reconcile();
		const run = state.storage.sql
			.exec<{ state: string }>("SELECT state FROM host_runs WHERE id = 'cmd'")
			.one();
		expect(run.state).toBe("canceled");
		expect(state.storage.sql.exec("SELECT * FROM host_safety").toArray()).toEqual(
			[],
		);
		expect(
			state.storage.sql
				.exec("SELECT id FROM host_effects WHERE state = 'admitted'")
				.toArray().length,
		).toBeGreaterThan(0);
		session.calls().release();
		await host.yield().catch(() => undefined);
		await scheduled;
	});
});

it("inserts a new admission after the retry queue has already rejected", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-review-queue-admit");
	await runInDurableObject(stub, async (_instance, state) => {
		const session = retainedHost(state.storage, "request", async () => ({
			current: true,
			generation: 1,
			executor: 1,
		}));
		const { host } = await session.open();
		await host.accept("cmd", "queue-admit");
		const scheduled = host.schedule("cmd").then(
			() => "scheduled",
			(error: unknown) =>
				error instanceof Error ? error.message : "schedule-failed",
		);
		await session.calls().entered;
		const failed = Promise.reject(new Error("synthetic retry seal failure"));
		failed.catch(() => undefined);
		Reflect.set(host, "privateQueue", failed);
		const admitted = await host
			.admit("tool", "after-rejection", BACKGROUND_CONTEXT)
			.then(
				() => "admitted",
				(error: unknown) =>
					error instanceof Error ? error.message : "admit-failed",
			);
		const rows = state.storage.sql
			.exec<{ id: string; state: string }>(
				"SELECT id, state FROM host_effects WHERE id LIKE '%after-rejection'",
			)
			.toArray();
		expect(admitted).toMatch(/synthetic retry seal failure/);
		expect(rows.map((row) => row.state)).toEqual(["admitted"]);
		expect(
			state.storage.sql
				.exec<{ fenced: number }>("SELECT fenced FROM host_meta")
				.one().fenced,
		).toBe(1);
		session.calls().release();
		await host.yield().catch(() => undefined);
		await scheduled;
	});
});

it("poisons the selection seal cache on a second bind of an unchanged selection", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-review-rebind");
	await runInDurableObject(stub, async (_instance, state) => {
		const session = retainedHost(state.storage, "request", async () => ({
			current: true,
			generation: 1,
			executor: 1,
		}));
		const { host } = await session.open();
		await host.accept("cmd", "rebind");
		const scheduled = host.schedule("cmd").then(
			() => "scheduled",
			(error: unknown) =>
				error instanceof Error ? error.message : "schedule-failed",
		);
		await session.calls().entered;
		const task = state.storage.sql
			.exec<{ task: number }>("SELECT task FROM host_tasks LIMIT 1")
			.one();
		const recordId = `task:${task.task}:selection`;
		const before = state.storage.sql
			.exec<{ digest: string }>(
				"SELECT digest FROM host_seal WHERE record_id = ?",
				recordId,
			)
			.one().digest;
		const context = withAbortSignal(
			session.calls().signal ?? new AbortController().signal,
			BACKGROUND_CONTEXT,
		);
		const second = await Reflect.get(host, "bindTask").call(
			host,
			"pi.generation",
			{ taskId: task.task, conversationId: ROOT_CONVERSATION_ID },
			{},
			"same-digest",
			context,
		).then(
			() => "bound",
			(error: unknown) => (error instanceof Error ? error.message : "bind-failed"),
		);
		const after = state.storage.sql
			.exec<{ digest: string }>(
				"SELECT digest FROM host_seal WHERE record_id = ?",
				recordId,
			)
			.one().digest;
		const cache = Reflect.get(host, "privateDigest") as Map<string, string>;
		let expire = "ok";
		try {
			await host.expire();
		} catch (error) {
			expire = error instanceof Error ? error.message : "expire-failed";
		}
		expect(second).toBe("bound");
		expect(after).toBe(before);
		expect(cache.get(recordId)).not.toBe(before);
		expect(expire).toMatch(/integrity/);
		session.calls().release();
		await host.yield().catch(() => undefined);
		await scheduled;
	});
});
