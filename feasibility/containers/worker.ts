// Chrome and the egress filter on Cloudflare Containers (#32), kept healthy (#37). One Durable
// Object, and so one container instance, per workspace. The owner's commands need the run key.
//   POST   /w/<workspace>/start          start the instance, restore its cookies, report startup
//   POST   /w/<workspace>/stop           save the cookies, then destroy the instance
//   POST   /w/<workspace>/discard        destroy the instance without saving
//   POST   /w/<workspace>/cookies/save   export the browser's cookies and store them encrypted
//   DELETE /w/<workspace>/cookies        delete the stored cookies (ADR-0010)
//   POST   /w/<workspace>/takeover       lock DevTools, then hold the instance for the owner
//   POST   /w/<workspace>/handback       unlock DevTools, release the hold, save the cookies
//   POST   /w/<workspace>/hold/task      hold the instance for a bot task; DELETE releases it
//   GET    /w/<workspace>/status         running, holds, last activity; never touches the instance
//   *      /w/<workspace>/view/...       noVNC take-over view (port 6080): the owner's sign-in, not
//                                        the run key, and only during take-over
//   GET    /auth/sign-in, /auth/callback  the owner's GitHub sign-in (owner-sign-in.ts)
//   *      /w/<workspace>/devtools/...   Chrome DevTools for the bot (port 9223), refused in take-over
//   GET    /w/<workspace>/control/...    filter decisions, fence, memory, samples (port 8081)
import { requireRunKey } from "../run-key.ts";
import {
	browserCommand,
	type Cookie,
	cookieParam,
	seal,
	type StoredCookies,
	unseal,
} from "./cookies.ts";
import { isOwner, signInRedirect, signInRoutes } from "./owner-sign-in.ts";

/** Workspaces with a destination list baked into the image. */
const WORKSPACES = new Set(["ws-cloud-trial", "ws-takeover"]);
const PORTS = { view: 6080, devtools: 9223, control: 8081, gate: 8082 } as const;
const READY_TIMEOUT_MS = 180_000;
/** Cloudflare stops an instance after 3 to 5 idle minutes; a hold touches it this often. */
export const KEEP_ALIVE_MS = 30_000;

type Hold = "takeover" | "task";

interface ContainerApi {
	readonly running: boolean;
	start(options: { env: Record<string, string>; enableInternet: boolean }): void;
	destroy(): Promise<void>;
	getTcpPort(port: number): { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
}

interface WorkspaceState {
	container?: ContainerApi;
	storage: {
		get<T>(key: string): Promise<T | undefined>;
		put(key: string, value: unknown): Promise<void>;
		delete(key: string): Promise<boolean>;
		setAlarm(at: number): Promise<void>;
	};
}

export interface WorkspaceEnv {
	/** Sent by the owner's commands in `x-trial-key`. Empty refuses every request. */
	TRIAL_RUN_KEY: string;
	/** The application's instance type, reported with each start. */
	INSTANCE_TYPE: string;
	/** Minutes after a start when the instance is destroyed regardless. */
	MAX_MINUTES: string;
	/** Encrypts the stored cookies. */
	COOKIE_KEY: string;
	/** Signs the owner's take-over session cookie. */
	OWNER_SESSION_KEY: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	/** The numeric GitHub user ID of the only account that may open the take-over view. */
	OWNER_GITHUB_ID: string;
	WORKSPACE: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
}

export class Workspace {
	/** Set while a start restores cookies, so no bot opens a page before they are in. */
	private starting = false;

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
		const route = `${request.method} ${[action, ...rest].join("/")}`;
		try {
			if (route === "POST start") return await this.start(workspace);
			if (route === "GET status") return Response.json({ workspace, ...(await this.status()) });
			if (route === "DELETE cookies") {
				await this.state.storage.delete("cookies");
				return Response.json({ workspace, deleted: true });
			}
			if (route === "POST stop") {
				const saved = this.container.running ? await this.save().catch(errorOf) : undefined;
				await this.destroy();
				return Response.json({ workspace, stopped: true, saved });
			}
			if (route === "POST discard") {
				await this.destroy();
				return Response.json({ workspace, stopped: true });
			}
			if (!this.container.running) {
				return new Response("Not running. Start it first.", { status: 409 });
			}
			if (route === "POST cookies/save")
				return Response.json({ workspace, saved: await this.save() });
			if (route === "POST takeover") return await this.takeOver(workspace);
			if (route === "POST handback")
				return Response.json({ workspace, ...(await this.handBack()) });
			if (route === "POST hold/task") {
				await this.hold("task");
				return Response.json({ workspace, holds: await this.holds() });
			}
			if (route === "DELETE hold/task") {
				const saved = await this.release("task");
				return Response.json({ workspace, holds: await this.holds(), saved });
			}
			if (action === "view" && !(await this.holds()).includes("takeover")) {
				return new Response("The view opens only during take-over", { status: 409 });
			}
			if (action === "devtools") {
				if ((await this.holds()).includes("takeover")) {
					return new Response("The owner holds the screen until hand-back", { status: 423 });
				}
				if (this.starting) return new Response("Restoring cookies", { status: 409 });
			}
			if (action !== "devtools" && action !== "control" && action !== "view") {
				return new Response("Not found", { status: 404 });
			}
			return await this.forward(request, PORTS[action], `/${rest.join("/")}`);
		} catch (error) {
			return Response.json({ workspace, error: (error as Error).message }, { status: 500 });
		}
	}

