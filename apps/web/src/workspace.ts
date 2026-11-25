import { Container } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./lib/auth.ts";
import type {
	ChiefOfStaff,
	ComputerPolicy,
	ComputerStatus,
	OpenedWorkspace,
	WorkspaceRpc,
} from "./workspace-rpc.ts";

/** The image's control port: readiness, the filter's decisions and the fence's result. */
const CONTROL_PORT = 8081;
const READY_TIMEOUT_MS = 180_000;
const IDLE_SECONDS = 5 * 60;
const MAX_HOSTS = 200;
const HOST =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * The shared computer's instance as the Workspace object drives it. Everything the object does
 * to the instance goes through this one seam.
 */
export interface Instance {
	readonly running: boolean;
	/** Starts the instance under `policy` and resolves once its control port answers. */
	start(policy: ComputerPolicy): Promise<void>;
	destroy(): Promise<void>;
	/** A request to the running instance's control port, which counts as use. */
	control(path: string, init?: RequestInit): Promise<Response>;
}

/** The approved hosts from a request body, normalized, or why they were refused. */
function parseHosts(body: unknown): string[] | string {
	const hosts = (body as { hosts?: unknown } | null)?.hosts;
	if (!Array.isArray(hosts)) return "Send { hosts: string[] }";
	if (hosts.length > MAX_HOSTS) return `At most ${MAX_HOSTS} hosts`;
	const normalized = new Set<string>();
	for (const host of hosts) {
		const name = typeof host === "string" ? host.trim().toLowerCase() : "";
		if (!HOST.test(name)) return `Not an exact host name: ${JSON.stringify(host)}`;
		normalized.add(name);
	}
	return [...normalized];
}

/** One per workspace, owning who may open it, its Chief of Staff and its shared computer. */
export class Workspace extends Container<AuthEnv> implements WorkspaceRpc {
	readonly #instance: Instance;
	/** The start in flight, so a racing start waits for it instead of starting again. */
	#starting: Promise<void> | undefined;
	/** Requests answered since the object woke, so tests can see that refusals never arrive. */
	#requests = 0;

