import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-message-parts";
import type { PiThinkingLevel } from "#/lib/agent-models";

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
	runId: string;
	sessionId: string;
	userMessageId: string;
	assistantMessageId: string;
	createdSession: boolean;
	sandboxState: string;
};

export type ControlReadyPayload = { runId: string };

export type TurnDonePayload = {
	userMessageId: string;
	assistantMessageId: string;
	content: string;
	tools?: StreamToolCall[];
	parts?: AssistantMessagePart[];
};

export type TurnStartPayload = {
	requestId: string;
	userMessageId: string;
	assistantMessageId: string;
	text: string;
};

export type QueueCancelledPayload = {
	requestId: string;
	userMessageId: string;
	assistantMessageId: string;
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
	onControlReady?: (data: ControlReadyPayload) => void;
	onTurnDone?: (data: TurnDonePayload) => void;
	onTurnStart?: (data: TurnStartPayload) => void;
	onQueueCancelled?: (data: QueueCancelledPayload) => void;
	onDelta?: (delta: string) => void;
	/** Optional second arg is the server-assigned occurrence time (epoch ms). */
	onAgent?: (event: unknown, occurredAt?: number) => void;
	onError?: (message: string) => void;
	onDone?: (data: DonePayload) => void;
};

export type AgentControlInput =
	| {
			action: "follow_up";
			projectId: string;
			sessionId: string;
			runId: string;
			model: string;
			message: string;
	  }
	| {
			action: "stop";
			projectId: string;
			sessionId: string;
			runId: string;
	  };

export type AgentControlResult =
	| {
			accepted: true;
			action: "follow_up";
			requestId: string;
			runId: string;
			sessionId: string;
			userMessageId: string;
			assistantMessageId: string;
	  }
	| {
			accepted: true;
			action: "stop";
			requestId: string;
			runId: string;
			sessionId: string;
			removedFollowUpCount: number;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
		case "control_ready":
			if (isRecord(parsed) && typeof parsed.runId === "string") {
				handlers.onControlReady?.({ runId: parsed.runId });
			}
			break;
		case "turn_done":
			if (
				isRecord(parsed) &&
				typeof parsed.userMessageId === "string" &&
				typeof parsed.assistantMessageId === "string" &&
				typeof parsed.content === "string"
			) {
				handlers.onTurnDone?.(parsed as TurnDonePayload);
			}
			break;
		case "turn_start":
			if (
				isRecord(parsed) &&
				typeof parsed.requestId === "string" &&
				typeof parsed.userMessageId === "string" &&
				typeof parsed.assistantMessageId === "string" &&
				typeof parsed.text === "string"
			) {
				handlers.onTurnStart?.(parsed as TurnStartPayload);
			}
			break;
		case "queue_cancelled":
			if (
				isRecord(parsed) &&
				typeof parsed.requestId === "string" &&
				typeof parsed.userMessageId === "string" &&
				typeof parsed.assistantMessageId === "string"
			) {
				handlers.onQueueCancelled?.(parsed as QueueCancelledPayload);
			}
			break;
		case "delta": {
			const record = parsed as { delta?: unknown };
			if (typeof record.delta === "string") {
				handlers.onDelta?.(record.delta);
			}
			break;
		}
		case "agent": {
			const record = parsed as { event?: unknown; occurredAt?: unknown };
			const occurredAt =
				typeof record.occurredAt === "number" &&
				Number.isFinite(record.occurredAt)
					? record.occurredAt
					: undefined;
			handlers.onAgent?.(record.event, occurredAt);
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

export async function sendAgentControl(
	input: AgentControlInput,
): Promise<AgentControlResult> {
	const response = await fetch("/api/agent/control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		credentials: "include",
	});

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error("Agent control returned an invalid response.");
	}

	if (!response.ok) {
		const message =
			isRecord(body) && typeof body.error === "string"
				? body.error
				: `Agent control failed (${response.status}).`;
		throw new Error(message);
	}
	if (!isRecord(body) || body.accepted !== true) {
		throw new Error("Agent control returned an invalid response.");
	}
	return body as AgentControlResult;
}

export async function streamAgentRun(
	input: {
		projectId: string;
		sessionId?: string;
		message: string;
		model: string;
		/** Abstract Pi level; omit for legacy clients / unknown model capabilities. */
		thinkingLevel?: PiThinkingLevel;
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
