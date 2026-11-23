// Cloudflare's container API and the instance behind it, faked at the platform boundary for the
// Containers trial Worker tests (#32, #37). The instance answers the control port, the DevTools
// gate and a browser-level DevTools socket that keeps a cookie jar, as Chrome's would.
import worker, { type WorkspaceEnv, Workspace } from "./containers/worker.ts";

export const RUN_KEY = "containers-run-key-SIMULATED-0123456789abcdef";
export const ORIGIN = "https://ditto-containers-trial.example.workers.dev";

export type Forwarded = { port: number; url: string; method: string; headers: Headers };
export type Cookie = {
	name: string;
	value: string;
	domain: string;
	path?: string;
	expires?: number;
	session?: boolean;
};

type Listener = (event: { data: unknown }) => void;

/** One instance's Chrome: a cookie jar reachable over a browser-level DevTools socket. */
function chrome(jar: Cookie[], log: string[]) {
	return {
		accept() {},
		listeners: [] as Listener[],
		addEventListener(_type: "message", listener: Listener) {
			this.listeners.push(listener);
		},
		send(raw: string) {
			const { id, method, params } = JSON.parse(raw) as {
				id: number;
				method: string;
				params: { cookies?: Cookie[] };
			};
			log.push(method);
			let result: unknown = {};
			if (method === "Storage.getCookies") result = { cookies: structuredClone(jar) };
			else if (method === "Storage.setCookies") jar.push(...(params.cookies ?? []));
			const reply = JSON.stringify({ id, result });
			queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: reply })));
		},
		close() {},
	};
}

export function platform() {
	const started: { env?: Record<string, string>; enableInternet?: boolean }[] = [];
	const forwarded: Forwarded[] = [];
	const alarms: number[] = [];
	const inactivity: number[] = [];
	const store = new Map<string, unknown>();
	/** Everything that happened to the instance, in order. */
	const events: string[] = [];
	let running = false;
	let destroyed = 0;
	let gateLocked = false;
	let gateFails = false;
	/** The current instance's cookies. A new instance starts with an empty jar. */
	let jar: Cookie[] = [];

	const answer = (port: number, request: Request): Response => {
		const { pathname } = new URL(request.url);
		if (port === 8082) {
			if (gateFails) return new Response("gate down", { status: 500 });
			if (pathname === "/lock") gateLocked = true;
			if (pathname === "/unlock") gateLocked = false;
			events.push(`gate ${pathname.slice(1)}`);
			return Response.json({ locked: gateLocked });
		}
		if (port === 9223) {
			if (gateLocked) throw new Error("connection refused");
			if (pathname === "/json/version") {
				return Response.json({
					webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/fake-browser",
				});
			}
			if (request.headers.get("upgrade") === "websocket") {
				events.push("browser devtools");
				return { webSocket: chrome(jar, events) } as unknown as Response;
			}
		}
		return new Response(`port ${port}`);
	};

	const container = {
		get running() {
			return running;
		},
		start(options: { env?: Record<string, string>; enableInternet?: boolean } = {}) {
			started.push(options);
			running = true;
			jar = [];
			events.push("start");
		},
		async setInactivityTimeout(ms: number) {
			inactivity.push(ms);
		},
		async destroy() {
			destroyed++;
			running = false;
			events.push("destroy");
		},
		getTcpPort(port: number) {
			return {
				async fetch(input: RequestInfo, init?: RequestInit) {
					const request = new Request(input, init);
					forwarded.push({
						port,
						url: request.url,
						method: request.method,
						headers: request.headers,
					});
					return answer(port, request);
				},
			};
		},
	};
	const objects = new Map<string, Workspace>();
	const env: WorkspaceEnv = {
		TRIAL_RUN_KEY: RUN_KEY,
		INSTANCE_TYPE: "standard-1",
		MAX_MINUTES: "60",
		COOKIE_KEY: "cookie-key-SIMULATED-0123456789abcdef",
		OWNER_SESSION_KEY: "owner-session-key-SIMULATED-0123456789",
		GITHUB_CLIENT_ID: "client-id-SIMULATED",
		GITHUB_CLIENT_SECRET: "client-secret-SIMULATED",
		OWNER_GITHUB_ID: "4242",
		WORKSPACE: {
			getByName(name: string) {
				let object = objects.get(name);
				if (!object) {
					const state = {
						container,
						storage: {
							get: async (key: string) => structuredClone(store.get(key)),
							put: async (key: string, value: unknown) => void store.set(key, value),
							delete: async (key: string) => store.delete(key),
							setAlarm: async (at: number) => void alarms.push(at),
						},
					};
					object = new Workspace(
						state as unknown as ConstructorParameters<typeof Workspace>[0],
						env,
					);
					objects.set(name, object);
				}
				return object;
			},
		},
	};
	return {
		env,
		started,
		forwarded,
		alarms,
		inactivity,
		objects,
		store,
		events,
		get destroyed() {
			return destroyed;
		},
		get jar() {
			return jar;
		},
		get gateLocked() {
			return gateLocked;
		},
		failGate() {
			gateFails = true;
		},
		/** The owner signs in to sites during take-over: their cookies land in the jar. */
		signIn(...cookies: Cookie[]) {
			jar.push(...cookies);
		},
		/** The platform stops the instance, as an idle stop does. */
		stopInstance() {
			running = false;
			events.push("platform stop");
		},
		/** A Durable Object evicted from memory comes back with only its storage. */
		evict() {
			objects.clear();
		},
	};
}

export type Platform = ReturnType<typeof platform>;

export function call(env: WorkspaceEnv, path: string, init: RequestInit = {}, key?: string) {
	const headers = new Headers(init.headers);
	if (key !== undefined) headers.set("x-trial-key", key);
	return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
}

export const owner = (env: WorkspaceEnv, path: string, method = "POST") =>
	call(env, path, { method }, RUN_KEY);