	constructor(ctx: DurableObjectState<{}>, env: AuthEnv) {
		super(ctx, env);
		// The library's own idle timer: only use of the instance renews it, never a status read.
		this.sleepAfter = Number(env.COMPUTER_IDLE_SECONDS ?? IDLE_SECONDS);
		const container = () => {
			if (!this.ctx.container) throw new Error("This Durable Object has no container");
			return this.ctx.container;
		};
		this.#instance = {
			get running() {
				return container().running;
			},
			start: ({ workspaceId, hosts }) =>
				this.startAndWaitForPorts({
					// The instance learns its workspace and list only from these variables.
					startOptions: {
						envVars: { WORKSPACE_ID: workspaceId, APPROVED_HOSTS: hosts.join(",") },
						enableInternet: true,
					},
					ports: [CONTROL_PORT],
					cancellationOptions: { portReadyTimeoutMS: READY_TIMEOUT_MS },
				}),
			destroy: () => this.destroy(),
			control: (path, init) =>
				this.containerFetch(new Request(`http://instance${path}`, init), CONTROL_PORT),
		};
	}

	/**
	 * Admits the workspace's owner, claiming it on first open, and provisions the permanent
	 * Chief of Staff once. Never starts the shared computer.
	 */
	async open(workspaceId: string, accountId: string): Promise<OpenedWorkspace> {
		const owner = await this.ctx.storage.get<string>("owner");
		if (owner !== undefined && owner !== accountId) return { refused: "not the owner" };
		if (owner === undefined) await this.ctx.storage.put("owner", accountId);

		let chiefOfStaff = await this.ctx.storage.get<ChiefOfStaff>("chiefOfStaff");
		if (!chiefOfStaff) {
			chiefOfStaff = { id: `bot-${crypto.randomUUID()}`, name: "Ditto" };
			await this.ctx.storage.put("chiefOfStaff", chiefOfStaff);
		}
		return { workspaceId, chiefOfStaff, computer: (await this.#status()).computer };
	}

	/** Test stage only: drops the object from memory, as an eviction would. */
	evict(): void {
		this.ctx.abort("evicted by the test stage");
	}

	/** The lifetime deadline, scheduled through the library at start. Public so it can fire. */
	async lifetimeEnded(): Promise<void> {
		await this.#stop();
	}

	/** Nothing used the instance for `sleepAfter`. */
	override async onActivityExpired(): Promise<void> {
		await this.#stop();
	}

	/** However the instance ended, nothing about it carries over to the next one. */
	override async onStop(): Promise<void> {
		await this.#forgetInstance();
	}

	/**
	 * The gateway forwards only the owner's requests, with the server-resolved workspace ID in
	 * `x-ditto-workspace-id`.
	 */
	override async fetch(request: Request): Promise<Response> {
		this.#requests++;
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const { 0: client, 1: server } = new WebSocketPair();
			server.accept();
			server.addEventListener("message", (event) => server.send(event.data));
			return new Response(null, { status: 101, webSocket: client });
		}
		const url = new URL(request.url);
		const route = `${request.method} ${url.pathname}`;
		try {
			if (route === "GET /computer") return Response.json(await this.#status());
			if (route === "POST /computer/start") {
				const workspaceId = request.headers.get("x-ditto-workspace-id");
				if (!workspaceId) return Response.json({ error: "No workspace" }, { status: 400 });
				return Response.json(await this.#start(workspaceId));
			}
			if (route === "POST /computer/stop") return Response.json(await this.#stop());
			if (route === "GET /hosts") return Response.json({ hosts: await this.#hosts() });
			if (route === "PUT /hosts") {
				const hosts = parseHosts(await request.json().catch(() => null));
				if (typeof hosts === "string") return Response.json({ error: hosts }, { status: 400 });
				// A running instance keeps the list it started with until its next start.
				await this.ctx.storage.put("hosts", hosts);
				return Response.json({ hosts });
			}
			const control = /^\/__test\/computer\/control(\/.*)$/.exec(url.pathname)?.[1];
			if (this.env.TEST_HOOKS === "on" && control) {
				if (!this.#instance.running) return Response.json({ error: "Stopped" }, { status: 409 });
				return await this.#instance.control(control + url.search, { method: request.method });
			}
		} catch (error) {
			return Response.json({ error: (error as Error).message }, { status: 500 });
		}
		return Response.json({
			object: "Workspace",
			container: this.ctx.container !== undefined,
			running: this.ctx.container?.running ?? false,
			requests: this.#requests,
		});
	}

	/** The approved exact-host list, which starts empty, so a new workspace denies every host. */
	async #hosts(): Promise<string[]> {
		return (await this.ctx.storage.get<string[]>("hosts")) ?? [];
	}

	/** Reads only the object's own state, so polling it neither starts nor keeps the instance. */
	async #status(): Promise<ComputerStatus> {
		if (!this.#instance.running) return { computer: "stopped" };
		const [deadline] = await this.listSchedules("lifetimeEnded");
		return {
			computer: "running",
			policy: (await this.ctx.storage.get<ComputerPolicy>("instancePolicy")) ?? null,
			deadline: deadline ? new Date(deadline.time * 1000).toISOString() : null,
		};
	}

	/**
	 * Starts the shared computer under the server-resolved workspace ID and the current list, or
	 * reuses the running one.
	 */
	async #start(workspaceId: string): Promise<ComputerStatus & { reused: boolean }> {
		if (this.#starting) {
			await this.#starting;
			return { ...(await this.#status()), reused: true };
		}
		if (this.#instance.running) return { ...(await this.#status()), reused: true };

		const lifetime = Number(this.env.COMPUTER_LIFETIME_SECONDS);
		if (!Number.isFinite(lifetime) || lifetime <= 0) {
			throw new Error("COMPUTER_LIFETIME_SECONDS must be a positive number");
		}
		const policy: ComputerPolicy = { workspaceId, hosts: await this.#hosts() };
		this.#starting = (async () => {
			await this.ctx.storage.put("instancePolicy", policy);
			this.deleteSchedules("lifetimeEnded");
			await this.schedule(new Date(Date.now() + lifetime * 1000), "lifetimeEnded");
			try {
				await this.#instance.start(policy);
				// Idle time counts from when the instance is ready.
				this.renewActivityTimeout();
			} catch (error) {
				await this.#stop();
				throw error;
			}
		})();
		try {
			await this.#starting;
		} finally {
			this.#starting = undefined;
		}
		return { ...(await this.#status()), reused: false };
	}

	/** Destroys the instance. Everything the object holds, the list included, survives it. */
	async #stop(): Promise<ComputerStatus> {
		if (this.#instance.running) await this.#instance.destroy();
		await this.#forgetInstance();
		return { computer: "stopped" };
	}

	async #forgetInstance(): Promise<void> {
		this.deleteSchedules("lifetimeEnded");
		await this.ctx.storage.delete("instancePolicy");
	}
}

export class Bot extends DurableObject {
	override fetch(): Response {
		return Response.json({ object: "Bot" });
	}
}

/** One per account, holding its model connections. */
export class Credentials extends DurableObject {
	override fetch(): Response {
		return Response.json({ object: "Credentials" });
	}
}
