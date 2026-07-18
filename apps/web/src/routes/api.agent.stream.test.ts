import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Full POST handler import pulls `cloudflare:workers` and TanStack route
 * bootstrap. Mock those modules and capture the handler; lifecycle is
 * exercised via injectable prepare/execute mocks plus source-shape checks.
 */

const prepareAgentRunMock = vi.hoisted(() => vi.fn());
const executeAgentRunMock = vi.hoisted(() => vi.fn());
const createAuthMock = vi.hoisted(() => vi.fn());
const createDbMock = vi.hoisted(() => vi.fn());

const routeOptions = vi.hoisted(() => ({
	current: null as null | {
		server: {
			handlers: {
				POST: (ctx: { request: Request }) => Promise<Response>;
			};
		};
	},
}));

vi.mock("cloudflare:workers", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		OPENCODE_API_KEY: "sk-test",
		AI_CREDENTIALS_ENCRYPTION_KEY: "ai-credentials-encryption-key-test-aaaa",
	},
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute:
		(_path: string) =>
		(options: {
			server: {
				handlers: {
					POST: (ctx: { request: Request }) => Promise<Response>;
				};
			};
		}) => {
			routeOptions.current = options;
			return options;
		},
}));

vi.mock("#/db", () => ({
	createDb: createDbMock,
}));

vi.mock("#/lib/auth", () => ({
	createAuth: createAuthMock,
}));

vi.mock("#/lib/agent-run-service", () => ({
	agentStreamBodySchema: z.object({
		projectId: z.string().min(1),
		sessionId: z.string().min(1).optional(),
		message: z.string().trim().min(1),
		model: z.string().min(1),
	}),
	prepareAgentRun: prepareAgentRunMock,
	executeAgentRun: executeAgentRunMock,
}));

await import("./api.agent.stream");

function getPostHandler() {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) {
		throw new Error("POST handler was not captured from createFileRoute");
	}
	return handler;
}

function authed() {
	createAuthMock.mockReturnValue({
		api: {
			getSession: vi.fn().mockResolvedValue({
				user: { id: "user-1" },
			}),
		},
	});
}

async function postJson(body: unknown): Promise<Response> {
	return getPostHandler()({
		request: new Request("http://localhost/api/agent/stream", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	});
}

describe("api.agent.stream POST adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
		authed();
	});

	it("returns 401 when unauthenticated", async () => {
		createAuthMock.mockReturnValue({
			api: { getSession: vi.fn().mockResolvedValue(null) },
		});

		const response = await getPostHandler()({
			request: new Request("http://localhost/api/agent/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					projectId: "p1",
					message: "hi",
					model: "opencode/deepseek-v4-flash-free",
				}),
			}),
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(prepareAgentRunMock).not.toHaveBeenCalled();
	});

	it("returns 400 for invalid JSON body", async () => {
		const response = await getPostHandler()({
			request: new Request("http://localhost/api/agent/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{not-json",
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid JSON body." });
	});

	it("returns 400 for malformed request body", async () => {
		const response = await postJson({ projectId: "p1" });
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe("Invalid request.");
		expect(prepareAgentRunMock).not.toHaveBeenCalled();
	});

	it("maps prepareAgentRun errors to HTTP responses", async () => {
		prepareAgentRunMock.mockResolvedValue({
			kind: "error",
			status: 409,
			body: { error: "Failed to prepare session worktree." },
		});

		const response = await postJson({
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "Failed to prepare session worktree.",
		});
		expect(executeAgentRunMock).not.toHaveBeenCalled();
	});

	it("encodes SSE events from executeAgentRun in order", async () => {
		prepareAgentRunMock.mockResolvedValue({
			kind: "ready",
			context: {
				sessionId: "sess-1",
				assistantMessageId: "asst-1",
			},
		});

		executeAgentRunMock.mockImplementation(async ({ emit }) => {
			emit({
				event: "meta",
				data: {
					sessionId: "sess-1",
					userMessageId: "u1",
					assistantMessageId: "asst-1",
					createdSession: false,
					sandboxState: "ready",
				},
			});
			emit({ event: "delta", data: { delta: "Hi" } });
			emit({
				event: "done",
				data: {
					ok: true,
					assistantMessageId: "asst-1",
					content: "Hi",
				},
			});
		});

		const response = await postJson({
			projectId: "proj-1",
			message: "hi",
			model: "opencode/deepseek-v4-flash-free",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
		const text = await response.text();
		expect(text).toContain("event: meta");
		expect(text).toContain("event: delta");
		expect(text).toContain("event: done");
		const metaAt = text.indexOf("event: meta");
		const deltaAt = text.indexOf("event: delta");
		const doneAt = text.indexOf("event: done");
		expect(metaAt).toBeGreaterThanOrEqual(0);
		expect(deltaAt).toBeGreaterThan(metaAt);
		expect(doneAt).toBeGreaterThan(deltaAt);
	});
});

describe("api.agent.stream source boundaries", () => {
	it("route is a thin adapter around the run service", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const source = await fs.readFile(
			path.join(import.meta.dirname, "api.agent.stream.ts"),
			"utf8",
		);

		expect(source).toContain("prepareAgentRun");
		expect(source).toContain("executeAgentRun");
		expect(source).toContain("encodeSseEvent");
		expect(source).not.toContain("agent-stream-client");
		expect(source).not.toContain("agent-tool-presentation");
		expect(source).not.toContain("runAgentInSandbox");
		expect(source).not.toContain("ensureSessionWorktree");
		expect(source).not.toContain("persistProjectSandboxBackup");
	});
});
