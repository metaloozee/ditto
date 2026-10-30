import {
	ContractParseError,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";

/**
 * UI workspace actions. They reach the runtime owner as typed intents and run
 * under the same exclusive mutation ownership as agent tools, restore and
 * archive. Push and pull-request creation are not actions here; they stay
 * disabled until their own gate.
 */
export const WORKSPACE_ACTION_KINDS = [
	"git_status",
	"git_commit",
	"preview_start",
	"preview_stop",
] as const;
export type WorkspaceActionKind = (typeof WORKSPACE_ACTION_KINDS)[number];

export const WORKSPACE_ACTION_LIMITS = {
	idCharacters: 128,
	commitMessageBytes: 4096,
} as const;

/** Fixed preview port; the command is discovered by the executor, never supplied. */
export const WORKSPACE_PREVIEW_PORT = 10_000;
/** Preview may defer a backup this long after the first unbacked mutation, never longer. */
export const WORKSPACE_BACKUP_DEFERRAL_MS = 10 * 60 * 1000;

export type WorkspaceActionV1 =
	| { version: 1; kind: "git_status" }
	| { version: 1; kind: "git_commit"; message: string }
	| { version: 1; kind: "preview_start" }
	| { version: 1; kind: "preview_stop" };

/** Browser form: the owned session it targets, then the action. */
export type BrowserWorkspaceActionV1 = WorkspaceActionV1 & {
	projectId: string;
	sessionId: string;
};

export const WORKSPACE_ACTION_DENIALS = [
	/** A run, tool, restore step or publication holds the workspace. */
	"busy",
	"restore_in_progress",
	/** The session is archived or being archived; its workspace is read-only history. */
	"archived",
	/** The backup deadline passed; mutations wait for a committed pair. */
	"backup_overdue",
	/** An unknown outcome or safety block needs review. */
	"blocked",
	/** No execution is composed for this session. */
	"unavailable",
	/** No execution slot is free for a preview that needs the executor. */
	"capacity",
] as const;
export type WorkspaceActionDenial = (typeof WORKSPACE_ACTION_DENIALS)[number];

export type WorkspaceActionResultV1 =
	| { status: "denied"; reason: WorkspaceActionDenial }
	| {
			status: "git_status";
			branch: string;
			head: string;
			changed: number;
	  }
	| { status: "committed"; head: string }
	| { status: "nothing_to_commit"; head: string }
	/** The action ran with a known error and changed nothing. */
	| { status: "rejected"; reason: string }
	/** The outcome is unknown; the workspace is blocked for review. */
	| { status: "unknown" }
	/** `url` is a bearer capability: return it to the owner only; never log, persist or observe it. */
	| { status: "preview_running"; generation: number; url: string }
	| { status: "preview_stopped"; generation: number }
	/** Neither committed pair restores a cold workspace; the seed is never used. */
	| { status: "preview_unavailable" };

function action(record: Record<string, unknown>): WorkspaceActionV1 {
	const kind = literalField(record, "kind", WORKSPACE_ACTION_KINDS);
	const version = literalField(record, "version", [1] as const);
	if (kind === "git_commit") {
		const message = stringField(record, "message", {
			maxBytes: WORKSPACE_ACTION_LIMITS.commitMessageBytes,
		});
		if (message.trim() === "")
			throw new ContractParseError("invalid_field", "message is empty.");
		return { version, kind, message };
	}
	if (record.message !== undefined)
		throw new ContractParseError(
			"unknown_field",
			"Only a commit carries a message.",
		);
	return { version, kind };
}

export function parseWorkspaceActionV1(value: unknown): WorkspaceActionV1 {
	return action(
		strictRecord(value, ["version", "kind", "message"], "Workspace action"),
	);
}

export function parseBrowserWorkspaceActionV1(
	value: unknown,
): BrowserWorkspaceActionV1 {
	const record = strictRecord(
		value,
		["version", "kind", "message", "projectId", "sessionId"],
		"Workspace action",
	);
	const ids = {
		projectId: stringField(record, "projectId", {
			maxCharacters: WORKSPACE_ACTION_LIMITS.idCharacters,
		}),
		sessionId: stringField(record, "sessionId", {
			maxCharacters: WORKSPACE_ACTION_LIMITS.idCharacters,
		}),
	};
	return { ...action(record), ...ids };
}
