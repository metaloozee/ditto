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
//   GET    /w/<workspace>/status         running, holds, last use; never touches the instance
//   *      /w/<workspace>/view/...       noVNC take-over view (port 6080): the owner's sign-in, not
//                                        the run key, and only during take-over
//   GET    /auth/sign-in, /auth/callback  the owner's GitHub sign-in (owner-sign-in.ts)
//   *      /w/<workspace>/devtools/...   Chrome DevTools for the bot (port 9223), refused in take-over
//   GET    /w/<workspace>/control/...    filter decisions, fence, memory, samples (port 8081)
import { Container } from "@cloudflare/containers";

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

// The library reaches it through ctx.exports when an object restarts beside a running instance.
export { ContainerProxy } from "@cloudflare/containers";

/** Workspaces with a destination list baked into the image. */
const WORKSPACES = new Set(["ws-cloud-trial", "ws-takeover"]);
const PORTS = { view: 6080, devtools: 9223, control: 8081, gate: 8082 } as const;
const READY_TIMEOUT_MS = 180_000;

type Hold = "takeover" | "task";

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

/**
 * The library proxies DevTools and the view through this object, accepting both WebSocket ends,
 * so Cloudflare counts them as the object's activity, and each request or message renews
 * `sleepAfter`. Its alarm loop keeps the object running while the instance does.
 */
export class Workspace extends Container<WorkspaceEnv> {
	sleepAfter = "5m";
	/** Set while a start restores cookies, so no bot opens a page before they are in. */
	private starting = false;
	/** When the instance was last used, for the owner's idle measurement. */
	private lastActivityAt: number | undefined;

	private get instance() {
		if (!this.ctx.container) throw new Error("This Durable Object has no container");
		return this.ctx.container;
	}

	override renewActivityTimeout(): void {
		super.renewActivityTimeout();
		if (this.ctx.container?.running) this.lastActivityAt = Date.now();
	}

	override async fetch(request: Request): Promise<Response> {
		const workspace = request.headers.get("x-workspace") ?? "";
		const [action = "", ...rest] = new URL(request.url).pathname.split("/").slice(3);
		const route = `${request.method} ${[action, ...rest].join("/")}`;
		try {
			if (route === "POST start") return await this.open(workspace);
			if (route === "GET status") return Response.json({ workspace, ...(await this.status()) });
			if (route === "DELETE cookies") {
				await this.ctx.storage.delete("cookies");
				return Response.json({ workspace, deleted: true });
			}
			if (route === "POST stop") {
				const saved = this.instance.running ? await this.save().catch(errorOf) : undefined;
				await this.shutDown();
				return Response.json({ workspace, stopped: true, saved });
			}
			if (route === "POST discard") {
				await this.shutDown();
				return Response.json({ workspace, stopped: true });
			}
			if (!this.instance.running) {
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

	/** Nothing used the instance for `sleepAfter`: a hold keeps it, otherwise save and stop. */
	override async onActivityExpired(): Promise<void> {
		if (!this.instance.running || (await this.holds()).length > 0) return;
		await this.save().catch(() => undefined);
		await this.shutDown();
	}

	/** The spending cap in time: the instance never outlives MAX_MINUTES, its cookies saved first. */
	async deadlinePassed(): Promise<void> {
		if (!this.instance.running) return;
		await this.save().catch(() => undefined);
		await this.shutDown();
	}

	private async open(workspace: string): Promise<Response> {
		const began = Date.now();
		const minutes = Number(this.env.MAX_MINUTES);
		if (!Number.isFinite(minutes) || minutes <= 0) {
			return Response.json(
				{ workspace, error: "MAX_MINUTES must be a positive number" },
				{ status: 500 },
			);
		}
		if (this.instance.running) return Response.json({ workspace, reused: true });

		// Decrypt first, so a key that cannot read the stored cookies fails before a billed start.
		const stored = await this.ctx.storage.get<StoredCookies>("cookies");
		const cookies = stored ? await unseal(stored, this.env.COOKIE_KEY) : [];

		this.starting = true;
		try {
			await this.ctx.storage.put("holds", []);
			this.deleteSchedules("deadlinePassed");
			await this.schedule(new Date(began + minutes * 60_000), "deadlinePassed");
			await this.startAndWaitForPorts({
				// The workspace identity reaches the filter only through this variable.
				startOptions: { envVars: { WORKSPACE_ID: workspace }, enableInternet: true },
				ports: [PORTS.control],
				cancellationOptions: { portReadyTimeoutMS: READY_TIMEOUT_MS },
			});
			const control = this.instance.getTcpPort(PORTS.control);
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
			if (cookies.length) {
				await browserCommand(this.devtools(), "Storage.setCookies", {
					cookies: cookies.map(cookieParam),
				});
			}
		} finally {
			this.starting = false;
		}
		this.renewActivityTimeout();
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
		const locked = await this.instance
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
		const response = await this.instance
			.getTcpPort(PORTS.gate)
			.fetch("http://127.0.0.1:8082/unlock", { method: "POST" });
		if (!response.ok) throw new Error(`DevTools did not unlock: ${response.status}`);
		const saved = await this.release("takeover");
		return { holds: await this.holds(), saved };
	}

	private async holds(): Promise<Hold[]> {
		return (await this.ctx.storage.get<Hold[]>("holds")) ?? [];
	}

	private async hold(name: Hold): Promise<void> {
		const holds = await this.holds();
		if (!holds.includes(name)) await this.ctx.storage.put("holds", [...holds, name]);
	}

	/** Releasing the last hold saves the cookies, and `sleepAfter` counts from the release. */
	private async release(name: Hold) {
		const holds = (await this.holds()).filter((hold) => hold !== name);
		await this.ctx.storage.put("holds", holds);
		this.renewActivityTimeout();
		return holds.length === 0 ? this.save() : undefined;
	}

	/** Reads only the object's own state, so polling it neither touches nor keeps the instance. */
	private async status() {
		const running = this.instance.running;
		return {
			running,
			holds: running ? await this.holds() : [],
			lastActivityAt: this.lastActivityAt,
			cookiesSavedAt: (await this.ctx.storage.get<StoredCookies>("cookies"))?.savedAt,
		};
	}

	/** Exports the browser's cookies over CDP and stores them encrypted. */
	private async save() {
		const { cookies } = await browserCommand<{ cookies: Cookie[] }>(
			this.devtools(),
			"Storage.getCookies",
		);
		const stored = await seal(cookies, this.env.COOKIE_KEY);
		await this.ctx.storage.put("cookies", stored);
		const domains = [...new Set(cookies.map((cookie) => cookie.domain))].sort();
		return { cookies: cookies.length, domains, savedAt: stored.savedAt };
	}

	private async shutDown(): Promise<void> {
		await this.ctx.storage.put("holds", []);
		this.deleteSchedules("deadlinePassed");
		if (this.instance.running) await this.instance.destroy();
	}

	private devtools() {
		return this.instance.getTcpPort(PORTS.devtools);
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
		return this.containerFetch(
			new Request(`http://${host}${path}${search}`, {
				method: request.method,
				headers,
				body: request.body,
			}),
			port,
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
