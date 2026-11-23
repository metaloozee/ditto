// The Browser Run trial Worker (#36) at its fetch seam, with Cloudflare's Browser Run binding
// faked at the platform boundary. A session holds the owner's logins, so every entry point sits
// behind the run key, and the CDP connection and Live View URL leave only by the owner's routes.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import worker, { type WorkspaceEnv, Workspace } from "./browser-run/worker.ts";

const RUN_KEY = "browser-run-key-SIMULATED-0123456789abcdef";
const COOKIE_KEY = "cookie-key-SIMULATED-fedcba9876543210";
const ORIGIN = "https://ditto-browser-run-trial.example.workers.dev";
const LIVE_VIEW = "https://live.browser.run/ui/view?mode=tab&wss=SIMULATED-live-view-jwt";

type Cookie = { name: string; value: string; domain: string; path: string; expires: number };
type Command = { id: number; method: string; params?: Record<string, unknown> };
type Session = {
	id: string;
	open: boolean;
	options: Record<string, unknown>;
	cookies: Cookie[];
	startTime: number;
	endTime?: number;
	closeReasonText?: string;
	commands: string[];
};

function platform() {
	const sessions: Session[] = [];
	const connected: { sessionId: string; targetId?: string }[] = [];
	const liveViews: { sessionId: string; options: Record<string, unknown> }[] = [];
	const storage = new Map<string, Map<string, unknown>>();
	const alarms = new Map<string, number>();
	const pageResponses: unknown[] = [];
	let clock = 1_700_000_000_000;

	const find = (id: string) => {
		const session = sessions.find((s) => s.id === id);
		if (!session) throw new Error(`No session ${id}`);
		return session;
	};

	// A CDP socket on the browser target: answers the Storage commands the Durable Object sends.
	const socket = (session: Session) => {
		const listeners: ((event: { data: string }) => void)[] = [];
		return {
			accept() {},
			addEventListener(_: "message", listener: (event: { data: string }) => void) {
				listeners.push(listener);
			},
			send(raw: string) {
				const command = JSON.parse(raw) as Command;
				session.commands.push(command.method);
				let result: unknown = {};
				if (command.method === "Storage.getCookies") result = { cookies: session.cookies };
				if (command.method === "Storage.setCookies") {
					session.cookies.push(...(command.params?.cookies as Cookie[]));
				}
				queueMicrotask(() =>
					listeners.forEach((l) => l({ data: JSON.stringify({ id: command.id, result }) })),
				);
			},
			close() {},
		};
	};

	const connection = (session: Session, targetId?: string) => ({
		sessionId: session.id,
		webSocket: {
			async fetch(_: string, init?: RequestInit) {
				if (new Headers(init?.headers).get("upgrade") !== "websocket")
					throw new Error("No upgrade");
				if (targetId) {
					const response = { status: 101, page: targetId };
					pageResponses.push(response);
					return response;
				}
				return { status: 101, webSocket: socket(session) };
			},
		},
	});

	const browser = {
		async launch(options: Record<string, unknown> = {}) {
			const session: Session = {
				id: `session-${sessions.length + 1}-SIMULATED`,
				open: true,
				options,
				cookies: [],
				startTime: (clock += 1000),
				commands: [],
			};
			sessions.push(session);
			return connection(session);
		},
		async connectSession(sessionId: string, options: { targetId?: string } = {}) {
			const session = find(sessionId);
			if (!session.open) throw new Error("Session closed");
			connected.push({ sessionId, targetId: options.targetId });
			return connection(session, options.targetId);
		},
		async getSession(sessionId: string) {
			const session = sessions.find((s) => s.id === sessionId);
			return session ? { sessionId, startTime: session.startTime, endTime: session.endTime } : null;
		},
		async closeSession(sessionId: string) {
			const session = find(sessionId);
			session.open = false;
			session.endTime = clock += 60_000;
			session.closeReasonText = "NormalClosure";
			return { status: "closed" };
		},
		async getLiveView(sessionId: string, options: Record<string, unknown> = {}) {
			liveViews.push({ sessionId, options });
			return { devtoolsFrontendUrl: LIVE_VIEW, webSocketDebuggerUrl: "wss://SIMULATED", id: "lv" };
		},
		async history() {
			return sessions.map((s) => ({
				sessionId: s.id,
				startTime: s.startTime,
				endTime: s.endTime,
				closeReason: s.endTime ? 1 : undefined,
				closeReasonText: s.closeReasonText,
			}));
		},
		async limits() {
			return { usedBrowserTimeSeconds: 4321, maxConcurrentSessions: 200, activeSessions: [] };
		},
		devtools: {
			async listTargets(sessionId: string) {
				find(sessionId);
				return [
					{ id: "browser-target", type: "browser", url: "" },
					{
						id: "PAGE1",
						type: "page",
						url: "about:blank",
						webSocketDebuggerUrl: "wss://live.browser.run/devtools/page/PAGE1?jwt=SIMULATED",
						devtoolsFrontendUrl: LIVE_VIEW,
					},
				];
			},
			async newTarget(sessionId: string, url = "about:blank") {
				find(sessionId);
				return { id: "PAGE2", type: "page", url };
			},
			async getVersion(sessionId: string) {
				find(sessionId).commands.push("Browser.getVersion");
				return { Browser: "Chrome/SIMULATED" };
			},
		},
	};

	const objects = new Map<string, Workspace>();
	const env: WorkspaceEnv = {
		TRIAL_RUN_KEY: RUN_KEY,
		COOKIE_KEY,
		BROWSER: browser,
		WORKSPACE: {
			getByName(name: string) {
				let object = objects.get(name);
				if (!object) {
					const data = storage.get(name) ?? new Map<string, unknown>();
					storage.set(name, data);
					const state = {
						storage: {
							get: async <T>(key: string) => data.get(key) as T | undefined,
							put: async (key: string, value: unknown) =>
								void data.set(key, structuredClone(value)),
							delete: async (key: string) => data.delete(key),
							setAlarm: async (at: number) => void alarms.set(name, at),
						},
					};
					object = new Workspace(state, env);
					objects.set(name, object);
				}
				return object;
			},
		},
	};

	return {
		env,
		sessions,
		connected,
		liveViews,
		storage,
		alarms,
		objects,
		pageResponses,
		/** The owner signs in through Live View: the site sets cookies in that session. */
		signIn(session: Session, cookies: Cookie[]) {
			session.cookies.push(...cookies);
		},
		/** Browser Run ends the session on its own: idle, crash or a release. */
		end(session: Session, reason: string) {
			session.open = false;
			session.endTime = clock += 60_000;
			session.closeReasonText = reason;
		},
		/** The Durable Object is evicted; its storage survives. */
		evict() {
			objects.clear();
		},
	};
}

