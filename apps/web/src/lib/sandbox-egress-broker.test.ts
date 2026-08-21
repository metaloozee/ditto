import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	OPENCODE_PLACEHOLDER_API_KEY,
	OPENCODE_REQUEST_MODEL,
} from "./open-code-contract";
import { SandboxAuthorityError } from "./sandbox-authority";
import { handleOutbound } from "./sandbox-egress-broker";

const mintTokenMock = vi.fn(async () => "ghs_minted_token");
const fetchMock = vi.fn();
const resolveMock = vi.fn();
const recordContractDenialMock = vi.fn();
const sessionUpdateMock = vi.fn();

const PINNED_BODY = {
	model: OPENCODE_REQUEST_MODEL,
	messages: [{ role: "user", content: "hi" }],
	stream: true,
	stream_options: { include_usage: true },
	max_tokens: 1024,
};

function openCodeRequest(options?: {
	body?: unknown;
	headers?: HeadersInit;
}): Request {
	return new Request("https://opencode.ai/zen/v1/chat/completions", {
		method: "POST",
		headers: {
			authorization: `Bearer ${OPENCODE_PLACEHOLDER_API_KEY}`,
			"content-type": "application/json",
			...Object.fromEntries(new Headers(options?.headers ?? [])),
		},
		body: JSON.stringify(options?.body ?? PINNED_BODY),
	});
}

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
		recordContractDenialMock.mockResolvedValue({
			denials: 1,
			closed: false,
			identityId: "id-1",
			workspaceSessionId: "sess-1",
		});
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
				contractDenials: 0,
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
				update() {
					return {
						set(values: unknown) {
							sessionUpdateMock(values);
							return {
								where: async () => undefined,
							};
						},
					};
				},
			}) as never,
		createAuthority: () =>
			({
				resolveOutboundRequest: resolveMock,
				recordContractDenial: recordContractDenialMock,
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

	it("exact OpenCode contract replaces the placeholder on a fresh upstream request", async () => {
		resolveMock.mockResolvedValue({
			identity: {
				id: "id-1",
				kind: "workspace_session",
				sandboxId: "sbx-1",
				containerId: "container-1",
				userId: "user-1",
				projectId: "proj-1",
				workspaceSessionId: "sess-1",
				lifecycleGeneration: 1,
				state: "ready",
				retiredAt: null,
			},
			operation: {
				id: "op-1",
				identityId: "id-1",
				lifecycleGeneration: 1,
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				repository: null,
				allowedRefs: null,
				maxRequests: null,
				consumedRequests: 0,
				contractDenials: 0,
				openedAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000),
				closedAt: null,
				closeReason: null,
				correlationId: "corr-1",
			},
		});
		const upstreamBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
				controller.close();
			},
		});
		fetchMock.mockResolvedValue(
			new Response(upstreamBody, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);
		const textSpy = vi.spyOn(Response.prototype, "text");
		const response = await handleOutbound(
			openCodeRequest(),
			{ OPENCODE_API_KEY: "sk-real-opencode-key" } as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const upstream = fetchMock.mock.calls[0]?.[0] as Request;
		expect(upstream.headers.get("Authorization")).toBe(
			"Bearer sk-real-opencode-key",
		);
		expect(upstream.redirect).toBe("manual");
		expect(textSpy).not.toHaveBeenCalled();
		textSpy.mockRestore();
		expect(mintTokenMock).not.toHaveBeenCalled();
	});

	it("wrong operation type and version fail closed without fetch", async () => {
		resolveMock.mockResolvedValue({
			identity: {
				id: "id-1",
				kind: "workspace_session",
				sandboxId: "sbx-1",
				containerId: "container-1",
				userId: "user-1",
				projectId: "proj-1",
				workspaceSessionId: "sess-1",
				lifecycleGeneration: 1,
				state: "ready",
				retiredAt: null,
			},
			operation: {
				id: "op-1",
				identityId: "id-1",
				lifecycleGeneration: 1,
				family: "model",
				type: "project_seed_fetch",
				contractVersion: 1,
				repository: null,
				allowedRefs: null,
				maxRequests: null,
				consumedRequests: 0,
				contractDenials: 0,
				openedAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000),
				closedAt: null,
				closeReason: null,
				correlationId: "corr-1",
			},
		});
		const response = await handleOutbound(
			openCodeRequest(),
			{ OPENCODE_API_KEY: "sk-real-opencode-key" } as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("failed OpenCode contract never reaches the public internet adapter", async () => {
		resolveMock.mockResolvedValue({
			identity: {
				id: "id-1",
				kind: "workspace_session",
				sandboxId: "sbx-1",
				containerId: "container-1",
				userId: "user-1",
				projectId: "proj-1",
				workspaceSessionId: "sess-1",
				lifecycleGeneration: 1,
				state: "ready",
				retiredAt: null,
			},
			operation: {
				id: "op-1",
				identityId: "id-1",
				lifecycleGeneration: 1,
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				repository: null,
				allowedRefs: null,
				maxRequests: null,
				consumedRequests: 0,
				contractDenials: 0,
				openedAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000),
				closedAt: null,
				closeReason: null,
				correlationId: "corr-1",
			},
		});
		const response = await handleOutbound(
			openCodeRequest({ body: { ...PINNED_BODY, model: "other" } }),
			{ OPENCODE_API_KEY: "sk-real-opencode-key" } as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(recordContractDenialMock).toHaveBeenCalledWith("op-1");
	});

	it("three contract denials close the operation and mark review without deleting recovery data", async () => {
		resolveMock.mockResolvedValue({
			identity: {
				id: "id-1",
				kind: "workspace_session",
				sandboxId: "sbx-1",
				containerId: "container-1",
				userId: "user-1",
				projectId: "proj-1",
				workspaceSessionId: "sess-1",
				lifecycleGeneration: 1,
				state: "ready",
				retiredAt: null,
			},
			operation: {
				id: "op-1",
				identityId: "id-1",
				lifecycleGeneration: 1,
				family: "model",
				type: "agent_run",
				contractVersion: 1,
				repository: null,
				allowedRefs: null,
				maxRequests: null,
				consumedRequests: 0,
				contractDenials: 2,
				openedAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000),
				closedAt: null,
				closeReason: null,
				correlationId: "corr-1",
			},
		});
		recordContractDenialMock.mockResolvedValue({
			denials: 3,
			closed: true,
			identityId: "id-1",
			workspaceSessionId: "sess-1",
		});
		const response = await handleOutbound(
			openCodeRequest({ body: { ...PINNED_BODY, stream: false } }),
			{ OPENCODE_API_KEY: "sk-real-opencode-key" } as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(sessionUpdateMock).toHaveBeenCalledWith({
			runtimeFailureReasonCode: "opencode_contract_denial_limit",
		});
		expect(sessionUpdateMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ sandboxBackup: expect.anything() }),
		);
	});

	it("unknown identity fails closed without fetch", async () => {
		resolveMock.mockRejectedValue(
			new SandboxAuthorityError("identity_not_found", "missing"),
		);
		const response = await handleOutbound(
			openCodeRequest(),
			{ OPENCODE_API_KEY: "sk-real-opencode-key" } as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
