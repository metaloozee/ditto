import { and, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { createDb } from "#/db";
import { aiProviderCredentials, providerAuthAttempts } from "#/db/schema";
import { decryptText, encryptText, providerCredentialAad } from "#/lib/crypto";

/** Max agent command window (matches agent-run). */
export const AGENT_COMMAND_TIMEOUT_MS = 600_000;

/** Auth-only sandbox resolve/login timeout. */
export const AUTH_RESOLUTION_TIMEOUT_MS = 120_000;

/** Grace after kill before lease may be released. */
export const AUTH_PROCESS_KILL_GRACE_MS = 15_000;

/** Lease must outlive resolve + kill grace. */
export const LEASE_TTL_MS = 180_000;

/** Bounded wait when another holder owns the lease. */
export const LEASE_WAIT_MS = 30_000;

/** Safety skew so access tokens outlive the agent run. */
export const ACCESS_EXPIRY_SAFETY_MS = 60_000;

export const OAUTH_REFRESH_SENTINEL = "ditto:no-refresh";

export const FALLBACK_MODEL_SPECIFIER =
	"opencode/deepseek-v4-flash-free" as const;
export const FALLBACK_PROVIDER_ID = "opencode" as const;

const MAX_CATALOG_MODELS = 500;
const MAX_ERROR_CODE = 64;
const MAX_MODEL_FIELD = 256;
const MAX_NAME_FIELD = 512;

export const safeModelSchema = z
	.object({
		providerId: z.string().min(1).max(MAX_MODEL_FIELD),
		modelId: z.string().min(1).max(MAX_MODEL_FIELD),
		name: z.string().min(1).max(MAX_NAME_FIELD),
		input: z.array(z.string().max(64)).max(16).optional(),
		reasoning: z.boolean().optional(),
		contextWindow: z.number().int().positive().safe().optional(),
		maxTokens: z.number().int().positive().safe().optional(),
		cost: z
			.object({
				input: z.number().nonnegative().optional(),
				output: z.number().nonnegative().optional(),
				cacheRead: z.number().nonnegative().optional(),
				cacheWrite: z.number().nonnegative().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export type SafeModel = z.infer<typeof safeModelSchema>;

export const safeModelCatalogSchema = z
	.array(safeModelSchema)
	.max(MAX_CATALOG_MODELS);

export type ProviderAuthType = "api_key" | "oauth";
export type CredentialStatus = "connected" | "needs_relogin";

export type ApiKeyCredential = {
	type: "api_key";
	key?: string;
	env?: Record<string, string>;
};

export type OAuthCredential = {
	type: "oauth";
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
};

export type StoredCredential = ApiKeyCredential | OAuthCredential;

export type ConnectionStatus = {
	providerId: string;
	authType: ProviderAuthType;
	status: CredentialStatus;
	lastErrorCode: string | null;
	models: SafeModel[];
};

type Db = ReturnType<typeof createDb>;

export type CredentialConfig = {
	AI_CREDENTIALS_ENCRYPTION_KEY: string;
	BETTER_AUTH_SECRET: string;
	OPENCODE_API_KEY: string;
};

export function assertCredentialConfig(env: CredentialConfig): void {
	const enc = env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim() ?? "";
	const auth = env.BETTER_AUTH_SECRET?.trim() ?? "";
	const opencode = env.OPENCODE_API_KEY?.trim() ?? "";
	if (!enc) {
		throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY is required.");
	}
	if (!auth) {
		throw new Error("BETTER_AUTH_SECRET is required.");
	}
	if (!opencode) {
		throw new Error("OPENCODE_API_KEY is required.");
	}
	if (enc === auth) {
		throw new Error(
			"AI_CREDENTIALS_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET.",
		);
	}
}

/** Collect every nonempty string leaf except structural `type`. */
export function credentialSecretValues(credential: unknown): string[] {
	const out: string[] = [];
	const walk = (value: unknown, key?: string) => {
		if (typeof value === "string") {
			if (key === "type") return;
			if (value.length > 0) out.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		if (value && typeof value === "object") {
			for (const [k, child] of Object.entries(value)) {
				walk(child, k);
			}
		}
	};
	walk(credential);
	return out;
}

export function parseSafeModelCatalog(raw: string): SafeModel[] {
	const parsed = JSON.parse(raw) as unknown;
	return safeModelCatalogSchema.parse(parsed);
}

export function projectSafeModels(
	models: readonly unknown[],
	providerId: string,
): SafeModel[] {
	const seen = new Set<string>();
	const out: SafeModel[] = [];
	for (const raw of models) {
		if (out.length >= MAX_CATALOG_MODELS) {
			throw new Error("Model catalog exceeds size limit.");
		}
		const model = safeModelSchema.parse(raw);
		if (model.providerId !== providerId) {
			throw new Error("Model provider mismatch.");
		}
		const key = `${model.providerId}/${model.modelId}`;
		if (seen.has(key)) {
			throw new Error("Duplicate model id in catalog.");
		}
		seen.add(key);
		out.push(model);
	}
	return out;
}

function nowDate(nowMs: number): Date {
	return new Date(nowMs);
}

export async function listConnections(
	db: Db,
	userId: string,
): Promise<ConnectionStatus[]> {
	const rows = await db
		.select({
			providerId: aiProviderCredentials.providerId,
			authType: aiProviderCredentials.authType,
			status: aiProviderCredentials.status,
			lastErrorCode: aiProviderCredentials.lastErrorCode,
			modelCatalog: aiProviderCredentials.modelCatalog,
		})
		.from(aiProviderCredentials)
		.where(eq(aiProviderCredentials.userId, userId));

	return rows.map((row) => ({
		providerId: row.providerId,
		authType: row.authType,
		status: row.status,
		lastErrorCode: row.lastErrorCode,
		models:
			row.status === "connected" ? parseSafeModelCatalog(row.modelCatalog) : [],
	}));
}

export async function loadCredential(options: {
	db: Db;
	userId: string;
	providerId: string;
	encryptionKey: string;
}): Promise<{
	id: string;
	authType: ProviderAuthType;
	status: CredentialStatus;
	version: number;
	credential: StoredCredential;
	models: SafeModel[];
	lastErrorCode: string | null;
} | null> {
	const [row] = await options.db
		.select()
		.from(aiProviderCredentials)
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
			),
		)
		.limit(1);
	if (!row) return null;

	const plaintext = await decryptText(
		row.encryptedCredential,
		options.encryptionKey,
		{
			additionalData: providerCredentialAad(options.userId, options.providerId),
		},
	);
	const credential = JSON.parse(plaintext) as StoredCredential;
	return {
		id: row.id,
		authType: row.authType,
		status: row.status,
		version: row.version,
		credential,
		models: parseSafeModelCatalog(row.modelCatalog),
		lastErrorCode: row.lastErrorCode,
	};
}

export async function upsertCredential(options: {
	db: Db;
	userId: string;
	providerId: string;
	authType: ProviderAuthType;
	credential: StoredCredential;
	models: SafeModel[];
	encryptionKey: string;
	nowMs?: number;
	createId?: () => string;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	const createId = options.createId ?? nanoid;
	const safeModels = projectSafeModels(options.models, options.providerId);
	const encrypted = await encryptText(
		JSON.stringify(options.credential),
		options.encryptionKey,
		{
			additionalData: providerCredentialAad(options.userId, options.providerId),
		},
	);

	const [existing] = await options.db
		.select({
			id: aiProviderCredentials.id,
			version: aiProviderCredentials.version,
		})
		.from(aiProviderCredentials)
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
			),
		)
		.limit(1);

	if (existing) {
		await options.db
			.update(aiProviderCredentials)
			.set({
				authType: options.authType,
				encryptedCredential: encrypted,
				modelCatalog: JSON.stringify(safeModels),
				status: "connected",
				lastErrorCode: null,
				version: existing.version + 1,
				leaseId: null,
				leaseExpiresAt: null,
				updatedAt: nowDate(now),
			})
			.where(eq(aiProviderCredentials.id, existing.id));
		return;
	}

	await options.db.insert(aiProviderCredentials).values({
		id: createId(),
		userId: options.userId,
		providerId: options.providerId,
		authType: options.authType,
		encryptedCredential: encrypted,
		modelCatalog: JSON.stringify(safeModels),
		status: "connected",
		lastErrorCode: null,
		version: 1,
		createdAt: nowDate(now),
		updatedAt: nowDate(now),
	});
}

export async function markNeedsRelogin(options: {
	db: Db;
	userId: string;
	providerId: string;
	errorCode: string;
	nowMs?: number;
}): Promise<void> {
	const code = options.errorCode.trim().slice(0, MAX_ERROR_CODE);
	if (!code) throw new Error("errorCode is required.");
	const now = options.nowMs ?? Date.now();
	await options.db
		.update(aiProviderCredentials)
		.set({
			status: "needs_relogin",
			lastErrorCode: code,
			leaseId: null,
			leaseExpiresAt: null,
			updatedAt: nowDate(now),
		})
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
			),
		);
}

/**
 * Acquire a lease. Returns leaseId on success, null if held by another.
 * Expired leases are reclaimable.
 */
export async function acquireLease(options: {
	db: Db;
	userId: string;
	providerId: string;
	nowMs?: number;
	createId?: () => string;
	ttlMs?: number;
}): Promise<{ leaseId: string; version: number } | null> {
	const now = options.nowMs ?? Date.now();
	const leaseId = (options.createId ?? nanoid)();
	const ttl = options.ttlMs ?? LEASE_TTL_MS;
	const expires = nowDate(now + ttl);

	const [row] = await options.db
		.select({
			id: aiProviderCredentials.id,
			version: aiProviderCredentials.version,
			leaseId: aiProviderCredentials.leaseId,
			leaseExpiresAt: aiProviderCredentials.leaseExpiresAt,
		})
		.from(aiProviderCredentials)
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
			),
		)
		.limit(1);
	if (!row) return null;

	const held =
		row.leaseId && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now;
	if (held) return null;

	const result = await options.db
		.update(aiProviderCredentials)
		.set({
			leaseId,
			leaseExpiresAt: expires,
			updatedAt: nowDate(now),
		})
		.where(
			and(
				eq(aiProviderCredentials.id, row.id),
				or(
					sql`${aiProviderCredentials.leaseId} IS NULL`,
					sql`${aiProviderCredentials.leaseExpiresAt} IS NULL`,
					lt(aiProviderCredentials.leaseExpiresAt, nowDate(now)),
					eq(aiProviderCredentials.leaseId, row.leaseId ?? ""),
				),
			),
		)
		.returning({
			leaseId: aiProviderCredentials.leaseId,
			version: aiProviderCredentials.version,
		});

	const updated = result[0];
	if (!updated || updated.leaseId !== leaseId) return null;
	return { leaseId, version: updated.version };
}