	/**
	 * Keep-alive while held, and the spending cap in time: the instance never outlives
	 * MAX_MINUTES, and its cookies are saved before the deadline destroys it.
	 */
	async alarm(): Promise<void> {
		if (!this.container.running) return;
		const deadline = (await this.state.storage.get<number>("deadline")) ?? 0;
		if (Date.now() >= deadline) {
			await this.save().catch(() => undefined);
			await this.destroy();
			return;
		}
		if ((await this.holds()).length === 0) {
			// Nothing holds the instance: leave it alone, so Cloudflare's idle stop can take it.
			await this.state.storage.setAlarm(deadline);
			return;
		}
		await this.touch();
		await this.state.storage.setAlarm(Math.min(Date.now() + KEEP_ALIVE_MS, deadline));
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
		if (this.container.running) return Response.json({ workspace, reused: true });

		// Decrypt first, so a key that cannot read the stored cookies fails before a billed start.
		const stored = await this.state.storage.get<StoredCookies>("cookies");
		const cookies = stored ? await unseal(stored, this.env.COOKIE_KEY) : [];

		this.starting = true;
		try {
			const deadline = began + minutes * 60_000;
			await this.state.storage.put("deadline", deadline);
			await this.state.storage.put("holds", []);
			// The workspace identity reaches the filter only through this variable.
			this.container.start({ env: { WORKSPACE_ID: workspace }, enableInternet: true });
			await this.state.storage.setAlarm(deadline);
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
			await this.state.storage.put("lastActivityAt", Date.now());
			if (cookies.length) {
				await browserCommand(this.devtools(), "Storage.setCookies", {
					cookies: cookies.map(cookieParam),
				});
			}
		} finally {
			this.starting = false;
		}
		return Response.json({
			workspace,
			instanceType: this.env.INSTANCE_TYPE,
			startupMs: Date.now() - began,
			restoredCookies: cookies.length,
			cookiesSavedAt: stored?.savedAt,
		});
	}

	/** ADR-0007: every bot's DevTools access ends before the owner is told the screen is theirs. */
	private async takeOver(workspace: string): Promise<Response> {
		const locked = await this.container
			.getTcpPort(PORTS.gate)
			.fetch("http://127.0.0.1:8082/lock", { method: "POST" })
			.then(
				async (response) => response.ok && ((await response.json()) as { locked: boolean }).locked,
			)
			.catch(() => false);
		if (!locked) {
			return Response.json({ workspace, error: "DevTools did not lock" }, { status: 502 });
		}
		await this.hold("takeover");
		return Response.json({ workspace, ready: true, holds: await this.holds() });
	}

	private async handBack() {
		const response = await this.container
			.getTcpPort(PORTS.gate)
			.fetch("http://127.0.0.1:8082/unlock", { method: "POST" });
		if (!response.ok) throw new Error(`DevTools did not unlock: ${response.status}`);
		const saved = await this.release("takeover");
		return { holds: await this.holds(), saved };
	}

	private async holds(): Promise<Hold[]> {
		return (await this.state.storage.get<Hold[]>("holds")) ?? [];
	}

