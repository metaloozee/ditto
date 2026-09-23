import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it, vi } from "vitest";
import type { createDb } from "#/db";

vi.mock("#/lib/sandbox-bootstrap", () => ({ getProjectSandbox: vi.fn() }));

import {
	deleteProjectRuntime,
	discoverPreviewCommand,
	isAstroVersionSupported,
	isViteVersionSupported,
	parseLeadingSemver,
	resolvePreviewHostname,
	validatePreviewUrl,
} from "./session-preview";

type Db = ReturnType<typeof createDb>;

const DELETION_NOW_SECONDS = 1_700_000_000;

function createDeletionDb() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE projects (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			description text,
			userId text NOT NULL,
			githubRepo text,
			githubInstallationId integer,
			status text NOT NULL DEFAULT 'provisioning',
			envVars text,
			created_at integer,
			updated_at integer
		);
		CREATE TABLE workspace_sessions (
			id text PRIMARY KEY NOT NULL,
			projectId text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			userId text NOT NULL,
			title text,
			branchName text,
			baseCommitSha text,
			status text NOT NULL DEFAULT 'active',
			previewStartedAt integer,
			sandboxIdentityId text,
			runtimeLeaseId text,
			runtimeLeaseExpiresAt integer,
			runtimeFailureReasonCode text,
			runtimeOwner text NOT NULL DEFAULT 'legacy',
			runtimeOwnerVersion integer NOT NULL DEFAULT 1,
			brainIdentityId text,
			runtimeProtocolVersion integer,
			runtimeJournalVersion integer,
			productProjectionVersion integer NOT NULL DEFAULT 0,
			created_at integer,
			updated_at integer
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
			protocolVersion integer,
			runtimeOwner text NOT NULL DEFAULT 'legacy',
			runtimeOwnerVersion integer NOT NULL DEFAULT 1,
			commandId text,
			deliveryState text NOT NULL DEFAULT 'pending',
			deliveryLeaseToken text,
			deliveryLeaseExpiresAt integer,
			deliveryAttempts integer NOT NULL DEFAULT 0,
			startupRoles text,
			startupPools text,
			expectedIdentityId text,
			startupDeadline integer,
			created_at integer,
			updated_at integer
		);
		CREATE TABLE archives (
			id text PRIMARY KEY NOT NULL,
			ownerKind text NOT NULL,
			ownerId text NOT NULL,
			objectKey text NOT NULL,
			formatVersion integer NOT NULL,
			compatibilityKey text NOT NULL,
			byteCount integer NOT NULL DEFAULT 0,
			digest text NOT NULL,
			generation integer NOT NULL DEFAULT 0,
			status text NOT NULL,
			cleanupRetryAt integer,
			cleanupAttempts integer NOT NULL DEFAULT 0,
			created_at integer,
			updated_at integer
		);
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
		return { rows: rows.map((row) => Object.values(row)) };
	}) as unknown as Db;

	return { db, sqlite };
}

function seedDeletionProject(
	sqlite: DatabaseSync,
	options: { projectId?: string; userId?: string; status?: string } = {},
) {
	const projectId = options.projectId ?? "proj-1";
	const userId = options.userId ?? "user-1";
	sqlite
		.prepare(
			`INSERT INTO projects (id, name, userId, status) VALUES (?, 'Project', ?, ?)`,
		)
		.run(projectId, userId, options.status ?? "ready");
	return { projectId, userId };
}

function seedDeletionSession(
	sqlite: DatabaseSync,
	options: {
		id?: string;
		projectId?: string;
		userId?: string;
		identityId?: string | null;
		leaseId?: string | null;
		leaseExpiresAt?: number | null;
	} = {},
) {
	sqlite
		.prepare(
			`INSERT INTO workspace_sessions (
				id, projectId, userId, status, sandboxIdentityId,
				runtimeLeaseId, runtimeLeaseExpiresAt
			) VALUES (?, ?, ?, 'active', ?, ?, ?)`,
		)
		.run(
			options.id ?? "sess-1",
			options.projectId ?? "proj-1",
			options.userId ?? "user-1",
			options.identityId ?? null,
			options.leaseId ?? null,
			options.leaseExpiresAt ?? null,
		);
}

function seedDeletionIdentity(
	sqlite: DatabaseSync,
	options: {
		id?: string;
		sandboxId?: string;
		projectId?: string;
		userId?: string;
		sessionId?: string | null;
	} = {},
) {
	sqlite
		.prepare(
			`INSERT INTO sandbox_identities (
				id, kind, sandboxId, containerId, userId, projectId,
				workspaceSessionId, state
			) VALUES (?, 'workspace_session', ?, 'container-1', ?, ?, ?, 'ready')`,
		)
		.run(
			options.id ?? "identity-1",
			options.sandboxId ?? "sandbox-1",
			options.userId ?? "user-1",
			options.projectId ?? "proj-1",
			options.sessionId ?? null,
		);
}

