import {
	ARCHIVE_COMPATIBILITY_KEY,
	type ArchiveArtifactV1,
	type ArchiveLimits,
	type ArtifactFailureReason,
} from "../../../packages/runtime-contracts/src/artifacts.js";
import {
	type CheckpointProjectionV1,
	parseCheckpointProjectionResultsV1,
} from "../../../packages/runtime-contracts/src/checkpoint.js";
import {
	type ArtifactExecution,
	type ArtifactStore,
	type BranchSyncAuthority,
	createRecoveryLedger,
	createWorkspaceRecovery,
	type MutationScope,
	RecoveryDenied,
	type RecoveryFailure,
	type RecoveryLedger,
} from "./pi-durable-artifacts.ts";
import {
	decryptRuntimeRecord,
	encryptRuntimeRecord,
	RUNTIME_CRYPTO_FORMAT_VERSION,
	type RuntimeKeyring,
} from "./runtime-crypto.ts";

/**
 * Paired checkpoint publication. A pair is a verified workspace archive and a
 * verified encrypted snapshot of the Pi storage rows at one exact commit
 * position, captured under one exclusive mutation scope. The manifest, the
 * current/previous pointer move and the pending product projection commit in
 * one runtime SQLite transaction; nothing before that commit is restorable.
 */

export const CHECKPOINT_MANIFEST_VERSION = 1;
export const CONTEXT_SNAPSHOT_FORMAT = 1;
export const MAX_CONTEXT_BYTES = 32 * 1024 * 1024;

/** Pi storage rows that together define the conversation and document state. */
const CONTEXT_TABLES = [
	"durable_schema",
	"ditto_storage_meta",
	"durable_metadata",
	"record_ids",
	"conversations",
	"entries",
	"tasks",
	"submissions",
	"documents",
	"document_revisions",
	"private_chunks",
] as const;
const REFERENCE_COLUMNS: Partial<
	Record<(typeof CONTEXT_TABLES)[number], string>
> = {
	durable_metadata: "counter_record",
	conversations: "record",
	entries: "record",
	tasks: "record",
	submissions: "record",
	documents: "record",
	document_revisions: "content",
};

export type ContextPosition = { commitSeq: number; nextId: string };
export type ConversationHead = {
	conversation: number;
	/** Null before the conversation has any entry. */
	entry: number | null;
	contextDigest: string | null;
};
export type StorageCompatibility = {
	format: number;
	engine: string;
	task: string;
	tool: string;
	provider: string;
	adapter: string;
};

export type CheckpointManifestV1 = {
	version: 1;
	id: string;
	sequence: number;
	kind: "baseline" | "boundary";
	workspaceSessionId: string;
	scope: string;
	archive: ArchiveArtifactV1;
	context: {
		format: number;
		objectKey: string;
		byteCount: number;
		digest: string;
		plaintextDigest: string;
		position: ContextPosition;
		conversationGeneration: number;
		/** Where a restore forks: the active conversation's newest entry and its model context. */
		head: ConversationHead;
		pins: { count: number; digest: string };
	};
	compatibility: {
		archive: string;
		storage: StorageCompatibility;
		host: string;
	};
	mutationGeneration: number;
	epoch: number;
	executor: { generation: number; executor: number };
	effects: { outstanding: 0; disposition: "settled" };
	baseline: { seedDigest: string; branchHead: string } | null;
	publishedAt: number;
};

/** What publication reads from the runtime host; all synchronous reads are of committed host tables. */
export type CheckpointHostPort = {
	readonly version: string;
	epoch(): number;
	/** No run in progress, no unresolved effect, no non-terminal Pi task or placed submission. */
	quiescent(): boolean;
	blocked(): boolean;
	/** Highest admitted effect row; any new admission makes a capture stale. */
	effectWatermark(): number;
	authority(): Promise<{
		current: boolean;
		generation: number;
		executor: number;
		liveExecutors?: number;
	}>;
	/** Rearms ordinary work after a baseline exists. */
	resume(): Promise<void>;
	/** Read-only: the active conversation's head. Publication rechecks the Pi position after it. */
	head(): Promise<ConversationHead>;
};

export type CheckpointFault =
	| "after-archive"
	| "after-context-upload"
	| "after-verify"
	| "commit"
	| "after-commit"
	| "after-restore-files";

export type PublishResult =
	| { status: "published"; manifest: CheckpointManifestV1 }
	| { status: "deferred"; reason: string }
	| {
			status: "failed";
			reason: ArtifactFailureReason | "stale" | "context_failed";
			workspace: RecoveryFailure["workspace"];
	  };

