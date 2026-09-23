import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createDb } from "#/db";
import * as schema from "#/db/schema";
import { createSqliteD1, OWNERSHIP_D1_SCHEMA } from "./sqlite-d1-test-utils";

vi.mock("#/lib/agent-run", () => ({
	runAgentInSandbox: vi.fn(),
	AGENT_COMMAND_TIMEOUT_MS: 600_000,
}));

vi.mock("#/lib/agent-control-service", () => ({
	controlAgentRun: vi.fn(),
}));

vi.mock("#/lib/workspace-recovery", () => ({
	recordMutationAndCheckpoint: vi.fn(),
}));

vi.mock("#/lib/workspace-runtime", () => ({
	ensureWorkspaceRuntimeReady: vi.fn(),
	submitWorkspaceWork: vi.fn(),
	withWorkspaceRuntimeLease: vi.fn(),
	completeWork: vi.fn(),
	failWork: vi.fn(),
	isLegacySharedSandboxSession: vi.fn(() => true),
	WorkspaceRuntimeError: class WorkspaceRuntimeError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
			this.name = "WorkspaceRuntimeError";
		}
	},
}));

vi.mock("#/lib/project-env-vars", () => ({
	decryptEnvVars: vi.fn().mockResolvedValue([]),
}));

vi.mock("#/lib/workspace-session", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#/lib/workspace-session")>();
	return {
		...actual,
		resolveSessionForMessageWrite: vi.fn(),
	};
});

import type { AgentRunContext, AgentRunDeps } from "./agent-run-service";
import { executeAgentRun, prepareAgentRun } from "./agent-run-service";
import { resolveSessionForMessageWrite } from "./workspace-session";

type Db = ReturnType<typeof createDb>;

const readyProject = {
	id: "proj-1",
	name: "Demo",
	description: null,
	userId: "user-1",
	githubRepo: "acme/repo",
	githubInstallationId: 1,
	envVars: null,
	status: "ready" as const,
	createdAt: new Date(),
	updatedAt: new Date(),
};

function makeEnv(): Env {
	return {
		OPENCODE_API_KEY: "sk-test-key-12345678901234567890",
		BETTER_AUTH_SECRET: "test-better-auth-secret-min-length",
		BETTER_AUTH_URL: "http://localhost:5173",
	} as Env;
}

function sessionRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "sess-1",
		projectId: "proj-1",
		userId: "user-1",
		status: "active" as const,
		title: "Chat",
		branchName: "ditto/session-sess-1",
		baseCommitSha: "abc123",
		workspacePath: "/workspace",
		sandboxIdentityId: null,
		runtimeLeaseId: null,
		runtimeLeaseExpiresAt: null,
		runtimeFailureReasonCode: null,
		previewStartedAt: null,
		runtimeOwner: "legacy" as const,
		runtimeOwnerVersion: 1,
		brainIdentityId: null,
		runtimeProtocolVersion: null,
		runtimeJournalVersion: null,
		productProjectionVersion: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function createOwnershipDb() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(OWNERSHIP_D1_SCHEMA);
	const db = drizzle(createSqliteD1(sqlite), {
		schema,
	}) as unknown as Db;
	return { db, sqlite };
}

function seedLegacySession(
	sqlite: DatabaseSync,
	options: {
		id?: string;
		owner?: string;
		version?: number;
	} = {},
) {
	sqlite
		.prepare(
			`INSERT INTO workspace_sessions (id, projectId, userId, status, runtimeOwner, runtimeOwnerVersion)
			 VALUES (?, 'proj-1', 'user-1', 'active', ?, ?)`,
		)
		.run(
			options.id ?? "sess-1",
			options.owner ?? "legacy",
			options.version ?? 1,
		);
}

