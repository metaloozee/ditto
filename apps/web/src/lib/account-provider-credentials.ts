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
		contextWindow: z.number().int().positive().finite().safe().optional(),
		maxTokens: z.number().int().positive().finite().safe().optional(),
		cost: z
			.object({
				input: z.number().finite().nonnegative().optional(),
				output: z.number().finite().nonnegative().optional(),
				cacheRead: z.number().finite().nonnegative().optional(),
				cacheWrite: z.number().finite().nonnegative().optional(),
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

export type CredentialRow = {
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

export type AuthAttemptRow = {
	id: string;
	userId: string;
	providerId: string;
	authType: ProviderAuthType;
	authSandboxId: string | null;
	status: "pending" | "complete" | "failed" | "cancelled";
	expiresAt: Date;
	createdAt: Date;
	updatedAt: Date;
};

type Db = ReturnType<typeof createDb>;

/**
 * Narrow credential authority surface. Production uses D1 via
 * {@link createCredentialRepository}; tests inject a same-shaped store so every
 * CAS/version path runs through one control flow.
 */
export type CredentialRepository = {
	getRow(userId: string, providerId: string): Promise<CredentialRow | null>;
	listRows(userId: string): Promise<CredentialRow[]>;
	insertRow(row: CredentialRow): Promise<void>;
	/** Conditional update; returns updated row or null if no match. */
	updateRow(
		where: {
			userId: string;
			providerId: string;
			id?: string;
			leaseId?: string | null;
			version?: number;
			/** Match when lease is free or expired at this instant. */
			leaseOpenAt?: number;
		},
		set: Partial<
			Pick<
				CredentialRow,
				| "authType"
				| "encryptedCredential"
				| "modelCatalog"
				| "status"
				| "lastErrorCode"
				| "version"
				| "leaseId"
				| "leaseExpiresAt"
				| "updatedAt"
			>
		>,
	): Promise<CredentialRow | null>;
	deleteRow(where: {
		userId: string;
		providerId: string;
		leaseId: string;
	}): Promise<boolean>;
	clearExpiredLeases(nowMs: number): Promise<void>;
	insertAttempt(row: AuthAttemptRow): Promise<void>;
	getAttempt(id: string, userId: string): Promise<AuthAttemptRow | null>;
	updateAttempt(
		id: string,
		set: Partial<Pick<AuthAttemptRow, "status" | "updatedAt">>,
	): Promise<void>;
	deleteExpiredAttempts(nowMs: number): Promise<void>;
};

function nowDate(nowMs: number): Date {
	return new Date(nowMs);
}

function leaseIsOpen(row: CredentialRow, nowMs: number): boolean {
	if (!row.leaseId) return true;
	if (!row.leaseExpiresAt) return true;
	return row.leaseExpiresAt.getTime() <= nowMs;
}

function matchesWhere(
	row: CredentialRow,
	where: Parameters<CredentialRepository["updateRow"]>[0],
): boolean {
	if (row.userId !== where.userId || row.providerId !== where.providerId) {
		return false;
	}
	if (where.id !== undefined && row.id !== where.id) return false;
	if (where.leaseId !== undefined && row.leaseId !== where.leaseId)
		return false;
	if (where.version !== undefined && row.version !== where.version)
		return false;
	if (where.leaseOpenAt !== undefined && !leaseIsOpen(row, where.leaseOpenAt)) {
		return false;
	}
	return true;
}

/** D1-backed production repository. */
export function createCredentialRepository(db: Db): CredentialRepository {
	return {
		async getRow(userId, providerId) {
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
		},

		async listRows(userId) {
			const rows = await db
				.select()
				.from(aiProviderCredentials)
				.where(eq(aiProviderCredentials.userId, userId));
			return rows as CredentialRow[];
		},

		async insertRow(row) {
			await db.insert(aiProviderCredentials).values(row);
		},

		async updateRow(where, set) {
			const conditions = [
				eq(aiProviderCredentials.userId, where.userId),
				eq(aiProviderCredentials.providerId, where.providerId),
			];
			if (where.id !== undefined) {
				conditions.push(eq(aiProviderCredentials.id, where.id));
			}
			if (where.leaseId !== undefined) {
				if (where.leaseId === null) {
					conditions.push(sql`${aiProviderCredentials.leaseId} IS NULL`);
				} else {
					conditions.push(eq(aiProviderCredentials.leaseId, where.leaseId));
				}
			}
			if (where.version !== undefined) {
				conditions.push(eq(aiProviderCredentials.version, where.version));
			}
			if (where.leaseOpenAt !== undefined) {
				const now = nowDate(where.leaseOpenAt);
				conditions.push(
					or(
						sql`${aiProviderCredentials.leaseId} IS NULL`,
						sql`${aiProviderCredentials.leaseExpiresAt} IS NULL`,
						lt(aiProviderCredentials.leaseExpiresAt, now),
					)!,
				);
			}

			const updated = await db
				.update(aiProviderCredentials)
				.set(set)
				.where(and(...conditions))
				.returning();
			return (updated[0] as CredentialRow | undefined) ?? null;
		},

		async deleteRow(where) {
			const deleted = await db
				.delete(aiProviderCredentials)
				.where(
					and(
						eq(aiProviderCredentials.userId, where.userId),
						eq(aiProviderCredentials.providerId, where.providerId),
						eq(aiProviderCredentials.leaseId, where.leaseId),
					),
				)
				.returning({ id: aiProviderCredentials.id });
			return deleted.length > 0;
		},

		async clearExpiredLeases(nowMs) {
			const nowTs = nowDate(nowMs);
			await db
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
		},

		async insertAttempt(row) {
			await db.insert(providerAuthAttempts).values(row);
		},

		async getAttempt(id, userId) {
			const [row] = await db
				.select()
				.from(providerAuthAttempts)
				.where(
					and(
						eq(providerAuthAttempts.id, id),
						eq(providerAuthAttempts.userId, userId),
					),
				)
				.limit(1);
			return (row as AuthAttemptRow | undefined) ?? null;
		},

		async updateAttempt(id, set) {
			await db
				.update(providerAuthAttempts)
				.set(set)
				.where(eq(providerAuthAttempts.id, id));
		},

		async deleteExpiredAttempts(nowMs) {
			await db
				.delete(providerAuthAttempts)
				.where(lt(providerAuthAttempts.expiresAt, nowDate(nowMs)));
		},
	};
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

export async function listConnections(
	db: CredentialRepository,
	userId: string,
): Promise<ConnectionStatus[]> {
	const rows = await db.listRows(userId);
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
	db: CredentialRepository;
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
	const row = await options.db.getRow(options.userId, options.providerId);
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
 *
 * Version is always `lease.version + 1` and the write is conditioned on both
 * lease ID and the acquired version (not a pre-lease snapshot).
 */
export async function upsertCredential(options: {
	db: CredentialRepository;
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

	const existing = await options.db.getRow(options.userId, options.providerId);

	if (!existing) {
		await options.db.insertRow({
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
		});
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
		// Re-read after lease; write against acquired version only.
		const current = await options.db.getRow(options.userId, options.providerId);
		if (!current || current.leaseId !== lease.leaseId) return "busy";
		if (current.version !== lease.version) return "busy";

		const updated = await options.db.updateRow(
			{
				userId: options.userId,
				providerId: options.providerId,
				id: current.id,
				leaseId: lease.leaseId,
				version: lease.version,
			},
			{
				authType: options.authType,
				encryptedCredential: encrypted,
				modelCatalog: JSON.stringify(safeModels),
				status: "connected",
				lastErrorCode: null,
				version: lease.version + 1,
				leaseId: null,
				leaseExpiresAt: null,
				updatedAt: nowDate(now),
			},
		);
		return updated ? "ok" : "busy";
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
	db: CredentialRepository;
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

	const updated = await options.db.updateRow(
		{
			userId: options.userId,
			providerId: options.providerId,
			leaseId: options.leaseId,
			version: options.expectedVersion,
		},
		{
			status: "needs_relogin",
			lastErrorCode: code,
			leaseId: null,
			leaseExpiresAt: null,
			updatedAt: nowDate(now),
		},
	);
	if (updated) return "ok";
	const still = await options.db.getRow(options.userId, options.providerId);
	return still ? "stale" : "missing";
}

/**
 * Acquire a lease. Returns leaseId on success, null if held by another.
 * Expired leases are reclaimable.
 */
export async function acquireLease(options: {
	db: CredentialRepository;
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

	const updated = await options.db.updateRow(
		{
			userId: options.userId,
			providerId: options.providerId,
			leaseOpenAt: now,
		},
		{
			leaseId,
			leaseExpiresAt: expires,
			updatedAt: nowDate(now),
		},
	);
	if (!updated || updated.leaseId !== leaseId) return null;
	return { leaseId, version: updated.version };
}

/** Bounded wait/retry for an active lease. */
export async function acquireLeaseWithWait(options: {
	db: CredentialRepository;
	userId: string;
	providerId: string;
	nowMs?: number;
	createId?: () => string;
	ttlMs?: number;
	waitMs?: number;
	pollMs?: number;
	sleep?: (ms: number) => Promise<void>;
	/** Injectable clock advance for tests. */
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
		await sleep(options.tick ? 0 : step);
		elapsed += step;
	}
	return null;
}

/** Update-only refresh write. Never recreates a deleted row. */
export async function updateCredentialUnderLease(options: {
	db: CredentialRepository;
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

	const current = await options.db.getRow(options.userId, options.providerId);
	if (!current) return "missing";
	if (
		current.leaseId !== options.leaseId ||
		current.version !== options.expectedVersion ||
		!current.leaseExpiresAt ||
		current.leaseExpiresAt.getTime() <= now
	) {
		return "stale";
	}

	const set: Parameters<CredentialRepository["updateRow"]>[1] = {
		encryptedCredential: encrypted,
		status: "connected",
		lastErrorCode: null,
		version: options.expectedVersion + 1,
		updatedAt: nowDate(now),
	};
	if (options.models) {
		set.modelCatalog = JSON.stringify(
			projectSafeModels(options.models, options.providerId),
		);
	}

	const updated = await options.db.updateRow(
		{
			userId: options.userId,
			providerId: options.providerId,
			id: current.id,
			leaseId: options.leaseId,
			version: options.expectedVersion,
		},
		set,
	);
	return updated ? "ok" : "stale";
}

export async function releaseLease(options: {
	db: CredentialRepository;
	userId: string;
	providerId: string;
	leaseId: string;
	nowMs?: number;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	await options.db.updateRow(
		{
			userId: options.userId,
			providerId: options.providerId,
			leaseId: options.leaseId,
		},
		{
			leaseId: null,
			leaseExpiresAt: null,
			updatedAt: nowDate(now),
		},
	);
}

/** Delete while holding the lease. */
export async function deleteCredentialUnderLease(options: {
	db: CredentialRepository;
	userId: string;
	providerId: string;
	leaseId: string;
}): Promise<boolean> {
	return options.db.deleteRow({
		userId: options.userId,
		providerId: options.providerId,
		leaseId: options.leaseId,
	});
}

export async function deleteCredentialWithLease(options: {
	db: CredentialRepository;
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
	db: CredentialRepository;
	nowMs?: number;
}): Promise<void> {
	const now = options.nowMs ?? Date.now();
	await options.db.deleteExpiredAttempts(now);
	await options.db.clearExpiredLeases(now);
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

/** Shared CAS predicate for repository implementations (incl. tests). */
export function credentialRowMatches(
	row: CredentialRow,
	where: Parameters<CredentialRepository["updateRow"]>[0],
): boolean {
	return matchesWhere(row, where);
}
