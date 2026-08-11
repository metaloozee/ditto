import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "migrations");
const files = readdirSync(migrationsDir)
	.filter((file) => /^\d{4}_.*\.sql$/.test(file))
	.sort();

function apply(db: DatabaseSync, through = files.length, from = 0) {
	for (const file of files.slice(from, through)) {
		for (const statement of readFileSync(resolve(migrationsDir, file), "utf8")
			.split("--> statement-breakpoint")
			.map((part) => part.trim())
			.filter(Boolean))
			db.exec(statement);
	}
}
function tables(db: DatabaseSync): string[] {
	return (
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all() as { name: string }[]
	).map((row) => row.name);
}
function seed(db: DatabaseSync) {
	db.exec("PRAGMA foreign_keys=ON");
	db.prepare(
		"INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)",
	).run("u1", "User", "u1@example.test", 0, 1, 1);
	db.prepare(
		"INSERT INTO projects (id,name,userId,status) VALUES (?,?,?,?)",
	).run("p1", "Project", "u1", "ready");
	db.prepare(
		"INSERT INTO workspace_sessions (id,projectId,userId,status) VALUES (?,?,?,?)",
	).run("s1", "p1", "u1", "active");
	db.prepare(
		"INSERT INTO messages (id,sessionId,projectId,userId,role,content,status) VALUES (?,?,?,?,?,?,?)",
	).run("m1", "s1", "p1", "u1", "user", "hello", "complete");
	db.prepare(
		"INSERT INTO messages (id,sessionId,projectId,userId,role,content,status) VALUES (?,?,?,?,?,?,?)",
	).run("m2", "s1", "p1", "u1", "assistant", "world", "complete");
}

