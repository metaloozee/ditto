import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const controlAgentRunMock = vi.hoisted(() => vi.fn());
const createAuthMock = vi.hoisted(() => vi.fn());
const createDbMock = vi.hoisted(() => vi.fn());
const routeOptions = vi.hoisted(() => ({
	current: null as null | {
		server: {
			handlers: { POST: (ctx: { request: Request }) => Promise<Response> };
		};
	},
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: typeof routeOptions.current) => {
		routeOptions.current = options;
		return options;
	},
}));
vi.mock("#/db", () => ({ createDb: createDbMock }));
vi.mock("#/lib/auth", () => ({ createAuth: createAuthMock }));
vi.mock("#/lib/agent-control-service", () => ({
	agentControlBodySchema: z.discriminatedUnion("action", [
		z.object({
			action: z.literal("follow_up"),
			projectId: z.string().min(1),
			sessionId: z.string().min(1),
			runId: z.string().min(1),
			model: z.string().min(1),
			message: z.string().trim().min(1),
		}),
		z.object({
			action: z.literal("stop"),
			projectId: z.string().min(1),
			sessionId: z.string().min(1),
			runId: z.string().min(1),
		}),
	]),
	controlAgentRun: controlAgentRunMock,
}));

await import("./api.agent.control");

function post(body: string) {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) throw new Error("route not captured");
	return handler({
		request: new Request("http://localhost/api/agent/control", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		}),
	});
}

describe("api.agent.control", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
		createAuthMock.mockReturnValue({
			api: {
				getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
			},
		});
	});

	it("returns 401 before control service access", async () => {
		createAuthMock.mockReturnValue({
			api: { getSession: vi.fn().mockResolvedValue(null) },
		});
		const response = await post(JSON.stringify({ action: "stop" }));
		expect(response.status).toBe(401);
		expect(controlAgentRunMock).not.toHaveBeenCalled();
	});

	it("returns 400 for invalid JSON and invalid bodies", async () => {
		expect((await post("{bad")).status).toBe(400);
		expect((await post(JSON.stringify({ action: "stop" }))).status).toBe(400);
	});

	it.each([404, 409] as const)("maps service status %s", async (status) => {
		controlAgentRunMock.mockResolvedValue({
			kind: "error",
			status,
			body: { error: "Safe failure." },
		});
		const response = await post(
			JSON.stringify({
				action: "stop",
				projectId: "project-1",
				sessionId: "session-1",
				runId: "run-1",
			}),
		);
		expect(response.status).toBe(status);
		expect(await response.json()).toEqual({ error: "Safe failure." });
	});

	it.each([
		{
			action: "follow_up",
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
			model: "provider/model",
			message: "next",
		},
		{
			action: "stop",
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
		},
	])("returns accepted $action responses", async (body) => {
		controlAgentRunMock.mockResolvedValue({
			kind: "accepted",
			status: 200,
			body: { accepted: true, action: body.action },
		});
		const response = await post(JSON.stringify(body));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			accepted: true,
			action: body.action,
		});
	});
});
