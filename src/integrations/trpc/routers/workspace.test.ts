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
