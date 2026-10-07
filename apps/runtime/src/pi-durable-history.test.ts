import { env, runInDurableObject } from "cloudflare:test";
import type { JsonValue } from "@earendil-works/chord";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type ConversationId,
	createRegistry,
	type DocumentId,
	defineExtension,
	defineTool,
	type EntryId,
	Harness,
	ROOT_CONVERSATION_ID,
	type StorageWrite,
	type SubmissionId,
	type TaskId,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { HOST_PRIVATE_PLAINTEXT_BYTES, sealHostField } from "./host-private.ts";
import type { PiDurableHostFixture } from "./pi-durable-host.ts";
import {
	EncryptedPiStorage,
	type EncryptedStorageOpenOptions,
	STORAGE_ROW_BYTES,
} from "./pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "./runtime-crypto.ts";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		PI_HOST_STORAGE: DurableObjectNamespace<PiDurableHostFixture>;
	}
}
const context = BACKGROUND_CONTEXT;
const sentinel = "005-private-sentinel";
const large = `${sentinel} 🧩 `.repeat(3000);
async function keys(rotated = false) {
	return {
		ownerId: "owner-005",
		workspaceSessionId: "session-005",
		keyring: await importRuntimeKeyringFromBytes(rotated ? "v2" : "v1", {
			v1: new Uint8Array(32).fill(5),
			...(rotated ? { v2: new Uint8Array(32).fill(6) } : {}),
		}),
	};
}
async function fixture(
	name: string,
	run: (
		storage: DurableObjectStorage,
		opened: EncryptedPiStorage,
	) => Promise<void>,
	options: EncryptedStorageOpenOptions = {},
) {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(`history-${name}`),
		async (_instance, state) => {
			const opened = await EncryptedPiStorage.open(
				state.storage,
				await keys(),
				options,
			);
			try {
				await run(state.storage, opened);
			} finally {
				await opened.close(context);
			}
		},
	);
}
it.each([
	["record", { maxRecordBytes: 1 }],
	["backing", { maxBackingBytes: 4096 }],
	[
		"split-backing",
		{ inlineMaxBytes: 1, chunkBytes: 8, maxBackingBytes: 8192 },
	],
] as const)("initial %s size denial leaves fresh storage usable", async (name, options) => {
	await runInDurableObject(
		env.PI_HOST_STORAGE.getByName(`history-initial-denial-${name}`),
		async (_instance, state) => {
			const binding = await keys();
			await expect(
				EncryptedPiStorage.open(state.storage, binding, options),
			).rejects.toThrow(/size limit/);
			expect(
				state.storage.sql
					.exec(
						"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf%'",
					)
					.toArray(),
			).toEqual([]);
			const opened = await EncryptedPiStorage.open(state.storage, binding);
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			await opened.close(context);
			const reopened = await EncryptedPiStorage.open(state.storage, binding);
			expect(
				await reopened.conversation(ROOT_CONVERSATION_ID, context),
			).toEqual({ id: ROOT_CONVERSATION_ID });
			await reopened.close(context);
		},
	);
});

it.each([
	["small", { maxRecordBytes: 256, maxBackingBytes: 14_000 }],
	[
		"split",
		{
			inlineMaxBytes: 1,
			chunkBytes: 8,
			maxRecordBytes: 256,
			maxBackingBytes: 200_000,
		},
	],
] as const)("honest %s limits initialize and retain authenticated counters", async (name, options) => {
	await fixture(
		`initial-${name}`,
		async (storage, opened) => {
			const initial = storage.sql
				.exec<{ counter_record: string }>(
					"SELECT counter_record FROM durable_metadata",
				)
				.one().counter_record;
			if (name === "split") {
				expect(JSON.parse(initial).kind).toBe("split");
				expect(await opened.enumerateCommittedReferences()).toHaveLength(1);
			}
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			await opened.close(context);
			const reopened = await EncryptedPiStorage.open(
				storage,
				await keys(),
				options,
			);
			expect(
				await reopened.conversation(ROOT_CONVERSATION_ID, context),
			).toEqual({ id: ROOT_CONVERSATION_ID });
			await reopened.close(context);
		},
		options,
	);
});

