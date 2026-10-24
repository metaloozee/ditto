import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());
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
vi.mock("#/lib/auth", () => ({ createAuth: createAuthMock }));
vi.mock("#/lib/session-runtime-client", () => ({
	resolveCandidateProductCommands: resolveMock,
}));

await import("./api.agent.models");

function post(body: string) {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) throw new Error("route not captured");
	return handler({
		request: new Request("http://localhost/api/agent/models", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
		}),
	});
}

describe("api.agent.models", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAuthMock.mockReturnValue({
			api: {
				getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
			},
		});
	});

	it("returns 401 before reaching the service", async () => {
		createAuthMock.mockReturnValue({
			api: { getSession: vi.fn().mockResolvedValue(null) },
		});
		expect((await post("{}")).status).toBe(401);
		expect(resolveMock).not.toHaveBeenCalled();
	});

	it("returns the ineligible code when no binding exists", async () => {
		resolveMock.mockReturnValue(undefined);
		const response = await post(
			JSON.stringify({ version: 1, projectId: "p", sessionId: "s" }),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			code: "candidate_admission_ineligible",
		});
	});

	it("calls the service as the authenticated user and returns its result", async () => {
		const service = { modelsOwned: vi.fn().mockResolvedValue({ ok: true }) };
		resolveMock.mockReturnValue(service);
		const response = await post(
			JSON.stringify({ version: 1, projectId: "p", sessionId: "s" }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(service.modelsOwned.mock.calls[0]?.[0]).toBe("user-1");
	});
});
