export type RunnerOut =
	| { v: 1; kind: "ready"; sessionId: string; model: string }
	| { v: 1; kind: "agent_event"; event: unknown }
	| { v: 1; kind: "assistant_delta"; delta: string }
	| {
			v: 1;
			kind: "control_event";
			event:
				| {
						type: "follow_up_started" | "follow_up_cancelled";
						requestId: string;
						runId: string;
						sessionId: string;
						text: string;
						userMessageId: string;
						assistantMessageId: string;
				  }
				| {
						type: "stop_requested";
						runId: string;
						sessionId: string;
				  };
	  }
	| { v: 1; kind: "error"; message: string }
	| {
			v: 1;
			kind: "done";
			sessionId: string;
			assistantText: string;
			ok: boolean;
	  };

export function encodeSseEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isRunnerOut(value: unknown): value is RunnerOut {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.v !== 1 || typeof record.kind !== "string") {
		return false;
	}
	switch (record.kind) {
		case "ready":
			return (
				typeof record.sessionId === "string" && typeof record.model === "string"
			);
		case "agent_event":
			return "event" in record;
		case "assistant_delta":
			return typeof record.delta === "string";
		case "control_event": {
			if (!record.event || typeof record.event !== "object") return false;
			const event = record.event as Record<string, unknown>;
			if (event.type === "stop_requested") {
				return (
					Object.keys(event).length === 3 &&
					typeof event.runId === "string" &&
					typeof event.sessionId === "string"
				);
			}
			if (
				event.type !== "follow_up_started" &&
				event.type !== "follow_up_cancelled"
			) {
				return false;
			}
			return (
				Object.keys(event).length === 7 &&
				typeof event.requestId === "string" &&
				typeof event.runId === "string" &&
				typeof event.sessionId === "string" &&
				typeof event.text === "string" &&
				typeof event.userMessageId === "string" &&
				typeof event.assistantMessageId === "string"
			);
		}
		case "error":
			return typeof record.message === "string";
		case "done":
			return (
				typeof record.sessionId === "string" &&
				typeof record.assistantText === "string" &&
				typeof record.ok === "boolean"
			);
		default:
			return false;
	}
}

export function parseRunnerStdoutLine(line: string): RunnerOut | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return isRunnerOut(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function splitStdoutBuffer(
	buffer: string,
	chunk: string,
): { lines: string[]; rest: string } {
	const combined = buffer + chunk;
	const parts = combined.split("\n");
	const rest = parts.pop() ?? "";
	return { lines: parts, rest };
}
