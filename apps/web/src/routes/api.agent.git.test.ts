import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Full POST handler import pulls `cloudflare:workers` and TanStack route
 * bootstrap. Mock those modules (and heavy handler deps), capture the handler,
 * and assert malformed bearer tokens return generic 401 without calling
 * dispatch/database helpers.
 */

const SECRET = "test-secret-for-agent-git-route";

const createDbMock = vi.hoisted(() => vi.fn());
const resolveAgentGitContextMock = vi.hoisted(() => vi.fn());
const dispatchAgentGitActionMock = vi.hoisted(() => vi.fn());

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
		BETTER_AUTH_SECRET: SECRET,
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

vi.mock("#/lib/agent-git-handler", () => ({
	AgentGitHttpError: class AgentGitHttpError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
			this.name = "AgentGitHttpError";
		}
	},
	agentGitBodySchema: {
		safeParse: (body: unknown) => ({ success: true as const, data: body }),
	},
	resolveAgentGitContext: resolveAgentGitContextMock,
	dispatchAgentGitAction: dispatchAgentGitActionMock,
}));

await import("./api.agent.git");

function getPostHandler() {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) {
		throw new Error("POST handler was not captured from createFileRoute");
	}
	return handler;
}

async function postWithBearer(token: string | null): Promise<Response> {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (token !== null) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	return getPostHandler()({
		request: new Request("http://localhost/api/agent/git", {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "status" }),
		}),
	});
}

describe("api.agent.git POST auth boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when Authorization is missing", async () => {
		const response = await postWithBearer(null);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(createDbMock).not.toHaveBeenCalled();
		expect(resolveAgentGitContextMock).not.toHaveBeenCalled();
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
	});

	it.each([
		["not-a-jwt", "not-a-jwt"],
		["empty segments", ".."],
		["invalid alphabet in signature", "hdr.pay.!!!invalid!!!"],
		["invalid alphabet in payload", "hdr.!!!invalid!!!.c2ln"],
		["spaces in signature", "hdr.pay.sig with spaces"],
		["illegal chars in signature", "hdr.pay.load?illegal"],
	] as const)("returns generic 401 for malformed bearer: %s", async (_label, token) => {
		const response = await postWithBearer(token);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(createDbMock).not.toHaveBeenCalled();
		expect(resolveAgentGitContextMock).not.toHaveBeenCalled();
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
	});

	it("returns generic 401 for validly encoded bad signature", async () => {
		const { mintAgentGitJwt } = await import("#/lib/agent-git-jwt");
		const token = await mintAgentGitJwt({
			secret: SECRET,
			projectId: "proj-1",
			sessionId: "sess-1",
			userId: "user-1",
			sandboxId: "sandbox-1",
		});
		const parts = token.split(".");
		const tampered = `${parts[0]}.${parts[1]}.${btoa("\0".repeat(32))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "")}`;

		const response = await postWithBearer(tampered);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(createDbMock).not.toHaveBeenCalled();
		expect(resolveAgentGitContextMock).not.toHaveBeenCalled();
		expect(dispatchAgentGitActionMock).not.toHaveBeenCalled();
	});
});
