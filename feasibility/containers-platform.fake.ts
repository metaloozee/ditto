// Cloudflare's Durable Object and container runtime, and the instance behind it, faked at the
// platform boundary for the Containers trial Worker tests (#32, #37). The instance answers the
// control port, the DevTools gate, a browser-level DevTools socket that keeps a cookie jar, as
// Chrome's would, and the noVNC view's socket. Time-driven tests fake the timers and call
// `elapse`, which also applies Cloudflare's idle stop.
import { DatabaseSync } from "node:sqlite";

import { vi } from "vite-plus/test";

import * as main from "./containers/worker.ts";
import worker, { type WorkspaceEnv, Workspace } from "./containers/worker.ts";

export const RUN_KEY = "containers-run-key-SIMULATED-0123456789abcdef";
export const ORIGIN = "https://ditto-containers-trial.example.workers.dev";
/** Cloudflare stopped the instance 26 to 57 s after its Durable Object went idle (2026-11-23). */
const PLATFORM_IDLE_STOP_MS = 30_000;
const STEP_MS = 5_000;

export type Forwarded = { port: number; url: string; method: string; headers: Headers };
export type Cookie = {
	name: string;
	value: string;
	domain: string;
	path?: string;
	expires?: number;
	session?: boolean;
};

type SocketEvent = { data?: unknown; code?: number; reason?: string };
type Listener = (event: SocketEvent) => void;

/** Sockets the Durable Object accepted, open: Cloudflare counts them as the object's activity. */
const accepted = new Set<FakeSocket>();

/** One end of a workerd WebSocket pair. */
export class FakeSocket {
	peer!: FakeSocket;
	open = true;
	private listeners = new Map<string, Listener[]>();

	accept() {
		accepted.add(this);
	}
	addEventListener(type: string, listener: Listener) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	send(data: unknown) {
		if (!this.open) throw new Error("WebSocket is closed");
		queueMicrotask(() => this.peer.emit("message", { data }));
	}
	close(code = 1000, reason = "") {
		if (!this.open) return;
		this.open = this.peer.open = false;
		accepted.delete(this);
		accepted.delete(this.peer);
		queueMicrotask(() => this.peer.emit("close", { code, reason }));
	}
	private emit(type: string, event: SocketEvent) {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

function socketPair(): [FakeSocket, FakeSocket] {
	const a = new FakeSocket();
	const b = new FakeSocket();
	a.peer = b;
	b.peer = a;
	return [a, b];
}

// workerd's globals that Node lacks: WebSocketPair, IdentityTransformStream, and Response's
// `webSocket`, which is null on a plain response.
const responseSockets = new WeakMap<Response, FakeSocket>();
const NodeResponse = globalThis.Response;
Object.defineProperty(NodeResponse.prototype, "webSocket", {
	configurable: true,
	get(this: Response) {
		return responseSockets.get(this) ?? null;
	},
});
class WorkerdResponse extends NodeResponse {
	constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: FakeSocket | null }) {
		const webSocket = init?.webSocket ?? null;
		// Node allows no 101; workerd answers an upgrade with one.
		super(body, webSocket ? { headers: init?.headers } : init);
		if (webSocket) responseSockets.set(this, webSocket);
	}
	override get status(): number {
		return responseSockets.has(this) ? 101 : super.status;
	}
}
Object.assign(globalThis, {
	Response: WorkerdResponse,
	IdentityTransformStream: TransformStream,
	WebSocketPair: class {
		0: FakeSocket;
		1: FakeSocket;
		constructor() {
			[this[0], this[1]] = socketPair();
		}
	},
});

/** WebCrypto settles on Node's thread pool, outside the faked timers; `elapse` waits for it. */
let pendingCrypto = 0;
for (const method of ["digest", "importKey", "encrypt", "decrypt", "sign", "verify"] as const) {
	const original = crypto.subtle[method].bind(crypto.subtle) as (
		...args: unknown[]
	) => Promise<unknown>;
	Object.defineProperty(crypto.subtle, method, {
		configurable: true,
		value: (...args: unknown[]) => {
			pendingCrypto++;
			return original(...args).finally(() => pendingCrypto--);
		},
	});
}

