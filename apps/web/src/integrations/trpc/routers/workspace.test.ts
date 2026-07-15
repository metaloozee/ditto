import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	encodeMessageCursor,
	messageCursorFromRow,
} from "#/lib/message-cursor";

const createDbMock = vi.hoisted(() => vi.fn());
const ensureProjectSandboxMock = vi.hoisted(() => vi.fn());
const resolveSessionForMessageWriteMock = vi.hoisted(() => vi.fn());
const archiveOwnedActiveSessionMock = vi.hoisted(() => vi.fn());
const workspaceSessionRecencyUpdateMock = vi.hoisted(() => vi.fn());
const loadOwnedActiveSessionMock = vi.hoisted(() => vi.fn());

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: ensureProjectSandboxMock,
}));

vi.mock("#/lib/workspace-session", () => ({
	resolveSessionForMessageWrite: resolveSessionForMessageWriteMock,
	archiveOwnedActiveSession: archiveOwnedActiveSessionMock,
	workspaceSessionRecencyUpdate: workspaceSessionRecencyUpdateMock,
	loadOwnedActiveSession: loadOwnedActiveSessionMock,
}));

const { workspaceRouter } = await import("./workspace");

function createCaller() {
	return workspaceRouter.createCaller({
		env: { DB: {} } as Env,
		session: {
			session: {
				id: "auth-sess",
				userId: "user-1",
				expiresAt: new Date(Date.now() + 60_000),
				token: "tok",
				createdAt: new Date(),
				updatedAt: new Date(),
				ipAddress: null,
				userAgent: null,
			},
			user: {
				id: "user-1",
				name: "Test",
				email: "test@example.com",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				image: null,
			},
		},
		request: new Request("http://localhost"),
		auth: {} as never,
	});
}

type MessageRow = {
	id: string;
	sessionId: string;
	projectId: string;
	userId: string;
	role: "user" | "assistant";
	content: string;
	model: string | null;
	tools: string | null;
	status: "pending" | "complete" | "failed";
	createdAt: Date;
	rowid: number;
};

function makeMessage(
	index: number,
	overrides: Partial<MessageRow> = {},
): MessageRow {
	const baseSec = 1_700_000_000 + index;
	return {
		id: `msg-${index}`,
		sessionId: "sess-1",
		projectId: "proj-1",
		userId: "user-1",
		role: index % 2 === 0 ? "user" : "assistant",
		content: `content-${index}`,
		model: null,
		tools: null,
		status: "complete",
		createdAt: new Date(baseSec * 1000),
		rowid: index + 1,
		...overrides,
	};
}

/** Chainable select mock that records limit and returns provided rows. */
function createMessagesDb(options: {
	rows: MessageRow[];
	/** Optional second select path for ensureWorkspace (project/sessions). */
	project?: Record<string, unknown> | null;
	sessions?: Record<string, unknown>[];
}) {
	const selectCalls: {
		limit?: number;
		orderByArgs?: unknown[];
	}[] = [];

	let selectCallIndex = 0;

	const select = vi.fn(() => {
		const callMeta: { limit?: number; orderByArgs?: unknown[] } = {};
		selectCalls.push(callMeta);
		const callIndex = selectCallIndex++;

		const chain = {
			from: vi.fn(() => chain),
			where: vi.fn(() => chain),
			orderBy: vi.fn((...args: unknown[]) => {
				callMeta.orderByArgs = args;
				return chain;
			}),
			limit: vi.fn((n: number) => {
				callMeta.limit = n;
				// First select after loadOwnedActiveSession in messages is message rows.
				// ensureWorkspace does project select then sessions select.
				if (options.project !== undefined && callIndex === 0) {
					return Promise.resolve(options.project ? [options.project] : []);
				}
				if (options.sessions !== undefined && callIndex === 1) {
					return Promise.resolve(options.sessions);
				}
				// Message page: rows are already newest-first; slice by limit.
				return Promise.resolve(options.rows.slice(0, n));
			}),
		};
		return chain;
	});

	return {
		db: { select },
		selectCalls,
		select,
	};
}

