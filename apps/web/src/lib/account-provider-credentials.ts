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

/** Poll while waiting for a lease. */
export const LEASE_WAIT_POLL_MS = 100;

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

/** Canonical env var names allowed in API-key runtime projection. */
export const PROVIDER_API_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	xai: "XAI_API_KEY",
	opencode: "OPENCODE_API_KEY",
	"opencode-go": "OPENCODE_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	google: "GOOGLE_API_KEY",
	mistral: "MISTRAL_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	together: "TOGETHER_API_KEY",
};

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

type CredentialRow = {
	id: string;
	userId: string;
	providerId: string;
	authType: ProviderAuthType;
	encryptedCredential: string;
	modelCatalog: string;
	status: CredentialStatus;
	lastErrorCode: string | null;
	version: number;
	leaseId: string | null;
	leaseExpiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

const MEMORY_DB = Symbol.for("ditto.memoryCredentialDb");

export type MemoryCredentialDb = {
	readonly [MEMORY_DB]: true;
	rows: Map<string, CredentialRow>;
	attempts: Map<
		string,
		{
			id: string;
			userId: string;
			providerId: string;
			authType: ProviderAuthType;
			authSandboxId: string | null;
			status: "pending" | "complete" | "failed" | "cancelled";
			expiresAt: Date;
			createdAt: Date;
			updatedAt: Date;
		}
	>;
	clock: number;
};

export function createMemoryCredentialDb(
	nowMs = 1_000_000,
): MemoryCredentialDb {
	return {
		[MEMORY_DB]: true,
		rows: new Map(),
		attempts: new Map(),
		clock: nowMs,
	};
}

export function isMemoryCredentialDb(db: unknown): db is MemoryCredentialDb {
	return (
		typeof db === "object" &&
		db !== null &&
		MEMORY_DB in db &&
		(db as MemoryCredentialDb)[MEMORY_DB] === true
	);
}

function isMemoryDb(db: Db | MemoryCredentialDb): db is MemoryCredentialDb {
	return isMemoryCredentialDb(db);
}

function rowKey(userId: string, providerId: string): string {
	return `${userId}\0${providerId}`;
}

function nowDate(nowMs: number): Date {
	return new Date(nowMs);
}

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

/** Validate credential shape before D1 write / project use. */
export function parseStoredCredential(value: unknown): StoredCredential {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid credential.");
	}
	const rec = value as Record<string, unknown>;
	if (rec.type === "api_key") {
		const out: ApiKeyCredential = { type: "api_key" };
		if (rec.key !== undefined) {
			if (
				typeof rec.key !== "string" ||
				rec.key.length === 0 ||
				rec.key.length > 16_384
			) {
				throw new Error("Invalid api key.");
			}
			out.key = rec.key;
		}
		if (rec.env !== undefined) {
			if (!rec.env || typeof rec.env !== "object" || Array.isArray(rec.env)) {
				throw new Error("Invalid api key env.");
			}
			const env: Record<string, string> = {};
			for (const [k, v] of Object.entries(rec.env)) {
				if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) {
					throw new Error("Invalid api key env name.");
				}
				if (typeof v !== "string" || v.length === 0 || v.length > 16_384) {
					throw new Error("Invalid api key env value.");
				}
				env[k] = v;
			}
			if (Object.keys(env).length > 8) {
				throw new Error("Invalid api key env size.");
			}
			out.env = env;
		}
		if (!out.key && !out.env) {
			throw new Error("API key credential is empty.");
		}
		return out;
	}
	if (rec.type === "oauth") {
		if (typeof rec.refresh !== "string" || rec.refresh.length === 0) {
			throw new Error("Invalid oauth refresh.");
		}
		if (typeof rec.access !== "string" || rec.access.length === 0) {
			throw new Error("Invalid oauth access.");
		}
		const expires = Number(rec.expires);
		if (!Number.isFinite(expires)) {
			throw new Error("Invalid oauth expires.");
		}
		// Preserve unknown PI fields losslessly at rest.
		return { ...(rec as OAuthCredential), type: "oauth", expires };
	}
	throw new Error("Unsupported credential type.");
}

