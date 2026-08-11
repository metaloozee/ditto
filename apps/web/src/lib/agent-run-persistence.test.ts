import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDb } from "#/db";
import {
	acceptAgentInput,
	advanceAgentRunEpoch,
	loadOwnedAgentRun,
	requestAgentRunStop,
	settleTurnAssistant,
	transitionAgentRun,
} from "./agent-run-persistence";

const migrationsDir = resolve(process.cwd(), "migrations");
const migrationFiles = readdirSync(migrationsDir)
	.filter((file) => /^\d{4}_.*\.sql$/.test(file))
	.sort();

function migrate(sqlite: DatabaseSync) {
	sqlite.exec("PRAGMA foreign_keys=ON");
	for (const file of migrationFiles)
		for (const statement of readFileSync(resolve(migrationsDir, file), "utf8")
			.split("--> statement-breakpoint")
			.map((part) => part.trim())
			.filter(Boolean))
			sqlite.exec(statement);
}

function makeDb() {
	const sqlite = new DatabaseSync(":memory:");
	migrate(sqlite);
	const prepared = (query: string, args: unknown[] = []) => {
		const statement = sqlite.prepare(query);
		const bound = {
			bind: (...values: unknown[]) => prepared(query, values),
			all: async () => ({ results: statement.all(...(args as never[])) }),
			run: async () => {
				const result = statement.run(...(args as never[]));
				return { results: [], meta: { changes: Number(result.changes) } };
			},
		};
		return bound;
	};
	const client = {
		prepare: (query: string) => prepared(query),
		batch: async (
			statements: Array<{
				run: () => Promise<{ results: unknown[]; meta: { changes: number } }>;
			}>,
		) => {
			sqlite.exec("BEGIN");
			try {
				const results = [];
				for (const statement of statements) results.push(await statement.run());
				sqlite.exec("COMMIT");
				return results;
			} catch (cause) {
				sqlite.exec("ROLLBACK");
				throw cause;
			}
		},
	};
	const db = createDb({ DB: client as never });
	sqlite
		.prepare(
			"INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
		)
		.run("u1", "User", "u1@example.test", 0, 1, 1);
	sqlite
		.prepare("INSERT INTO projects (id,name,userId,status) VALUES (?,?,?,?)")
		.run("p1", "Project", "u1", "ready");
	sqlite
		.prepare(
			"INSERT INTO workspace_sessions (id,projectId,userId,status) VALUES (?,?,?,?)",
		)
		.run("s1", "p1", "u1", "active");
	return { db, sqlite };
}
const scope = { userId: "u1", projectId: "p1", workspaceSessionId: "s1" };

describe("agent-run persistence", () => {
	it("accepts atomically, appends, and returns exact duplicates", async () => {
		const { db, sqlite } = makeDb();
		const first = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `id-${++n}`;
			})(),
			now: () => 1000,
		});
		expect(first).toMatchObject({
			runId: "id-1",
			sequence: 1,
			createdRun: true,
			duplicate: false,
		});
		expect(
			sqlite
				.prepare(
					"SELECT workspaceSessionId,projectId,userId FROM turns WHERE id=?",
				)
				.get("id-2"),
		).toEqual({ workspaceSessionId: "s1", projectId: "p1", userId: "u1" });
		const second = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-2",
			message: "again",
			modelSpecifier: "model",
			createId: (() => {
				let n = 10;
				return () => `id-${++n}`;
			})(),
			now: () => 2000,
		});
		expect(second).toMatchObject({
			runId: "id-1",
			sequence: 2,
			createdRun: false,
		});
		const duplicate = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
		});
		expect(duplicate).toMatchObject({
			runId: "id-1",
			sequence: 1,
			duplicate: true,
		});
		expect(sqlite.prepare("SELECT COUNT(*) AS count FROM turns").get()).toEqual(
			{ count: 2 },
		);
	});

	it("routes input after stop to one successor and preserves predecessor", async () => {
		const { db } = makeDb();
		const first = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `id-${++n}`;
			})(),
		});
		if ("kind" in first) throw new Error("setup failed");
		await requestAgentRunStop({
			db,
			...scope,
			runId: first.runId,
			requestId: "stop-1",
		});
		const next = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-2",
			message: "next",
			modelSpecifier: "model",
			createId: (() => {
				let n = 20;
				return () => `id-${++n}`;
			})(),
		});
		expect(next).toMatchObject({ createdRun: true, sequence: 1 });
		const run = await loadOwnedAgentRun({ db, ...scope, runId: first.runId });
		expect(run && !("kind" in run) ? run.run.status : "").toBe("stopping");
	});

	it("enforces CAS lifecycle, epochs, terminal settlement, and ownership", async () => {
		const { db } = makeDb();
		const created = await acceptAgentInput({
			db,
			...scope,
			requestId: "req-1",
			message: "hello",
			modelSpecifier: "model",
			createId: (() => {
				let n = 0;
				return () => `id-${++n}`;
			})(),
		});
		if ("kind" in created) throw new Error("setup failed");
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "accepted",
				to: "running",
				expectedEpoch: null,
			}),
		).toMatchObject({ status: "running", epoch: 1 });
		expect(
			await advanceAgentRunEpoch({
				db,
				...scope,
				runId: created.runId,
				expectedEpoch: 1,
			}),
		).toEqual({ epoch: 2 });
		expect(
			await advanceAgentRunEpoch({
				db,
				...scope,
				runId: created.runId,
				expectedEpoch: 1,
			}),
		).toMatchObject({ kind: "error", code: "stale" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "running",
				to: "finalizing",
				expectedEpoch: 2,
			}),
		).toMatchObject({ status: "finalizing" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "finalizing",
				to: "completed",
				expectedEpoch: 2,
			}),
		).toMatchObject({ kind: "error", code: "stale" });
		expect(
			await settleTurnAssistant({
				db,
				...scope,
				turnId: created.turnId,
				content: "done",
				status: "complete",
			}),
		).toEqual({ status: "complete" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "finalizing",
				to: "completed",
				expectedEpoch: 2,
			}),
		).toMatchObject({ status: "completed" });
		expect(
			await settleTurnAssistant({
				db,
				...scope,
				turnId: created.turnId,
				content: "different",
				status: "complete",
			}),
		).toMatchObject({ kind: "error", code: "idempotency_conflict" });
		expect(
			await transitionAgentRun({
				db,
				...scope,
				runId: created.runId,
				from: "completed",
				to: "running",
			}),
		).toMatchObject({ kind: "error", code: "invalid" });
		expect(
			await advanceAgentRunEpoch({
				db,
				userId: "u2",
				projectId: "p1",
				workspaceSessionId: "s1",
				runId: created.runId,
				expectedEpoch: 2,
			}),
		).toMatchObject({ kind: "error", code: "not_found" });
		const foreign = await loadOwnedAgentRun({
			db,
			userId: "u2",
			projectId: "p1",
			workspaceSessionId: "s1",
			runId: created.runId,
		});
		expect(foreign).toBeNull();
	});
});