function note(id: EntryId, text: string): StorageWrite {
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
function rawPrivate(storage: DurableObjectStorage) {
	return [
		"conversations",
		"entries",
		"tasks",
		"submissions",
		"documents",
		"document_revisions",
		"private_chunks",
		"durable_metadata",
	].flatMap((table) => storage.sql.exec(`SELECT * FROM ${table}`).toArray());
}
function assertPrivate(storage: DurableObjectStorage) {
	const raw = JSON.stringify(rawPrivate(storage));
	expect(raw).not.toContain(sentinel);
	for (const [table, column] of [
		["entries", "record"],
		["tasks", "record"],
		["document_revisions", "content"],
		["private_chunks", "content"],
	]) {
		const largest = storage.sql
			.exec<{ n: number }>(
				`SELECT COALESCE(MAX(length(CAST(${column} AS BLOB))),0) AS n FROM ${table}`,
			)
			.one().n;
		expect(largest).toBeLessThanOrEqual(STORAGE_ROW_BYTES);
	}
}

describe("exact bounded encrypted history", () => {
	it("materializes bases, deltas, version boundaries, copies, retirement and scans at committed positions", async () => {
		await fixture("positions", async (storage, opened) => {
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			const id = await opened.mintId<DocumentId>();
			const record = {
				id,
				kind: "history",
				scope: {
					kind: "conversation" as const,
					conversationId: ROOT_CONVERSATION_ID,
				},
				history: "rewindable" as const,
				fork: "asOf" as const,
			};
			const first = await opened.commit(
				[
					{
						type: "document.create",
						record,
						content: {
							kind: "base",
							version: 1,
							value: { text: large, count: 0 },
						},
					},
				],
				context,
			);
			const second = await opened.commit(
				[
					{
						type: "document.change",
						id,
						content: { kind: "delta", version: 1, ops: [["s", ["count"], 1]] },
					},
				],
				context,
			);
			const third = await opened.commit(
				[
					{
						type: "document.change",
						id,
						content: {
							kind: "base",
							version: 2,
							value: { text: large, count: 2 },
						},
					},
				],
				context,
			);
			const child = await opened.mintId<ConversationId>();
			await opened.commit(
				[{ type: "conversation", value: { id: child } }],
				context,
			);
			const copied = await opened.mintId<DocumentId>();
			await opened.commit(
				[
					{
						type: "document.copy",
						record: {
							...record,
							id: copied,
							scope: { kind: "conversation", conversationId: child },
						},
						source: { id, at: second },
					},
				],
				context,
			);
			expect((await opened.document(id, first, context))?.value).toEqual({
				text: large,
				count: 0,
			});
			expect(await opened.document(id, second, context)).toMatchObject({
				version: 1,
				deltasSinceBase: 1,
				value: { text: large, count: 1 },
			});
			expect(await opened.document(id, third, context)).toMatchObject({
				version: 2,
				deltasSinceBase: 0,
				value: { text: large, count: 2 },
			});
			expect(
				(await opened.document(copied, "current", context))?.value,
			).toEqual({ text: large, count: 1 });
			const retired = await opened.commit(
				[{ type: "document.retire", id }],
				context,
			);
			expect(await opened.document(id, retired, context)).toBeUndefined();
			expect(
				(
					await opened.scanDocuments(
						{ scope: record.scope, at: second },
						1,
						undefined,
						context,
					)
				).items.map((item) => item.id),
			).toEqual([id]);
			expect((await opened.findDocument(record, second, context))?.id).toBe(id);
			const refs = await opened.enumerateCommittedReferences();
			expect(
				refs.some((ref) =>
					ref.recordId.startsWith(`document_revisions/${id}/${first}`),
				),
			).toBe(true);
			assertPrivate(storage);
			await opened.close(context);
			const reopened = await EncryptedPiStorage.open(storage, await keys(true));
			expect((await reopened.document(id, second, context))?.value).toEqual({
				text: large,
				count: 1,
			});
			await reopened.close(context);
		});
	});

	it("roundtrips large task input, checkpoint, memos, image data, tool result and queued submission exactly", async () => {
		await fixture("record-families", async (storage, opened) => {
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			const taskId = await opened.mintId<TaskId<JsonValue>>();
			const entryId = await opened.mintId<EntryId>();
			const submissionId = await opened.mintId<SubmissionId>();
			const task = {
				id: taskId,
				conversationId: ROOT_CONVERSATION_ID,
				kind: "synthetic",
				version: 1,
				input: { text: large },
				background: false,
				abortRequested: false,
				memos: { private: large },
				state: {
					status: "waiting" as const,
					checkpoint: {
						phase: "prepared",
						request: {
							metadata: { private: large },
							ids: [entryId],
							arguments: { private: large },
						},
					},
					on: [],
					policy: "allSettled" as const,
				},
			};
			const entry = {
				id: entryId,
				conversationId: ROOT_CONVERSATION_ID,
				kind: "result",
				data: { detail: large },
				model: [
					{
						role: "user" as const,
						content: [
							{
								type: "image" as const,
								data: btoa(sentinel.repeat(6000)),
								mimeType: "image/png",
							},
						],
						timestamp: 17,
					},
				],
			};
			const submission = {
				id: submissionId,
				conversationId: ROOT_CONVERSATION_ID,
				requestId: "queue",
				type: "input" as const,
				status: "queued" as const,
			};
			await opened.commit(
				[
					{ type: "task", value: task },
					{ type: "entry", value: entry },
					{ type: "submission", value: submission },
				],
				context,
			);
			assertPrivate(storage);
			await opened.close(context);
			const reopened = await EncryptedPiStorage.open(storage, await keys(true));
			expect(await reopened.task(taskId, context)).toEqual(task);
			expect((await reopened.entry(entryId, context))?.entry).toEqual(entry);
			expect(
				await reopened.submissionByRequest(
					ROOT_CONVERSATION_ID,
					"queue",
					context,
				),
			).toEqual(submission);
			expect(
				(await reopened.scanTasks({ status: "waiting" }, 1, undefined, context))
					.items,
			).toEqual([task]);
			await reopened.close(context);
		});
	});

	it.each([
		"before-chunks",
		"between-chunks",
		"before-metadata",
		"metadata-lost-ack",
	] as const)("handles %s without authoritative partial references or rewinding safety", async (point) => {
		await fixture(
			point,
			async (storage, opened) => {
				await opened.commit(
					[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
					context,
				);
				storage.sql.exec("CREATE TABLE safety_005 (epoch INTEGER)");
				storage.sql.exec("INSERT INTO safety_005 VALUES (9)");
				const id = await opened.mintId<EntryId>();
				const original = storage.sql.exec.bind(storage.sql);
				let chunkCount = 0;
				storage.sql.exec = ((sql: string, ...params: SqlStorageValue[]) => {
					if (sql.startsWith("INSERT INTO private_chunks")) {
						chunkCount++;
						if (
							point === "before-chunks" ||
							(point === "between-chunks" && chunkCount === 2)
						)
							throw new Error("Synthetic chunk failure");
					}
					if (
						point === "before-metadata" &&
						sql.startsWith("INSERT INTO entries")
					)
						throw new Error("Synthetic metadata failure");
					return original(sql, ...params);
				}) as typeof storage.sql.exec;
				try {
					if (point === "metadata-lost-ack") {
						await expect(
							(async () => {
								await opened.commit([note(id, large)], context);
								throw new Error("Synthetic committed acknowledgment lost");
							})(),
						).rejects.toThrow(/acknowledgment lost/);
					} else
						await expect(
							opened.commit([note(id, large)], context),
						).rejects.toThrow(/Synthetic/);
				} finally {
					storage.sql.exec = original;
				}
				expect(
					storage.sql
						.exec<{ epoch: number }>("SELECT epoch FROM safety_005")
						.one().epoch,
				).toBe(9);
				await opened.close(context);
				const reopened = await EncryptedPiStorage.open(storage, await keys());
				if (point === "metadata-lost-ack")
					expect((await reopened.entry(id, context))?.entry.data).toEqual({
						text: large,
					});
				else {
					expect(await reopened.entry(id, context)).toBeUndefined();
					expect(await reopened.enumerateCommittedReferences()).toEqual([]);
				}
				await reopened.close(context);
			},
			{ inlineMaxBytes: 1024 },
		);
	});

	it("rejects content changed after verification but before its reference commit", async () => {
		await fixture("changed-prepared-content", async (storage, opened) => {
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			const id = await opened.mintId<EntryId>();
			const original: unknown = Reflect.get(opened, "encodeText");
			if (typeof original !== "function")
				throw new Error("Missing encryption seam");
			Reflect.set(
				opened,
				"encodeText",
				async (plaintext: string, recordId: string) => {
					const encoded: string = await original.call(
						opened,
						plaintext,
						recordId,
					);
					if (recordId.startsWith(`entries/${id}/`))
						storage.sql.exec("DELETE FROM private_chunks WHERE ordinal = 0");
					return encoded;
				},
			);
			await expect(opened.commit([note(id, large)], context)).rejects.toThrow(
				/integrity/,
			);
			expect(await opened.entry(id, context)).toBeUndefined();
			expect(await opened.enumerateCommittedReferences()).toEqual([]);
		});
	});

	it.each([
		"missing",
		"corrupt",
		"wrong-record",
		"unknown-key",
	] as const)("blocks referenced %s chunks before recovery", async (fault) => {
		await fixture(`bad-${fault}`, async (storage, opened) => {
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			const id = await opened.mintId<EntryId>();
			await opened.commit([note(id, large)], context);
			await opened.close(context);
			const chunk = storage.sql
				.exec<{ write_id: string; ordinal: number; content: string }>(
					"SELECT * FROM private_chunks ORDER BY ordinal LIMIT 1",
				)
				.one();
			if (fault === "missing")
				storage.sql.exec(
					"DELETE FROM private_chunks WHERE write_id = ? AND ordinal = ?",
					chunk.write_id,
					chunk.ordinal,
				);
			else if (fault === "wrong-record")
				storage.sql.exec(
					"UPDATE private_chunks SET record_id = 'wrong' WHERE write_id = ?",
					chunk.write_id,
				);
			else {
				const envelope = JSON.parse(chunk.content) as {
					ciphertext: string;
					keyVersion: string;
				};
				if (fault === "unknown-key") envelope.keyVersion = "not-retained";
				else
					envelope.ciphertext = `${envelope.ciphertext.startsWith("A") ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
				storage.sql.exec(
					"UPDATE private_chunks SET content = ? WHERE write_id = ? AND ordinal = ?",
					JSON.stringify(envelope),
					chunk.write_id,
					chunk.ordinal,
				);
			}
			await expect(
				EncryptedPiStorage.open(storage, await keys()),
			).rejects.toThrow(/integrity|chunk/);
		});
	});

	it("rolls back a mixed document/task/entry commit after complete SQL application, leaving only unreachable prepared chunks", async () => {
		await fixture("mixed-rollback", async (storage, opened) => {
			await opened.commit(
				[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
				context,
			);
			const doc = await opened.mintId<DocumentId>();
			await opened.commit(
				[
					{
						type: "document.create",
						record: { id: doc, kind: "mixed", scope: { kind: "session" } },
						content: { kind: "base", version: 1, value: { text: "original" } },
					},
				],
				context,
			);
			const id = await opened.mintId<EntryId>();
			const taskId = await opened.mintId<TaskId<JsonValue>>();
			const task = {
				id: taskId,
				conversationId: ROOT_CONVERSATION_ID,
				kind: "mixed",
				version: 1,
				input: large,
				background: false,
				abortRequested: false,
				state: {
					status: "pending" as const,
					checkpoint: { phase: "prepared", private: large },
				},
			};
			const original = storage.transactionSync.bind(storage);
			storage.transactionSync = ((callback: () => unknown) =>
				original(() => {
					callback();
					expect(
						storage.sql
							.exec("SELECT id FROM entries WHERE id = ?", id)
							.toArray(),
					).toHaveLength(1);
					throw new Error("Synthetic complete apply rejection");
				})) as typeof storage.transactionSync;
			try {
				await expect(
					opened.commit(
						[
							note(id, large),
							{ type: "task", value: task },
							{
								type: "document.change",
								id: doc,
								content: { kind: "base", version: 1, value: { text: large } },
							},
						],
						context,
					),
				).rejects.toThrow(/complete apply/);
			} finally {
				storage.transactionSync = original;
			}
			expect(await opened.entry(id, context)).toBeUndefined();
			expect((await opened.document(doc, "current", context))?.value).toEqual({
				text: "original",
			});
			expect(await opened.task(taskId, context)).toBeUndefined();
			expect(await opened.enumerateCommittedReferences()).toEqual([]);
		});
	});

	it("denies record, depth, write-count and host-field ceilings without accepting work", async () => {
		await fixture(
			"bounds",
			async (storage, opened) => {
				await opened.commit(
					[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
					context,
				);
				const id = await opened.mintId<EntryId>();
				const before = JSON.stringify(rawPrivate(storage));
				await expect(
					opened.commit([note(id, "x".repeat(1100))], context),
				).rejects.toThrow(/size limit/);
				const deep: Record<string, JsonValue> = { leaf: "private" };
				let value: JsonValue = deep;
				for (let i = 0; i < 10; i++) value = { child: value };
				await expect(
					opened.commit(
						[
							{
								type: "entry",
								value: {
									id,
									conversationId: ROOT_CONVERSATION_ID,
									kind: "note",
									data: value,
								},
							},
						],
						context,
					),
				).rejects.toThrow(/size limit/);
				await expect(
					opened.commit(
						[note(id, "ok"), note(id, "ok"), note(id, "ok")],
						context,
					),
				).rejects.toThrow(/size limit/);
				expect(JSON.stringify(rawPrivate(storage))).toBe(before);
				await expect(
					sealHostField(
						await keys(),
						"host-input",
						"x".repeat(HOST_PRIVATE_PLAINTEXT_BYTES + 1),
					),
				).rejects.toThrow(/size_limit/);
			},
			{ maxRecordBytes: 1024, maxDepth: 8, maxWrites: 2 },
		);
	});

	it("rejects oversized input through actual Harness submission before provider effects", async () => {
		await fixture(
			"before-effects",
			async (_storage, opened) => {
				const faux = fauxProvider({ tokensPerSecond: 0 });
				const models = createModels({
					authContext: {
						env: async () => undefined,
						fileExists: async () => false,
					},
				});
				models.setProvider(faux.provider);
				const harness = await Harness.open(
					opened,
					{
						models,
						registry: createRegistry(),
						settings: {
							retry: { enabled: false },
							compaction: { enabled: false },
						},
					},
					context,
				);
				const root = await harness.root(context);
				await root.configure(
					{
						model: {
							provider: faux.getModel().provider,
							modelId: faux.getModel().id,
						},
					},
					context,
				);
				await expect(
					root.submit(
						{
							type: "input",
							requestId: "too-large",
							content: "x".repeat(2048),
						},
						context,
					),
				).rejects.toThrow(/size limit/);
				expect(faux.state.callCount).toBe(0);
				expect(
					await opened.submissionByRequest(
						ROOT_CONVERSATION_ID,
						"too-large",
						context,
					),
				).toBeUndefined();
				await harness.close(context);
			},
			{ maxRecordBytes: 1024 },
		);
	});

	it("selects inline and split at exact serialized UTF-8 thresholds without changing content", async () => {
		await fixture(
			"inline-threshold",
			async (storage, opened) => {
				await opened.commit(
					[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
					context,
				);
				for (let n = -1; n <= 1; n++) {
					const id = await opened.mintId<EntryId>();
					const entry = {
						id,
						conversationId: ROOT_CONVERSATION_ID,
						kind: "note",
						data: { text: "" },
					};
					const overhead = new TextEncoder().encode(
						JSON.stringify({ commitSeq: 3 + n, entry }),
					).byteLength;
					entry.data.text = "x".repeat(256 + n - overhead);
					await opened.commit([{ type: "entry", value: entry }], context);
					const raw = JSON.parse(
						storage.sql
							.exec<{ record: string }>(
								"SELECT record FROM entries WHERE id = ?",
								id,
							)
							.one().record,
					) as { kind?: string };
					expect(raw.kind === "split").toBe(n === 1);
					expect((await opened.entry(id, context))?.entry).toEqual(entry);
				}
			},
			{ inlineMaxBytes: 256 },
		);
	});

	it.each([
		"nodes",
		"batch",
		"revision",
		"expanded-document",
		"backing",
	] as const)("denies the %s ceiling atomically", async (limit) => {
		const options: EncryptedStorageOpenOptions =
			limit === "nodes"
				? { maxNodes: 20 }
				: limit === "batch"
					? { maxRecordBytes: 1024, maxBatchBytes: 700 }
					: limit === "revision"
						? { maxRevisions: 2 }
						: limit === "backing"
							? { maxBackingBytes: 32 * 1024, inlineMaxBytes: 256 }
							: { maxRecordBytes: 1024 };
		await fixture(
			`ceiling-${limit}`,
			async (storage, opened) => {
				await opened.commit(
					[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
					context,
				);
				const id = await opened.mintId<EntryId>();
				let writes: StorageWrite[];
				if (limit === "nodes")
					writes = [
						{
							type: "entry",
							value: {
								id,
								conversationId: ROOT_CONVERSATION_ID,
								kind: "note",
								data: Array.from({ length: 30 }, () => "x"),
							},
						},
					];
				else if (limit === "batch")
					writes = [
						note(id, "x".repeat(400)),
						note(await opened.mintId<EntryId>(), "x".repeat(400)),
					];
				else if (limit === "backing") writes = [note(id, "x".repeat(40_000))];
				else {
					const doc = await opened.mintId<DocumentId>();
					await opened.commit(
						[
							{
								type: "document.create",
								record: { id: doc, kind: "bound", scope: { kind: "session" } },
								content: {
									kind: "base",
									version: 1,
									value:
										limit === "revision"
											? { count: 0 }
											: { first: "x".repeat(600) },
								},
							},
						],
						context,
					);
					if (limit === "revision")
						await opened.commit(
							[
								{
									type: "document.change",
									id: doc,
									content: {
										kind: "delta",
										version: 1,
										ops: [["s", ["count"], 1]],
									},
								},
							],
							context,
						);
					writes = [
						{
							type: "document.change",
							id: doc,
							content: {
								kind: "delta",
								version: 1,
								ops: [
									[
										"s",
										[limit === "revision" ? "count" : "second"],
										limit === "revision" ? 2 : "x".repeat(600),
									],
								],
							},
						},
					];
				}
				const counters = storage.sql
					.exec("SELECT * FROM durable_metadata")
					.one();
				await expect(opened.commit(writes, context)).rejects.toThrow(
					/size limit/,
				);
				expect(
					storage.sql.exec("SELECT * FROM durable_metadata").one(),
				).toEqual(counters);
				expect(await opened.entry(id, context)).toBeUndefined();
				await opened.close(context);
				const reopened = await EncryptedPiStorage.open(
					storage,
					await keys(),
					options,
				);
				await reopened.close(context);
			},
			options,
		);
	});

	it("reopens a compacted conversation with completed tools and queued followup and sends the exact next prepared provider request", async () => {
		await fixture("actual-next-request", async (storage, opened) => {
			const faux = fauxProvider({ tokensPerSecond: 0 });
			const models = createModels({
				authContext: {
					env: async () => undefined,
					fileExists: async () => false,
				},
			});
			models.setProvider(faux.provider);
			let executed = 0;
			const tool = defineTool({
				name: "history_tool",
				description: "Synthetic",
				parameters: Type.Object({ text: Type.String() }),
				replay: "unsafe",
				execute: async (args) => {
					executed++;
					return {
						content: [{ type: "text", text: args.text }],
						details: { private: large },
					};
				},
			});
			const extension = defineExtension({ name: "history-005", tools: [tool] });
			const registry = createRegistry();
			registry.install(extension);
			const options = {
				models,
				registry,
				settings: {
					extensions: [extension],
					retry: { enabled: false },
					compaction: {
						enabled: false,
						keepRecentTokens: 1,
						backgroundTokens: 0,
					},
					stream: {
						metadata: {
							private: `${sentinel}-metadata`,
							stableId: "prepared-original",
						},
					},
				},
			};
			faux.setResponses([
				fauxAssistantMessage(
					fauxToolCall(
						"history_tool",
						{ text: large },
						{ id: "completed-original-call" },
					),
					{
						stopReason: "toolUse",
						responseId: "provider-tool-id",
						timestamp: 11,
					},
				),
				fauxAssistantMessage("Completed answer", {
					responseId: "provider-answer-id",
					timestamp: 12,
				}),
				fauxAssistantMessage(`${sentinel}-compacted-summary`, {
					responseId: "provider-summary-id",
					timestamp: 13,
				}),
			]);
			let harness = await Harness.open(opened, options, context);
			let root = await harness.root(context);
			await root.configure(
				{
					model: {
						provider: faux.getModel().provider,
						modelId: faux.getModel().id,
					},
				},
				context,
			);
			const first = await root.submit(
				{ type: "input", requestId: "first", content: `${sentinel}-input` },
				context,
			);
			expect((await first.wait(context)).status).toBe("done");
			const originalHistory = (
				await opened.scanEntries(
					{ conversationId: root.id },
					100,
					undefined,
					context,
				)
			).items;
			expect(JSON.stringify(originalHistory)).toContain(
				"completed-original-call",
			);
			expect(JSON.stringify(originalHistory)).toContain("provider-tool-id");
			expect(JSON.stringify(originalHistory)).toContain("provider-answer-id");
			const compaction = await root.compact(undefined, context);
			await harness.waitForTask(compaction, context);
			await root.waitForIdle(context);
			expect((await root.context(context)).head).toBeDefined();
			let entered!: () => void;
			const started = new Promise<void>((resolve) => {
				entered = resolve;
			});
			let prepared: unknown;
			faux.setResponses([
				async (transcript, requestOptions, _state, model) => {
					const { signal, ...rest } = requestOptions ?? {};
					prepared = JSON.parse(
						JSON.stringify({ transcript, options: rest, model }),
					);
					entered();
					await awaitWithContext(
						new Promise<void>(() => {}),
						signal ? withAbortSignal(signal, context) : context,
					);
					return fauxAssistantMessage("unreachable");
				},
			]);
			const next = await root.submit(
				{ type: "input", requestId: "next", content: `${sentinel}-next` },
				context,
			);
			await started;
			const queued = await root.submit(
				{
					type: "input",
					requestId: "queued",
					content: `${sentinel}-queued`,
					whenBusy: "followUp",
				},
				context,
			);
			expect((await queued.status(context)).status).toBe("queued");
			const before = await root.context(context);
			await harness.close(context);
			assertPrivate(storage);
			const recovered = await EncryptedPiStorage.open(
				storage,
				await keys(true),
			);
			let actual: unknown;
			faux.setResponses([
				async (transcript, requestOptions, _state, model) => {
					const { signal: _signal, ...rest } = requestOptions ?? {};
					actual = JSON.parse(
						JSON.stringify({ transcript, options: rest, model }),
					);
					return fauxAssistantMessage("Recovered answer", {
						responseId: "recovered-answer",
						timestamp: 14,
					});
				},
				fauxAssistantMessage("Queued answer", { timestamp: 15 }),
			]);
			harness = await Harness.open(recovered, options, context);
			root = await harness.root(context);
			expect(await root.context(context)).toEqual(before);
			expect((await harness.inspect(context)).scheduling).toBe("paused");
			harness.resume();
			await root.waitForIdle(context);
			expect(actual).toEqual(prepared);
			for (const original of originalHistory)
				expect((await recovered.entry(original.id, context))?.entry).toEqual(
					original,
				);
			expect((await recovered.submission(next.id, context))?.status).toBe(
				"done",
			);
			expect((await recovered.submission(queued.id, context))?.status).toBe(
				"done",
			);
			expect(executed).toBe(1);
			await harness.close(context);
		});
	}, 30_000);
});
