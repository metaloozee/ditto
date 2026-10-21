import type { ArtifactStore } from "./pi-durable-artifacts.ts";
import { manifestRow } from "./pi-durable-checkpoints.ts";

/** Unreferenced transient content becomes collectible after this long. */
export const TRANSIENT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Items deleted per retention step; more work schedules another step. */
export const RETENTION_BATCH = 64;
/** Unreferenced writes considered per step. */
const SCAN_LIMIT = 4096;
/** A held workspace or a failed object delete is retried after this. */
const RETRY_MS = 60_000;

export type RetentionFault =
	| "after-mark"
	| "after-pair-retired"
	| "after-object-deleted"
	| "before-writes-collected";

type Sql = {
	exec<T extends Record<string, SqlStorageValue>>(
		query: string,
		...bindings: unknown[]
	): SqlStorageCursor<T>;
};

/** The encrypted Pi storage operations retention needs. */
export interface RetainedWrites {
	unreferencedWrites(limit: number): Promise<string[]>;
	collectWrites(
		writeIds: readonly string[],
		pinned: ReadonlySet<string>,
	): Promise<string[]>;
}

const SCHEMA = [
	"CREATE TABLE IF NOT EXISTS retention_marks (kind TEXT NOT NULL CHECK (kind IN ('pair','write')), id TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (kind, id))",
	"CREATE TABLE IF NOT EXISTS retention_retries (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, retry_at INTEGER NOT NULL)",
];

/**
 * Bounded collection of what nothing retained still needs. Canonical
 * history, the current and previous pairs, an archive's final pair, pairs
 * a pending product projection names, and every write a retained pair pins
 * are roots. Anything else is marked when first seen unreferenced and is
 * collected only if it is still unreferenced after the retention period;
 * age alone never deletes a root. Each step is safe to repeat.
 */