describe("durable agent-run migration 0012", () => {
	it("applies from empty history and leaves only the new run model", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		apply(db);
		for (const name of [
			"projects",
			"workspace_sessions",
			"messages",
			"agent_runs",
			"pi_agent_sessions",
			"turns",
		])
			expect(tables(db)).toContain(name);
		expect(tables(db)).not.toContain("agent_run_events");
		expect(tables(db)).not.toContain("run_artifacts");
		expect(tables(db)).not.toContain("snapshots");
		expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
	});

	it("preserves existing rows and adds empty tables", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		apply(db, files.length - 1);
		seed(db);
		const before = db
			.prepare("SELECT id,content FROM messages ORDER BY id")
			.all();
		const beforeShape = db
			.prepare(
				"SELECT id,sessionId,projectId,userId,role,content,model,status,tools,created_at FROM messages ORDER BY id",
			)
			.all();
		apply(db, files.length, files.length - 1);
		expect(
			db.prepare("SELECT id,content FROM messages ORDER BY id").all(),
		).toEqual(before);
		expect(
			db
				.prepare(
					"SELECT id,sessionId,projectId,userId,role,content,model,status,tools,created_at FROM messages ORDER BY id",
				)
				.all(),
		).toEqual(beforeShape);
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
		).toEqual({ count: 0 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM turns").get()).toEqual({
			count: 0,
		});
	});

	it("enforces ownership, uniqueness, positive sequences and vocabulary", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		apply(db);
		seed(db);
		db.prepare(
			"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,status) VALUES (?,?,?,?,?,?)",
		).run("r1", "s1", "p1", "u1", 1, "accepted");
		db.prepare(
			"INSERT INTO pi_agent_sessions (workspaceSessionId,projectId,userId,currentRunId) VALUES (?,?,?,?)",
		).run("s1", "p1", "u1", "r1");
		db.prepare(
			"INSERT INTO messages (id,sessionId,projectId,userId,role,content,status) VALUES (?,?,?,?,?,?,?)",
		).run("m3", "s1", "p1", "u1", "user", "next", "complete");
		db.prepare(
			"INSERT INTO messages (id,sessionId,projectId,userId,role,content,status) VALUES (?,?,?,?,?,?,?)",
		).run("m4", "s1", "p1", "u1", "assistant", "", "pending");
		db.prepare(
			"INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier) VALUES (?,?,?,?,?,?,?,?,?,?)",
		).run("t1", "r1", "s1", "p1", "u1", 1, "req-1", "m3", "m4", "model");
		expect(() =>
			db
				.prepare(
					"INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.run("t2", "r1", "s1", "p1", "u1", 1, "req-2", "m1", "m2", "model"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,status) VALUES (?,?,?,?,?,?)",
				)
				.run("r2", "s1", "p1", "u1", 0, "accepted"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,status) VALUES (?,?,?,?,?,?)",
				)
				.run("r3", "s1", "p1", "u1", 2, "bogus"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier,thinkingLevel) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
				)
				.run(
					"t3",
					"r1",
					"s1",
					"p1",
					"u1",
					2,
					"req-3",
					"m1",
					"m2",
					"model",
					"bogus",
				),
		).toThrow();
		db.prepare(
			"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,predecessorRunId,status) VALUES (?,?,?,?,?,?,?)",
		).run("r2", "s1", "p1", "u1", 2, "r1", "accepted");
		expect(() =>
			db
				.prepare(
					"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,predecessorRunId,status) VALUES (?,?,?,?,?,?,?)",
				)
				.run("r3", "s1", "p1", "u1", 3, "r1", "accepted"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.run("t2", "r2", "s1", "p1", "u1", 1, "req-1", "m1", "m2", "model"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.run("t3", "r2", "s1", "p1", "u1", 1, "req-3", "m3", "m4", "model"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier) VALUES (?,?,?,?,?,?,?,?,?,?)",
				)
				.run("t4", "r2", "s1", "p1", "u1", 0, "req-4", "m3", "m4", "model"),
		).toThrow();
		expect(() =>
			db
				.prepare(
					"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,status) VALUES (?,?,?,?,?,?)",
				)
				.run("r4", "missing", "p1", "u1", 4, "accepted"),
		).toThrow();
	});

	it("records exact SQLite columns, defaults, indexes, checks and foreign keys", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		apply(db);
		const columns = db.prepare("PRAGMA table_info(agent_runs)").all() as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		expect(columns.map((column) => column.name)).toEqual([
			"id",
			"workspaceSessionId",
			"projectId",
			"userId",
			"sequence",
			"predecessorRunId",
			"status",
			"currentExecutionEpoch",
			"stopRequestId",
			"stopRequestedAt",
			"outcomeCode",
			"acceptedAt",
			"startedAt",
			"finalizingAt",
			"finishedAt",
			"created_at",
			"updated_at",
		]);
		expect(
			columns.map((column) => [column.name, column.notnull, column.dflt_value]),
		).toEqual([
			["id", 1, null],
			["workspaceSessionId", 1, null],
			["projectId", 1, null],
			["userId", 1, null],
			["sequence", 1, null],
			["predecessorRunId", 0, null],
			["status", 1, "'accepted'"],
			["currentExecutionEpoch", 0, null],
			["stopRequestId", 0, null],
			["stopRequestedAt", 0, null],
			["outcomeCode", 0, null],
			["acceptedAt", 1, "unixepoch()"],
			["startedAt", 0, null],
			["finalizingAt", 0, null],
			["finishedAt", 0, null],
			["created_at", 1, "unixepoch()"],
			["updated_at", 1, "unixepoch()"],
		]);
		const piColumns = db
			.prepare("PRAGMA table_info(pi_agent_sessions)")
			.all() as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		expect(
			piColumns.map((column) => [
				column.name,
				column.notnull,
				column.dflt_value,
			]),
		).toEqual([
			["workspaceSessionId", 1, null],
			["projectId", 1, null],
			["userId", 1, null],
			["currentRunId", 0, null],
			["created_at", 1, "unixepoch()"],
			["updated_at", 1, "unixepoch()"],
		]);
		const turnColumns = db.prepare("PRAGMA table_info(turns)").all() as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		expect(
			turnColumns.map((column) => [
				column.name,
				column.notnull,
				column.dflt_value,
			]),
		).toEqual([
			["id", 1, null],
			["runId", 1, null],
			["workspaceSessionId", 1, null],
			["projectId", 1, null],
			["userId", 1, null],
			["sequence", 1, null],
			["requestId", 1, null],
			["userMessageId", 1, null],
			["assistantMessageId", 1, null],
			["modelSpecifier", 1, null],
			["thinkingLevel", 0, null],
			["created_at", 1, "unixepoch()"],
		]);
		expect(
			columns.find((column) => column.name === "workspaceSessionId")?.notnull,
		).toBe(1);
		const indexes = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('agent_runs','pi_agent_sessions','turns') ORDER BY name",
			)
			.all() as { name: string }[];
		expect(indexes.map((index) => index.name)).toEqual(
			expect.arrayContaining([
				"agent_runs_predecessor_uidx",
				"agent_runs_session_sequence_uidx",
				"agent_runs_project_session_status_idx",
				"turns_user_request_uidx",
				"turns_user_message_uidx",
				"turns_assistant_message_uidx",
			]),
		);
		expect(indexes.map((index) => index.name)).toEqual(
			expect.arrayContaining([
				"agent_runs_userId_idx",
				"pi_agent_sessions_project_user_idx",
				"turns_run_sequence_uidx",
				"turns_project_session_run_idx",
			]),
		);
		const sql = (
			db
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_runs'",
				)
				.get() as { sql: string }
		).sql;
		expect(sql).toContain("agent_runs_status_ck");
		expect(sql).toContain("agent_runs_terminal_shape_ck");
		expect(sql).toContain("agent_runs_sequence_positive_ck");
		expect(sql).toContain("agent_runs_outcome_shape_ck");
		const turnSql = (
			db
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name='turns'",
				)
				.get() as { sql: string }
		).sql;
		expect(turnSql).toContain("turns_sequence_positive_ck");
		expect(turnSql).toContain("turns_request_nonempty_ck");
		expect(turnSql).toContain("turns_model_nonempty_ck");
		expect(turnSql).toContain("turns_thinking_level_ck");
		const foreignKeys = (
			db.prepare("PRAGMA foreign_key_list(agent_runs)").all() as {
				table: string;
				on_delete: string;
			}[]
		).map((foreignKey) => [foreignKey.table, foreignKey.on_delete]);
		expect(foreignKeys).toEqual(
			expect.arrayContaining([
				["workspace_sessions", "CASCADE"],
				["projects", "CASCADE"],
				["user", "CASCADE"],
				["agent_runs", "SET NULL"],
			]),
		);
		for (const table of ["pi_agent_sessions", "turns"] as const) {
			const foreignKeyRows = db
				.prepare(`PRAGMA foreign_key_list(${table})`)
				.all() as {
				table: string;
				on_delete: string;
			}[];
			expect(foreignKeyRows.length).toBe(table === "turns" ? 6 : 4);
			expect(foreignKeyRows.map((foreignKey) => foreignKey.table)).toEqual(
				expect.arrayContaining(
					table === "turns"
						? [
								"agent_runs",
								"workspace_sessions",
								"projects",
								"user",
								"messages",
								"messages",
							]
						: ["workspace_sessions", "projects", "user", "agent_runs"],
				),
			);
			expect(
				foreignKeyRows.every(
					(foreignKey) =>
						foreignKey.on_delete === "CASCADE" ||
						foreignKey.on_delete === "SET NULL",
				),
			).toBe(true);
		}
	});

	it("cascades the owned model with its workspace session", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		apply(db);
		seed(db);
		db.prepare(
			"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,status) VALUES (?,?,?,?,?,?)",
		).run("r1", "s1", "p1", "u1", 1, "accepted");
		db.prepare(
			"INSERT INTO pi_agent_sessions (workspaceSessionId,projectId,userId,currentRunId) VALUES (?,?,?,?)",
		).run("s1", "p1", "u1", "r1");
		db.prepare("DELETE FROM workspace_sessions WHERE id=?").run("s1");
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
		).toEqual({ count: 0 });
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM pi_agent_sessions").get(),
		).toEqual({ count: 0 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual({
			count: 0,
		});
	});

	it("keeps a second Workspace Session isolated during cascade", () => {
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys=ON");
		apply(db);
		seed(db);
		db.prepare(
			"INSERT INTO projects (id,name,userId,status) VALUES (?,?,?,?)",
		).run("p2", "Other", "u1", "ready");
		db.prepare(
			"INSERT INTO workspace_sessions (id,projectId,userId,status) VALUES (?,?,?,?)",
		).run("s2", "p2", "u1", "active");
		db.prepare(
			"INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,status) VALUES (?,?,?,?,?,?)",
		).run("r2", "s2", "p2", "u1", 1, "accepted");
		db.prepare(
			"INSERT INTO pi_agent_sessions (workspaceSessionId,projectId,userId,currentRunId) VALUES (?,?,?,?)",
		).run("s2", "p2", "u1", "r2");
		db.prepare("DELETE FROM workspace_sessions WHERE id=?").run("s1");
		expect(db.prepare("SELECT id FROM agent_runs").all()).toEqual([
			{ id: "r2" },
		]);
		expect(
			db.prepare("SELECT workspaceSessionId FROM pi_agent_sessions").all(),
		).toEqual([{ workspaceSessionId: "s2" }]);
	});
});
