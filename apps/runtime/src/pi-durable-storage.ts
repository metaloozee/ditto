import type { Context, JsonValue } from "@earendil-works/chord";
import { apply, type Op } from "@earendil-works/chord/delta";
import {
	type ConversationId,
	type ConversationQuery,
	type ConversationRecord,
	type Cursor,
	type DocumentAddress,
	type DocumentContent,
	type DocumentCopySource,
	type DocumentId,
	type DocumentPoint,
	type DocumentQuery,
	type DocumentRecord,
	type EntryId,
	type EntryQuery,
	type EntryRecord,
	type Id,
	type Page,
	type Seq,
	type Storage,
	StorageRejected,
	type StorageWrite,
	type StoredDocument,
	type SubmissionId,
	type SubmissionQuery,
	type SubmissionRecord,
	type TaskId,
	type TaskQuery,
	type TaskRecord,
} from "@earendil-works/pi-durable";
import type { RetainedStorageBinding } from "./host-private.ts";
import {
	decryptRuntimePayload,
	encryptRuntimePayload,
	parseRuntimeCiphertextV1,
	parseRuntimeManifest,
	RUNTIME_CRYPTO_FORMAT_VERSION,
	type RuntimeChunkManifestV1,
	serializeRuntimeCiphertext,
} from "./runtime-crypto.ts";

export type { RetainedStorageBinding } from "./host-private.ts";

export const ENCRYPTED_STORAGE_FORMAT = 4;
export const ENGINE_COMPAT = "pi-durable-1.0.1";
export const TASK_COMPAT = "pi-task-v1";
export const TOOL_COMPAT = "pi-tool-v1";
export const PROVIDER_COMPAT = "provider-request-v1";
export const ADAPTER_COMPAT = "ditto-encrypted-storage-4";
export const STORAGE_ROW_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;
const MAX_WRITES = 1024;
const MAX_REVISIONS = 4096;
const MAX_CHUNKS = 4096;
const MAX_BACKING_BYTES = 16 * 1024 * 1024;

type SplitReference = {
	kind: "split";
	manifest: Omit<RuntimeChunkManifestV1, "chunks">;
};
const COUNTER_PLACEHOLDER = '{"kind":"unauthenticated-counter"}';

export class EncryptedStorageError extends Error {
	constructor(
		readonly code:
			| "size_limit"
			| "incompatible"
			| "plaintext_retained"
			| "integrity"
			| "unresolved_external_ref"
			| "closed"
			| "expired_transaction",
		message: string,
	) {
		super(message);
		this.name = "EncryptedStorageError";
	}
}

type Sql = string | number | null;
type Row = Record<string, SqlStorageValue>;
type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
type Query = {
	exec(sql: string, ...params: Sql[]): void;
	get(sql: string, ...params: Sql[]): Row | undefined;
	all(sql: string, ...params: Sql[]): Row[];
};

type Statement = { sql: string; params: Sql[] };

type RevisionSnap = {
	seq: number;
	kind: string;
	version: number;
	content: string;
};

type DocumentSnap = {
	record: string | null;
	retiredAt: number | null;
	kind: string | null;
	scopeKind: string | null;
	ownerId: number | null;
	family: number | null;
	keyValue: string | null;
	revisions: RevisionSnap[];
};

type Snapshot = {
	nextId: string;
	nextSeq: number;
	counterRecord: string;
	records: Array<[number, string | null]>;
	documents: Array<[number, DocumentSnap]>;
	currents: Array<[string, number]>;
};

type ParsedCounters = { nextId: number; nextSeq: number };

function snapshotToken(snapshot: Snapshot): string {
	return JSON.stringify(snapshot);
}

function emptyDocumentSnap(): DocumentSnap {
	return {
		record: null,
		retiredAt: null,
		kind: null,
		scopeKind: null,
		ownerId: null,
		family: null,
		keyValue: null,
		revisions: [],
	};
}

function snapshotQuery(snapshot: Snapshot): Query {
	const records = new Map(snapshot.records);
	const documents = new Map(snapshot.documents);
	const currents = new Map(snapshot.currents);
	return {
		exec() {
			throw new Error("Snapshot query cannot write");
		},
		get(sql, ...params): Row | undefined {
			if (sql.includes("FROM record_ids")) {
				const type = records.get(Number(params[0]));
				return type == null ? undefined : { record_type: type };
			}
			if (sql.includes("FROM document_revisions")) {
				const last = documents.get(Number(params[0]))?.revisions.at(-1);
				return last === undefined ? undefined : { version: last.version };
			}
			if (sql.includes("retired_at IS NULL")) {
				const count = currents.get(JSON.stringify(params.slice(0, 5))) ?? 0;
				return count > 0 ? { id: 1 } : undefined;
			}
			if (sql.includes("FROM documents")) {
				const snap = documents.get(Number(params[0]));
				return snap?.record == null ? undefined : { record: snap.record };
			}
			throw new Error("Uncaptured snapshot query");
		},
		all() {
			throw new Error("Snapshot query cannot scan");
		},
	};
}

type DocumentCreate = Extract<
	StorageWrite,
	{ type: "document.create" }
>["record"];
type DocumentAction = {
	retire: boolean;
	create?: DocumentCreate;
	content?: DocumentContent;
	copy?: DocumentCopySource;
};

