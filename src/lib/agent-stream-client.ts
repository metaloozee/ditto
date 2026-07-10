export type StreamToolCall = {
	id: string;
	name: string;
	status: "running" | "done" | "error";
	args?: unknown;
	result?: unknown;
};

export type AssistantMessagePart =
	| { type: "text"; id: string; text: string }
	| { type: "tool"; id: string; tool: StreamToolCall };

let partIdCounter = 0;

function nextPartId(prefix: string): string {
	partIdCounter += 1;
	return `${prefix}-${partIdCounter}`;
}

export type MetaPayload = {
	sessionId: string;
	userMessageId: string;
	assistantMessageId: string;
	createdSession: boolean;
	sandboxState: string;
};

export type DonePayload = {
	ok: boolean;
	assistantMessageId: string;
	content: string;
	tools?: StreamToolCall[];
	parts?: AssistantMessagePart[];
	backupError?: string;
};

export type AgentStreamHandlers = {
	onMeta?: (data: MetaPayload) => void;
	onDelta?: (delta: string) => void;
	onAgent?: (event: unknown) => void;
	onError?: (message: string) => void;
	onDone?: (data: DonePayload) => void;
};

export function parseSseChunk(buffer: string): {
	frames: { event: string; data: string }[];
	rest: string;
} {
	const frames: { event: string; data: string }[] = [];
	let working = buffer;

	while (true) {
		const splitAt = working.indexOf("\n\n");
		if (splitAt === -1) {
			return { frames, rest: working };
		}

		const rawFrame = working.slice(0, splitAt);
		working = working.slice(splitAt + 2);

		let event = "message";
		const dataLines: string[] = [];

		for (const line of rawFrame.split("\n")) {
			if (line.startsWith("event:")) {
				event = line.slice("event:".length).trim();
				continue;
			}
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}

		if (dataLines.length > 0) {
			frames.push({ event, data: dataLines.join("\n") });
		}
	}
}

function dispatchSseFrame(
	frame: { event: string; data: string },
	handlers: AgentStreamHandlers,
): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(frame.data);
	} catch {
		return;
	}

	switch (frame.event) {
		case "meta":
			handlers.onMeta?.(parsed as MetaPayload);
			break;
		case "delta": {
			const record = parsed as { delta?: unknown };
			if (typeof record.delta === "string") {
				handlers.onDelta?.(record.delta);
			}
			break;
		}
		case "agent": {
			const record = parsed as { event?: unknown };
			handlers.onAgent?.(record.event);
			break;
		}
		case "error": {
			const record = parsed as { message?: unknown };
			if (typeof record.message === "string") {
				handlers.onError?.(record.message);
			}
			break;
		}
		case "done":
			handlers.onDone?.(parsed as DonePayload);
			break;
		default:
			break;
	}
}

export async function streamAgentRun(
	input: {
		projectId: string;
		sessionId?: string;
		message: string;
		model: string;
	},
	handlers: AgentStreamHandlers,
	options?: { signal?: AbortSignal },
): Promise<void> {
	const response = await fetch("/api/agent/stream", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(input),
		credentials: "include",
		signal: options?.signal,
	});

	if (!response.ok) {
		const bodyText = await response.text().catch(() => "");
		throw new Error(
			bodyText.trim().length > 0
				? bodyText
				: `Agent stream failed (${response.status}).`,
		);
	}

	if (!response.body) {
		throw new Error("Agent stream returned no body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true });
		const parsed = parseSseChunk(buffer);
		buffer = parsed.rest;

		for (const frame of parsed.frames) {
			dispatchSseFrame(frame, handlers);
		}
	}

	if (buffer.trim().length > 0) {
		const parsed = parseSseChunk(`${buffer}\n\n`);
		for (const frame of parsed.frames) {
			dispatchSseFrame(frame, handlers);
		}
	}
}

