import {
	env,
	fetchMock,
	runDurableObjectAlarm,
	runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import migration from "../../web/migrations/0021_first_lilandra.sql?raw";
import { handleCodexConnection } from "../../web/src/lib/codex-connection";
import { createCodexConnectionOperations } from "../../web/src/lib/codex-connection-product";
import { CodexCredential } from "../../web/src/lib/codex-credential-do";
import type { FixtureCredential } from "./entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		DB: D1Database;
		CodexCredential: DurableObjectNamespace<FixtureCredential>;
		CODEX_DEVICE_AUTH: string;
	}
}

const DEVICE_ID = "fake-device-id-ABC";
const USER_CODE = "WXYZ-9876";
const ACCESS = "fake-access-token-XYZ";
const REFRESH = "fake-refresh-token-XYZ";
const IDENTITY = "fake-id-token-XYZ";
const VERIFIER = "fake-code-verifier-XYZ";
const AUTH_CODE = "fake-authorization-code-XYZ";
const secrets = [DEVICE_ID, ACCESS, REFRESH, IDENTITY, VERIFIER, AUTH_CODE];

const auth = () => fetchMock.get("https://auth.openai.com");
function mockStart(interval: number | string = "5") {
	auth()
		.intercept({ path: "/api/accounts/deviceauth/usercode", method: "POST" })
		.reply(200, {
			device_auth_id: DEVICE_ID,
			user_code: USER_CODE,
			interval,
		});
}
function mockPoll(status: number, body: unknown) {
	auth()
		.intercept({ path: "/api/accounts/deviceauth/token", method: "POST" })
		.reply(status, body as object);
}
function mockExchange(status: number, body: unknown) {
	auth()
		.intercept({
			path: "/oauth/token",
			method: "POST",
			body: (raw: string) =>
				new URLSearchParams(raw).get("grant_type") === "authorization_code" &&
				new URLSearchParams(raw).get("code_verifier") === VERIFIER,
		})
		.reply(status, body as object);
}
const authorized = { authorization_code: AUTH_CODE, code_verifier: VERIFIER };
const tokenResponse = {
	access_token: ACCESS,
	refresh_token: REFRESH,
	id_token: IDENTITY,
	expires_in: 3600,
};

const operations = () => createCodexConnectionOperations(env);
const stubFor = (owner = "owner") => env.CodexCredential.getByName(owner);
const connection = () =>
	env.DB.prepare(
		"SELECT generation,revoked,status FROM codex_connections WHERE user_id='owner'",
	).first<{ generation: number; revoked: number; status: string }>();
const objectRows = (table: "device" | "credential") =>
	runInDurableObject(stubFor(), (_instance, ctx) =>
		ctx.storage.sql.exec(`SELECT * FROM ${table}`).toArray(),
	);

beforeEach(async () => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
	await env.DB.exec("CREATE TABLE user(id TEXT PRIMARY KEY)");
	await env.DB.exec(migration.replaceAll("\n", " "));
	await env.DB.prepare("INSERT INTO user(id) VALUES('owner')").run();
});
afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
	fetchMock.deactivate();
});

