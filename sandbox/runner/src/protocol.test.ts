import { describe, expect, it } from "vitest";
import {
	encodeLine,
	extractAssistantTextFromMessages,
	extractTextDelta,
	pickAssistantText,
} from "./protocol.js";

describe("protocol", () => {
	it("encodeLine ends with newline and JSON.parse round-trips", () => {
		const msg = {
			v: 1 as const,
			kind: "ready" as const,
			sessionId: "conv-1",
			model: "opencode-go/deepseek-v4-flash",
		};
		const line = encodeLine(msg);
		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line)).toEqual(msg);
	});

	it('extractTextDelta returns "Hello" for message_update fixture', () => {
		const event = {
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "Hello" },
		};
		expect(extractTextDelta(event)).toBe("Hello");
	});

	it('extractTextDelta returns null for { type: "agent_start" }', () => {
		expect(extractTextDelta({ type: "agent_start" })).toBeNull();
	});

	it("extractAssistantTextFromMessages joins assistant text blocks", () => {
		const messages = [
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Hello " },
					{ type: "text", text: "world" },
				],
			},
		];
		expect(extractAssistantTextFromMessages(messages)).toBe("Hello world");
	});

	it("pickAssistantText prefers deltas when non-empty", () => {
		const messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "from messages" }],
			},
		];
		expect(pickAssistantText("from deltas", messages)).toBe("from deltas");
		expect(pickAssistantText("  ", messages)).toBe("from messages");
	});
});
