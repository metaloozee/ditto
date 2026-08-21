import {
	decodePktLines,
	MAX_PKT_LINE_BYTES,
	type PktLine,
	PktLineError,
	pktLineText,
} from "#/lib/git-pkt-line";

export const ZERO_OID = "0".repeat(40);
export const SHA1_OID_RE = /^[0-9a-f]{40}$/i;

/** Command-list prefix before the pack. One receive-pack command is tiny. */
export const MAX_RECEIVE_PACK_PREFIX_BYTES = 16 * 1024;
export const MAX_RECEIVE_PACK_ADVERTISEMENT_BYTES = 1024 * 1024;
export const MAX_REPORT_STATUS_BYTES = 64 * 1024;

/**
 * Client capabilities stock Git 2.52.0 send-pack actually emits over smart HTTP,
 * plus the reviewed plan list (`report-status`, `ofs-delta`).
 * Measured command line: `report-status-v2 side-band-64k quiet object-format=sha1 agent=…`.
 */
const ALLOWED_RECEIVE_PACK_CAPABILITIES = new Set([
	"report-status",
	"report-status-v2",
	"side-band-64k",
	"ofs-delta",
	"quiet",
	"agent",
	"object-format=sha1",
]);

export class GitReceivePackError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "GitReceivePackError";
		this.code = code;
	}
}

export type ReceivePackCommand = {
	oldOid: string;
	newOid: string;
	ref: string;
	capabilities: string[];
};

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function assertSha1Oid(oid: string, label: string): void {
	if (!SHA1_OID_RE.test(oid)) {
		if (/^[0-9a-f]{64}$/i.test(oid) || oid.toLowerCase().includes("sha256")) {
			throw new GitReceivePackError(
				"hash_width",
				`${label} uses a non-SHA-1 object id.`,
			);
		}
		throw new GitReceivePackError("invalid_oid", `${label} is not a SHA-1 id.`);
	}
}