export function toolNameFromAgentEvent(event: unknown): string | null {
	if (!event || typeof event !== "object") {
		return null;
	}

	const record = event as Record<string, unknown>;
	if (
		record.type !== "tool_execution_start" &&
		record.type !== "tool_execution_update" &&
		record.type !== "tool_execution_end"
	) {
		return null;
	}

	return typeof record.toolName === "string" ? record.toolName : null;
}

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

export function applyAgentToolEvent(
	tools: StreamToolCall[],
	event: unknown,
): StreamToolCall[] | null {
	if (!event || typeof event !== "object") {
		return null;
	}

	const record = event as Record<string, unknown>;
	const type = record.type;
	if (
		type !== "tool_execution_start" &&
		type !== "tool_execution_update" &&
		type !== "tool_execution_end"
	) {
		return null;
	}

	const id =
		typeof record.toolCallId === "string" && record.toolCallId.length > 0
			? record.toolCallId
			: null;
	const name =
		typeof record.toolName === "string" && record.toolName.length > 0
			? record.toolName
			: "tool";

	if (!id) {
		return null;
	}

	const existingIndex = tools.findIndex((tool) => tool.id === id);
	const existing = existingIndex >= 0 ? tools[existingIndex] : undefined;
	const next = [...tools];

	if (type === "tool_execution_start") {
		const entry: StreamToolCall = {
			id,
			name,
			status: "running",
			args: record.args,
		};
		if (existingIndex >= 0) {
			next[existingIndex] = entry;
		} else {
			next.push(entry);
		}
		return next;
	}

	if (type === "tool_execution_update") {
		const entry: StreamToolCall = {
			id,
			name,
			status: existing?.status ?? "running",
			args: record.args ?? existing?.args,
			result: record.partialResult ?? existing?.result,
		};
		if (existingIndex >= 0) {
			next[existingIndex] = entry;
		} else {
			next.push(entry);
		}
		return next;
	}

	const isError = record.isError === true;
	const entry: StreamToolCall = {
		id,
		name,
		status: isError ? "error" : "done",
		args: record.args ?? existing?.args,
		result: record.result,
	};
	if (existingIndex >= 0) {
		next[existingIndex] = entry;
	} else {
		next.push(entry);
	}
	return next;
}

export function finalizeStreamTools(tools: StreamToolCall[]): StreamToolCall[] {
	return tools.map((tool) =>
		tool.status === "running" ? { ...tool, status: "done" as const } : tool,
	);
}

export function appendAssistantTextDelta(
	parts: AssistantMessagePart[],
	delta: string,
): AssistantMessagePart[] {
	if (!delta) {
		return parts;
	}

	const next = [...parts];
	const last = next[next.length - 1];
	if (last?.type === "text") {
		next[next.length - 1] = {
			type: "text",
			id: last.id,
			text: last.text + delta,
		};
		return next;
	}

	next.push({ type: "text", id: nextPartId("text"), text: delta });
	return next;
}

export function applyAgentToolEventToParts(
	parts: AssistantMessagePart[],
	event: unknown,
): AssistantMessagePart[] | null {
	const flat = partsToTools(parts);
	const nextTools = applyAgentToolEvent(flat, event);
	if (!nextTools) {
		return null;
	}

	const record = event as Record<string, unknown>;
	const id = typeof record.toolCallId === "string" ? record.toolCallId : null;
	if (!id) {
		return null;
	}

	const updatedTool = nextTools.find((tool) => tool.id === id);
	if (!updatedTool) {
		return null;
	}

	const existingIndex = parts.findIndex(
		(part) => part.type === "tool" && part.tool.id === id,
	);
	if (existingIndex >= 0) {
		const next = [...parts];
		const existing = next[existingIndex];
		next[existingIndex] = {
			type: "tool",
			id: existing?.type === "tool" ? existing.id : nextPartId("tool"),
			tool: updatedTool,
		};
		return next;
	}

	return [
		...parts,
		{ type: "tool", id: nextPartId("tool"), tool: updatedTool },
	];
}

