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

export function nextPartId(prefix: string): string {
	partIdCounter += 1;
	return `${prefix}-${partIdCounter}`;
}

/** @internal test helper — reset part id counter between tests if needed */
export function resetPartIdCounterForTests(): void {
	partIdCounter = 0;
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