/** Update-only refresh write. Never recreates a deleted row. */
export async function updateCredentialUnderLease(options: {
	db: Db;
	userId: string;
	providerId: string;
	leaseId: string;
	expectedVersion: number;
	credential: StoredCredential;
	models?: SafeModel[];
	encryptionKey: string;
	nowMs?: number;
}): Promise<"ok" | "missing" | "stale"> {
	const now = options.nowMs ?? Date.now();
	const [row] = await options.db
		.select({
			id: aiProviderCredentials.id,
			version: aiProviderCredentials.version,
			leaseId: aiProviderCredentials.leaseId,
			leaseExpiresAt: aiProviderCredentials.leaseExpiresAt,
		})
		.from(aiProviderCredentials)
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
			),
		)
		.limit(1);
	if (!row) return "missing";
	if (
		row.leaseId !== options.leaseId ||
		row.version !== options.expectedVersion ||
		!row.leaseExpiresAt ||
		row.leaseExpiresAt.getTime() <= now
	) {
		return "stale";
	}

	const encrypted = await encryptText(
		JSON.stringify(options.credential),
		options.encryptionKey,
		{
			additionalData: providerCredentialAad(options.userId, options.providerId),
		},
	);

	const patch: Record<string, unknown> = {
		encryptedCredential: encrypted,
		status: "connected",
		lastErrorCode: null,
		version: row.version + 1,
		updatedAt: nowDate(now),
	};
	if (options.models) {
		patch.modelCatalog = JSON.stringify(
			projectSafeModels(options.models, options.providerId),
		);
	}

	const updated = await options.db
		.update(aiProviderCredentials)
		.set(patch)
		.where(
			and(
				eq(aiProviderCredentials.id, row.id),
				eq(aiProviderCredentials.leaseId, options.leaseId),
				eq(aiProviderCredentials.version, options.expectedVersion),
			),
		)
		.returning({ id: aiProviderCredentials.id });

	return updated[0] ? "ok" : "stale";
}