export function partsToText(parts: AssistantMessagePart[]): string {
	return parts
		.filter(
			(part): part is { type: "text"; id: string; text: string } =>
				part.type === "text",
		)
		.map((part) => part.text)
		.join("\n\n");
}

export function partsToTools(parts: AssistantMessagePart[]): StreamToolCall[] {
	return parts
		.filter(
			(part): part is { type: "tool"; id: string; tool: StreamToolCall } =>
				part.type === "tool",
		)
		.map((part) => part.tool);
}

export function finalizeAssistantParts(
	parts: AssistantMessagePart[],
): AssistantMessagePart[] {
	return parts.map((part) => {
		if (part.type !== "tool" || part.tool.status !== "running") {
			return part;
		}
		return {
			type: "tool",
			id: part.id,
			tool: { ...part.tool, status: "done" as const },
		};
	});
}

const STORAGE_TOOL_PAYLOAD_MAX_CHARS = 4096;
const STORAGE_MAX_DEPTH = 12;
const STORAGE_MAX_ARRAY_ITEMS = 100;

function truncateValueForStorage(
	value: unknown,
	seen: WeakSet<object>,
	depth: number,
): unknown {
	if (depth > STORAGE_MAX_DEPTH) {
		return "[truncated: depth]";
	}
	if (value == null) {
		return value;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "string") {
		return value.length > STORAGE_TOOL_PAYLOAD_MAX_CHARS
			? `${value.slice(0, STORAGE_TOOL_PAYLOAD_MAX_CHARS)}…`
			: value;
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "undefined"
	) {
		return value;
	}
	if (typeof value === "function" || typeof value === "symbol") {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, STORAGE_MAX_ARRAY_ITEMS)
			.map((item) => truncateValueForStorage(item, seen, depth + 1));
	}
	if (typeof value === "object") {
		if (seen.has(value)) {
			return "[Circular]";
		}
		seen.add(value);
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			const sanitized = truncateValueForStorage(child, seen, depth + 1);
			if (sanitized !== undefined) {
				out[key] = sanitized;
			}
		}
		seen.delete(value);
		return out;
	}
	return String(value);
}

export function sanitizeAssistantPartsForStorage(
	parts: AssistantMessagePart[],
): AssistantMessagePart[] {
	const finalized = finalizeAssistantParts(parts);
	const seen = new WeakSet<object>();
	return finalized.map((part) => {
		if (part.type === "text") {
			return part;
		}
		const tool = part.tool;
		const next: StreamToolCall = {
			id: tool.id,
			name: tool.name,
			status: tool.status,
		};
		if (tool.args !== undefined) {
			const args = truncateValueForStorage(tool.args, seen, 0);
			if (args !== undefined) {
				next.args = args;
			}
		}
		if (tool.result !== undefined) {
			const result = truncateValueForStorage(tool.result, seen, 0);
			if (result !== undefined) {
				next.result = result;
			}
		}
		return { type: "tool", id: part.id, tool: next };
	});
}

function minimalAssistantPartsForStorage(
	parts: AssistantMessagePart[],
): AssistantMessagePart[] {
	return parts.map((part) => {
		if (part.type === "text") {
			return part;
		}
		return {
			type: "tool",
			id: part.id,
			tool: {
				id: part.tool.id,
				name: part.tool.name,
				status: part.tool.status,
			},
		};
	});
}

export function serializeAssistantPartsForStorage(
	parts: AssistantMessagePart[],
): string | null {
	const sanitized = sanitizeAssistantPartsForStorage(parts);
	if (sanitized.length === 0) {
		return null;
	}
	try {
		return JSON.stringify(sanitized);
	} catch {
		return serializeAssistantPartsMinimalForStorage(parts);
	}
}