function counts(sqlite: DatabaseSync) {
	return {
		sessions: Number(
			(
				sqlite
					.prepare("SELECT count(*) AS n FROM workspace_sessions")
					.get() as {
					n: number;
				}
			).n,
		),
		messages: Number(
			(
				sqlite.prepare("SELECT count(*) AS n FROM messages").get() as {
					n: number;
				}
			).n,
		),
		work: Number(
			(
				sqlite
					.prepare("SELECT count(*) AS n FROM workspace_runtime_work")
					.get() as { n: number }
			).n,
		),
	};
}

function baseDeps(overrides: Partial<AgentRunDeps> = {}): AgentRunDeps {
	return {
		createId: vi
			.fn()
			.mockReturnValueOnce("run-1")
			.mockReturnValueOnce("work-1")
			.mockReturnValueOnce("user-msg")
			.mockReturnValueOnce("asst-msg"),
		loadProjectForUser: vi.fn().mockResolvedValue(readyProject),
		decryptEnvVars: vi.fn().mockResolvedValue([]),
		resolveSessionForMessageWrite: vi.fn().mockResolvedValue({
			kind: "existing",
			session: sessionRow(),
		}),
		ensureWorkspaceRuntimeReady: vi.fn(),
		submitWorkspaceWork: vi.fn().mockResolvedValue({
			workId: "work-1",
			status: "running",
			queuePosition: null,
			queueExpiresAt: null,
			sessionId: "sess-1",
			intent: "agent_run",
			reasonCode: null,
			userMessageId: "user-msg",
			assistantMessageId: "asst-msg",
		}),
		withWorkspaceRuntimeLease: vi.fn(),
		createAuthority: vi.fn(),
		runAgentInSandbox: vi.fn(),
		recordMutationAndCheckpoint: vi.fn(),
		...overrides,
	};
}

