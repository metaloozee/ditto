import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-message-parts";

function formatToolPayload(value: unknown, max = 800): string {
	if (value == null) {
		return "";
	}
	if (typeof value === "string") {
		return value.length > max ? `${value.slice(0, max)}…` : value;
	}
	try {
		const json = JSON.stringify(value, null, 2);
		return json.length > max ? `${json.slice(0, max)}…` : json;
	} catch {
		return String(value);
	}
}

export function formatToolCallDetail(tool: StreamToolCall): string {
	const parts: string[] = [];
	if (tool.args !== undefined) {
		const args = formatToolPayload(tool.args);
		if (args) {
			parts.push(args);
		}
	}
	if (tool.result !== undefined) {
		const result = formatToolPayload(tool.result);
		if (result) {
			parts.push(result);
		}
	}
	return parts.join("\n\n");
}

const TOOL_LABEL_MAX_CHARS = 100;

function truncateToolLabel(text: string, max = TOOL_LABEL_MAX_CHARS): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function toolArgAsLabelText(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.replace(/\s+/g, " ").trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
}

/** Preferred arg keys for non-shell tool labels (first match wins). */
const TOOL_LABEL_ARG_KEYS = [
	"pattern",
	"query",
	"path",
	"file_path",
	"filePath",
	"filename",
	"url",
	"target",
	"glob",
	"search",
	"message",
	"title",
	"branch",
	"repo",
	"content",
	"prompt",
	"text",
	"description",
] as const;

/**
 * Short label for chat UI.
 * Shell tools: the command string. Other tools: `name <primary arg>`.
 */
export function formatToolCallLabel(tool: StreamToolCall): string {
	const args = tool.args;
	if (args && typeof args === "object" && !Array.isArray(args)) {
		const record = args as Record<string, unknown>;

		for (const key of ["command", "cmd"] as const) {
			const command = toolArgAsLabelText(record[key]);
			if (command) {
				return truncateToolLabel(command);
			}
		}

		for (const key of TOOL_LABEL_ARG_KEYS) {
			const value = toolArgAsLabelText(record[key]);
			if (value) {
				return truncateToolLabel(`${tool.name} ${value}`);
			}
		}

		for (const [key, raw] of Object.entries(record)) {
			if (key === "id" || key === "timeout" || key === "cwd") {
				continue;
			}
			const value = toolArgAsLabelText(raw);
			if (value) {
				return truncateToolLabel(`${tool.name} ${value}`);
			}
		}
	}

	return tool.name;
}

export type AssistantPartGroup =
	| { type: "text"; id: string; text: string }
	| { type: "tools"; id: string; tools: StreamToolCall[] }
	| { type: "edit"; id: string; tool: StreamToolCall };

export function isEditTool(tool: StreamToolCall): boolean {
	return tool.name.toLowerCase() === "edit";
}

export type EditToolReplacement = {
	oldText: string;
	newText: string;
};

export type EditToolDiffData = {
	path: string;
	oldContents: string;
	newContents: string;
	/** Unified patch from the tool result when available (full-file context). */
	patch: string | null;
};

function recordString(
	record: Record<string, unknown>,
	...keys: string[]
): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}

function parseEditReplacement(value: unknown): EditToolReplacement | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const oldText = recordString(record, "oldText", "old_string", "old_text");
	const newText = recordString(record, "newText", "new_string", "new_text");
	if (oldText == null || newText == null) {
		return null;
	}
	return { oldText, newText };
}

export function extractEditReplacements(args: unknown): EditToolReplacement[] {
	if (!args || typeof args !== "object" || Array.isArray(args)) {
		return [];
	}
	const record = args as Record<string, unknown>;

	if (Array.isArray(record.edits)) {
		const fromList: EditToolReplacement[] = [];
		for (const item of record.edits) {
			const replacement = parseEditReplacement(item);
			if (replacement) {
				fromList.push(replacement);
			}
		}
		if (fromList.length > 0) {
			return fromList;
		}
	}

	// Some models send edits as a JSON string
	if (typeof record.edits === "string") {
		try {
			const parsed: unknown = JSON.parse(record.edits);
			if (Array.isArray(parsed)) {
				const fromJson: EditToolReplacement[] = [];
				for (const item of parsed) {
					const replacement = parseEditReplacement(item);
					if (replacement) {
						fromJson.push(replacement);
					}
				}
				if (fromJson.length > 0) {
					return fromJson;
				}
			}
		} catch {
			// ignore
		}
	}

	const single = parseEditReplacement(record);
	return single ? [single] : [];
}

export function extractEditPath(args: unknown): string | null {
	if (!args || typeof args !== "object" || Array.isArray(args)) {
		return null;
	}
	const record = args as Record<string, unknown>;
	return recordString(record, "path", "file_path", "filePath", "filename");
}

function looksLikeUnifiedPatch(value: string): boolean {
	return (
		value.includes("@@") ||
		value.includes("diff --git") ||
		(/^---\s/m.test(value) && /^\+\+\+\s/m.test(value))
	);
}