export function serializeAssistantPartsMinimalForStorage(
	parts: AssistantMessagePart[],
): string | null {
	const minimal = minimalAssistantPartsForStorage(
		sanitizeAssistantPartsForStorage(parts),
	);
	if (minimal.length === 0) {
		return null;
	}
	try {
		return JSON.stringify(minimal);
	} catch {
		return null;
	}
}

export function prepareAssistantMessageStorage(parts: AssistantMessagePart[]): {
	storageParts: AssistantMessagePart[];
	toolsColumn: string | null;
} {
	const storageParts = sanitizeAssistantPartsForStorage(parts);
	let toolsColumn: string | null = null;
	if (storageParts.length > 0) {
		try {
			toolsColumn = JSON.stringify(storageParts);
		} catch {
			toolsColumn = serializeAssistantPartsMinimalForStorage(parts);
		}
	}
	return { storageParts, toolsColumn };
}

function parseToolRecord(
	record: Record<string, unknown>,
): StreamToolCall | null {
	if (typeof record.id !== "string" || typeof record.name !== "string") {
		return null;
	}
	const status =
		record.status === "running" ||
		record.status === "done" ||
		record.status === "error"
			? record.status
			: "done";
	return {
		id: record.id,
		name: record.name,
		status,
		...(record.args !== undefined ? { args: record.args } : {}),
		...(record.result !== undefined ? { result: record.result } : {}),
	};
}

export function parseStoredTools(value: unknown): StreamToolCall[] | undefined {
	const parts = parseStoredParts(value);
	if (!parts) {
		return undefined;
	}
	const tools = partsToTools(parts);
	return tools.length > 0 ? tools : undefined;
}

export function parseStoredParts(
	value: unknown,
	fallbackContent?: string,
): AssistantMessagePart[] | undefined {
	if (value == null || value === "") {
		if (fallbackContent && fallbackContent.length > 0) {
			return [{ type: "text", id: nextPartId("text"), text: fallbackContent }];
		}
		return undefined;
	}

	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			return fallbackContent
				? [{ type: "text", id: nextPartId("text"), text: fallbackContent }]
				: undefined;
		}
	}

	if (!Array.isArray(parsed) || parsed.length === 0) {
		return fallbackContent
			? [{ type: "text", id: nextPartId("text"), text: fallbackContent }]
			: undefined;
	}

	const first = parsed[0];
	const isPartsFormat =
		first &&
		typeof first === "object" &&
		"type" in first &&
		((first as { type?: unknown }).type === "text" ||
			(first as { type?: unknown }).type === "tool");

	if (isPartsFormat) {
		const parts: AssistantMessagePart[] = [];
		for (const item of parsed) {
			if (!item || typeof item !== "object") {
				continue;
			}
			const record = item as Record<string, unknown>;
			if (record.type === "text" && typeof record.text === "string") {
				if (record.text.length > 0) {
					parts.push({
						type: "text",
						id: typeof record.id === "string" ? record.id : nextPartId("text"),
						text: record.text,
					});
				}
				continue;
			}
			if (
				record.type === "tool" &&
				record.tool &&
				typeof record.tool === "object"
			) {
				const tool = parseToolRecord(record.tool as Record<string, unknown>);
				if (tool) {
					parts.push({
						type: "tool",
						id: typeof record.id === "string" ? record.id : nextPartId("tool"),
						tool,
					});
				}
			}
		}
		return parts.length > 0 ? parts : undefined;
	}

	// Legacy flat tool list
	const tools: StreamToolCall[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const tool = parseToolRecord(item as Record<string, unknown>);
		if (tool) {
			tools.push(tool);
		}
	}

	const parts: AssistantMessagePart[] = [];
	if (fallbackContent && fallbackContent.length > 0) {
		parts.push({
			type: "text",
			id: nextPartId("text"),
			text: fallbackContent,
		});
	}
	for (const tool of tools) {
		parts.push({ type: "tool", id: nextPartId("tool"), tool });
	}
	return parts.length > 0 ? parts : undefined;
}
