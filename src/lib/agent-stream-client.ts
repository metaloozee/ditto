import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-message-parts";

export type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-message-parts";
export {
	appendAssistantTextDelta,
	applyAgentToolEvent,
	applyAgentToolEventToParts,
	finalizeAssistantParts,
	finalizeStreamTools,
	partsToText,
	partsToTools,
	toolNameFromAgentEvent,
} from "#/lib/agent-message-parts";
export {
	parseStoredParts,
	parseStoredTools,
	prepareAssistantMessageStorage,
	sanitizeAssistantPartsForStorage,
	serializeAssistantPartsForStorage,
	serializeAssistantPartsMinimalForStorage,
} from "#/lib/agent-message-storage";
export {
	type AssistantPartGroup,
	type EditToolDiffData,
	type EditToolReplacement,
	extractEditPatch,
	extractEditPath,
	extractEditReplacements,
	formatToolCallDetail,
	formatToolCallLabel,
	getEditToolDiffData,
	groupAssistantParts,
	isEditTool,
} from "#/lib/agent-tool-presentation";

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
