import { env, runInDurableObject } from "cloudflare:test";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type EntryId,
	ROOT_CONVERSATION_ID,
	type StorageWrite,
	type TaskId,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { parseCommandV2 } from "../../../packages/runtime-contracts/src/product-command.js";
import {
	command,
	complete,
	fixture,
	manifests,
	pointer,
	seed,
} from "./pi-durable-checkpoint.fixture.ts";
import { ensureCheckpointTables } from "./pi-durable-checkpoints.ts";
import type { PiDurableHost, PiDurableHostFixture } from "./pi-durable-host.ts";
import {
	createRetention,
	type RetentionFault,
	TRANSIENT_RETENTION_MS,
} from "./pi-durable-retention.ts";
import { EncryptedPiStorage } from "./pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

const context = BACKGROUND_CONTEXT;
const large = "017-retained-sentinel ".repeat(400);
const DAY = TRANSIENT_RETENTION_MS;

async function keys(rotated = false) {
	return {
		ownerId: "owner-017",
		workspaceSessionId: "session-017",
		keyring: await importRuntimeKeyringFromBytes(rotated ? "v2" : "v1", {
			v1: new Uint8Array(32).fill(7),
			...(rotated ? { v2: new Uint8Array(32).fill(8) } : {}),
		}),
	};
}

function task(id: TaskId<JsonValue>, text: string): StorageWrite {
	return {
		type: "task",
		value: {
			id,
			conversationId: ROOT_CONVERSATION_ID,
			kind: "synthetic",
			version: 1,
			input: { text },
			background: false,
			abortRequested: false,
			state: { status: "pending" as const, checkpoint: null },
		},
	};
}

function entry(id: EntryId, text: string): StorageWrite {
	return {
		type: "entry",
		value: {
			id,
			conversationId: ROOT_CONVERSATION_ID,
			kind: "note",
			data: { text },
		},
	};
}

const writes = (storage: DurableObjectStorage) =>
	storage.sql
		.exec<{ write_id: string }>(
			"SELECT DISTINCT write_id FROM private_chunks ORDER BY write_id",
		)
		.toArray()
		.map((row) => row.write_id);

async function references(opened: EncryptedPiStorage) {
	return new Set(
		(await opened.enumerateCommittedReferences()).map((ref) => ref.writeId),
	);
}

