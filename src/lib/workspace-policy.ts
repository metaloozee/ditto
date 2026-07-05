export const WORKSPACE_SESSION_STATUSES = ["active", "archived"] as const;

export const AGENT_RUN_STATUSES = [
	"pending",
	"running",
	"needs_input",
	"completed",
	"failed",
	"canceled",
] as const;

export const AGENT_RUN_EVENT_TYPES = [
	"message",
	"tool_started",
	"tool_finished",
	"command_output",
	"file_changed",
	"diff_ready",
	"export_started",
	"export_completed",
	"export_failed",
	"needs_input",
	"lock_rejected",
	"done",
	"error",
	"snapshot_started",
	"snapshot_completed",
	"snapshot_failed",
] as const;

export const WORKSPACE_PATH = "/workspace";
export const DITTO_DIR = "/workspace/.ditto";
export const PROJECT_MEMORY_PATH = "/workspace/.ditto/project-memory.md";

export type WorkspaceSessionStatus =
	(typeof WORKSPACE_SESSION_STATUSES)[number];
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

export function isActiveAgentRunStatus(status: string): boolean {
	return (
		status === "pending" || status === "running" || status === "needs_input"
	);
}

export function makeSessionTitleFromMessage(message: string): string {
	const words = message
		.trim()
		.replaceAll(/\s+/g, " ")
		.split(" ")
		.filter(Boolean);
	const title = words.slice(0, 3).join(" ");

	return words.length > 3 ? `${title}...` : title;
}

export function createAgentRunEventPayload(
	input: Record<string, unknown>,
): string {
	return JSON.stringify({ ...input, schemaVersion: 1 });
}
