import {
	parseSyntheticFrameV1,
	parseSyntheticModelBodyV1,
	parseSyntheticModelRequestV1,
	SYNTHETIC_MODEL_LIMITS,
	SYNTHETIC_MODEL_URL,
	type SyntheticFrameV1,
	type SyntheticModelBodyV1,
	type SyntheticModelRequestV1,
} from "../../../../packages/runtime-contracts/src/model.js";

export function reconstructSyntheticRequest(input: unknown): {
	request: SyntheticModelRequestV1;
	body: SyntheticModelBodyV1;
} {
	const parsed = parseSyntheticModelRequestV1(input);
	const body = parseSyntheticModelBodyV1(parsed.body);
	const request: SyntheticModelRequestV1 = {
		version: 1,
		method: "POST",
		url: SYNTHETIC_MODEL_URL,
		headers: [
			["content-type", "application/json"],
			["accept", "application/x-ndjson"],
		],
		body: JSON.stringify(body),
	};
	parseSyntheticModelRequestV1(request);
	return { request, body };
}

export async function syntheticRequestDigest(input: unknown): Promise<string> {
	const { request } = reconstructSyntheticRequest(input);
	const bytes = new TextEncoder().encode(JSON.stringify(request));
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(hash), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
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

export async function readSyntheticStream(
	response: Response,
	signal: AbortSignal,
	privateValues: readonly string[] = [],
): Promise<SyntheticFrameV1[]> {
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
	const frames: SyntheticFrameV1[] = [];
	let pending = "",
		total = 0,
		output = "",
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
			if (total > SYNTHETIC_MODEL_LIMITS.responseBytes)
				throw new Error("synthetic_response_bound");
			pending += decoder.decode(chunk.value, { stream: true });
			for (;;) {
				const index = pending.indexOf("\n");
				if (index === -1) break;
				if (done || frames.length >= SYNTHETIC_MODEL_LIMITS.frames)
					throw new Error("synthetic_frame_bound");
				const frame = parseSyntheticFrameV1(pending.slice(0, index));
				pending = pending.slice(index + 1);
				if (frame.type === "delta") {
					output += frame.text;
					if (
						encoder.encode(output).byteLength >
							SYNTHETIC_MODEL_LIMITS.outputBytes ||
						privateValues.some(
							(value) => value.length > 0 && output.includes(value),
						)
					)
						throw new Error("synthetic_output_bound");
				} else done = true;
				frames.push(frame);
			}
			if (
				encoder.encode(pending).byteLength > SYNTHETIC_MODEL_LIMITS.frameBytes
			)
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
