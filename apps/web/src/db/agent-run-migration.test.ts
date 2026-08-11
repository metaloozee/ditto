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
		apply(db, files.length, files.length - 1);
		expect(
			db.prepare("SELECT id,content FROM messages ORDER BY id").all(),
		).toEqual(before);
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
});