	private async hold(name: Hold): Promise<void> {
		const holds = await this.holds();
		if (!holds.includes(name)) await this.state.storage.put("holds", [...holds, name]);
		const deadline = (await this.state.storage.get<number>("deadline")) ?? Date.now();
		await this.state.storage.setAlarm(Math.min(Date.now() + KEEP_ALIVE_MS, deadline));
	}

	/** Releasing the last hold saves the cookies, before an idle stop can discard them. */
	private async release(name: Hold) {
		const holds = (await this.holds()).filter((hold) => hold !== name);
		await this.state.storage.put("holds", holds);
		return holds.length === 0 ? this.save() : undefined;
	}

	private async status() {
		return {
			running: this.container.running,
			holds: this.container.running ? await this.holds() : [],
			lastActivityAt: await this.state.storage.get<number>("lastActivityAt"),
			keepAlives: (await this.state.storage.get<number>("keepAlives")) ?? 0,
			cookiesSavedAt: (await this.state.storage.get<StoredCookies>("cookies"))?.savedAt,
		};
	}

	/** A request to the instance, which Cloudflare counts as activity. */
	private async touch(): Promise<void> {
		await this.container
			.getTcpPort(PORTS.control)
			.fetch("http://127.0.0.1:8081/ready")
			.catch(() => undefined);
		await this.state.storage.put("lastActivityAt", Date.now());
		const count = (await this.state.storage.get<number>("keepAlives")) ?? 0;
		await this.state.storage.put("keepAlives", count + 1);
	}

	/** Exports the browser's cookies over CDP and stores them encrypted. */
	private async save() {
		const { cookies } = await browserCommand<{ cookies: Cookie[] }>(
			this.devtools(),
			"Storage.getCookies",
		);
		const stored = await seal(cookies, this.env.COOKIE_KEY);
		await this.state.storage.put("cookies", stored);
		const domains = [...new Set(cookies.map((cookie) => cookie.domain))].sort();
		return { cookies: cookies.length, domains, savedAt: stored.savedAt };
	}

	private async destroy(): Promise<void> {
		await this.state.storage.put("holds", []);
		if (this.container.running) await this.container.destroy();
	}

	private devtools() {
		return this.container.getTcpPort(PORTS.devtools);
	}

	private async forward(request: Request, port: number, path: string): Promise<Response> {
		const headers = new Headers(request.headers);
		for (const name of ["x-trial-key", "x-workspace", "origin", "host", "cookie"]) {
			headers.delete(name);
		}
		// Chrome refuses DevTools requests whose Host is not an IP or localhost, and builds its
		// WebSocket URLs from that Host. 127.0.0.1:9222 is where the owner's loopback proxy listens.
		const host = port === PORTS.devtools ? "127.0.0.1:9222" : `127.0.0.1:${port}`;
		const search = new URL(request.url).search;
		await this.state.storage.put("lastActivityAt", Date.now());
		return this.container.getTcpPort(port).fetch(
			new Request(`http://${host}${path}${search}`, {
				method: request.method,
				headers,
				body: request.body,
			}),
		);
	}
}

const errorOf = (error: Error) => ({ error: error.message });

export default {
	async fetch(request: Request, env: WorkspaceEnv): Promise<Response> {
		const signIn = await signInRoutes(request, env);
		if (signIn) return signIn;
		const url = new URL(request.url);
		const [prefix, workspace = "", action] = url.pathname.split("/").slice(1);
		if (action === "view") {
			// The owner's screen: their sign-in, never the run key.
			const upgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
			if (!(await isOwner(request, env))) {
				return upgrade ? new Response("Sign in first", { status: 401 }) : signInRedirect(request);
			}
			if (upgrade && request.headers.get("origin") !== url.origin) {
				return new Response("Forbidden", { status: 403 });
			}
		} else {
			const refused = await requireRunKey(request, env.TRIAL_RUN_KEY);
			if (refused) return refused;
		}
		if (prefix !== "w" || !WORKSPACES.has(workspace)) {
			return new Response("Not found", { status: 404 });
		}
		const headers = new Headers(request.headers);
		headers.set("x-workspace", workspace);
		return env.WORKSPACE.getByName(workspace).fetch(new Request(request, { headers }));
	},
};
