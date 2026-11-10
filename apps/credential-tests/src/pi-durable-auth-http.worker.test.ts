import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withSessionRuntimeResolution } from "../../web/src/lib/session-runtime-client";
import { CANDIDATE_FIXTURE_RESET_SCHEMA } from "./candidate-fixture-schema";

// @ts-expect-error The Vite glob typing is not in this package's types.
const migrations = import.meta.glob("../../web/migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

// The web modules are loaded by absolute path so this package's typecheck does
// not pull the web app's Env and route-tree types into its own program.
const loadWeb = (path: string): Promise<unknown> =>
	import(
		/* @vite-ignore */ new URL(`../../web/src/${path}`, import.meta.url)
			.pathname
	);
type TestAuth = {
	$context: Promise<{
		internalAdapter: {
			createSession(userId: string): Promise<{ token: string }>;
		};
		authCookies: { sessionToken: { name: string } };
	}>;
	api: {
		getSession(options: {
			headers: Headers;
		}): Promise<{ user: { id: string } } | null>;
	};
};
let createAuth: (env: unknown) => TestAuth;
declare module "cloudflare:test" {
	interface ProvidedEnv {
		BETTER_AUTH_SECRET: string;
	}
}

type Handler = (ctx: { request: Request }) => Promise<Response>;
type Handlers = { GET?: Handler; POST?: Handler };

const captured = vi.hoisted(() => new Map<string, Handlers>());
vi.mock("../../web/node_modules/@tanstack/react-router", () => ({
	createFileRoute:
		(path: string) => (options: { server: { handlers: Handlers } }) => {
			captured.set(path, options.server.handlers);
			return { options };
		},
}));

const account = {
	version: 1,
	status: "available",
	generation: 1,
	revision: 1,
	models: [{ id: "faux-1", thinking: ["off"] }],
};
const prompt = {
	version: 2,
	kind: "prompt",
	projectId: "project",
	idempotencyKey: "first",
	text: "Synthetic admitted command",
};
const observe = { version: 1, projectId: "project", sessionId: "ghost" };
const action = {
	version: 1,
	kind: "git_status",
	projectId: "project",
	sessionId: "ghost",
};
const models = { version: 1, projectId: "project", sessionId: "ghost" };

const ROUTES = [
	{
		name: "control POST",
		path: "/api/agent/control",
		method: "POST",
		body: prompt,
	},
	{
		name: "observe POST",
		path: "/api/agent/observe",
		method: "POST",
		body: observe,
	},
	{
		name: "workspace-action POST",
		path: "/api/agent/workspace-action",
		method: "POST",
		body: action,
	},
	{
		name: "models POST",
		path: "/api/agent/models",
		method: "POST",
		body: models,
	},
	{
		name: "stream GET",
		path: "/api/agent/stream",
		method: "GET",
		search: "?projectId=project&sessionId=ghost",
	},
	{
		name: "stream POST",
		path: "/api/agent/stream",
		method: "POST",
		body: prompt,
	},
] as const;

const TABLES = [
	"workspace_sessions",
	"sandbox_identities",
	"session_commands",
	"messages",
	"workspace_runtime_work",
	"candidate_workspace_claims",
	"runtime_command_memberships",
	"privileged_operations",
];
async function counts() {
	return Promise.all(
		TABLES.map(
			async (table) =>
				(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{
					n: number;
				}>())!.n,
		),
	);
}
const ZERO = TABLES.map(() => 0);

async function hmacCookieValue(value: string, secret: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);
	const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
	return encodeURIComponent(`${value}.${b64}`);
}

// Mirrors better-call 1.3.7 serializeSignedCookie: encodeURIComponent(`${value}.${base64 HMAC-SHA256}`).
async function sessionCookie(userId: string, expiresAt?: number) {
	const ctx = await createAuth(env).$context;
	const session = await ctx.internalAdapter.createSession(userId);
	// The session.expiresAt column is a timestamp in whole seconds.
	if (expiresAt !== undefined)
		await env.DB.prepare("UPDATE session SET expiresAt=? WHERE token=?")
			.bind(Math.floor(expiresAt / 1000), session.token)
			.run();
	const name = ctx.authCookies.sessionToken.name;
	return `${name}=${await hmacCookieValue(session.token, env.BETTER_AUTH_SECRET)}`;
}

function tamper(cookie: string) {
	const last = cookie.at(-1);
	return cookie.slice(0, -1) + (last === "A" ? "B" : "A");
}

