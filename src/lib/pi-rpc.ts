export type PiRpcCommand =
	| { id?: string; type: "prompt"; message: string }
	| { id?: string; type: "steer"; message: string }
	| { id?: string; type: "follow_up"; message: string }
	| { id?: string; type: "abort" }
	| {
			id?: string;
			type: "extension_ui_response";
			requestId: string;
			value: string;
		};

export type PiRpcResponse = {
	type: "response";
	id?: string;
	command?: string;
	success: boolean;
	error?: string;
	data?: unknown;
};

export type PiRpcEvent =
	| PiRpcResponse
	| ({ type: "message_update" } & Record<string, unknown>)
	| ({ type: "message_end" } & Record<string, unknown>)
	| ({ type: "tool_execution_start" } & Record<string, unknown>)
	| ({ type: "tool_execution_update" } & Record<string, unknown>)
	| ({ type: "tool_execution_end" } & Record<string, unknown>)
	| ({ type: "extension_ui_request" } & Record<string, unknown>)
	| ({ type: "agent_end" } & Record<string, unknown>)
	| ({ type: "extension_error" } & Record<string, unknown>);

const PI_EVENT_TYPES = new Set([
	"response",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"extension_ui_request",
	"agent_end",
	"extension_error",
]);

export class JsonlBuffer {
	private buffered = "";

	push(chunk: string): PiRpcEvent[] {
		this.buffered += chunk;
		const events: PiRpcEvent[] = [];
		let newlineIndex = this.buffered.indexOf("\n");

		while (newlineIndex !== -1) {
			const rawLine = this.buffered.slice(0, newlineIndex);
			this.buffered = this.buffered.slice(newlineIndex + 1);
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

			if (line.trim()) {
				events.push(parsePiRpcEvent(line));
			}

			newlineIndex = this.buffered.indexOf("\n");
		}

		return events;
	}
}

export function parsePiRpcEvent(line: string): PiRpcEvent {
	let parsed: unknown;

	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error("Pi RPC emitted non-JSON output.");
	}

	if (!parsed || typeof parsed !== "object") {
		throw new Error("Pi RPC emitted a non-object JSON line.");
	}

	const event = parsed as Record<string, unknown>;
	if (typeof event.type !== "string" || !PI_EVENT_TYPES.has(event.type)) {
		throw new Error("Pi RPC emitted an unknown event type.");
	}

	if (event.type === "response" && typeof event.success !== "boolean") {
		throw new Error("Pi RPC response is missing a success boolean.");
	}

	return event as PiRpcEvent;
}

export function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildJsonlWriteCommand(
	fifoPath: string,
	command: PiRpcCommand,
): string {
	return `printf %s ${quoteShellArg(`${JSON.stringify(command)}\n`)} > ${quoteShellArg(fifoPath)}`;
}

export function getPiModelParts(modelSpecifier: string): {
	provider: string;
	model: string;
} {
	const slashIndex = modelSpecifier.indexOf("/");

	if (slashIndex <= 0 || slashIndex === modelSpecifier.length - 1) {
		throw new Error("Invalid Pi model specifier.");
	}

	return {
		provider: modelSpecifier.slice(0, slashIndex),
		model: modelSpecifier.slice(slashIndex + 1),
	};
}

export function getTextField(
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

export function trimCompact(value: string, maxLength = 2000): string {
	const compact = value.trim();

	if (compact.length <= maxLength) {
		return compact;
	}

	return `${compact.slice(0, maxLength)}\n...[truncated]`;
}
