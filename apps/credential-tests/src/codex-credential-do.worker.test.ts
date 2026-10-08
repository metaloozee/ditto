import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import migration from "../../web/migrations/0021_first_lilandra.sql?raw";
import { createCodexConnectionOperations } from "../../web/src/lib/codex-connection-product";
import {
	openCredentials,
	sealCredentials,
} from "../../web/src/lib/codex-credential-crypto";
import { CodexCredential } from "../../web/src/lib/codex-credential-do";
import { FixtureCredential } from "./entry";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		DB: D1Database;
		CodexCredential: DurableObjectNamespace<FixtureCredential>;
		CODEX_CREDENTIAL_CURRENT_KEY_VERSION: string;
		CODEX_CREDENTIAL_KEYS: string;
	}
}
const tokens = {
	access: "fixture-access-one",
	refresh: "fixture-refresh-one",
	identity: "fixture-identity-one",
	expiresAt: 0,
};
const rotated = {
	access: "fixture-access-two",
	refresh: "fixture-refresh-two",
	identity: "fixture-identity-two",
	expiresAt: 4102444800000,
};
const ring = { current: "fixture-v1", keys: { "fixture-v1": "01".repeat(32) } };
async function connect(owner = "owner", generation = 1) {
	await env.DB.prepare("INSERT OR IGNORE INTO user(id) VALUES(?)")
		.bind(owner)
		.run();
	await env.DB.prepare(
		"INSERT INTO codex_connections VALUES(?,?,0,'connected',0,0) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,revoked=0,status='connected',projection_version=0",
	)
		.bind(owner, generation)
		.run();
	const stub = env.CodexCredential.getByName(owner);
	expect(await stub.install(owner, generation, tokens)).toEqual({
		status: "connected",
		generation,
	});
	return stub;
}
function rotationResponse() {
	fetchMock
		.get("https://credential-fixture.invalid")
		.intercept({
			path: "/rotate",
			method: "POST",
			body: JSON.stringify({ refresh: tokens.refresh }),
		})
		.reply(200, rotated);
}
async function stored(stub: DurableObjectStub<FixtureCredential>) {
	return runInDurableObject(stub, (_instance, ctx) =>
		ctx.storage.sql
			.exec<{
				generation: number;
				version: number;
				renewal: number;
				status: string;
				sealed: string | null;
			}>("SELECT generation,version,renewal,status,sealed FROM credential")
			.one(),
	);
}
async function projection() {
	return env.DB.prepare(
		"SELECT * FROM codex_connections WHERE user_id='owner'",
	).first();
}

beforeEach(async () => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
	await env.DB.exec("CREATE TABLE user(id TEXT PRIMARY KEY)");
	await env.DB.exec(migration.replaceAll("\n", " "));
});
afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
	fetchMock.deactivate();
});