it("collects only writes that stay unreferenced and unpinned for the whole period; history, pins and rotated keys survive", async () => {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName("retention-writes"),
		async (_instance, state) => {
			const storage = state.storage;
			const options = { inlineMaxBytes: 1024 };
			let opened = await EncryptedPiStorage.open(
				storage,
				await keys(),
				options,
			);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			const taskId = await opened.mintId<TaskId<JsonValue>>();
			const entryId = await opened.mintId<EntryId>();
			await opened.commit(
				[task(taskId, `${large} v1`), entry(entryId, large)],
				context,
			);
			const v1 = await references(opened);
			// A retained pair pins the first task body before it is superseded.
			ensureCheckpointTables(storage);
			const pinnedWrites = [...v1];
			storage.sql.exec(
				"UPDATE checkpoint_pointer SET current = 'pair-1' WHERE id = 1",
			);
			for (const writeId of pinnedWrites)
				storage.sql.exec(
					"INSERT INTO checkpoint_pins (pair, write_id) VALUES ('pair-1', ?)",
					writeId,
				);
			await opened.commit([task(taskId, `${large} v2`)], context);
			const v2 = [...(await references(opened))].filter((id) => !v1.has(id));
			await opened.commit([task(taskId, `${large} v3`)], context);
			const live = await references(opened);
			// A failed preparation leaves an orphan no record references.
			const orphanEntry = await opened.mintId<EntryId>();
			const before = new Set(writes(storage));
			const original = storage.sql.exec.bind(storage.sql);
			storage.sql.exec = ((sql: string, ...params: SqlStorageValue[]) => {
				if (sql.startsWith("INSERT INTO entries"))
					throw new Error("Synthetic metadata failure");
				return original(sql, ...params);
			}) as typeof storage.sql.exec;
			try {
				await expect(
					opened.commit([entry(orphanEntry, `${large} orphan`)], context),
				).rejects.toThrow(/Synthetic/);
			} finally {
				storage.sql.exec = original;
			}
			const orphans = writes(storage).filter((id) => !before.has(id));
			expect(orphans).toHaveLength(1);
			expect(v2).toHaveLength(1);

			let now = 1_000_000;
			const retention = () =>
				createRetention({ storage, writes: opened, now: () => now });
			// First sight only marks.
			expect((await retention().step()).writes).toBe(0);
			const marked = storage.sql
				.exec<{ id: string }>(
					"SELECT id FROM retention_marks WHERE kind = 'write' ORDER BY id",
				)
				.toArray()
				.map((row) => row.id);
			expect(marked).toEqual([...v2, ...orphans].sort());
			// Age alone short of the period collects nothing.
			now += DAY - 1;
			expect((await retention().step()).writes).toBe(0);
			now += 1;
			// An interruption just before collection deletes nothing; the next pass does.
			await expect(
				createRetention({
					storage,
					writes: opened,
					now: () => now,
					fault: (point) => {
						if (point === "before-writes-collected")
							throw new Error("Synthetic retention fault");
					},
				}).step(),
			).rejects.toThrow(/Synthetic/);
			for (const id of [...v2, ...orphans])
				expect(writes(storage)).toContain(id);
			// A history read is queued with the collection in the admission lane.
			const [read, step] = await Promise.all([
				opened.entry(entryId, context),
				retention().step(),
			]);
			expect(read?.entry.data).toEqual({ text: large });
			expect(step.writes).toBe(2);
			const remaining = new Set(writes(storage));
			for (const id of [...v2, ...orphans])
				expect(remaining.has(id)).toBe(false);
			for (const id of [...live, ...pinnedWrites])
				expect(remaining.has(id)).toBe(true);
			await opened.close(context);
			// Rotated keys still open the retained history and its references.
			opened = await EncryptedPiStorage.open(
				storage,
				await keys(true),
				options,
			);
			try {
				expect(await opened.task(taskId, context)).toMatchObject({
					input: { text: `${large} v3` },
				});
				expect((await opened.entry(entryId, context))?.entry.data).toEqual({
					text: large,
				});
				now += 2 * DAY;
				await retention().step();
				await retention().step();
				expect(new Set(writes(storage))).toEqual(
					new Set([...live, ...pinnedWrites]),
				);
				// The recheck inside the admission lane keeps referenced and pinned writes.
				expect(
					await opened.collectWrites([...live], new Set<string>()),
				).toEqual([]);
				expect(
					await opened.collectWrites(pinnedWrites, new Set(pinnedWrites)),
				).toEqual([]);
				expect(new Set(writes(storage))).toEqual(
					new Set([...live, ...pinnedWrites]),
				);
			} finally {
				await opened.close(context);
			}
		},
	);
});

type Context = Parameters<Parameters<typeof fixture>[1]>[0];

/** A baseline, an answered command, then three boundary pairs over changing files. */
async function pairs(context: Context) {
	const { storage, control, store, execution } = context;
	context.workspaceOptions.enabled = true;
	await context.open();
	const baseline = await context.publisher().establishBaseline({
		seed: await seed(store.store),
		branch: "b",
	});
	if (baseline.status !== "published")
		throw new Error(JSON.stringify(baseline));
	const host = context.host();
	await host.acceptCandidate(command(1, control.now));
	await host.alarm();
	await complete(storage, host, 1);
	const ids = [baseline.manifest];
	for (const version of [1, 2, 3]) {
		execution.state.files = { "README.md": `version ${version}` };
		const published = await context.publisher().publishBoundary();
		if (published.status !== "published")
			throw new Error(JSON.stringify(published));
		ids.push(published.manifest);
	}
	// Fixture records stay inline, so each pair gets a synthetic pin to retire.
	for (const manifest of ids)
		storage.sql.exec(
			"INSERT INTO checkpoint_pins (pair, write_id) VALUES (?, ?)",
			manifest.id,
			`write-${manifest.id}`,
		);
	return { host, manifests: ids };
}

const objectKeys = (context: Context) => [
	...context.store.state.objects.keys(),
];
const pins = (context: Context) =>
	context.storage.sql
		.exec<{ pair: string }>(
			"SELECT DISTINCT pair FROM checkpoint_pins ORDER BY pair",
		)
		.toArray()
		.map((row) => row.pair);
/** Closes the host, moves the clock and reopens, as a later wakeup would. */
async function later(context: Context, host: PiDurableHost, ms: number) {
	await host.yield();
	await host.awaitClosure();
	context.control.now += ms;
	const reopened = await context.open();
	await reopened.alarm();
	return reopened;
}