function call(
	env: WorkspaceEnv,
	path: string,
	init: RequestInit = {},
	key: string | null = RUN_KEY,
) {
	const headers = new Headers(init.headers);
	if (key !== null) headers.set("x-trial-key", key);
	return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
}

const post = (env: WorkspaceEnv, path: string) => call(env, path, { method: "POST" });

const entryPoints: [string, RequestInit][] = [
	["/w/ws-takeover/session", { method: "POST" }],
	["/w/ws-takeover/keepalive", { method: "POST" }],
	["/w/ws-takeover/live-view", { method: "POST" }],
	["/w/ws-takeover/devtools/json/list", {}],
	["/w/ws-takeover/cookies/save", { method: "POST" }],
	["/w/ws-takeover/cookies", { method: "DELETE" }],
	["/w/ws-takeover/close", { method: "POST" }],
	["/w/ws-takeover/sessions", {}],
	["/", {}],
];

describe("run-key gate", () => {
	for (const [path, init] of entryPoints) {
		it.each([
			["no key", null],
			["a wrong key", "wrong"],
			["the key with a suffix", `${RUN_KEY}x`],
		])(`refuses ${init.method ?? "GET"} ${path} with %s and opens nothing`, async (_, key) => {
			const p = platform();
			const response = await call(p.env, path, init, key);

			expect(response.status).toBe(401);
			expect(p.objects.size).toBe(0);
			expect(p.sessions).toEqual([]);
		});
	}

	it("refuses a workspace without a destination list", async () => {
		const p = platform();
		const response = await post(p.env, "/w/ws-other/session");

		expect(response.status).toBe(404);
		expect(p.objects.size).toBe(0);
	});
});

describe("guardrails", () => {
	it.each([
		["ws-takeover", "takeover/destinations/ws-takeover.txt"],
		["ws-cloud-trial", "containers/destinations/ws-cloud-trial.txt"],
	] as const)(
		"opens %s's session with its destination list as allowed domains, kept alive 20 minutes",
		async (workspace, file) => {
			const p = platform();
			const response = await post(p.env, `/w/${workspace}/session`);

			expect(response.status).toBe(200);
			const listed = (await readFile(path.join(import.meta.dirname, file), "utf8"))
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"));
			expect(p.sessions).toHaveLength(1);
			expect(p.sessions[0]?.options).toEqual({
				keepAlive: 20 * 60_000,
				guardrails: { allowedDomains: listed },
			});
			expect(listed.length).toBeLessThanOrEqual(50);
		},
	);
});

