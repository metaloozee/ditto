import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { WORKSPACE_SESSION_STATUSES } from "#/lib/workspace-policy";

export const todos = sqliteTable("todos", {
	id: integer({ mode: "number" }).primaryKey({
		autoIncrement: true,
	}),
	title: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
});

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("emailVerified", { mode: "boolean" })
		.notNull()
		.default(false),
	image: text("image"),
	createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const projects = sqliteTable(
	"projects",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		description: text("description"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		githubRepo: text("githubRepo"),
		githubInstallationId: integer("githubInstallationId"),
		status: text("status", {
			enum: ["provisioning", "ready", "failed", "deleting"],
		})
			.notNull()
			.default("provisioning"),
		envVars: text("envVars"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [index("projects_userId_idx").on(table.userId)],
);

export const workspaceSessions = sqliteTable(
	"workspace_sessions",
	{
		id: text("id").primaryKey(),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title"),
		branchName: text("branchName"),
		baseCommitSha: text("baseCommitSha"),
		status: text("status", { enum: [...WORKSPACE_SESSION_STATUSES] })
			.notNull()
			.default("active"),
		/** Set while the user wants preview running. Not a URL or token. */
		previewStartedAt: integer("previewStartedAt", { mode: "timestamp" }),
		/** No FK: identity tombstones are permanent and never cascade-deleted. */
		sandboxIdentityId: text("sandboxIdentityId"),
		runtimeLeaseId: text("runtimeLeaseId"),
		runtimeLeaseExpiresAt: integer("runtimeLeaseExpiresAt", {
			mode: "timestamp",
		}),
		runtimeFailureReasonCode: text("runtimeFailureReasonCode"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("workspace_sessions_projectId_idx").on(table.projectId),
		index("workspace_sessions_userId_idx").on(table.userId),
		index("workspace_sessions_sandboxIdentityId_idx").on(
			table.sandboxIdentityId,
		),
	],
);

export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		sessionId: text("sessionId")
			.notNull()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["user", "assistant"] }).notNull(),
		content: text("content").notNull(),
		model: text("model"),
		/** JSON-encoded AssistantMessagePart[] for assistant messages (legacy StreamToolCall[] still parseable) */
		tools: text("tools"),
		/**
		 * Terminal write lifecycle for assistant rows:
		 * pending while streaming, complete on success, failed on partial/error.
		 * User rows and historical rows default to complete.
		 */
		status: text("status", {
			enum: ["pending", "complete", "failed"],
		})
			.notNull()
			.default("complete"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("messages_sessionId_idx").on(table.sessionId),
		index("messages_projectId_idx").on(table.projectId),
	],
);

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: integer("accessTokenExpiresAt", {
			mode: "timestamp",
		}),
		refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
			mode: "timestamp",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
		createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const ARCHIVE_OWNER_KINDS = [
	"project_seed",
	"workspace_recovery",
] as const;

export const ARCHIVE_STATUSES = [
	"uploading",
	"ready",
	"abandoned",
	"deleting",
] as const;

export const archives = sqliteTable(
	"archives",
	{
		id: text("id").primaryKey(),
		ownerKind: text("ownerKind", {
			enum: ARCHIVE_OWNER_KINDS,
		}).notNull(),
		ownerId: text("ownerId").notNull(),
		objectKey: text("objectKey").notNull(),
		formatVersion: integer("formatVersion", { mode: "number" }).notNull(),
		compatibilityKey: text("compatibilityKey").notNull(),
		byteCount: integer("byteCount", { mode: "number" }).notNull().default(0),
		digest: text("digest").notNull(),
		generation: integer("generation", { mode: "number" }).notNull().default(0),
		status: text("status", {
			enum: ARCHIVE_STATUSES,
		}).notNull(),
		cleanupRetryAt: integer("cleanupRetryAt", { mode: "number" }),
		cleanupAttempts: integer("cleanupAttempts", { mode: "number" })
			.notNull()
			.default(0),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("archives_ownerKind_ownerId_idx").on(table.ownerKind, table.ownerId),
		index("archives_status_cleanupRetryAt_idx").on(
			table.status,
			table.cleanupRetryAt,
		),
		uniqueIndex("archives_objectKey_uidx").on(table.objectKey),
	],
);

