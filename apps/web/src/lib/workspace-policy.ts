export const WORKSPACE_SESSION_STATUSES = ["active", "archived"] as const;

export const WORKSPACE_PATH = "/workspace";
export const PROJECT_MEMORY_PATH = "/workspace/.ditto/project-memory.md";
export const SESSION_WORKTREE_ROOT = `${WORKSPACE_PATH}/.ditto/worktrees`;
export const SESSION_WORKSPACE_LOCK_ROOT = "/tmp/ditto-session-locks";

export const SESSION_PREVIEW_PORT_MIN = 10000;
export const SESSION_PREVIEW_PORT_MAX = 10031;
export const SESSION_PREVIEW_PORT_COUNT =
	SESSION_PREVIEW_PORT_MAX - SESSION_PREVIEW_PORT_MIN + 1;

function sanitizeSessionSegment(value: string): string {
	const sanitized = value.replaceAll(/[^A-Za-z0-9._-]+/g, "-");
	return sanitized.replaceAll(/-+/g, "-").replaceAll(/^-+|-+$/g, "");
}

export function sessionPreviewProcessId(sessionId: string): string {
	const segment = sanitizeSessionSegment(sessionId) || "session";
	return `ditto-preview-${segment}`;
}

export function isSessionPreviewPort(port: number): boolean {
	return (
		Number.isInteger(port) &&
		port >= SESSION_PREVIEW_PORT_MIN &&
		port <= SESSION_PREVIEW_PORT_MAX
	);
}

export function sessionWorktreePath(sessionId: string): string {
	const segment = sanitizeSessionSegment(sessionId) || "session";
	return `${SESSION_WORKTREE_ROOT}/${segment}`;
}

export function sessionBranchName(sessionId: string): string {
	const segment = sanitizeSessionSegment(sessionId).slice(0, 12) || "unknown";
	return `ditto/session-${segment}`;
}

export function sessionWorkspaceLockPath(sessionId: string): string {
	const segment = sanitizeSessionSegment(sessionId) || "session";
	return `${SESSION_WORKSPACE_LOCK_ROOT}/${segment}.lock`;
}

export type WorkspaceSessionStatus =
	(typeof WORKSPACE_SESSION_STATUSES)[number];

export function makeSessionTitleFromMessage(message: string): string {
	const words = message
		.trim()
		.replaceAll(/\s+/g, " ")
		.split(" ")
		.filter(Boolean);
	const title = words.slice(0, 10).join(" ");

	return words.length > 10 ? `${title}...` : title;
}