function seedDeletionArchive(
	sqlite: DatabaseSync,
	options: { id: string; ownerId: string; status: "uploading" | "ready" },
) {
	sqlite
		.prepare(
			`INSERT INTO archives (
				id, ownerKind, ownerId, objectKey, formatVersion,
				compatibilityKey, digest, status
			) VALUES (?, 'workspace_recovery', ?, ?, 1, 'compat', 'digest', ?)`,
		)
		.run(options.id, options.ownerId, `archive/${options.id}`, options.status);
}

function deleteProject(
	db: Db,
	destroySandbox: (args: { env: Env; sandboxId: string }) => Promise<void>,
	options: { projectId?: string; userId?: string } = {},
) {
	return deleteProjectRuntime(
		{
			db,
			env: {} as Env,
			projectId: options.projectId ?? "proj-1",
			userId: options.userId ?? "user-1",
			destroySandbox,
		},
		{ nowSeconds: () => DELETION_NOW_SECONDS },
	);
}

function previewSandbox(packageJson: unknown, files: Record<string, unknown>) {
	return {
		exists: vi.fn(async (path: string) => ({
			exists: path === "/workspace/package.json" || path in files,
		})),
		readFile: vi.fn(async (path: string) => ({
			content:
				path === "/workspace/package.json"
					? JSON.stringify(packageJson)
					: JSON.stringify(files[path]),
		})),
	};
}

describe("project runtime deletion", () => {
	it("rejects deletion by a non-owner without mutating the project", async () => {
		const { db, sqlite } = createDeletionDb();
		seedDeletionProject(sqlite);
		const destroySandbox = vi.fn();

		await expect(
			deleteProject(db, destroySandbox, { userId: "user-2" }),
		).rejects.toMatchObject({ code: "not_found" });

		expect(
			sqlite.prepare("SELECT status FROM projects WHERE id = ?").get("proj-1"),
		).toEqual({ status: "ready" });
		expect(destroySandbox).not.toHaveBeenCalled();
	});

	it("retires authority and cancels work before sandbox cleanup", async () => {
		const { db, sqlite } = createDeletionDb();
		seedDeletionProject(sqlite);
		seedDeletionIdentity(sqlite);
		sqlite
			.prepare(
				`INSERT INTO workspace_runtime_work (
					id, fifoSeq, identityId, projectId, userId, intent,
					status, queueExpiresAt
				) VALUES ('work-1', 1, 'identity-1', 'proj-1', 'user-1',
					'destruction', 'queued', ?)`,
			)
			.run(DELETION_NOW_SECONDS + 60);
		const destroySandbox = vi.fn(async () => {
			expect(
				sqlite
					.prepare(
						"SELECT retiredAt IS NOT NULL AS retired FROM sandbox_identities WHERE id = ?",
					)
					.get("identity-1"),
			).toEqual({ retired: 1 });
			expect(
				sqlite
					.prepare("SELECT status FROM workspace_runtime_work WHERE id = ?")
					.get("work-1"),
			).toEqual({ status: "cancelled" });
		});

		await expect(deleteProject(db, destroySandbox)).resolves.toEqual({
			id: "proj-1",
		});
		expect(destroySandbox).toHaveBeenCalledOnce();
	});

	it("leaves a deleting tombstone while a lifecycle lease is active", async () => {
		const { db, sqlite } = createDeletionDb();
		seedDeletionProject(sqlite);
		seedDeletionSession(sqlite, {
			identityId: "identity-1",
			leaseId: "lease-1",
			leaseExpiresAt: DELETION_NOW_SECONDS + 60,
		});
		seedDeletionIdentity(sqlite, { sessionId: "sess-1" });
		seedDeletionArchive(sqlite, {
			id: "archive-1",
			ownerId: "sess-1",
			status: "ready",
		});
		const destroySandbox = vi.fn();

		await expect(deleteProject(db, destroySandbox)).rejects.toMatchObject({
			code: "busy",
		});

		expect(
			sqlite.prepare("SELECT status FROM projects WHERE id = ?").get("proj-1"),
		).toEqual({ status: "deleting" });
		expect(
			sqlite
				.prepare(
					"SELECT retiredAt IS NOT NULL AS retired FROM sandbox_identities WHERE id = ?",
				)
				.get("identity-1"),
		).toEqual({ retired: 1 });
		expect(
			sqlite
				.prepare("SELECT status FROM archives WHERE id = ?")
				.get("archive-1"),
		).toEqual({ status: "ready" });
		expect(destroySandbox).not.toHaveBeenCalled();
	});

	it("retries failed sandbox destruction without dropping tombstones", async () => {
		const { db, sqlite } = createDeletionDb();
		seedDeletionProject(sqlite);
		seedDeletionIdentity(sqlite);
		const destroySandbox = vi
			.fn()
			.mockRejectedValueOnce(new Error("destroy failed"))
			.mockResolvedValueOnce(undefined);

		await expect(deleteProject(db, destroySandbox)).rejects.toMatchObject({
			code: "cleanup_failed",
		});
		expect(
			sqlite.prepare("SELECT status FROM projects WHERE id = ?").get("proj-1"),
		).toEqual({ status: "deleting" });
		expect(
			sqlite
				.prepare(
					"SELECT retiredAt IS NOT NULL AS retired FROM sandbox_identities WHERE id = ?",
				)
				.get("identity-1"),
		).toEqual({ retired: 1 });

		await expect(deleteProject(db, destroySandbox)).resolves.toEqual({
			id: "proj-1",
		});
		expect(destroySandbox).toHaveBeenCalledTimes(2);
	});

	it("requires every sandbox destroy to succeed before deleting product rows", async () => {
		const { db, sqlite } = createDeletionDb();
		seedDeletionProject(sqlite);
		seedDeletionIdentity(sqlite);
		seedDeletionIdentity(sqlite, {
			id: "identity-2",
			sandboxId: "sandbox-2",
		});
		const destroySandbox = vi.fn(
			async ({ sandboxId }: { sandboxId: string }) => {
				if (sandboxId === "sandbox-2") {
					throw new Error("destroy failed");
				}
			},
		);

		await expect(deleteProject(db, destroySandbox)).rejects.toMatchObject({
			code: "cleanup_failed",
		});
		expect(destroySandbox).toHaveBeenCalledTimes(2);
		expect(
			sqlite.prepare("SELECT status FROM projects WHERE id = ?").get("proj-1"),
		).toEqual({ status: "deleting" });
	});

	it("queues uploading and ready archives for retryable cleanup", async () => {
		const { db, sqlite } = createDeletionDb();
		seedDeletionProject(sqlite);
		seedDeletionSession(sqlite);
		seedDeletionArchive(sqlite, {
			id: "uploading-archive",
			ownerId: "proj-1",
			status: "uploading",
		});
		seedDeletionArchive(sqlite, {
			id: "ready-archive",
			ownerId: "sess-1",
			status: "ready",
		});

		await deleteProject(db, vi.fn());

		expect(
			sqlite
				.prepare(
					`SELECT id, status, cleanupRetryAt, cleanupAttempts
					 FROM archives ORDER BY id`,
				)
				.all(),
		).toEqual([
			{
				id: "ready-archive",
				status: "abandoned",
				cleanupRetryAt: DELETION_NOW_SECONDS + 15,
				cleanupAttempts: 0,
			},
			{
				id: "uploading-archive",
				status: "abandoned",
				cleanupRetryAt: DELETION_NOW_SECONDS + 15,
				cleanupAttempts: 0,
			},
		]);
	});
});