async function selectRow(
	db: Db | MemoryCredentialDb,
	userId: string,
	providerId: string,
): Promise<CredentialRow | null> {
	if (isMemoryDb(db)) {
		return db.rows.get(rowKey(userId, providerId)) ?? null;
	}
	const [row] = await db
		.select()
		.from(aiProviderCredentials)
		.where(
			and(
				eq(aiProviderCredentials.userId, userId),
				eq(aiProviderCredentials.providerId, providerId),
			),
		)
		.limit(1);
	return (row as CredentialRow | undefined) ?? null;
}

export async function listConnections(
	db: Db | MemoryCredentialDb,
	userId: string,
): Promise<ConnectionStatus[]> {
	if (isMemoryDb(db)) {
		return [...db.rows.values()]
			.filter((row) => row.userId === userId)
			.map((row) => ({
				providerId: row.providerId,
				authType: row.authType,
				status: row.status,
				lastErrorCode: row.lastErrorCode,
				models:
					row.status === "connected"
						? parseSafeModelCatalog(row.modelCatalog)
						: [],
			}));
	}
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
	db: Db | MemoryCredentialDb;
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
	const row = await selectRow(options.db, options.userId, options.providerId);
	if (!row) return null;

	const plaintext = await decryptText(
		row.encryptedCredential,
		options.encryptionKey,
		{
			additionalData: providerCredentialAad(options.userId, options.providerId),
		},
	);
	const credential = parseStoredCredential(JSON.parse(plaintext) as unknown);
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

/**
 * Upsert a credential. Existing rows linearize with the provider lease so a
 * reconnect cannot clear another holder's active refresh lease without taking
 * it, and a concurrent refresh cannot race the write.
 */
export async function upsertCredential(options: {
	db: Db | MemoryCredentialDb;
	userId: string;
	providerId: string;
	authType: ProviderAuthType;
	credential: StoredCredential;
	models: SafeModel[];
	encryptionKey: string;
	nowMs?: number;
	createId?: () => string;
	/** When false, fail instead of waiting (default waits LEASE_WAIT_MS). */
	waitForLease?: boolean;
}): Promise<"ok" | "busy"> {
	const now = options.nowMs ?? Date.now();
	const createId = options.createId ?? nanoid;
	const safeModels = projectSafeModels(options.models, options.providerId);
	const credential = parseStoredCredential(options.credential);
	const encrypted = await encryptText(
		JSON.stringify(credential),
		options.encryptionKey,
		{
			additionalData: providerCredentialAad(options.userId, options.providerId),
		},
	);

	const existing = await selectRow(
		options.db,
		options.userId,
		options.providerId,
	);

	if (!existing) {
		const row: CredentialRow = {
			id: createId(),
			userId: options.userId,
			providerId: options.providerId,
			authType: options.authType,
			encryptedCredential: encrypted,
			modelCatalog: JSON.stringify(safeModels),
			status: "connected",
			lastErrorCode: null,
			version: 1,
			leaseId: null,
			leaseExpiresAt: null,
			createdAt: nowDate(now),
			updatedAt: nowDate(now),
		};
		if (isMemoryDb(options.db)) {
			options.db.rows.set(rowKey(options.userId, options.providerId), row);
			return "ok";
		}
		await options.db.insert(aiProviderCredentials).values(row);
		return "ok";
	}

	const wait = options.waitForLease !== false;
	const lease = wait
		? await acquireLeaseWithWait({
				db: options.db,
				userId: options.userId,
				providerId: options.providerId,
				nowMs: now,
				createId,
			})
		: await acquireLease({
				db: options.db,
				userId: options.userId,
				providerId: options.providerId,
				nowMs: now,
				createId,
			});
	if (!lease) return "busy";

	try {
		if (isMemoryDb(options.db)) {
			const row = options.db.rows.get(
				rowKey(options.userId, options.providerId),
			);
			if (!row || row.leaseId !== lease.leaseId) return "busy";
			row.authType = options.authType;
			row.encryptedCredential = encrypted;
			row.modelCatalog = JSON.stringify(safeModels);
			row.status = "connected";
			row.lastErrorCode = null;
			row.version = row.version + 1;
			row.leaseId = null;
			row.leaseExpiresAt = null;
			row.updatedAt = nowDate(now);
			return "ok";
		}

		const updated = await options.db
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
			.where(
				and(
					eq(aiProviderCredentials.id, existing.id),
					eq(aiProviderCredentials.leaseId, lease.leaseId),
				),
			)
			.returning({ id: aiProviderCredentials.id });
		return updated[0] ? "ok" : "busy";
	} finally {
		await releaseLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			leaseId: lease.leaseId,
			nowMs: now,
		});
	}
}

