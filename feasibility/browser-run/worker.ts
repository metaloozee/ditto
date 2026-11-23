// The workspace browser on Cloudflare Browser Run (#36, ADR-0012). One Workspace Durable Object
// per workspace owns its Browser Run session. Every route needs the owner's run key.
import { requireRunKey } from "../run-key.ts";
import { DESTINATIONS, isWorkspace, type WorkspaceId } from "./destinations.ts";

/** Browser Run's maximum: a session with no command for this long closes. */
const KEEP_ALIVE_MS = 20 * 60_000;
/** The Durable Object saves the cookies and closes the session this long after its last use. */
const SAVE_BEFORE_IDLE_MS = 18 * 60_000;

type Fetcher = { fetch(input: string, init?: RequestInit): Promise<unknown> };
type Connection = { sessionId: string; webSocket: Fetcher };
type SessionRecord = {
	sessionId: string;
	startTime?: number;
	endTime?: number;
	closeReason?: number;
	closeReasonText?: string;
};
type Target = { id: string; type: string; url: string; title?: string };
/** A cookie as CDP's `Storage.getCookies` returns it. */
type Cookie = { name: string; value: string; domain: string; expires?: number; session?: boolean };
/** One trial session as the owner's evidence reports it: by number, never by ID. */
export type SessionSummary = {
	session: number;
	startTime?: number;
	open?: true;
	endTime?: number;
	durationMs?: number;
	closeReason?: number;
	closeReasonText?: string;
};
type StoredCookies = { iv: string; data: string; savedAt: number; count: number };

/** Fields `Storage.setCookies` accepts back from what `Storage.getCookies` returned. */
const COOKIE_PARAMS = [
	"name",
	"value",
	"domain",
	"path",
	"secure",
	"httpOnly",
	"sameSite",
	"expires",
	"priority",
	"sourceScheme",
	"sourcePort",
	"partitionKey",
];

/** The parts of Cloudflare's `BrowserRun` binding this trial uses. */
export interface BrowserRunApi {
	launch(options: {
		keepAlive: number;
		guardrails: { allowedDomains: string[] };
	}): Promise<Connection>;
	connectSession(sessionId: string, options?: { targetId?: string }): Promise<Connection>;
	getSession(sessionId: string): Promise<SessionRecord | null>;
	closeSession(sessionId: string): Promise<unknown>;
	getLiveView(
		sessionId: string,
		options: { mode: "tab"; targetId: string; expiresInMs: number },
	): Promise<{ devtoolsFrontendUrl: string }>;
	history(options?: { limit?: number }): Promise<SessionRecord[]>;
	limits(): Promise<{ usedBrowserTimeSeconds?: number }>;
	devtools: {
		listTargets(sessionId: string): Promise<Target[]>;
		newTarget(sessionId: string, url?: string): Promise<Target>;
		getVersion(sessionId: string): Promise<unknown>;
	};
}

export interface WorkspaceState {
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
	/** Encrypts the stored cookies. */
	COOKIE_KEY: string;
	BROWSER: BrowserRunApi;
	WORKSPACE: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
}

export class Workspace {
	constructor(
		private state: WorkspaceState,
		private env: WorkspaceEnv,
	) {}