const SCHEMA = [
	`CREATE TABLE private_chunks (
		write_id TEXT NOT NULL,
		ordinal INTEGER NOT NULL,
		record_id TEXT NOT NULL,
		content TEXT NOT NULL CHECK (json_valid(content) AND length(CAST(content AS BLOB)) <= ${STORAGE_ROW_BYTES}),
		PRIMARY KEY (write_id, ordinal)
	) STRICT`,
	`CREATE TABLE durable_metadata (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		next_id TEXT NOT NULL,
		next_seq INTEGER NOT NULL,
		counter_record TEXT NOT NULL CHECK (json_valid(counter_record))
	) STRICT`,
	`INSERT INTO durable_metadata (singleton, next_id, next_seq, counter_record) VALUES (1, '2', 1, '${COUNTER_PLACEHOLDER}')`,
	`CREATE TABLE record_ids (
		id INTEGER PRIMARY KEY,
		record_type TEXT NOT NULL CHECK (record_type IN ('conversation', 'entry', 'task', 'submission', 'document'))
	) STRICT`,
	`CREATE TABLE conversations (
		id INTEGER PRIMARY KEY,
		owner_conversation_id INTEGER,
		owner_task_id INTEGER,
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
	"CREATE INDEX conversations_by_owner_conversation ON conversations (owner_conversation_id, id)",
	"CREATE INDEX conversations_by_owner_task ON conversations (owner_task_id, id)",
	`CREATE TABLE entries (
		id INTEGER PRIMARY KEY,
		conversation_id INTEGER NOT NULL,
		head INTEGER,
		commit_seq INTEGER NOT NULL,
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
	"CREATE INDEX entries_by_conversation ON entries (conversation_id, id DESC)",
	"CREATE INDEX entry_heads_by_conversation ON entries (conversation_id, id DESC) WHERE head IS NOT NULL",
	`CREATE TABLE tasks (
		id INTEGER PRIMARY KEY,
		conversation_id INTEGER NOT NULL,
		kind TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completing', 'terminal')),
		abort_requested INTEGER NOT NULL CHECK (abort_requested IN (0, 1)),
		background INTEGER NOT NULL CHECK (background IN (0, 1)),
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
	"CREATE INDEX tasks_by_status ON tasks (status, id)",
	"CREATE INDEX tasks_by_conversation ON tasks (conversation_id, id)",
	"CREATE INDEX tasks_by_kind ON tasks (kind, id)",
	"CREATE INDEX tasks_by_abort_requested ON tasks (abort_requested, id)",
	"CREATE INDEX tasks_by_background ON tasks (background, id)",
	`CREATE TABLE submissions (
		id INTEGER PRIMARY KEY,
		conversation_id INTEGER NOT NULL,
		request_id TEXT,
		status TEXT NOT NULL CHECK (status IN ('queued', 'placed', 'done', 'unanswered')),
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
	"CREATE INDEX submissions_by_request ON submissions (conversation_id, request_id)",
	"CREATE INDEX submissions_by_conversation ON submissions (conversation_id, id)",
	"CREATE INDEX submissions_by_status ON submissions (status, id)",
	`CREATE TABLE documents (
		id INTEGER PRIMARY KEY,
		kind TEXT NOT NULL,
		family INTEGER NOT NULL CHECK (family IN (0, 1)),
		key_value TEXT NOT NULL,
		scope_kind TEXT NOT NULL CHECK (scope_kind IN ('session', 'conversation', 'task')),
		owner_id INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		retired_at INTEGER,
		record TEXT NOT NULL CHECK (json_valid(record))
	) STRICT`,
	`CREATE INDEX documents_by_address
		ON documents (kind, scope_kind, owner_id, family, key_value, created_at DESC, retired_at)`,
	"CREATE INDEX documents_by_scope ON documents (scope_kind, owner_id, id)",
	"CREATE INDEX documents_by_scope_kind ON documents (scope_kind, owner_id, kind, id)",
	`CREATE TABLE document_revisions (
		document_id INTEGER NOT NULL,
		seq INTEGER NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('base', 'delta')),
		version INTEGER NOT NULL,
		content TEXT NOT NULL CHECK (json_valid(content)),
		PRIMARY KEY (document_id, seq)
	) STRICT`,
	"CREATE INDEX document_revisions_by_kind ON document_revisions (document_id, kind, seq DESC)",
	`CREATE TABLE ditto_storage_meta (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		format_version INTEGER NOT NULL,
		engine_compat TEXT NOT NULL,
		task_compat TEXT NOT NULL,
		tool_compat TEXT NOT NULL,
		provider_compat TEXT NOT NULL,
		adapter_compat TEXT NOT NULL
	) STRICT`,
	`INSERT INTO ditto_storage_meta (
		singleton, format_version, engine_compat, task_compat, tool_compat, provider_compat, adapter_compat
	) VALUES (1, ${ENCRYPTED_STORAGE_FORMAT}, '${ENGINE_COMPAT}', '${TASK_COMPAT}', '${TOOL_COMPAT}', '${PROVIDER_COMPAT}', '${ADAPTER_COMPAT}')`,
	`CREATE TABLE durable_schema (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		version INTEGER NOT NULL CHECK (version >= 0)
	) STRICT`,
	"INSERT INTO durable_schema (singleton, version) VALUES (1, 1)",
];

function idFromNumber<I extends Id<string>>(value: number): I {
	return value as I;
}

function seqFromNumber(value: number): Seq {
	return value as Seq;
}

function counterRecordId(nextId: number, nextSeq: number): string {
	return `durable_metadata/counters/${nextId}/${nextSeq}`;
}

function canonicalCounterPlaintext(nextId: number, nextSeq: number): string {
	return JSON.stringify({ nextId: String(nextId), nextSeq });
}

const EXHAUSTED_NEXT_ID = Number.MAX_SAFE_INTEGER + 1;

function parseCounterColumns(
	nextIdText: string,
	nextSeq: number,
): ParsedCounters {
	if (!/^[1-9][0-9]*$/.test(nextIdText))
		throw new EncryptedStorageError("integrity", "Storage integrity failure");
	const nextId =
		nextIdText === String(EXHAUSTED_NEXT_ID)
			? EXHAUSTED_NEXT_ID
			: Number(nextIdText);
	if (
		nextIdText !== String(nextId) ||
		(!Number.isSafeInteger(nextId) && nextId !== EXHAUSTED_NEXT_ID) ||
		nextId < 2 ||
		!Number.isSafeInteger(nextSeq) ||
		nextSeq < 1
	)
		throw new EncryptedStorageError("integrity", "Storage integrity failure");
	return { nextId, nextSeq };
}

function maxSql(db: Query, sql: string): number | null {
	const row = db.get(sql);
	if (row === undefined || row.n == null) return null;
	return integer(row, "n");
}

function encodeIndexedString(value: string): string {
	const encoded = JSON.stringify(value);
	if (new TextEncoder().encode(encoded).byteLength > 1024) sizeDenied();
	return encoded;
}

function cursorId(cursor: Cursor | undefined): number | undefined {
	const after = cursor?.after;
	if (after === undefined) return undefined;
	if (typeof after !== "number" || !Number.isSafeInteger(after))
		throw new TypeError("Invalid storage cursor");
	return after;
}

function page<T extends { id: number }>(
	values: T[],
	limit: number,
): Page<T, Cursor> {
	const items = values.slice(0, limit);
	if (values.length <= limit) return { items };
	const last = items.at(-1);
	if (!last) return { items };
	return { items, next: { after: last.id } };
}

function text(row: Row, key: string): string {
	const value = row[key];
	if (typeof value !== "string")
		throw new EncryptedStorageError("integrity", "Invalid storage row");
	return value;
}

function integer(row: Row, key: string): number {
	const value = row[key];
	if (typeof value !== "number" || !Number.isSafeInteger(value))
		throw new EncryptedStorageError("integrity", "Invalid storage row");
	return value;
}

function nullableInteger(row: Row, key: string): number | null {
	if (row[key] == null) return null;
	return integer(row, key);
}

function nullableText(row: Row, key: string): string | null {
	if (row[key] == null) return null;
	return text(row, key);
}

function scopeColumns(scope: DocumentRecord["scope"]): {
	scopeKind: string;
	ownerId: number;
} {
	switch (scope.kind) {
		case "session":
			return { scopeKind: "session", ownerId: 0 };
		case "conversation":
			return { scopeKind: "conversation", ownerId: scope.conversationId };
		case "task":
			return { scopeKind: "task", ownerId: scope.taskId };
	}
}

function addressParts(address: {
	kind: string;
	scope: DocumentRecord["scope"];
	key?: string;
}) {
	const scope = scopeColumns(address.scope);
	return {
		kind: encodeIndexedString(address.kind),
		...scope,
		family: address.key === undefined ? 0 : 1,
		keyValue: encodeIndexedString(address.key ?? ""),
	};
}

function addressKey(address: {
	kind: string;
	scope: DocumentRecord["scope"];
	key?: string;
}): string {
	const parts = addressParts(address);
	return JSON.stringify([
		parts.kind,
		parts.scopeKind,
		parts.ownerId,
		parts.family,
		parts.keyValue,
	]);
}

function isAliveAt(record: DocumentRecord, at: DocumentPoint): boolean {
	if (at === "current") return record.retiredAt === undefined;
	return (
		record.createdAt <= at &&
		(record.retiredAt === undefined || at < record.retiredAt)
	);
}

function isCurrentOnly(record: DocumentRecord): boolean {
	return record.scope.kind !== "conversation" || record.history === "latest";
}

function writeId(write: StorageWrite): number | undefined {
	switch (write.type) {
		case "conversation":
		case "entry":
		case "task":
		case "submission":
			return write.value.id;
		case "document.create":
		case "document.copy":
			return write.record.id;
		case "document.change":
		case "document.retire":
			return undefined;
	}
}

function isExternalRef(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"kind" in value &&
		value.kind === "external"
	);
}

function direct(storage: DurableObjectStorage): Query {
	return query(storage, () => true);
}

function query(storage: DurableObjectStorage, isActive: () => boolean): Query {
	function guard() {
		if (!isActive())
			throw new EncryptedStorageError(
				"expired_transaction",
				"Expired storage transaction",
			);
	}
	return {
		exec(sql, ...params) {
			guard();
			storage.sql.exec(sql, ...params);
		},
		get(sql, ...params) {
			guard();
			return storage.sql.exec<Row>(sql, ...params).toArray()[0];
		},
		all(sql, ...params) {
			guard();
			return storage.sql.exec<Row>(sql, ...params).toArray();
		},
	};
}

export type EncryptedStorageOpenOptions = {
	inlineMaxBytes?: number;
	chunkBytes?: number;
	maxRecordBytes?: number;
	maxBatchBytes?: number;
	maxNodes?: number;
	maxDepth?: number;
	maxWrites?: number;
	maxRevisions?: number;
	maxBackingBytes?: number;
};

function sizeDenied(): never {
	throw new EncryptedStorageError(
		"size_limit",
		"Private storage size limit exceeded",
	);
}

function ceiling(value: number | undefined, fallback: number): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || selected < 1 || selected > fallback)
		return sizeDenied();
	return selected;
}

function boundedJson(
	value: unknown,
	options: EncryptedStorageOpenOptions,
): string {
	const maxNodes = ceiling(options.maxNodes, MAX_NODES);
	const maxDepth = ceiling(options.maxDepth, MAX_DEPTH);
	const maxBytes = ceiling(options.maxRecordBytes, MAX_RECORD_BYTES);
	let stringBytes = 0;
	let nodes = 0;
	const ancestors = new Set<object>();
	function visit(current: unknown, depth: number): void {
		if (++nodes > maxNodes || depth > maxDepth) sizeDenied();
		if (typeof current === "string") {
			if (current.length > maxBytes) sizeDenied();
			stringBytes += new TextEncoder().encode(current).byteLength;
			if (stringBytes > maxBytes) sizeDenied();
		}
		if (current === null || typeof current !== "object") return;
		if (Array.isArray(current) && current.length > maxNodes - nodes)
			sizeDenied();
		if (ancestors.has(current)) sizeDenied();
		ancestors.add(current);
		if (Array.isArray(current)) {
			for (const child of current) visit(child, depth + 1);
		} else {
			for (const [key, child] of Object.entries(current)) {
				visit(key, depth + 1);
				visit(child, depth + 1);
			}
		}
		ancestors.delete(current);
	}
	visit(value, 0);
	const serialized = JSON.stringify(value);
	if (
		typeof serialized !== "string" ||
		new TextEncoder().encode(serialized).byteLength >
			ceiling(options.maxRecordBytes, MAX_RECORD_BYTES)
	)
		sizeDenied();
	return serialized;
}

/** Public Pi Storage over DO SQLite. Private record and revision bodies are encrypted before SQL. */
export class EncryptedPiStorage implements Storage {
	private closed = false;
	private closing: Promise<void> | undefined;
	private chain: Promise<unknown> = Promise.resolve();
	private readonly admitted = new Set<Promise<unknown>>();
	private verifiedIndex: string | undefined;
	private countersBound = false;
	private persistedNextId = 0;
	private persistedNextSeq = 0;
	private verifiedCounterRecord = "";
	private pendingCounters:
		| { nextId: number; nextSeq: number; record: string }
		| undefined;

	private constructor(
		private readonly storage: DurableObjectStorage,
		private readonly binding: RetainedStorageBinding,
		private nextId: number,
		private readonly options: EncryptedStorageOpenOptions,
	) {}

	static async open(
		storage: DurableObjectStorage,
		binding: RetainedStorageBinding,
		options: EncryptedStorageOpenOptions = {},
	): Promise<EncryptedPiStorage> {
		ceiling(options.inlineMaxBytes, 32 * 1024);
		ceiling(options.chunkBytes, 16 * 1024);
		ceiling(options.maxRecordBytes, MAX_RECORD_BYTES);
		ceiling(options.maxBatchBytes, MAX_BATCH_BYTES);
		ceiling(options.maxNodes, MAX_NODES);
		ceiling(options.maxDepth, MAX_DEPTH);
		ceiling(options.maxWrites, MAX_WRITES);
		ceiling(options.maxRevisions, MAX_REVISIONS);
		ceiling(options.maxBackingBytes, MAX_BACKING_BYTES);
		const opened = new EncryptedPiStorage(storage, binding, 0, { ...options });
		let initialCounters:
			| Awaited<ReturnType<typeof encryptRuntimePayload>>
			| undefined;
		const created = await ensureSchema(storage, async () => {
			initialCounters = await opened.prepareInitialCounters();
		});
		if (created && initialCounters)
			await opened.sealInitialCounters(initialCounters);
		await opened.verifyAll();
		return opened;
	}

	async commit(
		writes: readonly StorageWrite[],
		_context: Context,
	): Promise<Seq> {
		// Snapshot caller-owned values before the first asynchronous preparation.
		if (writes.length > ceiling(this.options.maxWrites, MAX_WRITES))
			sizeDenied();
		let total = 0;
		const detached = writes.map((write) => {
			const serialized = boundedJson(write, this.options);
			total += new TextEncoder().encode(serialized).byteLength;
			if (total > ceiling(this.options.maxBatchBytes, MAX_BATCH_BYTES))
				sizeDenied();
			return JSON.parse(serialized) as StorageWrite;
		});
		return this.admit(() => this.commitIsolated(detached));
	}

