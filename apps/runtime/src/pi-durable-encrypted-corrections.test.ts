import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type EntryId, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { digestText, sealHostField } from "./host-private.ts";
import { cooperativeFixture } from "./pi-durable-cooperative-fixture.ts";
import { PiDurableHost, type PiDurableHostFixture } from "./pi-durable-host.ts";
import { EncryptedPiStorage } from "./pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

async function retainedBinding(ownerId = "owner-review") {
	return {
		ownerId,
		workspaceSessionId: "session-review",
		keyring: await importRuntimeKeyringFromBytes("v1", {
			v1: new Uint8Array(32).fill(9),
		}),
	};
}

function dependencies(retained: Awaited<ReturnType<typeof retainedBinding>>) {
	const fixture = cooperativeFixture(
		"request",
		async () => "unused",
		async () => undefined,
	);
	return {
		fixture,
		dependencies: {
			now: () => Date.now() + 60_000,
			authority: async () => ({ current: true, generation: 1, executor: 1 }),
			options: () => ({
				models: fixture.models,
				registry: fixture.registry,
				settings: {
					extensions: [fixture.extension],
					toolExecution: "sequential" as const,
					retry: { enabled: false },
					compaction: { enabled: false, backgroundTokens: 0 },
				},
			}),
			retained,
		},
	};
}

it("denies a tampered seal on reopen and does not replace accepted command text", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-seal");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await retainedBinding();
		const first = dependencies(retained);
		let host = await PiDurableHost.open(state.storage, first.dependencies);
		await host.accept("cmd", "original-sentinel");
		await host.yield();
		state.storage.sql.exec(
			"UPDATE host_seal SET digest = ? WHERE record_id = ?",
			await digestText("evil-sentinel"),
			"inbox:cmd:content",
		);
		await expect(
			PiDurableHost.open(state.storage, dependencies(retained).dependencies),
		).rejects.toThrow(/integrity/);
		expect(first.fixture.providerCalls).toBe(0);
		state.storage.sql.exec(
			"UPDATE host_seal SET digest = ? WHERE record_id = ?",
			await digestText("original-sentinel"),
			"inbox:cmd:content",
		);
		host = await PiDurableHost.open(
			state.storage,
			dependencies(retained).dependencies,
		);
		await expect(host.accept("cmd", "evil-sentinel")).rejects.toThrow(
			/Conflicting input/,
		);
		const memory = Reflect.get(host, "privatePlain") as Map<string, string>;
		expect(memory.get("inbox:cmd:content")).toBe("original-sentinel");
		await host.yield();
	});
});

it("denies a live seal change and a reopened route change before I/O", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-live-route");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await retainedBinding();
		const opened = dependencies(retained);
		const host = await PiDurableHost.open(state.storage, opened.dependencies);
		await host.accept("cmd", "live-sentinel");
		state.storage.sql.exec(
			"UPDATE host_seal SET digest = ? WHERE record_id = ?",
			await digestText("other-sentinel"),
			"inbox:cmd:content",
		);
		await expect(host.schedule("cmd")).rejects.toThrow(/integrity/);
		expect(opened.fixture.providerCalls).toBe(0);
		await host.yield().catch(() => undefined);
		const correlation = JSON.stringify({
			version: 1,
			run: "cmd",
			operation: "op",
			task: 1,
		});
		const sealed = await sealHostField(
			retained,
			"effect:effect-1:correlation",
			correlation,
		);
		state.storage.sql.exec(
			"INSERT INTO host_effects (id, kind, invocation, epoch, attempt, executor, deadline, state, evidence, correlation) VALUES ('effect-1','model','inv',1,1,0,1,'admitted',NULL,?)",
			sealed.ciphertext,
		);
		state.storage.sql.exec(
			"INSERT INTO host_seal VALUES ('effect:effect-1:correlation', ?)",
			sealed.digest,
		);
		state.storage.sql.exec(
			"INSERT INTO host_effect_route VALUES ('effect-1','other-run','op',1)",
		);
		state.storage.sql.exec(
			"UPDATE host_seal SET digest = ? WHERE record_id = ?",
			await digestText("live-sentinel"),
			"inbox:cmd:content",
		);
		state.storage.sql.exec("UPDATE host_invocations SET state = 'closed'");
		await expect(
			PiDurableHost.open(state.storage, dependencies(retained).dependencies),
		).rejects.toThrow(/integrity/);
	});
});

