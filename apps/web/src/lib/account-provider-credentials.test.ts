import { beforeEach, describe, expect, it } from "vitest";
import {
	AUTH_PROCESS_KILL_GRACE_MS,
	AUTH_RESOLUTION_TIMEOUT_MS,
	acquireLease,
	acquireLeaseWithWait,
	assertCredentialConfig,
	createMemoryCredentialDb,
	credentialSecretValues,
	deleteCredentialUnderLease,
	LEASE_ORDERING_OK,
	LEASE_TTL_MS,
	LEASE_WAIT_MS,
	listConnections,
	loadCredential,
	type MemoryCredentialDb,
	markNeedsRelogin,
	projectSafeModels,
	releaseLease,
	type SafeModel,
	toRuntimeCredential,
	updateCredentialUnderLease,
	upsertCredential,
} from "#/lib/account-provider-credentials";
import { decryptText, providerCredentialAad } from "#/lib/crypto";

const KEY_A = "ai-credentials-encryption-key-aaaaaaaa";
const AUTH = "better-auth-secret-distinct-from-ai-key";
const OPENCODE = "sk-opencode-operator-key-00000001";

const model: SafeModel = {
	providerId: "anthropic",
	modelId: "claude-sonnet",
	name: "Claude Sonnet",
};

describe("account-provider-credentials", () => {
	let db: MemoryCredentialDb;
	let ids: number;

	beforeEach(() => {
		db = createMemoryCredentialDb(1_000_000);
		ids = 0;
	});

	const createId = () => `id-${++ids}`;
	const now = () => db.clock;

	it("enforces lease timing constants", () => {
		expect(LEASE_ORDERING_OK).toBe(true);
		expect(
			AUTH_RESOLUTION_TIMEOUT_MS + AUTH_PROCESS_KILL_GRACE_MS,
		).toBeLessThan(LEASE_TTL_MS);
		expect(LEASE_WAIT_MS).toBeGreaterThan(0);
	});

	it("rejects empty/equal secrets", () => {
		expect(() =>
			assertCredentialConfig({
				AI_CREDENTIALS_ENCRYPTION_KEY: "",
				BETTER_AUTH_SECRET: AUTH,
				OPENCODE_API_KEY: OPENCODE,
			}),
		).toThrow(/AI_CREDENTIALS_ENCRYPTION_KEY/);
		expect(() =>
			assertCredentialConfig({
				AI_CREDENTIALS_ENCRYPTION_KEY: AUTH,
				BETTER_AUTH_SECRET: AUTH,
				OPENCODE_API_KEY: OPENCODE,
			}),
		).toThrow(/differ/);
		expect(() =>
			assertCredentialConfig({
				AI_CREDENTIALS_ENCRYPTION_KEY: KEY_A,
				BETTER_AUTH_SECRET: AUTH,
				OPENCODE_API_KEY: "",
			}),
		).toThrow(/OPENCODE_API_KEY/);
	});

	it("isolates accounts via real load/list/upsert", async () => {
		expect(
			await upsertCredential({
				db,
				userId: "user-a",
				providerId: "anthropic",
				authType: "api_key",
				credential: { type: "api_key", key: "sk-user-a-secret-key-value" },
				models: [model],
				encryptionKey: KEY_A,
				nowMs: now(),
				createId,
			}),
		).toBe("ok");
		expect(
			await upsertCredential({
				db,
				userId: "user-b",
				providerId: "anthropic",
				authType: "api_key",
				credential: { type: "api_key", key: "sk-user-b-secret-key-value" },
				models: [model],
				encryptionKey: KEY_A,
				nowMs: now(),
				createId,
			}),
		).toBe("ok");

		const a = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});
		const b = await loadCredential({
			db,
			userId: "user-b",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});
		expect(a?.credential).toEqual({
			type: "api_key",
			key: "sk-user-a-secret-key-value",
		});
		expect(b?.credential).toEqual({
			type: "api_key",
			key: "sk-user-b-secret-key-value",
		});
		expect(
			await loadCredential({
				db,
				userId: "user-a",
				providerId: "openai",
				encryptionKey: KEY_A,
			}),
		).toBeNull();

		const listed = await listConnections(db, "user-a");
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain("sk-user-a");
	});

	it("wrong AAD cannot decrypt", async () => {
		await upsertCredential({
			db,
			userId: "user:with:colons",
			providerId: "prov:ider",
			authType: "api_key",
			credential: { type: "api_key", key: "sk-delimiter-test-key-xxx" },
			models: [{ providerId: "prov:ider", modelId: "m1", name: "M1" }],
			encryptionKey: KEY_A,
			nowMs: now(),
			createId,
		});
		const row = db.rows.get("user:with:colons\0prov:ider")!;
		await expect(
			decryptText(row.encryptedCredential, KEY_A, {
				additionalData: providerCredentialAad("other", "prov:ider"),
			}),
		).rejects.toThrow(/Failed to decrypt/);
	});

	it("concurrent acquisition: only one succeeds; expired takeover works", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-token-aaa",
				access: "access-token-aaa",
				expires: now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
			nowMs: now(),
			createId,
		});
		const first = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: now(),
			createId,
		});
		expect(first).not.toBeNull();
		expect(
			await acquireLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				nowMs: now(),
				createId,
			}),
		).toBeNull();
		db.clock += LEASE_TTL_MS + 1;
		expect(
			await acquireLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				nowMs: now(),
				createId,
			}),
		).not.toBeNull();
	});

	it("bounded lease wait retries until free", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "r",
				access: "a",
				expires: now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
			nowMs: now(),
			createId,
		});
		const held = await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: now(),
			createId: () => "holder",
		});
		expect(held).not.toBeNull();

		// Release after first poll via tick.
		let polls = 0;
		const waited = acquireLeaseWithWait({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: now(),
			createId: () => "waiter",
			waitMs: 500,
			pollMs: 100,
			sleep: async () => {
				polls += 1;
				if (polls === 1) {
					await releaseLease({
						db,
						userId: "user-a",
						providerId: "anthropic",
						leaseId: "holder",
						nowMs: now(),
					});
				}
			},
		});
		await expect(waited).resolves.toMatchObject({ leaseId: "waiter" });
	});

	it("stale update rejected; disconnect cannot be recreated by refresh", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-old",
				access: "access-old",
				expires: now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
			nowMs: now(),
			createId,
		});
		const lease = (await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: now(),
			createId,
		}))!;
		const loaded = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});

		expect(
			await updateCredentialUnderLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				leaseId: "wrong-lease",
				expectedVersion: loaded!.version,
				credential: {
					type: "oauth",
					refresh: "refresh-stale",
					access: "access-stale",
					expires: now() + 3_600_000,
				},
				encryptionKey: KEY_A,
				nowMs: now(),
			}),
		).toBe("stale");

		expect(
			await updateCredentialUnderLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
				expectedVersion: loaded!.version,
				credential: {
					type: "oauth",
					refresh: "refresh-new",
					access: "access-new",
					expires: now() + 3_600_000,
				},
				encryptionKey: KEY_A,
				nowMs: now(),
			}),
		).toBe("ok");

		expect(
			await deleteCredentialUnderLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
			}),
		).toBe(true);

		expect(
			await updateCredentialUnderLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
				expectedVersion: loaded!.version + 1,
				credential: {
					type: "oauth",
					refresh: "refresh-ghost",
					access: "access-ghost",
					expires: now() + 3_600_000,
				},
				encryptionKey: KEY_A,
				nowMs: now(),
			}),
		).toBe("missing");
	});

	it("reconnect defeats stale refresh success and stale failure", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-v1",
				access: "access-v1",
				expires: now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
			nowMs: now(),
			createId,
		});
		const lease = (await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: now(),
			createId: () => "stale-lease",
		}))!;
		const before = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});

		// Reconnect takes the lease path and replaces credential.
		expect(
			await upsertCredential({
				db,
				userId: "user-a",
				providerId: "anthropic",
				authType: "oauth",
				credential: {
					type: "oauth",
					refresh: "refresh-reconnect",
					access: "access-reconnect",
					expires: now() + 3_600_000,
				},
				models: [model],
				encryptionKey: KEY_A,
				nowMs: now(),
				createId,
				waitForLease: false,
			}),
		).toBe("busy"); // stale holder still has lease

		await releaseLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			leaseId: lease.leaseId,
			nowMs: now(),
		});

		expect(
			await upsertCredential({
				db,
				userId: "user-a",
				providerId: "anthropic",
				authType: "oauth",
				credential: {
					type: "oauth",
					refresh: "refresh-reconnect",
					access: "access-reconnect",
					expires: now() + 3_600_000,
				},
				models: [model],
				encryptionKey: KEY_A,
				nowMs: now(),
				createId,
			}),
		).toBe("ok");

		expect(
			await updateCredentialUnderLease({
				db,
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
				expectedVersion: before!.version,
				credential: {
					type: "oauth",
					refresh: "refresh-stale",
					access: "access-stale",
					expires: now() + 3_600_000,
				},
				encryptionKey: KEY_A,
				nowMs: now(),
			}),
		).toBe("stale");

		expect(
			await markNeedsRelogin({
				db,
				userId: "user-a",
				providerId: "anthropic",
				errorCode: "oauth_refresh_failed",
				leaseId: lease.leaseId,
				expectedVersion: before!.version,
				nowMs: now(),
			}),
		).toBe("stale");

		const final = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});
		expect(final?.status).toBe("connected");
		expect(final?.credential).toMatchObject({ refresh: "refresh-reconnect" });
	});

	it("needs_relogin conditional on lease+version keeps ciphertext", async () => {
		await upsertCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-keep",
				access: "access-keep",
				expires: now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
			nowMs: now(),
			createId,
		});
		const lease = (await acquireLease({
			db,
			userId: "user-a",
			providerId: "anthropic",
			nowMs: now(),
			createId,
		}))!;
		const loaded = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});
		expect(
			await markNeedsRelogin({
				db,
				userId: "user-a",
				providerId: "anthropic",
				errorCode: "oauth_refresh_failed",
				leaseId: lease.leaseId,
				expectedVersion: loaded!.version,
				nowMs: now(),
			}),
		).toBe("ok");
		const listed = await listConnections(db, "user-a");
		expect(listed[0]).toMatchObject({
			status: "needs_relogin",
			lastErrorCode: "oauth_refresh_failed",
			models: [],
		});
		const again = await loadCredential({
			db,
			userId: "user-a",
			providerId: "anthropic",
			encryptionKey: KEY_A,
		});
		expect(again?.credential).toMatchObject({ refresh: "refresh-keep" });
	});

	it("credentialSecretValues and runtime projection strip unknowns", () => {
		const secrets = credentialSecretValues({
			type: "oauth",
			refresh: "r-secret",
			access: "a-secret",
			expires: 123,
			accountId: "acct",
			unknownFuture: "u-secret",
		});
		expect(secrets).toEqual(
			expect.arrayContaining(["r-secret", "a-secret", "acct", "u-secret"]),
		);
		expect(secrets).not.toContain("oauth");

		const runtime = toRuntimeCredential(
			{
				type: "oauth",
				refresh: "r-secret",
				access: "a-secret",
				expires: Date.now() + 3_600_000,
				accountId: "acct-1",
				unknownFuture: "nope",
			},
			"openai-codex",
		);
		expect(runtime).toEqual({
			type: "oauth",
			refresh: "ditto:no-refresh",
			access: "a-secret",
			expires: expect.any(Number),
			accountId: "acct-1",
		});
		expect(runtime).not.toHaveProperty("unknownFuture");

		const api = toRuntimeCredential(
			{
				type: "api_key",
				key: "sk-abc",
				env: {
					ANTHROPIC_API_KEY: "sk-env",
					EVIL_OTHER: "nope",
				},
			},
			"anthropic",
		);
		expect(api).toEqual({
			type: "api_key",
			key: "sk-abc",
			env: { ANTHROPIC_API_KEY: "sk-env" },
		});
	});

	it("rejects unsafe model catalogs", () => {
		expect(() =>
			projectSafeModels(
				[
					{
						providerId: "anthropic",
						modelId: "x",
						name: "X",
						baseURL: "https://evil.example",
					},
				],
				"anthropic",
			),
		).toThrow();
	});

	it("migration cascades and has no project ownership columns", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const sqlPath = path.resolve(
			import.meta.dirname,
			"../../migrations/0010_worthless_george_stacy.sql",
		);
		const sql = fs.readFileSync(sqlPath, "utf8");
		expect(sql).toContain("ai_provider_credentials");
		expect(sql).toContain("provider_auth_attempts");
		expect(sql).toMatch(/ON DELETE cascade/i);
		expect(sql).not.toContain("projectId");
		const credTable = sql.slice(
			sql.indexOf("CREATE TABLE `ai_provider_credentials`"),
			sql.indexOf("CREATE TABLE `provider_auth_attempts`"),
		);
		expect(credTable).not.toContain("sandboxId");
	});
});
