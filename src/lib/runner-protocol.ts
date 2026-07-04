/**
 * Ditto runner<->broker NDJSON contract.
 *
 * This is the pure, testable seam between the Durable Object broker and the
 * Node.js agent runner. It owns the Ditto-defined wire types and the mapping
 * logic between Pi SDK events and Ditto events. It has **zero** imports from
 * the Pi SDK, the Cloudflare runtime, or `src/db` — that is what makes it
 * unit-testable without a sandbox, a Durable Object, or credentials.
 *
 * The framing/parsing helpers mirror `src/lib/pi-rpc.ts` but for the
 * Ditto-owned wire types.
 */

export { redactSecrets } from "./secret-redaction";

/** Commands the DO writes to the runner's stdin (one NDJSON object per line).
 *
 * `prompt.id` is the active run id — the runner tags every emitted event with
 * it. `abort.id` is the run id being aborted. */
export type RunnerCommand =
	| { type: "prompt"; id: string; message: string }
	| { type: "reply"; requestId: string; answer: string }
	| { type: "abort"; id: string };

/** Events the runner writes to stdout for the DO (one NDJSON object per line).
 *
 * Diagnostics must go to stderr only — stdout stays clean NDJSON. */
export type RunnerEvent =
	| { type: "ready"; runnerVersion: string; model: string }
	| { type: "assistant_delta"; runId: string; text: string }
	| {
			type: "tool_started";
			runId: string;
			toolName: string;
			label?: string;
	  }
	| { type: "tool_progress"; runId: string; text: string }
	| {
			type: "tool_finished";
			runId: string;
			toolName: string;
			status: string;
	  }
	| { type: "file_changed"; runId: string; path: string }
	| {
			type: "diff_ready";
			runId: string;
			changedFiles: number;
			truncated?: boolean;
	  }
	| {
			type: "input_request";
			runId: string;
			requestId: string;
			question: string;
			placeholder?: string;
	  }
	| { type: "done"; runId: string; status: "completed" | "failed" | "canceled" }
	| { type: "error"; runId: string; message: string };

export const RUNNER_EVENT_TYPES = new Set<string>([
	"ready",
	"assistant_delta",
	"tool_started",
	"tool_progress",
	"tool_finished",
	"file_changed",
	"diff_ready",
	"input_request",
	"done",
	"error",
]);

/** NDJSON line buffer. Accumulates chunks and yields one parsed
 * {@link RunnerEvent} per complete LF-delimited line. Mirrors `JsonlBuffer`. */
export class RunnerEventBuffer {
	private buffered = "";

	push(chunk: string): RunnerEvent[] {
		this.buffered += chunk;
		const events: RunnerEvent[] = [];
		let newlineIndex = this.buffered.indexOf("\n");

		while (newlineIndex !== -1) {
			const rawLine = this.buffered.slice(0, newlineIndex);
			this.buffered = this.buffered.slice(newlineIndex + 1);
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

			if (line.trim()) {
				events.push(parseRunnerEvent(line));
			}

			newlineIndex = this.buffered.indexOf("\n");
		}

		return events;
	}
}

function compactLineForError(line: string): string {
	const compact = line.trim().replaceAll(/\s+/g, " ");
	return compact.length > 160
		? `${compact.slice(0, 160)}...[truncated]`
		: compact;
}

/** JSON.parse + validate `type` against {@link RUNNER_EVENT_TYPES}. Throws on
 * non-JSON or unknown type. Mirrors `parsePiRpcEvent`. */
export function parseRunnerEvent(line: string): RunnerEvent {
	let parsed: unknown;

	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error(
			`Runner emitted non-JSON output: ${compactLineForError(line)}`,
		);
	}

	if (!parsed || typeof parsed !== "object") {
		throw new Error("Runner emitted a non-object JSON line.");
	}

	const event = parsed as Record<string, unknown>;
	if (typeof event.type !== "string" || !RUNNER_EVENT_TYPES.has(event.type)) {
		throw new Error("Runner emitted an unknown event type.");
	}

	return event as RunnerEvent;
}

/** Serialize a command to one JSON line (the caller appends `\n`). */
export function serializeRunnerCommand(command: RunnerCommand): string {
	return JSON.stringify(command);
}

/** Serialize an event to one JSON line (the caller appends `\n`). */
export function serializeRunnerEvent(event: RunnerEvent): string {
	return JSON.stringify(event);
}

// --- private payload-extraction helpers (copied from pi-rpc.ts / broker) ---