describe("product-only credential SQLite", () => {
	it("rejects an older valid envelope substituted alone after rotation before a second dispatch", async () => {
		const stub = await connect();
		const previous = await stored(stub);
		rotationResponse();
		expect((await stub.ensureFresh("owner")).status).toBe("connected");
		const current = await stored(stub);
		expect(current.version).toBe(3);
		await runInDurableObject(stub, (_instance, ctx) => {
			ctx.storage.sql.exec("UPDATE credential SET sealed=?", previous.sealed);
		});
		expect(await stored(stub)).toEqual({ ...current, sealed: previous.sealed });
		expect((await stub.ensureFresh("owner")).status).toBe("reconnect_required");
		expect((await stored(stub)).sealed).toBeNull();
		expect(
			await runInDurableObject(stub, (instance) => instance.dispatched),
		).toBe(1);
		expect(await projection()).toMatchObject({
			status: "reconnect_required",
			projection_version: 4,
		});
	});
	it("roundtrips bounded escaped and maximum plain token sets in real SQLite", async () => {
		for (const [owner, value] of [
			["escaped", '\\"\u0000'.repeat(500)],
			["plain", "a".repeat(8192)],
		]) {
			const stub = await connect(owner);
			const accepted = {
				access: value,
				refresh: value,
				identity: value,
				expiresAt: 0,
			};
			await env.DB.prepare(
				"UPDATE codex_connections SET generation=2 WHERE user_id=?",
			)
				.bind(owner)
				.run();
			expect((await stub.install(owner, 2, accepted)).status).toBe("connected");
			const row = await stored(stub);
			expect(row.sealed?.length).toBeLessThanOrEqual(60000);
			expect(
				await openCredentials(row.sealed ?? "", owner, 2, ring, row.version),
			).toEqual(accepted);
		}
	});
	it("denies JSON-expanded total envelopes before an installation writes SQLite or D1 status", async () => {
		const stub = await connect();
		for (const value of ["\\".repeat(8192), "\u0000".repeat(8192)]) {
			const before = await stored(stub);
			await env.DB.prepare(
				"UPDATE codex_connections SET generation=2,projection_version=0",
			).run();
			const productBefore = await projection();
			const oversized = {
				access: value,
				refresh: value,
				identity: value,
				expiresAt: 0,
			};
			const denial = await runInDurableObject(stub, async (instance) => {
				try {
					await instance.install("owner", 2, oversized);
					return "unexpected_install";
				} catch (error) {
					return error instanceof Error ? error.message : "unexpected_error";
				}
			});
			expect(denial).toBe("credential_integrity");
			expect(await stored(stub)).toEqual(before);
			expect(await projection()).toEqual(productBefore);
			await env.DB.prepare("UPDATE codex_connections SET generation=1").run();
		}
	});
	it("clears spent credentials on an oversized upstream replacement and never redispatches", async () => {
		const stub = await connect();
		const value = "\u0000".repeat(8192);
		fetchMock
			.get("https://credential-fixture.invalid")
			.intercept({ path: "/rotate", method: "POST" })
			.reply(200, {
				access: value,
				refresh: value,
				identity: value,
				expiresAt: 0,
			});
		for (let i = 0; i < 2; i++)
			expect((await stub.ensureFresh("owner")).status).toBe(
				"reconnect_required",
			);
		expect((await stored(stub)).sealed).toBeNull();
		expect(
			await runInDurableObject(stub, (instance) => instance.dispatched),
		).toBe(1);
		expect(await projection()).toMatchObject({
			status: "reconnect_required",
			projection_version: 3,
		});
	});
	it("checks the complete envelope bound including key-version serialization", async () => {
		const current = "\u0000".repeat(10000);
		await expect(
			sealCredentials(tokens, "owner", 1, {
				current,
				keys: { [current]: "01".repeat(32) },
			}),
		).rejects.toThrow("credential_integrity");
	});
	it("stores only encrypted tokens and returns bounded non-secret status", async () => {
		const stub = await connect();
		const row = await stored(stub);
		for (const token of [tokens.access, tokens.refresh, tokens.identity])
			expect(JSON.stringify(row)).not.toContain(token);
		expect(await openCredentials(row.sealed ?? "", "owner", 1, ring)).toEqual(
			tokens,
		);
		expect(Object.keys((await projection()) ?? {}).sort()).toEqual([
			"generation",
			"projection_version",
			"revoked",
			"status",
			"updated_at",
			"user_id",
		]);
		expect(await stub.status("foreign")).toEqual({
			status: "disconnected",
			generation: 0,
		});
		expect(await stub.ensureFresh("foreign")).toEqual({
			status: "disconnected",
			generation: 0,
		});
		expect(await stored(stub)).toEqual(row);
	});
	it("denies foreign identity installation and stale explicit connection generations", async () => {
		const stub = await connect();
		const row = await stored(stub);
		expect((await stub.install("foreign", 2, rotated)).status).toBe(
			"disconnected",
		);
		expect((await stub.install("owner", 1, rotated)).status).toBe(
			"disconnected",
		);
		expect(await stored(stub)).toEqual(row);
	});
	it("serializes two workspace requests through a durable dispatch intent and atomically replaces the token set", async () => {
		const stub = await connect();
		rotationResponse();
		await stub.holdRotation();
		const firstWorkspace = stub.ensureFresh("owner").then((value) => value);
		await stub.waitForRotation();
		expect(await stub.ensureFresh("owner")).toEqual({
			status: "renewing",
			generation: 1,
		});
		expect((await stored(stub)).renewal).toBe(1);
		await stub.release();
		expect(await firstWorkspace).toEqual({
			status: "connected",
			generation: 1,
		});
		const row = await stored(stub);
		expect(
			await openCredentials(row.sealed ?? "", "owner", 1, ring, row.version),
		).toEqual(rotated);
		expect(row.version).toBe(3);
		expect(await stub.ensureFresh("owner")).toEqual({
			status: "connected",
			generation: 1,
		});
		expect(
			await runInDurableObject(stub, (instance) => instance.dispatched),
		).toBe(1);
	});
	it("never retries an ambiguous upstream failure and sanitizes the error", async () => {
		const stub = await connect();
		fetchMock
			.get("https://credential-fixture.invalid")
			.intercept({ path: "/rotate", method: "POST" })
			.reply(500, { error: tokens.refresh });
		expect(await stub.ensureFresh("owner")).toEqual({
			status: "reconnect_required",
			generation: 1,
		});
		expect(await stub.ensureFresh("owner")).toEqual({
			status: "reconnect_required",
			generation: 1,
		});
		expect((await stored(stub)).sealed).toBeNull();
		expect(
			await runInDurableObject(stub, (instance) => instance.dispatched),
		).toBe(1);
	});
	it("fails closed after upstream rotation before replacement, including two SQLite reopens", async () => {
		const stub = await connect();
		rotationResponse();
		await runInDurableObject(stub, (instance) => {
			instance.crashAfterRotation = true;
		});
		expect((await stub.ensureFresh("owner")).status).toBe("reconnect_required");
		for (let i = 0; i < 2; i++) {
			expect(
				await runInDurableObject(stub, async (_instance, ctx) =>
					new FixtureCredential(ctx, env).ensureFresh("owner"),
				),
			).toEqual({ status: "reconnect_required", generation: 1 });
		}
		expect((await stored(stub)).sealed).toBeNull();
	});
	it("recovers a retained renewal intent without blindly spending the refresh token again", async () => {
		const stub = await connect();
		await runInDurableObject(stub, (_instance, ctx) => {
			ctx.storage.sql.exec(
				"UPDATE credential SET status='renewing',renewal=1,version=2",
			);
		});
		for (let i = 0; i < 2; i++)
			expect(
				(
					await runInDurableObject(stub, (_instance, ctx) =>
						new FixtureCredential(ctx, env).ensureFresh("owner"),
					)
				).status,
			).toBe("reconnect_required");
		expect((await stored(stub)).sealed).toBeNull();
	});
	it("historical product keys decrypt and renewal writes only with the new key", async () => {
		const stub = await connect();
		rotationResponse();
		const rotatedEnv = {
			...env,
			CODEX_CREDENTIAL_CURRENT_KEY_VERSION: "fixture-v2",
			CODEX_CREDENTIAL_KEYS: JSON.stringify({
				...ring.keys,
				"fixture-v2": "02".repeat(32),
			}),
		};
		expect(
			(
				await runInDurableObject(stub, (_instance, ctx) =>
					new FixtureCredential(ctx, rotatedEnv).ensureFresh("owner"),
				)
			).status,
		).toBe("connected");
		const row = await stored(stub);
		expect(JSON.parse(row.sealed ?? "").key).toBe("fixture-v2");
		expect(
			await openCredentials(
				row.sealed ?? "",
				"owner",
				1,
				{
					current: "fixture-v2",
					keys: { ...ring.keys, "fixture-v2": "02".repeat(32) },
				},
				row.version,
			),
		).toEqual(rotated);
	});
	it("tampered SQLite ciphertext denies dispatch without exposing token contents", async () => {
		const stub = await connect();
		await runInDurableObject(stub, (_instance, ctx) => {
			ctx.storage.sql.exec("UPDATE credential SET sealed='tampered'");
		});
		expect(await stub.ensureFresh("owner")).toEqual({
			status: "reconnect_required",
			generation: 1,
		});
		expect((await stored(stub)).sealed).toBeNull();
		expect(
			await runInDurableObject(stub, (instance) => instance.dispatched),
		).toBe(0);
	});
	it("owned disconnect preserves the D1 fence if delivery to the DO fails", async () => {
		const stub = await connect();
		const operations = createCodexConnectionOperations({
			DB: env.DB,
			CodexCredential: {
				getByName: () => ({
					status: async () => ({ status: "unavailable", generation: 1 }),
					revoke: async () => {
						throw new Error("fixture_handoff_failure");
					},
				}),
			},
		});
		await expect(operations.disconnect("owner")).rejects.toThrow(
			"fixture_handoff_failure",
		);
		expect(await projection()).toMatchObject({
			generation: 2,
			revoked: 1,
			status: "disconnected",
		});
		expect((await stub.ensureFresh("owner")).status).toBe("disconnected");
		expect((await stored(stub)).renewal).toBe(0);
	});
	it("product fence denies renewal even when DO revoke delivery failed", async () => {
		const stub = await connect();
		await env.DB.prepare(
			"UPDATE codex_connections SET revoked=1,generation=2,status='disconnected'",
		).run();
		expect((await stub.ensureFresh("owner")).status).toBe("disconnected");
		expect((await stored(stub)).renewal).toBe(0);
	});
	it("revocation retains a DO tombstone even before initial credential installation", async () => {
		await env.DB.exec(
			"INSERT INTO user VALUES('owner'); INSERT INTO codex_connections VALUES('owner',2,0,'connected',0,0)",
		);
		const stub = env.CodexCredential.getByName("owner");
		await stub.revoke("owner", 2);
		expect(await stub.install("owner", 2, tokens)).toEqual({
			status: "disconnected",
			generation: 0,
		});
		expect(await stored(stub)).toMatchObject({
			status: "disconnected",
			generation: 2,
			sealed: null,
		});
		expect((await stub.ensureFresh("owner")).status).toBe("disconnected");
	});
	it("DO fence denies renewal even if the product projection still grants the old connection", async () => {
		const stub = await connect();
		await stub.revoke("owner", 2);
		expect((await stub.ensureFresh("owner")).status).toBe("disconnected");
		expect((await stored(stub)).sealed).toBeNull();
	});
	it("disconnect commits product fence first and a late refresh cannot revive it", async () => {
		const stub = await connect();
		rotationResponse();
		await stub.holdRotation();
		const pending = stub.ensureFresh("owner").then((value) => value);
		await stub.waitForRotation();
		await createCodexConnectionOperations(env).disconnect("owner");
		await stub.release();
		expect((await pending).status).toBe("disconnected");
		expect((await stored(stub)).sealed).toBeNull();
		expect(await projection()).toMatchObject({
			revoked: 1,
			generation: 2,
			status: "disconnected",
		});
	});
	it("a stale refresh cannot overwrite explicit reconnect", async () => {
		const stub = await connect();
		rotationResponse();
		await stub.holdRotation();
		const pending = stub.ensureFresh("owner").then((value) => value);
		await stub.waitForRotation();
		await connect("owner", 2);
		await stub.release();
		await pending;
		const row = await stored(stub);
		expect(row.generation).toBe(2);
		expect(await openCredentials(row.sealed ?? "", "owner", 2, ring)).toEqual(
			tokens,
		);
		expect(await projection()).toMatchObject({
			generation: 2,
			status: "connected",
			revoked: 0,
		});
	});
	it("a late refresh does not recreate a deleted projection or user", async () => {
		const stub = await connect();
		rotationResponse();
		await stub.holdRotation();
		const pending = stub.ensureFresh("owner").then((value) => value);
		await stub.waitForRotation();
		await env.DB.prepare("DELETE FROM user WHERE id='owner'").run();
		await stub.release();
		expect((await pending).status).toBe("disconnected");
		expect(await projection()).toBeNull();
		expect((await stub.ensureFresh("owner")).status).toBe("disconnected");
	});
	it("production class never attaches credentials to a live renewal request", async () => {
		const stub = await connect();
		expect(
			await runInDurableObject(stub, (_instance, ctx) =>
				new CodexCredential(ctx, env).ensureFresh("owner"),
			),
		).toEqual({ status: "unavailable", generation: 1 });
		expect((await stored(stub)).renewal).toBe(0);
	});
	it("real SQLite rollback retains the original encrypted record", async () => {
		const stub = await connect();
		const before = await stored(stub);
		await runInDurableObject(stub, (_instance, ctx) => {
			try {
				ctx.storage.transactionSync(() => {
					ctx.storage.sql.exec("UPDATE credential SET sealed=NULL,renewal=100");
					throw new Error("fixture_rollback");
				});
			} catch {}
		});
		expect(await stored(stub)).toEqual(before);
	});
});
