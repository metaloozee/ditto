import {
	createAgentRunEventPayload,
	type AgentRunEventType,
} from "./workspace-policy";

export type FlueEventInput = {
	type: string;
	eventIndex?: number;
	timestamp?: string;
	dispatchId?: string;
	submissionId?: string;
	[key: string]: unknown;
};

export type FlueProjectedEvent = {
	type: AgentRunEventType;
	payload: string;
};

export type FlueProjectedFrame =
	| { type: "assistant_delta"; text: string }
	| { type: "tool_progress"; text: string }
	| { type: "error"; message: string };

export type FlueEventProjection = {
	events: FlueProjectedEvent[];
	frames: FlueProjectedFrame[];
	assistantDelta: string | null;
	terminalStatus: "completed" | "failed" | null;
};

export function compactFlueText(
	value: unknown,
	maxLength = 2000,
): string | null {
	const text = stringifyFlueValue(value)?.trim();

	if (!text) {
		return null;
	}

	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, maxLength)}\n...[truncated]`;
}

export function getToolStatus(event: FlueEventInput): "completed" | "failed" {
	return event.isError === true ? "failed" : "completed";
}

export function getFlueErrorMessage(event: FlueEventInput): string {
	return (
		compactFlueText(event.error) ??
		compactFlueText(event.message) ??
		compactFlueText(event.result) ??
		"Flue event failed."
	);
}

export function mapFlueEventToDittoEvents(
	event: FlueEventInput,
): FlueEventProjection {
	switch (event.type) {
		case "text_delta": {
			const text = compactFlueText(event.text);

			if (!text) {
				return emptyProjection();
			}

			return {
				events: [],
				frames: [{ type: "assistant_delta", text }],
				assistantDelta: text,
				terminalStatus: null,
			};
		}

		case "tool_start": {
			const toolName = compactFlueText(event.toolName) ?? "tool";
			const payload: Record<string, unknown> = {
				toolName,
				toolCallId: compactFlueText(event.toolCallId),
			};
			const args = compactFlueText(event.args);

			if (args) {
				payload.args = args;
			}

			return {
				events: [projectEvent("tool_started", payload)],
				frames: [{ type: "tool_progress", text: `Started ${toolName}.` }],
				assistantDelta: null,
				terminalStatus: null,
			};
		}

		case "tool": {
			const status = getToolStatus(event);
			const payload: Record<string, unknown> = {
				toolName: compactFlueText(event.toolName) ?? "tool",
				toolCallId: compactFlueText(event.toolCallId),
				status,
				durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
			};
			const result = compactFlueText(event.result);

			if (result) {
				payload.result = result;
			}

			const events = [projectEvent("tool_finished", payload)];

			if (status === "failed") {
				events.push(
					projectEvent("error", { message: getFlueErrorMessage(event) }),
				);
			}

			return {
				events,
				frames: [],
				assistantDelta: null,
				terminalStatus: null,
			};
		}

		case "log": {
			const message = compactFlueText(event.message) ?? "";
			const payload: Record<string, unknown> = {
				level: compactFlueText(event.level) ?? "info",
				message,
			};
			const attributes = compactFlueText(event.attributes);

			if (attributes) {
				payload.attributes = attributes;
			}

			return {
				events: [projectEvent("command_output", payload)],
				frames: event.level === "error" ? [{ type: "error", message }] : [],
				assistantDelta: null,
				terminalStatus: null,
			};
		}

		case "operation":
			if (event.isError !== true) {
				return emptyProjection();
			}

			return {
				events: [projectEvent("error", { message: getFlueErrorMessage(event) })],
				frames: [],
				assistantDelta: null,
				terminalStatus: event.operationKind === "prompt" ? "failed" : null,
			};

		case "submission_settled": {
			const terminalStatus =
				event.outcome === "failed"
					? "failed"
					: event.outcome === "completed"
						? "completed"
						: null;

			return {
				events:
					terminalStatus === "failed"
						? [projectEvent("error", { message: getFlueErrorMessage(event) })]
						: [],
				frames: [],
				assistantDelta: null,
				terminalStatus,
			};
		}

		case "run_end": {
			const terminalStatus = event.isError === true ? "failed" : "completed";

			return {
				events:
					terminalStatus === "failed"
						? [projectEvent("error", { message: getFlueErrorMessage(event) })]
						: [],
				frames: [],
				assistantDelta: null,
				terminalStatus,
			};
		}

		default:
			return emptyProjection();
	}
}

function emptyProjection(): FlueEventProjection {
	return { events: [], frames: [], assistantDelta: null, terminalStatus: null };
}

function projectEvent(
	type: AgentRunEventType,
	payload: Record<string, unknown>,
): FlueProjectedEvent {
	return { type, payload: createAgentRunEventPayload(payload) };
}

function stringifyFlueValue(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}

	if (value instanceof Error) {
		return value.message;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
