import { beforeEach, describe, expect, it, vi } from "vitest";

const createDbMock = vi.hoisted(() => vi.fn());
const startSessionPreviewMock = vi.hoisted(() => vi.fn());
const stopSessionPreviewMock = vi.hoisted(() => vi.fn());

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandbox: vi.fn(),
}));
vi.mock("#/lib/project-sandbox", () => ({
	ensureProjectSandbox: vi.fn(),
}));
vi.mock("#/lib/session-worktree", () => ({
	ensureSessionWorktree: vi.fn(),
}));
vi.mock("#/lib/session-workspace-lock", () => ({
	withSessionWorkspaceLock: vi.fn(),
}));

vi.mock("#/lib/session-preview", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/session-preview")>();
	return {
		...actual,
		startSessionPreview: startSessionPreviewMock,
		stopSessionPreview: stopSessionPreviewMock,
	};
});

const { sessionPreviewRouter } = await import("./session-preview");
const { SessionPreviewError } = await import("#/lib/session-preview");

function createCaller() {
	return sessionPreviewRouter.createCaller({
		env: { DB: {}, PREVIEW_BASE_HOST: "ayn.wtf" } as Env,
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
		request: new Request("https://ayn.wtf/app"),
		auth: {} as never,
	});
}

describe("sessionPreview router", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
	});

	it("starts with exact ids and request url", async () => {
		startSessionPreviewMock.mockResolvedValue({
			status: "running",
			url: "https://10000-box-token.ayn.wtf",
			port: 10000,
			reused: false,
		});

		const result = await createCaller().start({
			projectId: "proj-1",
			sessionId: "sess-1",
		});

		expect(result).toEqual({
			status: "running",
			url: "https://10000-box-token.ayn.wtf",
			port: 10000,
			reused: false,
		});
		expect(startSessionPreviewMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				sessionId: "sess-1",
				userId: "user-1",
				requestUrl: "https://ayn.wtf/app",
			}),
		);
	});

	it("maps not_found to NOT_FOUND", async () => {
		startSessionPreviewMock.mockRejectedValue(
			new SessionPreviewError("not_found", "Session or project not found."),
		);
		await expect(
			createCaller().start({ projectId: "p", sessionId: "s" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("maps unsupported_project to PRECONDITION_FAILED without raw errors", async () => {
		startSessionPreviewMock.mockRejectedValue(
			new SessionPreviewError(
				"unsupported_project",
				"Only root Vite (>=6.1.0) and Next.js projects with a local dev binary are supported.",
			),
		);
		await expect(
			createCaller().start({ projectId: "p", sessionId: "s" }),
		).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: expect.not.stringMatching(/ECONN|stack|at /),
		});
	});

	it("maps cleanup_failed on stop to BAD_GATEWAY", async () => {
		stopSessionPreviewMock.mockRejectedValue(
			new SessionPreviewError(
				"cleanup_failed",
				"Failed to fully stop the preview. Try again.",
			),
		);
		await expect(
			createCaller().stop({ projectId: "p", sessionId: "s" }),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
	});

	it("stops successfully", async () => {
		stopSessionPreviewMock.mockResolvedValue({ status: "stopped" });
		await expect(
			createCaller().stop({ projectId: "proj-1", sessionId: "sess-1" }),
		).resolves.toEqual({ status: "stopped" });
	});
});
