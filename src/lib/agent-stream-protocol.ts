export type RunnerOut =
	| { v: 1; kind: "ready"; sessionId: string; model: string }
	| { v: 1; kind: "agent_event"; event: unknown }
	| { v: 1; kind: "assistant_delta"; delta: string }
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
