export const PROJECT_CODER_AGENT_NAME = "project-coder" as const;

const FLUE_INTERNAL_ORIGIN = "https://flue.internal";
const MAX_ERROR_TEXT_LENGTH = 1000;

export type FlueAgentDispatchInput = {
	agentName: string;
	agentInstanceId: string;
	message: string;
};

export type FlueAgentDispatchReceipt = {
	agentName: string;
	agentInstanceId: string;
	streamUrl: string;
	streamOffset: string;
	submissionId: string | null;
	acceptedAt: string;
};

export type FlueStreamPollInput = {
	agentName: string;
	agentInstanceId: string;
	offset: string;
	cursor?: string | null;
};

export type FlueStreamPollResult = {
	events: unknown[];
	nextOffset: string;
	cursor: string | null;
	closed: boolean;
};

export type FlueDispatchFetch = (request: Request) => Promise<Response>;
export type FlueStreamFetch = (request: Request) => Promise<Response>;

export function buildFlueAgentPath(input: {
	agentName: string;
	agentInstanceId: string;
}): string {
	return `/agents/${encodeURIComponent(input.agentName)}/${encodeURIComponent(
		input.agentInstanceId,
	)}`;
}

export function buildFlueStreamPath(input: FlueStreamPollInput): string {
	const searchParams = new URLSearchParams({
		offset: input.offset,
		live: "long-poll",
	});

	if (input.cursor) {
		searchParams.set("cursor", input.cursor);
	}

	return `${buildFlueAgentPath(input)}?${searchParams.toString()}`;
}

export function createServiceBindingDispatchFetch(binding: {
	fetch(request: Request): Promise<Response>;
}): FlueDispatchFetch {
	return (request) => binding.fetch(request);
}

export function createServiceBindingStreamFetch(binding: {
	fetch(request: Request): Promise<Response>;
}): FlueStreamFetch {
	return (request) => binding.fetch(request);
}

export function createFlueDispatchAdapter(options: {
	dispatchFetch: FlueDispatchFetch;
	streamFetch: FlueStreamFetch;
	now?: () => Date;
}): {
	dispatch(input: FlueAgentDispatchInput): Promise<FlueAgentDispatchReceipt>;
	poll(input: FlueStreamPollInput): Promise<FlueStreamPollResult>;
} {
	return {
		async dispatch(input) {
			const response = await options.dispatchFetch(
				new Request(`${FLUE_INTERNAL_ORIGIN}${buildFlueAgentPath(input)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message: input.message }),
				}),
			);

			if (!response.ok) {
				throw new Error(await formatFlueResponseError("dispatch", response));
			}

			const body = await parseJsonObject(response, "dispatch");
			if (typeof body.streamUrl !== "string") {
				throw new Error("Flue dispatch response missing streamUrl");
			}
			if (typeof body.offset !== "string") {
				throw new Error("Flue dispatch response missing offset");
			}

			return {
				agentName: input.agentName,
				agentInstanceId: input.agentInstanceId,
				streamUrl: body.streamUrl,
				streamOffset: body.offset,
				submissionId:
					typeof body.submissionId === "string" ? body.submissionId : null,
				acceptedAt: (options.now?.() ?? new Date()).toISOString(),
			};
		},

		async poll(input) {
			const response = await options.streamFetch(
				new Request(`${FLUE_INTERNAL_ORIGIN}${buildFlueStreamPath(input)}`, {
					method: "GET",
				}),
			);

			if (response.status !== 200 && response.status !== 204) {
				throw new Error(await formatFlueResponseError("stream poll", response));
			}

			const nextOffset = response.headers.get("Stream-Next-Offset");
			if (!nextOffset) {
				throw new Error("Flue stream response missing Stream-Next-Offset");
			}

			const events =
				response.status === 204 ? [] : await parseJsonArray(response, "stream poll");

			return {
				events,
				nextOffset,
				cursor: response.headers.get("Stream-Cursor"),
				closed: response.headers.get("Stream-Closed") === "true",
			};
		},
	};
}

async function parseJsonObject(
	response: Response,
	operation: string,
): Promise<Record<string, unknown>> {
	const body: unknown = await response.json();
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error(`Flue ${operation} response was not a JSON object`);
	}

	return body as Record<string, unknown>;
}

async function parseJsonArray(
	response: Response,
	operation: string,
): Promise<unknown[]> {
	const body: unknown = await response.json();
	if (!Array.isArray(body)) {
		throw new Error(`Flue ${operation} response was not a JSON array`);
	}

	return body;
}

async function formatFlueResponseError(
	operation: string,
	response: Response,
): Promise<string> {
	const text = await response.text();
	const message = (extractErrorMessage(text) ?? text) || response.statusText;
	return `Flue ${operation} failed: ${response.status} ${compactText(message)}`;
}

function extractErrorMessage(text: string): string | null {
	try {
		const body: unknown = JSON.parse(text);
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return null;
		}

		const error = (body as Record<string, unknown>).error;
		if (!error || typeof error !== "object" || Array.isArray(error)) {
			return null;
		}

		const message = (error as Record<string, unknown>).message;
		return typeof message === "string" ? message : null;
	} catch {
		return null;
	}
}

function compactText(text: string): string {
	return text.length > MAX_ERROR_TEXT_LENGTH
		? text.slice(0, MAX_ERROR_TEXT_LENGTH)
		: text;
}
