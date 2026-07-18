import { describe, expect, it } from "vitest";
import {
	encodeLine,
	extractAssistantTextFromMessages,
	extractTextDelta,
	extractUserTextFromMessageStart,
	pickAssistantText,
	runnerOutputFromAgentEvent,
} from "./protocol.js";

describe("protocol", () => {
	it("encodeLine ends with newline and JSON.parse round-trips", () => {
		const msg = {
			v: 1 as const,
			kind: "ready" as const,
			sessionId: "conv-1",
			model: "opencode/deepseek-v4-flash-free",
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

	it("extracts user text from strict message_start shapes", () => {
		expect(
			extractUserTextFromMessageStart({
				type: "message_start",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "Follow " },
						{ type: "image", data: "ignored" },
						{ type: "text", text: "up" },
					],
				},
			}),
		).toBe("Follow up");
		expect(
			extractUserTextFromMessageStart({
				type: "message_start",
				message: { role: "assistant", content: "no" },
			}),
		).toBeNull();
	});

	it("encodes additive control events without changing the protocol version", () => {
		const event = {
			v: 1 as const,
			kind: "control_event" as const,
			event: {
				type: "follow_up_started" as const,
				requestId: "req-1",
				runId: "run-1",
				sessionId: "session-1",
				text: "Next",
				userMessageId: "user-2",
				assistantMessageId: "assistant-2",
			},
		};
		expect(JSON.parse(encodeLine(event))).toEqual(event);
	});

	it('extractTextDelta returns null for { type: "agent_start" }', () => {
		expect(extractTextDelta({ type: "agent_start" })).toBeNull();
	});

	it("normalizes only text deltas and tool lifecycle events", () => {
		expect(
			runnerOutputFromAgentEvent({
				type: "message_update",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello" }],
				},
				assistantMessageEvent: { type: "text_delta", delta: "Hello" },
			}),
		).toEqual({ v: 1, kind: "assistant_delta", delta: "Hello" });

		const toolEvent = {
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "edit",
			args: { path: "Footer.tsx" },
		};
		expect(runnerOutputFromAgentEvent(toolEvent)).toEqual({
			v: 1,
			kind: "agent_event",
			event: toolEvent,
		});
		expect(runnerOutputFromAgentEvent({ type: "message_start" })).toBeNull();
		expect(runnerOutputFromAgentEvent({ type: "message_end" })).toBeNull();
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

import { assertPublicAuthEvent, parseAuthControlRequest } from "./protocol.js";

describe("provider auth protocol", () => {
	it("assertPublicAuthEvent accepts exact variants and rejects extras", () => {
		expect(
			assertPublicAuthEvent({
				v: 1,
				kind: "device_code",
				userCode: "A",
				verificationUri: "https://example.com",
			}).kind,
		).toBe("device_code");
		expect(() =>
			assertPublicAuthEvent({
				v: 1,
				kind: "done",
				ok: true,
				credential: { access: "x" },
			}),
		).toThrow();
		expect(() => assertPublicAuthEvent({ v: 1, kind: "nope" })).toThrow();
	});

	it("parseAuthControlRequest rejects oversized/stale shapes", () => {
		expect(() =>
			parseAuthControlRequest({ action: "cancel", attemptId: "a", extra: 1 }),
		).toThrow();
		expect(() =>
			parseAuthControlRequest({
				action: "answer",
				attemptId: "a",
				promptId: "p",
				value: "x".repeat(9000),
			}),
		).toThrow();
	});
});
