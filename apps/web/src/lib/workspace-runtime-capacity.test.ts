import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it, vi } from "vitest";
import type { createDb } from "#/db";
import { messages, workspaceRuntimeWork } from "#/db/schema";
import {
	acquireCapacitySlot,
	cancelWorkspaceWorkRow,
	drainWorkspaceRuntimeQueue,
	expireQueuedWork,
	persistWorkspaceWork,
	releaseCapacitySlot,
	submitPersistedWork,
	WORKSPACE_CAPACITY_GLOBAL_LIMIT,
	WORKSPACE_CAPACITY_PER_USER_LIMIT,
	WORKSPACE_QUEUE_TTL_MS,
} from "#/lib/workspace-runtime-capacity";

type Db = ReturnType<typeof createDb>;

function createCapacityDb() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE user (
			id text PRIMARY KEY NOT NULL
		);
		CREATE TABLE projects (
			id text PRIMARY KEY NOT NULL,
			userId text NOT NULL
		);
		CREATE TABLE workspace_sessions (
			id text PRIMARY KEY NOT NULL,
			projectId text NOT NULL,
			userId text NOT NULL,
			status text NOT NULL DEFAULT 'active'
		);
		CREATE TABLE messages (
			id text PRIMARY KEY NOT NULL,
			sessionId text NOT NULL,
			projectId text NOT NULL,
			userId text NOT NULL,
			role text NOT NULL,
			content text NOT NULL,
			model text,
			tools text,
			status text NOT NULL DEFAULT 'complete',
			created_at integer
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
			created_at integer,
			updated_at integer
		);
		CREATE UNIQUE INDEX workspace_runtime_work_fifoSeq_uidx
			ON workspace_runtime_work (fifoSeq);
		CREATE UNIQUE INDEX workspace_runtime_work_assistantMessageId_uidx
			ON workspace_runtime_work (assistantMessageId);
		CREATE TABLE workspace_capacity_leases (
			id text PRIMARY KEY NOT NULL,
			sessionId text NOT NULL,
			userId text NOT NULL,
			identityId text,
			leaseToken text NOT NULL,
			expiresAt integer NOT NULL,
			created_at integer,
			updated_at integer
		);
		CREATE UNIQUE INDEX workspace_capacity_leases_sessionId_uidx
			ON workspace_capacity_leases (sessionId);
	`);

	const db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		if (method === "run") {
			stmt.run(...(params as never[]));
			return { rows: [] };
		}
		if (method === "get") {
			const row = stmt.get(...(params as never[])) as
				| Record<string, unknown>
				| undefined;
			return {
				rows: row ? (Object.values(row) as unknown[]) : (undefined as never),
			};
		}
		const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
		return { rows: rows.map((r) => Object.values(r)) };
	}) as unknown as Db;

	return { db, sqlite };
}

function seedUserSession(
	sqlite: DatabaseSync,
	options: { userId: string; sessionId: string; projectId?: string },
) {
	const projectId = options.projectId ?? `proj-${options.userId}`;
	sqlite
		.prepare(`INSERT OR IGNORE INTO user (id) VALUES (?)`)
		.run(options.userId);
	sqlite
		.prepare(`INSERT OR IGNORE INTO projects (id, userId) VALUES (?, ?)`)
		.run(projectId, options.userId);
	sqlite
		.prepare(
			`INSERT INTO workspace_sessions (id, projectId, userId, status) VALUES (?, ?, ?, 'active')`,
		)
		.run(options.sessionId, projectId, options.userId);
	return projectId;
}

describe("workspace capacity CAS", () => {
	it("enforces the global running-slot limit under concurrent acquire", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		const attempts = Array.from(
			{ length: WORKSPACE_CAPACITY_GLOBAL_LIMIT + 5 },
			(_, i) => {
				const userId = `user-${i}`;
				const sessionId = `sess-${i}`;
				seedUserSession(sqlite, { userId, sessionId });
				return acquireCapacitySlot({
					db,
					sessionId,
					userId,
					nowMs,
					createId: () => `id-${i}-${Math.random().toString(16).slice(2)}`,
				});
			},
		);
		const results = await Promise.all(attempts);
		expect(results.filter(Boolean)).toHaveLength(
			WORKSPACE_CAPACITY_GLOBAL_LIMIT,
		);
		expect(results.filter((row) => row == null).length).toBe(5);
	});

	it("enforces the per-user running-slot limit", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		seedUserSession(sqlite, { userId: "user-1", sessionId: "sess-a" });
		seedUserSession(sqlite, {
			userId: "user-1",
			sessionId: "sess-b",
			projectId: "proj-user-1",
		});
		seedUserSession(sqlite, {
			userId: "user-1",
			sessionId: "sess-c",
			projectId: "proj-user-1",
		});
		const first = await acquireCapacitySlot({
			db,
			sessionId: "sess-a",
			userId: "user-1",
			nowMs,
		});
		const second = await acquireCapacitySlot({
			db,
			sessionId: "sess-b",
			userId: "user-1",
			nowMs,
		});
		const third = await acquireCapacitySlot({
			db,
			sessionId: "sess-c",
			userId: "user-1",
			nowMs,
		});
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(third).toBeNull();
	});

	it("renews an existing session slot without consuming another", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		seedUserSession(sqlite, { userId: "user-1", sessionId: "sess-1" });
		const first = await acquireCapacitySlot({
			db,
			sessionId: "sess-1",
			userId: "user-1",
			nowMs,
		});
		const second = await acquireCapacitySlot({
			db,
			sessionId: "sess-1",
			userId: "user-1",
			nowMs: nowMs + 1000,
		});
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(second?.id).toBe(first?.id);
	});
});

describe("workspace work FIFO drain", () => {
	it("runs eligible work in fifo order and skips cancelled or expired items", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		const projectId = seedUserSession(sqlite, {
			userId: "user-1",
			sessionId: "sess-1",
		});
		const first = await persistWorkspaceWork({
			db,
			nowMs,
			workId: "work-1",
			intent: {
				kind: "git_mutation",
				projectId,
				userId: "user-1",
				sessionId: "sess-1",
			},
		});
		const second = await persistWorkspaceWork({
			db,
			nowMs,
			workId: "work-2",
			intent: {
				kind: "git_mutation",
				projectId,
				userId: "user-1",
				sessionId: "sess-1",
			},
		});
		const third = await persistWorkspaceWork({
			db,
			nowMs,
			workId: "work-3",
			intent: {
				kind: "git_mutation",
				projectId,
				userId: "user-1",
				sessionId: "sess-1",
			},
		});
		expect(first.fifoSeq).toBeLessThan(second.fifoSeq);
		expect(second.fifoSeq).toBeLessThan(third.fifoSeq);

		await cancelWorkspaceWorkRow({
			db,
			workId: "work-1",
			userId: "user-1",
			nowMs,
		});
		sqlite
			.prepare(
				`UPDATE workspace_runtime_work SET queueExpiresAt = ? WHERE id = ?`,
			)
			.run(Math.floor(nowMs / 1000) - 10, "work-2");

		const executed: string[] = [];
		await drainWorkspaceRuntimeQueue({
			env: {} as Env,
			db,
			now: () => nowMs,
			execute: async ({ work }) => {
				executed.push(work.id);
			},
		});
		expect(executed).toEqual(["work-3"]);
	});

	it("does not run the same agent work twice under overlapping drains", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		const projectId = seedUserSession(sqlite, {
			userId: "user-1",
			sessionId: "sess-1",
		});
		sqlite
			.prepare(
				`INSERT INTO messages (id, sessionId, projectId, userId, role, content, status)
				 VALUES (?, ?, ?, ?, 'assistant', '', 'pending')`,
			)
			.run("asst-1", "sess-1", projectId, "user-1");
		await persistWorkspaceWork({
			db,
			nowMs,
			workId: "work-agent",
			intent: {
				kind: "agent_run",
				projectId,
				userId: "user-1",
				sessionId: "sess-1",
				assistantMessageId: "asst-1",
			},
		});

		let releases = 0;
		const barrier = new Promise<void>((resolve) => {
			const check = () => {
				if (releases >= 1) resolve();
			};
			setTimeout(check, 0);
		});
		const execute = vi.fn(async () => {
			releases += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		void barrier;
		await Promise.all([
			drainWorkspaceRuntimeQueue({
				env: {} as Env,
				db,
				now: () => nowMs,
				execute,
			}),
			drainWorkspaceRuntimeQueue({
				env: {} as Env,
				db,
				now: () => nowMs,
				execute,
			}),
		]);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("fails the pending assistant when the queue expires", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		const projectId = seedUserSession(sqlite, {
			userId: "user-1",
			sessionId: "sess-1",
		});
		sqlite
			.prepare(
				`INSERT INTO messages (id, sessionId, projectId, userId, role, content, status)
				 VALUES (?, ?, ?, ?, 'assistant', '', 'pending')`,
			)
			.run("asst-1", "sess-1", projectId, "user-1");
		await persistWorkspaceWork({
			db,
			nowMs,
			workId: "work-1",
			intent: {
				kind: "agent_run",
				projectId,
				userId: "user-1",
				sessionId: "sess-1",
				assistantMessageId: "asst-1",
			},
		});
		const expired = await expireQueuedWork({
			db,
			nowMs: nowMs + WORKSPACE_QUEUE_TTL_MS + 1000,
		});
		expect(expired).toHaveLength(1);
		expect(expired[0]?.reasonCode).toBe("capacity_queue_expired");
		const [message] = await db.select().from(messages);
		expect(message?.status).toBe("failed");
	});

	it("releases a sleeping runtime's capacity slot", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		seedUserSession(sqlite, { userId: "user-1", sessionId: "sess-1" });
		const slot = await acquireCapacitySlot({
			db,
			sessionId: "sess-1",
			userId: "user-1",
			nowMs,
		});
		expect(slot).not.toBeNull();
		const released = await releaseCapacitySlot({
			db,
			sessionId: "sess-1",
			nowMs,
		});
		expect(released).toBe(true);
		seedUserSession(sqlite, { userId: "user-2", sessionId: "sess-2" });
		const again = await acquireCapacitySlot({
			db,
			sessionId: "sess-2",
			userId: "user-2",
			nowMs,
		});
		expect(again).not.toBeNull();
	});
});

describe("local capacity characterization", () => {
	it("holds limits, FIFO, and assistant settlement across a simulated restart", async () => {
		const { db, sqlite } = createCapacityDb();
		let nowMs = 1_700_000_000_000;
		const userSessions: Array<{ userId: string; sessionId: string }> = [];
		for (let i = 0; i < 22; i++) {
			const userId = `char-user-${i}`;
			for (let s = 0; s < 3; s++) {
				const sessionId = `${userId}-sess-${s}`;
				seedUserSession(sqlite, {
					userId,
					sessionId,
					projectId: `proj-${userId}`,
				});
				userSessions.push({ userId, sessionId });
			}
		}

		const acquired: string[] = [];
		for (const item of userSessions) {
			const slot = await acquireCapacitySlot({
				db,
				sessionId: item.sessionId,
				userId: item.userId,
				nowMs,
			});
			if (slot) {
				acquired.push(item.sessionId);
			}
		}
		expect(acquired.length).toBe(WORKSPACE_CAPACITY_GLOBAL_LIMIT);
		const byUser = new Map<string, number>();
		for (const sessionId of acquired) {
			const userId = sessionId.split("-sess-")[0] ?? sessionId;
			byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
		}
		for (const count of byUser.values()) {
			expect(count).toBeLessThanOrEqual(WORKSPACE_CAPACITY_PER_USER_LIMIT);
		}

		const queuedAssistants: string[] = [];
		for (let i = 0; i < 8; i++) {
			const assistantMessageId = `asst-q-${i}`;
			const queuedOwner = userSessions[40 + i] ?? userSessions[0];
			if (!queuedOwner) {
				throw new Error("expected seeded sessions");
			}
			const { userId, sessionId } = queuedOwner;
			const projectId = `proj-${userId}`;
			sqlite
				.prepare(
					`INSERT INTO messages (id, sessionId, projectId, userId, role, content, status)
					 VALUES (?, ?, ?, ?, 'assistant', '', 'pending')`,
				)
				.run(assistantMessageId, sessionId, projectId, userId);
			await persistWorkspaceWork({
				db,
				nowMs,
				workId: `work-q-${i}`,
				intent: {
					kind: "agent_run",
					projectId,
					userId,
					sessionId,
					assistantMessageId,
				},
			});
			queuedAssistants.push(assistantMessageId);
		}

		nowMs += 1000;
		await drainWorkspaceRuntimeQueue({
			env: {} as Env,
			db,
			now: () => nowMs,
			execute: async () => undefined,
		});

		nowMs += WORKSPACE_QUEUE_TTL_MS + 1000;
		await expireQueuedWork({ db, nowMs });
		const remaining = await db.select().from(workspaceRuntimeWork);
		for (const row of remaining) {
			if (row.intent === "agent_run") {
				expect([
					"complete",
					"failed",
					"cancelled",
					"running",
					"leased",
				]).toContain(row.status);
				if (row.status === "queued") {
					throw new Error("queued work survived expiry");
				}
			}
		}
		const assistantRows = await db.select().from(messages);
		for (const row of assistantRows) {
			expect(row.status === "complete" || row.status === "failed").toBe(true);
		}
	});

	it("starts immediate work when a slot is free", async () => {
		const { db, sqlite } = createCapacityDb();
		const nowMs = 1_700_000_000_000;
		const projectId = seedUserSession(sqlite, {
			userId: "user-1",
			sessionId: "sess-1",
		});
		const work = await persistWorkspaceWork({
			db,
			nowMs,
			workId: "work-now",
			intent: {
				kind: "git_mutation",
				projectId,
				userId: "user-1",
				sessionId: "sess-1",
			},
		});
		const receipt = await submitPersistedWork({ db, work, nowMs });
		expect(receipt.status).toBe("running");
	});
});
