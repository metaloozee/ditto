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
