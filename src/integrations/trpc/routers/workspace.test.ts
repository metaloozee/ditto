import { beforeEach, describe, expect, it, vi } from "vitest";

const createDbMock = vi.hoisted(() => vi.fn());
const ensureProjectSandboxMock = vi.hoisted(() => vi.fn());
const resolveSessionForMessageWriteMock = vi.hoisted(() => vi.fn());
const archiveOwnedActiveSessionMock = vi.hoisted(() => vi.fn());
const workspaceSessionRecencyUpdateMock = vi.hoisted(() => vi.fn());

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
	loadOwnedActiveSession: vi.fn(),
}));

const { workspaceRouter } = await import("./workspace");

const activeSession = {
	id: "sess-1",
	projectId: "proj-1",
	userId: "user-1",
	status: "active" as const,
	title: "Chat",
	branchName: null,
	baseCommitSha: null,
	workspacePath: "/workspace",
	memoryPath: "/workspace/.ditto/memory",
	createdAt: new Date(),
	updatedAt: new Date(),
};

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
	sandboxBackupCommittedGeneration: 0,
	envVars: null,
	status: "ready" as const,
	createdAt: new Date(),
	updatedAt: new Date(),
};

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

function mockProjectSelect() {
	const limit = vi.fn().mockResolvedValue([readyProject]);
	const where = vi.fn().mockReturnValue({ limit });
	const from = vi.fn().mockReturnValue({ where });
	const select = vi.fn().mockReturnValue({ from });
	const batch = vi.fn();
	const insertReturning = vi.fn();
	const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
	const insert = vi.fn().mockReturnValue({ values: insertValues });

	createDbMock.mockReturnValue({
		select,
		batch,
		insert,
	});

	return { select, batch, insert, insertValues, insertReturning, limit };
}

describe("workspace.sendMessage session lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureProjectSandboxMock.mockResolvedValue({
			project: readyProject,
			state: "ready",
		});
		workspaceSessionRecencyUpdateMock.mockReturnValue({
			__kind: "recency-update",
		});
	});

	it("uses an owned active session and bumps recency in the message batch", async () => {
		const db = mockProjectSelect();
		resolveSessionForMessageWriteMock.mockResolvedValue({
			kind: "existing",
			session: activeSession,
		});

		const userMessage = {
			id: "msg-1",
			sessionId: "sess-1",
			projectId: "proj-1",
			userId: "user-1",
			role: "user",
			content: "hello",
			model: "opencode-go/deepseek-v4-flash",
		};
		db.batch.mockResolvedValue([[userMessage]]);

		const caller = createCaller();
		const result = await caller.sendMessage({
			projectId: "proj-1",
			sessionId: "sess-1",
			message: "hello",
			model: "opencode-go/deepseek-v4-flash",
		});

		expect(resolveSessionForMessageWriteMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				userId: "user-1",
				sessionId: "sess-1",
			}),
		);
		expect(result.createdSession).toBe(false);
		expect(result.session.id).toBe("sess-1");
		expect(db.batch).toHaveBeenCalledTimes(1);
		const batchArgs = db.batch.mock.calls[0]?.[0] as unknown[];
		expect(batchArgs).toHaveLength(2);
		expect(workspaceSessionRecencyUpdateMock).toHaveBeenCalledWith(
			expect.anything(),
			"sess-1",
		);
		expect(batchArgs[1]).toEqual({ __kind: "recency-update" });
	});

	it("rejects an archived / missing explicit session id without creating a replacement", async () => {
		mockProjectSelect();
		resolveSessionForMessageWriteMock.mockResolvedValue({ kind: "not_found" });

		const caller = createCaller();
		await expect(
			caller.sendMessage({
				projectId: "proj-1",
				sessionId: "sess-archived",
				message: "hello",
				model: "opencode-go/deepseek-v4-flash",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Session not found.",
		});

		// No session insert / message batch when explicit id is invalid.
		const db = createDbMock.mock.results[0]?.value as {
			batch: ReturnType<typeof vi.fn>;
			insert: ReturnType<typeof vi.fn>;
		};
		expect(db.batch).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
	});

	it("creates a new session when no explicit session id is provided", async () => {
		const db = mockProjectSelect();
		resolveSessionForMessageWriteMock.mockResolvedValue({ kind: "create" });

		const created = { ...activeSession, id: "sess-new" };
		db.insertReturning.mockResolvedValue([created]);
		// First batch creates session; second inserts message + recency.
		db.batch.mockResolvedValueOnce([[created]]).mockResolvedValueOnce([
			[
				{
					id: "msg-1",
					sessionId: "sess-new",
					role: "user",
					content: "hello",
				},
			],
		]);

		const caller = createCaller();
		const result = await caller.sendMessage({
			projectId: "proj-1",
			message: "hello",
			model: "opencode-go/deepseek-v4-flash",
		});

		expect(result.createdSession).toBe(true);
		expect(db.batch).toHaveBeenCalledTimes(2);
		expect(workspaceSessionRecencyUpdateMock).toHaveBeenCalled();
	});
});

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