it("rejects a plaintext selection downgrade before scheduling", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-selection");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await retainedBinding();
		const host = await PiDurableHost.open(
			state.storage,
			dependencies(retained).dependencies,
		);
		await host.accept("cmd", "selection-sentinel");
		await host.yield();
		state.storage.sql.exec(
			"UPDATE host_tasks SET selection = 'pending' WHERE selection != 'pending'",
		);
		if (
			state.storage.sql.exec("SELECT task FROM host_tasks").toArray().length ===
			0
		) {
			state.storage.sql.exec(
				"INSERT INTO host_tasks (task,kind,conversation,owner,command,selection) VALUES (1,'pi.compaction',1,'null','cmd','pending')",
			);
		}
		await expect(
			PiDurableHost.open(state.storage, dependencies(retained).dependencies),
		).rejects.toThrow(/Plaintext retained payload|integrity/);
		await expect(
			PiDurableHost.open(
				state.storage,
				dependencies(await retainedBinding("other-owner")).dependencies,
			),
		).rejects.toThrow(/Plaintext retained payload|integrity|Storage integrity/);
	});
});

it("keeps a Stop control when a Pi encryption failure follows it", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-stop");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await retainedBinding();
		const host = await PiDurableHost.open(
			state.storage,
			dependencies(retained).dependencies,
		);
		await host.accept("cmd", "synthetic-stop");
		const pi = Reflect.get(host, "piRecords");
		if (!(pi instanceof EncryptedPiStorage))
			throw new Error("missing pi storage");
		const id = await pi.mintId<EntryId>();
		let release!: () => void;
		const hold = new Promise<void>((done) => {
			release = done;
		});
		const original: unknown = Reflect.get(pi, "encodeText");
		if (typeof original !== "function") throw new Error("missing encodeText");
		let entered!: () => void;
		const started = new Promise<void>((done) => {
			entered = done;
		});
		Reflect.set(pi, "encodeText", async (plain: string, recordId: string) => {
			if (recordId.startsWith(`entries/${id}/`)) {
				entered();
				await hold;
				throw new Error("synthetic encryption rejection");
			}
			return original.call(pi, plain, recordId);
		});
		const commit = pi
			.commit(
				[
					{
						type: "entry",
						value: {
							id,
							conversationId: ROOT_CONVERSATION_ID,
							kind: "note",
							data: { text: "synthetic-entry" },
						},
					},
				],
				BACKGROUND_CONTEXT,
			)
			.then(
				() => "committed",
				() => "rejected",
			);
		await started;
		const stopped = host.stop("stop-1", "cmd").then(
			() => "stopped",
			(error: unknown) =>
				error instanceof Error ? error.message : "stop-failed",
		);
		release();
		expect(await commit).toBe("rejected");
		await stopped;
		const run = state.storage.sql
			.exec<{ epoch: number; state: string }>(
				"SELECT epoch, state FROM host_runs WHERE id = 'cmd'",
			)
			.one();
		const controls = state.storage.sql
			.exec<{ id: string; state: string }>(
				"SELECT id, state FROM host_controls",
			)
			.toArray();
		expect(run.epoch).toBeGreaterThan(1);
		expect(controls).toEqual([{ id: "stop-1", state: "applied" }]);
		await expect(host.schedule("cmd")).rejects.toThrow();
		await host.yield().catch(() => undefined);
	});
});

it("fences close when retained retry sealing fails and rejects a pending intent", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("correction-retry-fence");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await retainedBinding();
		const host = await PiDurableHost.open(
			state.storage,
			dependencies(retained).dependencies,
		);
		await host.accept("cmd", "retry-sentinel");
		const failed = Promise.reject(new Error("synthetic retry seal failure"));
		failed.catch(() => undefined);
		Reflect.set(host, "privateQueue", failed);
		await expect(host.yield()).rejects.toThrow(/synthetic retry seal failure/);
		expect(
			state.storage.sql
				.exec<{ fenced: number }>("SELECT fenced FROM host_meta")
				.one().fenced,
		).toBe(1);
		await expect(host.schedule("cmd")).rejects.toThrow();
		state.storage.sql.exec("UPDATE host_invocations SET state = 'closed'");
		state.storage.sql.exec(
			"INSERT INTO host_retry_intent (effect_id, task, attempt, until_at, seq, state) VALUES ('effect-1', 1, 1, 1, 1, 'pending')",
		);
		await expect(
			PiDurableHost.open(state.storage, dependencies(retained).dependencies),
		).rejects.toThrow(/Missing retry evidence/);
	});
});
