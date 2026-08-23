import { beforeEach, describe, expect, it, vi } from "vitest";

const recordMutationAndCheckpointMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/workspace-recovery", () => ({
	recordMutationAndCheckpoint: recordMutationAndCheckpointMock,
}));

const { commitSessionChangesWithBackup, runSessionGitMutationWithBackup } =
	await import("./session-git-backup");
const project = { id: "p1", userId: "u1" };
const session = { id: "sess-1" };
const db = {} as Parameters<typeof commitSessionChangesWithBackup>[0]["db"];
const env = {} as Env;

describe("session Git recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		recordMutationAndCheckpointMock.mockResolvedValue({ state: "healthy" });
	});

	it("checkpoints after a created commit", async () => {
		const result = await commitSessionChangesWithBackup({
			db,
			env,
			project,
			session,
			commit: vi.fn().mockResolvedValue({ commitSha: "abc", committed: true }),
		});
		expect(result).toEqual({ commitSha: "abc", committed: true });
		expect(recordMutationAndCheckpointMock).toHaveBeenCalledWith({
			db,
			env,
			userId: "u1",
			projectId: "p1",
			sessionId: "sess-1",
		});
	});

	it("does not checkpoint a no-op commit", async () => {
		await commitSessionChangesWithBackup({
			db,
			env,
			project,
			session,
			commit: vi.fn().mockResolvedValue({ commitSha: null, committed: false }),
		});
		expect(recordMutationAndCheckpointMock).not.toHaveBeenCalled();
	});

	it("checkpoints after another successful Git mutation", async () => {
		await expect(
			runSessionGitMutationWithBackup({
				db,
				env,
				project,
				session,
				run: vi.fn().mockResolvedValue({ updated: true }),
			}),
		).resolves.toEqual({ updated: true });
		expect(recordMutationAndCheckpointMock).toHaveBeenCalledOnce();
	});

	it("keeps the Git result when checkpointing fails", async () => {
		recordMutationAndCheckpointMock.mockRejectedValue(new Error("failed"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		await expect(
			runSessionGitMutationWithBackup({
				db,
				env,
				project,
				session,
				run: vi.fn().mockResolvedValue({ updated: true }),
			}),
		).resolves.toEqual({ updated: true });
		consoleError.mockRestore();
	});
});