export async function releaseLease(options: {
	db: Db;
	userId: string;
	providerId: string;
	leaseId: string;
	nowMs?: number;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	await options.db
		.update(aiProviderCredentials)
		.set({
			leaseId: null,
			leaseExpiresAt: null,
			updatedAt: nowDate(now),
		})
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
				eq(aiProviderCredentials.leaseId, options.leaseId),
			),
		);
}

/** Delete while holding the lease. */
export async function deleteCredentialUnderLease(options: {
	db: Db;
	userId: string;
	providerId: string;
	leaseId: string;
}): Promise<boolean> {
	const deleted = await options.db
		.delete(aiProviderCredentials)
		.where(
			and(
				eq(aiProviderCredentials.userId, options.userId),
				eq(aiProviderCredentials.providerId, options.providerId),
				eq(aiProviderCredentials.leaseId, options.leaseId),
			),
		)
		.returning({ id: aiProviderCredentials.id });
	return deleted.length > 0;
}

export async function deleteCredentialWithLease(options: {
	db: Db;
	userId: string;
	providerId: string;
	nowMs?: number;
	createId?: () => string;
}): Promise<boolean> {
	const lease = await acquireLease(options);
	if (!lease) return false;
	try {
		return await deleteCredentialUnderLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			leaseId: lease.leaseId,
		});
	} finally {
		await releaseLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			leaseId: lease.leaseId,
			nowMs: options.nowMs,
		});
	}
}