const wakeup = (context: Context) =>
	context.storage.sql
		.exec<{ deadline: number }>(
			"SELECT deadline FROM host_wakeups WHERE id = 'retention'",
		)
		.toArray()[0]?.deadline;

it("retires pairs other than current and previous after the period: their pins and own objects go, shared seed bytes and retained pairs stay", async () => {
	await fixture("retention-pairs", async (context) => {
		const { control } = context;
		const { host, manifests: made } = await pairs(context);
		const [baseline, first, second, third] = made;
		expect(pointer(context.storage)).toMatchObject({
			current: third.id,
			previous: second.id,
		});
		// The first alarm with pairs arms retention one period out.
		await host.alarm();
		expect(wakeup(context)).toBe(control.now + DAY);
		let current = await later(context, host, DAY);
		// Marked, not collected.
		expect(pins(context)).toContain(first.id);
		expect(wakeup(context)).toBe(control.now + DAY);
		current = await later(context, current, DAY);
		expect(pins(context)).toEqual([second.id, third.id].sort());
		const keys = objectKeys(context);
		for (const manifest of [second, third]) {
			expect(keys).toContain(manifest.archive.objectKey);
			expect(keys).toContain(manifest.context.objectKey);
		}
		// The shared project seed is never this session's object.
		expect(keys).toContain("seed/project/seed.tar.gz");
		expect(keys).not.toContain(baseline.archive.objectKey);
		expect(keys).not.toContain(baseline.context.objectKey);
		expect(keys).not.toContain(first.archive.objectKey);
		expect(keys).not.toContain(first.context.objectKey);
		expect(manifests(context.storage)).toBe(4);
		// Nothing left waiting ends the wakeup instead of waking an idle session daily.
		expect(wakeup(context)).toBeUndefined();
		// Retained history still reads after collection.
		expect(JSON.stringify((await current.history()).items)).toContain(
			"Private instruction 1",
		);
	});
});

it.each([
	"after-mark",
	"after-pair-retired",
	"after-object-deleted",
] as const)("an interruption %s converges without losing a retained pair", async (point: RetentionFault) => {
	await fixture(`retention-fault-${point}`, async (context) => {
		const { host, manifests: made } = await pairs(context);
		const [baseline, first, second, third] = made;
		await host.alarm();
		let current = await later(context, host, DAY);
		let thrown = false;
		context.retentionOptions.fault = (at) => {
			if (at === point && !thrown) {
				thrown = true;
				throw new Error("Synthetic retention fault");
			}
		};
		for (let pass = 0; pass < 4; pass += 1)
			current = await later(context, current, DAY);
		expect(thrown).toBe(true);
		expect(pins(context)).toEqual([second.id, third.id].sort());
		const keys = objectKeys(context);
		expect(keys).toContain("seed/project/seed.tar.gz");
		expect(keys).not.toContain(baseline.archive.objectKey);
		for (const manifest of [second, third]) {
			expect(keys).toContain(manifest.archive.objectKey);
			expect(keys).toContain(manifest.context.objectKey);
		}
		expect(keys).not.toContain(first.context.objectKey);
		expect(keys).not.toContain(first.archive.objectKey);
	});
});

it("without a composed store releases pins but keeps objects for a later composition", async () => {
	await fixture("retention-no-store", async (context) => {
		context.retentionOptions.unavailable = true;
		const { host, manifests: made } = await pairs(context);
		const first = made[1];
		const keys = objectKeys(context);
		await host.alarm();
		const current = await later(context, host, DAY);
		await later(context, current, DAY);
		expect(pins(context)).not.toContain(first.id);
		expect(objectKeys(context)).toEqual(keys);
		expect(
			context.storage.sql
				.exec<{ state: string }>(
					"SELECT state FROM checkpoint_objects WHERE key = ?",
					first.context.objectKey,
				)
				.one().state,
		).toBe("orphaned");
	});
});