async function settle() {
	for (;;) {
		await vi.advanceTimersByTimeAsync(0);
		if (pendingCrypto === 0) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
}

export function platform() {
	accepted.clear();
	const started: { env?: Record<string, string>; enableInternet?: boolean }[] = [];
	const forwarded: Forwarded[] = [];
	/** Everything that happened to the instance, in order. */
	const events: string[] = [];
	/** The instance's own socket ends, closed with it. */
	const instanceSockets = new Set<FakeSocket>();
	let running = false;
	let exited: () => void = () => {};
	let exit = Promise.resolve();
	let destroyed = 0;
	let gateLocked = false;
	let gateFails = false;
	/** The current instance's cookies. A new instance starts with an empty jar. */
	let jar: Cookie[] = [];
	/** Requests and alarms the Durable Objects are running. */
	let inProgress = 0;
	let idleMs = 0;

	const halt = (event: string) => {
		if (!running) return;
		running = false;
		events.push(event);
		for (const socket of instanceSockets) socket.close(1006, "instance stopped");
		instanceSockets.clear();
		exited();
	};

	/** Chrome's browser target: answers each CDP command, keeping the cookie jar. */
	const chrome = (): FakeSocket => {
		const [toWorker, browser] = socketPair();
		instanceSockets.add(browser);
		browser.addEventListener("message", ({ data }) => {
			const { id, method, params } = JSON.parse(String(data)) as {
				id: number;
				method: string;
				params?: { cookies?: Cookie[] };
			};
			events.push(method);
			let result: unknown = {};
			if (method === "Storage.getCookies") result = { cookies: structuredClone(jar) };
			else if (method === "Storage.setCookies") jar.push(...(params?.cookies ?? []));
			browser.send(JSON.stringify({ id, result }));
		});
		return toWorker;
	};

	/** websockify behind the noVNC view: echoes the screen protocol back. */
	const view = (): FakeSocket => {
		const [toWorker, screen] = socketPair();
		instanceSockets.add(screen);
		screen.addEventListener("message", ({ data }) => screen.send(data));
		return toWorker;
	};

	const upgrade = (webSocket: FakeSocket) =>
		new Response(null, { status: 101, webSocket } as ResponseInit);

	const answer = (port: number, request: Request): Response => {
		const { pathname } = new URL(request.url);
		const isUpgrade = request.headers.get("upgrade") === "websocket";
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
			if (isUpgrade) {
				events.push("browser devtools");
				return upgrade(chrome());
			}
		}
		if (port === 6080 && isUpgrade) return upgrade(view());
		return new Response(`port ${port}`);
	};

	const container = {
		get running() {
			return running;
		},
		start(options: { env?: Record<string, string>; enableInternet?: boolean } = {}) {
			if (running) throw new Error("start() cannot be called on a running container");
			started.push(options);
			running = true;
			idleMs = 0;
			jar = [];
			exit = new Promise((resolve) => (exited = resolve));
			events.push("start");
		},
		monitor() {
			return exit;
		},
		signal(signo: number) {
			halt(`signal ${signo}`);
		},
		async destroy() {
			destroyed++;
			halt("destroy");
		},
		getTcpPort(port: number) {
			return {
				async fetch(input: RequestInfo | URL, init?: RequestInit) {
					if (!running) throw new Error("the container is not running");
					const request =
						init instanceof Request
							? new Request(input instanceof Request ? input.url : input.toString(), init)
							: new Request(input, init);
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
	const storages = new Map<string, ReturnType<typeof durableStorage>>();

	/** A SQLite-backed Durable Object's storage, with its one alarm delivered as Cloudflare does. */
	function durableStorage(name: string) {
		const store = new Map<string, unknown>();
		const db = new DatabaseSync(":memory:");
		let alarmAt: number | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let running: Promise<void> | undefined;
		const arm = () => {
			clearTimeout(timer);
			if (alarmAt !== undefined && !running) {
				timer = setTimeout(deliver, Math.max(0, alarmAt - Date.now()));
			}
		};
		const deliver = () => {
			if (running || alarmAt === undefined || alarmAt > Date.now()) return;
			alarmAt = undefined;
			inProgress++;
			running = object(name)
				.alarm()
				.catch(() => undefined)
				.finally(() => {
					inProgress--;
					running = undefined;
					arm();
				});
		};
		return {
			store,
			storage: {
				get: async (key: string) => structuredClone(store.get(key)),
				put: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
				delete: async (key: string) => store.delete(key),
				setAlarm: async (at: number) => {
					alarmAt = at;
					arm();
				},
				deleteAlarm: async () => {
					alarmAt = undefined;
					arm();
				},
				sync: async () => {},
				kv: {
					get: (key: string) => structuredClone(store.get(key)),
					put: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
				},
				sql: {
					// workerd binds undefined as NULL; node:sqlite refuses it.
					exec: (query: string, ...values: (string | number | null | undefined)[]) =>
						db.prepare(query).all(...values.map((value) => value ?? null)),
				},
			},
		};
	}

	function object(name: string): Workspace {
		let found = objects.get(name);
		if (!found) {
			let storage = storages.get(name);
			if (!storage) {
				storage = durableStorage(name);
				storages.set(name, storage);
			}
			const ctx = {
				id: { toString: () => name },
				container,
				storage: storage.storage,
				blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
				abort() {},
				// workerd mints a loopback for each entrypoint the main module exports.
				exports: Object.fromEntries(
					Object.keys(main)
						.filter((name) => name !== "default" && name !== "Workspace")
						.map((name) => [name, () => ({})]),
				),
			};
			found = new Workspace(ctx as unknown as ConstructorParameters<typeof Workspace>[0], env);
			objects.set(name, found);
		}
		return found;
	}

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
				return {
					async fetch(request: Request) {
						inProgress++;
						try {
							return await object(name).fetch(request);
						} finally {
							inProgress--;
						}
					},
				};
			},
		},
	};
	return {
		env,
		started,
		forwarded,
		objects,
		events,
		/** A workspace's Durable Object storage. */
		storage: (name: string) => storages.get(name)?.store ?? new Map<string, unknown>(),
		get destroyed() {
			return destroyed;
		},
		get running() {
			return running;
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
			halt("platform stop");
		},
		/** A Durable Object evicted from memory comes back with only its storage. */
		evict() {
			objects.clear();
		},
		/**
		 * Lets platform time pass, with the timers faked. Cloudflare stops an instance whose
		 * Durable Object has run no request or alarm and held no accepted WebSocket for a while.
		 */
		async elapse(ms: number) {
			for (let passed = 0; passed < ms; passed += STEP_MS) {
				const step = Math.min(STEP_MS, ms - passed);
				await vi.advanceTimersByTimeAsync(step);
				await settle();
				idleMs = inProgress === 0 && accepted.size === 0 ? idleMs + step : 0;
				if (running && idleMs >= PLATFORM_IDLE_STOP_MS) halt("platform idle stop");
			}
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

/** The client end of a WebSocket the Worker answered with, as a browser would hold it. */
export function socketOf(response: Response): FakeSocket {
	const socket = (response as Response & { webSocket: FakeSocket | null }).webSocket;
	if (!socket) throw new Error(`No WebSocket: ${response.status}`);
	return socket;
}