describe("session reuse", () => {
	it("reconnects to the live session on a later request instead of launching a browser", async () => {
		const p = platform();
		const first = await (await post(p.env, "/w/ws-takeover/session")).json();
		p.evict();
		const second = await (await post(p.env, "/w/ws-takeover/session")).json();

		expect(p.sessions).toHaveLength(1);
		expect(p.connected).toContainEqual({ sessionId: p.sessions[0]?.id, targetId: undefined });
		expect(first).toMatchObject({ reused: false, session: 1 });
		expect(second).toMatchObject({ reused: true, session: 1 });
	});

	it("launches a new session once Browser Run has ended the last one", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.end(p.sessions[0]!, "BrowserIdle");
		const next = await (await post(p.env, "/w/ws-takeover/session")).json();

		expect(p.sessions).toHaveLength(2);
		expect(next).toMatchObject({ reused: false, session: 2 });
	});

	it("keeps each workspace's session apart", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		await post(p.env, "/w/ws-cloud-trial/session");

		expect(p.sessions).toHaveLength(2);
	});
});

const SIGNED_IN: Cookie[] = [
	{ name: "SID", value: "google-SIMULATED-secret", domain: ".google.com", path: "/", expires: 2e9 },
	{
		name: "li_at",
		value: "linkedin-SIMULATED-secret",
		domain: ".linkedin.com",
		path: "/",
		expires: -1,
	},
];

describe("cookies", () => {
	it("saves the session's cookies encrypted and restores them into the next session", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.signIn(p.sessions[0]!, SIGNED_IN);

		const saved = await (await post(p.env, "/w/ws-takeover/cookies/save")).json();
		expect(saved).toMatchObject({ cookies: 2, domains: [".google.com", ".linkedin.com"] });
		expect(p.sessions[0]?.commands).toContain("Storage.getCookies");
		const atRest = JSON.stringify([...p.storage.get("ws-takeover")!.values()]);
		expect(atRest).not.toContain("SIMULATED-secret");
		expect(atRest).not.toContain("SID");

		p.end(p.sessions[0]!, "BrowserIdle");
		p.evict();
		const next = await (await post(p.env, "/w/ws-takeover/session")).json();

		expect(next).toMatchObject({
			reused: false,
			session: 2,
			restoredCookies: 2,
			cookiesSavedAt: (saved as { savedAt: number }).savedAt,
		});
		// A session cookie (`expires: -1` from Chrome) goes back without an expiry.
		expect(p.sessions[1]?.cookies).toEqual([
			SIGNED_IN[0],
			{ name: "li_at", value: "linkedin-SIMULATED-secret", domain: ".linkedin.com", path: "/" },
		]);
	});

	it("does not restore cookies into a session it reconnects to", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.signIn(p.sessions[0]!, SIGNED_IN);
		await post(p.env, "/w/ws-takeover/cookies/save");
		const again = await (await post(p.env, "/w/ws-takeover/session")).json();

		expect(again).toMatchObject({ reused: true, restoredCookies: 0 });
		expect(p.sessions[0]?.cookies).toHaveLength(2);
	});

	it("ends the login in the next session once the stored cookies are deleted", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.signIn(p.sessions[0]!, SIGNED_IN);
		await post(p.env, "/w/ws-takeover/cookies/save");

		const deleted = await call(p.env, "/w/ws-takeover/cookies", { method: "DELETE" });
		expect(deleted.status).toBe(200);
		await post(p.env, "/w/ws-takeover/close");
		const next = await (await post(p.env, "/w/ws-takeover/session")).json();

		expect(next).toMatchObject({ reused: false, restoredCookies: 0 });
		expect(p.sessions[1]?.cookies).toEqual([]);
	});

	it("cannot restore cookies saved under another cookie key", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.signIn(p.sessions[0]!, SIGNED_IN);
		await post(p.env, "/w/ws-takeover/cookies/save");
		await post(p.env, "/w/ws-takeover/close");
		p.env.COOKIE_KEY = "another-key-SIMULATED";

		const response = await post(p.env, "/w/ws-takeover/session");

		expect(response.status).toBe(500);
		// Refused before a billed browser starts.
		expect(p.sessions).toHaveLength(1);
	});

	it("refuses to save cookies without a live session", async () => {
		const p = platform();
		const response = await post(p.env, "/w/ws-takeover/cookies/save");

		expect(response.status).toBe(409);
		expect(p.sessions).toEqual([]);
	});
});