describe("Codex device sign-in", () => {
	it("starts a pending sign-in and bumps the product generation first", async () => {
		mockStart();
		const started = await operations().connect("owner");
		expect(started).toEqual({
			status: "pending",
			generation: 1,
			userCode: USER_CODE,
			verificationUri: "https://auth.openai.com/codex/device",
			expiresAt: expect.any(Number),
		});
		expect(JSON.stringify(started)).not.toContain(DEVICE_ID);
		expect(await connection()).toEqual({
			generation: 1,
			revoked: 0,
			status: "reconnect_required",
		});
		expect(await stubFor().status("owner")).toEqual({
			status: "pending",
			generation: 1,
		});
		const [device] = await objectRows("device");
		expect(JSON.stringify(device)).not.toContain(DEVICE_ID);
		mockStart();
		expect(await operations().connect("owner")).toMatchObject({
			status: "pending",
			generation: 2,
		});
		expect((await connection())?.generation).toBe(2);
	});

	it("keeps polling through pending and slow_down, then installs the tokens", async () => {
		mockStart();
		await operations().connect("owner");
		mockPoll(403, {});
		expect(await runDurableObjectAlarm(stubFor())).toBe(true);
		expect(await objectRows("device")).toHaveLength(1);
		const before = Date.now();
		mockPoll(400, { error: "slow_down" });
		expect(await runDurableObjectAlarm(stubFor())).toBe(true);
		const [slowed] = await objectRows("device");
		expect(slowed.interval_ms).toBe(10_000);
		expect(slowed.next_poll_at as number).toBeGreaterThanOrEqual(
			before + 10_000,
		);
		mockPoll(200, authorized);
		mockExchange(200, tokenResponse);
		expect(await runDurableObjectAlarm(stubFor())).toBe(true);
		expect(await stubFor().status("owner")).toEqual({
			status: "connected",
			generation: 1,
		});
		expect((await connection())?.status).toBe("connected");
		expect(await objectRows("device")).toHaveLength(0);
	});

	it("installs nothing when the product disconnects during a pending sign-in", async () => {
		mockStart();
		await operations().connect("owner");
		// Product revocation commits, but the object has not heard about it yet.
		await env.DB.prepare(
			"UPDATE codex_connections SET generation=2,revoked=1,status='disconnected' WHERE user_id='owner'",
		).run();
		expect(await runDurableObjectAlarm(stubFor())).toBe(true);
		expect(await objectRows("device")).toHaveLength(0);
		expect(await objectRows("credential")).toHaveLength(0);
		expect(await stubFor().status("owner")).toEqual({
			status: "disconnected",
			generation: 0,
		});
		expect(await connection()).toMatchObject({
			revoked: 1,
			status: "disconnected",
		});
	});

	it("drops a pending sign-in when disconnect reaches the object", async () => {
		mockStart();
		await operations().connect("owner");
		await operations().disconnect("owner");
		expect(await objectRows("device")).toHaveLength(0);
		expect(await runDurableObjectAlarm(stubFor())).toBe(false);
		expect((await stubFor().status("owner")).status).toBe("disconnected");
	});

	it("expires a sign-in without tokens", async () => {
		mockStart();
		await operations().connect("owner");
		await runInDurableObject(stubFor(), (_instance, ctx) => {
			ctx.storage.sql.exec("UPDATE device SET expires_at=?", Date.now() - 1);
		});
		expect(await runDurableObjectAlarm(stubFor())).toBe(true);
		expect(await objectRows("device")).toHaveLength(0);
		expect(await objectRows("credential")).toHaveLength(0);
		expect(await connection()).toMatchObject({
			revoked: 0,
			status: "disconnected",
		});
	});

	it("requires reconnecting when the code exchange fails", async () => {
		mockStart();
		await operations().connect("owner");
		mockPoll(200, authorized);
		mockExchange(400, { error: "invalid_grant" });
		expect(await runDurableObjectAlarm(stubFor())).toBe(true);
		expect(await objectRows("device")).toHaveLength(0);
		expect(await objectRows("credential")).toHaveLength(0);
		expect((await connection())?.status).toBe("reconnect_required");
	});

	it("reports a disabled upstream as unavailable", async () => {
		auth()
			.intercept({ path: "/api/accounts/deviceauth/usercode", method: "POST" })
			.reply(404, {});
		const result = await handleCodexConnection({
			authenticatedUserId: "owner",
			body: { action: "connect" },
			operations: operations(),
		});
		expect(result).toEqual({
			status: 503,
			body: { code: "codex_device_auth_unavailable" },
		});
		expect(await objectRows("device")).toHaveLength(0);
	});

	it("keeps tokens and the device id out of storage the product can read", async () => {
		mockStart();
		await operations().connect("owner");
		mockPoll(200, authorized);
		mockExchange(200, tokenResponse);
		await runDurableObjectAlarm(stubFor());
		const [row] = await objectRows("credential");
		expect(row.status).toBe("connected");
		for (const secret of secrets)
			expect(String(row.sealed)).not.toContain(secret);
		const d1 = await env.DB.prepare("SELECT * FROM codex_connections").all();
		for (const secret of secrets)
			expect(JSON.stringify(d1.results)).not.toContain(secret);
	});

	it("renews a near-expiry token through the refresh endpoint once", async () => {
		await env.DB.prepare(
			"INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)",
		).run();
		await stubFor().install("owner", 1, {
			access: "fake-old-access",
			refresh: "fake-old-refresh",
			expiresAt: 0,
		});
		// The fixture replaces renewUpstream, so run the production refresh here.
		await runInDurableObject(stubFor(), (instance) => {
			(instance as unknown as Record<string, unknown>).renewUpstream = (
				CodexCredential.prototype as unknown as Record<string, unknown>
			).renewUpstream;
		});
		auth()
			.intercept({
				path: "/oauth/token",
				method: "POST",
				body: (raw: string) => {
					const form = new URLSearchParams(raw);
					return (
						form.get("grant_type") === "refresh_token" &&
						form.get("refresh_token") === "fake-old-refresh"
					);
				},
			})
			.reply(200, tokenResponse);
		expect(await stubFor().ensureFresh("owner")).toEqual({
			status: "connected",
			generation: 1,
		});
		const [row] = await objectRows("credential");
		expect(String(row.sealed)).not.toContain(ACCESS);
		expect(String(row.sealed)).not.toContain(REFRESH);
	});

	it("keeps the old unverified response when device sign-in is not configured", async () => {
		const result = await handleCodexConnection({
			authenticatedUserId: "owner",
			body: { action: "connect" },
			operations: createCodexConnectionOperations({
				DB: env.DB,
				CodexCredential: env.CodexCredential,
				CODEX_DEVICE_AUTH: "",
			}),
		});
		expect(result).toEqual({
			status: 503,
			body: { code: "codex_hosted_auth_unverified" },
		});
		expect(await connection()).toBeNull();
	});
});
