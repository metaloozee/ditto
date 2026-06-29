import { describe, expect, it, vi } from "vitest";
import { getGitHubImportState } from "./github-repositories";

describe("getGitHubImportState", () => {
	it("maps installations and repositories into the import state shape", async () => {
		const state = await getGitHubImportState({
			accessToken: "test-token",
			installUrl: "https://github.com/apps/ditto/installations/new",
			client: {
				rest: {
					apps: {
						listInstallationsForAuthenticatedUser: async () => ({
							data: {
								installations: [
									{
										id: 101,
										account: {
											login: "acme",
											avatar_url: "https://avatars.example/acme.png",
										},
									},
								],
							},
						}),
						listInstallationReposForAuthenticatedUser: async () => ({
							data: {
								repositories: [
									{
										id: 202,
										full_name: "acme/rocket",
										owner: { login: "acme" },
										name: "rocket",
										language: "TypeScript",
										private: true,
										stargazers_count: 42,
									},
								],
							},
						}),
					},
				},
			},
		});

		expect(state).toEqual({
			installUrl: "https://github.com/apps/ditto/installations/new",
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

	it("returns partial repository results when one installation listing fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		try {
			const state = await getGitHubImportState({
				accessToken: "test-token",
				installUrl: "https://github.com/apps/ditto/installations/new",
				client: {
					rest: {
						apps: {
							listInstallationsForAuthenticatedUser: async () => ({
								data: {
									installations: [
										{
											id: 101,
											account: {
												login: "acme",
												avatar_url: "https://avatars.example/acme.png",
											},
										},
										{
											id: 303,
											account: {
												login: "octo",
												avatar_url: "https://avatars.example/octo.png",
											},
										},
									],
								},
							}),
							listInstallationReposForAuthenticatedUser: async ({
								installation_id,
							}) => {
								if (installation_id === 303) {
									throw new Error("GitHub unavailable");
								}

								return {
									data: {
										repositories: [
											{
												id: 202,
												full_name: "acme/rocket",
												owner: { login: "acme" },
												name: "rocket",
												language: null,
												private: false,
												stargazers_count: 7,
											},
										],
									},
								};
							},
						},
					},
				},
			});

			expect(state.installations).toEqual([
				{
					id: 101,
					account: {
						login: "acme",
						avatarUrl: "https://avatars.example/acme.png",
					},
				},
				{
					id: 303,
					account: {
						login: "octo",
						avatarUrl: "https://avatars.example/octo.png",
					},
				},
			]);
			expect(state.repositories).toEqual([
				{
					id: 202,
					name: "acme/rocket",
					owner: "acme",
					repoName: "rocket",
					language: null,
					isPrivate: false,
					stars: 7,
					installationId: 101,
				},
			]);
			expect(state.installUrl).toBe(
				"https://github.com/apps/ditto/installations/new",
			);
			expect(consoleError).toHaveBeenCalledOnce();
		} finally {
			consoleError.mockRestore();
		}
	});
});
