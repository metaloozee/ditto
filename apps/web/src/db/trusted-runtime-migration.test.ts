import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	new URL(
		"../../migrations/0020_trusted_runtime_additive.sql",
		import.meta.url,
	),
	"utf8",
).replaceAll("--> statement-breakpoint", "");

function legacyDatabase() {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(`
		CREATE TABLE user (id TEXT PRIMARY KEY);
		CREATE TABLE projects (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, contentHash TEXT NOT NULL);
		CREATE TABLE workspace_sessions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
		CREATE TABLE messages (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE, content TEXT NOT NULL);
		CREATE TABLE archives (id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, digest TEXT NOT NULL);
		CREATE TABLE sandbox_identities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, sandboxId TEXT NOT NULL, containerId TEXT NOT NULL, userId TEXT NOT NULL, projectId TEXT NOT NULL, workspaceSessionId TEXT, lifecycleGeneration INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL, retiredAt INTEGER, created_at INTEGER, updated_at INTEGER);
		CREATE TABLE privileged_operations (id TEXT PRIMARY KEY, identityId TEXT NOT NULL, lifecycleGeneration INTEGER NOT NULL, family TEXT NOT NULL, type TEXT NOT NULL, contractVersion INTEGER NOT NULL, repository TEXT, allowedRefs TEXT, maxRequests INTEGER, consumedRequests INTEGER NOT NULL DEFAULT 0, contractDenials INTEGER NOT NULL DEFAULT 0, contractState TEXT, openedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, closedAt INTEGER, closeReason TEXT, correlationId TEXT NOT NULL, openSlot TEXT NOT NULL DEFAULT 'open', created_at INTEGER, updated_at INTEGER);
		CREATE UNIQUE INDEX privileged_operations_open_family_uidx ON privileged_operations (identityId, family, openSlot);
		CREATE TABLE project_seeds (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, sourceCommit TEXT, archiveId TEXT, formatVersion INTEGER NOT NULL, compatibilityKey TEXT NOT NULL, buildState TEXT NOT NULL, failureReasonCode TEXT, created_at INTEGER, updated_at INTEGER);
		CREATE TABLE workspace_runtime_work (id TEXT PRIMARY KEY, fifoSeq INTEGER NOT NULL, identityId TEXT, sessionId TEXT, projectId TEXT NOT NULL, userId TEXT NOT NULL, intent TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'queued', leaseToken TEXT, leaseExpiresAt INTEGER, retryCount INTEGER NOT NULL DEFAULT 0, reasonCode TEXT, queueExpiresAt INTEGER NOT NULL, userMessageId TEXT, assistantMessageId TEXT, created_at INTEGER, updated_at INTEGER);
		CREATE UNIQUE INDEX workspace_runtime_work_fifoSeq_uidx ON workspace_runtime_work(fifoSeq);
		CREATE UNIQUE INDEX workspace_runtime_work_assistantMessageId_uidx ON workspace_runtime_work(assistantMessageId);
		CREATE TABLE workspace_capacity_leases (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, userId TEXT NOT NULL, identityId TEXT, leaseToken TEXT NOT NULL, expiresAt INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER);
	`);
	db.exec(
		`INSERT INTO user VALUES ('u'); INSERT INTO projects VALUES ('p','u','project-hash'); INSERT INTO workspace_sessions VALUES ('s','p','u'); INSERT INTO messages VALUES ('m','s','message-content'); INSERT INTO archives VALUES ('a','s','archive-digest'); INSERT INTO sandbox_identities (id,kind,sandboxId,containerId,userId,projectId,workspaceSessionId,lifecycleGeneration,state) VALUES ('i','workspace_session','opaque-sandbox','opaque-container','u','p','s',1,'ready'); INSERT INTO privileged_operations (id,identityId,lifecycleGeneration,family,type,contractVersion,openedAt,expiresAt,correlationId,openSlot) VALUES ('op','i',1,'model','agent_run',1,1,2,'corr','open'); INSERT INTO workspace_capacity_leases (id,sessionId,userId,identityId,leaseToken,expiresAt) VALUES ('lease','s','u','i','token',9999999999);`,
	);
	return db;
}

