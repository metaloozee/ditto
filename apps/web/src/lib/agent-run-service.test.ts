import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/agent-run", () => ({
	runAgentInSandbox: vi.fn(),
}));

vi.mock("#/lib/agent-control-service", () => ({
	controlAgentRun: vi.fn(),
}));

vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: vi.fn(),
	persistProjectSandboxBackup: vi.fn(),
}));

vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorktree: vi.fn(),
}));

vi.mock("#/lib/project-env-vars", () => ({
	decryptEnvVars: vi.fn().mockResolvedValue([]),
}));

vi.mock("#/lib/workspace-session", () => ({
	resolveSessionForMessageWrite: vi.fn(),
	workspaceSessionRecencyUpdate: vi.fn((_db: unknown, sessionId: string) => ({
		__kind: "recency-update",
		sessionId,
	})),
	loadOwnedActiveSession: vi.fn(),
	archiveOwnedActiveSession: vi.fn(),
}));

import type {
	AgentRunContext,
	AgentRunDeps,
	AgentRunStreamEvent,
} from "./agent-run-service";

const { executeAgentRun, prepareAgentRun } = await import(
	"./agent-run-service"
);

const readyProject = {
	id: "proj-1",
	name: "Demo",
	description: null,
	userId: "user-1",
	githubRepo: "acme/repo",
	githubInstallationId: 1,
	sandboxId: "sb-1",
	sandboxBackup: null,
	sandboxBackupCreatedAt: null,
	sandboxBackupRequestedGeneration: 0,
	sandboxBackupStoredGeneration: 0,
	envVars: null,
	status: "ready" as const,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const activeSession = {
	id: "sess-1",
	projectId: "proj-1",
	userId: "user-1",
	status: "active" as const,
	title: "Chat",
	branchName: "ditto/session-sess-1",
	baseCommitSha: "abc123",
	workspacePath: "/workspace/.ditto/worktrees/sess-1",
	memoryPath: "/workspace/.ditto/memory",
	createdAt: new Date(),
	updatedAt: new Date(),
};

function makeEnv(): Env {
	return {
		OPENCODE_API_KEY: "sk-test-key-12345678901234567890",
		AI_CREDENTIALS_ENCRYPTION_KEY: "ai-credentials-encryption-key-test-aaaa",
		BETTER_AUTH_SECRET: "test-better-auth-secret-min-length",
		BETTER_AUTH_URL: "http://localhost:5173",
	} as Env;
}

function createMockDb() {
	const updateWhere = vi.fn().mockResolvedValue(undefined);
	const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
	const update = vi.fn().mockReturnValue({ set: updateSet });

	const deleteWhere = vi.fn().mockResolvedValue(undefined);
	const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

	const insertReturning = vi.fn();
	const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
	const insert = vi.fn().mockReturnValue({ values: insertValues });

	const batch = vi.fn();

	return {
		db: {
			batch,
			insert,
			update,
			delete: deleteFn,
		} as never,
		batch,
		insert,
		insertValues,
		insertReturning,
		update,
		updateSet,
		updateWhere,
		deleteFn,
		deleteWhere,
	};
}

function baseDeps(overrides: Partial<AgentRunDeps> = {}): AgentRunDeps {
	return {
		createId: vi
			.fn()
			.mockReturnValueOnce("sess-new")
			.mockReturnValueOnce("user-msg")
			.mockReturnValueOnce("asst-msg"),
		loadProjectForUser: vi.fn().mockResolvedValue(readyProject),
		decryptEnvVars: vi.fn().mockResolvedValue([]),
		ensureProjectSandbox: vi.fn().mockResolvedValue({
			project: readyProject,
			state: "ready",
		}),
		resolveSessionForMessageWrite: vi.fn().mockResolvedValue({
			kind: "existing",
			session: activeSession,
		}),
		ensureSessionWorktree: vi.fn().mockResolvedValue({
			branchName: activeSession.branchName,
			baseCommitSha: activeSession.baseCommitSha,
			workspacePath: activeSession.workspacePath,
		}),
		loadCredential: vi.fn().mockResolvedValue(null),
		runAgentInSandbox: vi.fn().mockResolvedValue({
			ok: true,
			assistantText: "Hello",
		}),
		persistProjectSandboxBackup: vi.fn().mockResolvedValue({
			project: readyProject,
		}),
		redactSecrets: vi.fn((text: string) => text),
		prepareAssistantMessageStorage: vi.fn().mockReturnValue({
			storageParts: [],
			toolsColumn: null,
		}),
		serializeAssistantPartsMinimalForStorage: vi.fn().mockReturnValue(null),
		...overrides,
	};
}

describe("prepareAgentRun", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 404 when project is missing", async () => {
		const { db } = createMockDb();
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "missing",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps: baseDeps({
				loadProjectForUser: vi.fn().mockResolvedValue(null),
			}),
		});
		expect(result).toEqual({
			kind: "error",
			status: 404,
			body: { error: "Project not found." },
		});
	});

	it("returns 409 when sandbox is not ready", async () => {
		const { db } = createMockDb();
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "proj-1",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps: baseDeps({
				loadProjectForUser: vi.fn().mockResolvedValue({
					...readyProject,
					status: "provisioning",
					sandboxId: null,
				}),
			}),
		});
		expect(result).toMatchObject({
			kind: "error",
			status: 409,
			body: { error: "Project sandbox is not ready." },
		});
	});

	it("returns 404 for archived / missing sessions without creating a replacement", async () => {
		const { db, batch, insert } = createMockDb();
		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "proj-1",
				sessionId: "sess-archived",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps: baseDeps({
				resolveSessionForMessageWrite: vi
					.fn()
					.mockResolvedValue({ kind: "not_found" }),
			}),
		});
		expect(result).toEqual({
			kind: "error",
			status: 404,
			body: { error: "Session not found." },
		});
		expect(batch).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("prepares worktree before inserting messages for an existing session", async () => {
		const order: string[] = [];
		const { db, batch } = createMockDb();

		const deps = baseDeps({
			createId: vi
				.fn()
				.mockReturnValueOnce("run-1")
				.mockReturnValueOnce("user-msg")
				.mockReturnValueOnce("asst-msg"),
			ensureSessionWorktree: vi.fn().mockImplementation(async () => {
				order.push("worktree");
				return {
					branchName: activeSession.branchName,
					baseCommitSha: activeSession.baseCommitSha,
					workspacePath: activeSession.workspacePath,
				};
			}),
		});

		batch.mockImplementation(async () => {
			order.push("messages");
			return [[{ id: "user-msg" }], [{ id: "asst-msg" }]];
		});

		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "proj-1",
				sessionId: "sess-1",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps,
		});

		expect(result.kind).toBe("ready");
		expect(order).toEqual(["worktree", "messages"]);
		if (result.kind === "ready") {
			expect(result.context.assistantMessageId).toBe("asst-msg");
			expect(result.context.createdSession).toBe(false);
		}
	});

	it("cleans up a newly created empty session when worktree prep fails", async () => {
		const { db, deleteFn, deleteWhere, batch } = createMockDb();
		batch.mockResolvedValueOnce([[{ ...activeSession, id: "sess-new" }]]);

		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "proj-1",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps: baseDeps({
				createId: vi.fn().mockReturnValue("sess-new"),
				resolveSessionForMessageWrite: vi
					.fn()
					.mockResolvedValue({ kind: "create" }),
				ensureSessionWorktree: vi
					.fn()
					.mockRejectedValue(new Error("dirty primary")),
			}),
		});

		expect(result).toEqual({
			kind: "error",
			status: 409,
			body: { error: "dirty primary" },
		});
		expect(deleteFn).toHaveBeenCalled();
		expect(deleteWhere).toHaveBeenCalled();
		// Session create batch only — no message insert.
		expect(batch).toHaveBeenCalledTimes(1);
	});

	it("leaves an existing session untouched when worktree prep fails", async () => {
		const { db, deleteFn, batch } = createMockDb();

		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "proj-1",
				sessionId: "sess-1",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps: baseDeps({
				ensureSessionWorktree: vi
					.fn()
					.mockRejectedValue(new Error("worktree boom")),
			}),
		});

		expect(result).toEqual({
			kind: "error",
			status: 409,
			body: { error: "worktree boom" },
		});
		expect(deleteFn).not.toHaveBeenCalled();
		expect(batch).not.toHaveBeenCalled();
	});

	it("inserts assistant placeholder with pending status", async () => {
		const { db, insert, insertValues, batch } = createMockDb();
		batch.mockResolvedValue([[{ id: "user-msg" }], [{ id: "asst-msg" }]]);

		const result = await prepareAgentRun({
			db,
			env: makeEnv(),
			userId: "user-1",
			input: {
				projectId: "proj-1",
				sessionId: "sess-1",
				message: "hi",
				model: "opencode/deepseek-v4-flash-free",
			},
			deps: baseDeps({
				createId: vi
					.fn()
					.mockReturnValueOnce("run-1")
					.mockReturnValueOnce("user-msg")
					.mockReturnValueOnce("asst-msg"),
			}),
		});

		expect(result.kind).toBe("ready");
		expect(insert).toHaveBeenCalled();
		const valueCalls = insertValues.mock.calls.map(
			(call) => call[0] as Record<string, unknown>,
		);
		const assistantInsert = valueCalls.find(
			(values) => values.role === "assistant",
		);
		const userInsert = valueCalls.find((values) => values.role === "user");
		expect(assistantInsert).toMatchObject({
			id: "asst-msg",
			content: "",
			status: "pending",
		});
		expect(userInsert).toMatchObject({
			id: "user-msg",
			status: "complete",
		});
	});
});

