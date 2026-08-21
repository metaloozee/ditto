/** Git pkt-line framing helpers (gitprotocol-pack / gitprotocol-v2). */

export const PKT_FLUSH = 0;
export const PKT_DELIM = 1;
export const PKT_RESPONSE_END = 2;

export const MAX_PKT_LINE_BYTES = 65_520;
export const MAX_PKT_LINES = 10_000;
export const MAX_GIT_REQUEST_BODY_BYTES = 1024 * 1024;

export type PktSpecial = "flush" | "delim" | "response-end";

export type PktLine = { kind: "data"; data: Uint8Array } | { kind: PktSpecial };

export class PktLineError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "PktLineError";
		this.code = code;
	}
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function isHexChar(byte: number): boolean {
	return (
		(byte >= 0x30 && byte <= 0x39) ||
		(byte >= 0x61 && byte <= 0x66) ||
		(byte >= 0x41 && byte <= 0x46)
	);
}

function parseHexLength(bytes: Uint8Array, offset: number): number {
	if (offset + 4 > bytes.length) {
		throw new PktLineError("truncated", "Pkt-line length prefix is truncated.");
	}
	let value = 0;
	for (let i = 0; i < 4; i++) {
		const byte = bytes[offset + i]!;
		if (!isHexChar(byte)) {
			throw new PktLineError("non_hex_length", "Pkt-line length is not hex.");
		}
		const nibble = parseInt(String.fromCharCode(byte), 16);
		value = (value << 4) | nibble;
	}
	return value;
}

export function decodePktLines(
	buffer: Uint8Array,
	options?: { maxLines?: number; maxLineBytes?: number },
): { lines: PktLine[]; consumed: number } {
	const maxLines = options?.maxLines ?? MAX_PKT_LINES;
	const maxLineBytes = options?.maxLineBytes ?? MAX_PKT_LINE_BYTES;
	const lines: PktLine[] = [];
	let offset = 0;

	while (offset + 4 <= buffer.length) {
		if (lines.length >= maxLines) {
			throw new PktLineError(
				"too_many_lines",
				"Pkt-line count exceeds the contract limit.",
			);
		}
		const length = parseHexLength(buffer, offset);
		if (length === PKT_FLUSH) {
			lines.push({ kind: "flush" });
			offset += 4;
			continue;
		}
		if (length === PKT_DELIM) {
			lines.push({ kind: "delim" });
			offset += 4;
			continue;
		}
		if (length === PKT_RESPONSE_END) {
			lines.push({ kind: "response-end" });
			offset += 4;
			continue;
		}
		if (length < 4) {
			throw new PktLineError(
				"invalid_length",
				"Pkt-line length is below the 4-byte minimum.",
			);
		}
		if (length > maxLineBytes) {
			throw new PktLineError(
				"line_too_large",
				"Pkt-line exceeds the maximum size.",
			);
		}
		if (offset + length > buffer.length) {
			break;
		}
		lines.push({
			kind: "data",
			data: buffer.subarray(offset + 4, offset + length),
		});
		offset += length;
	}

	return { lines, consumed: offset };
}

export function pktLineText(line: PktLine): string {
	if (line.kind !== "data") {
		return "";
	}
	return textDecoder.decode(line.data);
}

export function encodePktLine(payload: string | Uint8Array): Uint8Array {
	const data =
		typeof payload === "string" ? textEncoder.encode(payload) : payload;
	const length = data.length + 4;
	if (length > MAX_PKT_LINE_BYTES) {
		throw new PktLineError("line_too_large", "Encoded pkt-line is too large.");
	}
	const header = textEncoder.encode(length.toString(16).padStart(4, "0"));
	const out = new Uint8Array(length);
	out.set(header, 0);
	out.set(data, 4);
	return out;
}

export function encodeFlushPkt(): Uint8Array {
	return textEncoder.encode("0000");
}

/**
 * TransformStream that buffers and validates pkt-lines from a POST body.
 * Emits the original bytes unchanged after validation succeeds for each complete line.
 */
export function createPktLineRequestValidator(options: {
	maxBodyBytes?: number;
	maxLines?: number;
	onCompleteLines: (lines: PktLine[]) => void;
}): TransformStream<Uint8Array, Uint8Array> {
	const maxBodyBytes = options.maxBodyBytes ?? MAX_GIT_REQUEST_BODY_BYTES;
	const maxLines = options.maxLines ?? MAX_PKT_LINES;
	let pending = new Uint8Array(0);
	let totalBytes = 0;
	let lineCount = 0;
	const completed: PktLine[] = [];

	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			totalBytes += chunk.byteLength;
			if (totalBytes > maxBodyBytes) {
				throw new PktLineError(
					"body_too_large",
					"Git request body exceeds the contract limit.",
				);
			}
			const merged = new Uint8Array(pending.length + chunk.byteLength);
			merged.set(pending, 0);
			merged.set(chunk, pending.length);
			const { lines, consumed } = decodePktLines(merged, { maxLines });
			if (lineCount + lines.length > maxLines) {
				throw new PktLineError(
					"too_many_lines",
					"Pkt-line count exceeds the contract limit.",
				);
			}
			lineCount += lines.length;
			completed.push(...lines);
			if (consumed > 0) {
				controller.enqueue(merged.subarray(0, consumed));
				pending = merged.subarray(consumed);
			} else {
				pending = merged;
			}
		},
		flush(controller) {
			if (pending.length > 0) {
				throw new PktLineError(
					"truncated",
					"Git request body ended mid pkt-line.",
				);
			}
			options.onCompleteLines(completed);
			controller.terminate();
		},
	});
}

/**
 * Byte-counting TransformStream that rejects responses over a max size.
 */
export function createBoundedByteCounter(
	maxBytes: number,
): TransformStream<Uint8Array, Uint8Array> {
	let total = 0;
	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			total += chunk.byteLength;
			if (total > maxBytes) {
				throw new PktLineError(
					"response_too_large",
					"Upstream response exceeds the contract limit.",
				);
			}
			controller.enqueue(chunk);
		},
	});
}
