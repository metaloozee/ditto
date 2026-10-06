import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { openHostField, sealHostField } from "../../apps/runtime/src/host-private.ts";
import { cooperativeFixture, type FixturePhase } from "../../apps/runtime/src/pi-durable-cooperative-fixture.ts";
import { PiDurableHost, type HostFixtureDependencies } from "../../apps/runtime/src/pi-durable-host.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

async function binding() {
	return { ownerId: "advisor-final-owner", workspaceSessionId: "advisor-final-session", keyring: await importRuntimeKeyringFromBytes("v1", { v1: new Uint8Array(32).fill(12) }) };
}
async function until(predicate: () => boolean | Promise<boolean>) {
	for (let n = 0; n < 300; n++) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Advisor observation deadline");
}
async function composition(storage: DurableObjectStorage, phase: FixturePhase) {
	const retained = await binding();
	let now = Date.now() + 60_000;
	let hook: (() => Promise<void>) | undefined;
	let host: PiDurableHost;
	const fixtures: ReturnType<typeof cooperativeFixture>[] = [];
	const dependencies: HostFixtureDependencies = {
		retained, now: () => now,
		authority: async () => { await hook?.(); return { current: true, generation: 1, executor: 1 }; },
		budgets: { workMs: 10_000, drainMs: 1_000 },
		operationMs: { model: 60_000, tool: 90_000 },
		wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
		options: (guard) => {
			const fixture = cooperativeFixture(phase, (kind, id, context) => guard.admit(kind, id, context), (id, context, evidence) => guard.result(id, context, evidence), guard);
			fixtures.push(fixture);
			return { now: () => now, models: fixture.models, registry: fixture.registry, settings: { extensions: [fixture.extension], toolExecution: "sequential", retry: { enabled: true, maxRetries: 1, baseDelayMs: 300 }, compaction: { enabled: false, backgroundTokens: 0, keepRecentTokens: 1, reserveTokens: 64 } } };
		},
	};
	return {
		retained, dependencies,
		get host() { return host; },
		get fixture() { return fixtures.at(-1)!; },
		get harness() {
			const value: unknown = Reflect.get(host, "harness");
			if (!value || typeof value !== "object" || !("getTask" in value)) throw new Error("Missing public Harness seam");
			return value as Harness;
		},
		set hook(value: typeof hook) { hook = value; },
		advance() { now += 1000; },
		async open() { host = await PiDurableHost.open(storage, dependencies); },
		async start() { await host.accept("command", "Synthetic advisor context ".repeat(50)); await host.schedule("command"); },
		effects() { return storage.sql.exec<{ id: string; kind: string; state: string; correlation: string; evidence: string | null }>("SELECT id,kind,state,correlation,evidence FROM host_effects ORDER BY rowid").toArray(); },
		async correlation(id: string, envelope: string) { return JSON.parse(await openHostField(retained, `effect:${id}:correlation`, envelope)) as Record<string, unknown>; },
		async dispose() { for (const fixture of fixtures) fixture.remote.resolve(); await host?.yield().catch(() => undefined); await storage.deleteAlarm(); await storage.sync(); },
	};
}
async function run(name: string, phase: FixturePhase, test: (f: Awaited<ReturnType<typeof composition>>, storage: DurableObjectStorage) => Promise<void>) {
	await runInDurableObject(env.PI_HOST_STORAGE.getByName(`004-final-advisor-${name}`), async (_instance, state) => {
		const f = await composition(state.storage, phase);
		await f.open();
		try { await test(f, state.storage); } finally { await f.dispose(); }
	});
}

