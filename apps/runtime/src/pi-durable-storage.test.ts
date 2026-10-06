import { env, runInDurableObject } from "cloudflare:test";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type DocumentId,
	type EntryId,
	ROOT_CONVERSATION_ID,
	type SubmissionId,
	type TaskId,
} from "@earendil-works/pi-durable";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vitest";
import type { RetainedStorageBinding } from "./host-private.ts";
import type { PiDurableHostFixture } from "./pi-durable-host.ts";
import {
	ADAPTER_COMPAT,
	ENCRYPTED_STORAGE_FORMAT,
	ENGINE_COMPAT,
	EncryptedPiStorage,
	EncryptedStorageError,
	PROVIDER_COMPAT,
	TASK_COMPAT,
	TOOL_COMPAT,
} from "./pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}

const SENTINEL = "SENTINEL_private_payload_004";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function note(id: EntryId, text: string) {
	return {
		type: "entry" as const,
		value: {
			id,
			conversationId: ROOT_CONVERSATION_ID,
			kind: "note",
			data: { text },
		},
	};
}

function keyBytes(fill: number): Uint8Array {
	return new Uint8Array(32).fill(fill);
}

async function binding(
	current = "v1",
	keys: Record<string, number> = { v1: 7 },
	ownerId = "owner-004",
	workspaceSessionId = "session-004",
): Promise<RetainedStorageBinding> {
	return {
		ownerId,
		workspaceSessionId,
		keyring: await importRuntimeKeyringFromBytes(
			current,
			Object.fromEntries(
				Object.entries(keys).map(([version, fill]) => [
					version,
					keyBytes(fill),
				]),
			),
		),
	};
}

async function withDo(
	name: string,
	use: (
		storage: DurableObjectStorage,
		binding: RetainedStorageBinding,
	) => Promise<void>,
) {
	const stub = env.PI_HOST_STORAGE.getByName(name);
	await runInDurableObject(stub, async (_instance, state) => {
		await use(state.storage, await binding());
	});
}

registerStorageConformance(
	{ describe, expect, it },
	"encrypted DO SQLite",
	async (use) => {
		const stub = env.PI_HOST_STORAGE.getByName(
			`conformance-${crypto.randomUUID()}`,
		);
		await runInDurableObject(stub, async (_instance, state) => {
			const storage = await EncryptedPiStorage.open(
				state.storage,
				await binding(),
			);
			try {
				await use(storage);
			} finally {
				await storage.close(BACKGROUND_CONTEXT);
			}
		});
	},
);

