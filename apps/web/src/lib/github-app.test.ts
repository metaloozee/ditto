import { afterEach, describe, expect, it, vi } from "vitest";

const createInstallationAccessToken = vi.fn();

vi.mock("octokit", () => ({
	App: class App {
		octokit = {
			rest: {
				apps: {
					createInstallationAccessToken,
				},
			},
		};
	},
}));

const {
	getInstallationAccessToken,
	revokeInstallationAccessToken,
	repositoryNameFromSlug,
} = await import("./github-app");

const env = {
	GITHUB_APP_ID: "123",
	GITHUB_APP_PRIVATE_KEY: "fake-key",
};

const TOKEN = `ghs_${"a".repeat(40)}`;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("getInstallationAccessToken", () => {
	it("preserves repository short-name scoping without permissions", async () => {
		createInstallationAccessToken.mockResolvedValue({ data: { token: TOKEN } });
		const token = await getInstallationAccessToken(env, 42, {
			repositories: ["widget"],
		});
		expect(token).toBe(TOKEN);
		expect(createInstallationAccessToken).toHaveBeenCalledWith({
			installation_id: 42,
			repositories: ["widget"],
		});
	});

	it("requests exact contents read/write permission when asked", async () => {
		createInstallationAccessToken.mockResolvedValue({ data: { token: TOKEN } });
		await getInstallationAccessToken(env, 7, {
			repositories: ["widget"],
			contents: "read",
		});
		expect(createInstallationAccessToken).toHaveBeenCalledWith({
			installation_id: 7,
			repositories: ["widget"],
			permissions: { contents: "read" },
		});
		await getInstallationAccessToken(env, 7, {
			repositories: ["widget"],
			contents: "write",
		});
		expect(createInstallationAccessToken).toHaveBeenLastCalledWith({
			installation_id: 7,
			repositories: ["widget"],
			permissions: { contents: "write" },
		});
	});

	it("repositoryNameFromSlug returns short name only", () => {
		expect(repositoryNameFromSlug("acme/widget")).toBe("widget");
		expect(repositoryNameFromSlug("widget")).toBeUndefined();
	});
});

describe("revokeInstallationAccessToken", () => {
	it("succeeds on 204 and sends token only in Authorization", async () => {
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toBe("https://api.github.com/installation/token");
				expect(init?.method).toBe("DELETE");
				const headers = new Headers(init?.headers);
				expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
				expect(headers.get("accept")).toBe("application/vnd.github+json");
				expect(headers.get("x-github-api-version")).toBe("2022-11-28");
				// Body must not carry the token
				expect(init?.body).toBeUndefined();
				return new Response(null, { status: 204 });
			},
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(revokeInstallationAccessToken(TOKEN)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("fails with fixed message on non-204 and never embeds token", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 500 })),
		);
		await expect(revokeInstallationAccessToken(TOKEN)).rejects.toThrow(
			"installation token revoke failed",
		);
		try {
			await revokeInstallationAccessToken(TOKEN);
		} catch (err) {
			expect(String(err)).not.toContain(TOKEN);
			expect(String(err)).not.toContain("ghs_");
		}
	});

	it("fails closed on network error without leaking token", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error(`network ${TOKEN}`);
			}),
		);
		try {
			await revokeInstallationAccessToken(TOKEN);
			expect.unreachable();
		} catch (err) {
			expect(String(err)).toBe("Error: installation token revoke failed");
			expect(String(err)).not.toContain(TOKEN);
		}
	});
});