describe("workspace.deleteSession archival", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("archives an owned active session", async () => {
		createDbMock.mockReturnValue({});
		archiveOwnedActiveSessionMock.mockResolvedValue({ id: "sess-1" });

		const caller = createCaller();
		const result = await caller.deleteSession({
			projectId: "proj-1",
			sessionId: "sess-1",
		});

		expect(result).toEqual({ id: "sess-1" });
		expect(archiveOwnedActiveSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
			}),
		);
	});

	it("rejects archived / missing / cross-user sessions with NOT_FOUND", async () => {
		createDbMock.mockReturnValue({});
		archiveOwnedActiveSessionMock.mockResolvedValue(null);

		const caller = createCaller();
		await expect(
			caller.deleteSession({
				projectId: "proj-1",
				sessionId: "sess-other",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Session not found.",
		});
	});
});

describe("workspace.messages cursor paging", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadOwnedActiveSessionMock.mockResolvedValue({
			id: "sess-1",
			projectId: "proj-1",
			userId: "user-1",
			status: "active",
		});
	});

	it("returns newest page chronologically with nextCursor when more exist", async () => {
		// 3 rows newest-first from DB; limit 2 → has more
		const rows = [makeMessage(2), makeMessage(1), makeMessage(0)];
		const { db, selectCalls } = createMessagesDb({ rows });
		createDbMock.mockReturnValue(db);

		const caller = createCaller();
		const result = await caller.messages({
			projectId: "proj-1",
			sessionId: "sess-1",
			limit: 2,
		});

		expect(result.items).toHaveLength(2);
		expect(result.items.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
		// Chronological within page
		const firstCreated = result.items[0]?.createdAt;
		const secondCreated = result.items[1]?.createdAt;
		expect(firstCreated).toBeTruthy();
		expect(secondCreated).toBeTruthy();
		expect(firstCreated?.getTime()).toBeLessThan(secondCreated?.getTime() ?? 0);
		expect(result.nextCursor).toBeTruthy();
		// nextCursor is from oldest *returned* row (msg-1)
		const oldestReturned = rows[1];
		expect(oldestReturned).toBeTruthy();
		expect(result.nextCursor).toBe(
			encodeMessageCursor(
				messageCursorFromRow(
					oldestReturned?.createdAt,
					oldestReturned?.rowid ?? 0,
				),
			),
		);
		// limit+1 fetch
		expect(selectCalls[0]?.limit).toBe(3);
		// Public items never include rowid
		expect(result.items[0]).not.toHaveProperty("rowid");
	});

	it("second page with cursor has no duplicate IDs vs page 1", async () => {
		const page1Newest = [makeMessage(5), makeMessage(4), makeMessage(3)];
		const page2 = [makeMessage(2), makeMessage(1), makeMessage(0)];

		// First call: page 1
		const db1 = createMessagesDb({ rows: page1Newest });
		createDbMock.mockReturnValue(db1.db);
		const caller = createCaller();
		const first = await caller.messages({
			projectId: "proj-1",
			sessionId: "sess-1",
			limit: 2,
		});
		expect(first.nextCursor).toBeTruthy();
		const pageCursor = first.nextCursor ?? "";

		// Second call: page 2 using cursor
		const db2 = createMessagesDb({ rows: page2 });
		createDbMock.mockReturnValue(db2.db);
		const second = await caller.messages({
			projectId: "proj-1",
			sessionId: "sess-1",
			limit: 2,
			cursor: pageCursor,
		});

		const firstIds = new Set(first.items.map((m) => m.id));
		for (const item of second.items) {
			expect(firstIds.has(item.id)).toBe(false);
		}
		expect(second.items.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
		// Stable chronological
		const times = second.items.map((m) => m.createdAt?.getTime() ?? 0);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});

	it("final page returns nextCursor null", async () => {
		const rows = [makeMessage(1), makeMessage(0)];
		const { db } = createMessagesDb({ rows });
		createDbMock.mockReturnValue(db);

		const caller = createCaller();
		const result = await caller.messages({
			projectId: "proj-1",
			sessionId: "sess-1",
			limit: 5,
		});

		expect(result.items).toHaveLength(2);
		expect(result.nextCursor).toBeNull();
	});

	it("defaults limit to 50 and clamps to 100", async () => {
		const many = Array.from({ length: 120 }, (_, i) => makeMessage(119 - i));
		const { db: dbDefault, selectCalls: defaultCalls } = createMessagesDb({
			rows: many,
		});
		createDbMock.mockReturnValue(dbDefault);
		const caller = createCaller();

		await caller.messages({
			projectId: "proj-1",
			sessionId: "sess-1",
		});
		expect(defaultCalls[0]?.limit).toBe(51); // 50 + 1

		const { db: dbClamped, selectCalls: clampedCalls } = createMessagesDb({
			rows: many,
		});
		createDbMock.mockReturnValue(dbClamped);
		const clamped = await caller.messages({
			projectId: "proj-1",
			sessionId: "sess-1",
			limit: 200,
		});
		expect(clampedCalls[0]?.limit).toBe(101); // 100 + 1
		expect(clamped.items.length).toBeLessThanOrEqual(100);
	});

	it("rejects malformed cursor with BAD_REQUEST", async () => {
		const { db } = createMessagesDb({ rows: [] });
		createDbMock.mockReturnValue(db);

		const caller = createCaller();
		await expect(
			caller.messages({
				projectId: "proj-1",
				sessionId: "sess-1",
				cursor: "not-a-valid-cursor",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		// Must not hit the messages select when cursor is bad
		expect(db.select).not.toHaveBeenCalled();
	});

	it("returns NOT_FOUND for archived / missing / cross-user session", async () => {
		loadOwnedActiveSessionMock.mockResolvedValue(null);
		createDbMock.mockReturnValue({ select: vi.fn() });

		const caller = createCaller();
		await expect(
			caller.messages({
				projectId: "proj-1",
				sessionId: "sess-missing",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Session not found.",
		});
	});
});

describe("workspace.ensureWorkspace omits unbounded messages", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not include messages in the ensureWorkspace payload", async () => {
		const project = {
			id: "proj-1",
			name: "P",
			description: null,
			userId: "user-1",
			githubRepo: null,
			githubInstallationId: null,
			sandboxId: null,
			sandboxBackup: "secret",
			sandboxBackupCreatedAt: null,
			sandboxBackupRequestedGeneration: 0,
			sandboxBackupStoredGeneration: 0,
			status: "provisioning" as const,
			envVars: "encrypted",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		// loadWorkspaceView: project select ends with limit; sessions select ends with orderBy.
		const select = vi.fn(() => {
			const chain: {
				from: ReturnType<typeof vi.fn>;
				where: ReturnType<typeof vi.fn>;
				orderBy: ReturnType<typeof vi.fn>;
				limit: ReturnType<typeof vi.fn>;
			} = {
				from: vi.fn(() => chain),
				where: vi.fn(() => chain),
				orderBy: vi.fn(() => Promise.resolve([])),
				limit: vi.fn(() => Promise.resolve([project])),
			};
			return chain;
		});

		createDbMock.mockReturnValue({ select });

		const caller = createCaller();
		const result = await caller.ensureWorkspace({ projectId: "proj-1" });

		expect(result).not.toHaveProperty("messages");
		expect(result.project.id).toBe("proj-1");
		expect(result.project).not.toHaveProperty("envVars");
		expect(result.project).not.toHaveProperty("sandboxBackup");
		expect(result.sessions).toEqual([]);
		expect(result.selectedSession).toBeNull();
	});
});
