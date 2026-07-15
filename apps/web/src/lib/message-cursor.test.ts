import { describe, expect, it } from "vitest";
import {
	compareMessageCursors,
	decodeMessageCursor,
	encodeMessageCursor,
	MessageCursorError,
	messageCursorFromRow,
	messageCursorOlderThanInputs,
} from "./message-cursor";

describe("message-cursor", () => {
	it("round-trips the same (t, r) stably", () => {
		const cursor = { t: 1_720_000_000, r: 42 };
		const encoded = encodeMessageCursor(cursor);
		expect(encoded).toEqual(encodeMessageCursor(cursor));
		expect(decodeMessageCursor(encoded)).toEqual(cursor);
	});

	it("rejects empty and garbage input", () => {
		expect(() => decodeMessageCursor("")).toThrow(MessageCursorError);
		expect(() => decodeMessageCursor("not-valid!!!")).toThrow(
			MessageCursorError,
		);
		expect(() => decodeMessageCursor("%%%%")).toThrow(MessageCursorError);
	});

	it("rejects wrong version", () => {
		const payload = btoa(JSON.stringify({ v: 99, t: 1, r: 2 }))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "");
		expect(() => decodeMessageCursor(payload)).toThrow(MessageCursorError);
	});

	it("rejects missing version and non-integer fields", () => {
		const noVersion = btoa(JSON.stringify({ t: 1, r: 2 }))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "");
		expect(() => decodeMessageCursor(noVersion)).toThrow(MessageCursorError);

		const floatFields = btoa(JSON.stringify({ v: 1, t: 1.5, r: 2 }))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "");
		expect(() => decodeMessageCursor(floatFields)).toThrow(MessageCursorError);
	});

	it("orders same second by rowid", () => {
		const earlier = { t: 100, r: 1 };
		const later = { t: 100, r: 2 };
		expect(compareMessageCursors(earlier, later)).toBeLessThan(0);
		expect(compareMessageCursors(later, earlier)).toBeGreaterThan(0);
		expect(compareMessageCursors(earlier, earlier)).toBe(0);
	});

	it("builds older-than predicate inputs from cursor", () => {
		const cursor = { t: 1_700_000_000, r: 7 };
		const inputs = messageCursorOlderThanInputs(cursor);
		expect(inputs.createdAtUnix).toBe(1_700_000_000);
		expect(inputs.rowid).toBe(7);
		expect(inputs.createdAtDate.getTime()).toBe(1_700_000_000 * 1000);
	});

	it("messageCursorFromRow accepts Date and unix seconds", () => {
		const fromDate = messageCursorFromRow(new Date(1_700_000_000 * 1000), 5);
		expect(fromDate).toEqual({ t: 1_700_000_000, r: 5 });

		const fromSec = messageCursorFromRow(1_700_000_000, 9);
		expect(fromSec).toEqual({ t: 1_700_000_000, r: 9 });
	});
});
