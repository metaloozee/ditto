import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyToSandboxMock = vi.hoisted(() => vi.fn());
const handlerFetchMock = vi.hoisted(() => vi.fn());
const handleOutboundMock = vi.hoisted(() => vi.fn());
const legacyDrainMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const scheduledDb = vi.hoisted(() => ({ current: {} as unknown }));
const legacySandboxStateMock = vi.hoisted(() => vi.fn());
const lowerMaintenanceMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);
vi.mock("#/db", () => ({ createDb: () => scheduledDb.current }));
vi.mock("#/lib/sandbox-bootstrap", () => ({
	getProjectSandboxState: legacySandboxStateMock,
	getProjectSandbox: vi.fn(),
	configureDittoGitIdentity: vi.fn(),
}));
vi.mock("#/lib/workspace-recovery", () => ({
	enqueueDuePreviewCheckpoints: lowerMaintenanceMock,
	hasRecoveryArchives: vi.fn(),
	restore: vi.fn(),
}));
vi.mock("#/lib/sandbox-archive", () => ({
	retryArchiveCleanup: lowerMaintenanceMock,
	restoreArchive: vi.fn(),
}));
vi.mock("#/lib/session-command-delivery", () => ({
	deliverSessionCommands: lowerMaintenanceMock,
}));
vi.mock("#/lib/workspace-runtime-capacity", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/lib/workspace-runtime-capacity")
	>()),
	drainWorkspaceRuntimeQueue: lowerMaintenanceMock,
}));
vi.mock("#/lib/workspace-runtime", () => ({
	drainWorkspaceRuntime: legacyDrainMock,
}));

const outboundHandlersRegistry = vi.hoisted(() => {
	const registry = new Map<string, Record<string, unknown>>();
	return registry;
});

