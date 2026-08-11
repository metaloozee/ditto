import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
	check,
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

export const AGENT_RUN_STATUSES = [
	"accepted",
	"running",
	"stopping",
	"finalizing",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
] as const;
export const AGENT_RUN_TERMINAL_STATUSES = [
	"completed",
	"failed",
	"cancelled",
	"interrupted",
] as const;
export const PI_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export const agentRuns = sqliteTable(
	"agent_runs",
	{
		id: text("id").primaryKey(),
		workspaceSessionId: text("workspaceSessionId")
			.notNull()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		predecessorRunId: text("predecessorRunId").references(
			(): AnySQLiteColumn => agentRuns.id,
			{ onDelete: "set null" },
		),
		status: text("status", { enum: AGENT_RUN_STATUSES })
			.notNull()
			.default("accepted"),
		currentExecutionEpoch: integer("currentExecutionEpoch"),
		stopRequestId: text("stopRequestId"),
		stopRequestedAt: integer("stopRequestedAt", { mode: "timestamp" }),
		outcomeCode: text("outcomeCode"),
		acceptedAt: integer("acceptedAt", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		startedAt: integer("startedAt", { mode: "timestamp" }),
		finalizingAt: integer("finalizingAt", { mode: "timestamp" }),
		finishedAt: integer("finishedAt", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(table) => [
		uniqueIndex("agent_runs_session_sequence_uidx").on(
			table.workspaceSessionId,
			table.sequence,
		),
		uniqueIndex("agent_runs_predecessor_uidx").on(table.predecessorRunId),
		index("agent_runs_project_session_status_idx").on(
			table.projectId,
			table.workspaceSessionId,
			table.status,
		),
		index("agent_runs_userId_idx").on(table.userId),
		check("agent_runs_sequence_positive_ck", sql`${table.sequence} > 0`),
		check(
			"agent_runs_status_ck",
			sql`${table.status} IN ('accepted','running','stopping','finalizing','completed','failed','cancelled','interrupted')`,
		),
		check(
			"agent_runs_epoch_positive_ck",
			sql`${table.currentExecutionEpoch} IS NULL OR ${table.currentExecutionEpoch} > 0`,
		),
		check(
			"agent_runs_terminal_shape_ck",
			sql`(${table.status} IN ('completed','failed','cancelled','interrupted') AND ${table.finishedAt} IS NOT NULL) OR (${table.status} NOT IN ('completed','failed','cancelled','interrupted') AND ${table.finishedAt} IS NULL)`,
		),
		check(
			"agent_runs_outcome_shape_ck",
			sql`(${table.status} IN ('completed','failed','cancelled','interrupted') OR ${table.outcomeCode} IS NULL) AND (${table.outcomeCode} IS NULL OR (length(${table.outcomeCode}) <= 128 AND length(${table.outcomeCode}) > 0 AND ${table.outcomeCode} NOT GLOB '*[^a-z0-9_:-]*'))`,
		),
	],
);

export const piAgentSessions = sqliteTable(
	"pi_agent_sessions",
	{
		workspaceSessionId: text("workspaceSessionId")
			.primaryKey()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		currentRunId: text("currentRunId").references(() => agentRuns.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(table) => [
		index("pi_agent_sessions_project_user_idx").on(
			table.projectId,
			table.userId,
		),
	],
);

export const turns = sqliteTable(
	"turns",
	{
		id: text("id").primaryKey(),
		runId: text("runId")
			.notNull()
			.references(() => agentRuns.id, { onDelete: "cascade" }),
		workspaceSessionId: text("workspaceSessionId")
			.notNull()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		requestId: text("requestId").notNull(),
		userMessageId: text("userMessageId")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		assistantMessageId: text("assistantMessageId")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		modelSpecifier: text("modelSpecifier").notNull(),
		thinkingLevel: text("thinkingLevel", { enum: PI_THINKING_LEVELS }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(table) => [
		uniqueIndex("turns_run_sequence_uidx").on(table.runId, table.sequence),
		uniqueIndex("turns_user_request_uidx").on(table.userId, table.requestId),
		uniqueIndex("turns_user_message_uidx").on(table.userMessageId),
		uniqueIndex("turns_assistant_message_uidx").on(table.assistantMessageId),
		index("turns_project_session_run_idx").on(
			table.projectId,
			table.workspaceSessionId,
			table.runId,
		),
		check("turns_sequence_positive_ck", sql`${table.sequence} > 0`),
		check(
			"turns_request_nonempty_ck",
			sql`length(trim(${table.requestId})) > 0 AND length(${table.requestId}) <= 128`,
		),
		check(
			"turns_model_nonempty_ck",
			sql`length(trim(${table.modelSpecifier})) > 0`,
		),
		check(
			"turns_thinking_level_ck",
			sql`${table.thinkingLevel} IS NULL OR ${table.thinkingLevel} IN ('off','minimal','low','medium','high','xhigh','max')`,
		),
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

/** Account-scoped AI provider credentials. D1 is the sole authority. */
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

/** Non-secret coordination for in-flight provider login attempts. */
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
