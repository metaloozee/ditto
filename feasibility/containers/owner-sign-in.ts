// The owner's sign-in for the take-over view (#37, ADR-0007), in place of the run key. The trial's
// smallest honest shape: GitHub OAuth, one of Ditto's sign-in providers, straight from this Worker,
// accepting only the GitHub account named at deploy. The session is an HMAC-signed cookie that
// holds no token. Production would use Ditto's own sign-in session instead.
//   GET /auth/sign-in?return=/w/<workspace>/view/...   to GitHub, with a one-time state
//   GET /auth/callback?code&state                      back from GitHub; sets the owner session

const SESSION_COOKIE = "ditto_owner";
const STATE_COOKIE = "ditto_oauth";
const SESSION_SECONDS = 3600;
const RETURN_PATH = /^\/w\/[a-z0-9-]+\/view\/[^\s]*$/;

export interface SignInEnv {
	OWNER_SESSION_KEY: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	OWNER_GITHUB_ID: string;
}

function cookies(request: Request): Map<string, string> {
	const header = request.headers.get("cookie") ?? "";
	return new Map(
		header
			.split(";")
			.map((part) => part.trim().split("="))
			.filter((pair): pair is [string, string] => pair.length >= 2)
			.map(([name, ...value]) => [name, value.join("=")]),
	);
}

async function sign(env: SignInEnv, value: string): Promise<string> {
	if (!env.OWNER_SESSION_KEY) throw new Error("OWNER_SESSION_KEY is not set");
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.OWNER_SESSION_KEY),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares digests, so the comparison takes the same time whatever the guess. */
async function same(a: string, b: string): Promise<boolean> {
	const digest = async (value: string) =>
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	const [x, y] = await Promise.all([digest(a), digest(b)]);
	return x.every((byte, i) => byte === y[i]);
}

/** Whether the request carries a live session for the configured owner. */
export async function isOwner(request: Request, env: SignInEnv): Promise<boolean> {
	if (!env.OWNER_GITHUB_ID || !env.OWNER_SESSION_KEY) return false;
	const [expires = "", mac = ""] = (cookies(request).get(SESSION_COOKIE) ?? "").split(".");
	if (!(Number(expires) > Date.now())) return false;
	return same(mac, await sign(env, `owner:${env.OWNER_GITHUB_ID}:${expires}`));
}

export function signInRedirect(request: Request): Response {
	const url = new URL(request.url);
	const target = new URL("/auth/sign-in", url.origin);
	target.searchParams.set("return", url.pathname + url.search);
	return Response.redirect(target.toString(), 302);
}

const refuse = (status: number, text: string) => new Response(text, { status });

/** Answers `/auth/*`, or returns undefined for any other path. */
export async function signInRoutes(
	request: Request,
	env: SignInEnv,
): Promise<Response | undefined> {
	const url = new URL(request.url);
	if (url.pathname === "/auth/sign-in") {
		const back = url.searchParams.get("return") ?? "";
		if (!RETURN_PATH.test(back)) return refuse(400, "Returns only to a take-over view");
		const state = [...crypto.getRandomValues(new Uint8Array(16))]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		const authorize = new URL("https://github.com/login/oauth/authorize");
		authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
		authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
		authorize.searchParams.set("state", state);
		authorize.searchParams.set("allow_signup", "false");
		const headers = new Headers({ location: authorize.toString() });
		// Lax, because GitHub's redirect back is a cross-site navigation.
		headers.append(
			"set-cookie",
			`${STATE_COOKIE}=${state}.${encodeURIComponent(back)}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
		);
		return new Response(null, { status: 302, headers });
	}
	if (url.pathname === "/auth/callback") {
		const saved = cookies(request).get(STATE_COOKIE) ?? "";
		const dot = saved.indexOf(".");
		const [state, back] = dot < 0 ? ["", ""] : [saved.slice(0, dot), saved.slice(dot + 1)];
		const given = url.searchParams.get("state") ?? "";
		if (!state || !(await same(state, given))) return refuse(400, "Sign-in state does not match");
		const returnTo = decodeURIComponent(back);
		if (!RETURN_PATH.test(returnTo)) return refuse(400, "Returns only to a take-over view");

		const token = (await (
			await fetch("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					client_id: env.GITHUB_CLIENT_ID,
					client_secret: env.GITHUB_CLIENT_SECRET,
					code: url.searchParams.get("code") ?? "",
					redirect_uri: `${url.origin}/auth/callback`,
				}).toString(),
			})
		).json()) as { access_token?: string };
		if (!token.access_token) return refuse(403, "GitHub refused the sign-in");
		const user = (await (
			await fetch("https://api.github.com/user", {
				headers: {
					authorization: `Bearer ${token.access_token}`,
					accept: "application/vnd.github+json",
					"user-agent": "ditto-feasibility",
				},
			})
		).json()) as { id?: number };
		if (!env.OWNER_GITHUB_ID || String(user.id) !== env.OWNER_GITHUB_ID) {
			return refuse(403, "Only the workspace owner may take over");
		}

		const expires = String(Date.now() + SESSION_SECONDS * 1000);
		const mac = await sign(env, `owner:${env.OWNER_GITHUB_ID}:${expires}`);
		const headers = new Headers({ location: `${url.origin}${returnTo}` });
		headers.append(
			"set-cookie",
			`${SESSION_COOKIE}=${expires}.${mac}; Path=/w; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
		);
		headers.append("set-cookie", `${STATE_COOKIE}=; Path=/auth; HttpOnly; Secure; Max-Age=0`);
		return new Response(null, { status: 302, headers });
	}
	return undefined;
}