describe("preview policy", () => {
	it("parses strict installed versions", () => {
		expect(parseLeadingSemver("6.1.0")).toEqual([6, 1, 0]);
		expect(parseLeadingSemver("v6.1.0")).toBeNull();
		expect(isViteVersionSupported("6.1.0")).toBe(true);
		expect(isViteVersionSupported("6.0.9")).toBe(false);
		expect(isAstroVersionSupported("5.4.0")).toBe(true);
	});

	it("accepts only the configured local or production host", () => {
		expect(
			resolvePreviewHostname({
				requestUrl: "http://localhost:5173/project/1",
				previewBaseHost: undefined,
			}),
		).toBe("localhost:5173");
		expect(
			resolvePreviewHostname({
				requestUrl: "https://ayn.wtf/project/1",
				previewBaseHost: "ayn.wtf",
			}),
		).toBe("ayn.wtf");
		expect(() =>
			resolvePreviewHostname({
				requestUrl: "https://evil.ayn.wtf/project/1",
				previewBaseHost: "ayn.wtf",
			}),
		).toThrow();
	});

	it("builds the fixed Vite command without project environment values", async () => {
		const sandbox = previewSandbox(
			{
				scripts: { dev: "vite" },
				devDependencies: { vite: "^6.1.0" },
			},
			{
				"/workspace/node_modules/vite/package.json": { version: "6.1.0" },
				"/workspace/node_modules/.bin/vite": {},
			},
		);
		const result = await discoverPreviewCommand({
			sandbox: sandbox as never,
			cwd: "/workspace",
			port: 10000,
		});
		expect(result.command).toBe(
			"./node_modules/.bin/vite --host 0.0.0.0 --port 10000 --strictPort",
		);
		expect(result.env).toEqual({
			HOST: "0.0.0.0",
			PORT: "10000",
			__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf",
		});
	});

	it("rejects preview URLs with credentials or nested production hosts", () => {
		expect(() =>
			validatePreviewUrl({
				url: "https://user:pass@10000-sandbox.ayn.wtf/",
				port: 10000,
				hostname: "ayn.wtf",
				local: false,
			}),
		).toThrow();
		expect(() =>
			validatePreviewUrl({
				url: "https://nested.10000-sandbox.ayn.wtf/",
				port: 10000,
				hostname: "ayn.wtf",
				local: false,
			}),
		).toThrow();
	});
});
