import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyToSandboxMock = vi.hoisted(() => vi.fn());
const handlerFetchMock = vi.hoisted(() => vi.fn());
const handleOutboundMock = vi.hoisted(() => vi.fn());

const outboundHandlersRegistry = vi.hoisted(() => {
	const registry = new Map<string, Record<string, unknown>>();
	return registry;
});

vi.mock("@cloudflare/sandbox", () => {
	class BaseSandbox {
		static get outboundHandlers(): Record<string, unknown> | undefined {
			return outboundHandlersRegistry.get(BaseSandbox.name);
		}
		static set outboundHandlers(handlers: Record<string, unknown>) {
			const existing = outboundHandlersRegistry.get(BaseSandbox.name) ?? {};
			outboundHandlersRegistry.set(BaseSandbox.name, {
				...existing,
				...handlers,
			});
		}
	}
	class ContainerProxy {}
	return {
		proxyToSandbox: proxyToSandboxMock,
		Sandbox: BaseSandbox,
		ContainerProxy,
	};
});

vi.mock("@tanstack/react-start/server-entry", () => ({
	default: {
		fetch: handlerFetchMock,
	},
}));

vi.mock("#/lib/sandbox-egress-broker", () => ({
	handleOutbound: handleOutboundMock,
}));

const serverModule = await import("./server");
const { default: server, Sandbox, ContainerProxy } = serverModule;

const env = { Sandbox: {} } as Env;

describe("server fetch routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		handlerFetchMock.mockResolvedValue(new Response("app", { status: 200 }));
	});

	it("returns non-HTML proxied responses unchanged, including SDK 500", async () => {
		const proxied = new Response("preview-error", { status: 500 });
		proxyToSandboxMock.mockResolvedValue(proxied);

		const request = new Request("https://10000-box-token.ayn.wtf/");
		const response = await server.fetch(request, env);

		expect(response).toBe(proxied);
		expect(response.status).toBe(500);
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("injects compact scrollbar styles into proxied HTML", async () => {
		const proxied = new Response(
			"<!doctype html><html><head><title>x</title></head><body>hi</body></html>",
			{
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" },
			},
		);
		proxyToSandboxMock.mockResolvedValue(proxied);

		const response = await server.fetch(
			new Request("https://10000-box-token.ayn.wtf/"),
			env,
		);
		const html = await response.text();

		expect(response).not.toBe(proxied);
		expect(html).toContain("data-ditto-scrollbar");
		expect(html).toContain("scrollbar-width:thin");
		expect(html.indexOf("data-ditto-scrollbar")).toBeLessThan(
			html.indexOf("</head>"),
		);
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

describe("Sandbox subclass exports", () => {
	it("exports ContainerProxy from the Worker entrypoint", () => {
		expect(ContainerProxy).toBeTypeOf("function");
	});

	it("assigns Sandbox.outboundHandlers via setter (not only a class field)", () => {
		expect(Sandbox.outboundHandlers?.dittoCatchAll).toBeTypeOf("function");
		expect(Sandbox.name).toBe("Sandbox");
	});

	it("enables HTTPS intercept without disabling legacy internet", () => {
		const constructed = new (
			Sandbox as unknown as new () => {
				enableInternet: boolean | undefined;
				interceptHttps: boolean;
			}
		)();
		expect(constructed.interceptHttps).toBe(true);
		// Legacy project sandboxes keep direct internet until they set a catch-all.
		expect(constructed.enableInternet).not.toBe(false);
	});
});