function getTextField(
	event: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = event[key];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}

	const message = event.message;
	if (message && typeof message === "object") {
		return getTextField(message as Record<string, unknown>, keys);
	}

	const data = event.data;
	if (data && typeof data === "object") {
		return getTextField(data as Record<string, unknown>, keys);
	}

	return null;
}

function getNestedObject(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | null {
	const nested = value[key];
	return nested && typeof nested === "object"
		? (nested as Record<string, unknown>)
		: null;
}

function getContentText(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value;
	}

	if (!Array.isArray(value)) {
		return null;
	}

	const text = value
		.map((item) => {
			if (!item || typeof item !== "object") {
				return null;
			}

			const record = item as Record<string, unknown>;
			return typeof record.text === "string" ? record.text : null;
		})
		.filter(Boolean)
		.join("\n");

	return text.trim() ? text : null;
}

function getToolProgressText(event: Record<string, unknown>): string | null {
	const partialResult = getNestedObject(event, "partialResult");
	if (partialResult) {
		return getContentText(partialResult.content);
	}

	return getTextField(event, ["output", "text", "message"]);
}

/**
 * Pure SDK->Ditto event mapper. Takes a **simulated** SDK event as a plain
 * object (so it is testable without the SDK) and returns zero or more Ditto
 * events. Implements the PRD mapping table:
 *
 * - `message_update` (`text_delta`) -> `assistant_delta`
 * - `tool_execution_start` -> `tool_started`
 * - `tool_execution_update` -> `tool_progress`
 * - `tool_execution_end` -> `tool_finished` (only; `file_changed`/`diff_ready`
 *   need a git side effect the runner performs, not a pure mapping)
 * - `agent_end` -> `done { status: "completed" }`
 * - `extension_error` -> `error` then `done { status: "failed" }`
 * - any other/unknown type -> `[]`
 *
 * All emitted events carry the `runId` passed in.
 */
export function mapSdkEventToDitto(
	event: Record<string, unknown>,
	runId: string,
): RunnerEvent[] {
	const type = typeof event.type === "string" ? event.type : "";

	switch (type) {
		case "message_update": {
			const assistantEvent = getNestedObject(event, "assistantMessageEvent");
			if (assistantEvent?.type !== "text_delta") {
				return [];
			}
			const text =
				getTextField(assistantEvent, ["delta"]) ??
				getTextField(event, ["delta", "text", "content"]);
			return text ? [{ type: "assistant_delta", runId, text }] : [];
		}
		case "tool_execution_start": {
			const toolName = getTextField(event, ["toolName", "name"]) ?? "unknown";
			const label = getTextField(event, ["label"]);
			const started: RunnerEvent = label
				? { type: "tool_started", runId, toolName, label }
				: { type: "tool_started", runId, toolName };
			return [started];
		}
		case "tool_execution_update": {
			const text = getToolProgressText(event);
			return text ? [{ type: "tool_progress", runId, text }] : [];
		}
		case "tool_execution_end": {
			const toolName = getTextField(event, ["toolName", "name"]) ?? "unknown";
			const status = getTextField(event, ["status"]) ?? "completed";
			return [{ type: "tool_finished", runId, toolName, status }];
		}
		case "agent_end": {
			return [{ type: "done", runId, status: "completed" }];
		}
		case "extension_error": {
			const message =
				getTextField(event, ["message", "error", "text"]) ?? "Extension error.";
			return [
				{ type: "error", runId, message },
				{ type: "done", runId, status: "failed" },
			];
		}
		default:
			return [];
	}
}

/** The pure command->dispatch decision. `null` means no-op (e.g. a `reply`
 * for an unknown `requestId`). */
export type RunnerDispatch =
	| { action: "prompt"; message: string }
	| { action: "resolveInput"; requestId: string; answer: string }
	| { action: "abort" }
	| null;

/**
 * Decide what the runner should do for a given command.
 *
 * - `prompt` -> `{ action: "prompt", message }`
 * - `reply` -> `{ action: "resolveInput", requestId, answer }` when
 *   `hasPendingInput(requestId)` is true, else `null`
 * - `abort` -> `{ action: "abort" }`
 */
export function planRunnerCommand(
	command: RunnerCommand,
	hasPendingInput: (requestId: string) => boolean,
): RunnerDispatch {
	switch (command.type) {
		case "prompt":
			return { action: "prompt", message: command.message };
		case "reply":
			return hasPendingInput(command.requestId)
				? {
						action: "resolveInput",
						requestId: command.requestId,
						answer: command.answer,
					}
				: null;
		case "abort":
			return { action: "abort" };
	}
}
