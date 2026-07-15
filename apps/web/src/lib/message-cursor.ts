/**
 * Opaque cursor for paginating messages newest-first.
 * Payload is versioned JSON, base64url-encoded — never raw SQL.
 */

export type MessageCursor = {
	/** Unix seconds (matches SQLite unixepoch / messages.created_at storage). */
	t: number;
	/** SQLite rowid of the boundary message. */
	r: number;
};

export class MessageCursorError extends Error {
	constructor(message = "Invalid message cursor.") {
		super(message);
		this.name = "MessageCursorError";
	}
}

const CURSOR_VERSION = 1 as const;

type CursorPayloadV1 = {
	v: typeof CURSOR_VERSION;
	t: number;
	r: number;
};

function isFiniteInteger(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		Number.isInteger(value)
	);
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const padLen = (4 - (padded.length % 4)) % 4;
	const decoded = atob(padded + "=".repeat(padLen));
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i++) {
		bytes[i] = decoded.charCodeAt(i);
	}
	return bytes;
}

/** Encode a stable opaque cursor for `(createdAt unix sec, rowid)`. */
export function encodeMessageCursor(cursor: MessageCursor): string {
	if (!isFiniteInteger(cursor.t) || !isFiniteInteger(cursor.r)) {
		throw new MessageCursorError("Cursor fields must be finite integers.");
	}
	const payload: CursorPayloadV1 = {
		v: CURSOR_VERSION,
		t: cursor.t,
		r: cursor.r,
	};
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
}

/** Decode an opaque cursor; throws {@link MessageCursorError} on malformed input. */
export function decodeMessageCursor(value: string): MessageCursor {
	if (typeof value !== "string" || value.length === 0) {
		throw new MessageCursorError("Cursor must be a non-empty string.");
	}

	let json: unknown;
	try {
		const bytes = base64UrlDecode(value);
		json = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new MessageCursorError("Cursor is not valid base64url JSON.");
	}

	if (
		typeof json !== "object" ||
		json === null ||
		!("v" in json) ||
		(json as CursorPayloadV1).v !== CURSOR_VERSION
	) {
		throw new MessageCursorError("Unsupported or missing cursor version.");
	}

	const { t, r } = json as CursorPayloadV1;
	if (!isFiniteInteger(t) || !isFiniteInteger(r)) {
		throw new MessageCursorError("Cursor payload fields are invalid.");
	}

	return { t, r };
}

/**
 * Convert a DB row's createdAt + rowid into cursor fields.
 * `createdAt` may be a Date (drizzle timestamp mode) or unix seconds number.
 */
export function messageCursorFromRow(
	createdAt: Date | number | null | undefined,
	rowid: number,
): MessageCursor {
	let t: number;
	if (createdAt instanceof Date) {
		t = Math.floor(createdAt.getTime() / 1000);
	} else if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
		// Treat values that look like ms as ms; otherwise assume unix seconds.
		t = createdAt > 1e12 ? Math.floor(createdAt / 1000) : Math.floor(createdAt);
	} else {
		t = 0;
	}

	return { t, r: rowid };
}

/**
 * Inputs for a strictly-older-than predicate:
 * `(createdAt < t) OR (createdAt = t AND rowid < r)`.
 * `createdAtDate` is suitable for drizzle timestamp-mode columns.
 */
export function messageCursorOlderThanInputs(cursor: MessageCursor): {
	createdAtUnix: number;
	createdAtDate: Date;
	rowid: number;
} {
	return {
		createdAtUnix: cursor.t,
		createdAtDate: new Date(cursor.t * 1000),
		rowid: cursor.r,
	};
}

/**
 * Compare two cursors for ordering (newest-first sort key).
 * Returns negative if a is older than b, positive if a is newer, 0 if equal.
 */
export function compareMessageCursors(
	a: MessageCursor,
	b: MessageCursor,
): number {
	if (a.t !== b.t) {
		return a.t - b.t;
	}
	return a.r - b.r;
}
