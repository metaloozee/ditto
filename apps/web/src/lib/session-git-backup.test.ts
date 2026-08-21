import { beforeEach, describe, expect, it, vi } from "vitest";

const persistProjectSandboxBackupMock = vi.hoisted(() => vi.fn());
const recordMutationAndCheckpointMock = vi.hoisted(() => vi.fn());
const isLegacySharedSandboxSessionMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/project-sandbox", () => ({
	persistProjectSandboxBackup: persistProjectSandboxBackupMock,
}));

vi.mock("#/lib/workspace-recovery", () => ({
	recordMutationAndCheckpoint: recordMutationAndCheckpointMock,
}));

vi.mock("#/lib/workspace-runtime", () => ({
	isLegacySharedSandboxSession: isLegacySharedSandboxSessionMock,
}));

const { commitSessionChangesWithBackup, runSessionGitMutationWithBackup } =
	await import("./session-git-backup");

const project = {
	id: "p1",
	userId: "u1",
	sandboxId: "s1",
	status: "ready" as const,
};

const legacySession = {
	id: "sess-1",
	sandboxIdentityId: null,
	baseCommitSha: "abc",
	workspacePath: "/workspace/.ditto/worktrees/sess-1",
	branchName: "ditto/session-sess-1",
};

const dedicatedSession = {
	id: "sess-2",
	sandboxIdentityId: "ident-1",
	baseCommitSha: "abc",
	workspacePath: "/workspace",
	branchName: "ditto/session-sess-2",
};

const db = {} as Parameters<typeof commitSessionChangesWithBackup>[0]["db"];
const env = {} as Env;

describe("session-git-backup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		persistProjectSandboxBackupMock.mockResolvedValue({});
		recordMutationAndCheckpointMock.mockResolvedValue({
			state: "healthy",
			pending: false,
		});
		isLegacySharedSandboxSessionMock.mockReturnValue(true);
	});

	describe("commitSessionChangesWithBackup", () => {
		it("persists legacy project backup when committed is true", async () => {
			const commit = vi.fn().mockResolvedValue({
				commitSha: "abc",
				committed: true,
			});

			const result = await commitSessionChangesWithBackup({
				db,
				env,
				project,
				session: legacySession,
				commit,
			});

			expect(result).toEqual({ commitSha: "abc", committed: true });
			expect(persistProjectSandboxBackupMock).toHaveBeenCalledWith({
				db,
				env,
				project,
			});
			expect(recordMutationAndCheckpointMock).not.toHaveBeenCalled();
		});

		it("checkpoints dedicated session recovery when committed is true", async () => {
			isLegacySharedSandboxSessionMock.mockReturnValue(false);
			const commit = vi.fn().mockResolvedValue({
				commitSha: "abc",
				committed: true,
			});

			await commitSessionChangesWithBackup({
				db,
				env,
				project,
				session: dedicatedSession,
				commit,
			});

			expect(recordMutationAndCheckpointMock).toHaveBeenCalledWith({
				db,
				env,
				userId: "u1",
				projectId: "p1",
				sessionId: "sess-2",
			});
			expect(persistProjectSandboxBackupMock).not.toHaveBeenCalled();
		});

		it("does not persist when committed is false", async () => {
			const commit = vi.fn().mockResolvedValue({
				commitSha: null,
				committed: false,
			});

			await commitSessionChangesWithBackup({
				db,
				env,
				project,
				session: legacySession,
				commit,
			});

			expect(persistProjectSandboxBackupMock).not.toHaveBeenCalled();
			expect(recordMutationAndCheckpointMock).not.toHaveBeenCalled();
		});

		it("returns git result when persist throws", async () => {
			persistProjectSandboxBackupMock.mockRejectedValue(
				new Error("backup failed"),
			);
			const commit = vi.fn().mockResolvedValue({
				commitSha: "abc",
				committed: true,
			});
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			await expect(
				commitSessionChangesWithBackup({
					db,
					env,
					project,
					session: legacySession,
					commit,
				}),
			).resolves.toEqual({ commitSha: "abc", committed: true });

			consoleError.mockRestore();
		});
	});

	describe("runSessionGitMutationWithBackup", () => {
		it("persists after successful push mutation", async () => {
			const run = vi.fn().mockResolvedValue({ pushed: true });

			await expect(
				runSessionGitMutationWithBackup({
					db,
					env,
					project,
					session: legacySession,
					run,
				}),
			).resolves.toEqual({ pushed: true });

			expect(persistProjectSandboxBackupMock).toHaveBeenCalled();
		});

		it("returns git result when persist throws", async () => {
			persistProjectSandboxBackupMock.mockRejectedValue(
				new Error("backup failed"),
			);
			const run = vi.fn().mockResolvedValue({ pushed: true });
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			await expect(
				runSessionGitMutationWithBackup({
					db,
					env,
					project,
					session: legacySession,
					run,
				}),
			).resolves.toEqual({ pushed: true });

			consoleError.mockRestore();
		});
	});
});