export function extractEditPatch(result: unknown): string | null {
	if (result == null) {
		return null;
	}
	if (typeof result === "string") {
		return looksLikeUnifiedPatch(result) ? result : null;
	}
	if (typeof result !== "object") {
		return null;
	}

	const record = result as Record<string, unknown>;
	const direct = recordString(record, "patch");
	if (direct && looksLikeUnifiedPatch(direct)) {
		return direct;
	}

	if (record.details && typeof record.details === "object") {
		const details = record.details as Record<string, unknown>;
		const fromDetails = recordString(details, "patch");
		if (fromDetails && looksLikeUnifiedPatch(fromDetails)) {
			return fromDetails;
		}
	}

	return null;
}

/**
 * Build diff inputs for an edit tool call from args (and optional result patch).
 * Single replacement → old/new for MultiFileDiff. Multi-edit prefers patch;
 * joins old/new with blank lines only when no usable patch exists.
 */
export function getEditToolDiffData(
	tool: StreamToolCall,
): EditToolDiffData | null {
	const path = extractEditPath(tool.args) ?? "file";
	const rawPatch = extractEditPatch(tool.result);
	const replacements = extractEditReplacements(tool.args);

	// Drop truncated patches — incomplete unified diffs fail to parse and
	// hide lines. UI falls back to MultiFileDiff from old/new text.
	const patch =
		rawPatch && !rawPatch.endsWith("…") && !rawPatch.includes("[truncated")
			? rawPatch
			: null;

	if (replacements.length === 0 && !patch) {
		return null;
	}

	let oldContents = "";
	let newContents = "";
	if (replacements.length === 1) {
		oldContents = replacements[0]?.oldText ?? "";
		newContents = replacements[0]?.newText ?? "";
	} else if (replacements.length > 1 && !patch) {
		oldContents = replacements.map((edit) => edit.oldText).join("\n\n");
		newContents = replacements.map((edit) => edit.newText).join("\n\n");
	}

	return {
		path,
		oldContents,
		newContents,
		patch,
	};
}

/**
 * Collapse consecutive non-edit tool parts into one group so the UI can show a
 * single Working/Worked collapsible. Edit tools stay ungrouped for a dedicated
 * diff UI. Non-empty text parts also split groups.
 */
export function groupAssistantParts(
	parts: AssistantMessagePart[],
): AssistantPartGroup[] {
	const groups: AssistantPartGroup[] = [];

	for (const part of parts) {
		if (part.type === "text") {
			if (part.text.trim().length === 0) {
				continue;
			}
			groups.push({ type: "text", id: part.id, text: part.text });
			continue;
		}

		if (isEditTool(part.tool)) {
			groups.push({ type: "edit", id: part.id, tool: part.tool });
			continue;
		}

		const last = groups[groups.length - 1];
		if (last?.type === "tools") {
			last.tools.push(part.tool);
		} else {
			groups.push({ type: "tools", id: part.id, tools: [part.tool] });
		}
	}

	return groups;
}

/**
 * Wall-clock elapsed ms for a completed tool group: latest endedAt − earliest
 * startedAt. Returns null unless every tool has finite start and end times.
 * Clock anomalies (end before start) clamp to zero.
 */
export function getToolGroupElapsedMs(tools: StreamToolCall[]): number | null {
	if (tools.length === 0) {
		return null;
	}

	let earliestStart = Number.POSITIVE_INFINITY;
	let latestEnd = Number.NEGATIVE_INFINITY;

	for (const tool of tools) {
		const start = tool.startedAt;
		const end = tool.endedAt;
		if (
			typeof start !== "number" ||
			!Number.isFinite(start) ||
			typeof end !== "number" ||
			!Number.isFinite(end)
		) {
			return null;
		}
		if (start < earliestStart) {
			earliestStart = start;
		}
		if (end > latestEnd) {
			latestEnd = end;
		}
	}

	return Math.max(0, latestEnd - earliestStart);
}

/**
 * Compact whole-second duration label (no zero-valued interior units):
 * 4_000 → "4s", 60_000 → "1m", 1_023_000 → "17m 3s", 3_723_000 → "1h 2m 3s".
 * Positive sub-second values round up to "1s".
 */
export function formatElapsedDuration(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		return "0s";
	}

	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	const parts: string[] = [];
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}
	if (seconds > 0 || parts.length === 0) {
		parts.push(`${seconds}s`);
	}
	return parts.join(" ");
}

/**
 * Index of the newest tools group that should stay active while the assistant
 * is still streaming (after its tools finished but text continues).
 * Returns -1 when not streaming or when no tools group exists.
 */
export function findActiveToolGroupIndex(
	groups: AssistantPartGroup[],
	streaming: boolean,
): number {
	if (!streaming) {
		return -1;
	}
	for (let i = groups.length - 1; i >= 0; i -= 1) {
		if (groups[i]?.type === "tools") {
			return i;
		}
	}
	return -1;
}
