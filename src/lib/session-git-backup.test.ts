import { beforeEach, describe, expect, it, vi } from "vitest";

const persistProjectSandboxBackupMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/project-sandbox", () => ({
	persistProjectSandboxBackup: persistProjectSandboxBackupMock,
}));

const {
	commitSessionChangesWithBackup,
	openSessionPullRequestWithBackup,
	runSessionGitMutationWithBackup,
} = await import("./session-git-backup");

const project = {
	id: "p1",
	userId: "u1",
	sandboxId: "s1",
	status: "ready" as const,
};

const db = {} as Parameters<typeof commitSessionChangesWithBackup>[0]["db"];
const env = {} as Env;

describe("session-git-backup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		persistProjectSandboxBackupMock.mockResolvedValue({});
	});

	describe("commitSessionChangesWithBackup", () => {
		it("persists when committed is true", async () => {
			const commit = vi.fn().mockResolvedValue({
				commitSha: "abc",
				committed: true,
			});

			const result = await commitSessionChangesWithBackup({
				db,
				env,
				project,
				commit,
			});

			expect(result).toEqual({ commitSha: "abc", committed: true });
			expect(persistProjectSandboxBackupMock).toHaveBeenCalledWith({
				db,
				env,
				project,
			});
		});

		it("does not persist when committed is false", async () => {
			const commit = vi.fn().mockResolvedValue({
				commitSha: null,
				committed: false,
			});

			await commitSessionChangesWithBackup({ db, env, project, commit });

			expect(persistProjectSandboxBackupMock).not.toHaveBeenCalled();
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
				commitSessionChangesWithBackup({ db, env, project, commit }),
			).resolves.toEqual({ commitSha: "abc", committed: true });

			consoleError.mockRestore();
		});
	});

	describe("runSessionGitMutationWithBackup", () => {
		it("persists after successful push mutation", async () => {
			const run = vi.fn().mockResolvedValue({ pushed: true });

			await expect(
				runSessionGitMutationWithBackup({ db, env, project, run }),
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
				runSessionGitMutationWithBackup({ db, env, project, run }),
			).resolves.toEqual({ pushed: true });

			consoleError.mockRestore();
		});
	});

	describe("openSessionPullRequestWithBackup", () => {
		it("persists after auto-push even when open pull request fails", async () => {
			const pushIfNeeded = vi.fn().mockResolvedValue(true);
			const open = vi.fn().mockRejectedValue(new Error("pr failed"));

			await expect(
				openSessionPullRequestWithBackup({
					db,
					env,
					project,
					pushIfNeeded,
					open,
				}),
			).rejects.toThrow("pr failed");

			expect(pushIfNeeded).toHaveBeenCalled();
			expect(persistProjectSandboxBackupMock).toHaveBeenCalledTimes(1);
			expect(open).toHaveBeenCalled();
		});

		it("persists after open when no push was needed", async () => {
			const pushIfNeeded = vi.fn().mockResolvedValue(false);
			const open = vi.fn().mockResolvedValue({ url: "https://pr", number: 2 });

			await expect(
				openSessionPullRequestWithBackup({
					db,
					env,
					project,
					pushIfNeeded,
					open,
				}),
			).resolves.toEqual({ url: "https://pr", number: 2 });

			expect(persistProjectSandboxBackupMock).toHaveBeenCalledTimes(1);
		});
	});
});