describe("before an idle close", () => {
	it("arms an alarm inside Browser Run's 20-minute keep-alive whenever the session is used", async () => {
		const p = platform();
		const before = Date.now();
		await post(p.env, "/w/ws-takeover/session");

		const at = p.alarms.get("ws-takeover")!;
		expect(at).toBeGreaterThan(before);
		expect(at).toBeLessThan(before + 20 * 60_000);
	});

	it("saves the cookies and closes the session when the alarm fires", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.signIn(p.sessions[0]!, SIGNED_IN);

		await p.objects.get("ws-takeover")!.alarm();

		expect(p.sessions[0]?.open).toBe(false);
		const next = await (await post(p.env, "/w/ws-takeover/session")).json();
		expect(next).toMatchObject({ reused: false, restoredCookies: 2 });
	});

	it("keeps the stored cookies when Browser Run ended the session first", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.signIn(p.sessions[0]!, SIGNED_IN);
		await post(p.env, "/w/ws-takeover/cookies/save");
		p.end(p.sessions[0]!, "BrowserIdle");

		await p.objects.get("ws-takeover")!.alarm();
		const next = await (await post(p.env, "/w/ws-takeover/session")).json();

		expect(next).toMatchObject({ restoredCookies: 2 });
	});

	it("sends the browser a command on keep-alive and pushes the alarm back", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");
		p.alarms.set("ws-takeover", 0);

		const response = await post(p.env, "/w/ws-takeover/keepalive");

		expect(response.status).toBe(200);
		expect(p.sessions[0]?.commands).toContain("Browser.getVersion");
		expect(p.alarms.get("ws-takeover")).toBeGreaterThan(Date.now());
	});

	it("never opens a session from keep-alive", async () => {
		const p = platform();
		const response = await post(p.env, "/w/ws-takeover/keepalive");

		expect(response.status).toBe(409);
		expect(p.sessions).toEqual([]);
	});
});

describe("harness and Live View", () => {
	it("lists the session's pages with DevTools URLs on the owner's loopback doorway", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");

		const response = await call(p.env, "/w/ws-takeover/devtools/json/list");
		const targets = await response.json();

		expect(targets).toEqual([
			{
				id: "PAGE1",
				type: "page",
				url: "about:blank",
				webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/PAGE1",
			},
		]);
	});

	it("connects a DevTools WebSocket to that page of the live session", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");

		const response = await call(p.env, "/w/ws-takeover/devtools/devtools/page/PAGE1", {
			headers: { upgrade: "websocket" },
		});

		expect(p.connected).toContainEqual({ sessionId: p.sessions[0]?.id, targetId: "PAGE1" });
		expect(response).toBe(p.pageResponses[0]);
	});

	it("mints a Live View link for the page in tab mode, for the requested time", async () => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");

		const response = await post(p.env, "/w/ws-takeover/live-view?minutes=15");

		expect(await response.json()).toEqual({ url: LIVE_VIEW, mode: "tab", expiresInMs: 900_000 });
		expect(p.liveViews).toEqual([
			{
				sessionId: p.sessions[0]?.id,
				options: { mode: "tab", targetId: "PAGE1", expiresInMs: 900_000 },
			},
		]);
	});

	it.each(["0", "61", "soon"])("refuses a Live View link for %j minutes", async (minutes) => {
		const p = platform();
		await post(p.env, "/w/ws-takeover/session");

		const response = await post(p.env, `/w/ws-takeover/live-view?minutes=${minutes}`);

		expect(response.status).toBe(400);
		expect(p.liveViews).toEqual([]);
	});

	it("never answers with the session ID, and only the Live View route with a Live View URL", async () => {
		const p = platform();
		const bodies: string[] = [];
		for (const [path, init] of entryPoints.filter(([path]) => !path.includes("live-view"))) {
			if (path === "/w/ws-takeover/cookies") continue;
			bodies.push(await (await call(p.env, path, init)).text());
		}
		p.signIn(p.sessions[0]!, SIGNED_IN);
		bodies.push(await (await post(p.env, "/w/ws-takeover/cookies/save")).text());

		const all = bodies.join("\n");
		expect(all).not.toContain(p.sessions[0]!.id);
		expect(all).not.toContain("live.browser.run");
		expect(all).not.toContain("SIMULATED-secret");
	});
});

describe("session history", () => {
	it("reports this workspace's sessions from history, numbered, with length and close reason", async () => {
		const p = platform();
		await post(p.env, "/w/ws-cloud-trial/session");
		await post(p.env, "/w/ws-takeover/session");
		p.end(p.sessions[1]!, "BrowserIdle");
		await post(p.env, "/w/ws-takeover/session");

		const response = await call(p.env, "/w/ws-takeover/sessions");
		const body = await response.json();

		expect(body).toEqual({
			workspace: "ws-takeover",
			sessions: [
				{
					session: 1,
					startTime: p.sessions[1]!.startTime,
					endTime: p.sessions[1]!.endTime,
					durationMs: 60_000,
					closeReason: 1,
					closeReasonText: "BrowserIdle",
				},
				{ session: 2, startTime: p.sessions[2]!.startTime, open: true },
			],
			usedBrowserTimeSeconds: 4321,
		});
		expect(JSON.stringify(body)).not.toContain("SIMULATED");
	});
});
