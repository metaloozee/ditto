import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import type { createDb } from "#/db";
import * as schema from "#/db/schema";

type Db = ReturnType<typeof createDb>;

type BoundStatement = {
	sql: string;
	params: unknown[];
	bind: (...values: unknown[]) => BoundStatement;
	run: () => Promise<{ success: boolean; meta: { changes: number } }>;
	all: () => Promise<{ results: Record<string, unknown>[]; success: boolean }>;
	raw: () => Promise<unknown[][]>;
	first: () => Promise<Record<string, unknown> | null>;
};

function normalizeParams(params: unknown[]): unknown[] {
	return params.map((value) => (value === undefined ? null : value));
}

function executeAll(
	sqlite: DatabaseSync,
	sql: string,
	params: unknown[],
): Record<string, unknown>[] {
	const statement = sqlite.prepare(sql);
	const bound = normalizeParams(params);
	try {
		return statement.all(...(bound as never[])) as Record<string, unknown>[];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/returning|select/i.test(sql) === false) {
			statement.run(...(bound as never[]));
			return [];
		}
		throw new Error(message);
	}
}

function createStatement(
	sqlite: DatabaseSync,
	sql: string,
	params: unknown[] = [],
): BoundStatement {
	const statement: BoundStatement = {
		sql,
		params,
		bind(...values: unknown[]) {
			return createStatement(sqlite, sql, values);
		},
		async run() {
			const bound = normalizeParams(params);
			const result = sqlite.prepare(sql).run(...(bound as never[]));
			return {
				success: true,
				meta: { changes: Number(result.changes ?? 0) },
			};
		},
		async all() {
			return {
				results: executeAll(sqlite, sql, params),
				success: true,
			};
		},
		async raw() {
			return executeAll(sqlite, sql, params).map((row) => Object.values(row));
		},
		async first() {
			return executeAll(sqlite, sql, params)[0] ?? null;
		},
	};
	return statement;
}

export function createSqliteD1(
	sqlite: DatabaseSync,
	options?: {
		beforeBatchStatement?: (index: number, sql: string) => void;
	},
): D1Database {
	return {
		prepare(sql: string) {
			return createStatement(sqlite, sql) as unknown as D1PreparedStatement;
		},
		async batch<T = unknown>(statements: D1PreparedStatement[]) {
			sqlite.exec("BEGIN IMMEDIATE");
			try {
				const results: D1Result<T>[] = [];
				for (const [index, statement] of statements.entries()) {
					const bound = statement as unknown as BoundStatement;
					options?.beforeBatchStatement?.(index, bound.sql);
					results.push({
						results: executeAll(sqlite, bound.sql, bound.params) as T[],
						success: true,
						meta: {
							duration: 0,
							sizeAfter: 0,
							rowsRead: 0,
							rowsWritten: 0,
							lastRowId: 0,
							changedDb: true,
							changes: 0,
						},
					} as unknown as D1Result<T>);
				}
				sqlite.exec("COMMIT");
				return results;
			} catch (error) {
				sqlite.exec("ROLLBACK");
				throw error;
			}
		},
		async exec(query: string) {
			sqlite.exec(query);
			return { count: 0, duration: 0 };
		},
		async dump() {
			return new ArrayBuffer(0);
		},
		withSession<T>(callback: (session: D1DatabaseSession) => T | Promise<T>) {
			return callback(this as unknown as D1DatabaseSession);
		},
	} as unknown as D1Database;
}

export function createD1Drizzle(
	sqlite: DatabaseSync,
	options?: {
		beforeBatchStatement?: (index: number, sql: string) => void;
	},
): Db {
	return drizzle(createSqliteD1(sqlite, options), { schema }) as unknown as Db;
}

export const OWNERSHIP_D1_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE workspace_sessions (
	id text PRIMARY KEY NOT NULL,
	projectId text NOT NULL,
	userId text NOT NULL,
	title text,
	branchName text,
	baseCommitSha text,
	status text NOT NULL DEFAULT 'active',
	previewStartedAt integer,
	sandboxIdentityId text,
	runtimeLeaseId text,
	runtimeLeaseExpiresAt integer,
	runtimeFailureReasonCode text,
	runtimeOwner text NOT NULL DEFAULT 'legacy',
	runtimeOwnerVersion integer NOT NULL DEFAULT 1,
	brainIdentityId text,
	runtimeProtocolVersion integer,
	runtimeJournalVersion integer,
	productProjectionVersion integer NOT NULL DEFAULT 0,
	created_at integer DEFAULT (unixepoch()),
	updated_at integer DEFAULT (unixepoch())
);
CREATE TABLE messages (
	id text PRIMARY KEY NOT NULL,
	sessionId text NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
	projectId text NOT NULL,
	userId text NOT NULL,
	role text NOT NULL,
	content text NOT NULL,
	model text,
	tools text,
	status text NOT NULL DEFAULT 'complete',
	created_at integer DEFAULT (unixepoch())
);
CREATE TABLE workspace_runtime_work (
	id text PRIMARY KEY NOT NULL,
	fifoSeq integer NOT NULL,
	identityId text,
	sessionId text,
	projectId text NOT NULL,
	userId text NOT NULL,
	intent text NOT NULL,
	payload text,
	status text NOT NULL DEFAULT 'queued',
	leaseToken text,
	leaseExpiresAt integer,
	retryCount integer NOT NULL DEFAULT 0,
	reasonCode text,
	queueExpiresAt integer NOT NULL,
	userMessageId text,
	assistantMessageId text,
	protocolVersion integer,
	runtimeOwner text NOT NULL DEFAULT 'legacy',
	runtimeOwnerVersion integer NOT NULL DEFAULT 1,
	commandId text,
	deliveryState text NOT NULL DEFAULT 'pending',
	deliveryLeaseToken text,
	deliveryLeaseExpiresAt integer,
	deliveryAttempts integer NOT NULL DEFAULT 0,
	startupRoles text,
	startupPools text,
	expectedIdentityId text,
	startupDeadline integer,
	created_at integer DEFAULT (unixepoch()),
	updated_at integer DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX workspace_runtime_work_fifoSeq_uidx
	ON workspace_runtime_work (fifoSeq);
CREATE UNIQUE INDEX workspace_runtime_work_assistantMessageId_uidx
	ON workspace_runtime_work (assistantMessageId);
`;
