import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth-schema.ts";

/** Each Ditto account's one personal workspace (ADR-0005). */
export const personalWorkspace = sqliteTable("personal_workspace", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id").notNull().unique(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
});

/**
 * A projection of each workspace's bot membership, so the app can list bots without waking
 * the Workspace object. The object is the authority and rebuilds this from its membership.
 */
export const workspaceBot = sqliteTable(
	"workspace_bot",
	{
		workspaceId: text("workspace_id").notNull(),
		botId: text("bot_id").notNull(),
		name: text("name").notNull(),
	},
	(table) => [primaryKey({ columns: [table.workspaceId, table.botId] })],
);