export async function clearExpiredAttemptsAndLeases(options: {
	db: Db;
	nowMs?: number;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	const nowTs = nowDate(now);
	await options.db
		.delete(providerAuthAttempts)
		.where(lt(providerAuthAttempts.expiresAt, nowTs));
	await options.db
		.update(aiProviderCredentials)
		.set({
			leaseId: null,
			leaseExpiresAt: null,
			updatedAt: nowTs,
		})
		.where(
			and(
				sql`${aiProviderCredentials.leaseExpiresAt} IS NOT NULL`,
				lt(aiProviderCredentials.leaseExpiresAt, nowTs),
			),
		);
}

/** Runtime projection allowlist per Locked decision 9. */
export function toRuntimeCredential(
	credential: StoredCredential,
	providerId: string,
	options?: { maxAgentWindowMs?: number; nowMs?: number },
): StoredCredential {
	const now = options?.nowMs ?? Date.now();
	const windowMs =
		(options?.maxAgentWindowMs ?? AGENT_COMMAND_TIMEOUT_MS) +
		ACCESS_EXPIRY_SAFETY_MS;

	if (credential.type === "api_key") {
		const out: ApiKeyCredential = { type: "api_key" };
		if (typeof credential.key === "string") out.key = credential.key;
		if (credential.env && typeof credential.env === "object") {
			out.env = { ...credential.env };
		}
		return out;
	}

	if (credential.type !== "oauth") {
		throw new Error("Unsupported credential type.");
	}

	const expires = Number(credential.expires);
	if (!Number.isFinite(expires) || expires <= now + windowMs) {
		throw new Error("OAuth access token expires too soon for a project run.");
	}

	const base: OAuthCredential = {
		type: "oauth",
		refresh: OAUTH_REFRESH_SENTINEL,
		access: String(credential.access),
		expires,
	};

	if (providerId === "openai-codex") {
		if (typeof credential.accountId === "string") {
			base.accountId = credential.accountId;
		}
		return base;
	}
	if (providerId === "github-copilot") {
		if (typeof credential.enterpriseUrl === "string") {
			base.enterpriseUrl = credential.enterpriseUrl;
		}
		if (Array.isArray(credential.availableModelIds)) {
			base.availableModelIds = credential.availableModelIds;
		}
		return base;
	}
	if (providerId === "anthropic" || providerId === "xai") {
		return base;
	}

	// Other OAuth providers: only the allowlisted core fields.
	return base;
}

export function operatorFallbackCredential(apiKey: string): ApiKeyCredential {
	return { type: "api_key", key: apiKey };
}

// Compile-time ordering check exported for tests.
export const LEASE_ORDERING_OK =
	AUTH_RESOLUTION_TIMEOUT_MS + AUTH_PROCESS_KILL_GRACE_MS < LEASE_TTL_MS;
