import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	PROJECT_MEMORY_PATH,
	WORKSPACE_PATH,
	WORKSPACE_SESSION_STATUSES,
} from "#/lib/workspace-policy";

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
		sandboxId: text("sandboxId"),
		sandboxBackup: text("sandboxBackup"),
		sandboxBackupCreatedAt: integer("sandboxBackupCreatedAt", {
			mode: "timestamp",
		}),
		sandboxBackupRequestedGeneration: integer(
			"sandboxBackupRequestedGeneration",
		)
			.notNull()
			.default(0),
		sandboxBackupStoredGeneration: integer("sandboxBackupStoredGeneration")
			.notNull()
			.default(0),
		status: text("status", {
			enum: ["provisioning", "ready", "failed"],
		})
			.notNull()
			.default("provisioning"),
		envVars: text("envVars"),
		previewLockToken: text("previewLockToken"),
		previewLockExpiresAt: integer("previewLockExpiresAt"),
		deletingAt: integer("deletingAt"),
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
		workspacePath: text("workspacePath").notNull().default(WORKSPACE_PATH),
		memoryPath: text("memoryPath").notNull().default(PROJECT_MEMORY_PATH),
		status: text("status", { enum: [...WORKSPACE_SESSION_STATUSES] })
			.notNull()
			.default("active"),
		previewPort: integer("previewPort"),
		/**
		 * Nullable for legacy shared-sandbox sessions. No FK: identity
		 * tombstones are permanent and never cascade-deleted.
		 */
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
		uniqueIndex("workspace_sessions_project_preview_port_uidx").on(
			table.projectId,
			table.previewPort,
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

/** Leftover account-provider rows. Not a current product path; pending removal. */
export const aiProviderCredentials = sqliteTable(
	"ai_provider_credentials",
	{
		id: text("id").primaryKey(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		providerId: text("providerId").notNull(),
		authType: text("authType", { enum: ["api_key", "oauth"] }).notNull(),
		encryptedCredential: text("encryptedCredential").notNull(),
		/** Safe model projection JSON only — never headers/endpoints/auth. */
		modelCatalog: text("modelCatalog").notNull(),
		status: text("status", { enum: ["connected", "needs_relogin"] })
			.notNull()
			.default("connected"),
		lastErrorCode: text("lastErrorCode"),
		version: integer("version").notNull().default(1),
		leaseId: text("leaseId"),
		leaseExpiresAt: integer("leaseExpiresAt", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(table) => [
		uniqueIndex("ai_provider_credentials_user_provider_uidx").on(
			table.userId,
			table.providerId,
		),
		index("ai_provider_credentials_userId_idx").on(table.userId),
	],
);

export const ARCHIVE_OWNER_KINDS = [
	"legacy_project",
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

/** Leftover provider-login attempt rows. Not a current product path; pending removal. */
export const providerAuthAttempts = sqliteTable(
	"provider_auth_attempts",
	{
		id: text("id").primaryKey(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		providerId: text("providerId").notNull(),
		authType: text("authType", { enum: ["api_key", "oauth"] }).notNull(),
		authSandboxId: text("authSandboxId"),
		status: text("status", {
			enum: ["pending", "complete", "failed", "cancelled"],
		})
			.notNull()
			.default("pending"),
		expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(table) => [index("provider_auth_attempts_userId_idx").on(table.userId)],
);
