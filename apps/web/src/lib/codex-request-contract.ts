import {
	MODEL_FIXTURE_URL_V2,
	MODEL_LIMITS_V2,
	type ModelFrameV2,
	type ModelRequestV2,
	modelRequestDigestV2,
	parseModelFrameV2,
	parseModelRequestV2,
} from "../../../../packages/runtime-contracts/src/model.js";

export function reconstructModelRequest(input: unknown): {
	request: ModelRequestV2;
} {
	return { request: parseModelRequestV2(input) };
}

export async function modelRequestDigest(input: unknown): Promise<string> {
	return modelRequestDigestV2(reconstructModelRequest(input).request);
}

/** Product builds the upstream request itself; the DO adds `authorization`. */
export function buildFixtureUpstream(request: ModelRequestV2): {
	url: string;
	headers: Record<string, string>;
	body: string;
} {
	return {
		url: MODEL_FIXTURE_URL_V2,
		headers: {
			"content-type": "application/json",
			accept: "application/x-ndjson",
		},
		body: JSON.stringify(request),
	};
}

export function awaitSynthetic<T>(
	pending: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new Error("synthetic_deadline"));
		if (signal.aborted) {
			void pending.catch(() => {});
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		void pending.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) abort();
				else resolve(value);
			},
			() => {
				signal.removeEventListener("abort", abort);
				reject(new Error("synthetic_operation_failed"));
			},
		);
	});
}

export async function readModelFrames(
	response: Response,
	signal: AbortSignal,
	privateValues: readonly string[] = [],
): Promise<ModelFrameV2[]> {
	if (
		response.status !== 200 ||
		response.headers.get("location") !== null ||
		response.headers.get("content-type") !== "application/x-ndjson" ||
		response.headers.has("content-encoding") ||
		!response.body
	)
		throw new Error("synthetic_upstream_contract");
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const encoder = new TextEncoder();
	const frames: ModelFrameV2[] = [];
	let pending = "",
		total = 0,
		output = "",
		outputBytes = 0,
		toolCalls = 0,
		done = false;
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		for (;;) {
			signal.throwIfAborted();
			const chunk = await awaitSynthetic(reader.read(), signal);
			signal.throwIfAborted();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > MODEL_LIMITS_V2.responseBytes)
				throw new Error("synthetic_response_bound");
			pending += decoder.decode(chunk.value, { stream: true });
			for (;;) {
				const index = pending.indexOf("\n");
				if (index === -1) break;
				if (done || frames.length >= MODEL_LIMITS_V2.frames)
					throw new Error("synthetic_frame_bound");
				const frame = parseModelFrameV2(pending.slice(0, index));
				pending = pending.slice(index + 1);
				if (frame.type === "done") done = true;
				else {
					if (frame.type === "toolCall") {
						toolCalls += 1;
						if (toolCalls > MODEL_LIMITS_V2.toolCalls)
							throw new Error("synthetic_output_bound");
					}
					const piece =
						frame.type === "text"
							? frame.text
							: frame.type === "thinking"
								? frame.thinking
								: JSON.stringify(frame.arguments);
					outputBytes += encoder.encode(piece).byteLength;
					output += piece;
					if (
						outputBytes > MODEL_LIMITS_V2.outputBytes ||
						privateValues.some(
							(value) => value.length > 0 && output.includes(value),
						)
					)
						throw new Error("synthetic_output_bound");
				}
				frames.push(frame);
			}
			if (encoder.encode(pending).byteLength > MODEL_LIMITS_V2.frameBytes)
				throw new Error("synthetic_frame_bound");
		}
		pending += decoder.decode();
		if (pending !== "" || !done) throw new Error("synthetic_truncated_stream");
		return frames;
	} finally {
		signal.removeEventListener("abort", abort);
		await awaitSynthetic(reader.cancel(), AbortSignal.timeout(1000)).catch(
			() => {},
		);
		reader.releaseLock();
	}
}