describe("executeAgentRun", () => {
	function makeContext(
		overrides: Partial<AgentRunContext> = {},
	): AgentRunContext {
		const mockDb = createMockDb();
		return {
			db: mockDb.db,
			env: makeEnv(),
			userId: "user-1",
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
			runId: "run-1",
			sessionId: "sess-1",
			createdSession: false,
			workspaceSession: activeSession,
			ensuredProject: readyProject,
			sandboxState: "ready",
			sessionWorkspacePath: activeSession.workspacePath,
			userMessageId: "user-msg",
			assistantMessageId: "asst-msg",
			envVars: [],
			secretValues: [makeEnv().OPENCODE_API_KEY],
			runtimeCredentialJson: JSON.stringify({
				type: "api_key",
				key: makeEnv().OPENCODE_API_KEY,
			}),
			...overrides,
		};
	}

	function collectEvents(
		context: AgentRunContext,
		deps: Partial<AgentRunDeps>,
	) {
		const events: AgentRunStreamEvent[] = [];
		return {
			events,
			run: () =>
				executeAgentRun({
					context,
					emit: (event) => events.push(event),
					deps: baseDeps(deps),
				}),
		};
	}

	it("emits meta -> delta* -> done and persists complete status", async () => {
		const mockDb = createMockDb();
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });

		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "Hello",
				});
				return { ok: true, assistantText: "Hello" };
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		expect(events.map((e) => e.event)).toEqual(["meta", "delta", "done"]);
		expect(events[0]).toMatchObject({
			event: "meta",
			data: {
				sessionId: "sess-1",
				userMessageId: "user-msg",
				assistantMessageId: "asst-msg",
				createdSession: false,
			},
		});
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: true, content: "Hello", assistantMessageId: "asst-msg" },
		});
		expect(updateSets.some((set) => set.status === "complete")).toBe(true);
		expect(updateSets.some((set) => set.content === "Hello")).toBe(true);
	});

	it("persists and emits one-at-a-time follow-up turn boundaries in order", async () => {
		const mockDb = createMockDb();
		mockDb.batch.mockResolvedValue([[{ id: "user-2" }], [{ id: "asst-2" }]]);
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });
		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "ready",
					sessionId: "sess-1",
					model: context.model,
				});
				await opts.onRunnerMessage({ kind: "assistant_delta", delta: "first" });
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
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "second",
				});
				return { ok: true, assistantText: "firstsecond" };
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		expect(events.map((event) => event.event)).toEqual([
			"meta",
			"control_ready",
			"delta",
			"turn_done",
			"turn_start",
			"delta",
			"done",
		]);
		expect(events[3]).toMatchObject({
			event: "turn_done",
			data: { assistantMessageId: "asst-msg", content: "first" },
		});
		expect(events[4]).toMatchObject({
			event: "turn_start",
			data: {
				requestId: "request-2",
				userMessageId: "user-2",
				assistantMessageId: "asst-2",
				text: "next",
			},
		});
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { assistantMessageId: "asst-2", content: "second", ok: true },
		});
		expect(updateSets.filter((set) => set.status === "complete")).toHaveLength(
			2,
		);
		expect(mockDb.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ id: "user-2", status: "complete" }),
		);
		expect(mockDb.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ id: "asst-2", status: "pending" }),
		);
	});

	it("creates three D1 pairs for two follow-ups and isolates final content", async () => {
		const mockDb = createMockDb();
		mockDb.batch
			.mockResolvedValueOnce([[{ id: "user-2" }], [{ id: "asst-2" }]])
			.mockResolvedValueOnce([[{ id: "user-3" }], [{ id: "asst-3" }]]);
		const context = makeContext({ db: mockDb.db });
		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				for (const [index, text] of ["one", "two", "three"].entries()) {
					await opts.onRunnerMessage({ kind: "assistant_delta", delta: text });
					if (index < 2) {
						const turn = index + 2;
						await opts.onRunnerMessage({
							kind: "control_event",
							event: {
								type: "follow_up_started",
								requestId: `request-${turn}`,
								runId: "run-1",
								sessionId: "sess-1",
								text: `follow-up ${turn}`,
								userMessageId: `user-${turn}`,
								assistantMessageId: `asst-${turn}`,
							},
						});
					}
				}
				return { ok: true, assistantText: "onetwothree" };
			}),
		});

		await run();
		expect(mockDb.batch).toHaveBeenCalledTimes(2);
		expect(events.filter((event) => event.event === "turn_done")).toHaveLength(
			2,
		);
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { assistantMessageId: "asst-3", content: "three" },
		});
	});

	it("requests Stop and fails a partially created follow-up assistant when its boundary batch fails", async () => {
		const mockDb = createMockDb();
		mockDb.batch.mockResolvedValue([[{ id: "user-2" }], []]);
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const controlAgentRun = vi.fn().mockResolvedValue({
			kind: "accepted",
			status: 200,
			body: { accepted: true },
		});
		const context = makeContext({ db: mockDb.db });
		const { events, run } = collectEvents(context, {
			controlAgentRun: controlAgentRun as never,
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({ kind: "assistant_delta", delta: "first" });
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
		});

		await run();

		expect(controlAgentRun).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					action: "stop",
					runId: "run-1",
				}),
			}),
		);
		expect(updateSets.filter((set) => set.status === "complete")).toHaveLength(
			1,
		);
		expect(updateSets.filter((set) => set.status === "failed")).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: false },
		});
	});

	it("persists the active started follow-up as failed with partial content after Stop", async () => {
		const mockDb = createMockDb();
		mockDb.batch.mockResolvedValue([[{ id: "user-2" }], [{ id: "asst-2" }]]);
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });
		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({ kind: "assistant_delta", delta: "first" });
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
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "partial follow-up",
				});
				return { ok: false, assistantText: "partial follow-up" };
			}),
		});

		await run();

		expect(updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "complete", content: "first" }),
				expect.objectContaining({
					status: "failed",
					content: "partial follow-up",
				}),
			]),
		);
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: {
				ok: false,
				assistantMessageId: "asst-2",
				content: "partial follow-up",
			},
		});
	});

	it("isolates text and tool chronology across follow-up turns", async () => {
		const mockDb = createMockDb();
		mockDb.batch.mockResolvedValue([[{ id: "user-2" }], [{ id: "asst-2" }]]);
		const context = makeContext({ db: mockDb.db });
		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "before one",
				});
				await opts.onRunnerMessage({
					kind: "agent_event",
					event: {
						type: "tool_execution_end",
						toolCallId: "tool-one",
						toolName: "bash",
						result: "one",
						isError: false,
					},
				});
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "after one",
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
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "before two",
				});
				await opts.onRunnerMessage({
					kind: "agent_event",
					event: {
						type: "tool_execution_end",
						toolCallId: "tool-two",
						toolName: "bash",
						result: "two",
						isError: false,
					},
				});
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "after two",
				});
				return { ok: true, assistantText: "unused" };
			}),
		});

		await run();

		const first = events.find((event) => event.event === "turn_done");
		const final = events.at(-1);
		expect(first).toMatchObject({
			event: "turn_done",
			data: {
				content: "before oneafter one",
				tools: [expect.objectContaining({ id: "tool-one" })],
			},
		});
		expect(JSON.stringify(first)).not.toContain("tool-two");
		expect(final).toMatchObject({
			event: "done",
			data: {
				content: "before twoafter two",
				tools: [expect.objectContaining({ id: "tool-two" })],
			},
		});
		expect(JSON.stringify(final)).not.toContain("tool-one");
	});

	it("drops cancelled queued follow-ups without creating D1 rows", async () => {
		const mockDb = createMockDb();
		const context = makeContext({ db: mockDb.db });
		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "partial",
				});
				await opts.onRunnerMessage({
					kind: "control_event",
					event: {
						type: "follow_up_cancelled",
						requestId: "request-2",
						runId: "run-1",
						sessionId: "sess-1",
						text: "never starts",
						userMessageId: "user-2",
						assistantMessageId: "asst-2",
					},
				});
				return { ok: false, assistantText: "partial" };
			}),
		});

		await run();
		expect(mockDb.batch).not.toHaveBeenCalled();
		expect(mockDb.insert).not.toHaveBeenCalled();
		expect(events).toContainEqual({
			event: "queue_cancelled",
			data: {
				requestId: "request-2",
				userMessageId: "user-2",
				assistantMessageId: "asst-2",
			},
		});
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: false, content: "partial" },
		});
	});

	it("persists failed partial content when runner throws after deltas", async () => {
		const mockDb = createMockDb();
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });

		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "partial text",
				});
				throw new Error("runner crashed");
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		expect(events.map((e) => e.event)).toEqual([
			"meta",
			"delta",
			"error",
			"done",
		]);
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: {
				ok: false,
				content: "partial text",
				assistantMessageId: "asst-msg",
			},
		});
		expect(updateSets.some((set) => set.status === "failed")).toBe(true);
		expect(updateSets.some((set) => set.content === "partial text")).toBe(true);
	});

	it("retries with minimal tools serialization on primary storage failure", async () => {
		const mockDb = createMockDb();
		let updateCount = 0;
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			updateCount += 1;
			if (updateCount === 1) {
				return {
					where: vi.fn().mockRejectedValue(new Error("payload too large")),
				};
			}
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });

		const minimal = vi.fn().mockReturnValue('[{"type":"tool"}]');
		const { events, run } = collectEvents(context, {
			loadCredential: vi.fn().mockResolvedValue(null),
			runAgentInSandbox: vi.fn().mockResolvedValue({
				ok: true,
				assistantText: "ok",
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [{ type: "text", id: "t", text: "ok" }],
				toolsColumn: "primary-json",
			}),
			serializeAssistantPartsMinimalForStorage: minimal,
		});

		await run();

		expect(minimal).toHaveBeenCalled();
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: true },
		});
		expect(updateSets.some((set) => set.tools === '[{"type":"tool"}]')).toBe(
			true,
		);
	});

	it("emits failed done without claiming success when both storage paths fail", async () => {
		const mockDb = createMockDb();
		mockDb.updateSet.mockImplementation(() => ({
			where: vi.fn().mockRejectedValue(new Error("db write failed")),
		}));
		const context = makeContext({ db: mockDb.db });

		const { events, run } = collectEvents(context, {
			loadCredential: vi.fn().mockResolvedValue(null),
			runAgentInSandbox: vi.fn().mockResolvedValue({
				ok: true,
				assistantText: "ok",
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: "x",
			}),
			serializeAssistantPartsMinimalForStorage: vi.fn().mockReturnValue("y"),
		});

		await run();

		expect(events.map((e) => e.event)).toEqual(["meta", "error", "done"]);
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: false },
		});
	});

	it("surfaces backup errors without flipping message status off complete", async () => {
		const mockDb = createMockDb();
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });

		const { events, run } = collectEvents(context, {
			loadCredential: vi.fn().mockResolvedValue(null),
			runAgentInSandbox: vi.fn().mockResolvedValue({
				ok: true,
				assistantText: "done",
			}),
			persistProjectSandboxBackup: vi
				.fn()
				.mockRejectedValue(new Error("backup metadata failed")),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: {
				ok: true,
				backupError: "backup metadata failed",
			},
		});
		expect(updateSets.some((set) => set.status === "complete")).toBe(true);
		expect(updateSets.every((set) => set.status !== "failed")).toBe(true);
	});

	it("emits agent events and persists tools on success", async () => {
		const mockDb = createMockDb();
		const context = makeContext({ db: mockDb.db });
		const prepareStorage = vi.fn().mockReturnValue({
			storageParts: [],
			toolsColumn: '[{"type":"tool"}]',
		});

		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "agent_event",
					event: {
						type: "tool_execution_end",
						toolCallId: "t1",
						toolName: "bash",
						result: "ok",
						isError: false,
					},
				});
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "after tool",
				});
				return { ok: true, assistantText: "after tool" };
			}),
			prepareAssistantMessageStorage: prepareStorage,
		});

		await run();

		expect(events.map((e) => e.event)).toEqual([
			"meta",
			"agent",
			"delta",
			"done",
		]);
		expect(prepareStorage).toHaveBeenCalled();
		const done = events.at(-1);
		expect(done?.event).toBe("done");
		if (done?.event === "done") {
			expect(done.data.tools?.some((t) => t.id === "t1")).toBe(true);
		}
	});

	it("stamps one server occurrence time into SSE, persisted parts, and done parts", async () => {
		const mockDb = createMockDb();
		const context = makeContext({ db: mockDb.db });
		const clock = [1_000, 5_000, 9_000];
		let clockIndex = 0;
		const now = vi.fn(() => {
			const value = clock[clockIndex] ?? clock[clock.length - 1] ?? 0;
			clockIndex += 1;
			return value;
		});
		const prepareStorage = vi.fn().mockImplementation((parts) => ({
			storageParts: parts,
			toolsColumn: JSON.stringify(parts),
		}));

		const { events, run } = collectEvents(context, {
			now,
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "agent_event",
					event: {
						type: "tool_execution_start",
						toolCallId: "t-time",
						toolName: "bash",
						args: { command: "ls" },
					},
				});
				await opts.onRunnerMessage({
					kind: "agent_event",
					event: {
						type: "tool_execution_end",
						toolCallId: "t-time",
						toolName: "bash",
						result: "ok",
						isError: false,
					},
				});
				return { ok: true, assistantText: "" };
			}),
			prepareAssistantMessageStorage: prepareStorage,
		});

		await run();

		const agentEvents = events.filter((e) => e.event === "agent");
		expect(agentEvents).toHaveLength(2);
		expect(agentEvents[0]).toMatchObject({
			event: "agent",
			data: {
				occurredAt: 1_000,
				event: { type: "tool_execution_start", toolCallId: "t-time" },
			},
		});
		expect(agentEvents[1]).toMatchObject({
			event: "agent",
			data: {
				occurredAt: 5_000,
				event: { type: "tool_execution_end", toolCallId: "t-time" },
			},
		});

		expect(prepareStorage).toHaveBeenCalled();
		const persistedParts = prepareStorage.mock.calls[0]?.[0] as Array<{
			type: string;
			tool?: { id: string; startedAt?: number; endedAt?: number };
		}>;
		const persistedTool = persistedParts.find(
			(p) => p.type === "tool" && p.tool?.id === "t-time",
		);
		expect(persistedTool?.tool).toMatchObject({
			startedAt: 1_000,
			endedAt: 5_000,
		});

		const done = events.at(-1);
		expect(done?.event).toBe("done");
		if (done?.event === "done") {
			const doneTool = done.data.tools?.find((t) => t.id === "t-time");
			expect(doneTool).toMatchObject({
				startedAt: 1_000,
				endedAt: 5_000,
			});
			const donePartTool = done.data.parts?.find(
				(p) => p.type === "tool" && p.tool.id === "t-time",
			);
			expect(
				donePartTool?.type === "tool" ? donePartTool.tool : undefined,
			).toMatchObject({
				startedAt: 1_000,
				endedAt: 5_000,
			});
		}
	});

	it("batches many tiny deltas into fewer delta events with identical content", async () => {
		const mockDb = createMockDb();
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });

		const tokens = Array.from({ length: 200 }, (_, i) => `w${i} `);
		const fullText = tokens.join("");

		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				for (const token of tokens) {
					await opts.onRunnerMessage({
						kind: "assistant_delta",
						delta: token,
					});
				}
				return { ok: true, assistantText: fullText };
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		const deltaEvents = events.filter((e) => e.event === "delta");
		expect(deltaEvents.length).toBeGreaterThan(0);
		expect(deltaEvents.length).toBeLessThan(tokens.length);
		const concatenated = deltaEvents
			.map((e) => (e.event === "delta" ? e.data.delta : ""))
			.join("");
		expect(concatenated).toBe(fullText);
		expect(events.map((e) => e.event).at(0)).toBe("meta");
		expect(events.map((e) => e.event).at(-1)).toBe("done");
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: true, content: fullText },
		});
		expect(updateSets.some((set) => set.content === fullText)).toBe(true);
	});

	it("flushes pending text before interleaved tool agent_events", async () => {
		const mockDb = createMockDb();
		const context = makeContext({ db: mockDb.db });

		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "before ",
				});
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "tool",
				});
				await opts.onRunnerMessage({
					kind: "agent_event",
					event: {
						type: "tool_execution_start",
						toolCallId: "t-order",
						toolName: "bash",
						args: { command: "echo hi" },
					},
				});
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: " after",
				});
				return { ok: true, assistantText: "before tool after" };
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		const kinds = events.map((e) => e.event);
		expect(kinds).toEqual(["meta", "delta", "agent", "delta", "done"]);
		const deltas = events
			.filter((e) => e.event === "delta")
			.map((e) => (e.event === "delta" ? e.data.delta : ""));
		// Raw delta bytes stay unchanged across the tool boundary.
		expect(deltas.join("")).toBe("before tool after");
		// First delta batch must complete before the tool event.
		const firstDeltaIdx = kinds.indexOf("delta");
		const agentIdx = kinds.indexOf("agent");
		expect(firstDeltaIdx).toBeLessThan(agentIdx);
		const expectedContent = "before tool after";
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: {
				ok: true,
				content: expectedContent,
			},
		});
		const done = events.at(-1);
		if (done?.event === "done") {
			expect(done.data.tools?.some((t) => t.id === "t-order")).toBe(true);
			expect(done.data.parts).toBeDefined();
		}
	});

	it("emits error/done immediately after flushing pending text", async () => {
		const mockDb = createMockDb();
		const updateSets: Array<Record<string, unknown>> = [];
		mockDb.updateSet.mockImplementation((values: Record<string, unknown>) => {
			updateSets.push(values);
			return { where: mockDb.updateWhere };
		});
		const context = makeContext({ db: mockDb.db });

		const { events, run } = collectEvents(context, {
			runAgentInSandbox: vi.fn().mockImplementation(async (opts) => {
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: "partial",
				});
				await opts.onRunnerMessage({
					kind: "assistant_delta",
					delta: " text",
				});
				await opts.onRunnerMessage({
					kind: "error",
					message: "boom",
				});
				return { ok: false, assistantText: "partial text" };
			}),
			prepareAssistantMessageStorage: vi.fn().mockReturnValue({
				storageParts: [],
				toolsColumn: null,
			}),
		});

		await run();

		const kinds = events.map((e) => e.event);
		expect(kinds).toEqual(["meta", "delta", "error", "done"]);
		const delta = events.find((e) => e.event === "delta");
		expect(delta).toMatchObject({
			event: "delta",
			data: { delta: "partial text" },
		});
		expect(events.at(-1)).toMatchObject({
			event: "done",
			data: { ok: false, content: "partial text" },
		});
		expect(updateSets.some((set) => set.content === "partial text")).toBe(true);
	});
});
