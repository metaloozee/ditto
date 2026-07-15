import { describe, expect, it, vi } from "vitest";
import { listGitHubBranchNames } from "#/integrations/trpc/routers/github";
import { getGitHubImportState } from "./github-repositories";

const installUrl = "https://github.com/apps/ditto/installations/new";

type ImportPaginate = (
	method: unknown,
	parameters: unknown,
) => Promise<unknown[]>;

function installationPayload(id: number, login = `org-${id}`) {
	return {
		id,
		account: {
			login,
			avatar_url: `https://avatars.example/${login}.png`,
		},
	};
}

function repoPayload(id: number, owner = "acme") {
	return {
		id,
		full_name: `${owner}/repo-${id}`,
		owner: { login: owner },
		name: `repo-${id}`,
		language: id === 101 ? "TypeScript" : null,
		private: id === 101,
		stargazers_count: id,
	};
}

function importMethods() {
	return {
		listInstallationsForAuthenticatedUser: vi.fn(),
		listInstallationReposForAuthenticatedUser: vi.fn(),
	};
}

function importClient(paginate: ImportPaginate, methods = importMethods()) {
	return {
		client: {
			paginate: paginate as <T>(
				method: unknown,
				parameters: unknown,
			) => Promise<T[]>,
			rest: { apps: methods },
		},
		...methods,
	};
}

describe("getGitHubImportState", () => {
	it("maps installations and repositories into the import state shape", async () => {
		const methods = importMethods();
		const paginate: ImportPaginate = async (method) => {
			if (method === methods.listInstallationsForAuthenticatedUser) {
				return [installationPayload(101, "acme")];
			}

			return [
				{
					...repoPayload(202),
					full_name: "acme/rocket",
					name: "rocket",
					language: "TypeScript",
					private: true,
					stargazers_count: 42,
				},
			];
		};

		const state = await getGitHubImportState({
			accessToken: "test-token",
			installUrl,
			client: importClient(paginate, methods).client,
		});

		expect(state).toEqual({
			installUrl,
			installations: [
				{
					id: 101,
					account: {
						login: "acme",
						avatarUrl: "https://avatars.example/acme.png",
					},
				},
			],
			repositories: [
				{
					id: 202,
					name: "acme/rocket",
					owner: "acme",
					repoName: "rocket",
					language: "TypeScript",
					isPrivate: true,
					stars: 42,
					installationId: 101,
				},
			],
		});
	});

	it("flattens paginated installations into one import state", async () => {
		const installations = Array.from({ length: 101 }, (_, index) =>
			installationPayload(index + 1),
		);
		const methods = importMethods();
		const setup = importClient(async (method) => {
			if (method === methods.listInstallationsForAuthenticatedUser) {
				return installations;
			}

			return [];
		}, methods);

		const state = await getGitHubImportState({
			accessToken: "test-token",
			installUrl,
			client: setup.client,
		});

		expect(state.installations).toHaveLength(101);
		expect(state.installations.at(-1)).toEqual({
			id: 101,
			account: {
				login: "org-101",
				avatarUrl: "https://avatars.example/org-101.png",
			},
		});
	});

	it("flattens paginated repositories under one installation", async () => {
		const repositories = Array.from({ length: 101 }, (_, index) =>
			repoPayload(index + 1),
		);
		const methods = importMethods();
		const setup = importClient(async (method) => {
			if (method === methods.listInstallationsForAuthenticatedUser) {
				return [installationPayload(101, "acme")];
			}

			return repositories;
		}, methods);

		const state = await getGitHubImportState({
			accessToken: "test-token",
			installUrl,
			client: setup.client,
		});

		expect(state.repositories).toHaveLength(101);
		expect(state.repositories.at(-1)).toEqual({
			id: 101,
			name: "acme/repo-101",
			owner: "acme",
			repoName: "repo-101",
			language: "TypeScript",
			isPrivate: true,
			stars: 101,
			installationId: 101,
		});
	});

	it("returns partial repository results when one installation listing fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const methods = importMethods();
		const setup = importClient(async (method, parameters) => {
			if (method === methods.listInstallationsForAuthenticatedUser) {
				return [
					installationPayload(101, "acme"),
					installationPayload(303, "octo"),
				];
			}

			if ((parameters as { installation_id: number }).installation_id === 303) {
				throw new Error("GitHub unavailable");
			}

			return [repoPayload(202)];
		}, methods);

		try {
			const state = await getGitHubImportState({
				accessToken: "test-token",
				installUrl,
				client: setup.client,
			});

			expect(state.installations).toHaveLength(2);
			expect(state.repositories).toEqual([
				{
					id: 202,
					name: "acme/repo-202",
					owner: "acme",
					repoName: "repo-202",
					language: null,
					isPrivate: false,
					stars: 202,
					installationId: 101,
				},
			]);
			expect(consoleError).toHaveBeenCalledOnce();
		} finally {
			consoleError.mockRestore();
		}
	});
});

describe("listGitHubBranchNames", () => {
	it("returns branch names beyond the first page", async () => {
		const listBranches = vi.fn();
		const branches = Array.from({ length: 101 }, (_, index) => ({
			name: `branch-${index + 1}`,
		}));
		const paginate = vi.fn(async () => branches);

		const result = await listGitHubBranchNames(
			{
				paginate: paginate as unknown as <T>(
					method: unknown,
					parameters?: unknown,
				) => Promise<T[]>,
				rest: {
					repos: { listBranches },
				},
			},
			{ owner: "acme", repo: "rocket" },
		);

		expect(result).toHaveLength(101);
		expect(result.at(-1)).toBe("branch-101");
		expect(paginate).toHaveBeenCalledWith(listBranches, {
			owner: "acme",
			repo: "rocket",
			per_page: 100,
		});
	});
});