async function call(
	route: (typeof ROUTES)[number] | { path: string; method: "POST" | "GET" },
	init: { cookie?: string; body?: unknown; search?: string },
) {
	const handler = captured.get(route.path)?.[route.method];
	if (!handler) throw new Error(`No handler for ${route.method} ${route.path}`);
	const headers = new Headers();
	if (init.cookie) headers.set("cookie", init.cookie);
	if (init.body !== undefined) headers.set("content-type", "application/json");
	const request = new Request(
		`http://localhost:5173${route.path}${init.search ?? ""}`,
		{
			method: route.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		},
	);
	return withSessionRuntimeResolution(
		{ candidateCommands: env.CandidateProduct },
		() => handler({ request }),
	);
}

beforeAll(async () => {
	for (const name of [
		"control",
		"observe",
		"workspace-action",
		"models",
		"stream",
	])
		await loadWeb(`routes/api.agent.${name}.ts`);
	createAuth = (
		(await loadWeb("lib/auth.ts")) as { createAuth: typeof createAuth }
	).createAuth;
});

beforeEach(async () => {
	for (const key of Object.keys(migrations).sort())
		for (const statement of (migrations[key] ?? "").split(
			"--> statement-breakpoint",
		))
			if (statement.trim())
				await env.DB.exec(
					statement.replace(/^\s*--[^\n]*$/gm, "").replaceAll("\n", " "),
				);
	await env.DB.exec(CANDIDATE_FIXTURE_RESET_SCHEMA);
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Synthetic owner','owner@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('intruder','Synthetic intruder','intruder@example.invalid',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO projects(id,name,userId,status) VALUES('project','Synthetic project','owner','ready')",
		),
		env.DB.prepare(
			"INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)",
		),
		env.DB.prepare(
			"INSERT INTO codex_fixture_capabilities VALUES('owner',1,1,?)",
		).bind(JSON.stringify(account)),
	]);
	expect(
		(
			await env.CodexCredential.getByName("owner").install("owner", 1, {
				access: "synthetic-product-access",
				refresh: "synthetic-product-refresh",
				expiresAt: 4102444800000,
			})
		).status,
	).toBe("connected");
	await env.CandidateCredential.getByName("owner").install("owner", 1, {
		access: "synthetic-product-access",
		refresh: "synthetic-product-refresh",
		expiresAt: 4102444800000,
	});
});

describe("PD39 real-auth HTTP smoke", () => {
	it("loads the observe handler", () => {
		expect(captured.get("/api/agent/observe")?.POST).toBeTypeOf("function");
	});

	it("signed test cookie is accepted by Better Auth", async () => {
		const cookie = await sessionCookie("owner");
		const session = await createAuth(env).api.getSession({
			headers: new Headers({ cookie }),
		});
		expect(session?.user.id).toBe("owner");
	});

	describe.each(ROUTES)("$name", (route) => {
		const send = (cookie?: string) =>
			call(route, {
				cookie,
				body: "body" in route ? route.body : undefined,
				search: "search" in route ? route.search : undefined,
			});
		it.each([
			["missing", async () => undefined],
			["expired", async () => sessionCookie("owner", Date.now() - 60_000)],
			["tampered", async () => tamper(await sessionCookie("owner"))],
		])("%s session is 401 and writes nothing", async (_label, makeCookie) => {
			const response = await send(await makeCookie());
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Unauthorized" });
			expect(await counts()).toEqual(ZERO);
		});
	});

	it("foreign prompt is refused without writes", async () => {
		const response = await call(ROUTES[5], {
			cookie: await sessionCookie("intruder"),
			body: prompt,
		});
		// The service binding flattens the fixture's CandidateCommandError, so the route reports it as 503.
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ code: "runtime_unavailable" });
		expect(await counts()).toEqual(ZERO);
	});

	it("valid owner prompt is admitted (fixture-backed)", async () => {
		const response = await call(ROUTES[5], {
			cookie: await sessionCookie("owner"),
			body: prompt,
		});
		expect(response.status).toBe(202);
		expect(
			(await env.DB.prepare(
				"SELECT count(*) AS n FROM session_commands",
			).first<{
				n: number;
			}>())!.n,
		).toBe(1);
	});

	it.each([
		["observe", ROUTES[1], observe],
		["workspace-action", ROUTES[2], action],
		["models", ROUTES[3], models],
	])("%s with a fabricated session is refused without writes", async (_n, route, body) => {
		const response = await call(route, {
			cookie: await sessionCookie("intruder"),
			body,
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ code: "runtime_unavailable" });
		expect(await counts()).toEqual(ZERO);
	});
});