/**
 * Mark needs_relogin only when the caller still holds the expected lease+version.
 * A stale failed refresh cannot mark a newly reconnected row.
 */
export async function markNeedsRelogin(options: {
	db: Db | MemoryCredentialDb;
	userId: string;
	providerId: string;
	errorCode: string;
	leaseId: string;
	expectedVersion: number;
	nowMs?: number;
}): Promise<"ok" | "stale" | "missing"> {
	const code = options.errorCode.trim().slice(0, MAX_ERROR_CODE);
	if (!code) throw new Error("errorCode is required.");
	const now = options.nowMs ?? Date.now();

	if (isMemoryDb(options.db)) {
		const row = options.db.rows.get(rowKey(options.userId, options.providerId));
		if (!row) return "missing";
		if (
			row.leaseId !== options.leaseId ||
			row.version !== options.expectedVersion
		) {
			return "stale";
		}
		row.status = "needs_relogin";
		row.lastErrorCode = code;
		row.leaseId = null;
		row.leaseExpiresAt = null;
		row.updatedAt = nowDate(now);
		return "ok";
	}

	const updated = await options.db
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
				eq(aiProviderCredentials.leaseId, options.leaseId),
				eq(aiProviderCredentials.version, options.expectedVersion),
			),
		)
		.returning({ id: aiProviderCredentials.id });
	if (updated[0]) return "ok";
	const still = await selectRow(options.db, options.userId, options.providerId);
	return still ? "stale" : "missing";
}

/**
 * Acquire a lease. Returns leaseId on success, null if held by another.
 * Expired leases are reclaimable.
 */
