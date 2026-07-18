import { beforeEach, describe, expect, it, vi } from "vitest";

const controlMock = vi.hoisted(() => vi.fn());
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

vi.mock("#/db", () => ({ createDb: createDbMock }));

vi.mock("#/lib/auth", () => ({
	createAuth: createAuthMock,
}));

vi.mock("#/lib/provider-auth-service", () => ({
	providerAuthControlBodySchema: {
		safeParse: (body: unknown) => {
			const b = body as { action?: string; attemptId?: string };
			if (!b?.action || !b?.attemptId) {
				return { success: false, error: { issues: [] } };
			}
			return { success: true, data: body };
		},
	},
	controlProviderAuth: controlMock,
}));

await import("./api.provider-auth.control");

function getPostHandler() {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) throw new Error("POST handler missing");
	return handler;
}

describe("POST /api/provider-auth/control", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
	});

	it("returns 401 for anonymous", async () => {
		createAuthMock.mockReturnValue({
			api: { getSession: vi.fn().mockResolvedValue(null) },
		});
		const response = await getPostHandler()({
			request: new Request("http://localhost/api/provider-auth/control", {
				method: "POST",
				body: JSON.stringify({ action: "cancel", attemptId: "a1" }),
			}),
		});
		expect(response.status).toBe(401);
	});

	it("does not echo control values", async () => {
		createAuthMock.mockReturnValue({
			api: {
				getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
			},
		});
		controlMock.mockResolvedValue({
			status: 200,
			body: { accepted: true, action: "answer" },
		});
		const response = await getPostHandler()({
			request: new Request("http://localhost/api/provider-auth/control", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "answer",
					attemptId: "a1",
					promptId: "p1",
					value: "sk-secret-should-not-echo",
				}),
			}),
		});
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(text).not.toContain("sk-secret-should-not-echo");
		expect(text).toContain("accepted");
	});
});
