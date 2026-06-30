import { describe, expect, it, vi } from "vitest";
import { authorizeGitHubRepositoryAccess } from "./github-authorization";

const installUrl = "https://github.com/apps/ditto/installations/new";

function visibleRepo(overrides: Partial<Repo> = {}): Repo {
	return {
		id: 202,
		name: "acme/rocket",
		owner: "acme",
		repoName: "rocket",
		language: "TypeScript",
		isPrivate: true,
		stars: 42,
		installationId: 101,
		...overrides,
	};
}

type Repo = Awaited<
	ReturnType<typeof authorizeGitHubRepositoryAccess>
>;

function authContext(accessToken: string | null = "github-token") {
	const headers = new Headers({ cookie: "session=abc" });
	const getAccessToken = vi.fn(async () => ({ accessToken }));

	return {
		ctx: {
			env: { VITE_GITHUB_APP_INSTALL_URL: installUrl },
			auth: { api: { getAccessToken } },
			request: { headers },
			user: { id: "user-1" },
		},
		getAccessToken,
		headers,
	};
}

describe("authorizeGitHubRepositoryAccess", () => {
	it("returns the visible repo for a valid repo and installation pair", async () => {
		const { ctx, getAccessToken, headers } = authContext();
		const repo = visibleRepo();
		const loadImportState = vi.fn(async () => ({
			installUrl,
			installations: [],
			repositories: [repo],
		}));

		await expect(
			authorizeGitHubRepositoryAccess({
				ctx,
				repo: "acme/rocket",
				installationId: 101,
				loadImportState,
			}),
		).resolves.toBe(repo);
		expect(getAccessToken).toHaveBeenCalledWith({
			body: { providerId: "github", userId: "user-1" },
			headers,
		});
		expect(loadImportState).toHaveBeenCalledWith({
			accessToken: "github-token",
			installUrl,
		});
	});

	it("rejects a visible repo with a mismatched installation id", async () => {
		const { ctx } = authContext();
		const loadImportState = vi.fn(async () => ({
			installUrl,
			installations: [],
			repositories: [visibleRepo({ installationId: 202 })],
		}));

		await expect(
			authorizeGitHubRepositoryAccess({
				ctx,
				repo: "acme/rocket",
				installationId: 101,
				loadImportState,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "GitHub repository is not accessible to this user.",
		});
	});

	it("rejects a repo missing from the user's visible import state", async () => {
		const { ctx } = authContext();
		const loadImportState = vi.fn(async () => ({
			installUrl,
			installations: [],
			repositories: [visibleRepo({ name: "octo/widgets" })],
		}));

		await expect(
			authorizeGitHubRepositoryAccess({
				ctx,
				repo: "acme/rocket",
				installationId: 101,
				loadImportState,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "GitHub repository is not accessible to this user.",
		});
	});

	it("preserves the expired GitHub OAuth token error", async () => {
		const { ctx } = authContext(null);
		const loadImportState = vi.fn();

		await expect(
			authorizeGitHubRepositoryAccess({
				ctx,
				repo: "acme/rocket",
				installationId: 101,
				loadImportState,
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
			message: "GitHub Auth expired, sign in again.",
		});
		expect(loadImportState).not.toHaveBeenCalled();
	});
});