	async fetch(request: Request): Promise<Response> {
		const workspace = request.headers.get("x-workspace") as WorkspaceId;
		const url = new URL(request.url);
		const action = url.pathname.split("/").slice(3).join("/");
		const route = `${request.method} ${action}`;
		try {
			if (route === "POST session") return Response.json(await this.open(workspace));
			if (route === "DELETE cookies") {
				await this.state.storage.delete("cookies");
				return Response.json({ workspace, deleted: true });
			}
			if (route === "GET sessions") return Response.json({ workspace, ...(await this.history()) });
			if (route === "POST close") return Response.json({ workspace, closed: await this.close() });
			const sessionId = await this.live();
			if (!sessionId) return new Response("No live session. Open one first.", { status: 409 });
			await this.state.storage.setAlarm(Date.now() + SAVE_BEFORE_IDLE_MS);
			if (route === "POST cookies/save") return Response.json(await this.save(sessionId));
			if (route === "GET devtools/json/list") {
				const page = await this.page(sessionId);
				return Response.json([
					{
						id: page.id,
						type: page.type,
						url: page.url,
						// The owner's loopback doorway forwards this to the devtools route below.
						webSocketDebuggerUrl: `ws://${DOORWAY}/devtools/page/${page.id}`,
					},
				]);
			}
			const pageSocket = /^GET devtools\/devtools\/page\/([^/]+)$/.exec(route);
			if (pageSocket && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
				const connection = await this.env.BROWSER.connectSession(sessionId, {
					targetId: pageSocket[1],
				});
				return (await connection.webSocket.fetch("https://browser-binding.invalid", {
					headers: { Upgrade: "websocket" },
				})) as Response;
			}
			if (route === "POST live-view") {
				const minutes = Number(url.searchParams.get("minutes") ?? "10");
				if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
					return new Response("minutes must be a whole number from 1 to 60", { status: 400 });
				}
				const expiresInMs = minutes * 60_000;
				const page = await this.page(sessionId);
				const view = await this.env.BROWSER.getLiveView(sessionId, {
					mode: "tab",
					targetId: page.id,
					expiresInMs,
				});
				return Response.json({ url: view.devtoolsFrontendUrl, mode: "tab", expiresInMs });
			}
			if (route === "POST keepalive") {
				await this.env.BROWSER.devtools.getVersion(sessionId);
				return Response.json({ workspace, alive: true });
			}
			return new Response("Not found", { status: 404 });
		} catch (error) {
			return Response.json({ workspace, error: (error as Error).message }, { status: 500 });
		}
	}

	/** The live session, reconnected, or a new one with the workspace's list as guardrails. */
	private async open(workspace: WorkspaceId) {
		const sessions = (await this.state.storage.get<string[]>("sessions")) ?? [];
		const live = await this.live();
		await this.state.storage.setAlarm(Date.now() + SAVE_BEFORE_IDLE_MS);
		if (live) {
			return { workspace, reused: true, session: sessions.indexOf(live) + 1, restoredCookies: 0 };
		}

		// Decrypt first, so a key mismatch fails before a billed browser starts.
		const { cookies, savedAt } = await this.storedCookies();
		const connection = await this.env.BROWSER.launch({
			keepAlive: KEEP_ALIVE_MS,
			guardrails: { allowedDomains: DESTINATIONS[workspace] },
		});
		sessions.push(connection.sessionId);
		await this.state.storage.put("session", connection.sessionId);
		await this.state.storage.put("sessions", sessions);
		if (cookies.length) {
			await browserCommand(connection, "Storage.setCookies", { cookies: cookies.map(cookieParam) });
		}
		return {
			workspace,
			reused: false,
			session: sessions.length,
			restoredCookies: cookies.length,
			cookiesSavedAt: savedAt,
		};
	}

	/**
	 * This workspace's sessions as Browser Run's history records them, numbered in the order they
	 * opened. Session IDs stay here: the owner's evidence names sessions by number.
	 */
	private async history() {
		const ours = (await this.state.storage.get<string[]>("sessions")) ?? [];
		const records = await this.env.BROWSER.history({ limit: 100 });
		const sessions = ours.flatMap((sessionId, index): SessionSummary[] => {
			const record = records.find((r) => r.sessionId === sessionId);
			if (!record) return [];
			const { startTime, endTime, closeReason, closeReasonText } = record;
			if (endTime === undefined) return [{ session: index + 1, startTime, open: true as const }];
			return [
				{
					session: index + 1,
					startTime,
					endTime,
					durationMs: startTime === undefined ? undefined : endTime - startTime,
					closeReason,
					closeReasonText,
				},
			];
		});
		const { usedBrowserTimeSeconds } = await this.env.BROWSER.limits();
		return { sessions, usedBrowserTimeSeconds };
	}

	/** The session's first page, opening one if the browser has none. */
	private async page(sessionId: string): Promise<Target> {
		const targets = await this.env.BROWSER.devtools.listTargets(sessionId);
		return (
			targets.find((target) => target.type === "page") ??
			(await this.env.BROWSER.devtools.newTarget(sessionId, "about:blank"))
		);
	}

	/**
	 * Before Browser Run would close an idle session, save its cookies and close it, so the login
	 * outlives it and an idle browser stops billing.
	 */
	async alarm(): Promise<void> {
		const sessionId = await this.live();
		if (!sessionId) return;
		await this.save(sessionId);
		await this.close();
	}

	/** Exports the browser's cookies over CDP and stores them encrypted. */
	private async save(sessionId: string) {
		const connection = await this.env.BROWSER.connectSession(sessionId);
		const { cookies } = await browserCommand<{ cookies: Cookie[] }>(
			connection,
			"Storage.getCookies",
		);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const data = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			await this.cookieKey(),
			new TextEncoder().encode(JSON.stringify(cookies)),
		);
		const savedAt = Date.now();
		const stored: StoredCookies = {
			iv: base64(iv),
			data: base64(new Uint8Array(data)),
			savedAt,
			count: cookies.length,
		};
		await this.state.storage.put("cookies", stored);
		const domains = [...new Set(cookies.map((cookie) => cookie.domain))].sort();
		return { cookies: cookies.length, domains, savedAt };
	}

	private async storedCookies(): Promise<{ cookies: Cookie[]; savedAt?: number }> {
		const stored = await this.state.storage.get<StoredCookies>("cookies");
		if (!stored) return { cookies: [] };
		const plain = await crypto.subtle
			.decrypt(
				{ name: "AES-GCM", iv: unbase64(stored.iv) },
				await this.cookieKey(),
				unbase64(stored.data),
			)
			.catch(() => {
				throw new Error("The stored cookies do not decrypt with this COOKIE_KEY");
			});
		const cookies = JSON.parse(new TextDecoder().decode(plain)) as Cookie[];
		return { cookies, savedAt: stored.savedAt };
	}

	private async cookieKey(): Promise<CryptoKey> {
		if (!this.env.COOKIE_KEY) throw new Error("COOKIE_KEY is not set");
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(this.env.COOKIE_KEY),
		);
		return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
	}

	/** Closes the live session without saving its cookies. */
	private async close(): Promise<boolean> {
		const sessionId = await this.state.storage.get<string>("session");
		if (!sessionId) return false;
		await this.state.storage.delete("session");
		await this.env.BROWSER.closeSession(sessionId).catch(() => undefined);
		return true;
	}

	/** The stored session's ID while Browser Run still has it open, reconnecting to prove it. */
	private async live(): Promise<string | undefined> {
		const sessionId = await this.state.storage.get<string>("session");
		if (!sessionId) return undefined;
		const record = await this.env.BROWSER.getSession(sessionId);
		if (record && record.endTime === undefined) {
			const reconnected = await this.env.BROWSER.connectSession(sessionId).catch(() => undefined);
			if (reconnected) return sessionId;
		}
		await this.state.storage.delete("session");
		return undefined;
	}
}

