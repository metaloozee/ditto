import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DITTO_GIT_ACTION_ORIGIN,
	MAX_DITTO_ACTION_REQUEST_BODY_BYTES,
} from "./ditto-action-contract";
import {
	OPENCODE_PLACEHOLDER_API_KEY,
	OPENCODE_REQUEST_MODEL,
} from "./open-code-contract";
import { SandboxAuthorityError } from "./sandbox-authority";
import { handleOutbound, resolveOutboundFetch } from "./sandbox-egress-broker";

const resolveAgentGitContextMock = vi.fn();
const dispatchAgentGitActionMock = vi.fn();

const mintTokenMock = vi.fn(async () => "ghs_minted_token");
const fetchMock = vi.fn();
const resolveMock = vi.fn();
const recordContractDenialMock = vi.fn();
const closeOperationMock = vi.fn();
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

function dittoGitRequest(options?: {
	body?: unknown;
	rawBody?: string;
	headers?: HeadersInit;
	url?: string;
	method?: string;
}): Request {
	const body =
		options?.rawBody ?? JSON.stringify(options?.body ?? { action: "status" });
	return new Request(options?.url ?? DITTO_GIT_ACTION_ORIGIN, {
		method: options?.method ?? "POST",
		headers: {
			"content-type": "application/json",
			...Object.fromEntries(new Headers(options?.headers ?? [])),
		},
		body,
	});
}

function dittoActionResolved(overrides?: {
	operation?: Record<string, unknown>;
	identity?: Record<string, unknown>;
}) {
	return {
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
			...overrides?.identity,
		},
		operation: {
			id: "op-git-1",
			identityId: "id-1",
			lifecycleGeneration: 1,
			family: "ditto_action",
			type: "agent_git",
			contractVersion: 1,
			repository: null,
			allowedRefs: ["ditto/session-abc"],
			maxRequests: null,
			consumedRequests: 0,
			contractDenials: 0,
			openedAt: new Date(),
			expiresAt: new Date(Date.now() + 60_000),
			closedAt: null,
			closeReason: null,
			correlationId: "corr-git-1",
			...overrides?.operation,
		},
	};
}