export function createRetention(deps: {
	storage: { sql: Sql; transactionSync<T>(closure: () => T): T };
	writes: RetainedWrites;
	/** Objects of retired pairs are deleted only when a store is composed. */
	store?: ArtifactStore;
	now(): number;
	batch?: number;
	fault?(point: RetentionFault): void | Promise<void>;
}) {
	const { storage } = deps;
	const sql = storage.sql;
	const batch = deps.batch ?? RETENTION_BATCH;
	for (const statement of SCHEMA) sql.exec(statement);
	const has = (table: string) =>
		sql
			.exec<{ n: number }>(
				"SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
				table,
			)
			.one().n > 0;

	function retainedPairs() {
		const pairs = new Set<string>();
		const add = (query: string) => {
			for (const row of sql.exec<{ pair: string | null }>(query).toArray())
				if (row.pair) pairs.add(row.pair);
		};
		add(
			"SELECT current AS pair FROM checkpoint_pointer UNION SELECT previous FROM checkpoint_pointer",
		);
		add(
			"SELECT current AS pair FROM checkpoint_projections WHERE state != 'applied' UNION SELECT previous FROM checkpoint_projections WHERE state != 'applied'",
		);
		if (has("host_archives")) add("SELECT pair FROM host_archives");
		if (has("host_restores"))
			add(
				"SELECT pair FROM host_restores WHERE state NOT IN ('complete','refused')",
			);
		return pairs;
	}

	/** Keys a retained manifest names; they are never deleted. */
	function retainedKeys(pairs: ReadonlySet<string>) {
		const keys = new Set<string>();
		for (const pair of pairs) {
			const manifest = manifestRow(storage, "id = ?", pair);
			if (!manifest) continue;
			keys.add(manifest.archive.objectKey);
			keys.add(manifest.context.objectKey);
		}
		return keys;
	}

	/** Publication, restore or archive holds the workspace; collection waits. */
	function busy() {
		if (
			has("recovery_scopes") &&
			sql.exec("SELECT 1 FROM recovery_scopes WHERE held = 1").toArray().length
		)
			return true;
		return (
			sql
				.exec("SELECT 1 FROM checkpoint_objects WHERE state = 'prepared'")
				.toArray().length > 0
		);
	}

	/** Marks newly seen ids; a complete listing also unmarks what is referenced again. */
	function mark(
		kind: "pair" | "write",
		ids: readonly string[],
		now: number,
		complete: boolean,
	) {
		const seen = new Set(ids);
		storage.transactionSync(() => {
			if (complete)
				for (const { id } of sql
					.exec<{ id: string }>(
						"SELECT id FROM retention_marks WHERE kind = ?",
						kind,
					)
					.toArray())
					if (!seen.has(id))
						sql.exec(
							"DELETE FROM retention_marks WHERE kind = ? AND id = ?",
							kind,
							id,
						);
			for (const id of ids)
				sql.exec(
					"INSERT OR IGNORE INTO retention_marks (kind, id, since) VALUES (?, ?, ?)",
					kind,
					id,
					now,
				);
		});
	}

	function due(kind: "pair" | "write", now: number) {
		return sql
			.exec<{ id: string }>(
				"SELECT id FROM retention_marks WHERE kind = ? AND since <= ? ORDER BY since, id LIMIT ?",
				kind,
				now - TRANSIENT_RETENTION_MS,
				batch,
			)
			.toArray()
			.map((row) => row.id);
	}

	/** Releases a retired pair's pins and hands its own objects to deletion. */
	function retirePair(pair: string) {
		const manifest = manifestRow(storage, "id = ?", pair);
		storage.transactionSync(() => {
			sql.exec("DELETE FROM checkpoint_pins WHERE pair = ?", pair);
			sql.exec(
				"UPDATE checkpoint_objects SET state = 'orphaned' WHERE pair = ? AND state = 'published'",
				pair,
			);
			// The archive is this session's only when its own capture made it;
			// seeds and a continued lineage's source archive are shared.
			if (
				manifest &&
				has("recovery_operations") &&
				sql
					.exec(
						"SELECT 1 FROM recovery_operations WHERE object_key = ? AND step = 'upload' AND state = 'completed'",
						manifest.archive.objectKey,
					)
					.toArray().length
			)
				sql.exec(
					"INSERT OR IGNORE INTO checkpoint_objects (key, pair, state) VALUES (?, ?, 'orphaned')",
					manifest.archive.objectKey,
					pair,
				);
			sql.exec(
				"DELETE FROM retention_marks WHERE kind = 'pair' AND id = ?",
				pair,
			);
		});
	}

	/**
	 * Deletes up to a batch of orphaned objects. A failed delete backs off
	 * on its own key, so it never blocks the rest or retries every minute.
	 */
	async function deleteObjects(retained: ReadonlySet<string>, now: number) {
		if (!deps.store) return { deleted: 0, more: false };
		const waiting = sql
			.exec<{ key: string }>(
				"SELECT o.key FROM checkpoint_objects o LEFT JOIN retention_retries r ON r.key = o.key WHERE o.state = 'orphaned' AND (r.retry_at IS NULL OR r.retry_at <= ?) ORDER BY o.key",
				now,
			)
			.toArray()
			.map((row) => row.key)
			.filter((key) => !retained.has(key));
		let deleted = 0;
		for (const key of waiting.slice(0, batch)) {
			try {
				await deps.store.delete(key);
			} catch {
				const attempts =
					(sql
						.exec<{ attempts: number }>(
							"SELECT attempts FROM retention_retries WHERE key = ?",
							key,
						)
						.toArray()[0]?.attempts ?? 0) + 1;
				sql.exec(
					"INSERT OR REPLACE INTO retention_retries (key, attempts, retry_at) VALUES (?, ?, ?)",
					key,
					attempts,
					now +
						Math.min(RETRY_MS * 2 ** (attempts - 1), TRANSIENT_RETENTION_MS),
				);
				continue;
			}
			await deps.fault?.("after-object-deleted");
			storage.transactionSync(() => {
				sql.exec(
					"UPDATE checkpoint_objects SET state = 'cleaned' WHERE key = ? AND state = 'orphaned'",
					key,
				);
				sql.exec("DELETE FROM retention_retries WHERE key = ?", key);
			});
			deleted += 1;
		}
		return { deleted, more: waiting.length > batch };
	}

	return {
		/**
		 * One bounded pass. Returns when to run again: now when a batch was
		 * full, else the earliest mark expiry or delete retry, or null.
		 */
		async step(): Promise<{
			next: number | null;
			pairs: number;
			objects: number;
			writes: number;
		}> {
			const result = { pairs: 0, objects: 0, writes: 0 };
			if (!has("checkpoint_pointer")) return { next: null, ...result };
			const now = deps.now();
			if (busy()) return { next: now + RETRY_MS, ...result };
			const retained = retainedPairs();
			const retired = sql
				.exec<{ id: string }>(
					"SELECT id FROM checkpoint_manifests WHERE EXISTS (SELECT 1 FROM checkpoint_pins p WHERE p.pair = checkpoint_manifests.id) OR EXISTS (SELECT 1 FROM checkpoint_objects o WHERE o.pair = checkpoint_manifests.id AND o.state = 'published') ORDER BY sequence",
				)
				.toArray()
				.map((row) => row.id)
				.filter((id) => !retained.has(id));
			mark("pair", retired, now, true);
			const unreferenced = await deps.writes.unreferencedWrites(SCAN_LIMIT);
			const pinned = new Set(
				sql
					.exec<{ write_id: string }>("SELECT write_id FROM checkpoint_pins")
					.toArray()
					.map((row) => row.write_id),
			);
			mark(
				"write",
				unreferenced.filter((id) => !pinned.has(id)),
				now,
				unreferenced.length < SCAN_LIMIT,
			);
			await deps.fault?.("after-mark");
			for (const pair of due("pair", now)) {
				if (retainedPairs().has(pair)) continue;
				retirePair(pair);
				result.pairs += 1;
				await deps.fault?.("after-pair-retired");
			}
			const objects = await deleteObjects(retainedKeys(retainedPairs()), now);
			result.objects = objects.deleted;
			const writes = due("write", now);
			if (writes.length) {
				await deps.fault?.("before-writes-collected");
				const stillPinned = new Set(
					sql
						.exec<{ write_id: string }>("SELECT write_id FROM checkpoint_pins")
						.toArray()
						.map((row) => row.write_id),
				);
				const collected = await deps.writes.collectWrites(writes, stillPinned);
				storage.transactionSync(() => {
					for (const id of writes)
						sql.exec(
							"DELETE FROM retention_marks WHERE kind = 'write' AND id = ?",
							id,
						);
				});
				result.writes = collected.length;
			}
			if (result.pairs >= batch || writes.length >= batch || objects.more)
				return { next: now, ...result };
			// Every object left to delete has failed once and waits its backoff.
			const retry = deps.store
				? sql
						.exec<{ at: number | null }>(
							"SELECT min(r.retry_at) AS at FROM retention_retries r JOIN checkpoint_objects o ON o.key = r.key WHERE o.state = 'orphaned'",
						)
						.one().at
				: null;
			const earliest = sql
				.exec<{ since: number | null }>(
					"SELECT min(since) AS since FROM retention_marks",
				)
				.one().since;
			const deadlines = [
				retry,
				earliest === null ? null : earliest + TRANSIENT_RETENTION_MS,
			].filter((value): value is number => value !== null);
			return {
				next: deadlines.length ? Math.min(...deadlines) : null,
				...result,
			};
		},
	};
}
