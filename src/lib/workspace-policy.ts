export const WORKSPACE_SESSION_STATUSES = ["active", "archived"] as const;

export const WORKSPACE_PATH = "/workspace";
export const PROJECT_MEMORY_PATH = "/workspace/.ditto/project-memory.md";

export type WorkspaceSessionStatus =
	(typeof WORKSPACE_SESSION_STATUSES)[number];

export function makeSessionTitleFromMessage(message: string): string {
	const words = message
		.trim()
		.replaceAll(/\s+/g, " ")
		.split(" ")
		.filter(Boolean);
	const title = words.slice(0, 3).join(" ");

	return words.length > 3 ? `${title}...` : title;
}
