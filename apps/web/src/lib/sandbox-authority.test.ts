import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it } from "vitest";
import type { createDb } from "#/db";
import {
	createSandboxAuthority,
	SandboxAuthorityError,
} from "./sandbox-authority";

type Db = ReturnType<typeof createDb>;

function makeAuthorityDb() {
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
		INSERT INTO workspace_sessions (id, projectId, userId, runtimeOwner, runtimeOwnerVersion)
		VALUES ('sess-1', 'proj-1', 'user-1', 'legacy', 1);
	`);
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

describe("SandboxAuthority", () => {
	let store: ReturnType<typeof makeAuthorityDb>;
	let authority: ReturnType<typeof createSandboxAuthority>;

	beforeEach(() => {
		store = makeAuthorityDb();
		authority = createSandboxAuthority(store.db);
	});

	async function register() {
		return authority.registerIdentity({
			kind: "project_seed",
			sandboxId: "sbx-1",
			containerId: "container-1",
			userId: "user-1",
			projectId: "proj-1",
		});
	}

	it("unknown identity fails resolve before any token mint would run", async () => {
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: "missing",
					lifecycleGeneration: 1,
					containerId: "container-1",
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "identity_not_found" });
	});

	it("stale generation fails", async () => {
		const identity = await register();
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 99,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "generation_mismatch" });
	});

	it("containerId mismatch fails", async () => {
		const identity = await register();
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: "other-container",
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "container_mismatch" });
	});

	it("retired identity fails", async () => {
		const identity = await register();
		await authority.retireIdentity(identity.id);
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "identity_retired" });
		const tombstone = await authority.getIdentity(identity.id);
		expect(tombstone?.retiredAt).toBeInstanceOf(Date);
		expect(tombstone?.state).toBe("destroyed");
	});

	it("one identity cannot open two git_transport operations", async () => {
		const identity = await register();
		await authority.openOperation({
			identityId: identity.id,
			family: "git_transport",
			type: "project_seed_fetch",
			contractVersion: 1,
			repository: "acme/app",
			allowedRefs: ["refs/heads/main"],
			expiresAt: new Date(Date.now() + 60_000),
		});
		await expect(
			authority.openOperation({
				identityId: identity.id,
				family: "git_transport",
				type: "project_seed_fetch",
				contractVersion: 1,
				repository: "acme/app",
				allowedRefs: ["refs/heads/main"],
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toMatchObject({ code: "operation_already_open" });
	});

	it("withOperation closes on throw", async () => {
		const identity = await register();
		await expect(
			authority.withOperation(
				{
					identityId: identity.id,
					family: "git_transport",
					type: "project_seed_fetch",
					contractVersion: 1,
					expiresAt: new Date(Date.now() + 60_000),
				},
				async () => {
					throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");

		const open = store.sqlite
			.prepare("SELECT id FROM privileged_operations WHERE closedAt IS NULL")
			.all();
		expect(open).toHaveLength(0);
		const closed = store.sqlite
			.prepare("SELECT id, closeReason, openSlot FROM privileged_operations")
			.get() as { id: string; closeReason: string; openSlot: string };
		expect(closed.closeReason).toBe("with_operation_settled");
		expect(closed.openSlot).toBe(closed.id);
	});

	it("missing open operation carries no authority", async () => {
		const identity = await register();
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toBeInstanceOf(SandboxAuthorityError);
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"git_transport",
			),
		).rejects.toMatchObject({ code: "operation_not_open" });
	});

	it("resolve succeeds only with matching open operation", async () => {
		const identity = await register();
		await authority.openOperation({
			identityId: identity.id,
			family: "git_transport",
			type: "project_seed_fetch",
			contractVersion: 1,
			repository: "acme/app",
			allowedRefs: ["refs/heads/main"],
			expiresAt: new Date(Date.now() + 60_000),
		});
		const resolved = await authority.resolveOutboundRequest(
			{
				identityId: identity.id,
				lifecycleGeneration: 1,
				containerId: identity.containerId,
			},
			"git_transport",
		);
		expect(resolved.operation.repository).toBe("acme/app");
		expect(resolved.operation.allowedRefs).toEqual(["refs/heads/main"]);
	});

	it("git_metadata consumes exactly one request under concurrent resolve", async () => {
		const identity = await register();
		await authority.openOperation({
			identityId: identity.id,
			family: "model",
			type: "git_metadata",
			contractVersion: 1,
			maxRequests: 1,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const ctx = {
			identityId: identity.id,
			lifecycleGeneration: 1,
			containerId: identity.containerId,
		};
		const results = await Promise.allSettled([
			authority.resolveOutboundRequest(ctx, "model"),
			authority.resolveOutboundRequest(ctx, "model"),
		]);
		const fulfilled = results.filter((result) => result.status === "fulfilled");
		const rejected = results.filter((result) => result.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({
			status: "rejected",
			reason: expect.objectContaining({ code: "operation_exhausted" }),
		});
	});

	it("agent_run allows multiple valid resolves until closed", async () => {
		const identity = await register();
		const operation = await authority.openOperation({
			identityId: identity.id,
			family: "model",
			type: "agent_run",
			contractVersion: 1,
			maxRequests: null,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const ctx = {
			identityId: identity.id,
			lifecycleGeneration: 1,
			containerId: identity.containerId,
		};
		await authority.resolveOutboundRequest(ctx, "model");
		await authority.resolveOutboundRequest(ctx, "model");
		await authority.closeOperation(operation.id, "agent_run_settled");
		await expect(
			authority.resolveOutboundRequest(ctx, "model"),
		).rejects.toMatchObject({ code: "operation_not_open" });
	});

	it("three contract denials close the operation", async () => {
		const identity = await authority.registerIdentity({
			kind: "workspace_session",
			sandboxId: "sbx-session",
			containerId: "container-1",
			userId: "user-1",
			projectId: "proj-1",
			workspaceSessionId: "sess-1",
		});
		const operation = await authority.openOperation({
			identityId: identity.id,
			family: "model",
			type: "agent_run",
			contractVersion: 1,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const first = await authority.recordContractDenial(operation.id);
		const second = await authority.recordContractDenial(operation.id);
		const third = await authority.recordContractDenial(operation.id);
		expect(first).toMatchObject({ denials: 1, closed: false });
		expect(second).toMatchObject({ denials: 2, closed: false });
		expect(third).toMatchObject({
			denials: 3,
			closed: true,
			workspaceSessionId: "sess-1",
		});
		const closed = store.sqlite
			.prepare(
				"SELECT closedAt, closeReason FROM privileged_operations WHERE id = ?",
			)
			.get(operation.id) as { closedAt: number | null; closeReason: string };
		expect(closed.closedAt).toEqual(expect.any(Number));
		expect(closed.closeReason).toBe("opencode_contract_denial_limit");
	});

	it("opens builder operations when the identity has no workspace session", async () => {
		const identity = await register();
		expect(identity.workspaceSessionId).toBeNull();
		const operation = await authority.openOperation({
			identityId: identity.id,
			family: "git_transport",
			type: "project_seed_fetch",
			contractVersion: 1,
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(operation.runtimeOwnerVersion).toBe(1);
		expect(operation.runId).toBeNull();
	});

	it("does not open trusted brain operation windows", async () => {
		const identity = await authority.registerIdentity({
			kind: "trusted_brain",
			sandboxId: "brain-1",
			containerId: "brain-container",
			userId: "user-1",
			projectId: "proj-1",
			workspaceSessionId: "sess-1",
		});
		await expect(
			authority.openOperation({
				identityId: identity.id,
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toMatchObject({ code: "trusted_windows_closed" });
		await expect(
			authority.resolveOutboundRequest(
				{
					identityId: identity.id,
					lifecycleGeneration: 1,
					containerId: identity.containerId,
				},
				"model",
			),
		).rejects.toMatchObject({ code: "trusted_windows_closed" });
	});
});