export async function acquireLease(options: {
	db: Db | MemoryCredentialDb;
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

	if (isMemoryDb(options.db)) {
		const row = options.db.rows.get(rowKey(options.userId, options.providerId));
		if (!row) return null;
		const held =
			row.leaseId && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now;
		if (held) return null;
		row.leaseId = leaseId;
		row.leaseExpiresAt = expires;
		row.updatedAt = nowDate(now);
		return { leaseId, version: row.version };
	}

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

/** Bounded wait/retry for an active lease. */
export async function acquireLeaseWithWait(options: {
	db: Db | MemoryCredentialDb;
	userId: string;
	providerId: string;
	nowMs?: number;
	createId?: () => string;
	ttlMs?: number;
	waitMs?: number;
	pollMs?: number;
	sleep?: (ms: number) => Promise<void>;
	/** Injectable clock advance for tests (memory db). */
	tick?: (ms: number) => void;
}): Promise<{ leaseId: string; version: number } | null> {
	const waitMs = options.waitMs ?? LEASE_WAIT_MS;
	const pollMs = options.pollMs ?? LEASE_WAIT_POLL_MS;
	const sleep =
		options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const started = options.nowMs ?? Date.now();
	let elapsed = 0;

	while (elapsed <= waitMs) {
		const now = started + elapsed;
		const lease = await acquireLease({
			db: options.db,
			userId: options.userId,
			providerId: options.providerId,
			nowMs: now,
			createId: options.createId,
			ttlMs: options.ttlMs,
		});
		if (lease) return lease;
		if (elapsed >= waitMs) break;
		const step = Math.min(pollMs, waitMs - elapsed);
		if (options.tick) options.tick(step);
		else if (isMemoryDb(options.db)) options.db.clock += step;
		await sleep(isMemoryDb(options.db) ? 0 : step);
		elapsed += step;
	}
	return null;
}

/** Update-only refresh write. Never recreates a deleted row. */
export async function updateCredentialUnderLease(options: {
	db: Db | MemoryCredentialDb;
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
	const credential = parseStoredCredential(options.credential);
	const encrypted = await encryptText(
		JSON.stringify(credential),
		options.encryptionKey,
		{
			additionalData: providerCredentialAad(options.userId, options.providerId),
		},
	);

	if (isMemoryDb(options.db)) {
		const row = options.db.rows.get(rowKey(options.userId, options.providerId));
		if (!row) return "missing";
		if (
			row.leaseId !== options.leaseId ||
			row.version !== options.expectedVersion ||
			!row.leaseExpiresAt ||
			row.leaseExpiresAt.getTime() <= now
		) {
			return "stale";
		}
		row.encryptedCredential = encrypted;
		row.status = "connected";
		row.lastErrorCode = null;
		row.version = row.version + 1;
		row.updatedAt = nowDate(now);
		if (options.models) {
			row.modelCatalog = JSON.stringify(
				projectSafeModels(options.models, options.providerId),
			);
		}
		return "ok";
	}

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
	db: Db | MemoryCredentialDb;
	userId: string;
	providerId: string;
	leaseId: string;
	nowMs?: number;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	if (isMemoryDb(options.db)) {
		const row = options.db.rows.get(rowKey(options.userId, options.providerId));
		if (row && row.leaseId === options.leaseId) {
			row.leaseId = null;
			row.leaseExpiresAt = null;
			row.updatedAt = nowDate(now);
		}
		return;
	}
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
	db: Db | MemoryCredentialDb;
	userId: string;
	providerId: string;
	leaseId: string;
}): Promise<boolean> {
	if (isMemoryDb(options.db)) {
		const k = rowKey(options.userId, options.providerId);
		const row = options.db.rows.get(k);
		if (!row || row.leaseId !== options.leaseId) return false;
		options.db.rows.delete(k);
		return true;
	}
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
	db: Db | MemoryCredentialDb;
	userId: string;
	providerId: string;
	nowMs?: number;
	createId?: () => string;
}): Promise<boolean> {
	const lease = await acquireLeaseWithWait(options);
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
	db: Db | MemoryCredentialDb;
	nowMs?: number;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	const nowTs = nowDate(now);
	if (isMemoryDb(options.db)) {
		for (const [id, attempt] of options.db.attempts) {
			if (attempt.expiresAt.getTime() < now) options.db.attempts.delete(id);
		}
		for (const row of options.db.rows.values()) {
			if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() < now) {
				row.leaseId = null;
				row.leaseExpiresAt = null;
				row.updatedAt = nowTs;
			}
		}
		return;
	}
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

function projectApiKeyEnv(
	credential: ApiKeyCredential,
	providerId: string,
): Record<string, string> | undefined {
	const canonical = PROVIDER_API_KEY_ENV[providerId];
	if (!canonical || !credential.env) return undefined;
	const value = credential.env[canonical];
	if (typeof value !== "string" || !value) return undefined;
	return { [canonical]: value };
}

/** Runtime projection allowlist per Locked decision 9. */
export function toRuntimeCredential(
	credential: StoredCredential,
	providerId: string,
	options?: { maxAgentWindowMs?: number; nowMs?: number },
): StoredCredential {
	const parsed = parseStoredCredential(credential);
	const now = options?.nowMs ?? Date.now();
	const windowMs =
		(options?.maxAgentWindowMs ?? AGENT_COMMAND_TIMEOUT_MS) +
		ACCESS_EXPIRY_SAFETY_MS;

	if (parsed.type === "api_key") {
		const out: ApiKeyCredential = { type: "api_key" };
		if (typeof parsed.key === "string") out.key = parsed.key;
		const env = projectApiKeyEnv(parsed, providerId);
		if (env) out.env = env;
		return out;
	}

	if (parsed.type !== "oauth") {
		throw new Error("Unsupported credential type.");
	}

	const expires = Number(parsed.expires);
	if (!Number.isFinite(expires) || expires <= now + windowMs) {
		throw new Error("OAuth access token expires too soon for a project run.");
	}

	const base: OAuthCredential = {
		type: "oauth",
		refresh: OAUTH_REFRESH_SENTINEL,
		access: String(parsed.access),
		expires,
	};

	if (providerId === "openai-codex") {
		if (typeof parsed.accountId === "string") {
			base.accountId = String(parsed.accountId).slice(0, 256);
		}
		return base;
	}
	if (providerId === "github-copilot") {
		if (typeof parsed.enterpriseUrl === "string") {
			const url = String(parsed.enterpriseUrl).slice(0, 512);
			if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(url)) {
				base.enterpriseUrl = url;
			}
		}
		if (Array.isArray(parsed.availableModelIds)) {
			base.availableModelIds = parsed.availableModelIds
				.filter((id): id is string => typeof id === "string" && id.length > 0)
				.slice(0, 500)
				.map((id) => id.slice(0, 256));
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