describe("resolveOutboundFetch", () => {
	it("calls globalThis.fetch as a method so workerd does not throw Illegal invocation", async () => {
		const original = globalThis.fetch;
		const host = globalThis;
		globalThis.fetch = function (this: unknown) {
			if (this !== host) {
				throw new TypeError(
					"Illegal invocation: function called with incorrect `this` reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors for details.",
				);
			}
			return Promise.resolve(new Response("ok", { status: 200 }));
		} as typeof fetch;
		try {
			const impl = resolveOutboundFetch();
			const detached = globalThis.fetch;
			expect(() => detached(new Request("https://example.com/"))).toThrow(
				/Illegal invocation/,
			);
			await expect(
				impl(new Request("https://example.com/")),
			).resolves.toBeInstanceOf(Response);
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe("SandboxEgressBroker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		recordContractDenialMock.mockResolvedValue({
			denials: 1,
			closed: false,
			identityId: "id-1",
			workspaceSessionId: "sess-1",
		});
		closeOperationMock.mockResolvedValue(undefined);
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
				closeOperation: closeOperationMock,
			}) as never,
		mintInstallationToken: mintTokenMock,
		resolveAgentGitContext: resolveAgentGitContextMock,
		dispatchAgentGitAction: dispatchAgentGitActionMock,
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

	it("maps a thrown GitHub fetch to 502 instead of leaking an exception", async () => {
		fetchMock.mockRejectedValue(new Error("network boom"));
		const response = await handleOutbound(
			new Request(
				"https://github.com/acme/app.git/info/refs?service=git-upload-pack",
				{
					headers: {
						Host: "github.com",
						"User-Agent": "git/2.34.1",
						Accept: "*/*",
						"Accept-Encoding": "deflate, gzip, br, zstd",
						Pragma: "no-cache",
						"Git-Protocol": "version=1",
					},
				},
			),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(502);
		const body = (await response.json()) as { reasonCode: string };
		expect(body.reasonCode).toBe("upstream_fetch_failed");
		expect(mintTokenMock).toHaveBeenCalledOnce();
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

	it("denies receive-pack while GIT_PUSH_ENABLED is false without minting", async () => {
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
				id: "op-push-1",
				identityId: "id-1",
				lifecycleGeneration: 1,
				family: "git_transport",
				type: "push",
				contractVersion: 1,
				repository: "acme/app",
				allowedRefs: ["refs/heads/ditto/session-1"],
				maxRequests: 2,
				consumedRequests: 0,
				contractDenials: 0,
				contractState: JSON.stringify({
					preflightHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				}),
				openedAt: new Date(),
				expiresAt: new Date(Date.now() + 60_000),
				closedAt: null,
				closeReason: null,
				correlationId: "corr-push-1",
			},
		});
		const response = await handleOutbound(
			new Request("https://github.com/acme/app.git/git-receive-pack", {
				method: "POST",
				headers: {
					"content-type": "application/x-git-receive-pack-request",
				},
				body: "PACK",
			}),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { reasonCode: string };
		expect(body.reasonCode).toBe("push_disabled");
		expect(mintTokenMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(closeOperationMock).toHaveBeenCalledWith(
			"op-push-1",
			"push_disabled",
		);
	});

	it("denies fetch-typed operation that hits git-receive-pack without minting", async () => {
		const response = await handleOutbound(
			new Request("https://github.com/acme/app.git/git-receive-pack", {
				method: "POST",
				headers: {
					"content-type": "application/x-git-receive-pack-request",
				},
				body: "PACK",
			}),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { reasonCode: string };
		expect(body.reasonCode).toBe("push_disabled");
		expect(mintTokenMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("denies receive-pack credential-shaped headers without minting", async () => {
		const response = await handleOutbound(
			new Request("https://github.com/acme/app.git/git-receive-pack", {
				method: "POST",
				headers: {
					"content-type": "application/x-git-receive-pack-request",
					Authorization: "Bearer stolen",
					Cookie: "session=1",
				},
				body: "PACK",
			}),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(mintTokenMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("denies a second concurrent receive-pack without minting", async () => {
		const makeReceivePack = () =>
			new Request("https://github.com/acme/app.git/git-receive-pack", {
				method: "POST",
				headers: {
					"content-type": "application/x-git-receive-pack-request",
				},
				body: "PACK",
			});
		const first = await handleOutbound(
			makeReceivePack(),
			{} as Env,
			makeCtx(),
			deps,
		);
		const second = await handleOutbound(
			makeReceivePack(),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(first.status).toBe(403);
		expect(second.status).toBe(403);
		expect(mintTokenMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
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

	it("exact Ditto Git action dispatches from D1 identity and redacts secrets", async () => {
		const secret = "proj-fixture-secret-value-01";
		resolveMock.mockResolvedValue(dittoActionResolved());
		resolveAgentGitContextMock.mockResolvedValue({
			db: {},
			userId: "user-1",
			projectId: "proj-1",
			githubRepo: "acme/app",
			installationId: 42,
			claimedSandboxId: "sbx-1",
			sessionId: "sess-1",
			sessionTitle: "Fix",
			knownSecrets: [secret],
		});
		dispatchAgentGitActionMock.mockResolvedValue({
			pushed: true,
			note: `export ${secret}`,
		});
		const response = await handleOutbound(
			dittoGitRequest({ body: { action: "push" } }),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(200);
		expect(resolveMock).toHaveBeenCalledWith(
			expect.objectContaining({ identityId: "id-1" }),
			"ditto_action",
		);
		expect(resolveAgentGitContextMock).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: {
					userId: "user-1",
					projectId: "proj-1",
					workspaceSessionId: "sess-1",
					sandboxId: "sbx-1",
				},
			}),
		);
		expect(dispatchAgentGitActionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { action: "push" },
				allowedRefs: ["ditto/session-abc"],
			}),
		);
		const body = (await response.json()) as {
			ok: boolean;
			result: { pushed: boolean; note: string };
		};
		expect(body.ok).toBe(true);
		expect(body.result.pushed).toBe(true);
		expect(JSON.stringify(body)).not.toContain(secret);
		expect(JSON.stringify(body)).not.toContain("op-git-1");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("Ditto Git action with no open operation fails closed", async () => {
		resolveMock.mockRejectedValue(
			new SandboxAuthorityError("operation_not_open", "missing"),
		);
		const response = await handleOutbound(
			dittoGitRequest(),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("stale generation fails closed for Ditto Git action", async () => {
		resolveMock.mockRejectedValue(
			new SandboxAuthorityError("generation_mismatch", "stale"),
		);
		const response = await handleOutbound(
			dittoGitRequest(),
			{} as Env,
			makeCtx({ identityId: "id-1", lifecycleGeneration: 9 }),
			deps,
		);
		expect(response.status).toBe(403);
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
	});

	it("wrong session identity fails closed for Ditto Git action", async () => {
		resolveMock.mockResolvedValue(
			dittoActionResolved({
				identity: { workspaceSessionId: null },
			}),
		);
		const response = await handleOutbound(
			dittoGitRequest(),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { reasonCode: string };
		expect(body.reasonCode).toBe("identity_binding_mismatch");
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
	});

	it("expired Ditto Git operation fails closed", async () => {
		resolveMock.mockRejectedValue(
			new SandboxAuthorityError("operation_expired", "expired"),
		);
		const response = await handleOutbound(
			dittoGitRequest(),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(403);
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
	});

	it("malformed action, extra field, oversized body, and authorization fail closed", async () => {
		resolveMock.mockResolvedValue(dittoActionResolved());
		const cases = [
			dittoGitRequest({ body: { action: "merge" } }),
			dittoGitRequest({ body: { action: "push", sessionId: "sess-1" } }),
			dittoGitRequest({
				rawBody: `{"action":"push","pad":"${"x".repeat(MAX_DITTO_ACTION_REQUEST_BODY_BYTES)}"}`,
			}),
			dittoGitRequest({ headers: { authorization: "Bearer stolen" } }),
		];
		for (const request of cases) {
			dispatchAgentGitActionMock.mockClear();
			const response = await handleOutbound(
				request,
				{} as Env,
				makeCtx(),
				deps,
			);
			expect(response.status).toBe(403);
			expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		}
	});

	it("public internet request cannot invoke the Ditto Git adapter", async () => {
		fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
		const response = await handleOutbound(
			new Request("https://example.com/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "push" }),
			}),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(200);
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
		expect(resolveAgentGitContextMock).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("maps handler errors to a generic sandbox-visible body", async () => {
		resolveMock.mockResolvedValue(dittoActionResolved());
		resolveAgentGitContextMock.mockResolvedValue({
			knownSecrets: ["proj-fixture-secret-value-01"],
		});
		const handlerError = new Error("Commit local changes before pushing.");
		handlerError.name = "AgentGitHttpError";
		(handlerError as unknown as { status: number }).status = 409;
		dispatchAgentGitActionMock.mockRejectedValue(handlerError);
		const response = await handleOutbound(
			dittoGitRequest({ body: { action: "push" } }),
			{} as Env,
			makeCtx(),
			deps,
		);
		expect(response.status).toBe(409);
		const body = (await response.json()) as { ok: boolean; error: string };
		expect(body).toEqual({ ok: false, error: "Git action failed." });
		expect(JSON.stringify(body)).not.toContain("proj-fixture-secret-value-01");
		expect(JSON.stringify(body)).not.toContain("op-git-1");
	});

	it("ditto.internal near-misses never reach public internet", async () => {
		const urls = [
			"https://ditto.internal/v1/git-action",
			"http://ditto.internal/v1/other",
			"http://ditto.internal/v1/git-action?x=1",
			"http://ditto.internal:8080/v1/git-action",
		];
		for (const url of urls) {
			fetchMock.mockClear();
			dispatchAgentGitActionMock.mockClear();
			const response = await handleOutbound(
				new Request(url, { method: "POST" }),
				{} as Env,
				makeCtx(),
				deps,
			);
			expect(response.status).toBe(403);
			const body = (await response.json()) as { reasonCode: string };
			expect(body.reasonCode).toBe("privileged_placeholder");
			expect(fetchMock).not.toHaveBeenCalled();
			expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
		}
	});
});