export type RestoreFailure = {
	pair: string;
	reason: ArtifactFailureReason | "context_failed" | "not_retained";
	workspace: RecoveryFailure["workspace"];
};
export type RestorePairResult =
	| {
			status: "restored";
			manifest: CheckpointManifestV1;
			fallback: boolean;
			generation: number;
	  }
	| { status: "deferred"; reason: string }
	| { status: "blocked"; failures: RestoreFailure[] };

/** Thrown by `establish` when the new generation does not reproduce the pair's context. */
export class ContextMismatch extends Error {}

/** The files half of a restore, as the host composes it. */
export type CheckpointRestorer = {
	restorePair(
		pairId: string,
		establish: (
			manifest: CheckpointManifestV1,
			confirm: () => void,
		) => Promise<number>,
	): Promise<RestorePairResult>;
};

type SqlStorage = {
	sql: {
		exec<T extends Record<string, SqlStorageValue>>(
			query: string,
			...bindings: unknown[]
		): { toArray(): T[]; one(): T };
	};
	transactionSync<T>(closure: () => T): T;
};

const SCHEMA = [
	"CREATE TABLE IF NOT EXISTS checkpoint_manifests (id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL CHECK (sequence > 0), kind TEXT NOT NULL CHECK (kind IN ('baseline','boundary')), archive_key TEXT UNIQUE NOT NULL, context_key TEXT UNIQUE NOT NULL, manifest TEXT NOT NULL)",
	"CREATE TRIGGER IF NOT EXISTS checkpoint_manifests_immutable BEFORE UPDATE ON checkpoint_manifests BEGIN SELECT RAISE(ABORT, 'checkpoint manifests are immutable'); END",
	"CREATE TABLE IF NOT EXISTS checkpoint_pointer (id INTEGER PRIMARY KEY CHECK (id = 1), current TEXT, previous TEXT, mutation_generation INTEGER NOT NULL, conversation_generation INTEGER NOT NULL)",
	"INSERT OR IGNORE INTO checkpoint_pointer VALUES (1, NULL, NULL, 0, 1)",
	"CREATE TRIGGER IF NOT EXISTS checkpoint_manifests_retained BEFORE DELETE ON checkpoint_manifests WHEN OLD.id IN (SELECT current FROM checkpoint_pointer WHERE current IS NOT NULL UNION SELECT previous FROM checkpoint_pointer WHERE previous IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'retained checkpoint'); END",
	"CREATE TABLE IF NOT EXISTS checkpoint_pins (pair TEXT NOT NULL, write_id TEXT NOT NULL, PRIMARY KEY (pair, write_id))",
	"CREATE TABLE IF NOT EXISTS checkpoint_projections (version INTEGER PRIMARY KEY, current TEXT NOT NULL, previous TEXT, mutation_generation INTEGER NOT NULL, expected INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','applied','rejected')), outcome TEXT)",
	"CREATE TABLE IF NOT EXISTS checkpoint_objects (key TEXT PRIMARY KEY, pair TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('prepared','published','orphaned','cleaned')))",
	"CREATE TABLE IF NOT EXISTS checkpoint_health (id INTEGER PRIMARY KEY CHECK (id = 1), outcome TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL)",
];

export function ensureCheckpointTables(storage: SqlStorage) {
	storage.transactionSync(() => {
		for (const statement of SCHEMA) storage.sql.exec(statement);
	});
}

function hasCheckpointTables(storage: SqlStorage): boolean {
	return (
		storage.sql
			.exec(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoint_pointer'",
			)
			.toArray().length > 0
	);
}

type Pointer = {
	current: string | null;
	previous: string | null;
	mutation_generation: number;
	conversation_generation: number;
};
function pointer(storage: SqlStorage): Pointer {
	return storage.sql
		.exec<Pointer>(
			"SELECT current, previous, mutation_generation, conversation_generation FROM checkpoint_pointer WHERE id = 1",
		)
		.one();
}

/**
 * Ordinary admission requires a committed pair and no held mutation scope.
 * A held or unknown recovery scope owns the workspace exclusively.
 */
export function checkpointAdmission(storage: SqlStorage): {
	baseline: boolean;
	exclusive: boolean;
} {
	if (!hasCheckpointTables(storage))
		return { baseline: false, exclusive: false };
	const scopes =
		storage.sql
			.exec(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_scopes'",
			)
			.toArray().length > 0
			? storage.sql
					.exec<{ n: number }>(
						"SELECT count(*) AS n FROM recovery_scopes WHERE held = 1",
					)
					.one().n
			: 0;
	return { baseline: pointer(storage).current !== null, exclusive: scopes > 0 };
}

export type RecoveryHealth = {
	status: "none" | "healthy" | "degraded" | "blocked";
	pairs: number;
	projectionLag: number;
};

