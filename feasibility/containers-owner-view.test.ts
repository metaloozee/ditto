// The take-over view behind the owner's sign-in (#37, ADR-0007), in place of the run key. The
// trial signs the owner in with GitHub, one of Ditto's sign-in providers, and accepts only the
// GitHub account named at deploy. GitHub is faked at its HTTP boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
	call,
	ORIGIN,
	owner,
	type Platform,
	platform,
	RUN_KEY,
	socketOf,
} from "./containers-platform.fake.ts";

const VIEW = "/w/ws-takeover/view/vnc.html?autoconnect=1";
let githubUser = 4242;
const github = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === "https://github.com/login/oauth/access_token") {
		const body = new URLSearchParams(init?.body as string);
		if (body.get("code") !== "good-code") return Response.json({ error: "bad_verification_code" });
		return Response.json({ access_token: "gho_SIMULATED", token_type: "bearer" });
	}
	if (url === "https://api.github.com/user")
		return Response.json({ id: githubUser, login: "someone" });
	return new Response("unexpected", { status: 500 });
});

beforeEach(() => {
	githubUser = 4242;
	github.mockClear();
	vi.stubGlobal("fetch", github);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const cookieOf = (response: Response, name: string) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith(`${name}=`))
		?.split(";")[0];

/** Runs the GitHub sign-in and returns the owner's session cookie, if one was set. */
async function signIn(p: Platform, code = "good-code") {
	const start = await call(p.env, `/auth/sign-in?return=${encodeURIComponent(VIEW)}`);
	const authorize = new URL(start.headers.get("location") ?? "");
	const state = authorize.searchParams.get("state") ?? "";
	const callback = await call(p.env, `/auth/callback?code=${code}&state=${state}`, {
		headers: { cookie: cookieOf(start, "ditto_oauth") ?? "" },
	});
	return { start, authorize, callback, session: cookieOf(callback, "ditto_owner") };
}

async function inTakeOver() {
	const p = platform();
	await owner(p.env, "/w/ws-takeover/start");
	await owner(p.env, "/w/ws-takeover/takeover");
	return p;
}

describe("take-over view", () => {
	it("sends the owner to sign in, even with the run key", async () => {
		const p = await inTakeOver();
		const before = p.forwarded.length;

		const response = await call(p.env, VIEW, {}, RUN_KEY);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			`${ORIGIN}/auth/sign-in?return=${encodeURIComponent(VIEW)}`,
		);
		expect(p.forwarded.length).toBe(before);
	});

	it("opens for the owner's GitHub account, and the view never sees the session cookie", async () => {
		const p = await inTakeOver();
		const { session } = await signIn(p);

		const response = await call(p.env, VIEW, { headers: { cookie: session ?? "" } });

		expect(await response.text()).toBe("port 6080");
		expect(p.forwarded.at(-1)?.url).toBe("http://127.0.0.1:6080/vnc.html?autoconnect=1");
		expect(p.forwarded.at(-1)?.headers.get("cookie")).toBeNull();
	});

	it("is closed outside take-over, even to the owner", async () => {
		const p = platform();
		await owner(p.env, "/w/ws-takeover/start");
		const { session } = await signIn(p);

		const response = await call(p.env, VIEW, { headers: { cookie: session ?? "" } });

		expect(response.status).toBe(409);
	});

	it("relays the screen's WebSocket both ways for the owner", async () => {
		const p = await inTakeOver();
		const { session } = await signIn(p);

		const response = await call(p.env, "/w/ws-takeover/view/websockify", {
			headers: { cookie: session ?? "", upgrade: "websocket", origin: ORIGIN },
		});
		const screen = socketOf(response);
		const echoed = new Promise((resolve) =>
			screen.addEventListener("message", ({ data }) => resolve(data)),
		);
		screen.send("RFB 003.008\n");

		expect(response.status).toBe(101);
		expect(await echoed).toBe("RFB 003.008\n");
		expect(p.forwarded.at(-1)?.url).toBe("http://127.0.0.1:6080/websockify");
	});

	it("refuses the screen's WebSocket from another site's page", async () => {
		const p = await inTakeOver();
		const { session } = await signIn(p);

		const response = await call(p.env, "/w/ws-takeover/view/websockify", {
			headers: { cookie: session ?? "", upgrade: "websocket", origin: "https://evil.example" },
		});

		expect(response.status).toBe(403);
	});

	it.each([
		["a forged session", "ditto_owner=9999999999999.forged"],
		["an expired session", "expired"],
	])("refuses %s", async (_, cookie) => {
		const p = await inTakeOver();
		let value = cookie;
		if (cookie === "expired") {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(Date.now() - 2 * 60 * 60_000);
			value = (await signIn(p)).session ?? "";
			vi.useRealTimers();
		}

		const response = await call(p.env, VIEW, { headers: { cookie: value } });

		expect(response.status).toBe(302);
	});
});

describe("GitHub sign-in", () => {
	it("asks GitHub to send the owner back to this Worker with a one-time state", async () => {
		const p = platform();
		const { start, authorize } = await signIn(p);

		expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
		expect(authorize.searchParams.get("client_id")).toBe("client-id-SIMULATED");
		expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
		expect(authorize.searchParams.get("state")).toMatch(/^[0-9a-f]{32,}$/);
		expect(start.headers.getSetCookie().join()).toMatch(/HttpOnly/);
	});

	it("signs the owner in and returns them to the view", async () => {
		const p = platform();
		const { callback } = await signIn(p);

		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe(`${ORIGIN}${VIEW}`);
		const cookie = callback.headers.getSetCookie().find((c) => c.startsWith("ditto_owner="));
		expect(cookie).toMatch(/HttpOnly/);
		expect(cookie).toMatch(/Secure/);
		expect(cookie).toMatch(/SameSite=Lax/);
		expect(cookie).toMatch(/Max-Age=3600/);
		expect(cookie).not.toContain("gho_SIMULATED");
	});

	it("refuses any other GitHub account", async () => {
		const p = platform();
		githubUser = 7;

		const { callback, session } = await signIn(p);

		expect(callback.status).toBe(403);
		expect(session).toBeUndefined();
	});

	it("refuses a callback whose state does not match the browser's", async () => {
		const p = platform();
		const start = await call(p.env, `/auth/sign-in?return=${encodeURIComponent(VIEW)}`);

		const callback = await call(p.env, "/auth/callback?code=good-code&state=attacker", {
			headers: { cookie: cookieOf(start, "ditto_oauth") ?? "" },
		});

		expect(callback.status).toBe(400);
		expect(github).not.toHaveBeenCalled();
	});

	it("refuses a code GitHub does not accept", async () => {
		const p = platform();
		const { callback, session } = await signIn(p, "bad-code");

		expect(callback.status).toBe(403);
		expect(session).toBeUndefined();
	});

	it("returns only to a take-over view on this Worker", async () => {
		const p = platform();
		const start = await call(p.env, "/auth/sign-in?return=https://evil.example/");

		expect(start.status).toBe(400);
	});

	it("refuses every sign-in when no owner account is configured", async () => {
		const p = platform();
		p.env.OWNER_GITHUB_ID = "";

		const { callback, session } = await signIn(p);

		expect(callback.status).toBe(403);
		expect(session).toBeUndefined();
	});
});
