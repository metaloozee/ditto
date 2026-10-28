import { beforeEach, describe, expect, it, vi } from "vitest";

const mintMock = vi.hoisted(() => vi.fn());
const reposGetMock = vi.hoisted(() => vi.fn());
const getBranchMock = vi.hoisted(() => vi.fn());
const getInstallationOctokitMock = vi.hoisted(() => vi.fn());

vi.mock("./github-app", () => ({
	getInstallationAccessToken: mintMock,
	getGitHubApp: () => ({ getInstallationOctokit: getInstallationOctokitMock }),
}));

import { candidateGitHubDeps } from "./candidate-branch-fetch";

const scope = {
	userId: "owner",
	projectId: "project",
	workspaceSessionId: "session",
	ownerVersion: 1,
};
const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "key" };

function fakeDb(installation: number | null | undefined) {
	const lookups: unknown[][] = [];
	const db = {
		prepare: () => ({
			bind: (...args: unknown[]) => ({
				first: async () => {
					lookups.push(args);
					const [projectId, userId, repo] = args;
					return projectId === "project" &&
						userId === "owner" &&
						repo === "acme/app" &&
						installation !== undefined
						? { githubInstallationId: installation }
						: null;
				},
			}),
		}),
	} as unknown as D1Database;
	return { db, lookups };
}

beforeEach(() => {
	vi.clearAllMocks();
	mintMock.mockResolvedValue("token");
	getInstallationOctokitMock.mockResolvedValue({
		rest: { repos: { get: reposGetMock, getBranch: getBranchMock } },
	});
});

describe("candidateGitHubDeps", () => {
	it("mints for the scope's project installation with the short repository name", async () => {
		const { db, lookups } = fakeDb(42);
		const deps = candidateGitHubDeps(env, db, scope);
		await expect(deps.mintToken("acme/app")).resolves.toBe("token");
		expect(lookups).toEqual([["project", "owner", "acme/app"]]);
		expect(mintMock).toHaveBeenCalledWith(env, 42, { repositories: ["app"] });
	});

	it("throws without minting for another repository, another user or no installation", async () => {
		const missing = candidateGitHubDeps(env, fakeDb(null).db, scope);
		const wrongRepo = candidateGitHubDeps(env, fakeDb(42).db, scope);
		const wrongUser = candidateGitHubDeps(env, fakeDb(42).db, {
			...scope,
			userId: "other",
		});
		for (const [deps, repo] of [
			[missing, "acme/app"],
			[wrongRepo, "acme/other"],
			[wrongUser, "acme/app"],
		] as const) {
			await expect(deps.mintToken(repo)).rejects.toThrow();
			await expect(deps.github.defaultBranch(repo)).rejects.toThrow();
			await expect(deps.github.branchExists(repo, "main")).rejects.toThrow();
		}
		expect(mintMock).not.toHaveBeenCalled();
		expect(getInstallationOctokitMock).not.toHaveBeenCalled();
	});

	it("maps a 404 to a missing branch and rethrows other failures", async () => {
		const deps = candidateGitHubDeps(env, fakeDb(42).db, scope);
		getBranchMock.mockResolvedValueOnce({ data: {} });
		await expect(deps.github.branchExists("acme/app", "feature")).resolves.toBe(
			true,
		);
		expect(getBranchMock).toHaveBeenCalledWith({
			owner: "acme",
			repo: "app",
			branch: "feature",
		});
		getBranchMock.mockRejectedValueOnce({ status: 404 });
		await expect(deps.github.branchExists("acme/app", "nope")).resolves.toBe(
			false,
		);
		getBranchMock.mockRejectedValueOnce({ status: 500 });
		await expect(
			deps.github.branchExists("acme/app", "boom"),
		).rejects.toMatchObject({ status: 500 });
	});

	it("returns the repository's default branch", async () => {
		const deps = candidateGitHubDeps(env, fakeDb(42).db, scope);
		reposGetMock.mockResolvedValueOnce({ data: { default_branch: "trunk" } });
		await expect(deps.github.defaultBranch("acme/app")).resolves.toBe("trunk");
		reposGetMock.mockResolvedValueOnce({ data: { default_branch: "" } });
		await expect(deps.github.defaultBranch("acme/app")).rejects.toThrow();
	});
});
