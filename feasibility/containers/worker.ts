// Chrome and the egress filter on Cloudflare Containers (#32). One Durable Object, and so one
// container instance, per workspace. The Worker is the only way in: every route needs the owner's
// run key, and only POST /w/<workspace>/start starts a billed instance.
//   POST /w/<workspace>/start          start the instance, wait for Chrome, report startup time
//   POST /w/<workspace>/stop           destroy the instance
//   *    /w/<workspace>/view/...       noVNC take-over view (port 6080)
//   *    /w/<workspace>/devtools/...   Chrome DevTools for the bot (port 9223)
//   GET  /w/<workspace>/control/...   filter decisions, fence, memory, bypass probe (port 8081)
import { requireRunKey } from "../run-key.ts";

/** Workspaces with a destination list baked into the image. */
const WORKSPACES = new Set(["ws-cloud-trial", "ws-takeover"]);
const PORTS = { view: 6080, devtools: 9223, control: 8081 } as const;
const READY_TIMEOUT_MS = 180_000;

interface ContainerApi {
	readonly running: boolean;
	start(options: { env: Record<string, string>; enableInternet: boolean }): void;
	destroy(): Promise<void>;
	setInactivityTimeout(durationMs: number): Promise<void>;
	getTcpPort(port: number): { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
}

interface WorkspaceState {
	container?: ContainerApi;
	storage: { setAlarm(at: number): Promise<void> };
}

export interface WorkspaceEnv {
	/** Sent by the owner's commands in `x-trial-key`. Empty refuses every request. */
	TRIAL_RUN_KEY: string;
	/** The application's instance type, reported with each start. */
	INSTANCE_TYPE: string;
	/** Minutes after a start when the instance is destroyed regardless. */
	MAX_MINUTES: string;
	WORKSPACE: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
}

export class Workspace {
	constructor(
		private state: WorkspaceState,
		private env: WorkspaceEnv,
	) {}

	private get container(): ContainerApi {
		if (!this.state.container) throw new Error("This Durable Object has no container");
		return this.state.container;
	}

	async fetch(request: Request): Promise<Response> {
		const workspace = request.headers.get("x-workspace") ?? "";
		const [action = "", ...rest] = new URL(request.url).pathname.split("/").slice(3);
		if (action === "start" && request.method === "POST") return this.start(workspace);
		if (action === "stop" && request.method === "POST") {
			await this.alarm();
			return Response.json({ workspace, stopped: true });
		}
		if (!(action in PORTS)) return new Response("Not found", { status: 404 });
		if (!this.container.running) {
			return new Response("Not running. Start it first.", { status: 409 });
		}
		return this.forward(request, PORTS[action as keyof typeof PORTS], `/${rest.join("/")}`);
	}

	/** Spending cap in time: the instance never outlives MAX_MINUTES. */
	async alarm(): Promise<void> {
		if (this.container.running) await this.container.destroy();
	}

	private async start(workspace: string): Promise<Response> {
		const began = Date.now();
		const minutes = Number(this.env.MAX_MINUTES);
		if (!Number.isFinite(minutes) || minutes <= 0) {
			return Response.json(
				{ workspace, error: "MAX_MINUTES must be a positive number" },
				{ status: 500 },
			);
		}
		// A repeat start keeps the first deadline, so starting again never extends the cap.
		if (!this.container.running) {
			const lifetimeMs = minutes * 60_000;
			// The workspace identity reaches the filter only through this variable.
			this.container.start({ env: { WORKSPACE_ID: workspace }, enableInternet: true });
			// The Durable Object sits idle while the owner signs in, which would otherwise stop the
			// container within seconds. It lives until the alarm destroys it instead.
			await this.container.setInactivityTimeout(lifetimeMs);
			await this.state.storage.setAlarm(began + lifetimeMs);
		}
		const control = this.container.getTcpPort(PORTS.control);
		for (;;) {
			const ready = await control
				.fetch("http://127.0.0.1:8081/ready")
				.then((response) => response.ok)
				.catch(() => false);
			if (ready) break;
			if (Date.now() - began > READY_TIMEOUT_MS) {
				return Response.json({ workspace, error: "Chrome never became ready" }, { status: 504 });
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		return Response.json({
			workspace,
			instanceType: this.env.INSTANCE_TYPE,
			startupMs: Date.now() - began,
		});
	}

	private forward(request: Request, port: number, path: string): Promise<Response> {
		const headers = new Headers(request.headers);
		for (const name of ["x-trial-key", "x-workspace", "origin", "host"]) headers.delete(name);
		// Chrome refuses DevTools requests whose Host is not an IP or localhost, and builds its
		// WebSocket URLs from that Host. 127.0.0.1:9222 is where the owner's loopback proxy listens.
		const host = port === PORTS.devtools ? "127.0.0.1:9222" : `127.0.0.1:${port}`;
		const search = new URL(request.url).search;
		return this.container.getTcpPort(port).fetch(
			new Request(`http://${host}${path}${search}`, {
				method: request.method,
				headers,
				body: request.body,
			}),
		);
	}
}

export default {
	async fetch(request: Request, env: WorkspaceEnv): Promise<Response> {
		const refused = await requireRunKey(request, env.TRIAL_RUN_KEY);
		if (refused) return refused;
		const [prefix, workspace = ""] = new URL(request.url).pathname.split("/").slice(1);
		if (prefix !== "w" || !WORKSPACES.has(workspace)) {
			return new Response("Not found", { status: 404 });
		}
		const headers = new Headers(request.headers);
		headers.set("x-workspace", workspace);
		return env.WORKSPACE.getByName(workspace).fetch(new Request(request, { headers }));
	},
};
