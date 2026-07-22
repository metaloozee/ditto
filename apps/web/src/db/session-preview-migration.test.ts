import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../migrations/0011_handy_loa.sql",
);

function applyMigration(db: DatabaseSync) {
	const sql = readFileSync(migrationPath, "utf8");
	for (const statement of sql
		.split("--> statement-breakpoint")
		.map((part) => part.trim())
		.filter(Boolean)) {
		db.exec(statement);
	}
}

function createPre0011Schema(db: DatabaseSync) {
	db.exec(`
		CREATE TABLE projects (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			userId text NOT NULL,
			status text DEFAULT 'ready' NOT NULL
		);
		CREATE TABLE workspace_sessions (
			id text PRIMARY KEY NOT NULL,
			projectId text NOT NULL,
			userId text NOT NULL,
			status text DEFAULT 'active' NOT NULL,
			workspacePath text NOT NULL DEFAULT '/workspace',
			memoryPath text NOT NULL DEFAULT '/workspace/.ditto/project-memory.md'
		);
	`);
}

describe("session preview migration 0011", () => {
	it("adds nullable lease fields and unique project+port index", () => {
		const db = new DatabaseSync(":memory:");
		createPre0011Schema(db);
		applyMigration(db);

		db.prepare(
			`INSERT INTO projects (id, name, userId, status) VALUES (?, ?, ?, ?)`,
		).run("p1", "Project", "u1", "ready");

		const project = db
			.prepare(
				`SELECT previewLockToken, previewLockExpiresAt, deletingAt FROM projects WHERE id = ?`,
			)
			.get("p1") as {
			previewLockToken: string | null;
			previewLockExpiresAt: number | null;
			deletingAt: number | null;
		};

		expect(project.previewLockToken).toBeNull();
		expect(project.previewLockExpiresAt).toBeNull();
		expect(project.deletingAt).toBeNull();

		db.prepare(
			`INSERT INTO workspace_sessions (id, projectId, userId, status) VALUES (?, ?, ?, ?)`,
		).run("s1", "p1", "u1", "active");
		db.prepare(
			`INSERT INTO workspace_sessions (id, projectId, userId, status) VALUES (?, ?, ?, ?)`,
		).run("s2", "p1", "u1", "active");

		const nullPorts = db
			.prepare(
				`SELECT COUNT(*) AS count FROM workspace_sessions WHERE projectId = ? AND previewPort IS NULL`,
			)
			.get("p1") as { count: number };
		expect(nullPorts.count).toBe(2);

		db.prepare(
			`UPDATE workspace_sessions SET previewPort = ? WHERE id = ?`,
		).run(10000, "s1");

		expect(() =>
			db
				.prepare(`UPDATE workspace_sessions SET previewPort = ? WHERE id = ?`)
				.run(10000, "s2"),
		).toThrow(/UNIQUE/i);

		db.prepare(
			`INSERT INTO projects (id, name, userId, status) VALUES (?, ?, ?, ?)`,
		).run("p2", "Other", "u1", "ready");
		db.prepare(
			`INSERT INTO workspace_sessions (id, projectId, userId, status, previewPort) VALUES (?, ?, ?, ?, ?)`,
		).run("s3", "p2", "u1", "active", 10000);

		const other = db
			.prepare(`SELECT previewPort FROM workspace_sessions WHERE id = ?`)
			.get("s3") as { previewPort: number };
		expect(other.previewPort).toBe(10000);
	});
});
