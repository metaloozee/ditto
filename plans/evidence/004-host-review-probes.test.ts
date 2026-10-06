import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type EntryId } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { digestText, openHostField, sealHostField } from "../../apps/runtime/src/host-private.ts";
import { cooperativeFixture } from "../../apps/runtime/src/pi-durable-cooperative-fixture.ts";
import { PiDurableHost } from "../../apps/runtime/src/pi-durable-host.ts";
import { EncryptedPiStorage } from "../../apps/runtime/src/pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function binding() {
	return {
		ownerId: "owner-review",
		workspaceSessionId: "session-review",
		keyring: await importRuntimeKeyringFromBytes("v1", {
			v1: new Uint8Array(32).fill(9),
		}),
	};
}

function dependencies(retained: Awaited<ReturnType<typeof binding>>) {
	const fixture = cooperativeFixture(
		"request",
		async () => "unused",
		async () => undefined,
	);
	return {
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
	};
}

it("host review: Stop epoch does not survive a rolled-back Pi commit", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("host-review-stop");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await binding();
		const host = await PiDurableHost.open(state.storage, dependencies(retained));
		await host.accept("cmd", "synthetic-stop");
		const pi = Reflect.get(host, "piRecords");
		if (!(pi instanceof EncryptedPiStorage)) throw new Error("missing pi storage");
		const id = await pi.mintId<EntryId>();
		const entered = deferred();
		const release = deferred();
		const original: unknown = Reflect.get(pi, "encodeText");
		if (typeof original !== "function") throw new Error("missing encodeText");
		Reflect.set(pi, "encodeText", async (plain: string, recordId: string) => {
			if (recordId === `entries/${id}`) {
				entered.resolve();
				await release.promise;
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
		await entered.promise;
		let stopSettled = false;
		const stopping = host.stop("stop-1", "cmd").then(
			() => {
				stopSettled = true;
				return "stopped";
			},
			(error: unknown) => {
				stopSettled = true;
				return error instanceof Error ? error.message : "stop-failed";
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 40));
		const settledBeforeRelease = stopSettled;
		release.resolve();
		const commitResult = await commit;
		const stopResult = await stopping;
		const run = state.storage.sql
			.exec<{ epoch: number; state: string }>(
				"SELECT epoch, state FROM host_runs WHERE id = 'cmd'",
			)
			.one();
		const controls = state.storage.sql
			.exec("SELECT id, state FROM host_controls")
			.toArray();
		const fenced = state.storage.sql
			.exec<{ fenced: number }>("SELECT fenced FROM host_meta")
			.one().fenced;
		await host.yield().catch(() => undefined);
		expect({
			commitResult,
			stopResult,
			settledBeforeRelease,
			epoch: run.epoch,
			runState: run.state,
			controls,
			fenced,
		}).toEqual({
			commitResult: "rejected",
			stopResult: "stopped",
			settledBeforeRelease: false,
			epoch: 2,
			runState: "stopping",
			controls: [{ id: "stop-1", state: "applied" }],
			fenced: 0,
		});
	});
});

it("host review: tampered seal substitutes inbox plaintext in memory", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("host-review-seal");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await binding();
		let host = await PiDurableHost.open(state.storage, dependencies(retained));
		await host.accept("cmd", "original-sentinel");
		await host.yield();
		const evilDigest = await digestText("evil-sentinel");
		state.storage.sql.exec(
			"UPDATE host_seal SET digest = ? WHERE record_id = ?",
			evilDigest,
			"inbox:cmd:content",
		);
		host = await PiDurableHost.open(state.storage, dependencies(retained));
		await host.accept("cmd", "evil-sentinel");
		const stored = state.storage.sql
			.exec<{ content: string }>("SELECT content FROM host_inbox WHERE id = 'cmd'")
			.one().content;
		const decrypted = await openHostField(retained, "inbox:cmd:content", stored);
		const memory = Reflect.get(host, "privatePlain") as Map<string, string>;
		expect(decrypted).toBe("original-sentinel");
		expect(memory.get("inbox:cmd:content")).toBe("evil-sentinel");
		expect(stored).not.toContain("evil-sentinel");
		await host.schedule("cmd");
		const pi = Reflect.get(host, "piRecords");
		if (!(pi instanceof EncryptedPiStorage)) throw new Error("missing pi storage");
		const submission = await pi.submissionByRequest(
			ROOT_CONVERSATION_ID,
			"cmd",
			BACKGROUND_CONTEXT,
		);
		expect(submission?.type).toBe("input");
		if (submission?.type !== "input" || submission.status !== "placed")
			throw new Error(`unexpected submission ${submission?.type}`);
		const entry = await pi.entry(
			ROOT_CONVERSATION_ID,
			submission.entry,
			BACKGROUND_CONTEXT,
		);
		const rendered = JSON.stringify(entry);
		expect(rendered).toContain("evil-sentinel");
		expect(rendered).not.toContain("original-sentinel");
		const rawEntries = state.storage.sql
			.exec<{ record: string }>("SELECT record FROM entries")
			.toArray()
			.map((row) => row.record)
			.join("\n");
		expect(rawEntries).not.toContain("evil-sentinel");
		expect(rawEntries).not.toContain("original-sentinel");
		await host.yield();
	});
});

it("host review: wrong owner with intact inbox fails closed", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("host-review-owner");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await binding();
		const host = await PiDurableHost.open(state.storage, dependencies(retained));
		await host.accept("cmd", "owner-sentinel");
		await host.yield();
		await expect(
			PiDurableHost.open(state.storage, dependencies({ ...retained, ownerId: "other-owner" })),
		).rejects.toThrow();
	});
});

it("host review: pending selection tamper and wrong owner", async () => {
	const stub = env.PI_HOST_STORAGE.getByName("host-review-meta");
	await runInDurableObject(stub, async (_instance, state) => {
		const retained = await binding();
		let host = await PiDurableHost.open(state.storage, dependencies(retained));
		const sealed = await sealHostField(
			retained,
			"task:9:selection",
			"{\"firstKept\":1}",
		);
		state.storage.sql.exec(
			"INSERT INTO host_tasks (task,kind,conversation,owner,command,selection) VALUES (9,'pi.compaction',1,'null','cmd',?)",
			sealed.ciphertext,
		);
		state.storage.sql.exec(
			"INSERT INTO host_seal VALUES ('task:9:selection', ?)",
			sealed.digest,
		);
		await host.yield();
		state.storage.sql.exec(
			"UPDATE host_tasks SET selection = 'pending' WHERE task = 9",
		);
		host = await PiDurableHost.open(state.storage, dependencies(retained));
		const mapping = Reflect.get(host, "mapping") as (task: number) => {
			selection: string;
		};
		expect(mapping.call(host, 9).selection).toBe("pending");
		await host.yield();
		const wrong = {
			...retained,
			ownerId: "other-owner",
		};
		await expect(
			PiDurableHost.open(state.storage, dependencies(wrong)),
		).rejects.toThrow();
	});
});