/** Where the owner's commands listen for DevTools; the harness connects only there. */
const DOORWAY = "127.0.0.1:9222";

type CdpSocket = {
	accept(): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	send(message: string): void;
	close(): void;
};

const CDP_TIMEOUT_MS = 15_000;

/** One CDP command on the session's browser target, on a socket of its own. */
async function browserCommand<T>(
	connection: Connection,
	method: string,
	params: Record<string, unknown> = {},
): Promise<T> {
	const response = (await connection.webSocket.fetch("https://browser-binding.invalid", {
		headers: { Upgrade: "websocket" },
	})) as { webSocket?: CdpSocket | null };
	const socket = response.webSocket;
	if (!socket) throw new Error("Browser Run did not return a WebSocket");
	socket.accept();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<T>((resolve, reject) => {
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(String(event.data)) as {
					id?: number;
					result?: T;
					error?: { message: string };
				};
				if (message.id !== 1) return;
				if (message.error) reject(new Error(`${method}: ${message.error.message}`));
				else resolve(message.result as T);
			});
			socket.send(JSON.stringify({ id: 1, method, params }));
			// An unanswered command would otherwise hold the request, or the alarm, forever.
			timer = setTimeout(() => reject(new Error(`${method}: no answer`)), CDP_TIMEOUT_MS);
		});
	} finally {
		clearTimeout(timer);
		socket.close();
	}
}

function cookieParam(cookie: Cookie): Record<string, unknown> {
	const param = Object.fromEntries(
		Object.entries(cookie).filter(([key]) => COOKIE_PARAMS.includes(key)),
	);
	// Chrome reports a session cookie with `expires: -1`; setting that back would expire it.
	if (cookie.session || (cookie.expires ?? -1) < 0) delete param.expires;
	return param;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unbase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export default {
	async fetch(request: Request, env: WorkspaceEnv): Promise<Response> {
		const refused = await requireRunKey(request, env.TRIAL_RUN_KEY);
		if (refused) return refused;
		const [prefix, workspace = ""] = new URL(request.url).pathname.split("/").slice(1);
		if (prefix !== "w" || !isWorkspace(workspace)) {
			return new Response("Not found", { status: 404 });
		}
		const headers = new Headers(request.headers);
		headers.set("x-workspace", workspace);
		return env.WORKSPACE.getByName(workspace).fetch(new Request(request, { headers }));
	},
};
