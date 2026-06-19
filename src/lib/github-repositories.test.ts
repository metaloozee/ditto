import { describe, expect, it, vi } from "vitest";
import {
	loadGitHubRepositories,
	toGitHubRepo,
} from "#/lib/github-repositories";

describe("toGitHubRepo", () => {
	it("maps GitHub API repository fields into dialog fields", () => {
		expect(
			toGitHubRepo({
				full_name: "acme/dashboard",
				language: "TypeScript",
				private: true,
				stargazers_count: 42,
			}),
		).toEqual({
			name: "acme/dashboard",
			language: "TypeScript",
			isPrivate: true,
			stars: 42,
		});
	});
});

describe("loadGitHubRepositories", () => {
	it("links GitHub, waits for auth, and fetches repositories", async () => {
		const linkSocial = vi.fn().mockResolvedValue({
			data: { url: "https://github.com/login/oauth/authorize" },
			error: null,
		});
		const getAccessToken = vi.fn().mockResolvedValue({
			accessToken: "token-123",
			error: null,
		});
		const popup = {
			closed: false,
			close: vi.fn(),
			location: { href: "about:blank" },
		} as unknown as Window;
		const waitForAuthComplete = vi.fn().mockResolvedValue(undefined);
		const fetchRepos = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [
				{
					full_name: "acme/dashboard",
					language: "TypeScript",
					private: false,
					stargazers_count: 3,
				},
			],
		});

		const repos = await loadGitHubRepositories({
			auth: { linkSocial, getAccessToken } as never,
			openAuthWindow: () => popup,
			waitForAuthComplete,
			fetchRepos: fetchRepos as unknown as typeof fetch,
		});

		expect(linkSocial).toHaveBeenCalledWith({
			provider: "github",
			scopes: ["repo"],
			disableRedirect: true,
			callbackURL: "/auth/github-link-complete",
		});
		expect(popup.location.href).toBe(
			"https://github.com/login/oauth/authorize",
		);
		expect(waitForAuthComplete).toHaveBeenCalledWith(popup);
		expect(getAccessToken).toHaveBeenCalledWith({ providerId: "github" });
		expect(fetchRepos).toHaveBeenCalledWith(
			expect.stringContaining("https://api.github.com/user/repos"),
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer token-123" }),
			}),
		);
		expect(repos).toEqual([
			{
				name: "acme/dashboard",
				language: "TypeScript",
				isPrivate: false,
				stars: 3,
			},
		]);
	});

	it("closes the popup and throws when the GitHub API request fails", async () => {
		const linkSocial = vi.fn().mockResolvedValue({
			data: { url: "https://github.com/login/oauth/authorize" },
			error: null,
		});
		const getAccessToken = vi.fn().mockResolvedValue({
			accessToken: "token-123",
			error: null,
		});
		const popup = {
			closed: false,
			close: vi.fn(),
			location: { href: "about:blank" },
		} as unknown as Window;
		const fetchRepos = vi.fn().mockResolvedValue({ ok: false, status: 500 });

		await expect(
			loadGitHubRepositories({
				auth: { linkSocial, getAccessToken } as never,
				openAuthWindow: () => popup,
				waitForAuthComplete: async () => undefined,
				fetchRepos: fetchRepos as unknown as typeof fetch,
			}),
		).rejects.toThrow("GitHub API request failed (500).");
		expect(popup.close).toHaveBeenCalled();
	});

	it("throws a user-facing error when the access token is missing", async () => {
		const linkSocial = vi.fn().mockResolvedValue({
			data: { url: "https://github.com/login/oauth/authorize" },
			error: null,
		});
		const getAccessToken = vi.fn().mockResolvedValue({ error: null });
		const popup = {
			closed: false,
			close: vi.fn(),
			location: { href: "about:blank" },
		} as unknown as Window;

		await expect(
			loadGitHubRepositories({
				auth: { linkSocial, getAccessToken } as never,
				openAuthWindow: () => popup,
				waitForAuthComplete: async () => undefined,
			}),
		).rejects.toThrow("GitHub access token was not returned.");
	});
});