it("never runs while a session is archived or its authority is revoked", async () => {
	await fixture("retention-archived", async (context) => {
		const { host } = await pairs(context);
		await host.alarm();
		const keys = objectKeys(context);
		const before = pins(context);
		await host.acceptCandidate(
			parseCommandV2({
				version: 2,
				kind: "archive_session",
				commandId: "archive-2",
				commandSeq: 2,
				userId: "owner",
				projectId: "project",
				workspaceSessionId: "workspace",
				runtimeOwnerVersion: 1,
				receiptId: "archive-receipt-2",
				acceptedAt: 1,
				deadlineAt: 900001,
				payloadDigest: "a".repeat(64),
			}),
		);
		await host.alarm();
		let current = host;
		for (let pass = 0; pass < 3; pass += 1)
			current = await later(context, current, DAY);
		expect(wakeup(context)).toBeUndefined();
		expect(pins(context)).toEqual(expect.arrayContaining(before));
		expect(objectKeys(context)).toEqual(expect.arrayContaining(keys));
	});
	await fixture("retention-revoked", async (context) => {
		const { host } = await pairs(context);
		await host.alarm();
		const keys = objectKeys(context);
		const before = pins(context);
		context.authority.current = false;
		for (let pass = 0; pass < 3; pass += 1) {
			context.control.now += DAY;
			await host.alarm().catch(() => undefined);
		}
		expect(pins(context)).toEqual(before);
		expect(objectKeys(context)).toEqual(keys);
	});
});

it("waits while a publication is in flight and collects once it settles", async () => {
	await fixture("retention-busy", async (context) => {
		const { host, manifests: made } = await pairs(context);
		const first = made[1];
		let now = context.control.now;
		const retention = createRetention({
			storage: context.storage,
			writes: {
				unreferencedWrites: async () => [],
				collectWrites: async () => [],
			},
			store: context.store.store,
			now: () => now,
		});
		// Pairs a pending product projection names stay retained until it applies.
		await retention.step();
		now += DAY;
		expect(await retention.step()).toMatchObject({ pairs: 0, objects: 0 });
		expect(pins(context)).toContain(first.id);
		await host.alarm();
		// A live publication has prepared its context object but not committed.
		context.storage.sql.exec(
			"INSERT INTO checkpoint_objects (key, pair, state) VALUES ('context/workspace/in-flight.json', 'in-flight', 'prepared')",
		);
		for (let pass = 0; pass < 3; pass += 1) {
			expect(await retention.step()).toMatchObject({ pairs: 0, objects: 0 });
			now += DAY;
		}
		expect(pins(context)).toContain(first.id);
		expect(objectKeys(context)).toContain(first.context.objectKey);
		context.storage.sql.exec(
			"UPDATE checkpoint_objects SET state = 'published' WHERE key = 'context/workspace/in-flight.json'",
		);
		const settled = await retention.step();
		now += DAY;
		expect(settled.pairs + (await retention.step()).pairs).toBe(2);
		expect(pins(context)).not.toContain(first.id);
		expect(objectKeys(context)).not.toContain(first.context.objectKey);
	});
});

it("keeps an archive this session did not upload, and backs off a failing delete per object", async () => {
	await fixture("retention-shared-archive", async (context) => {
		const { host, manifests: made } = await pairs(context);
		const [baseline, first] = made;
		await host.alarm();
		// The first pair's archive came from elsewhere, as a continued lineage's source does.
		context.storage.sql.exec(
			"DELETE FROM recovery_operations WHERE object_key = ?",
			first.archive.objectKey,
		);
		let failing = true;
		let attempts = 0;
		let now = context.control.now;
		const retention = createRetention({
			storage: context.storage,
			writes: {
				unreferencedWrites: async () => [],
				collectWrites: async () => [],
			},
			store: {
				...context.store.store,
				delete: async (key) => {
					if (key === baseline.context.objectKey) attempts += 1;
					if (failing && key === baseline.context.objectKey)
						throw new Error("Synthetic delete failure");
					await context.store.store.delete(key);
				},
			},
			now: () => now,
		});
		await retention.step();
		now += DAY;
		expect(await retention.step()).toMatchObject({
			pairs: 2,
			objects: 2,
			next: now + 60_000,
		});
		let keys = objectKeys(context);
		expect(keys).toContain(first.archive.objectKey);
		expect(keys).toContain(baseline.context.objectKey);
		expect(keys).not.toContain(baseline.archive.objectKey);
		expect(keys).not.toContain(first.context.objectKey);
		// Inside its backoff the failing key is not tried again.
		now += 30_000;
		expect(await retention.step()).toMatchObject({ objects: 0 });
		expect(attempts).toBe(1);
		// A second failure doubles the wait.
		now += 30_000;
		expect(await retention.step()).toMatchObject({
			objects: 0,
			next: now + 120_000,
		});
		failing = false;
		now += 120_000;
		expect(await retention.step()).toMatchObject({ objects: 1, next: null });
		keys = objectKeys(context);
		expect(keys).not.toContain(baseline.context.objectKey);
		expect(keys).toContain(first.archive.objectKey);
	});
});