for (const field of ["correlation", "selection", "prepared"] as const)
	it(`advisor: ${field} alone changed at an authority await denies model I/O`, async () => run(`swap-${field}`, "answer", async (f, storage) => {
		let changed = false;
		if (field === "prepared") {
			await f.start();
			await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		}
		f.hook = async () => {
			if (changed) return;
			let recordId: string;
			let table: string;
			let column: string;
			let key: string | number;
			if (field === "correlation") {
				const row = storage.sql.exec<{ id: string }>("SELECT id FROM host_effects WHERE correlation IS NOT NULL LIMIT 1").toArray()[0];
				if (!row) return;
				recordId = `effect:${row.id}:correlation`; table = "host_effects"; column = "id"; key = row.id;
			} else {
				const row = storage.sql.exec<{ task: number; prepared: string | null }>("SELECT task,prepared FROM host_tasks LIMIT 1").toArray()[0];
				if (!row || field === "prepared" && row.prepared == null) return;
				recordId = `task:${row.task}:${field}`; table = "host_tasks"; column = "task"; key = row.task;
			}
			const sealed = await sealHostField(f.retained, recordId, '{"advisorSwap":true}');
			storage.sql.exec(`UPDATE ${table} SET ${field} = ? WHERE ${column} = ?`, sealed.ciphertext, key);
			changed = true;
		};
		if (field === "prepared") await f.host.compact("command");
		else await f.start();
		await until(() => changed);
		await f.harness.waitForIdle(BACKGROUND_CONTEXT);
		expect(f.fixture.providerCalls).toBe(field === "prepared" ? 1 : 0);
		await expect(f.host.expire()).rejects.toThrow(/integrity/);
	}));

it("advisor: committed summary retry resumes after close with the exact logical request", async () => run("retry-reopen", "answer", async (f) => {
	await f.start();
	await f.harness.waitForIdle(BACKGROUND_CONTEXT);
	f.fixture.summary = "error-once";
	const task = await f.host.compact("command");
	await until(async () => { const cp = (await f.host.task(task))?.state.checkpoint; return !!cp && typeof cp === "object" && "phase" in cp && cp.phase === "retry"; });
	await f.host.yield();
	await f.open();
	f.advance();
	await f.host.schedule("command");
	await f.harness.waitForTask(task, BACKGROUND_CONTEXT);
	await f.host.reconcile();
	const attempts: Array<{ correlation: Record<string, unknown>; state: string }> = [];
	for (const row of f.effects()) { const correlation = await f.correlation(row.id, row.correlation); if (correlation.task === Number(task)) attempts.push({ correlation, state: row.state }); }
	expect(attempts).toHaveLength(2);
	expect(attempts.map((row) => row.correlation.piAttempt)).toEqual([1, 2]);
	expect(attempts[1]?.correlation).toMatchObject({ operation: attempts[0]?.correlation.operation, prepared: attempts[0]?.correlation.prepared, digest: attempts[0]?.correlation.digest });
	expect(attempts.map((row) => row.state)).toEqual(["pi-committed", "pi-committed"]);
	expect(f.fixture.providerCalls).toBe(1);
}));

it("advisor: unknown admitted summary denies actual recovered requests through two reopens", async () => run("unknown-summary", "answer", async (f) => {
	await f.start();
	await f.harness.waitForIdle(BACKGROUND_CONTEXT);
	f.fixture.summary = "pending";
	const task = await f.host.compact("command");
	await f.fixture.entered.promise;
	let original: ReturnType<typeof f.effects>[number] | undefined;
	for (const row of f.effects()) if ((await f.correlation(row.id, row.correlation)).task === Number(task)) original = row;
	expect(original?.state).toBe("admitted");
	for (let n = 0; n < 2; n++) {
		await f.host.yield(); await f.open();
		await expect(f.host.schedule("command")).rejects.toThrow();
		if (n === 0) f.harness.resume();
		else await (await f.harness.root(BACKGROUND_CONTEXT)).submit({ type: "input", content: "Synthetic advisor defense", requestId: "summary-defense" }, BACKGROUND_CONTEXT);
		await until(() => f.fixture.providerAttempts > 0);
		expect(f.fixture.providerCalls + f.fixture.executionCalls).toBe(0);
		expect(f.effects()).toContainEqual(original);
	}
}));

it("advisor: repeated results use original plaintext evidence and retain one receipt", async () => run("idempotent-result", "answer", async (f) => {
	await f.start(); await f.host.waitIdle();
	const row = f.effects()[0];
	if (!row?.evidence) throw new Error("Missing result");
	const evidence = await openHostField(f.retained, `effect:${row.id}:evidence`, row.evidence);
	await expect(f.host.result(row.id, BACKGROUND_CONTEXT, evidence)).resolves.toBeUndefined();
	await f.host.yield(); await f.open();
	await expect(f.host.result(row.id, BACKGROUND_CONTEXT, evidence)).resolves.toBeUndefined();
	expect(f.effects()).toHaveLength(1); expect(f.fixture.providerCalls).toBe(0);
}));
