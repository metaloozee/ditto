import {
	type AssistantMessagePart,
	finalizeAssistantParts,
	nextPartId,
	partsToTools,
	type StreamToolCall,
} from "#/lib/agent-message-parts";

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
