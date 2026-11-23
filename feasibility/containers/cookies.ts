// The browser's logins outside the instance (#37). A Container's disk is discarded whenever the
// instance stops, so the Workspace Durable Object exports Chrome's cookies over CDP, keeps them
// encrypted in its own storage and sets them again in the next instance. Adapted from the
// Browser Run trial (#36, `git show d5545cd:feasibility/browser-run/worker.ts`).

/** A cookie as CDP's `Storage.getCookies` returns it. */
export type Cookie = {
	name: string;
	value: string;
	domain: string;
	expires?: number;
	session?: boolean;
};
export type StoredCookies = { iv: string; data: string; savedAt: number; count: number };

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

export function cookieParam(cookie: Cookie): Record<string, unknown> {
	const param = Object.fromEntries(
		Object.entries(cookie).filter(([key]) => COOKIE_PARAMS.includes(key)),
	);
	// Chrome reports a session cookie with `expires: -1`; setting that back would expire it.
	if (cookie.session || (cookie.expires ?? -1) < 0) delete param.expires;
	return param;
}

async function aesKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("COOKIE_KEY is not set");
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(cookies: Cookie[], secret: string): Promise<StoredCookies> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await aesKey(secret),
		new TextEncoder().encode(JSON.stringify(cookies)),
	);
	return {
		iv: base64(iv),
		data: base64(new Uint8Array(data)),
		savedAt: Date.now(),
		count: cookies.length,
	};
}

export async function unseal(stored: StoredCookies, secret: string): Promise<Cookie[]> {
	const plain = await crypto.subtle
		.decrypt(
			{ name: "AES-GCM", iv: unbase64(stored.iv) },
			await aesKey(secret),
			unbase64(stored.data),
		)
		.catch(() => {
			throw new Error("The stored cookies do not decrypt with this COOKIE_KEY");
		});
	return JSON.parse(new TextDecoder().decode(plain)) as Cookie[];
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unbase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

type Port = { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
type CdpSocket = {
	accept(): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	send(message: string): void;
	close(): void;
};

const CDP_TIMEOUT_MS = 15_000;
/** Chrome refuses DevTools requests whose Host is not an IP or localhost. */
const DEVTOOLS_HOST = "http://127.0.0.1:9222";

/** One CDP command on the browser target, through the instance's DevTools gate. */
export async function browserCommand<T>(
	devtools: Port,
	method: string,
	params: Record<string, unknown> = {},
): Promise<T> {
	const version = (await (await devtools.fetch(`${DEVTOOLS_HOST}/json/version`)).json()) as {
		webSocketDebuggerUrl: string;
	};
	const { pathname } = new URL(version.webSocketDebuggerUrl);
	const response = (await devtools.fetch(`${DEVTOOLS_HOST}${pathname}`, {
		headers: { Upgrade: "websocket" },
	})) as Response & { webSocket?: CdpSocket | null };
	const socket = response.webSocket;
	if (!socket) throw new Error("DevTools did not return a WebSocket");
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
