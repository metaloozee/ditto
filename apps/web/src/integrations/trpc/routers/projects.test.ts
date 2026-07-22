import { beforeEach, describe, expect, it, vi } from "vitest";

const createDbMock = vi.hoisted(() => vi.fn());
const deleteProjectWithPreviewFenceMock = vi.hoisted(() => vi.fn());
const destroySandboxMock = vi.hoisted(() => vi.fn());

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/sandbox-bootstrap", () => ({
	bootstrapSandbox: vi.fn(),
	destroySandbox: destroySandboxMock,
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

vi.mock("#/lib/github-authorization", () => ({
	authorizeGitHubRepositoryAccess: vi.fn(),
}));

vi.mock("#/lib/project-env-vars", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#/lib/project-env-vars")>();
	return actual;
});

vi.mock("#/lib/sandbox-backup", () => ({
	serializeSandboxBackup: vi.fn(),
}));

vi.mock("#/lib/session-preview", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/session-preview")>();
	return {
		...actual,
		deleteProjectWithPreviewFence: deleteProjectWithPreviewFenceMock,
	};
});

const { projectsRouter } = await import("./projects");
const { SessionPreviewError } = await import("#/lib/session-preview");

function createCaller() {
	return projectsRouter.createCaller({
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

describe("projects.deleteProject fence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
	});

	it("delegates to deleteProjectWithPreviewFence with destroySandbox", async () => {
		deleteProjectWithPreviewFenceMock.mockResolvedValue({ id: "proj-1" });
		const result = await createCaller().deleteProject({ id: "proj-1" });
		expect(result).toEqual({ id: "proj-1" });
		expect(deleteProjectWithPreviewFenceMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				userId: "user-1",
				destroySandbox: destroySandboxMock,
			}),
		);
	});

	it("maps not_found", async () => {
		deleteProjectWithPreviewFenceMock.mockRejectedValue(
			new SessionPreviewError("not_found", "Session or project not found."),
		);
		await expect(
			createCaller().deleteProject({ id: "missing" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Project not found.",
		});
	});

	it("maps busy", async () => {
		deleteProjectWithPreviewFenceMock.mockRejectedValue(
			new SessionPreviewError("busy", "Preview is busy. Try again shortly."),
		);
		await expect(
			createCaller().deleteProject({ id: "proj-1" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});
