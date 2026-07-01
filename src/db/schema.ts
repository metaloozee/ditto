import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
	AGENT_RUN_EVENT_TYPES,
	AGENT_RUN_STATUSES,
	PROJECT_MEMORY_PATH,
	WORKSPACE_PATH,
	WORKSPACE_SESSION_STATUSES,
} from "#/lib/workspace-policy";
import { DEFAULT_PROJECT_CODER_MODEL } from "#/lib/agent-models";

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
		activeAgentRunId: text("activeAgentRunId"),
		activeAgentRunStartedAt: integer("activeAgentRunStartedAt", {
			mode: "timestamp",
		}),
		status: text("status", {
			enum: ["provisioning", "ready", "failed"],
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
		workspacePath: text("workspacePath").notNull().default(WORKSPACE_PATH),
		memoryPath: text("memoryPath").notNull().default(PROJECT_MEMORY_PATH),
		status: text("status", { enum: [...WORKSPACE_SESSION_STATUSES] })
			.notNull()
			.default("active"),
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
	],
);

export const agentRuns = sqliteTable(
	"agent_runs",
	{
		id: text("id").primaryKey(),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sessionId: text("sessionId")
			.notNull()
			.references(() => workspaceSessions.id, { onDelete: "cascade" }),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: text("status", { enum: [...AGENT_RUN_STATUSES] })
			.notNull()
			.default("pending"),
		isMutating: integer("isMutating", { mode: "boolean" })
			.notNull()
			.default(true),
		modelSpecifier: text("modelSpecifier")
			.notNull()
			.default(DEFAULT_PROJECT_CODER_MODEL),
		userMessage: text("userMessage").notNull(),
		question: text("question"),
		recommendedAnswer: text("recommendedAnswer"),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		updatedAt: integer("updated_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
		finishedAt: integer("finishedAt", { mode: "timestamp" }),
	},
	(table) => [
		index("agent_runs_projectId_idx").on(table.projectId),
		index("agent_runs_sessionId_idx").on(table.sessionId),
		index("agent_runs_userId_idx").on(table.userId),
		index("agent_runs_status_idx").on(table.status),
	],
);

export const agentRunEvents = sqliteTable(
	"agent_run_events",
	{
		id: integer("id", { mode: "number" }).primaryKey({
			autoIncrement: true,
		}),
		runId: text("runId"),
		projectId: text("projectId")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sessionId: text("sessionId"),
		type: text("type", { enum: [...AGENT_RUN_EVENT_TYPES] }).notNull(),
		payload: text("payload").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).default(
			sql`(unixepoch())`,
		),
	},
	(table) => [
		index("agent_run_events_runId_idx").on(table.runId),
		index("agent_run_events_projectId_idx").on(table.projectId),
		index("agent_run_events_sessionId_idx").on(table.sessionId),
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