function counts(db: DatabaseSync) {
	return {
		users: db.prepare("SELECT count(*) AS count FROM user").get(),
		projects: db.prepare("SELECT count(*) AS count FROM projects").get(),
		sessions: db
			.prepare("SELECT count(*) AS count FROM workspace_sessions")
			.get(),
		messages: db.prepare("SELECT count(*) AS count FROM messages").get(),
		identities: db
			.prepare("SELECT count(*) AS count FROM sandbox_identities")
			.get(),
		archives: db.prepare("SELECT count(*) AS count FROM archives").get(),
		leases: db
			.prepare("SELECT count(*) AS count FROM workspace_capacity_leases")
			.get(),
		openOps: db
			.prepare(
				"SELECT count(*) AS count FROM privileged_operations WHERE openSlot='open'",
			)
			.get(),
	};
}

describe("0020 trusted runtime additive migration", () => {
	it("preserves retained rows and interprets every existing session as legacy", () => {
		const db = legacyDatabase();
		const before = counts(db);
		db.exec(migration);
		expect(counts(db)).toEqual(before);
		expect(
			db.prepare("SELECT contentHash FROM projects WHERE id='p'").get(),
		).toEqual({
			contentHash: "project-hash",
		});
		expect(
			db.prepare("SELECT content FROM messages WHERE id='m'").get(),
		).toEqual({
			content: "message-content",
		});
		expect(
			db.prepare("SELECT digest FROM archives WHERE id='a'").get(),
		).toEqual({
			digest: "archive-digest",
		});
		expect(
			db
				.prepare(
					"SELECT runtimeOwner, runtimeOwnerVersion FROM workspace_sessions WHERE id='s'",
				)
				.get(),
		).toEqual({ runtimeOwner: "legacy", runtimeOwnerVersion: 1 });
		expect(
			db
				.prepare(
					"SELECT accountingMode, version FROM runtime_capacity_policy WHERE id=1",
				)
				.get(),
		).toEqual({ accountingMode: "legacy", version: 1 });
		expect(
			db
				.prepare(
					"SELECT count(*) AS count FROM workspace_sessions WHERE runtimeOwner != 'legacy'",
				)
				.get(),
		).toEqual({ count: 0 });
	});

	it("enforces dedupe, sequence, target and accounting constraints", () => {
		const db = legacyDatabase();
		db.exec(migration);
		const key = "INSERT INTO session_command_keys VALUES (?,?,?,?,?,?,?,?,?,?)";
		db.prepare(key).run(
			"k1",
			"u",
			"project",
			"p",
			"same",
			"prompt",
			"hash",
			"c1",
			"r1",
			1,
		);
		expect(() =>
			db
				.prepare(key)
				.run(
					"k2",
					"u",
					"project",
					"p",
					"same",
					"prompt",
					"other",
					"c2",
					"r2",
					2,
				),
		).toThrow(/UNIQUE/);
		expect(() =>
			db
				.prepare(
					"UPDATE runtime_capacity_policy SET accountingMode='bogus' WHERE id=1",
				)
				.run(),
		).toThrow(/CHECK/);
		expect(() =>
			db
				.prepare(
					"INSERT INTO session_commands (id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,payloadVersion,payloadDigest,acceptedAt,deadlineAt,userMessageId,assistantMessageId) VALUES ('c','u','project','p','p',NULL,'prompt',NULL,1,'h',1,2,'m1','m2')",
				)
				.run(),
		).toThrow(/CHECK/);
		expect(() =>
			db
				.prepare("INSERT INTO session_command_sequences VALUES ('s',0,1)")
				.run(),
		).toThrow(/CHECK/);
		db.prepare(
			"INSERT INTO session_commands (id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetCommandId,payloadVersion,payloadDigest,acceptedAt,deadlineAt) VALUES ('cancel-1','u','workspace_session','s','p','s','cancel',1,'queued-cmd',1,'h',1,2)",
		).run();
		expect(() =>
			db
				.prepare(
					"INSERT INTO session_commands (id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,targetRunId,payloadVersion,payloadDigest,acceptedAt,deadlineAt) VALUES ('cancel-2','u','workspace_session','s','p','s','cancel',2,'run-1',1,'h',1,2)",
				)
				.run(),
		).toThrow(/CHECK/);
		expect(
			db
				.prepare(
					"SELECT count(*) AS count FROM session_commands GROUP BY sessionId, commandSeq HAVING count(*) > 1",
				)
				.all(),
		).toEqual([]);
		expect(
			db
				.prepare(
					"SELECT count(*) AS count FROM privileged_operations WHERE openSlot='open' GROUP BY identityId, family HAVING count(*) > 1",
				)
				.all(),
		).toEqual([]);
	});

	it("rolls back command sequence and messages when one acceptance statement fails", () => {
		const db = legacyDatabase();
		db.exec(migration);
		expect(() =>
			db.exec(
				`BEGIN; INSERT INTO session_command_sequences VALUES ('s',2,1); INSERT INTO messages VALUES ('new','s','new'); INSERT INTO session_commands (id,userId,targetKind,targetId,projectId,sessionId,kind,commandSeq,payloadVersion,payloadDigest,acceptedAt,deadlineAt,userMessageId,assistantMessageId) VALUES ('c','u','workspace_session','s','p','s','prompt',0,1,'h',1,2,'new','assistant'); COMMIT;`,
			),
		).toThrow(/CHECK/);
		if (db.isTransaction) db.exec("ROLLBACK");
		expect(
			db.prepare("SELECT id FROM messages WHERE id='new'").get(),
		).toBeUndefined();
		expect(
			db
				.prepare(
					"SELECT sessionId FROM session_command_sequences WHERE sessionId='s'",
				)
				.get(),
		).toBeUndefined();
	});

	it("keeps cleanup and identity fences after cascading product and auth deletion", () => {
		const db = legacyDatabase();
		db.exec(migration);
		db.prepare(
			"INSERT INTO runtime_deleted_target_fences VALUES ('workspace_session','s',2,1)",
		).run();
		db.prepare(
			"INSERT INTO runtime_retired_identity_fences VALUES ('i',2,1)",
		).run();
		db.prepare(
			"INSERT INTO runtime_cleanup_jobs VALUES ('job-1','workspace_session','s','pending',NULL,0,1)",
		).run();
		db.prepare(
			"INSERT INTO runtime_projection_cursors VALUES ('s','command','cmd-1',1,1,1)",
		).run();
		db.prepare(
			"INSERT INTO runtime_command_memberships VALUES ('cmd-1','s',NULL,'m',NULL,NULL)",
		).run();
		db.prepare("DELETE FROM user WHERE id='u'").run();
		expect(
			db.prepare("SELECT id FROM projects WHERE id='p'").get(),
		).toBeUndefined();
		expect(
			db.prepare("SELECT id FROM workspace_sessions WHERE id='s'").get(),
		).toBeUndefined();
		expect(
			db.prepare("SELECT targetId FROM runtime_deleted_target_fences").get(),
		).toEqual({
			targetId: "s",
		});
		expect(
			db
				.prepare("SELECT identityId FROM runtime_retired_identity_fences")
				.get(),
		).toEqual({
			identityId: "i",
		});
		expect(db.prepare("SELECT id FROM runtime_cleanup_jobs").get()).toEqual({
			id: "job-1",
		});
		expect(
			db.prepare("SELECT targetId FROM runtime_projection_cursors").get(),
		).toEqual({
			targetId: "cmd-1",
		});
	});

	it("changes accounting mode only with the observed version while legacy claims remain visible", () => {
		const db = legacyDatabase();
		db.exec(migration);
		const stale = db
			.prepare(
				"UPDATE runtime_capacity_policy SET accountingMode='unified', version=version+1 WHERE id=1 AND accountingMode='legacy' AND version=2",
			)
			.run();
		expect(stale.changes).toBe(0);
		expect(
			db
				.prepare("SELECT count(*) AS count FROM workspace_capacity_leases")
				.get(),
		).toEqual({
			count: 1,
		});
		const current = db
			.prepare(
				"UPDATE runtime_capacity_policy SET accountingMode='unified', version=version+1 WHERE id=1 AND accountingMode='legacy' AND version=1",
			)
			.run();
		expect(current.changes).toBe(1);
		expect(() =>
			db
				.prepare(
					"INSERT INTO runtime_capacity_policy (id, accountingMode, version, updatedAt) VALUES (2,'legacy',1,1)",
				)
				.run(),
		).toThrow(/CHECK/);
	});
});
