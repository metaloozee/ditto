import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it } from "vitest";
import type { createDb } from "#/db";
import {
	assertRuntimeOwner,
	RuntimeOwnershipError,
	transitionRuntimeOwner,
} from "./session-runtime-ownership";

type Db = ReturnType<typeof createDb>;
function fixture() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(
		"CREATE TABLE workspace_sessions (id TEXT PRIMARY KEY, runtimeOwner TEXT NOT NULL DEFAULT 'legacy', runtimeOwnerVersion INTEGER NOT NULL DEFAULT 1, updated_at INTEGER)",
	);
	sqlite.prepare("INSERT INTO workspace_sessions (id) VALUES ('s')").run();
	const db = drizzle(async (query, params, method) => {
		const stmt = sqlite.prepare(query);
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
		return { rows: rows.map((row) => Object.values(row)) };
	}) as unknown as Db;
	return { db, sqlite };
}

describe("session runtime ownership", () => {
	it("rejects owner or version mismatches", () => {
		expect(() =>
			assertRuntimeOwner({
				session: { id: "s", runtimeOwner: "legacy", runtimeOwnerVersion: 2 },
				expectedOwner: "legacy",
				ownerVersion: 1,
			}),
		).toThrow(RuntimeOwnershipError);
		expect(() =>
			assertRuntimeOwner({
				session: { id: "s", runtimeOwner: "migrating", runtimeOwnerVersion: 1 },
				expectedOwner: "legacy",
				ownerVersion: 1,
			}),
		).toThrow(/ownership changed/);
		expect(() =>
			assertRuntimeOwner({
				session: { id: "s", runtimeOwner: "blocked", runtimeOwnerVersion: 1 },
				expectedOwner: "trusted_v1",
				ownerVersion: 1,
			}),
		).toThrow(RuntimeOwnershipError);
	});
	it("moves through migrating with a SQL compare-and-set", async () => {
		const { db } = fixture();
		await expect(
			transitionRuntimeOwner({
				db,
				sessionId: "s",
				from: "legacy",
				fromVersion: 1,
				to: "migrating",
			}),
		).resolves.toMatchObject({
			runtimeOwner: "migrating",
			runtimeOwnerVersion: 2,
		});
		await expect(
			transitionRuntimeOwner({
				db,
				sessionId: "s",
				from: "legacy",
				fromVersion: 1,
				to: "migrating",
			}),
		).rejects.toMatchObject({ code: "runtime_owner_transition_conflict" });
	});
	it("does not permit a direct legacy to trusted transition", async () => {
		const { db } = fixture();
		await expect(
			transitionRuntimeOwner({
				db,
				sessionId: "s",
				from: "legacy",
				fromVersion: 1,
				to: "trusted_v1",
			}),
		).rejects.toMatchObject({ code: "runtime_owner_transition_conflict" });
	});
});