	private async commitIsolated(writes: readonly StorageWrite[]): Promise<Seq> {
		const documentActions = this.prepareDocumentActions(writes);
		const candidateNextId = this.candidateNextId(writes);
		for (let attempt = 0; attempt < 8; attempt++) {
			if (this.indexToken() !== this.verifiedIndex)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			const snapshot = this.captureCommitSnapshot(writes, documentActions);
			this.assertSnapshotCounters(snapshot);
			const prepared = await this.prepareCommit(
				writes,
				documentActions,
				snapshot,
				candidateNextId,
			);
			const seq = this.storage.transactionSync(() => {
				if (this.indexToken() !== this.verifiedIndex)
					throw new EncryptedStorageError(
						"integrity",
						"Storage integrity failure",
					);
				const current = this.captureCommitSnapshot(writes, documentActions);
				if (snapshotToken(snapshot) !== snapshotToken(current))
					return undefined;
				for (const statement of prepared.statements)
					this.storage.sql.exec(statement.sql, ...statement.params);
				this.assertBackingBounds();
				return seqFromNumber(snapshot.nextSeq);
			});
			if (seq === undefined) continue;
			this.adoptCommittedCounters(prepared);
			return seq;
		}
		throw new EncryptedStorageError(
			"integrity",
			"Storage commit lost its version check",
		);
	}

	async mintId<I extends Id<string>>(): Promise<I> {
		return this.admit(async () => {
			this.assertLiveCounters();
			if (!Number.isSafeInteger(this.nextId))
				throw new Error("ID space is exhausted");
			return idFromNumber<I>(this.nextId++);
		});
	}

	async conversation(
		id: ConversationId,
		_context: Context,
	): Promise<ConversationRecord | undefined> {
		return this.admit(async () => this.readConversation(id));
	}