export const SANDBOX_IDENTITY_KINDS = [
	"project_seed",
	"workspace_session",
] as const;

export const SANDBOX_IDENTITY_STATES = [
	"unprovisioned",
	"queued",
	"provisioning",
	"ready",
	"restoring",
	"destroying",
	"destroyed",
	"failed",
] as const;

export const PRIVILEGED_OPERATION_FAMILIES = [
	"model",
	"git_transport",
	"ditto_action",
] as const;

export const PROJECT_SEED_BUILD_STATES = [
	"pending",
	"ready",
	"failed",
] as const;

export const sandboxIdentities = sqliteTable(
	"sandbox_identities",
	{
		id: text("id").primaryKey(),
		kind: text("kind", {
			enum: SANDBOX_IDENTITY_KINDS,
		}).notNull(),
		sandboxId: text("sandboxId").notNull(),
		containerId: text("containerId").notNull(),
		userId: text("userId").notNull(),
		projectId: text("projectId").notNull(),
		workspaceSessionId: text("workspaceSessionId"),
		lifecycleGeneration: integer("lifecycleGeneration", { mode: "number" })
			.notNull()
			.default(1),
		state: text("state", {
			enum: SANDBOX_IDENTITY_STATES,
		}).notNull(),
		retiredAt: integer("retiredAt", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		uniqueIndex("sandbox_identities_sandboxId_uidx").on(table.sandboxId),
		index("sandbox_identities_kind_projectId_idx").on(
			table.kind,
			table.projectId,
		),
	],
);

export const privilegedOperations = sqliteTable(
	"privileged_operations",
	{
		id: text("id").primaryKey(),
		identityId: text("identityId").notNull(),
		lifecycleGeneration: integer("lifecycleGeneration", {
			mode: "number",
		}).notNull(),
		family: text("family", {
			enum: PRIVILEGED_OPERATION_FAMILIES,
		}).notNull(),
		type: text("type").notNull(),
		contractVersion: integer("contractVersion", { mode: "number" }).notNull(),
		repository: text("repository"),
		allowedRefs: text("allowedRefs"),
		maxRequests: integer("maxRequests", { mode: "number" }),
		consumedRequests: integer("consumedRequests", { mode: "number" })
			.notNull()
			.default(0),
		/** Durable OpenCode contract-denial count for the open operation. */
		contractDenials: integer("contractDenials", { mode: "number" })
			.notNull()
			.default(0),
		/** JSON contract payload (push preflight HEAD + advertised old OID). */
		contractState: text("contractState"),
		openedAt: integer("openedAt", { mode: "timestamp" }).notNull(),
		expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
		closedAt: integer("closedAt", { mode: "timestamp" }),
		closeReason: text("closeReason"),
		/** Worker-generated; never accept from the sandbox. */
		correlationId: text("correlationId").notNull(),
		/**
		 * Partial-open uniqueness sentinel: `'open'` while the operation is open,
		 * then the operation id once closed. Enforces one open row per identity+family.
		 */
		openSlot: text("openSlot").notNull().default("open"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("privileged_operations_identityId_idx").on(table.identityId),
		uniqueIndex("privileged_operations_open_family_uidx").on(
			table.identityId,
			table.family,
			table.openSlot,
		),
	],
);

export const projectSeeds = sqliteTable(
	"project_seeds",
	{
		id: text("id").primaryKey(),
		projectId: text("projectId").notNull(),
		sourceCommit: text("sourceCommit"),
		archiveId: text("archiveId"),
		formatVersion: integer("formatVersion", { mode: "number" }).notNull(),
		compatibilityKey: text("compatibilityKey").notNull(),
		buildState: text("buildState", {
			enum: PROJECT_SEED_BUILD_STATES,
		}).notNull(),
		failureReasonCode: text("failureReasonCode"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [uniqueIndex("project_seeds_projectId_uidx").on(table.projectId)],
);

export const WORKSPACE_RECOVERY_STATES = [
	"healthy",
	"pending",
	"degraded",
	"failed",
] as const;

export const workspaceSessionRecoveries = sqliteTable(
	"workspace_session_recoveries",
	{
		sessionId: text("sessionId")
			.primaryKey()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		mutationGeneration: integer("mutationGeneration", { mode: "number" })
			.notNull()
			.default(0),
		durableGeneration: integer("durableGeneration", { mode: "number" })
			.notNull()
			.default(0),
		pendingGeneration: integer("pendingGeneration", { mode: "number" }),
		pendingSince: integer("pendingSince", { mode: "timestamp" }),
		currentArchiveId: text("currentArchiveId"),
		previousArchiveId: text("previousArchiveId"),
		state: text("state", {
			enum: WORKSPACE_RECOVERY_STATES,
		})
			.notNull()
			.default("healthy"),
		reasonCode: text("reasonCode"),
		retryAttempts: integer("retryAttempts", { mode: "number" })
			.notNull()
			.default(0),
		retryAt: integer("retryAt", { mode: "number" }),
		checkpointLeaseId: text("checkpointLeaseId"),
		checkpointLeaseExpiresAt: integer("checkpointLeaseExpiresAt", {
			mode: "timestamp",
		}),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
);

export const WORKSPACE_WORK_INTENTS = [
	"agent_run",
	"git_mutation",
	"preview_start",
	"recovery_retry",
	"archive",
	"destruction",
] as const;

export const WORKSPACE_WORK_STATUSES = [
	"queued",
	"leased",
	"running",
	"complete",
	"failed",
	"cancelled",
] as const;

/**
 * Durable runtime work. Callers persist identifiers and bounded payload only —
 * never Request, Response, Error, functions, streams, or class instances.
 */
export const workspaceRuntimeWork = sqliteTable(
	"workspace_runtime_work",
	{
		id: text("id").primaryKey(),
		fifoSeq: integer("fifoSeq").notNull(),
		identityId: text("identityId"),
		sessionId: text("sessionId"),
		projectId: text("projectId").notNull(),
		userId: text("userId").notNull(),
		intent: text("intent", {
			enum: WORKSPACE_WORK_INTENTS,
		}).notNull(),
		payload: text("payload"),
		status: text("status", {
			enum: WORKSPACE_WORK_STATUSES,
		})
			.notNull()
			.default("queued"),
		leaseToken: text("leaseToken"),
		leaseExpiresAt: integer("leaseExpiresAt"),
		retryCount: integer("retryCount", { mode: "number" }).notNull().default(0),
		reasonCode: text("reasonCode"),
		queueExpiresAt: integer("queueExpiresAt").notNull(),
		userMessageId: text("userMessageId"),
		assistantMessageId: text("assistantMessageId"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		uniqueIndex("workspace_runtime_work_fifoSeq_uidx").on(table.fifoSeq),
		index("workspace_runtime_work_status_fifoSeq_idx").on(
			table.status,
			table.fifoSeq,
		),
		index("workspace_runtime_work_sessionId_idx").on(table.sessionId),
		index("workspace_runtime_work_userId_idx").on(table.userId),
		index("workspace_runtime_work_projectId_idx").on(table.projectId),
		uniqueIndex("workspace_runtime_work_assistantMessageId_uidx").on(
			table.assistantMessageId,
		),
	],
);

/** Unexpired rows are running workspace-session capacity slots. */
export const workspaceCapacityLeases = sqliteTable(
	"workspace_capacity_leases",
	{
		id: text("id").primaryKey(),
		sessionId: text("sessionId").notNull(),
		userId: text("userId").notNull(),
		identityId: text("identityId"),
		leaseToken: text("leaseToken").notNull(),
		expiresAt: integer("expiresAt").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		uniqueIndex("workspace_capacity_leases_sessionId_uidx").on(table.sessionId),
		index("workspace_capacity_leases_userId_expiresAt_idx").on(
			table.userId,
			table.expiresAt,
		),
		index("workspace_capacity_leases_expiresAt_idx").on(table.expiresAt),
	],
);