/** Product-safe recovery health; no keys, digests or object references. */
export function checkpointHealth(
	storage: SqlStorage,
): RecoveryHealth | undefined {
	if (!hasCheckpointTables(storage)) return undefined;
	const current = pointer(storage);
	const pairs = [current.current, current.previous].filter(Boolean).length;
	const projectionLag = storage.sql
		.exec<{ n: number }>(
			"SELECT count(*) AS n FROM checkpoint_projections WHERE state != 'applied'",
		)
		.one().n;
	const rejected =
		storage.sql
			.exec<{ n: number }>(
				"SELECT count(*) AS n FROM checkpoint_projections WHERE state = 'rejected'",
			)
			.one().n > 0;
	const exists = (table: string) =>
		storage.sql
			.exec(
				"SELECT name FROM sqlite_master WHERE type='table' AND name=?",
				table,
			)
			.toArray().length > 0;
	const unknown =
		(exists("recovery_operations") &&
			storage.sql
				.exec<{ n: number }>(
					"SELECT count(*) AS n FROM recovery_operations WHERE state = 'unknown'",
				)
				.one().n > 0) ||
		// A restore with no usable pair holds the workspace until review.
		(exists("host_restores") &&
			storage.sql
				.exec<{ n: number }>(
					"SELECT count(*) AS n FROM host_restores WHERE state = 'blocked'",
				)
				.one().n > 0);
	const last = storage.sql
		.exec<{ outcome: string }>(
			"SELECT outcome FROM checkpoint_health WHERE id = 1",
		)
		.toArray()[0];
	return {
		status: unknown
			? "blocked"
			: last?.outcome === "failed" || rejected
				? "degraded"
				: current.current
					? "healthy"
					: "none",
		pairs,
		projectionLag,
	};
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

type ContextEvidence = Omit<
	CheckpointManifestV1["context"],
	"conversationGeneration" | "head" | "pins"
>;
type ContextSnapshot = {
	format: number;
	position: ContextPosition;
	compatibility: StorageCompatibility;
	tables: Record<string, Record<string, string | number | null>[]>;
};

class ContextFailure extends Error {}

/**
 * One synchronous read of every Pi storage row: an exact commit position with
 * its conversation and document state. Row bodies are already encrypted.
 */
function snapshotContext(storage: SqlStorage): {
	snapshot: ContextSnapshot;
	pins: string[];
} {
	const tables: ContextSnapshot["tables"] = {};
	const pins = new Set<string>();
	for (const table of CONTEXT_TABLES) {
		const rows = storage.sql
			.exec<Record<string, SqlStorageValue>>(
				`SELECT * FROM ${table} ORDER BY rowid`,
			)
			.toArray();
		tables[table] = rows.map((row) => {
			const copy: Record<string, string | number | null> = {};
			for (const [key, value] of Object.entries(row)) {
				if (
					value !== null &&
					typeof value !== "string" &&
					typeof value !== "number"
				)
					throw new ContextFailure("Unsupported Pi storage value");
				copy[key] = value;
			}
			return copy;
		});
		const column = REFERENCE_COLUMNS[table];
		if (!column) continue;
		for (const row of rows) {
			const body: unknown = JSON.parse(String(row[column]));
			if (
				body &&
				typeof body === "object" &&
				"kind" in body &&
				body.kind === "split" &&
				"manifest" in body &&
				body.manifest &&
				typeof body.manifest === "object" &&
				"writeId" in body.manifest &&
				typeof body.manifest.writeId === "string"
			)
				pins.add(body.manifest.writeId);
		}
	}
	const chunkWrites = new Set(
		(tables.private_chunks ?? []).map((row) => String(row.write_id)),
	);
	for (const pin of pins)
		if (!chunkWrites.has(pin))
			throw new ContextFailure("A referenced private record is missing");
	const metadata = tables.durable_metadata?.[0];
	const meta = tables.ditto_storage_meta?.[0];
	if (!metadata || !meta) throw new ContextFailure("Pi storage is not open");
	return {
		snapshot: {
			format: CONTEXT_SNAPSHOT_FORMAT,
			position: {
				commitSeq: Number(metadata.next_seq),
				nextId: String(metadata.next_id),
			},
			compatibility: {
				format: Number(meta.format_version),
				engine: String(meta.engine_compat),
				task: String(meta.task_compat),
				tool: String(meta.tool_compat),
				provider: String(meta.provider_compat),
				adapter: String(meta.adapter_compat),
			},
			tables,
		},
		pins: [...pins].sort(),
	};
}

function nextProjection(storage: SqlStorage) {
	return (
		storage.sql
			.exec<{ n: number }>(
				"SELECT COALESCE(MAX(version), 0) AS n FROM checkpoint_projections",
			)
			.one().n + 1
	);
}

/**
 * Points current at the restored pair, inside the transaction that commits
 * its generation. A restored previous pair has no retained predecessor, so
 * pairs from the discarded timeline stop being retained or offered.
 */
function movePointer(storage: SqlStorage, restored: string) {
	const before = pointer(storage);
	const previous = restored === before.current ? before.previous : null;
	const generation = before.mutation_generation + 1;
	storage.sql.exec(
		"UPDATE checkpoint_pointer SET current = ?, previous = ?, mutation_generation = ? WHERE id = 1",
		restored,
		previous,
		generation,
	);
	storage.sql.exec(
		"INSERT INTO checkpoint_projections (version, current, previous, mutation_generation, expected, state) VALUES (?, ?, ?, ?, ?, 'pending')",
		nextProjection(storage),
		restored,
		previous,
		generation,
		before.mutation_generation,
	);
}

function manifestRow(
	storage: SqlStorage,
	where: string,
	value: string | number,
): CheckpointManifestV1 | null {
	const row = storage.sql
		.exec<{ manifest: string }>(
			`SELECT manifest FROM checkpoint_manifests WHERE ${where}`,
			value,
		)
		.toArray()[0];
	return row ? (JSON.parse(row.manifest) as CheckpointManifestV1) : null;
}

function currentPosition(storage: SqlStorage): number {
	return Number(
		storage.sql
			.exec<{ next_seq: number }>(
				"SELECT next_seq FROM durable_metadata WHERE singleton = 1",
			)
			.one().next_seq,
	);
}

async function readAll(
	body: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> {
	const reader = body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => undefined);
			throw new ContextFailure("Context object exceeds its declared length");
		}
		parts.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return bytes;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

/**
 * Host-open recovery: nothing from an earlier process is in flight. A lost
 * workspace mutation becomes unknown and keeps its scope held; other held
 * scopes are released; uploads and context objects that never reached a
 * committed manifest become orphans for cleanup.
 */
export function recoverCheckpointState(storage: SqlStorage) {
	ensureCheckpointTables(storage);
	const ledger = createRecoveryLedger(storage, {
		authority: () => ({
			epoch: 0,
			generation: 0,
			quiescent: false,
			blocked: true,
		}),
		now: () => 0,
		id: () => crypto.randomUUID(),
	});
	ledger.recover();
	storage.transactionSync(() => {
		storage.sql.exec(
			"UPDATE checkpoint_objects SET state = 'orphaned' WHERE state = 'prepared'",
		);
		for (const { object_key } of storage.sql
			.exec<{ object_key: string }>(
				"SELECT object_key FROM recovery_operations WHERE step = 'upload' AND state = 'completed' AND object_key IS NOT NULL AND object_key NOT IN (SELECT archive_key FROM checkpoint_manifests)",
			)
			.toArray())
			ledger.orphan(object_key);
	});
}

export type CheckpointPublisher = ReturnType<typeof createCheckpointPublisher>;

export function createCheckpointPublisher(deps: {
	storage: SqlStorage;
	host: CheckpointHostPort;
	binding: {
		ownerId: string;
		workspaceSessionId: string;
		keyring: RuntimeKeyring;
	};
	execution: ArtifactExecution;
	store: ArtifactStore;
	branch?: BranchSyncAuthority;
	/** Writers outside the host, such as preview. Unsettled defers publication. */
	writers?(): Promise<{ settled: boolean }>;
	now(): number;
	id?(): string;
	limits?: ArchiveLimits;
	/** Test seam; a promise that never settles models a lost process. */
	fault?(point: CheckpointFault): void | Promise<void>;
}) {
	const { storage, host } = deps;
	const id = deps.id ?? (() => crypto.randomUUID());
	ensureCheckpointTables(storage);
	let authority: Awaited<ReturnType<CheckpointHostPort["authority"]>> = {
		current: false,
		generation: 0,
		executor: 0,
	};
	const writable = (value: typeof authority) =>
		value.current && value.executor === 1 && (value.liveExecutors ?? 1) === 1;
	const ledger: RecoveryLedger = createRecoveryLedger(storage, {
		authority: () => ({
			epoch: host.epoch(),
			generation: authority.generation,
			quiescent: host.quiescent(),
			blocked: host.blocked() || !writable(authority),
		}),
		now: deps.now,
		id,
	});
	const recovery = createWorkspaceRecovery({
		ledger,
		execution: deps.execution,
		store: deps.store,
		branch: deps.branch,
		workspaceSessionId: deps.binding.workspaceSessionId,
		limits: deps.limits,
	});
	let inFlight = 0;
	const refresh = async () => {
		authority = await host.authority();
	};
	const health = (outcome: "published" | "failed", reason: string | null) =>
		storage.sql.exec(
			"INSERT INTO checkpoint_health (id, outcome, reason, at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET outcome = excluded.outcome, reason = excluded.reason, at = excluded.at",
			outcome,
			reason,
			deps.now(),
		);
	const aad = (pairId: string) => ({
		ownerId: deps.binding.ownerId,
		workspaceSessionId: deps.binding.workspaceSessionId,
		recordId: `checkpoint-context/${pairId}`,
		formatVersion: RUNTIME_CRYPTO_FORMAT_VERSION,
	});

	async function writeContext(
		pairId: string,
		snapshot: ContextSnapshot,
	): Promise<ContextEvidence> {
		const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
		if (plaintext.byteLength > MAX_CONTEXT_BYTES)
			throw new ContextFailure("Context snapshot exceeds its limit");
		const envelope = await encryptRuntimeRecord(
			plaintext,
			deps.binding.keyring,
			aad(pairId),
		);
		const bytes = new TextEncoder().encode(JSON.stringify(envelope));
		const objectKey = `context/${deps.binding.workspaceSessionId}/${pairId}.json`;
		storage.sql.exec(
			"INSERT INTO checkpoint_objects (key, pair, state) VALUES (?, ?, 'prepared')",
			objectKey,
			pairId,
		);
		await deps.store.put(objectKey, streamOf(bytes), bytes.byteLength);
		return {
			format: CONTEXT_SNAPSHOT_FORMAT,
			objectKey,
			byteCount: bytes.byteLength,
			digest: await sha256Hex(bytes),
			plaintextDigest: await sha256Hex(plaintext),
			position: snapshot.position,
		};
	}

	/** Reads the stored context back and proves it is the captured position. */
	async function readContext(
		pairId: string,
		context: ContextEvidence,
	): Promise<ContextSnapshot> {
		const object = await deps.store.get(context.objectKey);
		if (!object) throw new ContextFailure("Context object is missing");
		if (object.size !== context.byteCount) {
			await object.body.cancel().catch(() => undefined);
			throw new ContextFailure("Context object length does not match");
		}
		const bytes = await readAll(object.body, context.byteCount);
		if (
			bytes.byteLength !== context.byteCount ||
			(await sha256Hex(bytes)) !== context.digest
		)
			throw new ContextFailure("Context object digest does not match");
		const plaintext = await decryptRuntimeRecord(
			JSON.parse(new TextDecoder().decode(bytes)),
			deps.binding.keyring,
			aad(pairId),
		);
		if ((await sha256Hex(plaintext)) !== context.plaintextDigest)
			throw new ContextFailure("Context plaintext digest does not match");
		const snapshot = JSON.parse(
			new TextDecoder().decode(plaintext),
		) as ContextSnapshot;
		if (
			snapshot.format !== CONTEXT_SNAPSHOT_FORMAT ||
			snapshot.position.commitSeq !== context.position.commitSeq ||
			snapshot.position.nextId !== context.position.nextId
		)
			throw new ContextFailure("Context position does not match");
		return snapshot;
	}

	function orphan(pairId: string, archiveKey: string | null) {
		storage.sql.exec(
			"UPDATE checkpoint_objects SET state = 'orphaned' WHERE pair = ? AND state = 'prepared'",
			pairId,
		);
		if (archiveKey) ledger.orphan(archiveKey);
	}

	async function publish(
		kind: CheckpointManifestV1["kind"],
		prepare?: (
			scope: MutationScope,
		) => Promise<{ seedDigest: string; branchHead: string } | RecoveryFailure>,
	): Promise<PublishResult> {
		await refresh();
		if (!writable(authority))
			return { status: "deferred", reason: "executor_not_current" };
		if (deps.writers && !(await deps.writers()).settled)
			return { status: "deferred", reason: "writers_unsettled" };
		if (kind === "boundary" && pointer(storage).current === null)
			return { status: "deferred", reason: "baseline_missing" };
		if (kind === "baseline" && pointer(storage).current !== null)
			return { status: "deferred", reason: "baseline_exists" };
		// A fenced restore names the current pair; publishing would move it.
		if (
			storage.sql
				.exec(
					"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'host_restores'",
				)
				.toArray().length &&
			storage.sql
				.exec("SELECT 1 FROM host_restores WHERE state IN ('fenced','retired')")
				.toArray().length
		)
			return { status: "deferred", reason: "restore_pending" };
		let scope: MutationScope;
		try {
			scope = ledger.acquire(kind === "baseline" ? "restore" : "capture");
		} catch (error) {
			if (error instanceof RecoveryDenied)
				return { status: "deferred", reason: error.reason };
			throw error;
		}
		inFlight++;
		const pairId = id();
		let archiveKey: string | null = null;
		let committed = false;
		const fail = (
			reason: Exclude<
				PublishResult,
				{ status: "published" | "deferred" }
			>["reason"],
			workspace: RecoveryFailure["workspace"],
		): PublishResult => {
			orphan(pairId, archiveKey);
			health("failed", reason);
			return { status: "failed", reason, workspace };
		};
		try {
			let baseline: CheckpointManifestV1["baseline"] = null;
			if (prepare) {
				const prepared = await prepare(scope);
				if ("status" in prepared)
					return fail(prepared.reason, prepared.workspace);
				baseline = prepared;
				await refresh();
			}
			const workspace = () =>
				ledger.mutated(scope.id)
					? ("unusable" as const)
					: ("unchanged" as const);
			// The context is read at the start of exclusive ownership, before files.
			const watermark = host.effectWatermark();
			const headPosition = currentPosition(storage);
			const head = await host.head();
			let captured: ReturnType<typeof snapshotContext>;
			try {
				captured = snapshotContext(storage);
			} catch (error) {
				if (error instanceof ContextFailure)
					return fail("context_failed", workspace());
				throw error;
			}
			if (captured.snapshot.position.commitSeq !== headPosition)
				return fail("stale", workspace());
			const archive = await recovery.capture(scope);
			if (archive.status !== "verified")
				return fail(archive.reason, archive.workspace);
			archiveKey = archive.artifact.objectKey;
			await deps.fault?.("after-archive");
			await refresh();
			let context: ContextEvidence;
			try {
				context = await writeContext(pairId, captured.snapshot);
			} catch {
				return fail("context_failed", workspace());
			}
			await deps.fault?.("after-context-upload");
			try {
				await readContext(pairId, context);
			} catch {
				return fail("context_failed", workspace());
			}
			await deps.fault?.("after-verify");
			await refresh();
			if (deps.writers && !(await deps.writers()).settled)
				return fail("stale", workspace());
			const pinDigest = await sha256Hex(
				new TextEncoder().encode(JSON.stringify(captured.pins)),
			);
			const result = storage.transactionSync(
				(): { manifest: CheckpointManifestV1 } | { stale: true } => {
					try {
						ledger.confirm(scope);
					} catch (error) {
						if (error instanceof RecoveryDenied) return { stale: true };
						throw error;
					}
					if (
						host.effectWatermark() !== watermark ||
						currentPosition(storage) !== captured.snapshot.position.commitSeq
					)
						return { stale: true };
					const before = pointer(storage);
					if ((kind === "baseline") !== (before.current === null))
						return { stale: true };
					const sequence =
						storage.sql
							.exec<{ n: number }>(
								"SELECT COALESCE(MAX(sequence), 0) AS n FROM checkpoint_manifests",
							)
							.one().n + 1;
					const version = nextProjection(storage);
					const manifest: CheckpointManifestV1 = {
						version: CHECKPOINT_MANIFEST_VERSION,
						id: pairId,
						sequence,
						kind,
						workspaceSessionId: deps.binding.workspaceSessionId,
						scope: scope.id,
						archive: archive.artifact,
						context: {
							...context,
							conversationGeneration: before.conversation_generation,
							head,
							pins: { count: captured.pins.length, digest: pinDigest },
						},
						compatibility: {
							archive: ARCHIVE_COMPATIBILITY_KEY,
							storage: captured.snapshot.compatibility,
							host: host.version,
						},
						mutationGeneration: before.mutation_generation + 1,
						epoch: scope.epoch,
						executor: {
							generation: scope.generation,
							executor: authority.executor,
						},
						effects: { outstanding: 0, disposition: "settled" },
						baseline,
						publishedAt: deps.now(),
					};
					// A throw here rolls the whole commit back, as a crash would.
					void deps.fault?.("commit");
					storage.sql.exec(
						"INSERT INTO checkpoint_manifests (id, sequence, kind, archive_key, context_key, manifest) VALUES (?, ?, ?, ?, ?, ?)",
						pairId,
						sequence,
						kind,
						manifest.archive.objectKey,
						manifest.context.objectKey,
						JSON.stringify(manifest),
					);
					for (const pin of captured.pins)
						storage.sql.exec(
							"INSERT INTO checkpoint_pins (pair, write_id) VALUES (?, ?)",
							pairId,
							pin,
						);
					storage.sql.exec(
						"UPDATE checkpoint_pointer SET current = ?, previous = ?, mutation_generation = ? WHERE id = 1",
						pairId,
						before.current,
						manifest.mutationGeneration,
					);
					storage.sql.exec(
						"INSERT INTO checkpoint_projections (version, current, previous, mutation_generation, expected, state) VALUES (?, ?, ?, ?, ?, 'pending')",
						version,
						pairId,
						before.current,
						manifest.mutationGeneration,
						before.mutation_generation,
					);
					storage.sql.exec(
						"UPDATE checkpoint_objects SET state = 'published' WHERE pair = ?",
						pairId,
					);
					health("published", null);
					return { manifest };
				},
			);
			if ("stale" in result) return fail("stale", workspace());
			committed = true;
			await deps.fault?.("after-commit");
			return { status: "published", manifest: result.manifest };
		} finally {
			inFlight--;
			ledger.release(scope);
			// Work and wakeups deferred while the scope was held resume now.
			// A failed rearm fences the host itself; it must not replace the result.
			if (pointer(storage).current !== null)
				await host.resume().catch(() => undefined);
		}
	}

	return {
		ledger,
		/**
		 * Restore the owned seed, synchronize the owned branch and publish the
		 * first pair, all under one exclusive mutation scope.
		 */
		establishBaseline(input: { seed: ArchiveArtifactV1; branch: string }) {
			return publish("baseline", async (scope) => {
				const restored = await recovery.restore(scope, input.seed);
				if (restored.status !== "verified") return restored;
				const synced = await recovery.syncBranch(scope, input.branch);
				if (synced.status !== "verified") return synced;
				return { seedDigest: input.seed.digest, branchHead: synced.head };
			});
		},
		/** A later pair at an acknowledged quiescent run or Git boundary. */
		publishBoundary() {
			return publish("boundary");
		},
		/**
		 * Under one exclusive mutation scope, verify and restore the named
		 * current pair, or its previous pair when the current one is unusable,
		 * and let the host establish the matching conversation generation.
		 * `establish` must call `confirm` inside the transaction that commits
		 * the generation. Two unusable pairs block; the seed is never used.
		 */
		async restorePair(
			pairId: string,
			establish: (
				manifest: CheckpointManifestV1,
				confirm: () => void,
			) => Promise<number>,
		): Promise<RestorePairResult> {
			await refresh();
			if (!writable(authority))
				return { status: "deferred", reason: "executor_not_current" };
			if (deps.writers && !(await deps.writers()).settled)
				return { status: "deferred", reason: "writers_unsettled" };
			// Only the retained lineage: the current pair, then its previous pair.
			const at = pointer(storage);
			if (pairId !== at.current && pairId !== at.previous)
				return {
					status: "blocked",
					failures: [
						{ pair: pairId, reason: "not_retained", workspace: "unchanged" },
					],
				};
			const named = manifestRow(storage, "id = ?", pairId);
			if (!named)
				return {
					status: "blocked",
					failures: [
						{
							pair: pairId,
							reason: "artifact_missing",
							workspace: "unchanged",
						},
					],
				};
			const previous =
				pairId === at.current && at.previous
					? manifestRow(storage, "id = ?", at.previous)
					: null;
			let scope: MutationScope;
			try {
				scope = ledger.acquire("restore");
			} catch (error) {
				if (error instanceof RecoveryDenied)
					return { status: "deferred", reason: error.reason };
				throw error;
			}
			inFlight++;
			const failures: RestoreFailure[] = [];
			try {
				for (const manifest of [named, previous]) {
					if (!manifest) continue;
					if (manifest.compatibility.host !== host.version) {
						failures.push({
							pair: manifest.id,
							reason: "incompatible",
							workspace: ledger.mutated(scope.id) ? "unusable" : "unchanged",
						});
						continue;
					}
					try {
						await readContext(manifest.id, manifest.context);
					} catch {
						failures.push({
							pair: manifest.id,
							reason: "context_failed",
							workspace: ledger.mutated(scope.id) ? "unusable" : "unchanged",
						});
						continue;
					}
					const files = await recovery.restore(scope, manifest.archive);
					if (files.status !== "verified") {
						failures.push({
							pair: manifest.id,
							reason: files.reason,
							workspace: files.workspace,
						});
						// An unknown extraction owns the workspace until reviewed.
						if (files.workspace === "unknown") break;
						if (
							files.reason === "authority_revoked" ||
							files.reason === "scope_denied"
						)
							return { status: "deferred", reason: files.reason };
						continue;
					}
					await deps.fault?.("after-restore-files");
					await refresh();
					if (!writable(authority))
						return { status: "deferred", reason: "executor_not_current" };
					try {
						const generation = await establish(manifest, () => {
							ledger.confirm(scope);
							movePointer(storage, manifest.id);
						});
						return {
							status: "restored",
							manifest,
							fallback: manifest.id !== pairId,
							generation,
						};
					} catch (error) {
						if (error instanceof RecoveryDenied)
							return { status: "deferred", reason: error.reason };
						if (!(error instanceof ContextMismatch)) throw error;
						failures.push({
							pair: manifest.id,
							reason: "verification_failed",
							workspace: "unusable",
						});
					}
				}
				health("failed", "restore_blocked");
				return { status: "blocked", failures };
			} finally {
				inFlight--;
				ledger.release(scope);
			}
		},
		current(): {
			current: CheckpointManifestV1 | null;
			previous: CheckpointManifestV1 | null;
		} {
			const at = pointer(storage);
			const read = (pair: string | null) =>
				pair
					? (JSON.parse(
							storage.sql
								.exec<{ manifest: string }>(
									"SELECT manifest FROM checkpoint_manifests WHERE id = ?",
									pair,
								)
								.one().manifest,
						) as CheckpointManifestV1)
					: null;
			return { current: read(at.current), previous: read(at.previous) };
		},
		/** Proves a committed pair's context still reads back at its position. */
		verifyContext(manifest: CheckpointManifestV1) {
			return readContext(manifest.id, manifest.context);
		},
		/**
		 * After a restart nothing is in flight: lost admitted steps are
		 * classified, and prepared objects that never committed become orphans.
		 */
		recover() {
			if (inFlight)
				throw new Error("Checkpoint recovery requires no live publication");
			recoverCheckpointState(storage);
		},
		/** Deletes orphaned objects; objects of the current and previous pairs are never deleted. */
		async cleanup(): Promise<{ cleaned: number }> {
			const retained = new Set<string>();
			const pairs = this.current();
			for (const manifest of [pairs.current, pairs.previous])
				if (manifest) {
					retained.add(manifest.archive.objectKey);
					retained.add(manifest.context.objectKey);
				}
			let cleaned = 0;
			for (const key of ledger.orphans()) {
				if (retained.has(key)) continue;
				try {
					await deps.store.delete(key);
					ledger.cleaned(key);
					cleaned += 1;
				} catch {
					// Retried on the next cleanup.
				}
			}
			for (const { key } of storage.sql
				.exec<{ key: string }>(
					"SELECT key FROM checkpoint_objects WHERE state = 'orphaned'",
				)
				.toArray()) {
				if (retained.has(key)) continue;
				try {
					await deps.store.delete(key);
					storage.sql.exec(
						"UPDATE checkpoint_objects SET state = 'cleaned' WHERE key = ?",
						key,
					);
					cleaned += 1;
				} catch {
					// Retried on the next cleanup.
				}
			}
			return { cleaned };
		},
	};
}

/**
 * Applies committed pointer moves to the product in order. Only an exact
 * acknowledgment retires an intent; a retry or failure leaves it pending.
 * Moves form a chain, so a rejected move stops delivery and stays visible as
 * degraded recovery with lag until reconciled.
 */
export async function deliverCheckpointProjections(
	storage: SqlStorage,
	apply: (projections: CheckpointProjectionV1[]) => Promise<unknown>,
): Promise<{ pending: number }> {
	if (!hasCheckpointTables(storage)) return { pending: 0 };
	const rows = storage.sql
		.exec<{
			version: number;
			current: string;
			previous: string | null;
			mutation_generation: number;
			expected: number;
		}>(
			"SELECT version, current, previous, mutation_generation, expected FROM checkpoint_projections WHERE state = 'pending' AND NOT EXISTS (SELECT 1 FROM checkpoint_projections WHERE state = 'rejected') ORDER BY version LIMIT 16",
		)
		.toArray();
	// A restore move does not chain from the move before it; it starts a new batch.
	const chain = rows.findIndex(
		(row, index) => index > 0 && row.previous !== rows[index - 1]?.current,
	);
	if (chain > 0) rows.length = chain;
	if (rows.length) {
		const batch: CheckpointProjectionV1[] = rows.map((row) => ({
			version: 1,
			currentPairId: row.current,
			previousPairId: row.previous,
			mutationGeneration: row.mutation_generation,
			expectedMutationGeneration: row.expected,
			projectionVersion: row.version,
		}));
		const results = parseCheckpointProjectionResultsV1(
			await apply(batch),
			batch,
		);
		storage.transactionSync(() => {
			for (const result of results) {
				if (result.outcome === "retry") break;
				const settled =
					result.outcome === "applied" || result.outcome === "already_applied";
				storage.sql.exec(
					"UPDATE checkpoint_projections SET state = ?, outcome = ? WHERE version = ? AND state = 'pending'",
					settled ? "applied" : "rejected",
					result.outcome,
					result.projectionVersion,
				);
				if (!settled) break;
			}
		});
	}
	return {
		pending: storage.sql
			.exec<{ n: number }>(
				"SELECT count(*) AS n FROM checkpoint_projections WHERE state = 'pending' AND NOT EXISTS (SELECT 1 FROM checkpoint_projections WHERE state = 'rejected')",
			)
			.one().n,
	};
}
