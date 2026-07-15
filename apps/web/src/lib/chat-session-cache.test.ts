import { afterEach, describe, expect, it } from "vitest";
import {
	acknowledgeSessionMessages,
	clearAllSessionMessages,
	clearSessionMessages,
	listPendingSessionMessages,
	MAX_CACHED_MESSAGES_PER_SESSION,
	readSessionMessages,
	seedSessionMessages,
} from "#/lib/chat-session-cache";

afterEach(() => {
	clearAllSessionMessages();
});

describe("chat-session-cache", () => {
	it("retains pending messages until the server acknowledges them", () => {
		seedSessionMessages("sess-a", [
			{ id: "u1", role: "user", content: "hello" },
			{ id: "a1", role: "assistant", content: "hi" },
		]);

		expect(
			listPendingSessionMessages("sess-a", [{ id: "older" }]),
		).toHaveLength(2);

		expect(
			listPendingSessionMessages("sess-a", [{ id: "u1" }, { id: "a1" }]),
		).toHaveLength(0);
	});

	it("removes acknowledged ids and keeps unacked ones", () => {
		seedSessionMessages("sess-a", [
			{ id: "u1", role: "user", content: "one" },
			{ id: "a1", role: "assistant", content: "two" },
			{ id: "u2", role: "user", content: "three" },
		]);

		const removed = acknowledgeSessionMessages("sess-a", ["u1", "a1"]);
		expect(removed).toBe(true);
		expect(readSessionMessages("sess-a").map((m) => m.id)).toEqual(["u2"]);
		expect(acknowledgeSessionMessages("sess-a", ["u1"])).toBe(false);
	});

	it("clears one session on archive without affecting others", () => {
		seedSessionMessages("sess-a", [{ id: "1", role: "user", content: "a" }]);
		seedSessionMessages("sess-b", [{ id: "2", role: "user", content: "b" }]);

		clearSessionMessages("sess-a");

		expect(readSessionMessages("sess-a")).toEqual([]);
		expect(readSessionMessages("sess-b")).toHaveLength(1);
	});

	it("clears all sessions", () => {
		seedSessionMessages("sess-a", [{ id: "1", role: "user", content: "a" }]);
		seedSessionMessages("sess-b", [{ id: "2", role: "user", content: "b" }]);

		clearAllSessionMessages();

		expect(readSessionMessages("sess-a")).toEqual([]);
		expect(readSessionMessages("sess-b")).toEqual([]);
	});

	it("enforces a per-session cap on seed", () => {
		const messages = Array.from(
			{ length: MAX_CACHED_MESSAGES_PER_SESSION + 25 },
			(_, i) => ({
				id: `m${i}`,
				role: "user" as const,
				content: `msg ${i}`,
			}),
		);

		seedSessionMessages("sess-cap", messages);

		const cached = readSessionMessages("sess-cap");
		expect(cached).toHaveLength(MAX_CACHED_MESSAGES_PER_SESSION);
		expect(cached[0]?.id).toBe("m25");
		expect(cached.at(-1)?.id).toBe(`m${MAX_CACHED_MESSAGES_PER_SESSION + 24}`);
	});

	it("isolates sessions when merging and listing pending", () => {
		seedSessionMessages("sess-a", [
			{ id: "shared-looking", role: "user", content: "a" },
		]);
		seedSessionMessages("sess-b", [
			{ id: "shared-looking", role: "user", content: "b" },
		]);

		expect(listPendingSessionMessages("sess-a", [])).toEqual([
			expect.objectContaining({ content: "a" }),
		]);
		expect(listPendingSessionMessages("sess-b", [])).toEqual([
			expect.objectContaining({ content: "b" }),
		]);
	});
});
