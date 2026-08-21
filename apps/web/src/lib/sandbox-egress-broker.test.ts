import { beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxAuthorityError } from "./sandbox-authority";
import { handleOutbound } from "./sandbox-egress-broker";

const mintTokenMock = vi.fn(async () => "ghs_minted_token");
const fetchMock = vi.fn();
const resolveMock = vi.fn();

function makeCtx(
	params: unknown = {
		identityId: "id-1",
		lifecycleGeneration: 1,
	},
) {
	return {
		containerId: "container-1",
		className: "Sandbox",
		params,
	};
}

describe("SandboxEgressBroker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveMock.mockResolvedValue({
			identity: {
				id: "id-1",
				kind: "project_seed",
				sandboxId: "sbx-1",
				containerId: "container-1",
				userId: "user-1",
				projectId: "proj-1",
				workspaceSessionId: null,
				lifecycleGeneration: 1,
				state: "provisioning",
				retiredAt: null,
			},
			operation: {
				id: "op-1",
				identityId: "id-1",
				lifecycleGeneration: 1,
				family: "git_transport",
				type: "project_seed_fetch",
				contractVersion: 1,
				repository: "acme/app",
				allowedRefs: ["refs/heads/main"],
				maxRequests: null,
				consumedRequests: 0,
				openedAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000),
				closedAt: null,
				closeReason: null,
				correlationId: "corr-1",
			},
		});
	});

	const deps = {
		fetch: fetchMock as unknown as typeof fetch,
		createDb: () =>
			({
				select() {
					return {
						from() {
							return {
								where() {
									return {
										limit: async () => [
											{
												githubInstallationId: 42,
												githubRepo: "acme/app",
											},
										],
									};
								},
							};
						},
					};
				},
			}) as never,
		createAuthority: () =>
			({
				resolveOutboundRequest: resolveMock,
			}) as never,
		mintInstallationToken: mintTokenMock,
	};

	it("denied privileged request never forwards to a public origin", async () => {
		const response = await handleOutbound(
			new Request("https://opencode.ai/v1/chat"),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mintTokenMock).not.toHaveBeenCalled();
	});

	it("OpenCode-shaped privileged miss denies", async () => {
		const response = await handleOutbound(
			new Request("https://api.opencode.ai/chat/completions"),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { reasonCode: string };
		expect(body.reasonCode).toBe("privileged_placeholder");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("public internet allow does not attach GitHub/OpenCode credentials", async () => {
		fetchMock.mockResolvedValue(
			new Response("ok", {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);
		const response = await handleOutbound(
			new Request("https://registry.npmjs.org/left-pad", {
				headers: {
					Authorization: "Bearer should-strip",
					Cookie: "x=1",
				},
			}),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const upstream = fetchMock.mock.calls[0]?.[0] as Request;
		expect(upstream.headers.get("Authorization")).toBeNull();
		expect(upstream.headers.get("Cookie")).toBeNull();
		expect(mintTokenMock).not.toHaveBeenCalled();
	});

	it("redirect response is rejected on public path", async () => {
		fetchMock.mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { Location: "https://evil.example/" },
			}),
		);
		const response = await handleOutbound(
			new Request("https://example.com/"),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(502);
		const body = (await response.json()) as { reasonCode: string };
		expect(body.reasonCode).toBe("redirect_denied");
	});

	it("wrong identity/generation/retired fails before token mint", async () => {
		resolveMock.mockRejectedValue(
			new SandboxAuthorityError("generation_mismatch", "stale"),
		);
		const response = await handleOutbound(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
			),
			{} as Env,
			makeCtx({ identityId: "id-1", lifecycleGeneration: 9 }),
			deps,
		);
		expect(response.status).toBe(403);
		expect(mintTokenMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("failed git contract does not fall through to public internet", async () => {
		const response = await handleOutbound(
			new Request(
				"https://github.com/wrong/repo.git/info/refs?service=git-upload-pack",
			),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mintTokenMock).not.toHaveBeenCalled();
	});

	it("valid git info/refs mints token only on the fresh upstream request", async () => {
		fetchMock.mockResolvedValue(
			new Response("pack", {
				status: 200,
				headers: {
					"content-type": "application/x-git-upload-pack-advertisement",
				},
			}),
		);
		const response = await handleOutbound(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
			),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(200);
		expect(mintTokenMock).toHaveBeenCalledOnce();
		const upstream = fetchMock.mock.calls[0]?.[0] as Request;
		expect(upstream.headers.get("Authorization")).toBe(
			"token ghs_minted_token",
		);
		expect(upstream.url).not.toContain("ghs_minted_token");
		expect(upstream.url.startsWith("https://github.com/acme/app.git/")).toBe(
			true,
		);
	});

	it("synthetic ditto origin denies as privileged", async () => {
		const response = await handleOutbound(
			new Request("https://actions.ditto.internal/git"),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
