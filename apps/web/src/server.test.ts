import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyToSandboxMock = vi.hoisted(() => vi.fn());
const handlerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@cloudflare/sandbox", () => ({
	proxyToSandbox: proxyToSandboxMock,
	Sandbox: class Sandbox {},
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: {
		fetch: handlerFetchMock,
	},
}));

const { default: server } = await import("./server");

const env = { Sandbox: {} } as Env;

describe("server fetch routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		handlerFetchMock.mockResolvedValue(new Response("app", { status: 200 }));
	});

	it("returns proxied sandbox response unchanged, including SDK 500", async () => {
		const proxied = new Response("preview-error", { status: 500 });
		proxyToSandboxMock.mockResolvedValue(proxied);

		const request = new Request("https://10000-box-token.ayn.wtf/");
		const response = await server.fetch(request, env);

		expect(response).toBe(proxied);
		expect(response.status).toBe(500);
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("falls through to TanStack on apex host when proxy misses", async () => {
		proxyToSandboxMock.mockResolvedValue(null);

		const request = new Request("https://ayn.wtf/projects");
		const response = await server.fetch(request, env);

		expect(await response.text()).toBe("app");
		expect(handlerFetchMock).toHaveBeenCalledOnce();
	});

	it("falls through to TanStack on localhost when proxy misses", async () => {
		proxyToSandboxMock.mockResolvedValue(null);

		const request = new Request("http://localhost:5173/");
		const response = await server.fetch(request, env);

		expect(await response.text()).toBe("app");
		expect(handlerFetchMock).toHaveBeenCalledOnce();
	});

	it("returns 404 for unknown shallow *.ayn.wtf hosts", async () => {
		proxyToSandboxMock.mockResolvedValue(null);

		const request = new Request("https://unknown.ayn.wtf/");
		const response = await server.fetch(request, env);

		expect(response.status).toBe(404);
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("returns 404 for unknown deep *.ayn.wtf hosts", async () => {
		proxyToSandboxMock.mockResolvedValue(null);

		const request = new Request("https://a.b.c.ayn.wtf/path");
		const response = await server.fetch(request, env);

		expect(response.status).toBe(404);
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("falls through for lookalike hosts that are not proper subdomains", async () => {
		proxyToSandboxMock.mockResolvedValue(null);

		const request = new Request("https://notayn.wtf/");
		const response = await server.fetch(request, env);

		expect(await response.text()).toBe("app");
		expect(handlerFetchMock).toHaveBeenCalledOnce();
	});
});
