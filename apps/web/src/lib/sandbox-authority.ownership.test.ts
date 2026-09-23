import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it } from "vitest";
import type { createDb } from "#/db";
import {
	createSandboxAuthority,
	SandboxAuthorityError,
} from "./sandbox-authority";

type Db = ReturnType<typeof createDb>;

function createAuthoritySql() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE workspace_sessions (
			id text PRIMARY KEY NOT NULL,
			projectId text NOT NULL,
			userId text NOT NULL,
			status text NOT NULL DEFAULT 'active',
			runtimeOwner text NOT NULL DEFAULT 'legacy',
			runtimeOwnerVersion integer NOT NULL DEFAULT 1
		);
		CREATE TABLE sandbox_identities (
			id text PRIMARY KEY NOT NULL,
			kind text NOT NULL,
			sandboxId text NOT NULL,
			containerId text NOT NULL,
			userId text NOT NULL,
			projectId text NOT NULL,
			workspaceSessionId text,
			controllerClass text,
			controllerNamespace text,
			incarnationId text,
			incarnationStartedAt integer,
			lifecycleGeneration integer NOT NULL DEFAULT 1,
			state text NOT NULL,
			retiredAt integer,
			created_at integer,
			updated_at integer
		);
		CREATE TABLE privileged_operations (
			id text PRIMARY KEY NOT NULL,
			identityId text NOT NULL,
			lifecycleGeneration integer NOT NULL,
			family text NOT NULL,
			type text NOT NULL,
			contractVersion integer NOT NULL,
			runtimeOwnerVersion integer NOT NULL DEFAULT 1,
			runId text,
			runEpoch integer,
			incarnationId text,
			admissionReference text,
			repository text,
			allowedRefs text,
			maxRequests integer,
			consumedRequests integer NOT NULL DEFAULT 0,
			contractDenials integer NOT NULL DEFAULT 0,
			contractState text,
			openedAt integer NOT NULL,
			expiresAt integer NOT NULL,
			closedAt integer,
			closeReason text,
			correlationId text NOT NULL,
			openSlot text NOT NULL DEFAULT 'open',
			created_at integer,
			updated_at integer
		);
		CREATE UNIQUE INDEX privileged_operations_open_family_uidx
			ON privileged_operations (identityId, family, openSlot);
	`);
	let afterSessionRead: (() => void | Promise<void>) | undefined;
	const db = drizzle(async (query, params, method) => {
		const stmt = sqlite.prepare(query);
		const runAfter =
			afterSessionRead &&
			query.startsWith("select") &&
			query.includes("workspace_sessions")
				? afterSessionRead
				: undefined;
		if (runAfter) {
			afterSessionRead = undefined;
		}
		if (method === "run") {
			stmt.run(...(params as never[]));
			await runAfter?.();
			return { rows: [] };
		}
		if (method === "get") {
			const row = stmt.get(...(params as never[])) as
				| Record<string, unknown>
				| undefined;
			await runAfter?.();
			return {
				rows: row ? (Object.values(row) as unknown[]) : (undefined as never),
			};
		}
		const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
		await runAfter?.();
		return { rows: rows.map((row) => Object.values(row)) };
	}) as unknown as Db;
	return {
		db,
		sqlite,
		onSessionRead(callback: () => void | Promise<void>) {
			afterSessionRead = callback;
		},
	};
}

function seedWorkspaceIdentity(
	sqlite: DatabaseSync,
	options: {
		owner?: string;
		version?: number;
		incarnationId?: string | null;
		sessionId?: string | null;
		kind?: string;
	} = {},
) {
	const sessionId = options.sessionId === undefined ? "s" : options.sessionId;
	if (sessionId) {
		sqlite
			.prepare(
				`INSERT INTO workspace_sessions (id, projectId, userId, runtimeOwner, runtimeOwnerVersion)
				 VALUES (?, 'p', 'u', ?, ?)`,
			)
			.run(sessionId, options.owner ?? "legacy", options.version ?? 1);
	}
	sqlite
		.prepare(
			`INSERT INTO sandbox_identities (
				id, kind, sandboxId, containerId, userId, projectId, workspaceSessionId,
				incarnationId, lifecycleGeneration, state
			) VALUES ('i', ?, 'sb', 'opaque-container', 'u', 'p', ?, ?, 1, 'ready')`,
		)
		.run(
			options.kind ?? "workspace_session",
			sessionId,
			options.incarnationId ?? null,
		);
}

describe("sandbox authority ownership SQL fence", () => {
	it("opens a valid legacy builder without fabricating workspace membership", async () => {
		const { db, sqlite } = createAuthoritySql();
		sqlite
			.prepare(
				`INSERT INTO sandbox_identities (
					id, kind, sandboxId, containerId, userId, projectId, workspaceSessionId,
					lifecycleGeneration, state
				) VALUES ('builder', 'project_seed', 'sb', 'c', 'u', 'p', NULL, 1, 'ready')`,
			)
			.run();
		const authority = createSandboxAuthority(db);
		const operation = await authority.openOperation({
			identityId: "builder",
			family: "git_transport",
			type: "project_seed_fetch",
			contractVersion: 1,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(operation.runtimeOwnerVersion).toBe(1);
		expect(
			sqlite.prepare("SELECT workspaceSessionId FROM sandbox_identities").get(),
		).toEqual({ workspaceSessionId: null });
	});

	it("denies migrating, blocked, and trusted owners for new operations and callbacks", async () => {
		for (const owner of ["migrating", "blocked", "trusted_v1"] as const) {
			const { db, sqlite } = createAuthoritySql();
			seedWorkspaceIdentity(sqlite, { owner, version: 2 });
			sqlite
				.prepare(
					`INSERT INTO privileged_operations (
						id, identityId, lifecycleGeneration, family, type, contractVersion,
						runtimeOwnerVersion, openedAt, expiresAt, correlationId, openSlot
					) VALUES ('op', 'i', 1, 'model', 'agent_run', 1, 1, 1, 4102444800, 'corr', 'open')`,
				)
				.run();
			const authority = createSandboxAuthority(db);
			await expect(
				authority.openOperation({
					identityId: "i",
					family: "git_transport",
					type: "git_fetch",
					contractVersion: 1,
					expiresAt: new Date(Date.now() + 60_000),
				}),
			).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
			await expect(
				authority.resolveOutboundRequest(
					{
						identityId: "i",
						lifecycleGeneration: 1,
						containerId: "opaque-container",
					},
					"model",
				),
			).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
		}
	});

	it("uses the current owner version after a round trip instead of defaulting to 1", async () => {
		const { db, sqlite } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite, { owner: "legacy", version: 3 });
		const authority = createSandboxAuthority(db);
		const operation = await authority.openOperation({
			identityId: "i",
			family: "model",
			type: "agent_run",
			contractVersion: 1,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(operation.runtimeOwnerVersion).toBe(3);
	});

	it("blocks a stale owner version after a round trip", async () => {
		const { db, sqlite } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite, { owner: "legacy", version: 3 });
		sqlite
			.prepare(
				`INSERT INTO privileged_operations (
					id, identityId, lifecycleGeneration, family, type, contractVersion,
					runtimeOwnerVersion, openedAt, expiresAt, correlationId, openSlot
				) VALUES ('op', 'i', 1, 'model', 'agent_run', 1, 1, 1, 4102444800, 'corr', 'open')`,
			)
			.run();
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: "i",
					lifecycleGeneration: 1,
					containerId: "opaque-container",
				},
				"model",
			),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
	});

	it("does not let a missing caller incarnation bypass a stored required incarnation", async () => {
		const { db, sqlite } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite, { incarnationId: "inc-1" });
		sqlite
			.prepare(
				`INSERT INTO privileged_operations (
					id, identityId, lifecycleGeneration, family, type, contractVersion,
					runtimeOwnerVersion, incarnationId, openedAt, expiresAt, correlationId, openSlot
				) VALUES ('op', 'i', 1, 'model', 'agent_run', 1, 1, 'inc-1', 1, 4102444800, 'corr', 'open')`,
			)
			.run();
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: "i",
					lifecycleGeneration: 1,
					containerId: "opaque-container",
				},
				"model",
			),
		).rejects.toMatchObject({ code: "incarnation_mismatch" });
	});

	it("rechecks ownership between identity read and operation insert", async () => {
		const { db, sqlite, onSessionRead } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		onSessionRead(() => {
			sqlite
				.prepare(
					`UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2 WHERE id = 's'`,
				)
				.run();
		});
		const authority = createSandboxAuthority(db);
		await expect(
			authority.openOperation({
				identityId: "i",
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM privileged_operations").get(),
		).toEqual({ n: 0 });
	});

	it("keeps trusted brain windows closed", async () => {
		const { db, sqlite } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite, { kind: "trusted_brain" });
		const authority = createSandboxAuthority(db);
		await expect(
			authority.openOperation({
				identityId: "i",
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toBeInstanceOf(SandboxAuthorityError);
		await expect(
			authority.openOperation({
				identityId: "i",
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toMatchObject({ code: "trusted_windows_closed" });
	});

	function seedOpenModel(
		sqlite: DatabaseSync,
		options: {
			maxRequests?: number | null;
			incarnationId?: string | null;
		} = {},
	) {
		sqlite
			.prepare(
				`INSERT INTO privileged_operations (
					id, identityId, lifecycleGeneration, family, type, contractVersion,
					runtimeOwnerVersion, incarnationId, maxRequests, openedAt, expiresAt, correlationId, openSlot
				) VALUES ('op', 'i', 1, 'model', 'agent_run', 1, 1, ?, ?, 1, 4102444800, 'corr', 'open')`,
			)
			.run(
				options.incarnationId ?? null,
				options.maxRequests === undefined ? null : options.maxRequests,
			);
	}

	const callbackCtx = {
		identityId: "i",
		lifecycleGeneration: 1,
		containerId: "opaque-container",
	};

	it("denies an unlimited callback when ownership changes after the owner read", async () => {
		const { db, sqlite, onSessionRead } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		seedOpenModel(sqlite);
		onSessionRead(() => {
			sqlite
				.prepare(
					`UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2 WHERE id = 's'`,
				)
				.run();
		});
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(callbackCtx, "model"),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
	});

	it("denies a non-consuming callback when ownership changes after the owner read", async () => {
		const { db, sqlite, onSessionRead } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		seedOpenModel(sqlite);
		onSessionRead(() => {
			sqlite
				.prepare(
					`UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2 WHERE id = 's'`,
				)
				.run();
		});
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(callbackCtx, "model", {
				consume: false,
			}),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
	});

	it("denies bounded consumption when ownership changes after the owner read", async () => {
		const { db, sqlite, onSessionRead } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		seedOpenModel(sqlite, { maxRequests: 4 });
		onSessionRead(() => {
			sqlite
				.prepare(
					`UPDATE workspace_sessions SET runtimeOwner = 'migrating', runtimeOwnerVersion = 2 WHERE id = 's'`,
				)
				.run();
		});
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(callbackCtx, "model"),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
		expect(
			sqlite
				.prepare("SELECT consumedRequests FROM privileged_operations")
				.get(),
		).toEqual({ consumedRequests: 0 });
	});

	it("rejects an explicit caller owner-version mismatch", async () => {
		const { db, sqlite } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		seedOpenModel(sqlite);
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(
				{ ...callbackCtx, runtimeOwnerVersion: 99 },
				"model",
			),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
	});

	it("rejects operation insertion after an actual lifecycle rotation", async () => {
		const { db, sqlite, onSessionRead } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		const authority = createSandboxAuthority(db);
		onSessionRead(async () => {
			await authority.rotateGeneration("i");
		});
		await expect(
			authority.openOperation({
				identityId: "i",
				family: "git_transport",
				type: "git_fetch",
				contractVersion: 1,
				expiresAt: new Date(4102444800000),
			}),
		).rejects.toMatchObject({ code: "runtime_owner_mismatch" });
		expect(
			sqlite
				.prepare("SELECT lifecycleGeneration FROM sandbox_identities")
				.get(),
		).toEqual({ lifecycleGeneration: 2 });
		expect(
			sqlite.prepare("SELECT count(*) AS n FROM privileged_operations").get(),
		).toEqual({ n: 0 });
	});

	it("rejects a missing caller run epoch when the stored operation requires one", async () => {
		const { db, sqlite } = createAuthoritySql();
		seedWorkspaceIdentity(sqlite);
		sqlite
			.prepare(
				`INSERT INTO privileged_operations (
					id, identityId, lifecycleGeneration, family, type, contractVersion,
					runtimeOwnerVersion, runEpoch, openedAt, expiresAt, correlationId, openSlot
				) VALUES ('op', 'i', 1, 'model', 'agent_run', 1, 1, 7, 1, 4102444800, 'corr', 'open')`,
			)
			.run();
		const authority = createSandboxAuthority(db);
		await expect(
			authority.resolveOutboundRequest(callbackCtx, "model"),
		).rejects.toMatchObject({ code: "run_epoch_mismatch" });
	});
});
