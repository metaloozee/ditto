import { sql } from "drizzle-orm";
import {
	check,
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
		runtimeOwner: text("runtimeOwner", {
			enum: ["legacy", "migrating", "trusted_v1", "blocked"],
		})
			.notNull()
			.default("legacy"),
		runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull().default(1),
		brainIdentityId: text("brainIdentityId"),
		runtimeProtocolVersion: integer("runtimeProtocolVersion"),
		runtimeJournalVersion: integer("runtimeJournalVersion"),
		productProjectionVersion: integer("productProjectionVersion")
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
	"trusted_brain",
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
		controllerClass: text("controllerClass"),
		controllerNamespace: text("controllerNamespace"),
		incarnationId: text("incarnationId"),
		incarnationStartedAt: integer("incarnationStartedAt"),
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
		runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull().default(1),
		runId: text("runId"),
		runEpoch: integer("runEpoch"),
		incarnationId: text("incarnationId"),
		admissionReference: text("admissionReference"),
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
		startupRoles: text("startupRoles"),
		startupPools: text("startupPools"),
		expectedRuntimeOwnerVersion: integer("expectedRuntimeOwnerVersion"),
		expectedIdentityId: text("expectedIdentityId"),
		startupDeadline: integer("startupDeadline"),
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
		protocolVersion: integer("protocolVersion"),
		runtimeOwner: text("runtimeOwner", { enum: ["legacy", "trusted_v1"] })
			.notNull()
			.default("legacy"),
		runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull().default(1),
		commandId: text("commandId"),
		deliveryState: text("deliveryState", {
			enum: ["pending", "leased", "delivered", "acknowledged", "failed"],
		})
			.notNull()
			.default("pending"),
		deliveryLeaseToken: text("deliveryLeaseToken"),
		deliveryLeaseExpiresAt: integer("deliveryLeaseExpiresAt"),
		deliveryAttempts: integer("deliveryAttempts").notNull().default(0),
		startupRoles: text("startupRoles"),
		startupPools: text("startupPools"),
		expectedIdentityId: text("expectedIdentityId"),
		startupDeadline: integer("startupDeadline"),
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
		uniqueIndex("workspace_runtime_work_commandId_uidx").on(table.commandId),
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

export const SESSION_COMMAND_KINDS = [
	"prompt",
	"follow_up",
	"stop",
	"cancel",
	"project_delete",
] as const;
export const SESSION_COMMAND_TARGET_KINDS = [
	"project",
	"workspace_session",
] as const;

export const sessionCommands = sqliteTable(
	"session_commands",
	{
		id: text("id").primaryKey(),
		userId: text("userId").notNull(),
		targetKind: text("targetKind", {
			enum: SESSION_COMMAND_TARGET_KINDS,
		}).notNull(),
		targetId: text("targetId").notNull(),
		projectId: text("projectId").notNull(),
		sessionId: text("sessionId"),
		kind: text("kind", { enum: SESSION_COMMAND_KINDS }).notNull(),
		commandSeq: integer("commandSeq"),
		targetRunId: text("targetRunId"),
		targetCommandId: text("targetCommandId"),
		payloadVersion: integer("payloadVersion").notNull(),
		userMessageId: text("userMessageId"),
		assistantMessageId: text("assistantMessageId"),
		payloadDigest: text("payloadDigest").notNull(),
		acceptedAt: integer("acceptedAt").notNull(),
		deadlineAt: integer("deadlineAt").notNull(),
		admissionVersion: integer("admissionVersion").notNull().default(1),
		executionProjectionVersion: integer("executionProjectionVersion")
			.notNull()
			.default(0),
		reasonCode: text("reasonCode"),
	},
	(table) => [
		uniqueIndex("session_commands_session_seq_uidx").on(
			table.sessionId,
			table.commandSeq,
		),
		index("session_commands_user_target_idx").on(
			table.userId,
			table.targetKind,
			table.targetId,
		),
		check(
			"session_commands_kind_enum",
			sql`${table.kind} IN ('prompt', 'follow_up', 'stop', 'cancel', 'project_delete')`,
		),
		check(
			"session_commands_target_kind_enum",
			sql`${table.targetKind} IN ('project', 'workspace_session')`,
		),
		check(
			"session_commands_target_shape",
			sql`(${table.kind} = 'project_delete' AND ${table.targetKind} = 'project' AND ${table.sessionId} IS NULL AND ${table.commandSeq} IS NULL) OR (${table.kind} != 'project_delete' AND ${table.targetKind} = 'workspace_session' AND ${table.sessionId} IS NOT NULL AND ${table.commandSeq} IS NOT NULL AND typeof(${table.commandSeq}) = 'integer' AND ${table.commandSeq} > 0)`,
		),
		check(
			"session_commands_message_shape",
			sql`(${table.kind} IN ('prompt', 'follow_up') AND ${table.userMessageId} IS NOT NULL AND ${table.assistantMessageId} IS NOT NULL) OR (${table.kind} NOT IN ('prompt', 'follow_up') AND ${table.userMessageId} IS NULL AND ${table.assistantMessageId} IS NULL)`,
		),
		check(
			"session_commands_run_shape",
			sql`(${table.kind} IN ('follow_up', 'stop') AND ${table.targetRunId} IS NOT NULL AND ${table.targetCommandId} IS NULL) OR (${table.kind} = 'cancel' AND ${table.targetRunId} IS NULL AND ${table.targetCommandId} IS NOT NULL) OR (${table.kind} NOT IN ('follow_up', 'stop', 'cancel') AND ${table.targetRunId} IS NULL AND ${table.targetCommandId} IS NULL)`,
		),
		check(
			"session_commands_versions",
			sql`typeof(${table.payloadVersion}) = 'integer' AND ${table.payloadVersion} > 0 AND typeof(${table.admissionVersion}) = 'integer' AND ${table.admissionVersion} > 0 AND typeof(${table.executionProjectionVersion}) = 'integer' AND ${table.executionProjectionVersion} >= 0`,
		),
	],
);

export const sessionCommandKeys = sqliteTable(
	"session_command_keys",
	{
		id: text("id").primaryKey(),
		userId: text("userId").notNull(),
		targetKind: text("targetKind", {
			enum: SESSION_COMMAND_TARGET_KINDS,
		}).notNull(),
		targetId: text("targetId").notNull(),
		idempotencyKey: text("idempotencyKey").notNull(),
		commandKind: text("commandKind", { enum: SESSION_COMMAND_KINDS }).notNull(),
		canonicalPayloadHash: text("canonicalPayloadHash").notNull(),
		commandId: text("commandId").notNull(),
		receiptId: text("receiptId").notNull(),
		createdAt: integer("createdAt").notNull(),
	},
	(table) => [
		uniqueIndex("session_command_keys_scope_uidx").on(
			table.userId,
			table.targetKind,
			table.targetId,
			table.idempotencyKey,
		),
		uniqueIndex("session_command_keys_receipt_uidx").on(table.receiptId),
	],
);

export const sessionCommandSequences = sqliteTable(
	"session_command_sequences",
	{
		sessionId: text("sessionId").primaryKey(),
		nextSequence: integer("nextSequence").notNull().default(1),
		updatedAt: integer("updatedAt").notNull(),
	},
	(table) => [
		check("session_command_sequences_positive", sql`${table.nextSequence} > 0`),
	],
);

export const runtimeCapacityPolicy = sqliteTable(
	"runtime_capacity_policy",
	{
		id: integer("id").primaryKey(),
		accountingMode: text("accountingMode", { enum: ["legacy", "unified"] })
			.notNull()
			.default("legacy"),
		version: integer("version").notNull().default(1),
		updatedAt: integer("updatedAt").notNull(),
	},
	(table) => [
		check("runtime_capacity_policy_singleton", sql`${table.id} = 1`),
		check(
			"runtime_capacity_policy_mode",
			sql`${table.accountingMode} IN ('legacy', 'unified')`,
		),
		check(
			"runtime_capacity_policy_version",
			sql`typeof(${table.version}) = 'integer' AND ${table.version} > 0`,
		),
	],
);

export const runtimeCapacityReservations = sqliteTable(
	"runtime_capacity_reservations",
	{
		id: text("id").primaryKey(),
		pool: text("pool", { enum: ["brain", "execution"] }).notNull(),
		ownerKind: text("ownerKind", {
			enum: ["workspace_session", "builder", "preview"],
		}).notNull(),
		ownerId: text("ownerId").notNull(),
		userId: text("userId").notNull(),
		sessionId: text("sessionId"),
		identityId: text("identityId").notNull(),
		incarnationId: text("incarnationId"),
		reservationGroupId: text("reservationGroupId").notNull(),
		observedState: text("observedState", {
			enum: ["reserved", "starting", "running", "terminating", "released"],
		}).notNull(),
		expiresAt: integer("expiresAt"),
		runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull(),
		accountingVersion: integer("accountingVersion").notNull(),
		activeSlot: text("activeSlot").notNull().default("active"),
		createdAt: integer("createdAt").notNull(),
		updatedAt: integer("updatedAt").notNull(),
	},
	(table) => [
		uniqueIndex("runtime_capacity_reservations_identity_pool_active_uidx").on(
			table.identityId,
			table.pool,
			table.activeSlot,
		),
		check(
			"runtime_capacity_reservations_enums",
			sql`${table.pool} IN ('brain', 'execution') AND ${table.ownerKind} IN ('workspace_session', 'builder', 'preview') AND ${table.observedState} IN ('reserved', 'starting', 'running', 'terminating', 'released')`,
		),
		check(
			"runtime_capacity_reservations_versions",
			sql`typeof(${table.runtimeOwnerVersion}) = 'integer' AND ${table.runtimeOwnerVersion} > 0 AND typeof(${table.accountingVersion}) = 'integer' AND ${table.accountingVersion} > 0`,
		),
	],
);

export const runtimeCheckpointPairs = sqliteTable("runtime_checkpoint_pairs", {
	id: text("id").primaryKey(),
	sessionId: text("sessionId").notNull(),
	archiveId: text("archiveId").notNull(),
	continuationObjectKey: text("continuationObjectKey").notNull(),
	archiveDigest: text("archiveDigest").notNull(),
	continuationDigest: text("continuationDigest").notNull(),
	archiveByteCount: integer("archiveByteCount").notNull(),
	continuationByteCount: integer("continuationByteCount").notNull(),
	compatibilityKey: text("compatibilityKey").notNull(),
	brainIdentityId: text("brainIdentityId").notNull(),
	brainIncarnationId: text("brainIncarnationId").notNull(),
	executorIdentityId: text("executorIdentityId").notNull(),
	executorIncarnationId: text("executorIncarnationId").notNull(),
	mutationGeneration: integer("mutationGeneration").notNull(),
	executionPosition: integer("executionPosition").notNull(),
	outstandingEffectCount: integer("outstandingEffectCount").notNull(),
	outstandingEffectSummary: text("outstandingEffectSummary").notNull(),
	createdAt: integer("createdAt").notNull(),
});

export const runtimeCheckpointPointers = sqliteTable(
	"runtime_checkpoint_pointers",
	{
		sessionId: text("sessionId").primaryKey(),
		runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull(),
		currentPairId: text("currentPairId"),
		previousPairId: text("previousPairId"),
		mutationGeneration: integer("mutationGeneration").notNull(),
		updatedAt: integer("updatedAt").notNull(),
	},
);

export const runtimeProjectionCursors = sqliteTable(
	"runtime_projection_cursors",
	{
		sessionId: text("sessionId").notNull(),
		targetKind: text("targetKind", {
			enum: ["command", "message", "session"],
		}).notNull(),
		targetId: text("targetId").notNull(),
		runtimeOwnerVersion: integer("runtimeOwnerVersion").notNull(),
		coordinatorSeq: integer("coordinatorSeq").notNull(),
		updatedAt: integer("updatedAt").notNull(),
	},
	(table) => [
		uniqueIndex("runtime_projection_cursors_target_uidx").on(
			table.sessionId,
			table.targetKind,
			table.targetId,
		),
	],
);

export const runtimeCommandMemberships = sqliteTable(
	"runtime_command_memberships",
	{
		commandId: text("commandId").primaryKey(),
		sessionId: text("sessionId").notNull(),
		runId: text("runId"),
		userMessageId: text("userMessageId"),
		assistantMessageId: text("assistantMessageId"),
		runEpoch: integer("runEpoch"),
	},
);

export const runtimeMigrations = sqliteTable("runtime_migrations", {
	id: text("id").primaryKey(),
	sessionId: text("sessionId").notNull(),
	expectedOwner: text("expectedOwner", {
		enum: ["legacy", "migrating", "trusted_v1", "blocked"],
	}).notNull(),
	expectedOwnerVersion: integer("expectedOwnerVersion").notNull(),
	sourceArchiveId: text("sourceArchiveId"),
	sourceIdentityId: text("sourceIdentityId"),
	startupRoles: text("startupRoles"),
	startupPools: text("startupPools"),
	expectedIdentityId: text("expectedIdentityId"),
	startupDeadline: integer("startupDeadline"),
	state: text("state", { enum: ["pending", "complete", "failed"] }).notNull(),
	createdAt: integer("createdAt").notNull(),
});

export const runtimeCleanupJobs = sqliteTable("runtime_cleanup_jobs", {
	id: text("id").primaryKey(),
	targetKind: text("targetKind", {
		enum: ["project", "workspace_session"],
	}).notNull(),
	targetId: text("targetId").notNull(),
	state: text("state", {
		enum: ["pending", "running", "complete", "failed"],
	}).notNull(),
	retryAt: integer("retryAt"),
	attempts: integer("attempts").notNull().default(0),
	createdAt: integer("createdAt").notNull(),
});

export const runtimeDeletedTargetFences = sqliteTable(
	"runtime_deleted_target_fences",
	{
		targetKind: text("targetKind", {
			enum: ["project", "workspace_session"],
		}).notNull(),
		targetId: text("targetId").notNull(),
		lastOwnerVersion: integer("lastOwnerVersion").notNull(),
		deletedAt: integer("deletedAt").notNull(),
	},
	(table) => [
		uniqueIndex("runtime_deleted_target_fences_target_uidx").on(
			table.targetKind,
			table.targetId,
		),
	],
);

export const runtimeRetiredIdentityFences = sqliteTable(
	"runtime_retired_identity_fences",
	{
		identityId: text("identityId").primaryKey(),
		lifecycleGeneration: integer("lifecycleGeneration").notNull(),
		retiredAt: integer("retiredAt").notNull(),
	},
);