describe("encrypted storage transactions and integrity", () => {
	it("keeps a same-invocation read and safety write out of a failing commit", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("same-invocation-commit");
		await runInDurableObject(stub, async (_instance, state) => {
			const opened = await EncryptedPiStorage.open(
				state.storage,
				await binding(),
			);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			state.storage.sql.exec(
				"CREATE TABLE safety_probe (epoch INTEGER NOT NULL)",
			);
			state.storage.sql.exec("INSERT INTO safety_probe VALUES (1)");
			const first = await opened.mintId<EntryId>();
			const second = await opened.mintId<EntryId>();
			const entered = deferred();
			const release = deferred();
			const original: unknown = Reflect.get(opened, "encodeText");
			if (typeof original !== "function")
				throw new Error("Missing encryption seam");
			Reflect.set(
				opened,
				"encodeText",
				async (plain: string, recordId: string) => {
					if (recordId.startsWith(`entries/${second}/`)) {
						entered.resolve();
						await release.promise;
						throw new Error("Synthetic encryption rejection");
					}
					return original.call(opened, plain, recordId);
				},
			);
			const commit = opened
				.commit(
					[note(first, "first"), note(second, "second")],
					BACKGROUND_CONTEXT,
				)
				.then(
					() => "committed",
					() => "rejected",
				);
			await entered.promise;
			state.storage.transactionSync(() => {
				state.storage.sql.exec("UPDATE safety_probe SET epoch = 2");
			});
			let readSettled = false;
			const reading = opened.entry(first, BACKGROUND_CONTEXT).then((value) => {
				readSettled = true;
				return value;
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(readSettled).toBe(false);
			release.resolve();
			expect(await commit).toBe("rejected");
			expect(await reading).toBeUndefined();
			expect(await opened.entry(first, BACKGROUND_CONTEXT)).toBeUndefined();
			expect(
				state.storage.sql
					.exec<{ epoch: number }>("SELECT epoch FROM safety_probe")
					.one().epoch,
			).toBe(2);
			await opened.close(BACKGROUND_CONTEXT);
			await expect(opened.mintId()).rejects.toThrow(/closed/);
		});
	});

	it("joins an admitted commit before close completes", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("close-joins-commit");
		await runInDurableObject(stub, async (_instance, state) => {
			const opened = await EncryptedPiStorage.open(
				state.storage,
				await binding(),
			);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			const id = await opened.mintId<EntryId>();
			const entered = deferred();
			const release = deferred();
			const original: unknown = Reflect.get(opened, "encodeText");
			if (typeof original !== "function")
				throw new Error("Missing encryption seam");
			Reflect.set(
				opened,
				"encodeText",
				async (plain: string, recordId: string) => {
					if (recordId.startsWith(`entries/${id}/`)) {
						entered.resolve();
						await release.promise;
					}
					return original.call(opened, plain, recordId);
				},
			);
			const commit = opened.commit([note(id, SENTINEL)], BACKGROUND_CONTEXT);
			await entered.promise;
			let closed = false;
			const closing = opened.close(BACKGROUND_CONTEXT).then(() => {
				closed = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(closed).toBe(false);
			release.resolve();
			await commit;
			await closing;
			expect(() => {
				void opened.entry(id, BACKGROUND_CONTEXT);
			}).toThrow(/closed/);
		});
	});

	it("reopens encrypted rows in order and keeps sentinels out of raw record bodies", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("reopen-sentinel");
		await runInDurableObject(stub, async (_instance, state) => {
			const keys = await binding();
			const first = await EncryptedPiStorage.open(state.storage, keys);
			const root = ROOT_CONVERSATION_ID;
			await first.commit(
				[{ type: "conversation", value: { id: root } }],
				BACKGROUND_CONTEXT,
			);
			const entryId = await first.mintId<EntryId>();
			await first.commit(
				[
					{
						type: "entry",
						value: {
							id: entryId,
							conversationId: root,
							kind: "note",
							data: { text: SENTINEL },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			await first.close(BACKGROUND_CONTEXT);
			const raw = state.storage.sql
				.exec<{ record: string }>("SELECT record FROM entries")
				.one().record;
			expect(raw).not.toContain(SENTINEL);
			expect(raw).toContain("aes-256-gcm");
			const second = await EncryptedPiStorage.open(state.storage, keys);
			expect(
				(await second.entry(entryId, BACKGROUND_CONTEXT))?.entry.data,
			).toEqual({
				text: SENTINEL,
			});
			await second.close(BACKGROUND_CONTEXT);
		});
	});

	it("round-trips chunked document content without storing the plaintext body", async () => {
		await withDo("chunked", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys, {
				inlineMaxBytes: 8,
				chunkBytes: 4,
			});
			const root = ROOT_CONVERSATION_ID;
			await opened.commit(
				[{ type: "conversation", value: { id: root } }],
				BACKGROUND_CONTEXT,
			);
			const documentId = await opened.mintId<DocumentId>();
			await opened.commit(
				[
					{
						type: "document.create",
						record: {
							id: documentId,
							kind: "app.note",
							scope: { kind: "session" },
						},
						content: {
							kind: "base",
							version: 1,
							value: { text: SENTINEL },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			const raw = storage.sql
				.exec<{ content: string }>("SELECT content FROM document_revisions")
				.one().content;
			expect(raw).not.toContain(SENTINEL);
			expect(raw).toContain("chunkCount");
			expect(
				(await opened.document(documentId, "current", BACKGROUND_CONTEXT))
					?.value,
			).toEqual({ text: SENTINEL });
			await opened.close(BACKGROUND_CONTEXT);
		});
	});

	it("fails closed on tamper, swap, wrong owner, missing key, rotation and bad versions", async () => {
		const stub = env.PI_HOST_STORAGE.getByName("integrity");
		await runInDurableObject(stub, async (_instance, state) => {
			const keys = await binding();
			const opened = await EncryptedPiStorage.open(state.storage, keys);
			const root = ROOT_CONVERSATION_ID;
			await opened.commit(
				[{ type: "conversation", value: { id: root } }],
				BACKGROUND_CONTEXT,
			);
			const first = await opened.mintId<EntryId>();
			const second = await opened.mintId<EntryId>();
			await opened.commit(
				[
					{
						type: "entry",
						value: {
							id: first,
							conversationId: root,
							kind: "note",
							data: { text: `${SENTINEL}-a` },
						},
					},
					{
						type: "entry",
						value: {
							id: second,
							conversationId: root,
							kind: "note",
							data: { text: `${SENTINEL}-b` },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			await opened.close(BACKGROUND_CONTEXT);
			const rotated = await EncryptedPiStorage.open(
				state.storage,
				await binding("v2", { v1: 7, v2: 9 }),
			);
			expect(
				(await rotated.entry(first, BACKGROUND_CONTEXT))?.entry.data,
			).toEqual({
				text: `${SENTINEL}-a`,
			});
			const added = await rotated.mintId<EntryId>();
			await rotated.commit(
				[
					{
						type: "entry",
						value: {
							id: added,
							conversationId: root,
							kind: "note",
							data: { text: "rotated" },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			const versions = state.storage.sql
				.exec<{ record: string }>("SELECT id, record FROM entries ORDER BY id")
				.toArray()
				.map((row) => JSON.parse(row.record) as { keyVersion: string });
			expect(versions.map((row) => row.keyVersion)).toEqual(["v1", "v1", "v2"]);
			await rotated.close(BACKGROUND_CONTEXT);
			await expect(
				EncryptedPiStorage.open(state.storage, await binding("v2", { v2: 9 })),
			).rejects.toThrow(EncryptedStorageError);
			await expect(
				EncryptedPiStorage.open(
					state.storage,
					await binding("v1", { v1: 7 }, "other-owner"),
				),
			).rejects.toThrow(/Storage integrity failure/);
			await expect(
				EncryptedPiStorage.open(
					state.storage,
					await binding("v1", { v1: 7 }, "owner-004", "other-session"),
				),
			).rejects.toThrow(/Storage integrity failure/);
			const rows = state.storage.sql
				.exec<{ id: number; record: string }>(
					"SELECT id, record FROM entries ORDER BY id",
				)
				.toArray();
			state.storage.sql.exec(
				"UPDATE entries SET record = ? WHERE id = ?",
				rows[1]?.record,
				rows[0]?.id,
			);
			await expect(
				EncryptedPiStorage.open(state.storage, keys),
			).rejects.toThrow(/Storage integrity failure/);
			state.storage.sql.exec(
				"UPDATE entries SET record = ? WHERE id = ?",
				rows[0]?.record,
				rows[0]?.id,
			);
			const envelope = JSON.parse(rows[0]?.record ?? "{}") as {
				ciphertext: string;
			};
			envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}${envelope.ciphertext.endsWith("AA") ? "BB" : "AA"}`;
			state.storage.sql.exec(
				"UPDATE entries SET record = ? WHERE id = ?",
				JSON.stringify(envelope),
				rows[0]?.id,
			);
			await expect(
				EncryptedPiStorage.open(state.storage, await binding("v1", { v1: 8 })),
			).rejects.toThrow(EncryptedStorageError);
			state.storage.sql.exec(
				"UPDATE ditto_storage_meta SET format_version = 99",
			);
			const scheduled = false;
			await expect(
				EncryptedPiStorage.open(state.storage, keys),
			).rejects.toThrow(/Incompatible encrypted storage/);
			expect(scheduled).toBe(false);
			state.storage.sql.exec(
				"UPDATE entries SET record = ? WHERE id = ?",
				JSON.stringify({
					kind: "external",
					version: 1,
					digest: "aa",
					byteCount: 3,
					locator: "r2/not-written",
				}),
				rows[0]?.id,
			);
			state.storage.sql.exec(
				"UPDATE ditto_storage_meta SET format_version = 1",
			);
			await expect(
				EncryptedPiStorage.open(state.storage, keys),
			).rejects.toThrow(/Incompatible encrypted storage/);
			state.storage.sql.exec(
				"UPDATE ditto_storage_meta SET format_version = ?",
				ENCRYPTED_STORAGE_FORMAT,
			);
			await expect(
				EncryptedPiStorage.open(state.storage, keys),
			).rejects.toThrow(/Unresolved external record reference/);
		});
	});

	it("rejects correct-key ciphertext tamper separately from a wrong key", async () => {
		await withDo("correct-key-tamper", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			const id = await opened.mintId<EntryId>();
			await opened.commit([note(id, SENTINEL)], BACKGROUND_CONTEXT);
			await opened.close(BACKGROUND_CONTEXT);
			const row = storage.sql
				.exec<{ record: string }>("SELECT record FROM entries")
				.one();
			const envelope = JSON.parse(row.record) as { ciphertext: string };
			envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}${envelope.ciphertext.endsWith("AA") ? "BB" : "AA"}`;
			storage.sql.exec(
				"UPDATE entries SET record = ?",
				JSON.stringify(envelope),
			);
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/Storage integrity failure/,
			);
		});
	});

	it("rejects each compatibility field and a keyring that lacks the historical key", async () => {
		const fields = [
			["engine_compat", ENGINE_COMPAT],
			["task_compat", TASK_COMPAT],
			["tool_compat", TOOL_COMPAT],
			["provider_compat", PROVIDER_COMPAT],
			["adapter_compat", ADAPTER_COMPAT],
		] as const;
		for (const [field, value] of fields) {
			const stub = env.PI_HOST_STORAGE.getByName(`compat-${field}`);
			await runInDurableObject(stub, async (_instance, state) => {
				const keys = await binding();
				const opened = await EncryptedPiStorage.open(state.storage, keys);
				await opened.close(BACKGROUND_CONTEXT);
				state.storage.sql.exec(
					`UPDATE ditto_storage_meta SET ${field} = ?`,
					`${value}-tampered`,
				);
				await expect(
					EncryptedPiStorage.open(state.storage, keys),
				).rejects.toThrow(/Incompatible encrypted storage/);
			});
		}
	});

	it("keeps sentinels out of each private payload family", async () => {
		await withDo("family-sentinels", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			const root = ROOT_CONVERSATION_ID;
			const entryId = await opened.mintId<EntryId>();
			const taskId = await opened.mintId<TaskId<JsonValue>>();
			const submissionId = await opened.mintId<SubmissionId>();
			const baseId = await opened.mintId<DocumentId>();
			const copyId = await opened.mintId<DocumentId>();
			const child =
				await opened.mintId<
					import("@earendil-works/pi-durable").ConversationId
				>();
			const record = {
				id: baseId,
				kind: "app.note",
				scope: { kind: "conversation" as const, conversationId: root },
				history: "rewindable" as const,
				fork: "current" as const,
			};
			await opened.commit(
				[
					{ type: "conversation", value: { id: root } },
					note(entryId, `${SENTINEL}-entry`),
					{
						type: "task",
						value: {
							id: taskId,
							conversationId: root,
							kind: "pi.tool",
							version: 1,
							background: false,
							abortRequested: false,
							input: { args: `${SENTINEL}-tool-args` },
							state: {
								status: "running",
								checkpoint: {
									phase: "execute",
									note: `${SENTINEL}-checkpoint`,
								},
							},
						},
					},
					{
						type: "submission",
						value: {
							id: submissionId,
							conversationId: root,
							type: "input",
							status: "placed",
							entry: entryId,
						},
					},
					{
						type: "document.create",
						record,
						content: {
							kind: "base",
							version: 1,
							value: { text: `${SENTINEL}-base` },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			await opened.commit(
				[
					{
						type: "document.change",
						id: baseId,
						content: {
							kind: "delta",
							version: 1,
							ops: [["s", ["text"], `${SENTINEL}-delta`]],
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			await opened.commit(
				[{ type: "conversation", value: { id: child } }],
				BACKGROUND_CONTEXT,
			);
			await opened.commit(
				[
					{
						type: "document.copy",
						record: {
							...record,
							id: copyId,
							scope: { kind: "conversation", conversationId: child },
						},
						source: { id: baseId, at: "current" },
					},
				],
				BACKGROUND_CONTEXT,
			);
			const raw = [
				...storage.sql
					.exec<{ value: string }>("SELECT record AS value FROM conversations")
					.toArray(),
				...storage.sql
					.exec<{ value: string }>("SELECT record AS value FROM entries")
					.toArray(),
				...storage.sql
					.exec<{ value: string }>("SELECT record AS value FROM tasks")
					.toArray(),
				...storage.sql
					.exec<{ value: string }>("SELECT record AS value FROM submissions")
					.toArray(),
				...storage.sql
					.exec<{ value: string }>("SELECT record AS value FROM documents")
					.toArray(),
				...storage.sql
					.exec<{ value: string }>(
						"SELECT content AS value FROM document_revisions",
					)
					.toArray(),
			]
				.map((row) => row.value)
				.join("\n");
			expect(raw).not.toContain(SENTINEL);
			expect(raw).toContain("aes-256-gcm");
			expect(
				(await opened.document(copyId, "current", BACKGROUND_CONTEXT))?.value,
			).toEqual({ text: `${SENTINEL}-delta` });
			await opened.close(BACKGROUND_CONTEXT);
		});
	});

	it("fails closed when revision version or kind is changed", async () => {
		await withDo("revision-version", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			const id = await opened.mintId<DocumentId>();
			await opened.commit(
				[
					{
						type: "document.create",
						record: { id, kind: "app.note", scope: { kind: "session" } },
						content: {
							kind: "base",
							version: 1,
							value: { text: "synthetic-v1" },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			const honest = await opened.document(id, "current", BACKGROUND_CONTEXT);
			expect(honest?.version).toBe(1);
			expect(honest?.value).toEqual({ text: "synthetic-v1" });
			await opened.close(BACKGROUND_CONTEXT);
			storage.sql.exec(
				"UPDATE document_revisions SET version = 99 WHERE document_id = ?",
				id,
			);
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/integrity/,
			);
			storage.sql.exec(
				"UPDATE document_revisions SET version = 1, kind = 'delta' WHERE document_id = ?",
				id,
			);
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/integrity/,
			);
		});
	});

	it("fails closed when indexed routing no longer matches the authenticated record", async () => {
		await withDo("indexed-routing", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			const root = ROOT_CONVERSATION_ID;
			const entryId = await opened.mintId<EntryId>();
			const taskId = await opened.mintId<TaskId<JsonValue>>();
			const submissionId = await opened.mintId<SubmissionId>();
			const documentId = await opened.mintId<DocumentId>();
			await opened.commit(
				[
					{
						type: "conversation",
						value: {
							id: root,
							owner: { conversationId: root, taskId },
						},
					},
					note(entryId, "synthetic-history"),
					{
						type: "task",
						value: {
							id: taskId,
							conversationId: root,
							kind: "pi.tool",
							version: 1,
							background: false,
							abortRequested: false,
							input: { args: "synthetic" },
							state: { status: "running", checkpoint: { phase: "execute" } },
						},
					},
					{
						type: "submission",
						value: {
							id: submissionId,
							conversationId: root,
							type: "input",
							status: "queued",
							requestId: "synthetic-request",
						},
					},
					{
						type: "document.create",
						record: {
							id: documentId,
							kind: "app.note",
							scope: { kind: "conversation", conversationId: root },
							history: "rewindable",
							fork: "current",
						},
						content: { kind: "base", version: 1, value: { text: "kept" } },
					},
				],
				BACKGROUND_CONTEXT,
			);
			storage.sql.exec(
				"UPDATE entries SET conversation_id = 999 WHERE id = ?",
				entryId,
			);
			await expect(
				opened.scanEntries(
					{ conversationId: root },
					20,
					undefined,
					BACKGROUND_CONTEXT,
				),
			).rejects.toThrow(/integrity/);
			storage.sql.exec(
				"UPDATE entries SET conversation_id = ? WHERE id = ?",
				root,
				entryId,
			);
			storage.sql.exec(
				"UPDATE entries SET commit_seq = 99 WHERE id = ?",
				entryId,
			);
			await expect(opened.entry(entryId, BACKGROUND_CONTEXT)).rejects.toThrow(
				/integrity/,
			);
			storage.sql.exec(
				"UPDATE entries SET commit_seq = 1, head = 99 WHERE id = ?",
				entryId,
			);
			await expect(opened.entry(entryId, BACKGROUND_CONTEXT)).rejects.toThrow(
				/integrity/,
			);
			storage.sql.exec(
				"UPDATE entries SET head = NULL, commit_seq = 1 WHERE id = ?",
				entryId,
			);
			storage.sql.exec(
				"UPDATE conversations SET owner_task_id = 999 WHERE id = ?",
				root,
			);
			await expect(
				opened.conversation(root, BACKGROUND_CONTEXT),
			).rejects.toThrow(/integrity/);
			storage.sql.exec(
				"UPDATE conversations SET owner_task_id = ? WHERE id = ?",
				taskId,
				root,
			);
			storage.sql.exec(
				"UPDATE tasks SET status = 'terminal', background = 1 WHERE id = ?",
				taskId,
			);
			await expect(opened.task(taskId, BACKGROUND_CONTEXT)).rejects.toThrow(
				/integrity/,
			);
			storage.sql.exec(
				"UPDATE tasks SET status = 'running', background = 0 WHERE id = ?",
				taskId,
			);
			storage.sql.exec(
				"UPDATE submissions SET request_id = NULL, status = 'done' WHERE id = ?",
				submissionId,
			);
			await expect(
				opened.submission(submissionId, BACKGROUND_CONTEXT),
			).rejects.toThrow(/integrity/);
			storage.sql.exec(
				"UPDATE submissions SET status = 'queued', request_id = ? WHERE id = ?",
				JSON.stringify("synthetic-request"),
				submissionId,
			);
			storage.sql.exec(
				"UPDATE documents SET retired_at = 1 WHERE id = ?",
				documentId,
			);
			await expect(
				opened.document(documentId, "current", BACKGROUND_CONTEXT),
			).rejects.toThrow(/integrity/);
			await opened.close(BACKGROUND_CONTEXT);
		});
	});
});

describe("authenticated durable counters", () => {
	function counters(storage: DurableObjectStorage) {
		return storage.sql
			.exec<{
				next_id: string;
				next_seq: number;
				counter_record: string;
			}>("SELECT next_id, next_seq, counter_record FROM durable_metadata")
			.one();
	}

	it("denies a regressed sequence before it can authenticate new history", async () => {
		await withDo("counter-regressed-seq", async (storage, keys) => {
			const first = await EncryptedPiStorage.open(storage, keys);
			await first.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			const id = await first.mintId<EntryId>();
			const before = await first.commit(
				[note(id, "before")],
				BACKGROUND_CONTEXT,
			);
			await first.close(BACKGROUND_CONTEXT);
			storage.sql.exec("UPDATE durable_metadata SET next_seq = 1");
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/integrity/,
			);
			expect(before).toBeGreaterThan(1);
		});
	});

	it("denies a regressed id before mint can overwrite a retained task", async () => {
		await withDo("counter-regressed-id", async (storage, keys) => {
			const first = await EncryptedPiStorage.open(storage, keys);
			const task = await first.mintId<TaskId<JsonValue>>();
			await first.commit(
				[
					{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
					{
						type: "task",
						value: {
							id: task,
							conversationId: ROOT_CONVERSATION_ID,
							kind: "pi.tool",
							version: 1,
							background: false,
							abortRequested: false,
							input: { original: true },
							state: {
								status: "running",
								checkpoint: { phase: "execute", original: true },
							},
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			await first.close(BACKGROUND_CONTEXT);
			storage.sql.exec("UPDATE durable_metadata SET next_id = ?", String(task));
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/integrity/,
			);
		});
	});

	it("denies live counter corruption on read, mint, and commit", async () => {
		await withDo("counter-live", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			storage.sql.exec("UPDATE durable_metadata SET next_seq = 50");
			await expect(
				opened.conversation(ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT),
			).rejects.toThrow(/integrity/);
			await expect(opened.mintId()).rejects.toThrow(/integrity/);
			await expect(opened.commit([], BACKGROUND_CONTEXT)).rejects.toThrow(
				/integrity/,
			);
			await opened.close(BACKGROUND_CONTEXT);
		});
	});

	it("denies a counter envelope that no longer matches its columns", async () => {
		await withDo("counter-envelope-mismatch", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			const first = counters(storage);
			await opened.commit([], BACKGROUND_CONTEXT);
			const second = counters(storage);
			expect(second.counter_record).not.toBe(first.counter_record);
			await opened.close(BACKGROUND_CONTEXT);
			storage.sql.exec(
				"UPDATE durable_metadata SET counter_record = ?",
				first.counter_record,
			);
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/integrity/,
			);
			storage.sql.exec(
				"UPDATE durable_metadata SET counter_record = ?, next_seq = ?",
				second.counter_record,
				first.next_seq,
			);
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/integrity/,
			);
		});
	});

	it("rejects malformed, negative, noncanonical, and unsafe counter values", async () => {
		const cases = [
			["negative", "UPDATE durable_metadata SET next_seq = -1"],
			["zero", "UPDATE durable_metadata SET next_seq = 0"],
			["noncanonical", "UPDATE durable_metadata SET next_id = '02'"],
			["decimal", "UPDATE durable_metadata SET next_id = '2.0'"],
			["blank", "UPDATE durable_metadata SET next_id = ''"],
			["unsafe", "UPDATE durable_metadata SET next_id = '9007199254740993'"],
			[
				"missing-auth",
				'UPDATE durable_metadata SET counter_record = \'{"kind":"unauthenticated-counter"}\'',
			],
		] as const;
		for (const [name, sql] of cases) {
			await withDo(`counter-${name}`, async (storage, keys) => {
				const opened = await EncryptedPiStorage.open(storage, keys);
				await opened.close(BACKGROUND_CONTEXT);
				storage.sql.exec(sql);
				await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
					/integrity/,
				);
			});
		}
		await withDo("counter-old-format", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			await opened.close(BACKGROUND_CONTEXT);
			storage.sql.exec(
				"UPDATE ditto_storage_meta SET format_version = 2, adapter_compat = 'ditto-encrypted-storage-2'",
			);
			await expect(EncryptedPiStorage.open(storage, keys)).rejects.toThrow(
				/Incompatible encrypted storage/,
			);
		});
	});

	it("does not authenticate a counter mutated while encryption is in flight", async () => {
		await withDo("counter-mutate-during-crypto", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			const before = counters(storage);
			const id = await opened.mintId<EntryId>();
			const original: unknown = Reflect.get(opened, "encodeText");
			if (typeof original !== "function")
				throw new Error("Missing encryption seam");
			let mutated = false;
			Reflect.set(
				opened,
				"encodeText",
				async (plain: string, recordId: string) => {
					const sealed = await original.call(opened, plain, recordId);
					if (!mutated && recordId.startsWith("durable_metadata/counters/")) {
						mutated = true;
						storage.sql.exec("UPDATE durable_metadata SET next_seq = 1");
					}
					return sealed;
				},
			);
			await expect(
				opened.commit([note(id, "during")], BACKGROUND_CONTEXT),
			).rejects.toThrow(/integrity/);
			expect(mutated).toBe(true);
			expect(storage.sql.exec("SELECT id FROM entries").toArray()).toHaveLength(
				0,
			);
			expect(counters(storage).counter_record).toBe(before.counter_record);
			await opened.close(BACKGROUND_CONTEXT);
		});
	});

	it("keeps honest id gaps, uncommitted mints, empty commits, and task-only sequences", async () => {
		await withDo("counter-gaps", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			const burned = await opened.mintId<EntryId>();
			await opened.close(BACKGROUND_CONTEXT);
			const reopened = await EncryptedPiStorage.open(storage, keys);
			expect(await reopened.mintId<EntryId>()).toBe(burned);
			const kept = await reopened.mintId<EntryId>();
			const task = await reopened.mintId<TaskId<JsonValue>>();
			const taskSeq = await reopened.commit(
				[
					{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
					{
						type: "task",
						value: {
							id: task,
							conversationId: ROOT_CONVERSATION_ID,
							kind: "pi.tool",
							version: 1,
							background: false,
							abortRequested: false,
							input: { gap: true },
							state: { status: "running", checkpoint: { phase: "execute" } },
						},
					},
				],
				BACKGROUND_CONTEXT,
			);
			const emptySeq = await reopened.commit([], BACKGROUND_CONTEXT);
			expect(emptySeq).toBeGreaterThan(taskSeq);
			expect(storage.sql.exec("SELECT id FROM entries").toArray()).toHaveLength(
				0,
			);
			await reopened.close(BACKGROUND_CONTEXT);
			const again = await EncryptedPiStorage.open(storage, keys);
			const minted = await again.mintId<EntryId>();
			expect(minted).not.toBe(kept);
			expect(minted).not.toBe(task);
			expect(minted).toBeGreaterThan(task);
			storage.sql.exec("UPDATE durable_metadata SET next_seq = ?", taskSeq);
			await expect(
				again.conversation(ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT),
			).rejects.toThrow(/integrity/);
			await again.close(BACKGROUND_CONTEXT);
		});
	});

	it("rolls back the authenticated counter with records and id claims", async () => {
		await withDo("counter-sql-rollback", async (storage, keys) => {
			const opened = await EncryptedPiStorage.open(storage, keys);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				BACKGROUND_CONTEXT,
			);
			const before = counters(storage);
			storage.sql.exec(
				"CREATE UNIQUE INDEX counter_fault_index ON entries (conversation_id)",
			);
			const ids = [
				await opened.mintId<EntryId>(),
				await opened.mintId<EntryId>(),
			];
			await expect(
				opened.commit(
					ids.map((id) => note(id, "synthetic")),
					BACKGROUND_CONTEXT,
				),
			).rejects.toThrow();
			expect(storage.sql.exec("SELECT id FROM entries").toArray()).toHaveLength(
				0,
			);
			expect(
				storage.sql
					.exec("SELECT id FROM record_ids WHERE record_type = 'entry'")
					.toArray(),
			).toHaveLength(0);
			expect(counters(storage)).toEqual(before);
			await opened.close(BACKGROUND_CONTEXT);
			const reopened = await EncryptedPiStorage.open(storage, keys);
			expect(await reopened.entry(ids[0], BACKGROUND_CONTEXT)).toBeUndefined();
			expect(counters(storage)).toEqual(before);
			await reopened.close(BACKGROUND_CONTEXT);
		});
	});
});