function splitCapabilityList(raw: string): string[] {
	return raw
		.split(/[\s\0]+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

export function assertReceivePackCapabilityAllowed(capability: string): void {
	if (capability === "push-cert" || capability.startsWith("push-cert=")) {
		throw new GitReceivePackError("push_cert", "push-cert is not allowed.");
	}
	if (capability === "push-options" || capability.startsWith("push-option")) {
		throw new GitReceivePackError(
			"push_options",
			"push-options are not allowed.",
		);
	}
	if (capability === "object-format=sha256" || capability.includes("sha256")) {
		throw new GitReceivePackError(
			"hash_width",
			"SHA-256 object format is not allowed.",
		);
	}
	const normalized = capability.startsWith("agent=") ? "agent" : capability;
	if (!ALLOWED_RECEIVE_PACK_CAPABILITIES.has(normalized)) {
		throw new GitReceivePackError(
			"capability_denied",
			`Capability ${capability} is not allowed.`,
		);
	}
}

function parseCommandLine(text: string, isFirst: boolean): ReceivePackCommand {
	let capabilities: string[] = [];
	let command = text;
	const nul = text.indexOf("\0");
	if (nul >= 0) {
		if (!isFirst) {
			throw new GitReceivePackError(
				"invalid_command",
				"Capabilities are only allowed on the first receive-pack command.",
			);
		}
		command = text.slice(0, nul);
		capabilities = splitCapabilityList(text.slice(nul + 1));
		for (const capability of capabilities) {
			assertReceivePackCapabilityAllowed(capability);
		}
	} else if (isFirst) {
		throw new GitReceivePackError(
			"invalid_command",
			"First receive-pack command must include a capability list.",
		);
	}

	command = command.replace(/\n$/, "");
	if (command.startsWith("push-cert")) {
		throw new GitReceivePackError("push_cert", "push-cert is not allowed.");
	}

	const match = command.match(/^([0-9a-fA-F]+) ([0-9a-fA-F]+) (.+)$/);
	if (!match) {
		throw new GitReceivePackError(
			"invalid_command",
			"Receive-pack command is not old-oid SP new-oid SP ref.",
		);
	}
	const oldOid = match[1]!.toLowerCase();
	const newOid = match[2]!.toLowerCase();
	const ref = match[3]!;
	assertSha1Oid(oldOid, "old object id");
	assertSha1Oid(newOid, "new object id");
	if (ref.includes(" ") || ref.includes("\t") || !ref.startsWith("refs/")) {
		throw new GitReceivePackError("invalid_ref", "Ref name is invalid.");
	}
	return { oldOid, newOid, ref, capabilities };
}

/**
 * Parse GET info/refs?service=git-receive-pack advertisement and return the
 * advertised old OID for one exact ref. Missing refs are a create (zero OID).
 */
export function extractAdvertisedOldOid(
	bytes: Uint8Array,
	refName: string,
	maxBytes = MAX_RECEIVE_PACK_ADVERTISEMENT_BYTES,
): string {
	if (bytes.byteLength > maxBytes) {
		throw new GitReceivePackError(
			"advertisement_too_large",
			"Receive-pack advertisement exceeds the contract limit.",
		);
	}
	const { lines, consumed } = decodePktLines(bytes);
	if (consumed !== bytes.byteLength) {
		throw new PktLineError(
			"truncated",
			"Receive-pack advertisement ended mid pkt-line.",
		);
	}

	let sawService = false;
	let inRefs = false;
	let found: string | null = null;
	let dummyCreate = false;

	for (const line of lines) {
		if (line.kind === "flush") {
			if (sawService && !inRefs) {
				inRefs = true;
				continue;
			}
			continue;
		}
		if (line.kind !== "data") {
			throw new GitReceivePackError(
				"invalid_advertisement",
				"Unexpected special pkt-line in receive-pack advertisement.",
			);
		}
		const text = pktLineText(line).replace(/\n$/, "");
		if (!sawService && text.startsWith("# service=")) {
			if (text !== "# service=git-receive-pack") {
				throw new GitReceivePackError(
					"protocol_downgrade",
					"info/refs service is not git-receive-pack.",
				);
			}
			sawService = true;
			continue;
		}
		inRefs = true;
		const nul = text.indexOf("\0");
		const head = nul >= 0 ? text.slice(0, nul) : text;
		const rest = nul >= 0 ? text.slice(nul + 1) : "";
		if (rest.toLowerCase().includes("sha256") || head.length > 80) {
			throw new GitReceivePackError(
				"hash_width",
				"Non-SHA-1 advertisement is not allowed.",
			);
		}
		const parts = head.split(" ");
		if (parts.length < 2) {
			throw new GitReceivePackError(
				"invalid_advertisement",
				"Advertised ref line is malformed.",
			);
		}
		const oid = parts[0]!.toLowerCase();
		const name = parts.slice(1).join(" ");
		if (name.endsWith("^{}")) {
			continue;
		}
		if (name === "capabilities^{}") {
			assertSha1Oid(oid, "dummy advertisement object id");
			dummyCreate = true;
			continue;
		}
		assertSha1Oid(oid, "advertised object id");
		if (name === refName) {
			if (found != null && found !== oid) {
				throw new GitReceivePackError(
					"invalid_advertisement",
					"Advertisement lists conflicting OIDs for the target ref.",
				);
			}
			found = oid;
		}
	}

	if (found != null) {
		return found;
	}
	if (dummyCreate || sawService || inRefs) {
		return ZERO_OID;
	}
	throw new GitReceivePackError(
		"invalid_advertisement",
		"Receive-pack advertisement is empty.",
	);
}

/**
 * Parse the pkt-line command prefix (through the flush). Requires exactly one
 * create or update command.
 */
export function parseReceivePackCommands(
	prefix: Uint8Array,
	options: {
		allowedRef: string;
		newOid: string;
		oldOid: string;
	},
): ReceivePackCommand {
	if (prefix.byteLength > MAX_RECEIVE_PACK_PREFIX_BYTES) {
		throw new GitReceivePackError(
			"prefix_too_large",
			"Receive-pack command prefix exceeds the contract limit.",
		);
	}
	const { lines, consumed } = decodePktLines(prefix);
	if (consumed !== prefix.byteLength) {
		throw new PktLineError(
			"truncated",
			"Receive-pack command prefix ended mid pkt-line.",
		);
	}

	const commands: ReceivePackCommand[] = [];
	let sawFlush = false;
	for (const line of lines) {
		if (line.kind === "flush") {
			sawFlush = true;
			continue;
		}
		if (sawFlush) {
			throw new GitReceivePackError(
				"invalid_command",
				"Receive-pack commands after flush are not allowed.",
			);
		}
		if (line.kind !== "data") {
			throw new GitReceivePackError(
				"invalid_command",
				"Unexpected special pkt-line in receive-pack commands.",
			);
		}
		commands.push(parseCommandLine(pktLineText(line), commands.length === 0));
	}
	if (!sawFlush) {
		throw new GitReceivePackError(
			"truncated",
			"Receive-pack command list is missing a flush.",
		);
	}
	if (commands.length === 0) {
		throw new GitReceivePackError(
			"invalid_command",
			"Receive-pack request must include exactly one command.",
		);
	}
	if (commands.length > 1) {
		const refs = commands.map((command) => command.ref);
		const unique = new Set(refs);
		if (unique.size !== refs.length) {
			throw new GitReceivePackError(
				"duplicate_command",
				"Duplicate receive-pack commands are not allowed.",
			);
		}
		throw new GitReceivePackError(
			"extra_ref",
			"Receive-pack may update only one ref.",
		);
	}

	const command = commands[0]!;
	if (command.newOid === ZERO_OID) {
		throw new GitReceivePackError("deletion", "Ref deletion is not allowed.");
	}
	if (command.ref !== options.allowedRef) {
		throw new GitReceivePackError(
			"ref_denied",
			"Requested ref is not in allowedRefs.",
		);
	}
	if (command.newOid !== options.newOid.toLowerCase()) {
		throw new GitReceivePackError(
			"new_oid_mismatch",
			"New object id does not match the preflight HEAD.",
		);
	}
	if (command.oldOid !== options.oldOid.toLowerCase()) {
		throw new GitReceivePackError(
			"old_oid_mismatch",
			"Old object id does not match the advertised ref.",
		);
	}
	return command;
}

function extractSidebandPayload(
	lines: PktLine[],
	maxBytes: number,
): Uint8Array {
	const parts: Uint8Array[] = [];
	let total = 0;
	let sawBand = false;
	for (const line of lines) {
		if (line.kind === "flush") {
			continue;
		}
		if (line.kind !== "data") {
			throw new GitReceivePackError(
				"invalid_status",
				"Unexpected special pkt-line in report-status.",
			);
		}
		if (line.data.length === 0) {
			continue;
		}
		const band = line.data[0]!;
		if (band === 1 || band === 2 || band === 3) {
			sawBand = true;
			if (band === 2) {
				continue;
			}
			if (band === 3) {
				throw new GitReceivePackError(
					"unpack_failed",
					"Receive-pack side-band reported an error.",
				);
			}
			total += line.data.length - 1;
			if (total > maxBytes) {
				throw new GitReceivePackError(
					"status_too_large",
					"Report-status exceeds the contract limit.",
				);
			}
			parts.push(line.data.subarray(1));
			continue;
		}
		if (sawBand) {
			throw new GitReceivePackError(
				"invalid_status",
				"Mixed side-band and plain report-status is not allowed.",
			);
		}
		total += line.data.length;
		if (total > maxBytes) {
			throw new GitReceivePackError(
				"status_too_large",
				"Report-status exceeds the contract limit.",
			);
		}
		parts.push(line.data);
	}
	return concatBytes(parts);
}

/**
 * Parse a bounded report-status (plain or side-band-64k). Requires `unpack ok`
 * and `ok` for only the expected ref.
 */
export function parseReportStatus(
	bytes: Uint8Array,
	expectedRef: string,
	maxBytes = MAX_REPORT_STATUS_BYTES,
): void {
	if (bytes.byteLength > maxBytes) {
		throw new GitReceivePackError(
			"status_too_large",
			"Report-status exceeds the contract limit.",
		);
	}
	const outer = decodePktLines(bytes);
	if (
		outer.consumed !== bytes.byteLength &&
		outer.consumed + 4 <= bytes.byteLength
	) {
		throw new PktLineError("truncated", "Report-status ended mid pkt-line.");
	}

	let statusLines = outer.lines;
	const firstData = statusLines.find((line) => line.kind === "data");
	const firstByte = firstData?.kind === "data" ? firstData.data[0] : undefined;
	if (firstByte === 1 || firstByte === 2 || firstByte === 3) {
		const inner = extractSidebandPayload(statusLines, maxBytes);
		const decoded = decodePktLines(inner);
		statusLines = decoded.lines;
	}

	let unpackOk = false;
	const okRefs: string[] = [];
	for (const line of statusLines) {
		if (line.kind === "flush") {
			continue;
		}
		if (line.kind !== "data") {
			continue;
		}
		const text = pktLineText(line).replace(/\n$/, "");
		if (text === "unpack ok") {
			unpackOk = true;
			continue;
		}
		if (text.startsWith("unpack ")) {
			throw new GitReceivePackError(
				"unpack_failed",
				`Receive-pack unpack failed: ${text.slice(0, 64)}`,
			);
		}
		if (text.startsWith("ok ")) {
			okRefs.push(text.slice("ok ".length));
			continue;
		}
		if (text.startsWith("ng ")) {
			throw new GitReceivePackError(
				"ref_update_failed",
				`Receive-pack rejected the ref: ${text.slice(0, 64)}`,
			);
		}
	}
	if (!unpackOk) {
		throw new GitReceivePackError(
			"unpack_failed",
			"Report-status is missing unpack ok.",
		);
	}
	if (okRefs.length !== 1 || okRefs[0] !== expectedRef) {
		throw new GitReceivePackError(
			"ref_status_mismatch",
			"Report-status must ok only the expected ref.",
		);
	}
}

function concatPrefixAndPack(
	prefix: Uint8Array,
	pack: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			if (prefix.byteLength > 0) {
				controller.enqueue(prefix);
			}
			const reader = pack.getReader();
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) {
						controller.close();
						return;
					}
					if (value && value.byteLength > 0) {
						controller.enqueue(value);
					}
				}
			} catch (error) {
				controller.error(error);
			} finally {
				reader.releaseLock();
			}
		},
	});
}