vi.mock("@cloudflare/sandbox", () => {
	class BaseSandbox {
		ctx = {
			storage: {
				put: async () => undefined,
				get: async () => null,
			},
		};
		async fetch(request: Request): Promise<Response> {
			return new Response(`base:${new URL(request.url).hostname}`);
		}
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

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {},
	WorkerEntrypoint: class WorkerEntrypoint {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
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

describe("candidate preview routing", () => {
	const uuid = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
	const candidateUrl = `https://10000-c-${uuid}-tok.ayn.wtf/`;

	beforeEach(() => {
		vi.clearAllMocks();
		handlerFetchMock.mockResolvedValue(new Response("app", { status: 200 }));
	});

	it("forwards candidate hosts to the binding, bypassing the legacy proxy", async () => {
		const upstream = new Response(null, { status: 204 });
		const binding = { fetch: vi.fn().mockResolvedValue(upstream) };
		const request = new Request(candidateUrl);

		const response = await server.fetch(request, {
			...env,
			CANDIDATE_PREVIEW: binding,
		} as unknown as Env);

		expect(binding.fetch).toHaveBeenCalledOnce();
		expect(binding.fetch).toHaveBeenCalledWith(request);
		expect(proxyToSandboxMock).not.toHaveBeenCalled();
		expect(handlerFetchMock).not.toHaveBeenCalled();
		expect(response).toBe(upstream);
	});

	it("injects scrollbar styles into HTML from the binding", async () => {
		const binding = {
			fetch: vi.fn().mockResolvedValue(
				new Response("<html><head></head><body>hi</body></html>", {
					headers: { "content-type": "text/html" },
				}),
			),
		};
		const response = await server.fetch(new Request(candidateUrl), {
			...env,
			CANDIDATE_PREVIEW: binding,
		} as unknown as Env);
		expect(await response.text()).toContain("data-ditto-scrollbar");
	});

	it("returns non-HTML binding responses by identity", async () => {
		const upstream = new Response("console.log(1)", {
			headers: { "content-type": "text/javascript" },
		});
		const binding = { fetch: vi.fn().mockResolvedValue(upstream) };
		const response = await server.fetch(new Request(candidateUrl), {
			...env,
			CANDIDATE_PREVIEW: binding,
		} as unknown as Env);
		expect(response).toBe(upstream);
	});

	it("returns 404 when the binding is unbound", async () => {
		const response = await server.fetch(new Request(candidateUrl), env);
		expect(response.status).toBe(404);
		expect(proxyToSandboxMock).not.toHaveBeenCalled();
		expect(handlerFetchMock).not.toHaveBeenCalled();
	});

	it("keeps legacy preview hosts on the legacy proxy", async () => {
		const proxied = new Response("legacy", { status: 200 });
		proxyToSandboxMock.mockResolvedValue(proxied);
		const binding = { fetch: vi.fn() };
		await server.fetch(new Request(`https://10000-${uuid}-tok.ayn.wtf/`), {
			...env,
			CANDIDATE_PREVIEW: binding,
		} as unknown as Env);
		expect(proxyToSandboxMock).toHaveBeenCalledOnce();
		expect(binding.fetch).not.toHaveBeenCalled();
	});
});

describe("candidate entrypoint composition", () => {
	it("resolves only the deployment binding during fetch and independently during scheduled", async () => {
		const { resolveCandidateProductCommands } = await import(
			"#/lib/session-runtime-client"
		);
		const candidate = {
			admitOwned: vi.fn(),
			observeOwned: vi.fn(),
			workspaceActionOwned: vi.fn(),
			deleteProjectOwned: vi.fn(),
			modelsOwned: vi.fn(),
			drain: vi.fn().mockResolvedValue(undefined),
		};
		const fixtureEnv = {
			...env,
			PI_DURABLE_PRODUCT_COMMANDS: candidate,
		} as Env;
		proxyToSandboxMock.mockResolvedValue(null);
		handlerFetchMock.mockImplementation(
			async () =>
				new Response(
					resolveCandidateProductCommands() === candidate
						? "candidate"
						: "unavailable",
				),
		);
		expect(
			await (
				await server.fetch(new Request("http://localhost/"), fixtureEnv)
			).text(),
		).toBe("candidate");
		expect(resolveCandidateProductCommands()).toBeUndefined();
		expect(
			await (await server.fetch(new Request("http://localhost/"), env)).text(),
		).toBe("unavailable");
		const waitUntil = vi.fn();
		await server.scheduled({} as ScheduledController, fixtureEnv, {
			waitUntil,
		} as unknown as ExecutionContext);
		expect(candidate.drain).toHaveBeenCalledOnce();
		expect(waitUntil).toHaveBeenCalledWith(
			candidate.drain.mock.results[0].value,
		);
		expect(legacyDrainMock).toHaveBeenCalled();
	});
	it("leaves candidate commands unresolved without a CandidateSessions binding", async () => {
		const { resolveCandidateProductCommands } = await import(
			"#/lib/session-runtime-client"
		);
		proxyToSandboxMock.mockResolvedValue(null);
		handlerFetchMock.mockImplementation(
			async () =>
				new Response(
					resolveCandidateProductCommands() === undefined
						? "unavailable"
						: "candidate",
				),
		);
		expect(
			await (await server.fetch(new Request("http://localhost/"), env)).text(),
		).toBe("unavailable");
	});
	it("builds the production candidate commands when CandidateSessions is bound", async () => {
		const { resolveCandidateProductCommands } = await import(
			"#/lib/session-runtime-client"
		);
		proxyToSandboxMock.mockResolvedValue(null);
		handlerFetchMock.mockImplementation(
			async () =>
				new Response(
					typeof resolveCandidateProductCommands()?.drain === "function"
						? "candidate"
						: "unavailable",
				),
		);
		const bound = { ...env, CandidateSessions: {} } as unknown as Env;
		expect(
			await (
				await server.fetch(new Request("http://localhost/"), bound)
			).text(),
		).toBe("candidate");
	});
	it("does not contact the legacy Sandbox namespace for a ready candidate identity during real scheduled maintenance", async () => {
		const { sandboxIdentities, workspaceSessions } = await import(
			"#/db/schema"
		);
		const actual = await vi.importActual<
			typeof import("#/lib/workspace-runtime")
		>("#/lib/workspace-runtime");
		const identity = {
			workspaceSessionId: "candidate-session",
			sandboxId: "synthetic-executor",
		};
		const rows = (table: unknown) =>
			table === sandboxIdentities
				? [identity]
				: table === workspaceSessions
					? [
							{
								id: identity.workspaceSessionId,
								runtimeOwner: "pi_durable_v1",
								previewStartedAt: null,
							},
						]
					: [];
		scheduledDb.current = {
			select: () => ({
				from: (table: unknown) => ({
					where: () => {
						const result = rows(table);
						return Object.assign(Promise.resolve(result), {
							limit: async () => result,
						});
					},
				}),
			}),
		};
		legacySandboxStateMock.mockClear();
		lowerMaintenanceMock.mockClear();
		legacyDrainMock.mockImplementationOnce(actual.drainWorkspaceRuntime);
		const joined: Promise<unknown>[] = [];
		await server.scheduled({} as ScheduledController, env, {
			waitUntil: (promise: Promise<unknown>) => joined.push(promise),
		} as unknown as ExecutionContext);
		await Promise.all(joined);
		expect(legacySandboxStateMock).not.toHaveBeenCalled();
		expect(lowerMaintenanceMock).toHaveBeenCalledTimes(4);
		scheduledDb.current = {};
	});
	it("joins candidate scheduled delivery rather than relying only on waitUntil", async () => {
		const error = new Error("candidate drain failed");
		const candidate = {
			admitOwned: vi.fn(),
			observeOwned: vi.fn(),
			workspaceActionOwned: vi.fn(),
			deleteProjectOwned: vi.fn(),
			modelsOwned: vi.fn(),
			drain: vi.fn().mockRejectedValue(error),
		};
		await expect(
			server.scheduled(
				{} as ScheduledController,
				{ ...env, PI_DURABLE_PRODUCT_COMMANDS: candidate } as Env,
				{ waitUntil: vi.fn() } as unknown as ExecutionContext,
			),
		).rejects.toBe(error);
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

	it("routes all sandbox internet through the outbound broker", () => {
		const constructed = new (
			Sandbox as unknown as new () => {
				enableInternet: boolean | undefined;
				interceptHttps: boolean;
				sleepAfter: string;
			}
		)();
		expect(constructed.interceptHttps).toBe(true);
		expect(constructed.enableInternet).toBe(false);
		expect(constructed.sleepAfter).toBe("10m");
	});

	it("exports a scheduled drain handler", () => {
		expect(server.scheduled).toBeTypeOf("function");
	});
});