describe("agent run ownership batches through drizzle-orm/d1", () => {
	beforeEach(() => {
		vi.mocked(resolveSessionForMessageWrite).mockReset();
	});

	it("admits a matching legacy prompt batch and persists session recency writes", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite);
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: { projectId: "proj-1", sessionId: "sess-1", message: "hi" },
			deps: baseDeps(),
		});
		expect(result.kind).toBe("ready");
		expect(counts(sqlite)).toEqual({ sessions: 1, messages: 2, work: 1 });
		expect(
			sqlite.prepare("SELECT role, status FROM messages ORDER BY role").all(),
		).toEqual([
			{ role: "assistant", status: "pending" },
			{ role: "user", status: "complete" },
		]);
	});

	it("treats a stale in-memory owner after load as a conflict with no residue", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite, { owner: "migrating", version: 2 });
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: { projectId: "proj-1", sessionId: "sess-1", message: "hi" },
			deps: baseDeps(),
		});
		expect(result).toMatchObject({
			kind: "error",
			status: 409,
			body: { error: "Workspace runtime ownership changed." },
		});
		expect(counts(sqlite)).toEqual({ sessions: 1, messages: 0, work: 0 });
	});

	it("accepts a legacy owner after a migrating round trip at the current version", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite, { owner: "legacy", version: 3 });
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: { projectId: "proj-1", sessionId: "sess-1", message: "hi" },
			deps: baseDeps({
				resolveSessionForMessageWrite: vi.fn().mockResolvedValue({
					kind: "existing",
					session: sessionRow({ runtimeOwnerVersion: 3 }),
				}),
			}),
		});
		expect(result.kind).toBe("ready");
		expect(counts(sqlite)).toEqual({ sessions: 1, messages: 2, work: 1 });
	});

	it("rolls back prompt messages when a later batch statement fails", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite);
		sqlite
			.prepare(
				`INSERT INTO workspace_runtime_work (
					id, fifoSeq, projectId, userId, intent, queueExpiresAt, assistantMessageId
				) VALUES ('existing-work', 1, 'proj-1', 'user-1', 'agent_run', 999999, 'asst-msg')`,
			)
			.run();
		await expect(
			prepareAgentRun({
				db,
				env: makeEnv(),
				userId: "user-1",
				input: { projectId: "proj-1", sessionId: "sess-1", message: "hi" },
				deps: baseDeps(),
			}),
		).rejects.toThrow();
		expect(counts(sqlite)).toEqual({ sessions: 1, messages: 0, work: 1 });
		expect(
			sqlite.prepare("SELECT id FROM workspace_runtime_work").get(),
		).toEqual({ id: "existing-work" });
	});

	it("persists a follow-up batch for a matching legacy owner", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite);
		sqlite
			.prepare(
				`INSERT INTO messages (id, sessionId, projectId, userId, role, content, status)
				 VALUES ('user-msg', 'sess-1', 'proj-1', 'user-1', 'user', 'hi', 'complete'),
				        ('asst-msg', 'sess-1', 'proj-1', 'user-1', 'assistant', '', 'pending')`,
			)
			.run();
		const context: AgentRunContext = {
			db,
			env: makeEnv(),
			userId: "user-1",
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
			runId: "run-1",
			workId: "work-1",
			sessionId: "sess-1",
			createdSession: false,
			workspaceSession: sessionRow(),
			ensuredProject: readyProject,
			sandboxState: "ready",
			userMessageId: "user-msg",
			assistantMessageId: "asst-msg",
			envVars: [],
			secretValues: [],
		};
		await executeAgentRun({
			context,
			emit: () => undefined,
			deps: {
				runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
					await opts.onRunnerMessage({
						kind: "assistant_delta",
						delta: "first",
					});
					await opts.onRunnerMessage({
						kind: "control_event",
						event: {
							type: "follow_up_started",
							requestId: "request-2",
							runId: "run-1",
							sessionId: "sess-1",
							text: "next",
							userMessageId: "user-2",
							assistantMessageId: "asst-2",
						},
					});
					return { ok: true, assistantText: "first" };
				}),
				withWorkspaceRuntimeLease: vi.fn(async (_input, run) =>
					run({
						sessionId: "sess-1",
						purpose: "agent_run",
						workspacePath: "/workspace",
						branchName: "ditto/session-sess-1",
						baseCommitSha: "abc",
						sandbox: {} as never,
						identity: {
							id: "ident-1",
							kind: "workspace_session",
							sandboxId: "sb-1",
							containerId: "container-1",
							userId: "user-1",
							projectId: "proj-1",
							workspaceSessionId: "sess-1",
							lifecycleGeneration: 1,
							state: "ready",
							retiredAt: null,
						},
						projectEnv: [],
						matchesSandboxClaim: () => true,
					}),
				),
				createAuthority: () =>
					({
						withOperation: async (
							_input: unknown,
							run: (op: unknown) => unknown,
						) => run({ id: "op-1" }),
					}) as never,
				prepareAssistantMessageStorage: vi.fn().mockReturnValue({
					storageParts: [],
					toolsColumn: null,
				}),
			},
		});
		expect(sqlite.prepare("SELECT id FROM messages ORDER BY id").all()).toEqual(
			[
				{ id: "asst-2" },
				{ id: "asst-msg" },
				{ id: "user-2" },
				{ id: "user-msg" },
			],
		);
	});

	it("rolls back a new-session prompt batch when a later statement fails", async () => {
		const { db, sqlite } = createOwnershipDb();
		sqlite
			.prepare(
				`INSERT INTO workspace_runtime_work (
					id, fifoSeq, projectId, userId, intent, queueExpiresAt, assistantMessageId
				) VALUES ('existing-work', 1, 'proj-1', 'user-1', 'agent_run', 999999, 'asst-msg')`,
			)
			.run();
		await expect(
			prepareAgentRun({
				db,
				env: makeEnv(),
				userId: "user-1",
				input: { projectId: "proj-1", message: "hi" },
				deps: baseDeps({
					createId: vi
						.fn()
						.mockReturnValueOnce("sess-new")
						.mockReturnValueOnce("run-1")
						.mockReturnValueOnce("work-1")
						.mockReturnValueOnce("user-msg")
						.mockReturnValueOnce("asst-msg"),
					resolveSessionForMessageWrite: vi.fn().mockResolvedValue({
						kind: "create",
					}),
				}),
			}),
		).rejects.toThrow();
		expect(counts(sqlite)).toEqual({ sessions: 0, messages: 0, work: 1 });
	});

	it("rejects a stale owner version after a complete owner round trip", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite, { owner: "legacy", version: 3 });
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: { projectId: "proj-1", sessionId: "sess-1", message: "hi" },
			deps: baseDeps({
				resolveSessionForMessageWrite: vi.fn().mockResolvedValue({
					kind: "existing",
					session: sessionRow({ runtimeOwnerVersion: 1 }),
				}),
			}),
		});
		expect(result).toMatchObject({
			kind: "error",
			status: 409,
			body: { error: "Workspace runtime ownership changed." },
		});
		expect(counts(sqlite)).toEqual({ sessions: 1, messages: 0, work: 0 });
	});

	it("leaves no follow-up residue when ownership changed after the original load", async () => {
		const { db, sqlite } = createOwnershipDb();
		seedLegacySession(sqlite, { owner: "blocked", version: 4 });
		sqlite
			.prepare(
				`INSERT INTO messages (id, sessionId, projectId, userId, role, content, status)
				 VALUES ('user-msg', 'sess-1', 'proj-1', 'user-1', 'user', 'hi', 'complete'),
				        ('asst-msg', 'sess-1', 'proj-1', 'user-1', 'assistant', '', 'pending')`,
			)
			.run();
		const context: AgentRunContext = {
			db,
			env: makeEnv(),
			userId: "user-1",
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
			runId: "run-1",
			workId: "work-1",
			sessionId: "sess-1",
			createdSession: false,
			workspaceSession: sessionRow({ runtimeOwnerVersion: 1 }),
			ensuredProject: readyProject,
			sandboxState: "ready",
			userMessageId: "user-msg",
			assistantMessageId: "asst-msg",
			envVars: [],
			secretValues: [],
		};
		await executeAgentRun({
			context,
			emit: () => undefined,
			deps: {
				controlAgentRun: vi.fn().mockResolvedValue({
					kind: "accepted",
					status: 200,
					body: { accepted: true },
				}),
				runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
					await opts.onRunnerMessage({
						kind: "assistant_delta",
						delta: "first",
					});
					await opts.onRunnerMessage({
						kind: "control_event",
						event: {
							type: "follow_up_started",
							requestId: "request-2",
							runId: "run-1",
							sessionId: "sess-1",
							text: "next",
							userMessageId: "user-2",
							assistantMessageId: "asst-2",
						},
					});
					return { ok: true, assistantText: "first" };
				}),
				withWorkspaceRuntimeLease: vi.fn(async (_input, run) =>
					run({
						sessionId: "sess-1",
						purpose: "agent_run",
						workspacePath: "/workspace",
						branchName: "ditto/session-sess-1",
						baseCommitSha: "abc",
						sandbox: {} as never,
						identity: {
							id: "ident-1",
							kind: "workspace_session",
							sandboxId: "sb-1",
							containerId: "container-1",
							userId: "user-1",
							projectId: "proj-1",
							workspaceSessionId: "sess-1",
							lifecycleGeneration: 1,
							state: "ready",
							retiredAt: null,
						},
						projectEnv: [],
						matchesSandboxClaim: () => true,
					}),
				),
				createAuthority: () =>
					({
						withOperation: async (
							_input: unknown,
							run: (op: unknown) => unknown,
						) => run({ id: "op-1" }),
					}) as never,
				prepareAssistantMessageStorage: vi.fn().mockReturnValue({
					storageParts: [],
					toolsColumn: null,
				}),
			},
		});
		expect(sqlite.prepare("SELECT id FROM messages ORDER BY id").all()).toEqual(
			[{ id: "asst-msg" }, { id: "user-msg" }],
		);
	});
});
