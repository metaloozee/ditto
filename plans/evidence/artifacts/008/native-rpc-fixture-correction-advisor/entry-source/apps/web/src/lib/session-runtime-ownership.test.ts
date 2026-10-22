import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it } from "vitest";
import type { createDb } from "#/db";
import { readCurrentTrustedAuthority } from "./session-runtime-authority";
import {
	assertRuntimeOwner,
	RuntimeOwnershipError,
	transitionRuntimeOwner,
} from "./session-runtime-ownership";

type Db = ReturnType<typeof createDb>;
function fixture() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(
		"CREATE TABLE workspace_sessions (id TEXT PRIMARY KEY, runtimeOwner TEXT NOT NULL DEFAULT 'legacy', runtimeOwnerVersion INTEGER NOT NULL DEFAULT 1, updated_at INTEGER, userId TEXT DEFAULT 'owner', projectId TEXT DEFAULT 'project', status TEXT DEFAULT 'active', brainIdentityId TEXT, sandboxIdentityId TEXT)",
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
	it("requires the exact candidate owner and version without granting legacy authority", () => {
		const session = {
			id: "s",
			runtimeOwner: "pi_durable_v1" as const,
			runtimeOwnerVersion: 1,
		};
		expect(() =>
			assertRuntimeOwner({
				session,
				expectedOwner: "pi_durable_v1",
				ownerVersion: 1,
			}),
		).not.toThrow();
		for (const expectedOwner of ["legacy", "trusted_v1"] as const) {
			expect(() =>
				assertRuntimeOwner({ session, expectedOwner, ownerVersion: 1 }),
			).toThrow(RuntimeOwnershipError);
		}
		expect(() =>
			assertRuntimeOwner({
				session,
				expectedOwner: "pi_durable_v1",
				ownerVersion: 2,
			}),
		).toThrow(RuntimeOwnershipError);
	});
	it("never migrates an existing owner into or out of the candidate", async () => {
		const { db, sqlite } = fixture();
		for (const from of [
			"legacy",
			"migrating",
			"trusted_v1",
			"blocked",
		] as const) {
			await expect(
				transitionRuntimeOwner({
					db,
					sessionId: "s",
					from,
					fromVersion: 1,
					to: "pi_durable_v1",
				}),
			).rejects.toMatchObject({ code: "runtime_owner_transition_conflict" });
		}
		for (const to of [
			"legacy",
			"migrating",
			"trusted_v1",
			"blocked",
		] as const) {
			await expect(
				transitionRuntimeOwner({
					db,
					sessionId: "s",
					from: "pi_durable_v1",
					fromVersion: 1,
					to,
				}),
			).rejects.toMatchObject({ code: "runtime_owner_transition_conflict" });
		}
		expect(
			sqlite
				.prepare(
					"SELECT runtimeOwner,runtimeOwnerVersion FROM workspace_sessions WHERE id='s'",
				)
				.get(),
		).toMatchObject({ runtimeOwner: "legacy", runtimeOwnerVersion: 1 });
	});
	it("denies candidate sessions before the old coordinator reads identities or capacity", async () => {
		const { db, sqlite } = fixture();
		sqlite
			.prepare(
				"UPDATE workspace_sessions SET runtimeOwner='pi_durable_v1' WHERE id='s'",
			)
			.run();
		await expect(
			readCurrentTrustedAuthority(db, {
				workspaceSessionId: "s",
				userId: "owner",
				projectId: "project",
			}),
		).resolves.toBeNull();
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
