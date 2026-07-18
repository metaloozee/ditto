import { beforeEach, describe, expect, it } from "vitest";
import {
	assertCredentialConfig,
	AUTH_PROCESS_KILL_GRACE_MS,
	AUTH_RESOLUTION_TIMEOUT_MS,
	credentialSecretValues,
	LEASE_ORDERING_OK,
	LEASE_TTL_MS,
	parseSafeModelCatalog,
	projectSafeModels,
	type SafeModel,
	type StoredCredential,
	toRuntimeCredential,
} from "#/lib/account-provider-credentials";
import {
	decryptText,
	encryptText,
	providerCredentialAad,
} from "#/lib/crypto";

type Row = {
	id: string;
	userId: string;
	providerId: string;
	authType: "api_key" | "oauth";
	encryptedCredential: string;
	modelCatalog: string;
	status: "connected" | "needs_relogin";
	lastErrorCode: string | null;
	version: number;
	leaseId: string | null;
	leaseExpiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

/**
 * In-memory vault mirroring account-provider-credentials contracts for
 * ownership, AAD encryption, lease serialization, and update-only refresh.
 */
class MemoryVault {
	rows = new Map<string, Row>();
	clock = 1_000_000;
	now = () => this.clock;
	advance = (ms: number) => {
		this.clock += ms;
	};
	key = (userId: string, providerId: string) => `${userId}::${providerId}`;

	async upsert(input: {
		userId: string;
		providerId: string;
		authType: "api_key" | "oauth";
		credential: StoredCredential;
		models: SafeModel[];
		encryptionKey: string;
	}) {
		const models = projectSafeModels(input.models, input.providerId);
		const encrypted = await encryptText(
			JSON.stringify(input.credential),
			input.encryptionKey,
			{
				additionalData: providerCredentialAad(input.userId, input.providerId),
			},
		);
		const k = this.key(input.userId, input.providerId);
		const existing = this.rows.get(k);
		if (existing) {
			this.rows.set(k, {
				...existing,
				authType: input.authType,
				encryptedCredential: encrypted,
				modelCatalog: JSON.stringify(models),
				status: "connected",
				lastErrorCode: null,
				version: existing.version + 1,
				leaseId: null,
				leaseExpiresAt: null,
				updatedAt: new Date(this.now()),
			});
			return;
		}
		this.rows.set(k, {
			id: `id-${this.rows.size + 1}`,
			userId: input.userId,
			providerId: input.providerId,
			authType: input.authType,
			encryptedCredential: encrypted,
			modelCatalog: JSON.stringify(models),
			status: "connected",
			lastErrorCode: null,
			version: 1,
			leaseId: null,
			leaseExpiresAt: null,
			createdAt: new Date(this.now()),
			updatedAt: new Date(this.now()),
		});
	}

	async load(userId: string, providerId: string, encryptionKey: string) {
		const row = this.rows.get(this.key(userId, providerId));
		if (!row || row.userId !== userId) return null;
		const plaintext = await decryptText(
			row.encryptedCredential,
			encryptionKey,
			{ additionalData: providerCredentialAad(userId, providerId) },
		);
		return {
			id: row.id,
			authType: row.authType,
			status: row.status,
			version: row.version,
			credential: JSON.parse(plaintext) as StoredCredential,
			models: parseSafeModelCatalog(row.modelCatalog),
			lastErrorCode: row.lastErrorCode,
		};
	}

	list(userId: string) {
		return [...this.rows.values()]
			.filter((r) => r.userId === userId)
			.map((r) => ({
				providerId: r.providerId,
				authType: r.authType,
				status: r.status,
				lastErrorCode: r.lastErrorCode,
				models:
					r.status === "connected" ? parseSafeModelCatalog(r.modelCatalog) : [],
			}));
	}

	acquire(userId: string, providerId: string) {
		const row = this.rows.get(this.key(userId, providerId));
		if (!row) return null;
		const held =
			row.leaseId &&
			row.leaseExpiresAt &&
			row.leaseExpiresAt.getTime() > this.now();
		if (held) return null;
		const leaseId = `lease-${Math.random().toString(16).slice(2)}`;
		row.leaseId = leaseId;
		row.leaseExpiresAt = new Date(this.now() + LEASE_TTL_MS);
		return { leaseId, version: row.version };
	}

	async updateUnderLease(input: {
		userId: string;
		providerId: string;
		leaseId: string;
		expectedVersion: number;
		credential: StoredCredential;
		encryptionKey: string;
	}) {
		const row = this.rows.get(this.key(input.userId, input.providerId));
		if (!row) return "missing" as const;
		if (
			row.leaseId !== input.leaseId ||
			row.version !== input.expectedVersion ||
			!row.leaseExpiresAt ||
			row.leaseExpiresAt.getTime() <= this.now()
		) {
			return "stale" as const;
		}
		row.encryptedCredential = await encryptText(
			JSON.stringify(input.credential),
			input.encryptionKey,
			{
				additionalData: providerCredentialAad(input.userId, input.providerId),
			},
		);
		row.status = "connected";
		row.lastErrorCode = null;
		row.version += 1;
		row.updatedAt = new Date(this.now());
		return "ok" as const;
	}

	markNeeds(userId: string, providerId: string, code: string) {
		const row = this.rows.get(this.key(userId, providerId));
		if (!row) return;
		row.status = "needs_relogin";
		row.lastErrorCode = code;
		row.leaseId = null;
		row.leaseExpiresAt = null;
	}

	deleteUnder(userId: string, providerId: string, leaseId: string) {
		const k = this.key(userId, providerId);
		const row = this.rows.get(k);
		if (!row || row.leaseId !== leaseId) return false;
		this.rows.delete(k);
		return true;
	}
}

const KEY_A = "ai-credentials-encryption-key-aaaaaaaa";
const AUTH = "better-auth-secret-distinct-from-ai-key";
const OPENCODE = "sk-opencode-operator-key-00000001";

const model: SafeModel = {
	providerId: "anthropic",
	modelId: "claude-sonnet",
	name: "Claude Sonnet",
};

describe("account-provider-credentials", () => {
	let vault: MemoryVault;

	beforeEach(() => {
		vault = new MemoryVault();
	});

	it("enforces lease timing constants", () => {
		expect(LEASE_ORDERING_OK).toBe(true);
		expect(
			AUTH_RESOLUTION_TIMEOUT_MS + AUTH_PROCESS_KILL_GRACE_MS,
		).toBeLessThan(LEASE_TTL_MS);
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

	it("isolates accounts and loads without project/sandbox ids", async () => {
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "api_key",
			credential: { type: "api_key", key: "sk-user-a-secret-key-value" },
			models: [model],
			encryptionKey: KEY_A,
		});
		await vault.upsert({
			userId: "user-b",
			providerId: "anthropic",
			authType: "api_key",
			credential: { type: "api_key", key: "sk-user-b-secret-key-value" },
			models: [model],
			encryptionKey: KEY_A,
		});

		const a = await vault.load("user-a", "anthropic", KEY_A);
		const b = await vault.load("user-b", "anthropic", KEY_A);
		expect(a?.credential).toEqual({
			type: "api_key",
			key: "sk-user-a-secret-key-value",
		});
		expect(b?.credential).toEqual({
			type: "api_key",
			key: "sk-user-b-secret-key-value",
		});
		expect(await vault.load("user-a", "openai", KEY_A)).toBeNull();

		const listed = vault.list("user-a");
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain("sk-user-a");
		expect(listed[0]?.models[0]?.modelId).toBe("claude-sonnet");
	});

	it("wrong AAD cannot decrypt another account ciphertext", async () => {
		await vault.upsert({
			userId: "user:with:colons",
			providerId: "prov:ider",
			authType: "api_key",
			credential: { type: "api_key", key: "sk-delimiter-test-key-xxx" },
			models: [{ providerId: "prov:ider", modelId: "m1", name: "M1" }],
			encryptionKey: KEY_A,
		});
		const row = vault.rows.get(vault.key("user:with:colons", "prov:ider"))!;
		await expect(
			decryptText(row.encryptedCredential, KEY_A, {
				additionalData: providerCredentialAad("other", "prov:ider"),
			}),
		).rejects.toThrow(/Failed to decrypt/);
	});

	it("replaces on upsert rather than duplicating", async () => {
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "api_key",
			credential: { type: "api_key", key: "sk-old-key-value-xxxxxx" },
			models: [model],
			encryptionKey: KEY_A,
		});
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "api_key",
			credential: { type: "api_key", key: "sk-new-key-value-yyyyyy" },
			models: [model],
			encryptionKey: KEY_A,
		});
		expect(vault.list("user-a")).toHaveLength(1);
		const loaded = await vault.load("user-a", "anthropic", KEY_A);
		expect(loaded?.credential).toEqual({
			type: "api_key",
			key: "sk-new-key-value-yyyyyy",
		});
		expect(loaded?.version).toBe(2);
	});

	it("only one concurrent lease succeeds; expired lease recovers", async () => {
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-token-aaa",
				access: "access-token-aaa",
				expires: vault.now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
		});
		const first = vault.acquire("user-a", "anthropic");
		expect(first).not.toBeNull();
		expect(vault.acquire("user-a", "anthropic")).toBeNull();
		vault.advance(LEASE_TTL_MS + 1);
		expect(vault.acquire("user-a", "anthropic")).not.toBeNull();
	});

	it("stale lease/version cannot overwrite; delete cannot be recreated", async () => {
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-old",
				access: "access-old",
				expires: vault.now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
		});
		const lease = vault.acquire("user-a", "anthropic")!;
		const loaded = await vault.load("user-a", "anthropic", KEY_A);

		expect(
			await vault.updateUnderLease({
				userId: "user-a",
				providerId: "anthropic",
				leaseId: "wrong-lease",
				expectedVersion: loaded!.version,
				credential: {
					type: "oauth",
					refresh: "refresh-stale",
					access: "access-stale",
					expires: vault.now() + 3_600_000,
				},
				encryptionKey: KEY_A,
			}),
		).toBe("stale");

		expect(
			await vault.updateUnderLease({
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
				expectedVersion: loaded!.version,
				credential: {
					type: "oauth",
					refresh: "refresh-new",
					access: "access-new",
					expires: vault.now() + 3_600_000,
				},
				encryptionKey: KEY_A,
			}),
		).toBe("ok");

		expect(vault.deleteUnder("user-a", "anthropic", lease.leaseId)).toBe(true);
		expect(
			await vault.updateUnderLease({
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
				expectedVersion: loaded!.version + 1,
				credential: {
					type: "oauth",
					refresh: "refresh-ghost",
					access: "access-ghost",
					expires: vault.now() + 3_600_000,
				},
				encryptionKey: KEY_A,
			}),
		).toBe("missing");
	});

	it("reconnect defeats stale refresh write", async () => {
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-v1",
				access: "access-v1",
				expires: vault.now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
		});
		const lease = vault.acquire("user-a", "anthropic")!;
		const before = await vault.load("user-a", "anthropic", KEY_A);
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-reconnect",
				access: "access-reconnect",
				expires: vault.now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
		});
		expect(
			await vault.updateUnderLease({
				userId: "user-a",
				providerId: "anthropic",
				leaseId: lease.leaseId,
				expectedVersion: before!.version,
				credential: {
					type: "oauth",
					refresh: "refresh-stale",
					access: "access-stale",
					expires: vault.now() + 3_600_000,
				},
				encryptionKey: KEY_A,
			}),
		).toBe("stale");
		const final = await vault.load("user-a", "anthropic", KEY_A);
		expect(final?.credential).toMatchObject({ refresh: "refresh-reconnect" });
	});

	it("needs_relogin keeps ciphertext and stable code only", async () => {
		await vault.upsert({
			userId: "user-a",
			providerId: "anthropic",
			authType: "oauth",
			credential: {
				type: "oauth",
				refresh: "refresh-keep",
				access: "access-keep",
				expires: vault.now() + 3_600_000,
			},
			models: [model],
			encryptionKey: KEY_A,
		});
		vault.markNeeds("user-a", "anthropic", "oauth_refresh_failed");
		const listed = vault.list("user-a");
		expect(listed[0]).toMatchObject({
			status: "needs_relogin",
			lastErrorCode: "oauth_refresh_failed",
			models: [],
		});
		const loaded = await vault.load("user-a", "anthropic", KEY_A);
		expect(loaded?.credential).toMatchObject({ refresh: "refresh-keep" });
		expect(JSON.stringify(listed)).not.toContain("invalid_grant");
	});

	it("credentialSecretValues and runtime projection", () => {
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
		expect(() =>
			projectSafeModels(
				[{ providerId: "openai", modelId: "x", name: "X" }],
				"anthropic",
			),
		).toThrow(/mismatch/);
	});

	it("migration cascades and has no project/sandbox ownership columns", async () => {
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
		expect(sql).toMatch(/authSandboxId/);
		const credTable = sql.slice(
			sql.indexOf("CREATE TABLE `ai_provider_credentials`"),
			sql.indexOf("CREATE TABLE `provider_auth_attempts`"),
		);
		expect(credTable).not.toContain("sandboxId");
	});
});