	async scanConversations(
		queryFilter: ConversationQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<ConversationRecord, Cursor>> {
		return this.admit(async () => {
			const clauses = ["id > ?"];
			const params: Sql[] = [cursorId(cursor) ?? -1];
			if (queryFilter.ownerConversationId !== undefined) {
				clauses.push("owner_conversation_id = ?");
				params.push(queryFilter.ownerConversationId);
			}
			if (queryFilter.ownerTaskId !== undefined) {
				clauses.push("owner_task_id = ?");
				params.push(queryFilter.ownerTaskId);
			}
			params.push(limit + 1);
			const rows = query(this.storage, () => true).all(
				`SELECT id, record FROM conversations WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`,
				...params,
			);
			return page(
				await Promise.all(
					rows.map(async (row) =>
						this.decodeRecord<ConversationRecord>(
							text(row, "record"),
							`conversations/${integer(row, "id")}`,
						),
					),
				),
				limit,
			);
		});
	}

	entry(
		id: EntryId,
		context: Context,
	): Promise<
		{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined
	>;
	entry(
		conversationId: ConversationId,
		id: EntryId,
		context: Context,
	): Promise<
		{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined
	>;
	entry(
		idOrConversationId: EntryId | ConversationId,
		idOrContext: EntryId | Context,
		context?: Context,
	): Promise<
		{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined
	> {
		return this.admit(() =>
			this.readEntry(idOrConversationId, idOrContext, context),
		);
	}

	findLatestHeadMarker(
		conversationId: ConversationId,
		atOrBeforeEntryId: EntryId | undefined,
		_context: Context,
	): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
		return this.admit(() =>
			this.readLatestHeadMarker(conversationId, atOrBeforeEntryId),
		);
	}

	scanEntries(
		queryFilter: EntryQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<EntryRecord, Cursor>> {
		return this.admit(() => this.readEntries(queryFilter, limit, cursor));
	}

	async task(id: TaskId, _context: Context): Promise<StoredTask | undefined> {
		return this.admit(async () => {
			const row = query(this.storage, () => true).get(
				"SELECT record FROM tasks WHERE id = ?",
				id,
			);
			return row === undefined
				? undefined
				: this.decodeRecord<StoredTask>(text(row, "record"), `tasks/${id}`);
		});
	}

	async scanTasks(
		queryFilter: TaskQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<StoredTask, Cursor>> {
		return this.admit(async () => {
			const clauses = ["id > ?"];
			const params: Sql[] = [cursorId(cursor) ?? -1];
			if (queryFilter.conversationId !== undefined) {
				clauses.push("conversation_id = ?");
				params.push(queryFilter.conversationId);
			}
			if (queryFilter.kind !== undefined) {
				clauses.push("kind = ?");
				params.push(encodeIndexedString(queryFilter.kind));
			}
			if (queryFilter.status !== undefined) {
				clauses.push("status = ?");
				params.push(queryFilter.status);
			}
			if (queryFilter.abortRequested !== undefined) {
				clauses.push("abort_requested = ?");
				params.push(queryFilter.abortRequested ? 1 : 0);
			}
			if (queryFilter.background !== undefined) {
				clauses.push("background = ?");
				params.push(queryFilter.background ? 1 : 0);
			}
			params.push(limit + 1);
			const rows = query(this.storage, () => true).all(
				`SELECT id, record FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`,
				...params,
			);
			return page(
				await Promise.all(
					rows.map((row) =>
						this.decodeRecord<StoredTask>(
							text(row, "record"),
							`tasks/${integer(row, "id")}`,
						),
					),
				),
				limit,
			);
		});
	}

	async submission(
		id: SubmissionId,
		_context: Context,
	): Promise<SubmissionRecord | undefined> {
		return this.admit(async () => {
			const row = query(this.storage, () => true).get(
				"SELECT record FROM submissions WHERE id = ?",
				id,
			);
			return row === undefined
				? undefined
				: this.decodeRecord<SubmissionRecord>(
						text(row, "record"),
						`submissions/${id}`,
					);
		});
	}

	async scanSubmissions(
		queryFilter: SubmissionQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<SubmissionRecord, Cursor>> {
		return this.admit(async () => {
			const clauses = ["id > ?"];
			const params: Sql[] = [cursorId(cursor) ?? -1];
			if (queryFilter.conversationId !== undefined) {
				clauses.push("conversation_id = ?");
				params.push(queryFilter.conversationId);
			}
			if (queryFilter.status !== undefined) {
				clauses.push("status = ?");
				params.push(queryFilter.status);
			}
			params.push(limit + 1);
			const rows = query(this.storage, () => true).all(
				`SELECT id, record FROM submissions WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`,
				...params,
			);
			return page(
				await Promise.all(
					rows.map((row) =>
						this.decodeRecord<SubmissionRecord>(
							text(row, "record"),
							`submissions/${integer(row, "id")}`,
						),
					),
				),
				limit,
			);
		});
	}

	async submissionByRequest(
		conversationId: ConversationId,
		requestId: string,
		_context: Context,
	): Promise<SubmissionRecord | undefined> {
		return this.admit(async () => {
			const row = query(this.storage, () => true).get(
				"SELECT id, record FROM submissions WHERE conversation_id = ? AND request_id = ?",
				conversationId,
				encodeIndexedString(requestId),
			);
			return row === undefined
				? undefined
				: this.decodeRecord<SubmissionRecord>(
						text(row, "record"),
						`submissions/${integer(row, "id")}`,
					);
		});
	}

	async findDocument(
		address: DocumentAddress,
		at: DocumentPoint,
		_context: Context,
	): Promise<DocumentRecord | undefined> {
		return this.admit(async () => {
			const parts = addressParts(address);
			const sql =
				at === "current"
					? `SELECT id, record FROM documents
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`
					: `SELECT id, record FROM documents
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)
					ORDER BY created_at DESC LIMIT 1`;
			const params: Sql[] = [
				parts.kind,
				parts.scopeKind,
				parts.ownerId,
				parts.family,
				parts.keyValue,
			];
			if (at !== "current") params.push(at, at);
			const row = query(this.storage, () => true).get(sql, ...params);
			return row === undefined
				? undefined
				: this.decodeRecord<DocumentRecord>(
						text(row, "record"),
						`documents/${integer(row, "id")}`,
					);
		});
	}

	async document(
		id: DocumentId,
		at: DocumentPoint,
		_context: Context,
	): Promise<StoredDocument | undefined> {
		return this.admit(async () => {
			const captured = this.storage.transactionSync(() =>
				this.captureDocument(id),
			);
			return this.materializeCaptured(captured, id, at);
		});
	}

	async scanDocuments(
		queryFilter: DocumentQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<DocumentRecord, Cursor>> {
		return this.admit(async () => {
			const scope = scopeColumns(queryFilter.scope);
			const clauses = ["scope_kind = ?", "owner_id = ?", "id > ?"];
			const params: Sql[] = [
				scope.scopeKind,
				scope.ownerId,
				cursorId(cursor) ?? -1,
			];
			if (queryFilter.kind !== undefined) {
				clauses.push("kind = ?");
				params.push(encodeIndexedString(queryFilter.kind));
			}
			if (queryFilter.at === "current") clauses.push("retired_at IS NULL");
			else {
				clauses.push(
					"created_at <= ?",
					"(retired_at IS NULL OR retired_at > ?)",
				);
				params.push(queryFilter.at, queryFilter.at);
			}
			params.push(limit + 1);
			const rows = query(this.storage, () => true).all(
				`SELECT id, record FROM documents WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`,
				...params,
			);
			return page(
				await Promise.all(
					rows.map((row) =>
						this.decodeRecord<DocumentRecord>(
							text(row, "record"),
							`documents/${integer(row, "id")}`,
						),
					),
				),
				limit,
			);
		});
	}

	close(_context: Context): Promise<void> {
		if (this.closing !== undefined) return this.closing;
		this.closed = true;
		const pending = [...this.admitted];
		this.closing = Promise.allSettled(pending).then(() => undefined);
		return this.closing;
	}

	private admit<T>(work: () => Promise<T>): Promise<T> {
		this.assertOpen();
		const run = this.chain.then(
			() => this.runAdmitted(work),
			() => this.runAdmitted(work),
		);
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		this.admitted.add(run);
		void run.then(
			() => {
				this.admitted.delete(run);
			},
			() => {
				this.admitted.delete(run);
			},
		);
		return run;
	}

	private async runAdmitted<T>(work: () => Promise<T>): Promise<T> {
		await this.ensureIndexed();
		return work();
	}

	private async readConversation(
		id: ConversationId,
	): Promise<ConversationRecord | undefined> {
		const row = query(this.storage, () => true).get(
			"SELECT record FROM conversations WHERE id = ?",
			id,
		);
		return row === undefined
			? undefined
			: this.decodeRecord<ConversationRecord>(
					text(row, "record"),
					`conversations/${id}`,
				);
	}

	private async readEntry(
		idOrConversationId: number,
		idOrContext: EntryId | Context,
		context: Context | undefined,
	) {
		const id =
			context === undefined
				? idFromNumber<EntryId>(idOrConversationId)
				: typeof idOrContext === "number"
					? idFromNumber<EntryId>(idOrContext)
					: undefined;
		if (id === undefined)
			throw new TypeError("Storage.entry() requires an entry ID");
		let conversation: ConversationRecord | undefined;
		if (context !== undefined) {
			const conversationId = idFromNumber<ConversationId>(idOrConversationId);
			conversation = await this.readConversation(conversationId);
			if (conversation === undefined)
				throw new Error(`Unknown conversation: ${conversationId}`);
		}
		const row = query(this.storage, () => true).get(
			"SELECT id, conversation_id, head, commit_seq, record FROM entries WHERE id = ?",
			id,
		);
		if (row === undefined) return undefined;
		const commitSeq = integer(row, "commit_seq");
		const entry = await this.decodeEntry(text(row, "record"), id, commitSeq);
		this.assertEntryColumns(entry, row);
		if (conversation !== undefined) {
			let upperEntryId = Number.POSITIVE_INFINITY;
			while (conversation.id !== entry.conversationId) {
				if (conversation.parent === undefined) return undefined;
				upperEntryId = Math.min(upperEntryId, conversation.parent.at);
				const parent = await this.readConversation(
					conversation.parent.conversationId,
				);
				if (parent === undefined)
					throw new EncryptedStorageError(
						"integrity",
						"Missing parent conversation",
					);
				conversation = parent;
			}
			if (entry.id > upperEntryId) return undefined;
		}
		return { entry, commitSeq: seqFromNumber(integer(row, "commit_seq")) };
	}

	private async readLatestHeadMarker(
		conversationId: ConversationId,
		atOrBeforeEntryId: EntryId | undefined,
	) {
		let conversation = await this.readConversation(conversationId);
		if (conversation === undefined)
			throw new Error(`Unknown conversation: ${conversationId}`);
		let upper: number | undefined = atOrBeforeEntryId;
		const db = query(this.storage, () => true);
		while (true) {
			const row =
				upper === undefined
					? db.get(
							"SELECT id, conversation_id, head, commit_seq, record FROM entries WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1",
							conversation.id,
						)
					: db.get(
							"SELECT id, conversation_id, head, commit_seq, record FROM entries WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1",
							conversation.id,
							upper,
						);
			if (row !== undefined) {
				const entry = await this.decodeEntry(
					text(row, "record"),
					integer(row, "id"),
					integer(row, "commit_seq"),
				);
				this.assertEntryColumns(entry, row);
				if (entry.head === undefined)
					throw new EncryptedStorageError(
						"integrity",
						"Storage integrity failure",
					);
				return entry as EntryRecord & { head: EntryId };
			}
			if (conversation.parent === undefined) return undefined;
			upper =
				upper === undefined
					? conversation.parent.at
					: Math.min(upper, conversation.parent.at);
			const parent = await this.readConversation(
				conversation.parent.conversationId,
			);
			if (parent === undefined)
				throw new EncryptedStorageError(
					"integrity",
					"Missing parent conversation",
				);
			conversation = parent;
		}
	}

	private async readEntries(
		queryFilter: EntryQuery,
		limit: number,
		cursor: Cursor | undefined,
	) {
		let conversation = await this.readConversation(queryFilter.conversationId);
		if (conversation === undefined)
			throw new Error(`Unknown conversation: ${queryFilter.conversationId}`);
		const after = cursorId(cursor);
		let upper: number | undefined = queryFilter.maxEntryId;
		if (after !== undefined)
			upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
		const values: EntryRecord[] = [];
		const db = query(this.storage, () => true);
		while (true) {
			const clauses = ["conversation_id = ?"];
			const params: Sql[] = [conversation.id];
			if (queryFilter.minEntryId !== undefined) {
				clauses.push("id >= ?");
				params.push(queryFilter.minEntryId);
			}
			if (upper !== undefined) {
				clauses.push("id <= ?");
				params.push(upper);
			}
			params.push(limit + 1 - values.length);
			const rows = db.all(
				`SELECT id, conversation_id, head, commit_seq, record FROM entries WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`,
				...params,
			);
			for (const row of rows) {
				const entry = await this.decodeEntry(
					text(row, "record"),
					integer(row, "id"),
					integer(row, "commit_seq"),
				);
				this.assertEntryColumns(entry, row);
				if (entry.conversationId !== conversation.id)
					throw new EncryptedStorageError(
						"integrity",
						"Storage integrity failure",
					);
				values.push(entry);
			}
			if (values.length > limit || conversation.parent === undefined) break;
			upper =
				upper === undefined
					? conversation.parent.at
					: Math.min(upper, conversation.parent.at);
			if (
				queryFilter.minEntryId !== undefined &&
				upper < queryFilter.minEntryId
			)
				break;
			const parent = await this.readConversation(
				conversation.parent.conversationId,
			);
			if (parent === undefined)
				throw new EncryptedStorageError(
					"integrity",
					"Missing parent conversation",
				);
			conversation = parent;
		}
		return page(values, limit);
	}

	private captureCommitSnapshot(
		writes: readonly StorageWrite[],
		actions: Map<number, DocumentAction>,
	): Snapshot {
		const db = direct(this.storage);
		const metadata = db.get(
			"SELECT next_id, next_seq, counter_record FROM durable_metadata WHERE singleton = 1",
		);
		if (metadata === undefined)
			throw new EncryptedStorageError(
				"integrity",
				"Durable SQLite metadata is missing",
			);
		const ids = new Set<number>();
		for (const write of writes) {
			const id = writeId(write);
			if (id !== undefined) ids.add(id);
		}
		const docIds = new Set<number>();
		for (const [id, action] of actions) {
			docIds.add(id);
			if (action.copy !== undefined) docIds.add(action.copy.id);
		}
		const records = [...ids]
			.sort((left, right) => left - right)
			.map((id): [number, string | null] => {
				const row = db.get(
					"SELECT record_type FROM record_ids WHERE id = ?",
					id,
				);
				return [id, row === undefined ? null : text(row, "record_type")];
			});
		const documents = [...docIds]
			.sort((left, right) => left - right)
			.map((id): [number, DocumentSnap] => [
				id,
				this.readDocumentSnap(db, id) ?? emptyDocumentSnap(),
			]);
		const addresses = new Map<string, Sql[]>();
		for (const action of actions.values()) {
			if (action.create === undefined) continue;
			const parts = addressParts(action.create);
			addresses.set(addressKey(action.create), [
				parts.kind,
				parts.scopeKind,
				parts.ownerId,
				parts.family,
				parts.keyValue,
			]);
		}
		for (const [, snap] of documents) {
			if (
				snap.kind === null ||
				snap.scopeKind === null ||
				snap.ownerId === null ||
				snap.family === null ||
				snap.keyValue === null
			)
				continue;
			const key = JSON.stringify([
				snap.kind,
				snap.scopeKind,
				snap.ownerId,
				snap.family,
				snap.keyValue,
			]);
			addresses.set(key, [
				snap.kind,
				snap.scopeKind,
				snap.ownerId,
				snap.family,
				snap.keyValue,
			]);
		}
		const currents = [...addresses.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, params]): [string, number] => {
				const row = db.get(
					`SELECT COUNT(*) AS n FROM documents
						WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ? AND retired_at IS NULL`,
					...params,
				);
				return [key, row === undefined ? 0 : integer(row, "n")];
			});
		return {
			nextId: text(metadata, "next_id"),
			nextSeq: integer(metadata, "next_seq"),
			counterRecord: text(metadata, "counter_record"),
			records,
			documents,
			currents,
		};
	}

	private readDocumentSnap(db: Query, id: number): DocumentSnap | undefined {
		const row = db.get(
			"SELECT record, retired_at, kind, scope_kind, owner_id, family, key_value FROM documents WHERE id = ?",
			id,
		);
		if (row === undefined) return undefined;
		return {
			record: text(row, "record"),
			retiredAt: row.retired_at == null ? null : integer(row, "retired_at"),
			kind: text(row, "kind"),
			scopeKind: text(row, "scope_kind"),
			ownerId: integer(row, "owner_id"),
			family: integer(row, "family"),
			keyValue: text(row, "key_value"),
			revisions: db
				.all(
					"SELECT seq, kind, version, content FROM document_revisions WHERE document_id = ? ORDER BY seq",
					id,
				)
				.map((revision) => ({
					seq: integer(revision, "seq"),
					kind: text(revision, "kind"),
					version: integer(revision, "version"),
					content: text(revision, "content"),
				})),
		};
	}

	private captureDocument(id: number): DocumentSnap | undefined {
		return this.readDocumentSnap(direct(this.storage), id);
	}

	private async prepareCommit(
		writes: readonly StorageWrite[],
		actions: Map<number, DocumentAction>,
		snapshot: Snapshot,
		candidateNextId: number,
	): Promise<{
		statements: Statement[];
		nextId: number;
		nextSeq: number;
		counterRecord: string;
	}> {
		const view = snapshotQuery(snapshot);
		await this.checkGlobalIds(view, writes);
		await this.checkDocumentActions(view, actions);
		for (const [id, snap] of snapshot.documents) {
			if (snap.record == null) continue;
			const decoded = await this.decodeRecord<DocumentRecord>(
				snap.record,
				`documents/${id}`,
			);
			const parts = addressParts(decoded);
			if (
				parts.kind !== snap.kind ||
				parts.scopeKind !== snap.scopeKind ||
				parts.ownerId !== snap.ownerId ||
				parts.family !== snap.family ||
				parts.keyValue !== snap.keyValue ||
				(decoded.retiredAt ?? null) !== snap.retiredAt
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		const seq = seqFromNumber(snapshot.nextSeq);
		const statements: Statement[] = [];
		for (const write of writes) {
			if (
				write.type === "document.create" ||
				write.type === "document.copy" ||
				write.type === "document.change" ||
				write.type === "document.retire"
			)
				continue;
			const table = write.type;
			statements.push({
				sql: "INSERT OR IGNORE INTO record_ids (id, record_type) VALUES (?, ?)",
				params: [write.value.id, table],
			});
			const recordId = `${table}s/${write.value.id}`;
			const record =
				write.type === "entry"
					? await this.encodeEntry(write.value, seq)
					: await this.encodeRecord(write.value, recordId);
			if (write.type === "conversation") {
				statements.push({
					sql: "INSERT INTO conversations (id, owner_conversation_id, owner_task_id, record) VALUES (?, ?, ?, ?)",
					params: [
						write.value.id,
						write.value.owner?.conversationId ?? null,
						write.value.owner?.taskId ?? null,
						record,
					],
				});
			} else if (write.type === "entry") {
				statements.push({
					sql: "INSERT INTO entries (id, conversation_id, head, commit_seq, record) VALUES (?, ?, ?, ?, ?)",
					params: [
						write.value.id,
						write.value.conversationId,
						write.value.head ?? null,
						seq,
						record,
					],
				});
			} else if (write.type === "task") {
				statements.push({
					sql: `INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, kind = excluded.kind,
						status = excluded.status, abort_requested = excluded.abort_requested,
						background = excluded.background, record = excluded.record`,
					params: [
						write.value.id,
						write.value.conversationId,
						encodeIndexedString(write.value.kind),
						write.value.state.status,
						write.value.abortRequested ? 1 : 0,
						write.value.background ? 1 : 0,
						record,
					],
				});
			} else {
				statements.push({
					sql: `INSERT INTO submissions (id, conversation_id, request_id, status, record) VALUES (?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id,
						request_id = excluded.request_id, status = excluded.status, record = excluded.record`,
					params: [
						write.value.id,
						write.value.conversationId,
						write.value.requestId === undefined
							? null
							: encodeIndexedString(write.value.requestId),
						write.value.status,
						record,
					],
				});
			}
		}
		statements.push(
			...(await this.prepareDocumentStatements(actions, snapshot, seq)),
		);
		const stored = parseCounterColumns(snapshot.nextId, snapshot.nextSeq);
		let nextId = stored.nextId;
		if (candidateNextId > nextId) nextId = candidateNextId;
		if (!Number.isSafeInteger(nextId) && nextId !== EXHAUSTED_NEXT_ID)
			throw new Error("ID space is exhausted");
		const nextSeq = stored.nextSeq + 1;
		if (!Number.isSafeInteger(nextSeq))
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		const counterRecord = await this.encodeText(
			canonicalCounterPlaintext(nextId, nextSeq),
			counterRecordId(nextId, nextSeq),
		);
		statements.push({
			sql: "UPDATE durable_metadata SET next_id = ?, next_seq = ?, counter_record = ? WHERE singleton = 1",
			params: [String(nextId), nextSeq, counterRecord],
		});
		return { statements, nextId, nextSeq, counterRecord };
	}

	private async prepareDocumentStatements(
		actions: Map<number, DocumentAction>,
		snapshot: Snapshot,
		seq: Seq,
	): Promise<Statement[]> {
		const documents = new Map(snapshot.documents);
		const statements: Statement[] = [];
		for (const [id, action] of actions) {
			let content = action.content;
			if (action.copy !== undefined) {
				try {
					const stored = await this.materializeCaptured(
						documents.get(action.copy.id),
						idFromNumber<DocumentId>(action.copy.id),
						action.copy.at,
					);
					if (stored === undefined)
						throw new Error(
							`Fork source document ${action.copy.id} cannot be read`,
						);
					const create = action.create;
					if (create === undefined)
						throw new Error(`Document ${id} has more than one content command`);
					if (
						stored.record.scope.kind !== "conversation" ||
						create.scope.kind !== "conversation" ||
						stored.record.kind !== create.kind ||
						stored.record.key !== create.key ||
						stored.record.history !== create.history ||
						stored.record.fork !== create.fork
					) {
						throw new Error(
							`Fork source document ${action.copy.id} does not match the copied record`,
						);
					}
					content = {
						kind: "base",
						version: stored.version,
						value: stored.value,
					};
				} catch (error) {
					if (error instanceof StorageRejected) throw error;
					throw new StorageRejected(`Document copy ${id} was rejected`, {
						cause: error,
					});
				}
			}
			let record: DocumentRecord;
			if (action.create !== undefined) {
				record = {
					...action.create,
					createdAt: seq,
					...(action.retire ? { retiredAt: seq } : {}),
				};
				const parts = addressParts(record);
				statements.push({
					sql: "INSERT OR IGNORE INTO record_ids (id, record_type) VALUES (?, ?)",
					params: [id, "document"],
				});
				statements.push({
					sql: `INSERT INTO documents
						(id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					params: [
						id,
						parts.kind,
						parts.family,
						parts.keyValue,
						parts.scopeKind,
						parts.ownerId,
						seq,
						action.retire ? seq : null,
						await this.encodeRecord(record, `documents/${id}`),
					],
				});
			} else {
				const existing = documents.get(id);
				if (existing?.record == null)
					throw new Error(`Unknown document: ${id}`);
				record = await this.decodeRecord<DocumentRecord>(
					existing.record,
					`documents/${id}`,
				);
			}
			if (content !== undefined) {
				const previous = documents.get(id);
				if (
					(previous?.revisions.length ?? 0) + 1 >
						ceiling(this.options.maxRevisions, MAX_REVISIONS) &&
					!(content.kind === "base" && isCurrentOnly(record))
				)
					sizeDenied();
				if (content.kind === "delta") {
					const before = await this.materializeCaptured(
						previous,
						idFromNumber<DocumentId>(id),
						"current",
					);
					if (before === undefined)
						throw new Error("Document delta has no base");
					boundedJson(apply(before.value, content.ops as Op[]), this.options);
				} else boundedJson(content.value, this.options);
				if (content.kind === "base" && isCurrentOnly(record))
					statements.push({
						sql: "DELETE FROM document_revisions WHERE document_id = ?",
						params: [id],
					});
				statements.push({
					sql: "INSERT INTO document_revisions (document_id, seq, kind, version, content) VALUES (?, ?, ?, ?, ?)",
					params: [
						id,
						seq,
						content.kind,
						content.version,
						await this.encodeRevision(
							id,
							seq,
							content.kind,
							content.version,
							content.kind === "base" ? content.value : content.ops,
						),
					],
				});
			}
			if (action.retire) {
				if (action.create === undefined) {
					record = { ...record, retiredAt: seq };
					statements.push({
						sql: "UPDATE documents SET retired_at = ?, record = ? WHERE id = ?",
						params: [
							seq,
							await this.encodeRecord(record, `documents/${id}`),
							id,
						],
					});
				}
				if (isCurrentOnly(record))
					statements.push({
						sql: "DELETE FROM document_revisions WHERE document_id = ?",
						params: [id],
					});
			}
		}
		return statements;
	}

	private async materializeCaptured(
		captured: DocumentSnap | undefined,
		id: DocumentId,
		at: DocumentPoint,
	): Promise<StoredDocument | undefined> {
		if (captured?.record == null) return undefined;
		const record = await this.decodeRecord<DocumentRecord>(
			captured.record,
			`documents/${id}`,
		);
		if (at !== "current" && isCurrentOnly(record))
			throw new Error(`Document ${id} does not retain historical content`);
		if (!isAliveAt(record, at)) return undefined;
		const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
		if (
			captured.revisions.length >
			ceiling(this.options.maxRevisions, MAX_REVISIONS)
		)
			sizeDenied();
		const visible = captured.revisions.filter(
			(revision) => revision.seq <= upper,
		);
		const decoded = [];
		for (const revision of visible)
			decoded.push(
				await this.decodeRevision(
					revision.content,
					id,
					revision.seq,
					revision.kind,
					revision.version,
				),
			);
		const base = [...decoded]
			.reverse()
			.find((revision) => revision.kind === "base");
		if (base === undefined)
			throw new Error(`Document ${id} is missing a required base`);
		let value = base.payload;
		const tail = decoded.filter((revision) => revision.seq > base.seq);
		for (const revision of tail) {
			if (revision.kind !== "delta" || revision.version !== base.version)
				throw new Error(
					`Document ${id} crosses a stored version boundary without a base`,
				);
			if (!Array.isArray(revision.payload))
				throw new EncryptedStorageError("integrity", "Invalid document delta");
			value = apply(value, revision.payload as Op[]);
			boundedJson(value, this.options);
		}
		if (typeof value !== "object" || value === null || Array.isArray(value))
			throw new EncryptedStorageError("integrity", "Invalid document value");
		boundedJson(value, this.options);
		return {
			record,
			version: base.version,
			value: value as StoredDocument["value"],
			deltasSinceBase: tail.length,
		};
	}

	private candidateNextId(writes: readonly StorageWrite[]): number {
		if (!Number.isSafeInteger(this.nextId) && this.nextId !== EXHAUSTED_NEXT_ID)
			throw new Error("ID space is exhausted");
		let nextId = this.nextId;
		for (const write of writes) {
			const id = writeId(write);
			if (id === undefined) continue;
			if (!Number.isSafeInteger(id) || id < 1)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			if (id === Number.MAX_SAFE_INTEGER) {
				nextId = EXHAUSTED_NEXT_ID;
				continue;
			}
			const successor = id + 1;
			if (successor > nextId) nextId = successor;
		}
		return nextId;
	}

	private async checkGlobalIds(
		executor: Query,
		writes: readonly StorageWrite[],
	) {
		const claimed = new Map<number, string>();
		for (const write of writes) {
			if (write.type === "document.change" || write.type === "document.retire")
				continue;
			const document =
				write.type === "document.create" || write.type === "document.copy";
			const table = document ? "document" : write.type;
			const id = document ? write.record.id : write.value.id;
			const existing = executor.get(
				"SELECT record_type FROM record_ids WHERE id = ?",
				id,
			)?.record_type;
			const earlier = claimed.get(id);
			if (
				table === "conversation" ||
				table === "entry" ||
				table === "document"
			) {
				if (existing !== undefined)
					throw new Error(`ID ${id} already belongs to ${existing}`);
				if (earlier !== undefined)
					throw new Error(`ID ${id} is written more than once`);
			} else {
				if (existing !== undefined && existing !== table)
					throw new Error(`ID ${id} already belongs to ${existing}`);
				if (earlier !== undefined && earlier !== table)
					throw new Error(`ID ${id} is written as two record types`);
			}
			claimed.set(id, table);
		}
	}

	private prepareDocumentActions(writes: readonly StorageWrite[]) {
		const actions = new Map<number, DocumentAction>();
		for (const write of writes) {
			if (
				write.type !== "document.create" &&
				write.type !== "document.copy" &&
				write.type !== "document.change" &&
				write.type !== "document.retire"
			)
				continue;
			const id =
				write.type === "document.create" || write.type === "document.copy"
					? write.record.id
					: write.id;
			let action = actions.get(id);
			if (action === undefined) {
				action = { retire: false };
				actions.set(id, action);
			}
			switch (write.type) {
				case "document.create":
					if (
						action.create !== undefined ||
						action.content !== undefined ||
						action.copy !== undefined
					)
						throw new Error(`Document ${id} has more than one content command`);
					action.create = write.record;
					action.content = write.content;
					break;
				case "document.copy":
					if (
						action.create !== undefined ||
						action.content !== undefined ||
						action.copy !== undefined
					)
						throw new Error(`Document ${id} has more than one content command`);
					action.create = write.record;
					action.copy = write.source;
					break;
				case "document.change":
					if (action.content !== undefined || action.copy !== undefined)
						throw new Error(`Document ${id} has more than one content command`);
					action.content = write.content;
					break;
				case "document.retire":
					if (action.retire)
						throw new Error(`Document ${id} is retired more than once`);
					action.retire = true;
					break;
			}
		}
		return actions;
	}

	private async checkDocumentActions(
		executor: Query,
		actions: Map<number, DocumentAction>,
	) {
		const liveCounts = new Map<string, number>();
		for (const [id, action] of actions) {
			if (action.copy !== undefined && actions.has(action.copy.id))
				throw new StorageRejected(
					`Document copy ${id} source is changed in the copy batch`,
				);
			const row = executor.get("SELECT record FROM documents WHERE id = ?", id);
			const existing =
				row === undefined
					? undefined
					: await this.decodeRecord<DocumentRecord>(
							text(row, "record"),
							`documents/${id}`,
						);
			if (action.create === undefined && existing === undefined)
				throw new Error(`Unknown document: ${id}`);
			if (action.create !== undefined && existing !== undefined)
				throw new Error(`Document ${id} already exists`);
			if (existing?.retiredAt !== undefined)
				throw new Error(`Document ${id} is retired`);
			if (action.content?.kind === "delta") {
				const previous = executor.get(
					"SELECT version FROM document_revisions WHERE document_id = ? ORDER BY seq DESC LIMIT 1",
					id,
				);
				if (previous === undefined)
					throw new Error(`Document ${id} delta has no base`);
				if (integer(previous, "version") !== action.content.version)
					throw new Error(`Document ${id} version transition requires a base`);
			}
			const record = action.create ?? existing;
			if (record === undefined) throw new Error(`Unknown document: ${id}`);
			const key = addressKey(record);
			let live = liveCounts.get(key);
			if (live === undefined)
				live =
					(await this.currentDocumentId(executor, record)) === undefined
						? 0
						: 1;
			if (action.retire && existing !== undefined) live -= 1;
			if (action.create !== undefined && !action.retire) live += 1;
			liveCounts.set(key, live);
		}
		for (const live of liveCounts.values()) {
			if (live > 1)
				throw new Error("Document address already has a current incarnation");
		}
	}

	private async currentDocumentId(
		executor: Query,
		address: { kind: string; scope: DocumentRecord["scope"]; key?: string },
	): Promise<DocumentId | undefined> {
		const parts = addressParts(address);
		const id = executor.get(
			`SELECT id FROM documents
				WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ? AND retired_at IS NULL
				LIMIT 1`,
			parts.kind,
			parts.scopeKind,
			parts.ownerId,
			parts.family,
			parts.keyValue,
		)?.id;
		return typeof id === "number" ? idFromNumber<DocumentId>(id) : undefined;
	}

	private async verifyAll(): Promise<void> {
		const before = this.indexToken();
		await this.checkIndexedRows();
		const after = this.indexToken();
		if (before !== after)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		this.bindVerifiedCounters();
		this.verifiedIndex = after;
	}

	private async ensureIndexed(): Promise<void> {
		const token = this.indexToken();
		if (token === this.verifiedIndex) return;
		await this.verifyAll();
		if (this.verifiedIndex !== token)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
	}

	private indexToken(): string {
		const db = direct(this.storage);
		const counters = db.get(
			"SELECT next_id, next_seq, counter_record FROM durable_metadata WHERE singleton = 1",
		);
		if (counters === undefined)
			throw new EncryptedStorageError(
				"integrity",
				"Durable SQLite metadata is missing",
			);
		this.assertBackingBounds();
		return JSON.stringify({
			chunks: db.all(
				"SELECT write_id, ordinal, record_id, content FROM private_chunks ORDER BY write_id, ordinal",
			),
			counters: [
				text(counters, "next_id"),
				integer(counters, "next_seq"),
				text(counters, "counter_record"),
			],
			conversations: db
				.all(
					"SELECT id, owner_conversation_id, owner_task_id, record FROM conversations ORDER BY id",
				)
				.map((row) => [
					integer(row, "id"),
					nullableInteger(row, "owner_conversation_id"),
					nullableInteger(row, "owner_task_id"),
					text(row, "record"),
				]),
			entries: db
				.all(
					"SELECT id, conversation_id, head, commit_seq, record FROM entries ORDER BY id",
				)
				.map((row) => [
					integer(row, "id"),
					integer(row, "conversation_id"),
					nullableInteger(row, "head"),
					integer(row, "commit_seq"),
					text(row, "record"),
				]),
			tasks: db
				.all(
					"SELECT id, conversation_id, kind, status, abort_requested, background, record FROM tasks ORDER BY id",
				)
				.map((row) => [
					integer(row, "id"),
					integer(row, "conversation_id"),
					text(row, "kind"),
					text(row, "status"),
					integer(row, "abort_requested"),
					integer(row, "background"),
					text(row, "record"),
				]),
			submissions: db
				.all(
					"SELECT id, conversation_id, request_id, status, record FROM submissions ORDER BY id",
				)
				.map((row) => [
					integer(row, "id"),
					integer(row, "conversation_id"),
					nullableText(row, "request_id"),
					text(row, "status"),
					text(row, "record"),
				]),
			documents: db
				.all(
					"SELECT id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record FROM documents ORDER BY id",
				)
				.map((row) => [
					integer(row, "id"),
					text(row, "kind"),
					integer(row, "family"),
					text(row, "key_value"),
					text(row, "scope_kind"),
					integer(row, "owner_id"),
					integer(row, "created_at"),
					nullableInteger(row, "retired_at"),
					text(row, "record"),
				]),
			revisions: db
				.all(
					"SELECT document_id, seq, kind, version, content FROM document_revisions ORDER BY document_id, seq",
				)
				.map((row) => [
					integer(row, "document_id"),
					integer(row, "seq"),
					text(row, "kind"),
					integer(row, "version"),
					text(row, "content"),
				]),
			ids: db
				.all("SELECT id, record_type FROM record_ids ORDER BY id")
				.map((row) => [integer(row, "id"), text(row, "record_type")]),
		});
	}

	private async checkIndexedRows(): Promise<void> {
		const db = direct(this.storage);
		const claimed = new Map<number, string>();
		for (const row of db.all("SELECT id, record_type FROM record_ids")) {
			const id = integer(row, "id");
			if (claimed.has(id))
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			claimed.set(id, text(row, "record_type"));
		}
		const seen = new Map<string, Set<number>>();
		const claim = (type: string, id: number) => {
			if (claimed.get(id) !== type)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			const ids = seen.get(type) ?? new Set<number>();
			ids.add(id);
			seen.set(type, ids);
		};
		for (const row of db.all(
			"SELECT id, owner_conversation_id, owner_task_id, record FROM conversations",
		)) {
			const id = integer(row, "id");
			claim("conversation", id);
			const record = await this.decodeRecord<ConversationRecord>(
				text(row, "record"),
				`conversations/${id}`,
			);
			if (
				record.id !== id ||
				(record.owner?.conversationId ?? null) !==
					nullableInteger(row, "owner_conversation_id") ||
				(record.owner?.taskId ?? null) !== nullableInteger(row, "owner_task_id")
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		for (const row of db.all(
			"SELECT id, conversation_id, head, commit_seq, record FROM entries",
		)) {
			const id = integer(row, "id");
			claim("entry", id);
			const entry = await this.decodeEntry(
				text(row, "record"),
				id,
				integer(row, "commit_seq"),
			);
			this.assertEntryColumns(entry, row);
		}
		for (const row of db.all(
			"SELECT id, conversation_id, kind, status, abort_requested, background, record FROM tasks",
		)) {
			const id = integer(row, "id");
			claim("task", id);
			const record = await this.decodeRecord<StoredTask>(
				text(row, "record"),
				`tasks/${id}`,
			);
			if (
				record.id !== id ||
				record.conversationId !== integer(row, "conversation_id") ||
				encodeIndexedString(record.kind) !== text(row, "kind") ||
				record.state.status !== text(row, "status") ||
				(record.abortRequested ? 1 : 0) !== integer(row, "abort_requested") ||
				(record.background ? 1 : 0) !== integer(row, "background")
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		for (const row of db.all(
			"SELECT id, conversation_id, request_id, status, record FROM submissions",
		)) {
			const id = integer(row, "id");
			claim("submission", id);
			const record = await this.decodeRecord<SubmissionRecord>(
				text(row, "record"),
				`submissions/${id}`,
			);
			if (
				record.id !== id ||
				record.conversationId !== integer(row, "conversation_id") ||
				(record.requestId === undefined
					? null
					: encodeIndexedString(record.requestId)) !==
					nullableText(row, "request_id") ||
				record.status !== text(row, "status")
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		for (const row of db.all(
			"SELECT id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record FROM documents",
		)) {
			const id = integer(row, "id");
			claim("document", id);
			const record = await this.decodeRecord<DocumentRecord>(
				text(row, "record"),
				`documents/${id}`,
			);
			const parts = addressParts(record);
			if (
				record.id !== id ||
				parts.kind !== text(row, "kind") ||
				parts.family !== integer(row, "family") ||
				parts.keyValue !== text(row, "key_value") ||
				parts.scopeKind !== text(row, "scope_kind") ||
				parts.ownerId !== integer(row, "owner_id") ||
				record.createdAt !== integer(row, "created_at") ||
				(record.retiredAt ?? null) !== nullableInteger(row, "retired_at")
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		let previousDocument = -1;
		let previousSeq = 0;
		for (const row of db.all(
			"SELECT document_id, seq, kind, version, content FROM document_revisions ORDER BY document_id, seq",
		)) {
			const documentId = integer(row, "document_id");
			const seq = integer(row, "seq");
			if (documentId === previousDocument ? seq <= previousSeq : seq <= 0)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			previousDocument = documentId;
			previousSeq = seq;
			await this.decodeRevision(
				text(row, "content"),
				documentId,
				seq,
				text(row, "kind"),
				integer(row, "version"),
			);
		}
		for (const [id, type] of claimed) {
			if (!seen.get(type)?.has(id))
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
		}
		await this.verifyCounterRow();
	}

	private assertEntryColumns(entry: EntryRecord, row: Row) {
		if (
			entry.id !== integer(row, "id") ||
			entry.conversationId !== integer(row, "conversation_id") ||
			(entry.head ?? null) !== nullableInteger(row, "head")
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
	}

	private async encodeEntry(
		value: EntryRecord,
		commitSeq: Seq,
	): Promise<string> {
		return this.encodeText(
			boundedJson({ commitSeq, entry: value }, this.options),
			`entries/${value.id}/commit/${commitSeq}`,
		);
	}

	private async decodeEntry(
		stored: string,
		id: number,
		commitSeq: number,
	): Promise<EntryRecord> {
		const value = await this.decodeJson(
			stored,
			`entries/${id}/commit/${commitSeq}`,
		);
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			!("commitSeq" in value) ||
			!("entry" in value) ||
			value.commitSeq !== commitSeq ||
			typeof value.entry !== "object" ||
			value.entry === null ||
			Array.isArray(value.entry) ||
			!("id" in value.entry) ||
			value.entry.id !== id
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		return value.entry as EntryRecord;
	}

	private async encodeRevision(
		id: number,
		seq: number,
		kind: string,
		version: number,
		payload: unknown,
	): Promise<string> {
		return this.encodeText(
			boundedJson({ seq, kind, version, payload }, this.options),
			`document_revisions/${id}/${seq}/${kind}/${version}`,
		);
	}

	private async decodeRevision(
		stored: string,
		id: number,
		seq: number,
		kind: string,
		version: number,
	): Promise<{
		seq: number;
		kind: string;
		version: number;
		payload: unknown;
	}> {
		const value = await this.decodeJson(
			stored,
			`document_revisions/${id}/${seq}/${kind}/${version}`,
		);
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			!("seq" in value) ||
			!("kind" in value) ||
			!("version" in value) ||
			!("payload" in value) ||
			value.seq !== seq ||
			value.kind !== kind ||
			value.version !== version ||
			(kind !== "base" && kind !== "delta")
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		return {
			seq,
			kind,
			version,
			payload: value.payload,
		};
	}

	private async encodeRecord(
		value: unknown,
		recordId: string,
	): Promise<string> {
		return this.encodeText(boundedJson(value, this.options), recordId);
	}

	private async encodeText(
		plaintext: string,
		recordId: string,
		prepared?: Awaited<ReturnType<typeof encryptRuntimePayload>>,
	): Promise<string> {
		const bytes = new TextEncoder().encode(plaintext);
		if (
			bytes.byteLength > ceiling(this.options.maxRecordBytes, MAX_RECORD_BYTES)
		)
			sizeDenied();
		const sealed =
			prepared ??
			(await encryptRuntimePayload(
				bytes,
				this.binding.keyring,
				this.aad(recordId),
				this.options,
			));
		if (sealed.kind === "inline") {
			const encoded = serializeRuntimeCiphertext(sealed.envelope);
			if (new TextEncoder().encode(encoded).byteLength > STORAGE_ROW_BYTES)
				sizeDenied();
			return encoded;
		}
		const { chunks, ...manifest } = sealed.manifest;
		for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
			const encoded = serializeRuntimeCiphertext(chunks[ordinal]);
			if (new TextEncoder().encode(encoded).byteLength > STORAGE_ROW_BYTES)
				sizeDenied();
			if (this.indexToken() !== this.verifiedIndex)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			this.assertBackingBounds(new TextEncoder().encode(encoded).byteLength, 1);
			this.storage.sql.exec(
				"INSERT INTO private_chunks (write_id, ordinal, record_id, content) VALUES (?, ?, ?, ?)",
				manifest.writeId,
				ordinal,
				recordId,
				encoded,
			);
			this.verifiedIndex = this.indexToken();
		}
		const reference: SplitReference = { kind: "split", manifest };
		const encoded = JSON.stringify(reference);
		if (new TextEncoder().encode(encoded).byteLength > STORAGE_ROW_BYTES)
			sizeDenied();
		// A reference is prepared only after reading and authenticating its persisted bytes.
		await this.decodePlaintext(encoded, recordId);
		return encoded;
	}

	private async decodeRecord<T>(stored: string, recordId: string): Promise<T> {
		const value = await this.decodeJson(stored, recordId);
		return value as T;
	}

	private async decodePlaintext(
		stored: string,
		recordId: string,
	): Promise<string> {
		let parsed: unknown;
		try {
			if (new TextEncoder().encode(stored).byteLength > STORAGE_ROW_BYTES)
				sizeDenied();
			parsed = JSON.parse(stored) as unknown;
		} catch {
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		}
		if (isExternalRef(parsed))
			throw new EncryptedStorageError(
				"unresolved_external_ref",
				"Unresolved external record reference",
			);
		try {
			const split = this.readSplit(parsed, recordId);
			const bytes =
				split !== undefined
					? await decryptRuntimePayload(
							{ kind: "chunked", manifest: split },
							this.binding.keyring,
							this.aad(recordId),
						)
					: isManifest(parsed)
						? await decryptRuntimePayload(
								{ kind: "chunked", manifest: parseRuntimeManifest(parsed) },
								this.binding.keyring,
								this.aad(recordId),
							)
						: await decryptRuntimePayload(
								{ kind: "inline", envelope: parseRuntimeCiphertextV1(parsed) },
								this.binding.keyring,
								this.aad(recordId),
							);
			if (
				bytes.byteLength >
				ceiling(this.options.maxRecordBytes, MAX_RECORD_BYTES)
			)
				sizeDenied();
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch (error) {
			if (error instanceof EncryptedStorageError) throw error;
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		}
	}

	private async decodeJson(stored: string, recordId: string): Promise<unknown> {
		try {
			const value: unknown = JSON.parse(
				await this.decodePlaintext(stored, recordId),
			);
			boundedJson(value, this.options);
			return value;
		} catch (error) {
			if (error instanceof EncryptedStorageError) throw error;
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		}
	}

	private readSplit(
		value: unknown,
		recordId: string,
	): RuntimeChunkManifestV1 | undefined {
		if (
			typeof value !== "object" ||
			value === null ||
			!("kind" in value) ||
			value.kind !== "split"
		)
			return undefined;
		if (
			!("manifest" in value) ||
			typeof value.manifest !== "object" ||
			value.manifest === null ||
			Array.isArray(value.manifest)
		)
			throw new EncryptedStorageError("integrity", "Invalid private reference");
		const manifest = value.manifest as Record<string, unknown>;
		if (
			manifest.version !== 1 ||
			manifest.recordId !== recordId ||
			typeof manifest.writeId !== "string" ||
			!/^[0-9a-f]{32}$/.test(manifest.writeId) ||
			typeof manifest.digest !== "string" ||
			!/^[0-9a-f]{64}$/.test(manifest.digest) ||
			manifest.formatVersion !== RUNTIME_CRYPTO_FORMAT_VERSION ||
			typeof manifest.chunkCount !== "number" ||
			!Number.isSafeInteger(manifest.chunkCount) ||
			manifest.chunkCount < 1 ||
			manifest.chunkCount > MAX_CHUNKS ||
			typeof manifest.totalLength !== "number" ||
			!Number.isSafeInteger(manifest.totalLength) ||
			manifest.totalLength < 1 ||
			manifest.totalLength >
				ceiling(this.options.maxRecordBytes, MAX_RECORD_BYTES) ||
			"chunks" in manifest
		)
			throw new EncryptedStorageError("integrity", "Invalid private reference");
		const rows = direct(this.storage).all(
			"SELECT ordinal, record_id, content FROM private_chunks WHERE write_id = ? ORDER BY ordinal",
			manifest.writeId,
		);
		if (rows.length !== manifest.chunkCount)
			throw new EncryptedStorageError("integrity", "Missing private chunks");
		const chunks = rows.map((row, ordinal) => {
			if (
				integer(row, "ordinal") !== ordinal ||
				text(row, "record_id") !== recordId ||
				new TextEncoder().encode(text(row, "content")).byteLength >
					STORAGE_ROW_BYTES
			)
				throw new EncryptedStorageError("integrity", "Invalid private chunk");
			return parseRuntimeCiphertextV1(text(row, "content"));
		});
		return parseRuntimeManifest({ ...manifest, chunks });
	}

	private assertBackingBounds(extraBytes = 0, extraRows = 0): void {
		const db = direct(this.storage);
		let total = extraBytes;
		let count = extraRows;
		for (const [table, column] of [
			["conversations", "record"],
			["entries", "record"],
			["tasks", "record"],
			["submissions", "record"],
			["documents", "record"],
			["document_revisions", "content"],
			["private_chunks", "content"],
			["durable_metadata", "counter_record"],
		]) {
			const row = db.get(
				`SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(${column} AS BLOB))), 0) AS bytes, COALESCE(MAX(length(CAST(${column} AS BLOB))), 0) AS largest FROM ${table}`,
			);
			if (row === undefined)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			total += integer(row, "bytes");
			count += integer(row, "n");
			if (integer(row, "largest") > STORAGE_ROW_BYTES) sizeDenied();
		}
		// Include a conservative allowance for routing columns and per-row SQLite overhead.
		if (
			total + count * 4096 >
				ceiling(this.options.maxBackingBytes, MAX_BACKING_BYTES) ||
			count > MAX_NODES
		)
			sizeDenied();
	}

	/** All committed references, including canonical history. Prepared orphan chunks are excluded; nothing is deleted. */
	enumerateCommittedReferences(): Promise<
		readonly Omit<RuntimeChunkManifestV1, "chunks">[]
	> {
		return this.admit(async () => {
			const references = new Map<
				string,
				Omit<RuntimeChunkManifestV1, "chunks">
			>();
			for (const [table, column] of [
				["conversations", "record"],
				["entries", "record"],
				["tasks", "record"],
				["submissions", "record"],
				["documents", "record"],
				["document_revisions", "content"],
				["durable_metadata", "counter_record"],
			]) {
				for (const row of direct(this.storage).all(
					`SELECT ${column} AS body FROM ${table}`,
				)) {
					const value: unknown = JSON.parse(text(row, "body"));
					if (
						typeof value === "object" &&
						value !== null &&
						"kind" in value &&
						value.kind === "split" &&
						"manifest" in value
					) {
						const manifest = value.manifest as Omit<
							RuntimeChunkManifestV1,
							"chunks"
						>;
						this.readSplit(value, manifest.recordId);
						references.set(manifest.writeId, manifest);
					}
				}
			}
			return [...references.values()];
		});
	}

	private aad(recordId: string) {
		return {
			ownerId: this.binding.ownerId,
			workspaceSessionId: this.binding.workspaceSessionId,
			recordId,
			formatVersion: RUNTIME_CRYPTO_FORMAT_VERSION,
		};
	}

	private assertOpen() {
		if (this.closed) throw new Error("EncryptedPiStorage is closed");
	}

	private readCounterRow(): Row {
		const row = direct(this.storage).get(
			"SELECT next_id, next_seq, counter_record FROM durable_metadata WHERE singleton = 1",
		);
		if (row === undefined)
			throw new EncryptedStorageError(
				"integrity",
				"Durable SQLite metadata is missing",
			);
		return row;
	}

	private async prepareInitialCounters() {
		const bytes = new TextEncoder().encode(canonicalCounterPlaintext(2, 1));
		if (
			bytes.byteLength > ceiling(this.options.maxRecordBytes, MAX_RECORD_BYTES)
		)
			sizeDenied();
		const sealed = await encryptRuntimePayload(
			bytes,
			this.binding.keyring,
			this.aad(counterRecordId(2, 1)),
			this.options,
		);
		const bodies: string[] = [];
		if (sealed.kind === "inline") {
			bodies.push(serializeRuntimeCiphertext(sealed.envelope));
		} else {
			const { chunks, ...manifest } = sealed.manifest;
			if (chunks.length > MAX_CHUNKS) sizeDenied();
			bodies.push(JSON.stringify({ kind: "split", manifest }));
			for (const chunk of chunks)
				bodies.push(serializeRuntimeCiphertext(chunk));
		}
		let backingBytes = bodies.length * 4096;
		for (const body of bodies) {
			const length = new TextEncoder().encode(body).byteLength;
			if (length > STORAGE_ROW_BYTES) sizeDenied();
			backingBytes += length;
		}
		if (backingBytes > ceiling(this.options.maxBackingBytes, MAX_BACKING_BYTES))
			sizeDenied();
		return sealed;
	}

	private async sealInitialCounters(
		prepared: Awaited<ReturnType<typeof encryptRuntimePayload>>,
	): Promise<void> {
		this.verifiedIndex = this.indexToken();
		const parsed = parseCounterColumns("2", 1);
		const envelope = await this.encodeText(
			canonicalCounterPlaintext(parsed.nextId, parsed.nextSeq),
			counterRecordId(parsed.nextId, parsed.nextSeq),
			prepared,
		);
		this.storage.transactionSync(() => {
			const row = this.readCounterRow();
			if (
				text(row, "next_id") !== "2" ||
				integer(row, "next_seq") !== 1 ||
				text(row, "counter_record") !== COUNTER_PLACEHOLDER
			)
				throw new EncryptedStorageError(
					"integrity",
					"Storage integrity failure",
				);
			this.storage.sql.exec(
				"UPDATE durable_metadata SET counter_record = ? WHERE singleton = 1 AND counter_record = ?",
				envelope,
				COUNTER_PLACEHOLDER,
			);
		});
	}

	private async verifyCounterRow(): Promise<void> {
		const row = this.readCounterRow();
		const parsed = parseCounterColumns(
			text(row, "next_id"),
			integer(row, "next_seq"),
		);
		const record = text(row, "counter_record");
		const plaintext = await this.decodePlaintext(
			record,
			counterRecordId(parsed.nextId, parsed.nextSeq),
		);
		if (plaintext !== canonicalCounterPlaintext(parsed.nextId, parsed.nextSeq))
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		this.assertCounterBounds(parsed);
		this.pendingCounters = {
			nextId: parsed.nextId,
			nextSeq: parsed.nextSeq,
			record,
		};
	}

	private assertCounterBounds(counters: ParsedCounters): void {
		const db = direct(this.storage);
		const maxId = maxSql(db, "SELECT MAX(id) AS n FROM record_ids");
		if (maxId !== null && maxId >= counters.nextId)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		const retained = [
			maxSql(db, "SELECT MAX(commit_seq) AS n FROM entries"),
			maxSql(db, "SELECT MAX(created_at) AS n FROM documents"),
			maxSql(db, "SELECT MAX(retired_at) AS n FROM documents"),
			maxSql(db, "SELECT MAX(seq) AS n FROM document_revisions"),
		].reduce<number | null>((max, value) => {
			if (value === null) return max;
			if (max === null || value > max) return value;
			return max;
		}, null);
		// Empty and task-only commits consume a sequence without leaving an entry or revision.
		if (retained !== null && retained >= counters.nextSeq)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
	}

	private bindVerifiedCounters(): void {
		const pending = this.pendingCounters;
		if (pending === undefined)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		const row = this.readCounterRow();
		const parsed = parseCounterColumns(
			text(row, "next_id"),
			integer(row, "next_seq"),
		);
		if (
			parsed.nextId !== pending.nextId ||
			parsed.nextSeq !== pending.nextSeq ||
			text(row, "counter_record") !== pending.record
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		if (!this.countersBound || parsed.nextId > this.nextId)
			this.nextId = parsed.nextId;
		this.persistedNextId = parsed.nextId;
		this.persistedNextSeq = parsed.nextSeq;
		this.verifiedCounterRecord = pending.record;
		this.countersBound = true;
	}

	private assertLiveCounters(): void {
		const row = this.readCounterRow();
		const parsed = parseCounterColumns(
			text(row, "next_id"),
			integer(row, "next_seq"),
		);
		if (
			!this.countersBound ||
			parsed.nextId !== this.persistedNextId ||
			parsed.nextSeq !== this.persistedNextSeq ||
			text(row, "counter_record") !== this.verifiedCounterRecord ||
			this.nextId < this.persistedNextId
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
	}

	private assertSnapshotCounters(snapshot: Snapshot): void {
		this.assertLiveCounters();
		if (
			snapshot.nextId !== String(this.persistedNextId) ||
			snapshot.nextSeq !== this.persistedNextSeq ||
			snapshot.counterRecord !== this.verifiedCounterRecord
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
	}

	private adoptCommittedCounters(prepared: {
		nextId: number;
		nextSeq: number;
		counterRecord: string;
	}): void {
		const row = this.readCounterRow();
		const parsed = parseCounterColumns(
			text(row, "next_id"),
			integer(row, "next_seq"),
		);
		if (
			parsed.nextId !== prepared.nextId ||
			parsed.nextSeq !== prepared.nextSeq ||
			text(row, "counter_record") !== prepared.counterRecord ||
			parsed.nextSeq !== this.persistedNextSeq + 1 ||
			parsed.nextId < this.persistedNextId
		)
			throw new EncryptedStorageError("integrity", "Storage integrity failure");
		if (parsed.nextId > this.nextId) this.nextId = parsed.nextId;
		this.persistedNextId = parsed.nextId;
		this.persistedNextSeq = parsed.nextSeq;
		this.verifiedCounterRecord = prepared.counterRecord;
		this.countersBound = true;
		this.verifiedIndex = this.indexToken();
	}
}

function isManifest(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"chunkCount" in value &&
		"chunks" in value
	);
}

async function ensureSchema(
	storage: DurableObjectStorage,
	prepareInitialCounters: () => Promise<void>,
): Promise<boolean> {
	const existing = storage.sql
		.exec<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ditto_storage_meta'",
		)
		.toArray();
	if (existing.length === 0) {
		const stock = storage.sql
			.exec<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('durable_schema', 'conversations', 'tasks')",
			)
			.toArray();
		if (stock.length > 0)
			throw new EncryptedStorageError(
				"plaintext_retained",
				"Plaintext storage cannot be opened as retained",
			);
		await prepareInitialCounters();
		storage.transactionSync(() => {
			for (const statement of SCHEMA) storage.sql.exec(statement);
		});
		return true;
	}
	const row = storage.sql
		.exec<{
			format_version: number;
			engine_compat: string;
			task_compat: string;
			tool_compat: string;
			provider_compat: string;
			adapter_compat: string;
		}>(
			"SELECT format_version, engine_compat, task_compat, tool_compat, provider_compat, adapter_compat FROM ditto_storage_meta WHERE singleton = 1",
		)
		.toArray()[0];
	if (
		row === undefined ||
		row.format_version !== ENCRYPTED_STORAGE_FORMAT ||
		row.engine_compat !== ENGINE_COMPAT ||
		row.task_compat !== TASK_COMPAT ||
		row.tool_compat !== TOOL_COMPAT ||
		row.provider_compat !== PROVIDER_COMPAT ||
		row.adapter_compat !== ADAPTER_COMPAT
	)
		throw new EncryptedStorageError(
			"incompatible",
			"Incompatible encrypted storage",
		);
	return false;
}