/**
 * Read pkt-line commands until flush, bound the prefix, and yield remaining
 * bytes as the pack stream without accumulating them.
 */
export async function splitReceivePackBody(
	body: ReadableStream<Uint8Array>,
	maxPrefixBytes = MAX_RECEIVE_PACK_PREFIX_BYTES,
): Promise<{ prefix: Uint8Array; pack: ReadableStream<Uint8Array> }> {
	const reader = body.getReader();
	let pending = new Uint8Array(0);

	const appendPrefixWindow = (chunk: Uint8Array): Uint8Array => {
		const room = maxPrefixBytes + MAX_PKT_LINE_BYTES - pending.length;
		if (room <= 0) {
			return chunk;
		}
		const take = Math.min(chunk.byteLength, room);
		const merged = new Uint8Array(pending.length + take);
		merged.set(pending, 0);
		merged.set(chunk.subarray(0, take), pending.length);
		pending = merged;
		return chunk.subarray(take);
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				throw new PktLineError(
					"truncated",
					"Receive-pack body ended before the command flush.",
				);
			}
			if (!value || value.byteLength === 0) {
				continue;
			}
			const unread = appendPrefixWindow(value);

			let decoded: { lines: PktLine[]; consumed: number };
			try {
				decoded = decodePktLines(pending, { stopAtFlush: true });
			} catch (error) {
				if (error instanceof PktLineError && error.code === "line_too_large") {
					throw error;
				}
				if (error instanceof PktLineError && error.code === "non_hex_length") {
					throw error;
				}
				if (error instanceof PktLineError && error.code === "invalid_length") {
					throw error;
				}
				throw error;
			}

			const flushIndex = decoded.lines.findIndex(
				(line) => line.kind === "flush",
			);
			if (flushIndex < 0) {
				if (pending.byteLength >= maxPrefixBytes) {
					throw new GitReceivePackError(
						"prefix_too_large",
						"Receive-pack command prefix exceeds the contract limit.",
					);
				}
				if (unread.byteLength > 0) {
					throw new GitReceivePackError(
						"prefix_too_large",
						"Receive-pack command prefix exceeds the contract limit.",
					);
				}
				continue;
			}

			let flushOffset = 0;
			let flushes = 0;
			for (const line of decoded.lines) {
				if (line.kind === "flush") {
					flushOffset += 4;
					flushes += 1;
					if (flushes === 1) {
						break;
					}
				} else if (line.kind === "data") {
					flushOffset += 4 + line.data.byteLength;
				} else {
					flushOffset += 4;
				}
			}

			if (flushOffset > maxPrefixBytes) {
				throw new GitReceivePackError(
					"prefix_too_large",
					"Receive-pack command prefix exceeds the contract limit.",
				);
			}

			const prefix = pending.subarray(0, flushOffset);
			const leftover = pending.subarray(flushOffset);
			pending = new Uint8Array(0);

			const pack = new ReadableStream<Uint8Array>({
				async start(controller) {
					if (leftover.byteLength > 0) {
						controller.enqueue(leftover);
					}
					if (unread.byteLength > 0) {
						controller.enqueue(unread);
					}
					try {
						for (;;) {
							const next = await reader.read();
							if (next.done) {
								controller.close();
								return;
							}
							if (next.value && next.value.byteLength > 0) {
								controller.enqueue(next.value);
							}
						}
					} catch (error) {
						controller.error(error);
					} finally {
						reader.releaseLock();
					}
				},
				cancel() {
					return reader.cancel();
				},
			});

			return { prefix: new Uint8Array(prefix), pack };
		}
	} catch (error) {
		reader.releaseLock();
		throw error;
	}
}

export function reconstructReceivePackBody(
	prefix: Uint8Array,
	pack: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	return concatPrefixAndPack(prefix, pack);
}

export function collectStream(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const parts: Uint8Array[] = [];
		let total = 0;
		stream
			.pipeTo(
				new WritableStream<Uint8Array>({
					write(chunk) {
						total += chunk.byteLength;
						if (total > maxBytes) {
							throw new GitReceivePackError(
								"status_too_large",
								"Buffered Git bytes exceed the contract limit.",
							);
						}
						parts.push(chunk);
					},
				}),
			)
			.then(() => resolve(concatBytes(parts)))
			.catch(reject);
	});
}
