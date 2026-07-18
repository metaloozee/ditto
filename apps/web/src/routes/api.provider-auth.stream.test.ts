import { beforeEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.hoisted(() => vi.fn());
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
	providerAuthStreamBodySchema: {
		safeParse: (body: unknown) => {
			const b = body as { providerId?: string; authType?: string };
			if (!b?.providerId || !b?.authType) {
				return { success: false, error: { issues: [] } };
			}
			return { success: true, data: body };
		},
	},
	streamProviderAuth: streamMock,
}));

await import("./api.provider-auth.stream");

function getPostHandler() {
	const handler = routeOptions.current?.server.handlers.POST;
	if (!handler) throw new Error("POST handler missing");
	return handler;
}

describe("POST /api/provider-auth/stream", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDbMock.mockReturnValue({});
	});

	it("returns 401 for anonymous", async () => {
		createAuthMock.mockReturnValue({
			api: { getSession: vi.fn().mockResolvedValue(null) },
		});
		const response = await getPostHandler()({
			request: new Request("http://localhost/api/provider-auth/stream", {
				method: "POST",
				body: JSON.stringify({ providerId: "openai", authType: "api_key" }),
			}),
		});
		expect(response.status).toBe(401);
		expect(streamMock).not.toHaveBeenCalled();
	});

	it("streams for authenticated users", async () => {
		createAuthMock.mockReturnValue({
			api: {
				getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
			},
		});
		streamMock.mockImplementation(async ({ emit }) => {
			await emit({ event: "done", data: { ok: true } });
		});
		const response = await getPostHandler()({
			request: new Request("http://localhost/api/provider-auth/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ providerId: "openai", authType: "api_key" }),
			}),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
		expect(streamMock).toHaveBeenCalled();
	});
});
