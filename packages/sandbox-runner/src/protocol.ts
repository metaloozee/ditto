export const PROTOCOL_VERSION = 1 as const;

export type FollowUpCorrelation = {
	requestId: string;
	runId: string;
	sessionId: string;
	text: string;
	userMessageId: string;
	assistantMessageId: string;
};

export type RunnerControlEvent =
	| ({ type: "follow_up_started" } & FollowUpCorrelation)
	| ({ type: "follow_up_cancelled" } & FollowUpCorrelation)
	| {
			type: "stop_requested";
			runId: string;
			sessionId: string;
	  };

export type RunnerOut =
	| { v: 1; kind: "ready"; sessionId: string; model: string }
	| { v: 1; kind: "agent_event"; event: unknown }
	| { v: 1; kind: "assistant_delta"; delta: string }
	| { v: 1; kind: "control_event"; event: RunnerControlEvent }
	| { v: 1; kind: "error"; message: string }
	| {
			v: 1;
			kind: "done";
			sessionId: string;
			assistantText: string;
			ok: boolean;
	  };

export function encodeLine(msg: RunnerOut): string {
	return `${JSON.stringify(msg)}\n`;
}

export function extractUserTextFromMessageStart(event: unknown): string | null {
	if (!event || typeof event !== "object") return null;
	const e = event as Record<string, unknown>;
	if (e.type !== "message_start") return null;
	const message = e.message;
	if (!message || typeof message !== "object") return null;
	const m = message as Record<string, unknown>;
	if (m.role !== "user") return null;
	if (typeof m.content === "string") return m.content;
	if (!Array.isArray(m.content)) return null;
	const text: string[] = [];
	for (const block of m.content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (b.type === "text" && typeof b.text === "string") text.push(b.text);
	}
	return text.join("");
}

export function extractTextDelta(event: unknown): string | null {
	if (!event || typeof event !== "object") return null;
	const e = event as Record<string, unknown>;
	if (e.type !== "message_update") return null;
	const ame = e.assistantMessageEvent;
	if (!ame || typeof ame !== "object") return null;
	const a = ame as Record<string, unknown>;
	if (a.type !== "text_delta" || typeof a.delta !== "string") return null;
	return a.delta;
}

export function runnerOutputFromAgentEvent(event: unknown): RunnerOut | null {
	const delta = extractTextDelta(event);
	if (delta !== null) {
		return { v: 1, kind: "assistant_delta", delta };
	}

	if (!event || typeof event !== "object") return null;
	const type = (event as Record<string, unknown>).type;
	if (
		type !== "tool_execution_start" &&
		type !== "tool_execution_update" &&
		type !== "tool_execution_end"
	) {
		return null;
	}

	return { v: 1, kind: "agent_event", event };
}

export function extractAssistantTextFromMessages(messages: unknown): string {
	if (!Array.isArray(messages)) return "";

	let lastAssistant: unknown = null;
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const m = message as Record<string, unknown>;
		if (m.role === "assistant") {
			lastAssistant = message;
		}
	}

	if (!lastAssistant || typeof lastAssistant !== "object") return "";

	const content = (lastAssistant as Record<string, unknown>).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (b.type === "text" && typeof b.text === "string") {
			parts.push(b.text);
		}
	}

	return parts.join("");
}

export function pickAssistantText(
	accumulatedDeltas: string,
	sessionMessages: unknown,
): string {
	const fromDeltas = accumulatedDeltas.trim();
	if (fromDeltas.length > 0) return accumulatedDeltas;
	return extractAssistantTextFromMessages(sessionMessages);
}
